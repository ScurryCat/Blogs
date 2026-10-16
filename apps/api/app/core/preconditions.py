"""乐观锁 / If-Match 与版本号（05 §7、SHARED-CONTRACTS §5）。

规则（所有管理写接口共用，模块不再各写一份）：
  - 站主详情响应带 `version` 并返回 `ETag: "3"`。
  - 更新 / 发布 / 撤回 / 删除必须带 `If-Match: "3"`：
      未提供 → 428（code `PRECONDITION_REQUIRED`）
      版本不一致 → 412（code `VERSION_CONFLICT`）
  - 412 时客户端保留未保存输入、读取新版并处理冲突，**不自动覆盖**。

T01 提供能力与测试；文章写接口属后续功能包（05 §7 末尾）。
"""

from __future__ import annotations

from fastapi import Response

from app.core.errors import (
    CODE_PRECONDITION_REQUIRED,
    CODE_VALIDATION_FAILED,
    CODE_VERSION_CONFLICT,
    ApiError,
)


def format_etag(version: int) -> str:
    """`version` → 强 ETag。整数版本不需要弱校验标记。"""
    return f'"{int(version)}"'


def parse_if_match(header: str | None) -> int:
    """解析 `If-Match`。缺失 → 428；`*` 或非数字 → 400。

    不接受 `*`：本站的并发控制要求客户端明确说出它改的是哪一版，
    「匹配任意版本」会让并行编辑的丢失重新变得可能。
    """
    if header is None or not header.strip():
        raise ApiError(
            CODE_PRECONDITION_REQUIRED,
            "缺少 If-Match，请先读取最新版本再提交",
            status_code=428,
            fields={"If-Match": ["缺少版本条件（If-Match）"]},
        )
    candidate = header.strip()
    if candidate.startswith("W/"):
        candidate = candidate[2:].strip()
    if len(candidate) >= 2 and candidate.startswith('"') and candidate.endswith('"'):
        candidate = candidate[1:-1]
    if candidate == "*":
        raise ApiError(
            CODE_VALIDATION_FAILED,
            "If-Match 必须指定具体版本号",
            status_code=400,
            fields={"If-Match": ["不支持通配版本"]},
        )
    try:
        version = int(candidate)
    except ValueError:
        raise ApiError(
            CODE_VALIDATION_FAILED,
            "If-Match 版本号格式不正确",
            status_code=400,
            fields={"If-Match": ["版本号必须是整数"]},
        ) from None
    if version < 1:
        raise ApiError(
            CODE_VALIDATION_FAILED,
            "If-Match 版本号格式不正确",
            status_code=400,
            fields={"If-Match": ["版本号必须是正整数"]},
        )
    return version


def require_version(current_version: int, if_match: str | None) -> None:
    """校验并发条件。通过则返回 None，否则抛 428 / 412 / 400。"""
    expected = parse_if_match(if_match)
    if expected != int(current_version):
        raise ApiError(
            CODE_VERSION_CONFLICT,
            "内容已在别处更新，请先读取最新版本。",
            status_code=412,
            fields={"version": [f"当前版本为 {int(current_version)}，提交的是 {expected}"]},
        )


def apply_etag(response: Response, version: int) -> None:
    response.headers["ETag"] = format_etag(version)
