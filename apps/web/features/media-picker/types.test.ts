/**
 * 共享图片选择器的纯函数（P5 第一批 · C3）。
 *
 * 这里钉住的是**规则**而不是组件：格式预检（HEIC 明确提示、不承诺自动转换）、
 * 大小上限、分页去重、变体优先级、替代文本长度、已选归一化。
 */

import { describe, expect, it } from "vitest";

import {
  HEIC_UNSUPPORTED_MESSAGE,
  MEDIA_ALT_MAX_CODEPOINTS,
  MEDIA_UPLOAD_MAX_BYTES,
  TOO_LARGE_MESSAGE,
  UNSUPPORTED_FORMAT_MESSAGE,
  codepointLength,
  isAltValid,
  isHeicFile,
  isMediaReady,
  isPubliclyReferenced,
  mediaMetaLabel,
  mediaSizeLabel,
  mediaStatusLabel,
  mediaVariantUrl,
  mergeMediaPages,
  normalizePickedImages,
  toPickedImages,
  validateImageFile,
  type MediaPickerMedia,
} from "./types";

function media(id: string, overrides: Partial<MediaPickerMedia> = {}): MediaPickerMedia {
  return {
    id,
    mime_type: "image/png",
    bytes: 1000,
    width: 800,
    height: 600,
    sha256: "hash",
    status: "ready",
    created_at: "2026-10-18T00:00:00Z",
    original_url: `/api/v1/media/${id}/original`,
    variants: [
      { name: "w320.webp", width: 320, height: 240, bytes: 10, url: `/api/v1/media/${id}/w320.webp` },
      { name: "w640.webp", width: 640, height: 480, bytes: 20, url: `/api/v1/media/${id}/w640.webp` },
    ],
    ...overrides,
  };
}

function fileLike(name: string, type: string, size = 1024): { name: string; type: string; size: number } {
  return { name, type, size };
}

describe("上传前格式预检", () => {
  it("HEIC / HEIF 明确提示，且不承诺自动转换", () => {
    expect(isHeicFile(fileLike("IMG_0001.HEIC", "image/heic"))).toBe(true);
    expect(isHeicFile(fileLike("photo.heif", ""))).toBe(true);
    expect(isHeicFile(fileLike("photo.png", "image/png"))).toBe(false);
    expect(validateImageFile(fileLike("IMG_0001.HEIC", "image/heic"))).toBe(HEIC_UNSUPPORTED_MESSAGE);
    expect(HEIC_UNSUPPORTED_MESSAGE).toContain("HEIC");
    expect(HEIC_UNSUPPORTED_MESSAGE).toContain("不会自动转换");
  });

  it("JPEG / PNG / WebP 允许；其他图片类型与未知类型提示不支持", () => {
    expect(validateImageFile(fileLike("a.jpg", "image/jpeg"))).toBeNull();
    expect(validateImageFile(fileLike("a.png", "image/png"))).toBeNull();
    expect(validateImageFile(fileLike("a.webp", "image/webp"))).toBeNull();
    expect(validateImageFile(fileLike("a.gif", "image/gif"))).toBe(UNSUPPORTED_FORMAT_MESSAGE);
    expect(validateImageFile(fileLike("a.txt", "text/plain"))).toBe(UNSUPPORTED_FORMAT_MESSAGE);
  });

  it("浏览器不给 MIME 时按扩展名兜底（不误拒常见图片）", () => {
    expect(validateImageFile(fileLike("photo.JPG", ""))).toBeNull();
    expect(validateImageFile(fileLike("photo.webp", ""))).toBeNull();
    expect(validateImageFile(fileLike("archive.zip", ""))).toBe(UNSUPPORTED_FORMAT_MESSAGE);
  });

  it("超过 8 MiB 的图片直接提示，不发请求", () => {
    expect(validateImageFile(fileLike("a.png", "image/png", MEDIA_UPLOAD_MAX_BYTES + 1))).toBe(
      TOO_LARGE_MESSAGE,
    );
    expect(validateImageFile(fileLike("a.png", "image/png", MEDIA_UPLOAD_MAX_BYTES))).toBeNull();
  });
});

describe("媒体列表与展示辅助", () => {
  it("分页合并按 ID 去重并保留先出现的顺序", () => {
    const a = media("a");
    const b = media("b");
    const c = media("c");
    const merged = mergeMediaPages([a, b], [b, c]);
    expect(merged.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("缩略图优先 w320，缺变体时退回已有变体，不猜原图地址", () => {
    const full = media("a");
    expect(mediaVariantUrl(full)).toBe("/api/v1/media/a/w320.webp");
    const noThumb = media("b", {
      variants: [
        { name: "w1280.webp", width: 1280, height: 960, bytes: 30, url: "/api/v1/media/b/w1280.webp" },
      ],
    });
    expect(mediaVariantUrl(noThumb)).toBe("/api/v1/media/b/w1280.webp");
    expect(mediaVariantUrl(media("c", { variants: [] }))).toBeNull();
  });

  it("尺寸与状态文案稳定（供选择器与测试共用）", () => {
    expect(mediaSizeLabel(media("a"))).toBe("800×600");
    expect(mediaStatusLabel({ status: "ready" })).toBe("已上传（ready）");
    expect(mediaStatusLabel({ status: "pending" })).toContain("处理中");
    expect(mediaStatusLabel({ status: "failed" })).toContain("处理失败");
    expect(mediaMetaLabel(media("a"))).toContain("800×600");
    expect(isMediaReady({ status: "ready" })).toBe(true);
    expect(isMediaReady({ status: "pending" })).toBe(false);
  });

  it("公开引用只认服务端 true（字段缺失当作没有提示，不据此授权）", () => {
    const withReference: MediaPickerMedia = { ...media("a"), publicly_referenced: true };
    expect(isPubliclyReferenced(withReference)).toBe(true);
    expect(isPubliclyReferenced(media("a"))).toBe(false);
    expect(isPubliclyReferenced(null)).toBe(false);
  });
});

describe("替代文本与已选归一化", () => {
  it("码点计数与 1–200 字规则", () => {
    expect(codepointLength("🎮")).toBe(1);
    expect(codepointLength("操场")).toBe(2);
    expect(isAltValid("")).toBe(false);
    expect(isAltValid("   ")).toBe(false);
    expect(isAltValid("操场")).toBe(true);
    const max = "字".repeat(MEDIA_ALT_MAX_CODEPOINTS);
    expect(isAltValid(max)).toBe(true);
    expect(isAltValid(`${max}多`)).toBe(false);
  });

  it("已选归一化：去空白、去重、截断到上限、不丢媒体详情", () => {
    const a = media("a");
    const normalized = normalizePickedImages(
      [
        { media_id: "a", alt: "甲", media: a },
        { media_id: "a", alt: "重复", media: a },
        { media_id: " ", alt: "空 id" },
        { media_id: "b", alt: "乙" },
      ],
      9,
    );
    expect(normalized.map((item) => item.media_id)).toEqual(["a", "b"]);
    expect(normalized[0]?.media?.id).toBe("a");
    expect(normalized[1]?.media).toBeUndefined();
    expect(normalizePickedImages([{ media_id: "a", alt: "1" }, { media_id: "b", alt: "2" }], 1)).toHaveLength(1);
  });

  it("回写时按数组顺序生成 position，并去掉替代文本首尾空白", () => {
    const next = toPickedImages([
      { media_id: "a", alt: "  操场  " },
      { media_id: "b", alt: "" },
    ]);
    expect(next).toEqual([
      { media_id: "a", alt: "操场", position: 0 },
      { media_id: "b", alt: "", position: 1 },
    ]);
  });
});
