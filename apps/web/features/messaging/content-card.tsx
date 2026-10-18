"use client";

/**
 * 内容卡片（08 §3）：服务端验证过的**公开**内容引用，前端只负责渲染成站内链接。
 *
 * 三条硬规则：
  1. `url` 是服务端在写入消息时按当前公开状态解析出来的。前端**不**自己拼路径，
     也不接受模型给的任何 URL —— 这里渲染的只是 `kind` + `id` + 由服务端给出的 url。
  2. 一律用 `SiteLink`（T02 的导航协调器）：裸 `<a href="/…">` 或自己写 onClick
     拦截会让部分跳转退化成整页重载，把音乐打断。
  3. 纯文本渲染，没有 `dangerouslySetInnerHTML`：标题与摘要都来自数据库里的用户/模型内容，
     按不可信输入对待。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { SiteLink } from "@/features/runtime/navigation/site-link";

import type { Card } from "./types";

const KIND_LABEL: Record<string, string> = {
  post: "文章",
  moment: "图文动态",
  path: "站内入口",
  image: "照片",
  album_photo: "相册照片",
};

/** 图片卡：白框拍立得图 + 说明；点击打开轻量灯箱（Escape 关闭并归还焦点）。 */
function ImageCard({ card }: { card: Card }): ReactNode {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const alt = (card.alt ?? "").trim() || card.title.trim() || "照片";

  const close = useCallback(() => {
    setOpen(false);
    // 灯箱关闭后把焦点还给触发按钮（键盘用户不能丢焦点）。
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close, open]);

  if (failed) {
    return (
      <span className="msg-photo-fallback" role="status">
        {card.title || "这张照片"} · 图片暂时不可用
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        className="msg-photo"
        onClick={() => setOpen(true)}
        aria-label={`查看图片：${alt}`}
        ref={triggerRef}
      >
        {/* 服务端生成的 w640 变体地址；原图永远不对访客开放。 */}
        {/* eslint-disable-next-line @next/next/no-img-element -- 媒体端点按请求授权 + 变体，不走 next/image 缓存 */}
        <img
          className="msg-photo-img"
          src={card.url}
          alt={alt}
          width={card.width ?? undefined}
          height={card.height ?? undefined}
          loading="lazy"
          onError={() => setFailed(true)}
        />
        {card.title ? <span className="msg-photo-caption">{card.title}</span> : null}
      </button>
      {open ? (
        <div
          className="msg-photo-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          onClick={close}
        >
          <figure className="msg-photo-lightbox-figure" onClick={(event) => event.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element -- 同上：受权媒体变体 */}
            <img className="msg-photo-lightbox-img" src={card.url} alt={alt} />
            <figcaption>{card.title || alt}</figcaption>
            <button type="button" className="msg-photo-lightbox-close" onClick={close}>
              关闭
            </button>
          </figure>
        </div>
      ) : null}
    </>
  );
}

export interface ContentCardProps {
  card: Card;
  /** 手机里用 phone-internal（短过渡），独立页用 phone-link。 */
  source?: "phone-internal" | "phone-link";
}

export function ContentCard({ card, source = "phone-link" }: ContentCardProps): ReactNode {
  if (card.kind === "image" || card.kind === "album_photo") {
    return <ImageCard card={card} />;
  }
  return (
    <SiteLink className="msg-card" href={card.url} source={source}>
      <span className="msg-card-kind">{KIND_LABEL[card.kind] ?? "站内内容"}</span>
      <span className="msg-card-title">{card.title}</span>
      {card.summary ? <span className="msg-card-summary">{card.summary}</span> : null}
    </SiteLink>
  );
}

export function ContentCardList({
  cards,
  source,
}: {
  cards: readonly Card[];
  source?: ContentCardProps["source"];
}): ReactNode {
  if (cards.length === 0) return null;
  return (
    <ul className="msg-cards">
      {cards.map((card) => (
        <li key={`${card.kind}:${card.id}`}>
          <ContentCard card={card} source={source} />
        </li>
      ))}
    </ul>
  );
}

export { KIND_LABEL };
