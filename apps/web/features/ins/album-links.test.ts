// @vitest-environment node
/**
 * 动态 → 相册收录（第三轮 §4.2–4.3，N4b）的纯函数与契约对齐。
 *
 * 契约来源：`docs/agent-deliveries/N3-result.md` 第 3 节 + 真实契约
 * `contracts/openapi.json`（本测试直接从磁盘读契约，字段一漂就红）。
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ALBUM_LINK_MEDIA_MAX,
  albumLinkSummary,
  cleanAlbumLinks,
  purgeAlbumLinks,
  validateAlbumLinks,
} from "./types";

const MEDIA = {
  a: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  b: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  c: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  d: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
} as const;

const ALBUM = {
  tokyo: "11111111-1111-4111-8111-111111111111",
  kyoto: "22222222-2222-4222-8222-222222222222",
} as const;

describe("cleanAlbumLinks（提交前清洗，服务端仍是权威）", () => {
  it("按相册去重、按媒体去重并保留首次出现顺序", () => {
    const cleaned = cleanAlbumLinks([
      { album_id: ALBUM.tokyo, media_ids: [MEDIA.a, MEDIA.a, MEDIA.b] },
      { album_id: ALBUM.tokyo, media_ids: [MEDIA.c] },
      { album_id: ALBUM.kyoto, media_ids: [MEDIA.b, MEDIA.a] },
    ]);
    expect(cleaned).toEqual([
      { album_id: ALBUM.tokyo, media_ids: [MEDIA.a, MEDIA.b] },
      { album_id: ALBUM.kyoto, media_ids: [MEDIA.b, MEDIA.a] },
    ]);
  });

  it("丢掉「选了相册但一张图都没勾」的条目（不产生任何收录来源）", () => {
    expect(cleanAlbumLinks([{ album_id: ALBUM.tokyo, media_ids: [] }])).toEqual([]);
    expect(cleanAlbumLinks([{ album_id: "  ", media_ids: [MEDIA.a] }])).toEqual([]);
    expect(cleanAlbumLinks([{ album_id: ALBUM.tokyo, media_ids: ["  "] }])).toEqual([]);
  });

  it("单个相册的媒体数截断到契约上限（9 张，与动态图片上限一致）", () => {
    expect(ALBUM_LINK_MEDIA_MAX).toBe(9);
    const many = Array.from({ length: 12 }, (_unused, index) =>
      `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    );
    const cleaned = cleanAlbumLinks([{ album_id: ALBUM.tokyo, media_ids: many }]);
    expect(cleaned[0]?.media_ids).toHaveLength(9);
  });

  it("空输入得到空数组（提交 [] = 清空全部收录选择）", () => {
    expect(cleanAlbumLinks([])).toEqual([]);
  });
});

describe("purgeAlbumLinks（动态删图后同步清理选择）", () => {
  it("去掉已不在动态里的媒体；相册因此一张不剩时整条移除", () => {
    const links = [
      { album_id: ALBUM.tokyo, media_ids: [MEDIA.a, MEDIA.b] },
      { album_id: ALBUM.kyoto, media_ids: [MEDIA.c] },
    ];
    expect(purgeAlbumLinks(links, [MEDIA.a])).toEqual([
      { album_id: ALBUM.tokyo, media_ids: [MEDIA.a] },
    ]);
  });

  it("全部图片都还在时不做任何改动（但输出是新数组）", () => {
    const links = [{ album_id: ALBUM.tokyo, media_ids: [MEDIA.a, MEDIA.b] }];
    const purged = purgeAlbumLinks(links, [MEDIA.a, MEDIA.b]);
    expect(purged).toEqual(links);
    expect(purged).not.toBe(links);
  });
});

describe("validateAlbumLinks（客户端预检）", () => {
  it("合法选择没有 issue", () => {
    expect(
      validateAlbumLinks([{ album_id: ALBUM.tokyo, media_ids: [MEDIA.a] }], [MEDIA.a, MEDIA.b]),
    ).toEqual([]);
  });

  it("包含不属于当前动态的媒体时给出可读提示（否则服务端会 409 整单拒绝）", () => {
    const issues = validateAlbumLinks(
      [{ album_id: ALBUM.tokyo, media_ids: [MEDIA.c] }],
      [MEDIA.a, MEDIA.b],
    );
    expect(issues.map((issue) => issue.field)).toEqual(["album_links"]);
    expect(issues[0]?.message).toContain("不属于本条动态");
  });

  it("单相册超过上限时给出提示", () => {
    const many = Array.from({ length: 10 }, (_unused, index) => `media-${index}`);
    const issues = validateAlbumLinks([{ album_id: ALBUM.tokyo, media_ids: many }], many);
    expect(issues[0]?.message).toContain("最多收录 9 张");
  });
});

describe("albumLinkSummary（保存后的可读提示）", () => {
  it("分别统计相册数与去重后的图片数，忽略空条目", () => {
    expect(
      albumLinkSummary([
        { album_id: ALBUM.tokyo, media_ids: [MEDIA.a, MEDIA.b] },
        { album_id: ALBUM.kyoto, media_ids: [MEDIA.b, MEDIA.c] },
        { album_id: ALBUM.kyoto, media_ids: [MEDIA.d] },
        { album_id: "", media_ids: [MEDIA.d] },
      ]),
    ).toEqual({ albums: 2, media: 3 });
  });
});

describe("与 N3 冻结契约对齐（contracts/openapi.json）", () => {
  const contract = JSON.parse(
    readFileSync(path.resolve(process.cwd(), "../../contracts/openapi.json"), "utf8"),
  ) as {
    components: {
      schemas: Record<
        string,
        {
          properties?: Record<string, { items?: { $ref?: string }; type?: string; maxItems?: number; anyOf?: unknown[] }>;
          required?: string[];
        }
      >
    };
  };
  const schemas = contract.components.schemas;

  it("MomentAlbumLinkIn：要求 album_id，media_ids 可选且上限 9", () => {
    const schema = schemas.MomentAlbumLinkIn!;
    expect(schema.required).toEqual(["album_id"]);
    expect(schema.properties?.media_ids?.maxItems).toBe(ALBUM_LINK_MEDIA_MAX);
  });

  it("MomentAlbumLinkOut：回执形状与前端读取的类型一致", () => {
    const schema = schemas.MomentAlbumLinkOut!;
    expect(schema.required?.sort()).toEqual(["album_id", "media_ids"]);
    expect(schema.properties?.album_id?.type).toBe("string");
    expect(schema.properties?.media_ids?.type).toBe("array");
  });

  it("MomentCreateIn / MomentUpdateIn 都接受 album_links，且 Create 侧上限与动态图片上限无关（200）", () => {
    expect(schemas.MomentCreateIn!.properties?.album_links?.maxItems).toBe(200);
    const update = schemas.MomentUpdateIn!.properties?.album_links;
    // Update 侧允许 null（= 保留原配置），因此是 anyOf。
    expect(Array.isArray(update?.anyOf)).toBe(true);
  });

  it("MomentAdminOut 返回 album_links（非 required，前端按可选 + `?? []` 兜底）", () => {
    const admin = schemas.MomentAdminOut!;
    expect(admin.properties?.album_links?.type).toBe("array");
    expect(admin.properties?.album_links?.items?.$ref).toBe(
      "#/components/schemas/MomentAlbumLinkOut",
    );
    expect(admin.required?.includes("album_links")).toBe(false);
  });
});
