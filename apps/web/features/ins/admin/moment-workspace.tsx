"use client";

/**
 * 站主动态工作台（T03 管理表单）。
 *
 * 流程（03 §3「站主」）：登录 → 新建草稿 → 上传图片 → 排序 / 填替代文本 → 预览 → 发布。
 *
 * 硬规则：
 *  - 图片走共享媒体服务（`MediaUploader`），**客户端缩略图不算上传成功**；
 *  - 冲突（412）**保留未保存输入**，提示读取新版，不自动覆盖（05 §7）；
 *  - 发布门槛在本地**先预检一次**给出快速反馈，但最终以服务端为准：
 *    服务端 409 时逐字显示它的原因，不谎报成功；
 *  - 草稿的 `text` / `tags` 在客户端是**受控输入**，只有「保存」才提交，
 *    因此上传图片不会把正在编辑的文字冲掉。
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  createMoment,
  deleteMoment,
  fetchAdminMoment,
  fetchAdminMoments,
  publishMoment,
  unpublishMoment,
  updateMoment,
} from "../api";
import {
  TAG_INPUT_HINT,
  albumLinkSummary,
  cleanAlbumLinks,
  cleanTags,
  purgeAlbumLinks,
  validateAlbumLinks,
  validateDraftForPublish,
  validateTagInput,
  type MomentAdmin,
  type MomentAlbumLink,
  type MomentImageInput,
} from "../types";
import { AlbumLinksEditor } from "./album-links-editor";
import { MediaUploader, type UploadedImage } from "./media-uploader";
import { fieldMessages } from "./session";

export interface MomentWorkspaceProps {
  csrfToken: string;
  /** 由父组件提供失败文案与冲突判定（会话 hook 里统一）。 */
  describeError: (error: unknown) => string;
  isConflict: (error: unknown) => boolean;
}

interface EditorState {
  /** 已保存的草稿 id；未创建前为空。 */
  momentId: string | null;
  version: number | null;
  status: "draft" | "published";
  text: string;
  tags: string;
  images: UploadedImage[];
  /** 动态 → 相册的收录选择（第三轮 §4.2；保存时随其他字段一起提交完整选择）。 */
  albumLinks: MomentAlbumLink[];
  /** 是否有未保存的改动（文字 / 标签 / 图片关系 / 收录选择）。 */
  dirty: boolean;
}

const EMPTY: EditorState = {
  momentId: null,
  version: null,
  status: "draft",
  text: "",
  tags: "",
  images: [],
  albumLinks: [],
  dirty: false,
};

function toImageInputs(images: readonly UploadedImage[]): MomentImageInput[] {
  return images.map((image, index) => ({
    media_id: image.mediaId,
    position: index,
    alt: image.alt.trim(),
  }));
}

function albumLinksFromMoment(moment: MomentAdmin): MomentAlbumLink[] {
  // 回执形状与写入同形；老桩数据可能没有该字段，`?? []` 兜底。
  return (moment.album_links ?? []).map((link) => ({
    album_id: link.album_id,
    media_ids: [...link.media_ids],
  }));
}

function fromMoment(moment: MomentAdmin): UploadedImage[] {
  return moment.images_admin.map((image) => ({
    mediaId: image.media_id,
    alt: image.alt,
    upload: {
      id: image.media_id,
      mime_type: "",
      bytes: 0,
      width: 0,
      height: 0,
      status: "ready",
      variants: [],
      original_url: "",
    },
  }));
}

