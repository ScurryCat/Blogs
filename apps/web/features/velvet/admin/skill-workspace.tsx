"use client";

/**
 * 技能编辑器（T09；07 §6、05 §7）。
 *
 * 设计要点：
 *
 *  1. **不伪造等级**（07 §6）：表单里**没有**等级 / 熟练度 / 完成度输入框。
 *     能力由「范围说明」+「掌握证据」+「关联作品」三块表达。这也意味着
 *     说不出证据的技能**发布不了** —— 服务端会在 publish 时返回 409。
 *  2. **关联已有作品，不复制履历**：输入的是 `projects` 里的作品 UUID 与顺序；
 *     作品正文只有一份（T06）。关联的作品可以是草稿（站主先建技能再等作品发布），
 *     公开侧由服务端的公开条件兜底。
 *  3. **412 保留输入**：版本冲突时不清空表单，只提示重新读取（05 §7）。
 *  4. **发布门槛的提示放在按钮旁**：范围说明与掌握证据为空时明确写出「现在发布会被拒」，
 *     且按钮文案如实说明，而不是让站主撞一次 409 才知道。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import {
  createSkill,
  deleteSkill,
  fetchAdminSkill,
  publishSkill,
  unpublishSkill,
  updateSkill,
  type SkillWriteInput,
} from "../api";
import { SKILL_DOMAINS, type AdminSkill, type SkillLinkInput, type SkillProjectRelationInput } from "../types";
import { fieldMessages } from "./session";

/** 表单里的一条站外证据链接。 */
interface LinkDraft {
  key: string;
  kind: SkillLinkInput["kind"];
  label: string;
  url: string;
}

/** 表单里的一条作品关联。 */
interface ProjectDraft {
  key: string;
  project_id: string;
}

export interface SkillWorkspaceProps {
  csrfToken: string;
  describeError: (error: unknown) => string;
  isConflict: (error: unknown) => boolean;
  createMode: boolean;
  skillId?: string;
  onSaved?: (skill: AdminSkill) => void;
}

function newKey(): string {
  return Math.random().toString(36).slice(2, 10);
}

function emptyLink(): LinkDraft {
  return { key: newKey(), kind: "repo", label: "", url: "" };
}

function emptyProject(): ProjectDraft {
  return { key: newKey(), project_id: "" };
}

