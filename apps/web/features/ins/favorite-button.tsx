"use client";

/**
 * 本机收藏按钮（03 §7）。
 *
 * 规则：
 *  - 只保存 UUID + 收藏时间 + 最小展示摘要，**不复制原图、不存整段正文**；
 *  - 收藏状态通过 `useSyncExternalStore` 读取本机存储（见 `favorites-react.ts`）：
 *    服务端渲染成「未收藏」，客户端接管后自动校正，**不在 effect 里 setState**，
 *    也不会出现水合不一致；
 *  - 存储不可用时明确说明「本次只在内存中，刷新会丢」，
 *    并且**收藏失败不能伪装为已保存**（03 §4）；
 *  - 界面文案写「仅此浏览器保存」，不承诺跨设备同步。
 */

import { useCallback, useState, type ReactNode } from "react";

import { useFavorites } from "./favorites-react";
import type { Moment } from "./types";

export interface FavoriteButtonProps {
  moment: Moment;
  excerpt: string;
  coverUrl: string | null;
}

export function FavoriteButton({ moment, excerpt, coverUrl }: FavoriteButtonProps): ReactNode {
  const favorites = useFavorites();
  const [notice, setNotice] = useState<string | null>(null);
  const saved = favorites.has(moment.id);

  const toggle = useCallback(() => {
    const result = saved
      ? favorites.remove(moment.id)
      : favorites.add({
          id: moment.id,
          savedAt: new Date().toISOString(),
          // 只存摘要：卡片已经算好了截断后的文字，不额外保存全文。
          excerpt,
          cover: coverUrl,
          tags: moment.tags.map((tag) => tag.name),
        });
    if (!result.persisted) {
      setNotice(
        favorites.durable
          ? "浏览器存储已满，本次收藏只保存在当前页面。"
          : "这个浏览器不允许本机存储，本次收藏只保存在当前页面。",
      );
    } else {
      setNotice(saved ? "已取消收藏" : "已收藏（仅此浏览器保存）");
    }
  }, [coverUrl, excerpt, favorites, moment.id, moment.tags, saved]);

  return (
    <span className="ins-fav">
      <button
        type="button"
        className={`ins-btn${saved ? " on" : ""}`}
        aria-pressed={saved}
        onClick={toggle}
      >
        {saved ? "已收藏" : "收藏"}
      </button>
      {notice ? (
        <span className="ins-fav-note" role="status">
          {notice}
        </span>
      ) : null}
      {favorites.durable ? null : (
        <span className="ins-fav-warn">本机存储不可用：收藏只在当前页面有效。</span>
      )}
    </span>
  );
}
