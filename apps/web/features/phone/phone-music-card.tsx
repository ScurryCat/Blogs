"use client";

/**
 * 手机里的音乐卡片与滑块。
 *
 * 音乐本身由 `AudioService`（根布局里的唯一 `<audio>`）持有：**打开 / 关闭手机、
 * 切换应用、跨站内路由都不会停止音乐**，这里只是它的一个遥控器。
 *
 * ## 斜屏命中与取值（v2 任务书 §3.1）
 * 桌面端的手机屏幕被 `matrix3d` 透视贴到外壳斜面上（并叠加 `zoom`），
 * Chrome 对「矩阵形式变换」的命中测试不可靠：滑块的视觉包围盒两端会落到父容器上，
 * 事件根本到不了滑块，且「页面横坐标与滑块内部坐标线性一致」的假设在斜屏上不成立。
 *
 * 因此**指针命中与取值都不依赖 CSS 命中测试**，改为：
 *   1. 每条滑杆在左端 / 右端 / 顶部中点放三个零尺寸标记（继承全部变换）；
 *   2. 指针按下时在**卡片级委托**判断落在哪条滑杆的视觉四边形内；
 *   3. 移动时把指针投影到「两端标记连线」上取 0..1 比例 —— 任意仿射/透视 + zoom
 *      组合下都精确（几何全部来自 `getBoundingClientRect` 实测）。
 * 键盘操作仍走滑杆自身的箭头键（±0.05），不经过指针，天然无斜屏问题。
 */

import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { useAudioOrDefault, useAudioSnapshot } from "@/features/runtime/audio/audio-service";

