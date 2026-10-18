"use client";

/**
 * 动态详情视图（03 §4「动态详情」）。
 *
 * 规则：
 *  - 显示完整文字与图片顺序；文字按**纯文本**处理，不接受 HTML，也不把正文里的
 *    URL 当站内路由执行（03 §4）；
 *  - `initial` 由服务端渲染传入（canonical 页面与手机视图共用同一份数据与组件）；
 *  - 未找到 / 已撤回有**不同**的提示（03 §4「必备状态」：动态撤回要单独说明）；
 *  - 图片预览复用同一个前景层组件，键盘可关、可翻页，不重建音乐。
 */

import { SiteLink } from "@/features/runtime/navigation/site-link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { ApiClientError, ApiTransportError } from "@/lib/api/client";

import { fetchMoment } from "./api";
import { FavoriteButton } from "./favorite-button";
import { ImagePreview } from "./image-preview";
import { InsOwnerEntry } from "./owner-entry";
import { ShareButton } from "./share-button";
import { formatPublishedAt, variantUrl, type Moment, type MomentImage } from "./types";

export interface DetailViewProps {
  momentId: string;
  /** 服务端已取到的数据；为 null 表示服务端确认 404（不再客户端重试）。 */
  initial?: Moment | null;
  /** 已确认不存在（服务端 404）。 */
  confirmedMissing?: boolean;
  /**
   * 服务端读取失败的原因。非空时**不再自动发起第二次请求**（避免重复打一个
   * 已知不健康的服务），而是显示失败态与「重新读取」按钮。
   */
  serverError?: string | null;
  /** 手机视图里不显示「返回列表」——返回由宿主统一处理（02 §6）。 */
  hideBackLink?: boolean;
}

type Phase = "ready" | "loading" | "missing" | "error";

function ImageStack({
  images,
  onOpen,
}: {
  images: readonly MomentImage[];
  onOpen: (index: number, element: HTMLElement | null) => void;
}): ReactNode {
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  return (
    <ol className="ins-detail-images">
      {images.map((image, index) => {
        const url = variantUrl(image, ["w1280.webp", "w640.webp", "w320.webp"]);
        const broken = failed[image.media_id];
        return (
          <li key={image.media_id} className="ins-detail-image">
            <button
              type="button"
              className="ins-detail-image-btn"
              onClick={(event) => onOpen(index, event.currentTarget)}
              // 与卡片里的缩略图用**同一套** aria-label 文案：两处入口对读屏用户应当一致。
              aria-label={`预览第 ${index + 1} 张图片：${image.alt}`}
            >
              {broken || !url ? (
                <span className="ins-image-failed" role="alert">
                  第 {index + 1} 张图片加载失败，可能已被撤回。
                </span>
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element -- 站主上传的媒体只通过 `/api/v1/media/{id}/{variant}` 出，且每次请求都重查公开引用（撤回后立即不可读，05 §8）。next/image 的远程优化器会缓存并代理这些字节，等于在授权层前面加一层缓存；本站又已经事先生成了固定宽度变体（w320/w640/w1280），所以刻意用原生 <img>。 */
                <img
                  src={url}
                  alt={image.alt}
                  onError={() =>
                    setFailed((previous) => ({ ...previous, [image.media_id]: true }))
                  }
                />
              )}
            </button>
            <p className="ins-detail-alt">{image.alt}</p>
          </li>
        );
      })}
    </ol>
  );
}

