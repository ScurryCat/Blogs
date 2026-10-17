"use client";

/**
 * 生活图库的**相册视图**（`/gallery?view=albums`，第三轮任务书 §4.1）。
 *
 * 相册负责组织图片：这里只列相册（封面 / 标题 / 类型 / 张数 / 说明），点进去是
 * `/gallery?scope=album&album=<slug>`（相册自己的排序与说明由照片墙视图展示）。
 *
 * 约束：
 *  - 读公开相册接口（`/api/v1/gallery/albums`），**没有**自己的上传 / 发布 / 数据副本；
 *  - 首屏由服务端读好传进来，客户端只在「加载更多」与失败重试时请求；
 *  - 空态不编造相册、不填空占位卡；失败态如实显示原因（验收 §8.2「看不见就是看不见」）。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { AlbumCard } from "./album-card";
import { fetchAlbums } from "./api";
import { classifyFailure } from "./failure";
import { ALBUM_PAGE_SIZE, type AlbumKind, type AlbumSummary } from "./types";

export interface AlbumGalleryProps {
  /** 服务端读到的第一页相册。 */
  initialAlbums: readonly AlbumSummary[];
  initialCursor: string | null;
  /** 服务端读取失败的可读原因；非空时只显示失败态，不显示空态。 */
  loadError?: string | null;
  /** 相册类型筛选（沿 URL 传入；相册视图默认不筛选）。 */
  kind?: AlbumKind | null;
}

export function AlbumGallery({
  initialAlbums,
  initialCursor,
  loadError = null,
  kind = null,
}: AlbumGalleryProps): ReactNode {
  // 服务端给的第一页是派生基线：props 变化时列表回到新基线，不在 effect 里 setState
  // （与 gallery-view.tsx 同一套模式，React Compiler 不接受 effect 里同步 setState）。
  const [extra, setExtra] = useState<{ key: string; items: AlbumSummary[] } | null>(null);
  const [extraCursor, setExtraCursor] = useState<{ key: string; cursor: string | null } | null>(null);
  const [phase, setPhase] = useState<"idle" | "loading" | "failed">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const filterKey = kind ?? "";
  const albums: readonly AlbumSummary[] =
    extra && extra.key === filterKey ? [...initialAlbums, ...extra.items] : initialAlbums;
  const cursor =
    extraCursor && extraCursor.key === filterKey ? extraCursor.cursor : initialCursor;

  // 卸载时取消在途请求：晚到的响应不得写回状态（验收 §1）。
  useEffect(() => () => controllerRef.current?.abort(), []);

  const loadMore = useCallback(async () => {
    if (!cursor || phase === "loading") return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    await Promise.resolve();
    setPhase("loading");
    setMessage(null);
    try {
      const page = await fetchAlbums({ kind, cursor, limit: ALBUM_PAGE_SIZE }, controller.signal);
      setExtra({ key: filterKey, items: page.items });
      setExtraCursor({ key: filterKey, cursor: page.next_cursor });
      setPhase("idle");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setPhase("failed");
      setMessage(classifyFailure(error).message);
    }
  }, [cursor, filterKey, kind, phase]);

  if (loadError) {
    return (
      <div className="plg-state" role="status" data-gallery-albums-error="">
        <p className="plg-state-kicker">FAILED</p>
        <h2 className="plg-state-title">相册暂时读不出来</h2>
        <p className="plg-state-body">{loadError}</p>
        <button type="button" className="plg-button" onClick={() => window.location.reload()}>
          重新加载
        </button>
      </div>
    );
  }

  if (albums.length === 0) {
    return (
      <div className="plg-state" role="status" data-gallery-albums-empty="">
        <p className="plg-state-kicker">EMPTY</p>
        <h2 className="plg-state-title">还没有公开的相册</h2>
        <p className="plg-state-body">
          相册由站主在后台维护；这里不显示占位封面，也不编造张数。
        </p>
      </div>
    );
  }

  return (
    <div className="plg-album-view" data-album-gallery="">
      <div className="plg-album-grid" data-album-grid="">
        {albums.map((album) => (
          <AlbumCard key={album.id} album={album} />
        ))}
      </div>

      <p className="plg-group-meta" data-album-total="">
        共 {albums.length} 个相册
      </p>

      {cursor && !loadError ? (
        <div className="plg-more-row">
          <button
            type="button"
            className="plg-button"
            onClick={() => void loadMore()}
            disabled={phase === "loading"}
            data-load-more-albums=""
          >
            {phase === "loading" ? "正在读取…" : "加载更多相册"}
          </button>
        </div>
      ) : null}

      {phase === "failed" && message ? (
        <div className="plg-state" role="status" data-load-more-albums-error="">
          <p className="plg-state-body">{message}</p>
          <button type="button" className="plg-button" onClick={() => void loadMore()}>
            重试
          </button>
        </div>
      ) : null}
    </div>
  );
}
