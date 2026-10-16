"use client";

/**
 * 相册编辑器（T06；07 §5、05 §7）。
 *
 * 设计要点：
 *
 *  1. **复用已有 media，不重复上传**（验收 2）：这里**不**实现上传按钮 ——
 *     文件上传是 T01 的媒体服务（`POST /api/v1/admin/media`），动态、文章封面与相册
 *     共用同一个端点。相册编辑器接受**已有的 media UUID**，因此同一张图可以被动态、
 *     相册、作品同时引用，而文件只有一套。已上传的图在动态编辑器里可以直接复制 ID。
 *  2. **逐张录入顺序 / 说明 / 拍摄时间**：`position` 决定相册内顺序，说明与拍摄时间
 *     各自独立保存（同一张图在作品里的说明可以完全不同）。
 *  3. **拍摄时间可以留空**：空输入 → `taken_on: null`，界面显示「未填写日期」，
 *     不替站主编一个日期（07 §5）。
 *  4. **412 保留输入**：版本冲突时不清空表单，只提示重新读取（05 §7）。
 *  5. **移除单张照片 ≠ 删除图片**：走 `DELETE /admin/albums/{id}/photos/{media_id}`，
 *     文案明确写「只从本相册移除」。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import {
  createAlbum,
  deleteAlbum,
  fetchAdminAlbum,
  publishAlbum,
  removeAlbumPhoto,
  unpublishAlbum,
  updateAlbum,
  type AlbumWritePayload,
} from "../api";
import { ALBUM_KINDS, type AdminAlbum, type AdminPhotoInput, type AlbumKind } from "../types";
import { fieldMessages } from "./session";

/** 表单里的一行照片（`media_id` 直接粘贴 UUID；说明与拍摄时间可空）。 */
interface PhotoDraft {
  key: string;
  media_id: string;
  alt: string;
  caption: string;
  taken_on: string;
}

export interface AlbumWorkspaceProps {
  csrfToken: string;
  describeError: (error: unknown) => string;
  isConflict: (error: unknown) => boolean;
  /** 新建模式（true）还是编辑某个相册（false）。 */
  createMode: boolean;
  /** 编辑模式下的相册 id。 */
  albumId?: string;
}

function draftFromAlbum(album: AdminAlbum): PhotoDraft[] {
  return album.photos.map((photo, index) => ({
    key: `${photo.media_id}-${index}`,
    media_id: photo.media_id,
    alt: photo.alt,
    caption: photo.caption ?? "",
    taken_on: photo.taken_on ?? "",
  }));
}

function emptyDraft(): PhotoDraft {
  return { key: `new-${Math.random().toString(36).slice(2, 9)}`, media_id: "", alt: "", caption: "", taken_on: "" };
}

