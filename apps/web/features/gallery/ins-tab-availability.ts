"use client";

/**
 * INS 相册页签的可用性钩子（T06 → T03/T00 的组合接口）。
 *
 * 问题：`InsTabContribution.isAvailable` 是**同步谓词**（T03 的 `resolveTabs()` 在渲染期
 * 调用它），而「有没有公开相册」只有一次读取之后才知道。
 *
 * 解法（不使用模块级可变布尔 —— 那在 SSR 下是共享状态，两个渲染会互相污染）：
 *
 *  1. 服务端组件在读到第一页相册后把 `initialAvailable` 传进 INS 的页面；
 *  2. 页面调 `useGalleryTab(setAvailable)`；hook 在挂载时异步**权威地**确认一次
 *     （`GET /gallery/albums?limit=1`）；
 *  3. `isAvailable()` 只是读 `isAvailable` prop（默认 false = 不显示），
 *     页面把它接到 hook 的 state 上。
 *
 * 因此约定接线方式（T00 在 INS 页里写 5 行）：
 *
 * ```tsx
 * const gallery = useGalleryTab();
 * <InsShell tabContributions={[galleryTabContribution(gallery.available)]} … />
 * ```
 *
 * `useGalleryTab` 卸载时取消在途请求（验收 §1）；读取失败时保持「不显示」，
 * 因为一个点了会报错的页签比没有页签更糟（验收：未接入不显示坏按钮）。
 */

import { useEffect, useRef, useState } from "react";

import { fetchAlbums } from "./api";

export interface GalleryTabState {
  /** 是否显示相册页签。默认 false（不显示），确认有公开相册后变 true。 */
  available: boolean;
  /** 读取阶段，供页面显示「正在确认相册…」之类的中性提示（可选使用）。 */
  phase: "checking" | "ready";
}

export interface UseGalleryTabOptions {
  /**
   * 服务端已经确认过「有公开相册」时传 true：首屏就有页签，不闪一下。
   * 服务端没读到（可能是失败、也可能真的为空）时传 false，hook 会在挂载后确认。
   */
  initialAvailable?: boolean;
  /** 关闭自动确认（例如服务端已经读到了完整的第一页相册）。 */
  enabled?: boolean;
}

export function useGalleryTab(options: UseGalleryTabOptions = {}): GalleryTabState {
  const { initialAvailable = false, enabled = true } = options;
  const [available, setAvailable] = useState(initialAvailable);
  const [phase, setPhase] = useState<"checking" | "ready">(
    initialAvailable || !enabled ? "ready" : "checking",
  );
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    controllerRef.current = controller;
    void (async () => {
      try {
        const page = await fetchAlbums({ limit: 1 }, controller.signal);
        setAvailable(page.items.length > 0);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        // 读取失败：保持「不显示」。理由见文件头 —— 坏按钮比没有入口更糟。
        setAvailable(false);
      } finally {
        if (!controller.signal.aborted) setPhase("ready");
      }
    })();
    return () => controller.abort();
  }, [enabled]);

  return { available, phase };
}
