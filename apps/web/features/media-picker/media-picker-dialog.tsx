"use client";

/**
 * 共享图片选择器（P5 第一批 · C3；契约 §4.3 / §9.5）。
 *
 * INS 动态与手记共用：上传新图 / 分页浏览站主媒体 / 查看缩略图·尺寸·上传状态 /
 * 多选、排序、移除、逐图替代文本 / 公开引用提示 / 超上限禁用 / 失败保留已选 /
 * 关闭不丢已确认选择（**只有「确定」才回写**）。
 *
 * 数据边界（设计书 §3.4）：
 *  - 这里管理的是**站主内容媒体**，不是 P5 参考素材库，两者不合并；
 *  - 复用图片引用同一 media ID，不重复上传；
 *  - 草稿对媒体的保留关系不授予匿名访问权限，缩略图仍走已认证接口。
 *
 * 交互约定：
 *  - 受控：`open` 由调用方持有；关闭（取消 / Escape / 右上角）只调用 `onClose`，
 *    不改调用方已确认的选择；「确定」时给出 `PickedImage[]`（顺序 = 数组顺序）。
 *  - 每次打开都从 `selected` 重新初始化内部状态，因此二次编辑不需要额外参数。
 *  - 手机触控目标 ≥44px（见 media-picker.css）；data-* 属性按契约 §9.5 固定。
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import { ApiClientError } from "@/lib/api/client";

import { describeMediaUploadError, getAdminMedia, listAdminMedia, uploadMedia } from "./api";
import { MediaThumb } from "./media-thumb";
import "./media-picker.css";
import {
  LOCAL_PREVIEW_NOTE,
  MEDIA_ALT_MAX_CODEPOINTS,
  MEDIA_PICKER_ALT_HINT,
  MEDIA_PICKER_DEFAULT_MAX,
  MEDIA_PICKER_PAGE_SIZE,
  MEDIA_UPLOAD_ACCEPT,
  PUBLIC_REFERENCE_BADGE,
  PUBLIC_REFERENCE_WARNING,
  TOO_LARGE_MESSAGE,
  UNSUPPORTED_FORMAT_MESSAGE,
  codepointLength,
  isMediaReady,
  isPubliclyReferenced,
  mediaMetaLabel,
  mediaSizeLabel,
  mediaStatusLabel,
  mergeMediaPages,
  normalizePickedImages,
  toPickedImages,
  validateImageFile,
  type MediaAdminOut,
  type MediaPickerMedia,
  type PickedImage,
} from "./types";

export interface MediaPickerDialogProps {
  open: boolean;
  csrfToken: string;
  /** 编辑器当前已选（顺序即发布顺序）；每次打开都会从这里重新初始化。 */
  selected: PickedImage[];
  /** 确定：回写新的已选数组（顺序 = 数组顺序）。 */
  onConfirm(next: PickedImage[]): void;
  /** 取消 / 关闭 / 确定之后都会调用；调用方只需把 open 置 false。 */
  onClose(): void;
  /** 最多可选张数，默认 9（INS 发布上限）。 */
  max?: number;
  /** 是否显示「上传新图」，默认 true。 */
  allowUpload?: boolean;
}

/** 已选区的一行内部状态：媒体详情可能尚未取到（不在当前列表页时不误判失效）。 */
interface PickedEntry {
  media_id: string;
  alt: string;
  media: MediaAdminOut | null;
  /** 补取详情明确 404：不可用（保留显示，不静默丢弃）。 */
  unavailable?: boolean;
  /** 补取详情失败（非 404）：读取失败，**不等于**失效。 */
  loadError?: boolean;
}

interface LocalPreview {
  key: string;
  name: string;
  url: string | null;
  status: "uploading" | "failed";
  reason?: string;
}

const MAX_ALT = MEDIA_ALT_MAX_CODEPOINTS;