export function AlbumWorkspace({
  csrfToken,
  describeError,
  isConflict,
  createMode,
  albumId,
}: AlbumWorkspaceProps): ReactNode {
  const [album, setAlbum] = useState<AdminAlbum | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "unavailable">(
    createMode ? "ready" : "loading",
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<AlbumKind>("photo");
  const [position, setPosition] = useState("0");
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const controllerRef = useRef<AbortController | null>(null);

  // 载入已有相册（编辑模式）。卸载时取消在途读取。
  useEffect(() => {
    if (createMode || !albumId) return undefined;
    const controller = new AbortController();
    controllerRef.current = controller;
    void (async () => {
      try {
        const loaded = await fetchAdminAlbum(albumId, controller.signal);
        setAlbum(loaded);
        setSlug(loaded.slug);
        setTitle(loaded.title);
        setDescription(loaded.description);
        setKind((loaded.kind as AlbumKind) ?? "photo");
        setPosition(String(loaded.position));
        setPhotos(draftFromAlbum(loaded));
        setPhase("ready");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPhase("unavailable");
        setNotice(describeError(error));
      }
    })();
    return () => controller.abort();
  }, [albumId, createMode, describeError]);

  const reload = useCallback(async () => {
    if (!albumId) return;
    try {
      const loaded = await fetchAdminAlbum(albumId);
      setAlbum(loaded);
      setSlug(loaded.slug);
      setTitle(loaded.title);
      setDescription(loaded.description);
      setKind((loaded.kind as AlbumKind) ?? "photo");
      setPosition(String(loaded.position));
      setPhotos(draftFromAlbum(loaded));
      setNotice("已读取最新版本，请重新确认后再提交。");
      setFieldErrors({});
    } catch (error) {
      setNotice(describeError(error));
    }
  }, [albumId, describeError]);

  const buildPayload = useCallback((): AlbumWritePayload => {
    const cleaned: AdminPhotoInput[] = photos
      .filter((photo) => photo.media_id.trim())
      .map((photo, index) => ({
        media_id: photo.media_id.trim(),
        position: index,
        alt: photo.alt.trim(),
        caption: photo.caption.trim(),
        taken_on: photo.taken_on.trim() ? photo.taken_on.trim() : null,
      }));
    const payload: AlbumWritePayload = {
      title: title.trim(),
      description: description.trim(),
      kind,
      position: Number.parseInt(position, 10) || 0,
      photos: cleaned,
    };
    if (createMode) payload.slug = slug.trim();
    return payload;
  }, [createMode, description, kind, photos, position, slug, title]);

  const handleSave = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    setFieldErrors({});
    try {
      if (createMode) {
        const payload = buildPayload();
        if (!payload.slug) {
          setFieldErrors({ slug: "新建相册必须填 slug" });
          return;
        }
        const created = await createAlbum(
          payload as AlbumWritePayload & { slug: string; title: string },
          csrfToken,
        );
        setAlbum(created);
        setSlug(created.slug);
        setPhotos(draftFromAlbum(created));
        setNotice(`已保存草稿「${created.title}」（version ${created.version}）。`);
        setPhase("ready");
      } else if (album && albumId) {
        const updated = await updateAlbum(albumId, buildPayload(), csrfToken, album.version);
        setAlbum(updated);
        setSlug(updated.slug);
        setPhotos(draftFromAlbum(updated));
        setNotice(`已保存（version ${updated.version}）。`);
      }
    } catch (error) {
      if (isConflict(error)) {
        // 412：**保留**未保存输入，只提示读取新版（05 §7）。
        setNotice(describeError(error));
      } else {
        setNotice(describeError(error));
        setFieldErrors(fieldMessages(error));
      }
    } finally {
      setBusy(false);
    }
  }, [album, albumId, buildPayload, busy, createMode, csrfToken, describeError, isConflict]);

  const handlePublishToggle = useCallback(
    async (publish: boolean) => {
      if (!album) return;
      setBusy(true);
      setNotice(null);
      try {
        const next = publish
          ? await publishAlbum(album.id, csrfToken, album.version)
          : await unpublishAlbum(album.id, csrfToken, album.version);
        setAlbum(next);
        setNotice(publish ? "已发布，公开照片墙现在可以看到它。" : "已撤回，公开页面不再显示。");
      } catch (error) {
        setNotice(describeError(error));
        if (isConflict(error)) await reload();
      } finally {
        setBusy(false);
      }
    },
    [album, csrfToken, describeError, isConflict, reload],
  );

  const handleDelete = useCallback(async () => {
    if (!album) return;
    setBusy(true);
    setNotice(null);
    try {
      await deleteAlbum(album.id, csrfToken, album.version);
      setAlbum(null);
      setNotice("已软删除。照片文件没有被删掉（其他公开内容可能还在引用它）。");
    } catch (error) {
      setNotice(describeError(error));
    } finally {
      setBusy(false);
    }
  }, [album, csrfToken, describeError]);

  const handleRemovePhoto = useCallback(
    async (mediaId: string) => {
      if (!album) return;
      setBusy(true);
      setNotice(null);
      try {
        await removeAlbumPhoto(album.id, mediaId, csrfToken, album.version);
        const refreshed = await fetchAdminAlbum(album.id);
        setAlbum(refreshed);
        setPhotos(draftFromAlbum(refreshed));
        setNotice(
          "已从本相册移除这一张。同一张图片如果还在动态、作品或别的相册里，匿名访客仍然看得到它。",
        );
      } catch (error) {
        setNotice(describeError(error));
      } finally {
        setBusy(false);
      }
    },
    [album, csrfToken, describeError],
  );

  if (phase === "loading") {
    return <p className="pls-card-meta">正在读取相册…</p>;
  }

  if (phase === "unavailable" && !album) {
    return (
      <div className="pls-state" role="alert">
        <p className="pls-state-kicker">UNAVAILABLE</p>
        <p className="pls-state-body">{notice ?? "读取相册失败。"}</p>
      </div>
    );
  }

  return (
    <div className="pls-wrap" data-album-workspace="">
      {notice ? (
        <p className="pls-card-meta" role="status" data-admin-notice="">
          {notice}
        </p>
      ) : null}

      <div className="pls-sections">
        <section className="pls-section">
          <h3>基本信息</h3>
          {createMode ? (
            <p>
              <label htmlFor="album-slug">slug（公开地址的一部分，小写字母 / 数字 / 连字符）</label>
              <br />
              <input
                id="album-slug"
                name="slug"
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                required
                aria-invalid={fieldErrors.slug ? true : undefined}
              />
              {fieldErrors.slug ? <span role="alert"> {fieldErrors.slug}</span> : null}
            </p>
          ) : (
            <p className="pls-card-meta">
              slug：<code>{slug}</code>（公开 URL 稳定优先，不可修改）
            </p>
          )}
          <p>
            <label htmlFor="album-title">标题</label>
            <br />
            <input
              id="album-title"
              name="title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
            />
          </p>
          <p>
            <label htmlFor="album-description">说明（可空）</label>
            <br />
            <textarea
              id="album-description"
              name="description"
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </p>
          <p>
            <label htmlFor="album-kind">类型</label>
            <br />
            <select
              id="album-kind"
              name="kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as AlbumKind)}
            >
              {ALBUM_KINDS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </p>
          <p>
            <label htmlFor="album-position">排序（同类相册内的顺序，数字小的在前）</label>
            <br />
            <input
              id="album-position"
              name="position"
              inputMode="numeric"
              value={position}
              onChange={(event) => setPosition(event.target.value)}
            />
          </p>
        </section>

        <section className="pls-section">
          <h3>照片</h3>
          <p className="pls-card-meta">
            填**已有**的媒体 UUID（在动态编辑器里上传后可以复制）。这里刻意不做第二次上传：
            同一张图被动态、相册、作品引用时文件只有一套。
          </p>
          {photos.map((photo, index) => (
            <fieldset key={photo.key} data-photo-row={index}>
              <legend>第 {index + 1} 张</legend>
              <p>
                <label htmlFor={`photo-media-${index}`}>媒体 UUID</label>
                <br />
                <input
                  id={`photo-media-${index}`}
                  value={photo.media_id}
                  onChange={(event) =>
                    setPhotos((previous) =>
                      previous.map((item, position) =>
                        position === index ? { ...item, media_id: event.target.value } : item,
                      ),
                    )
                  }
                />
              </p>
              <p>
                <label htmlFor={`photo-alt-${index}`}>替代文本（必填，1–200 字）</label>
                <br />
                <input
                  id={`photo-alt-${index}`}
                  value={photo.alt}
                  onChange={(event) =>
                    setPhotos((previous) =>
                      previous.map((item, position) =>
                        position === index ? { ...item, alt: event.target.value } : item,
                      ),
                    )
                  }
                />
              </p>
              <p>
                <label htmlFor={`photo-caption-${index}`}>场景说明（可空）</label>
                <br />
                <input
                  id={`photo-caption-${index}`}
                  value={photo.caption}
                  onChange={(event) =>
                    setPhotos((previous) =>
                      previous.map((item, position) =>
                        position === index ? { ...item, caption: event.target.value } : item,
                      ),
                    )
                  }
                />
              </p>
              <p>
                <label htmlFor={`photo-taken-${index}`}>拍摄时间（可空）</label>
                <br />
                <input
                  id={`photo-taken-${index}`}
                  type="date"
                  value={photo.taken_on}
                  onChange={(event) =>
                    setPhotos((previous) =>
                      previous.map((item, position) =>
                        position === index ? { ...item, taken_on: event.target.value } : item,
                      ),
                    )
                  }
                />
                {photo.taken_on ? null : (
                  <span className="pls-card-meta"> 空着就是「未填写日期」，不会补一个。</span>
                )}
              </p>
              <div className="pls-row-actions">
                <button
                  type="button"
                  className="pls-button"
                  onClick={() =>
                    setPhotos((previous) => {
                      if (index === 0) return previous;
                      const next = [...previous];
                      const above = next[index - 1];
                      const current = next[index];
                      if (!above || !current) return previous;
                      next[index - 1] = current;
                      next[index] = above;
                      return next;
                    })
                  }
                  disabled={index === 0}
                >
                  上移
                </button>
                <button
                  type="button"
                  className="pls-button"
                  onClick={() =>
                    setPhotos((previous) => {
                      if (index >= previous.length - 1) return previous;
                      const next = [...previous];
                      const below = next[index + 1];
                      const current = next[index];
                      if (!below || !current) return previous;
                      next[index + 1] = current;
                      next[index] = below;
                      return next;
                    })
                  }
                  disabled={index === photos.length - 1}
                >
                  下移
                </button>
                <button
                  type="button"
                  className="pls-button"
                  onClick={() =>
                    setPhotos((previous) => previous.filter((_item, position) => position !== index))
                  }
                >
                  从表单移除
                </button>
                {album && photo.media_id ? (
                  <button
                    type="button"
                    className="pls-button"
                    onClick={() => void handleRemovePhoto(photo.media_id)}
                    disabled={busy}
                    data-remove-photo={photo.media_id}
                  >
                    只从本相册移除
                  </button>
                ) : null}
              </div>
            </fieldset>
          ))}
          <button
            type="button"
            className="pls-button"
            onClick={() => setPhotos((previous) => [...previous, emptyDraft()])}
            data-add-photo=""
          >
            添加一张照片
          </button>
        </section>
      </div>

      <div className="pls-row-actions">
        <button
          type="button"
          className="pls-button"
          onClick={() => void handleSave()}
          disabled={busy}
          data-save=""
        >
          {createMode && !album ? "保存草稿" : "保存修改"}
        </button>
        {album ? (
          <>
            <button
              type="button"
              className="pls-button"
              onClick={() => void handlePublishToggle(album.status !== "published")}
              disabled={busy}
              data-publish-toggle=""
            >
              {album.status === "published" ? "撤回" : "发布"}
            </button>
            <button type="button" className="pls-button" onClick={() => void reload()} disabled={busy}>
              读取最新版本
            </button>
            <button
              type="button"
              className="pls-button"
              onClick={() => void handleDelete()}
              disabled={busy}
              data-delete=""
            >
              软删除
            </button>
          </>
        ) : null}
      </div>

      {album ? (
        <p className="pls-card-meta" data-album-status={album.status}>
          当前状态：{album.status === "published" ? "已发布" : "草稿"} · version {album.version} ·
          {album.photos.length} 张
          {album.photos.some((photo) => photo.media_status !== "ready") ? (
            <strong> · 有照片未就绪，发布会被拒绝</strong>
          ) : null}
        </p>
      ) : null}

      {fieldErrors.media_id || fieldErrors.photos ? (
        <p className="pls-state-body" role="alert">
          {fieldErrors.media_id ?? fieldErrors.photos}
        </p>
      ) : null}

    </div>
  );
}
