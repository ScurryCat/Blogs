"use client";

/**
 * SiteRuntime：跨普通站内路由保留的客户端外壳（01 §4）。
 *
 * ```text
 * RootLayout（服务端）
 * └─ SiteRuntime（客户端，**包裹服务端 children**）
 *    ├─ AudioService（唯一 audio）/ 音效偏好
 *    ├─ NavigationCoordinator 与 TransitionLayer（人群 / Joker 帷幕 / 斜切兜底）
 *    ├─ OverlayManager / Toast
 *    ├─ children：服务端渲染的页头 / 正文 / 页脚
 *    └─ PhoneProvider 与 PhoneHost、问卷浮层、开屏、锚点落地
 * ```
 *
 * 两个关键点：
 *  - **providers 必须包住 `children`**：页头、正文与地图里的链接都要用同一个导航协调器。
 *    否则那些链接拿不到 context，会退回「整页跳转」，过场效果与「不重建音频」的保证都不成立
 *    （真实浏览器验收抓到过这个 bug，见 T02-result.md）。
 *  - `children` 是**服务端渲染的插槽**，不会因为进了客户端组件而变成客户端渲染；
 *    只有手机 / 问卷这些确实需要浏览器 API 的部分才在客户端。
 *
 * 这里**不读 pathname 当 key 重建**，也不在顶层读 `window`：音乐与手机状态因此能跨页保留。
 */

import {
  Suspense,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { BootScreen } from "@/features/runtime/boot-screen";
import { AudioProvider } from "@/features/runtime/audio/audio-service";
import { LegacyCursor } from "@/features/runtime/legacy-fx";
import { LegacyHashLanding } from "@/features/runtime/legacy-hash";
import { NavigationProvider, useNavigation } from "@/features/runtime/navigation/coordinator";
import {
  TransitionLayer,
  createProxyDriver,
  type TransitionHandle,
} from "@/features/runtime/navigation/transition-layer";
import { OverlayProvider, useOverlayManager } from "@/features/runtime/overlay-manager";
import { ToastProvider } from "@/features/runtime/toast";
import { DefaultPoll } from "@/features/legacy/poll/poll";
import { PhoneHost } from "@/features/phone/phone-host";
import { MiniPlayer } from "@/features/runtime/audio/mini-player";
import { PhoneProvider } from "@/features/phone/phone-provider";

const HandleContext = createContext<TransitionHandle | null>(null);

/** 测试与调试用的只读探针（旧站也有 `PL.transitionState()` 这类入口）。 */
function RuntimeProbe(): null {
  const navigation = useNavigation();
  const overlays = useOverlayManager();
  const handle = useContext(HandleContext);

  useEffect(() => {
    const probe = () => ({
      navigation: navigation.debug(),
      overlays: overlays.depth(),
      ...(handle?.debug() ?? {
        crowd: { created: false, ready: false, playing: false, state: "not-warmed" },
        joker: { created: false, ready: false, playing: false },
      }),
      transition: {
        crowd: document.querySelector(".crowd")?.classList.contains("on") ?? false,
        joker: document.querySelector(".jk")?.classList.contains("on") ?? false,
        wipe: document.querySelector(".wipe")?.classList.contains("go") ?? false,
      },
      phone: {
        open: document.querySelector(".pw-wrap")?.hasAttribute("hidden") === false,
        apps: document.querySelectorAll(".pw-app").length,
      },
      audio: {
        elements: document.querySelectorAll("audio").length,
        music: document.querySelectorAll("audio[data-pl-music]").length,
      },
    });
    const target = window as unknown as { __PHANTOM_DEBUG__?: () => unknown };
    target.__PHANTOM_DEBUG__ = probe;
    return () => {
      delete target.__PHANTOM_DEBUG__;
    };
  }, [handle, navigation, overlays]);

  return null;
}

export function SiteRuntime({ children }: { children: ReactNode }): ReactNode {
  // 句柄用 state 保存（不在渲染期读写 ref）；driver 通过闭包读它，
  // 因此 NavigationProvider 拿到的是一个稳定的决策入口。
  const [handle, setHandle] = useState<TransitionHandle | null>(null);
  const driver = useMemo(() => createProxyDriver(() => handle), [handle]);

  return (
    <OverlayProvider>
      <AudioProvider>
        <ToastProvider>
          <NavigationProvider driver={driver}>
            <HandleContext.Provider value={handle}>
              <RuntimeProbe />
              <TransitionLayer onReady={setHandle} />
              {/* 服务端渲染的页头 / 正文 / 页脚：必须在 providers 之内，
                  否则它们的链接拿不到导航协调器，会退回整页跳转。 */}
              {children}
              <Suspense fallback={null}>
                <PhoneProvider>
                  <BootScreen />
                  <LegacyHashLanding />
                  <LegacyCursor />
                  <PhoneHost />
                  <MiniPlayer />
                  <DefaultPoll />
                </PhoneProvider>
              </Suspense>
            </HandleContext.Provider>
          </NavigationProvider>
        </ToastProvider>
      </AudioProvider>
    </OverlayProvider>
  );
}
