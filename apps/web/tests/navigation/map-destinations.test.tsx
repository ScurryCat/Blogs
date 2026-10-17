/**
 * 地图目的地单一配置与三入口一致性（任务书 §2.3 / §8.1）。
 *
 * 重点：
 *  - 13 个开放地点的映射与任务书表格一一对应，其余 12 个保持未开放、无假链接；
 *  - 地图图标 / 右侧「出发」/ 下方列表**读同一份** `features/navigation/map-destinations.ts`，
 *    不复制三份 switch；每个地点三个消费点都断言 href / 说明 / intent；
 *  - 目的地不再绑定具体文章 slug，也没有旧 HTML 入口；
 *  - 上野（作品）三入口都显式带 `enter-showcase`，其它地点不带；
 *  - 地图图形与位置（25 个地点的坐标数据）不因目的地重构而改变。
 */

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MapView } from "@/features/legacy/pages/map-view";
import mapJson from "@/features/legacy/data/map.json";
import { mapLocations, openLocations } from "@/features/legacy/map";
import {
  MAP_DESTINATIONS,
  OPEN_MAP_LOCATION_IDS,
  findMapDestination,
} from "@/features/navigation/map-destinations";
import { mockMatchMedia } from "../helpers/browser";
import { click, render, resetDocument } from "../helpers/render";

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));

// 地图只关心「点了之后交给导航协调器什么」，不关心真实过场实现（N0/N5 冻结）。
vi.mock("@/features/runtime/navigation/coordinator", () => ({
  useNavigation: () => ({
    navigate: navigateMock,
    updateUrl: () => undefined,
    commitPhoneTarget: () => undefined,
    navigating: () => false,
    debug: () => ({
      navigating: false,
      source: null,
      intent: null,
      kind: "none",
      token: 0,
      pendingPath: null,
      cancels: 0,
    }),
  }),
}));

afterEach(() => {
  resetDocument();
  navigateMock.mockClear();
});

/** 任务书 §2.3 的 13 个开放地点与目的地（顺序无关，按地点 id 对照）。 */
const EXPECTED: Record<number, string> = {
  18: "/apps/leblanc", // 四轩茶屋 · 生活总览
  12: "/apps/ins", // 涩谷 · INS
  0: "/apps/journal", // 青山一丁目 · 手记
  15: "/posts", // 神保町 · 文章
  6: "/showcase", // 上野 · 作品
  23: "/gallery", // 三浦海岸 · 图库（默认照片墙）
  7: "/apps/leisure?screen=game", // 秋叶原 · 放课后游戏
  3: "/apps/leisure?screen=anime", // 池袋 · 放课后追番
  19: "/apps/coop", // 六本木 · COOP 友链
  8: "/posts?view=archive", // 浅草 · 文章归档
  9: "/weather", // 井之头公园 · 天气
  10: "/guestbook", // 明治神宫 · 留言
  13: "/about", // 永田町 · 关于
};

