/**
 * 手记正文 `/apps/journal/<id>`（07 §7）。
 *
 * 两条数据路径、**同一个展示组件**：
 *
 *  1. 服务端配置了 `API_INTERNAL_URL`（生产形态）→ 服务端读取；草稿 / 私密 / 已撤回 /
 *     不存在的记录一律 `notFound()`，返回**真正的 404**（不泄漏「存在但私密」）；
 *  2. 没有配置（本地开发）或服务端读不到 → 渲染同源读取的客户端加载器，
 *     由它区分「已不再公开」与「服务暂时不可用」。
 *
 * 直接访问、刷新、从历史返回都不播过场；页面内的其它链接才发送来源。
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { EntryReading } from "@/features/journal/entry-reading";
import { EntryReadingLoader } from "@/features/journal/entry-reading-loader";
import { JournalPageShell } from "@/features/journal/page-shell";
import type { JournalEntryDetail } from "@/features/journal/types";
import { ApiClientError } from "@/lib/api/client";
import { serverApiRequest } from "@/lib/api/server";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

function serverReadingEnabled(): boolean {
  return Boolean(process.env.API_INTERNAL_URL);
}

async function readForPage(entryId: string): Promise<JournalEntryDetail> {
  return serverApiRequest<JournalEntryDetail>(`/journal/entries/${encodeURIComponent(entryId)}`);
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  if (!serverReadingEnabled()) return { title: "手记" };
  try {
    const entry = await readForPage(decodeURIComponent(id));
    return { title: entry.title || "手记", description: entry.excerpt };
  } catch {
    // 读取失败不冒充标题，也不让元数据抛错。
    return { title: "手记" };
  }
}

export default async function JournalEntryPage({ params }: PageProps): Promise<ReactNode> {
  const { id } = await params;
  const decoded = decodeURIComponent(id);

  if (!serverReadingEnabled()) {
    return (
      <JournalPageShell>
        <EntryReadingLoader entryId={decoded} />
      </JournalPageShell>
    );
  }

  // notFound() 必须在 try 之外调用：它靠抛异常实现，被 catch 吞掉会变成 500。
  let entry: JournalEntryDetail | null = null;
  let failure: unknown = null;
  try {
    entry = await readForPage(decoded);
  } catch (error) {
    failure = error;
  }

  if (failure) {
    if (failure instanceof ApiClientError && failure.status === 404) notFound();
    // 其它错误（服务不可用、网关问题）不伪装成「不存在」：交给浏览器同源读取。
    return (
      <JournalPageShell>
        <EntryReadingLoader entryId={decoded} />
      </JournalPageShell>
    );
  }

  if (!entry) notFound();
  return (
    <JournalPageShell>
      <EntryReading entry={entry} />
    </JournalPageShell>
  );
}
