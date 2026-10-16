/**
 * 作品详情（`/showcase/projects/<slug>`，T06；07 §5 / §7）。
 *
 * 服务端组件：直接读 `GET /api/v1/projects/<slug>` 并渲染正文。
 *
 * 三种结果的反馈**必须不同**：
 *  - 404（草稿 / 已撤回 / 已删除 / slug 不存在）：`notFound()` → 真正的 404 页面；
 *  - 其它 HTTP 错误：显示服务端给的真实原因（不降级成「作品不存在」）；
 *  - 连不上 API：说明是连接问题。
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { ApiClientError, ApiTransportError } from "@/lib/api/client";
import "@/features/gallery/gallery.css";
import "@/features/showcase/showcase.css";
import { ProjectReading } from "@/features/showcase/project-reading";
import { fetchProjectOnServer } from "@/features/showcase/server-api";
import type { ProjectDetail } from "@/features/showcase/types";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  try {
    const project = await fetchProjectOnServer(slug);
    if (project) {
      return {
        title: `${project.title} · 我的殿堂`,
        description: project.summary || "作品详情：职责、关键取舍与可验证成果。",
      };
    }
  } catch {
    // 元数据读取失败不影响页面本身的错误处理，回落到通用标题。
  }
  return { title: "作品 · 我的殿堂" };
}

export default async function ProjectPage({ params }: PageProps): Promise<ReactNode> {
  const { slug } = await params;

  let project: ProjectDetail | null = null;
  let failure: string | null = null;
  try {
    project = await fetchProjectOnServer(slug);
  } catch (error) {
    if (error instanceof ApiClientError) {
      failure = `读取作品失败（HTTP ${error.status}）：${error.message}`;
    } else if (error instanceof ApiTransportError) {
      failure = "连不上接口服务，暂时无法读取这件作品。";
    } else if (error instanceof Error && error.message) {
      failure = `读取作品失败：${error.message}`;
    } else {
      failure = "读取作品失败。";
    }
  }

  if (failure) {
    return (
      <section className="shell">
        <div className="pls-wrap">
          <div className="pls-state" role="status" data-project-error="">
            <p className="pls-state-kicker">FAILED</p>
            <h1 className="pls-state-title">作品暂时读不出来</h1>
            <p className="pls-state-body">{failure}</p>
            <p className="pls-state-body">
              <Link href="/showcase">回到我的殿堂</Link>
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (!project) {
    // 草稿、已撤回、已删除与不存在完全同形 —— 真 404，不猜也不跳首页。
    notFound();
  }

  return (
    <section className="shell">
      <ProjectReading project={project} />
    </section>
  );
}
