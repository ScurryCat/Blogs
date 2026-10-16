"use client";

/**
 * 管理：专题列表 + 新建（`/admin/palaces`）。
 *
 *  - 列表来自 `GET /admin/nav/palaces`（**只有站主**能读，含草稿与关键词冲突提示）；
 *  - 新建总是草稿，发布要另外点（发布前必须至少一篇公开文章，服务端会 409）；
 *  - 别名用「一行一条：字段:值」的简单格式，重复 / 非法由服务端 422 指出；
 *  - 每个写操作都带 `If-Match`（列表里拿到什么版本就提交什么版本）。
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState, type FormEvent, type ReactNode } from "react";

import { createPalace, deletePalace, listAdminPalaces, publishPalace, unpublishPalace } from "../api";
import { isAbort } from "../failure";
import { useLoader } from "../host";
import styles from "../metanav.module.css";
import { FIELD_LABELS, PALACE_FIELDS, type PalaceAdmin } from "../types";
import { parseAliasLines } from "./alias-lines";
import { AdminNotice, describeWriteFailure, unauthorisedHint, useAdminSession } from "./session";

function StatusChip({ palace }: { palace: PalaceAdmin }): ReactNode {
  const label = palace.deleted_at ? "已删除" : palace.status === "published" ? "已发布" : "草稿";
  const className = palace.status === "published" ? styles.statusPublished : styles.statusDraft;
  return <span className={`${styles.statusChip} ${className}`}>{label}</span>;
}

export function PalaceAdminList(): ReactNode {
  const router = useRouter();
  const { state: sessionState } = useAdminSession();
  const { state, reload } = useLoader((signal) => listAdminPalaces(signal), []);
  const [message, setMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    slug: "",
    title: "",
    summary: "",
    name: "",
    location: "",
    cognition: "",
    aliases: "",
    postIds: "",
  });

  const csrf = sessionState.status === "ready" ? sessionState.session.csrf_token : null;
  const authenticated = sessionState.status === "ready" && sessionState.session.authenticated;

  const onCreate = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!csrf) return;
      const { aliases, invalid } = parseAliasLines(form.aliases);
      if (invalid.length) {
        setMessage(`别名格式不对（每行「字段:值」，字段为 name / location / cognition）：${invalid.join("；")}`);
        return;
      }
      setCreating(true);
      setMessage(null);
      try {
        const created = await createPalace(
          {
            slug: form.slug.trim(),
            title: form.title.trim(),
            summary: form.summary.trim(),
            keywords: {
              name: form.name.trim(),
              location: form.location.trim(),
              cognition: form.cognition.trim(),
            },
            aliases,
            post_ids: form.postIds
              .split(/[\s,]+/)
              .map((item) => item.trim())
              .filter(Boolean),
          },
          csrf,
        );
        router.push(`/admin/palaces/${created.id}`);
      } catch (error) {
        setMessage(describeWriteFailure(error).message);
      } finally {
        setCreating(false);
      }
    },
    [csrf, form, router],
  );

  const act = useCallback(
    async (palace: PalaceAdmin, action: "publish" | "unpublish" | "delete") => {
      if (!csrf) return;
      setMessage(null);
      try {
        if (action === "publish") await publishPalace(palace.id, palace.version, csrf);
        else if (action === "unpublish") await unpublishPalace(palace.id, palace.version, csrf);
        else await deletePalace(palace.id, palace.version, csrf);
        reload();
      } catch (error) {
        if (isAbort(error)) return;
        setMessage(describeWriteFailure(error).message);
      }
    },
    [csrf, reload],
  );

  return (
    <div className={styles.wrap}>
      <header className={styles.bar}>
        <div>
          <p className="kick">{"// Admin · Palaces"}</p>
          <h2 className={styles.title}>专题殿堂</h2>
          <p className={styles.lead}>
            维护标题、简介、三项标准关键词与别名、文章顺序，然后发布或撤回。
            发布要求至少一篇公开文章；别名与其他专题重叠时会在这里提示。
          </p>
        </div>
      </header>

      {sessionState.status === "loading" ? <AdminNotice>正在确认站主会话…</AdminNotice> : null}
      {sessionState.status === "failed" ? <AdminNotice tone="error">{sessionState.message}</AdminNotice> : null}
      {sessionState.status === "ready" && !sessionState.session.authenticated ? (
        <AdminNotice tone="error">{unauthorisedHint()}</AdminNotice>
      ) : null}

      {message ? <AdminNotice tone="error">{message}</AdminNotice> : null}

      {state.status === "failed" ? (
        <AdminNotice tone="error">
          {state.failure.message}{" "}
          <button className={styles.linkButton} type="button" onClick={reload}>
            重新读取
          </button>
        </AdminNotice>
      ) : null}

      <section>
        <h3 className={styles.cardTitle}>新建专题（保存为草稿）</h3>
        <form className={styles.form} onSubmit={onCreate}>
          <div className={styles.row2}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="new-slug">
                slug（公开地址，创建后不可改）
              </label>
              <input
                className={styles.input}
                id="new-slug"
                value={form.slug}
                placeholder="phantom-base"
                onChange={(event) => setForm({ ...form, slug: event.target.value })}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="new-title">
                标题
              </label>
              <input
                className={styles.input}
                id="new-title"
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
              />
            </div>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="new-summary">
              简介
            </label>
            <textarea
              className={styles.input}
              id="new-summary"
              rows={2}
              value={form.summary}
              onChange={(event) => setForm({ ...form, summary: event.target.value })}
            />
          </div>
          <div className={styles.row2}>
            {PALACE_FIELDS.map((field) => (
              <div className={styles.field} key={field}>
                <label className={styles.label} htmlFor={`new-${field}`}>
                  {FIELD_LABELS[field]}
                </label>
                <input
                  className={styles.input}
                  id={`new-${field}`}
                  value={form[field]}
                  onChange={(event) => setForm({ ...form, [field]: event.target.value })}
                />
              </div>
            ))}
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="new-aliases">
              别名（每行「字段:值」，字段为 name / location / cognition）
            </label>
            <textarea
              className={styles.input}
              id="new-aliases"
              rows={3}
              value={form.aliases}
              onChange={(event) => setForm({ ...form, aliases: event.target.value })}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="new-posts">
              文章 UUID（可留空；用空格或逗号分隔，顺序即章节顺序）
            </label>
            <textarea
              className={styles.input}
              id="new-posts"
              rows={2}
              value={form.postIds}
              onChange={(event) => setForm({ ...form, postIds: event.target.value })}
            />
            <p className={styles.hint}>
              还没有文章 UUID？到 <Link href="/admin/palaces">公开文章列表</Link> 或
              `/api/v1/posts` 复制。文章管理 UI 属后续功能（05 §7）。
            </p>
          </div>
          <div className={styles.actions}>
            <button className={styles.button} type="submit" disabled={!authenticated || creating}>
              {creating ? "创建中…" : "创建草稿"}
            </button>
          </div>
        </form>
      </section>

      {state.status === "ready" ? (
        state.data.items.length ? (
          <ul className={styles.adminList}>
            {state.data.items.map((palace) => (
              <li className={styles.adminRow} key={palace.id} data-palace={palace.slug}>
                <p className={styles.cardTitle}>
                  <StatusChip palace={palace} />{" "}
                  <Link href={`/admin/palaces/${palace.id}`}>{palace.title}</Link>
                </p>
                <p className={styles.cardMeta}>
                  <span>/{palace.slug}</span>
                  <span>version {palace.version}</span>
                  <span>{palace.public_post_count} 篇公开文章</span>
                  <span>{palace.posts.length} 篇关联</span>
                </p>
                {palace.conflicts.length ? (
                  <p className={styles.previewDraft}>
                    关键词与其他专题重叠：
                    {palace.conflicts
                      .map((conflict) => `${FIELD_LABELS[conflict.field]}「${conflict.value}」→ ${conflict.palaces.map((item) => item.title).join("、")}`)
                      .join("；")}
                  </p>
                ) : null}
                <div className={styles.actions}>
                  <Link className={`${styles.button} ${styles.buttonGhost}`} href={`/admin/palaces/${palace.id}`}>
                    编辑与预览
                  </Link>
                  {palace.status === "published" ? (
                    <button
                      className={`${styles.button} ${styles.buttonGhost}`}
                      type="button"
                      disabled={!authenticated}
                      onClick={() => void act(palace, "unpublish")}
                    >
                      撤回
                    </button>
                  ) : (
                    <button
                      className={styles.button}
                      type="button"
                      disabled={!authenticated}
                      onClick={() => void act(palace, "publish")}
                    >
                      发布
                    </button>
                  )}
                  <button
                    className={`${styles.button} ${styles.buttonDanger}`}
                    type="button"
                    disabled={!authenticated || Boolean(palace.deleted_at)}
                    onClick={() => void act(palace, "delete")}
                  >
                    软删除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>还没有专题。上面创建第一个草稿吧。</p>
        )
      ) : null}
    </div>
  );
}
