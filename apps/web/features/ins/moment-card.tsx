"use client";

/**
 * 信息流卡片与骨架（03 §4「信息流」）。
 *
 * 卡片包含：图片、页码、正文摘要、标签、发布时间、收藏与分享。
 *  - 默认只加载缩略图（`variantUrl` 的 w640 → w320 优先级），
 *    用户主动进入预览才请求更大版本（03 §4）；
 *  - 多图必须同时提供**左右按钮**，不能只有手势（03 §4）；
 *  - 正文按**纯文本**渲染（03 §4：不接受 HTML），因此这里永远是 `{text}`，没有
 *    `dangerouslySetInnerHTML`；
 *  - 图片失败显示可读提示，不留空白。
 */

import { SiteLink } from "@/features/runtime/navigation/site-link";
import { useState, type ReactNode } from "react";

import { FavoriteButton } from "./favorite-button";
import { ShareButton } from "./share-button";
import { excerptOf, formatPublishedAt, variantUrl, type Moment } from "./types";

export interface MomentCardProps {
  moment: Moment;
  onOpenPreview?: (momentId: string, index: number) => void;
}

function ThumbStrip({ moment, onOpenPreview }: MomentCardProps): ReactNode {
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const images = moment.images;
  if (!images.length) {
    // 公开列表里的动态一定至少一张图（发布门槛），但前端不假设服务端永远正确：
    // 真的没有图时给出可读说明，而不是空白卡片。
    return <p className="ins-card-noimage">这条动态没有可显示的图片。</p>;
  }

  // 卡片只展示前 3 张缩略图；更多图进预览看（列表不为每张图加载大图）。
  const visible = images.slice(0, 3);
  return (
    <div className="ins-card-strip" role="group" aria-label={`动态配图，共 ${images.length} 张`}>
      {visible.map((image, index) => {
        const url = variantUrl(image);
        const broken = failed[image.media_id];
        return (
          <button
            key={image.media_id}
            type="button"
            className="ins-thumb"
            onClick={() => onOpenPreview?.(moment.id, index)}
            aria-label={`预览第 ${index + 1} 张图片：${image.alt}`}
          >
            {broken || !url ? (
              <span className="ins-thumb-failed" role="img" aria-label="图片不可用">
                图片不可用
              </span>
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element -- 站主上传的媒体只通过 `/api/v1/media/{id}/{variant}` 出，且每次请求都重查公开引用（撤回后立即不可读，05 §8）。next/image 的远程优化器会缓存并代理这些字节，等于在授权层前面加一层缓存；本站又已经事先生成了固定宽度变体（w320/w640/w1280），所以刻意用原生 <img>。 */
              <img
                src={url}
                alt={image.alt}
                loading="lazy"
                onError={() => setFailed((previous) => ({ ...previous, [image.media_id]: true }))}
              />
            )}
          </button>
        );
      })}
      <span className="ins-card-page">{visible.length} / {images.length}</span>
    </div>
  );
}

export function MomentCard({ moment, onOpenPreview }: MomentCardProps): ReactNode {
  const detailPath = `/apps/ins/${moment.id}`;
  const excerpt = excerptOf(moment.text);
  // `noUncheckedIndexedAccess` 下 `images[0]` 可能是 undefined，先取出来再收窄。
  const cover = moment.images[0];
  return (
    <article className="ins-card" data-moment-id={moment.id}>
      <header className="ins-card-head">
        <p className="ins-card-kicker">{"// MOMENT"}</p>
        <time className="ins-card-time" dateTime={moment.published_at ?? undefined}>
          {formatPublishedAt(moment.published_at)}
        </time>
      </header>

      {/* 正文按纯文本渲染：不解析 HTML，也不把它当路由执行（03 §4）。 */}
      {excerpt ? <p className="ins-card-text">{excerpt}</p> : null}

      <ThumbStrip moment={moment} onOpenPreview={onOpenPreview} />

      {moment.tags.length ? (
        <ul className="ins-tags" aria-label="标签">
          {moment.tags.map((tag) => (
            <li key={tag.id}>
              <SiteLink source="phone-link" className="ins-tag" href={`/apps/ins?tag=${encodeURIComponent(tag.name)}`}>
                #{tag.name}
              </SiteLink>
            </li>
          ))}
        </ul>
      ) : null}

      <footer className="ins-card-act">
        <SiteLink source="phone-link" className="ins-btn" href={detailPath}>
          查看详情
        </SiteLink>
        <FavoriteButton
          moment={moment}
          excerpt={excerpt}
          coverUrl={cover ? variantUrl(cover) : null}
        />
        <ShareButton momentId={moment.id} title={excerpt || "图文动态"} />
      </footer>
    </article>
  );
}

export function MomentCardSkeleton(): ReactNode {
  return (
    <article className="ins-card ins-card-skeleton" aria-hidden="true">
      <span className="ins-skeleton-line" />
      <span className="ins-skeleton-block" />
      <span className="ins-skeleton-line short" />
    </article>
  );
}

/** 加载骨架：`aria-busy` 让读屏知道这是「正在加载」而不是空内容。 */
export function FeedSkeleton({ count = 2 }: { count?: number }): ReactNode {
  return (
    <div className="ins-feed" aria-busy="true" role="status">
      <span className="visually-hidden">正在加载图文动态…</span>
      {Array.from({ length: count }, (_value, index) => (
        <MomentCardSkeleton key={index} />
      ))}
    </div>
  );
}
