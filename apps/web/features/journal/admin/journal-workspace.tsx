"use client";

/**
 * 手记管理端（05 §7、验收 1/6）。
 *
 * 边界（01 §3）：这里**不做访问控制** —— 隐藏入口不是安全边界，读写权限一律由
 * FastAPI 判断；未登录时页面给出「去登录」的入口并说明真实权限在后端。
 *
 * 三条必须如实呈现的规则：
 *  1. 新建**总是** draft + private；要公开必须显式「发布」再「设为公开」两步；
 *  2. 412（版本冲突）时**保留未保存输入**，提示读取最新版本后再决定，不自动覆盖；
 *  3. 一张图还有别的公开引用时（`shared_media`），明确说明「切为私密不会撤回它」
 *     —— 不声称「撤回了日记，图就没了」（05 §11）。
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";

import { useAdminSession } from "@/features/metanav/admin/session";
import type { SessionStatus } from "@/features/auth/api";
import { SiteLink } from "@/features/runtime/navigation/site-link";
import { ApiClientError } from "@/lib/api/client";

import {
  createEntry,
  deleteEntry,
  getAdminEntry,
  listAdminEntries,
  publishEntry,
  setVisibility,
  unpublishEntry,
  updateEntry,
} from "../api";
import { publishBlockers, validateDraft } from "../failure";
import styles from "../journal.module.css";
import { formatEntryDate, imageUrl } from "../paths";
import type { JournalAdminEntry, JournalImage } from "../types";

interface Draft {
  entry_date: string;
  title: string;
  content_md: string;
  mood: string;
  location: string;
  images: { media_id: string; alt: string }[];
}

function emptyDraft(today: string): Draft {
  return { entry_date: today, title: "", content_md: "", mood: "", location: "", images: [] };
}

function draftFromEntry(entry: JournalAdminEntry): Draft {
  return {
    entry_date: entry.entry_date,
    title: entry.title,
    content_md: entry.content_md,
    mood: entry.mood,
    location: entry.location,
    images: [...entry.images]
      .sort((a, b) => a.position - b.position)
      .map((image) => ({ media_id: image.media_id, alt: image.alt })),
  };
}

function describeWriteFailure(error: unknown): { message: string; conflict: boolean } {
  if (error instanceof ApiClientError) {
    if (error.status === 412) {
      return {
        message: "这篇手记已在别处更新（412）。你的输入还留着：先重新读取最新版本，再决定要不要覆盖。",
        conflict: true,
      };
    }
    if (error.status === 428) {
      return { message: "缺少版本条件（428）：请重新读取这一条再提交。", conflict: true };
    }
    if (error.status === 409) return { message: error.message, conflict: false };
    if (error.status === 401) return { message: "需要站主登录（401）。", conflict: false };
    if (error.status === 422) {
      const fields = Object.entries(error.fields)
        .map(([key, messages]) => `${key}：${messages.join("；")}`)
        .join(" / ");
      return { message: `字段校验失败（422）：${fields || error.message}`, conflict: false };
    }
    return { message: `保存失败（HTTP ${error.status} · ${error.code}）`, conflict: false };
  }
  return { message: "连不上服务，改动没有保存。", conflict: false };
}

export function JournalWorkspace(): ReactNode {
  const { state: sessionState } = useAdminSession();

  if (sessionState.status === "loading") {
    return (
      <p className={styles.empty} role="status">
        正在读取站主会话…
      </p>
    );
  }
  if (sessionState.status === "failed") {
    return (
      <div className={styles.empty} role="alert">
        <p>{sessionState.message}</p>
        <SiteLink className={styles.button} href="/admin/login" source="top-nav">
          去登录
        </SiteLink>
      </div>
    );
  }
  return <Workspace session={sessionState.session} />;
}

function Workspace({ session }: { session: SessionStatus }): ReactNode {
  const [entries, setEntries] = useState<JournalAdminEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; tone: "info" | "error" } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<JournalAdminEntry | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const authenticated = session.authenticated;
  const csrfToken = session.csrf_token;

  const reload = useCallback(async () => {
    try {
      const page = await listAdminEntries({ limit: 30 });
      setEntries(page.items);
      setLoadError(null);
    } catch (error) {
      setEntries(null);
      setLoadError(describeWriteFailure(error).message);
    }
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    listAdminEntries({ limit: 30 })
      .then((page) => {
        if (!cancelled) {
          setEntries(page.items);
          setLoadError(null);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(describeWriteFailure(error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [authenticated]);

  if (!authenticated) {
    return (
      <div className={styles.empty} role="status">
        <h1 className={styles.title}>需要站主登录</h1>
        <p>
          管理接口只接受已登录的站主会话。请先到{" "}
          <SiteLink href="/admin/login" source="top-nav">
            站主登录
          </SiteLink>
          。
        </p>
        <p className={styles.hint}>
          说明：本页不做路由保护 —— 真正的权限判断在后端（01 §3）。
        </p>
      </div>
    );
  }

  const startCreate = () => {
    setEditing(null);
    setFieldErrors({});
    // 编辑区的日期默认值只是**表单初值**（站主会自己改）。真正的「今天是哪一天」
    // 由公开日历接口的 `today` 给出（明确展示时区），管理端不自己算一个可能差一天的日期。
    setDraft(emptyDraft(new Date().toISOString().slice(0, 10)));
  };

  const startEdit = async (entry: JournalAdminEntry) => {
    setNotice(null);
    try {
      const fresh = await getAdminEntry(entry.id);
      setEditing(fresh);
      setFieldErrors({});
      setDraft(draftFromEntry(fresh));
    } catch (error) {
      setNotice({ message: describeWriteFailure(error).message, tone: "error" });
    }
  };

  const submit = async () => {
    if (!draft) return;
    const errors = validateDraft(draft);
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;

    const payload = {
      ...draft,
      images: draft.images.map((image, index) => ({ ...image, position: index })),
    };
    setNotice(null);
    try {
      if (editing) {
        const saved = await updateEntry(editing.id, payload, editing.version, csrfToken);
        setEditing(saved);
        setDraft(draftFromEntry(saved));
        setNotice({ message: "已保存。", tone: "info" });
      } else {
        const created = await createEntry(payload, csrfToken);
        setEditing(created);
        setDraft(draftFromEntry(created));
        setNotice({
          message: "已新建为草稿且仅自己可见。要公开请先「发布」，再「设为公开」。",
          tone: "info",
        });
      }
      await reload();
    } catch (error) {
      setNotice({ message: describeWriteFailure(error).message, tone: "error" });
    }
  };

  const act = async (
    action: (entry: JournalAdminEntry) => Promise<JournalAdminEntry>,
    successMessage: string,
  ) => {
    if (!editing) return;
    setNotice(null);
    try {
      const updated = await action(editing);
      setEditing(updated);
      setDraft(draftFromEntry(updated));
      setNotice({ message: successMessage, tone: "info" });
      await reload();
    } catch (error) {
      setNotice({ message: describeWriteFailure(error).message, tone: "error" });
    }
  };

  const remove = async () => {
    if (!editing) return;
    setNotice(null);
    try {
      await deleteEntry(editing.id, editing.version, csrfToken);
      setEditing(null);
      setDraft(null);
      setNotice({ message: "已软删除（数据保留，可人工恢复）。", tone: "info" });
      await reload();
    } catch (error) {
      setNotice({ message: describeWriteFailure(error).message, tone: "error" });
    }
  };

  const blockers = draft ? publishBlockers(draft) : [];

  return (
    <div>
      <header className={styles.bar}>
        <div>
          <p className="kick">{"// Journal Admin"}</p>
          <h1 className={styles.title}>手记管理</h1>
          <p className={styles.lead}>
            新建的手记默认是<strong>草稿</strong>且<strong>仅自己可见</strong>；
            公开需要「发布」与「设为公开」两步都完成。
          </p>
        </div>
        <div className={styles.actions}>
          {/*
            P5 · C4：独立编辑页入口。旧工作台保留全部能力（新建/编辑/发布/可见性/删除），
            这两条只是把「新建手记」「继续编辑」接到新编辑器，不替换旧流程。
          */}
          <SiteLink
            className={styles.button}
            href="/admin/journal/new"
            source="top-nav"
            data-journal-new-page
          >
            新建手记（独立页）
          </SiteLink>
          <button className={`${styles.button} ${styles.buttonGhost}`} type="button" onClick={startCreate}>
            写一篇（本页）
          </button>
          <button
            className={`${styles.button} ${styles.buttonGhost}`}
            type="button"
            onClick={() => void reload()}
          >
            刷新列表
          </button>
        </div>
      </header>

      {notice ? (
        <p className={styles.notice} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.message}
        </p>
      ) : null}

      {loadError ? (
        <p className={styles.notice} role="alert">
          {loadError}
        </p>
      ) : null}

      <h2 className={styles.monthTitle}>全部手记（含草稿与私密）</h2>
      {entries === null && !loadError ? (
        <p className={styles.empty} role="status">
          正在读取…
        </p>
      ) : null}
      {entries !== null && !entries.length ? (
        <p className={styles.empty}>还没有任何手记。点「写一篇」开始。</p>
      ) : null}
      {entries !== null && entries.length ? (
        <ul className={styles.adminList}>
          {entries.map((entry) => (
            <li className={styles.adminRow} key={entry.id}>
              <div className={styles.cardMeta}>
                <span className={styles.chip}>{entry.entry_date}</span>
                <span
                  className={`${styles.statusChip} ${
                    entry.status === "published" ? styles.statusPublished : styles.statusDraft
                  }`}
                >
                  {entry.status === "published" ? "已发布" : "草稿"}
                </span>
                <span
                  className={`${styles.statusChip} ${
                    entry.visibility === "public" ? styles.visibilityPublic : styles.visibilityPrivate
                  }`}
                >
                  {entry.visibility === "public" ? "公开" : "仅自己可见"}
                </span>
                <span className={styles.chip}>{entry.public ? "当前公开可见" : "当前不可见"}</span>
              </div>
              <strong>{entry.title || "（无标题）"}</strong>
              <div className={styles.actions}>
                <button
                  className={`${styles.button} ${styles.buttonGhost}`}
                  type="button"
                  onClick={() => void startEdit(entry)}
                >
                  编辑（本页）
                </button>
                <SiteLink
                  className={`${styles.button} ${styles.buttonGhost}`}
                  href={`/admin/journal/${encodeURIComponent(entry.id)}/edit`}
                  source="top-nav"
                  data-journal-edit-page={entry.id}
                >
                  继续编辑（独立页）
                </SiteLink>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {draft ? (
        <section
          aria-labelledby="journal-editor"
          // 管理端异步读取被编辑的那一条：把 id expose 出来，脚本/测试可以等
          // 「正在编辑的确实是这一条」再点按钮，避免在旧数据上误操作。
          data-journal-editor={editing?.id ?? "new"}
        >
          <h2 className={styles.monthTitle} id="journal-editor">
            {editing ? `编辑：${editing.title || "（无标题）"}` : "新建手记"}
          </h2>
          {editing ? (
            <p className={styles.hint}>
              版本 {editing.version}；保存 / 发布 / 删除都会带上这个版本，冲突时不会被静默覆盖。
            </p>
          ) : null}

          <div className={styles.adminForm}>
            <div className={styles.row2}>
              <label className={styles.field}>
                <span className={styles.label}>日期（YYYY-MM-DD）</span>
                <input
                  className={styles.input}
                  value={draft.entry_date}
                  aria-invalid={fieldErrors.entry_date ? "true" : undefined}
                  aria-describedby={fieldErrors.entry_date ? "journal-date-error" : undefined}
                  onChange={(event) => setDraft({ ...draft, entry_date: event.target.value })}
                />
                {fieldErrors.entry_date ? (
                  <span className={styles.fieldError} id="journal-date-error">
                    {fieldErrors.entry_date}
                  </span>
                ) : null}
              </label>
              <label className={styles.field}>
                <span className={styles.label}>心情（可空）</span>
                <input
                  className={styles.input}
                  value={draft.mood}
                  aria-invalid={fieldErrors.mood ? "true" : undefined}
                  onChange={(event) => setDraft({ ...draft, mood: event.target.value })}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>地点（可空）</span>
                <input
                  className={styles.input}
                  value={draft.location}
                  aria-invalid={fieldErrors.location ? "true" : undefined}
                  onChange={(event) => setDraft({ ...draft, location: event.target.value })}
                />
              </label>
            </div>

            <label className={styles.field}>
              <span className={styles.label}>标题</span>
              <input
                className={styles.input}
                value={draft.title}
                aria-invalid={fieldErrors.title ? "true" : undefined}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
              {fieldErrors.title ? (
                <span className={styles.fieldError}>{fieldErrors.title}</span>
              ) : null}
            </label>

            <label className={styles.field}>
              <span className={styles.label}>正文（Markdown，与文章共用同一套渲染）</span>
              <textarea
                className={styles.textarea}
                value={draft.content_md}
                onChange={(event) => setDraft({ ...draft, content_md: event.target.value })}
              />
            </label>

            <fieldset className={styles.field}>
              <legend className={styles.label}>图片（可选，最多 9 张；先在上传页拿到媒体 ID）</legend>
              <textarea
                className={styles.textarea}
                style={{ minHeight: "6em" }}
                value={draft.images.map((image) => `${image.media_id} ${image.alt}`).join("\n")}
                aria-label="每行一条：媒体 UUID 与替代文本"
                onChange={(event) => {
                  const images = event.target.value
                    .split("\n")
                    .map((line) => line.trim())
                    .filter(Boolean)
                    .map((line) => {
                      const [media_id = "", ...rest] = line.split(/\s+/);
                      return { media_id, alt: rest.join(" ") || "手记配图" };
                    });
                  setDraft({ ...draft, images });
                }}
              />
              <span className={styles.hint}>
                每行一条：`媒体 UUID 替代文本`。替代文本会作为图片说明（必填，1–200 字）。
              </span>
            </fieldset>

            {editing?.shared_media.length ? (
              <p className={styles.sharedWarning} role="note">
                这张手记里的 {editing.shared_media.length} 张图<strong>还有别的公开引用</strong>
                （公开相册或公开动态），因此把它切为私密<strong>不会</strong>让这些图片从公开相册里消失。
                要真正撤回图片，需要同时撤回其它引用它的公开内容。
              </p>
            ) : null}

            <div className={styles.actions}>
              <button className={styles.button} type="button" onClick={() => void submit()}>
                {editing ? "保存" : "新建草稿"}
              </button>
              {editing && editing.status === "draft" ? (
                <button
                  className={`${styles.button} ${styles.buttonGhost}`}
                  type="button"
                  disabled={blockers.length > 0}
                  title={blockers.length ? `发布前还需要：${blockers.join("、")}` : undefined}
                  onClick={() =>
                    void act((entry) => publishEntry(entry.id, entry.version, csrfToken), "已发布。")
                  }
                >
                  发布
                </button>
              ) : null}
              {editing && editing.status === "published" ? (
                <button
                  className={`${styles.button} ${styles.buttonGhost}`}
                  type="button"
                  onClick={() =>
                    void act((entry) => unpublishEntry(entry.id, entry.version, csrfToken), "已撤回为草稿。")
                  }
                >
                  撤回为草稿
                </button>
              ) : null}
              {editing ? (
                <button
                  className={`${styles.button} ${styles.buttonGhost}`}
                  type="button"
                  onClick={() =>
                    void act(
                      (entry) =>
                        setVisibility(
                          entry.id,
                          entry.visibility === "public" ? "private" : "public",
                          entry.version,
                          csrfToken,
                        ),
                      "可见性已切换（公开端点立即生效）。",
                    )
                  }
                >
                  {editing.visibility === "public" ? "设为仅自己可见" : "设为公开"}
                </button>
              ) : null}
              {editing ? (
                <button
                  className={`${styles.button} ${styles.buttonDanger}`}
                  type="button"
                  onClick={() => void remove()}
                >
                  删除（软删除）
                </button>
              ) : null}
              <button
                className={`${styles.button} ${styles.buttonGhost}`}
                type="button"
                onClick={() => {
                  setDraft(null);
                  setEditing(null);
                  setFieldErrors({});
                }}
              >
                关闭编辑区
              </button>
            </div>

            {editing ? (
              <p className={styles.hint}>
                {editing.images.length
                  ? `当前 ${editing.images.length} 张图：`
                  : "当前没有图片。"}
              </p>
            ) : null}
            {editing?.images.length ? (
              <ul className={styles.imageList}>
                {editing.images.map((image) => (
                  <li className={styles.imageRow} key={image.media_id}>
                    <span>
                      #{image.position} · {image.alt}
                    </span>
                    <span className={styles.hint}>
                      {image.still_public ? "仍有别的公开引用（切私密不会撤回它）" : "仅本篇引用"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}

            <PreviewPanel draft={draft} />
          </div>
        </section>
      ) : null}
    </div>
  );
}

function PreviewPanel({ draft }: { draft: Draft }): ReactNode {
  return (
    <section className={styles.empty} aria-label="公开预览">
      <p className={styles.hint}>
        公开预览（只显示真正公开时会出现的字段；日期按展示时区，不做 UTC 转换）：
      </p>
      <p>
        <strong>{formatEntryDate(draft.entry_date)}</strong>
        {draft.mood ? ` · ${draft.mood}` : ""}
        {draft.location ? ` · ${draft.location}` : ""}
      </p>
      <p>{draft.title || "（无标题）"}</p>
      <p className={styles.hint}>{(draft.content_md || "").slice(0, 160) || "（还没有正文）"}</p>
      <p className={styles.hint}>{draft.images.length} 张图</p>
    </section>
  );
}

/** 供测试与「图片行解析」单测使用。 */
export function parseImageLines(value: string): { media_id: string; alt: string }[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [media_id = "", ...rest] = line.split(/\s+/);
      return { media_id, alt: rest.join(" ") || "手记配图" };
    });
}

export type { JournalImage };
