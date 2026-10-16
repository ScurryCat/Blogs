/**
 * 手机宿主的集成测试（02 §4 / §6 / §7 / §11）。
 *
 * 覆盖验收里最容易写错的部分：
 *  - 只改注册表就能接入应用（宿主没有按应用分支）；
 *  - 前台只挂载一个应用视图；非法 screen 回退桌面；
 *  - 直接链接「收起手机」用 replace 清参数，**不 `history.back()` 跳出本站**；
 *  - 手机返回与浏览器 Back 同一条历史；
 *  - Escape：应用内先回应用层，桌面再关手机；
 *  - 连续开关手机 20 次：不新增全局监听、音乐元素始终只有一个。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { AudioProvider, MUSIC_ELEMENT_ATTR } from "@/features/runtime/audio/audio-service";
import { NavigationProvider } from "@/features/runtime/navigation/coordinator";
import { OverlayProvider } from "@/features/runtime/overlay-manager";
import { ToastProvider } from "@/features/runtime/toast";
import { PhoneHost } from "@/features/phone/phone-host";
import { PhoneProvider } from "@/features/phone/phone-provider";
import { createPhoneRegistry, type PhoneRegistry } from "@/features/phone/registry";
import type { PhoneAppManifest } from "@/features/phone/types";
import { act } from "react";

import { advance, click, key, render, resetDocument } from "../helpers/render";
import { mockMatchMedia, stubMediaPlayback } from "../helpers/browser";

let search = "";
let pathname = "/";
const pushMock = vi.fn();
const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(search),
}));

const TEST_APP: PhoneAppManifest = {
  id: "demo",
  name: "示例应用",
  subtitle: "只改注册表就能接入",
  icon: "/assets/legacy/img/icon/joker.webp",
  order: 5,
  kind: "embedded",
  canonical_path: "/apps/demo",
  loader: async () => ({
    default: ({ screen, item, mode }: { screen: string; item: string | null; mode: string }) => (
      <p data-demo-view>{`view:${screen}:${item ?? "-"}:${mode}`}</p>
    ),
    screens: ["feed", "detail"],
  }),
  feature_flag: null,
  state_version: 1,
};

const OTHER_APP: PhoneAppManifest = {
  ...TEST_APP,
  id: "other",
  name: "另一个应用",
  order: 6,
  loader: async () => ({
    default: () => <p data-other-view>other</p>,
    screens: ["home"],
  }),
};

const noopDriver = {
  hasCrowd: () => false,
  crowdReady: () => false,
  playCrowd: () => false,
  stopCrowd: () => undefined,
  crowdWait: () => 0,
  hasJoker: () => false,
  jokerReady: () => false,
  playJoker: () => false,
  stopJoker: () => undefined,
  jokerWait: () => 0,
  playWipe: () => undefined,
  stopWipe: () => undefined,
};

let restoreMedia: () => void;
let cleanups: (() => void)[] = [];
let historyBack: ReturnType<typeof vi.spyOn>;

function mount(registry?: PhoneRegistry): ReturnType<typeof render> {
  const tree: ReactNode = (
    <OverlayProvider>
      <AudioProvider>
        <ToastProvider>
          <NavigationProvider
            driver={noopDriver}
            adapter={{
              push: (destination, options) => {
                if (options?.replace) replaceMock(destination);
                else pushMock(destination);
                const [path = "/", query = ""] = destination.split("?");
                pathname = path;
                search = query;
              },
              assign: () => undefined,
              pathname,
            }}
          >
            <PhoneProvider registry={registry}>
              <PhoneHost />
            </PhoneProvider>
          </NavigationProvider>
        </ToastProvider>
      </AudioProvider>
    </OverlayProvider>
  );
  const view = render(tree);
  cleanups.push(view.unmount);
  return view;
}

/**
 * 模拟 Next 的路由提交：地址变了就重渲染一次。
 * `fast` 只刷微任务（20 次循环里用，避免测试超时）；默认还会等一帧让懒加载落地。
 */
async function commit(
  view: ReturnType<typeof render>,
  registry?: PhoneRegistry,
  fast = false,
): Promise<void> {
  if (fast) await act(async () => undefined);
  else await advance();
  await act(async () => {
    view.root.render(
    <OverlayProvider>
      <AudioProvider>
        <ToastProvider>
          <NavigationProvider
            driver={noopDriver}
            adapter={{
              push: (destination, options) => {
                if (options?.replace) replaceMock(destination);
                else pushMock(destination);
                const [path = "/", query = ""] = destination.split("?");
                pathname = path;
                search = query;
              },
              assign: () => undefined,
              pathname,
            }}
          >
            <PhoneProvider registry={registry}>
              <PhoneHost />
            </PhoneProvider>
          </NavigationProvider>
        </ToastProvider>
        </AudioProvider>
      </OverlayProvider>,
    );
  });
  if (fast) await act(async () => undefined);
  else await advance();
}

