"use client";

/**
 * 媒体缩略图（共享图片选择器的一部分，契约 §4.3）。
 *
 * 规则：
 *  - 只用服务端生成的变体（w320 / w640 / w1280），不默认加载原图；
 *  - 图片加载失败时显示可读的降级占位，不出现「裂图」图标；
 *  - 装饰性图片 `alt=""`：可读文案由调用方放在相邻文本 / aria-label 上，
 *    避免和已选区里的替代文本重复播报；
 *  - 尺寸、上传状态不在这里渲染（由选择器与调用方决定），保证缩略图可复用。
 */

import { useState, type ReactNode } from "react";

import { mediaSizeLabel, mediaVariantUrl, type MediaAdminOut } from "./types";

export interface MediaThumbProps {
  media: MediaAdminOut;
  /** sm = 列表/已选区小图（默认 md 用于媒体库网格）。 */
  size?: "sm" | "md";
}

export function MediaThumb({ media, size = "md" }: MediaThumbProps): ReactNode {
  // 记录「加载失败的是哪一张」而不是布尔值：同一个组件复用不同 media 时不会串状态。
  const [brokenId, setBrokenId] = useState<string | null>(null);
  const broken = brokenId === media.id;
  const url = mediaVariantUrl(
    media,
    size === "sm"
      ? ["w320.webp", "w640.webp"]
      : ["w320.webp", "w640.webp", "w1280.webp"],
  );

  if (broken || !url) {
    return (
      <span
        className={`mpx-thumb is-${size} is-fallback`}
        data-media-thumb={media.id}
        aria-hidden="true"
        title={`${mediaSizeLabel(media)} · 暂无可用缩略图`}
      >
        无预览
      </span>
    );
  }

  return (
    <span className={`mpx-thumb is-${size}`} data-media-thumb={media.id}>
      {/* eslint-disable-next-line @next/next/no-img-element -- 管理侧媒体变体 URL 每次请求都按公开条件鉴权（草案图匿名 404），不能交给 next/image 的远程优化缓存。 */}
      <img
        src={url}
        alt=""
        loading="lazy"
        decoding="async"
        width={size === "sm" ? 64 : 160}
        height={size === "sm" ? 64 : 120}
        onError={() => setBrokenId(media.id)}
      />
    </span>
  );
}
