"use client";

/**
 * 「同时收录到相册」编辑分区（第三轮任务书 §4.2–4.3，N4b）。
 *
 * 职责边界：
 *  - 只负责**收录选择**：相册列表读管理端点 `/api/v1/admin/albums`（含草稿），
 *    图片只能从「本条动态当前的图片」里逐张勾选（契约要求 `media_ids` 是动态图片的子集）；
 *  - **不**创建 / 发布相册、**不**复制动态正文当照片说明、**不**上传媒体 ——
 *    需要新相册时打开**现有**相册管理流程（新标签页），当前动态的文字 / 图片 / 收录
 *    选择都留在本页，回来后点「刷新相册列表」即可继续；
 *  - 不替服务端做最终判断：非法相册 / 不属于动态的图由服务端 409 整单拒绝，
 *    这里只做「提前可读提示」，真实失败仍由工作台展示服务端错误。
 *
 * 状态语义（与 N3 契约 §3.1 对齐）：
 *  - **配置存在 ≠ 公开资格**：相册是草稿时显示「已收录，待相册公开后展示」；
 *  - 相册已公开时也要等本条动态发布，图片才会进入照片墙 —— 文案不夸大。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { ApiClientError } from "@/lib/api/client";
import { fetchAdminAlbum, fetchAdminAlbums } from "@/features/gallery/api";
import type { AdminAlbum } from "@/features/gallery/types";

import {
  ALBUM_LINKS_HINT,
  cleanAlbumLinks,
  type MomentAlbumLink,
} from "../types";
import type { UploadedImage } from "./media-uploader";

/** 相册管理页（现有流程，不在本组件里复制一套新建 / 发布 UI）。 */
export const ALBUM_ADMIN_PATH = "/admin/albums";

export interface AlbumLinksEditorProps {
  /** 本条动态当前的图片（服务端确认过 ready 的那些）。 */
  images: readonly UploadedImage[];
  /** 当前收录选择（受控：由工作台持有，保证「保存草稿」与其他字段一起提交）。 */
  links: readonly MomentAlbumLink[];
  onChange: (links: MomentAlbumLink[]) => void;
  /** 会话 hook 提供的失败文案。 */
  describeError: (error: unknown) => string;
  /** 服务端返回的 `error.fields.album_links`（409/422 时由工作台传入，如实展示）。 */
  fieldError?: string | null;
  disabled?: boolean;
  /**
   * 可选：由调用方接管「新建相册」入口。
   *
   * 传入时渲染按钮而不是同级新标签页链接：调用方可以**先发起一次工作草稿保存**
   * （INS 独立编辑页的「新建相册往返不丢草稿」），再打开现有相册管理页。
   * 不传时保持原有链接行为 —— 旧工作台/旧页面完全不受影响。
   */
  onCreateAlbum?: () => void;
}

/** 相册卡上给站主看的公开状态文案（不把「已收录」说成「已展示」）。 */
export function albumPublicHint(album: Pick<AdminAlbum, "status">): string {
  return album.status === "published"
    ? "相册已公开：本条动态发布后，勾选的图片会进入照片墙。"
    : "已收录，待相册公开后展示（草稿相册不会自动发布）。";
}