export function MomentWorkspace({
  csrfToken,
  describeError,
  isConflict,
}: MomentWorkspaceProps): ReactNode {
  const [list, setList] = useState<MomentAdmin[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "busy">("idle");
  const [editor, setEditor] = useState<EditorState>(EMPTY);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const inflight = useRef<AbortController | null>(null);

  const loadList = useCallback(async () => {
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;
    try {
      const page = await fetchAdminMoments({ limit: 30 }, controller.signal);
      if (controller.signal.aborted) return;
      setList(page.items);
      setListError(null);
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure instanceof DOMException && failure.name === "AbortError") return;
      // 读取失败不显示成「没有动态」（01 §6）。
      setListError(describeError(failure));
    }
  }, [describeError]);

  useEffect(() => {
    // 挂载后拉一次管理列表。`loadList` 的 setState 都发生在 `await` 之后，
    // 因此这里的「同步调用」只是发起请求，不是级联渲染。
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 见上：setState 在 await 之后。
    void loadList();
    return () => inflight.current?.abort();
  }, [loadList]);

  const run = useCallback(
    async (action: () => Promise<void>) => {
      setPhase("busy");
      setError(null);
      setFieldErrors({});
      try {
        await action();
      } catch (failure) {
        setError(describeError(failure));
        setFieldErrors(fieldMessages(failure));
        if (isConflict(failure)) {
          setMessage("版本冲突：你的输入都还在这里。请点「重新读取」拿到最新版本，再决定怎么改。");
        }
      } finally {
        setPhase("idle");
      }
    },
    [describeError, isConflict],
  );

  const startNew = useCallback(() => {
    setEditor(EMPTY);
    setMessage("新草稿是空的。先上传图片、写文字，然后「保存草稿」。");
    setError(null);
    setFieldErrors({});
  }, []);

  const openMoment = useCallback(
    async (momentId: string) => {
      setPhase("busy");
      setError(null);
      try {
        const moment = await fetchAdminMoment(momentId);
        setEditor({
          momentId: moment.id,
          version: moment.version,
          status: moment.status,
          text: moment.text,
          tags: moment.tags.map((tag) => tag.name).join(" "),
          images: fromMoment(moment),
          albumLinks: albumLinksFromMoment(moment),
          dirty: false,
        });
        setMessage(
          moment.status === "published"
            ? "这条动态已发布。修改后记得「保存草稿」，再重新发布。"
            : "已读取草稿。",
        );
      } catch (failure) {
        setError(describeError(failure));
      } finally {
        setPhase("idle");
      }
    },
    [describeError],
  );

  // memo 化：`createDraft` / `save` 依赖它，每次渲染都新建数组会让依赖恒变。
  const tagNames = useMemo(() => cleanTags(editor.tags.split(/[\s,，、]+/)), [editor.tags]);
  const tagIssues = validateTagInput(tagNames);

  const createDraft = useCallback(async () => {
    await run(async () => {
      const created = await createMoment(csrfToken, { text: editor.text, tags: tagNames });
      setEditor({
        momentId: created.id,
        version: created.version,
        status: created.status,
        text: created.text,
        tags: created.tags.map((tag) => tag.name).join(" "),
        images: [],
        albumLinks: albumLinksFromMoment(created),
        dirty: false,
      });
      setMessage("草稿已创建。现在可以上传图片了。");
      await loadList();
    });
  }, [csrfToken, editor.text, loadList, run, tagNames]);

  const save = useCallback(async () => {
    if (!editor.momentId || editor.version === null) {
      setError("请先创建草稿（点下面的「新建草稿」）。");
      return;
    }
    const publishIssues = validateDraftForPublish({
      text: editor.text,
      images: toImageInputs(editor.images),
    });
    if (tagIssues.length) {
      setError(tagIssues.map((issue) => issue.message).join("；"));
      return;
    }
    // 收录选择：客户端先做一次契约预检（服务端仍是权威，失败会显示服务端 409/422）。
    const albumLinks = cleanAlbumLinks(editor.albumLinks);
    const albumIssues = validateAlbumLinks(albumLinks, editor.images.map((image) => image.mediaId));
    if (albumIssues.length) {
      setError(albumIssues.map((issue) => issue.message).join("；"));
      return;
    }
    await run(async () => {
      const updated = await updateMoment(csrfToken, editor.momentId as string, editor.version as number, {
        text: editor.text,
        tags: tagNames,
        images: toImageInputs(editor.images),
        // 完整选择（含 `[]` = 清空）：界面状态就是服务端配置的唯一来源。
        album_links: albumLinks,
      });
      setEditor({
        momentId: updated.id,
        version: updated.version,
        status: updated.status,
        text: updated.text,
        tags: updated.tags.map((tag) => tag.name).join(" "),
        images: fromMoment(updated).map((image, index) => ({
          ...image,
          upload: editor.images[index]?.upload ?? image.upload,
        })),
        albumLinks: albumLinksFromMoment(updated),
        dirty: false,
      });
      // 保存成功后才提示「可以发布」；门槛未满足时如实说明还差什么。
      const savedIssues = publishIssues.length
        ? `已保存。还不能发布：${publishIssues.map((issue) => issue.message).join("；")}`
        : "已保存。可以发布了。";
      const summary = albumLinkSummary(albumLinks);
      setMessage(
        summary.albums > 0
          ? `${savedIssues} 已收录 ${summary.media} 张图到 ${summary.albums} 个相册（相册未公开时暂不展示）。`
          : savedIssues,
      );
      await loadList();
    });
  }, [csrfToken, editor, loadList, run, tagIssues, tagNames]);

  const publish = useCallback(async () => {
    if (!editor.momentId || editor.version === null) {
      setError("请先创建并保存草稿。");
      return;
    }
    await run(async () => {
      const published = await publishMoment(
        csrfToken,
        editor.momentId as string,
        editor.version as number,
      );
      setEditor((previous) => ({
        ...previous,
        version: published.version,
        status: published.status,
        dirty: false,
        // 发布回执也带 album_links（N3 契约 §3.3）：以服务端为准同步，避免界面与配置漂移。
        albumLinks: albumLinksFromMoment(published),
      }));
      setMessage(`已发布（发布时间 ${published.published_at ?? "由服务端生成"}）。`);
      await loadList();
    });
  }, [csrfToken, editor.momentId, editor.version, loadList, run]);

  const unpublish = useCallback(async () => {
    if (!editor.momentId || editor.version === null) return;
    await run(async () => {
      const withdrawn = await unpublishMoment(
        csrfToken,
        editor.momentId as string,
        editor.version as number,
      );
      setEditor((previous) => ({
        ...previous,
        version: withdrawn.version,
        status: withdrawn.status,
        // 撤回只让动态来源不再贡献公开资格，**配置保留**（N3 契约 §3.1 第 10 条）。
        albumLinks: albumLinksFromMoment(withdrawn),
      }));
      setMessage("已撤回：公开页面与新媒体请求都将看不到它，图片关系保留着，改完可以再发。");
      await loadList();
    });
  }, [csrfToken, editor.momentId, editor.version, loadList, run]);

  const remove = useCallback(async () => {
    if (!editor.momentId || editor.version === null) return;
    const confirmed =
      typeof window === "undefined"
        ? true
        : window.confirm("软删除这条动态？公开页面会立刻看不到它（可用备份与保留期策略另行处理）。");
    if (!confirmed) return;
    await run(async () => {
      await deleteMoment(csrfToken, editor.momentId as string, editor.version as number);
      setEditor(EMPTY);
      setMessage("已软删除。公开页面与管理列表都不再显示它。");
      await loadList();
    });
  }, [csrfToken, editor.momentId, editor.version, loadList, run]);

  const busy = phase === "busy";
  const publishIssues = validateDraftForPublish({
    text: editor.text,
    images: toImageInputs(editor.images),
  });

  return (
    <div className="ins-admin">
      <section className="ins-admin-list" aria-label="动态列表">
        <div className="ins-admin-list-head">
          <h2>动态</h2>
          <div className="ins-admin-list-act">
            {/* 列表头这个按钮只清空右侧工作台，**不**创建服务端草稿；
                因此文案与下面的「新建草稿」区分开，避免两处同名按钮做不同的事。 */}
            <button type="button" className="ins-btn" onClick={startNew} disabled={busy}>
              清空工作台
            </button>
            <button type="button" className="ins-btn" onClick={() => void loadList()} disabled={busy}>
              刷新列表
            </button>
            {/* P5 第一批独立编辑页入口：不替换旧工作台，只是多一条更轻的路径。 */}
            <Link className="ins-btn" href="/admin/moments/new">
              新建动态（独立编辑页）
            </Link>
          </div>
        </div>

        {listError ? (
          <p className="ins-admin-notice" role="alert">
            {listError}
          </p>
        ) : list.length === 0 ? (
          <p className="ins-admin-hint" role="status">
            还没有任何动态。
          </p>
        ) : (
          <ul className="ins-admin-list-items">
            {list.map((moment) => (
              <li key={moment.id}>
                <button
                  type="button"
                  className={`ins-admin-list-item${editor.momentId === moment.id ? " on" : ""}`}
                  onClick={() => void openMoment(moment.id)}
                  disabled={busy}
                >
                  <span className={`ins-admin-state is-${moment.status}`}>
                    {moment.status === "published" ? "已发布" : "草稿"}
                  </span>
                  <span className="ins-admin-list-text">
                    {moment.text ? moment.text.slice(0, 40) : "（无文字）"}
                  </span>
                  <span className="ins-admin-list-meta">
                    {moment.images_admin.length} 图 · v{moment.version}
                  </span>
                </button>
                {/* 独立编辑页：会在工作草稿里复用/创建副本；旧工作台的保存/发布逻辑不受影响。 */}
                <Link className="ins-admin-list-edit" href={`/admin/moments/${moment.id}/edit`}>
                  继续编辑（独立页）
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="ins-admin-editor" aria-label="编辑动态">
        {message ? (
          <p className="ins-admin-message" role="status">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className="ins-admin-notice" role="alert">
            {error}
          </p>
        ) : null}

        <p className="ins-admin-hint">
          {editor.momentId
            ? `正在编辑 ${editor.momentId}（v${editor.version ?? "?"} · ${editor.status === "published" ? "已发布" : "草稿"}）`
            : "尚未创建草稿：点下面的「新建草稿」。"}
        </p>

        <label className="ins-admin-field">
          <span>文字（最多 2000 字，可留空；按纯文本展示，不接受 HTML）</span>
          <textarea
            value={editor.text}
            rows={5}
            maxLength={2000}
            onChange={(event) =>
              setEditor((previous) => ({ ...previous, text: event.target.value, dirty: true }))
            }
            aria-invalid={fieldErrors.text ? true : undefined}
          />
          <small>{Array.from(editor.text).length} / 2000 码点</small>
          {fieldErrors.text ? <em role="alert">{fieldErrors.text}</em> : null}
        </label>

        <label className="ins-admin-field">
          <span>{TAG_INPUT_HINT}</span>
          <input
            type="text"
            value={editor.tags}
            onChange={(event) =>
              setEditor((previous) => ({ ...previous, tags: event.target.value, dirty: true }))
            }
            aria-invalid={tagIssues.length ? true : undefined}
          />
          {tagIssues.length ? <em role="alert">{tagIssues.map((issue) => issue.message).join("；")}</em> : null}
          {fieldErrors.tags ? <em role="alert">{fieldErrors.tags}</em> : null}
        </label>

        {editor.momentId ? (
          <MediaUploader
            csrfToken={csrfToken}
            images={editor.images}
            onChange={(images) =>
              setEditor((previous) => ({
                ...previous,
                images,
                // 动态里移除的图片必须同步从收录选择里去掉：否则保存会带一个「不属于
                // 当前动态的媒体」被服务端 409 整单拒绝（N3 契约 §3.2）。
                albumLinks: purgeAlbumLinks(
                  previous.albumLinks,
                  images.map((image) => image.mediaId),
                ),
                dirty: true,
              }))
            }
            disabled={busy}
          />
        ) : (
          <p className="ins-admin-hint">
            图片上传需要先有草稿：先点下面的「新建草稿」（会在服务端建一条草稿），再选择图片。
            这样每张图都有服务端确认的 ready 记录，不会出现「看到了缩略图但服务端没有这张图」。
          </p>
        )}

        {editor.momentId ? (
          <AlbumLinksEditor
            images={editor.images}
            links={editor.albumLinks}
            onChange={(albumLinks) =>
              setEditor((previous) => ({ ...previous, albumLinks, dirty: true }))
            }
            describeError={describeError}
            fieldError={fieldErrors.album_links ?? null}
            disabled={busy}
          />
        ) : null}

        {publishIssues.length ? (
          <ul className="ins-admin-issues" aria-label="发布前仍需处理">
            {publishIssues.map((issue) => (
              <li key={`${issue.field}:${issue.message}`}>{issue.message}</li>
            ))}
          </ul>
        ) : null}

        <div className="ins-admin-act">
          <button type="button" className="ins-btn" onClick={() => void createDraft()} disabled={busy}>
            新建草稿
          </button>
          <button
            type="button"
            className="ins-btn"
            onClick={() => void save()}
            disabled={busy || !editor.momentId}
          >
            {editor.dirty ? "保存草稿 *" : "保存草稿"}
          </button>
          <button
            type="button"
            className="ins-btn"
            onClick={() => setPreviewOpen((value) => !value)}
            disabled={!editor.momentId}
          >
            {previewOpen ? "关闭预览" : "预览"}
          </button>
          <button
            type="button"
            className="ins-btn red"
            onClick={() => void publish()}
            disabled={busy || !editor.momentId || editor.dirty}
          >
            发布
          </button>
          <button
            type="button"
            className="ins-btn"
            onClick={() => void unpublish()}
            disabled={busy || !editor.momentId || editor.status !== "published"}
          >
            撤回
          </button>
          <button
            type="button"
            className="ins-btn"
            onClick={() => void remove()}
            disabled={busy || !editor.momentId}
          >
            软删除
          </button>
        </div>

        {editor.dirty ? (
          <p className="ins-admin-hint" role="status">
            有未保存的改动：先「保存草稿」再发布（避免发布一个旧的文字/图片顺序）。
          </p>
        ) : null}

        {previewOpen ? (
          <div className="ins-admin-preview" aria-label="草稿预览（管理数据，非公开页面）">
            <p className="ins-admin-preview-note">
              这是管理预览：它与公开页面的差别是**能看到未发布的草稿**。公开页面只显示已发布内容。
            </p>
            <p className="ins-admin-preview-text">{editor.text || "（无文字）"}</p>
            <ol className="ins-admin-preview-images">
              {editor.images.map((image, index) => (
                <li key={image.mediaId}>
                  {image.upload.variants[0]?.url ? (
                    /* eslint-disable-next-line @next/next/no-img-element -- 管理预览使用带授权语义的媒体变体地址。 */
                    <img
                      src={image.upload.variants[0].url}
                      alt={image.alt || `第 ${index + 1} 张`}
                      width={160}
                      height={120}
                    />
                  ) : (
                    <span className="ins-admin-hint">第 {index + 1} 张（无可用变体）</span>
                  )}
                  <p>{image.alt || "（缺少替代文本，发布会被拒绝）"}</p>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </section>
    </div>
  );
}
