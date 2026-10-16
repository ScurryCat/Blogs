/**
 * 地图页 `/map`（旧站 `map.html` + `assets/js/map.js`）。
 * 交互（选中、光标抖动、方向键）在客户端组件里；过场来源见 `MapView`。
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";

import { MapView } from "@/features/legacy/pages/map-view";

export const metadata: Metadata = {
  title: "Tokyo Map",
  description: "东京地图：可前往的地点与目的地。地图图标、右侧出发与下方列表使用车站人群过场。",
};

export default function MapPage(): ReactNode {
  return <MapView />;
}
