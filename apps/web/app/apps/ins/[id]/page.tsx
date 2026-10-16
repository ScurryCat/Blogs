/**
 * 图文动态详情 `/apps/ins/<uuid>`（T03）。
 *
 * 硬规则（03 §3 / 08 §2）：**动态 ID 必须是 UUID**。
 * 非 UUID 的段直接 `notFound()`，这样将来 T08 的静态路由
 * `/apps/ins/messages` 不会被动态段吞掉（验收用例 5、SHARED-CONTRACTS §4）。
 *
 * 数据在服务端读：
 *  - 200 → 交给客户端详情视图渲染（与手机视图同一个组件）；
 *  - 404（草稿、已撤回、已删除、不存在统一 404）→ 真正的 404 页面；
 *  - 其他错误 → 显示可读原因，**不伪装成「已撤回」**。
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { ApiClientError, ApiTransportError } from "@/lib/api/client";
import { DetailView } from "@/features/ins/detail-view";
import { fetchMomentOnServer } from "@/features/ins/server-api";
import { INS_TITLE } from "@/features/ins/composition";
import { excerptOf, isMomentId, type Moment } from "@/features/ins/types";
import "@/features/ins/ins.css";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  if (!isMomentId(id)) return { title: "动态不存在" };
  try {
    const moment = await fetchMomentOnServer(id);
    if (!moment) return { title: "动态已撤回或不可访问" };
    const summary = excerptOf(moment.text, 60);
    return {
      title: summary || "图文动态",
      description: summary || `${INS_TITLE} 的一条图文动态。`,
      openGraph: {
        title: summary || "图文动态",
        description: summary,
        type: "article",
        publishedTime: moment.published_at ?? undefined,
      },
    };
  } catch {
    // 元数据读取失败不影响页面本身；页面会显示失败原因。
    return { title: "图文动态" };
  }
}

export default async function MomentDetailPage({ params }: PageProps): Promise<ReactNode> {
  const { id } = await params;

  // 非 UUID：交给 404，让 /apps/ins/messages 之类的静态路由有机会接管。
  if (!isMomentId(id)) notFound();

  let moment: Moment | null = null;
  let failure: string | null = null;
  try {
    moment = await fetchMomentOnServer(id);
  } catch (error) {
    failure =
      error instanceof ApiClientError
        ? `读取失败（HTTP ${error.status}）：${error.message}`
        : error instanceof ApiTransportError
          ? "连不上接口服务，暂时无法读取这条动态。"
          : "读取失败。";
  }

  // 明确 404 → 真正的 404 状态码（不是 200 页面里写「找不到」）。
  if (!failure && moment === null) notFound();

  return (
    // 不用 <main>：根布局已经有一个 <main id="main">，嵌套 landmark 会误导读屏。
    <div className="ins-app">
      <DetailView
        momentId={id}
        initial={moment}
        confirmedMissing={!failure && moment === null}
        serverError={failure}
      />
    </div>
  );
}
