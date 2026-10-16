/**
 * INS 类型、纯函数与分页合并（T03）。
 *
 * 这些是「契约的形状」：码点计数、标签清洗、位置连续性、UUID 判定、
 * 分页去重与排序、变体优先级。它们不依赖 React，因此可以逐条断言边界值。
 */

import { describe, expect, it } from "vitest";

import {
  ALT_MAX_CODEPOINTS,
  FEED_PAGE_SIZE,
  MOMENTS_PATH,
  TEXT_MAX_CODEPOINTS,
  canonicalMomentPath,
  cleanTags,
  codepointLength,
  excerptOf,
  feedPath,
  formatPublishedAt,
  isMomentId,
  mergeMoments,
  previewUrl,
  validateDraftForPublish,
  validateTagInput,
  variantUrl,
  type Moment,
  type MomentImage,
} from "./types";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

function image(overrides: Partial<MomentImage> = {}): MomentImage {
  return {
    media_id: UUID_A,
    position: 0,
    alt: "操场",
    width: 800,
    height: 600,
    variants: [
      { name: "w320.webp", width: 320, height: 240, bytes: 10, url: "/api/v1/media/a/w320.webp" },
      { name: "w640.webp", width: 640, height: 480, bytes: 20, url: "/api/v1/media/a/w640.webp" },
      { name: "w1280.webp", width: 1280, height: 960, bytes: 30, url: "/api/v1/media/a/w1280.webp" },
    ],
    ...overrides,
  };
}

function moment(overrides: Partial<Moment> = {}): Moment {
  return {
    id: UUID_A,
    text: "测试",
    tags: [],
    published_at: "2026-10-16T04:00:00Z",
    images: [image()],
    ...overrides,
  };
}

describe("常量与路径", () => {
  it("FEED_PAGE_SIZE 定义在无 use client 的模块里（服务端也要用它构造 limit）", () => {
    // 服务端组件 import 带 `"use client"` 的模块时，导出会变成客户端引用函数而不是数字 ——
    // 真实浏览器联调里那会变成 `?limit=function(){throw …}` → API 422。
    expect(FEED_PAGE_SIZE).toBe(12);
    expect(Number.isInteger(FEED_PAGE_SIZE)).toBe(true);
  });

  it("公开列表路径与规格一致", () => {
    expect(MOMENTS_PATH).toBe("/moments");
    expect(TEXT_MAX_CODEPOINTS).toBe(2000);
    expect(ALT_MAX_CODEPOINTS).toBe(200);
  });

  it("canonical 分享地址是独立页地址（不含手机参数）", () => {
    expect(canonicalMomentPath(UUID_A)).toBe(`/apps/ins/${UUID_A}`);
    expect(canonicalMomentPath(UUID_A)).not.toContain("phone=");
  });

  it("feedPath 编码标签，空标签回到不带查询串的地址", () => {
    expect(feedPath(null)).toBe("/apps/ins");
    expect(feedPath("   ")).toBe("/apps/ins");
    expect(feedPath("校园 生活")).toBe(`/apps/ins?tag=${encodeURIComponent("校园 生活")}`);
  });
});

describe("isMomentId", () => {
  it("只接受 UUID，并作为类型谓词收窄", () => {
    expect(isMomentId(UUID_A)).toBe(true);
    // 未来的静态路由不能被动态段吞掉（08 §2）
    expect(isMomentId("messages")).toBe(false);
    expect(isMomentId("collections")).toBe(false);
    expect(isMomentId(null)).toBe(false);
    expect(isMomentId(undefined)).toBe(false);
    expect(isMomentId("")).toBe(false);
    expect(isMomentId(`${UUID_A}/extra`)).toBe(false);
  });

  it("收窄后可以直接当 string 用", () => {
    const value: string | null = UUID_A;
    if (!isMomentId(value)) throw new Error("should be a moment id");
    expect(value.toUpperCase()).toBe(UUID_A.toUpperCase());
  });
});

describe("codepointLength 与截断", () => {
  it("按码点计数，不按 UTF-16", () => {
    expect(codepointLength("abc")).toBe(3);
    expect(codepointLength("中文")).toBe(2);
    // 星形符号是 BMP 外的码点：`"𝐀".length` 是 2，码点数是 1
    expect("𝐀".length).toBe(2);
    expect(codepointLength("𝐀")).toBe(1);
  });

  it("excerptOf 按码点截断并加省略号", () => {
    expect(excerptOf("短文本")).toBe("短文本");
    expect(excerptOf("字".repeat(10), 4)).toBe("字字字字…");
    expect(excerptOf(" 前后有空白 ")).toBe("前后有空白");
    expect(excerptOf("𝐀".repeat(5), 3)).toBe("𝐀𝐀𝐀…");
  });
});

describe("cleanTags", () => {
  it("去首尾空白、丢掉空标签、去重并保留首次出现顺序", () => {
    expect(cleanTags([" 校园 ", "校园", "", "   ", "摄影", "摄影"])).toEqual(["校园", "摄影"]);
  });

  it("不改变大小写与中文（规范化由后端 slug 负责）", () => {
    expect(cleanTags(["Front End", "front end"])).toEqual(["Front End", "front end"]);
  });
});

