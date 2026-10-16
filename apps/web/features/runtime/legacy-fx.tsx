"use client";

/**
 * 旧站「怪盗光标 + 菜单音效」的组件化迁移（`assets/js/fx.js`）。
 *
 * 保留的行为：仅精确指针 + 未开启减弱动效时启用；第一次移动鼠标前不隐藏系统光标；
 * 悬停 / 点击可点元素时出声；页头 ♪ 开关按 `pl-sound` 记忆。
 *
 * 改动：旧实现把 `#hud .snd` 按钮插进页头 DOM 里（`insertAdjacentHTML`），
 * 新站由 React 渲染 `<SoundToggle />`，不再有人往别人拥有的节点里塞 DOM。
 * 全局监听在卸载时全部移除。
 */

import { useEffect, useRef, type ReactNode } from "react";

import { useAudioOrDefault, useSoundEnabled } from "@/features/runtime/audio/audio-service";
import { prefersReducedMotion } from "@/features/runtime/effects/crowd";

const HOT = "a,button,summary,label[for],select,.pm,.chip,.row-a,[data-sfx]";
const BLIP = `${HOT},.loc:not(.off)`;

export function LegacyCursor(): ReactNode {
  const audio = useAudioOrDefault();
  const cursorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;

    const node = document.createElement("div");
    node.id = "p5-cursor";
    node.setAttribute("aria-hidden", "true");
    document.body.appendChild(node);
    cursorRef.current = node;

    let x = -100;
    let y = -100;
    let frame = 0;
    let last = 0;
    let shown = false;
    let raf = 0;

    const onMove = (event: MouseEvent) => {
      x = event.clientX;
      y = event.clientY;
      if (!shown) {
        shown = true;
        node.style.display = "block";
        document.documentElement.classList.add("p5c");
      }
      const target = event.target as Element | null;
      node.classList.toggle("link", Boolean(target?.closest?.(`${HOT},.loc`)));
    };
    const hide = () => {
      node.style.display = "none";
      shown = false;
      document.documentElement.classList.remove("p5c");
    };
    const tick = (timestamp: number) => {
      if (timestamp - last >= 50) {
        frame = (frame + 1) % 30;
        last = timestamp;
        node.style.backgroundPosition = `${-frame * 48}px 0`;
      }
      node.style.transform = `translate(${x}px,${y}px)`;
      raf = window.requestAnimationFrame(tick);
    };
    // 悬停 / 点击出声：只在「进入一个新的可点元素」时响一次。
    let lastHot: Element | null = null;
    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const target = event.target as Element | null;
      const hot = target?.closest?.(BLIP) ?? null;
      if (hot && hot !== lastHot) audio.blip();
      lastHot = hot;
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest?.(BLIP)) audio.blip();
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as Element | null;
      if (target?.matches?.(":focus-visible")) audio.blip();
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("blur", hide);
    document.documentElement.addEventListener("mouseleave", hide);
    document.addEventListener("pointerover", onPointerOver);
    document.addEventListener("click", onClick, true);
    document.addEventListener("focusin", onFocusIn);
    raf = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("blur", hide);
      document.documentElement.removeEventListener("mouseleave", hide);
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("focusin", onFocusIn);
      document.documentElement.classList.remove("p5c");
      node.remove();
      cursorRef.current = null;
    };
  }, [audio]);

  return null;
}

/** 页头 ♪ 开关：音效状态的事实来源。 */
export function SoundToggle(): ReactNode {
  const audio = useAudioOrDefault();
  const enabled = useSoundEnabled();
  return (
    <button
      className="snd"
      type="button"
      aria-pressed={enabled}
      aria-label="菜单音效"
      onClick={() => {
        const next = !enabled;
        audio.setSoundEnabled(next);
        if (next) audio.blip();
      }}
    >
      <span aria-hidden="true">♪</span>
    </button>
  );
}
