"use client";

/**
 * 导航协调器（01 §4、02 §8、地图转场设计）。
 *
 * 统一接收「目的地 + 来源」，**不按当前 URL 猜动画**：
 *
 * | 来源 | 结果 |
 * | --- | --- |
 * | `top-nav` | Joker 帷幕 |
 * | `map-travel` | 车站人群；地图图标、右侧出发、下方地点列表统一 |
 * | `phone-internal` | App 内短过渡，不遮盖全站（不经过本协调器的全屏层） |
 * | `phone-link` | 普通站点跳转，默认 Joker |
 * | `metaverse-entry` | 专用认知过渡；**素材缺失时正常降级，不用人群** |
 *
 * 硬性规则：
 *  - 每次导航持有**唯一令牌**；连点不启动第二套动画，后退取消旧任务；
 *  - **`router.push()` 不能当作可等待的 Promise**：完成信号来自目标路由提交
 *    （`usePathname()` 变化），不是 `await push()`；
 *  - 15 秒最终看门狗：超时移除遮罩、整页降级到目标地址，**不永久黑屏**；
 *  - 减少动态效果时直接导航，不播人群、不延时；
 *  - 历史前进后退、刷新、新标签页不重播过场（`popstate` / `pageshow` 取消）；
 *  - 所有实际链接保留正确 `href`；Ctrl / Cmd 点击、中键、新标签页不经过过场。
 */

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

import type {
  NavigationIntent,
  NavigationRequest,
  NavigationSource,
  PhoneUrlState,
} from "@/features/phone/types";
import { parsePhoneState } from "@/features/phone/url-state";
import { CROWD_WAIT_MS } from "@/features/runtime/effects/crowd";
import { prefersReducedMotion } from "@/features/runtime/effects/crowd";
import { showcaseEntryIntent } from "@/features/runtime/navigation/showcase-boundary";

/** 最终看门狗：沿用旧站 15 秒迁移基线。 */
export const NAVIGATION_WATCHDOG_MS = 15_000;
/** CSS 斜切兜底时长（旧站 440ms）。 */
export const WIPE_WAIT_MS = 440;
/** 异世界短过场默认目标 1.5 秒（任务书 §6.3：每次 1–2 秒，不能用整段 9/11 秒视频等待）。 */
export const ISEKAI_WAIT_MS = 1_500;
/** 短版时长合法区间：短于 1 秒会闪、长于 2 秒违背「短过场」要求。 */
export const ISEKAI_MIN_MS = 1_000;
export const ISEKAI_MAX_MS = 2_000;

export type TransitionKind = "crowd" | "joker" | "wipe" | "isekai" | "none";

export interface TransitionDebug {
  navigating: boolean;
  source: NavigationSource | null;
  /** 本次导航的显式/推导意图；普通导航为 null。 */
  intent: NavigationIntent | null;
  kind: TransitionKind;
  token: number;
  pendingPath: string | null;
  cancels: number;
}

/** 由 SiteRuntime 提供的实际效果开关；协调器只做决策，不自己碰 canvas。 */
export interface TransitionDriver {
  hasCrowd(): boolean;
  crowdReady(): boolean;
  playCrowd(): boolean;
  stopCrowd(): void;
  crowdWait(): number;
  hasJoker(): boolean;
  jokerReady(): boolean;
  playJoker(): boolean;
  stopJoker(): void;
  jokerWait(): number;
  playWipe(): void;
  stopWipe(): void;
  /**
   * 异世界短过场（任务书 §6.3）。素材未就绪 / 解码失败时 `isekaiReady()` 返回 false，
   * 协调器按优先级退回斜切兜底并继续进入，不留下黑屏遮罩。
   */
  hasIsekai(): boolean;
  isekaiReady(): boolean;
  playIsekai(): boolean;
  stopIsekai(): void;
  /** 短版实际时长（毫秒）；协调器会夹到 1–2 秒区间。 */
  isekaiWait(): number;
}

export interface NavigationCoordinator {
  /** 带过场的站内导航。 */
  navigate(request: NavigationRequest): void;
  /** 不带过场的 URL 更新（手机 `phone` / `screen` / `item`），保持 href 与历史正确。 */
  updateUrl(destination: string, options?: { replace?: boolean }): void;
  /**
   * 手机目标提交信号：目标 App / screen / item 已提交到 URL（`pathname` 可能没变）。
   * 手机宿主在手机状态落定后调用；只有与本次导航的期望目标一致时才结束过场。
   * 页面路由导航不需要调用它 —— 那边由 `usePathname()` 变化结束。
   */
  commitPhoneTarget(state: PhoneUrlState | null): void;
  /**
   * 跳过当前过场：立即提交本次导航的目标地址，视觉在完成信号后统一收起。
   * 没有进行中的导航时是 no-op。任务书 §6.3「提供可用的跳过操作」。
   */
  skip(): void;
  navigating(): boolean;
  debug(): TransitionDebug;
}

