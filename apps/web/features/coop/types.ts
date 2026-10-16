/**
 * COOP 友链的公开类型。
 *
 * 字段名沿用 API 的 snake_case（05 §2），避免两套映射。
 * 这里**没有** rank / 访问次数 / 在线状态 / 最新动态之类字段 —— 本站不存这些数据
 * （07 §4：不根据点击量生成好感度或 RANK，不伪造朋友的最新动态与在线状态）。
 */

/** 与 T01 的 `media.schemas.MediaPublicOut` 同形：只有尺寸与变体 URL，没有原图。 */
export interface CoopAvatarVariant {
  name: string;
  width: number;
  height: number;
  bytes: number;
  url: string;
}

export interface CoopAvatar {
  id: string;
  width: number;
  height: number;
  variants: CoopAvatarVariant[];
}

/** 公开列表项：没有 `story` 正文，只有「有没有故事」。 */
export interface FriendLinkSummary {
  id: string;
  name: string;
  url: string;
  summary: string;
  arcana: string | null;
  tags: string[];
  avatar: CoopAvatar | null;
  has_story: boolean;
}

/** 公开详情：比列表只多一个 `story`。 */
export interface FriendLinkDetail extends FriendLinkSummary {
  story: string | null;
}

/** 标签（筛选器用）。没有计数：友链不做排名统计。 */
export interface FriendTag {
  name: string;
  normalized: string;
}

export type FriendStatus = "draft" | "published";

/** 管理形态：多出状态、版本、软删除时间与头像媒体 id。 */
export interface FriendLinkAdmin {
  id: string;
  name: string;
  url: string;
  summary: string;
  story: string | null;
  arcana: string | null;
  avatar_media_id: string | null;
  avatar: CoopAvatar | null;
  tags: FriendTag[];
  position: number;
  status: FriendStatus;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  version: number;
}

export interface FriendLinkCreateInput {
  name: string;
  url: string;
  summary?: string;
  story?: string | null;
  arcana?: string | null;
  tags?: string[];
  avatar_media_id?: string | null;
  position?: number;
}

/** PATCH：只提交出现的字段；`tags` 传入即完整替换。 */
export interface FriendLinkPatchInput {
  name?: string;
  url?: string;
  summary?: string;
  story?: string | null;
  arcana?: string | null;
  tags?: string[];
  avatar_media_id?: string | null;
  position?: number;
}

/** 编辑表单的本地草稿（全部是字符串，提交时再转换）。 */
export interface FriendDraft {
  name: string;
  url: string;
  summary: string;
  story: string;
  arcana: string;
  tags: string;
  position: string;
  avatarMediaId: string;
}
