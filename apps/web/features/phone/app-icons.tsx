"use client";

/**
 * 手机桌面应用图标（内联 SVG，自绘）。
 *
 * **为什么自绘而不是用现成素材**（2026-10-17 查证）：
 *  - 仓库里没有应用图标 —— 只有手机外壳图与 10 个**角色头像**（`assets/img/icon/*.webp`），
 *    而头像用来表示「手记」「天气」是语义错位的，站点入口那边还退化成文字符号 ▤ ◈ ☂ ★；
 *  - 游戏原版素材取不到也不该取：The Spriters Resource / TCRF / 萌娘百科 / vg-resource /
 *    spritedatabase / models-resource **全部 403/406**（Cloudflare），GitHub 上的 P5 界面项目
 *    都是**代码复刻**而非官方素材（唯一 MIT 许可的那个没有任何图片，另一个 279★ 的没有许可）；
 *  - P5 素材本身是 Atlus / SEGA 版权，`docs/operations/limitations.md` 已登记「游戏素材许可缺口」，
 *    再引入一批拆包图标只会扩大它。**自绘不引入新的许可问题**，也不新增位图。
 *
 * 语言：24×24 视框、实心色块、硬边与斜切（呼应磁贴的 `clip-path`），单色 `currentColor`
 * 以便跟随主题（磁贴上由 `.pw-app .g` 染成红色）。
 *
 * 替换方式：`AppTile` 优先用这里的图标；没有对应条目时才回退到角色头像 / 文字符号。
 * 这样以后想换某个图标只改这一个文件，不必动宿主。
 */

import type { ReactNode } from "react";

/** 统一的 SVG 外壳：24×24、实心、跟随 currentColor。 */
function Icon({ children, title }: { children: ReactNode; title: string }): ReactNode {
  return (
    <svg
      className="g-svg"
      viewBox="0 0 24 24"
      width={34}
      height={34}
      role="img"
      aria-label={title}
      focusable="false"
    >
      {children}
    </svg>
  );
}

/**
 * 应用 / 入口 id → 图标。id 与 `features/phone/registry.ts`、`legacy-apps.ts` 里的 id 一致。
 *
 * 造型说明（每个都取「功能本身」而不是角色）：
 *   ins       对话气泡 —— 图文动态与交流
 *   journal   笔记本 —— 手记
 *   leisure   手柄 —— 追番与游戏（放课后）
 *   coop      两个并肩的人 —— 协助者（真实友链）
 *   metanav   导航针 —— 异世界导航
 *   showcase  画框 —— 我的殿堂（作品与照片）
 *   palace    带放大镜的卷宗 —— 情报宫殿（专题索引）
 *   tokyo     地图针 —— 东京地图
 *   cast      云与雨 —— 天气预报
 *   profile   证件卡 —— 档案
 */
