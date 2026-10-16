/**
 * 问卷规则的回归测试 —— 与旧站 `tests/poll-model.test.cjs` 同一批断言的 TypeScript 版。
 *
 * 重点：**迁移不改语义**。`base` 仍是配置里的设定票数（73 : 927 → 7.3%），
 * 本机那一票只在自己浏览器里叠加；界面永远标注「本地展示 · 非全站统计」。
 */

import { describe, expect, it } from "vitest";

import {
  createStore,
  formatPercent,
  normalize,
  type PollInput,
  type PollStorage,
} from "@/features/legacy/poll/model";

function config(patch: Partial<PollInput> = {}): PollInput {
  return {
    id: "phantom-thieves-belief",
    title: "怪盗ch",
    question: "你相信心之怪盗吗？",
    questionHighlight: ["心之怪盗"],
    options: [
      { value: "yes", label: "YES" },
      { value: "no", label: "NO" },
    ],
    main: "yes",
    base: { yes: 73, no: 927 },
    ...patch,
  };
}

function storage(initial: Record<string, string> = {}): PollStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const key = (id: string) => `pl-poll-v2:${encodeURIComponent(id)}`;

describe("问卷配置校验", () => {
  it("文本按纯文本处理，不当作 HTML", () => {
    const input = config({
      id: " custom ",
      question: "<img src=x onerror=alert(1)>",
      comment: { text: "<b>hello</b>", highlight: ["hello"] },
    });
    const result = normalize(input);
    expect(result.id).toBe("custom");
    expect(result.question).toBe(input.question);
    expect(result.comment?.author).toBe("匿名");
    // 结果与输入不共享可变结构。
    result.options[0]!.label = "changed";
    result.base.yes = 2;
    expect(input.options[0]!.label).toBe("YES");
    expect(input.base.yes).toBe(73);
  });

  it("非法配置在创建阶段就报错，不静默产生错误结果", () => {
    expect(() => normalize(config({ id: "  " }))).toThrow(/id/);
    expect(() => normalize(config({ options: [{ value: "a", label: "A" }] }))).toThrow(/two options/);
    expect(() =>
      normalize(
        config({
          options: [
            { value: "a", label: "A" },
            { value: "a", label: "B" },
          ],
        }),
      ),
    ).toThrow(/distinct/);
    expect(() => normalize(config({ main: "maybe" }))).toThrow(/main/);
    expect(() => normalize(config({ base: { yes: -1, no: 1 } }))).toThrow(/base\.yes/);
    expect(() => normalize(config({ base: { yes: Number.NaN, no: 1 } }))).toThrow(/base\.yes/);
  });

  it("百分比永远是两位整数 + 一位小数，边界不产生 NaN", () => {
    expect(formatPercent(0)).toBe("00.0%");
    expect(formatPercent(7.3)).toBe("07.3%");
    expect(formatPercent(100)).toBe("100.0%");
    expect(() => formatPercent(101)).toThrow();
    expect(() => formatPercent(Number.NaN)).toThrow();
  });
});

describe("问卷状态与票数", () => {
  it("默认配置的百分比就是设定值 7.3%，投一票后变成 7.4%（分母也 +1）", () => {
    const store = createStore(storage());
    const before = store.tally(config());
    expect(before.n).toEqual({ yes: 73, no: 927 });
    expect(before.total).toBe(1000);
    expect(formatPercent(before.pct.yes!)).toBe("07.3%");

    store.vote(config(), "yes");
    const after = store.tally(config());
    expect(after.n).toEqual({ yes: 74, no: 927 });
    expect(formatPercent(after.pct.yes!)).toBe("07.4%");
  });

  it("一道题只加一票；重复投票与关闭都不影响票数", () => {
    const store = createStore(storage());
    store.vote(config(), "yes");
    store.vote(config(), "no");
    expect(store.tally(config()).n.yes).toBe(74);
    expect(store.tally(config()).n.no).toBe(927);

    const other = createStore(storage());
    other.markSeen(config());
    expect(other.tally(config()).n.yes).toBe(73);
    expect(other.get(config())).toEqual({ seen: true, vote: null });
  });

  it("不同题互不影响，同一题的多份实例读同一份记录", () => {
    const backing = storage();
    const store = createStore(backing);
    store.vote(config({ id: "q-one" }), "yes");
    expect(store.get(config({ id: "q-two" })).vote).toBeNull();
    expect(store.get(config({ id: "q-one" })).vote).toBe("yes");

    const second = createStore(backing);
    expect(second.get(config({ id: "q-one" })).vote).toBe("yes");
  });

  it("按 id 隔离存储；旧 pl-poll-v1 只迁移到默认题", () => {
    const backing = storage({ "pl-poll-v1": JSON.stringify({ done: true, vote: "no" }) });
    const store = createStore(backing);
    expect(store.get(config()).vote).toBe("no");
    expect(backing.data.has(key("phantom-thieves-belief"))).toBe(true);

    // 后来新增的题不会被旧记录污染。
    const fresh = createStore(storage({ "pl-poll-v1": JSON.stringify({ done: true, vote: "no" }) }));
    expect(fresh.get(config({ id: "later-question" })).vote).toBeNull();
  });

  it("reset 清掉默认题的新旧记录，其他题不受影响", () => {
    const backing = storage({ "pl-poll-v1": JSON.stringify({ done: true, vote: "no" }) });
    const store = createStore(backing);
    store.vote(config({ id: "later-question" }), "yes");
    store.reset(config());
    expect(store.get(config())).toEqual({ seen: false, vote: null });
    expect(backing.data.has("pl-poll-v1")).toBe(false);
    expect(store.get(config({ id: "later-question" })).vote).toBe("yes");
  });

  it("存储在读取 / 写入抛异常时仍然可用（退化为内存）", () => {
    const hostile: PollStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const store = createStore(hostile);
    expect(store.get(config()).seen).toBe(false);
    store.vote(config(), "yes");
    expect(store.get(config()).vote).toBe("yes");
    expect(store.tally(config()).n.yes).toBe(74);
  });

  it("没有 storage（无痕 / 服务端）时也不会崩，交互仍可完成", () => {
    const store = createStore(null);
    expect(store.markSeen(config())).toEqual({ seen: true, vote: null });
    expect(store.vote(config(), "no").vote).toBe("no");
    expect(store.tally(config()).n.no).toBe(928);
  });

  it("订阅只通知同一题，退订后不再收到", () => {
    const store = createStore(storage());
    const seen: (string | null)[] = [];
    const unsubscribe = store.subscribe("phantom-thieves-belief", (state) => seen.push(state.vote));
    store.vote(config(), "yes");
    store.vote(config({ id: "other" }), "yes");
    expect(seen).toEqual(["yes"]);
    unsubscribe();
    store.reset(config());
    expect(seen).toEqual(["yes"]);
  });

  it("票数溢出时百分比仍然是有限值（缩放后再求和）", () => {
    const store = createStore(storage());
    const huge = config({ base: { yes: Number.MAX_VALUE, no: Number.MAX_VALUE } });
    const tally = store.tally(huge);
    expect(Number.isFinite(tally.pct.yes!)).toBe(true);
    expect(formatPercent(tally.pct.yes!)).toBe("50.0%");
  });
});
