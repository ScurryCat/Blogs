"use client";

/**
 * 手机桌面：状态栏 + 音乐卡片 + 应用网格（02 §3）。
 *
 * - 只显示**真的可用**的入口：内置应用来自注册表（未接入的能力不出现），
 *   站点链接来自已迁移的页面；不放假信号、假通知数量或占位按钮。
 * - 音效不再独占一个 App（设计 02 §3）：它是音乐卡片下方的开关。
 * - 状态栏时钟只在客户端走时，卸载时清计时器。
 */

import { useEffect, useState, type ReactNode } from "react";

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

export function PhoneDesktop(): ReactNode {
  const { apps } = usePhone();
  const [now, setNow] = useState<Date | null>(null);

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
      <nav className="pw-apps" aria-label="手机应用">
        {apps.map((app) => (
          <AppTile app={app} key={app.id} />
        ))}
      </nav>
      <SoundSwitch />
    </>
  );
}
