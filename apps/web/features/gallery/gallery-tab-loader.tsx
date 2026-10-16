"use client";

/**
 * INS 相册页签的**接线助手**（T00 在 T03 的 INS 页里用一行接上）。
 *
 * 为什么需要它：T00 要接线的话，需要「服务端预读相册 → 客户端确认 → 构造贡献」三步。
 * 把这三步收在这里，接线方只写：
 *
 * ```tsx
 * // app/apps/ins/page.tsx（T03 所有，由 T00 接线）
 * <GalleryTabLoader initialAlbums={albumPage?.items ?? null}>
 *   {(contribution) => (
 *     <InsShell tabContributions={[contribution]} … />
 *   )}
 * </GalleryTabLoader>
 * ```
 *
 * 也可以不预读（`initialAlbums` 省略）：那时首屏没有相册页签，挂载后确认一次再出现。
 *
 * 本文件**不修改** INS 的任何文件，只提供给它一个可注入的贡献对象。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { fetchAlbums } from "./api";
import { galleryTabContribution } from "./ins-tab";
import type { InsTabContribution } from "@/features/ins/composition";
import type { AlbumSummary } from "./types";

export interface GalleryTabLoaderProps {
  /**
   * 服务端已经读到的第一页相册（`null` / 省略 = 没有预读，客户端自己确认）。
   * 传了空数组表示「服务端确认过：一个公开相册都没有」，客户端不再重复确认。
   */
  initialAlbums?: readonly AlbumSummary[] | null;
  children: (contribution: InsTabContribution) => ReactNode;
}

export function GalleryTabLoader({ initialAlbums = null, children }: GalleryTabLoaderProps): ReactNode {
  const [available, setAvailable] = useState((initialAlbums?.length ?? 0) > 0);
  const controllerRef = useRef<AbortController | null>(null);

  const check = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const page = await fetchAlbums({ limit: 1 }, controller.signal);
      setAvailable(page.items.length > 0);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      // 读取失败保持「不显示」：一个点了会报错的页签比没有页签更糟。
      setAvailable(false);
    }
  }, []);

  useEffect(() => {
    // 服务端已经给出结论（含「确实没有」）时不重复请求。
    if (initialAlbums !== null) return undefined;
    const controller = new AbortController();
    controllerRef.current = controller;
    // 先 `await` 再 setState：effect 体里同步 setState 会触发级联渲染
    // （React Compiler 的 `react-hooks/set-state-in-effect`）。
    void (async () => {
      await Promise.resolve();
      await check();
    })();
    return () => controller.abort();
  }, [check, initialAlbums]);

  return <>{children(galleryTabContribution(available))}</>;
}
