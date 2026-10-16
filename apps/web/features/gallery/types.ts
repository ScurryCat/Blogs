/**
 * 相册 / 照片的数据类型（T06）。
 *
 * 与服务端 DTO **一一对应**（`apps/api/app/modules/gallery/schemas.py`）；字段名保持
 * snake_case，与全站约定一致（SHARED-CONTRACTS §5：字段 snake_case）。
 *
 * 三条硬规则在这里就写清楚，避免实现时漂移：
 *
 *  1. `variants` 里**永远没有** `original`（05 §8：原图只给站主）。前端不该出现
 *     一个「原图」按钮 —— 那个请求对匿名一定是 404。
 *  2. `taken_on` 是 `string | null`（07 §5「拍摄时间可选」）：`null` 就是**没有**
 *     拍摄时间，界面显示「未填写日期」，**不要**回落到上传时间去假装它拍过。
 *  3. 照片的展示尺寸用 `width` / `height`（媒体行的真实像素），因此图格可以按**自然
 *     比例**排布，而不必等图片加载完再猜一个裁切比例（验收「自然比例图格」）。
 */

/** 可用变体名（T01 的 `ALLOWED_VARIANT_NAMES`；公开侧不含 original）。 */
export type MediaVariantName = "w320.webp" | "w640.webp" | "w1280.webp" | string;

export interface MediaVariant {
  name: MediaVariantName;
  width: number;
  height: number;
  bytes: number;
  /** 本站相对地址（`/api/v1/media/<id>/<variant>`），不是绝对路径。 */
  url: string;
}

/** 相册类型（07 §5：摄影优先展示，游戏截图独立相册）。 */
export type AlbumKind = "photo" | "screenshot" | "other";

export interface AlbumKindOption {
  value: AlbumKind;
  label: string;
}

/** 与后端 `KIND_LABELS` 一致；界面上的筛选按钮用这份清单。 */
export const ALBUM_KINDS: readonly AlbumKindOption[] = Object.freeze([
  { value: "photo", label: "摄影" },
  { value: "screenshot", label: "游戏截图" },
  { value: "other", label: "其它" },
]);

export const DEFAULT_ALBUM_KIND: AlbumKind = "photo";

export function albumKindLabel(kind: string): string {
  return ALBUM_KINDS.find((item) => item.value === kind)?.label ?? "";
}

export function isAlbumKind(value: string | null | undefined): value is AlbumKind {
  return !!value && ALBUM_KINDS.some((item) => item.value === value);
}

/** 一张照片（公开形态）。 */
export interface Photo {
  media_id: string;
  position: number;
  alt: string;
  caption: string;
  taken_on: string | null;
  width: number;
  height: number;
  variants: MediaVariant[];
}

/** 照片墙上的一项：照片 + 它属于哪个相册（前端据此渲染分组标题）。 */
export interface WallAlbum {
  id: string;
  slug: string;
  title: string;
  kind: string;
  kind_label: string;
  position: number;
}

export interface WallPhoto {
  photo: Photo;
  album: WallAlbum;
}

export interface AlbumSummary {
  id: string;
  slug: string;
  title: string;
  description: string;
  kind: string;
  kind_label: string;
  photo_count: number;
  published_at: string;
  cover: Photo | null;
}

export interface AlbumDetail extends AlbumSummary {
  photos: Photo[];
}

export interface PhotoPage {
  items: WallPhoto[];
  next_cursor: string | null;
  /** 当前筛选下的实时总张数（不作为权限条件）。 */
  total: number;
}

export interface AlbumPage {
  items: AlbumSummary[];
  next_cursor: string | null;
}

/** 管理形态的照片：额外带媒体状态，用于「这张还不能发布」的提示。 */
export interface AdminPhoto extends Photo {
  media_status: string;
  media_deleted: boolean;
  album_id: string | null;
  album_slug: string | null;
  album_title: string | null;
}

export interface AdminAlbum {
  id: string;
  slug: string;
  title: string;
  description: string;
  kind: string;
  kind_label: string;
  position: number;
  status: "draft" | "published";
  published_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
  photo_count: number;
  photos: AdminPhoto[];
}

export interface AdminPhotoInput {
  media_id: string;
  position: number;
  alt: string;
  caption: string;
  taken_on: string | null;
}

/** 照片墙的两个 scope（与后端的取值一致）。 */
export type WallScope = "global" | "album";

export const WALL_PAGE_SIZE = 24;
export const ALBUM_PAGE_SIZE = 12;
export const ADMIN_PAGE_SIZE = 20;

/**
 * 一张照片的展示地址：优先 `w1280.webp`（灯箱），回落 `w640.webp` / `w320.webp`。
 *
 * 为什么不用「有没有某个变体」来决定展示：变体是服务端按原图尺寸生成的（不放大小图），
 * 一张 400px 宽的截图只有 w320，界面必须能降级而不是显示一个坏图。
 */
export function variantUrl(photo: Photo, preferred: readonly MediaVariantName[]): string | null {
  for (const name of preferred) {
    const found = photo.variants.find((variant) => variant.name === name);
    if (found) return found.url;
  }
  return photo.variants[0]?.url ?? null;
}

/** 图格用的缩略图（自然比例）。 */
export function thumbnailUrl(photo: Photo): string | null {
  return variantUrl(photo, ["w640.webp", "w320.webp", "w1280.webp"]);
}

/** 灯箱用的大图。 */
export function lightboxUrl(photo: Photo): string | null {
  return variantUrl(photo, ["w1280.webp", "w640.webp", "w320.webp"]);
}

/** 自然比例：`width / height`，两者都不合法时回落到 1（正方形），不产生 NaN 布局。 */
export function aspectRatio(photo: Pick<Photo, "width" | "height">): number {
  if (!photo.width || !photo.height) return 1;
  const ratio = photo.width / photo.height;
  if (!Number.isFinite(ratio) || ratio <= 0) return 1;
  return ratio;
}

/** `taken_on` 的展示文案；`null` 明确写成「未填写日期」而不是猜一个（07 §5）。 */
export function formatTakenOn(value: string | null | undefined): string {
  if (!value) return "未填写日期";
  return value.slice(0, 10);
}

/** 拍摄时间的 `datetime` 属性（`<time dateTime>` 用）；没有日期时给空字符串。 */
export function takenOnDateTime(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  return value.slice(0, 10);
}

/** 照片的 `alt`：后端保证非空，这里再兜一层，避免出现无 alt 的 `<img>`。 */
export function photoAlt(photo: Photo): string {
  const text = (photo.alt ?? "").trim();
  return text || photo.caption.trim() || "照片（未填写替代文本）";
}