const NavigationContext = createContext<NavigationCoordinator | null>(null);

/**
 * 纯函数：来源 + 意图 → 效果优先级（可单测，不依赖 DOM）。
 *
 * 任务书 §6.2 的效果优先级：
 *  1. 减少动态效果 → 由调用方直接提交（不经过这里）；
 *  2. 明确主动进入殿堂 → 异世界短版（素材未就绪时斜切兜底，**绝不串播**人群/Joker）；
 *  3. 其余 → 既有来源规则。
 */
export function effectPlan(
  source: NavigationSource,
  driver: Pick<
    TransitionDriver,
    "crowdReady" | "hasCrowd" | "hasJoker" | "jokerReady" | "hasIsekai" | "isekaiReady"
  >,
  intent?: NavigationIntent,
): TransitionKind[] {
  if (intent === "enter-showcase") {
    return driver.hasIsekai() && driver.isekaiReady() ? ["isekai", "wipe"] : ["wipe"];
  }
  switch (source) {
    case "map-travel":
      // 人群优先；素材缺失或被减动效时退回 Joker 帷幕，**绝不改用文章的潜入动画**。
      return driver.hasCrowd() && driver.crowdReady() ? ["crowd", "joker", "wipe"] : ["joker", "wipe"];
    case "metaverse-entry":
      // 专用认知过渡的素材尚未提供：**正常降级为斜切兜底**，明确不使用人群。
      return driver.hasJoker() && driver.jokerReady() ? ["joker", "wipe"] : ["wipe"];
    case "top-nav":
    case "phone-link":
      return driver.hasJoker() && driver.jokerReady() ? ["joker", "wipe"] : ["wipe"];
    case "phone-internal":
      // App 内短过渡由手机宿主自己做，不遮盖全站。
      return ["none"];
    default:
      return ["wipe"];
  }
}

export function waitForEffect(kind: TransitionKind, driver: TransitionDriver): number {
  if (kind === "crowd") return driver.crowdWait() || CROWD_WAIT_MS;
  if (kind === "joker") return driver.jokerWait();
  if (kind === "wipe") return WIPE_WAIT_MS;
  if (kind === "isekai") {
    const reported = driver.isekaiWait();
    if (!Number.isFinite(reported) || reported <= 0) return ISEKAI_WAIT_MS;
    return Math.min(ISEKAI_MAX_MS, Math.max(ISEKAI_MIN_MS, reported));
  }
  return 0;
}

