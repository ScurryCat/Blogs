/**
 * 东京地图：25 个地点的几何数据 + 目的地解析。
 *
 * 几何来自 `data/map.json`（旧站 `assets/js/map-data.js`，坐标单位 = 地图 SVG 用户单位，
 * viewBox `0 0 1500 1000`）。**不改地点配置、不改「点哪里去哪」**：
 * 目的地解析完全沿用旧站 `assets/js/map.js` 的 `dest()`，
 * 只把旧站链接经 `legacyHrefToNext()` 转成新站路径。
 */

import { asset } from "./assets";
import { site } from "./config";
import mapJson from "./data/map.json";
import { findPost, postPath, type Post } from "./posts";
import { legacyHrefToNext } from "./routes";

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

export interface MapDestinationInfo {
  href: string;
  en: string;
  title: string;
  note: string;
  cover?: string;
  date?: string;
}

const tuples = mapJson as MapTuple[];

function destination(id: number): MapDestinationInfo | null {
  const entry = site.map[String(id)];
  if (!entry) return null;
  if (entry.post) {
    const post: Post | null = findPost(entry.post);
    if (!post) return null;
    return {
      href: postPath(post),
      en: post.category,
      title: post.title,
      note: post.ex,
      cover: post.cover,
      date: post.date,
    };
  }
  return {
    href: legacyHrefToNext(entry.href ?? "/"),
    en: entry.en ?? "POST",
    title: entry.title ?? "",
    note: entry.note ?? "",
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

/** 可前往的地点（旧站 `open`）。 */
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
