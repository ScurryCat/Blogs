import { describe, expect, it } from "vitest";

import {
  MESSAGES_TAB_ID,
  MESSAGES_TAB_ORDER,
  aiNotice,
  aiBadgeIndices,
  bubbleSide,
  codepointLength,
  formatTimestamp,
  groupAiRuns,
  isCharacterId,
  newClientId,
  normalizeCharacterId,
  normalizeInput,
  previewOf,
  type Message,
} from "./types";
import { conversationAppPath, conversationApiPath, MESSAGES_APP_PATH, phoneConversationTarget } from "./paths";

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: "m1",
    seq: 1,
    origin: "script",
    text: "第一句",
    node_id: "intro",
    choice_id: null,
    cards: [],
    created_at: "2026-10-16T04:00:00Z",
    generation_request_id: null,
    is_ai: false,
    attribution: "",
    ...overrides,
  };
}

describe("码点计数与输入归一", () => {
  it("按 Unicode 码点计数，与后端 len() 一致（不是 UTF-16 码元数）", () => {
    expect(codepointLength("abc")).toBe(3);
    // 星平面字符：JS 的 .length 是 2，码点数是 1
    expect("𠮷".length).toBe(2);
    expect(codepointLength("𠮷")).toBe(1);
    expect(codepointLength("𠮷a")).toBe(2);
    // emoji 由代理对组成，同样只算一个码点
    expect(codepointLength("🎉")).toBe(1);
    expect(codepointLength("")).toBe(0);
  });

  it("归一输入：去首尾空白、内部空白折叠成单个空格（与后端一致）", () => {
    expect(normalizeInput("  你好   世界  ")).toBe("你好 世界");
    expect(normalizeInput("\n\n\t")).toBe("");
    expect(normalizeInput("a\nb")).toBe("a b");
  });

  it("生成的幂等 ID 形状固定且足够短", () => {
    const first = newClientId("msg");
    const second = newClientId("msg");
    expect(first).toMatch(/^msg-[A-Za-z0-9]+$/);
    expect(first).not.toBe(second);
    expect(first.length).toBeLessThanOrEqual(64);
  });
});

describe("角色 id 校验", () => {
  it("只接受小写字母开头的短标识", () => {
    expect(isCharacterId("futaba")).toBe(true);
    expect(isCharacterId("morgana")).toBe(true);
    expect(isCharacterId("Futaba")).toBe(false);
    expect(isCharacterId("futaba/../admin")).toBe(false);
    expect(isCharacterId("")).toBe(false);
    expect(isCharacterId(null)).toBe(false);
  });

  it("归一允许大写与空白，但仍然拒绝非法形状", () => {
    expect(normalizeCharacterId(" Futaba ")).toBe("futaba");
    expect(normalizeCharacterId("../etc/passwd")).toBeNull();
    expect(normalizeCharacterId(null)).toBeNull();
  });
});

describe("气泡归类与 AI 分组", () => {
  it("user 在右、script/ai 在左、system 是居中提示", () => {
    expect(bubbleSide(message({ origin: "user" }))).toBe("out");
    expect(bubbleSide(message({ origin: "script" }))).toBe("in");
    expect(bubbleSide(message({ origin: "ai" }))).toBe("in");
    expect(bubbleSide(message({ origin: "system" }))).toBe("note");
  });

  it("同一次生成的多个 AI 气泡只在第一条上挂标记", () => {
    const messages = [
      message({ id: "m1", origin: "script" }),
      message({ id: "m2", origin: "user" }),
      message({ id: "m3", origin: "ai", generation_request_id: "g1" }),
      message({ id: "m4", origin: "ai", generation_request_id: "g1" }),
      message({ id: "m5", origin: "ai", generation_request_id: "g2" }),
    ];
    expect([...aiBadgeIndices(messages)]).toEqual([2, 4]);
    expect(groupAiRuns(messages)).toEqual([1, 2, 3, 3, 4]);
  });

  it("生成请求 ID 不同的相邻 AI 气泡算两组", () => {
    const messages = [
      message({ id: "m1", origin: "ai", generation_request_id: "g1" }),
      message({ id: "m2", origin: "ai", generation_request_id: "g2" }),
    ];
    expect([...aiBadgeIndices(messages)]).toEqual([0, 1]);
  });
});

describe("时间与摘要", () => {
  it("同一天只给 HH:MM，跨天带上月日", () => {
    const base = new Date("2026-10-16T12:00:00");
    const sameDay = new Date("2026-10-16T09:05:00").toISOString();
    expect(formatTimestamp(sameDay, base)).toMatch(/^0?9:05$|^09:05$/);
    const other = new Date("2026-10-15T22:30:00").toISOString();
    expect(formatTimestamp(other, base)).toContain("10-15");
  });

  it("非法时间返回空串而不是 Invalid Date", () => {
    expect(formatTimestamp("not-a-date")).toBe("");
  });

  it("摘要折叠空白并按码点截断", () => {
    expect(previewOf("  你好   世界  ")).toBe("你好 世界");
    expect(previewOf("一二三四五", 3)).toBe("一二…");
    expect(previewOf("🎉🎉🎉🎉", 2)).toBe("🎉…");
  });
});

describe("AI 降级文案", () => {
  it("正常与回放不打扰用户", () => {
    expect(aiNotice({ status: "ok", message: "", provider: "simulator", retryable: false })).toBeNull();
    expect(
      aiNotice({ status: "replayed", message: "", provider: "simulator", retryable: false }),
    ).toBeNull();
  });

  it("额度用尽说的是服务，不冒充角色情绪", () => {
    const notice = aiNotice({
      status: "visitor_daily_limit",
      message: "自由聊天今天已经用过 20 次，明天再来。预设剧情仍然可以继续。",
      provider: "simulator",
      retryable: false,
    });
    expect(notice?.tone).toBe("warn");
    for (const forbidden of ["不想", "生气", "离线", "下线", "睡着了"]) {
      expect(notice?.text).not.toContain(forbidden);
    }
  });

  it("每个降级状态都有可读文案，不会掉成空白", () => {
    for (const status of [
      "disabled",
      "not_configured",
      "timeout",
      "transport",
      "upstream",
      "invalid_output",
      "internal",
    ]) {
      const notice = aiNotice({ status, message: "", provider: "simulator", retryable: true });
      expect(notice?.text.length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe("URL 构造", () => {
  it("消息页签 id 与排序不与 INS 内置页签冲突", () => {
    expect(MESSAGES_TAB_ID).toBe("messages");
    expect(MESSAGES_TAB_ID).not.toBe("feed");
    expect(MESSAGES_TAB_ID).not.toBe("saved");
    expect(MESSAGES_TAB_ORDER).toBeGreaterThan(20);
  });

  it("canonical 路径里只有角色 id，没有会话 UUID", () => {
    const path = conversationAppPath("futaba");
    expect(path).toBe(`${MESSAGES_APP_PATH}/futaba`);
    expect(path).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  it("角色 id 会被 URL 编码，不接受裸拼接", () => {
    expect(conversationAppPath("a b")).toBe(`${MESSAGES_APP_PATH}/a%20b`);
  });

  it("会话 API 路径按 id 与动作拼接", () => {
    expect(conversationApiPath("abc")).toBe("/messaging/conversations/abc");
  });

  it("手机目标只声明角色与屏幕", () => {
    expect(phoneConversationTarget("morgana")).toEqual({
      phone: "ins",
      screen: "conversation",
      item: "morgana",
    });
  });
});
