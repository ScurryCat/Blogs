/**
 * 放课后 · 快捷更新区（P5 · C4；契约 §4.5 / §9.6）。
 *
 * 覆盖设计书 §2.5 的可验证要求：
 *  - 只有点「提交更新」才发 PATCH（不采用输入即改公开记录）；
 *  - 提交中禁用 + in-flight 守卫：连点只产生一次请求；
 *  - 失败保留输入、显示原因、不显示成功；成功文案只用服务端返回的新值；
 *  - 总集数未知不生成百分比（`data-leisure-quick-ratio="none"`、正文无 %）；
 *  - 状态取值来自现有枚举（与后端 ANIME_PROGRESS / GAME_PROGRESS 一致）；
 *  - 「通关」与「全成就」不互相推断：游戏 PATCH 里根本没有这两个字段；
 *  - 传输复用现有 leisure PATCH + If-Match 版本（不改后端契约）。
 */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionStatus } from "@/features/auth/api";
import { render, advance, click, resetDocument } from "@/tests/helpers/render";

import {
  QuickUpdate,
  buildQuickPatch,
  emptyQuickForm,
  formFromEntry,
  quickCompletionRatio,
  validateQuickForm,
} from "./quick-update";
import type { LeisureAdminEntry } from "../types";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const SESSION: SessionStatus = {
  authenticated: true,
  user: { id: "11111111-1111-1111-1111-111111111111", username: "owner" },
  csrf_token: "csrf-token",
  expires_at: null,
  prelogin: false,
};

function animeEntry(overrides: Partial<LeisureAdminEntry> = {}): LeisureAdminEntry {
  return {
    id: "a1",
    kind: "anime",
    title: "正在看的番",
    progress: "watching",
    progress_label: "在看",
    rating: null,
    notes: "还不错",
    notes_have_spoilers: false,
    cover: null,
    anime: {
      season: null,
      episodes_watched: 6,
      total_episodes: null,
      last_watched_on: null,
      airing: true,
      episodes_label: "看到第 6 集",
      completion_ratio: null,
    },
    game: null,
    review: null,
    updated_at: "2026-10-16T00:00:00Z",
    review_post_id: null,
    status: "published",
    published_at: "2026-10-16T00:00:00Z",
    created_at: "2026-10-16T00:00:00Z",
    deleted_at: null,
    version: 2,
    public: true,
    ...overrides,
  };
}

function gameEntry(overrides: Partial<LeisureAdminEntry> = {}): LeisureAdminEntry {
  return {
    id: "g1",
    kind: "game",
    title: "正在玩的游戏",
    progress: "playing",
    progress_label: "在玩",
    rating: 9,
    notes: "",
    notes_have_spoilers: false,
    cover: null,
    anime: null,
    game: {
      platform: "PC",
      started_on: null,
      completed_on: null,
      playtime_minutes: 120,
      playtime_label: "2 小时",
      all_achievements: null,
    },
    review: null,
    updated_at: "2026-10-16T00:00:00Z",
    review_post_id: null,
    status: "published",
    published_at: "2026-10-16T00:00:00Z",
    created_at: "2026-10-16T00:00:00Z",
    deleted_at: null,
    version: 4,
    public: true,
    ...overrides,
  };
}