/** jsdom / 隐私模式下 createObjectURL 可能不可用：降级为无本地预览，但上传照常。 */
function safeObjectUrl(file: File): string | null {
  try {
    return URL.createObjectURL(file);
  } catch {
    return null;
  }
}

export function MediaPickerDialog({
  open,
  csrfToken,
  selected,
  onConfirm,
  onClose,
  max = MEDIA_PICKER_DEFAULT_MAX,
  allowUpload = true,
}: MediaPickerDialogProps): ReactNode {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);

  const [items, setItems] = useState<MediaPickerMedia[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [listPhase, setListPhase] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [picked, setPicked] = useState<PickedEntry[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localPreviews, setLocalPreviews] = useState<LocalPreview[]>([]);

  const listController = useRef<AbortController | null>(null);
  const detailController = useRef<AbortController | null>(null);
  const uploadControllers = useRef<AbortController[]>([]);
  const attemptedDetails = useRef<Set<string>>(new Set());
  // 已选 / 本地预览的最新值：异步回调里读 ref，避免闭包读到旧数组。
  const pickedRef = useRef<PickedEntry[]>([]);
  const previewsRef = useRef<LocalPreview[]>([]);
  const selectedRef = useRef<PickedImage[]>([]);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  useEffect(() => {
    pickedRef.current = picked;
  }, [picked]);
  useEffect(() => {
    previewsRef.current = localPreviews;
  }, [localPreviews]);

  // 卸载时释放所有本地预览 object URL（没有这一步会泄漏 blob）。
  useEffect(
    () => () => {
      previewsRef.current.forEach((item) => {
        if (item.url) URL.revokeObjectURL(item.url);
      });
      uploadControllers.current.forEach((controller) => controller.abort());
    },
    [],
  );

  const loadPage = useCallback(async (nextCursor: string | null, mode: "replace" | "append") => {
    listController.current?.abort();
    const controller = new AbortController();
    listController.current = controller;
    if (mode === "replace") {
      setListPhase("loading");
      setListError(null);
    } else {
      setLoadingMore(true);
    }
    try {
      const page = await listAdminMedia(
        { cursor: nextCursor, limit: MEDIA_PICKER_PAGE_SIZE },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setItems((previous) =>
        mode === "replace" ? page.items : mergeMediaPages(previous, page.items),
      );
      setCursor(page.next_cursor);
      setListPhase("ready");
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure instanceof DOMException && failure.name === "AbortError") return;
      setListError(describeReadFailure(failure));
      // 追加失败时保留已读到的内容，只在列表下方说明原因。
      if (mode === "replace") setListPhase("failed");
    } finally {
      if (!controller.signal.aborted) setLoadingMore(false);
    }
  }, []);

  // 每次打开：重置为调用方当前选择、清空提示、从第一页读媒体库。
  useEffect(() => {
    if (!open) return undefined;
    attemptedDetails.current = new Set();
    setPicked(
      normalizePickedImages(selectedRef.current, max).map((item) => ({
        media_id: item.media_id,
        alt: item.alt,
        media: item.media ?? null,
      })),
    );
    setNotice(null);
    setError(null);
    setLocalPreviews([]);
    setItems([]);
    setCursor(null);
    setListPhase("loading");
    setListError(null);
    setLoadingMore(false);
    void loadPage(null, "replace");
    // 打开后把焦点放进对话框：键盘用户不会继续停在背后的页面上。
    panelRef.current?.focus?.();
    return () => {
      listController.current?.abort();
      detailController.current?.abort();
      uploadControllers.current.forEach((controller) => controller.abort());
      uploadControllers.current = [];
    };
    // 只依赖 open/max/loadPage：selected 变化不应重置用户正在编辑的内部状态。
  }, [open, max, loadPage]);

  // 已选里「媒体详情未知」的条目：按 ID 补取详情（只 404 才算不可用）。
  useEffect(() => {
    if (!open) return;
    const missing = picked
      .filter(
        (entry) =>
          !entry.media &&
          !entry.unavailable &&
          !entry.loadError &&
          !attemptedDetails.current.has(entry.media_id),
      )
      .map((entry) => entry.media_id);
    if (missing.length === 0) return;

    const controller = new AbortController();
    detailController.current = controller;
    for (const mediaId of missing) {
      attemptedDetails.current.add(mediaId);
      void getAdminMedia(mediaId, controller.signal)
        .then((media) => {
          if (controller.signal.aborted) return;
          setPicked((previous) =>
            previous.map((entry) =>
              entry.media_id === mediaId ? { ...entry, media, unavailable: false } : entry,
            ),
          );
        })
        .catch((failure: unknown) => {
          if (controller.signal.aborted) return;
          if (failure instanceof DOMException && failure.name === "AbortError") return;
          const unavailable = failure instanceof ApiClientError && failure.status === 404;
          setPicked((previous) =>
            previous.map((entry) =>
              entry.media_id === mediaId
                ? { ...entry, unavailable, loadError: !unavailable }
                : entry,
            ),
          );
          if (unavailable) {
            setError("有一张已选图片已不可用（可能已被删除）；请移除它再保存，或重新选择一张。");
          } else {
            setError("有一张已选图片的详情读取失败。它不代表图片失效，可以稍后重试。");
          }
        });
    }
    // 补取完成会更新 picked，从而结束这个 effect；attempted 集合防止反复请求。
  }, [open, picked]);

  // Escape 关闭：与站内浮层语义一致（只关最上层选择器）。
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const selectedIds = useMemo(() => new Set(picked.map((entry) => entry.media_id)), [picked]);
  const atMax = picked.length >= max;

  const toggleItem = useCallback(
    (media: MediaPickerMedia) => {
      if (selectedIds.has(media.id)) {
        setPicked((previous) => previous.filter((entry) => entry.media_id !== media.id));
        return;
      }
      if (pickedRef.current.length >= max) {
        setNotice(`最多选择 ${max} 张图片：先取消一张，再添加新的。`);
        return;
      }
      if (!isMediaReady(media)) {
        setError("这张图片还没处理完成，暂时不能加入草稿。");
        return;
      }
      setPicked((previous) =>
        previous.some((entry) => entry.media_id === media.id)
          ? previous
          : [...previous, { media_id: media.id, alt: "", media }],
      );
    },
    [max, selectedIds],
  );

  const setAlt = useCallback((mediaId: string, alt: string) => {
    setPicked((previous) =>
      previous.map((entry) =>
        entry.media_id === mediaId ? { ...entry, alt: Array.from(alt).slice(0, MAX_ALT).join("") } : entry,
      ),
    );
  }, []);

  const move = useCallback((index: number, delta: number) => {
    setPicked((previous) => {
      const target = index + delta;
      if (target < 0 || target >= previous.length) return previous;
      const next = [...previous];
      const current = next[index];
      const swap = next[target];
      if (!current || !swap) return previous;
      next[index] = swap;
      next[target] = current;
      return next;
    });
  }, []);

  const remove = useCallback((mediaId: string) => {
    setPicked((previous) => previous.filter((entry) => entry.media_id !== mediaId));
  }, []);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setError(null);
      setNotice(null);
      let uploaded = 0;
      let rejected = 0;
      let skippedByMax = 0;

      for (const file of Array.from(files)) {
        if (pickedRef.current.length >= max) {
          skippedByMax += 1;
          continue;
        }
        const localKey = `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`;
        const previewUrl = safeObjectUrl(file);
        const rejection = validateImageFile(file);
        if (rejection) {
          rejected += 1;
          setLocalPreviews((previous) => [
            ...previous,
            { key: localKey, name: file.name, url: previewUrl, status: "failed", reason: rejection },
          ]);
          continue;
        }

        setLocalPreviews((previous) => [
          ...previous,
          { key: localKey, name: file.name, url: previewUrl, status: "uploading" },
        ]);
        const controller = new AbortController();
        uploadControllers.current.push(controller);
        try {
          const media = await uploadMedia(file, csrfToken, { signal: controller.signal });
          if (controller.signal.aborted) return;
          uploaded += 1;
          // 新上传的图也放进媒体库列表最前面，并在已选区里按上传顺序追加。
          setItems((previous) => mergeMediaPages([media], previous));
          setPicked((previous) =>
            previous.some((entry) => entry.media_id === media.id) || previous.length >= max
              ? previous
              : [...previous, { media_id: media.id, alt: "", media }],
          );
          setLocalPreviews((previous) => previous.filter((item) => item.key !== localKey));
          if (previewUrl) URL.revokeObjectURL(previewUrl);
        } catch (failure) {
          if (failure instanceof DOMException && failure.name === "AbortError") return;
          const reason = describeMediaUploadError(failure);
          setLocalPreviews((previous) =>
            previous.map((item) =>
              item.key === localKey ? { ...item, status: "failed", reason } : item,
            ),
          );
          setError(
            `「${file.name}」没有上传成功：${reason}已选图片都还在，可以重新选择后重试。`,
          );
        }
      }

      if (uploaded > 0) setNotice(`已上传 ${uploaded} 张图片，并加入已选。`);
      if (rejected > 0) setNotice(`有 ${rejected} 个文件不符合格式或大小要求，没有上传。`);
      if (skippedByMax > 0) setNotice(`已达上限 ${max} 张，有 ${skippedByMax} 个文件没有上传。`);
    },
    [csrfToken, max],
  );

  const confirm = useCallback(() => {
    onConfirm(
      toPickedImages(
        picked.map((entry) => ({
          media_id: entry.media_id,
          alt: entry.alt,
          ...(entry.media ? { media: entry.media } : {}),
        })),
      ),
    );
    // 先回写再关闭：调用方只处理 onConfirm 或只把 open 置 false 都能工作。
    onClose();
  }, [onClose, onConfirm, picked]);

  if (!open) return null;

  return (
    <div className="mpx-overlay" data-media-picker="" role="presentation">
      <div
        className="mpx-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={panelRef}
      >
        <header className="mpx-head">
          <div>
            <h2 id={titleId}>选择图片</h2>
            <p className="mpx-sub">
              从媒体库选择或上传新图；顺序即发布顺序，替代文本发布前必填。
            </p>
          </div>
          <button
            type="button"
            className="mpx-btn mpx-close"
            aria-label="关闭图片选择器"
            data-media-picker-close=""
            onClick={onClose}
          >
            关闭
          </button>
        </header>

        {notice ? (
          <p className="mpx-notice" role="status" data-media-picker-notice="">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="mpx-notice is-error" role="alert" data-media-picker-error="">
            {error}
          </p>
        ) : null}

        {/* ---------- 已选：顺序 / 移除 / 逐图替代文本 ---------- */}
        <section className="mpx-selected" aria-label="已选图片">
          <h3 className="mpx-section-title">
            已选 <strong>{picked.length}</strong> / {max} 张
          </h3>
          {picked.length === 0 ? (
            <p className="mpx-hint" data-media-picker-empty-selected="">
              还没有选择图片。草稿可以先不选图；正式发布动态至少需要 1 张。
            </p>
          ) : (
            <>
              <ol className="mpx-picked-list">
                {picked.map((entry, index) => {
                  const altLength = codepointLength(entry.alt.trim());
                  return (
                    <li
                      key={entry.media_id}
                      className="mpx-picked-item"
                      data-media-picker-picked=""
                      data-media-id={entry.media_id}
                    >
                      <span className="mpx-order" aria-hidden="true">
                        {index + 1}
                      </span>
                      {entry.media ? (
                        <MediaThumb media={entry.media} size="sm" />
                      ) : (
                        <span className="mpx-thumb is-sm is-fallback" aria-hidden="true">
                          无预览
                        </span>
                      )}
                      <div className="mpx-picked-body">
                        <p className="mpx-meta">
                          {entry.media
                            ? mediaMetaLabel(entry.media)
                            : entry.unavailable
                              ? "图片已不可用（可能已被删除）"
                              : entry.loadError
                                ? "图片状态读取失败（不代表已删除）"
                                : "正在读取图片…"}
                        </p>
                        {entry.media && isPubliclyReferenced(entry.media) ? (
                          <p className="mpx-warn" data-media-picker-warning="">
                            {PUBLIC_REFERENCE_WARNING}
                          </p>
                        ) : null}
                        <label className="mpx-alt">
                          <span>替代文本</span>
                          <input
                            type="text"
                            value={entry.alt}
                            maxLength={MAX_ALT}
                            data-media-picker-alt=""
                            aria-label={`第 ${index + 1} 张图片的替代文本`}
                            aria-invalid={altLength === 0 ? true : undefined}
                            onChange={(event) => setAlt(entry.media_id, event.target.value)}
                          />
                          <small>
                            {altLength}/{MAX_ALT} 字{altLength === 0 ? "（发布前必填）" : ""}
                          </small>
                        </label>
                      </div>
                      <div className="mpx-picked-act">
                        <button
                          type="button"
                          className="mpx-btn"
                          data-media-picker-move-up=""
                          onClick={() => move(index, -1)}
                          disabled={index === 0}
                        >
                          上移
                        </button>
                        <button
                          type="button"
                          className="mpx-btn"
                          data-media-picker-move-down=""
                          onClick={() => move(index, 1)}
                          disabled={index === picked.length - 1}
                        >
                          下移
                        </button>
                        <button
                          type="button"
                          className="mpx-btn is-danger"
                          data-media-picker-remove=""
                          onClick={() => remove(entry.media_id)}
                        >
                          移除
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ol>
              <p className="mpx-hint">{MEDIA_PICKER_ALT_HINT}</p>
            </>
          )}
        </section>

        {/* ---------- 上传新图 ---------- */}
        {allowUpload ? (
          <section className="mpx-upload" aria-label="上传新图片">
            <label className="mpx-upload-label">
              <span>上传新图（JPEG / PNG / WebP，单张 ≤ 8 MiB；暂不支持 HEIC，也不会自动转换）</span>
              <input
                type="file"
                accept={MEDIA_UPLOAD_ACCEPT}
                multiple
                data-media-picker-upload=""
                onChange={(event) => {
                  void handleFiles(event.target.files);
                  event.target.value = "";
                }}
              />
            </label>
            {localPreviews.length > 0 ? (
              <ul className="mpx-locals" aria-label="上传中的本地预览">
                {localPreviews.map((item) => (
                  <li key={item.key} className={`mpx-local is-${item.status}`}>
                    {item.url ? (
                      /* eslint-disable-next-line @next/next/no-img-element -- 本地 object URL 预览，没有远端地址可优化。 */
                      <img src={item.url} alt="" width={56} height={42} />
                    ) : null}
                    <span>
                      {item.name} ·{" "}
                      {item.status === "uploading" ? "上传中…" : `${LOCAL_PREVIEW_NOTE}（${item.reason ?? "失败"}）`}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}

        {/* ---------- 媒体库分页浏览 ---------- */}
        <section className="mpx-library" aria-label="媒体库">
          <h3 className="mpx-section-title">媒体库</h3>
          {atMax ? (
            <p className="mpx-notice" role="status" data-media-picker-max="">
              已选满 {max} 张，未选中的图片暂时不能点选；取消一张后可继续添加。
            </p>
          ) : null}

          {listPhase === "loading" ? (
            <p className="mpx-hint" role="status">
              正在读取媒体库…
            </p>
          ) : listPhase === "failed" ? (
            <div className="mpx-state" role="alert">
              <p>{listError ?? "媒体库读取失败。"}</p>
              <button
                type="button"
                className="mpx-btn"
                data-media-picker-retry=""
                onClick={() => void loadPage(null, "replace")}
              >
                重新读取
              </button>
            </div>
          ) : items.length === 0 ? (
            <p className="mpx-hint" data-media-picker-empty="">
              媒体库还没有图片。{allowUpload ? "可以用上面的「上传新图」开始。" : ""}
            </p>
          ) : (
            <>
              <ul className="mpx-grid">
                {items.map((media) => {
                  const isSelected = selectedIds.has(media.id);
                  const order = picked.findIndex((entry) => entry.media_id === media.id);
                  const ready = isMediaReady(media);
                  const disabled = !isSelected && (atMax || !ready);
                  return (
                    <li key={media.id} className="mpx-grid-item">
                      <button
                        type="button"
                        className={`mpx-media${isSelected ? " is-selected" : ""}`}
                        data-media-picker-item=""
                        data-media-id={media.id}
                        aria-pressed={isSelected}
                        aria-label={`${isSelected ? "取消选择" : "选择"}图片：${mediaSizeLabel(media)}${isSelected ? `（已选第 ${order + 1} 张）` : ""}`}
                        disabled={disabled}
                        onClick={() => toggleItem(media)}
                      >
                        <MediaThumb media={media} />
                        <span className="mpx-media-meta">{mediaMetaLabel(media)}</span>
                        {isSelected ? (
                          <span className="mpx-media-order">已选 #{order + 1}</span>
                        ) : null}
                        {isPubliclyReferenced(media) ? (
                          <span className="mpx-media-warn" data-media-picker-warning="">
                            <strong>{PUBLIC_REFERENCE_BADGE}</strong>
                            <span>{PUBLIC_REFERENCE_WARNING}</span>
                          </span>
                        ) : null}
                        {!ready ? (
                          <span className="mpx-media-state">
                            {mediaStatusLabel(media)}：暂不可选
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {listError ? (
                <p className="mpx-notice is-error" role="alert">
                  {listError}
                </p>
              ) : null}
              {cursor ? (
                <div className="mpx-more">
                  <button
                    type="button"
                    className="mpx-btn"
                    data-media-picker-next=""
                    disabled={loadingMore}
                    onClick={() => void loadPage(cursor, "append")}
                  >
                    {loadingMore ? "加载中…" : "加载更多"}
                  </button>
                </div>
              ) : (
                <p className="mpx-hint">已经到底了。</p>
              )}
            </>
          )}
        </section>

        <footer className="mpx-foot">
          <p className="mpx-foot-count">
            已选 {picked.length} / {max} 张
          </p>
          <div className="mpx-foot-act">
            <button
              type="button"
              className="mpx-btn"
              data-media-picker-cancel=""
              onClick={onClose}
            >
              取消
            </button>
            <button
              type="button"
              className="mpx-btn is-primary"
              data-media-picker-confirm=""
              onClick={confirm}
            >
              确定（{picked.length} 张）
            </button>
          </div>
          <p className="mpx-hint">确定后才写回编辑器；取消不会丢掉之前已选中的图片。</p>
        </footer>
      </div>
    </div>
  );
}

/** 读取/上传失败的文案：读取失败来自 api 层，上传失败同源翻译（不伪造成功）。 */
function describeReadFailure(error: unknown): string {
  if (error instanceof ApiClientError) {
    switch (error.status) {
      case 401:
        return "登录已失效，请刷新页面重新登录。";
      case 403:
        return "请求来源或 CSRF 校验失败，请刷新页面后重试。";
      case 404:
        return "图片不存在或已被删除。";
      case 413:
        return TOO_LARGE_MESSAGE;
      case 415:
        return UNSUPPORTED_FORMAT_MESSAGE;
      case 422:
        return "图片解码失败或像素超限，请换一张再试。";
      default:
        return error.message || `操作失败（HTTP ${error.status}）。`;
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return "操作失败，请稍后重试。";
}
