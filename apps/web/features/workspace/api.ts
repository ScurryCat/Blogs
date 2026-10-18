/**
 * 工作草稿（work-drafts）浏览器端 API（P5 第一批）。
 *
 * 契约：`docs/agent-deliveries/P5-C0-integration-contract.md` §3.2 / §4.2。
 *
 * 硬约束：
 *  - 自动保存只写 `work_drafts`，**永远不写** `moments` / `journal_entries`（设计书 §3.1）；
 *  - 写请求统一带 `X-CSRF-Token` 头（契约 §9.2：长手记正文超过 body csrf 的 4096 字节上限），
 *    body 里**不再**依赖 `csrf_token`；
 *  - 版本控制沿用共享客户端：PATCH / commit 走 `If-Match: "<draft_version>"`（428 缺头 / 412 冲突）。
 */

import { apiRequest, type Page } from "@/lib/api/client";

import type {
  CommitResult,
  CommitWorkDraftInput,
  ContentType,
  CreateWorkDraftInput,
  PickedImage,
  WorkDraft,
  WorkDraftPatch,
} from "./types";

/** 全部工作草稿接口的基路径（§3.2）。 */
export const WORK_DRAFTS_PATH = "/admin/work-drafts";

/** 写请求头：CSRF 走 header，不依赖 body（§9.2）。 */
function writeHeaders(csrf: string): Record<string, string> {
  return { "X-CSRF-Token": csrf };
}

/** 图片数组 → wire 形状；**数组顺序即 position**（省略 position 时按当前顺序补齐）。 */
function imagesToWire(images: readonly PickedImage[]): Array<{ media_id: string; position: number; alt: string }> {
  return images.map((image, index) => ({
    media_id: image.media_id,
    position: index,
    alt: image.alt ?? "",
  }));
}

/** `POST /admin/work-drafts`：创建或恢复工作草稿。 */
export function createWorkDraft(
  csrf: string,
  input: CreateWorkDraftInput,
  signal?: AbortSignal,
): Promise<{ draft: WorkDraft; reused: boolean }> {
  const body: Record<string, unknown> = { content_type: input.contentType };
  if (input.targetId) body.target_id = input.targetId;
  if (input.data !== undefined) body.data = input.data;
  if (input.images !== undefined) body.images = imagesToWire(input.images);
  return apiRequest<{ draft: WorkDraft; reused: boolean }>(WORK_DRAFTS_PATH, {
    method: "POST",
    body,
    headers: writeHeaders(csrf),
    signal,
  });
}

/** `GET /admin/work-drafts`：列表（仅本人 active，updated_at 倒序）。 */
export function listWorkDrafts(
  options: { contentType?: ContentType; cursor?: string | null; limit?: number } = {},
  signal?: AbortSignal,
): Promise<Page<WorkDraft>> {
  const query = new URLSearchParams();
  if (options.contentType) query.set("content_type", options.contentType);
  if (options.cursor) query.set("cursor", options.cursor);
  if (options.limit !== undefined) query.set("limit", String(options.limit));
  const suffix = query.toString();
  return apiRequest<Page<WorkDraft>>(suffix ? `${WORK_DRAFTS_PATH}?${suffix}` : WORK_DRAFTS_PATH, {
    signal,
  });
}

/** `GET /admin/work-drafts/{id}`：详情（跨设备恢复/冲突时读最新版本）。 */
export function getWorkDraft(id: string, signal?: AbortSignal): Promise<WorkDraft> {
  return apiRequest<WorkDraft>(`${WORK_DRAFTS_PATH}/${encodeURIComponent(id)}`, { signal });
}

/** `PATCH /admin/work-drafts/{id}`：保存工作副本（If-Match 草稿版本）。 */
export function updateWorkDraft(
  csrf: string,
  id: string,
  draftVersion: number,
  patch: WorkDraftPatch,
  signal?: AbortSignal,
): Promise<WorkDraft> {
  const body: Record<string, unknown> = {};
  if (patch.data !== undefined) body.data = patch.data;
  if (patch.images !== undefined) body.images = imagesToWire(patch.images);
  return apiRequest<WorkDraft>(`${WORK_DRAFTS_PATH}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body,
    ifMatch: `"${draftVersion}"`,
    headers: writeHeaders(csrf),
    signal,
  });
}

/** `POST /admin/work-drafts/{id}/commit`：显式提交（事务 + 双版本检查 + 幂等）。 */
export function commitWorkDraft(
  csrf: string,
  id: string,
  draftVersion: number,
  input: CommitWorkDraftInput,
  signal?: AbortSignal,
): Promise<CommitResult> {
  return apiRequest<CommitResult>(`${WORK_DRAFTS_PATH}/${encodeURIComponent(id)}/commit`, {
    method: "POST",
    body: {
      action: input.action,
      expected_target_version: input.expectedTargetVersion,
      commit_key: input.commitKey,
    },
    ifMatch: `"${draftVersion}"`,
    headers: writeHeaders(csrf),
    signal,
  });
}

/** `DELETE /admin/work-drafts/{id}`：丢弃工作草稿（204；不动正式内容与媒体文件）。 */
export function discardWorkDraft(csrf: string, id: string, signal?: AbortSignal): Promise<void> {
  return apiRequest<void>(`${WORK_DRAFTS_PATH}/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: writeHeaders(csrf),
    signal,
  });
}
