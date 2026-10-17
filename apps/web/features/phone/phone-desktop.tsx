"use client";

/**
 * 手机桌面：状态栏 + 音乐卡片 + 两页应用网格（v2 任务书 §2.2）。
 *
 * - **两页桌面**：第一页 2×3（INS / 手记 / 放课后，COOP / 我的殿堂 / 异世界导航 ——
 *   生活近况优先在第一行）；第二页 2×2（情报 / 地图 / 天气 / 档案）。
 *   页码**单独在桌面定义**，不依赖注册表排序（任务书点名：showcase 与 metanav 的
 *   注册表顺序不等于桌面要求）。
 * - 换页：左右按钮 + 「1 / 2」指示（触控**滑动只是补充**，不能是唯一途径）；
 *   第二页**不塞占位 App** 填满网格。
 * - 只显示**真的可用**的入口：清单里的 id 若未在注册表登记就不渲染（不放假入口）。
 * - 音效不再独占一个 App（设计 02 §3）：它是音乐卡片下方的开关。
 * - 状态栏时钟只在客户端走时，卸载时清计时器。
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

import { PhoneMusicCard } from "./phone-music-card";
import { APP_ICONS } from "./app-icons";

/**
 * 应用图标用哪一版：
 *   `"raster"` = 生成的位图（`public/assets/legacy/img/app/<id>.png`，AI 出图后切好、抠黑底）
 *   `"svg"`    = 自绘矢量（`./app-icons`）
 *
 * **两版都保留，切换只改这一行** —— 位图那版笔触更「厚」、有手绘感；矢量那版在任意缩放下都锐利、
 * 且不新增位图资产。定下来之后删掉没选的那版即可（位图版删 `public/assets/legacy/img/app/`，
 * 矢量版删 `./app-icons.tsx`）。
 */
const ICON_STYLE: "raster" | "svg" = "raster";
import { usePhone } from "./phone-provider";
import type { PhoneAppManifest } from "./types";
import { useAudioOrDefault, useSoundEnabled } from "@/features/runtime/audio/audio-service";

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/**
 * 旧站桌面的字形图标（`▤ ◈ ☂ ★`）。注册表里的应用有自己的图标资源，
 * 这两个已迁移的站点链接保留旧站字形，避免「顺手换掉」既有的手机美术。
 */
const LEGACY_GLYPHS: Record<string, string> = {
  palace: "▤",
  tokyo: "◈",
  cast: "☂",
  profile: "★",
};

/** 两页桌面的固定排列（v2 任务书 §2.2）。第二页只有 4 个，不填充占位。 */
const DESKTOP_PAGES: readonly (readonly string[])[] = [
  ["ins", "journal", "leisure", "coop", "showcase", "metanav"],
  ["palace", "tokyo", "cast", "profile"],
];

function SoundSwitch(): ReactNode {
  const audio = useAudioOrDefault();
  const enabled = useSoundEnabled();
  return (
    <button
      className="pw-snd"
      type="button"
      aria-pressed={enabled}
      aria-label="菜单音效"
      onClick={() => {
        const next = !enabled;
        audio.setSoundEnabled(next);
        if (next) audio.blip();
      }}
    >
      <span aria-hidden="true">♪</span> 音效 {enabled ? "ON" : "OFF"}
    </button>
  );
}

function AppTile({ app }: { app: PhoneAppManifest }): ReactNode {
  const { host } = usePhone();
  const glyph = LEGACY_GLYPHS[app.id];
  // 优先用自绘的 SVG 应用图标（一套语言、无许可问题）；
  // 没有对应条目时才回退到角色头像 / 旧站文字符号。
  const icon = APP_ICONS[app.id];
  const rasterIcon = `/assets/legacy/img/app/${app.id}.png`;
  const activate = () => {
    if (app.kind === "embedded") {
      host.openApp(app.id);
      return;
    }
    // 站点链接：普通站内跳转（默认 Joker 帷幕），不冒充地图旅行。
    host.openSiteContent({ destination: app.canonical_path, source: "phone-link" });
  };
  return (
    <button className="pw-app" type="button" onClick={activate} data-app-id={app.id}>
      {ICON_STYLE === "raster" && rasterIcon ? (
        // eslint-disable-next-line @next/next/no-img-element -- 已审核的静态资源，尺寸固定。
        <img className="g-img" src={rasterIcon} alt="" width={34} height={34} />
      ) : icon ? (
        icon
      ) : glyph ? (
        <span className="g" aria-hidden="true">
          {glyph}
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- 图标来自已审核的静态资源，尺寸固定。
        <img className="g-img" src={app.icon} alt="" width={34} height={34} />
      )}
      <span className="c">{app.name}</span>
      <span className="e">{app.subtitle}</span>
    </button>
  );
}

