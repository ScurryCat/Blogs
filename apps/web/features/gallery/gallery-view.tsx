"use client";

/**
 * 记忆画廊的**独立页视图**（`/showcase/photos`）。
 *
 * 这是「同一内容在手机与 canonical 页面使用同一功能视图和数据」里的 canonical 侧
 * （SHARED-CONTRACTS §1）；INS 的相册页签用 `ins-gallery-view.tsx` 复用同一批取数函数
 * 与同一个灯箱，**不复制图库**（验收 4）。
 *
 * 行为要点：
 *  - 首屏（照片 + 相册 + 年份）由服务端读好传进来，客户端不再空转一圈；
 *  - 「加载更多」按 `next_cursor` 追加，**不重复请求旧游标**（03 §9 用例 6）；
 *  - 相册 / 年份 / 类型筛选都写进 URL（可分享、可刷新、Back 可用），
 *    并用 `SiteLink` 跳转（站内链接一律走它，避免与 Next 的全局点击处理抢时序）；
 *  - 灯箱与「回到顶部」都不新增音频、不锁 body（滚动锁由 OverlayManager 统一管）。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { SiteLink } from "@/features/runtime/navigation/site-link";

import { AlbumCard } from "./album-card";
import { fetchWallPhotos } from "./api";
import { classifyFailure, groupByAlbum, IMAGE_FAILURE_TEXT } from "./failure";
import { Lightbox } from "./lightbox";
import { galleryHref, PHOTOS_PATH } from "./paths";
import { PhotoTile } from "./photo-tile";
import {
  albumKindLabel,
  isAlbumKind,
  WALL_PAGE_SIZE,
  type AlbumKind,
  type AlbumSummary,
  type Photo,
  type WallPhoto,
} from "./types";

export interface GalleryViewProps {
  /** 当前筛选（来自 URL 查询参数）。 */
  album: string | null;
  kind: AlbumKind | null;
  year: number | null;
  /** `album` = 相册浏览（手工顺序）；`global` = 按拍摄时间。由页面按 URL 决定。 */
  scope?: "global" | "album";
  /** 首屏数据（服务端已经读过；为 null 表示读取失败，页面给出失败态）。 */
  initialPhotos: readonly WallPhoto[];
  initialCursor: string | null;
  initialTotal: number;
  albums: readonly AlbumSummary[];
  years: readonly number[];
  /** 服务端读取失败的可读原因；非空时只显示失败态 + 重试。 */
  loadError?: string | null;
  /** 是否使用真正的导航宿主（独立页有运行时，所以为 true）。 */
  hasOverlayHost?: boolean;
}