describe("地图目的地单一配置", () => {
  it("13 个开放地点与任务书 §2.3 表格完全一致", () => {
    expect(MAP_DESTINATIONS).toHaveLength(13);
    expect(Object.fromEntries(MAP_DESTINATIONS.map((item) => [item.locationId, item.href]))).toEqual(
      EXPECTED,
    );
    expect([...OPEN_MAP_LOCATION_IDS].sort((a, b) => a - b)).toEqual(
      Object.keys(EXPECTED)
        .map(Number)
        .sort((a, b) => a - b),
    );
  });

  it("每个开放地点都有英文短名、标题与用途说明", () => {
    for (const destination of MAP_DESTINATIONS) {
      expect(destination.en).toMatch(/^[A-Z]{3,11}$/);
      expect(destination.title.length).toBeGreaterThan(1);
      expect(destination.note.length).toBeGreaterThan(8);
    }
  });

  it("只有上野（作品）带 enter-showcase，且 href 仍是 /showcase", () => {
    const withIntent = MAP_DESTINATIONS.filter((item) => item.intent !== undefined);
    expect(withIntent).toHaveLength(1);
    expect(withIntent[0]?.locationId).toBe(6);
    expect(withIntent[0]?.href).toBe("/showcase");
    expect(withIntent[0]?.intent).toBe("enter-showcase");
  });

  it("图库目的地使用 N4 的 URL 契约：/gallery 是默认照片墙", () => {
    // N4 契约：/gallery 默认照片墙，/gallery?view=albums 才是相册视图；
    // 地图的地点用途是「图库」，落到默认照片墙，不猜子视图。
    expect(EXPECTED[23]).toBe("/gallery");
    expect(findMapDestination(23)?.href).toBe("/gallery");
  });

  it("移除绑定具体文章 slug 的目的地", () => {
    for (const destination of MAP_DESTINATIONS) {
      expect(destination.href).not.toMatch(/^\/posts\/[^?]+/);
      expect(destination.href).not.toContain(".html");
      expect(destination.href.startsWith("/")).toBe(true);
    }
  });

  it("其余 12 个地点保持未开放：不开放到配置、也不开放到地图", () => {
    const openIds = new Set(OPEN_MAP_LOCATION_IDS);
    const closed = mapLocations.filter((location) => !openIds.has(location.id));
    expect(closed).toHaveLength(25 - 13);
    for (const location of closed) {
      expect(location.to).toBeNull();
      expect(findMapDestination(location.id)).toBeNull();
    }
    // openLocations 与单一配置逐一对应（没有第二份开放名单）。
    expect(openLocations.map((location) => location.id).sort()).toEqual(
      [...OPEN_MAP_LOCATION_IDS].sort(),
    );
  });

  it("地图解析结果逐字段来自配置（单一来源，不是复制数据）", () => {
    for (const destination of MAP_DESTINATIONS) {
      const location = mapLocations.find((item) => item.id === destination.locationId);
      expect(location?.to).toEqual({
        href: destination.href,
        en: destination.en,
        title: destination.title,
        note: destination.note,
        ...(destination.intent ? { intent: destination.intent } : {}),
      });
    }
  });

  it("地图图形与位置保持原样（25 个地点的坐标数据未变）", () => {
    expect(mapLocations).toHaveLength(25);
    expect(mapJson).toHaveLength(25);
    for (const [index, tuple] of (mapJson as number[][]).entries()) {
      const location = mapLocations[index];
      expect(location?.id).toBe(tuple[0]);
      expect(location?.kanji).toBe(tuple[1]);
      expect(location?.roma).toBe(tuple[2]);
      // 标签 / 城市图 / 文字锚点等几何字段原样保留。
      expect([
        location?.lx,
        location?.ly,
        location?.lw,
        location?.lh,
        location?.cx,
        location?.cy,
        location?.cw,
        location?.ch,
        location?.kx,
        location?.ky,
        location?.ex,
        location?.ey,
        location?.rot,
      ]).toEqual(tuple.slice(3));
    }
  });
});

