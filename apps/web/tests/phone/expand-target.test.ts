/**
 * 手机「展开查看」的目标（R3）。
 *
 * 验收要求：INS 会话展开后必须仍是**当前那段会话的 canonical 页面**，
 * 而不是笼统回到 INS 首页；列表屏展开到消息页；其他屏幕/应用沿用
 * `manifest.canonical_path`。这里把规则钉成纯函数测试，宿主只负责调用
 * `host.openSiteContent({ destination, source: "phone-link" })`。
 */

import { describe, expect, it } from "vitest";

import { INS_PHONE_APP_ID, expandDestination } from "@/features/phone/expand-target";
import { conversationAppPath } from "@/features/messaging/paths";
import type { PhoneAppManifest, PhoneUrlState } from "@/features/phone/types";

function manifest(overrides: Partial<PhoneAppManifest> = {}): PhoneAppManifest {
  return {
    id: INS_PHONE_APP_ID,
    name: "INS",
    subtitle: "图文动态",
    icon: "/assets/legacy/img/icon/joker.webp",
    order: 10,
    kind: "embedded",
    canonical_path: "/apps/ins",
    loader: async () => ({ default: () => null, screens: [] }),
    feature_flag: null,
    state_version: 1,
    ...overrides,
  };
}

function phoneState(overrides: Partial<PhoneUrlState> = {}): PhoneUrlState {
  return { phone: INS_PHONE_APP_ID, screen: null, item: null, ...overrides };
}

describe("手机展开查看的目标", () => {
  it("INS 会话展开到当前角色的 canonical 会话页（保留当前会话上下文）", () => {
    expect(expandDestination(manifest(), phoneState({ screen: "conversation", item: "futaba" }))).toBe(
      "/apps/ins/messages/futaba",
    );
  });

  it("INS 消息列表展开到消息页，而不是 INS 首页", () => {
    expect(expandDestination(manifest(), phoneState({ screen: "messages" }))).toBe(
      "/apps/ins/messages",
    );
  });

  it("会话 item 缺失或不合法时回落到 canonical，不拼任意路径", () => {
    for (const item of ["", "   ", "../admin", "<script>", "futaba/../admin"]) {
      expect(expandDestination(manifest(), phoneState({ screen: "conversation", item }))).toBe(
        "/apps/ins",
      );
    }
    expect(expandDestination(manifest(), phoneState({ screen: "conversation" }))).toBe("/apps/ins");
  });

  it("特殊字符不会拼成任意路径：输出永远是 / 开头的站内 canonical 地址", () => {
    // 手机 URL 的 item 来自地址栏，必须当作不可信输入：只有符合角色 id 字符集的
    // 值才会进入 conversationAppPath（内部 encodeURIComponent），其余一律回 canonical。
    const untrusted = [
      "../admin",
      "..%2Fadmin",
      "futaba/../admin",
      "<script>alert(1)</script>",
      "futaba?x=1",
      "futaba#frag",
      "a b",
      "Ａ",
      "%2e%2e",
    ];
    for (const item of untrusted) {
      const target = expandDestination(manifest(), phoneState({ screen: "conversation", item }));
      expect(target).toBe("/apps/ins");
      expect(target.startsWith("/")).toBe(true);
      expect(target).not.toContain("<");
      expect(target).not.toContain("..");
    }
    // 合法 id 走与 canonical 路由同一个构造函数（内含 encodeURIComponent）。
    expect(conversationAppPath("futaba")).toBe("/apps/ins/messages/futaba");
  });

  it("角色 id 归一化为 canonical 小写形式，避免大小写不同造成两份 URL", () => {
    expect(
      expandDestination(manifest(), phoneState({ screen: "conversation", item: " FUTABA " })),
    ).toBe("/apps/ins/messages/futaba");
  });

  it("INS 其他屏幕沿用 manifest.canonical_path", () => {
    for (const screen of ["feed", "detail", "saved", "tagged"]) {
      expect(expandDestination(manifest(), phoneState({ screen, item: "abc" }))).toBe("/apps/ins");
    }
  });

  it("非 INS 应用与缺失状态一律回到各自的 canonical_path（不越权拼 INS 路径）", () => {
    const journal = manifest({ id: "journal", name: "手记", canonical_path: "/apps/journal" });
    expect(
      expandDestination(journal, phoneState({ phone: "journal", screen: "detail", item: "x" })),
    ).toBe("/apps/journal");
    expect(expandDestination(journal, null)).toBe("/apps/journal");
    // URL 状态属于别的应用时，INS 也不能把 item 拼进自己的 URL。
    expect(
      expandDestination(
        manifest(),
        phoneState({ phone: "journal", screen: "conversation", item: "futaba" }),
      ),
    ).toBe("/apps/ins");
  });
});
