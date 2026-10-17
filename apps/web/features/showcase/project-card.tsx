"use client";

/**
 * 作品卡片（T06，07 §5）。
 *
 * 卡片只放**真实存在**的东西：效果图（没有就说明「还没有效果图」）、一句话用途、
 * 技术栈、维护状态、关联专题。**没有**奖项、星级、用户数之类的成绩位 ——
 * 那些数字本站不收集，也就不显示（验收「不生成奖项或虚构数字」）。
 */

import { useState } from "react";
import type { ReactNode } from "react";

import { SiteLink } from "@/features/runtime/navigation/site-link";

import { palacePath, projectPath } from "./paths";
import {
  projectImageAlt,
  projectImageUrl,
  truncateSummary,
  type ProjectSummary,
} from "./types";

export interface ProjectCardProps {
  project: ProjectSummary;
}

export function ProjectCard({ project }: ProjectCardProps): ReactNode {
  const cover = project.cover ? projectImageUrl(project.cover) : null;
  // 效果图取不到（被撤回 / 变体过期 / 网络不通）时给出**文字状态**，不留破图
  // —— 任务书 §4.6「图片失败都需要可用的布局」。
  const [coverFailed, setCoverFailed] = useState(false);
  return (
    <SiteLink
      href={projectPath(project.slug)}
      source="phone-link"
      className="pls-card"
      data-project={project.slug}
    >
      {cover && !coverFailed ? (
        /* eslint-disable-next-line @next/next/no-img-element -- 媒体字节只能从 /api/v1/media 取（每次请求都校验公开引用），next/image 的优化器无法代取。 */
        <img
          className="pls-card-cover"
          src={cover}
          alt={project.cover ? projectImageAlt(project.cover) : ""}
          width={project.cover?.width ?? 640}
          height={project.cover?.height ?? 400}
          loading="lazy"
          decoding="async"
            onError={() => setCoverFailed(true)}
        />
      ) : (
        <span
            className="pls-card-cover-empty"
            role={cover && coverFailed ? "status" : undefined}
          >
            {cover && coverFailed ? "效果图加载失败" : "这件作品还没有效果图"}
          </span>
      )}

      <h2 className="pls-card-title">{project.title}</h2>
      {project.summary ? (
        <p className="pls-card-summary">{truncateSummary(project.summary)}</p>
      ) : (
        <p className="pls-empty-note">还没有写一句话用途。</p>
      )}

      {project.tech_stack.length > 0 ? (
        <ul className="pls-tech" aria-label="技术栈">
          {project.tech_stack.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}

      <p className="pls-card-meta">
        {project.maintenance_label || project.maintenance}
        {project.palace ? ` · 攻略记录：${project.palace.title}` : " · 暂时没有可读的攻略记录"}
      </p>
    </SiteLink>
  );
}

/** 「攻略记录」入口：只在专题**当前公开**时渲染（验收 5）。 */
export function GuideEntry({ palace }: { palace: ProjectSummary["palace"] }): ReactNode {
  if (!palace) {
    return (
      <p className="pls-empty-note" data-guide-unavailable="">
        这件作品还没有公开的攻略记录（专题未发布或已撤回时不会显示标题）。
      </p>
    );
  }
  return (
    <SiteLink
      href={palacePath(palace.slug)}
      source="metaverse-entry"
      className="pls-guide-entry"
      data-guide-entry={palace.slug}
    >
      查看攻略记录：{palace.title}
    </SiteLink>
  );
}