export function AlbumLinksEditor({
  images,
  links,
  onChange,
  describeError,
  fieldError = null,
  disabled = false,
  onCreateAlbum,
}: AlbumLinksEditorProps): ReactNode {
  const [albums, setAlbums] = useState<readonly AdminAlbum[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
  const [listError, setListError] = useState<string | null>(null);
  const [pickedAlbumId, setPickedAlbumId] = useState("");
  const [query, setQuery] = useState("");
  /** 已选但不在当前列表页里的相册详情（分页外补取）。 */
  const [details, setDetails] = useState<ReadonlyMap<string, AdminAlbum>>(new Map());
  /** 补取详情明确 404 的相册 —— 只有这种才可以说「已不可用/已删除」。 */
  const [missingIds, setMissingIds] = useState<ReadonlySet<string>>(new Set());
  /** 补取详情失败（非 404）的相册：如实显示读取失败，不能当删除。 */
  const [detailErrors, setDetailErrors] = useState<ReadonlyMap<string, string>>(new Map());
  /** 列表达到 40 页 × 30 条上限后仍有 next_cursor：明确提示还有更多，不静默假装全量。 */
  const [listTruncated, setListTruncated] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const detailControllerRef = useRef<AbortController | null>(null);
  const attemptedDetails = useRef<Set<string>>(new Set());

  const loadAlbums = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setPhase("loading");
    setListError(null);
    setListTruncated(false);
    // 手动刷新：清掉上一次的补取结果，按新数据重新判断「缺失」。
    attemptedDetails.current = new Set();
    setMissingIds(new Set());
    setDetailErrors(new Map());
    setDetails(new Map());
    try {
      // 管理列表包含草稿：允许「先收录到草稿相册，待其公开后自动展示」（任务书 §4.2）。
      // 列表是 cursor 分页的：不能只读第一页（否则第 51 个之后的相册会被误判为不可用）。
      const collected: AdminAlbum[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 40; page += 1) {
        const result = await fetchAdminAlbums({ limit: 30, cursor }, controller.signal);
        if (controller.signal.aborted) return;
        collected.push(...result.items);
        cursor = result.next_cursor;
        if (!cursor) break;
      }
      setAlbums(collected);
      // 循环正常结束后 cursor 仍非空 = 达到 40 页上限但还有更多；给用户明确提示。
      setListTruncated(Boolean(cursor));
      setPhase("ready");
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
      setPhase("failed");
      setListError(describeError(error));
    }
  }, [describeError]);

  const refresh = useCallback(() => {
    // 同时取消补取详情的在途请求，避免旧结果覆盖新列表。
    detailControllerRef.current?.abort();
    void loadAlbums();
  }, [loadAlbums]);

  useEffect(() => {
    // 挂载后读一次相册列表；setState 都在 await 之后，不是级联渲染。
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 见上：setState 在 await 之后。
    void loadAlbums();
    return () => controllerRef.current?.abort();
  }, [loadAlbums]);

  const albumById = useMemo(() => {
    const map = new Map<string, AdminAlbum>();
    for (const album of albums) map.set(album.id, album);
    for (const album of details.values()) map.set(album.id, album);
    return map;
  }, [albums, details]);

  /**
   * 已选目标里没有出现在列表页的相册：单独补取管理详情。
   * 列表页只代表「这一页没返回」，不等于已删除 —— 只有详情 404 才判 missing。
   */
  useEffect(() => {
    const pending = links
      .map((link) => link.album_id)
      .filter((albumId) => !albumById.has(albumId) && !attemptedDetails.current.has(albumId));
    if (pending.length === 0) return;

    for (const albumId of pending) attemptedDetails.current.add(albumId);
    const controller = new AbortController();
    detailControllerRef.current = controller;

    for (const albumId of pending) {
      void fetchAdminAlbum(albumId, controller.signal)
        .then((album) => {
          if (controller.signal.aborted) return;
          setDetails((previous) => new Map(previous).set(albumId, album));
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          if (error instanceof DOMException && error.name === "AbortError") return;
          if (error instanceof ApiClientError && error.status === 404) {
            setMissingIds((previous) => new Set(previous).add(albumId));
            return;
          }
          setDetailErrors((previous) => new Map(previous).set(albumId, describeError(error)));
        });
    }
    // 刻意不在依赖变化时 abort：列表加载会更新 albumById，若在此时取消在途详情请求，
    // 「404 / 读取失败」的结论就永远不会落地（测试也钉住了这一点）。
    // 卸载与手动刷新通过 detailControllerRef 取消。
  }, [albumById, describeError, links]);

  useEffect(() => () => detailControllerRef.current?.abort(), []);

  const linkByAlbumId = useMemo(() => {
    const map = new Map<string, MomentAlbumLink>();
    for (const link of links) map.set(link.album_id, link);
    return map;
  }, [links]);

  // 只列还没被选中的相册（同一相册在一个动态里只允许一条选择）。
  const availableAlbums = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return albums
      .filter((album) => !linkByAlbumId.has(album.id))
      .filter(
        (album) =>
          keyword.length === 0 ||
          album.title.toLowerCase().includes(keyword) ||
          album.slug.toLowerCase().includes(keyword),
      );
  }, [albums, linkByAlbumId, query]);

  const updateLink = useCallback(
    (albumId: string, mediaIds: string[]) => {
      const next = links.map((link) =>
        link.album_id === albumId ? { album_id: albumId, media_ids: mediaIds } : link,
      );
      onChange(next);
    },
    [links, onChange],
  );

  const toggleMedia = useCallback(
    (albumId: string, mediaId: string, checked: boolean) => {
      const current = linkByAlbumId.get(albumId);
      const mediaIds = current?.media_ids ?? [];
      const next = checked
        ? [...mediaIds.filter((id) => id !== mediaId), mediaId]
        : mediaIds.filter((id) => id !== mediaId);
      // 顺序不在这里排序：服务端按动态图片 position 归一，界面按当前勾选顺序即可。
      updateLink(albumId, next);
    },
    [linkByAlbumId, updateLink],
  );

  const addAlbum = useCallback(() => {
    const album = availableAlbums.find((item) => item.id === pickedAlbumId);
    if (!album) return;
    // 添加相册不自动勾选图片：必须逐张选择（任务书 §4.2 第 1 条）。
    onChange([...links, { album_id: album.id, media_ids: [] }]);
    setPickedAlbumId("");
  }, [availableAlbums, links, onChange, pickedAlbumId]);

  const removeAlbum = useCallback(
    (albumId: string) => {
      onChange(links.filter((link) => link.album_id !== albumId));
    },
    [links, onChange],
  );

  const pendingCount = cleanAlbumLinks(links).length;
  const draftAlbumCount = cleanAlbumLinks(links).filter((link) => {
    const album = albumById.get(link.album_id);
    // 已不可用的相册单独提示，不能算成「等待公开」。
    return album !== undefined && album.status !== "published";
  }).length;

  return (
    <section className="ins-admin-albums" aria-label="同时收录到相册" data-album-links-editor="">
      <h2>同时收录到相册（可选）</h2>
      <p className="ins-admin-hint">{ALBUM_LINKS_HINT}</p>

      {fieldError ? (
        <p className="ins-admin-notice" role="alert" data-album-links-error="">
          {fieldError}
        </p>
      ) : null}

      <div className="ins-admin-albums-tools">
        <label className="ins-admin-field ins-admin-albums-search">
          <span>搜索相册（标题 / slug）</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="输入关键词过滤"
            disabled={disabled || phase !== "ready"}
            data-album-search=""
          />
        </label>
        <label className="ins-admin-field ins-admin-albums-pick">
          <span>选择已有相册</span>
          <select
            value={pickedAlbumId}
            onChange={(event) => setPickedAlbumId(event.target.value)}
            disabled={disabled || phase !== "ready" || availableAlbums.length === 0}
            data-album-picker=""
          >
            <option value="">
              {availableAlbums.length === 0 ? "没有可添加的相册" : "选择一个相册…"}
            </option>
            {availableAlbums.map((album) => (
              <option key={album.id} value={album.id}>
                {album.title}
                {album.status === "published" ? "（已公开）" : "（草稿）"}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="ins-btn"
          onClick={addAlbum}
          disabled={disabled || !pickedAlbumId}
        >
          添加相册
        </button>
        <button type="button" className="ins-btn" onClick={refresh} disabled={disabled}>
          刷新相册列表
        </button>
        {/* 新标签页打开**现有**相册管理流程：本页草稿（文字 / 图片 / 收录选择）不受影响。 */}
        {onCreateAlbum ? (
          <button
            type="button"
            className="ins-btn"
            data-album-admin-link=""
            onClick={onCreateAlbum}
            disabled={disabled}
          >
            新建相册（新标签页）
          </button>
        ) : (
          <a
            className="ins-btn"
            href={ALBUM_ADMIN_PATH}
            target="_blank"
            rel="noopener noreferrer"
            data-album-admin-link=""
          >
            新建相册（新标签页）
          </a>
        )}
      </div>
      <p className="ins-admin-hint">
        需要新相册时点「新建相册」——它打开的是现有相册管理页，不会自动发布；当前动态的
        文字、图片与收录选择都保留在这里，创建后回来点「刷新相册列表」即可选到它。
      </p>

      {phase === "loading" ? (
        <p className="ins-admin-hint" role="status">
          正在读取相册列表…
        </p>
      ) : null}
      {phase === "failed" && listError ? (
        <p className="ins-admin-notice" role="alert" data-album-list-error="">
          {listError}
          <button type="button" className="ins-btn" onClick={refresh} disabled={disabled}>
            重试
          </button>
        </p>
      ) : null}
      {phase === "ready" && listTruncated ? (
        <p className="ins-admin-notice" role="status" data-album-links-truncated="">
          相册列表已达本页加载上限（40 页 × 30 条 = 1200 个），仍有更多相册未加载。
          可用搜索过滤已加载项；已选相册会按 ID 校验，保存不受列表截断影响。
          如需完整管理，请到相册管理页查看。
        </p>
      ) : null}
      {phase === "ready" && albums.length === 0 ? (
        <p className="ins-admin-hint" role="status">
          还没有任何相册。可以先去「新建相册」建一个草稿相册；本动态之后仍可保存与发布，
          收录是可选项。
        </p>
      ) : null}

      {images.length === 0 ? (
        <p className="ins-admin-hint">本条动态还没有图片：先上传图片，再来勾选要收录的图。</p>
      ) : null}

      {links.length === 0 ? (
        <p className="ins-admin-hint" data-album-links-empty="">
          还没有选择任何相册（可选项）。
        </p>
      ) : (
        <ul className="ins-admin-album-list">
          {links.map((link) => {
            const album = albumById.get(link.album_id);
            const missing = !album && phase === "ready" && missingIds.has(link.album_id);
            const detailError = detailErrors.get(link.album_id) ?? null;
            return (
              <li
                key={link.album_id}
                className={`ins-admin-album${missing ? " is-missing" : ""}`}
                data-album-link={album?.slug ?? link.album_id}
              >
                <div className="ins-admin-album-head">
                  <strong>
                    {album?.title ??
                      (missing
                        ? "（相册已不可用）"
                        : detailError
                          ? "（相册状态读取失败）"
                          : phase === "failed"
                            ? "（相册列表读取失败）"
                            : "（正在读取相册…）")}
                  </strong>
                  <span className="ins-admin-album-meta">
                    {missing
                      ? "相册已不可用（可能已删除）：保存会被服务端拒绝，请先移除。"
                      : album
                        ? albumPublicHint(album)
                        : detailError
                          ? `相册状态读取失败：${detailError}。可点「刷新相册列表」重试；这不代表相册已删除。`
                          : "正在读取相册状态…"}
                  </span>
                  <button
                    type="button"
                    className="ins-btn"
                    onClick={() => removeAlbum(link.album_id)}
                    disabled={disabled}
                  >
                    移除相册
                  </button>
                </div>

                {images.length === 0 ? null : (
                  <ul className="ins-admin-album-media">
                    {images.map((image, index) => {
                      const checked = link.media_ids.includes(image.mediaId);
                      return (
                        <li key={image.mediaId}>
                          <label>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={disabled}
                              onChange={(event) =>
                                toggleMedia(link.album_id, image.mediaId, event.target.checked)
                              }
                            />
                            <span>
                              第 {index + 1} 张 · {image.alt.trim() || "（尚无替代文本）"}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <p className="ins-admin-hint">
                  已选 {link.media_ids.length} 张；图片说明与顺序由相册自己维护，不会复制动态正文。
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {pendingCount > 0 && draftAlbumCount > 0 ? (
        <p className="ins-admin-message" data-album-pending-note="">
          已收录，待相册公开后展示：{draftAlbumCount} 个目标相册还是草稿（草稿相册不会自动发布）。
        </p>
      ) : null}
    </section>
  );
}
