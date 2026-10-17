/**
 * 站点配置：旧站 `assets/js/site.js` 的 `window.PL_SITE` 迁移。
 *
 * 数值来自 `data/site.json`（由 `tools/legacy-migration/migrate.mjs` 从旧站转出，
 * 保持逐字段一致），这里只做**类型化 + 资源路径改写**，不改语义：
 *  - 问卷 `base`（73 : 927）是设定值，不是全站真实票数，迁移不「升级」它；
 *  - 留言板默认仍是 `store: 'local'`（本机存储），不偷偷变成共享留言；
 *  - 说话人立绘、地图目的地、塔罗分类全部沿用旧配置。
 */

import { asset } from "./assets";
import siteJson from "./data/site.json";

export interface SocialLink {
  k: string;
  v: string;
  url: string;
}

export interface PollConfig {
  id: string;
  title: string;
  question: string;
  questionHighlight: string[];
  options: { value: string; label: string }[];
  main: string;
  base: Record<string, number>;
  comment: { author: string; text: string; highlight: string[] } | null;
}

export interface GuestbookConfig {
  store: string;
  endpoint: string;
  key: string;
  table: string;
  greeting: string;
  maxName: number;
  maxText: number;
  cooldown: number;
}

export interface MapDestination {
  /** 站内目的地（旧站写法，如 `index.html#posts`）。 */
  href?: string;
  en?: string;
  title?: string;
  note?: string;
  /** 或者是文章 slug，标题 / 日期从文章数据取。 */
  post?: string;
}

export interface AboutStat {
  en: string;
  cn: string;
  lv: number;
  rank: string;
  note: string;
}

export interface AboutCoop {
  name: string;
  arcana: string[];
  rank: number;
  icon: string;
  note: string;
  url: string;
}

export interface AboutTimeline {
  y: string;
  h: string;
  p: string;
}

export interface AboutConfig {
  bg: string;
  art: string;
  lead: string;
  intro: string[];
  stats: AboutStat[];
  coop: AboutCoop[];
  timeline: AboutTimeline[];
}

export interface SiteConfig {
  name: string;
  nameB: string;
  nameCn: string;
  kicker: string;
  lead: string;
  author: string;
  codeName: string;
  role: string;
  base: string;
  startYear: number;
  heroArt: string;
  logo: string;
  ticker: string[];
  legal: string;
  copyright: string;
  social: SocialLink[];
  poll: PollConfig | null;
  guestbook: GuestbookConfig;
  arcana: Record<string, string[]>;
  speakers: Record<string, string>;
  me: string[];
  weather: { city: string; lat: number; lon: number };
  map: Record<string, MapDestination>;
  about: AboutConfig;
}

type RawSite = typeof siteJson;

function rewrite<T extends string | undefined>(value: T): T {
  return (value === undefined ? value : asset(value)) as T;
}

const raw = siteJson as RawSite;

export const site: SiteConfig = {
  ...raw,
  heroArt: rewrite(raw.heroArt),
  logo: rewrite(raw.logo),
  poll: raw.poll
    ? {
        id: raw.poll.id,
        title: raw.poll.title,
        question: raw.poll.question,
        questionHighlight: [...raw.poll.questionHighlight],
        options: raw.poll.options.map((option) => ({ ...option })),
        main: raw.poll.main,
        base: { ...raw.poll.base },
        comment: raw.poll.comment
          ? {
              author: raw.poll.comment.author,
              text: raw.poll.comment.text,
              highlight: [...raw.poll.comment.highlight],
            }
          : null,
      }
    : null,
  guestbook: { ...raw.guestbook },
  arcana: Object.fromEntries(
    Object.entries(raw.arcana).map(([key, value]) => [key, [...value]]),
  ),
  speakers: Object.fromEntries(
    Object.entries(raw.speakers).map(([key, value]) => [key, asset(value)]),
  ),
  me: [...raw.me],
  weather: { ...raw.weather },
  map: Object.fromEntries(
    // 第三轮起地图目的地由 `features/navigation/map-destinations.ts` **单点**配置
    // （13 个开放地点 + 用途说明 + 必要的导航意图）。`site.json` 里旧的逐字段 map
    // 已清空，避免残留绑定具体文章 slug 的旧入口；这里保留装配逻辑以便回退。
    Object.entries(raw.map as Record<string, MapDestination>).map(([key, value]) => [
      key,
      { ...value },
    ]),
  ),
  about: {
    ...raw.about,
    bg: rewrite(raw.about.bg),
    art: rewrite(raw.about.art),
    intro: [...raw.about.intro],
    stats: raw.about.stats.map((stat) => ({ ...stat })),
    coop: raw.about.coop.map((coop) => ({
      ...coop,
      arcana: [...coop.arcana],
      icon: asset(coop.icon),
    })),
    timeline: raw.about.timeline.map((item) => ({ ...item })),
  },
};

/** 分类 → 塔罗（旧站 `S.arcana[category] || ['?', category]`）。 */
export function arcanaOf(category: string): [string, string] {
  const found = site.arcana[category];
  return found ? [found[0] ?? "?", found[1] ?? category] : ["?", category];
}

/** 站点配置里的说话人立绘；未登记的名字不是对话框。 */
export function speakerFace(name: string): string | null {
  return site.speakers[name] ?? null;
}

export function isSpeaker(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(site.speakers, name);
}
