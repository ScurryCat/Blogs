/**
 * returnTo 白名单与链接工具（契约 §4.6 / §9.5）。
 *
 * 断言的是**安全边界**：跨源、协议相对地址、反斜杠、控制字符、非白名单路径全部拒绝；
 * 白名单内页面保留查询串（手机 deep-link 的 phone/screen/item 要能恢复）。
 */

import { describe, expect, it } from "vitest";

import {
  readReturnTo,
  safeInternalPath,
  stripPhoneContext,
  withReturnTo,
} from "./return-context";

describe("safeInternalPath", () => {
  it("接受白名单内的站内路径与查询串", () => {
    expect(safeInternalPath("/")).toBe("/");
    expect(safeInternalPath("/?phone=ins&screen=feed")).toBe("/?phone=ins&screen=feed");
    expect(safeInternalPath("/apps/ins")).toBe("/apps/ins");
    expect(safeInternalPath("/apps/ins/aaaa-bbbb?tab=saved")).toBe("/apps/ins/aaaa-bbbb?tab=saved");
    expect(safeInternalPath("/apps/journal/2026-10-18")).toBe("/apps/journal/2026-10-18");
    expect(safeInternalPath("/apps/leisure?tab=anime")).toBe("/apps/leisure?tab=anime");
    expect(safeInternalPath("/apps/leblanc")).toBe("/apps/leblanc");
  });

  it("拒绝协议相对地址（// 开头）", () => {
    expect(safeInternalPath("//evil.example.com")).toBeNull();
    expect(safeInternalPath("//evil.example.com/apps/ins")).toBeNull();
    // URLSearchParams 解码后的形式同样拒绝
    expect(safeInternalPath("//")).toBeNull();
  });

  it("拒绝异源/带协议的地址", () => {
    expect(safeInternalPath("https://evil.example.com/apps/ins")).toBeNull();
    expect(safeInternalPath("http://evil.example.com")).toBeNull();
    expect(safeInternalPath("javascript:alert(1)")).toBeNull();
    expect(safeInternalPath("data:text/html,hi")).toBeNull();
    expect(safeInternalPath("apps/ins")).toBeNull();
    expect(safeInternalPath("evil.example.com")).toBeNull();
  });

  it("拒绝反斜杠（浏览器会把 \\ 当 /）", () => {
    expect(safeInternalPath("/\\evil.example.com")).toBeNull();
    expect(safeInternalPath("/apps/ins\\..\\..\\admin")).toBeNull();
    expect(safeInternalPath("\\\\evil.example.com")).toBeNull();
  });

  it("拒绝控制字符（含 NUL、换行、TAB、DEL）", () => {
    expect(safeInternalPath("/apps/ins\u0000")).toBeNull();
    expect(safeInternalPath("/apps/ins\n")).toBeNull();
    expect(safeInternalPath("/apps/\tins")).toBeNull();
    expect(safeInternalPath("/apps/ins\u007f")).toBeNull();
  });

  it("拒绝白名单之外的站内路径（例如管理页/文章页/地图）", () => {
    expect(safeInternalPath("/admin")).toBeNull();
    expect(safeInternalPath("/admin/login")).toBeNull();
    expect(safeInternalPath("/posts/hello")).toBeNull();
    expect(safeInternalPath("/map")).toBeNull();
    expect(safeInternalPath("/apps/metanav")).toBeNull();
    expect(safeInternalPath("/apps/ins-evil")).toBeNull();
  });

  it("空值/非字符串返回 null", () => {
    expect(safeInternalPath(null)).toBeNull();
    expect(safeInternalPath(undefined)).toBeNull();
    expect(safeInternalPath("")).toBeNull();
  });
});

describe("withReturnTo / readReturnTo", () => {
  it("把 returnTo 用 encodeURIComponent 放进链接", () => {
    expect(withReturnTo("/admin/moments/new", "/apps/ins?tab=feed")).toBe(
      "/admin/moments/new?returnTo=%2Fapps%2Fins%3Ftab%3Dfeed",
    );
  });

  it("已有查询串时用 & 追加", () => {
    expect(withReturnTo("/admin/journal/new?date=2026-10-18", "/apps/journal")).toBe(
      "/admin/journal/new?date=2026-10-18&returnTo=%2Fapps%2Fjournal",
    );
  });

  it("没有 returnTo 时原样返回链接", () => {
    expect(withReturnTo("/admin/moments/new", null)).toBe("/admin/moments/new");
    expect(withReturnTo("/admin/moments/new", "")).toBe("/admin/moments/new");
  });

  it("readReturnTo 解码并校验；非法返回 null", () => {
    const good = new URLSearchParams("?returnTo=%2Fapps%2Fjournal%2F2026-10-18");
    expect(readReturnTo(good)).toBe("/apps/journal/2026-10-18");

    const evil = new URLSearchParams("?returnTo=%2F%2Fevil.example.com");
    expect(readReturnTo(evil)).toBeNull();

    expect(readReturnTo(new URLSearchParams(""))).toBeNull();
    expect(readReturnTo(null)).toBeNull();
  });
});

describe("stripPhoneContext", () => {
  it("去掉 phone/screen/item，保留其他查询串与片段", () => {
    expect(stripPhoneContext("/?phone=ins&screen=feed&tab=saved#top")).toBe("/?tab=saved#top");
    expect(stripPhoneContext("/apps/ins?phone=1&item=x")).toBe("/apps/ins");
    expect(stripPhoneContext("/apps/ins?tab=saved")).toBe("/apps/ins?tab=saved");
    expect(stripPhoneContext("/apps/ins")).toBe("/apps/ins");
  });
});
