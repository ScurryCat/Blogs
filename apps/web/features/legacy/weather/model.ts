/**
 * 天气页的纯逻辑 —— 旧站 `assets/js/weather.js` 的映射表与精灵图坐标迁移。
 *
 * 抽成模块是为了能单测：WMO 天气码 → P5 四类天气、中文描述、精灵图定位。
 * 数据源仍是 Open-Meteo（免费、无需 API Key），迁移不改数据源。
 */

export const CONDITIONS = ["晴", "多云", "雨", "雪"] as const;
export const WEEKDAYS_CN = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

/** WMO 天气码 → P5 的四种天气：0 晴、1 云、2 雨、3 雪。 */
export function p5Condition(code: number): 0 | 1 | 2 | 3 {
  if (code <= 1) return 0;
  if (code <= 48) return 1;
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 3;
  return 2;
}

const DESCRIPTIONS: Record<number, string> = {
  0: "晴朗",
  1: "大致晴朗",
  2: "局部多云",
  3: "阴天",
  45: "雾",
  48: "冻雾",
  51: "小毛毛雨",
  53: "毛毛雨",
  55: "大毛毛雨",
  61: "小雨",
  63: "中雨",
  65: "大雨",
  66: "冻雨",
  67: "强冻雨",
  71: "小雪",
  73: "中雪",
  75: "大雪",
  77: "雪粒",
  80: "阵雨",
  81: "强阵雨",
  82: "暴雨",
  85: "阵雪",
  86: "强阵雪",
  95: "雷阵雨",
  96: "雷阵雨伴冰雹",
  99: "强雷暴伴冰雹",
};

export function wmoText(code: number): string {
  return DESCRIPTIONS[code] ?? CONDITIONS[p5Condition(code)];
}

/** `2026-10-16` → 本地日期。 */
export function parseDay(value: string): Date {
  const [year = 1970, month = 1, day = 1] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** 精灵图：叠层数字（top / mid / base 三层）；320 = °，352 = 负号，384 = 空。 */
export function smallDigitPosition(value: number): { sign: number; tens: number; ones: number } {
  const rounded = Math.round(value);
  const abs = Math.abs(rounded);
  return {
    sign: rounded < 0 ? -352 : -384,
    tens: abs >= 10 ? (-((Math.floor(abs / 10) % 10) * 32)) : -384,
    ones: -((abs % 10) * 32),
  };
}

/** 大号当前温度：72px 一格；704 = °，768 = 小数点，832 = 负号。 */
export function currentTemperature(value: number): {
  negative: boolean;
  single: boolean;
  tens: number;
  ones: number;
  fraction: number;
} {
  const abs = Math.round(Math.abs(value) * 10) / 10;
  return {
    negative: value < 0,
    single: abs < 10,
    tens: (-(Math.floor(abs / 10) % 10)) * 72,
    ones: (-(Math.floor(abs) % 10)) * 72,
    fraction: (-((Math.round((abs - Math.floor(abs)) * 10) % 10) * 72)),
  };
}

export interface WeatherDay {
  date: Date;
  code: number;
  hi: number;
  lo: number;
}

export interface WeatherSnapshot {
  city: string;
  timezone: string;
  current: { temperature: number; code: number };
  days: WeatherDay[];
}

export interface OpenMeteoResponse {
  timezone: string;
  current: { temperature_2m: number; weather_code: number };
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
  };
}

/** Open-Meteo 响应 → 页面模型（数组越界一律按缺省处理，不抛异常）。 */
export function toSnapshot(city: string, response: OpenMeteoResponse): WeatherSnapshot {
  const days: WeatherDay[] = response.daily.time.map((time, index) => ({
    date: parseDay(time),
    code: response.daily.weather_code[index] ?? 0,
    hi: response.daily.temperature_2m_max[index] ?? 0,
    lo: response.daily.temperature_2m_min[index] ?? 0,
  }));
  return {
    city,
    timezone: response.timezone,
    current: {
      temperature: response.current.temperature_2m,
      code: response.current.weather_code,
    },
    days,
  };
}

/** 读屏文本：整页精灵图都是装饰，真实信息只从这里念出来。 */
export function screenReaderText(snapshot: WeatherSnapshot): string {
  const [today, ...rest] = snapshot.days;
  if (!today) return "";
  return (
    `${snapshot.city}现在 ${snapshot.current.temperature}°C，${wmoText(snapshot.current.code)}。` +
    `今天最高 ${Math.round(today.hi)}°，最低 ${Math.round(today.lo)}°。` +
    rest
      .map(
        (day) =>
          `${day.date.getMonth() + 1}月${day.date.getDate()}日 ${wmoText(day.code)}，${Math.round(day.lo)}° 到 ${Math.round(day.hi)}°`,
      )
      .join("；") +
    "。"
  );
}

export const WEATHER_STORAGE_KEY = "pl-weather-city";

export const WEATHER_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
export const GEOCODING_ENDPOINT = "https://geocoding-api.open-meteo.com/v1/search";

export function forecastQuery(lat: number, lon: number): string {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: "temperature_2m,weather_code",
    daily: "weather_code,temperature_2m_max,temperature_2m_min",
    timezone: "auto",
    forecast_days: "5",
  });
  return `${WEATHER_ENDPOINT}?${params.toString()}`;
}
