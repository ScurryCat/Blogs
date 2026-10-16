"use client";

/**
 * 问题记录编辑器（T09 · 印象空间；07 §6、05 §7）。
 *
 * 设计要点：
 *
 *  1. **工作状态与发布状态分开**：表单里是两个独立控件 —— 「工作状态」
 *     （待探索 / 调查中 / 已解决 / 暂搁置）与「发布 / 撤回」按钮。
 *     把工作状态改成「已解决」**不会**自动发布这条记录，
 *     发布也**不会**把工作状态改成「已解决」。界面上写清楚这一点。
 *  2. **「已解决」必须有结果说明**：工作状态选「已解决」而结果为空时，服务端会返回 409；
 *     这里在提交前就提示，但按钮不禁用 —— 让站主看到服务端真正的拒绝原因，
 *     而不是面对一个不知道为什么点不动的按钮。
 *  3. **关联内容不复制正文**：只保存文章 / 作品的 UUID 与顺序；公开侧按当前公开条件
 *     解析，撤回的内容整条消失（不泄漏隐藏标题）。
 *  4. **412 保留输入**，只提示读取最新版本（05 §7）。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import {
  createRecord,
  deleteRecord,
  fetchAdminRecord,
  publishRecord,
  unpublishRecord,
  updateRecord,
  type RecordWriteInput,
} from "../api";
import { WORK_STATUSES, type AdminRecord } from "../types";
import { fieldMessages } from "./session";

interface LinkDraft {
  key: string;
  kind: "repo" | "demo" | "docs" | "proof" | "other";
  label: string;
  url: string;
}

interface RelationDraft {
  key: string;
  id: string;
}

export interface RecordWorkspaceProps {
  csrfToken: string;
  describeError: (error: unknown) => string;
  isConflict: (error: unknown) => boolean;
  createMode: boolean;
  recordId?: string;
  onSaved?: (record: AdminRecord) => void;
}

function newKey(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function RecordWorkspace({
  csrfToken,
  describeError,
  isConflict,
  createMode,
  recordId,
  onSaved,
}: RecordWorkspaceProps): ReactNode {
  const [record, setRecord] = useState<AdminRecord | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "unavailable">(
    createMode ? "ready" : "loading",
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);

  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [background, setBackground] = useState("");
  const [attempts, setAttempts] = useState("");
  const [outcome, setOutcome] = useState("");
  const [workStatus, setWorkStatus] = useState<string>("pending");
  const [links, setLinks] = useState<LinkDraft[]>([]);
  const [posts, setPosts] = useState<RelationDraft[]>([]);
  const [projects, setProjects] = useState<RelationDraft[]>([]);
  const controllerRef = useRef<AbortController | null>(null);

  const applyLoaded = useCallback((loaded: AdminRecord) => {
    setRecord(loaded);
    setSlug(loaded.slug);
    setTitle(loaded.title);
    setBackground(loaded.background);
    setAttempts(loaded.attempts);
    setOutcome(loaded.outcome);
    setWorkStatus(loaded.work_status);
    setLinks(
      loaded.evidence_links.map((link) => ({
        key: newKey(),
        kind: (link.kind as LinkDraft["kind"]) ?? "proof",
        label: link.label,
        url: link.url,
      })),
    );
    setPosts(
      [...loaded.posts]
        .sort((a, b) => a.position - b.position)
        .map((relation) => ({ key: newKey(), id: relation.post_id })),
    );
    setProjects(
      [...loaded.projects]
        .sort((a, b) => a.position - b.position)
        .map((relation) => ({ key: newKey(), id: relation.project_id })),
    );
  }, []);

  useEffect(() => {
    if (createMode || !recordId) return undefined;
    const controller = new AbortController();
    controllerRef.current = controller;
    void (async () => {
      try {
        const loaded = await fetchAdminRecord(recordId, controller.signal);
        applyLoaded(loaded);
        setPhase("ready");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPhase("unavailable");
        setNotice(describeError(error));
      }
    })();
    return () => controller.abort();
  }, [applyLoaded, createMode, describeError, recordId]);

  const reload = useCallback(async () => {
    if (!recordId) return;
    try {
      const loaded = await fetchAdminRecord(recordId);
      applyLoaded(loaded);
      setNotice("已读取最新版本，请重新确认后再提交。");
      setFieldErrors({});
      setConflict(false);
    } catch (error) {
      setNotice(describeError(error));
    }
  }, [applyLoaded, describeError, recordId]);

  const buildPayload = useCallback((): RecordWriteInput => {
    const cleanLinks = links
      .filter((link) => link.label.trim() && link.url.trim())
      .map((link) => ({ kind: link.kind, label: link.label.trim(), url: link.url.trim() }));
    return {
      title: title.trim(),
      background: background.trim(),
      attempts: attempts.trim(),
      outcome: outcome.trim(),
      work_status: workStatus,
      evidence_links: cleanLinks,
      posts: posts
        .filter((draft) => draft.id.trim())
        .map((draft, index) => ({ post_id: draft.id.trim(), position: index })),
      projects: projects
        .filter((draft) => draft.id.trim())
        .map((draft, index) => ({ project_id: draft.id.trim(), position: index })),
    };
  }, [attempts, background, links, outcome, posts, projects, title, workStatus]);

  const handleError = useCallback(
    (error: unknown) => {
      setFieldErrors(fieldMessages(error));
      setNotice(describeError(error));
      setConflict(isConflict(error));
    },
    [describeError, isConflict],
  );

  const save = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    setFieldErrors({});
    setConflict(false);
    try {
      const payload = buildPayload();
      const saved = createMode
        ? await createRecord(csrfToken, { slug: slug.trim(), ...payload })
        : await updateRecord(csrfToken, record!.id, record!.version, payload);
      applyLoaded(saved);
      setNotice(
        createMode
          ? `已创建草稿「${saved.title}」。发布后读者才能看到。`
          : `已保存（version ${saved.version}）。`,
      );
      onSaved?.(saved);
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  }, [applyLoaded, buildPayload, createMode, csrfToken, handleError, onSaved, record, slug]);

  const publish = useCallback(async () => {
    if (!record) return;
    setBusy(true);
    setNotice(null);
    setConflict(false);
    try {
      const saved = await publishRecord(csrfToken, record.id, record.version);
      applyLoaded(saved);
      setNotice("已发布。工作状态没有被改动 —— 两者是独立的。");
      onSaved?.(saved);
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  }, [applyLoaded, csrfToken, handleError, onSaved, record]);

  const unpublish = useCallback(async () => {
    if (!record) return;
    setBusy(true);
    setNotice(null);
    setConflict(false);
    try {
      const saved = await unpublishRecord(csrfToken, record.id, record.version);
      applyLoaded(saved);
      setNotice("已撤回为草稿。工作状态与关联内容都没有被改动。");
      onSaved?.(saved);
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  }, [applyLoaded, csrfToken, handleError, onSaved, record]);

  const remove = useCallback(async () => {
    if (!record) return;
    setBusy(true);
    setNotice(null);
    setConflict(false);
    try {
      await deleteRecord(csrfToken, record.id, record.version);
      setNotice("已软删除。关联的文章与作品完全不受影响。");
      onSaved?.({ ...record, status: "draft" });
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  }, [csrfToken, handleError, onSaved, record]);

  if (phase === "loading") {
    return <p className="pme-hint">正在读取问题记录…</p>;
  }

  if (phase === "unavailable") {
    return (
      <p className="pme-alert" role="alert">
        {notice ?? "读不到这条记录。"}
      </p>
    );
  }

  const resolvedWithoutOutcome = workStatus === "resolved" && !outcome.trim();

  return (
    <form
      className="pme-panel"
      data-record-workspace={createMode ? "create" : (record?.slug ?? "")}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {notice ? (
        <p className="pme-hint" role="status" data-record-notice="">
          {notice}
        </p>
      ) : null}

      {conflict ? (
        <p className="pme-alert" role="alert" data-record-conflict="">
          别处已经改过这条记录。表单里的输入仍然保留，请先「读取最新版本」再提交。
        </p>
      ) : null}

      {record ? (
        <p className="pme-card-meta">
          <span>发布状态：{record.status === "published" ? "已发布" : "草稿"}</span>
          <span>工作状态：{record.work_status_label}</span>
          <span>version {record.version}</span>
        </p>
      ) : null}

      <label className="pme-field">
        <span className="pme-section-title">slug（公开地址，创建后不可改）</span>
        <input
          className="pme-input"
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
          disabled={!createMode}
          required
          pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
          data-record-slug=""
        />
        {fieldErrors.slug ? <span className="pme-alert">{fieldErrors.slug}</span> : null}
      </label>

      <label className="pme-field">
        <span className="pme-section-title">标题（问题是什么）</span>
        <input
          className="pme-input"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
          data-record-title=""
        />
        {fieldErrors.title ? <span className="pme-alert">{fieldErrors.title}</span> : null}
      </label>

      <label className="pme-field">
        <span className="pme-section-title">背景（发布前必填）</span>
        <textarea
          className="pme-input"
          value={background}
          onChange={(event) => setBackground(event.target.value)}
          rows={4}
          data-record-background=""
        />
        {fieldErrors.background ? <span className="pme-alert">{fieldErrors.background}</span> : null}
      </label>

      <label className="pme-field">
        <span className="pme-section-title">尝试（查了什么、试了什么、排除了什么）</span>
        <textarea
          className="pme-input"
          value={attempts}
          onChange={(event) => setAttempts(event.target.value)}
          rows={5}
          data-record-attempts=""
        />
      </label>

      <label className="pme-field">
        <span className="pme-section-title">结果（工作状态为「已解决」时必填）</span>
        <textarea
          className="pme-input"
          value={outcome}
          onChange={(event) => setOutcome(event.target.value)}
          rows={5}
          data-record-outcome=""
        />
        {fieldErrors.outcome ? <span className="pme-alert">{fieldErrors.outcome}</span> : null}
        {resolvedWithoutOutcome && !fieldErrors.outcome ? (
          <span className="pme-hint" data-record-outcome-blocked="">
            工作状态是「已解决」但结果说明是空的：现在提交会被服务端拒绝（409）。
            这不是界面在拦你 —— 已解决的记录必须有实际说明。
          </span>
        ) : null}
      </label>

      <label className="pme-field">
        <span className="pme-section-title">工作状态（与是否发布无关）</span>
        <select
          className="pme-input"
          value={workStatus}
          onChange={(event) => setWorkStatus(event.target.value)}
          data-record-work-status=""
        >
          {WORK_STATUSES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="pme-hint">
          把状态改成「已解决」不会自动发布这条记录；发布也不会改变工作状态。
        </span>
      </label>

      <fieldset className="pme-panel">
        <legend className="pme-section-title">验证链接（可选，http / https）</legend>
        {links.map((link, index) => (
          <div className="pme-actions" key={link.key}>
            <label className="pme-field">
              <span className="pme-section-title">类型</span>
              <select
                className="pme-input"
                value={link.kind}
                onChange={(event) =>
                  setLinks((previous) =>
                    previous.map((item, i) =>
                      i === index ? { ...item, kind: event.target.value as LinkDraft["kind"] } : item,
                    ),
                  )
                }
              >
                <option value="repo">仓库</option>
                <option value="demo">演示</option>
                <option value="docs">文档</option>
                <option value="proof">验证</option>
                <option value="other">其它</option>
              </select>
            </label>
            <label className="pme-field">
              <span className="pme-section-title">文字</span>
              <input
                className="pme-input"
                value={link.label}
                onChange={(event) =>
                  setLinks((previous) =>
                    previous.map((item, i) => (i === index ? { ...item, label: event.target.value } : item)),
                  )
                }
              />
            </label>
            <label className="pme-field">
              <span className="pme-section-title">地址</span>
              <input
                className="pme-input"
                value={link.url}
                onChange={(event) =>
                  setLinks((previous) =>
                    previous.map((item, i) => (i === index ? { ...item, url: event.target.value } : item)),
                  )
                }
                placeholder="https://…"
              />
            </label>
            <button
              className="pme-button pme-button-ghost"
              type="button"
              onClick={() => setLinks((previous) => previous.filter((_item, i) => i !== index))}
            >
              移除
            </button>
          </div>
        ))}
        <button
          className="pme-button pme-button-ghost"
          type="button"
          onClick={() =>
            setLinks((previous) => [...previous, { key: newKey(), kind: "proof", label: "", url: "" }])
          }
        >
          添加验证链接
        </button>
      </fieldset>

      <fieldset className="pme-panel">
        <legend className="pme-section-title">关联文章（粘贴文章 UUID，顺序即展示顺序）</legend>
        <p className="pme-hint">
          只保存关系，不复制标题：文章撤回后公开侧整条消失，不会留下「（已隐藏）」
          —— 那本身就是泄漏。UUID 可在 <code>/admin/moments</code> 之外的文章管理入口复制。
        </p>
        {posts.map((draft, index) => (
          <div className="pme-actions" key={draft.key}>
            <input
              className="pme-input"
              value={draft.id}
              onChange={(event) =>
                setPosts((previous) =>
                  previous.map((item, i) => (i === index ? { ...item, id: event.target.value } : item)),
                )
              }
              data-record-post={index}
              placeholder="文章 UUID"
            />
            <button
              className="pme-button pme-button-ghost"
              type="button"
              onClick={() => setPosts((previous) => previous.filter((_item, i) => i !== index))}
            >
              取消关联
            </button>
          </div>
        ))}
        <button
          className="pme-button pme-button-ghost"
          type="button"
          onClick={() => setPosts((previous) => [...previous, { key: newKey(), id: "" }])}
        >
          添加文章关联
        </button>
        {fieldErrors.posts ? <p className="pme-alert">{fieldErrors.posts}</p> : null}
      </fieldset>

      <fieldset className="pme-panel">
        <legend className="pme-section-title">关联作品（粘贴作品 UUID）</legend>
        {projects.map((draft, index) => (
          <div className="pme-actions" key={draft.key}>
            <input
              className="pme-input"
              value={draft.id}
              onChange={(event) =>
                setProjects((previous) =>
                  previous.map((item, i) => (i === index ? { ...item, id: event.target.value } : item)),
                )
              }
              data-record-project={index}
              placeholder="作品 UUID"
            />
            <button
              className="pme-button pme-button-ghost"
              type="button"
              onClick={() => setProjects((previous) => previous.filter((_item, i) => i !== index))}
            >
              取消关联
            </button>
          </div>
        ))}
        <button
          className="pme-button pme-button-ghost"
          type="button"
          onClick={() => setProjects((previous) => [...previous, { key: newKey(), id: "" }])}
        >
          添加作品关联
        </button>
        {fieldErrors.projects ? <p className="pme-alert">{fieldErrors.projects}</p> : null}
      </fieldset>

      <div className="pme-actions">
        <button className="pme-button" type="submit" disabled={busy} data-record-save="">
          {busy ? "正在提交…" : createMode ? "创建草稿" : "保存"}
        </button>
        {!createMode && record ? (
          <>
            <button
              className="pme-button"
              type="button"
              onClick={() => void publish()}
              disabled={busy}
              data-record-publish=""
            >
              发布
            </button>
            <button
              className="pme-button pme-button-ghost"
              type="button"
              onClick={() => void unpublish()}
              disabled={busy || record.status !== "published"}
              data-record-unpublish=""
            >
              撤回为草稿
            </button>
            <button
              className="pme-button pme-button-ghost"
              type="button"
              onClick={() => void reload()}
              disabled={busy}
            >
              读取最新版本
            </button>
            <button
              className="pme-button pme-button-ghost"
              type="button"
              onClick={() => void remove()}
              disabled={busy}
              data-record-delete=""
            >
              软删除
            </button>
          </>
        ) : null}
      </div>
    </form>
  );
}