const format = (seconds: number): string =>
  Number.isFinite(seconds) && seconds >= 0
    ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`
    : "0:00";

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

function ScrubBar({
  value,
  label,
  onScrub,
  disabled,
}: {
  value: number;
  label: string;
  onScrub: (fraction: number) => void;
  disabled: boolean;
}): ReactNode {
  const ratio = Math.min(1, Math.max(0, value));

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const delta = { ArrowLeft: -0.05, ArrowRight: 0.05, ArrowDown: -0.05, ArrowUp: 0.05 }[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    onScrub(clamp01(ratio + delta));
  };

  return (
    <div
      className={`pw-bar${label === "音量" ? " vol" : ""}`}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(ratio * 100)}
      aria-disabled={disabled || undefined}
      onKeyDown={onKeyDown}
    >
      <i style={{ width: `${ratio * 100}%` }} />
      <span className="knob" style={{ left: `calc(${ratio * 100}% - 3px)` }} />
      {/* 变换感知的轴端点与顶中点：零尺寸、绝对定位、不可命中 */}
      <span data-pw-axis="left" className="pw-axis" style={{ left: 0, top: "50%" }} aria-hidden="true" />
      <span data-pw-axis="right" className="pw-axis" style={{ right: 0, top: "50%" }} aria-hidden="true" />
      <span data-pw-axis="top" className="pw-axis" style={{ left: "50%", top: 0 }} aria-hidden="true" />
    </div>
  );
}

/** 由三个标记的视觉位置求指针在条内的局部坐标（x 横向、y 纵向，均以条自身为单位）。 */
function localPointOf(
  left: DOMRect,
  right: DOMRect,
  top: DOMRect,
  clientX: number,
  clientY: number,
): { x: number; y: number } | null {
  const ux = right.left - left.left;
  const uy = right.top - left.top;
  const uLen2 = ux * ux + uy * uy;
  if (uLen2 < 1) return null;
  const mx = (left.left + right.left) / 2;
  const my = (left.top + right.top) / 2;
  // 高度向量正交化：条的 skewX 让「轴向」与「高度向」不垂直，直接投影会把端点
  // 的 y 算到 1.4+ 而被容差拒掉（实测）。去掉 v 沿 u 的分量后才是真·垂直高度。
  const vx = top.left - mx;
  const vy = top.top - my;
  const alongU = (vx * ux + vy * uy) / uLen2;
  const ox = vx - alongU * ux;
  const oy = vy - alongU * uy;
  const oLen2 = ox * ox + oy * oy;
  if (oLen2 < 1) return null;
  const px = clientX - left.left;
  const py = clientY - left.top;
  const x = (px * ux + py * uy) / uLen2;
  const pmx = clientX - mx;
  const pmy = clientY - my;
  const y = 0.5 - (pmx * ox + pmy * oy) / (2 * oLen2);
  return { x, y };
}

export function PhoneMusicCard(): ReactNode {
  const audio = useAudioOrDefault();
  const snapshot = useAudioSnapshot();
  const disabled = snapshot.empty || snapshot.unavailable;

  const cardRef = useRef<HTMLElement | null>(null);

  const [activeBar, setActiveBar] = useState<"progress" | "volume" | null>(null);

  /** 从容器里查对应滑杆的三个轴标记（避免在渲染期持有 ref 回调）。 */
  const axisOf = useCallback((kind: "progress" | "volume") => {
    const card = cardRef.current;
    if (!card) return { left: null, right: null, top: null };
    const bar = card.querySelector(kind === "progress" ? ".pw-bar:not(.vol)" : ".pw-bar.vol");
    if (!bar) return { left: null, right: null, top: null };
    return {
      left: bar.querySelector<HTMLSpanElement>('[data-pw-axis="left"]'),
      right: bar.querySelector<HTMLSpanElement>('[data-pw-axis="right"]'),
      top: bar.querySelector<HTMLSpanElement>('[data-pw-axis="top"]'),
    };
  }, []);

  /** 指针落在哪条滑杆上（y 放宽 ±0.3 容错手指）；都不中返回 null。 */
  const findBarAt = useCallback(
    (clientX: number, clientY: number): "progress" | "volume" | null => {
      for (const kind of ["progress", "volume"] as const) {
        const axis = axisOf(kind);
        if (!axis.left || !axis.right || !axis.top) continue;
        const point = localPointOf(
          axis.left.getBoundingClientRect(),
          axis.right.getBoundingClientRect(),
          axis.top.getBoundingClientRect(),
          clientX,
          clientY,
        );
        if (point && point.x >= 0 && point.x <= 1 && point.y >= -0.3 && point.y <= 1.3) return kind;
      }
      return null;
    },
    [axisOf],
  );

  const applyBar = useCallback(
    (kind: "progress" | "volume", clientX: number, clientY: number) => {
      if (kind === "progress" && disabled) return;
      const axis = axisOf(kind);
      if (!axis.left || !axis.right || !axis.top) return;
      const point = localPointOf(
        axis.left.getBoundingClientRect(),
        axis.right.getBoundingClientRect(),
        axis.top.getBoundingClientRect(),
        clientX,
        clientY,
      );
      if (!point) return;
      const fraction = clamp01(point.x);
      if (kind === "progress") audio.seek(fraction);
      else audio.setVolume(fraction);
    },
    [axisOf, audio, disabled],
  );

  const onPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    const kind = findBarAt(event.clientX, event.clientY);
    if (!kind) return;
    if (kind === "progress" && disabled) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setActiveBar(kind);
    applyBar(kind, event.clientX, event.clientY);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (!activeBar || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    applyBar(activeBar, event.clientX, event.clientY);
  };
  const onPointerUp = () => setActiveBar(null);

  return (
    <section
      ref={cardRef}
      className={`pw-music${disabled ? " pw-empty" : ""}`}
      aria-label="音乐播放器"
      data-music-state={snapshot.empty ? "empty" : snapshot.unavailable ? "unavailable" : "ready"}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <p className="pw-kick">NOW PLAYING</p>
      <h2 className="pw-title">{snapshot.title}</h2>
      <p className="pw-artist">{snapshot.artist}</p>
      <ScrubBar
        value={snapshot.duration ? snapshot.currentTime / snapshot.duration : 0}
        label="播放进度"
        disabled={disabled}
        onScrub={(fraction) => audio.seek(fraction)}
      />
      <div className="pw-row">
        <span className="pw-time">
          {format(snapshot.currentTime)} / {format(snapshot.duration)}
        </span>
        <span className="pw-idx">{snapshot.count ? `${snapshot.index + 1} / ${snapshot.count}` : ""}</span>
      </div>
      <div className="pw-ctl">
        <button
          className="pw-btn"
          type="button"
          aria-label="上一首"
          disabled={disabled}
          onClick={() => audio.previous()}
        >
          ◀◀
        </button>
        <button
          className="pw-btn play"
          type="button"
          aria-label={snapshot.playing ? "暂停" : "播放"}
          disabled={disabled}
          onClick={() => audio.toggle()}
        >
          {snapshot.playing ? "❚❚" : "▶"}
        </button>
        <button
          className="pw-btn"
          type="button"
          aria-label="下一首"
          disabled={disabled}
          onClick={() => audio.next()}
        >
          ▶▶
        </button>
        <span className="pw-lab" aria-hidden="true">
          VOL
        </span>
      </div>
      <ScrubBar
        value={snapshot.volume}
        label="音量"
        disabled={false}
        onScrub={(fraction) => audio.setVolume(fraction)}
      />
    </section>
  );
}
