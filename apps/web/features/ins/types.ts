/**
 * INS 图文动态的前端类型与纯函数（T03）。
 *
 * 契约来源：`docs/superpowers/specs/2026-10-16-data-api-design.md` §6（公开 DTO）
 * 与 §7（管理 DTO），以及 `apps/api/app/modules/moments/schemas.py`。
 *
 * 与后端保持一致的硬约束（03 §5）：
 *   - 文字最多 2000 个 Unicode 码点，可留空，但发布时至少一张图；
 *   - 1–9 张图片，position 从 0 连续，alt 1–200 码点；
 *   - 最多 8 个标签，单标签 1–24 码点，去空白、去重；
 *   - 只有 draft / published；撤回回到 draft；删除是软删除。
 *
 * 这里不 import `lib/api/generated/schema.ts`：生成类型由 T00 在 `/moments` 挂载后
 * 统一重生成，本包先用**手写但逐字段对齐**的接口，避免依赖尚未生成的产物。
 * 集成后如需切换到生成类型，只需替换接口来源，字段名不变。
 */

export const TEXT_MAX_CODEPOINTS = 2000;
export const IMAGES_MIN = 1;
export const IMAGES_MAX = 9;
export const ALT_MIN_CODEPOINTS = 1;
export const ALT_MAX_CODEPOINTS = 200;
export const TAGS_MAX = 8;
export const TAG_MAX_CODEPOINTS = 24;

export const MOMENTS_PATH = "/moments";
export const ADMIN_MOMENTS_PATH = "/admin/moments";

/**
 * 信息流每页条数（05 §6：默认 12、上限 30）。
 *
 * **必须放在这个模块里**（没有 `"use client"`）：服务端组件也要用它构造
 * `?limit=`。放在 `use-feed.ts` 会让服务端拿到一个「客户端引用函数」而不是数字，
 * 于是请求变成 `?limit=function(){throw Error("Attempted to call FEED_PAGE_SIZE() …")}`
 * —— API 返回 422，页面显示「读取动态失败」。（真实浏览器截图 + API 访问日志抓到。）
 */
export const FEED_PAGE_SIZE = 12;

export type MomentStatus = "draft" | "published";

export interface MomentTag {
  id: string;
  slug: string;
  name: string;
}

export interface MediaVariant {
  name: string;
  width: number;
  height: number;
  bytes: number;
  url: string;
}

export interface MomentImage {
  media_id: string;
  position: number;
  alt: string;
  width: number;
  height: number;
  variants: MediaVariant[];
}

/** 公开响应（05 §6）：不含 status / version / deleted_at 等管理字段。 */
export interface Moment {
  id: string;
  text: string;
  tags: MomentTag[];
  published_at: string | null;
  images: MomentImage[];
}

/** 管理回执里的可回填关系（只有三个写入字段）。 */
export interface MomentImageInput {
  media_id: string;
  position: number;
  alt: string;
}

/** 管理响应（05 §7）：在公开字段之外带 status / version 与可回填的图片列表。 */
export interface MomentAdmin extends Moment {
  status: MomentStatus;
  version: number;
  created_at: string;
  updated_at: string;
  images_admin: MomentImageInput[];
}

/** 上传响应（T01 的 `MediaAdminOut`，这里只用到这几项）。 */
export interface MediaAdminUpload {
  id: string;
  mime_type: string;
  bytes: number;
  width: number;
  height: number;
  status: string;
  variants: MediaVariant[];
  original_url: string;
}

export interface MomentListPayload {
  items: Moment[];
  next_cursor: string | null;
}

export interface MomentAdminListPayload {
  items: MomentAdmin[];
  next_cursor: string | null;
}

/**
 * 站内相对地址校验。
 *
 * 动态 ID 必须是 UUID（03 §3 / 08 §2）：`/apps/ins/<uuid>` 是详情，
 * `/apps/ins/messages` 之类的**静态**路由要留给 T08，不能被动态段吞掉。
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 是否是合法的动态 UUID。
 *
 * 返回**类型谓词**而不是 `boolean`：调用处 `if (!isMomentId(item)) return` 之后
 * TypeScript 才能把 `item: string | null` 收窄成 `string`（`noUncheckedIndexedAccess`
 * 之类的严格设置下，这一点直接决定详情视图能不能拿到非空 id）。
 */