export const APP_ICONS: Record<string, ReactNode> = {
  ins: (
    <Icon title="图文动态">
      <path d="M2.5 3.5h19l-1.6 12.4H10.2L5.6 20.6v-4.7H4.1z" fill="currentColor" />
      <path d="M7 8.2h10.2l-.3 2.2H7.3z" fill="var(--black)" opacity=".55" />
      <path d="M7.6 12.1h7.6l-.3 2.2H7.9z" fill="var(--black)" opacity=".55" />
    </Icon>
  ),
  journal: (
    <Icon title="手记">
      <path d="M4.6 2.8h14.9l-1.9 18.4H6.5z" fill="currentColor" />
      <path d="M8.2 2.8h2.6l-1.9 18.4H6.3z" fill="var(--black)" opacity=".45" />
      <path d="M11.6 7.1h5.6l-.3 1.9h-5.6z" fill="var(--black)" opacity=".5" />
      <path d="M11 11.2h5.6l-.3 1.9h-5.6z" fill="var(--black)" opacity=".5" />
      <path d="M10.4 15.3h5.6l-.3 1.9h-5.6z" fill="var(--black)" opacity=".5" />
    </Icon>
  ),
  leisure: (
    <Icon title="放课后">
      <path d="M7.4 7.1h9.2l5.1 4.3-3.2 5.5-3-2.3H8.5l-3 2.3-3.2-5.5z" fill="currentColor" />
      <path d="M6.1 10.4h3.2v1.7H6.1zM7.3 9.2h.8v4.1h-.8z" fill="var(--black)" opacity=".6" />
      <circle cx="16" cy="10.4" r="1.2" fill="var(--black)" opacity=".6" />
      <circle cx="18.2" cy="12.3" r="1.2" fill="var(--black)" opacity=".6" />
    </Icon>
  ),
  coop: (
    <Icon title="协助者">
      <circle cx="8.1" cy="7.2" r="3.3" fill="currentColor" />
      <path d="M1.9 20.4c0-3.6 2.8-6.1 6.2-6.1s6.2 2.5 6.2 6.1z" fill="currentColor" />
      <circle cx="16.6" cy="8.4" r="2.6" fill="currentColor" opacity=".62" />
      <path d="M11.6 20.4c0-3.1 2.2-5.2 5-5.2s5 2.1 5 5.2z" fill="currentColor" opacity=".62" />
    </Icon>
  ),
  metanav: (
    <Icon title="异世界导航">
      <path d="M12 2.2l3.4 8.1 6.4 1.7-6.4 1.7L12 21.8l-3.4-8.1L2.2 12l6.4-1.7z" fill="currentColor" />
      <circle cx="12" cy="12" r="2.4" fill="var(--black)" opacity=".55" />
    </Icon>
  ),
  showcase: (
    <Icon title="我的殿堂">
      <path d="M2.4 3.2h19.2v15.1H2.4z" fill="currentColor" />
      <path d="M4.6 5.4h14.8v10.7H4.6z" fill="var(--black)" opacity=".55" />
      <path d="M5.4 15.4l3.6-4.4 2.6 3 2.4-2.9 4.3 4.3z" fill="currentColor" />
      <circle cx="9.1" cy="8.2" r="1.3" fill="currentColor" />
      <path d="M2.4 19.4h19.2v1.6H2.4z" fill="currentColor" opacity=".7" />
    </Icon>
  ),
  palace: (
    <Icon title="情报宫殿">
      <path d="M3.2 2.6h12.4l-1.6 14.8H4.8z" fill="currentColor" />
      <path d="M6.1 6.4h7.4l-.3 1.7H6.4zM5.6 10h7.4l-.3 1.7H5.9z" fill="var(--black)" opacity=".5" />
      <circle cx="17.4" cy="15.6" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M20.1 18.6l2.4 2.6-1.4 1.2-2.3-2.6z" fill="currentColor" />
    </Icon>
  ),
  tokyo: (
    <Icon title="东京地图">
      <path d="M12 1.9c3.7 0 6.6 2.9 6.6 6.5 0 4.6-6.6 13.7-6.6 13.7S5.4 13 5.4 8.4c0-3.6 2.9-6.5 6.6-6.5z" fill="currentColor" />
      <circle cx="12" cy="8.2" r="2.7" fill="var(--black)" opacity=".55" />
    </Icon>
  ),
  cast: (
    <Icon title="天气预报">
      <path d="M6.4 12.6c-2.1 0-3.8-1.6-3.8-3.6s1.7-3.6 3.8-3.6c.5-2.4 2.7-4.1 5.3-4.1 3 0 5.4 2.2 5.4 5 2 .3 3.5 1.9 3.5 3.8 0 2.1-1.8 3.8-4 3.8z" fill="currentColor" />
      <path d="M7.2 15.4l-1.4 3.2h2.1l1.4-3.2zM12 15.4l-1.4 5.1h2.1l1.4-5.1zM16.8 15.4l-1.4 3.2h2.1l1.4-3.2z" fill="currentColor" opacity=".72" />
    </Icon>
  ),
  velvet: (
    <Icon title="天鹅绒房间">
      <path d="M12 2.6c-4.4 0-7.4 3-7.4 7.2 0 5 3.5 8.5 7.4 12.2 3.9-3.7 7.4-7.2 7.4-12.2 0-4.2-3-7.2-7.4-7.2z" fill="currentColor" />
      <circle cx="9.2" cy="9" r="1.5" fill="var(--black)" />
      <circle cx="14.8" cy="9" r="1.5" fill="var(--black)" />
      <path d="M8.6 13.4h6.8L12 17.2z" fill="var(--black)" />
    </Icon>
  ),
  mementos: (
    <Icon title="印象空间">
      <path d="M3.5 20.5v-8L12 4.2l8.5 8.3v8h-4.7v-4.1a3.8 3.8 0 0 0-7.6 0v4.1z" fill="currentColor" />
      <path d="M8.2 20.5v-4.1a3.8 3.8 0 0 1 7.6 0v4.1h-2.2v-4.1a1.6 1.6 0 0 0-3.2 0v4.1z" fill="var(--black)" />
      <path d="M2 20.5h20v1.4H2z" fill="currentColor" />
    </Icon>
  ),
  profile: (
    <Icon title="档案">
      <path d="M2.6 4.4h18.8v15.2H2.6z" fill="currentColor" />
      <path d="M4.8 6.6h9.6v10.8H4.8z" fill="var(--black)" opacity=".5" />
      <circle cx="9.6" cy="10.2" r="1.9" fill="currentColor" />
      <path d="M6.2 17.4c0-2 1.5-3.5 3.4-3.5s3.4 1.5 3.4 3.5z" fill="currentColor" />
      <path d="M16.2 8.2h3.2v1.5h-3.2zM16.2 11.4h3.2v1.5h-3.2zM16.2 14.6h3.2v1.5h-3.2z" fill="var(--black)" opacity=".55" />
    </Icon>
  ),
};