export function PhoneDesktop({
  page,
  onPageChange,
}: {
  /** 当前桌面页（由 PhoneHost 持有）：进入 App 再返回时不应回到第一页。 */
  page: number;
  onPageChange: (next: number) => void;
}): ReactNode {
  const { apps } = usePhone();
  const [now, setNow] = useState<Date | null>(null);
  // 页码由 PhoneHost 持有 —— 组件在「进入 App」时会卸载，
  // 放在这里会被重置回第一页（任务书 §3.3「返回保留适用状态」）。
  const swipe = useRef<{ x: number; y: number } | null>(null);

  // 固定排列之外、但已登记的应用追加到末页：**注册表仍是「存在」的唯一来源**，
  // 新登记的应用不会从桌面上消失（宿主不加分支）。空页跳过，避免出现空白页。
  const fixedIds = new Set(DESKTOP_PAGES.flat());
  const extras = apps.filter((app) => !fixedIds.has(app.id));
  const pages = DESKTOP_PAGES.map((ids, index) =>
    index === DESKTOP_PAGES.length - 1 ? [...ids, ...extras.map((app) => app.id)] : [...ids],
  )
    .map((ids) =>
      ids
        .map((id) => apps.find((app) => app.id === id))
        .filter((app): app is PhoneAppManifest => Boolean(app)),
    )
    .filter((list) => list.length > 0);

  const pageCount = Math.max(1, pages.length);
  const current = Math.min(page, pageCount - 1);
  const pageApps = pages[current] ?? [];

  useEffect(() => {
    // 挂载后再读时钟：SSR 快照与客户端时间不同，且 effect 里同步 setState 会级联渲染。
    let frame = 0;
    const read = () => setNow(new Date());
    frame = window.requestAnimationFrame(read);
    const timer = window.setInterval(read, 20_000);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(timer);
    };
  }, []);

  const clock = now ? `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}` : "--:--";
  const date = now ? `${now.getMonth() + 1}/${now.getDate()} ${WEEKDAYS[now.getDay()]}` : "";

  return (
    <>
      <header className="pw-status">
        <span className="pw-clk" data-pl-clock>
          {clock}
        </span>
        <span className="pw-date">{date}</span>
        <span className="pw-sig" aria-hidden="true">
          ▮▮▮▯
        </span>
      </header>
      <PhoneMusicCard />
      <nav
        className="pw-apps"
        aria-label={`手机应用（第 ${current + 1} 页，共 ${pageCount} 页）`}
        data-page={current}
        onPointerDown={(event) => {
          swipe.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerUp={(event) => {
          if (!swipe.current) return;
          const dx = event.clientX - swipe.current.x;
          const dy = event.clientY - swipe.current.y;
          swipe.current = null;
          // 触控滑动是**补充**：横向位移显著大于纵向才算换页手势，
          // 避免与屏幕纵向滚动冲突（任务书 §2.2 / §3.2）。
          if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 2) {
            onPageChange(Math.min(pageCount - 1, Math.max(0, current + (dx < 0 ? 1 : -1))));
          }
        }}
      >
        {pageApps.map((app) => (
          <AppTile app={app} key={app.id} />
        ))}
      </nav>
      <div className="pw-pager">
        <button
          className="pw-page-btn"
          type="button"
          aria-label="上一页"
          disabled={current === 0}
          onClick={() => onPageChange(Math.max(0, current - 1))}
        >
          ‹
        </button>
        <span className="pw-page-dots" aria-hidden="true">
          {pages.map((_, index) => (
            <i key={index} className={index === current ? "on" : ""} />
          ))}
        </span>
        <span className="pw-page-num">
          {current + 1} / {pageCount}
        </span>
        <button
          className="pw-page-btn"
          type="button"
          aria-label="下一页"
          disabled={current === pageCount - 1}
          onClick={() => onPageChange(Math.min(pageCount - 1, current + 1))}
        >
          ›
        </button>
      </div>
      <SoundSwitch />
    </>
  );
}