export function isMomentId(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** 码点计数（05 §2：文本长度按 Unicode 码点，不用 `length` 的 UTF-16 语义）。 */
export function codepointLength(value: string): number {
  return Array.from(value).length;
}

/** 标签清洗：去首尾空白 → 丢空 → 去重（保留首次出现顺序）。与后端同一套规则。 */
export function cleanTags(input: readonly string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of input) {
    const name = (raw ?? "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    cleaned.push(name);
  }
  return cleaned;
}

/** 管理表单里标签输入框的说明（与后端规则一致）。 */
export const TAG_INPUT_HINT = `标签：空白 / 逗号 / 顿号分隔，最多 ${TAGS_MAX} 个，单个 1–${TAG_MAX_CODEPOINTS} 字`;

export interface ValidationIssue {
  field: string;
  message: string;
}

/**
 * 本地预校验（服务端仍然是最终权威）。
 *
 * 目的只是**避免一次注定失败的往返**与给出更快的字段级提示；
 * 服务端会用同一套规则再校验一次，测试覆盖两侧，因此本地规则放宽或收紧
 * 都不会变成「前端说没问题、服务端拒绝」的静默不一致 —— 页面上会显示后端的字段错误。
 */
export function validateDraftForPublish(moment: {
  text: string;
  images: readonly MomentImageInput[];
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (moment.images.length < IMAGES_MIN) {
    issues.push({ field: "images", message: `发布前至少需要 ${IMAGES_MIN} 张图片` });
  }
  if (moment.images.length > IMAGES_MAX) {
    issues.push({ field: "images", message: `最多 ${IMAGES_MAX} 张图片` });
  }
  const positions = moment.images.map((image) => image.position).sort((a, b) => a - b);
  if (positions.some((position, index) => position !== index)) {
    issues.push({ field: "images", message: "图片顺序必须从 0 开始且连续" });
  }
  for (const image of moment.images) {
    const length = codepointLength(image.alt.trim());
    if (length < ALT_MIN_CODEPOINTS) {
      issues.push({ field: "images", message: "每张图片都需要替代文本" });
      break;
    }
    if (length > ALT_MAX_CODEPOINTS) {
      issues.push({ field: "images", message: `替代文本最多 ${ALT_MAX_CODEPOINTS} 个字符` });
      break;
    }
  }
  if (codepointLength(moment.text) > TEXT_MAX_CODEPOINTS) {
    issues.push({ field: "text", message: `文字最多 ${TEXT_MAX_CODEPOINTS} 个字符` });
  }
  return issues;
}

export function validateTagInput(tags: readonly string[]): ValidationIssue[] {
  const cleaned = cleanTags(tags);
  const issues: ValidationIssue[] = [];
  if (cleaned.length > TAGS_MAX) {
    issues.push({ field: "tags", message: `最多 ${TAGS_MAX} 个标签` });
  }
  for (const tag of cleaned) {
    if (codepointLength(tag) > TAG_MAX_CODEPOINTS) {
      issues.push({ field: "tags", message: `单个标签最多 ${TAG_MAX_CODEPOINTS} 个字符` });
      break;
    }
  }
  return issues;
}

/** 列表用摘要：单条正文在卡片里截断，不在前端伪造「阅读更多」内容。 */
export function excerptOf(text: string, limit = 140): string {
  const points = Array.from(text.trim());
  if (points.length <= limit) return text.trim();
  return `${points.slice(0, limit).join("")}…`;
}

/**
 * 选择要展示的变体（与 `lib/api/posts.ts` 的 `coverUrl` 同一套优先级）。
 *
 * 缩略图优先小图：03 §4 要求「默认显示适配过的缩略图，用户主动进入预览才加载更大版本」，
 * 因此这里可以指定偏好顺序，**不在列表里加载原图**（原图对匿名本来就 404）。
 */
export function variantUrl(
  image: MomentImage,
  preference: readonly string[] = ["w640.webp", "w320.webp", "w1280.webp"],
): string | null {
  for (const name of preference) {
    const found = image.variants.find((variant) => variant.name === name);
    if (found) return found.url;
  }
  return image.variants[0]?.url ?? null;
}

/** 预览用的大图（用户主动打开预览时才请求）。 */
export function previewUrl(image: MomentImage): string | null {
  return variantUrl(image, ["w1280.webp", "w640.webp", "w320.webp"]);
}

/**
 * 按 `published_at DESC, id DESC` 合并下载到的分页结果并按 ID 去重。
 *
 * 03 §7：分页过程中已看过的项目由前端按 ID 去重；撤回与筛选变化都可能让
 * 相邻两页出现同一条，不能靠「服务端不会重复」的假设。
 */
export function mergeMoments(existing: readonly Moment[], incoming: readonly Moment[]): Moment[] {
  const seen = new Set<string>();
  const merged: Moment[] = [];
  for (const moment of [...existing, ...incoming]) {
    if (seen.has(moment.id)) continue;
    seen.add(moment.id);
    merged.push(moment);
  }
  return merged.sort((a, b) => {
    const left = a.published_at ?? "";
    const right = b.published_at ?? "";
    if (left === right) return b.id.localeCompare(a.id);
    return right.localeCompare(left);
  });
}

/** 展示时间：UTC ISO → 本地日期时间；无法解析时原样返回，不显示「Invalid Date」。 */
export function formatPublishedAt(value: string | null): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const pad = (input: number) => String(input).padStart(2, "0");
  return (
    `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ` +
    `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
  );
}

/** canonical 分享地址：分享出去的是不带手机参数的独立页（03 §4）。 */
export function canonicalMomentPath(momentId: string): string {
  return `/apps/ins/${momentId}`;
}

/** 标签筛选地址。切换标签必须**重置游标**（05 §6）。 */
export function feedPath(tag?: string | null): string {
  const clean = (tag ?? "").trim();
  return clean ? `/apps/ins?tag=${encodeURIComponent(clean)}` : "/apps/ins";
}
