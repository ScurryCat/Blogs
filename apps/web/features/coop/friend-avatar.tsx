"use client";

/**
 * 头像：缺失 / 加载失败都要有兜底（验收第 4 条）。
 *
 *  - 服务端在媒体未 ready 或已撤回时给 `avatar: null`，这里就渲染站名首字；
 *  - 即使给了 URL，图片仍可能 404（例如引用检查未登记、对象丢失），
 *    `onError` 后同样退回首字 —— 不给访客一个坏图图标；
 *  - 变体按固定优先级挑选：变体清单由服务端给，前端不拼路径、不猜文件名。
 */

import { useState, type ReactNode } from "react";

import type { CoopAvatar } from "./types";
import styles from "./coop.module.css";

/** 变体优先级：卡片用中等尺寸，避免先下原图。 */
export const AVATAR_VARIANT_ORDER = ["w640.webp", "w320.webp", "w1280.webp"] as const;

export function pickAvatarUrl(avatar: CoopAvatar | null): string | null {
  if (!avatar || avatar.variants.length === 0) return null;
  for (const name of AVATAR_VARIANT_ORDER) {
    const match = avatar.variants.find((variant) => variant.name === name);
    if (match) return match.url;
  }
  // 没有首选变体时用第一个可用变体；仍然只使用服务端给的相对地址。
  return avatar.variants[0]?.url ?? null;
}

/** 站名首字（CJK 取第一个字符，拉丁取首字母大写）。 */
export function monogramOf(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const [first] = Array.from(trimmed);
  return (first ?? "?").toUpperCase();
}

export function FriendAvatar({
  name,
  avatar,
  size = "card",
}: {
  name: string;
  avatar: CoopAvatar | null;
  size?: "card" | "inline";
}): ReactNode {
  const url = pickAvatarUrl(avatar);
  const [failed, setFailed] = useState(false);
  const showImage = url !== null && !failed;

  return (
    <span
      className={`${styles.avatar} ${size === "inline" ? styles.avatarInline : ""}`}
      data-coop-avatar={showImage ? "image" : "fallback"}
      aria-hidden="true"
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- 同源 API 变体地址，不是可优化的静态资源。
        <img src={url} alt="" width={48} height={48} loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <span className={styles.monogram}>{monogramOf(name)}</span>
      )}
    </span>
  );
}
