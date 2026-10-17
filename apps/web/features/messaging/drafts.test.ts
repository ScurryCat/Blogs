/**
 * IM 草稿的存取（任务书 §3.3「返回时保留…输入草稿」）。
 *
 * 行为要求：
 *  - 按角色分键，不串；
 *  - 空串等于删除记录（发送成功 / 切回话题要清掉）；
 *  - 存储不可用时安静降级，不能让聊天发不出去。
 */

import { beforeEach, describe, expect, it } from "vitest";

import { draftKey, readDraft, writeDraft } from "./drafts";

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("draftKey / readDraft / writeDraft", () => {
  it("写入后能读回，且不同角色互不影响", () => {
    writeDraft("futaba", "晚上好");
    writeDraft("morgana", "喵");

    expect(readDraft("futaba")).toBe("晚上好");
    expect(readDraft("morgana")).toBe("喵");
    expect(readDraft("akechi")).toBe("");
    // 键里带角色 id，便于排查
    expect(draftKey("futaba")).toContain("futaba");
  });

  it("写空串等于删除记录", () => {
    writeDraft("futaba", "写了一半");
    expect(window.sessionStorage.getItem(draftKey("futaba"))).toBe("写了一半");

    writeDraft("futaba", "");
    expect(window.sessionStorage.getItem(draftKey("futaba"))).toBeNull();
    expect(readDraft("futaba")).toBe("");
  });

  it("角色为空时不读也不写（不会把草稿存到空键下）", () => {
    expect(readDraft(null)).toBe("");
    writeDraft(null, "不该被保存");
    expect(window.sessionStorage.length).toBe(0);
  });

  it("存储抛异常时安静降级（读写都不抛）", () => {
    const getItem = Object.getOwnPropertyDescriptor(Storage.prototype, "getItem")!;
    const setItem = Object.getOwnPropertyDescriptor(Storage.prototype, "setItem")!;
    Object.defineProperty(Storage.prototype, "getItem", {
      configurable: true,
      value: () => {
        throw new Error("隐私模式");
      },
    });
    Object.defineProperty(Storage.prototype, "setItem", {
      configurable: true,
      value: () => {
        throw new Error("配额已满");
      },
    });
    try {
      expect(() => writeDraft("futaba", "x")).not.toThrow();
      expect(readDraft("futaba")).toBe("");
    } finally {
      Object.defineProperty(Storage.prototype, "getItem", getItem);
      Object.defineProperty(Storage.prototype, "setItem", setItem);
    }
  });
});
