/**
 * INS 独立编辑页的纯数据逻辑（P5 第一批 · C3）。
 *
 * 放在单独文件里（没有 React、没有 fetch）是为了让「草稿 data 的读写」「发布前阻塞原因」
 * 可以被单独测试，组件只负责把它们渲染出来、在事件里调用它们。
 *
 * 契约：
 *  - 工作草稿 `moment` 的 data = `{text, tags, album_links}`（集成契约 §3.3）；
 *  - 发布门槛复用既有 `validateDraftForPublish` + `validateAlbumLinks` + `validateTagInput`
 *    （features/ins/types.ts），本地提示不代替服务端校验。
 */

import {
  cleanAlbumLinks,
  cleanTags,
  codepointLength,
  validateAlbumLinks,
  validateDraftForPublish,
  validateTagInput,
  type MomentAlbumLink,
  type MomentImageInput,
  type ValidationIssue,
} from "../types";
import type { PickedImage } from "@/features/media-picker";

/** 标签输入框的分隔规则（与旧工作台一致：空白/逗号/顿号）。 */
const TAG_SEPARATORS = /[\s,，、]+/;
/** 单个标签最多码点（与正式规则一致；草稿期先过滤掉超长标签，避免一次自动保存整体 422）。 */
const TAG_MAX_CODEPOINTS = 24;
const TAGS_MAX = 8;

/** 工作草稿里 moment 的 data（契约 §3.3）。 */
export interface MomentDraftData {
  text: string;
  tags: string[];
  album_links: MomentAlbumLink[];
}

export const EMPTY_MOMENT_DRAFT_DATA: MomentDraftData = {
  text: "",
  tags: [],
  album_links: [],
};

/** 标签输入框的原始字符串 → 清洗后的标签（去空白、去重、保留首次顺序）。 */
export function splitTagInput(input: string): string[] {
  return cleanTags(input.split(TAG_SEPARATORS));
}

/**
 * 用于**自动保存**的标签：在清洗基础上丢掉超长标签 / 超过数量的部分。
 *
 * 为什么不在数据里保留它们：草稿服务的 data 校验与正式内容同规则（单标签 ≤24 码点），
 * 一个还没改完的长标签会让整次自动保存 422，连正文都存不进去。
 * 界面保留原始输入并单独提示；修好后下一次保存自然带上。
 */
export function tagsForDraft(input: string): string[] {
  return splitTagInput(input)
    .filter((tag) => codepointLength(tag) <= TAG_MAX_CODEPOINTS)
    .slice(0, TAGS_MAX);
}

/** 把服务端草稿 data 读成编辑器状态：未知/坏形状一律降级为空，不抛错。 */
export function readMomentDraftData(
  value: Record<string, unknown> | null | undefined,
): MomentDraftData {
  const text = typeof value?.text === "string" ? value.text : "";
  const rawTags = Array.isArray(value?.tags)
    ? value.tags.filter((tag): tag is string => typeof tag === "string")
    : [];
  const album_links: MomentAlbumLink[] = [];
  const seenAlbums = new Set<string>();
  if (Array.isArray(value?.album_links)) {
    for (const raw of value.album_links) {
      if (!raw || typeof raw !== "object") continue;
      const record = raw as Record<string, unknown>;
      const albumId = typeof record.album_id === "string" ? record.album_id.trim() : "";
      if (!albumId || seenAlbums.has(albumId)) continue;
      seenAlbums.add(albumId);
      const mediaIds = Array.isArray(record.media_ids)
        ? record.media_ids.filter(
            (mediaId): mediaId is string => typeof mediaId === "string" && mediaId.trim().length > 0,
          )
        : [];
      // 保留「已添加相册但还没勾图片」的空条目：否则重新打开编辑器时选择会凭空消失。
      album_links.push({ album_id: albumId, media_ids: mediaIds });
    }
  }
  return { text, tags: cleanTags(rawTags), album_links };
}

/** 编辑器状态 → 草稿 data（album_links 保留空条目，交给服务端宽松校验）。 */
export function toMomentDraftData(input: {
  text: string;
  tagsInput: string;
  albumLinks: readonly MomentAlbumLink[];
}): MomentDraftData {
  return {
    text: input.text,
    tags: tagsForDraft(input.tagsInput),
    album_links: input.albumLinks.map((link) => ({
      album_id: link.album_id,
      media_ids: [...link.media_ids],
    })),
  };
}

/** 编辑器里的已选图片 → 正式接口的图片输入（position = 数组下标）。 */
export function pickedToMomentImages(images: readonly PickedImage[]): MomentImageInput[] {
  return images.map((image, index) => ({
    media_id: image.media_id,
    position: index,
    alt: image.alt.trim(),
  }));
}

/**
 * 发布前的**全部**阻塞原因（集中列出，不在发布时才发现第一条）。
 *
 * 与旧工作台同一套规则；这里只做本地预检，服务端 422 仍会照实显示。
 */
export function collectPublishBlockers(input: {
  text: string;
  tagsInput: string;
  images: readonly PickedImage[];
  albumLinks: readonly MomentAlbumLink[];
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const imageInputs = pickedToMomentImages(input.images);
  issues.push(...validateDraftForPublish({ text: input.text, images: imageInputs }));
  issues.push(...validateTagInput(splitTagInput(input.tagsInput)));
  issues.push(
    ...validateAlbumLinks(
      cleanAlbumLinksForSubmit(input.albumLinks),
      imageInputs.map((image) => image.media_id),
    ),
  );
  return issues;
}

/**
 * 提交用的收录选择：丢掉没有勾任何图片的相册条目。
 *
 * 与草稿 data 不同：提交时一个「勾了 0 张」的相册不产生任何收录来源，只让服务端多做一次校验。
 */
export function cleanAlbumLinksForSubmit(
  links: readonly MomentAlbumLink[],
): MomentAlbumLink[] {
  // 复用既有 `cleanAlbumLinks`（trim / 去重 / 丢空条目 / 截断上限），不在这里发明第二套规则。
  return cleanAlbumLinks(links);
}

/** 阻塞原因 → 一行可读文案（按钮点击时的提示 / 错误框）。 */
export function formatBlockers(issues: readonly ValidationIssue[]): string {
  return issues.map((issue) => issue.message).join("；");
}

/** 提交动作的固定文案（保存 / 发布 / 更新已公开内容，三者语义不同，不混用词）。 */
export function submitLabel(action: "save" | "publish" | "update"): string {
  switch (action) {
    case "save":
      return "保存草稿";
    case "publish":
      return "发布动态";
    default:
      return "更新正式内容";
  }
}

/** 提交成功后的动作说明（成功页展示，如实说明公开状态）。 */
export function commitSuccessHint(result: {
  action: "save" | "publish" | "update";
  status: "draft" | "published";
}): string {
  if (result.action === "save") {
    return "已保存为正式草稿：公开页面还看不到它，确认后再点发布。";
  }
  if (result.action === "publish") {
    return "已发布：公开页面现在可以看到这条动态。";
  }
  return "已更新正式内容：公开页面现在显示的是这次提交的版本。";
}
