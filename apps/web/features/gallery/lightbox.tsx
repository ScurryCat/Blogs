"use client";

/**
 * 灯箱（07 §5「照片墙支持……灯箱」；验收 6「灯箱键盘」）。
 *
 * 规则（与 T03 的 `image-preview.tsx` 同形，不另造一套全局行为）：
 *  - ← / → 切换，Home / End 跳到首尾，Escape 关闭；**不能只有滑动手势**；
 *  - 关闭回到原来的图格（焦点归还交给 `OverlayManager` 的 `restoreFocus`）；
 *  - **有宿主时**不新增全局 Escape 监听、不自己锁 body（`useOverlay` 登记）；
 *  - **没有宿主时**（`/admin` 里的预览、独立渲染的测试）`useOverlayManager()` 返回
 *    空操作替身 —— 那时灯箱会「打不开也关不掉」。因此这里显式分成两条路径：
 *    有宿主就登记，没宿主就自己接管自己的 Escape（T03 在真实浏览器里踩过这一点）；
 *  - **不新增音频、不锁 body、不改 history**：只渲染 `<img>` 与按钮。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { useOverlay } from "@/features/runtime/overlay-manager";

import { IMAGE_FAILURE_TEXT, photoMetaLine } from "./failure";
import { formatTakenOn, lightboxUrl, photoAlt, type Photo } from "./types";

export interface LightboxProps {
  photos: readonly Photo[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /** 关闭后通知调用方把焦点还给触发元素。 */
  onClosed?: () => void;
  /** 相册标题（显示在顶栏，让用户知道自己在看哪个相册）。 */
  albumTitle?: string;
  /**
   * 是否真的有 OverlayManager 宿主（手机面板与站点运行时都有；`/admin` 与独立
   * 渲染的组件测试没有）。没有宿主时灯箱自己接管自己的 Escape。
   *
   * 这个标志由调用方给出而不是在灯箱内部猜：`useOverlayManager()` 在缺少宿主时
   * 返回的是空操作替身，灯箱无法从它反推出「有没有宿主」。
   */
  hasHost?: boolean;
}

export function Lightbox({
  photos,
  index,
  onIndexChange,
  onClose,
  onClosed,
  albumTitle,
  hasHost = false,
}: LightboxProps): ReactNode {
  // 失败态按**当前这张图**记：换一张就自然回到「没失败」，
  // 不需要在 effect 里 setState 复位。
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const photo = photos[index];
  const failed = !!photo && failedFor === photo.media_id;

  const go = useCallback(
    (step: number) => {
      if (photos.length < 2) return;
      const next = (index + step + photos.length) % photos.length;
      onIndexChange(next);
    },
    [index, onIndexChange, photos.length],
  );

  const requestClose = useCallback(() => {
    onClose();
    onClosed?.();
    return true;
  }, [onClose, onClosed]);

  // 路径 A：登记到 OverlayManager（滚动锁 + 焦点归还 + 分层 Escape，由宿主实现）。
  // 没有宿主时 `useOverlay` 是空操作，下面的 `onKeyDown` 里的 Escape 分支会接管。
  useOverlay({
    id: "gallery-lightbox",
    onEscape: requestClose,
    lockScroll: true,
    restoreFocus: () => onClosed?.(),
  });

  // 打开后把焦点放到关闭按钮：键盘用户的第一站。
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  if (!photo) return null;
  const big = lightboxUrl(photo);
  const canNavigate = photos.length > 1;

  return (
    <div
      className="plg-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`照片灯箱 第 ${index + 1} 张，共 ${photos.length} 张`}
      data-lightbox=""
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
        if (event.key === "Home" && canNavigate) {
          event.preventDefault();
          onIndexChange(0);
          return;
        }
        if (event.key === "End" && canNavigate) {
          event.preventDefault();
          onIndexChange(photos.length - 1);
          return;
        }
        if (event.key === "Escape") {
          // Escape 的双保险，**不会重复关闭**（同 T03）：有宿主时宿主的 document
          // 监听先跑并 preventDefault，这里直接返回；没有宿主时补上，
          // 否则键盘用户进去就出不来。
          if (event.defaultPrevented) return;
          event.preventDefault();
          requestClose();
        }
      }}
    >
      <div className="plg-lightbox-bar">
        <p className="plg-lightbox-counter" aria-live="polite">
          {index + 1} / {photos.length}
          {albumTitle ? ` · ${albumTitle}` : ""}
          {hasHost ? "" : " · 独立预览"}
        </p>
        <div className="plg-lightbox-actions">
          <button
            type="button"
            className="plg-button"
            onClick={() => go(-1)}
            disabled={!canNavigate}
            aria-label="上一张照片"
          >
            上一张
          </button>
          <button
            type="button"
            className="plg-button"
            onClick={() => go(1)}
            disabled={!canNavigate}
            aria-label="下一张照片"
          >
            下一张
          </button>
          <button
            ref={closeRef}
            type="button"
            className="plg-button"
            onClick={requestClose}
            aria-label="关闭灯箱"
          >
            关闭
          </button>
        </div>
      </div>

      <div className="plg-lightbox-stage">
        {failed || !big ? (
          <div className="plg-lightbox-fallback" role="status">
            <p>{IMAGE_FAILURE_TEXT}</p>
            <button
              type="button"
              className="plg-button"
              onClick={() => setFailedFor(null)}
            >
              重新加载
            </button>
          </div>
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element -- 媒体字节只能从 /api/v1/media 取（每次请求都校验公开引用），next/image 无法代取。 */
          <img
            className="plg-lightbox-image"
            src={big}
            alt={photoAlt(photo)}
            width={photo.width}
            height={photo.height}
            onError={() => setFailedFor(photo.media_id)}
          />
        )}
      </div>

      <p className="plg-lightbox-caption">
        {photoMetaLine(photo)}
        {photo.taken_on ? <time dateTime={formatTakenOn(photo.taken_on)} hidden /> : null}
      </p>
    </div>
  );
}
