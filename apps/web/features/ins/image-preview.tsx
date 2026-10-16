"use client";

/**
 * 图片预览前景层（03 §4「图片预览」）。
 *
 * 规则：
 *  - 上一张 / 下一张、关闭、键盘操作都支持；**不能只有滑动手势**（03 §4）；
 *  - 关闭回到原卡片（焦点归还由 `OverlayManager` 的 `restoreFocus` 统一处理）；
 *  - **有宿主时**不新增全局 Escape 监听、不自己锁 body：Escape 分层与滚动锁由
 *    `OverlayManager` 统一管理（02 §9、SHARED-CONTRACTS §4）；
 *  - **没有宿主时**（例如 `/admin` 下的草稿预览、独立于根布局渲染的测试）
 *    `useOverlayManager()` 会返回一个空操作替身 —— 那时预览会「打不开也关不掉」。
 *    真实浏览器联调抓到过这一点（键盘用户进去出不来），因此这里显式分成两条路径：
 *    有宿主就登记，没宿主就自己接管自己的 Escape，绝不和宿主抢。
 *  - **不触发音效、不重建音乐**：只渲染 `<img>`，不碰任何音频元素（03 §8、验收 6）。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { useOverlay, useOverlayManager } from "@/features/runtime/overlay-manager";

import { previewUrl, type MomentImage } from "./types";

export interface ImagePreviewProps {
  images: readonly MomentImage[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /**
   * 关闭时通知调用方归还焦点。
   *
   * 刻意**不接收元素本身**（`returnFocusTo`）：那样调用方就得在渲染期读 ref 才能把
   * 元素传进来，而渲染期读写 ref 是 React 的纯度违规。改成回调后，调用方在 effect
   * 或事件处理里读 ref，两边都干净。
   */
  onClosed?: () => void;
  caption?: string;
}

export function ImagePreview({
  images,
  index,
  onIndexChange,
  onClose,
  onClosed,
  caption,
}: ImagePreviewProps): ReactNode {
  const [failed, setFailed] = useState(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const image = images[index];
  const go = useCallback(
    (step: number) => {
      if (images.length < 2) return;
      const next = (index + step + images.length) % images.length;
      setFailed(false);
      onIndexChange(next);
    },
    [images.length, index, onIndexChange],
  );

  // 返回 true 表示这一层消费了 Escape，宿主不会再往下关其他层。
  const requestClose = useCallback(() => {
    onClose();
    onClosed?.();
    return true;
  }, [onClose, onClosed]);

  // 路径 A：登记到 OverlayManager（滚动锁 + 焦点归还 + 分层 Escape，由宿主实现）。
  useOverlay({
    id: "ins-image-preview",
    onEscape: requestClose,
    lockScroll: true,
    restoreFocus: () => onClosed?.(),
  });

  // 载入后把焦点放到关闭按钮（键盘用户第一站），但**不抢走 OverlayManager 的 Escape 职责**。
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  if (!image) return null;
  const url = previewUrl(image);

  return (
    <div
      className="ins-preview"
      role="dialog"
      aria-modal="true"
      aria-label={`图片预览 第 ${index + 1} 张，共 ${images.length} 张`}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") {
          event.preventDefault();
          go(1);
          return;
        }
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          go(-1);
          return;
        }
        if (event.key === "Escape") {
          // Escape 的双保险，**不会重复关闭**：
          //  - 有宿主时宿主的 document 监听先跑并 preventDefault，这里直接返回；
          //  - 没有宿主时（例如 /admin 下的草稿预览）宿主的替身是空操作，
          //    事件没被消费，这里补上 —— 否则键盘用户进去就出不来。
          if (event.defaultPrevented) return;
          event.preventDefault();
          requestClose();
        }
      }}
    >
      <div className="ins-preview-bar">
        <span className="ins-preview-count" aria-live="polite">
          {index + 1} / {images.length}
        </span>
        <button ref={closeRef} type="button" className="ins-btn" onClick={requestClose}>
          关闭预览
        </button>
      </div>

      <div className="ins-preview-stage">
        {images.length > 1 ? (
          <button
            type="button"
            className="ins-btn ins-preview-nav"
            onClick={() => go(-1)}
            aria-label="上一张图片"
          >
            ‹
          </button>
        ) : null}

        {failed || !url ? (
          <p className="ins-image-failed" role="alert">
            这张图片加载失败，可能已被撤回或暂时不可用。
          </p>
        ) : (
          // key 让换图时重新触发 onError，避免沿用上一张的失败状态。
          /* eslint-disable-next-line @next/next/no-img-element -- 预览层展示的是 `previewUrl()`
             按当前媒体变体清单选出的地址（w1280→w640→w320）。这个地址**按请求**由媒体端点授权，
             且不同查看者看到的变体集合可能不同，因此不能交给 next/image 的远程优化器缓存。 */
          <img
            key={image.media_id}
            className="ins-preview-img"
            src={url}
            alt={image.alt}
            onError={() => setFailed(true)}
          />
        )}

        {images.length > 1 ? (
          <button
            type="button"
            className="ins-btn ins-preview-nav"
            onClick={() => go(1)}
            aria-label="下一张图片"
          >
            ›
          </button>
        ) : null}
      </div>

      <p className="ins-preview-caption">
        {image.alt}
        {caption ? ` · ${caption}` : ""}
      </p>

      <button
        type="button"
        className="ins-preview-backdrop"
        aria-label="关闭预览"
        onClick={requestClose}
      />
    </div>
  );
}
