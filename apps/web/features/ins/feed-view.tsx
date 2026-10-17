"use client";

/**
 * 信息流视图（03 §4）。
 *
 * 结构：站主头像 / 名称 + 简介 → 标签过滤 → 单列图文卡片 → 「加载更多」。
 *
 * 必须区分的状态（03 §4「必备状态」）：
 *   骨架 / 没有动态 / 标签无结果 / 断网或请求失败 / 图片失败 / 动态撤回。
 * **失败不能显示成空列表**，所以 `error` 分支永远优先于 `empty` 分支。
 *
 * 其他约定：
 *  - 「加载更多」是显式按钮，不做无限滚动（03 §4）；
 *  - 切换标签**重置游标**并从第一页开始（05 §6）；
 *  - 卸载与切换时取消进行中的读取（验收 §1）。
 */

import { SiteLink } from "@/features/runtime/navigation/site-link";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";

import { ImagePreview } from "./image-preview";
import { FeedSkeleton, MomentCard } from "./moment-card";
import { useFeedScrollRestore, scrollKey } from "./scroll-memory";
import { excerptOf, type Moment } from "./types";
import { useMomentFeed } from "./use-feed";

export interface FeedViewProps {
  /** 手机内传入：标签切换走宿主换屏；不传则渲染站内链接（独立页）。 */
  onSelectTag?: (tag: string | null) => void;
  /** 当前标签筛选（来自 URL 查询参数）。 */
  tag: string | null;
  /** 可用的标签（来自已加载动态的并集）。 */
  availableTags?: readonly string[];
  /** 服务端已经渲染好的第一页；传入时客户端不再重复请求同一页。 */
  initial?: readonly Moment[];
  initialCursor?: string | null;
  /** 服务端首屏失败的原因（客户端读取的初始错误；读到内容后会被清掉）。 */
  initialError?: string | null;
}

export function FeedView({
  tag,
  availableTags = [],
  initial,
  initialCursor = null,
  initialError = null,
  onSelectTag,
}: FeedViewProps): ReactNode {
  const [preview, setPreview] = useState<{ momentId: string; index: number } | null>(null);
  const lastTrigger = useRef<HTMLElement | null>(null);
  // 列表根节点：滚动记忆据此判定容器（手机 .pw-screen / 独立页 window）。
  const wrapRef = useRef<HTMLElement | null>(null);
  const feed = useMomentFeed(tag, { initial, initialCursor, initialError });

  useFeedScrollRestore(scrollKey(tag), feed.loaded, {
    enabled: true,
    consume: true,
    containerRef: wrapRef,
  });

  const previewMoment = useMemo(
    () => (preview ? feed.items.find((moment) => moment.id === preview.momentId) ?? null : null),
    [feed.items, preview],
  );

  // 只在事件处理里写 ref、只在 effect / 关闭回调里读 —— 不在渲染期读写。
  const openPreview = useCallback((momentId: string, index: number) => {
    lastTrigger.current = (document.activeElement as HTMLElement | null) ?? null;
    setPreview({ momentId, index });
  }, []);

  const closePreview = useCallback(() => setPreview(null), []);

  const restorePreviewFocus = useCallback(() => {
    lastTrigger.current?.focus?.();
  }, []);

  return (
    <section className="ins-feed-wrap" aria-label="图文动态" ref={wrapRef}>
      <nav className="ins-filters" aria-label="标签筛选">
        {onSelectTag ? (
          // 手机里：标签是应用内状态，换屏而不是跳站内路由（否则手机会被关闭）
          <button
            type="button"
            className={`ins-chip${tag ? "" : " on"}`}
            aria-current={tag ? undefined : "page"}
            onClick={() => onSelectTag(null)}
          >
            全部
          </button>
        ) : (
          <SiteLink source="phone-link" className={`ins-chip${tag ? "" : " on"}`} href="/apps/ins" aria-current={tag ? undefined : "page"}>
            全部
          </SiteLink>
        )}
        {availableTags.map((name) =>
          onSelectTag ? (
            <button
              key={name}
              type="button"
              className={`ins-chip${tag === name ? " on" : ""}`}
              aria-current={tag === name ? "page" : undefined}
              onClick={() => onSelectTag(name)}
            >
              #{name}
            </button>
          ) : (
            <SiteLink source="phone-link"
              key={name}
              className={`ins-chip${tag === name ? " on" : ""}`}
              href={`/apps/ins?tag=${encodeURIComponent(name)}`}
              aria-current={tag === name ? "page" : undefined}
            >
              #{name}
            </SiteLink>
          ),
        )}
      </nav>

      {feed.phase === "loading" && !feed.items.length ? (
        <FeedSkeleton />
      ) : feed.phase === "error" && !feed.items.length ? (
        <div className="ins-state ins-state-error" role="alert">
          <p className="ins-state-kicker">READ FAILED</p>
          <p>{feed.error}</p>
          <button type="button" className="ins-btn red" onClick={feed.reload}>
            重新读取
          </button>
        </div>
      ) : feed.items.length === 0 ? (
        <div className="ins-state" role="status">
          <p className="ins-state-kicker">EMPTY</p>
          <p>
            {tag
              ? `标签 #${tag} 下还没有公开的动态。`
              : "还没有公开的图文动态。站主发布后会出现在这里。"}
          </p>
          {tag ? (
            <SiteLink source="phone-link" className="ins-btn" href="/apps/ins">
              看全部动态
            </SiteLink>
          ) : null}
        </div>
      ) : (
        <>
          {feed.error ? (
            // 已有内容但翻页失败：不把已读到的内容换成错误页，只在下面说明。
            <p className="ins-inline-error" role="alert">
              {feed.error}
            </p>
          ) : null}
          <div className="ins-feed">
            {feed.items.map((moment) => (
              <MomentCard key={moment.id} moment={moment} onOpenPreview={openPreview} />
            ))}
          </div>
          <div className="ins-more">
            {feed.hasMore ? (
              <button
                type="button"
                className="ins-btn"
                onClick={feed.loadMore}
                disabled={feed.loadingMore}
              >
                {feed.loadingMore ? "加载中…" : "加载更多"}
              </button>
            ) : (
              <p className="ins-more-end">已经到底了。</p>
            )}
          </div>
        </>
      )}

      {preview && previewMoment ? (
        <ImagePreview
          images={previewMoment.images}
          index={preview.index}
          onIndexChange={(index) => setPreview({ momentId: preview.momentId, index })}
          onClose={closePreview}
          onClosed={restorePreviewFocus}
          caption={excerptOf(previewMoment.text, 40)}
        />
      ) : null}
    </section>
  );
}
