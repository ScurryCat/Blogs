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
import { createPortal } from "react-dom";

import { useOverlay } from "@/features/runtime/overlay-manager";
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
  // 缩略图已成功、灯箱再请求失败（图片失去公开引用 / 网络断开）时也要有可用降级。
  const [lightboxFailed, setLightboxFailed] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const alt = (card.alt ?? "").trim() || card.title.trim() || "照片";

  const close = useCallback(() => {
    setOpen(false);
    // 灯箱关闭后把焦点还给触发按钮（键盘用户不能丢焦点）。
    // preventScroll：归还焦点不能顺带把消息列表滚几像素（R2 验收要求滚动位置保留）。
    triggerRef.current?.focus({ preventScroll: true });
  }, []);

  const openLightbox = useCallback(() => {
    setLightboxFailed(false);
    setOpen(true);
  }, []);

  // 接入共享 OverlayManager：Escape 只关最上层灯箱，手机宿主不会同时收到关闭动作
  // （R2：此前 window 监听 + 手机宿主各自消费 Escape，一次按键退出整个 App）。
  useOverlay(
    {
      id: `msg-photo-lightbox-${card.id}`,
      onEscape: () => {
        close();
        return true;
      },
      lockScroll: true,
      restoreFocus: () => triggerRef.current?.focus({ preventScroll: true }),
    },
    open,
  );

  // 打开后把焦点放到关闭按钮：键盘用户的第一站，且不再依赖 window 级监听。
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
  }, [open]);

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
        onClick={openLightbox}
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
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
          className="msg-photo-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          onClick={close}
          // 无宿主时的 Escape 兜底；有宿主时 OverlayManager 在 document 上统一处理。
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            close();
          }}
        >
          <figure className="msg-photo-lightbox-figure" onClick={(event) => event.stopPropagation()}>
            {lightboxFailed ? (
              <p className="msg-photo-lightbox-fallback" role="status">
                {card.title || alt} · 图片暂时不可用（可能已失去公开引用）。可以关闭后继续浏览。
              </p>
            ) : (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element -- 同上：受权媒体变体 */}
                <img
                  className="msg-photo-lightbox-img"
                  src={card.url}
                  alt={alt}
                  onError={() => setLightboxFailed(true)}
                />
              </>
            )}
            <figcaption>{card.title || alt}</figcaption>
            <button
              type="button"
              className="msg-photo-lightbox-close"
              onClick={close}
              ref={closeRef}
            >
              关闭
            </button>
          </figure>
            </div>,
            document.body,
          )
        : null}
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
