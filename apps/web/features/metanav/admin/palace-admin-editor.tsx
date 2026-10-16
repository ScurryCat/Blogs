"use client";

/**
 * 管理：单个专题的编辑与预览（`/admin/palaces/<id>`）。
 *
 *  - 读取管理详情（含草稿关系与冲突提示）+ ETag；保存时用 `If-Match: "<version>"`；
 *  - **预览**用管理 DTO，不请求公共 URL：草稿文章在预览里标出来，不会被误认为已公开；
 *  - 文章顺序用上移 / 下移与「加入 / 移除」维护，提交时整体替换（05 §7）；
 *  - 412 时保留未保存输入，提示重新读取，不自动覆盖；发布需要至少一篇公开文章。
 */

import Link from "next/link";
import { useCallback, useMemo, useState, type ReactNode } from "react";

import { getAdminPalace, listPostsByCategory, publishPalace, unpublishPalace, updatePalace } from "../api";
import { isAbort } from "../failure";
import { formatDate, useLoader } from "../host";
import styles from "../metanav.module.css";
import { FIELD_LABELS, PALACE_FIELDS, type PalaceAdmin, type PostSummary } from "../types";
import { formatAliasLines, parseAliasLines } from "./alias-lines";
import { AdminNotice, describeWriteFailure, unauthorisedHint, useAdminSession } from "./session";

// 文章选择器复用公开文章列表接口：文章管理 UI 属后续功能（05 §7 末尾）。
const PICKER_CATEGORIES = ["TECH", "LIFE", "TOOL", "GAME", "BOOK", "INFO", "LOG"];

function PostPicker({
  chosen,
  onAdd,
  posts,
  loading,
}: {
  chosen: readonly string[];
  onAdd: (post: PostSummary) => void;
  posts: readonly PostSummary[];
  loading: boolean;
}): ReactNode {
  return (
    <div className={styles.field}>
      <span className={styles.label}>加入文章（按分类读取公开文章）</span>
      {loading ? <p className={styles.hint}>正在读取公开文章…</p> : null}
      <ul className={styles.postPicker}>
        {posts.map((post) => (
          <li className={styles.postRow} key={post.id}>
            <span className={styles.postRowInfo}>
              <span>{post.title}</span>
              <span className={styles.postRowMeta}>
                /{post.slug} · {post.category} · {formatDate(post.display_date ?? post.published_at)}
              </span>
            </span>
            <button
              className={`${styles.button} ${styles.buttonGhost}`}
              type="button"
              disabled={chosen.includes(post.id)}
              onClick={() => onAdd(post)}
            >
              {chosen.includes(post.id) ? "已加入" : "加入"}
            </button>
          </li>
        ))}
      </ul>
      {!loading && posts.length === 0 ? <p className={styles.hint}>没有读到公开文章。</p> : null}
    </div>
  );
}

