/**
 * INS 独立编辑页的纯数据逻辑（P5 第一批 · C3）。
 *
 * 覆盖：草稿 data 的读写（含「已添加相册但没勾图」的保留）、标签清洗与超长标签过滤、
 * 发布前的集中阻塞原因、提交用收录选择清洗、成功文案。
 */

import { describe, expect, it } from "vitest";

import type { PickedImage } from "@/features/media-picker";

import {
  cleanAlbumLinksForSubmit,
  collectPublishBlockers,
  commitSuccessHint,
  formatBlockers,
  pickedToMomentImages,
  readMomentDraftData,
  splitTagInput,
  submitLabel,
  tagsForDraft,
  toMomentDraftData,
} from "./draft-data";

const MEDIA_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MEDIA_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ALBUM_A = "33333333-3333-4333-8333-333333333333";
const ALBUM_B = "44444444-4444-4444-8444-444444444444";

function image(mediaId: string, alt: string): PickedImage {
  return { media_id: mediaId, alt };
}

describe("标签输入", () => {
  it("按空白/逗号/顿号拆分并去重", () => {
    expect(splitTagInput("校园，操场 校园、日常")).toEqual(["校园", "操场", "日常"]);
  });

  it("自动保存前过滤超长标签与超过 8 个的部分（避免一次 422 连正文都存不进去）", () => {
    expect(tagsForDraft("字".repeat(25) + " 正常")).toEqual(["正常"]);
    expect(tagsForDraft(Array.from({ length: 10 }, (_, i) => `t${i}`).join(" "))).toHaveLength(8);
  });
});

describe("草稿 data 读写", () => {
  it("读：坏形状降级为空，不抛错", () => {
    expect(readMomentDraftData(null)).toEqual({ text: "", tags: [], album_links: [] });
    expect(readMomentDraftData({ text: 1, tags: "x", album_links: {} })).toEqual({
      text: "",
      tags: [],
      album_links: [],
    });
  });

  it("读：保留「已添加相册但还没勾图片」的条目（否则重开编辑器选择会凭空消失）", () => {
    const data = readMomentDraftData({
      text: "文字",
      tags: ["校园", " 操场 ", "校园"],
      album_links: [
        { album_id: ALBUM_A, media_ids: [MEDIA_A] },
        { album_id: ALBUM_A, media_ids: [MEDIA_B] },
        { album_id: ALBUM_B, media_ids: [] },
      ],
    });
    expect(data.tags).toEqual(["校园", "操场"]);
    expect(data.album_links).toEqual([
      { album_id: ALBUM_A, media_ids: [MEDIA_A] },
      { album_id: ALBUM_B, media_ids: [] },
    ]);
  });

  it("写：保留空相册条目，标签按自动保存规则过滤", () => {
    const data = toMomentDraftData({
      text: "正文",
      tagsInput: "字".repeat(30) + " 保留",
      albumLinks: [{ album_id: ALBUM_B, media_ids: [] }],
    });
    expect(data).toEqual({
      text: "正文",
      tags: ["保留"],
      album_links: [{ album_id: ALBUM_B, media_ids: [] }],
    });
  });
});

describe("图片输入", () => {
  it("position = 数组下标，alt 去首尾空白", () => {
    expect(pickedToMomentImages([image(MEDIA_A, "  操场  "), image(MEDIA_B, "")])).toEqual([
      { media_id: MEDIA_A, position: 0, alt: "操场" },
      { media_id: MEDIA_B, position: 1, alt: "" },
    ]);
  });
});

describe("发布前集中阻塞原因", () => {
  it("没有图片 + 缺替代文本 + 超长标签都会列出来（不只是第一条）", () => {
    const issues = collectPublishBlockers({
      text: "",
      tagsInput: "字".repeat(30),
      images: [],
      albumLinks: [],
    });
    const messages = issues.map((issue) => issue.message).join("；");
    expect(messages).toContain("发布前至少需要 1 张图片");
    expect(messages).toContain("单个标签最多 24 个字符");
  });

  it("有图片但缺替代文本 → 列出替代文本要求；补齐后只剩图片数量外的原因", () => {
    const missingAlt = collectPublishBlockers({
      text: "文字",
      tagsInput: "",
      images: [image(MEDIA_A, " ")],
      albumLinks: [],
    });
    expect(missingAlt.map((issue) => issue.message).join("；")).toContain("每张图片都需要替代文本");

    const ready = collectPublishBlockers({
      text: "文字",
      tagsInput: "",
      images: [image(MEDIA_A, "操场")],
      albumLinks: [],
    });
    expect(ready).toEqual([]);
  });

  it("收录选择里有不属于当前动态的图片 → 提前提示", () => {
    const issues = collectPublishBlockers({
      text: "",
      tagsInput: "",
      images: [image(MEDIA_A, "操场")],
      albumLinks: [{ album_id: ALBUM_A, media_ids: [MEDIA_B] }],
    });
    expect(issues.map((issue) => issue.message).join("；")).toContain("不属于本条动态");
  });
});

describe("提交用收录选择清洗", () => {
  it("丢掉没勾任何图片的相册、去重、保留首次顺序", () => {
    expect(
      cleanAlbumLinksForSubmit([
        { album_id: ALBUM_A, media_ids: [MEDIA_A, MEDIA_A] },
        { album_id: ALBUM_B, media_ids: [] },
        { album_id: ALBUM_A, media_ids: [MEDIA_B] },
      ]),
    ).toEqual([{ album_id: ALBUM_A, media_ids: [MEDIA_A] }]);
  });
});

describe("动作与成功文案", () => {
  it("三个动作的按钮文案互不混用", () => {
    expect(submitLabel("save")).toBe("保存草稿");
    expect(submitLabel("publish")).toBe("发布动态");
    expect(submitLabel("update")).toBe("更新正式内容");
  });

  it("成功提示如实说明公开状态", () => {
    expect(commitSuccessHint({ action: "save", status: "draft" })).toContain("公开页面还看不到");
    expect(commitSuccessHint({ action: "publish", status: "published" })).toContain("可以看到");
    expect(commitSuccessHint({ action: "update", status: "published" })).toContain("这次提交的版本");
  });

  it("阻塞原因格式化成一行", () => {
    expect(
      formatBlockers([
        { field: "images", message: "发布前至少需要 1 张图片" },
        { field: "tags", message: "最多 8 个标签" },
      ]),
    ).toBe("发布前至少需要 1 张图片；最多 8 个标签");
  });
});
