"use client";

/**
 * 首页「应用枢纽」变体（C）的入口网格（2026-10-17 · 用户反馈 R4）。
 *
 * 目的：把 9 个视觉还原界面（殿堂/图库/天鹅绒/导航/COOP/放课后/手记/印象空间/IM）
 * 放到首页显眼位置，方便站主逐屏验证；点击进入手机对应深链或独立页。
 *
 * 用 `<a>`（而不是导航协调器）的原因：这些是**手机深链**（`?phone=`），
 * 由 PhoneProvider 从 URL 解析，直接整页打开也能恢复状态；不参与页面过场。
 */

import type { ReactNode } from "react";

import { HOME_APP_LINKS } from "./home-app-links";

export function HomeAppHub(): ReactNode {
  return (
    <section className="shell home-sec" id="home-apps" aria-labelledby="home-apps-h">
      <header className="sec-h">
        <span className="no">05</span>
        <h2 id="home-apps-h">
          <span className="en">App Hub</span>
          <span className="cn">应用入口</span>
        </h2>
        <p className="aside">9 INTERFACES</p>
      </header>
      <ul className="home-app-hub">
        {HOME_APP_LINKS.map((app) => (
          <li key={app.id}>
            <a href={app.href} data-home-app={app.id}>
              {/* eslint-disable-next-line @next/next/no-img-element -- 固定迁移图标，尺寸 40px。 */}
              <img src={app.icon} alt="" width={40} height={40} loading="lazy" />
              <span className="hub-name">{app.name}</span>
              <span className="hub-sub">{app.subtitle}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
