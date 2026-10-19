/**
 * 自动保存引擎 `useWorkDraft`（契约 §4.2 / §9.4，设计书 §3.2）。
 *
 * 逐条覆盖要求：
 *  1. 停止输入约 1s 保存；持续输入最长约 5s 必提交一次；
 *  2. 串行队列：同一草稿一次只发一个保存请求；在途时的新输入不丢、旧响应不覆盖新输入；
 *  3. 本机恢复副本：按站主隔离、未登录不读不写、刷新后恢复（内容 + 草稿版本）；
 *  4. 412 冲突：暂停自动保存，`reload-latest` / `save-as-new` 两条路径；
 *  5. 401：停止自动保存、提示登录失效、本机内容保留；
 *  6. 断网：保留本机 + failed 状态；`saveNow()` 重试成功；
 *  7. 新内容懒创建（首次真实输入才建）、`saveNow()` 可主动建、`discard()` 清本机副本。
 */

import { act, useEffect, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { advance, render, resetDocument } from "@/tests/helpers/render";

import {
  clearAllWorkDraftLocalCopies,
  LOCAL_COPY_PREFIX,
  workDraftLocalCopyKey,
  useWorkDraft,
  WorkDraftSaveError,
  type UseWorkDraftOptions,
  type UseWorkDraftResult,
} from "./use-work-draft";
import {
  errorResponse,
  jsonResponse,
  makeWorkDraft,
  stubFetch,
  type FetchStub,
} from "./test-support";

interface ExposedRef {
  current: UseWorkDraftResult | null;
}

function Harness({ options, exposeRef }: { options: UseWorkDraftOptions; exposeRef: ExposedRef }): ReactNode {
  const result = useWorkDraft(options);
  useEffect(() => {
    exposeRef.current = result;
  });
  return (
    <div>
      <p data-hook-state={result.state} />
      <p data-hook-message={result.syncMessage} />
      <p data-hook-recovery={result.recoveryNotice ?? ""} />
      <p data-hook-draft-id={result.draft?.id ?? ""} />
      <p data-hook-draft-version={result.draft ? String(result.draft.draft_version) : ""} />
      <p data-hook-draft-data={JSON.stringify(result.draft?.data ?? null)} />
      <p data-hook-local-copy={JSON.stringify(result.localCopy?.data ?? null)} />
      <p data-hook-synced-at={result.lastSyncedAt ?? ""} />
      <p data-hook-auth-expired={result.authExpired ? "1" : "0"} />
    </div>
  );
}

const TARGET_ID = "target-1";
const DRAFT_ID = "draft-1";

function baseOptions(overrides: Partial<UseWorkDraftOptions> = {}): UseWorkDraftOptions {
  return {
    contentType: "moment",
    targetId: null,
    enabled: true,
    ownerId: "owner-1",
    initialData: { text: "" },
    initialImages: [],
    csrfToken: "csrf-token-1",
    entryId: "11111111-1111-4111-8111-111111111111",
    ...overrides,
  };
}

function targetDraft(overrides: Record<string, unknown> = {}) {
  return makeWorkDraft({
    id: DRAFT_ID,
    content_type: "moment",
    target_id: TARGET_ID,
    target_version: 1,
    draft_version: 1,
    data: { text: "" },
    updated_at: "2026-10-18T10:00:00Z",
    ...overrides,
  });
}

let stub: FetchStub | null = null;
const mounted: Array<ReturnType<typeof render>> = [];

function mount(options: UseWorkDraftOptions): { expose: ExposedRef; container: HTMLElement } {
  const exposeRef: ExposedRef = { current: null };
  const rendered = render(<Harness options={options} exposeRef={exposeRef} />);
  mounted.push(rendered);
  return { expose: exposeRef, container: rendered.container };
}

function attr(container: HTMLElement, name: string): string | null {
  return container.querySelector(`[${name}]`)?.getAttribute(name) ?? null;
}

function stateOf(container: HTMLElement): string | null {
  return attr(container, "data-hook-state");
}

function jsonAttr(container: HTMLElement, name: string): unknown {
  const raw = attr(container, name);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function actCall(fn: () => unknown): Promise<void> {
  await act(async () => {
    await fn();
  });
}

/** 以已登录站主身份复用一份**服务端已有**草稿（target 路径挂载后会 POST 复用）。 */
function reuseRoutes(overrides: {
  draft?: Record<string, unknown>;
  onPatch?: (request: { headers: Record<string, string>; body: unknown }) => Response | Promise<Response>;
} = {}) {
  return [
    {
      match: "/admin/work-drafts",
      method: "POST",
      respond: () =>
        jsonResponse({ draft: targetDraft(overrides.draft), reused: true }, 200),
    },
    {
      match: `/admin/work-drafts/${DRAFT_ID}`,
      method: "PATCH",
      respond: (request: { headers: Record<string, string>; body: unknown }) =>
        overrides.onPatch
          ? overrides.onPatch(request)
          : jsonResponse(
              targetDraft({
                draft_version: 2,
                data: request.body as Record<string, unknown>,
                updated_at: "2026-10-18T10:00:10Z",
              }),
            ),
    },
  ];
}

beforeEach(() => {
  resetDocument();
});

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.unmount();
  stub?.restore();
  stub = null;
});