describe("validateDraftForPublish", () => {
  it("没有图片就不能发布（03 §5）", () => {
    const issues = validateDraftForPublish({ text: "只有文字", images: [] });
    expect(issues.map((issue) => issue.field)).toEqual(["images"]);
    expect(issues[0]?.message).toContain("至少");
  });

  it("图片顺序必须从 0 连续", () => {
    const issues = validateDraftForPublish({
      text: "",
      images: [
        { media_id: UUID_A, position: 1, alt: "一" },
        { media_id: UUID_B, position: 2, alt: "二" },
      ],
    });
    expect(issues.some((issue) => issue.message.includes("从 0 开始"))).toBe(true);
  });

  it("每张图都要有替代文本，且不超过 200 码点", () => {
    expect(
      validateDraftForPublish({
        text: "",
        images: [{ media_id: UUID_A, position: 0, alt: "   " }],
      }).some((issue) => issue.message.includes("替代文本")),
    ).toBe(true);

    expect(
      validateDraftForPublish({
        text: "",
        images: [{ media_id: UUID_A, position: 0, alt: "字".repeat(201) }],
      }).some((issue) => issue.message.includes("200")),
    ).toBe(true);

    expect(
      validateDraftForPublish({
        text: "",
        images: [{ media_id: UUID_A, position: 0, alt: "字".repeat(200) }],
      }),
    ).toEqual([]);
  });

  it("文字超过 2000 码点会被拦下", () => {
    const issues = validateDraftForPublish({
      text: "字".repeat(2001),
      images: [{ media_id: UUID_A, position: 0, alt: "图" }],
    });
    expect(issues.some((issue) => issue.field === "text")).toBe(true);
  });

  it("合法草稿没有任何问题", () => {
    expect(
      validateDraftForPublish({
        text: "校园的下午",
        images: [
          { media_id: UUID_A, position: 0, alt: "操场" },
          { media_id: UUID_B, position: 1, alt: "走廊" },
        ],
      }),
    ).toEqual([]);
  });
});

describe("validateTagInput", () => {
  it("最多 8 个标签", () => {
    const issues = validateTagInput(Array.from({ length: 9 }, (_v, index) => `标签${index}`));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("8");
  });

  it("单个标签最多 24 码点", () => {
    expect(validateTagInput(["字".repeat(25)])[0]?.message).toContain("24");
    expect(validateTagInput(["字".repeat(24)])).toEqual([]);
  });

  it("重复标签在计数前先被去掉（8 个里 7 个重复不算超限）", () => {
    expect(validateTagInput(["校园", "校园", "校园"])).toEqual([]);
  });
});

describe("变体选择", () => {
  it("列表优先小图，预览优先大图，且绝不指向原图", () => {
    const item = image();
    expect(variantUrl(item)).toBe("/api/v1/media/a/w640.webp");
    expect(previewUrl(item)).toBe("/api/v1/media/a/w1280.webp");
    expect(variantUrl(item)).not.toContain("original");
  });

  it("缺少首选变体时回落到可用变体；完全没有变体时返回 null", () => {
    const onlyW320 = image({
      variants: [
        { name: "w320.webp", width: 320, height: 240, bytes: 1, url: "/api/v1/media/a/w320.webp" },
      ],
    });
    expect(variantUrl(onlyW320)).toBe("/api/v1/media/a/w320.webp");
    expect(previewUrl(onlyW320)).toBe("/api/v1/media/a/w320.webp");
    expect(variantUrl(image({ variants: [] }))).toBeNull();
    expect(previewUrl(image({ variants: [] }))).toBeNull();
  });
});

describe("mergeMoments", () => {
  it("按 ID 去重（分页相邻两页可能重复）", () => {
    // 两条时间不同，因此结果顺序由时间决定；去重的证据是「第一条只出现一次」。
    const first = moment({ id: UUID_A, published_at: "2026-10-16T03:00:00Z" });
    const second = moment({ id: UUID_B, published_at: "2026-10-16T04:00:00Z" });
    const merged = mergeMoments([first], [first, second]);
    expect(merged).toHaveLength(2);
    expect(merged.filter((item) => item.id === UUID_A)).toHaveLength(1);
    expect(merged.map((item) => item.id)).toEqual([UUID_B, UUID_A]);
  });

  it("已加载的条目在新一页里被撤回时不重复、也不丢失其他条目", () => {
    const kept = moment({ id: UUID_A, published_at: "2026-10-16T04:00:00Z" });
    const next = moment({ id: UUID_B, published_at: "2026-10-16T02:00:00Z" });
    expect(mergeMoments([kept], [next]).map((item) => item.id)).toEqual([UUID_A, UUID_B]);
    // 第二页整页都是已看过的条目（撤回导致 API 重发）→ 结果不变
    expect(mergeMoments([kept, next], [kept, next]).map((item) => item.id)).toEqual([UUID_A, UUID_B]);
  });

  it("按 published_at DESC, id DESC 稳定排序", () => {
    const sameTimeA = moment({ id: UUID_A, published_at: "2026-10-16T04:00:00Z" });
    const sameTimeB = moment({ id: UUID_B, published_at: "2026-10-16T04:00:00Z" });
    const older = moment({
      id: "33333333-3333-4333-8333-333333333333",
      published_at: "2026-10-15T04:00:00Z",
    });
    const merged = mergeMoments([older, sameTimeA], [sameTimeB]);
    expect(merged.map((item) => item.id)).toEqual([UUID_B, UUID_A, older.id]);
  });

  it("published_at 为 null（草稿形状）排在最后，不抛错", () => {
    const draft = moment({ id: UUID_B, published_at: null });
    const published = moment({ id: UUID_A, published_at: "2026-10-16T04:00:00Z" });
    expect(mergeMoments([draft], [published]).map((item) => item.id)).toEqual([UUID_A, UUID_B]);
  });
});

describe("formatPublishedAt", () => {
  it("把 UTC ISO 转成可读本地时间", () => {
    const formatted = formatPublishedAt("2026-10-16T04:00:00Z");
    expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it("空值与无法解析的值不显示 Invalid Date", () => {
    expect(formatPublishedAt(null)).toBe("");
    expect(formatPublishedAt("not-a-date")).toBe("not-a-date");
  });
});
