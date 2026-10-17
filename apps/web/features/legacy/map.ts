/**
 * 东京地图：25 个地点的几何数据 + 目的地解析。
 *
 * 几何来自 `data/map.json`（旧站 `assets/js/map-data.js`，坐标单位 = 地图 SVG 用户单位，
 * viewBox `0 0 1500 1000`）。**不改地图图形、地点名与位置**。
 *
 * 目的地只从**一份**配置来：`features/navigation/map-destinations.ts`（任务书 §2.3）。
 * 因此地图图标、右侧「出发」与下方列表读到的永远是同一个 `to`；
 * 不再按文章 slug 解析目的地，也没有旧 HTML 入口。
 */

import type { NavigationIntent } from "@/features/phone/types";
import { findMapDestination } from "@/features/navigation/map-destinations";

import { asset } from "./assets";
import mapJson from "./data/map.json";

/** `map.json` 的元组顺序（与旧站注释一致）。 */
type MapTuple = [
  id: number,
  kanji: string,
  roma: string,
  lx: number,
  ly: number,
  lw: number,
  lh: number,
  cx: number,
  cy: number,
  cw: number,
  ch: number,
  kx: number,
  ky: number,
  ex: number,
  ey: number,
  rot: number,
];

export interface MapLocation {
  id: number;
  kanji: string;
  roma: string;
  lx: number;
  ly: number;
  lw: number;
  lh: number;
  cx: number;
  cy: number;
  cw: number;
  ch: number;
  kx: number;
  ky: number;
  ex: number;
  ey: number;
  rot: number;
  /** 目的地；`null` 表示「未开放」（不可点、不进列表）。 */
  to: MapDestinationInfo | null;
}

/** 右侧档案卡与三入口共用的目的地信息（全部来自 `MAP_DESTINATIONS`）。 */
export interface MapDestinationInfo {
  href: string;
  en: string;
  title: string;
  note: string;
  /** 显式导航意图（上野 = 主动进入作品殿堂）。 */
  intent?: NavigationIntent;
}

const tuples = mapJson as MapTuple[];

function destination(id: number): MapDestinationInfo | null {
  const entry = findMapDestination(id);
  if (!entry) return null;
  return {
    href: entry.href,
    en: entry.en,
    title: entry.title,
    note: entry.note,
    ...(entry.intent ? { intent: entry.intent } : {}),
  };
}

export const mapLocations: MapLocation[] = tuples.map((tuple) => {
  const [id, kanji, roma, lx, ly, lw, lh, cx, cy, cw, ch, kx, ky, ex, ey, rot] = tuple;
  return {
    id,
    kanji,
    roma,
    lx,
    ly,
    lw,
    lh,
    cx,
    cy,
    cw,
    ch,
    kx,
    ky,
    ex,
    ey,
    rot,
    to: destination(id),
  };
});

/** 可前往的地点（统一由目的地配置决定；未开放地点 `to` 为 null）。 */
export const openLocations: MapLocation[] = mapLocations.filter((loc) => loc.to !== null);

export const MAP_IMAGE_BASE = asset("assets/img/map/");

export function locationImage(id: number): string {
  return `${MAP_IMAGE_BASE}${id}_image.png`;
}

export function locationLabel(id: number): string {
  return `${MAP_IMAGE_BASE}svg/${id}_label.svg`;
}

export function locationLabelAlt(id: number): string {
  return `${MAP_IMAGE_BASE}svg/${id}_label_alt.svg`;
}

export const MAP_SRC = `${MAP_IMAGE_BASE}map.webp`;
/** 旧站 viewBox 是 `0 0 1500 990`，底图高 982。 */
export const MAP_VIEWBOX = { width: 1500, height: 990 };
export const DEFAULT_LOCATION_ID = 18;
