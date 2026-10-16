/** 天气页 `/weather`（旧站 `weather.html`）：客户端读取 Open-Meteo。 */

import type { Metadata } from "next";
import type { ReactNode } from "react";

import { WeatherView } from "@/features/legacy/pages/weather-view";
import { site } from "@/features/legacy/config";

export const metadata: Metadata = {
  title: "Weather",
  description: `天气预报（默认城市 ${site.weather.city}，数据来自 Open-Meteo）。`,
};

export default function WeatherPage(): ReactNode {
  return <WeatherView />;
}
