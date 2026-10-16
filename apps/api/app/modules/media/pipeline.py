"""图片校验与派生（05 §8）。

规则（全部在本模块落地）：
  - 类型只认 JPEG / PNG / WebP，**以真实签名与解码结果判断**，不看扩展名或 Content-Type。
  - 单文件 8 MiB；解码像素上限 40MP，单边不超过 8192px。
  - 方向归一（EXIF Orientation 应用后删除），EXIF / GPS / ICC / 文本块等元信息一律去除。
  - 生成固定变体 w320 / w640 / w1280（WebP）；不放大超过原图的宽度。
  - 解码 / 缩放 / 编码都是 CPU 阻塞操作，由 `core.concurrency.run_bounded` 放进有界线程池，
    不在事件循环里执行。
  - 任何失败都抛 `ApiError`（413 / 415 / 422），不返回「差不多能用」的对象。

本模块是纯函数式的：输入字节，输出字节与元数据，**不碰文件系统、不碰数据库**，
因此可以被直接单元测试，也方便将来放进异步队列。
"""

from __future__ import annotations

import hashlib
import io
from dataclasses import dataclass
from typing import Iterable

from PIL import Image, ImageOps, PngImagePlugin, UnidentifiedImageError

from app.core.errors import (
    CODE_PAYLOAD_TOO_LARGE,
    CODE_UNSUPPORTED_MEDIA_TYPE,
    CODE_UNPROCESSABLE,
    ApiError,
)

# 以真实格式为准的允许集合：扩展名与 Content-Type 都不可信。
ALLOWED_FORMATS = {
    "JPEG": "image/jpeg",
    "PNG": "image/png",
    "WEBP": "image/webp",
}

VARIANT_WIDTHS = (320, 640, 1280)

# 原图重新编码时的质量；变体统一用 WebP。
JPEG_QUALITY = 92
WEBP_QUALITY = 88


@dataclass(frozen=True)
class ImageLimits:
    max_bytes: int
    max_pixels: int
    max_side: int


@dataclass(frozen=True)
class VariantArtifact:
    name: str
    width: int
    height: int
    data: bytes
    mime_type: str = "image/webp"


@dataclass(frozen=True)
class ProcessedImage:
    """一张上传图处理后的全部产物。`data` 是**已归一、已去元信息**的原图字节。"""

    mime_type: str
    width: int
    height: int
    data: bytes
    sha256: str
    variants: tuple[VariantArtifact, ...]
    source_format: str


def _payload_too_large() -> ApiError:
    return ApiError(
        CODE_PAYLOAD_TOO_LARGE,
        "文件过大，单张图片上限为 8 MiB",
        status_code=413,
        fields={"file": ["文件过大"]},
    )


def _unsupported(message: str = "仅支持 JPEG / PNG / WebP 图片") -> ApiError:
    return ApiError(
        CODE_UNSUPPORTED_MEDIA_TYPE,
        message,
        status_code=415,
        fields={"file": ["类型不支持"]},
    )


def _unprocessable(message: str) -> ApiError:
    return ApiError(CODE_UNPROCESSABLE, message, status_code=422, fields={"file": [message]})


def validate_size(data: bytes, limits: ImageLimits) -> None:
    if not data:
        raise _unprocessable("空文件不是有效图片")
    if len(data) > limits.max_bytes:
        raise _payload_too_large()


# 真实格式的签名：用来区分「根本不是图片」（415）与「是图片但数据损坏」（422）。
MAGIC_SIGNATURES: tuple[tuple[bytes, str], ...] = (
    (b"\x89PNG\r\n\x1a\n", "PNG"),
    (b"\xff\xd8\xff", "JPEG"),
)


def signature_format(data: bytes) -> str | None:
    """只看头部签名判断「声称是什么格式」。不用于接受文件，只用于错误分类。"""
    for signature, name in MAGIC_SIGNATURES:
        if data.startswith(signature):
            return name
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "WEBP"
    return None


def _open_and_identify(data: bytes) -> tuple[Image.Image, str]:
    """打开并识别格式。

    分类（05 §9）：
      - 认不出格式且没有已知图片签名 → 415（类型不支持，例如把 HTML 改名成 .png）
      - 有已知图片签名但解不开 → 422（图片解码不合法）
    """
    try:
        probe = Image.open(io.BytesIO(data))
    except UnidentifiedImageError:
        if signature_format(data) is not None:
            raise _unprocessable("图片文件损坏，无法解码") from None
        raise _unsupported() from None
    except Image.DecompressionBombError:
        raise _unprocessable("图片尺寸超出上限") from None
    except OSError:
        raise _unprocessable("图片文件损坏，无法解码") from None

    source_format = (probe.format or "").upper()
    if source_format not in ALLOWED_FORMATS:
        raise _unsupported(f"不支持的图片格式：{source_format or '未知'}")
    return probe, source_format


