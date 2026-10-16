"use client";

/**
 * 东京地图 —— 旧站 `assets/js/map.js` 的 React 迁移。
 *
 * **过场来源是这里的重点**：地图 SVG 地点图标、卡片右侧「出发」、下方地点列表
 * 三个入口统一使用 `source="map-travel"`（车站人群），顶部导航仍是 Joker 帷幕，
 * 不因为「当前在地图页」就把所有入口都当人群（地图转场设计的硬性要求）。
 *
 * 其余行为按原样保留：25 个地点（未配置目的地的显示为未开放、不进列表）、
 * 悬停 / Tab / 方向键选中、红色菱形 + 青色方框的抖动光标、右侧档案卡。
 *
 * 迁移差别：光标 rAF 只在有选中项时运行，卸载即取消；旧站那两处靠
 * `PL.onLeave` 手动清理的全局 keydown 与动画在这里随组件卸载一起消失。
 */

import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";

import {
  DEFAULT_LOCATION_ID,
  MAP_SRC,
  MAP_VIEWBOX,
  locationImage,
  locationLabel,
  locationLabelAlt,
  mapLocations,
  openLocations,
  type MapLocation,
} from "@/features/legacy/map";
import { prefersReducedMotion } from "@/features/runtime/effects/crowd";
import { navigationRequestFromClick } from "@/features/runtime/navigation/link-guard";
import { useNavigation } from "@/features/runtime/navigation/coordinator";
import { SiteLink } from "@/features/runtime/navigation/site-link";

/**
 * 地图 SVG 里的 `<a>`（`SVGAElement`）——与 `SiteLink` **共用同一套点击判定**，
 * 避免「图标用人群、列表用别的」这类按元素类型分裂出来的行为差异。
 * 类型上不能复用 HTML 锚点组件，所以这里显式写 SVG 命名空间的 `<a>`。
 */
function SvgSiteLink({
  href,
  source,
  children,
  ...rest
}: {
  href: string;
  source: "map-travel";
  children: ReactNode;
  className?: string;
  "data-id"?: number;
  "aria-label"?: string;
  onMouseEnter?: () => void;
  onFocus?: () => void;
}): ReactNode {
  const navigation = useNavigation();
  // React 在运行时按父级命名空间创建 SVG <a>，但 JSX 的类型仍然按 HTML 锚点推导；
  // 这里沿用 HTML 锚点的事件类型，判定函数只读 getAttribute / hasAttribute，两者同形。
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    const request = navigationRequestFromClick(event, event.currentTarget, href, source);
    if (!request) return;
    event.preventDefault();
    navigation.navigate(request);
  };
  return (
    <a href={href} onClick={onClick} {...rest}>
      {children}
    </a>
  );
}

interface Point {
  x: number;
  y: number;
}

interface CursorState {
  red: { from: Point[]; to: Point[]; t0: number; dur: number };
  blue: { from: Point[]; to: Point[]; t0: number; dur: number };
}

const ease = (t: number) => t * (2 - t);
const toPoints = (points: Point[]) => points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");

function jitter(points: Point[]): Point[] {
  return points.map((point) => ({
    x: point.x + Math.random() * 34 - 17,
    y: point.y + Math.random() * 15 - 7.5,
  }));
}

function cursorFor(location: MapLocation): CursorState {
  const { lx: x, ly: y, lw: w, lh: h } = location;
  const ox = x - 17;
  const oy = y - 7.5;
  const red: Point[] = [
    { x: ox, y: oy + h / 2 },
    { x: ox + w / 2, y: oy },
    { x: ox + w * 1.2, y: oy + h / 2 },
    { x: ox + w / 1.05, y: oy + h * 1.4 },
  ];
  const blue: Point[] = [
    { x: ox + 25, y: oy + h + 3 },
    { x: ox + w + 20, y: oy + h },
    { x: ox + w + 25, y: oy + 10 },
    { x: ox + 25, y: oy },
  ];
  return {
    red: { from: jitter(red), to: jitter(red), t0: performance.now(), dur: 200 },
    blue: { from: jitter(blue), to: jitter(blue), t0: performance.now(), dur: 250 },
  };
}