export function GalleryView({
  album,
  kind,
  year,
  initialPhotos,
  initialCursor,
  initialTotal,
  albums,
  years,
  scope = "global",
  loadError = null,
  hasOverlayHost = true,
}: GalleryViewProps): ReactNode {
  // 服务端给的第一页是**派生基线**：筛选变化时 URL（也就是这些 props）变，
  // 下面的 `photos` / `cursor` / `total` 自动回到新基线 —— 不需要在 effect 里
  // setState（React Compiler 的 `react-hooks/set-state-in-effect` 会拒绝那种写法）。
  const [extra, setExtra] = useState<{ key: string; items: WallPhoto[] } | null>(null);
  const [extraCursor, setExtraCursor] = useState<{ key: string; cursor: string | null } | null>(null);
  const [extraTotal, setExtraTotal] = useState<{ key: string; total: number } | null>(null);
  const [phase, setPhase] = useState<"idle" | "loading" | "failed">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [grouped, setGrouped] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const tileRefs = useRef(new Map<string, HTMLButtonElement>());
  const controllerRef = useRef<AbortController | null>(null);

  const filterKey = `${scope}|${album ?? ""}|${kind ?? ""}|${year ?? ""}`;
  // 用 useMemo 包住派生结果：否则每次渲染都是新数组 / 新对象引用，
  // 依赖它们（`photos` / `cursor`）的 useCallback 会**每次渲染都重建**
  // （eslint react-hooks/exhaustive-deps 的警告），下游 memo 也会全部失效。
  const photos: readonly WallPhoto[] = useMemo(
    () => (extra && extra.key === filterKey ? [...initialPhotos, ...extra.items] : initialPhotos),
    [extra, filterKey, initialPhotos],
  );
  const cursor = useMemo(
    () => (extraCursor && extraCursor.key === filterKey ? extraCursor.cursor : initialCursor),
    [extraCursor, filterKey, initialCursor],
  );
  const total = extraTotal && extraTotal.key === filterKey ? extraTotal.total : initialTotal;

  // 卸载时取消在途请求：晚到的响应不得写回状态（验收 §1）。
  useEffect(() => () => controllerRef.current?.abort(), []);

  const loadMore = useCallback(async () => {
    if (!cursor || phase === "loading") return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    // 先让出一次事件循环再 setState：同一个 effect/事件里同步 setState 会触发
    // 级联渲染（React Compiler 的规则），也让「加载中」这一帧是真的画出来的。
    await Promise.resolve();
    setPhase("loading");
    setMessage(null);
    try {
      const page = await fetchWallPhotos(
        {
          scope,
          album,
          albumScope: scope === "album",
          kind,
          year,
          cursor,
          limit: WALL_PAGE_SIZE,
        },
        controller.signal,
      );
      setExtra({ key: filterKey, items: page.items });
      setExtraCursor({ key: filterKey, cursor: page.next_cursor });
      setExtraTotal({ key: filterKey, total: page.total });
      setPhase("idle");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      const failure = classifyFailure(error);
      setPhase("failed");
      setMessage(failure.message);
    }
  }, [album, cursor, filterKey, kind, phase, scope, year]);

  const openLightbox = useCallback((photo: Photo) => {
    const index = photos.findIndex((item) => item.photo.media_id === photo.media_id);
    if (index >= 0) setLightboxIndex(index);
  }, [photos]);

  const closeLightbox = useCallback(() => {
    const current = lightboxIndex === null ? null : photos[lightboxIndex];
    setLightboxIndex(null);
    if (current) {
      // 焦点还给触发它的图格（OverlayManager 的 restoreFocus 会在有宿主时也做一次，
      // 重复聚焦到同一个元素是无害的）。
      tileRefs.current.get(current.photo.media_id)?.focus();
    }
  }, [lightboxIndex, photos]);

  const flatPhotos = photos.map((item) => item.photo);
  const groups = grouped ? groupByAlbum(photos) : [];
  return (
    <div className="plg-wrap" data-gallery-view="">
      <div className="plg-filters" role="group" aria-label="照片筛选">
        <span className="plg-filter-label">相册</span>
        <SiteLink
          href={PHOTOS_PATH}
          source="phone-link"
          className="plg-chip-link"
          aria-current={album ? undefined : "page"}
          data-filter="album-all"
        >
          全部
        </SiteLink>
        {albums.map((item) => (
          <SiteLink
            key={item.id}
            href={galleryHref({ album: item.slug, kind, year })}
            source="phone-link"
            className="plg-chip-link"
            aria-current={album === item.slug ? "page" : undefined}
            data-filter={`album-${item.slug}`}
          >
            {item.title}
          </SiteLink>
        ))}
      </div>

      <div className="plg-filters" role="group" aria-label="类型与年份筛选">
        <span className="plg-filter-label">类型</span>
        {(["photo", "screenshot", "other"] as const).map((value) => (
          <SiteLink
            key={value}
            href={galleryHref({ album, kind: kind === value ? null : value, year })}
            source="phone-link"
            className="plg-chip-link"
            aria-pressed={kind === value}
            data-filter={`kind-${value}`}
          >
            {albumKindLabel(value)}
          </SiteLink>
        ))}
        {years.length > 0 ? <span className="plg-filter-label">年份</span> : null}
        {years.map((value) => (
          <SiteLink
            key={value}
            href={galleryHref({ album, kind, year: year === value ? null : value })}
            source="phone-link"
            className="plg-chip-link"
            aria-current={year === value ? "page" : undefined}
            data-filter={`year-${value}`}
          >
            {value}
          </SiteLink>
        ))}
        <button
          type="button"
          className="plg-chip"
          aria-pressed={grouped}
          onClick={() => setGrouped((value) => !value)}
          data-filter="group"
        >
          {grouped ? "按拍摄时间排" : "按相册分组"}
        </button>
      </div>

      {album ? (
        <p className="plg-lead" data-album-scope={scope}>
          {scope === "album"
            ? `正在看相册「${albums.find((item) => item.slug === album)?.title ?? album}」：顺序是站主排的。`
            : `已按相册「${albums.find((item) => item.slug === album)?.title ?? album}」筛选，仍按拍摄时间排序。`}
        </p>
      ) : null}

      {loadError ? (
        <div className="plg-state" role="status" data-gallery-error="">
          <p className="plg-state-kicker">FAILED</p>
          <h2 className="plg-state-title">照片墙暂时读不出来</h2>
          <p className="plg-state-body">{loadError}</p>
          <button type="button" className="plg-button" onClick={() => window.location.reload()}>
            重新加载
          </button>
        </div>
      ) : photos.length === 0 ? (
        <div className="plg-state" role="status" data-gallery-empty="">
          <p className="plg-state-kicker">EMPTY</p>
          <h2 className="plg-state-title">这个筛选下还没有照片</h2>
          <p className="plg-state-body">
            照片由站主在后台「相册」里维护。这里不显示占位图，也不编造张数。
          </p>
        </div>
      ) : grouped ? (
        groups.map((group) => (
          <section key={group.key} data-photo-group={group.albumSlug ?? ""}>
            <div className="plg-group-head">
              <h2 className="plg-group-title">
                {group.albumSlug ? (
                  <SiteLink
                    href={galleryHref({ album: group.albumSlug })}
                    source="phone-link"
                    className="plg-chip-link"
                  >
                    {group.albumTitle}
                  </SiteLink>
                ) : (
                  group.albumTitle
                )}
              </h2>
              <p className="plg-group-meta">
                {group.albumKindLabel} · 本页 {group.photos.length} 张
              </p>
            </div>
            <PhotoMasonry
              photos={group.photos}
              onOpen={openLightbox}
              registerTile={(mediaId) => (element) => {
                if (element) tileRefs.current.set(mediaId, element);
                else tileRefs.current.delete(mediaId);
              }}
            />
          </section>
        ))
      ) : (
        <PhotoMasonry
          photos={flatPhotos}
          onOpen={openLightbox}
          registerTile={(mediaId) => (element) => {
            if (element) tileRefs.current.set(mediaId, element);
            else tileRefs.current.delete(mediaId);
          }}
        />
      )}

      <p className="plg-group-meta" data-photo-total="">
        共 {total} 张照片
        {photos.length < total ? `，已显示 ${photos.length} 张` : ""}
      </p>

      {cursor && !loadError ? (
        <div className="plg-more-row">
          <button
            type="button"
            className="plg-button"
            onClick={() => void loadMore()}
            disabled={phase === "loading"}
            data-load-more=""
          >
            {phase === "loading" ? "正在读取…" : "加载更多照片"}
          </button>
        </div>
      ) : null}

      {phase === "failed" && message ? (
        <div className="plg-state" role="status" data-load-more-error="">
          <p className="plg-state-body">{message}</p>
          <button type="button" className="plg-button" onClick={() => void loadMore()}>
            重试
          </button>
        </div>
      ) : null}

      <p className="plg-group-meta" data-image-failure-text={IMAGE_FAILURE_TEXT}>
        {albums.length === 0 ? "还没有公开的相册。" : ""}
      </p>

      {lightboxIndex !== null ? (
        <Lightbox
          photos={flatPhotos}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onClosed={closeLightbox}
          albumTitle={photos[lightboxIndex]?.album.title}
          hasHost={hasOverlayHost}
        />
      ) : null}
    </div>
  );
}

interface PhotoMasonryProps {
  photos: readonly Photo[];
  onOpen: (photo: Photo) => void;
  registerTile: (mediaId: string) => (element: HTMLButtonElement | null) => void;
}

function PhotoMasonry({ photos, onOpen, registerTile }: PhotoMasonryProps): ReactNode {
  return (
    <div className="plg-masonry">
      {photos.map((photo) => (
        <PhotoTile
          key={`${photo.media_id}-${photo.position}`}
          photo={photo}
          onOpen={onOpen}
          buttonRef={registerTile(photo.media_id)}
        />
      ))}
    </div>
  );
}
