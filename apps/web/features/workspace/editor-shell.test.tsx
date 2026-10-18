/**
 * 编辑器外壳 EditorShell（契约 §4.2 / §4.8 / §9.7）。
 *
 * 断言：
 *  - `data-editor` / `data-editor-return` / `data-editor-shell` 钩子存在；
 *  - 返回按钮用 `router.replace(returnTo)`（非法/为空回 `/admin`，编辑器不留在后退栈）；
 *  - `≤620px` 判定为紧凑层时通过 `useOverlay` 锁滚动（OverlayManager 的计数锁）；
 *  - status / actions 插槽渲染到 sticky 头部。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routerMock = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

import { advance, click, render, resetDocument } from "@/tests/helpers/render";

import { OverlayProvider } from "@/features/runtime/overlay-manager";
import { EditorShell } from "./editor-shell";

let rendered: ReturnType<typeof render> | null = null;
let restoreMatchMedia: (() => void) | null = null;

function stubCompactMatchMedia(matches: boolean): void {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: matches && query === "(max-width: 620px)",
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  restoreMatchMedia = () => {
    window.matchMedia = original;
  };
}

function mountShell(returnTo: string | null): HTMLElement {
  rendered = render(
    <OverlayProvider>
      <EditorShell
        title="编辑动态"
        subtitle="工作草稿"
        returnTo={returnTo}
        contentType="moment"
        status={<p data-test-status>已同步</p>}
        actions={<button type="button" data-test-action>发布</button>}
      >
        <p>正文区</p>
      </EditorShell>
    </OverlayProvider>,
  );
  return rendered.container;
}

beforeEach(() => {
  resetDocument();
  routerMock.replace.mockReset();
});

afterEach(() => {
  rendered?.unmount();
  rendered = null;
  restoreMatchMedia?.();
  restoreMatchMedia = null;
  resetDocument();
});

describe("EditorShell", () => {
  it("渲染标题/状态/操作与 data-editor-* 钩子；返回用 replace(returnTo)", async () => {
    stubCompactMatchMedia(false);
    const container = mountShell("/apps/ins");
    await advance(60);

    const shell = container.querySelector("[data-editor-shell]");
    expect(shell?.getAttribute("data-editor")).toBe("moment");
    expect(container.textContent).toContain("编辑动态");
    expect(container.querySelector("[data-test-status]")).not.toBeNull();
    expect(container.querySelector("[data-test-action]")).not.toBeNull();
    expect(container.textContent).toContain("正文区");

    const back = container.querySelector("[data-editor-return]");
    expect(back).not.toBeNull();
    click(back);
    expect(routerMock.replace).toHaveBeenCalledWith("/apps/ins");
  });

  it("returnTo 非法或为空：返回 /admin", async () => {
    stubCompactMatchMedia(false);
    const container = mountShell("//evil.example.com");
    await advance(60);
    click(container.querySelector("[data-editor-return]"));
    expect(routerMock.replace).toHaveBeenCalledWith("/admin");
  });

  it("≤620px：标记 data-editor-compact 并通过 OverlayManager 锁滚动", async () => {
    stubCompactMatchMedia(true);
    const container = mountShell("/apps/journal");
    await advance(80);

    expect(container.querySelector("[data-editor-compact='true']")).not.toBeNull();
    // OverlayManager 的计数锁：紧凑层打开时 <html> 带 ov-lock
    expect(document.documentElement.classList.contains("ov-lock")).toBe(true);
  });

  it("桌面（>620px）：不标记紧凑层、不锁滚动", async () => {
    stubCompactMatchMedia(false);
    const container = mountShell("/apps/journal");
    await advance(80);

    expect(container.querySelector("[data-editor-compact]")).toBeNull();
    expect(document.documentElement.classList.contains("ov-lock")).toBe(false);
  });
});
