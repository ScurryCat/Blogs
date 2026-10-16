/**
 * 管理表单的纯函数：草稿 ↔ API 载荷、标签解析、排序。
 *
 * 单独成文件是为了能**不起 DOM** 直接单测：这些都是「字符串进、结构出」的转换，
 * 出错的表现是「站主填的东西没保存」或「顺序点了不动」，值得钉住。
 */

import type {
  FriendDraft,
  FriendLinkAdmin,
  FriendLinkCreateInput,
  FriendLinkPatchInput,
} from "../types";

export function emptyDraft(): FriendDraft {
  return {
    name: "",
    url: "",
    summary: "",
    story: "",
    arcana: "",
    tags: "",
    position: "0",
    avatarMediaId: "",
  };
}

export function draftFromLink(link: FriendLinkAdmin): FriendDraft {
  return {
    name: link.name,
    url: link.url,
    summary: link.summary,
    story: link.story ?? "",
    arcana: link.arcana ?? "",
    // 展示用名保留站主写法；提交时服务端按规范化值去重。
    tags: link.tags.map((tag) => tag.name).join(", "),
    position: String(link.position),
    avatarMediaId: link.avatar_media_id ?? "",
  };
}

/** 逗号 / 顿号 / 换行都能分隔标签，方便手输。 */
export function parseTags(text: string): string[] {
  return text
    .split(/[,，、\n]/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export function parsePosition(text: string): number {
  const parsed = Number.parseInt(text.trim(), 10);
  if (Number.isNaN(parsed) || parsed < 0) return 0;
  return Math.min(parsed, 100_000);
}

export function draftToCreate(draft: FriendDraft): FriendLinkCreateInput {
  return {
    name: draft.name.trim(),
    url: draft.url.trim(),
    summary: draft.summary.trim(),
    story: draft.story.trim() ? draft.story.trim() : null,
    arcana: draft.arcana.trim() ? draft.arcana.trim() : null,
    tags: parseTags(draft.tags),
    avatar_media_id: draft.avatarMediaId.trim() ? draft.avatarMediaId.trim() : null,
    position: parsePosition(draft.position),
  };
}

/**
 * 只把**真的变了**的字段放进 PATCH：服务端按出现过的字段更新，
 * 提交全量会把并发编辑的邻居字段一起覆盖掉。
 */
export function draftToPatch(draft: FriendDraft, original: FriendLinkAdmin): FriendLinkPatchInput {
  const patch: FriendLinkPatchInput = {};
  const next = draftToCreate(draft);
  const originalTags = original.tags.map((tag) => tag.name).join(", ");

  if (next.name !== original.name) patch.name = next.name;
  if (next.url !== original.url) patch.url = next.url;
  if ((next.summary ?? "") !== original.summary) patch.summary = next.summary ?? "";
  if ((next.story ?? null) !== (original.story ?? null)) patch.story = next.story ?? null;
  if ((next.arcana ?? null) !== (original.arcana ?? null)) patch.arcana = next.arcana ?? null;
  if (parseTags(draft.tags).join(", ") !== parseTags(originalTags).join(", ")) patch.tags = next.tags;
  if ((next.avatar_media_id ?? null) !== (original.avatar_media_id ?? null)) {
    patch.avatar_media_id = next.avatar_media_id ?? null;
  }
  if (next.position !== original.position) patch.position = next.position;
  return patch;
}

/** 站主手动排序的步长：留出插入空间，重排时只需要改少数几行。 */
export const POSITION_STEP = 10;

export interface ReorderPlan {
  /** 重排后的完整顺序（用于界面立即反馈）。 */
  order: FriendLinkAdmin[];
  /** 需要写回的 (id, version, position)，通常只有 1–2 条。 */
  changes: { id: string; version: number; position: number }[];
}

/**
 * 把列表里的第 `index` 条上移 / 下移一位。
 *
 * 为什么重新编号而不是交换两个 position：手动排序里的位置值可能重复（新建默认都是 0），
 * 交换会得到「点的没动」。这里按新顺序编号 `index * POSITION_STEP`，
 * 只提交真的变了的行 —— 站点规模是几十条，代价可以忽略。
 */
export function planReorder(
  items: readonly FriendLinkAdmin[],
  index: number,
  delta: -1 | 1,
): ReorderPlan | null {
  const target = index + delta;
  if (index < 0 || index >= items.length) return null;
  if (target < 0 || target >= items.length) return null;

  const order = [...items];
  const moved = order[index];
  const swapped = order[target];
  if (!moved || !swapped) return null;
  order[index] = swapped;
  order[target] = moved;

  const changes: ReorderPlan["changes"] = [];
  order.forEach((item, position) => {
    const nextPosition = position * POSITION_STEP;
    if (item.position !== nextPosition) {
      changes.push({ id: item.id, version: item.version, position: nextPosition });
    }
  });
  return { order, changes };
}
