/**
 * 共享图片选择器的类型与纯函数（P5 第一批 · C3）。
 *
 * 契约来源：`docs/agent-deliveries/P5-C0-integration-contract.md` §4.3 / §9.5
 * 与设计书 `docs/handoff/2026-10-18-p5-creator-workspace-design.md` §3.4。
 *
 * 边界：
 *  - 这里管理的是**站主内容媒体**（`POST/GET /api/v1/admin/media`），
 *    不是 P5 参考素材库，两者不合并（设计书 §3.4）；
 *  - 复用已有图片时引用同一个 media ID，不重复上传；
 *  - 本模块没有 React、没有 fetch，纯函数可以单独测试。
 *
 * 与 `features/workspace/types.ts` 的 `PickedImage` 结构兼容（字段名相同），
 * 但**不 import workspace**：选择器是 C4 也要用的独立共享模块，
 * 不让它反向依赖创作台基础层。
 */

import type { components } from "@/lib/api/generated/schema";

/** 管理侧媒体 DTO（由 openapi 生成，字段以契约为准；不手写第二份）。 */
export type MediaAdminOut = components["schemas"]["MediaAdminOut"];

/**
 * 媒体列表项：契约 §3.4 规定「列表项 = MediaAdminOut + publicly_referenced」。
 *
 * `publicly_referenced` 声明为可选：生成类型是否把它并进 `MediaAdminOut`
 * 取决于 C1 的实现方式（扩展 schema 或新 schema），两种都能读；
 * **不能把「字段缺失」当成「没有其他公开引用」** —— 展示时按 false 处理，
 * 但这只是提示，不构成权限判断。
 */
export interface MediaPickerMedia extends MediaAdminOut {
  publicly_referenced?: boolean;
}

/** 编辑器持有的已选图片（契约 §4.2；选择器的 `selected` 入参就是这个形状）。 */
export interface PickedImage {
  media_id: string;
  alt: string;
  /** 顺序 = 数组顺序；回写时可选（编辑器可以自己按数组下标派生）。 */
  position?: number;
  /** 已知的媒体详情；不在当前列表页时可能缺失，由选择器按 ID 补取详情。 */
  media?: MediaAdminOut;
}

/** 选择器确认时给出的条目：媒体详情已知，避免调用方再补取一次。 */
export interface MediaPickerItem extends PickedImage {
  media: MediaAdminOut;
}

/** 默认最多 9 张（与 INS 正式发布的 1–9 张一致）。 */
export const MEDIA_PICKER_DEFAULT_MAX = 9;
/** 媒体库每页条数（后端 cursor 分页，上限由接口决定；这里取一个适合缩略图网格的值）。 */
export const MEDIA_PICKER_PAGE_SIZE = 24;
/** 替代文本上限（码点），与 INS 正式规则一致；草稿期允许为空。 */
export const MEDIA_ALT_MAX_CODEPOINTS = 200;
/** 单张上传上限：8 MiB（沿用现有媒体服务限制）。 */
export const MEDIA_UPLOAD_MAX_BYTES = 8 * 1024 * 1024;
/** `<input type="file">` 的 accept：只接受 JPEG / PNG / WebP（与现有上传一致）。 */
export const MEDIA_UPLOAD_ACCEPT = "image/jpeg,image/png,image/webp";
/** 允许的 MIME（大小写不敏感比较）。 */
export const MEDIA_UPLOAD_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** 公开引用提示（契约 §4.3 指定文案，选择器内部统一呈现）。 */
export const PUBLIC_REFERENCE_WARNING =
  "该图片已在其他位置公开：用于私密手记不会撤回其他公开引用";
/** 很短的徽标文案：只用在网格缩略图上，完整说明在下面一行。 */
export const PUBLIC_REFERENCE_BADGE = "已在其他位置公开";
/** HEIC / HEIF：明确提示，不承诺自动转换（设计书 §2.3）。 */
export const HEIC_UNSUPPORTED_MESSAGE =
  "暂不支持 HEIC / HEIF 格式，也不会自动转换：请先导出为 JPEG、PNG 或 WebP 再上传。";
/** 其他不支持格式。 */
export const UNSUPPORTED_FORMAT_MESSAGE = "只支持 JPEG、PNG、WebP 图片，这个文件没有上传。";
/** 超过单张大小上限。 */
export const TOO_LARGE_MESSAGE = "单张图片上限 8 MiB，这个文件没有上传。";
/** 替代文本输入框下方的说明。 */
export const MEDIA_PICKER_ALT_HINT =
  "替代文本 1–200 字，发布动态时每张图都必须填写；草稿期可以先空着。";
/** 选择器里“还未上传成功”的本地预览状态说明。 */
export const LOCAL_PREVIEW_NOTE = "本地预览 · 尚未上传";

/** 管理侧媒体接口路径（浏览器同源相对地址；`apiRequest` 会补 `/api/v1` 前缀）。 */
export const ADMIN_MEDIA_PATH = "/api/v1/admin/media";

/** 缩略图变体优先级：网格用小图，大图位也优先自适应变体，不默认加载原图。 */
const THUMB_PREFERENCE = ["w320.webp", "w640.webp", "w1280.webp"] as const;
const LARGE_PREFERENCE = ["w640.webp", "w1280.webp", "w320.webp"] as const;

/** 码点长度（中文/emoji 都按 Unicode 码点计数，不用 UTF-16 `length`）。 */
export function codepointLength(value: string): number {
  return Array.from(value).length;
}

/** 服务端是否确认这张图已处理完成、可以进入草稿。 */
export function isMediaReady(media: Pick<MediaAdminOut, "status">): boolean {
  return media.status === "ready";
}

