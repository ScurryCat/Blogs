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
