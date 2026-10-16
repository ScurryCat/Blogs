/**
 * 相册的**纯**部分：失败分类、照片分组与展示工具。
 *
 * 这里不导入任何 React Hook，也不导入 `lib/api/server.ts`：服务端组件（相册阅读页）
 * 与客户端组件都要用这些函数。T04 踩过的坑：把 Hook 一起放进来的话，Server Component
 * 会因为「导入了依赖 useEffect 的模块」直接构建失败（`tsc` 不报错，`next build` 报错）。
 */

import { ApiClientError, ApiTransportError } from "@/lib/api/client";

import { albumKindLabel, formatTakenOn, type Photo, type WallPhoto } from "./types";

export type FailureKind = "not_found" | "unavailable" | "unknown";

export interface GalleryFailure {
  kind: FailureKind;
  message: string;
  /** 报告给用户的请求编号（有的话），便于对照服务端日志。 */
  requestId: string | null;
}

/**
 * 把任意错误分类成「真的没有这条内容」/「服务读不到」/「其它」。
 *
 * 三者的界面反馈**必须不同**（验收 6：图片失败与损坏都要有明确状态）：
 *  - `not_found`：草稿、已撤回、已删除与不存在同形 —— 说「没有这个相册」；
 *  - `unavailable`：网络 / 上游故障 —— 说「暂时读不到」并给重试；
 *  - `unknown`：其它，如实显示底层消息。
 */
export function classifyFailure(error: unknown): GalleryFailure {
  if (error instanceof ApiClientError) {
    if (error.status === 404) {
      return { kind: "not_found", message: error.message || "没有找到这个相册", requestId: error.requestId };
    }
    if (error.status >= 500) {
      return {
        kind: "unavailable",
        message: `服务暂时不可用（HTTP ${error.status}），请稍后重试。`,
        requestId: error.requestId,
      };
    }
    return { kind: "unknown", message: error.message || `请求失败（HTTP ${error.status}）`, requestId: error.requestId };
  }
  if (error instanceof ApiTransportError) {
    return { kind: "unavailable", message: "连不上接口服务，请检查网络后重试。", requestId: null };
  }
  if (error instanceof Error && error.message) {
    return { kind: "unknown", message: error.message, requestId: null };
  }
  return { kind: "unknown", message: "读取相册失败。", requestId: null };
}

/** 一「组」照片：要么是一个相册（跨相册浏览时按相册分组），要么是一段无标题的连续照片。 */
export interface PhotoGroup {
  key: string;
  albumSlug: string | null;
  albumTitle: string;
  albumKindLabel: string;
  photos: Photo[];
}

/**
 * 把照片墙的扁平结果按相册分组，**保持服务端给的顺序**。
 *
 * 为什么在客户端分组而不是服务端返回嵌套结构：跨相册照片墙的排序键是全局的
 * （拍摄日期），服务端必须按这个顺序返回才能保证游标翻页不漏不重；分组只是
 * **展示层**的重排，不改变顺序，也不影响游标（同一相册的照片可能跨两页，
 * 那时会出现两个同名的组 —— 这是真实的，不合并）。
 */
export function groupByAlbum(items: readonly WallPhoto[]): PhotoGroup[] {
  const groups: PhotoGroup[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.albumSlug === item.album.slug) {
      last.photos.push(item.photo);
      continue;
    }
    groups.push({
      key: `${item.album.slug}-${groups.length}`,
      albumSlug: item.album.slug,
      albumTitle: item.album.title,
      albumKindLabel: item.album.kind_label || albumKindLabel(item.album.kind),
      photos: [item.photo],
    });
  }
  return groups;
}

/** 照片的说明行：`拍摄时间 · 说明`；两者都空时返回空串（界面不显示空行）。 */
export function photoMetaLine(photo: Pick<Photo, "taken_on" | "caption">): string {
  const date = photo.taken_on ? formatTakenOn(photo.taken_on) : "";
  const caption = (photo.caption ?? "").trim();
  if (date && caption) return `${date} · ${caption}`;
  return date || caption;
}

/** 相册卡片的副标题：`类型 · N 张`。 */
export function albumMetaLine(album: { kind_label: string; photo_count: number }): string {
  const count = album.photo_count === 1 ? "1 张" : `${album.photo_count} 张`;
  return album.kind_label ? `${album.kind_label} · ${count}` : count;
}

/** 图片加载失败时的占位说明（验收 6：图片失败态）。 */
export const IMAGE_FAILURE_TEXT = "这张图片暂时加载不出来";
