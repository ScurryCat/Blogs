/* eslint-disable @next/next/no-img-element -- 开屏立绘与站点标志是旧站固定资源，尺寸写死在 chrome.css 里。 */
"use client";

/**
 * 开屏（怪盗入城）—— 旧站 `assets/js/boot.js` 的组件化迁移。
 *
 * 保留的行为：
 *  - 同一会话（sessionStorage `pl-booted`）只播一遍；`prefers-reduced-motion: reduce` 直接跳过；
 *  - 点击任意处 / Enter / Space / Escape 关闭，关闭时播一次菜单音效（在真实手势里，绕开自动播放策略）；
 *  - 关闭动画 560ms 后移除节点；期间锁滚动（`body.boot-lock`）；
 *  - 关闭（或跳过）时广播 `pl:booted`：音乐自动播放借这个手势。
 *
 * 迁移差别：节点由 React 渲染（`useLayoutEffect` 在首帧前决定要不要播，避免先看到正文再盖幕布），
 * 不再 `insertAdjacentHTML` 到 body。
 */

import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from "react";

import { site } from "@/features/legacy/config";
import { rn } from "@/features/legacy/text/ransom";
import { asset } from "@/features/legacy/assets";
import { useAudioOrDefault } from "@/features/runtime/audio/audio-service";
import { prefersReducedMotion } from "@/features/runtime/effects/crowd";

const BOOT_KEY = "pl-booted";

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function fireBooted(): void {
  try {
    window.dispatchEvent(new Event("pl:booted"));
  } catch {
    // 忽略：没有监听者也不影响开屏。
  }
}

export function BootScreen(): ReactNode {
  const audio = useAudioOrDefault();
  const [phase, setPhase] = useState<"idle" | "shown" | "closing" | "done">("idle");

  useIsomorphicLayoutEffect(() => {
    if (prefersReducedMotion()) {
      fireBooted();
      setPhase("done");
      return;
    }
    let booted: string | null = null;
    try {
      booted = window.sessionStorage.getItem(BOOT_KEY);
    } catch {
      // 读不到就当没播过（与旧站一致）。
    }
    if (booted) {
      fireBooted();
      setPhase("done");
      return;
    }
    setPhase("shown");
  }, []);

  const close = useCallback(() => {
    setPhase((current) => (current === "shown" ? "closing" : current));
  }, []);

  useEffect(() => {
    if (phase !== "shown") return;
    document.body.classList.add("boot-lock");
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " " || event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.body.classList.remove("boot-lock");
    };
  }, [phase, close]);

  useEffect(() => {
    if (phase !== "closing") return;
    try {
      window.sessionStorage.setItem(BOOT_KEY, "1");
    } catch {
      // 记不住就每次都播（旧站行为）。
    }
    audio.blip();
    fireBooted();
    const timer = window.setTimeout(() => setPhase("done"), 560);
    return () => window.clearTimeout(timer);
  }, [phase, audio]);

  if (phase !== "shown" && phase !== "closing") return null;

  return (
    <div id="boot" className={phase === "closing" ? "out" : undefined} onClick={close}>
      <div className="boot-dots" aria-hidden="true" />
      <div className="boot-stripes" aria-hidden="true" />
      <img className="boot-aoa" src={asset("assets/img/joker-aoa.png")} alt="" aria-hidden="true" />
      <img className="boot-logo" src={site.logo} alt={`${site.name} ${site.nameB}`} />
      <div className="boot-inner">
        <div className="boot-kicker">{site.kicker}</div>
        <h1 className="boot-title rn" id="boot-title">
          {rn(site.nameCn, 9)}
        </h1>
        <div className="boot-sub" aria-hidden="true">
          <span>Press</span>
          <span className="kbd">Enter</span>
          <span>to start</span>
        </div>
        <div className="boot-bar" aria-hidden="true">
          <i />
        </div>
      </div>
      <button className="boot-skip" type="button" onClick={close}>
        点击任意处进入
      </button>
    </div>
  );
}
