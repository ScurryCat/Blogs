/**
 * 专题页 `/apps/metanav/palaces/<slug>`（04 §4A 的独立页）。
 *
 * 两条数据路径，**同一个展示组件**：
 *
 *  1. 服务端配置了 `API_INTERNAL_URL`（生产形态）→ 服务端读取，`slug` 不存在 /
 *     未发布 / 没有公开文章时调用 `notFound()`，返回**真正的 404**；
 *  2. 没有配置（本地开发）或服务端读不到 → 渲染同源读取的客户端加载器，
 *     由它区分「已不再公开」与「服务不可用」。
 *
 * 直接访问本页、刷新、从历史返回**都不重播**认知过场（04 §7）；
 * 页面里的其它殿堂链接才发送 `metaverse-entry`。
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { ApiClientError } from "@/lib/api/client";
import { serverApiList, serverApiRequest } from "@/lib/api/server";
import { PalaceReading } from "@/features/metanav/palace-reading";
import { PalaceReadingLoader } from "@/features/metanav/palace-reading-loader";
import type { PalaceDetail, PalaceSummary } from "@/features/metanav/types";

// 公开状态随时可能变化：不做构建期预渲染，也不缓存。
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ slug: string }>;
}

interface Reading {
  palace: PalaceDetail;
  related: PalaceSummary[];
}

function serverReadingEnabled(): boolean {
  return Boolean(process.env.API_INTERNAL_URL);
}

async function readForPage(slug: string): Promise<Reading> {
  const palace = await serverApiRequest<PalaceDetail>(`/nav/palaces/${encodeURIComponent(slug)}`);
  const others = await serverApiList<PalaceSummary>("/nav/palaces", { limit: 4 });
  return { palace, related: others.items.filter((item) => item.slug !== slug).slice(0, 3) };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  if (!serverReadingEnabled()) return { title: "专题殿堂" };
  try {
    const data = await readForPage(decodeURIComponent(slug));
    return { title: data.palace.title, description: data.palace.summary };
  } catch {
    // 读取失败不冒充标题，也不让元数据抛错。
    return { title: "专题殿堂" };
  }
}

export default async function PalacePage({ params }: PageProps): Promise<ReactNode> {
  const { slug } = await params;
  const decoded = decodeURIComponent(slug);

  if (!serverReadingEnabled()) {
    return (
      <section className="shell">
        <PalaceReadingLoader slug={decoded} />
      </section>
    );
  }

  // notFound() 必须在 try 之外调用：它靠抛异常实现，被 catch 吞掉会变成 500。
  let reading: Reading | null = null;
  let failure: unknown = null;
  try {
    reading = await readForPage(decoded);
  } catch (error) {
    failure = error;
  }

  if (failure) {
    if (failure instanceof ApiClientError && failure.status === 404) notFound();
    // 其它错误（服务不可用、网关问题）不伪装成「不存在」：交给浏览器同源读取，
    // 由加载器显示明确的「导航暂时不可用」状态。
    return (
      <section className="shell">
        <PalaceReadingLoader slug={decoded} />
      </section>
    );
  }

  if (!reading) notFound();
  return (
    <section className="shell">
      <PalaceReading palace={reading.palace} related={reading.related} />
    </section>
  );
}
