/**
 * 天鹅绒房间 · 技能全书（`/velvet`，T09；07 §6 / §7）。
 *
 * 这是**服务端组件**：第一页技能在服务端读（`API_INTERNAL_URL`），把可序列化的结果交给
 * 客户端视图 `VelvetView`。这样首屏就有内容，不需要客户端空转一圈再渲染。
 *
 * 读取失败的处理（01 §6）：把失败原因**如实显示**，绝不降级成「没有技能」——
 * 「读不到」和「真的没有」是两种不同的反馈。`API_INTERNAL_URL` 未配置时
 * （本地只跑前端）渲染客户端加载器，由它读同源 `/api/v1`。
 *
 * 领域筛选放在 URL（`?domain=`）：可分享、可刷新、Back 可用；
 * 用户没有写权限，所以路由里不能出现「只存前端的筛选状态」。
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";

import { ApiClientError, ApiTransportError } from "@/lib/api/client";
import { VelvetLoader } from "@/features/velvet/velvet-loader";
import { VelvetView } from "@/features/velvet/velvet-view";
import { fetchSkillsOnServer } from "@/features/velvet/server-api";
import { isSkillDomain, SKILL_PAGE_SIZE, type SkillSummary } from "@/features/velvet/types";
import "@/features/velvet/velvet.css";
import { AppPageShell } from "@/components/ui/app-page-shell";

export const metadata: Metadata = {
  title: "天鹅绒房间 · 技能全书",
  description:
    "已学习的领域、能力范围与真实作品证据。技能与作品的关系只有一份：这里列出的作品，就是作品页里写着的技能。",
};

// 公开数据首版不共享缓存（01 §6），也不预生成固定页面。
export const dynamic = "force-dynamic";

function serverReadingEnabled(): boolean {
  return Boolean(process.env.API_INTERNAL_URL);
}

function failureReason(error: unknown): string {
  if (error instanceof ApiClientError) {
    return `读取技能全书失败（HTTP ${error.status}）：${error.message}`;
  }
  if (error instanceof ApiTransportError) {
    return "连不上接口服务，暂时无法读取技能全书。";
  }
  if (error instanceof Error && error.message) {
    return `读取技能全书失败：${error.message}`;
  }
  return "读取技能全书失败。";
}

interface PageProps {
  searchParams: Promise<{ domain?: string | string[] }>;
}

export default async function VelvetPage({ searchParams }: PageProps): Promise<ReactNode> {
  const params = await searchParams;
  const raw = Array.isArray(params.domain) ? params.domain[0] : params.domain;
  const domain = isSkillDomain(raw) ? raw : null;

  if (!serverReadingEnabled()) {
    return (
      <AppPageShell>
        <VelvetLoader />
      </AppPageShell>
    );
  }

  let skills: SkillSummary[] = [];
  let cursor: string | null = null;
  let loadError: string | null = null;
  try {
    const page = await fetchSkillsOnServer({ domain, limit: SKILL_PAGE_SIZE });
    skills = page.items;
    cursor = page.next_cursor;
  } catch (error) {
    loadError = failureReason(error);
  }

  return (
    <AppPageShell>
      <VelvetView
        initialSkills={skills}
        initialCursor={cursor}
        loadError={loadError}
        domain={domain}
      />
    </AppPageShell>
  );
}