export function NavigationProvider({
  children,
  driver,
  /** 测试可注入的导航与路径读取；默认用 Next 的 router / pathname。 */
  adapter,
}: {
  children: ReactNode;
  driver: TransitionDriver;
  adapter?: {
    push: (destination: string, options?: { replace?: boolean }) => void;
    /** 看门狗降级时的整页跳转；默认 `window.location.assign`。 */
    assign?: (url: string) => void;
    pathname: string;
  };
}): ReactNode {
  const router = useRouter();
  const nextPathname = usePathname();
  const pathname = adapter?.pathname ?? nextPathname;

  const tokenRef = useRef(0);
  const navigatingRef = useRef(false);
  const pendingRef = useRef<{
    token: number;
    path: string;
    search: string;
    /** 本次导航要提交的完整站内地址（跳过时立即提交它）。 */
    destination: string;
    kind: TransitionKind;
    /** 手机目标导航的期望状态（pathname 不变，靠宿主提交信号结束）；普通导航为 null。 */
    phone: PhoneUrlState | null;
  } | null>(null);
  const pushTimerRef = useRef(0);
  const watchdogRef = useRef(0);
  const tailTimerRef = useRef(0);
  /** 提交后核对地址用的轮询计时器（查询串变化不会触发 usePathname，见 verifyCommit）。 */
  const verifyTimerRef = useRef(0);
  const cancelsRef = useRef(0);
  const debugRef = useRef<TransitionDebug>({
    navigating: false,
    source: null,
    intent: null,
    kind: "none",
    token: 0,
    pendingPath: null,
    cancels: 0,
  });

  const driverRef = useRef(driver);
  useEffect(() => {
    // 每次提交后同步最新的 driver；决策函数只在事件里读它。
    driverRef.current = driver;
  });

  const clearLayers = useCallback(() => {
    const active = driverRef.current;
    active.stopCrowd();
    active.stopJoker();
    active.stopIsekai();
    active.stopWipe();
  }, []);

  const cancel = useCallback(() => {
    tokenRef.current += 1;
    cancelsRef.current += 1;
    window.clearTimeout(pushTimerRef.current);
    window.clearTimeout(watchdogRef.current);
    window.clearTimeout(tailTimerRef.current);
    window.clearTimeout(verifyTimerRef.current);
    pushTimerRef.current = 0;
    watchdogRef.current = 0;
    tailTimerRef.current = 0;
    verifyTimerRef.current = 0;
    navigatingRef.current = false;
    pendingRef.current = null;
    clearLayers();
    debugRef.current = {
      ...debugRef.current,
      navigating: false,
      pendingPath: null,
      token: tokenRef.current,
      cancels: cancelsRef.current,
    };
  }, [clearLayers]);

  /** 目标路由已提交：收起遮罩（留一小段退场，避免闪现）。 */
  const finish = useCallback(() => {
    pendingRef.current = null;
    navigatingRef.current = false;
    debugRef.current = { ...debugRef.current, navigating: false, pendingPath: null };
    window.clearTimeout(watchdogRef.current);
    watchdogRef.current = 0;
    window.clearTimeout(verifyTimerRef.current);
    verifyTimerRef.current = 0;
    tailTimerRef.current = window.setTimeout(() => {
      clearLayers();
    }, 80);
  }, [clearLayers]);

  // 完成信号一：目标路由提交（pathname 变化），不是 await router.push()。
  useEffect(() => {
    const pending = pendingRef.current;
    if (pending && pending.path === pathname) finish();
  }, [pathname, finish]);

  // 完成信号二：手机目标 App / screen / item 提交完成（pathname 可能不变）。
  const commitPhoneTarget = useCallback(
    (state: PhoneUrlState | null) => {
      const pending = pendingRef.current;
      if (!pending || !pending.phone) return;
      if (
        state &&
        state.phone === pending.phone.phone &&
        state.screen === pending.phone.screen &&
        state.item === pending.phone.item
      ) {
        finish();
      }
    },
    [finish],
  );

  /**
   * 提交后核对地址：`usePathname()` 只在路径变化时驱动完成信号，
   * 而 `/posts?view=archive` 这类**只改查询串**的提交不会让它变化。
   * 这里在 push 之后按令牌做有限次核对（不做无限轮询），地址一致即收尾；
   * 手机目标仍以 `commitPhoneTarget` 为主，两者结果一致、幂等。
   */
  const verifyCommit = useCallback(
    (token: number) => {
      window.clearTimeout(verifyTimerRef.current);
      let attempts = 0;
      const check = () => {
        verifyTimerRef.current = 0;
        if (token !== tokenRef.current) return;
        const pending = pendingRef.current;
        if (!pending) return;
        const current = `${window.location.pathname}${window.location.search}`;
        if (current === pending.destination.replace(/#.*$/, "")) {
          finish();
          return;
        }
        attempts += 1;
        if (attempts < 20) verifyTimerRef.current = window.setTimeout(check, 100);
      };
      check();
    },
    [finish],
  );

  // 后退 / 前进与 bfcache 还原：取消旧任务，不重播过场。
  useEffect(() => {
    const onPopState = () => cancel();
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) cancel();
    };
    window.addEventListener("popstate", onPopState);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("pageshow", onPageShow);
      window.clearTimeout(pushTimerRef.current);
      window.clearTimeout(watchdogRef.current);
      window.clearTimeout(tailTimerRef.current);
      window.clearTimeout(verifyTimerRef.current);
      clearLayers();
    };
  }, [cancel, clearLayers]);

  const doPush = useCallback(
    (destination: string, replace: boolean) => {
      if (adapter) {
        adapter.push(destination, { replace });
        return;
      }
      // router.push() 不被等待：完成信号来自上面的 pathname effect。
      if (replace) router.replace(destination, { scroll: false });
      else router.push(destination, { scroll: false });
    },
    [adapter, router],
  );

  const updateUrl = useCallback(
    (destination: string, options?: { replace?: boolean }) => {
      doPush(destination, options?.replace ?? false);
    },
    [doPush],
  );

  const navigate = useCallback(
    (request: NavigationRequest) => {
      const { destination, source } = request;

      // 站外 / 空目的地不接管（仍走同一个 assign 出口，测试与降级路径一致）。
      if (!destination.startsWith("/")) {
        (adapter?.assign ?? ((url: string) => window.location.assign(url)))(destination);
        return;
      }

      const target = new URL(destination, window.location.href);
      // 同页（同 path + 同 search）时交给浏览器做锚点滚动，不播放过场、不制造历史。
      if (target.pathname === window.location.pathname && target.search === window.location.search) {
        window.location.hash = target.hash;
        return;
      }

      // 意图：调用方显式声明优先；缺省时按「当前是否已在殿堂内部」自动判定边界，
      // 覆盖首页卡片、作品详情等不一定能逐条标注来源的外部入口。
      const originPhoneApp = parsePhoneState(window.location.search)?.phone ?? null;
      const intent: NavigationIntent | null =
        request.intent ??
        showcaseEntryIntent(destination, {
          pathname: window.location.pathname,
          phoneApp: originPhoneApp,
        });

      if (prefersReducedMotion()) {
        // 减少动态效果：直接导航，不遮屏、不延时（意图也不改变这条）。
        doPush(target.pathname + target.search + target.hash, false);
        return;
      }

      // 连点：不启动第二套动画。
      if (navigatingRef.current) return;

      const active = driverRef.current;
      const plan = effectPlan(source, active, intent ?? undefined);
      let kind: TransitionKind = "none";
      for (const candidate of plan) {
        if (candidate === "crowd" && active.playCrowd()) {
          kind = "crowd";
          break;
        }
        if (candidate === "joker" && active.playJoker()) {
          kind = "joker";
          break;
        }
        if (candidate === "isekai" && active.playIsekai()) {
          kind = "isekai";
          break;
        }
        if (candidate === "wipe") {
          active.playWipe();
          kind = "wipe";
          break;
        }
        if (candidate === "none") {
          kind = "none";
          break;
        }
      }

      tokenRef.current += 1;
      const token = tokenRef.current;
      navigatingRef.current = true;
      pendingRef.current = {
        token,
        path: target.pathname,
        search: target.search.replace(/^\?/, ""),
        destination: target.pathname + target.search + target.hash,
        kind,
        phone: parsePhoneState(target.search),
      };
      debugRef.current = {
        navigating: true,
        source,
        intent,
        kind,
        token,
        pendingPath: target.pathname,
        cancels: cancelsRef.current,
      };

      const wait = waitForEffect(kind, active);
      window.clearTimeout(pushTimerRef.current);
      pushTimerRef.current = window.setTimeout(() => {
        if (token !== tokenRef.current) return;
        doPush(target.pathname + target.search + target.hash, false);
        verifyCommit(token);
      }, wait);

      // 15 秒最终看门狗：清遮罩 + 整页降级，绝不永久黑屏。
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = window.setTimeout(() => {
        if (token !== tokenRef.current) return;
        cancel();
        (adapter?.assign ?? ((url: string) => window.location.assign(url)))(target.href);
      }, NAVIGATION_WATCHDOG_MS);
    },
    [adapter, cancel, doPush, verifyCommit],
  );

  /** 跳过：立即提交目标地址；视觉在完成信号后的统一退场里收起，不留下黑屏遮罩。 */
  const skip = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    window.clearTimeout(pushTimerRef.current);
    pushTimerRef.current = 0;
    // 先停掉短版视觉，避免「视频还在播、页面已经换了」。
    driverRef.current.stopIsekai();
    doPush(pending.destination, false);
    verifyCommit(pending.token);
  }, [doPush, verifyCommit]);

  const value = useMemo<NavigationCoordinator>(
    () => ({
      navigate,
      updateUrl,
      commitPhoneTarget,
      skip,
      navigating: () => navigatingRef.current,
      debug: () => debugRef.current,
    }),
    [commitPhoneTarget, navigate, skip, updateUrl],
  );

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

const FALLBACK: NavigationCoordinator = {
  navigate: (request) => {
    if (typeof window !== "undefined") window.location.assign(request.destination);
  },
  updateUrl: () => undefined,
  commitPhoneTarget: () => undefined,
  skip: () => undefined,
  navigating: () => false,
  debug: () => ({
    navigating: false,
    source: null,
    intent: null,
    kind: "none",
    token: 0,
    pendingPath: null,
    cancels: 0,
  }),
};

export function useNavigation(): NavigationCoordinator {
  const value = useContext(NavigationContext);
  return useMemo(() => value ?? FALLBACK, [value]);
}
