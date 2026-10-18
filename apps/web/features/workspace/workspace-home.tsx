"use client";

/**
 * 创作台首页 `/admin`（P5 第一批 · 契约 §4.7 / §9.5）。
 *
 * 四项实际任务（**没有假统计、占位动态、虚构通知**）：
 *  ① 开始记录：发布动态 / 写手记 / 更新追番 / 更新游戏；
 *  ② 继续编辑：服务端工作草稿列表（类型 / 摘要 / 最近同步时间）→ 对应编辑页；
 *  ③ 近期内容：最近保存或发布的动态与手记（编辑 + 预览，状态如实标注）；
 *  ④ 内容管理：链到已有管理页（相册 / 作品 / 友链 / 殿堂 / 技能 / 印象空间 / 消息…）。
 *
 * 会话：用 `useOwnerSession`（无副作用探针 `GET /auth/owner-status`），
 * **确认站主后才发管理侧读取**；未登录给登录入口；取数失败如实显示原因（不伪装成空列表）。
 */

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { fetchAdminMoments } from "@/features/ins/api";
import type { MomentAdmin } from "@/features/ins/types";
import { listAdminEntries } from "@/features/journal/api";
import type { JournalAdminEntry } from "@/features/journal/types";
import { ApiClientError, ApiTransportError } from "@/lib/api/client";

import { listWorkDrafts } from "./api";
import { readReturnTo, withReturnTo } from "./return-context";
import { refreshOwnerSession, useOwnerSession } from "./session";
import type { WorkDraft } from "./types";

interface RecentItem {
  key: string;
  type: "moment" | "journal";
  typeLabel: string;
  title: string;
  statusLabel: string;
  updatedAt: string;
  editHref: string;
  previewHref: string | null;
}

const MANAGE_LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/admin/moments", label: "动态管理" },
  { href: "/admin/journal", label: "手记管理" },
  { href: "/admin/leisure", label: "放课后管理" },
  { href: "/admin/albums", label: "相册" },
  { href: "/admin/projects", label: "作品" },
  { href: "/admin/friends", label: "友链" },
  { href: "/admin/palaces", label: "殿堂" },
  { href: "/admin/skills", label: "技能 / 道具" },
  { href: "/admin/exploration", label: "印象空间" },
  { href: "/admin/messages", label: "消息与成本" },
];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** 本地时间 `YYYY-MM-DD HH:mm`；非法时间原样返回，不编造。 */
function formatTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function firstLine(value: string, fallback: string): string {
  const text = value.trim().split("\n")[0]?.trim() ?? "";
  if (!text) return fallback;
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

function draftTypeLabel(contentType: WorkDraft["content_type"]): string {
  return contentType === "moment" ? "动态" : "手记";
}

/** 工作草稿 → 对应独立编辑页（路由由 C3/C4 建，契约 §4.1）。 */
function draftHref(draft: WorkDraft): string {
  const base = draft.content_type === "moment" ? "/admin/moments" : "/admin/journal";
  if (draft.target_id) return `${base}/${draft.target_id}/edit`;
  return `${base}/new`;
}

function describeHomeError(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 401) return "登录已失效，请重新登录后再读取。";
    if (error.status === 403) return "没有权限读取这些内容（服务端拒绝）。";
    return error.message || `读取失败（HTTP ${error.status}）。`;
  }
  if (error instanceof ApiTransportError) return "无法连接到服务，请检查网络后重试。";
  return "读取失败，请稍后重试。";
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function momentToRecent(moment: MomentAdmin): RecentItem {
  return {
    key: `moment-${moment.id}`,
    type: "moment",
    typeLabel: "动态",
    title: firstLine(moment.text, "（这条动态还没有文字）"),
    statusLabel: moment.status === "published" ? "已发布" : "草稿",
    updatedAt: moment.updated_at,
    editHref: `/admin/moments/${moment.id}/edit`,
    previewHref: moment.status === "published" ? `/apps/ins/${moment.id}` : null,
  };
}

function journalToRecent(entry: JournalAdminEntry): RecentItem {
  const published = entry.status === "published";
  const publicEntry = published && entry.visibility === "public";
  return {
    key: `journal-${entry.id}`,
    type: "journal",
    typeLabel: "手记",
    title: firstLine(entry.title, "（这篇手记还没有标题）"),
    statusLabel: published ? (publicEntry ? "已公开" : "已发布（私密）") : "草稿",
    updatedAt: entry.updated_at,
    editHref: `/admin/journal/${entry.id}/edit`,
    previewHref: publicEntry ? `/apps/journal/${entry.id}` : null,
  };
}

