"use client";

/**
 * 编辑器入口 id（`?entry=<uuid>`，契约 §9.4 更新 / 设计书 §3.2）。
 *
 * 为什么需要：本机恢复副本的 localStorage key 必须包含「入口 id」——
 * 新内容每次打开编辑器生成一个新的 entry，避免不同草稿串稿；
 * 同时把 entry 写回 URL，**刷新后仍是同一个 key**，本机副本才能恢复。
 *
 * 行为：
 *  - `useEntryId()` 首次渲染返回 `null`（服务端渲染/hydration 安全），挂载后：
 *    读 URL `?entry=<uuid>` → 合法则采用；缺失或非法 → `createEntryId()` 生成并
 *    `router.replace(...)` 写回 URL（replace 不增加历史栈）；
 *  - 写回时**只设置 `entry` 参数**，保留 `returnTo` / `date` 等其他查询参数；
 *  - 需要在「再发一条」等场景重新开一份草稿时：调用 `createEntryId()` +
 *    `withEntryId(...)` 并把新 id 写回 URL，再以新 id 重挂编辑器（见交付文档）。
 */

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** URL 里入口 id 的参数名。 */
export const ENTRY_PARAM = "entry";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** 是否是合法的入口 id（uuid v1–v5 形状）；非法值不写进 localStorage key。 */
export function isEntryId(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * 生成一个新的入口 id。
 *
 * 优先 `crypto.randomUUID()`；旧环境/测试替身没有时退回时间戳 + 随机数的 uuid v4 形状
 * （仍然保证 key 里不会出现 `.`、`/` 之类会破坏 key 分段的字符）。
 */
export function createEntryId(): string {
  const cryptoApi = typeof globalThis === "undefined" ? undefined : globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
  const variant = ((Math.random() * 4) | 0) + 8;
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-${variant.toString(16)}${hex().slice(1)}-${hex()}${hex()}${hex()}`;
}

/**
 * 在 `href` 上设置（或替换）`entry` 参数，**原样保留其他查询参数与 hash**。
 *
 * 例：`withEntryId("/admin/journal/new?date=2026-10-18&returnTo=%2Fapps%2Fjournal", id)`
 * → `/admin/journal/new?date=2026-10-18&returnTo=%2Fapps%2Fjournal&entry=<id>`。
 */
export function withEntryId(href: string, entryId: string): string {
  const hashIndex = href.indexOf("#");
  const hash = hashIndex === -1 ? "" : href.slice(hashIndex);
  const withoutHash = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const queryIndex = withoutHash.indexOf("?");
  const path = queryIndex === -1 ? withoutHash : withoutHash.slice(0, queryIndex);
  const params = new URLSearchParams(queryIndex === -1 ? "" : withoutHash.slice(queryIndex + 1));
  params.set(ENTRY_PARAM, entryId);
  const suffix = params.toString();
  return `${path}${suffix ? `?${suffix}` : ""}${hash}`;
}

/**
 * 读取/建立当前编辑器的入口 id。
 *
 * 页面应在拿到非空值之后才挂编辑器（并把同一个值传给 `useWorkDraft({ entryId })`）：
 * 首次渲染返回 `null`，是为了让服务端渲染与客户端 hydration 产出一致。
 */
export function useEntryId(): string | null {
  const router = useRouter();
  const [entryId, setEntryId] = useState<string | null>(null);

  useEffect(() => {
    // 放进异步闭包：避免 effect 内同步 setState 的级联渲染（挂载后一帧内完成）。
    void (async () => {
      if (typeof window === "undefined") return;
      const params = new URLSearchParams(window.location.search);
      const current = params.get(ENTRY_PARAM);
      if (isEntryId(current)) {
        setEntryId(current);
        return;
      }
      const generated = createEntryId();
      const href = withEntryId(
        `${window.location.pathname}${window.location.search}${window.location.hash}`,
        generated,
      );
      // replace：入口 id 写回不产生新的历史记录（编辑器不留在后退栈里）。
      router.replace(href);
      setEntryId(generated);
    })();
  }, [router]);

  return entryId;
}
