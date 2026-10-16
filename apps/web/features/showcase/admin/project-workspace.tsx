"use client";

/**
 * 作品编辑器（T06；07 §5、05 §7）。
 *
 * 设计要点（与 `features/gallery/admin/album-workspace.tsx` 同形）：
 *
 *  1. **复用已有 media，不重复上传**（验收 2）：只接受已有媒体 UUID，
 *     上传是 T01 的共享媒体服务，动态 / 相册 / 作品共用一套文件。
 *  2. **多行图片录入**：一行一张，格式
 *     `media UUID | 替代文本 | 用途(cover/detail/evidence) | 说明 | 拍摄日期(可空)`。
 *     竖线分隔对站主更快，也避免了长表单里的可访问性噪音；解析失败的行会**逐行报错**，
 *     不被静默丢弃。
 *  3. **技术栈一行一项**、**链接一行一条**（`label | url`，kind 自动归类：
 *     github.com → repo、其它 → demo）。
 *  4. **412 保留输入**（05 §7）：冲突时表单不清空，只提示读取新版。
 *  5. **没有成绩字段**：表单里没有「奖项 / 星数 / 用户数」——
 *     这些数字本站不收集，界面也就不提供填它的地方（验收 §1）。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import {
  createProject,
  deleteProject,
  fetchAdminProject,
  publishProject,
  unpublishProject,
  updateProject,
  type ProjectWritePayload,
} from "../api";
import type {
  AdminProject,
  AdminProjectImageInput,
  ProjectImageKind,
  ProjectLinkInput,
} from "../types";
import { fieldMessages } from "./session";

const KINDS: readonly ProjectImageKind[] = ["cover", "detail", "evidence"];

export interface ProjectWorkspaceProps {
  csrfToken: string;
  describeError: (error: unknown) => string;
  isConflict: (error: unknown) => boolean;
  createMode: boolean;
  projectId?: string;
  /** 可关联的**公开**专题（由服务端读好后传入；草稿专题不出现在这里）。 */
  palaceOptions?: readonly { id: string; slug: string; title: string }[];
}

export interface ParsedImageLine {
  ok: boolean;
  input?: AdminProjectImageInput;
  error?: string;
  /** 原始行，便于界面标出是哪一行出错。 */
  raw: string;
}

/**
 * 解析一行图片记录。格式：
 *
 *     media UUID | 替代文本 | 用途 | 说明（可空） | 拍摄日期（可空，YYYY-MM-DD）
 *
 * 只有 `media UUID | 替代文本` 是必需的，其余可省略（用途默认 `detail`）。
 */
export function parseImageLines(text: string): ParsedImageLine[] {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.map((raw, index) => {
    const parts = raw.split("|").map((part) => part.trim());
    const mediaId = parts[0] ?? "";
    const alt = parts[1] ?? "";
    const kind = (parts[2] ?? "detail") || "detail";
    const caption = parts[3] ?? "";
    const takenOn = parts[4] ?? "";
    if (!/^[0-9a-fA-F-]{36}$/.test(mediaId)) {
      return { ok: false, raw, error: `第 ${index + 1} 行的媒体 UUID 不像 UUID：${mediaId || "(空)"}` };
    }
    if (!alt) {
      return { ok: false, raw, error: `第 ${index + 1} 行缺少替代文本（必填）` };
    }
    if (!KINDS.includes(kind as ProjectImageKind)) {
      return {
        ok: false,
        raw,
        error: `第 ${index + 1} 行的用途只能是 ${KINDS.join(" / ")}`,
      };
    }
    if (takenOn && !/^\d{4}-\d{2}-\d{2}$/.test(takenOn)) {
      return { ok: false, raw, error: `第 ${index + 1} 行的拍摄日期要写成 YYYY-MM-DD（或留空）` };
    }
    return {
      ok: true,
      raw,
      input: {
        media_id: mediaId,
        position: index,
        kind: kind as ProjectImageKind,
        alt,
        caption,
        taken_on: takenOn || null,
      },
    };
  });
}