export function DetailView({
  momentId,
  initial = null,
  confirmedMissing = false,
  serverError = null,
  hideBackLink = false,
}: DetailViewProps): ReactNode {
  const router = useRouter();
  const [moment, setMoment] = useState<Moment | null>(initial);
  const [phase, setPhase] = useState<Phase>(
    initial ? "ready" : confirmedMissing ? "missing" : serverError ? "error" : "loading",
  );
  const [message, setMessage] = useState<string | null>(serverError);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // 客户端取数只在「服务端没有给数据、没有确认 404、也没有已知失败」时发生
  // （例如手机视图内切换 item）。已知失败时用按钮显式重试，不自动重打。
  useEffect(() => {
    if (initial || confirmedMissing || serverError) return undefined;
    const controller = new AbortController();
    void (async () => {
      try {
        const payload = await fetchMoment(momentId, controller.signal);
        if (controller.signal.aborted) return;
        setMoment(payload);
        setPhase("ready");
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (error instanceof ApiClientError && error.status === 404) {
          setPhase("missing");
          return;
        }
        setPhase("error");
        setMessage(
          error instanceof ApiTransportError
            ? "连不上服务，请检查网络后重试。"
            : error instanceof ApiClientError
              ? `读取失败（HTTP ${error.status}）：${error.message}`
              : "读取失败。",
        );
      }
    })();
    return () => controller.abort();
  }, [confirmedMissing, initial, momentId, serverError]);

  // 只在事件处理里写 ref、只在 effect 里读 —— 不在渲染期读写（React 纯度规则）。
  const openPreview = useCallback((index: number, element: HTMLElement | null) => {
    triggerRef.current = element;
    setPreviewIndex(index);
  }, []);

  // Escape / 关闭后把焦点还给触发预览的那张图。读 ref 发生在 effect 里，不参与渲染。
  const restorePreviewFocus = useCallback(() => {
    triggerRef.current?.focus?.();
  }, []);

  if (phase === "loading") {
    return (
      <section className="ins-detail" aria-busy="true" role="status">
        <p className="ins-loading">正在读取这条动态…</p>
      </section>
    );
  }

  if (phase === "missing") {
    return (
      <section className="ins-detail ins-state" role="status">
        <p className="ins-state-kicker">NOT AVAILABLE</p>
        <h2>这条动态已经撤回或不可访问</h2>
        <p>它可能被站主撤回、删除，或链接里的编号不正确。</p>
        {hideBackLink ? null : (
          <SiteLink source="phone-link" className="ins-btn" href="/apps/ins">
            回到图文动态
          </SiteLink>
        )}
      </section>
    );
  }

  if (phase === "error" || !moment) {
    return (
      <section className="ins-detail ins-state ins-state-error" role="alert">
        <p className="ins-state-kicker">READ FAILED</p>
        <p>{message ?? "读取失败。"}</p>
        <div className="ins-card-act" style={{ justifyContent: "center" }}>
          <button
            type="button"
            className="ins-btn red"
            onClick={() => {
              // 重新跑一次服务端渲染：页面本身是 force-dynamic，因此这是真实的重读。
              setMessage(null);
              setPhase("loading");
              router.refresh();
            }}
          >
            重新读取
          </button>
          {hideBackLink ? null : (
            <SiteLink source="phone-link" className="ins-btn" href="/apps/ins">
              回到图文动态
            </SiteLink>
          )}
        </div>
      </section>
    );
  }

  const excerpt = moment.text.slice(0, 60);
  // `noUncheckedIndexedAccess` 下 `images[0]` 可能是 undefined，先取出来再收窄。
  const cover = moment.images[0];

  return (
    <article className="ins-detail" data-moment-id={moment.id}>
      {hideBackLink ? null : (
        <nav className="ins-detail-nav">
          <SiteLink source="phone-link" className="ins-btn" href="/apps/ins">
            返回列表
          </SiteLink>
        </nav>
      )}

      {/* 站主入口：只在确认站主登录后由组件自己渲染（详情页「编辑当前动态」）。 */}
      <InsOwnerEntry kind="ins-edit" momentId={moment.id} />

      <header className="ins-detail-head">
        <p className="ins-card-kicker">{"// MOMENT"}</p>
        <time dateTime={moment.published_at ?? undefined}>
          {formatPublishedAt(moment.published_at)}
        </time>
      </header>

      {/* 纯文本：不做 markdown / HTML 解析，也不把 URL 变成站内跳转（03 §4）。 */}
      {moment.text ? <p className="ins-detail-text">{moment.text}</p> : null}

      <ImageStack images={moment.images} onOpen={openPreview} />

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
        <FavoriteButton
          moment={moment}
          excerpt={excerpt}
          coverUrl={cover ? variantUrl(cover) : null}
        />
        <ShareButton momentId={moment.id} title={excerpt || "图文动态"} />
      </footer>

      {previewIndex !== null ? (
        <ImagePreview
          images={moment.images}
          index={previewIndex}
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
          onClosed={restorePreviewFocus}
        />
      ) : null}
    </article>
  );
}