export function WorkspaceHome(): ReactNode {
  const { status, session } = useOwnerSession();
  const ownerName = session?.user?.username ?? null;
  /** 创作台自身可能带 `?returnTo=`（例如登录后回跳）：继续编辑时保留来源上下文。 */
  const [returnTo, setReturnTo] = useState<string | null>(null);

  const [drafts, setDrafts] = useState<WorkDraft[] | null>(null);
  const [draftsError, setDraftsError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentItem[] | null>(null);
  const [recentErrors, setRecentErrors] = useState<string[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  const loadWorkspace = useCallback(async (signal?: AbortSignal) => {
    setLoadingData(true);
    setDrafts(null);
    setDraftsError(null);
    setRecent(null);
    setRecentErrors([]);
    const [draftResult, momentResult, journalResult] = await Promise.allSettled([
      listWorkDrafts({ limit: 10 }, signal),
      fetchAdminMoments({ limit: 5 }, signal),
      listAdminEntries({ limit: 5 }, signal),
    ]);
    if (signal?.aborted) return;
    const errors: string[] = [];
    if (draftResult.status === "fulfilled") {
      setDrafts(draftResult.value.items);
    } else if (!isAbort(draftResult.reason)) {
      setDraftsError(describeHomeError(draftResult.reason));
    }
    const recentItems: RecentItem[] = [];
    if (momentResult.status === "fulfilled") {
      recentItems.push(...momentResult.value.items.map(momentToRecent));
    } else if (!isAbort(momentResult.reason)) {
      errors.push(`最近动态读取失败：${describeHomeError(momentResult.reason)}`);
    }
    if (journalResult.status === "fulfilled") {
      recentItems.push(...journalResult.value.items.map(journalToRecent));
    } else if (!isAbort(journalResult.reason)) {
      errors.push(`最近手记读取失败：${describeHomeError(journalResult.reason)}`);
    }
    recentItems.sort((left, right) => {
      const leftTime = Date.parse(left.updatedAt);
      const rightTime = Date.parse(right.updatedAt);
      if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) return 0;
      return rightTime - leftTime;
    });
    setRecent(recentItems.slice(0, 6));
    setRecentErrors(errors);
    setLoadingData(false);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    void (async () => {
      setReturnTo(readReturnTo(new URLSearchParams(window.location.search)));
    })();
  }, []);

  useEffect(() => {
    if (status !== "owner") return;
    const controller = new AbortController();
    // 放进异步闭包：读取函数开头会置「加载中」，避免 effect 同步 setState 的级联渲染。
    void (async () => {
      await loadWorkspace(controller.signal);
    })();
    return () => controller.abort();
  }, [status, loadWorkspace]);

  const owner = status === "owner";

  return (
    <div className="ws-home" data-workspace-home>
      <header className="ws-home-head">
        <p className="ws-kicker">{"// Creator Workspace"}</p>
        <h1 className="ws-home-title">创作台</h1>
        <p className="ws-home-sub">
          {owner
            ? `以 ${ownerName ?? "站主"} 登录 · 桌面写长文，手机随手记；自动保存只改工作草稿，不会提前改动访客看到的内容。`
            : "集中管理动态、手记、放课后进度与已有内容；只有站主登录后才显示可写入口。"}
        </p>
      </header>

      {status === "loading" ? (
        <p className="ws-loading" data-workspace-loading>
          正在确认站主身份…
        </p>
      ) : null}

      {status === "failed" ? (
        <section className="ws-error" role="alert" data-workspace-session-error>
          <p className="ws-error-line">无法确认站主身份：服务暂时不可用或登录状态读取失败。</p>
          <div className="ws-empty-actions">
            <button type="button" className="ws-btn" onClick={() => void refreshOwnerSession()}>
              重试
            </button>
            <Link className="ws-btn ws-btn-ghost" href="/admin/login">
              去登录
            </Link>
          </div>
        </section>
      ) : null}

      {status === "anonymous" ? (
        <section className="ws-error" role="status" data-workspace-login-required>
          <p className="ws-error-line">
            需要站主登录后才能创作。创作台与编辑器都不做路由保护 ——
            真正的权限判断与 CSRF 校验在后端，隐藏入口不是安全边界。
          </p>
          <div className="ws-empty-actions">
            <Link className="ws-btn ws-btn-primary" href={withReturnTo("/admin/login", "/admin")}>
              站主登录
            </Link>
            <Link className="ws-btn ws-btn-ghost" href="/">
              回到站点
            </Link>
          </div>
        </section>
      ) : null}

      {owner ? (
        <>
          <section className="ws-section" data-workspace-section="start">
            <div className="ws-section-head">
              <h2 className="ws-section-title">开始记录</h2>
              <p className="ws-section-note">从最短路径进入；图片、正文、收录都在编辑器里完成。</p>
            </div>
            <div className="ws-start-grid">
              <Link
                className="ws-start-card"
                href={withReturnTo("/admin/moments/new", returnTo)}
                data-workspace-start="moment"
              >
                <span className="ws-start-label">发布动态</span>
                <span className="ws-start-hint">先选图，再写文字</span>
              </Link>
              <Link
                className="ws-start-card"
                href={withReturnTo("/admin/journal/new", returnTo)}
                data-workspace-start="journal"
              >
                <span className="ws-start-label">写手记</span>
                <span className="ws-start-hint">默认私密，公开是单独动作</span>
              </Link>
              <Link
                className="ws-start-card"
                href={withReturnTo("/admin/leisure", returnTo)}
                data-workspace-start="anime"
              >
                <span className="ws-start-label">更新追番</span>
                <span className="ws-start-hint">集数 / 状态 / 短评</span>
              </Link>
              <Link
                className="ws-start-card"
                href={withReturnTo("/admin/leisure", returnTo)}
                data-workspace-start="game"
              >
                <span className="ws-start-label">更新游戏</span>
                <span className="ws-start-hint">状态 / 时长 / 短评</span>
              </Link>
            </div>
          </section>

          <section className="ws-section" data-workspace-section="drafts">
            <div className="ws-section-head">
              <h2 className="ws-section-title">继续编辑</h2>
              <p className="ws-section-note">服务端工作草稿；自动保存确认后才算「可在另一设备继续」。</p>
            </div>
            {draftsError ? (
              <section className="ws-error" role="alert" data-workspace-drafts-error>
                <p className="ws-error-line">{draftsError}</p>
                <div className="ws-empty-actions">
                  <button type="button" className="ws-btn" onClick={() => void loadWorkspace()}>
                    重试
                  </button>
                </div>
              </section>
            ) : drafts === null ? (
              <p className="ws-loading">{loadingData ? "正在读取工作草稿…" : "正在读取工作草稿…"}</p>
            ) : drafts.length === 0 ? (
              <p className="ws-empty" data-workspace-drafts-empty>
                还没有工作草稿。从上方「开始记录」写一条动态或手记，停止输入约 1 秒后会自动保存到这里。
              </p>
            ) : (
              <div className="ws-list">
                {drafts.map((draft) => (
                  <Link
                    key={draft.id}
                    className="ws-row"
                    href={withReturnTo(draftHref(draft), returnTo)}
                    data-workspace-draft-row={draft.content_type}
                    data-workspace-draft-open={draft.id}
                  >
                    <span className="ws-row-type">{draftTypeLabel(draft.content_type)}</span>
                    <span className="ws-row-body">
                      <span className="ws-row-title">
                        {draft.summary?.trim() ? draft.summary : "尚未填写内容"}
                      </span>
                      <span className="ws-row-meta">
                        {draft.target_id ? "编辑已有内容" : "新内容草稿"} · 草稿版本 {draft.draft_version}
                      </span>
                    </span>
                    <span className="ws-row-side">最近同步 {formatTime(draft.updated_at)}</span>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className="ws-section" data-workspace-section="recent">
            <div className="ws-section-head">
              <h2 className="ws-section-title">近期内容</h2>
              <p className="ws-section-note">最近保存或发布的动态与手记；草稿与公开状态如实标注。</p>
            </div>
            {recentErrors.length > 0 ? (
              <section className="ws-error" role="alert" data-workspace-recent-error>
                {recentErrors.map((message) => (
                  <p key={message} className="ws-error-line">
                    {message}
                  </p>
                ))}
                <div className="ws-empty-actions">
                  <button type="button" className="ws-btn" onClick={() => void loadWorkspace()}>
                    重试
                  </button>
                </div>
              </section>
            ) : null}
            {recent !== null && recent.length === 0 && recentErrors.length === 0 ? (
              <p className="ws-empty" data-workspace-recent-empty>
                还没有保存或发布的动态与手记。可以从上方「开始记录」写第一条。
              </p>
            ) : null}
            {recent !== null && recent.length > 0 ? (
              <div className="ws-grid-rows">
                {recent.map((item) => (
                  <div
                    className="ws-recent-row"
                    key={item.key}
                    data-workspace-recent-row={item.type}
                  >
                    <span className="ws-row-type">{item.typeLabel}</span>
                    <span className="ws-row-body">
                      <span className="ws-row-title">{item.title}</span>
                      <span className="ws-row-meta">
                        {item.statusLabel} · 最近更新 {formatTime(item.updatedAt)}
                      </span>
                    </span>
                    <span className="ws-row-actions">
                      <Link className="ws-row-link" href={item.editHref}>
                        编辑
                      </Link>
                      {item.previewHref ? (
                        <Link className="ws-row-link" href={item.previewHref}>
                          预览
                        </Link>
                      ) : null}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          <section className="ws-section" id="manage" data-workspace-section="manage">
            <div className="ws-section-head">
              <h2 className="ws-section-title">内容管理</h2>
              <p className="ws-section-note">沿用已有管理页；这里只做入口，不重复实现它们的能力。</p>
            </div>
            <div className="ws-manage-grid">
              {MANAGE_LINKS.map((link) => (
                <Link
                  className="ws-manage-link"
                  key={link.href}
                  href={link.href}
                  data-workspace-manage-link={link.href}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