/** 解析链接行：`标题 | https://…`；kind 按域名归类（github → repo）。 */
export function parseLinkLines(text: string): { links: ProjectLinkInput[]; errors: string[] } {
  const links: ProjectLinkInput[] = [];
  const errors: string[] = [];
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  lines.forEach((raw, index) => {
    const parts = raw.split("|").map((part) => part.trim());
    const label = parts[0] ?? "";
    const url = parts[1] ?? "";
    if (!label || !url) {
      errors.push(`第 ${index + 1} 行要写成「标题 | https://…」`);
      return;
    }
    if (!/^https?:\/\//.test(url)) {
      errors.push(`第 ${index + 1} 行的地址必须以 http:// 或 https:// 开头`);
      return;
    }
    links.push({
      kind: /github\.com/i.test(url) ? "repo" : "demo",
      label,
      url,
    });
  });
  return { links, errors };
}

function imageLinesFromProject(project: AdminProject): string {
  return project.images
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((image) =>
      [image.media_id, image.alt, image.kind, image.caption ?? "", image.taken_on ?? ""]
        .join(" | ")
        .replace(/(\s*\|\s*)+$/, ""),
    )
    .join("\n");
}

function linkLinesFromProject(project: AdminProject): string {
  return project.links.map((link) => `${link.label} | ${link.url}`).join("\n");
}

