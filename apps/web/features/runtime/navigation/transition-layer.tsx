"use client";

/**
 * 转场层：渲染旧站的遮罩容器，并把它们接给共享导航协调器。
 *
 * 每一层对应任务书里的一种效果，**一次导航只播其中一套**（协调器决定）：
 *  - `.wipe` 是 CSS 三色斜切兜底（永远可用，不需要下载素材）；
 *  - `.crowd` 里挂地图人群 Canvas；
 *  - `.jk` 里挂《过场 joker 拉下帷幕》的矢量 Canvas；
 *  - `.isekai` 里挂「我的殿堂」异世界短版视频（VP9+alpha，1.5 秒；绿幕素材由
 *    `effects/isekai.ts` 做 alpha 校验与红闪降级）。
 *
 * 生命周期：效果对象只创建一次，卸载时 `destroy()`（移除画布 / 视频、取消 rAF）。
 * 旧站里那些跨页常驻的 `resize` / `pointerdown` / `keydown` 全局监听没有迁移过来：
 * 尺寸变化由每帧就地校正，预热由 React 的 effect 调度。
 *
 * 异世界短版的「跳过」：播放中显示 ≥44px 的按钮，并支持 Escape；两者都调用
 * `navigation.skip()`（立即提交目标，视觉由协调器统一退场）。按钮放在 `.isekai`
 * 容器**外面**，因为容器是 `aria-hidden` 的纯装饰层。
 */

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import { CrowdEffect, isCheapConnection, type CrowdWarmState } from "@/features/runtime/effects/crowd";
import {
  ISEKAI_WAIT_MS,
  IsekaiEffect,
  type IsekaiWarmState,
} from "@/features/runtime/effects/isekai";
import { JokerCurtainEffect } from "@/features/runtime/effects/joker-curtain";
import { useNavigation, type TransitionDriver } from "@/features/runtime/navigation/coordinator";

export interface TransitionHandle {
  driver: TransitionDriver;
  debug(): {
    crowd: { created: boolean; ready: boolean; playing: boolean; state: CrowdWarmState };
    joker: { created: boolean; ready: boolean; playing: boolean };
    isekai: { created: boolean; ready: boolean; playing: boolean; state: IsekaiWarmState };
  };
}

