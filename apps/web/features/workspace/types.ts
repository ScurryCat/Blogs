/**
 * 创作台（`/admin`）与工作草稿的前端共享类型（P5 第一批）。
 *
 * 契约来源：`docs/agent-deliveries/P5-C0-integration-contract.md` §4.2 / §9.4。
 * **导出名即契约**：C3 / C4 的编辑器只 import 这里与同目录模块，不要改名字。
 *
 * 两层数据（设计书 §3.1）：
 *   [本机恢复副本 localStorage] →（节流/顺序）→ [服务端 work_drafts] →（显式提交/事务）→ [正式内容]
 * 所以这些类型只描述「工作草稿」，不是公开内容类型。
 */

import type { components } from "@/lib/api/generated/schema";

/**
 * 管理侧媒体 DTO（由 `contracts/openapi.json` 生成；C1 的 media 管理接口复用）。
 *
 * C3 的共享图片选择器会在此基础上加 `publicly_referenced?: boolean`，结构兼容。
 */
export type MediaAdminOut = components["schemas"]["MediaAdminOut"];

/** 工作草稿支持的内容类型；第一批只有动态与手记。 */
export type ContentType = "moment" | "journal";

/** 显式提交动作：保存正式草稿 / 发布 / 更新已公开内容（手记还要区分公开与否）。 */
export type DraftAction = "save" | "publish" | "update";

/** 草稿里的图片选择（顺序即 position；`media` 是管理侧详情，可能由选择器带上）。 */
export interface PickedImage {
  media_id: string;
  alt: string;
  position?: number;
  media?: MediaAdminOut;
}

/** `WorkDraftOut`（契约 §3.3）。 */
export interface WorkDraft {
  id: string;
  content_type: ContentType;
  target_id: string | null;
  target_version: number | null;
  draft_version: number;
  /**
   * 服务端草稿状态（`work_drafts.status` 的检查约束：active / committed / discarded）。
   *
   * 只有 `active` 可以继续编辑；详情接口按契约对任何状态都返回 200（供审计/详情查看），
   * 所以「按 id 恢复」的调用方必须自己校验状态，不能把已丢弃/已提交的草稿当可编辑草稿。
   */
  status: "active" | "committed" | "discarded";
  /** 服务端派生的一行摘要（≤120 字符），列表展示用。 */
  summary: string;
  /** 按 content_type 校验的编辑数据（moment / journal 的 data 键见契约 §3.3）。 */
  data: Record<string, unknown>;
  /** 与工作草稿绑定的图片保留关系（省略=不动，给出数组=整组替换）。 */
  images: PickedImage[];
  created_at: string;
  updated_at: string;
}

/** `CommitResultOut`（契约 §3.3）：显式提交的正式结果。 */
export interface CommitResult {
  draft_id: string;
  content_type: ContentType;
  target_id: string;
  target_version: number;
  status: "draft" | "published";
  visibility: "private" | "public" | null;
  action: DraftAction;
  idempotent_replay: boolean;
}

/** 同步状态机（设计书 §3.2 / 契约 §9.4）。 */
export type SyncState = "local-only" | "saving" | "synced" | "failed" | "conflict" | "idle";

/** 本机恢复副本（localStorage）存的内容（契约 §4.2 第 3 条）。 */
export interface WorkDraftLocalCopy {
  data: Record<string, unknown>;
  images: PickedImage[];
  draftId: string | null;
  draftVersion: number | null;
  /** 本机最后一次写入时间（ISO8601）；与服务器 `updated_at` 比新旧用。 */
  savedAt: string;
  returnTo: string | null;
}

/** `POST /admin/work-drafts` 的入参（页面/引擎用；wire 字段在 api.ts 转 snake_case）。 */
export interface CreateWorkDraftInput {
  contentType: ContentType;
  targetId?: string | null;
  data?: Record<string, unknown>;
  images?: PickedImage[];
}

/** `PATCH /admin/work-drafts/{id}` 的入参；两个键都可省略（省略=不动）。 */
export interface WorkDraftPatch {
  data?: Record<string, unknown>;
  images?: PickedImage[];
}

/** 显式提交入参（`commit_key` 必填；重试复用同一个 key）。 */
export interface CommitWorkDraftInput {
  action: DraftAction;
  expectedTargetVersion: number | null;
  commitKey: string;
}
