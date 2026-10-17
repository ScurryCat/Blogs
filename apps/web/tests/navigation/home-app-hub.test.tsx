/**
 * 首页应用枢纽（C 变体）入口网格（2026-10-17 · 用户反馈 R4）。
 *
 * 断言：9 个视觉还原界面入口齐全；手机内置应用的深链 id 都在注册表里（不会坏按钮）；
 * 图库走真实独立页 `/gallery`。
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { render, resetDocument } from "../helpers/render";
import { HOME_APP_LINKS } from "@/features/legacy/pages/home-app-links";
import { HomeAppHub } from "@/features/legacy/pages/home-app-hub";
import { phoneRegistry } from "@/features/phone/registry";

afterEach(() => {
  resetDocument();
});

describe("HomeAppHub", () => {
  it("渲染 9 个入口，名称与用户要验证的界面一致", () => {
    const { container, unmount } = render(<HomeAppHub />);
    const links = [...container.querySelectorAll("[data-home-app]")];
    expect(links).toHaveLength(9);
    const names = links.map((node) => node.querySelector(".hub-name")?.textContent);
    expect(names).toEqual(expect.arrayContaining(["殿堂", "图库", "天鹅绒", "导航", "协助者", "放课后", "手记", "印象空间", "IM"]));
    unmount();
  });

  it("手机应用的深链 id 都在注册表；图库走 /gallery", () => {
    for (const app of HOME_APP_LINKS) {
      if (app.id === "gallery") {
        expect(app.href).toBe("/gallery");
        continue;
      }
      expect(phoneRegistry.find(app.id), `未注册的首页入口 ${app.id}`).toBeDefined();
      expect(app.href).toBe(`/?phone=${app.id}`);
    }
  });

  it("图标都指向仓库内存在的静态路径（/assets/legacy/...）", () => {
    for (const app of HOME_APP_LINKS) {
      expect(app.icon.startsWith("/assets/legacy/img/app/")).toBe(true);
    }
  });
});