describe("useWorkDraft · 防抖与最长间隔", () => {
  it("停止输入约 1s 才保存（1s 前不发请求）", async () => {
    stub = stubFetch([
      {
        match: "/admin/work-drafts",
        method: "POST",
        body: { draft: makeWorkDraft({ id: "new-draft", draft_version: 1 }), reused: false },
      },
    ]);
    const { expose, container } = mount(baseOptions());
    await advance(60);

    await actCall(() => expose.current?.update({ data: { text: "第一段" } }));
    await advance(600);
    expect(stub.requests.filter((request) => request.method === "POST")).toHaveLength(0);
    expect(stateOf(container)).toBe("local-only");

    await advance(600);
    const posts = stub.requests.filter((request) => request.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toMatchObject({ content_type: "moment", data: { text: "第一段" } });
    expect(stateOf(container)).toBe("synced");
    expect(attr(container, "data-hook-synced-at")).toBe("2026-10-18T00:00:00Z");
    expect(attr(container, "data-hook-message")).toContain("可在另一设备继续编辑");
  }, 15000);

  it("持续输入时最长约 5s 必须提交一次（防抖被不断重置）", async () => {
    stub = stubFetch([
      {
        match: "/admin/work-drafts",
        method: "POST",
        body: { draft: makeWorkDraft({ id: "new-draft", draft_version: 1 }), reused: false },
      },
    ]);
    const { expose } = mount(baseOptions());
    await advance(60);

    // 每 300ms 输入一次：1s 防抖被不断重置，只能靠 5s 上限触发保存。
    for (let round = 0; round < 16; round += 1) {
      await actCall(() => expose.current?.update({ data: { text: `第 ${round} 段` } }));
      await advance(300);
    }
    // 约 4.8s：上限还没到，不应有保存请求
    expect(stub.requests.filter((request) => request.method === "POST")).toHaveLength(0);
    // 再等 0.6s（累计约 5.4s）：上限必须已经触发
    await advance(600);
    const posts = stub.requests.filter((request) => request.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toMatchObject({ data: { text: "第 15 段" } });
  }, 20000);
});

describe("useWorkDraft · 串行队列与旧响应", () => {
  it("同一草稿一次只有一个保存请求；在途输入不丢；旧响应不覆盖新输入", async () => {
    let inFlight = 0;
    let maxConcurrent = 0;
    const resolvers: Array<(response: Response) => void> = [];
    stub = stubFetch([
      ...reuseRoutes({
        onPatch: () => {
          inFlight += 1;
          maxConcurrent = Math.max(maxConcurrent, inFlight);
          return new Promise<Response>((resolve) => {
            resolvers.push((response) => {
              inFlight -= 1;
              resolve(response);
            });
          });
        },
      }),
    ]);
    const { expose, container } = mount(baseOptions({ targetId: TARGET_ID }));
    await advance(120);
    expect(expose.current?.draft?.id).toBe(DRAFT_ID);

    await actCall(() => expose.current?.update({ data: { text: "a" } }));
    await advance(1100);
    // 第一个 PATCH 在途
    expect(stub.requests.filter((request) => request.method === "PATCH")).toHaveLength(1);
    expect(resolvers).toHaveLength(1);

    // 在途时继续输入：不能并发发第二个请求
    await actCall(() => expose.current?.update({ data: { text: "ab" } }));
    await advance(1100);
    expect(stub.requests.filter((request) => request.method === "PATCH")).toHaveLength(1);

    // 旧响应回来（内容是 "a"）：不得覆盖界面上的最新输入 "ab"
    resolvers[0]?.(jsonResponse(targetDraft({ draft_version: 2, data: { text: "a" } })));
    await advance(80);
    expect(JSON.stringify(jsonAttr(container, "data-hook-draft-data"))).toContain("ab");
    // 队列继续：第二个请求携带最新内容
    const patches = stub.requests.filter((request) => request.method === "PATCH");
    expect(patches).toHaveLength(2);
    expect((patches[1]?.body as { data?: { text?: string } }).data?.text).toBe("ab");

    resolvers[1]?.(jsonResponse(targetDraft({ draft_version: 3, data: { text: "ab" } })));
    await advance(80);
    expect(maxConcurrent).toBe(1);
    expect(stateOf(container)).toBe("synced");
    expect(attr(container, "data-hook-draft-version")).toBe("3");
    expect(jsonAttr(container, "data-hook-local-copy")).toMatchObject({ text: "ab" });
  }, 20000);
});

describe("useWorkDraft · 本机恢复副本", () => {
  it("按站主隔离：不会读取其他站主的本机副本", async () => {
    stub = stubFetch([...reuseRoutes()]);
    const foreignKey = workDraftLocalCopyKey("owner-1", "moment", TARGET_ID, "entry");
    window.localStorage.setItem(
      foreignKey,
      JSON.stringify({
        data: { text: "别的站主的私密草稿" },
        images: [],
        draftId: "draft-other",
        draftVersion: 1,
        savedAt: "2026-10-18T12:00:00Z",
        returnTo: null,
      }),
    );

    const { container } = mount(baseOptions({ targetId: TARGET_ID, ownerId: "owner-2" }));
    await advance(150);
    expect(attr(container, "data-hook-recovery")).toBe("");
    expect(stateOf(container)).toBe("synced");
    // 采用服务器内容，不泄露 owner-1 的本机副本
    expect(JSON.stringify(jsonAttr(container, "data-hook-draft-data"))).not.toContain("别的站主的私密草稿");
  });

  it("未登录不读不写本机副本", async () => {
    stub = stubFetch([]);
    const key = workDraftLocalCopyKey("owner-1", "moment", TARGET_ID, "entry");
    const copy = JSON.stringify({
      data: { text: "未登录不应展示" },
      images: [],
      draftId: DRAFT_ID,
      draftVersion: 1,
      savedAt: "2026-10-18T12:00:00Z",
      returnTo: null,
    });
    window.localStorage.setItem(key, copy);

    const { expose, container } = mount(
      baseOptions({ targetId: TARGET_ID, ownerId: null, enabled: false }),
    );
    await advance(80);
    await actCall(() => expose.current?.update({ data: { text: "匿名输入" } }));
    await advance(80);

    expect(expose.current?.localCopy).toBeNull();
    expect(attr(container, "data-hook-recovery")).toBe("");
    expect(stub.requests).toHaveLength(0);
    // 不覆盖、不新增、不清除别人的本机副本
    expect(window.localStorage.getItem(key)).toBe(copy);
    expect(window.localStorage.length).toBe(1);
  });

  it("刷新后恢复：较新的本机副本被采用（内容 + 图片关系），并继续同步", async () => {
    stub = stubFetch([
      // 服务器草稿更新于 10:00；本机副本保存于 12:00（更新）
      ...reuseRoutes({ draft: { updated_at: "2026-10-18T10:00:00Z" } }),
    ]);
    const key = workDraftLocalCopyKey("owner-1", "moment", TARGET_ID, "entry");
    window.localStorage.setItem(
      key,
      JSON.stringify({
        data: { text: "本机未同步的内容" },
        images: [{ media_id: "media-1", alt: "操场", position: 0 }],
        draftId: DRAFT_ID,
        draftVersion: 1,
        savedAt: "2026-10-18T12:00:00Z",
        returnTo: "/apps/ins",
      }),
    );

    const { expose, container } = mount(baseOptions({ targetId: TARGET_ID }));
    await advance(150);

    expect(attr(container, "data-hook-recovery")).toContain("已恢复本机未同步的修改");
    expect(stateOf(container)).toBe("local-only");
    expect(jsonAttr(container, "data-hook-draft-data")).toMatchObject({ text: "本机未同步的内容" });
    expect(expose.current?.draft?.images[0]?.media_id).toBe("media-1");

    // 用户继续输入后保存：本机恢复的内容不会丢，新输入先落本机再同步
    await actCall(() => expose.current?.update({ data: { text: "本机未同步的内容 + 新输入" } }));
    await advance(1200);
    const patches = stub.requests.filter((request) => request.method === "PATCH");
    expect(patches.length).toBeGreaterThanOrEqual(1);
    expect((patches[0]?.body as { data?: { text?: string } }).data?.text).toBe(
      "本机未同步的内容 + 新输入",
    );
    expect(stateOf(container)).toBe("synced");
  }, 15000);

  it("clearAllWorkDraftLocalCopies 只清本机草稿前缀", async () => {
    window.localStorage.setItem(`${LOCAL_COPY_PREFIX}owner-1.moment.new.1`, "{}");
    window.localStorage.setItem("pl.other.key", "keep");
    clearAllWorkDraftLocalCopies();
    expect(window.localStorage.getItem(`${LOCAL_COPY_PREFIX}owner-1.moment.new.1`)).toBeNull();
    expect(window.localStorage.getItem("pl.other.key")).toBe("keep");
  });
});

describe("useWorkDraft · 冲突 / 401 / 断网", () => {
  it("412：暂停自动保存；reload-latest 载入最新版本后恢复同步", async () => {
    stub = stubFetch([
      ...reuseRoutes({
        onPatch: (request) =>
          request.headers["if-match"] === '"1"'
            ? errorResponse(412, "VERSION_CONFLICT", "草稿版本冲突")
            : jsonResponse(
                targetDraft({
                  draft_version: 8,
                  data: request.body as Record<string, unknown>,
                  updated_at: "2026-10-18T10:10:00Z",
                }),
              ),
      }),
      {
        match: `/admin/work-drafts/${DRAFT_ID}`,
        method: "GET",
        respond: () =>
          jsonResponse(
            targetDraft({
              draft_version: 7,
              data: { text: "服务器最新版本" },
              updated_at: "2026-10-18T10:05:00Z",
            }),
          ),
      },
    ]);
    const { expose, container } = mount(baseOptions({ targetId: TARGET_ID }));
    await advance(120);

    await actCall(() => expose.current?.update({ data: { text: "本机修改" } }));
    await advance(1200);
    expect(stateOf(container)).toBe("conflict");
    const patchesAfterConflict = stub.requests.filter((request) => request.method === "PATCH").length;
    expect(patchesAfterConflict).toBe(1);

    // 暂停自动保存：继续输入也不会发送
    await actCall(() => expose.current?.update({ data: { text: "本机修改 2" } }));
    await advance(1200);
    expect(stub.requests.filter((request) => request.method === "PATCH")).toHaveLength(1);

    await actCall(() => expose.current?.resolveConflict("reload-latest"));
    await advance(80);
    expect(stateOf(container)).toBe("synced");
    expect(jsonAttr(container, "data-hook-draft-data")).toMatchObject({ text: "服务器最新版本" });
    expect(attr(container, "data-hook-draft-version")).toBe("7");

    // 冲突解除后恢复自动保存（用最新版本号做 If-Match）
    await actCall(() => expose.current?.update({ data: { text: "冲突后继续" } }));
    await advance(1200);
    const patches = stub.requests.filter((request) => request.method === "PATCH");
    expect(patches).toHaveLength(2);
    expect(patches[1]?.headers["if-match"]).toBe('"7"');
    expect(stateOf(container)).toBe("synced");
  }, 20000);

  it("412：save-as-new 用本机内容新建草稿（原草稿不覆盖）", async () => {
    stub = stubFetch([
      {
        match: "/admin/work-drafts",
        method: "POST",
        respond: (request: { body: unknown }) => {
          const body = request.body as { target_id?: string; data?: Record<string, unknown> };
          // 挂载时带 target_id → 复用既有草稿；另存为新草稿时不带 target_id。
          if (body.target_id) {
            return jsonResponse({ draft: targetDraft(), reused: true }, 200);
          }
          return jsonResponse(
            {
              draft: makeWorkDraft({
                id: "draft-new",
                content_type: "moment",
                target_id: null,
                draft_version: 1,
                data: body.data ?? {},
                updated_at: "2026-10-18T10:20:00Z",
              }),
              reused: false,
            },
            201,
          );
        },
      },
      {
        match: `/admin/work-drafts/${DRAFT_ID}`,
        method: "PATCH",
        respond: () => errorResponse(412, "VERSION_CONFLICT", "草稿版本冲突"),
      },
    ]);
    const { expose, container } = mount(baseOptions({ targetId: TARGET_ID }));
    await advance(120);
    await actCall(() => expose.current?.update({ data: { text: "本机要保留" } }));
    await advance(1200);
    expect(stateOf(container)).toBe("conflict");

    await actCall(() => expose.current?.resolveConflict("save-as-new"));
    await advance(80);
    expect(stateOf(container)).toBe("synced");
    expect(attr(container, "data-hook-draft-id")).toBe("draft-new");
    const creates = stub.requests.filter((request) => request.method === "POST");
    expect(creates).toHaveLength(2); // 1 次挂载复用 + 1 次另存
    const saveAsNew = creates[1]?.body as Record<string, unknown>;
    expect(saveAsNew).not.toHaveProperty("target_id");
    expect((saveAsNew.data as { text?: string }).text).toBe("本机要保留");
  }, 15000);

  it("401：停止自动保存、提示登录失效、本机内容保留", async () => {
    stub = stubFetch([
      {
        match: "/admin/work-drafts",
        method: "POST",
        respond: () => errorResponse(401, "UNAUTHORIZED", "登录已失效"),
      },
    ]);
    const { expose, container } = mount(baseOptions());
    await advance(80);
    await actCall(() => expose.current?.update({ data: { text: "别丢了我" } }));
    await advance(1200);

    expect(stateOf(container)).toBe("failed");
    expect(attr(container, "data-hook-auth-expired")).toBe("1");
    expect(attr(container, "data-hook-message")).toContain("登录已失效");
    const keys = Object.keys(window.localStorage);
    expect(keys.some((key) => key.startsWith(LOCAL_COPY_PREFIX))).toBe(true);
    const stored = window.localStorage.getItem(keys[0] ?? "") ?? "";
    expect(stored).toContain("别丢了我");

    // 登录失效后不再自动发写请求
    const requestsAfter = stub.requests.length;
    await actCall(() => expose.current?.update({ data: { text: "更多输入" } }));
    await advance(1200);
    expect(stub.requests.length).toBe(requestsAfter);
  }, 15000);

  it("断网：failed 保留本机内容，saveNow 重试成功", async () => {
    let fail = true;
    stub = stubFetch([
      {
        match: "/admin/work-drafts",
        method: "POST",
        respond: () => {
          if (fail) throw new TypeError("Failed to fetch");
          return jsonResponse(
            {
              draft: makeWorkDraft({
                id: "new-draft",
                draft_version: 1,
                data: { text: "网络恢复后内容还在" },
              }),
              reused: false,
            },
            201,
          );
        },
      },
    ]);
    const { expose, container } = mount(baseOptions());
    await advance(80);
    await actCall(() => expose.current?.update({ data: { text: "网络恢复后内容还在" } }));
    await advance(1200);
    expect(stateOf(container)).toBe("failed");
    expect(attr(container, "data-hook-message")).toContain("本机输入已保留");
    // 不自动重发写请求
    expect(stub.requests.filter((request) => request.method === "POST")).toHaveLength(1);

    fail = false;
    await actCall(() => expose.current?.saveNow());
    await advance(120);
    expect(stateOf(container)).toBe("synced");
    expect(attr(container, "data-hook-draft-id")).toBe("new-draft");
  }, 15000);
});

describe("useWorkDraft · 新内容懒创建 / saveNow / discard", () => {
  it("新内容首次真实输入才创建草稿；discard 清本机副本", async () => {
    stub = stubFetch([
      {
        match: "/admin/work-drafts",
        method: "POST",
        body: { draft: makeWorkDraft({ id: "new-draft", draft_version: 1 }), reused: false },
      },
      { match: "/admin/work-drafts/new-draft", method: "DELETE", status: 204 },
    ]);
    const { expose, container } = mount(baseOptions());
    await advance(120);
    expect(stub.requests).toHaveLength(0); // 挂载时不建草稿（避免空的「继续编辑」条目）

    await actCall(() => expose.current?.update({ data: { text: "开始写" } }));
    await advance(1200);
    expect(stub.requests.filter((request) => request.method === "POST")).toHaveLength(1);

    await actCall(() => expose.current?.discard());
    await advance(80);
    expect(stub.requests.some((request) => request.method === "DELETE")).toBe(true);
    expect(stateOf(container)).toBe("idle");
    expect(expose.current?.draft).toBeNull();
    expect(Object.keys(window.localStorage)).toHaveLength(0);
  }, 15000);

  it("saveNow 在新内容也有内容时主动创建草稿", async () => {
    stub = stubFetch([
      {
        match: "/admin/work-drafts",
        method: "POST",
        body: { draft: makeWorkDraft({ id: "new-draft", draft_version: 1 }), reused: false },
      },
    ]);
    const { expose } = mount(baseOptions({ initialData: { text: "已有的初始内容" } }));
    await advance(120);
    expect(stub.requests).toHaveLength(0);

    await actCall(() => expose.current?.saveNow());
    await advance(80);
    expect(stub.requests.filter((request) => request.method === "POST")).toHaveLength(1);
    expect(expose.current?.draft?.id).toBe("new-draft");
  }, 15000);
});

/** 从 localStorage 读出当前唯一的工作草稿本机副本（断言「最新输入仍在」用）。 */
function storedLocalCopyText(): string {
  const keys = Object.keys(window.localStorage);
  const key = keys.find((item) => item.startsWith(LOCAL_COPY_PREFIX));
  return key ? (window.localStorage.getItem(key) ?? "") : "";
}

describe("useWorkDraft · R1 saveNow 失败契约（不得返回旧草稿冒充成功）", () => {
  it("PATCH 500：saveNow 抛 failed、保留最新本机副本与表单；重试成功返回当前内容", async () => {
    let patchFails = true;
    stub = stubFetch(
      reuseRoutes({
        draft: { data: { text: "OLD SERVER TEXT" }, updated_at: "2026-10-18T09:00:00Z" },
        onPatch: (request) =>
          patchFails
            ? errorResponse(500, "INTERNAL", "模拟 PATCH 500")
            : jsonResponse(
                targetDraft({
                  draft_version: 2,
                  data: (request.body as { data?: Record<string, unknown> }).data ?? {},
                  updated_at: "2026-10-18T10:00:10Z",
                }),
              ),
      }),
    );
    const { expose, container } = mount(baseOptions({ targetId: TARGET_ID }));
    await advance(120);
    expect(expose.current?.draft?.data).toMatchObject({ text: "OLD SERVER TEXT" });

    await actCall(() => expose.current?.update({ data: { text: "LATEST UNSAVED TEXT" } }));
    let failure: unknown;
    await actCall(async () => {
      try {
        await expose.current?.saveNow();
      } catch (error) {
        failure = error;
      }
    });

    expect(failure).toBeInstanceOf(WorkDraftSaveError);
    expect((failure as WorkDraftSaveError).code).toBe("failed");
    // 真实错误文案（服务端 message 原样展示，不编造成功）
    expect((failure as WorkDraftSaveError).message).toContain("模拟 PATCH 500");
    expect(stateOf(container)).toBe("failed");
    // 本机副本与界面内容都保留最新输入，且 localStorage 里也是最新文字
    expect(expose.current?.localCopy?.data).toMatchObject({ text: "LATEST UNSAVED TEXT" });
    expect(storedLocalCopyText()).toContain("LATEST UNSAVED TEXT");
    // draft 仍是旧服务端内容（saveNow 没有把它当成成功结果返回，调用方只能拿到异常）
    expect(expose.current?.draft?.data).toMatchObject({ text: "OLD SERVER TEXT" });

    // 解除阻断后重试：返回与当前表单一致的快照（不是旧服务端内容）
    patchFails = false;
    const result: { outcome: Awaited<ReturnType<UseWorkDraftResult["saveNow"]>> } = {
      outcome: null,
    };
    await actCall(async () => {
      result.outcome = (await expose.current?.saveNow()) ?? null;
    });
    expect(result.outcome?.draft.data).toMatchObject({ text: "LATEST UNSAVED TEXT" });
    expect(result.outcome?.contentVersion).toBe(expose.current?.contentVersion());
    expect(stateOf(container)).toBe("synced");
    expect(expose.current?.localCopy?.data).toMatchObject({ text: "LATEST UNSAVED TEXT" });
  }, 20000);

  it("412 / 401 / 断网 / 未启用：分别映射 conflict / auth / unavailable / not-ready，且都不旁路", async () => {
    // 412 冲突
    stub = stubFetch([
      ...reuseRoutes({ onPatch: () => errorResponse(412, "VERSION_CONFLICT", "草稿版本冲突") }),
    ]);
    const conflictMount = mount(baseOptions({ targetId: TARGET_ID }));
    await advance(120);
    await actCall(() => conflictMount.expose.current?.update({ data: { text: "本机修改" } }));
    let conflictFailure: unknown;
    await actCall(async () => {
      try {
        await conflictMount.expose.current?.saveNow();
      } catch (error) {
        conflictFailure = error;
      }
    });
    expect((conflictFailure as WorkDraftSaveError).code).toBe("conflict");
    expect(stateOf(conflictMount.container)).toBe("conflict");
    stub.restore();

    // 401 登录失效
    stub = stubFetch([
      { match: "/admin/work-drafts", method: "POST", respond: () => errorResponse(401, "UNAUTHORIZED", "登录已失效") },
    ]);
    const authMount = mount(baseOptions());
    await advance(80);
    await actCall(() => authMount.expose.current?.update({ data: { text: "别丢了我" } }));
    let authFailure: unknown;
    await actCall(async () => {
      try {
        await authMount.expose.current?.saveNow();
      } catch (error) {
        authFailure = error;
      }
    });
    expect((authFailure as WorkDraftSaveError).code).toBe("auth");
    expect(attr(authMount.container, "data-hook-auth-expired")).toBe("1");
    stub.restore();

    // 断网
    stub = stubFetch([
      ...reuseRoutes({
        onPatch: () => {
          throw new TypeError("Failed to fetch");
        },
      }),
    ]);
    const offlineMount = mount(baseOptions({ targetId: TARGET_ID }));
    await advance(120);
    await actCall(() => offlineMount.expose.current?.update({ data: { text: "断网也要保留" } }));
    let offlineFailure: unknown;
    await actCall(async () => {
      try {
        await offlineMount.expose.current?.saveNow();
      } catch (error) {
        offlineFailure = error;
      }
    });
    expect((offlineFailure as WorkDraftSaveError).code).toBe("unavailable");
    expect(offlineMount.expose.current?.localCopy?.data).toMatchObject({ text: "断网也要保留" });
    stub.restore();

    // 未启用（未登录/会话未就绪）
    stub = stubFetch([]);
    const idleMount = mount(baseOptions({ enabled: false }));
    await advance(60);
    let notReadyFailure: unknown;
    await actCall(async () => {
      try {
        await idleMount.expose.current?.saveNow();
      } catch (error) {
        notReadyFailure = error;
      }
    });
    expect((notReadyFailure as WorkDraftSaveError).code).toBe("not-ready");
    expect(stub.requests).toHaveLength(0);
  }, 20000);

  it("干净的空编辑器：saveNow 返回 null（唯一允许的 null 场景）", async () => {
    stub = stubFetch([]);
    const { expose } = mount(baseOptions());
    await advance(80);
    let outcome: Awaited<ReturnType<UseWorkDraftResult["saveNow"]>> | "unset" = "unset";
    await actCall(async () => {
      outcome = await expose.current?.saveNow() ?? null;
    });
    expect(outcome).toBeNull();
    expect(stub.requests).toHaveLength(0);
  });

  it("contentVersion + discardLocalCopyIfUnchanged：版本一致才清本机副本，提交期间新输入保留", async () => {
    stub = stubFetch([...reuseRoutes()]);

    const first = mount(baseOptions({ targetId: TARGET_ID }));
    await advance(120);
    await actCall(() => first.expose.current?.update({ data: { text: "要提交的内容" } }));
    const firstResult: { outcome: Awaited<ReturnType<UseWorkDraftResult["saveNow"]>> } = {
      outcome: null,
    };
    await actCall(async () => {
      firstResult.outcome = (await first.expose.current!.saveNow()) ?? null;
    });
    expect(first.expose.current?.localCopy).not.toBeNull();
    let firstCleared = false;
    await actCall(() => {
      firstCleared = first.expose.current!.discardLocalCopyIfUnchanged(
        firstResult.outcome!.contentVersion,
      );
    });
    expect(firstCleared).toBe(true);
    expect(first.expose.current?.localCopy).toBeNull();

    const second = mount(
      baseOptions({ targetId: TARGET_ID, entryId: "22222222-2222-4222-8222-222222222222" }),
    );
    await advance(120);
    await actCall(() => second.expose.current?.update({ data: { text: "提交快照" } }));
    const secondResult: { outcome: Awaited<ReturnType<UseWorkDraftResult["saveNow"]>> } = {
      outcome: null,
    };
    await actCall(async () => {
      secondResult.outcome = (await second.expose.current!.saveNow()) ?? null;
    });
    // 提交期间用户又输入：版本前进 → 守卫返回 false，本机副本保留新输入
    await actCall(() => second.expose.current?.update({ data: { text: "提交期间的新输入" } }));
    let secondKept = true;
    await actCall(() => {
      secondKept = second.expose.current!.discardLocalCopyIfUnchanged(
        secondResult.outcome!.contentVersion,
      );
    });
    expect(secondKept).toBe(false);
    expect(second.expose.current?.localCopy?.data).toMatchObject({ text: "提交期间的新输入" });
    expect(storedLocalCopyText()).toContain("提交期间的新输入");
  }, 20000);
});

const RESUMED_ID = "draft-resume-1";

function resumedDraft(overrides: Record<string, unknown> = {}) {
  return makeWorkDraft({
    id: RESUMED_ID,
    content_type: "moment",
    target_id: null,
    draft_version: 2,
    data: {
      text: "服务器草稿文字",
      tags: ["校园"],
      album_links: [{ album_id: "album-1", media_ids: ["media-1", "media-2"] }],
    },
    images: [
      { media_id: "media-1", alt: "第一张", position: 0 },
      { media_id: "media-2", alt: "第二张", position: 1 },
    ],
    updated_at: "2026-10-19T00:00:00Z",
    ...overrides,
  });
}

/** 指定草稿恢复用的 GET 路由（其余请求由调用方配置；未配置会返回 404 并记录）。 */
function resumeGetRoute(draft = resumedDraft()) {
  return {
    match: `/admin/work-drafts/${draft.id}`,
    method: "GET",
    respond: () => jsonResponse(structuredClone(draft)),
  };
}

/** 不该被调用的「自动新建」路由：一旦被调用会留下 POST 记录（断言用）。 */
const NO_CREATE_ROUTE = {
  match: "/admin/work-drafts",
  method: "POST",
  respond: () => errorResponse(500, "INTERNAL", "恢复失败时不得自动新建草稿"),
};

describe("useWorkDraft · R2 指定草稿恢复（新建内容，不依赖本机缓存）", () => {
  it("无本机缓存：GET 1 次恢复 data/images（含顺序/alt/收录），state=synced，不发 POST 新建", async () => {
    stub = stubFetch([resumeGetRoute(), NO_CREATE_ROUTE]);
    const { expose, container } = mount(baseOptions({ draftId: RESUMED_ID }));
    await advance(120);

    expect(stub.requests.filter((request) => request.method === "GET")).toHaveLength(1);
    expect(stub.requests.filter((request) => request.method === "POST")).toHaveLength(0);
    expect(expose.current?.draft?.id).toBe(RESUMED_ID);
    expect(expose.current?.draft?.data).toMatchObject({
      text: "服务器草稿文字",
      tags: ["校园"],
      album_links: [{ album_id: "album-1", media_ids: ["media-1", "media-2"] }],
    });
    expect(
      expose.current?.draft?.images.map((image) => ({ media_id: image.media_id, alt: image.alt })),
    ).toEqual([
      { media_id: "media-1", alt: "第一张" },
      { media_id: "media-2", alt: "第二张" },
    ]);
    expect(stateOf(container)).toBe("synced");
    // 本机副本同时写入 draftId/version（刷新后可继续）
    expect(expose.current?.localCopy?.draftId).toBe(RESUMED_ID);
    expect(expose.current?.localCopy?.draftVersion).toBe(2);
    expect(jsonAttr(container, "data-hook-local-copy")).toMatchObject({ text: "服务器草稿文字" });
  });

  it("同类型两份草稿：点击哪份恢复哪份，互不串稿", async () => {
    stub = stubFetch([
      {
        match: "/admin/work-drafts/draft-a",
        method: "GET",
        respond: () =>
          jsonResponse(
            makeWorkDraft({ id: "draft-a", data: { text: "草稿 A" }, updated_at: "2026-10-19T00:00:00Z" }),
          ),
      },
      {
        match: "/admin/work-drafts/draft-b",
        method: "GET",
        respond: () =>
          jsonResponse(
            makeWorkDraft({ id: "draft-b", data: { text: "草稿 B" }, updated_at: "2026-10-19T00:00:00Z" }),
          ),
      },
      NO_CREATE_ROUTE,
    ]);
    const first = mount(baseOptions({ draftId: "draft-a" }));
    await advance(120);
    expect(first.expose.current?.draft?.id).toBe("draft-a");
    expect(first.expose.current?.draft?.data).toMatchObject({ text: "草稿 A" });

    const second = mount(
      baseOptions({ draftId: "draft-b", entryId: "33333333-3333-4333-8333-333333333333" }),
    );
    await advance(120);
    expect(second.expose.current?.draft?.id).toBe("draft-b");
    expect(second.expose.current?.draft?.data).toMatchObject({ text: "草稿 B" });
    expect(stub.requests.filter((request) => request.method === "POST")).toHaveLength(0);
  });

  it("刷新同一 URL（本机副本较新）：保留本机输入并标 local-only，不覆盖为服务器旧内容", async () => {
    const entryId = "11111111-1111-4111-8111-111111111111";
    const key = workDraftLocalCopyKey("owner-1", "moment", null, entryId);
    window.localStorage.setItem(
      key,
      JSON.stringify({
        data: { text: "本机更新内容" },
        images: [{ media_id: "media-local", alt: "本机图", position: 0 }],
        draftId: RESUMED_ID,
        draftVersion: 1,
        savedAt: "2026-10-20T00:00:00Z",
        returnTo: null,
      }),
    );
    stub = stubFetch([resumeGetRoute(), NO_CREATE_ROUTE]);
    const { expose, container } = mount(baseOptions({ draftId: RESUMED_ID, entryId }));
    await advance(120);

    expect(stateOf(container)).toBe("local-only");
    expect(attr(container, "data-hook-recovery")).toContain("已恢复本机未同步的修改");
    expect(expose.current?.draft?.id).toBe(RESUMED_ID);
    expect(expose.current?.draft?.data).toMatchObject({ text: "本机更新内容" });
    expect(expose.current?.localCopy?.data).toMatchObject({ text: "本机更新内容" });
  });

  it("恢复在途时用户输入：旧响应不覆盖新输入（保留本机内容并等待同步）", async () => {
    const resolvers: Array<(response: Response) => void> = [];
    stub = stubFetch([
      {
        match: `/admin/work-drafts/${RESUMED_ID}`,
        method: "GET",
        respond: () =>
          new Promise<Response>((resolve) => {
            resolvers.push(resolve);
          }),
      },
    ]);
    const { expose, container } = mount(baseOptions({ draftId: RESUMED_ID }));
    await advance(60);
    expect(resolvers).toHaveLength(1);

    await actCall(() => expose.current?.update({ data: { text: "恢复期间的用户输入" } }));
    resolvers[0]?.(jsonResponse(resumedDraft()));
    await advance(80);

    expect(expose.current?.draft?.data).toMatchObject({ text: "恢复期间的用户输入" });
    expect(stateOf(container)).not.toBe("synced");
    expect(expose.current?.localCopy?.data).toMatchObject({ text: "恢复期间的用户输入" });
  });

  it("404 / 403：state failed + resumeError，不自动新建、后续输入不再发写请求；saveNow 抛 unavailable", async () => {
    stub = stubFetch([
      {
        match: "/admin/work-drafts/missing-draft",
        method: "GET",
        respond: () => errorResponse(404, "NOT_FOUND", "工作草稿不存在"),
      },
      {
        match: "/admin/work-drafts/forbidden-draft",
        method: "GET",
        respond: () => errorResponse(403, "FORBIDDEN", "无权访问"),
      },
      NO_CREATE_ROUTE,
    ]);
    const notFound = mount(baseOptions({ draftId: "missing-draft" }));
    await advance(120);
    expect(stateOf(notFound.container)).toBe("failed");
    expect(notFound.expose.current?.resumeError).toContain("不存在");
    expect(notFound.expose.current?.draft).toBeNull();
    expect(stub.requests.filter((request) => request.method === "POST")).toHaveLength(0);

    const before = stub.requests.length;
    await actCall(() => notFound.expose.current?.update({ data: { text: "本机输入" } }));
    await advance(1200);
    expect(stub.requests.length).toBe(before); // 已暂停：不再有写请求（也不会自动新建）
    let failure: unknown;
    await actCall(async () => {
      try {
        await notFound.expose.current?.saveNow();
      } catch (error) {
        failure = error;
      }
    });
    expect((failure as WorkDraftSaveError).code).toBe("unavailable");

    const forbidden = mount(
      baseOptions({ draftId: "forbidden-draft", entryId: "44444444-4444-4444-8444-444444444444" }),
    );
    await advance(120);
    expect(stateOf(forbidden.container)).toBe("failed");
    expect(forbidden.expose.current?.resumeError).toContain("权限");
  }, 20000);

  it("已丢弃 / 已提交的草稿：state failed + 准确 resumeError（不当作可编辑草稿加载）", async () => {
    stub = stubFetch([
      {
        match: "/admin/work-drafts/discarded-draft",
        method: "GET",
        respond: () =>
          jsonResponse(resumedDraft({ id: "discarded-draft", status: "discarded" })),
      },
      {
        match: "/admin/work-drafts/committed-draft",
        method: "GET",
        respond: () =>
          jsonResponse(resumedDraft({ id: "committed-draft", status: "committed" })),
      },
      NO_CREATE_ROUTE,
    ]);
    // 后端详情接口对任何状态都返回 200（契约如此）；恢复方必须自己拒绝非 active 状态。
    const discarded = mount(baseOptions({ draftId: "discarded-draft" }));
    await advance(120);
    expect(stateOf(discarded.container)).toBe("failed");
    expect(discarded.expose.current?.draft).toBeNull();
    expect(discarded.expose.current?.resumeError).toContain("丢弃");
    expect(stub.requests.filter((request) => request.method === "POST")).toHaveLength(0);

    const committed = mount(
      baseOptions({
        draftId: "committed-draft",
        entryId: "77777777-7777-4777-8777-777777777777",
      }),
    );
    await advance(120);
    expect(stateOf(committed.container)).toBe("failed");
    expect(committed.expose.current?.draft).toBeNull();
    expect(committed.expose.current?.resumeError).toContain("已经提交");

    // 暂停状态：用户继续输入也不会自动新建/写请求，saveNow 抛 unavailable。
    const before = stub.requests.length;
    await actCall(() => discarded.expose.current?.update({ data: { text: "本机输入" } }));
    await advance(1200);
    expect(stub.requests.length).toBe(before);
    let failure: unknown;
    await actCall(async () => {
      try {
        await discarded.expose.current?.saveNow();
      } catch (error) {
        failure = error;
      }
    });
    expect(failure).toBeInstanceOf(WorkDraftSaveError);
    expect((failure as WorkDraftSaveError).code).toBe("unavailable");
  }, 20000);

  it("类型不匹配 / target 不匹配：state failed + 准确 resumeError（不加载草稿）", async () => {
    stub = stubFetch([
      {
        match: "/admin/work-drafts/wrong-type",
        method: "GET",
        respond: () => jsonResponse(resumedDraft({ id: "wrong-type", content_type: "journal" })),
      },
      {
        match: "/admin/work-drafts/has-target",
        method: "GET",
        respond: () => jsonResponse(resumedDraft({ id: "has-target", target_id: "existing-moment" })),
      },
      {
        match: "/admin/work-drafts/wrong-target",
        method: "GET",
        respond: () => jsonResponse(resumedDraft({ id: "wrong-target", target_id: "other-target" })),
      },
      NO_CREATE_ROUTE,
    ]);

    const wrongType = mount(baseOptions({ draftId: "wrong-type" }));
    await advance(120);
    expect(stateOf(wrongType.container)).toBe("failed");
    expect(wrongType.expose.current?.resumeError).toContain("类型不匹配");
    expect(wrongType.expose.current?.draft).toBeNull();

    // 新建页拿到「属于已有内容」的草稿：不允许当作新建继续
    const newPage = mount(
      baseOptions({ draftId: "has-target", entryId: "55555555-5555-4555-8555-555555555555" }),
    );
    await advance(120);
    expect(newPage.expose.current?.resumeError).toContain("新建页");

    // 编辑页拿到别的 target 的草稿：停止恢复
    const editPage = mount(
      baseOptions({
        targetId: TARGET_ID,
        draftId: "wrong-target",
        entryId: "66666666-6666-4666-8666-666666666666",
      }),
    );
    await advance(120);
    expect(stateOf(editPage.container)).toBe("failed");
    expect(editPage.expose.current?.resumeError).toContain("target 不匹配");
    expect(stub.requests.filter((request) => request.method === "POST")).toHaveLength(0);
  });

  it("编辑已有内容 + 指定草稿（target_id 匹配）：直接 GET 恢复，不重复 POST", async () => {
    stub = stubFetch([
      resumeGetRoute(resumedDraft({ target_id: TARGET_ID, data: { text: "编辑页指定草稿" } })),
      NO_CREATE_ROUTE,
    ]);
    const { expose, container } = mount(
      baseOptions({ targetId: TARGET_ID, draftId: RESUMED_ID }),
    );
    await advance(120);
    expect(stateOf(container)).toBe("synced");
    expect(expose.current?.draft?.target_id).toBe(TARGET_ID);
    expect(expose.current?.draft?.data).toMatchObject({ text: "编辑页指定草稿" });
    expect(stub.requests.filter((request) => request.method === "POST")).toHaveLength(0);
  });

  it("「另存为新草稿」生成的草稿也能用 draftId 在另一上下文恢复", async () => {
    stub = stubFetch([
      {
        match: "/admin/work-drafts/draft-saved-new",
        method: "GET",
        respond: () =>
          jsonResponse(
            makeWorkDraft({
              id: "draft-saved-new",
              content_type: "moment",
              target_id: null,
              data: { text: "要另存的新草稿" },
              updated_at: "2026-10-19T01:00:00Z",
            }),
          ),
      },
      {
        match: "/admin/work-drafts",
        method: "POST",
        respond: (request) => {
          const body = request.body as { target_id?: string; data?: Record<string, unknown> };
          if (body.target_id) {
            return jsonResponse(
              { draft: targetDraft({ data: { text: "OLD SERVER TEXT" } }), reused: true },
              200,
            );
          }
          return jsonResponse(
            {
              draft: makeWorkDraft({
                id: "draft-saved-new",
                content_type: "moment",
                target_id: null,
                draft_version: 1,
                data: body.data ?? {},
                updated_at: "2026-10-19T01:00:00Z",
              }),
              reused: false,
            },
            201,
          );
        },
      },
      {
        match: `/admin/work-drafts/${DRAFT_ID}`,
        method: "PATCH",
        respond: () => errorResponse(412, "VERSION_CONFLICT", "草稿版本冲突"),
      },
    ]);

    const target = mount(baseOptions({ targetId: TARGET_ID }));
    await advance(120);
    await actCall(() => target.expose.current?.update({ data: { text: "要另存的新草稿" } }));
    await advance(1200);
    expect(stateOf(target.container)).toBe("conflict");
    await actCall(() => target.expose.current?.resolveConflict("save-as-new"));
    await advance(80);
    expect(target.expose.current?.draft?.id).toBe("draft-saved-new");

    const another = mount(
      baseOptions({ draftId: "draft-saved-new", entryId: "77777777-7777-4777-8777-777777777777" }),
    );
    await advance(120);
    expect(another.expose.current?.draft?.id).toBe("draft-saved-new");
    expect(another.expose.current?.draft?.data).toMatchObject({ text: "要另存的新草稿" });
    expect(stateOf(another.container)).toBe("synced");
  }, 20000);
});
