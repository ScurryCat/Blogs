"use client";

/**
 * 桌面底部的迷你播放器（v2 任务书 §3.2）。
 *
 * - 收起态：曲名、播放状态、基础播放控制（上一首 / 播放暂停 / 下一首）；
 * - 点击信息区展开：曲目列表、播放进度、音量，以及**明确的收起按钮**；
 * - 数据全部来自既有的 `AudioService`（全站唯一 `<audio>`）：进入 App、返回桌面、
 *   展开独立页面都不打断播放，这里只是遥控器；**不新增播放模式**；
 * - 无曲目 / 音频不可用 / 尚未取得时长都有明确状态，不显示「看起来能用但没反应」的控制；
 * - 进度与音量用**原生 `<input type="range">`**：拖动、键盘、触控都由浏览器提供，
 *   不需要像斜屏滑杆那样做变换感知（这一层是平铺的固定定位层）；
 * - 聊天正文区不放常驻音乐面板 —— 本组件固定在视口底部，与内容区分离。
 */

import { useState, type ChangeEvent, type ReactNode } from "react";

import { tracks } from "@/features/legacy/music";
import { useAudioOrDefault, useAudioSnapshot } from "@/features/runtime/audio/audio-service";
import { useSoundEnabled } from "@/features/runtime/audio/audio-service";

const format = (seconds: number): string =>
  Number.isFinite(seconds) && seconds >= 0
    ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`
    : "--:--";

/** 进度条用 0..1000 的整数刻度，避免浮点抖动导致受控组件回弹。 */
const PROGRESS_STEPS = 1000;

export function MiniPlayer(): ReactNode {
  const audio = useAudioOrDefault();
  const snapshot = useAudioSnapshot();
  const soundEnabled = useSoundEnabled();
  const [expanded, setExpanded] = useState(false);

  const empty = snapshot.empty;
  const unavailable = snapshot.unavailable;
  const usable = !empty && !unavailable;
  const hasDuration = Number.isFinite(snapshot.duration) && snapshot.duration > 0;
  const progress = hasDuration ? Math.round((snapshot.currentTime / snapshot.duration) * PROGRESS_STEPS) : 0;

  const status = empty ? "无曲目" : unavailable ? "音频不可用" : snapshot.playing ? "播放中" : "已暂停";

  const onSeek = (event: ChangeEvent<HTMLInputElement>) => {
    if (!hasDuration) return;
    audio.seek(Number(event.target.value) / PROGRESS_STEPS);
  };
  const onVolume = (event: ChangeEvent<HTMLInputElement>) => {
    audio.setVolume(Number(event.target.value) / 100);
  };

  return (
    <section
      className={`mini${expanded ? " mini--open" : ""}`}
      aria-label="音乐播放器"
      data-mini-player
      data-state={empty ? "empty" : unavailable ? "unavailable" : "ready"}
    >
      {expanded ? (
        <div className="mini-panel" id="mini-panel">
          <div className="mini-panel-head">
            <p className="mini-kick">PLAYLIST</p>
            <button
              className="mini-collapse"
              type="button"
              aria-label="收起播放器"
              onClick={() => setExpanded(false)}
            >
              收起 ▾
            </button>
          </div>

          {usable ? (
            <ol className="mini-list">
              {tracks.map((track, index) => (
                <li key={track.src}>
                  <button
                    type="button"
                    className={`mini-item${index === snapshot.index ? " on" : ""}`}
                    aria-current={index === snapshot.index ? "true" : undefined}
                    onClick={() => audio.select(index)}
                  >
                    <span className="mini-item-i" aria-hidden="true">
                      {index === snapshot.index && snapshot.playing ? "▶" : String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="mini-item-t">
                      {track.title}
                      <em>{track.artist}</em>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          ) : null}

          <label className="mini-slider">
            <span className="mini-slider-l">进度</span>
            <input
              type="range"
              min={0}
              max={PROGRESS_STEPS}
              step={1}
              value={progress}
              disabled={!hasDuration}
              aria-label="播放进度"
              onChange={onSeek}
            />
            <span className="mini-slider-v">
              {/* 还没取得时长（0 / NaN）时明确显示 --:--，不写 0:00 误导成「已到开头」 */}
              {format(snapshot.currentTime)} / {hasDuration ? format(snapshot.duration) : "--:--"}
            </span>
          </label>

          <label className="mini-slider">
            <span className="mini-slider-l">音量</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(snapshot.volume * 100)}
              aria-label="音量"
              onChange={onVolume}
            />
            <span className="mini-slider-v">{Math.round(snapshot.volume * 100)}</span>
          </label>

          <p className="mini-hint" role="status">
            {empty
              ? "还没有曲子：把音频放进 assets/music/ 并写进曲目清单。"
              : unavailable
                ? "曲目清单有内容，但音频取不到（检查 /assets/music/ 是否可访问）。"
                : hasDuration
                  ? `音效 ${soundEnabled ? "开" : "关"} · 共 ${snapshot.count} 首`
                  : "还没有取得时长，进度暂不可拖。"}
          </p>
        </div>
      ) : null}

      <div className="mini-bar">
        <button
          className="mini-open"
          type="button"
          aria-expanded={expanded}
          aria-controls="mini-panel"
          onClick={() => setExpanded((value) => !value)}
        >
          <span className="mini-note" aria-hidden="true">
            ♪
          </span>
          <span className="mini-title">{empty || unavailable ? status : snapshot.title}</span>
          <span className="mini-artist">
            {empty || unavailable ? (empty ? "等待曲目" : "检查音频路径") : snapshot.artist}
          </span>
          <span className={`mini-state${snapshot.playing ? " on" : ""}`}>{status}</span>
        </button>

        <div className="mini-ctl">
          <button
            className="mini-btn"
            type="button"
            aria-label="上一首"
            disabled={!usable}
            onClick={() => audio.previous()}
          >
            ◀◀
          </button>
          <button
            className="mini-btn play"
            type="button"
            aria-label={snapshot.playing ? "暂停" : "播放"}
            disabled={!usable}
            onClick={() => audio.toggle()}
          >
            {snapshot.playing ? "❚❚" : "▶"}
          </button>
          <button
            className="mini-btn"
            type="button"
            aria-label="下一首"
            disabled={!usable}
            onClick={() => audio.next()}
          >
            ▶▶
          </button>
        </div>
      </div>
    </section>
  );
}
