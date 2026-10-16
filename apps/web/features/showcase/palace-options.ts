/**
 * 关联专题候选（作品管理的下拉数据）。
 *
 * 读的是 **T04 的公开端点** `GET /api/v1/nav/palaces`，因此：
 *  - 候选项一定是**当前公开**的专题（草稿 / 已撤回 / 无公开文章的专题不出现）；
 *  - 本模块不 import `features/metanav/` 的任何内部实现 —— 只按公开 HTTP 契约读，
 *    对方的内部重构不会让作品管理页编译失败（T04 的交付单提醒过这类耦合）。
 *
 * 读取失败时返回空列表：关联专题是**可选**字段，下拉为空不该让整个管理页失败。
 */

import { apiRequest } from "@/lib/api/client";

export interface PalaceOption {
  id: string;
  slug: string;
  title: string;
}

interface PalaceSummary {
  id: string;
  slug: string;
  title: string;
}

export async function fetchPalaceOptions(signal?: AbortSignal): Promise<PalaceOption[]> {
  try {
    const page = await apiRequest<{ items: PalaceSummary[]; next_cursor: string | null }>(
      "/api/v1/nav/palaces?limit=30",
      { signal },
    );
    return page.items.map((item) => ({ id: item.id, slug: item.slug, title: item.title }));
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return [];
  }
}
