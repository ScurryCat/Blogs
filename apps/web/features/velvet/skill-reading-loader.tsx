"use client";

/**
 * 技能详情的浏览器端加载器（T09）。
 *
 * 与 T06 的 `PalaceReadingLoader` 同一个用途：**没有** `API_INTERNAL_URL` 的本地开发环境
 * 里，由浏览器按 slug 读同源 `/api/v1`，并区分三种状态：
 *
 *   1. 读到了 → `SkillReading`；
 *   2. 404（不存在 / 未发布 / 已撤回）→ 明确的「技能不存在或未公开」，不是空页面；
 *   3. 服务不可用 → 「暂时读不到内容，请稍后重试」+ 重试按钮，**不伪装成不存在**。
 *
 * 分类只做**一次**（在这里）；晚到的响应由 `useFeatureFetch` 的取消逻辑拦住。
 */

import type { ReactNode } from "react";

import { useFeatureFetch } from "@/features/growth-fetch/use-fetch";
import { SiteLink } from "@/features/runtime/navigation/site-link";

import { fetchSkill } from "./api";
import { classifyFailure } from "./failure";
import { VELVET_PATH } from "./paths";
import { SkillReading } from "./skill-reading";
import "@/features/velvet/velvet.css";
import type { SkillDetail } from "./types";

export function SkillReadingLoader({ slug }: { slug: string }): ReactNode {
  const { state, reload } = useFeatureFetch<SkillDetail>(slug, (signal) =>
    fetchSkill(slug, signal),
  );

  if (state.status === "loading") {
    return (
      <p className="plv-hint" role="status">
        正在读取技能…
      </p>
    );
  }

  if (state.status === "failed") {
    const failure = classifyFailure(state.error);
    return (
      <div className="plv-room" role="alert" data-skill-failure={failure.kind}>
        <p className="plv-alert">{failure.message}</p>
        <div className="plv-actions">
          <button className="plv-button" type="button" onClick={reload}>
            重新读取
          </button>
          <SiteLink className="plv-button plv-button-ghost" href={VELVET_PATH} source="phone-link">
            回到技能全书
          </SiteLink>
        </div>
      </div>
    );
  }

  return <SkillReading skill={state.data} />;
}
