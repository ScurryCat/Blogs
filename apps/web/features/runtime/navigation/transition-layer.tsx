"use client";

/**
 * 转场层：渲染旧站的三个遮罩容器，并把它们接给导航协调器。
 *
 * DOM 与类名沿用旧站（`chrome.css` 的 `.wipe` / `.crowd` / `.jk` 规则原样复用）：
 *  - `.wipe` 是 CSS 三色斜切兜底（永远可用，不需要下载素材）；
 *  - `.crowd` 里挂地图人群 Canvas；
 *  - `.jk` 里挂《过场 joker 拉下帷幕》的矢量 Canvas。
 *
 * 生命周期：效果对象只创建一次，卸载时 `destroy()`（移除画布、取消 rAF）。
 * 旧站里那些跨页常驻的 `resize` / `pointerdown` / `keydown` 全局监听没有迁移过来：
 * 尺寸变化由每帧就地校正，预热由 React 的 effect 调度。
 */

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import { CrowdEffect, isCheapConnection, type CrowdWarmState } from "@/features/runtime/effects/crowd";
import { JokerCurtainEffect } from "@/features/runtime/effects/joker-curtain";
import type { TransitionDriver } from "@/features/runtime/navigation/coordinator";

export interface TransitionHandle {
  driver: TransitionDriver;
  debug(): {
    crowd: { created: boolean; ready: boolean; playing: boolean; state: CrowdWarmState };
    joker: { created: boolean; ready: boolean; playing: boolean };
  };
}