export function SkillWorkspace({
  csrfToken,
  describeError,
  isConflict,
  createMode,
  skillId,
  onSaved,
}: SkillWorkspaceProps): ReactNode {
  const [skill, setSkill] = useState<AdminSkill | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "unavailable">(
    createMode ? "ready" : "loading",
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  /**
   * 版本冲突（412）。命中时**保留**表单里的未保存输入，只额外给出「读取最新版本」
   * 的入口 —— 自动覆盖会把别人的修改吃掉（05 §7）。
   */
  const [conflict, setConflict] = useState(false);

  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [domain, setDomain] = useState<string>("other");
  const [scope, setScope] = useState("");
  const [evidence, setEvidence] = useState("");
  const [position, setPosition] = useState("0");
  const [links, setLinks] = useState<LinkDraft[]>([]);
  const [projects, setProjects] = useState<ProjectDraft[]>([]);
  const controllerRef = useRef<AbortController | null>(null);

  const applyLoaded = useCallback((loaded: AdminSkill) => {
    setSkill(loaded);
    setSlug(loaded.slug);
    setName(loaded.name);
    setDomain(loaded.domain);
    setScope(loaded.scope);
    setEvidence(loaded.evidence);
    setPosition(String(loaded.position));
    setLinks(
      loaded.links.map((link) => ({
        key: newKey(),
        kind: (link.kind as SkillLinkInput["kind"]) ?? "other",
        label: link.label,
        url: link.url,
      })),
    );
    setProjects(
      [...loaded.projects]
        .sort((a, b) => a.position - b.position)
        .map((relation) => ({ key: newKey(), project_id: relation.project_id })),
    );
  }, []);

  useEffect(() => {
    if (createMode || !skillId) return undefined;
    const controller = new AbortController();
    controllerRef.current = controller;
    void (async () => {
      try {
        const loaded = await fetchAdminSkill(skillId, controller.signal);
        applyLoaded(loaded);
        setPhase("ready");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPhase("unavailable");
        setNotice(describeError(error));
      }
    })();
    return () => controller.abort();
  }, [applyLoaded, createMode, describeError, skillId]);

  const reload = useCallback(async () => {
    if (!skillId) return;
    try {
      const loaded = await fetchAdminSkill(skillId);
      applyLoaded(loaded);
      setNotice("已读取最新版本，请重新确认后再提交。");
      setFieldErrors({});
    } catch (error) {
      setNotice(describeError(error));
    }
  }, [applyLoaded, describeError, skillId]);

  const buildPayload = useCallback((): SkillWriteInput => {
    const cleanLinks: SkillLinkInput[] = links
      .filter((link) => link.label.trim() && link.url.trim())
      .map((link) => ({ kind: link.kind, label: link.label.trim(), url: link.url.trim() }));
    const cleanProjects: SkillProjectRelationInput[] = projects
      .filter((draft) => draft.project_id.trim())
      .map((draft, index) => ({ project_id: draft.project_id.trim(), position: index }));
    return {
      name: name.trim(),
      domain,
      scope: scope.trim(),
      evidence: evidence.trim(),
      position: Number.parseInt(position, 10) || 0,
      links: cleanLinks,
      projects: cleanProjects,
    };
  }, [domain, evidence, links, name, position, projects, scope]);

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
        ? await createSkill(csrfToken, { slug: slug.trim(), ...payload })
        : await updateSkill(csrfToken, skill!.id, skill!.version, payload);
      applyLoaded(saved);
      setNotice(
        createMode
          ? `已创建草稿「${saved.name}」。填好范围说明与掌握证据后再发布。`
          : `已保存（version ${saved.version}）。`,
      );
      onSaved?.(saved);
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  }, [applyLoaded, buildPayload, createMode, csrfToken, handleError, onSaved, skill, slug]);

  const publish = useCallback(async () => {
    if (!skill) return;
    setBusy(true);
    setNotice(null);
    setConflict(false);
    try {
      const saved = await publishSkill(csrfToken, skill.id, skill.version);
      applyLoaded(saved);
      setNotice("已发布：技能全书与作品详情都会看到它。");
      onSaved?.(saved);
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  }, [applyLoaded, csrfToken, handleError, onSaved, skill]);

  const unpublish = useCallback(async () => {
    if (!skill) return;
    setBusy(true);
    setNotice(null);
    setConflict(false);
    try {
      const saved = await unpublishSkill(csrfToken, skill.id, skill.version);
      applyLoaded(saved);
      setNotice("已撤回为草稿。关联的作品没有被改动。");
      onSaved?.(saved);
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  }, [applyLoaded, csrfToken, handleError, onSaved, skill]);

  const remove = useCallback(async () => {
    if (!skill) return;
    setBusy(true);
    setNotice(null);
    setConflict(false);
    try {
      await deleteSkill(csrfToken, skill.id, skill.version);
      setNotice("已软删除。作品本身不受影响。");
      onSaved?.({ ...skill, status: "draft" });
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  }, [csrfToken, handleError, onSaved, skill]);

  if (phase === "loading") {
    return <p className="plv-hint">正在读取技能…</p>;
  }

  if (phase === "unavailable") {
    return (
      <p className="plv-alert" role="alert">
        {notice ?? "读不到这门技能。"}
      </p>
    );
  }

  const canPublish = scope.trim().length > 0 && evidence.trim().length > 0;

  return (
    <form
      className="plv-section"
      data-skill-workspace={createMode ? "create" : (skill?.slug ?? "")}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {notice ? (
        <p className="plv-note" role="status" data-skill-notice="">
          {notice}
        </p>
      ) : null}

      {conflict ? (
        <p className="plv-alert" role="alert" data-skill-conflict="">
          别处已经改过这门技能。表单里的输入仍然保留，请先「读取最新版本」，
          确认差异后再提交 —— 这里不会自动覆盖。
        </p>
      ) : null}

      {skill ? (
        <p className="plv-card-meta">
          <span>状态：{skill.status === "published" ? "已发布" : "草稿"}</span>
          <span>version {skill.version}</span>
          {skill.published_at ? <span>发布于 {skill.published_at.slice(0, 10)}</span> : null}
        </p>
      ) : null}

      <label className="plv-field">
        <span className="plv-field-label">slug（公开地址，创建后不可改）</span>
        <input
          className="plv-select"
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
          disabled={!createMode}
          required
          pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
          data-skill-slug=""
        />
        {fieldErrors.slug ? <span className="plv-alert">{fieldErrors.slug}</span> : null}
      </label>

      <label className="plv-field">
        <span className="plv-field-label">技能名称</span>
        <input
          className="plv-select"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          data-skill-name=""
        />
        {fieldErrors.name ? <span className="plv-alert">{fieldErrors.name}</span> : null}
      </label>

      <label className="plv-field">
        <span className="plv-field-label">领域</span>
        <select
          className="plv-select"
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          data-skill-domain=""
        >
          {SKILL_DOMAINS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {fieldErrors.domain ? <span className="plv-alert">{fieldErrors.domain}</span> : null}
      </label>

      <label className="plv-field">
        <span className="plv-field-label">范围说明（这门技能管到哪儿）</span>
        <textarea
          className="plv-select"
          value={scope}
          onChange={(event) => setScope(event.target.value)}
          rows={4}
          data-skill-scope=""
        />
        {fieldErrors.scope ? <span className="plv-alert">{fieldErrors.scope}</span> : null}
      </label>

      <label className="plv-field">
        <span className="plv-field-label">掌握证据（凭什么这么说）</span>
        <textarea
          className="plv-select"
          value={evidence}
          onChange={(event) => setEvidence(event.target.value)}
          rows={5}
          data-skill-evidence=""
        />
        {fieldErrors.evidence ? <span className="plv-alert">{fieldErrors.evidence}</span> : null}
      </label>

      <label className="plv-field">
        <span className="plv-field-label">展示顺序（数字小的排前面，可重复）</span>
        <input
          className="plv-select"
          type="number"
          min={0}
          value={position}
          onChange={(event) => setPosition(event.target.value)}
          data-skill-position=""
        />
      </label>

      <fieldset className="plv-section">
        <legend className="plv-field-label">站外证据链接（http / https）</legend>
        <p className="plv-hint">
          这是**可选**的补充证据。全站不接受 <code>javascript:</code> 之类的地址，
          也不接受本机绝对路径 —— 服务端会直接拒掉。
        </p>
        {links.map((link, index) => (
          <div className="plv-combo" key={link.key}>
            <label className="plv-field">
              <span className="plv-field-label">类型</span>
              <select
                className="plv-select"
                value={link.kind}
                onChange={(event) =>
                  setLinks((previous) =>
                    previous.map((item, i) =>
                      i === index ? { ...item, kind: event.target.value as SkillLinkInput["kind"] } : item,
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
            <label className="plv-field">
              <span className="plv-field-label">链接文字</span>
              <input
                className="plv-select"
                value={link.label}
                onChange={(event) =>
                  setLinks((previous) =>
                    previous.map((item, i) => (i === index ? { ...item, label: event.target.value } : item)),
                  )
                }
              />
            </label>
            <label className="plv-field">
              <span className="plv-field-label">地址</span>
              <input
                className="plv-select"
                value={link.url}
                onChange={(event) =>
                  setLinks((previous) =>
                    previous.map((item, i) => (i === index ? { ...item, url: event.target.value } : item)),
                  )
                }
                placeholder="https://…"
              />
            </label>
            <div className="plv-actions">
              <button
                className="plv-button plv-button-ghost"
                type="button"
                onClick={() => setLinks((previous) => previous.filter((_item, i) => i !== index))}
              >
                移除这条
              </button>
            </div>
          </div>
        ))}
        <div className="plv-actions">
          <button
            className="plv-button plv-button-ghost"
            type="button"
            onClick={() => setLinks((previous) => [...previous, emptyLink()])}
          >
            添加链接
          </button>
        </div>
      </fieldset>

      <fieldset className="plv-section">
        <legend className="plv-field-label">关联作品（粘贴作品的 UUID，顺序即展示顺序）</legend>
        <p className="plv-hint">
          只保存**关系**，不复制作品正文（验收 2）。UUID 可以在
          <code> /admin/projects </code> 列表里复制。可以关联草稿作品 ——
          公开侧只会显示已发布的那些。
        </p>
        {projects.map((draft, index) => (
          <div className="plv-actions" key={draft.key}>
            <label className="plv-field">
              <span className="plv-field-label">作品 {index + 1}</span>
              <input
                className="plv-select"
                value={draft.project_id}
                onChange={(event) =>
                  setProjects((previous) =>
                    previous.map((item, i) =>
                      i === index ? { ...item, project_id: event.target.value } : item,
                    ),
                  )
                }
                data-skill-project={index}
              />
            </label>
            <button
              className="plv-button plv-button-ghost"
              type="button"
              onClick={() => setProjects((previous) => previous.filter((_item, i) => i !== index))}
            >
              取消关联
            </button>
          </div>
        ))}
        <div className="plv-actions">
          <button
            className="plv-button plv-button-ghost"
            type="button"
            onClick={() => setProjects((previous) => [...previous, emptyProject()])}
          >
            添加作品关联
          </button>
        </div>
        {fieldErrors.projects ? <p className="plv-alert">{fieldErrors.projects}</p> : null}
      </fieldset>

      <div className="plv-actions">
        <button className="plv-button" type="submit" disabled={busy} data-skill-save="">
          {busy ? "正在提交…" : createMode ? "创建草稿" : "保存"}
        </button>
        {!createMode && skill ? (
          <>
            <button
              className="plv-button"
              type="button"
              onClick={() => void publish()}
              disabled={busy || !canPublish}
              data-skill-publish=""
            >
              发布
            </button>
            <button
              className="plv-button plv-button-ghost"
              type="button"
              onClick={() => void unpublish()}
              disabled={busy || skill.status !== "published"}
              data-skill-unpublish=""
            >
              撤回为草稿
            </button>
            <button
              className="plv-button plv-button-ghost"
              type="button"
              onClick={() => void reload()}
              disabled={busy}
            >
              读取最新版本
            </button>
            <button
              className="plv-button plv-button-ghost"
              type="button"
              onClick={() => void remove()}
              disabled={busy}
              data-skill-delete=""
            >
              软删除
            </button>
          </>
        ) : null}
      </div>

      {!createMode && skill && !canPublish ? (
        <p className="plv-hint" data-skill-publish-blocked="">
          现在点「发布」会被服务端拒绝：范围说明与掌握证据都填写后才可以发布
          —— 没有证据的技能保持草稿，这是刻意的（07 §6）。
        </p>
      ) : null}
    </form>
  );
}
