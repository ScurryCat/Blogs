/**
 * 编辑器入口 id（`?entry=<uuid>`，契约 §9.4 更新）。
 *
 * 断言：
 *  - URL 已有合法 uuid → 直接采用，不再改 URL；
 *  - URL 缺失/非法 → 生成 uuid 并 router.replace 写回，**保留 returnTo/date 等其他参数**；
 *  - 首次渲染返回 null（SSR/hydration 安全），挂载后才返回 id。
 */

import { act, useEffect, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routerMock = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  // 必须返回**稳定对象**：真实 useRouter 也是稳定的，否则 effect 依赖每次渲染都变。
  useRouter: () => routerMock,
}));

import { renderToString } from "react-dom/server";

import { advance, render, resetDocument } from "@/tests/helpers/render";

import { createEntryId, isEntryId, useEntryId, withEntryId } from "./use-entry-id";

const ENTRY_A = "11111111-1111-4111-8111-111111111111";

interface ExposedRef {
  current: string | null;
}

function Probe({ exposeRef }: { exposeRef: ExposedRef }): ReactNode {
  const entryId = useEntryId();
  useEffect(() => {
    exposeRef.current = entryId;
  });
  return <output data-entry-id={entryId ?? ""} />;
}

let rendered: ReturnType<typeof render> | null = null;

beforeEach(() => {
  resetDocument();
  routerMock.replace.mockReset();
  window.history.replaceState(null, "", "/admin/moments/new");
});

afterEach(() => {
  rendered?.unmount();
  rendered = null;
});

function mount(): { expose: ExposedRef; container: HTMLElement } {
  const exposeRef: ExposedRef = { current: null };
  rendered = render(<Probe exposeRef={exposeRef} />);
  return { expose: exposeRef, container: rendered.container };
}

describe("isEntryId", () => {
  it("只接受 uuid 形状", () => {
    expect(isEntryId(ENTRY_A)).toBe(true);
    expect(isEntryId("not-a-uuid")).toBe(false);
    expect(isEntryId("11111111-1111-4111-8111-11111111111")).toBe(false);
    expect(isEntryId("")).toBe(false);
    expect(isEntryId(null)).toBe(false);
  });
});

describe("withEntryId", () => {
  it("只设置 entry，保留其他查询参数与 hash", () => {
    expect(
      withEntryId("/admin/journal/new?date=2026-10-18&returnTo=%2Fapps%2Fjournal", ENTRY_A),
    ).toBe(`/admin/journal/new?date=2026-10-18&returnTo=%2Fapps%2Fjournal&entry=${ENTRY_A}`);
    expect(withEntryId(`/admin/moments/new?entry=${ENTRY_A}`, "22222222-2222-4222-8222-222222222222")).toBe(
      "/admin/moments/new?entry=22222222-2222-4222-8222-222222222222",
    );
    expect(withEntryId("/admin/journal/new#top", ENTRY_A)).toBe(`/admin/journal/new?entry=${ENTRY_A}#top`);
  });
});

describe("useEntryId", () => {
  it("URL 已有合法 entry：直接采用，不重写 URL", async () => {
    window.history.replaceState(null, "", `/admin/moments/new?entry=${ENTRY_A}&returnTo=%2Fapps%2Fins`);
    const { expose } = mount();
    await advance(60);
    expect(expose.current).toBe(ENTRY_A);
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it("服务端渲染不生成入口 id（首帧 null，hydration 安全）", () => {
    window.history.replaceState(null, "", "/admin/moments/new");
    const html = renderToString(<Probe exposeRef={{ current: null }} />);
    expect(html).toContain('data-entry-id=""');
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it("缺失 entry：生成 uuid 并 router.replace 写回，保留 returnTo/date", async () => {
    window.history.replaceState(
      null,
      "",
      "/admin/journal/new?date=2026-10-18&returnTo=%2Fapps%2Fjournal",
    );
    const { expose } = mount();
    await advance(60);

    expect(isEntryId(expose.current)).toBe(true);
    expect(routerMock.replace).toHaveBeenCalledTimes(1);
    const href = String(routerMock.replace.mock.calls[0]?.[0] ?? "");
    const params = new URLSearchParams(href.slice(href.indexOf("?")));
    expect(params.get("date")).toBe("2026-10-18");
    expect(params.get("returnTo")).toBe("/apps/journal");
    expect(params.get("entry")).toBe(expose.current);
    // replace 不产生历史栈（hook 用的是 replace 而不是 push）
    expect(href.startsWith("/admin/journal/new?")).toBe(true);
  });

  it("非法 entry：生成新的 uuid 并覆盖掉非法值", async () => {
    window.history.replaceState(null, "", "/admin/moments/new?entry=not-a-uuid");
    const { expose } = mount();
    await advance(60);
    expect(isEntryId(expose.current)).toBe(true);
    expect(expose.current).not.toBe("not-a-uuid");
    expect(String(routerMock.replace.mock.calls[0]?.[0])).toContain(`entry=${expose.current}`);
  });
});

describe("createEntryId", () => {
  it("生成互不相同的 uuid", () => {
    const first = createEntryId();
    const second = createEntryId();
    expect(isEntryId(first)).toBe(true);
    expect(isEntryId(second)).toBe(true);
    expect(first).not.toBe(second);
  });

  it("在 act 外生成也不依赖 React", () => {
    const id = createEntryId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    act(() => undefined);
  });
});
