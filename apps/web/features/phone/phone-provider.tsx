"use client";

/**
 * PhoneProvider：手机宿主的状态与能力（02 §4 / §6 / §7）。
 *
 *  - **URL 是唯一依据**：`phone` / `screen` / `item` 三个保留参数；
 *  - 打开手机、进入应用、进入详情各 push 一条历史；浏览器 Back 与手机返回走同一条历史；
 *  - 直接访问带 `phone` 的链接（没有已知起点）时，「收起」用 `replace` 清参数，
 *    **不会 `history.back()` 跳出本站**；
 *  - 非法应用 / screen 回退到桌面，非法 item 由应用自己显示「未找到」；
 *  - 宿主只提供八项能力（打开应用、内部换屏、返回、关闭、打开站内内容、提示、音频、本机状态），
 *    应用不碰全局 DOM、不加音频、不锁 body。
 */

import { useSearchParams } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

import { LEGACY_PHONE_APPS } from "./legacy-apps";
import { createPhoneStateService } from "./phone-state-service";
import { createPhoneRegistry, phoneRegistry, type PhoneRegistry } from "./registry";
import type { NavigationRequest, PhoneAppManifest, PhoneHost, PhoneUrlState } from "./types";
import { buildPhoneUrl, parsePhoneState, withoutPhoneParams } from "./url-state";
import { useAudioOrDefault } from "@/features/runtime/audio/audio-service";
import { useNavigation } from "@/features/runtime/navigation/coordinator";
import { useToast } from "@/features/runtime/toast";

export interface PhoneContextValue {
  /** `null` 表示手机没有打开。 */
  state: PhoneUrlState | null;
  open: boolean;
  registry: PhoneRegistry;
  apps: readonly PhoneAppManifest[];
  host: PhoneHost;
  /** 打开手机（第一次打开时记下起点）。 */
  openPhone(): void;
  /**
   * 回到手机桌面。`phone=home` 不是应用 id，所以**不能**用 `host.openApp("home")`
   * （那会被正确地当成未注册应用而忽略）；宿主内部用这个方法。
   */
  goHome(): void;
  /** 应用加载后发现 screen 不在自己的枚举里：回退桌面并修正 URL。 */
  rejectScreen(): void;
}

const PhoneContext = createContext<PhoneContextValue | null>(null);

/** 正式注册表 + 已迁移的旧站站点链接，合成桌面清单。 */
export function createHostRegistry(): PhoneRegistry {
  return createPhoneRegistry([...phoneRegistry.manifests(), ...LEGACY_PHONE_APPS]);
}

export function PhoneProvider({
  children,
  /** 测试 / 集成时可注入注册表；默认是「正式注册表 + 已迁移的旧站站点链接」。 */
  registry: injected,
}: {
  children: ReactNode;
  registry?: PhoneRegistry;
}): ReactNode {
  const params = useSearchParams();
  const navigation = useNavigation();
  const toast = useToast();
  const audio = useAudioOrDefault();

  const registry = useMemo(() => injected ?? createHostRegistry(), [injected]);
  const stateService = useMemo(
    () => createPhoneStateService({ versionOf: (appId) => registry.find(appId)?.state_version ?? 1 }),
    [registry],
  );

  const search = params?.toString() ?? "";
  const parsed = useMemo(() => parsePhoneState(search), [search]);

  const originRef = useRef<string | null>(null);
  const depthRef = useRef(0);

  // 非法 / 未启用的应用：回退到桌面（02 §6 第 6 条），不做任意路径跳转。
  // 结果用 useMemo 固定身份 —— 下面的 host 与 context 都以它为依赖。
  const state = useMemo<PhoneUrlState | null>(() => {
    if (!parsed) return null;
    if (parsed.phone === "home") return parsed;
    return registry.find(parsed.phone) ? parsed : { phone: "home", screen: null, item: null };
  }, [parsed, registry]);

  const pushState = useCallback(
    (next: PhoneUrlState | null, options?: { replace?: boolean; countDepth?: boolean }) => {
      const target = buildPhoneUrl(window.location.pathname, window.location.search, next);
      if (!options?.replace && options?.countDepth !== false) depthRef.current += 1;
      navigation.updateUrl(target, { replace: options?.replace ?? false });
    },
    [navigation],
  );

  const openPhone = useCallback(() => {
    if (originRef.current === null) {
      const rest = withoutPhoneParams(window.location.search);
      originRef.current = `${window.location.pathname}${rest ? `?${rest}` : ""}`;
    }
    pushState({ phone: "home", screen: null, item: null });
  }, [pushState]);

  const goHome = useCallback(() => {
    pushState({ phone: "home", screen: null, item: null });
  }, [pushState]);

  const host = useMemo<PhoneHost>(() => {
    const service: PhoneHost = {
      openApp(appId, screen, item) {
        const found = registry.find(appId);
        if (!found) return; // 未注册 → 什么都不做，不执行任意路径
        pushState({ phone: appId, screen: screen ?? null, item: item ?? null });
      },
      navigateScreen(screen, item) {
        if (!state || state.phone === "home") return;
        pushState({ phone: state.phone, screen, item: item ?? null });
      },
      back() {
        if (depthRef.current > 0) {
          depthRef.current -= 1;
          window.history.back(); // 与浏览器 Back 同一条历史
          return;
        }
        // 直接链接进来的：没有本机历史可退，按「收起」处理，不跳出本站。
        service.close();
      },
      close() {
        const origin = originRef.current;
        originRef.current = null;
        depthRef.current = 0;
        if (origin && origin !== window.location.pathname) {
          // 有已知起点：回到起点（起点自身的查询参数保留，手机参数去掉）。
          navigation.updateUrl(origin);
          return;
        }
        navigation.updateUrl(
          buildPhoneUrl(window.location.pathname, window.location.search, null),
          { replace: true },
        );
      },
      openSiteContent(request: NavigationRequest) {
        if (request.source === "phone-link") originRef.current = null;
        navigation.navigate(request);
      },
      toast(message, options) {
        toast.show(message, { tone: options?.tone });
      },
      audio: {
        isPlaying: () => audio.isPlaying(),
        play: () => audio.play(),
        pause: () => audio.pause(),
        setVolume: (volume) => audio.setVolume(volume),
        getVolume: () => audio.getVolume(),
      },
      state: {
        get: (appId, key, fallback) => stateService.get(appId, key, fallback),
        set: (appId, key, value) => stateService.set(appId, key, value),
        clear: (appId) => stateService.clear(appId),
      },
    };
    return service;
  }, [audio, navigation, pushState, registry, state, stateService, toast]);

  const value = useMemo<PhoneContextValue>(
    () => ({
      state,
      open: state !== null,
      registry,
      apps: registry.manifests(),
      host,
      openPhone,
      goHome,
      rejectScreen() {
        pushState({ phone: "home", screen: null, item: null }, { replace: true });
      },
    }),
    [goHome, host, openPhone, pushState, registry, state],
  );

  return <PhoneContext.Provider value={value}>{children}</PhoneContext.Provider>;
}

export function usePhone(): PhoneContextValue {
  const value = useContext(PhoneContext);
  if (!value) throw new Error("usePhone 必须在 PhoneProvider 内使用");
  return value;
}
