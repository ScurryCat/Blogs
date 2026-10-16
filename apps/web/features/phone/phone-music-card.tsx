"use client";

/**
 * 手机里的音乐卡片与滑块。
 *
 * 音乐本身由 `AudioService`（根布局里的唯一 `<audio>`）持有：**打开 / 关闭手机、
 * 切换应用、跨站内路由都不会停止音乐**，这里只是它的一个遥控器。
 * 滑块用 pointer capture，卸载即随元素消失，不挂全局监听。
 */

import { useRef, type PointerEvent as ReactPointerEvent, type KeyboardEvent, type ReactNode } from "react";

import { useAudioOrDefault, useAudioSnapshot } from "@/features/runtime/audio/audio-service";

const format = (seconds: number): string =>
  Number.isFinite(seconds) && seconds >= 0
    ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`
    : "0:00";

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
  const ref = useRef<HTMLDivElement | null>(null);
  const ratio = Math.min(1, Math.max(0, value));

  const set = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || !rect.width) return;
    onScrub((clientX - rect.left) / rect.width);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    set(event.clientX);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    set(event.clientX);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const delta = { ArrowLeft: -0.05, ArrowRight: 0.05, ArrowDown: -0.05, ArrowUp: 0.05 }[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    onScrub(ratio + delta);
  };

  return (
    <div
      ref={ref}
      className={`pw-bar${label === "音量" ? " vol" : ""}`}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(ratio * 100)}
      aria-disabled={disabled || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onKeyDown={onKeyDown}
    >
      <i style={{ width: `${ratio * 100}%` }} />
      <span className="knob" style={{ left: `calc(${ratio * 100}% - 3px)` }} />
    </div>
  );
}

export function PhoneMusicCard(): ReactNode {
  const audio = useAudioOrDefault();
  const snapshot = useAudioSnapshot();
  const disabled = snapshot.empty || snapshot.unavailable;

  return (
    <section
      className={`pw-music${disabled ? " pw-empty" : ""}`}
      aria-label="音乐播放器"
      data-music-state={snapshot.empty ? "empty" : snapshot.unavailable ? "unavailable" : "ready"}
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
