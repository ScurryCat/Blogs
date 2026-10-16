"""媒体测试用的真实图片构造与上传辅助。

图片全部在测试里现场生成（不依赖仓库素材），并且**真的**经过 Pillow 编码：
因此「假 PNG / 损坏图 / EXIF 方向 / GPS」这些用例操作的是真实字节，
不是被 mock 掉的解码器。
"""

from __future__ import annotations

import hashlib
import io
import struct
import uuid
import zlib
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

from app.modules.media import storage
from tests.auth.helpers import ORIGIN

UPLOAD_PATH = "/api/v1/admin/media"


def png_bytes(width: int = 800, height: int = 600, color=(200, 30, 40)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), color).save(buffer, format="PNG")
    return buffer.getvalue()


def jpeg_with_exif(
    width: int = 600,
    height: int = 400,
    *,
    orientation: int = 6,
    with_gps: bool = True,
) -> bytes:
    """带 EXIF 方向与 GPS 的 JPEG。

    orientation=6 表示「顺时针旋转 90 度后才是正的」，因此处理后的尺寸应变成 400x600。
    """
    image = Image.new("RGB", (width, height), (10, 120, 200))
    exif = Image.Exif()
    exif[0x0112] = orientation  # Orientation
    exif[0x0132] = "2026:10:16 12:00:00"  # DateTime（也是要清掉的元信息）
    if with_gps:
        # Pillow 的 GPS IFD：经纬度用十进制度数写入，读取侧会得到真实 rational。
        exif[0x8825] = {
            1: "N",
            2: 35.6764,
            3: "E",
            4: 139.65,
        }
        exif[0x010F] = "PHANTOM-TEST-CAMERA"  # Make：用于断言元信息确实被清掉
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", exif=exif, quality=90)
    return buffer.getvalue()


def webp_bytes(width: int = 500, height: int = 500) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGBA", (width, height), (0, 0, 0, 0)).save(buffer, format="WEBP")
    return buffer.getvalue()


def fake_png() -> bytes:
    """扩展名是 .png、内容其实是 HTML —— 必须按类型不支持拒绝，而不是相信扩展名。"""
    return b"<html><body>not an image at all</body></html>"


def corrupt_png() -> bytes:
    """有正确的 PNG 签名，但数据不可解码：属于「解码不合法」，与「类型不支持」区分开。"""
    return b"\x89PNG\r\n\x1a\n" + b"\x00" * 64 + b"garbage-garbage-garbage"


def png_with_declared_size(width: int, height: int) -> bytes:
    """构造只声明巨大尺寸、像素数据被截断的 PNG。

    用途：断言「先看头部尺寸再解码」，解压炸弹在分配内存之前就被拒绝。
    """
    def chunk(kind: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + kind
            + payload
            + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)
    # 只给一行像素的 IDAT：尺寸信息完整，像素数据远不完整。
    idat = zlib.compress(b"\x00" * min(width + 1, 4096))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def padded_bytes(size: int) -> bytes:
    return b"\x89PNG\r\n\x1a\n" + b"\x00" * max(0, size - 8)


def upload(
    client: TestClient,
    data: bytes,
    *,
    filename: str = "photo.png",
    content_type: str = "image/png",
    csrf_token: str | None = None,
    transport: str = "form",
    origin: str = ORIGIN,
    field_name: str = "file",
):
    """POST /admin/media。

    transport="form" 把 CSRF token 放在 multipart 表单字段（前端上传的常规做法）；
    transport="header" 走 X-CSRF-Token。
    """
    files = {field_name: (filename, data, content_type)}
    form: dict[str, str] = {}
    headers: dict[str, str] = {"Origin": origin}
    if csrf_token is not None:
        if transport == "header":
            headers["X-CSRF-Token"] = csrf_token
        else:
            form["csrf_token"] = csrf_token
    return client.post(UPLOAD_PATH, files=files, data=form, headers=headers)


def media_root(t01_settings) -> Path:
    return t01_settings.media_root_path


def stored_keys(root: Path) -> list[str]:
    return storage.iter_stored_keys(root)


def make_media_row(
    session,
    *,
    owner_id,
    root: Path | None = None,
    width: int = 800,
    height: int = 600,
    mime_type: str = "image/png",
    status: str = "ready",
    deleted_at=None,
    variant_names: tuple[str, ...] = ("w320.webp", "w640.webp"),
    data: bytes | None = None,
):
    """直接插一条媒体记录（可选把文件真的写到磁盘上）。

    需要「匿名能读到字节」的用例传 `root`，需要「只有元数据」的用例不传。
    """
    from app.modules.media.models import Media, STATUS_READY
    from app.modules.media.storage import original_object_key, variant_object_key

    media_id = uuid.uuid4()
    effective_status = status or STATUS_READY
    key = original_object_key(media_id, mime_type)
    variants: dict[str, dict[str, object]] = {}
    for name in variant_names:
        variant_key = variant_object_key(media_id, name)
        variants[name] = {
            "key": variant_key,
            "mime_type": "image/webp",
            "width": 320,
            "height": max(1, round(height * 320 / width)),
            "bytes": 128,
        }

    payload = data if data is not None else png_bytes(width, height)
    if root is not None:
        storage.write_object(root, key, payload)
        for entry in variants.values():
            storage.write_object(root, str(entry["key"]), b"RIFF0000WEBPVP8 ")

    row = Media(
        id=media_id,
        owner_id=owner_id,
        storage_key=key,
        mime_type=mime_type,
        bytes=len(payload),
        width=width,
        height=height,
        sha256=hashlib.sha256(payload).hexdigest(),
        variants=variants,
        status=effective_status,
        deleted_at=deleted_at,
    )
    session.add(row)
    session.flush()
    return row