/** 走原型上的 value setter（React 19 的受控输入追踪，见既有测试的同一注释）。 */
function setInput(container: HTMLElement, selector: string, value: string): void {
  const field = container.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
  if (!field) throw new Error(`没有找到 ${selector}`);
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  act(() => {
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function setSelect(container: HTMLElement, selector: string, value: string): void {
  const field = container.querySelector(selector) as HTMLSelectElement | null;
  if (!field) throw new Error(`没有找到 ${selector}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  act(() => {
    setter?.call(field, value);
    field.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function pickEntry(container: HTMLElement, entryId: string): void {
  const select = container.querySelector("select") as HTMLSelectElement | null;
  if (!select) throw new Error("没有找到记录选择器");
  setSelect(container, "select", entryId);
  expect(select.value).toBe(entryId);
}

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function body(call: Call): Record<string, unknown> {
  return JSON.parse(String(call.init?.body ?? "{}")) as Record<string, unknown>;
}

let calls: Call[];

beforeEach(() => {
  resetDocument();
  calls = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("纯函数（不渲染）", () => {
  it("总集数未知 → 完成率为 null（界面不生成百分比）", () => {
    const entry = animeEntry();
    const form = { ...emptyQuickForm(), episodes: "7" };
    expect(quickCompletionRatio(form, entry)).toBeNull();
    const known = animeEntry({
      anime: { ...entry.anime!, total_episodes: 12, completion_ratio: null },
    });
    expect(quickCompletionRatio(form, known)).toBeCloseTo(7 / 12, 4);
  });

  it("游戏 PATCH 永远不含通关日期 / 全成就（不互相推断）", () => {
    const patch = buildQuickPatch("game", {
      ...emptyQuickForm(),
      entryId: "g1",
      progress: "cleared",
      playtime: "180",
    });
    expect(patch).toEqual({ progress: "cleared", playtime_minutes: 180, notes: "" });
    expect("completed_on" in patch).toBe(false);
    expect("all_achievements" in patch).toBe(false);
  });

  it("追番 airing 默认不提交；明确选择才带上布尔值", () => {
    const base = { ...emptyQuickForm(), entryId: "a1", progress: "watching", episodes: "7" };
    expect("airing" in buildQuickPatch("anime", base)).toBe(false);
    expect(buildQuickPatch("anime", { ...base, airing: "yes" }).airing).toBe(true);
    expect(buildQuickPatch("anime", { ...base, airing: "no" }).airing).toBe(false);
  });

  it("状态必须来自该类型允许的枚举", () => {
    const form = { ...emptyQuickForm(), entryId: "g1", progress: "watching" };
    expect(validateQuickForm("game", form).progress).toContain("允许的取值");
    expect(validateQuickForm("game", { ...form, progress: "cleared" }).progress).toBeUndefined();
  });

  it("选中记录时如实带出既有字段，而不是空表", () => {
    const form = formFromEntry(animeEntry());
    expect(form.entryId).toBe("a1");
    expect(form.episodes).toBe("6");
    expect(form.progress).toBe("watching");
    expect(form.notes).toBe("还不错");
    expect(form.airing).toBe("keep");
  });
});

describe("组件行为", () => {
  it("追番提交成功：PATCH 带 If-Match 与快捷字段，成功文案用服务端返回值", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchLike>(async (url, init) => {
        calls.push({ url: String(url), init });
        return json({
          ...animeEntry(),
          progress: "watching",
          progress_label: "在看",
          version: 3,
          anime: {
            ...animeEntry().anime!,
            episodes_watched: 7,
            episodes_label: "看到第 7 集",
          },
        });
      }),
    );
    const onUpdated = vi.fn();
    const view = render(
      <QuickUpdate session={SESSION} entries={[animeEntry()]} onUpdated={onUpdated} />,
    );
    pickEntry(view.container, "a1");
    setInput(view.container, "[data-leisure-quick-episodes]", "7");
    const submit = view.container.querySelector("[data-leisure-quick-submit]");
    expect(submit?.textContent).toContain("提交更新");
    click(submit);
    await advance(20);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/v1/admin/leisure/entries/a1");
    expect(calls[0]!.init?.method).toBe("PATCH");
    expect((calls[0]!.init?.headers as Record<string, string>)["If-Match"]).toBe('"2"');
    // 契约 §9.2：写请求必须带 X-CSRF-Token 头（不依赖 body 里的 csrf_token）。
    expect((calls[0]!.init?.headers as Record<string, string>)["X-CSRF-Token"]).toBe(
      "csrf-token",
    );
    expect(body(calls[0]!)).toMatchObject({
      progress: "watching",
      episodes_watched: 7,
      notes: "还不错",
    });
    expect(body(calls[0]!).completed_on).toBeUndefined();
    expect(body(calls[0]!).all_achievements).toBeUndefined();
    expect(onUpdated).toHaveBeenCalledTimes(1);

    const success = view.container.querySelector("[data-leisure-quick-success]");
    expect(success?.textContent ?? "").toContain("已更新");
    expect(success?.textContent ?? "").toContain("看到第 7 集");
    expect(success?.textContent ?? "").toContain("版本 3");
    expect(view.container.querySelector("[data-leisure-quick-error]")).toBeNull();
    view.unmount();
  });

  it("总集数未知：预览只显示「看到第 N 集」，不生成百分比", async () => {
    const view = render(<QuickUpdate session={SESSION} entries={[animeEntry()]} />);
    pickEntry(view.container, "a1");
    setInput(view.container, "[data-leisure-quick-episodes]", "7");
    await advance(10);

    const ratio = view.container.querySelector("[data-leisure-quick-ratio]");
    expect(ratio?.getAttribute("data-leisure-quick-ratio")).toBe("none");
    const text = view.container.textContent ?? "";
    expect(text).toContain("看到第 7 集");
    expect(text).toContain("总集数未知，不生成完成率");
    expect(text).not.toContain("%");
    view.unmount();
  });

  it("游戏状态选「通关」不推断通关日期与全成就", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchLike>(async (url, init) => {
        calls.push({ url: String(url), init });
        return json({
          ...gameEntry(),
          progress: "cleared",
          progress_label: "通关",
          version: 5,
          game: { ...gameEntry().game!, playtime_minutes: 180, playtime_label: "3 小时" },
        });
      }),
    );
    const view = render(<QuickUpdate session={SESSION} entries={[gameEntry()]} />);
    // 切到游戏页签
    click(view.container.querySelector('[data-leisure-quick-kind="game"]'));
    await advance(10);
    pickEntry(view.container, "g1");
    setSelect(view.container, "[data-leisure-quick-progress]", "cleared");
    setInput(view.container, "[data-leisure-quick-playtime]", "180");
    click(view.container.querySelector("[data-leisure-quick-submit]"));
    await advance(20);

    const patch = body(calls[0]!);
    expect(patch.progress).toBe("cleared");
    expect(patch.playtime_minutes).toBe(180);
    expect(patch.completed_on).toBeUndefined();
    expect(patch.all_achievements).toBeUndefined();
    const success = view.container.querySelector("[data-leisure-quick-success]");
    expect(success?.textContent ?? "").toContain("通关");
    expect(success?.textContent ?? "").toContain("3 小时");
    view.unmount();
  });

  it("失败保留输入、显示原因、不显示成功（412 版本冲突）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchLike>(async (url, init) => {
        calls.push({ url: String(url), init });
        return json(
          {
            error: { code: "VERSION_CONFLICT", message: "版本冲突", fields: {} },
            request_id: "r",
          },
          412,
        );
      }),
    );
    const onUpdated = vi.fn();
    const view = render(
      <QuickUpdate session={SESSION} entries={[animeEntry()]} onUpdated={onUpdated} />,
    );
    pickEntry(view.container, "a1");
    setInput(view.container, "[data-leisure-quick-episodes]", "8");
    click(view.container.querySelector("[data-leisure-quick-submit]"));
    await advance(20);

    const error = view.container.querySelector("[data-leisure-quick-error]");
    expect(error?.textContent ?? "").toContain("412");
    // 输入原样保留
    const episodes = view.container.querySelector<HTMLInputElement>(
      "[data-leisure-quick-episodes]",
    );
    expect(episodes?.value).toBe("8");
    expect(view.container.querySelector("[data-leisure-quick-success]")).toBeNull();
    expect(onUpdated).not.toHaveBeenCalled();
    // 按钮恢复可点（可以重新读取后重试，不锁死界面）
    const submit = view.container.querySelector<HTMLButtonElement>("[data-leisure-quick-submit]");
    expect(submit?.disabled).toBe(false);
    view.unmount();
  });

  it("提交中禁用按钮，连点只产生一次请求", async () => {
    // 用对象持有「放行函数」：闭包里的赋值不会被 TS 的控制流分析当成 null 收窄。
    const gate: { release: ((response: Response) => void) | null } = { release: null };
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchLike>((url, init) => {
        calls.push({ url: String(url), init });
        return new Promise<Response>((resolve) => {
          gate.release = resolve;
        });
      }),
    );
    const view = render(<QuickUpdate session={SESSION} entries={[animeEntry()]} />);
    pickEntry(view.container, "a1");
    setInput(view.container, "[data-leisure-quick-episodes]", "7");
    const submit = view.container.querySelector<HTMLButtonElement>(
      "[data-leisure-quick-submit]",
    );
    click(submit);
    await advance(10);
    // 提交中：按钮禁用、文案明确
    expect(submit?.disabled).toBe(true);
    expect(submit?.textContent).toContain("提交中");
    // 再点两次（即使禁用按钮被绕过直接派发 click，守卫也应拒绝）
    click(submit);
    click(submit);
    await advance(10);
    expect(calls).toHaveLength(1);

    // 放行请求，界面回到可提交状态
    gate.release?.(json({ ...animeEntry(), version: 3 }));
    await advance(20);
    expect(calls).toHaveLength(1);
    expect(submit?.disabled).toBe(false);
    view.unmount();
  });

  it("未选记录时提交给出明确提示，不发请求", async () => {
    vi.stubGlobal("fetch", vi.fn<FetchLike>(async () => json({ ...animeEntry() })));
    const view = render(<QuickUpdate session={SESSION} entries={[animeEntry()]} />);
    // 先选再清空，确保走「未选择」分支
    pickEntry(view.container, "a1");
    setSelect(view.container, "select", "");
    click(view.container.querySelector("[data-leisure-quick-submit]"));
    await advance(10);
    expect(calls).toHaveLength(0);
    expect(view.container.querySelector("[data-leisure-quick-error]")?.textContent ?? "").toContain(
      "先选择要更新的记录",
    );
    view.unmount();
  });

  it("列表还没读出来时说明原因，不假装能更新", () => {
    const view = render(<QuickUpdate session={SESSION} entries={null} />);
    expect(view.container.textContent ?? "").toContain("暂时不能快捷更新");
    expect(view.container.querySelector("[data-leisure-quick-submit]")).toBeNull();
    view.unmount();
  });
});