export function TransitionLayer({ onReady }: { onReady: (handle: TransitionHandle) => void }): ReactNode {
  const wipeRef = useRef<HTMLDivElement | null>(null);
  const crowdRef = useRef<HTMLDivElement | null>(null);
  const jokerRef = useRef<HTMLDivElement | null>(null);
  const isekaiHostRef = useRef<HTMLDivElement | null>(null);
  const isekaiSkipRef = useRef<HTMLButtonElement | null>(null);
  const crowd = useRef<CrowdEffect | null>(null);
  const joker = useRef<JokerCurtainEffect | null>(null);
  const isekai = useRef<IsekaiEffect | null>(null);
  const crowdPlaying = useRef(false);
  const jokerPlaying = useRef(false);
  const isekaiPlaying = useRef(false);
  const pathname = usePathname();
  const navigation = useNavigation();

  useEffect(() => {
    const crowdHost = crowdRef.current;
    const jokerHost = jokerRef.current;
    const isekaiHost = isekaiHostRef.current;
    if (!crowdHost || !jokerHost || !isekaiHost) return;
    const crowdEffect = new CrowdEffect(crowdHost);
    const jokerEffect = new JokerCurtainEffect(jokerHost);
    const isekaiEffect = new IsekaiEffect(isekaiHost);
    crowd.current = crowdEffect;
    joker.current = jokerEffect;
    isekai.current = isekaiEffect;

    /** 跳过按钮只在短版真正播放时出现；隐藏时 `display:none`，不进 Tab 序。 */
    const setSkipVisible = (visible: boolean) => {
      const button = isekaiSkipRef.current;
      if (!button) return;
      button.classList.toggle("is-on", visible);
    };

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
      hasIsekai: () => isekai.current !== null,
      isekaiReady: () => isekai.current?.ready() ?? false,
      playIsekai: () => {
        const played = isekai.current?.play() ?? false;
        isekaiPlaying.current = played;
        setSkipVisible(played);
        return played;
      },
      stopIsekai: () => {
        isekai.current?.stop();
        isekaiPlaying.current = false;
        setSkipVisible(false);
      },
      isekaiWait: () => isekai.current?.wait ?? ISEKAI_WAIT_MS,
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
        isekai: {
          created: isekai.current !== null,
          ready: isekai.current?.ready() ?? false,
          playing: isekaiPlaying.current,
          state: isekai.current?.state() ?? "not-warmed",
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

    // 异世界短版（约 242 KB）也在空闲时预热 —— 它服务全站任意入口，
    // 不像人群过场只服务地图页。省流量 / 2G 的判定在 `warm()` 内部。
    const warmIsekai = () => {
      isekai.current?.warm();
    };
    const idleIsekai =
      typeof window.requestIdleCallback === "function"
        ? window.requestIdleCallback(warmIsekai, { timeout: 2000 })
        : window.setTimeout(warmIsekai, 1600);
    // 空闲回调不一定触发（后台标签页 / 主线程被占满）：首次交互补一次。幂等。
    const warmOnFirstInteraction = () => warmIsekai();
    window.addEventListener("pointerdown", warmOnFirstInteraction, { once: true, capture: true });
    window.addEventListener("keydown", warmOnFirstInteraction, { once: true, capture: true });

    return () => {
      if (typeof window.cancelIdleCallback === "function") {
        if (typeof idle === "number") window.cancelIdleCallback(idle);
        if (typeof idleIsekai === "number") window.cancelIdleCallback(idleIsekai);
      } else {
        window.clearTimeout(idle as number);
        window.clearTimeout(idleIsekai as number);
      }
      window.removeEventListener("pointerdown", warmOnFirstInteraction, true);
      window.removeEventListener("keydown", warmOnFirstInteraction, true);
      crowdEffect.destroy();
      jokerEffect.destroy();
      isekaiEffect.destroy();
      crowd.current = null;
      joker.current = null;
      isekai.current = null;
      isekaiPlaying.current = false;
      onReady({ driver: NOOP_DRIVER, debug: () => NOOP_DEBUG });
    };
    // onReady 由 SiteRuntime 用 ref 稳定持有；这里只跑一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 短版播放中按 Escape = 跳过（而不是让 Escape 继续关下面的手机 / 弹层）：
  // 此刻过场是最上层视觉，先消费掉它，避免「页面已跳走、手机也同时被关」的叠加行为。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (!isekaiPlaying.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      navigation.skip();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [navigation]);

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
      <div className="isekai" ref={isekaiHostRef} aria-hidden="true" />
      <button
        ref={isekaiSkipRef}
        type="button"
        className="isekai-skip"
        aria-label="跳过殿堂过场"
        onClick={() => navigation.skip()}
      >
        跳过<span aria-hidden="true"> / SKIP</span>
      </button>
    </>
  );
}

export const NOOP_DEBUG = {
  crowd: { created: false, ready: false, playing: false, state: "not-warmed" as CrowdWarmState },
  joker: { created: false, ready: false, playing: false },
  isekai: { created: false, ready: false, playing: false, state: "not-warmed" as IsekaiWarmState },
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
  hasIsekai: () => false,
  isekaiReady: () => false,
  playIsekai: () => false,
  stopIsekai: () => undefined,
  isekaiWait: () => ISEKAI_WAIT_MS,
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
    hasIsekai: () => call((driver) => driver.hasIsekai(), false),
    isekaiReady: () => call((driver) => driver.isekaiReady(), false),
    playIsekai: () => call((driver) => driver.playIsekai(), false),
    stopIsekai: () => call((driver) => driver.stopIsekai(), undefined),
    isekaiWait: () => call((driver) => driver.isekaiWait(), ISEKAI_WAIT_MS),
  };
}
