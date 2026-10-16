"use client";

/**
 * 作品详情里的「使用的技能」（T09 交付给 T06 作品页的**一层关系视图**）。
 *
 * 为什么是这样一个小组件：验收 2 要求「技能全书和作品详情使用同一关系来源」。
 * 唯一关系来源是 `project_skills`；技能侧由 `/velvet/<slug>` 展示，
 * 作品侧由这个组件读 `GET /api/v1/skills/projects/<slug>` —— **同一个端点、同一批行**，
 * 因此不可能出现「技能页说有 3 件作品、作品页说 2 门技能」这种互相矛盾。
 *
 * 它**不修改** T06 的任何文件：作品页若要显示这一块，只需在合适位置加一行
 * （集成申请里给了确切写法）：
 *
 *     <ProjectSkills projectSlug={project.slug} />
 *
 * 失败与空值是两种不同的展示：
 *   - 读不到（服务不可用）→ 明确写出来，而不是让读者以为这件作品没有技能；
 *   - 读到空数组 → 「这件作品还没有登记技能」，并给出技能全书入口。
 * 没有关联时**不**显示一个空的技能标题行。
 */

import type { ReactNode } from "react";

import { useFeatureFetch } from "@/features/growth-fetch/use-fetch";
import { SiteLink } from "@/features/runtime/navigation/site-link";

import { fetchSkillsForProject } from "./api";
import { skillPath, VELVET_PATH } from "./paths";
import "@/features/velvet/velvet.css";
import type { SkillSummary } from "./types";

export function ProjectSkills({ projectSlug }: { projectSlug: string }): ReactNode {
  const { state } = useFeatureFetch<SkillSummary[]>(projectSlug, (signal) =>
    fetchSkillsForProject(projectSlug, signal),
  );

  if (state.status === "loading") {
    return (
      <p className="plv-hint" role="status">
        正在读取这件作品使用的技能…
      </p>
    );
  }

  if (state.status === "failed") {
    return (
      <p className="plv-hint" role="status" data-skills-unavailable="">
        暂时读不到技能信息（作品本身不受影响）。
      </p>
    );
  }

  if (state.data.length === 0) {
    return (
      <p className="plv-empty" role="status" data-skills-empty="">
        这件作品还没有登记技能。
        {" "}
        <SiteLink href={VELVET_PATH} source="phone-link">
          看技能全书
        </SiteLink>
      </p>
    );
  }

  return (
    <ul className="plv-evidence-list" data-project-skills="">
      {state.data.map((skill) => (
        <li key={skill.id}>
          <SiteLink href={skillPath(skill.slug)} source="phone-link" data-project-skill={skill.slug}>
            {skill.name}（{skill.domain_label}）
          </SiteLink>
        </li>
      ))}
    </ul>
  );
}