export function PalaceAdminEditor({ id }: { id: string }): ReactNode {
  const { state: sessionState } = useAdminSession();
  const { state, reload } = useLoader((signal) => getAdminPalace(id, signal), [id]);
  const [draft, setDraft] = useState<PalaceAdmin | null>(null);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [keywords, setKeywords] = useState({ name: "", location: "", cognition: "" });
  const [aliasText, setAliasText] = useState("");
  const [order, setOrder] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pickerCategory, setPickerCategory] = useState(PICKER_CATEGORIES[0] ?? "TECH");

  // 服务端数据到了就灌进本地编辑状态；**412 之后不重新灌**，避免覆盖未保存输入。
  // 这是 React 文档里的「渲染期按 props 调整状态」：用 (id, version) 作标记，
  // 避免在 effect 里同步 setState 造成的级联渲染。
  const loaded: PalaceAdmin | null = state.status === "ready" ? state.data : null;
  const loadedKey = loaded ? `${loaded.id}@${loaded.version}` : null;
  const [seenKey, setSeenKey] = useState<string | null>(null);
  if (loaded && loadedKey && loadedKey !== seenKey) {
    setSeenKey(loadedKey);
    if (!conflict) {
      setDraft(loaded);
      setTitle(loaded.title);
      setSummary(loaded.summary);
      setKeywords(loaded.keywords);
      setAliasText(formatAliasLines(loaded.aliases));
      setOrder(loaded.posts.map((item) => item.post_id));
    }
  }

  const { state: pickerState } = useLoader(
    (signal) => listPostsByCategory(pickerCategory, signal),
    [pickerCategory],
  );
  const pickerPosts = useMemo(
    () => (pickerState.status === "ready" ? pickerState.data.items : []),
    [pickerState],
  );

  const csrf = sessionState.status === "ready" ? sessionState.session.csrf_token : null;
  const authenticated = sessionState.status === "ready" && sessionState.session.authenticated;

  const knownPosts = useMemo(() => {
    const map = new Map<string, { title: string; slug: string; status: string; public: boolean }>();
    for (const item of draft?.posts ?? []) {
      map.set(item.post_id, {
        title: item.title,
        slug: item.slug,
        status: item.deleted ? "已删除" : item.status,
        public: item.public,
      });
    }
    for (const post of pickerPosts) {
      if (!map.has(post.id)) map.set(post.id, { title: post.title, slug: post.slug, status: "published", public: true });
    }
    return map;
  }, [draft, pickerPosts]);

  const move = (index: number, delta: number) => {
    setOrder((previous) => {
      const next = [...previous];
      const target = index + delta;
      if (target < 0 || target >= next.length) return previous;
      const [item] = next.splice(index, 1);
      if (item) next.splice(target, 0, item);
      return next;
    });
  };

  const save = useCallback(async () => {
    if (!csrf || !draft) return;
    const { aliases, invalid } = parseAliasLines(aliasText);
    if (invalid.length) {
      setMessage(`别名格式不对：${invalid.join("；")}`);
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const updated = await updatePalace(
        draft.id,
        { title, summary, keywords, aliases, post_ids: order },
        draft.version,
        csrf,
      );
      setConflict(false);
      setDraft(updated);
      setMessage("已保存。");
      reload();
    } catch (error) {
      const failure = describeWriteFailure(error);
      setConflict(failure.conflict);
      setMessage(failure.message);
    } finally {
      setSaving(false);
    }
  }, [aliasText, csrf, draft, keywords, order, reload, summary, title]);

  const act = useCallback(
    async (action: "publish" | "unpublish") => {
      if (!csrf || !draft) return;
      setSaving(true);
      setMessage(null);
      try {
        const updated =
          action === "publish"
            ? await publishPalace(draft.id, draft.version, csrf)
            : await unpublishPalace(draft.id, draft.version, csrf);
        setConflict(false);
        setDraft(updated);
        setMessage(action === "publish" ? "已发布。" : "已撤回。");
        reload();
      } catch (error) {
        if (isAbort(error)) return;
        const failure = describeWriteFailure(error);
        setConflict(failure.conflict);
        setMessage(failure.message);
      } finally {
        setSaving(false);
      }
    },
    [csrf, draft, reload],
  );

  if (state.status === "loading") {
    return <AdminNotice>正在读取专题…</AdminNotice>;
  }
  if (state.status === "failed") {
    return (
      <AdminNotice tone="error">
        {state.failure.kind === "not_found" ? "这条专题不存在（或已彻底删除）。" : state.failure.message}{" "}
        <Link href="/admin/palaces">返回列表</Link>
      </AdminNotice>
    );
  }

  const palace = draft ?? state.data;

  return (
    <div className={styles.wrap}>
      <header className={styles.bar}>
        <div>
          <p className="kick">{"// Admin · Palace"}</p>
          <h2 className={styles.title}>{palace.title}</h2>
          <p className={styles.lead}>
            /{palace.slug} · version {palace.version} ·{" "}
            {palace.status === "published" ? "已发布" : "草稿"} · {palace.public_post_count} 篇公开文章
          </p>
        </div>
        <nav className={styles.actions}>
          <Link className={`${styles.button} ${styles.buttonGhost}`} href="/admin/palaces">
            返回列表
          </Link>
          <Link className={`${styles.button} ${styles.buttonGhost}`} href={`/apps/metanav/palaces/${palace.slug}`}>
            打开公开页
          </Link>
        </nav>
      </header>

      {sessionState.status === "ready" && !sessionState.session.authenticated ? (
        <AdminNotice tone="error">{unauthorisedHint()}</AdminNotice>
      ) : null}
      {message ? <AdminNotice tone={conflict ? "error" : "info"}>{message}</AdminNotice> : null}
      {conflict ? (
        <p className={styles.actions}>
          <button className={styles.button} type="button" onClick={reload}>
            重新读取最新版本
          </button>
          <span className={styles.hint}>重新读取不会自动覆盖你刚才的输入 —— 保存前请再确认一次。</span>
        </p>
      ) : null}

      <section className={styles.adminFields}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="edit-title">
            标题
          </label>
          <input className={styles.input} id="edit-title" value={title} onChange={(event) => setTitle(event.target.value)} />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="edit-summary">
            简介
          </label>
          <textarea
            className={styles.input}
            id="edit-summary"
            rows={2}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
          />
        </div>
        <div className={styles.row2}>
          {PALACE_FIELDS.map((field) => (
            <div className={styles.field} key={field}>
              <label className={styles.label} htmlFor={`edit-${field}`}>
                {FIELD_LABELS[field]}（标准关键词）
              </label>
              <input
                className={styles.input}
                id={`edit-${field}`}
                value={keywords[field]}
                onChange={(event) => setKeywords({ ...keywords, [field]: event.target.value })}
              />
            </div>
          ))}
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="edit-aliases">
            别名（每行「字段:值」；保存即完整替换）
          </label>
          <textarea
            className={styles.input}
            id="edit-aliases"
            rows={4}
            value={aliasText}
            onChange={(event) => setAliasText(event.target.value)}
          />
          <p className={styles.hint}>
            别名重叠会让定位返回多个候选（这是设计允许的）；保存后这里会提示与哪些专题重叠。
          </p>
        </div>

        <div className={styles.field}>
          <span className={styles.label}>文章顺序（章节从上到下）</span>
          {order.length ? (
            <ul className={styles.postPicker}>
              {order.map((postId, index) => {
                const info = knownPosts.get(postId);
                return (
                  <li className={styles.postRow} key={postId}>
                    <span className={styles.postRowInfo}>
                      <span>
                        {`CH.${String(index + 1).padStart(2, "0")} `}
                        {info?.title ?? postId}
                        {info && !info.public ? <span className={styles.previewDraft}>（{info.status} · 不会公开显示）</span> : null}
                      </span>
                      <span className={styles.postRowMeta}>{info ? `/${info.slug}` : postId}</span>
                    </span>
                    <span className={styles.actions}>
                      <button className={`${styles.button} ${styles.buttonGhost}`} type="button" onClick={() => move(index, -1)}>
                        上移
                      </button>
                      <button className={`${styles.button} ${styles.buttonGhost}`} type="button" onClick={() => move(index, 1)}>
                        下移
                      </button>
                      <button
                        className={`${styles.button} ${styles.buttonDanger}`}
                        type="button"
                        onClick={() => setOrder(order.filter((item) => item !== postId))}
                      >
                        移除
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className={styles.empty}>还没有关联文章。发布前必须至少加入一篇**公开**文章。</p>
          )}
        </div>

        <div className={styles.row2}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="picker-category">
              候选文章分类
            </label>
            <select
              className={styles.input}
              id="picker-category"
              value={pickerCategory}
              onChange={(event) => setPickerCategory(event.target.value)}
            >
              {PICKER_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>
        </div>
        <PostPicker
          chosen={order}
          posts={pickerPosts}
          loading={pickerState.status === "loading"}
          onAdd={(post) => setOrder((previous) => [...previous, post.id])}
        />

        <div className={styles.actions}>
          <button className={styles.button} type="button" disabled={!authenticated || saving} onClick={() => void save()}>
            {saving ? "保存中…" : "保存修改"}
          </button>
          {palace.status === "published" ? (
            <button
              className={`${styles.button} ${styles.buttonGhost}`}
              type="button"
              disabled={!authenticated || saving}
              onClick={() => void act("unpublish")}
            >
              撤回
            </button>
          ) : (
            <button
              className={styles.button}
              type="button"
              disabled={!authenticated || saving}
              onClick={() => void act("publish")}
            >
              发布
            </button>
          )}
        </div>

        {palace.conflicts.length ? (
          <div className={styles.preview}>
            <p className="kick">{"// Keyword Conflicts"}</p>
            {palace.conflicts.map((item) => (
              <p key={`${item.field}:${item.normalized_value}`}>
                {FIELD_LABELS[item.field]}「{item.value}」也出现在：
                {item.palaces.map((other) => `${other.title}（${other.status}）`).join("、")}
              </p>
            ))}
            <p className={styles.hint}>
              允许发布：定位会返回多个候选，由访客自己选。这里只是提醒你确认这是有意的。
            </p>
          </div>
        ) : null}

        <div className={styles.preview}>
          <p className="kick">{"// Preview"}</p>
          <h3 className={styles.cardTitle}>{title || "（还没有标题）"}</h3>
          <p className={styles.excerpt}>{summary || "（还没有简介）"}</p>
          <ul className={styles.keywords}>
            {PALACE_FIELDS.map((field) => (
              <li className={styles.keywordChip} key={field}>
                <b>{FIELD_LABELS[field]}</b>
                {keywords[field] || "—"}
              </li>
            ))}
          </ul>
          <ol className={styles.chapters}>
            {order.map((postId, index) => {
              const info = knownPosts.get(postId);
              return (
                <li className={styles.chapter} key={postId}>
                  <span className={styles.chapterNo}>{`CH.${String(index + 1).padStart(2, "0")}`}</span>
                  <span>
                    <h4 className={styles.chapterTitle}>{info?.title ?? postId}</h4>
                    {info && !info.public ? (
                      <p className={styles.previewDraft}>草稿 / 已撤回：公开页不会显示这一篇。</p>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ol>
          <p className={styles.hint}>
            预览用管理接口的数据，草稿文章会标出来；公开页只显示公开文章
            （当前 {palace.public_post_count} 篇）。
          </p>
        </div>
      </section>
    </div>
  );
}
