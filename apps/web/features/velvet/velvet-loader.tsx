"use client";

/**
 * 技能全书的浏览器端外壳（没有 `API_INTERNAL_URL` 的本地开发环境用）。
 *
 * 与 `SkillReadingLoader` 同一个理由：Next 的服务端读取需要 `API_INTERNAL_URL`，
 * 本地开发只跑前端时它没有值。这时由浏览器按 URL 里的 `domain` 读同源 `/api/v1`，
 * 得到与生产完全一样的数据（同一条公开端点），而不是退化成一份假数据。
 *
 * `domain` 从 URL 读到：可分享、可刷新、Back / Forward 都可用。
 * 可取消读取与「不在 effect 里同步 setState」由 `useFeatureFetch` 统一处理。
 */

import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

import { useFeatureFetch } from "@/features/growth-fetch/use-fetch";

import { fetchSkills } from "./api";
import { SERVICE_UNAVAILABLE } from "./failure";
import { SKILL_PAGE_SIZE, isSkillDomain, type SkillPage } from "./types";
import "@/features/velvet/velvet.css";
import { VelvetView } from "./velvet-view";

export function VelvetLoader(): ReactNode {
  const params = useSearchParams();
  const rawDomain = params?.get("domain") ?? null;
  const domain = isSkillDomain(rawDomain) ? rawDomain : null;

  const { state } = useFeatureFetch<SkillPage>(JSON.stringify({ domain }), (signal) =>
    fetchSkills({ domain, limit: SKILL_PAGE_SIZE }, signal),
  );

  if (state.status === "loading") {
    return (
      <p className="data-notice" role="status">
        正在读取技能全书…
      </p>
    );
  }

  if (state.status === "failed") {
    return (
      <VelvetView
        initialSkills={[]}
        initialCursor={null}
        loadError={SERVICE_UNAVAILABLE}
        domain={domain}
      />
    );
  }

  return (
    <VelvetView
      initialSkills={state.data.items}
      initialCursor={state.data.next_cursor}
      loadError={null}
      domain={domain}
    />
  );
}