def _check_dimensions(width: int, height: int, limits: ImageLimits) -> None:
    if width < 1 or height < 1:
        raise _unprocessable("图片尺寸不合法")
    if width > limits.max_side or height > limits.max_side:
        raise _unprocessable(f"图片单边不能超过 {limits.max_side} 像素")
    if width * height > limits.max_pixels:
        raise _unprocessable("图片像素总数超出上限")


def _load_normalized(data: bytes, limits: ImageLimits) -> tuple[Image.Image, str]:
    """解码 → 方向归一 → 去掉全部元信息。"""
    probe, source_format = _open_and_identify(data)
    width, height = probe.size
    # 先看头部尺寸再解码：解压炸弹在分配内存之前就被拒绝。
    _check_dimensions(width, height, limits)
    try:
        image = ImageOps.exif_transpose(probe)
        image.load()
    except Image.DecompressionBombError:
        raise _unprocessable("图片尺寸超出上限") from None
    except OSError:
        raise _unprocessable("图片文件损坏，无法解码") from None

    # 方向已应用到像素，元信息不再需要：显式清掉，避免重新编码时被写回。
    # 注意只清元信息，不动 "transparency"（那是像素语义，不是元信息）。
    for key in ("exif", "icc_profile", "xmp", "comment"):
        image.info.pop(key, None)
    return image, source_format


def _webp_ready(image: Image.Image) -> Image.Image:
    """WebP 编码只接受 RGB / RGBA；其余模式显式转换，避免编码器报错。"""
    if image.mode in ("RGB", "RGBA"):
        return image
    if image.mode in ("P", "PA") or "transparency" in image.info:
        return image.convert("RGBA")
    return image.convert("RGB")


def _encode_original(image: Image.Image, source_format: str) -> bytes:
    buffer = io.BytesIO()
    if source_format == "JPEG":
        image.convert("RGB").save(
            buffer,
            format="JPEG",
            quality=JPEG_QUALITY,
            optimize=True,
            progressive=True,
            exif=b"",
            icc_profile=None,
        )
    elif source_format == "PNG":
        image.save(
            buffer,
            format="PNG",
            optimize=True,
            pnginfo=PngImagePlugin.PngInfo(),
            exif=b"",
            icc_profile=None,
        )
    else:  # WEBP
        _webp_ready(image).save(
            buffer,
            format="WEBP",
            quality=WEBP_QUALITY,
            method=4,
            exif=b"",
            icc_profile=None,
        )
    return buffer.getvalue()


def _encode_variant(image: Image.Image, width: int, height: int) -> bytes:
    buffer = io.BytesIO()
    resized = _webp_ready(image).resize((width, height), Image.Resampling.LANCZOS)
    resized.save(buffer, format="WEBP", quality=WEBP_QUALITY, method=4, exif=b"", icc_profile=None)
    return buffer.getvalue()


def _variant_names_for(width: int) -> Iterable[tuple[str, int]]:
    for candidate in VARIANT_WIDTHS:
        if candidate < width:
            yield f"w{candidate}.webp", candidate


def process_image(data: bytes, limits: ImageLimits) -> ProcessedImage:
    """同步处理（调用方负责放到有界线程池里执行）。"""
    validate_size(data, limits)
    image, source_format = _load_normalized(data, limits)
    width, height = image.size

    original_bytes = _encode_original(image, source_format)
    if len(original_bytes) > limits.max_bytes:
        # 归一后的原图仍然超过单文件上限：拒绝，而不是悄悄降质。
        raise _payload_too_large()

    variants: list[VariantArtifact] = []
    for name, target_width in _variant_names_for(width):
        target_height = max(1, round(height * (target_width / width)))
        variants.append(
            VariantArtifact(
                name=name,
                width=target_width,
                height=target_height,
                data=_encode_variant(image, target_width, target_height),
            )
        )

    digest = hashlib.sha256(original_bytes).hexdigest()
    return ProcessedImage(
        mime_type=ALLOWED_FORMATS[source_format],
        width=width,
        height=height,
        data=original_bytes,
        sha256=digest,
        variants=tuple(variants),
        source_format=source_format,
    )