export function MapView(): ReactNode {
  const [selectedId, setSelectedId] = useState<number>(DEFAULT_LOCATION_ID);
  const cursor = useRef<CursorState | null>(null);
  const redRef = useRef<SVGPolygonElement | null>(null);
  const blueRef = useRef<SVGPolygonElement | null>(null);
  const raf = useRef(0);
  const selected = useMemo(
    () => mapLocations.find((location) => location.id === selectedId) ?? null,
    [selectedId],
  );

  const select = (id: number, focus: boolean) => {
    const location = mapLocations.find((item) => item.id === id);
    if (!location || !location.to) return;
    setSelectedId(id);
    if (focus) {
      // 键盘选中后把焦点移到对应的地点链接上：下一帧查 DOM 更稳（React 刚提交完）。
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`.mp-svg .loc.on`)?.focus({ preventScroll: true });
      });
    }
  };

  // 方向键：在可前往的地点之间按空间方向跳。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[
        event.key
      ];
      if (!direction) return;
      const element = document.activeElement;
      if (element instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(element.tagName)) return;
      event.preventDefault();
      const current = mapLocations.find((location) => location.id === selectedId);
      if (!current) return;
      const [dx0, dy0] = [current.lx + current.lw / 2, current.ly + current.lh / 2];
      let best: MapLocation | null = null;
      let bestScore = Number.POSITIVE_INFINITY;
      for (const location of openLocations) {
        if (location.id === current.id) continue;
        const dx = location.lx + location.lw / 2 - dx0;
        const dy = location.ly + location.lh / 2 - dy0;
        const along = dx * (direction[0] ?? 0) + dy * (direction[1] ?? 0);
        if (along <= 0) continue;
        const score = along + 2.2 * Math.abs(dx * (direction[1] ?? 0) + dy * (direction[0] ?? 0));
        if (score < bestScore) {
          bestScore = score;
          best = location;
        }
      }
      if (best) select(best.id, true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // select 依赖当前选中项，用 selectedId 触发重建即可（select 每次渲染都是新函数）。
  }, [selectedId]);

  // 选中光标：每个角在 34×15 的小框里随机找下一个点，平滑过去。
  useEffect(() => {
    if (!selected || prefersReducedMotion()) return;
    cursor.current = cursorFor(selected);
    if (redRef.current) redRef.current.setAttribute("points", toPoints(cursor.current.red.from));
    if (blueRef.current) blueRef.current.setAttribute("points", toPoints(cursor.current.blue.from));

    const step = (now: number) => {
      const state = cursor.current;
      if (!state) return;
      for (const [key, element] of [
        ["red", redRef.current],
        ["blue", blueRef.current],
      ] as const) {
        if (!element) continue;
        const lane = state[key];
        let t = (now - lane.t0) / lane.dur;
        if (t >= 1) {
          lane.from = lane.to;
          lane.to = jitter(lane.from);
          lane.t0 = now;
          t = 0;
        }
        const e = ease(t);
        element.setAttribute(
          "points",
          toPoints(lane.from.map((point, index) => ({
            x: point.x + ((lane.to[index]?.x ?? point.x) - point.x) * e,
            y: point.y + ((lane.to[index]?.y ?? point.y) - point.y) * e,
          }))),
        );
      }
      raf.current = window.requestAnimationFrame(step);
    };
    raf.current = window.requestAnimationFrame(step);
    return () => {
      window.cancelAnimationFrame(raf.current);
      raf.current = 0;
      cursor.current = null;
    };
  }, [selected]);

  const renderLocation = (location: MapLocation): ReactNode => {
    const sub = location.to ? (location.to.en ?? "POST") : "CLOSED";
    const body = (
      <>
        <image
          className="city"
          href={locationImage(location.id)}
          x={location.cx}
          y={location.cy}
          width={location.cw}
          height={location.ch}
          style={{ transformOrigin: `${location.cx + location.cw / 2}px ${location.cy + location.ch}px` }}
        />
        <g className="tag">
          <image
            className="tag-n"
            href={locationLabel(location.id)}
            x={location.lx}
            y={location.ly}
            width={location.lw}
            height={location.lh}
          />
          <image
            className="tag-on"
            href={locationLabelAlt(location.id)}
            x={location.lx}
            y={location.ly}
            width={location.lw}
            height={location.lh}
          />
          <text
            className="kj"
            x={location.kx}
            y={location.ky}
            transform={`rotate(${location.rot} ${location.kx} ${location.ky})`}
            style={{ fontSize: `${Math.min(24, (location.lw - 14) / [...location.kanji].length)}px` }}
          >
            {location.kanji}
          </text>
          <text
            className="en"
            x={location.ex}
            y={location.ey}
            transform={`rotate(${location.rot} ${location.ex} ${location.ey})`}
            textLength={Math.min(location.lw - 16, sub.length * 9)}
            lengthAdjust="spacingAndGlyphs"
          >
            {sub}
          </text>
        </g>
      </>
    );

    if (!location.to) {
      return (
        <g className="loc off" data-id={location.id} aria-hidden="true" key={location.id}>
          {body}
        </g>
      );
    }

    return (
      <SvgSiteLink
        className={`loc${selectedId === location.id ? " on" : ""}`}
        href={location.to.href}
        source="map-travel"
        data-id={location.id}
        aria-label={`${location.kanji}：${location.to.title}`}
        key={location.id}
        onMouseEnter={() => select(location.id, false)}
        onFocus={() => select(location.id, false)}
      >
        {body}
      </SvgSiteLink>
    );
  };

  const others = mapLocations.filter((location) => location.id !== selectedId);
  const destination = selected?.to ?? null;

  return (
    <section className="mp shell" aria-labelledby="mp-h">
      <header className="mp-head">
        <div>
          <p className="kick">{"// Tokyo · 选一个地方出发"}</p>
          <h1 className="mp-t" id="mp-h">
            Tokyo <span>Map</span>
          </h1>
        </div>
        <p className="mp-hint" aria-hidden="true">
          <kbd>←</kbd>
          <kbd>→</kbd> MOVE &nbsp; <kbd>ENTER</kbd> GO
        </p>
      </header>
      <div className="mp-g">
        <div className="mp-board">
          <svg
            className="mp-svg"
            viewBox={`0 0 ${MAP_VIEWBOX.width} ${MAP_VIEWBOX.height}`}
            role="group"
            aria-label={`东京地图：${openLocations.length} 个可前往的地点`}
          >
            <image href={MAP_SRC} x={0} y={0} width={1500} height={982} />
            {/* 顺序与旧站一致：其他地点 → 光标 → 选中的地点（选中项画在最上层）。 */}
            {others.map(renderLocation)}
            <polygon className="cur-b" points="" ref={blueRef} />
            <polygon className="cur-r" points="" ref={redRef} />
            {selected ? renderLocation(selected) : null}
          </svg>
        </div>
        <aside className="mp-card" aria-live="polite">
          {selected && destination ? (
            <>
              <p className="mp-c-k">
                <b>{selected.kanji}</b>
                <span>{selected.roma}</span>
              </p>
              {destination.cover ? (
                // eslint-disable-next-line @next/next/no-img-element -- 旧站封面资源。
                <img src={destination.cover} alt="" loading="lazy" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- 旧站地图插画。
                <img className="ill" src={locationImage(selected.id)} alt="" />
              )}
              <p className="kick">
                {destination.en || "POST"}
                {destination.date ? ` · ${destination.date}` : ""}
              </p>
              <h2>{destination.title}</h2>
              <p className="mp-c-n">{destination.note || ""}</p>
              {/* 右侧「出发」：同样是人群过场。 */}
              <SiteLink className="btn red" href={destination.href} source="map-travel">
                <span>出发 ▸</span>
              </SiteLink>
            </>
          ) : null}
        </aside>
      </div>
      <ul className="mp-list" aria-label="地点列表">
        {openLocations.map((location) => (
          <li key={location.id}>
            {/* 下方地点列表：同样是人群过场。 */}
            <SiteLink
              href={location.to?.href ?? "/map"}
              source="map-travel"
              data-id={location.id}
              onMouseEnter={() => select(location.id, false)}
            >
              <b>{location.kanji}</b>
              <span>{location.to?.title}</span>
            </SiteLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
