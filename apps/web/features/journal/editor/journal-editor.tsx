"use client";

/**
 * 手记独立编辑页（P5 第一批 · C4；契约 §4.5 / §9.5，设计书 §2.4）。
 *
 * 主区域：日期、标题、正文（Markdown 写作 + 预览）；次要区域：心情、地点、图片、
 * 关联文章。技术信息（正式版本号、站点时区、今天）只放辅助文本，不占主界面。
 *
 * 三条硬规则（验收 A4/A5）：
 *  1. **自动保存只写工作草稿**（C2 的 `useWorkDraft`），绝不直接 PATCH 正式内容；
 *     「保存」「公开」「更新正式内容」是三个显式按钮，走事务提交（`commitWorkDraft`）。
 *  2. **保存 ≠ 公开**：新建默认 draft + private；公开必须单独点「公开这篇」，
 *     先过本地发布门槛（标题 + 正文），失败保留输入、不显示成功。
 *  3. **修改已公开手记先工作副本**：点「更新正式内容」（commit `update`）之前，
 *     访客继续看到原版本；按钮与提示都明说这一点。
 *
 * 成功后页面进入「已提交」只读态并给出真实结果与下一步链接（继续编辑 = 打开新的
 * 工作副本 / 查看手记 / 返回来源），避免在已提交的草稿上继续输入导致 409 困惑。
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

import { parseContent } from "@/features/legacy/markdown";
import { MarkdownView } from "@/features/legacy/markdown/view";
import { MediaPickerDialog, MediaThumb, type PickedImage } from "@/features/media-picker";
import { SiteLink } from "@/features/runtime/navigation/site-link";
import { commitWorkDraft } from "@/features/workspace/api";
import { ConflictNotice } from "@/features/workspace/conflict-notice";
import { EditorShell } from "@/features/workspace/editor-shell";
import { withReturnTo } from "@/features/workspace/return-context";
import { SyncStatus } from "@/features/workspace/sync-status";
import type { DraftAction } from "@/features/workspace/types";
import { useWorkDraft } from "@/features/workspace/use-work-draft";
import { ApiClientError } from "@/lib/api/client";

import styles from "../journal.module.css";
import {
  ACTION_LABELS,
  CONTENT_MAX_CODEPOINTS,
  allowedActionsFor,
  describeCommitSuccess,
  emptyForm,
  expectedTargetVersion,
  formFromData,
  formFromEntry,
  newCommitKey,
  publishBlockersFor,
  publishedEditHint,
  statusLine,
  targetState,
  toDraftData,
  validateEditorForm,
  type JournalForm,
  type PostOption,
} from "./model";
import { MOOD_PRESETS, type JournalAdminEntry } from "../types";

export interface JournalEditorProps {
  mode: "new" | "edit";
  /** 编辑已有手记时是管理端 DTO；新建为 null。 */
  entry: JournalAdminEntry | null;
  /** 新建页解析好的初始日期（`?date=` 或站点时区今天）。 */
  initialDate: string;
  /** 新建页的日期来源说明（安静提示）。 */
  dateHint: string | null;
  ownerId: string;
  csrfToken: string;
  /** 已校验的 returnTo；非法/为空时编辑器返回 /admin。 */
  returnTo: string | null;
  /** 关联文章的可选项（公开文章列表）；null = 还没读到。 */
  posts: PostOption[] | null;
  postsError: string | null;
  /** 编辑已有手记时的图片（已尽量补取媒体详情；取不到也有 media_id + alt）。 */
  images: PickedImage[];
  /** 辅助信息：站点时区与今天（来自 API）。 */
  timezone: string | null;
  today: string | null;
  /**
   * 本机草稿的稳定入口 id（C2 `useEntryId()` 生成并写进 URL `?entry=`）。
   * 必填：刷新后要能恢复本机副本，key 必须稳定（契约 §9.4）。
   */
  entryId: string;
}

interface SuccessState {
  message: string;
  targetId: string;
  status: "draft" | "published";
  visibility: "private" | "public" | null;
  action: DraftAction;
}

