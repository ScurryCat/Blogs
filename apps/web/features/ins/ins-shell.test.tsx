/**
 * INS 壳的页签组合与手机视图（T03 验收用例 5）。
 *
 * 核心断言：
 *  - 未接入的相册 / 消息**没有按钮**（不是禁用按钮、也没有「敬请期待」文案）；
 *  - 注入之后才出现，并且点击能真的渲染对应视图；
 *  - 消息未接入时页面上不出现任何在线状态；
 *  - 手机视图：非法 item 显示「不存在」，不执行任意路径；saved 屏直接落在收藏页签。
 */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigateScreen = vi.fn();
const toast = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/apps/ins",
  useSearchParams: () => new URLSearchParams(""),
}));

import { InsShell } from "./ins-shell";
import { InsPhoneView, INS_APP_SCREENS, momentScreenTarget } from "./phone-view";
import { INS_SAVED_TAB, type InsTabContribution } from "./composition";
import { resetFavoriteStoreForTests } from "./favorites";
import { stubFetch, type FetchStub } from "./test-support";
import type { PhoneHost, PhoneViewProps } from "@/features/phone/types";
import { stubScrollTo } from "@/tests/helpers/browser";
import { advance, click, render, resetDocument } from "@/tests/helpers/render";

let stub: FetchStub | null = null;
let scrollStub: { calls: Array<{ top: number }>; restore: () => void } | null = null;

function host(): PhoneHost {
  return {
    openApp: vi.fn(),
    navigateScreen,
    back: vi.fn(),
    close: vi.fn(),
    openSiteContent: vi.fn(),
    toast,
    audio: {
      isPlaying: () => false,
      play: () => undefined,
      pause: () => undefined,
      setVolume: () => undefined,
      getVolume: () => 0.5,
    },
    state: {
      get: (_appId, _key, fallback) => fallback,
      set: () => ({ persisted: true }),
      clear: () => undefined,
    },
  };
}

function viewProps(overrides: Partial<PhoneViewProps> = {}): PhoneViewProps {
  return { screen: "feed", item: null, mode: "compact", host: host(), ...overrides };
}

const gallery: InsTabContribution = {
  id: "gallery",
  label: "相册",
  ariaLabel: "相册视图",
  order: 30,
  render: () => <p data-testid="gallery-body">相册内容（来自 T06）</p>,
};

const messages: InsTabContribution = {
  id: "messages",
  label: "消息",
  ariaLabel: "角色消息",
  order: 40,
  render: () => <p data-testid="messages-body">消息内容（来自 T08）</p>,
};

beforeEach(() => {
  resetDocument();
  resetFavoriteStoreForTests();
  navigateScreen.mockClear();
  scrollStub = stubScrollTo();
});

afterEach(() => {
  stub?.restore();
  stub = null;
  scrollStub?.restore();
  scrollStub = null;
});

