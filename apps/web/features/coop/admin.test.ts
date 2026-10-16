/**
 * 管理表单的纯函数与手机 manifest（不需要 DOM 的部分）。
 *
 *  - 只提交真的变了的字段（否则并发编辑会被整行覆盖）；
 *  - 排序按新顺序重新编号，且只写回变化的行；
 *  - manifest 是十字段，图标必须是仓库里真实存在的资源（T00 会核对）。
 */

import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { COOP_PHONE_ICON, COOP_PHONE_MANIFEST } from "./phone-manifest";
import {
  POSITION_STEP,
  draftFromLink,
  draftToCreate,
  draftToPatch,
  emptyDraft,
  parsePosition,
  parseTags,
  planReorder,
} from "./admin/form";
import { adminLink } from "./test-support";

describe("草稿与载荷", () => {
  it("空草稿提交出合法的空表单（必填项由服务端与浏览器各自校验）", () => {
    expect(draftToCreate(emptyDraft())).toEqual({
      name: "",
      url: "",
      summary: "",
      story: null,
      arcana: null,
      tags: [],
      avatar_media_id: null,
      position: 0,
    });
  });

  it("标签支持逗号、顿号与换行，并去掉空白", () => {
    expect(parseTags("前端, 算法、生活\n笔记")).toEqual(["前端", "算法", "生活", "笔记"]);
  });

  it("排序值非法时回落成 0，不产生负数", () => {
    expect(parsePosition("-5")).toBe(0);
    expect(parsePosition("abc")).toBe(0);
    expect(parsePosition(" 30 ")).toBe(30);
  });

  it("编辑草稿只提交变化的字段（tags 传入即完整替换）", () => {
    const original = adminLink({ name: "站点", url: "https://example.com/", summary: "简介", version: 3 });
    const draft = { ...draftFromLink(original), summary: "新简介", tags: "前端, 算法" };

    expect(draftToPatch(draft, original)).toEqual({ summary: "新简介", tags: ["前端", "算法"] });
  });

  it("没有任何改动时 patch 为空对象（界面据此提示而不是发空请求）", () => {
    const original = adminLink({});
    expect(draftToPatch(draftFromLink(original), original)).toEqual({});
  });

  it("清空可空字段提交的是 null，而不是空字符串", () => {
    const original = adminLink({ story: "旧故事", arcana: "IX · HERMIT" });
    const draft = { ...draftFromLink(original), story: "", arcana: "" };

    expect(draftToPatch(draft, original)).toEqual({ story: null, arcana: null });
  });
});

describe("手动排序", () => {
  const items = [
    adminLink({ id: "a", position: 0, version: 1 }),
    adminLink({ id: "b", position: 10, version: 2 }),
    adminLink({ id: "c", position: 20, version: 3 }),
  ];

  it("上移交换顺序并只写回变化的位置", () => {
    const plan = planReorder(items, 2, -1);
    expect(plan?.order.map((item) => item.id)).toEqual(["a", "c", "b"]);
    // 变化按**新顺序**列出；未变化的 a（position 0）不会被写回。
    expect(plan?.changes).toEqual([
      { id: "c", version: 3, position: 1 * POSITION_STEP },
      { id: "b", version: 2, position: 2 * POSITION_STEP },
    ]);
  });

  it("位置全为 0（新建默认值）时也真的会换位", () => {
    const flat = [
      adminLink({ id: "a", position: 0 }),
      adminLink({ id: "b", position: 0 }),
    ];
    const plan = planReorder(flat, 1, -1);

    expect(plan?.order.map((item) => item.id)).toEqual(["b", "a"]);
    // b 落到 0 正好等于它原来的值（不需要写），只有 a 需要改。
    expect(plan?.changes).toEqual([{ id: "a", version: 1, position: POSITION_STEP }]);
  });

  it("边界不产生越界写入", () => {
    expect(planReorder(items, 0, -1)).toBeNull();
    expect(planReorder(items, 2, 1)).toBeNull();
    expect(planReorder(items, 9, 1)).toBeNull();
  });
});

describe("手机 manifest", () => {
  it("十个字段齐全，id / 路径 / loader 形状正确", () => {
    const manifest = COOP_PHONE_MANIFEST;
    expect(Object.keys(manifest).sort()).toEqual(
      [
        "canonical_path",
        "feature_flag",
        "icon",
        "id",
        "kind",
        "loader",
        "name",
        "order",
        "state_version",
        "subtitle",
      ].sort(),
    );
    expect(manifest.id).toBe("coop");
    expect(manifest.kind).toBe("embedded");
    expect(manifest.canonical_path).toBe("/apps/coop");
    expect(typeof manifest.loader).toBe("function");
  });

  it("图标是仓库里真实存在的资源（不是凭空写的路径）", () => {
    const file = path.join(process.cwd(), "public", COOP_PHONE_ICON.replace(/^\//, ""));
    expect(existsSync(file)).toBe(true);
  });

  it("loader 解析出的模块形状符合宿主协议", async () => {
    const loaded = await COOP_PHONE_MANIFEST.loader?.();
    expect(typeof loaded?.default).toBe("function");
    expect([...(loaded?.screens ?? [])]).toEqual(["links"]);
    expect(typeof loaded?.dispose).toBe("function");
  });
});
