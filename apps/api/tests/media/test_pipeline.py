"""图片处理管线的单元测试（05 §8）。

这些用例直接对真实字节跑 Pillow：不是 mock 解码器，而是断言「假 PNG / 损坏图 /
EXIF 方向 / GPS / 像素上限」的真实行为。上限类用例通过注入更小的 `ImageLimits`
来触发同一个代码分支（构造 4000 万像素真图只会让测试变慢变脆）。
"""

from __future__ import annotations

import hashlib
import io

import pytest
from PIL import Image, PngImagePlugin

from app.core.errors import ApiError
from app.modules.media.pipeline import ImageLimits, process_image
from tests.media.helpers import (
    corrupt_png,
    fake_png,
    jpeg_with_exif,
    padded_bytes,
    png_bytes,
    png_with_declared_size,
    webp_bytes,
)

LIMITS = ImageLimits(max_bytes=8 * 1024 * 1024, max_pixels=40_000_000, max_side=8192)


def _open(data: bytes) -> Image.Image:
    return Image.open(io.BytesIO(data))


def test_png_produces_fixed_webp_variants():
    processed = process_image(png_bytes(1600, 1200), LIMITS)
    assert processed.mime_type == "image/png"
    assert (processed.width, processed.height) == (1600, 1200)
    assert [variant.name for variant in processed.variants] == ["w320.webp", "w640.webp", "w1280.webp"]
    for variant in processed.variants:
        assert variant.mime_type == "image/webp"
        decoded = _open(variant.data)
        assert decoded.format == "WEBP"
        assert decoded.width == variant.width
        assert decoded.height == variant.height
        assert decoded.height == round(1200 * variant.width / 1600)


def test_small_image_is_not_upscaled():
    processed = process_image(png_bytes(200, 100), LIMITS)
    assert processed.variants == ()


def test_webp_input_is_supported():
    processed = process_image(webp_bytes(500, 500), LIMITS)
    assert processed.mime_type == "image/webp"
    assert [variant.name for variant in processed.variants] == ["w320.webp"]


def test_exif_orientation_applied_and_metadata_removed():
    data = jpeg_with_exif(600, 400, orientation=6, with_gps=True)

    # 先确认源图确实带 EXIF 方向与相机 / GPS 信息（否则本用例没有意义）
    source = _open(data)
    source_exif = source.getexif()
    assert source_exif.get(0x0112) == 6
    assert source_exif.get(0x010F) == "PHANTOM-TEST-CAMERA"

    processed = process_image(data, LIMITS)
    # orientation=6 → 顺时针 90 度：宽高互换
    assert (processed.width, processed.height) == (400, 600)
    assert processed.mime_type == "image/jpeg"

    result = _open(processed.data)
    assert result.size == (400, 600)
    assert dict(result.getexif()) == {}, "派生图的 EXIF 必须为空"
    assert "exif" not in result.info
    assert "icc_profile" not in result.info
    assert b"PHANTOM-TEST-CAMERA" not in processed.data
    assert b"2026:10:16 12:00:00" not in processed.data
    # 无 APP1(EXIF) 段
    assert b"\xff\xe1" not in processed.data

    for variant in processed.variants:
        assert dict(_open(variant.data).getexif()) == {}


def test_orientation_one_still_strips_metadata():
    data = jpeg_with_exif(300, 200, orientation=1, with_gps=True)
    processed = process_image(data, LIMITS)
    assert (processed.width, processed.height) == (300, 200)
    assert dict(_open(processed.data).getexif()) == {}


def test_png_text_chunks_are_stripped():
    buffer = io.BytesIO()
    info = PngImagePlugin.PngInfo()
    info.add_text("Comment", "SECRET-COMMENT-TEXT")
    Image.new("RGB", (400, 300), (1, 2, 3)).save(buffer, format="PNG", pnginfo=info)
    data = buffer.getvalue()
    assert b"SECRET-COMMENT-TEXT" in data  # 源图确实带文本块

    processed = process_image(data, LIMITS)
    assert b"SECRET-COMMENT-TEXT" not in processed.data
    assert _open(processed.data).text == {}


def test_sha256_is_of_the_stored_original():
    processed = process_image(png_bytes(400, 400), LIMITS)
    assert processed.sha256 == hashlib.sha256(processed.data).hexdigest()
    assert len(processed.sha256) == 64


def test_non_image_is_rejected_as_unsupported_type():
    with pytest.raises(ApiError) as excinfo:
        process_image(fake_png(), LIMITS)
    assert excinfo.value.status_code == 415
    assert excinfo.value.code == "UNSUPPORTED_MEDIA_TYPE"


def test_corrupt_png_is_rejected_as_unprocessable():
    with pytest.raises(ApiError) as excinfo:
        process_image(corrupt_png(), LIMITS)
    assert excinfo.value.status_code == 422
    assert excinfo.value.code == "UNPROCESSABLE"


def test_empty_payload_is_rejected():
    with pytest.raises(ApiError) as excinfo:
        process_image(b"", LIMITS)
    assert excinfo.value.status_code == 422


def test_too_large_payload_hits_413_before_decoding():
    with pytest.raises(ApiError) as excinfo:
        process_image(padded_bytes(LIMITS.max_bytes + 1), LIMITS)
    assert excinfo.value.status_code == 413
    assert excinfo.value.code == "PAYLOAD_TOO_LARGE"


def test_pixel_and_side_limits_are_enforced():
    tiny_limits = ImageLimits(max_bytes=8 * 1024 * 1024, max_pixels=1000, max_side=8192)
    with pytest.raises(ApiError) as excinfo:
        process_image(png_bytes(200, 200), tiny_limits)
    assert excinfo.value.status_code == 422
    assert "像素" in excinfo.value.message

    narrow_limits = ImageLimits(max_bytes=8 * 1024 * 1024, max_pixels=40_000_000, max_side=100)
    with pytest.raises(ApiError) as excinfo:
        process_image(png_bytes(200, 200), narrow_limits)
    assert excinfo.value.status_code == 422
    assert "单边" in excinfo.value.message


def test_declared_huge_dimensions_rejected_without_full_decode():
    """解压炸弹：头部声明 20000x20000、像素数据远不完整 → 直接拒绝，不分配 4 亿像素。"""
    data = png_with_declared_size(20000, 20000)
    assert len(data) < 8192, "构造出来的探针文件本身必须极小"
    with pytest.raises(ApiError) as excinfo:
        process_image(data, LIMITS)
    assert excinfo.value.status_code == 422