describe("InsShell 页签组合", () => {
  it("没有注入时只有动态与收藏，且没有任何相册 / 消息按钮或占位文案", () => {
    stub = stubFetch([{ match: "/moments", body: { items: [], next_cursor: null } }]);
    const view = render(<InsShell renderFeed={() => <p>动态内容</p>} />);
    const labels = [...view.container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
    expect(labels).toEqual(["动态", "收藏"]);
    expect(view.container.textContent).not.toContain("相册");
    expect(view.container.textContent).not.toContain("消息");
    expect(view.container.textContent).not.toContain("敬请期待");
    // 不假装在线（08 §2：角色不显示虚构的实时在线状态）
    expect(view.container.textContent).not.toMatch(/在线|online/i);
    view.unmount();
  });

  it("注入后才出现页签，点击真的渲染那个视图", () => {
    stub = stubFetch([{ match: "/moments", body: { items: [], next_cursor: null } }]);
    const view = render(
      <InsShell renderFeed={() => <p>动态内容</p>} tabContributions={[gallery, messages]} />,
    );
    const tabs = [...view.container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs.map((tab) => tab.textContent)).toEqual(["动态", "收藏", "相册", "消息"]);

    click(tabs.find((tab) => tab.textContent === "相册") ?? null);
    expect(view.container.querySelector('[data-testid="gallery-body"]')).not.toBeNull();

    click(tabs.find((tab) => tab.textContent === "消息") ?? null);
    expect(view.container.querySelector('[data-testid="messages-body"]')).not.toBeNull();
    view.unmount();
  });

  it("isAvailable() 为 false 的页签不显示（未接入 = 不显示）", () => {
    stub = stubFetch([{ match: "/moments", body: { items: [], next_cursor: null } }]);
    const view = render(
      <InsShell
        renderFeed={() => null}
        tabContributions={[{ ...gallery, isAvailable: () => false }, messages]}
      />,
    );
    const labels = [...view.container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
    expect(labels).toEqual(["动态", "收藏", "消息"]);
    view.unmount();
  });

  it("头像区的 COOP 插槽未注入时不渲染任何友链入口", async () => {
    stub = stubFetch([{ match: "/moments", body: { items: [], next_cursor: null } }]);
    const view = render(<InsShell renderFeed={() => null} />);
    expect(view.container.querySelector(".ins-app-coop")).toBeNull();

    await act(async () => {
      view.root.render(
        <InsShell
          renderFeed={() => null}
          profile={{ coop: <a href="/apps/coop">友链通讯录</a> }}
        />,
      );
    });
    expect(view.container.querySelector(".ins-app-coop")?.textContent).toContain("友链通讯录");
    view.unmount();
  });

  it("详情模式下壳只渲染详情，不再重复渲染页签", () => {
    stub = stubFetch([{ match: "/moments", body: { items: [], next_cursor: null } }]);
    const view = render(
      <InsShell renderFeed={() => null} detail={<p data-testid="detail-body">详情</p>} />,
    );
    expect(view.container.querySelector('[data-testid="detail-body"]')).not.toBeNull();
    expect(view.container.querySelectorAll('[role="tab"]')).toHaveLength(0);
    view.unmount();
  });
});

describe("InsPhoneView", () => {
  it("screens 枚举与规格一致（不含 messages）", () => {
    expect([...INS_APP_SCREENS]).toEqual(["feed", "detail", "saved", "tagged"]);
    expect(INS_APP_SCREENS).not.toContain("messages");
  });

  it("feed 屏渲染信息流，点「查看详情」交给宿主换屏（应用不碰 history）", async () => {
    stub = stubFetch([{ match: "/moments", body: { items: [], next_cursor: null } }]);
    const props = viewProps({ screen: "feed" });
    const view = render(<InsPhoneView {...props} />);
    await advance(20);
    expect(view.container.textContent).toContain("ScurryCat 的图文动态");
    expect(view.container.querySelector(".ins-phone-hint")).not.toBeNull();
    view.unmount();
  });

  it("detail 屏遇到非法 item 显示「不存在」，不做任何导航", () => {
    stub = stubFetch([{ match: "/moments", body: { items: [], next_cursor: null } }]);
    const view = render(<InsPhoneView {...viewProps({ screen: "detail", item: "messages" })} />);
    expect(view.container.textContent).toContain("这条动态不存在");
    expect(navigateScreen).not.toHaveBeenCalled();
    view.unmount();
  });

  it("detail 屏的合法 UUID 会去读那条动态，且不显示「返回列表」（返回归宿主）", async () => {
    stub = stubFetch([
      {
        match: "/moments/",
        body: {
          id: "11111111-1111-4111-8111-111111111111",
          text: "手机里看的动态",
          tags: [],
          published_at: "2026-10-16T04:00:00Z",
          images: [],
        },
      },
    ]);
    const view = render(
      <InsPhoneView {...viewProps({ screen: "detail", item: "11111111-1111-4111-8111-111111111111" })} />,
    );
    await advance(30);
    expect(view.container.textContent).toContain("手机里看的动态");
    expect(view.container.textContent).not.toContain("返回列表");
    view.unmount();
  });

  it("saved 屏直接落在收藏页签，并说明只保存在此浏览器", () => {
    stub = stubFetch([{ match: "/moments", body: { items: [], next_cursor: null } }]);
    const view = render(<InsPhoneView {...viewProps({ screen: "saved" })} />);
    const selected = view.container.querySelector('[role="tab"][aria-selected="true"]');
    expect(selected?.textContent).toBe("收藏");
    expect(view.container.textContent).toContain("此浏览器");
    view.unmount();
  });

  it("momentScreenTarget 只产出宿主认识的屏幕名", () => {
    const target = momentScreenTarget("11111111-1111-4111-8111-111111111111");
    expect(target.screen).toBe("detail");
    expect(INS_APP_SCREENS).toContain(target.screen as (typeof INS_APP_SCREENS)[number]);
    expect(INS_SAVED_TAB).toBe("saved");
  });
});
