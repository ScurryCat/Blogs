/**
 * 技能全书的数据类型（T09）。
 *
 * 与服务端 DTO **一一对应**（`apps/api/app/modules/skills/schemas.py`）。
 *
 * 三条硬规则：
 *
 *  1. **没有等级字段**：这里没有 `level` / `rank` / `score` / `percent`。
 *     07 §6「不自封数值等级」；技能的表达方式是 `scope`（范围说明）+
 *     `evidence`（掌握证据）+ 真实的 `projects`（作品证据）。
 *  2. **没有成绩数字**：`project_count` 是**当前公开**关联作品的实时统计，
 *     不是「完成度」或「熟练度」。界面上的措辞必须是「关联作品 N 件」。
 *  3. `tech_overlap` 是**算出来的**一致性诊断：当前公开关联作品的技术栈里，
 *     与本技能同名的项。它不是一份要维护的数据，也不代表掌握程度。
 */

/** 领域（07 §6「技能全书展示已学习的领域」）。取值与后端 `SKILL_DOMAINS` 一致。 */
export type SkillDomain =
  | "algorithm"
  | "frontend"
  | "backend"
  | "data"
  | "signal"
  | "systems"
  | "tooling"
  | "other";

export interface SkillDomainOption {
  value: SkillDomain;
  label: string;
}

/** 与后端 `DOMAIN_LABELS` 一致（界面的筛选与下拉用这份）。 */
export const SKILL_DOMAINS: readonly SkillDomainOption[] = Object.freeze([
  { value: "algorithm", label: "算法与数据结构" },
  { value: "frontend", label: "前端工程" },
  { value: "backend", label: "后端与接口" },
  { value: "data", label: "数据与存储" },
  { value: "signal", label: "信号与系统" },
  { value: "systems", label: "系统与网络" },
  { value: "tooling", label: "工具与流程" },
  { value: "other", label: "其它" },
]);

export function domainLabel(value: string): string {
  return SKILL_DOMAINS.find((item) => item.value === value)?.label ?? value;
}

export function isSkillDomain(value: string | null | undefined): value is SkillDomain {
  return !!value && SKILL_DOMAINS.some((item) => item.value === value);
}

export type SkillStatus = "draft" | "published";

export interface SkillLink {
  kind: string;
  label: string;
  url: string;
}

export const LINK_KIND_LABELS: Readonly<Record<string, string>> = Object.freeze({
  repo: "仓库",
  demo: "演示",
  docs: "文档",
  proof: "验证",
  other: "链接",
});

export function linkKindLabel(kind: string): string {
  return LINK_KIND_LABELS[kind] ?? LINK_KIND_LABELS.other ?? "链接";
}

/** 技能关联到的一件**当前公开**作品（最小字段，正文仍只有一份）。 */
export interface SkillProjectRef {
  id: string;
  slug: string;
  title: string;
  summary: string;
  maintenance: string;
  maintenance_label: string;
  published_at: string;
}

export interface SkillSummary {
  id: string;
  slug: string;
  name: string;
  domain: string;
  domain_label: string;
  scope: string;
  evidence: string;
  position: number;
  links: SkillLink[];
  project_count: number;
}

export interface SkillDetail extends SkillSummary {
  projects: SkillProjectRef[];
  /** 当前公开关联作品的技术栈里与本技能同名的项（只读诊断，不是等级）。 */
  tech_overlap: string[];
}

export interface SkillPage {
  items: SkillSummary[];
  next_cursor: string | null;
}

/**
 * 「合体」筛选结果（07 §6）。
 *
 * `items` 为空是**正常结果**（`note` 会说明「还没有同时用到这两个技能的公开作品」），
 * 界面必须显示空态，**不能**编造一件作品。
 */
export interface SkillCombo {
  a: SkillSummary;
  b: SkillSummary;
  items: SkillProjectRef[];
  note: string;
}

export interface AdminSkillProjectRelation {
  project_id: string;
  slug: string;
  title: string;
  status: SkillStatus;
  position: number;
}

export interface AdminSkill {
  id: string;
  slug: string;
  name: string;
  domain: string;
  domain_label: string;
  scope: string;
  evidence: string;
  links: SkillLink[];
  position: number;
  status: SkillStatus;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
  projects: AdminSkillProjectRelation[];
}

export interface SkillLinkInput {
  kind: "repo" | "demo" | "docs" | "proof" | "other";
  label: string;
  url: string;
}

export interface SkillProjectRelationInput {
  project_id: string;
  position: number;
}

export const SKILL_PAGE_SIZE = 30;
export const ADMIN_SKILL_PAGE_SIZE = 50;

/** 「合体」空缺时的说明（与服务端 `COMBO_EMPTY_NOTE` 同一句话，界面不另写一套）。 */
export const COMBO_EMPTY_NOTE = "还没有同时用到这两个技能的公开作品。";

/**
 * 范围说明在卡片上的截断长度。
 *
 * 截断只发生在**展示**上，不改数据；超长时加省略号，读者仍可在详情页看到全文。
 */
export const SCOPE_CARD_MAX = 140;

export function truncateScope(value: string): string {
  const text = (value ?? "").trim();
  if (text.length <= SCOPE_CARD_MAX) return text;
  return `${text.slice(0, SCOPE_CARD_MAX)}…`;
}
