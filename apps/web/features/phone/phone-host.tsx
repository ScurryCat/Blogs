"use client";

/**
 * PhoneHost：手机外壳、桌面与直立应用面板（02 §2 / §6 / §9）。
 *
 * - 桌面保留旧站外壳与红屏气质；进入内容应用后，屏幕变成**不做透视缩放的直立面板**
 *   （同尺寸同原点，只去掉 matrix3d），正文字号不被缩放；
 * - 小屏（≤620px）沿用旧站做法：外壳 PNG 与矩阵一起下岗，屏幕自己当面板；
 * - 「收起手机」关闭整个手机，不逐层返回；直接链接进来时用 replace 清参数，不离站；
 * - Escape 交给 OverlayManager 统一排队：应用内先回桌面，桌面再关手机；
 * - 打开时给背景加 `inert`，关闭时还原；焦点在打开时进手机、关闭时回到小图标。
 */

import { useCallback, useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

import { PhoneAppView } from "./phone-app-view";
import { PhoneDesktop } from "./phone-desktop";
import { usePhone } from "./phone-provider";
import { useAudioSnapshot } from "@/features/runtime/audio/audio-service";
import { asset } from "@/features/legacy/assets";
import { useOverlay } from "@/features/runtime/overlay-manager";

/** 打开手机时把背景收起来（设计 02 §9 的「背景 inert」）。 */
function setBackgroundInert(inert: boolean): void {
  // `.pw-tab` 也一起收起来：否则 Tab 会跑到手机上，而焦点圈定应当在对话框内。
  for (const selector of ["#main", "#hud", ".foot", ".skip", ".pw-tab"]) {
    const node = document.querySelector(selector);
    if (!node) continue;
    if (inert) node.setAttribute("inert", "");
    else node.removeAttribute("inert");
  }
}

export function PhoneHost(): ReactNode {
  const { state, open, registry, host, openPhone, goHome } = usePhone();
  const snapshot = useAudioSnapshot();
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const phoneRef = useRef<HTMLDivElement | null>(null);
  const wasOpen = useRef(false);

  const onDesktop = !state || state.phone === "home";
  const manifest = state && state.phone !== "home" ? registry.find(state.phone) : undefined;

  const close = useCallback(() => host.close(), [host]);
  const back = useCallback(() => host.back(), [host]);

  const onEscape = useCallback(() => {
    if (!open) return false;
    // 应用内先回应用层，桌面再关手机；不同时关闭多层。
    if (!onDesktop) {
      goHome();
      return true;
    }
    host.close();
    return true;
  }, [goHome, host, onDesktop, open]);

  useOverlay({ id: "phone", onEscape, lockScroll: open }, open);

  useEffect(() => {
    if (open) {
      document.documentElement.classList.add("pw-open");
      setBackgroundInert(true);
      // 焦点进手机（02 §9 的焦点圈定）：下一帧把焦点放到关闭键上，
      // 键盘用户一进来就能退出；不依赖是「点击打开」还是「直接链接打开」。
      const frame = window.requestAnimationFrame(() => {
        const target = phoneRef.current?.querySelector<HTMLElement>(".pw-close");
        target?.focus({ preventScroll: true });
      });
      return () => {
        window.cancelAnimationFrame(frame);
      };
    }
    document.documentElement.classList.remove("pw-open");
    setBackgroundInert(false);
    return undefined;
  }, [open]);

  // 关闭后把焦点还给边上的小图标。
  useEffect(() => {
    if (wasOpen.current && !open) launcherRef.current?.focus({ preventScroll: true });
    wasOpen.current = open;
  }, [open]);

  /** 焦点圈定：Tab / Shift+Tab 在对话框内的可聚焦元素之间首尾相连（背景已 inert）。 */
  const trapFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const host = phoneRef.current;
    if (!host) return;
    // 可见性判定用计算样式，不用 `offsetParent`：后者对 `position: fixed` 的元素恒为 null
    // （手机面板里的元素基本都是 fixed 后代），也会让 jsdom 里的判定恒为「不可见」。
    const visible = (node: HTMLElement) => {
      if (node.hasAttribute("hidden") || node.getAttribute("aria-hidden") === "true") return false;
      const style = window.getComputedStyle(node);
      return style.display !== "none" && style.visibility !== "hidden";
    };
    const focusable = [
      ...host.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ].filter(visible);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      <button
        ref={launcherRef}
        className={`pw-tab${snapshot.playing ? " playing" : ""}`}
        type="button"
        aria-expanded={open}
        aria-controls="p5-phone"
        onClick={() => {
          if (open) close();
          else openPhone();
        }}
      >
        <span className="g" aria-hidden="true">
          ▯
        </span>
        <span className="t" aria-hidden="true">
          PHONE
        </span>
        <span className="sr-only">
          {snapshot.playing ? "打开怪盗手机（音乐播放中）" : "打开怪盗手机"}
        </span>
      </button>

      <div className={`pw-wrap${open ? " on" : ""}`} hidden={!open} data-phone-host>
        <div
          className="pw-scrim"
          data-close
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        />
        <div
          ref={phoneRef}
          className={`pw${onDesktop ? "" : " pw--app"}`}
          onKeyDown={trapFocus}
          id="p5-phone"
          role="dialog"
          aria-modal="true"
          aria-label="怪盗手机"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- 旧站外壳图，固定 880×715。 */}
          <img
            className="pw-frame"
            src={asset("assets/img/phone/frame.webp")}
            alt=""
            width={880}
            height={715}
          />
          <div className="pw-screen">
            {onDesktop || !manifest ? (
              <PhoneDesktop />
            ) : (
              <div className="pw-appview">
                <header className="pw-appbar">
                  <button className="pw-back" type="button" aria-label="返回" onClick={back}>
                    ◂
                  </button>
                  <p className="pw-appname">
                    {manifest.name}
                    <span>{manifest.subtitle}</span>
                  </p>
                  <a
                    className="pw-expand"
                    href={manifest.canonical_path}
                    onClick={(event) => {
                      event.preventDefault();
                      host.openSiteContent({ destination: manifest.canonical_path, source: "phone-link" });
                    }}
                  >
                    展开查看 ▸
                  </a>
                </header>
                <div className="pw-appbody">
                  <PhoneAppView
                    manifest={manifest}
                    screen={state?.screen ?? null}
                    item={state?.item ?? null}
                    mode="compact"
                  />
                </div>
              </div>
            )}
          </div>
          <button className="pw-close" type="button" aria-label="收起手机" onClick={close}>
            ✕
          </button>
        </div>
      </div>
    </>
  );
}
