"""媒体文件布局与原子写入（05 §3 / §4 / §8）。

对象键（storage_key 与变体 key）都由服务端从媒体 UUID 生成：

    <uuid 前两位>/<uuid>/original.<ext>     原图（仅站主可读）
    <uuid 前两位>/<uuid>/w320.webp          固定变体
    <uuid 前两位>/<uuid>/w640.webp
    <uuid 前两位>/<uuid>/w1280.webp

规则：
  - **不使用用户文件名**：键里没有任何客户端输入，路径穿越在结构上不可能。
  - 写入先写同目录临时文件再 `os.replace` 原子替换；失败时删除临时文件，
    不留半截文件被当成完整对象。
  - 键还经过白名单正则 + `resolve()` 包含性检查（纵深防御，防未来有人把键接到请求参数）。
  - 媒体卷不直接作为静态目录暴露：文件只通过 `GET /api/v1/media/{id}/{variant}` 出。
"""

from __future__ import annotations

import os
import re
import uuid
from pathlib import Path

ORIGINAL_VARIANT = "original"
VARIANT_WIDTHS = (320, 640, 1280)
VARIANT_FILENAMES = tuple(f"w{width}.webp" for width in VARIANT_WIDTHS)
# 允许的名字：original + 固定变体名。顺序稳定，供路由枚举与文档复用。
ALLOWED_VARIANT_NAMES = (ORIGINAL_VARIANT, *VARIANT_FILENAMES)

_OBJECT_KEY_RE = re.compile(r"^[0-9a-f]{2}/[0-9a-f]{32}/[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")

_EXTENSION_BY_MIME = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}


class StorageKeyError(ValueError):
    """对象键不合法（不是服务端生成形状）。"""


def media_prefix(media_id: uuid.UUID) -> str:
    hexed = media_id.hex
    return f"{hexed[:2]}/{hexed}"


def original_object_key(media_id: uuid.UUID, mime_type: str) -> str:
    extension = _EXTENSION_BY_MIME.get(mime_type)
    if extension is None:
        raise StorageKeyError(f"不支持的媒体类型：{mime_type}")
    return f"{media_prefix(media_id)}/{ORIGINAL_VARIANT}.{extension}"


def variant_object_key(media_id: uuid.UUID, variant_name: str) -> str:
    if variant_name not in VARIANT_FILENAMES:
        raise StorageKeyError(f"未知变体名：{variant_name}")
    return f"{media_prefix(media_id)}/{variant_name}"


def validate_object_key(key: str) -> str:
    if not _OBJECT_KEY_RE.match(key or ""):
        raise StorageKeyError("对象键不合法")
    return key


def object_path(root: Path, key: str) -> Path:
    """把对象键映射到绝对路径，并确认结果仍在 root 之内。"""
    validate_object_key(key)
    root_resolved = Path(root).resolve()
    candidate = (root_resolved / key).resolve()
    if root_resolved != candidate and root_resolved not in candidate.parents:
        raise StorageKeyError("对象键越出媒体根目录")
    return candidate


def write_object(root: Path, key: str, data: bytes) -> Path:
    """原子写入。先写 `.tmp-<uuid>` 再 replace；异常时清理临时文件后抛出。"""
    target = object_path(root, key)
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_name(f"{target.name}.tmp-{uuid.uuid4().hex}")
    try:
        with open(temp, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, target)
    except BaseException:
        try:
            temp.unlink(missing_ok=True)
        except OSError:  # pragma: no cover - 清理失败不掩盖原始异常
            pass
        raise
    return target


def delete_object(root: Path, key: str) -> bool:
    """删除一个对象。不存在返回 False，不抛错（幂等清理）。"""
    try:
        path = object_path(root, key)
    except StorageKeyError:
        return False
    existed = path.exists()
    try:
        path.unlink()
    except FileNotFoundError:
        return False
    try:
        # 目录空了就顺手删掉，避免媒体卷累积空目录。
        path.parent.rmdir()
    except OSError:
        pass
    return existed


def cleanup_objects(root: Path, keys: list[str]) -> list[str]:
    """按顺序删除多个对象，返回真正删除的键。用于失败回滚与清理报告。"""
    removed: list[str] = []
    for key in keys:
        try:
            if delete_object(root, key):
                removed.append(key)
        except OSError:  # pragma: no cover - 单个删除失败不影响其余
            continue
    return removed


def iter_stored_keys(root: Path) -> list[str]:
    """列出媒体根下所有符合布局的对象键（忽略探针与临时文件）。"""
    base = Path(root)
    if not base.exists():
        return []
    found: list[str] = []
    for path in sorted(base.rglob("*")):
        if not path.is_file():
            continue
        key = path.relative_to(base).as_posix()
        if ".tmp-" in path.name or path.name.startswith("."):
            continue
        try:
            validate_object_key(key)
        except StorageKeyError:
            # 形状不符的文件（例如运维手放的探针）不算媒体对象，但依然会被清理报告看见。
            found.append(key)
            continue
        found.append(key)
    return found
