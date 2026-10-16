"use client";

/**
 * 技能详情（`/velvet/<slug>`，07 §6）。
 *
 * 内容全部是站主手写的字段与**当前公开**的关联作品：
 *
 *   - 范围说明（`scope`）回答「这门技能管到哪儿」；
 *   - 掌握证据（`evidence`）回答「凭什么这么说」；
 *   - 关联作品（`projects`）是可点开的真实证据，链接到 T06 的作品详情 ——
 *     作品的正文只有一份，技能页不复制（验收 2）；
 *   - 外部证据链接（`links`）是仓库 / 演示 / 文档等站外地址。
 *
 * 刻意**没有**的展示：等级、熟练度、进度条、完成百分比。数据里没有这些字段，
 * 界面也不靠 CSS 造一个出来（07 §6「不自封数值等级」）。
 */

import type { ReactNode } from "react";

import { SiteLink } from "@/features/runtime/navigation/site-link";

import { projectPath, VELVET_PATH } from "./paths";
import "@/features/velvet/velvet.css";
import { linkKindLabel, type SkillDetail } from "./types";

export interface SkillReadingProps {
  skill: SkillDetail;
}

export function SkillReading({ skill }: SkillReadingProps): ReactNode {
  return (
    <article className="plv-room" data-skill-reading={skill.slug}>
      <header className="plv-bar">
        <div>
          <p className="plv-kicker">{"// VELVET ROOM · SKILL"}</p>
          <h1 className="plv-title">{skill.name}</h1>
          <p className="plv-lead">
            <span className="plv-card-domain">{skill.domain_label}</span>
            {" "}关联作品 <b>{skill.project_count}</b> 件 · 展示顺序 {skill.position}
          </p>
        </div>
      </header>

      <section className="plv-gate">
        <h2 className="plv-hint">范围说明</h2>
        <p>{skill.scope || "站主还没有补充这门技能的范围说明。"}</p>

        <h2 className="plv-hint">掌握证据</h2>
        <p data-skill-evidence="">{skill.evidence || "站主还没有补充掌握证据。"}</p>

        {skill.links.length ? (
          <div className="plv-evidence">
            <h2 className="plv-hint">外部证据</h2>
            <ul className="plv-evidence-list">
              {skill.links.map((link) => (
                <li key={`${link.kind}:${link.url}`}>
                  {/*
                    站外地址：用原生 <a>，不走 SiteLink（它不是站内路由）。
                    服务端 schema 只接受 http / https，因此这里不需要再过滤，
                    但保留 rel 说明来源。
                  */}
                  <a href={link.url} target="_blank" rel="noreferrer noopener">
                    {linkKindLabel(link.kind)}：{link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="plv-section" aria-labelledby="velvet-projects">
        <h2 id="velvet-projects">能力对应的作品</h2>
        {skill.projects.length === 0 ? (
          <p className="plv-empty" role="status" data-skill-projects-empty="">
            还没有和这门技能关联的公开作品。这不代表这门技能不存在 ——
            只是暂时没有可展示的证据；没有交集时也不会临时生成一件作品。
            {" "}
            <SiteLink href="/showcase" source="phone-link">
              看看已有的作品
            </SiteLink>
          </p>
        ) : (
          <ul className="plv-project-list">
            {skill.projects.map((project) => (
              <li className="plv-project-row" key={project.id} data-skill-project={project.slug}>
                <p className="plv-project-title">
                  <SiteLink href={projectPath(project.slug)} source="phone-link">
                    {project.title}
                  </SiteLink>
                </p>
                {project.summary ? (
                  <p className="plv-project-summary">{project.summary}</p>
                ) : null}
                <p className="plv-card-meta">
                  <span>{project.maintenance_label}</span>
                  <span>{project.published_at.slice(0, 10)}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {skill.tech_overlap.length ? (
        <section className="plv-section" aria-labelledby="velvet-tech">
          <h2 id="velvet-tech">与技术栈对得上的项</h2>
          <p className="plv-hint">
            上面这些作品的「技术栈」里，有与本技能同名的项。这是一致性提示，
            <b>不是</b>掌握程度：技能本身不保存技术标签副本，这里只是把关系算出来给你核对。
          </p>
          <ul className="plv-evidence-list">
            {skill.tech_overlap.map((item) => (
              <li key={item}>
                <span className="plv-card-domain">{item}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="plv-hint">
        <SiteLink href={VELVET_PATH} source="phone-link">
          ← 回到技能全书
        </SiteLink>
      </p>
    </article>
  );
}