/** 提交失败文案：与失败原因对应，不吞掉可行动信息。 */
function describeCommitError(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 412) {
      return "这篇手记的正式内容已在别处更新（412）。你的输入还在本机/工作副本里；请回列表重新打开这一篇，再决定是否更新。";
    }
    if (error.status === 422) {
      const fields = Object.entries(error.fields)
        .map(([key, messages]) => `${key}：${messages.join("；")}`)
        .join(" / ");
      return `发布/保存校验没通过（422）：${fields || error.message}。内容没有提交。`;
    }
    if (error.status === 409) {
      return `当前状态不允许这个操作（409）：${error.message}`;
    }
    if (error.status === 428) {
      return "缺少版本条件（428）：请刷新页面重新打开这一篇再提交。";
    }
    if (error.status === 401) {
      return "登录已失效（401）。本机内容已保留，请重新登录后再提交。";
    }
    return `提交失败（HTTP ${error.status} · ${error.code}）：内容没有提交。`;
  }
  return "连不上服务，内容没有提交（工作副本与本机内容已保留）。";
}

export function JournalEditor(props: JournalEditorProps): ReactNode {
  const {
    mode,
    entry,
    initialDate,
    dateHint,
    ownerId,
    csrfToken,
    returnTo,
    posts,
    postsError,
    images: initialImages,
    timezone,
    today,
    entryId,
  } = props;

  /** 页面初值（只算一次）：服务端草稿/本机副本回填之前的表单基准。 */
  const [form, setForm] = useState<JournalForm>(() =>
    entry ? formFromEntry(entry) : emptyForm(initialDate),
  );
  const [initialDraftData] = useState<Record<string, unknown>>(() =>
    toDraftData(entry ? formFromEntry(entry) : emptyForm(initialDate)),
  );
  const [images, setImages] = useState<PickedImage[]>(initialImages);
  const [pane, setPane] = useState<"write" | "preview">("write");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessState | null>(null);
  const [submitting, setSubmitting] = useState<DraftAction | null>(null);
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const [discarded, setDiscarded] = useState(false);

  /** 用户是否已经开始编辑（决定「服务端草稿/本机副本」能否回填表单）。 */
  const dirtyRef = useRef(false);
  /** 只回填一次（首次挂载、用户未编辑）。 */
  const adoptedRef = useRef(false);
  /** 幂等提交键：一次提交（含网络重试）复用同一个 key。 */
  const commitKeyRef = useRef<string | null>(null);
  /** 最新表单：异步回填/冲突处理里读 ref，避免闭包拿到旧值。 */
  const formRef = useRef(form);
  useEffect(() => {
    formRef.current = form;
  }, [form]);

  const committed = success !== null;
  const work = useWorkDraft({
    contentType: "journal",
    targetId: entry?.id ?? null,
    enabled: true,
    ownerId,
    initialData: initialDraftData,
    initialImages,
    returnTo,
    csrfToken,
    entryId,
  });

  // 服务端草稿 / 本机副本比页面初值更新时回填一次；用户一旦开始输入就不再覆盖。
  useEffect(() => {
    if (adoptedRef.current || dirtyRef.current) return;
    const source = work.draft
      ? { data: work.draft.data as Record<string, unknown>, images: work.draft.images }
      : work.localCopy
        ? { data: work.localCopy.data, images: work.localCopy.images }
        : null;
    if (!source) return;
    const hasData = Object.keys(source.data ?? {}).length > 0;
    // 只在来源**确实带图**时覆盖图片：工作草稿初始化在途时 images 可能暂时为空，
    // 那不是「用户在别处删光了图」，不能把页面初值（编辑已有内容的图）清掉。
    const hasImages = Array.isArray(source.images) && source.images.length > 0;
    if (!hasData && !hasImages) return;
    adoptedRef.current = true;
    if (hasData) setForm(formFromData(source.data, formRef.current));
    if (hasImages) setImages(source.images);
    // 只在草稿/本机副本第一次出现时回填（dirty/adopted 两个 ref 就是守卫）。
  }, [work.draft, work.localCopy]);

  const blockers = publishBlockersFor(form);
  /**
   * C5 的 e2e 钩子（契约 §9.5，C4 手记专属）：
   *  - `data-editor-status` = draft | published（新建/正式草稿 → draft；publish → published；
   *    update 保持发布态；提交成功后反映服务端真实结果）；
   *  - `data-editor-visibility` = private | public（仅手记输出；新建默认 private，
   *    公开成功后才 public）。
   */
  const statusValue: "draft" | "published" = success
    ? success.status
    : entry?.status === "published"
      ? "published"
      : "draft";
  const visibilityValue: "private" | "public" = success
    ? success.visibility === "public"
      ? "public"
      : "private"
    : entry?.visibility === "public"
      ? "public"
      : "private";
  const actions = allowedActionsFor(entry);
  const canPublish = actions.includes("publish");
  const canSave = actions.includes("save");
  const canUpdate = actions.includes("update");
  const publishedHint = publishedEditHint(entry);
  const state = targetState(entry);

  const changeForm = (patch: Partial<JournalForm>) => {
    if (committed) return;
    dirtyRef.current = true;
    const next = { ...form, ...patch };
    setForm(next);
    if (patch.entry_date !== undefined) setFieldErrors((previous) => ({ ...previous, entry_date: "" }));
    work.update({ data: toDraftData(next) });
  };

  const changeImages = (next: PickedImage[]) => {
    if (committed) return;
    dirtyRef.current = true;
    const normalized = next.map((image, index) => ({ ...image, position: index }));
    setImages(normalized);
    work.update({ images: normalized });
  };

  const submit = async (action: DraftAction) => {
    if (submitting !== null || committed) return;
    setError(null);
    const found = validateEditorForm(form);
    setFieldErrors(found);
    if (Object.keys(found).length) {
      setError("还有需要修正的字段（见下方提示）。内容没有提交。");
      return;
    }
    if (action === "publish" && blockers.length) {
      setError(`公开前还需要：${blockers.join("、")}。内容没有公开，草稿仍在。`);
      return;
    }
    if (action === "save" && !form.title.trim() && !form.content_md.trim() && images.length === 0) {
      setError("先写一点内容再保存：空手记不会创建正式草稿（自动保存会先建立工作副本）。");
      return;
    }
    setSubmitting(action);
    try {
      // 先确保工作副本是最新内容；自动保存不碰正式内容。
      const saved = await work.saveNow();
      if (!saved) {
        setError("还没有可提交的内容：先写一点正文或标题（自动保存会先建立工作副本）。");
        return;
      }
      const commitKey = commitKeyRef.current ?? newCommitKey();
      commitKeyRef.current = commitKey;
      const result = await commitWorkDraft(csrfToken, saved.id, saved.draft_version, {
        action,
        expectedTargetVersion: expectedTargetVersion(entry),
        commitKey,
      });
      commitKeyRef.current = null;
      // 已提交：本机恢复副本不该再被当成「未同步修改」提示（正式内容已是这份内容）。
      work.discardLocalCopy();
      setSuccess({
        message: describeCommitSuccess(result),
        targetId: result.target_id,
        status: result.status,
        visibility: result.visibility,
        action: result.action,
      });
    } catch (failure) {
      setError(describeCommitError(failure));
    } finally {
      setSubmitting(null);
    }
  };

  const adoptLocalCopy = () => {
    const copy = work.localCopy;
    if (!copy) return;
    setForm(formFromData(copy.data, formRef.current));
    setImages(copy.images);
    adoptedRef.current = true;
    work.adoptLocalCopy();
  };

  const reloadLatest = async () => {
    adoptedRef.current = false;
    dirtyRef.current = false;
    await work.resolveConflict("reload-latest");
  };

  const saveAsNew = async () => {
    adoptedRef.current = false;
    await work.resolveConflict("save-as-new");
  };

  const discardWorkCopy = async () => {
    setDiscardConfirm(false);
    await work.discard();
    setDiscarded(true);
    setSuccess(null);
    adoptedRef.current = true;
  };

  const successPanel = success ? (
    <section className={styles.notice} role="status" data-editor-success>
      <p>{success.message}</p>
      <div className={styles.actions}>
        {success.status === "published" ? (
          <SiteLink
            className={styles.button}
            href={`/apps/journal/${encodeURIComponent(success.targetId)}`}
            source="top-nav"
          >
            查看手记
          </SiteLink>
        ) : null}
        <SiteLink
          className={`${styles.button} ${styles.buttonGhost}`}
          href={withReturnTo(
            `/admin/journal/${encodeURIComponent(success.targetId)}/edit`,
            returnTo,
          )}
          source="top-nav"
        >
          继续编辑（打开新的工作副本）
        </SiteLink>
        <SiteLink
          className={`${styles.button} ${styles.buttonGhost}`}
          href={returnTo ?? "/admin"}
          source="top-nav"
        >
          {returnTo ? "返回来源" : "回到创作台"}
        </SiteLink>
      </div>
    </section>
  ) : null;

  const commitButtons = (
    <>
      {canSave ? (
        <button
          className={styles.button}
          type="button"
          disabled={submitting !== null || committed}
          data-editor-save
          data-editor-submit-action="save"
          onClick={() => void submit("save")}
        >
          {submitting === "save" ? "保存中…" : ACTION_LABELS.save}
        </button>
      ) : null}
      {canPublish ? (
        <button
          className={`${styles.button} ${styles.buttonGhost}`}
          type="button"
          disabled={submitting !== null || committed}
          data-editor-publish
          data-editor-submit-action="publish"
          onClick={() => void submit("publish")}
        >
          {submitting === "publish" ? "公开中…" : ACTION_LABELS.publish}
        </button>
      ) : null}
      {canUpdate ? (
        <button
          className={styles.button}
          type="button"
          disabled={submitting !== null || committed}
          data-editor-update
          data-editor-submit-action="update"
          onClick={() => void submit("update")}
        >
          {submitting === "update" ? "更新中…" : ACTION_LABELS.update}
        </button>
      ) : null}
    </>
  );

  // 状态槽只放 C2 的 SyncStatus；本机恢复副本的两个明确动作放页面顶部（契约 §9.4）。
  const syncSlot = (
    <SyncStatus state={work.state} message={work.syncMessage} lastSyncedAt={work.lastSyncedAt} />
  );

  return (
    <>
      <EditorShell
        title={mode === "new" ? "写手记" : entry?.title || "编辑手记"}
        subtitle={dateHint ?? undefined}
        returnTo={returnTo}
        contentType="journal"
        status={syncSlot}
        actions={commitButtons}
      >
        <div className={styles.editorBody} data-journal-editor={entry?.id ?? "new"}>
          {/* 本机恢复副本：不静默选择，给「采用本机修改 / 放弃本机修改」两个明确动作。 */}
          {work.recoveryNotice && !committed ? (
            <div className={styles.noticeInfo} role="status" data-editor-recovery>
              <p>{work.recoveryNotice}</p>
              <div className={styles.actions}>
                {work.localCopy ? (
                  <button
                    className={styles.button}
                    type="button"
                    data-workdraft-adopt-local
                    onClick={adoptLocalCopy}
                  >
                    采用本机修改
                  </button>
                ) : null}
                <button
                  className={`${styles.button} ${styles.buttonGhost}`}
                  type="button"
                  data-workdraft-discard-local
                  onClick={() => work.discardLocalCopy()}
                >
                  放弃本机修改
                </button>
              </div>
            </div>
          ) : null}
          {/* 冲突处理按钮必须可点：放在 disabled fieldset 之外。 */}
          {work.state === "conflict" ? (
            <ConflictNotice
              onReload={() => void reloadLatest()}
              onSaveAsNew={() => void saveAsNew()}
            />
          ) : null}
          <fieldset className={styles.editorFieldset} disabled={committed}>
            <div className={styles.editorMain}>
              <div className={styles.editorMainRow}>
                <label className={styles.field}>
                  <span className={styles.label}>日期</span>
                  <input
                    className={styles.input}
                    type="date"
                    value={form.entry_date}
                    data-journal-date
                    data-editor-field="date"
                    aria-invalid={fieldErrors.entry_date ? "true" : undefined}
                    onChange={(event) => changeForm({ entry_date: event.target.value })}
                  />
                  {fieldErrors.entry_date ? (
                    <span className={styles.fieldError}>{fieldErrors.entry_date}</span>
                  ) : null}
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>标题</span>
                  <input
                    className={styles.input}
                    value={form.title}
                    data-journal-title
                    data-editor-field="title"
                    aria-invalid={fieldErrors.title ? "true" : undefined}
                    onChange={(event) => changeForm({ title: event.target.value })}
                  />
                  {fieldErrors.title ? (
                    <span className={styles.fieldError}>{fieldErrors.title}</span>
                  ) : null}
                </label>
              </div>

              <div className={styles.editorPanes}>
                <div className={styles.editorTabs} role="tablist" aria-label="写作与预览">
                  <button
                    type="button"
                    role="tab"
                    className={styles.editorTab}
                    aria-selected={pane === "write" ? "true" : "false"}
                    data-journal-pane="write"
                    onClick={() => setPane("write")}
                  >
                    写
                  </button>
                  <button
                    type="button"
                    role="tab"
                    className={styles.editorTab}
                    aria-selected={pane === "preview" ? "true" : "false"}
                    data-journal-pane="preview"
                    onClick={() => setPane("preview")}
                  >
                    预览
                  </button>
                </div>

                {pane === "write" ? (
                  <label className={styles.field}>
                    <span className={styles.label}>
                      正文（Markdown，与文章共用同一套渲染；{[...form.content_md].length} /{" "}
                      {CONTENT_MAX_CODEPOINTS} 字）
                    </span>
                    <textarea
                      className={styles.textarea}
                      value={form.content_md}
                      data-journal-content
                      data-editor-field="content"
                      aria-invalid={fieldErrors.content_md ? "true" : undefined}
                      onChange={(event) => changeForm({ content_md: event.target.value })}
                    />
                    {fieldErrors.content_md ? (
                      <span className={styles.fieldError}>{fieldErrors.content_md}</span>
                    ) : null}
                  </label>
                ) : (
                  <div className={styles.markdownPreview} data-journal-preview>
                    {form.content_md.trim() ? (
                      <MarkdownView result={parseContent(form.content_md)} />
                    ) : (
                      <p className={styles.hint}>还没有正文：写一点内容再预览。</p>
                    )}
                  </div>
                )}
              </div>

              {publishedHint ? (
                <p className={styles.noticeInfo} role="note">
                  {publishedHint}
                </p>
              ) : null}

              {canPublish && blockers.length ? (
                <ul className={styles.editorBlockers} data-editor-blockers role="note">
                  {blockers.map((blocker) => (
                    <li key={blocker}>公开前还需要：{blocker}</li>
                  ))}
                </ul>
              ) : null}

              {work.authExpired ? (
                <p className={styles.notice} role="alert">
                  登录已失效，本机输入已保留。
                  <SiteLink className={styles.button} href="/admin/login" source="top-nav">
                    重新登录
                  </SiteLink>
                </p>
              ) : null}

              {error ? (
                <p className={styles.notice} role="alert" data-editor-error>
                  {error}
                </p>
              ) : null}

              {successPanel}

              {discarded ? (
                <p className={styles.noticeInfo} role="status" data-journal-discarded>
                  已丢弃工作副本（正式内容与已公开内容都没有被改动）。可以返回来源页，或重新写一篇。
                </p>
              ) : null}
            </div>

            <aside className={styles.editorAside} aria-label="次要信息">
              <p
                className={styles.editorAux}
                data-editor-status={statusValue}
                data-editor-visibility={visibilityValue}
              >
                当前状态：{statusLine(entry, false)}
                {timezone ? ` · 站点时区 ${timezone}` : ""}
                {today ? ` · 今天 ${today}` : ""}
              </p>
              <p className={styles.editorAux}>
                {mode === "new"
                  ? "新建默认是草稿且仅自己可见；保存不会公开。"
                  : "自动保存只写工作副本，访客看到的仍是正式内容。"}
              </p>

              <label className={styles.field}>
                <span className={styles.label}>心情（可空）</span>
                <input
                  className={styles.input}
                  value={form.mood}
                  data-journal-mood
                  data-editor-field="mood"
                  aria-invalid={fieldErrors.mood ? "true" : undefined}
                  onChange={(event) => changeForm({ mood: event.target.value })}
                />
                {fieldErrors.mood ? (
                  <span className={styles.fieldError}>{fieldErrors.mood}</span>
                ) : null}
                <span className={styles.hint}>
                  快捷选择：
                  {MOOD_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className={`${styles.button} ${styles.buttonGhost}`}
                      disabled={committed}
                      data-journal-mood-preset={preset}
                      onClick={() => changeForm({ mood: preset })}
                    >
                      {preset}
                    </button>
                  ))}
                </span>
              </label>

              <label className={styles.field}>
                <span className={styles.label}>地点（可空）</span>
                <input
                  className={styles.input}
                  value={form.location}
                  data-journal-location
                  data-editor-field="location"
                  aria-invalid={fieldErrors.location ? "true" : undefined}
                  onChange={(event) => changeForm({ location: event.target.value })}
                />
                {fieldErrors.location ? (
                  <span className={styles.fieldError}>{fieldErrors.location}</span>
                ) : null}
              </label>

              <div className={styles.field}>
                <span className={styles.label}>图片（最多 9 张；用共享选择器选，不再输入媒体 ID）</span>
                <button
                  className={styles.button}
                  type="button"
                  data-journal-media-open
                  data-media-picker-open=""
                  disabled={committed}
                  onClick={() => setPickerOpen(true)}
                >
                  {images.length ? "编辑图片（顺序 / 替代文本）" : "选择图片"}
                </button>
                {images.length ? (
                  <ul className={styles.imageList} data-journal-images>
                    {images.map((image, index) => (
                      <li
                        className={styles.imageRow}
                        key={`${image.media_id}-${index}`}
                        data-journal-image={image.media_id}
                      >
                        <span>
                          #{index + 1}
                          {image.media ? (
                            <MediaThumb media={image.media} size="sm" />
                          ) : (
                            <span className={styles.thumbFailed}>缩略图暂时取不到</span>
                          )}
                          {image.alt ? <span> {image.alt}</span> : null}
                        </span>
                        <span className={styles.hint}>
                          {image.alt ? "" : "（还没写替代文本，发布前必须补）"}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={styles.hint}>还没有图片；图片是可选的，不影响保存草稿。</p>
                )}
              </div>

              <label className={styles.field}>
                <span className={styles.label}>关联文章（可选）</span>
                <select
                  className={styles.select}
                  value={form.post_id ?? ""}
                  data-journal-post
                  onChange={(event) => changeForm({ post_id: event.target.value || null })}
                >
                  <option value="">不关联</option>
                  {(posts ?? []).map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {postsError ? <span className={styles.fieldError}>{postsError}</span> : null}
                {posts === null && !postsError ? (
                  <span className={styles.hint}>正在读取公开文章…</span>
                ) : null}
                {posts !== null && posts.length === 0 ? (
                  <span className={styles.hint}>还没有公开文章可关联。</span>
                ) : null}
              </label>

              <div className={styles.actions}>
                {discardConfirm ? (
                  <>
                    <button
                      className={styles.buttonDanger}
                      type="button"
                      data-journal-discard-confirm
                      onClick={() => void discardWorkCopy()}
                    >
                      确认丢弃工作副本
                    </button>
                    <button
                      className={`${styles.button} ${styles.buttonGhost}`}
                      type="button"
                      onClick={() => setDiscardConfirm(false)}
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <button
                    className={`${styles.button} ${styles.buttonGhost}`}
                    type="button"
                    disabled={committed || work.draft === null}
                    data-journal-discard
                    onClick={() => setDiscardConfirm(true)}
                  >
                    丢弃工作副本
                  </button>
                )}
              </div>
              <p className={styles.editorAux}>
                丢弃只删除工作草稿，不动正式内容、已公开内容与媒体文件。
              </p>
            </aside>
          </fieldset>
        </div>
      </EditorShell>

      <MediaPickerDialog
        open={pickerOpen}
        csrfToken={csrfToken}
        selected={images}
        onConfirm={(next) => changeImages(next)}
        onClose={() => setPickerOpen(false)}
        max={9}
      />
    </>
  );
}

/** 供测试与页面复用：新建页的初始表单（也用于预览/校验的单测）。 */
export function initialFormFor(entry: JournalAdminEntry | null, initialDate: string): JournalForm {
  return entry ? formFromEntry(entry) : emptyForm(initialDate);
}
