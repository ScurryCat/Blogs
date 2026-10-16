/**
 * 单条问题记录 `/apps/metanav/mementos/<slug>`（T09；07 §6）。
 *
 * 与 T04 的专题页 / T06 的作品页同形：
 *
 *  1. 服务端配置了 `API_INTERNAL_URL` → 服务端读取；不存在 / 未发布 / 已撤回时
 *     `notFound()` 返回**真正的 404**；
 *  2. 没有配置或服务端读不到 → 客户端加载器区分「已不再公开」与「服务不可用」。
 *
 * 关联文章 / 作品的标题由服务端按**当前公开条件**解析：撤回的内容不会出现在这里，
 * 也不会留下「（已隐藏）」占位（验收 3）。
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { ApiClientError } from "@/lib/api/client";
import { MementosReading } from "@/features/exploration/mementos-reading";
import { MementosReadingLoader } from "@/features/exploration/mementos-reading-loader";
import { fetchRecordOnServer } from "@/features/exploration/server-api";
import type { RecordDetail } from "@/features/exploration/types";
import "@/features/exploration/exploration.css";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ work_status?: string | string[] }>;
}

function serverReadingEnabled(): boolean {
  return Boolean(process.env.API_INTERNAL_URL);
}

function backWorkStatusOf(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value ?? null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  if (!serverReadingEnabled()) return { title: "问题记录" };
  try {
    const record = await fetchRecordOnServer(decodeURIComponent(slug));
    if (!record) return { title: "问题记录不存在或未公开" };
    return {
      title: `${record.title} · 印象空间`,
      description: record.background.slice(0, 160) || record.work_status_label,
    };
  } catch {
    return { title: "问题记录" };
  }
}

export default async function MementosRecordPage({
  params,
  searchParams,
}: PageProps): Promise<ReactNode> {
  const { slug } = await params;
  const search = await searchParams;
  const decoded = decodeURIComponent(slug);
  const backWorkStatus = backWorkStatusOf(search.work_status);

  if (!serverReadingEnabled()) {
    return (
      <section className="shell">
        <MementosReadingLoader slug={decoded} backWorkStatus={backWorkStatus} />
      </section>
    );
  }

  // notFound() 必须在 try 之外调用：它靠抛异常实现，被 catch 吞掉会变成 500。
  let record: RecordDetail | null = null;
  let failure: unknown = null;
  try {
    record = await fetchRecordOnServer(decoded);
  } catch (error) {
    failure = error;
  }

  if (failure) {
    if (failure instanceof ApiClientError && failure.status === 404) notFound();
    return (
      <section className="shell">
        <MementosReadingLoader slug={decoded} backWorkStatus={backWorkStatus} />
      </section>
    );
  }

  if (!record) notFound();

  return (
    <section className="shell">
      <MementosReading record={record} backWorkStatus={backWorkStatus} />
    </section>
  );
}
