/**
 * 异世界导航：前端类型（与 `contracts/openapi.json` 的 nav 端点一致）。
 *
 * 字段名沿用 API 的 snake_case（05 §2：前端生成类型也遵守，不手写另一套字段映射）。
 * 这里**只声明公开与管理两类 DTO 的形状**；权限与公开条件由服务端负责，
 * 前端不会因为「本地过滤」而多拿到草稿。
 */

/** 认知定位的三个字段（04 §4B 的界面名称与数据字段）。 */
export type PalaceField = "name" | "location" | "cognition";

/** 每个字段的界面名称与帮助说明（把三字段并排压进小屏不可取，因此纵向排列）。 */
export interface FieldGuide {
  field: PalaceField;
  label: string;
  hint: string;
  placeholder: string;
}

export const PALACE_FIELDS: readonly PalaceField[] = ["name", "location", "cognition"];

/** 字段的中文界面名称。管理端与阅读页共用一份，避免三处各写一遍。 */
export const FIELD_LABELS: Record<PalaceField, string> = {
  name: "目标名",
  location: "现实地点",
  cognition: "认知形态",
};

export const FIELD_GUIDES: readonly FieldGuide[] = [
  {
    field: "name",
    label: "目标名",
    hint: "专题的署名或代号 —— 不是现实里的攻击目标。",
    placeholder: "例如 ScurryCat / PHANTOM",
  },
  {
    field: "location",
    label: "现实地点",
    hint: "内容的来源场景，例如个人博客、竞赛训练场。",
    placeholder: "例如 个人博客",
  },
  {
    field: "cognition",
    label: "认知形态",
    hint: "站主为这个主题设计的意象，例如据点、迷宫、工房。",
    placeholder: "例如 据点",
  },
];

export interface PalaceKeywords {
  name: string;
  location: string;
  cognition: string;
}

export interface MediaVariant {
  name: string;
  width: number;
  height: number;
  bytes: number;
  url: string;
}

export interface TagSummary {
  id: string;
  slug: string;
  name: string;
}

/** 公开文章摘要（与 posts 模块的 `PostSummaryOut` 同形）。 */
export interface PostSummary {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  display_date: string | null;
  published_at: string;
  tags: TagSummary[];
  cover: { id: string; width: number; height: number; variants: MediaVariant[] } | null;
}

/** 公开专题摘要。`post_count` 是服务端实时统计的公开文章数。 */
export interface PalaceSummary {
  id: string;
  slug: string;
  title: string;
  summary: string;
  keywords: PalaceKeywords;
  post_count: number;
  published_at: string;
}

export interface PalaceDetail extends PalaceSummary {
  posts: PostSummary[];
}

export type ResolveStatus = "found" | "ambiguous" | "not_found";

/** 认知定位的三种业务结果；服务故障不是其中之一（04 §4B）。 */
export interface ResolveResult {
  status: ResolveStatus;
  matches: PalaceSummary[];
}

export type SearchKind = "post" | "palace";

export interface SearchItem {
  kind: SearchKind;
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  /** 服务端生成的本站地址，不返回任意第三方重定向。 */
  href: string;
}

export interface KeywordInput {
  name: string;
  location: string;
  cognition: string;
}

// --- 管理 DTO（只在 /admin/palaces 使用） -----------------------------------

export interface PalaceAlias {
  field: PalaceField;
  value: string;
}

export interface PalaceAliasOut extends PalaceAlias {
  normalized_value: string;
}

export interface PalacePostAdmin {
  post_id: string;
  slug: string;
  title: string;
  status: "draft" | "published";
  position: number;
  deleted: boolean;
  /** 当前是否公开可见（预览用，由服务端按公开条件判定）。 */
  public: boolean;
}

export interface PalaceConflict {
  field: PalaceField;
  value: string;
  normalized_value: string;
  palaces: { id: string; slug: string; title: string; status: string }[];
}

export interface PalaceAdmin {
  id: string;
  slug: string;
  title: string;
  summary: string;
  keywords: PalaceKeywords;
  status: "draft" | "published";
  published_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  version: number;
  aliases: PalaceAliasOut[];
  posts: PalacePostAdmin[];
  conflicts: PalaceConflict[];
  public_post_count: number;
}

export interface PalaceWriteInput {
  slug?: string;
  title: string;
  summary: string;
  keywords: PalaceKeywords;
  aliases: PalaceAlias[];
  post_ids: string[];
}

export type PalacePatch = Partial<Omit<PalaceWriteInput, "slug">>;
