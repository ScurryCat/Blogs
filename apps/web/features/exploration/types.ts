/**
 * 问题记录的数据类型（T09 · 印象空间）。
 *
 * 与服务端 DTO **一一对应**（`apps/api/app/modules/exploration/schemas.py`）。
 *
 * 两条硬规则：
 *
 *  1. **工作状态与发布状态是两件事**（07 §6）：`work_status` 只在
 *     待探索 / 调查中 / 已解决 / 暂搁置 之间；`status` 是站主的发布开关。
 *     界面上必须把两者分开显示 —— 「已解决」不等于「所有人都能看到」。
 *  2. **关联内容只在当前公开时出现**：撤回的文章 / 作品会被服务端整条丢弃，
 *     客户端拿不到隐藏标题，也不应该用「（已隐藏）」之类的占位去补位。
 */

/** 工作状态（07 §6）。取值与后端 `WORK_STATUSES` 一致。 */
export type WorkStatus = "pending" | "investigating" | "resolved" | "archived";

export interface WorkStatusOption {
  value: WorkStatus;
  label: string;
}

/** 与后端 `WORK_STATUS_LABELS` 一致（界面的筛选与下拉用这份）。 */
export const WORK_STATUSES: readonly WorkStatusOption[] = Object.freeze([
  { value: "pending", label: "待探索" },
  { value: "investigating", label: "调查中" },
  { value: "resolved", label: "已解决" },
  { value: "archived", label: "暂搁置" },
]);

export function workStatusLabel(value: string): string {
  return WORK_STATUSES.find((item) => item.value === value)?.label ?? value;
}

export function isWorkStatus(value: string | null | undefined): value is WorkStatus {
  return !!value && WORK_STATUSES.some((item) => item.value === value);
}

export type RecordStatus = "draft" | "published";

export interface EvidenceLink {
  kind: string;
  label: string;
  url: string;
}

export const EVIDENCE_KIND_LABELS: Readonly<Record<string, string>> = Object.freeze({
  repo: "仓库",
  demo: "演示",
  docs: "文档",
  proof: "验证",
  other: "链接",
});

export function evidenceKindLabel(kind: string): string {
  return EVIDENCE_KIND_LABELS[kind] ?? EVIDENCE_KIND_LABELS.other ?? "链接";
}

/** 关联的**当前公开**文章（撤回后整条消失）。 */
export interface RelatedPost {
  id: string;
  slug: string;
  title: string;
  href: string;
}

/** 关联的**当前公开**作品（撤回后整条消失）。 */
export interface RelatedProject {
  id: string;
  slug: string;
  title: string;
  summary: string;
  href: string;
}

export interface RecordSummary {
  id: string;
  slug: string;
  title: string;
  /** 背景摘要（卡片用）。不是完成度，也不是评分。 */
  excerpt: string;
  work_status: string;
  work_status_label: string;
  resolved_at: string | null;
  published_at: string;
  /** 当前公开的关联数量（不是「完成度」）。 */
  post_count: number;
  project_count: number;
}

export interface RecordDetail extends RecordSummary {
  background: string;
  attempts: string;
  outcome: string;
  evidence_links: EvidenceLink[];
  posts: RelatedPost[];
  projects: RelatedProject[];
}

export interface RecordPage {
  items: RecordSummary[];
  next_cursor: string | null;
}

/** 公开工作状态统计：只算**当前公开**的记录（不泄漏草稿数量）。 */
export interface RecordStats {
  total: number;
  by_work_status: Record<string, number>;
}

export interface RelatedPostRelation {
  post_id: string;
  slug: string;
  title: string;
  status: RecordStatus;
  position: number;
}

export interface RelatedProjectRelation {
  project_id: string;
  slug: string;
  title: string;
  status: RecordStatus;
  position: number;
}

export interface AdminRecord {
  id: string;
  slug: string;
  title: string;
  background: string;
  attempts: string;
  outcome: string;
  evidence_links: EvidenceLink[];
  work_status: string;
  work_status_label: string;
  resolved_at: string | null;
  status: RecordStatus;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
  posts: RelatedPostRelation[];
  projects: RelatedProjectRelation[];
}

export interface EvidenceLinkInput {
  kind: "repo" | "demo" | "docs" | "proof" | "other";
  label: string;
  url: string;
}

export interface RelatedPostRelationInput {
  post_id: string;
  position: number;
}

export interface RelatedProjectRelationInput {
  project_id: string;
  position: number;
}

export const RECORD_PAGE_SIZE = 20;
export const ADMIN_RECORD_PAGE_SIZE = 50;

/**
 * 背景摘要的兜底截断长度。
 *
 * 正常情况下服务端已经给出 `excerpt`（与它自己的一致性都由服务端保证），
 * 这里只是防御性兜底：万一某个入口漏传，界面也不会把整段背景塞进卡片。
 */
export const BACKGROUND_CARD_MAX = 160;

export function truncateBackground(value: string): string {
  const text = (value ?? "").trim();
  if (text.length <= BACKGROUND_CARD_MAX) return text;
  return `${text.slice(0, BACKGROUND_CARD_MAX)}…`;
}

/**
 * 「已解决」的展示补充。
 *
 * 07 §6 要求已解决的记录有**实际说明**；服务端保证 `outcome` 非空，
 * 界面在这里再兜一层，避免将来某个入口漏传时显示一个空的「结果」小节。
 */
export function resolvedSummary(record: RecordSummary): string {
  if (record.work_status !== "resolved") return record.work_status_label;
  return record.resolved_at
    ? `已解决 · ${record.resolved_at.slice(0, 10)}`
    : "已解决";
}