beforeEach(() => {
  resetDocument();
  cleanups = [];
  search = "";
  pathname = "/";
  pushMock.mockClear();
  replaceMock.mockClear();
  restoreMedia = mockMatchMedia();
  stubMediaPlayback();
  window.history.replaceState({}, "", "/");
  historyBack = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
});

afterEach(() => {
  for (const dispose of cleanups.splice(0).reverse()) dispose();
  historyBack.mockRestore();
  restoreMedia();
});

describe("手机桌面", () => {
  it("默认只显示已迁移的真实入口，未注册的能力不出现", async () => {
    const view = mount();
    await advance();
    click(view.container.querySelector(".pw-tab"));
    await commit(view);

    const tiles = [...view.container.querySelectorAll(".pw-app")].map(
      (tile) => tile.getAttribute("data-app-id"),
    );
    expect(tiles).toEqual([
      "ins", "palace", "journal", "tokyo", "cast", "leisure", "coop", "profile", "metanav", "showcase",
    ]);
    // INS（T03）+ metanav（T04）两个内置应用 + 4 个 site-link 入口（T02 迁移的真实目的地）。
    // 断言具体清单而非数量：后续包登记时会被强制确认一次，而不是静默改变桌面。
    expect(tiles).toHaveLength(10);
    expect(view.container.querySelector(".pw-music")).not.toBeNull();
  });

  it("注册表里新增应用就出现在桌面（宿主不加分支）", async () => {
    const registry = createPhoneRegistry([TEST_APP, OTHER_APP]);
    const view = mount(registry);
    await advance();
    click(view.container.querySelector(".pw-tab"));
    await commit(view, registry);
    const tiles = [...view.container.querySelectorAll(".pw-app")].map((tile) =>
      tile.getAttribute("data-app-id"),
    );
    expect(tiles).toEqual(["demo", "other"]);
  });
});