/** 是否被其他公开内容引用（只做提示，最终是否允许公开由服务端判断）。 */
export function isPubliclyReferenced(media: MediaAdminOut | null | undefined): boolean {
  return (media as MediaPickerMedia | null | undefined)?.publicly_referenced === true;
}

/** 媒体变体 URL：按偏好顺序取第一个存在的；一个都没有时返回 null（不猜原图地址）。 */
export function mediaVariantUrl(
  media: Pick<MediaAdminOut, "variants">,
  preference: readonly string[] = THUMB_PREFERENCE,
): string | null {
  for (const name of preference) {
    const found = media.variants.find((variant) => variant.name === name);
    if (found) return found.url;
  }
  return media.variants[0]?.url ?? null;
}

/** 尺寸文案：`800×600`。 */
export function mediaSizeLabel(media: Pick<MediaAdminOut, "width" | "height">): string {
  return `${media.width}×${media.height}`;
}

/** 上传状态文案（选择器与缩略图统一用这一套，不各写一句）。 */
export function mediaStatusLabel(media: Pick<MediaAdminOut, "status">): string {
  switch (media.status) {
    case "ready":
      return "已上传（ready）";
    case "pending":
    case "processing":
      return "处理中，暂不能加入草稿";
    case "failed":
      return "处理失败，请重新上传";
    default:
      return `状态：${media.status}`;
  }
}

/** 媒体列表项的一句话元信息：尺寸 + 状态（选择器与测试共用的稳定格式）。 */
export function mediaMetaLabel(media: MediaAdminOut): string {
  return `${mediaSizeLabel(media)} · ${mediaStatusLabel(media)}`;
}

/** 替代文本是否满足**正式发布**要求（1–200 码点，去首尾空白后）。 */
export function isAltValid(alt: string): boolean {
  const length = codepointLength(alt.trim());
  return length >= 1 && length <= MEDIA_ALT_MAX_CODEPOINTS;
}

/** 文件名/类型是否是 HEIC / HEIF（浏览器对这两种类型的 MIME 不一致，按扩展名兜底）。 */
export function isHeicFile(file: Pick<File, "name" | "type">): boolean {
  const type = (file.type ?? "").toLowerCase();
  if (type === "image/heic" || type === "image/heif" || type === "image/heic-sequence") return true;
  const name = (file.name ?? "").toLowerCase();
  return name.endsWith(".heic") || name.endsWith(".heif");
}

/**
 * 上传前的本地预检：返回 null 表示可以交给服务端；返回字符串表示**不要上传**并展示原因。
 *
 * 注意：这里只做「明显不支持」的提前提示，服务端仍是权威（413/415/422 会带真实原因）。
 */
export function validateImageFile(file: Pick<File, "name" | "type" | "size">): string | null {
  if (isHeicFile(file as Pick<File, "name" | "type">)) return HEIC_UNSUPPORTED_MESSAGE;
  const type = (file.type ?? "").toLowerCase();
  const name = (file.name ?? "").toLowerCase();
  if (!type) {
    // 有些浏览器 / 文件管理器不给 MIME：扩展名可信时放行，让服务端做最终判断。
    if (/\.(jpe?g|png|webp)$/.test(name)) {
      return file.size > MEDIA_UPLOAD_MAX_BYTES ? TOO_LARGE_MESSAGE : null;
    }
    return UNSUPPORTED_FORMAT_MESSAGE;
  }
  if (!(MEDIA_UPLOAD_MIME_TYPES as readonly string[]).includes(type)) {
    return UNSUPPORTED_FORMAT_MESSAGE;
  }
  if (file.size > MEDIA_UPLOAD_MAX_BYTES) return TOO_LARGE_MESSAGE;
  return null;
}

/**
 * 合并两页媒体列表：按 ID 去重、保留先出现的顺序。
 *
 * 分页过程中后端可能因为新上传/删除让相邻两页重复同一条，不能假设「不会重复」。
 */
export function mergeMediaPages(
  existing: readonly MediaPickerMedia[],
  incoming: readonly MediaPickerMedia[],
): MediaPickerMedia[] {
  const seen = new Set<string>();
  const merged: MediaPickerMedia[] = [];
  for (const media of [...existing, ...incoming]) {
    if (seen.has(media.id)) continue;
    seen.add(media.id);
    merged.push(media);
  }
  return merged;
}

/**
 * 把任意已选数组归一成选择器内部状态：去空白、按 ID 去重（保留首次顺序）、截断到 max。
 *
 * 不丢弃「媒体详情未知」的条目：它可能只是不在当前列表页，由选择器按 ID 补取详情
 * （契约 §6 A11：选中的对象不因不在当前页就被误判为失效）。
 */
export function normalizePickedImages(
  selected: readonly PickedImage[],
  max: number = MEDIA_PICKER_DEFAULT_MAX,
): PickedImage[] {
  const seen = new Set<string>();
  const picked: PickedImage[] = [];
  for (const item of selected) {
    const mediaId = (item?.media_id ?? "").trim();
    if (!mediaId || seen.has(mediaId)) continue;
    seen.add(mediaId);
    picked.push({
      media_id: mediaId,
      alt: item?.alt ?? "",
      ...(item?.media ? { media: item.media } : {}),
    });
    if (picked.length >= max) break;
  }
  return picked;
}

/** 已选图片 → 展示用条目（`position` 按下标派生；调用方保存时用数组顺序即可）。 */
export function toPickedImages(
  items: readonly { media_id: string; alt: string; media?: MediaAdminOut }[],
): PickedImage[] {
  return items.map((item, index) => ({
    media_id: item.media_id,
    alt: item.alt.trim(),
    position: index,
    ...(item.media ? { media: item.media } : {}),
  }));
}