describe("地图三入口（图标 / 出发 / 列表）一致性", () => {
  /** 鼠标移入（React 的 onMouseEnter 由 mouseover 委托触发）。 */
  function hover(element: Element | null): void {
    if (!element) throw new Error("hover: element is missing");
    act(() => {
      element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true }));
    });
  }

  function setup() {
    // 减少动态效果：跳过光标 rAF 动画（与过场无关，只让测试环境稳定）。
    const restore = mockMatchMedia({ "(prefers-reduced-motion: reduce)": true });
    const rendered = render(<MapView />);
    return { ...rendered, restore };
  }

  it("25 个地点全部渲染，13 个可点、12 个未开放且没有假链接", () => {
    const { container, unmount, restore } = setup();
    expect(container.querySelectorAll(".mp-svg .loc")).toHaveLength(25);
    expect(container.querySelectorAll(".mp-svg a.loc")).toHaveLength(13);
    expect(container.querySelectorAll(".mp-svg .loc.off")).toHaveLength(12);
    expect(container.querySelectorAll(".mp-list a")).toHaveLength(13);
    unmount();
    restore();
  });

  it("每个地点：图标 href = 列表 href = 配置 href", () => {
    const { container, unmount, restore } = setup();
    for (const destination of MAP_DESTINATIONS) {
      const icon = container.querySelector<SVGAElement>(
        `.mp-svg a.loc[data-id="${destination.locationId}"]`,
      );
      const listLink = container.querySelector<HTMLAnchorElement>(
        `.mp-list a[data-id="${destination.locationId}"]`,
      );
      expect(icon, `地点 ${destination.locationId} 缺少图标入口`).toBeTruthy();
      expect(listLink, `地点 ${destination.locationId} 缺少列表入口`).toBeTruthy();
      expect(icon?.getAttribute("href")).toBe(destination.href);
      expect(listLink?.getAttribute("href")).toBe(destination.href);
      expect(icon?.getAttribute("aria-label")).toContain(destination.title);
      expect(listLink?.textContent).toContain(destination.title);
    }
    unmount();
    restore();
  });

  it("选中每个地点后，右侧档案卡与「出发」读同一份配置", () => {
    const { container, unmount, restore } = setup();
    for (const destination of MAP_DESTINATIONS) {
      hover(
        container.querySelector(`.mp-svg a.loc[data-id="${destination.locationId}"]`),
      );
      const card = container.querySelector(".mp-card");
      const start = card?.querySelector<HTMLAnchorElement>("a.btn.red");
      expect(start, `地点 ${destination.locationId} 缺少出发按钮`).toBeTruthy();
      expect(start?.getAttribute("href")).toBe(destination.href);
      expect(card?.textContent).toContain(destination.en);
      expect(card?.textContent).toContain(destination.title);
      expect(card?.textContent).toContain(destination.note);
    }
    unmount();
    restore();
  });

  it("图标 / 出发 / 列表三入口点击都交给导航协调器，且目的地一致", () => {
    const { container, unmount, restore } = setup();
    hover(container.querySelector(`.mp-svg a.loc[data-id="18"]`));
    // 选中会让 React 重建该地点的节点：hover 之后重新查询，避免点到已卸载的旧节点。
    const icon = container.querySelector(`.mp-svg a.loc[data-id="18"]`);
    const listLink = container.querySelector(`.mp-list a[data-id="18"]`);
    const start = container.querySelector(".mp-card a.btn.red");
    expect(start?.getAttribute("href")).toBe("/apps/leblanc");
    for (const entry of [icon, start, listLink]) {
      click(entry);
    }
    expect(navigateMock).toHaveBeenCalledTimes(3);
    for (const call of navigateMock.mock.calls) {
      expect(call[0]).toMatchObject({ destination: "/apps/leblanc", source: "map-travel" });
      expect(call[0]?.intent).toBeUndefined();
    }
    unmount();
    restore();
  });

  it("上野三入口显式带 enter-showcase；其它地点不带", () => {
    const { container, unmount, restore } = setup();
    hover(container.querySelector(`.mp-svg a.loc[data-id="6"]`));
    // 同上：选中后节点重建，重新查询再点击。
    const icon = container.querySelector(`.mp-svg a.loc[data-id="6"]`);
    const listLink = container.querySelector(`.mp-list a[data-id="6"]`);
    const start = container.querySelector(".mp-card a.btn.red");
    expect(start?.getAttribute("href")).toBe("/showcase");
    for (const entry of [icon, start, listLink]) {
      click(entry);
    }
    expect(navigateMock).toHaveBeenCalledTimes(3);
    for (const call of navigateMock.mock.calls) {
      expect(call[0]).toMatchObject({
        destination: "/showcase",
        source: "map-travel",
        intent: "enter-showcase",
      });
    }
    unmount();
    restore();
  });

  it("地图不把未开放地点变成入口（图标不可点、列表不含）", () => {
    const { container, unmount, restore } = setup();
    for (const location of mapLocations.filter((item) => item.to === null)) {
      expect(container.querySelector(`.mp-svg a.loc[data-id="${location.id}"]`)).toBeNull();
      expect(container.querySelector(`.mp-list a[data-id="${location.id}"]`)).toBeNull();
    }
    unmount();
    restore();
  });
});