describe("前台应用", () => {
  const registry = () => createPhoneRegistry([TEST_APP, OTHER_APP]);

  it("打开内置应用：懒加载视图收到 screen / item / compact", async () => {
    search = "phone=demo&screen=detail&item=abc";
    const view = mount(registry());
    await advance();
    await advance();
    expect(view.container.querySelector("[data-demo-view]")?.textContent).toBe("view:detail:abc:compact");
    // 展开查看指向 canonical 路由。
    expect(view.container.querySelector(".pw-expand")?.getAttribute("href")).toBe("/apps/demo");
  });

  it("非法 screen 回退桌面，不执行任意路径", async () => {
    search = "phone=demo&screen=../../etc";
    const view = mount(registry());
    await advance();
    await advance();
    expect(view.container.querySelector("[data-demo-view]")).toBeNull();
    expect(replaceMock).toHaveBeenCalled();
    const target = replaceMock.mock.calls.at(-1)?.[0] as string;
    expect(target).toContain("phone=home");
    expect(target).not.toContain("screen=");
  });

  it("未注册的应用 id 回退桌面", async () => {
    search = "phone=not-registered";
    const view = mount(registry());
    await advance();
    expect(view.container.querySelector(".pw-apps")).not.toBeNull();
  });

  it("同时只挂载一个前台应用", async () => {
    search = "phone=demo&screen=feed";
    const view = mount(registry());
    await advance();
    await advance();
    expect(view.container.querySelectorAll("[data-demo-view]")).toHaveLength(1);
    expect(view.container.querySelectorAll("[data-other-view]")).toHaveLength(0);
    expect(view.container.querySelectorAll(".pw-appbody")).toHaveLength(1);
  });

  it("返回：有本机历史时与浏览器 Back 同一条历史", async () => {
    const view = mount(registry());
    await advance();
    click(view.container.querySelector(".pw-tab")); // 打开手机（depth 1）
    await commit(view, registry());
    click(view.container.querySelector('[data-app-id="demo"]')); // 进入应用（depth 2）
    await commit(view, registry());

    click(view.container.querySelector(".pw-back"));
    expect(historyBack).toHaveBeenCalledTimes(1);
  });

  it("Escape：应用内先回应用层，桌面再关手机（只关一层）", async () => {
    const view = mount(registry());
    await advance();
    click(view.container.querySelector(".pw-tab"));
    await commit(view, registry());
    click(view.container.querySelector('[data-app-id="demo"]'));
    await commit(view, registry());

    key(document, "Escape");
    await commit(view, registry());
    expect(pushMock.mock.calls.at(-1)?.[0]).toContain("phone=home");
    expect(view.container.querySelector(".pw-wrap")?.hasAttribute("hidden")).toBe(false);

    key(document, "Escape");
    await commit(view, registry());
    expect(view.container.querySelector(".pw-wrap")?.hasAttribute("hidden")).toBe(true);
  });

  it("直接链接打开：Escape 能关掉手机（不会被自动弹出的问卷截走）", async () => {
    search = "phone=home";
    const view = mount(registry());
    await advance();
    await advance();
    key(document, "Escape");
    await commit(view, registry());
    expect(view.container.querySelector(".pw-wrap")?.hasAttribute("hidden")).toBe(true);
  });

  it("打开后焦点进入对话框，且 Tab 在对话框内首尾相接", async () => {
    search = "phone=home";
    const view = mount(registry());
    await advance();
    await advance();
    const active = document.activeElement;
    expect(active?.classList.contains("pw-close")).toBe(true);

    // Shift+Tab 在第一个可聚焦元素上应回到最后一个（焦点圈定）。
    const host = view.container.querySelector<HTMLElement>(".pw")!;
    // 与组件用同一条选择器（含 tabindex=0 的滑杆），否则首元素会对不上。
    const focusable = [
      ...host.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ];
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    first.focus();
    let notCancelled = true;
    act(() => {
      const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });
      notCancelled = first.dispatchEvent(event);
    });
    // 先确认事件真的被处理器消费（preventDefault 生效），再看焦点落点。
    expect(notCancelled).toBe(false);
    expect(document.activeElement).toBe(last);
    last.focus();
    key(last, "Tab");
    expect(document.activeElement).toBe(first);
  });

  it("收起手机（直接链接）：用 replace 清参数，不 history.back 离站", async () => {
    search = "phone=demo&screen=feed";
    const view = mount(registry());
    await advance();
    await advance();
    click(view.container.querySelector(".pw-close"));
    expect(historyBack).not.toHaveBeenCalled();
    expect(replaceMock).toHaveBeenCalled();
    const target = replaceMock.mock.calls.at(-1)?.[0] as string;
    expect(target).not.toContain("phone=");
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe("重复开关不累增", () => {
  it("打开 / 关闭手机 20 次：不新增全局监听、音乐元素始终只有一个", async () => {
    const registry = createPhoneRegistry([TEST_APP]);
    const view = mount(registry);
    await advance();

    const addDocument = vi.spyOn(document, "addEventListener");
    const addWindow = vi.spyOn(window, "addEventListener");
    const baselineDocument = addDocument.mock.calls.length;
    const baselineWindow = addWindow.mock.calls.length;

    for (let index = 0; index < 20; index += 1) {
      // 打开（桌面 → 应用 → 关闭），每次都走一遍真实的挂载 / 卸载路径。
      search = "";
      pathname = "/";
      await commit(view, registry, true);
      click(view.container.querySelector(".pw-tab"));
      await commit(view, registry, true);
      click(view.container.querySelector('[data-app-id="demo"]'));
      await commit(view, registry, true);
      click(view.container.querySelector(".pw-close"));
      await commit(view, registry, true);
    }

    expect(addDocument.mock.calls.length).toBe(baselineDocument);
    expect(addWindow.mock.calls.length).toBe(baselineWindow);
    expect(document.querySelectorAll(`audio[${MUSIC_ELEMENT_ATTR}]`)).toHaveLength(1);
    expect(document.querySelectorAll(".pw-wrap")).toHaveLength(1);
    addDocument.mockRestore();
    addWindow.mockRestore();
  });

  it("切换应用不会同时留下两个视图", async () => {
    const registry = createPhoneRegistry([TEST_APP, OTHER_APP]);
    const view = mount(registry);
    await advance();
    for (let index = 0; index < 10; index += 1) {
      search = "phone=demo&screen=feed";
      await commit(view, registry);
      search = "phone=other";
      await commit(view, registry);
    }
    expect(view.container.querySelectorAll("[data-demo-view]")).toHaveLength(0);
    expect(view.container.querySelectorAll("[data-other-view]")).toHaveLength(1);
  });
});
