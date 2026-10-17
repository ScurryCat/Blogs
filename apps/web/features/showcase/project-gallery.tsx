"use client";

/**
 * 我的殿堂 · 作品展厅视图（T06，07 §5；第三轮 §4.1 起殿堂**只保留作品**）。
 *
 * 这是**独立页**（`/showcase`）用的完整视图；手机内置应用复用同一个组件，
 * 只换注入的宿主（SHARED-CONTRACTS §1：「同一内容在手机与 canonical 页面使用同一
 * 功能视图和数据」）。
 *
 * 行为要点：
 *  - 首屏由服务端读好传进来；
 *  - 网格 / 列表两个视图切换（列表视图给「想快速扫一遍」的人，07 §5「默认做二维展厅」）；
 *  - 维护状态筛选写进 URL，用 `SiteLink` 跳转；
 *  - 「加载更多」按 `next_cursor` 追加，不重复请求旧游标；
 *  - 空态说明**不编造成果**（验收 5）。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { SiteLink } from "@/features/runtime/navigation/site-link";

import { fetchProjects } from "./api";
import { showcaseHref, SHOWCASE_PATH } from "./paths";
import { ProjectCard } from "./project-card";
import {
  MAINTENANCE_STATES,
  PROJECT_PAGE_SIZE,
  type MaintenanceState,
  type ProjectSummary,
} from "./types";

export interface ProjectGalleryProps {
  initialProjects: readonly ProjectSummary[];
  initialCursor: string | null;
  /** 服务端读取失败的可读原因；非空时只显示失败态 + 重试。 */
  loadError?: string | null;
  maintenance: MaintenanceState | null;
}

export function ProjectGallery({
  initialProjects,
  initialCursor,
  loadError = null,
  maintenance,
}: ProjectGalleryProps): ReactNode {
  // 服务端给的第一页是**派生基线**：筛选（`maintenance`）变化时 props 变，
  // 列表自动回到新基线，不需要在 effect 里 setState
  // （React Compiler 的 `react-hooks/set-state-in-effect` 会拒绝那种写法）。
  const [extra, setExtra] = useState<{ key: string; items: ProjectSummary[] } | null>(null);
  const [extraCursor, setExtraCursor] = useState<{ key: string; cursor: string | null } | null>(null);
  const [phase, setPhase] = useState<"idle" | "loading" | "failed">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [view, setView] = useState<"grid" | "list">("grid");
  const controllerRef = useRef<AbortController | null>(null);

  const filterKey = maintenance ?? "all";
  const projects: readonly ProjectSummary[] =
    extra && extra.key === filterKey ? [...initialProjects, ...extra.items] : initialProjects;
  const cursor =
    extraCursor && extraCursor.key === filterKey ? extraCursor.cursor : initialCursor;

  useEffect(() => () => controllerRef.current?.abort(), []);

  const loadMore = useCallback(async () => {
    if (!cursor || phase === "loading") return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    // 先让出一次事件循环再 setState：见 gallery-view.tsx 的同一处说明。
    await Promise.resolve();
    setPhase("loading");
    setMessage(null);
    try {
      const page = await fetchProjects(
        { maintenance, cursor, limit: PROJECT_PAGE_SIZE },
        controller.signal,
      );
      setExtra({ key: filterKey, items: page.items });
      setExtraCursor({ key: filterKey, cursor: page.next_cursor });
      setPhase("idle");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setPhase("failed");
      setMessage(
        error instanceof Error && error.message
          ? error.message
          : "读取作品失败，请稍后重试。",
      );
    }
  }, [cursor, filterKey, maintenance, phase]);

  return (
    <div className="pls-wrap" data-project-gallery="">
      <div className="pls-tabs" role="group" aria-label="视图与筛选">
        <button
          type="button"
          className="pls-button"
          aria-pressed={view === "grid"}
          onClick={() => setView("grid")}
          data-view="grid"
        >
          卡片视图
        </button>
        <button
          type="button"
          className="pls-button"
          aria-pressed={view === "list"}
          onClick={() => setView("list")}
          data-view="list"
        >
          列表视图
        </button>
        <SiteLink
          href={showcaseHref()}
          source="phone-link"
          className="pls-tab"
          aria-current={maintenance ? undefined : "page"}
          data-filter="all"
        >
          全部状态
        </SiteLink>
        {MAINTENANCE_STATES.map((state) => (
          <SiteLink
            key={state.value}
            href={showcaseHref({ maintenance: maintenance === state.value ? null : state.value })}
            source="phone-link"
            className="pls-tab"
            aria-current={maintenance === state.value ? "page" : undefined}
            data-filter={state.value}
          >
            {state.label}
          </SiteLink>
        ))}
      </div>

      {loadError ? (
        <div className="pls-state" role="status" data-projects-error="">
          <p className="pls-state-kicker">FAILED</p>
          <h2 className="pls-state-title">作品列表暂时读不出来</h2>
          <p className="pls-state-body">{loadError}</p>
          <button
            type="button"
            className="pls-button"
            onClick={() => window.location.reload()}
          >
            重新加载
          </button>
        </div>
      ) : projects.length === 0 ? (
        <div className="pls-state" role="status" data-projects-empty="">
          <p className="pls-state-kicker">EMPTY</p>
          <h2 className="pls-state-title">
            {maintenance ? "这个状态下还没有作品" : "还没有公开的作品"}
          </h2>
          <p className="pls-state-body">
            作品由站主在后台录入并发布。这里不会用占位卡片、假统计或虚构奖项填充版面。
          </p>
        </div>
      ) : view === "grid" ? (
        <div className="pls-grid">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      ) : (
        <table className="pls-table" data-project-table="">
          <caption className="pls-card-meta">
            作品的简短清单；点标题进详情看职责、取舍与成果。
          </caption>
          <thead>
            <tr>
              <th scope="col">作品</th>
              <th scope="col">一句话用途</th>
              <th scope="col">状态</th>
              <th scope="col">攻略记录</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => (
              <tr key={project.id} data-project-row={project.slug}>
                <td>
                  <SiteLink href={`/showcase/projects/${project.slug}`} source="phone-link">
                    {project.title}
                  </SiteLink>
                </td>
                <td>{project.summary || "（未填写）"}</td>
                <td>{project.maintenance_label || project.maintenance}</td>
                <td>{project.palace ? project.palace.title : "暂时没有可读的攻略记录"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {cursor && !loadError ? (
        <div className="pls-more-row">
          <button
            type="button"
            className="pls-button"
            onClick={() => void loadMore()}
            disabled={phase === "loading"}
            data-load-more=""
          >
            {phase === "loading" ? "正在读取…" : "加载更多作品"}
          </button>
        </div>
      ) : null}

      {phase === "failed" && message ? (
        <div className="pls-state" role="status" data-load-more-error="">
          <p className="pls-state-body">{message}</p>
          <button type="button" className="pls-button" onClick={() => void loadMore()}>
            重试
          </button>
        </div>
      ) : null}
    </div>
  );
}