export function ProjectWorkspace({
  csrfToken,
  describeError,
  isConflict,
  createMode,
  projectId,
  palaceOptions = [],
}: ProjectWorkspaceProps): ReactNode {
  const [project, setProject] = useState<AdminProject | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "unavailable">(
    createMode ? "ready" : "loading",
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [lineErrors, setLineErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [role, setRole] = useState("");
  const [problem, setProblem] = useState("");
  const [tradeoffs, setTradeoffs] = useState("");
  const [outcomes, setOutcomes] = useState("");
  const [techStack, setTechStack] = useState("");
  const [linkLines, setLinkLines] = useState("");
  const [imageLines, setImageLines] = useState("");
  const [maintenance, setMaintenance] = useState("maintained");
  const [palaceId, setPalaceId] = useState("");

  const controllerRef = useRef<AbortController | null>(null);

  const applyProject = useCallback((loaded: AdminProject) => {
    setProject(loaded);
    setSlug(loaded.slug);
    setTitle(loaded.title);
    setSummary(loaded.summary);
    setRole(loaded.role);
    setProblem(loaded.problem);
    setTradeoffs(loaded.tradeoffs);
    setOutcomes(loaded.outcomes);
    setTechStack(loaded.tech_stack.join("\n"));
    setLinkLines(linkLinesFromProject(loaded));
    setImageLines(imageLinesFromProject(loaded));
    setMaintenance(loaded.maintenance);
    setPalaceId(loaded.palace_id ?? "");
  }, []);

  useEffect(() => {
    if (createMode || !projectId) return undefined;
    const controller = new AbortController();
    controllerRef.current = controller;
    void (async () => {
      try {
        const loaded = await fetchAdminProject(projectId, controller.signal);
        applyProject(loaded);
        setPhase("ready");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPhase("unavailable");
        setNotice(describeError(error));
      }
    })();
    return () => controller.abort();
  }, [applyProject, createMode, describeError, projectId]);

  const buildPayload = useCallback((): { payload: ProjectWritePayload; errors: string[] } => {
    const parsed = parseImageLines(imageLines);
    const errors = parsed.filter((line) => !line.ok).map((line) => line.error ?? "图片行不合法");
    const { links, errors: linkErrors } = parseLinkLines(linkLines);
    errors.push(...linkErrors);
    const images = parsed
      .filter((line) => line.ok && line.input)
      .map((line) => line.input as AdminProjectImageInput);
    const payload: ProjectWritePayload = {
      title: title.trim(),
      summary: summary.trim(),
      role,
      problem,
      tradeoffs,
      outcomes,
      tech_stack: techStack
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean),
      links,
      maintenance: maintenance as ProjectWritePayload["maintenance"],
      palace_id: palaceId ? palaceId : null,
      images,
    };
    if (createMode) payload.slug = slug.trim();
    return { payload, errors };
  }, [
    createMode,
    imageLines,
    linkLines,
    maintenance,
    outcomes,
    palaceId,
    problem,
    role,
    slug,
    summary,
    techStack,
    title,
    tradeoffs,
  ]);

  const handleSave = useCallback(async () => {
    if (busy) return;
    const { payload, errors } = buildPayload();
    setLineErrors(errors);
    setFieldErrors({});
    setNotice(null);
    if (errors.length > 0) {
      setNotice("有几行还不合法，先按下面的提示改一下（没有静默丢弃任何一行）。");
      return;
    }
    if (!payload.title?.trim()) {
      setFieldErrors({ title: "标题不能为空" });
      return;
    }
    if (createMode && !payload.slug?.trim()) {
      setFieldErrors({ slug: "新建作品必须填 slug" });
      return;
    }
    setBusy(true);
    try {
      if (createMode) {
        const created = await createProject(
          payload as ProjectWritePayload & { slug: string; title: string },
          csrfToken,
        );
        applyProject(created);
        setPhase("ready");
        setNotice(`已保存草稿「${created.title}」（version ${created.version}）。`);
      } else if (projectId && project) {
        const updated = await updateProject(projectId, payload, csrfToken, project.version);
        applyProject(updated);
        setNotice(`已保存（version ${updated.version}）。`);
      }
    } catch (error) {
      setNotice(describeError(error));
      setFieldErrors(fieldMessages(error));
    } finally {
      setBusy(false);
    }
  }, [applyProject, buildPayload, busy, createMode, csrfToken, describeError, project, projectId]);

  const handleReload = useCallback(async () => {
    if (!projectId) return;
    try {
      const loaded = await fetchAdminProject(projectId);
      applyProject(loaded);
      setNotice("已读取最新版本，请重新确认后再提交。");
      setFieldErrors({});
      setLineErrors([]);
    } catch (error) {
      setNotice(describeError(error));
    }
  }, [applyProject, describeError, projectId]);

  const handlePublishToggle = useCallback(
    async (publish: boolean) => {
      if (!project) return;
      setBusy(true);
      setNotice(null);
      try {
        const next = publish
          ? await publishProject(project.id, csrfToken, project.version)
          : await unpublishProject(project.id, csrfToken, project.version);
        applyProject(next);
        setNotice(
          publish
            ? "已发布。撤回关联专题**不会**连带撤回这件作品。"
            : "已撤回，公开页面不再显示这件作品。",
        );
      } catch (error) {
        setNotice(describeError(error));
        if (isConflict(error)) await handleReload();
      } finally {
        setBusy(false);
      }
    },
    [applyProject, csrfToken, describeError, handleReload, isConflict, project],
  );

  const handleDelete = useCallback(async () => {
    if (!project) return;
    setBusy(true);
    setNotice(null);
    try {
      await deleteProject(project.id, csrfToken, project.version);
      setProject(null);
      setNotice("已软删除。图片文件没有被删掉（其他公开内容可能还在引用它们）。");
    } catch (error) {
      setNotice(describeError(error));
    } finally {
      setBusy(false);
    }
  }, [csrfToken, describeError, project]);

  if (phase === "loading") {
    return <p className="pls-card-meta">正在读取作品…</p>;
  }

  if (phase === "unavailable" && !project) {
    return (
      <div className="pls-state" role="alert">
        <p className="pls-state-kicker">UNAVAILABLE</p>
        <p className="pls-state-body">{notice ?? "读取作品失败。"}</p>
      </div>
    );
  }

  return (
    <div className="pls-wrap" data-project-workspace="">
      {notice ? (
        <p className="pls-card-meta" role="status" data-admin-notice="">
          {notice}
        </p>
      ) : null}

      {lineErrors.length > 0 ? (
        <ul className="pls-state-body" role="alert" data-line-errors="">
          {lineErrors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}

      <div className="pls-sections">
        <section className="pls-section">
          <h3>基本信息</h3>
          {createMode ? (
            <p>
              <label htmlFor="project-slug">slug（公开地址的一部分）</label>
              <br />
              <input
                id="project-slug"
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
            <label htmlFor="project-title">标题</label>
            <br />
            <input
              id="project-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
            />
            {fieldErrors.title ? <span role="alert"> {fieldErrors.title}</span> : null}
          </p>
          <p>
            <label htmlFor="project-summary">一句话用途（发布必填，07 §5）</label>
            <br />
            <input
              id="project-summary"
              value={summary}
              maxLength={500}
              onChange={(event) => setSummary(event.target.value)}
              required
            />
            {fieldErrors.summary ? <span role="alert"> {fieldErrors.summary}</span> : null}
          </p>
          <p>
            <label htmlFor="project-maintenance">维护状态</label>
            <br />
            <select
              id="project-maintenance"
              value={maintenance}
              onChange={(event) => setMaintenance(event.target.value)}
            >
              <option value="active">正在开发</option>
              <option value="maintained">持续维护</option>
              <option value="paused">暂停</option>
              <option value="archived">已归档</option>
            </select>
          </p>
          <p>
            <label htmlFor="project-palace">关联专题（可空，只列当前公开的专题）</label>
            <br />
            <select
              id="project-palace"
              value={palaceId}
              onChange={(event) => setPalaceId(event.target.value)}
            >
              <option value="">不关联</option>
              {palaceOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.title}（{option.slug}）
                </option>
              ))}
            </select>
          </p>
          <p className="pls-card-meta">
            说明：作品页展示**你做出了什么**；专题解释**怎么做出来**。关联的专题撤回后，
            作品不会跟着消失，但公开页面不会再露出它的标题。
          </p>
        </section>

        <section className="pls-section">
          <h3>正文分节</h3>
          <p>
            <label htmlFor="project-role">个人职责</label>
            <br />
            <textarea
              id="project-role"
              rows={3}
              value={role}
              onChange={(event) => setRole(event.target.value)}
            />
          </p>
          <p>
            <label htmlFor="project-problem">解决的问题</label>
            <br />
            <textarea
              id="project-problem"
              rows={3}
              value={problem}
              onChange={(event) => setProblem(event.target.value)}
            />
          </p>
          <p>
            <label htmlFor="project-tradeoffs">关键取舍</label>
            <br />
            <textarea
              id="project-tradeoffs"
              rows={3}
              value={tradeoffs}
              onChange={(event) => setTradeoffs(event.target.value)}
            />
          </p>
          <p>
            <label htmlFor="project-outcomes">可验证成果（写事实，不写编出来的数字）</label>
            <br />
            <textarea
              id="project-outcomes"
              rows={3}
              value={outcomes}
              onChange={(event) => setOutcomes(event.target.value)}
            />
          </p>
        </section>

        <section className="pls-section">
          <h3>技术栈 / 链接</h3>
          <p>
            <label htmlFor="project-tech">技术栈（一行一项）</label>
            <br />
            <textarea
              id="project-tech"
              rows={4}
              value={techStack}
              onChange={(event) => setTechStack(event.target.value)}
            />
          </p>
          <p>
            <label htmlFor="project-links">链接（一行一条，`标题 | https://…`）</label>
            <br />
            <textarea
              id="project-links"
              rows={3}
              value={linkLines}
              onChange={(event) => setLinkLines(event.target.value)}
            />
          </p>
        </section>

        <section className="pls-section">
          <h3>图片（复用已有媒体，不重复上传）</h3>
          <p className="pls-card-meta">
            一行一张：<code>媒体 UUID | 替代文本 | 用途 | 说明（可空） | 拍摄日期（可空）</code>
            。用途只能是 cover / detail / evidence；替代文本必填。
          </p>
          <p>
            <label htmlFor="project-images">图片行</label>
            <br />
            <textarea
              id="project-images"
              rows={6}
              value={imageLines}
              onChange={(event) => setImageLines(event.target.value)}
              data-image-lines=""
            />
          </p>
          <p className="pls-card-meta">
            发布门槛：至少一张 ready 图片 + 一句话用途。未就绪的图片会被后端拒绝（409），
            这里不做「看起来保存成功」的假动作。
          </p>
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
          {createMode && !project ? "保存草稿" : "保存修改"}
        </button>
        {project ? (
          <>
            <button
              type="button"
              className="pls-button"
              onClick={() => void handlePublishToggle(project.status !== "published")}
              disabled={busy}
              data-publish-toggle=""
            >
              {project.status === "published" ? "撤回" : "发布"}
            </button>
            <button
              type="button"
              className="pls-button"
              onClick={() => void handleReload()}
              disabled={busy}
            >
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

      {project ? (
        <p className="pls-card-meta" data-project-status={project.status}>
          当前状态：{project.status === "published" ? "已发布" : "草稿"} · version {project.version} ·
          {project.images.length} 张图
          {project.images.some((image) => image.media_status !== "ready") ? (
            <strong> · 有图片未就绪，发布会被拒绝</strong>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
