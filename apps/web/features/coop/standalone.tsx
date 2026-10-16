"use client";

/**
 * 独立页宿主：把 `CoopView` 接到站点的导航协调器与 URL 状态上。
 *
 *  - 筛选标签与展开的卡片都在查询参数里（`?tag=` / `?item=`）：可分享、可刷新、
 *    Back / Forward 可用；
 *  - 换筛选 / 展开走 `navigation.updateUrl`（phone-internal 语义：**不播全屏过场**）；
 *  - 离开本站的外链不经过协调器：它们是普通 `<a target="_blank">`，由浏览器处理。
 */

import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

import { useNavigation } from "@/features/runtime/navigation/coordinator";

import { CoopView } from "./coop-view";
import { buildCoopHref, COOP_PATH, normalizeCoopItem, normalizeCoopTag } from "./paths";

export function CoopStandalone({ pathname = COOP_PATH }: { pathname?: string }): ReactNode {
  const params = useSearchParams();
  const navigation = useNavigation();
  const search = params?.toString() ?? "";
  // 非法取值一律回落到「没有筛选 / 没有展开」，不执行任意路径（02 §6）。
  const tag = normalizeCoopTag(params?.get("tag"));
  const item = normalizeCoopItem(params?.get("item"));

  return (
    <CoopView
      mode="site"
      tag={tag}
      item={item}
      onSelectTag={(next) => navigation.updateUrl(buildCoopHref(pathname, search, { tag: next ?? "" }))}
      onSelectItem={(next) => navigation.updateUrl(buildCoopHref(pathname, search, { item: next ?? "" }))}
    />
  );
}