export function TransitionLayer({ onReady }: { onReady: (handle: TransitionHandle) => void }): ReactNode {
  const wipeRef = useRef<HTMLDivElement | null>(null);
  const crowdRef = useRef<HTMLDivElement | null>(null);
  const jokerRef = useRef<HTMLDivElement | null>(null);
  const crowd = useRef<CrowdEffect | null>(null);
  const joker = useRef<JokerCurtainEffect | null>(null);
  const crowdPlaying = useRef(false);
  const jokerPlaying = useRef(false);
  const pathname = usePathname();

  useEffect(() => {
    const crowdHost = crowdRef.current;
    const jokerHost = jokerRef.current;
    if (!crowdHost || !jokerHost) return;
    const crowdEffect = new CrowdEffect(crowdHost);
    const jokerEffect = new JokerCurtainEffect(jokerHost);
    crowd.current = crowdEffect;
    joker.current = jokerEffect;

    const driver: TransitionDriver = {
      hasCrowd: () => crowd.current !== null,
      crowdReady: () => crowd.current?.ready() ?? false,
      playCrowd: () => {
        const played = crowd.current?.play() ?? false;
        crowdPlaying.current = played;
        return played;
      },
      stopCrowd: () => {
        crowd.current?.stop();
        crowdPlaying.current = false;
      },
      crowdWait: () => crowd.current?.wait ?? 900,
      hasJoker: () => joker.current !== null,
      jokerReady: () => joker.current?.ready() ?? false,
      playJoker: () => {
        const played = joker.current?.play() ?? false;
        jokerPlaying.current = played;
        return played;
      },
      stopJoker: () => {
        joker.current?.stop();
        jokerPlaying.current = false;
      },
      jokerWait: () => joker.current?.total ?? 1180,
      playWipe: () => wipeRef.current?.classList.add("go"),
      stopWipe: () => wipeRef.current?.classList.remove("go"),
    };

    onReady({
      driver,
      debug: () => ({
        crowd: {
          created: crowd.current !== null,
          ready: crowd.current?.ready() ?? false,
          playing: crowdPlaying.current,
          // 有意跳过（reduced-motion）与加载失败（failed）分开，便于排查。
          state: crowd.current?.state() ?? "not-warmed",
        },
        joker: {
          created: joker.current !== null,
          ready: joker.current?.ready() ?? false,
          playing: jokerPlaying.current,
        },
      }),
    });

    // 帷幕数据懒加载（32 KB）：先画页面，空闲时再取；失败则退回斜切。
    const warmJoker = () => {
      void joker.current?.warm();
    };
    const idle =
      typeof window.requestIdleCallback === "function"
        ? window.requestIdleCallback(warmJoker, { timeout: 2500 })
        : window.setTimeout(warmJoker, 2000);

    return () => {
      if (typeof window.cancelIdleCallback === "function" && typeof idle === "number") {
        window.cancelIdleCallback(idle);
      } else {
        window.clearTimeout(idle as number);
      }
      crowdEffect.destroy();
      jokerEffect.destroy();
      crowd.current = null;
      joker.current = null;
      onReady({ driver: NOOP_DRIVER, debug: () => NOOP_DEBUG });
    };
    // onReady 由 SiteRuntime 用 ref 稳定持有；这里只跑一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 只有地图页预热人群（旧站同样只在 map 页预热），避免其他页面白下 700 KB 素材。
  // 「减少动效」的判定在 `warm()` 内部（单一判据，状态会记成 reduced-motion）；
  // 这里只拦省流量 / 2G，并把原因登记下来，便于与「加载失败」区分。
  useEffect(() => {
    if (pathname !== "/map") return;
    if (!isCheapConnection()) {
      crowd.current?.markSkipped("slow-connection");
      return;
    }
    const warm = () => crowd.current?.warm();
    const idle =
      typeof window.requestIdleCallback === "function"
        ? window.requestIdleCallback(warm, { timeout: 2500 })
        : window.setTimeout(warm, 1200);
    return () => {
      if (typeof window.cancelIdleCallback === "function" && typeof idle === "number") {
        window.cancelIdleCallback(idle);
      } else {
        window.clearTimeout(idle as number);
      }
    };
  }, [pathname]);

  return (
    <>
      <div className="wipe" ref={wipeRef} aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div className="crowd" ref={crowdRef} aria-hidden="true" />
      <div className="jk" ref={jokerRef} aria-hidden="true" />
    </>
  );
}

export const NOOP_DEBUG = {
  crowd: { created: false, ready: false, playing: false, state: "not-warmed" as CrowdWarmState },
  joker: { created: false, ready: false, playing: false },
};

export const NOOP_DRIVER: TransitionDriver = {
  hasCrowd: () => false,
  crowdReady: () => false,
  playCrowd: () => false,
  stopCrowd: () => undefined,
  crowdWait: () => 900,
  hasJoker: () => false,
  jokerReady: () => false,
  playJoker: () => false,
  stopJoker: () => undefined,
  jokerWait: () => 1180,
  playWipe: () => undefined,
  stopWipe: () => undefined,
};

/**
 * 代理驱动：NavigationProvider 在渲染期就需要一个 driver，
 * 而真实效果对象是 TransitionLayer 挂载后才建好的。
 * 代理把调用转发给「当前句柄」，两个组件因此可以各自独立挂载。
 */
export function createProxyDriver(getHandle: () => TransitionHandle | null): TransitionDriver {
  const call = <T,>(read: (driver: TransitionDriver) => T, fallback: T): T => {
    const handle = getHandle();
    return handle ? read(handle.driver) : fallback;
  };
  return {
    hasCrowd: () => call((driver) => driver.hasCrowd(), false),
    crowdReady: () => call((driver) => driver.crowdReady(), false),
    playCrowd: () => call((driver) => driver.playCrowd(), false),
    stopCrowd: () => call((driver) => driver.stopCrowd(), undefined),
    crowdWait: () => call((driver) => driver.crowdWait(), 900),
    hasJoker: () => call((driver) => driver.hasJoker(), false),
    jokerReady: () => call((driver) => driver.jokerReady(), false),
    playJoker: () => call((driver) => driver.playJoker(), false),
    stopJoker: () => call((driver) => driver.stopJoker(), undefined),
    jokerWait: () => call((driver) => driver.jokerWait(), 1180),
    playWipe: () => call((driver) => driver.playWipe(), undefined),
    stopWipe: () => call((driver) => driver.stopWipe(), undefined),
  };
}
