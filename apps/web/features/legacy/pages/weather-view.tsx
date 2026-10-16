"use client";

/**
 * 天气页 —— 旧站 `assets/js/weather.js` 的 React 迁移。
 *
 * 精灵图排版、叠层数字、三帧天气图标、昼夜背景、城市搜索与定位、
 * 30 分钟自动刷新与「天气没读出来」的失败态都按原样保留；
 * 纯逻辑（WMO 码映射、精灵图坐标、读屏文本）在 `weather/model.ts` 里可单测。
 *
 * 迁移差别：旧站把计时器与事件都挂在全局、换页时靠 `PL.onLeave` 清理，
 * 这里全部收在 effect 里，卸载即停（未完成的请求用 `AbortController` 取消）。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { site } from "@/features/legacy/config";
import {
  GEOCODING_ENDPOINT,
  WEATHER_STORAGE_KEY,
  WEEKDAYS_CN,
  currentTemperature,
  forecastQuery,
  p5Condition,
  screenReaderText,
  smallDigitPosition,
  toSnapshot,
  wmoText,
  type OpenMeteoResponse,
  type WeatherSnapshot,
} from "@/features/legacy/weather/model";
import { prefersReducedMotion } from "@/features/runtime/effects/crowd";

interface City {
  city: string;
  lat: number;
  lon: number;
}

const WEATHER_SPRITES = "/assets/legacy/img/weather/";

function Stack({ cls }: { cls: string }): ReactNode {
  return (
    <>
      <i className={`${cls} top`} />
      <i className={`${cls} mid`} />
      <i className={`${cls} base`} />
    </>
  );
}

function position(element: HTMLElement | null, x: number, y: number): void {
  if (element) element.style.backgroundPosition = `${x}px ${y}px`;
}

export function WeatherView(): ReactNode {
  const [city, setCity] = useState<City>(site.weather);
  const [snapshot, setSnapshot] = useState<WeatherSnapshot | null>(null);
  const [message, setMessage] = useState("正在读取天气…");
  const [bad, setBad] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [night, setNight] = useState(false);
  const [clock, setClock] = useState("--:--");
  const [query, setQuery] = useState("");
  const [frame, setFrame] = useState(0);

  const rootRef = useRef<HTMLElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timezoneRef = useRef<string | undefined>(undefined);

  // 城市选择记在浏览器里（旧站同一把键）。
  useEffect(() => {
    // 挂载后再读本机城市：渲染期不能碰 localStorage，effect 里同步 setState 又会级联渲染。
    const frame = window.requestAnimationFrame(() => {
      try {
        const stored = window.localStorage.getItem(WEATHER_STORAGE_KEY);
        if (!stored) return;
        const parsed = JSON.parse(stored) as Partial<City> | null;
        if (parsed?.city && typeof parsed.lat === "number" && typeof parsed.lon === "number") {
          setCity({ city: parsed.city, lat: parsed.lat, lon: parsed.lon });
        }
      } catch {
        // 读不到就用默认城市。
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const load = useCallback(async (target: City, boom: boolean) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setMessage("正在读取天气…");
    setBad(false);
    try {
      const response = await fetch(forecastQuery(target.lat, target.lon), { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as OpenMeteoResponse;
      const next = toSnapshot(target.city, payload);
      timezoneRef.current = next.timezone;
      setSnapshot(next);
      setMessage("");
      setBad(false);
      if (boom && !prefersReducedMotion()) {
        setShaking(true);
        window.setTimeout(() => setShaking(false), 400);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      setBad(true);
      setMessage("天气没读出来：网络不通或 Open-Meteo 暂时不可用。稍后刷新，或换个城市再试。");
      void error;
    }
  }, []);

  useEffect(() => {
    // 首次读取延后一拍：避免在 effect 同步阶段就把状态改掉（级联渲染）。
    const start = window.setTimeout(() => void load(city, false), 0);
    const timer = window.setInterval(() => void load(city, false), 30 * 60 * 1000);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(timer);
      abortRef.current?.abort();
    };
  }, [city, load]);

  // 时钟（按所选城市的当地时间）+ 昼夜切换。
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const zone = timezoneRef.current;
      try {
        const parts = new Intl.DateTimeFormat("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
          timeZone: zone,
        }).formatToParts(now);
        const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
        setClock(`${get("hour").padStart(2, "0")}:${get("minute")}${get("dayPeriod").toLowerCase()}`);
        const hour24 = Number(
          new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: zone }).format(now),
        );
        setNight(hour24 >= 18 || hour24 < 6);
      } catch {
        setClock("--:--");
      }
    };
    tick();
    const timer = window.setInterval(tick, 15_000);
    return () => window.clearInterval(timer);
  }, [snapshot]);

  // 天气图标三帧动画：全局一个计时器，减少动效时不跑。
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const timer = window.setInterval(() => setFrame((current) => (current + 1) % 3), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // 精灵图定位：日期、温度与天气图标。
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !snapshot) return;
    const setStack = (box: Element | null, index: number, width: number, height: number) => {
      box?.querySelectorAll("i").forEach((element, row) => {
        position(element as HTMLElement, -index * width, -row * height);
      });
    };
    const today = snapshot.days[0];
    if (!today) return;
    setStack(root.querySelector(".sp-mo"), today.date.getMonth(), 120, 120);
    setStack(root.querySelector(".sp-d.t"), Math.floor(today.date.getDate() / 10), 100, 150);
    setStack(root.querySelector(".sp-d.o"), today.date.getDate() % 10, 100, 150);
    const weekday = (today.date.getDay() + 6) % 7;
    position(root.querySelector(".sp-wd") as HTMLElement | null, -(weekday % 3) * 191, -Math.floor(weekday / 3) * 74);
    (root.querySelector(".sp-wx") as HTMLElement | null)?.setAttribute(
      "data-c",
      String(p5Condition(snapshot.current.code)),
    );
    const current = currentTemperature(snapshot.current.temperature);
    const cur = root.querySelector(".cur");
    cur?.classList.toggle("neg", current.negative);
    cur?.classList.toggle("one", current.single);
    position(cur?.querySelector(".c.t") as HTMLElement | null, current.tens, 0);
    position(cur?.querySelector(".c.o") as HTMLElement | null, current.ones, 0);
    position(cur?.querySelector(".c.f") as HTMLElement | null, current.fraction, 0);
    for (const [selector, value] of [
      [".mm.hi", today.hi],
      [".mm.lo", today.lo],
    ] as const) {
      const box = root.querySelector(selector);
      const digits = smallDigitPosition(value);
      position(box?.querySelector(".s") as HTMLElement | null, digits.sign, 0);
      position(box?.querySelector(".t") as HTMLElement | null, digits.tens, 0);
      position(box?.querySelector(".o") as HTMLElement | null, digits.ones, 0);
    }
    root.querySelectorAll(".wk").forEach((item, index) => {
      const day = snapshot.days[index + 1];
      if (!day) return;
      setStack(item.querySelector(".sp-d.t"), Math.floor(day.date.getDate() / 10), 100, 150);
      setStack(item.querySelector(".sp-d.o"), day.date.getDate() % 10, 100, 150);
      const weekdayIndex = (day.date.getDay() + 6) % 7;
      position(
        item.querySelector(".sp-wd") as HTMLElement | null,
        -(weekdayIndex % 3) * 191,
        -Math.floor(weekdayIndex / 3) * 74,
      );
      (item.querySelector(".sp-wx") as HTMLElement | null)?.setAttribute("data-c", String(p5Condition(day.code)));
      for (const [selector, value] of [
        [".mm.hi", day.hi],
        [".mm.lo", day.lo],
      ] as const) {
        const box = item.querySelector(selector);
        const digits = smallDigitPosition(value);
        position(box?.querySelector(".s") as HTMLElement | null, digits.sign, 0);
        position(box?.querySelector(".t") as HTMLElement | null, digits.tens, 0);
        position(box?.querySelector(".o") as HTMLElement | null, digits.ones, 0);
      }
      const label = item.querySelector(".wk-cn");
      if (label) label.textContent = `${WEEKDAYS_CN[weekdayIndex]} · ${wmoText(day.code)}`;
    });
  }, [snapshot]);

  // 天气图标帧：只改 data 与位置，不动结构。
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.querySelectorAll<HTMLElement>(".sp-wx[data-c]").forEach((element) => {
      const code = Number(element.dataset.c ?? 0);
      position(element, -code * 75, -frame * 72);
    });
  }, [frame, snapshot]);

  const onSearch = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = query.trim();
    if (!name) return;
    setMessage(`正在查找「${name}」…`);
    setBad(false);
    try {
      const response = await fetch(
        `${GEOCODING_ENDPOINT}?count=1&language=zh&name=${encodeURIComponent(name)}`,
      );
      const payload = (await response.json()) as {
        results?: { name: string; latitude: number; longitude: number }[];
      };
      const found = payload.results?.[0];
      if (!found) {
        setBad(true);
        setMessage(`没找到「${name}」。试试城市的正式名称，比如「上海」或「Osaka」。`);
        return;
      }
      const next = { city: found.name, lat: found.latitude, lon: found.longitude };
      try {
        window.localStorage.setItem(WEATHER_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // 记不住就用本次会话内的状态。
      }
      setQuery("");
      setCity(next);
      await load(next, true);
    } catch {
      setBad(true);
      setMessage("城市查询失败：网络不通。稍后再试。");
    }
  };

  const onLocate = () => {
    if (!navigator.geolocation) {
      setBad(true);
      setMessage("这个浏览器不支持定位。直接搜索城市吧。");
      return;
    }
    setMessage("正在定位…");
    navigator.geolocation.getCurrentPosition(
      (result) => {
        const next = {
          city: "我的位置",
          lat: Number(result.coords.latitude.toFixed(3)),
          lon: Number(result.coords.longitude.toFixed(3)),
        };
        try {
          window.localStorage.setItem(WEATHER_STORAGE_KEY, JSON.stringify(next));
        } catch {
          // 忽略。
        }
        setCity(next);
        void load(next, true);
      },
      () => {
        setBad(true);
        setMessage("没拿到位置：可能拒绝了定位权限，或页面不是 https。直接搜索城市吧。");
      },
      { timeout: 10_000 },
    );
  };

  return (
    <section
      className={`wx${snapshot ? " ready" : ""}${night ? " is-night" : ""}${shaking ? " shake" : ""}`}
      aria-labelledby="wx-h"
      ref={rootRef}
    >
      <div className="wx-bg" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element -- 旧站天气背景图。 */}
        <img className="day" src={`${WEATHER_SPRITES}city-day.jpg`} alt="" />
        {/* eslint-disable-next-line @next/next/no-img-element -- 旧站天气背景图。 */}
        <img className="night" src={`${WEATHER_SPRITES}city-night.jpg`} alt="" />
      </div>
      <div className="shell wx-in">
        <header className="wx-head">
          <div className="wx-town">
            <h1 id="wx-h" className="wx-city">
              {city.city}
            </h1>
            <p className="wx-clock">
              <span id="wx-time">{clock}</span>
            </p>
          </div>
          <form className="wx-find" id="wx-find" role="search" onSubmit={onSearch}>
            <label className="sr-only" htmlFor="wx-q">
              搜索城市
            </label>
            <input
              id="wx-q"
              type="search"
              placeholder="换个城市：上海 / Osaka"
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button className="btn" type="submit">
              <span>搜索</span>
            </button>
            <button className="btn red" type="button" id="wx-geo" onClick={onLocate}>
              <span>定位</span>
            </button>
          </form>
        </header>
        <p className={`wx-msg${bad ? " bad" : ""}`} id="wx-msg" role="status" hidden={!message}>
          {message}
        </p>
        <div className="wx-today" id="wx-today">
          <div className="db" aria-hidden="true">
            <div className="dbi">
              <div className="sp-mo">
                <Stack cls="mo" />
              </div>
              <div className="sp-d t">
                <Stack cls="dg" />
              </div>
              <div className="sp-d o">
                <Stack cls="dg" />
              </div>
              <i className="sp-wd" />
              <i className="sp-card" />
              <i className="sp-wx" />
            </div>
          </div>
          <div className="cur-col">
            <div className="cur" aria-hidden="true">
              <i className="cur-bg" />
              <i className="c s" />
              <i className="c t" />
              <i className="c o" />
              <i className="c dot" />
              <i className="c f" />
              <i className="c deg" />
            </div>
            <div className="mmx" aria-hidden="true">
              <i className="mm-bg" />
              <span className="mm hi">
                <i className="s" />
                <i className="t" />
                <i className="o" />
                <i className="deg" />
              </span>
              <span className="mm lo">
                <i className="s" />
                <i className="t" />
                <i className="o" />
                <i className="deg" />
              </span>
            </div>
          </div>
        </div>
        <p className="sr-only" id="wx-sr">
          {snapshot ? screenReaderText(snapshot) : ""}
        </p>
        <ol className="wx-week" id="wx-week" aria-label="未来四天">
          {[0, 1, 2, 3].map((index) => (
            <li className="wk" key={index}>
              <div className="db" aria-hidden="true">
                <div className="dbi">
                  <div className="sp-d t">
                    <Stack cls="dg" />
                  </div>
                  <div className="sp-d o">
                    <Stack cls="dg" />
                  </div>
                  <i className="sp-wd" />
                  <i className="sp-card" />
                  <i className="sp-wx" />
                </div>
              </div>
              <div className="mmx" aria-hidden="true">
                <i className="mm-bg" />
                <span className="mm hi">
                  <i className="s" />
                  <i className="t" />
                  <i className="o" />
                  <i className="deg" />
                </span>
                <span className="mm lo">
                  <i className="s" />
                  <i className="t" />
                  <i className="o" />
                  <i className="deg" />
                </span>
              </div>
              <span className="wk-cn" />
            </li>
          ))}
        </ol>
        <p className="wx-src">
          数据：Open-Meteo（每 30 分钟刷新） · 天气精灵图 ©ATLUS，界面移植自 caffi-nate / Persona5-Weather-Forecast
        </p>
      </div>
    </section>
  );
}
