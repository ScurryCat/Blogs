/**
 * 技能详情 `/velvet/<slug>`（T09；07 §6）。
 *
 * 两条数据路径，**同一个展示组件**（与 T04 的专题页、T06 的作品页同形）：
 *
 *  1. 服务端配置了 `API_INTERNAL_URL`（生产形态）→ 服务端读取，`slug` 不存在 /
 *     未发布 / 已撤回时调用 `notFound()`，返回**真正的 404**；
 *  2. 没有配置（本地开发）或服务端读不到 → 渲染同源读取的客户端加载器，
 *     由它区分「已不再公开」与「服务不可用」。
 *
 * 技能页不复制作品正文：关联作品以链接形式指向 `/showcase/projects/<slug>`（验收 2）。
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { ApiClientError } from "@/lib/api/client";
import { fetchSkillOnServer } from "@/features/velvet/server-api";
import { SkillReading } from "@/features/velvet/skill-reading";
import { SkillReadingLoader } from "@/features/velvet/skill-reading-loader";
import type { SkillDetail } from "@/features/velvet/types";
import "@/features/velvet/velvet.css";
import { AppPageShell } from "@/components/ui/app-page-shell";

// 公开状态随时可能变化：不做构建期预渲染，也不缓存。
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ slug: string }>;
}

function serverReadingEnabled(): boolean {
  return Boolean(process.env.API_INTERNAL_URL);
}

/** 站外证据链接的展示（仅用于 metadata；不参与页面渲染）。 */
function describe(skill: SkillDetail): string {
  const scope = skill.scope.trim();
  if (scope) return scope.slice(0, 160);
  return `技能：${skill.name}（${skill.domain_label}）`;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  if (!serverReadingEnabled()) return { title: "技能" };
  try {
    const skill = await fetchSkillOnServer(decodeURIComponent(slug));
    if (!skill) return { title: "技能不存在或未公开" };
    return { title: `${skill.name} · 技能全书`, description: describe(skill) };
  } catch {
    // 读取失败不冒充标题，也不让元数据抛错。
    return { title: "技能" };
  }
}

export default async function SkillPage({ params }: PageProps): Promise<ReactNode> {
  const { slug } = await params;
  const decoded = decodeURIComponent(slug);

  if (!serverReadingEnabled()) {
    return (
      <AppPageShell>
        <SkillReadingLoader slug={decoded} />
      </AppPageShell>
    );
  }

  // notFound() 必须在 try 之外调用：它靠抛异常实现，被 catch 吞掉会变成 500。
  let skill: SkillDetail | null = null;
  let failure: unknown = null;
  try {
    skill = await fetchSkillOnServer(decoded);
  } catch (error) {
    failure = error;
  }

  if (failure) {
    if (failure instanceof ApiClientError && failure.status === 404) notFound();
    // 其它错误（服务不可用、网关问题）不伪装成「不存在」：交给浏览器同源读取，
    // 由加载器显示明确的「暂时读不到」状态。
    return (
      <AppPageShell>
        <SkillReadingLoader slug={decoded} />
      </AppPageShell>
    );
  }

  if (!skill) notFound();

  return (
    <AppPageShell>
      <SkillReading skill={skill} />
    </AppPageShell>
  );
}
