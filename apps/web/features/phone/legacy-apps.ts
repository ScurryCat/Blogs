/**
 * 旧站手机的四个「站点链接」入口 → 注册表形态的 manifest（kind: `site-link`）。
 *
 * 为什么放在这里而不是 `registry.ts`：`registry.ts` 归 T00，且它目前**只有正式
 * 内置应用清单**（INS / 导航 / 日常由 T03–T07 登记）。这里登记的是**已经迁移完成、
 * 真的能打开的页面**（地图 / 天气 / 档案 / 宫殿索引），所以不是「尚未上线的坏按钮」。
 *
 * 宿主只按类型消费：`site-link` 走 `canonical_path` + `source: phone-link`，
 * 与 `embedded` 走同一条渲染路径，没有针对具体应用的条件分支。
 */

import type { PhoneAppManifest } from "./types";

export const LEGACY_PHONE_APPS: readonly PhoneAppManifest[] = Object.freeze([
  {
    id: "palace",
    name: "情报",
    subtitle: "宫殿索引",
    icon: "/assets/legacy/img/icon/joker.webp",
    order: 10,
    kind: "site-link",
    canonical_path: "/#posts",
    feature_flag: null,
    state_version: 1,
  },
  {
    id: "tokyo",
    name: "地图",
    subtitle: "东京",
    icon: "/assets/legacy/img/icon/queen.webp",
    order: 20,
    kind: "site-link",
    canonical_path: "/map",
    feature_flag: null,
    state_version: 1,
  },
  {
    id: "cast",
    name: "天气",
    subtitle: "预报",
    icon: "/assets/legacy/img/icon/oracle.webp",
    order: 30,
    kind: "site-link",
    canonical_path: "/weather",
    feature_flag: null,
    state_version: 1,
  },
  {
    id: "profile",
    name: "档案",
    subtitle: "关于我",
    icon: "/assets/legacy/img/icon/fox.webp",
    order: 40,
    kind: "site-link",
    canonical_path: "/about",
    feature_flag: null,
    state_version: 1,
  },
]);
