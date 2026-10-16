/**
 * 作品的数据类型（T06）。
 *
 * 与服务端 DTO **一一对应**（`apps/api/app/modules/projects/schemas.py`）。
 *
 * 三条硬规则：
 *
 *  1. **没有成绩字段**：这里没有 `awards` / `stars` / `users` / `downloads`。
 *     作品页要回答「你做出了什么」，而不是把编出来的数字当履历（07 §5、验收 §1）。
 *     素材不足时页面少显示一块，不生成奖项或统计。
 *  2. `palace` 为 `null` 有两种含义：**没有关联专题**，或者**关联的专题当前不公开**。
 *     两种情况界面都必须显示「暂时没有可读的攻略记录」，绝不猜标题（验收 5）。
 *  3. `links` 只可能是 `http` / `https`（服务端在 schema 层拒绝其它协议与本机路径）。
 */

/** 图片来源。`cover` = 卡片 / 详情头图，`detail` = 详情附图，`evidence` = 成果证据。 */
export type ProjectImageKind = "cover" | "detail" | "evidence";

export const PROJECT_IMAGE_KIND_LABELS: Readonly<Record<ProjectImageKind, string>> = Object.freeze({
  cover: "效果图",
  detail: "详情附图",
  evidence: "成果证据",
});

export type MaintenanceState = "active" | "maintained" | "paused" | "archived";

export interface MaintenanceOption {
  value: MaintenanceState;
  label: string;
}

/** 与后端 `MAINTENANCE_LABELS` 一致（界面的筛选与下拉用这份）。 */
export const MAINTENANCE_STATES: readonly MaintenanceOption[] = Object.freeze([
  { value: "active", label: "正在开发" },
  { value: "maintained", label: "持续维护" },
  { value: "paused", label: "暂停" },
  { value: "archived", label: "已归档" },
]);

export function maintenanceLabel(value: string): string {
  return MAINTENANCE_STATES.find((item) => item.value === value)?.label ?? value;
}

export function isMaintenanceState(value: string | null | undefined): value is MaintenanceState {
  return !!value && MAINTENANCE_STATES.some((item) => item.value === value);
}

export interface MediaVariant {
  name: string;
  width: number;
  height: number;
  bytes: number;
  url: string;
}

export interface ProjectImage {
  media_id: string;
  position: number;
  kind: string;
  alt: string;
  caption: string;
  taken_on: string | null;
  width: number;
  height: number;
  variants: MediaVariant[];
}

export interface ProjectLink {
  kind: string;
  label: string;
  url: string;
}

export const LINK_KIND_LABELS: Readonly<Record<string, string>> = Object.freeze({
  repo: "仓库",
  demo: "演示",
  docs: "文档",
  other: "链接",
});

export function linkKindLabel(kind: string): string {
  return LINK_KIND_LABELS[kind] ?? LINK_KIND_LABELS.other ?? "链接";
}

export interface ProjectPalaceLink {
  slug: string;
  title: string;
  summary: string;
}

export interface ProjectSummary {
  id: string;
  slug: string;
  title: string;
  summary: string;
  tech_stack: string[];
  maintenance: string;
  maintenance_label: string;
  published_at: string;
  cover: ProjectImage | null;
  palace: ProjectPalaceLink | null;
}

export interface ProjectDetail extends ProjectSummary {
  role: string;
  problem: string;
  tradeoffs: string;
  outcomes: string;
  links: ProjectLink[];
  images: ProjectImage[];
}

export interface ProjectPage {
  items: ProjectSummary[];
  next_cursor: string | null;
}

export interface AdminProject {
  id: string;
  slug: string;
  title: string;
  summary: string;
  role: string;
  problem: string;
  tradeoffs: string;
  outcomes: string;
  tech_stack: string[];
  links: ProjectLink[];
  maintenance: string;
  maintenance_label: string;
  palace_id: string | null;
  status: "draft" | "published";
  published_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
  images: AdminProjectImage[];
}

export interface AdminProjectImage extends ProjectImage {
  media_status: string;
  media_deleted: boolean;
}

export interface AdminProjectImageInput {
  media_id: string;
  position: number;
  kind: ProjectImageKind;
  alt: string;
  caption: string;
  taken_on: string | null;
}

export interface ProjectLinkInput {
  kind: "repo" | "demo" | "docs" | "other";
  label: string;
  url: string;
}

export const PROJECT_PAGE_SIZE = 12;
export const ADMIN_PAGE_SIZE = 20;

/** 图格缩略图（自然比例）。与相册同一套回落规则。 */
export function projectImageUrl(
  image: ProjectImage,
  preferred: readonly string[] = ["w640.webp", "w320.webp", "w1280.webp"],
): string | null {
  for (const name of preferred) {
    const found = image.variants.find((variant) => variant.name === name);
    if (found) return found.url;
  }
  return image.variants[0]?.url ?? null;
}

/** 图片的 `alt`：后端保证非空，这里再兜一层，避免无 alt 的 `<img>`。 */
export function projectImageAlt(image: ProjectImage): string {
  const text = (image.alt ?? "").trim();
  return text || (image.caption ?? "").trim() || "作品图片（未填写替代文本）";
}

/**
 * 「一句话用途」在卡片上的截断长度。
 *
 * 截断只发生在**展示**上，不改数据；超长时加省略号，读者仍可在详情页看到全文。
 */
export const SUMMARY_CARD_MAX = 120;

export function truncateSummary(value: string): string {
  const text = (value ?? "").trim();
  if (text.length <= SUMMARY_CARD_MAX) return text;
  return `${text.slice(0, SUMMARY_CARD_MAX)}…`;
}
