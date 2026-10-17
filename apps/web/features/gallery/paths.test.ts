/**
 * 相册的 URL 构造与工具（T06）。
 *
 * 断言的是**具体的 URL 字符串**：两端（浏览器 / 服务端）共用同一份构造，
 * 各写一份迟早漂移（一端带 `kind`、另一端忘了编码），所以这里把形状钉死。
 */

import { describe, expect, it } from "vitest";

import {
  adminAlbumListQuery,
  adminAlbumPath,
  adminAlbumPhotoPath,
  albumDetailPath,
  albumListQuery,
  galleryAlbumHref,
  galleryAlbumsHref,
  galleryHref,
  legacyPhotosRedirectPath,
  normalizeGalleryView,
  wallQuery,
  GALLERY_API,
  GALLERY_PATH,
  GALLERY_ROUTES,
  LEGACY_PHOTOS_PATH,
  projectHref,
} from "./paths";
import {
  albumKindLabel,
  aspectRatio,
  formatTakenOn,
  isAlbumKind,
  lightboxUrl,
  photoAlt,
  thumbnailUrl,
  variantUrl,
  type Photo,
} from "./types";

const photo: Photo = {
  media_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  position: 0,
  alt: "操场",
  caption: "",
  taken_on: null,
  width: 800,
  height: 600,
  variants: [
    { name: "w320.webp", width: 320, height: 240, bytes: 1, url: "/api/v1/media/a/w320.webp" },
    { name: "w640.webp", width: 640, height: 480, bytes: 2, url: "/api/v1/media/a/w640.webp" },
  ],
};

describe("相册查询串", () => {
  it("默认不写 scope（服务端默认就是 global）", () => {
    expect(wallQuery()).toBe(GALLERY_API.photos);
    expect(wallQuery({ limit: 24 })).toBe(`${GALLERY_API.photos}?limit=24`);
  });

  it("按相册浏览时同时写 scope 与 album", () => {
    expect(wallQuery({ scope: "album", album: "tokyo-2026" })).toBe(
      `${GALLERY_API.photos}?scope=album&album=tokyo-2026`,
    );
    // 只给 album + albumScope 也会得到 scope=album（页面链接就是这样构造的）。
    expect(wallQuery({ album: "tokyo-2026", albumScope: true })).toBe(
      `${GALLERY_API.photos}?scope=album&album=tokyo-2026`,
    );
    // 只给 album（按相册筛选）不写 scope：排序仍是全局的按拍摄时间。
    expect(wallQuery({ album: "tokyo-2026" })).toBe(
      `${GALLERY_API.photos}?album=tokyo-2026`,
    );
  });

  it("年份 / 月份 / 类型都进查询串", () => {
    const query = wallQuery({ kind: "photo", year: 2026, month: 10 });
    expect(query).toContain("kind=photo");
    expect(query).toContain("year=2026");
    expect(query).toContain("month=10");
  });

  it("游标原样带上（不透明，不做任何加工）", () => {
    expect(wallQuery({ cursor: "abc-DEF_123" })).toContain("cursor=abc-DEF_123");
  });

  it("相册列表查询串", () => {
    expect(albumListQuery()).toBe(GALLERY_API.albums);
    expect(albumListQuery({ kind: "screenshot", limit: 12 })).toBe(
      `${GALLERY_API.albums}?kind=screenshot&limit=12`,
    );
  });

  it("详情与管理路径", () => {
    expect(albumDetailPath("tokyo-2026")).toBe(`${GALLERY_API.albums}/tokyo-2026`);
    expect(adminAlbumListQuery({ status: "draft" })).toBe(`${GALLERY_API.adminAlbums}?status=draft`);
    expect(adminAlbumPath("id-1")).toBe(`${GALLERY_API.adminAlbums}/id-1`);
    expect(adminAlbumPhotoPath("id-1", "media-1")).toBe(
      `${GALLERY_API.adminAlbums}/id-1/photos/media-1`,
    );
  });

  it("页面地址（SiteLink 用）：图库的独立入口是 /gallery", () => {
    expect(galleryHref()).toBe(GALLERY_PATH);
    // 相册链接 = 相册浏览：显式带 scope=album（服务端据此用手工顺序）。
    expect(galleryHref({ album: "tokyo-2026" })).toBe(
      `${GALLERY_PATH}?scope=album&album=tokyo-2026`,
    );
    expect(galleryAlbumHref("tokyo-2026")).toBe(
      `${GALLERY_PATH}?scope=album&album=tokyo-2026`,
    );
    // 照片墙是默认视图，因此不带 view 参数；相册视图才显式带 view=albums。
    expect(galleryAlbumsHref()).toBe(`${GALLERY_PATH}?view=albums`);
    expect(projectHref("phantom-blog")).toBe("/showcase/projects/phantom-blog");
  });

  it("slug 会做 URL 编码（不接受任意路径注入）", () => {
    expect(albumDetailPath("a b/c")).toBe(`${GALLERY_API.albums}/a%20b%2Fc`);
    expect(projectHref("a/b")).toBe("/showcase/projects/a%2Fb");
  });
});

describe("路由映射（交给 T00 注入 INS 页签）", () => {
  it("页签 id 不占用内置的 feed / saved", () => {
    expect(GALLERY_ROUTES.insTabId).not.toBe("feed");
    expect(GALLERY_ROUTES.insTabId).not.toBe("saved");
  });

  it("页签顺序从 30 起（内置是 10 / 20）", () => {
    expect(GALLERY_ROUTES.insTabOrder).toBeGreaterThanOrEqual(30);
  });

  it("canonical 路由：殿堂只留作品，图库独立成 /gallery（第三轮 §4.1）", () => {
    expect(GALLERY_ROUTES.showcase).toBe("/showcase");
    expect(GALLERY_ROUTES.standalone).toBe("/gallery");
    expect(GALLERY_ROUTES.legacyPhotos).toBe("/showcase/photos");
    expect(GALLERY_ROUTES.albumsView).toBe("albums");
    expect(GALLERY_ROUTES.admin).toBe("/admin/albums");
  });

  it("旧手机照片 / 相册屏幕仍登记（只为转发旧深链到图库）", () => {
    expect(GALLERY_ROUTES.phoneAppId).toBe("showcase");
    expect(GALLERY_ROUTES.phoneScreens).toContain("photos");
    expect(GALLERY_ROUTES.phoneScreens).toContain("album");
  });
});

describe("生活图库视图与旧照片墙重定向（第三轮 §4.1 / 验收 §8.2 末行）", () => {
  it("默认照片墙；只有 view=albums 是相册视图，未知值按默认处理", () => {
    expect(normalizeGalleryView(null)).toBe("wall");
    expect(normalizeGalleryView("")).toBe("wall");
    expect(normalizeGalleryView("wall")).toBe("wall");
    expect(normalizeGalleryView("albums")).toBe("albums");
    expect(normalizeGalleryView("album")).toBe("wall");
  });

  it("旧照片墙根地址重定向到图库根地址", () => {
    expect(LEGACY_PHOTOS_PATH).toBe("/showcase/photos");
    expect(legacyPhotosRedirectPath({})).toBe(GALLERY_PATH);
    expect(legacyPhotosRedirectPath(new URLSearchParams())).toBe(GALLERY_PATH);
  });

  it("保留原相册与合法筛选参数（album / scope / kind / year / month）", () => {
    expect(
      legacyPhotosRedirectPath({
        album: "tokyo-2026",
        scope: "album",
        kind: "photo",
        year: "2026",
        month: "5",
      }),
    ).toBe(`${GALLERY_PATH}?album=tokyo-2026&scope=album&kind=photo&year=2026&month=5`);
    // 只给 album（全局筛选，不是相册手工顺序）：不补 scope。
    expect(legacyPhotosRedirectPath({ album: "tokyo-2026" })).toBe(
      `${GALLERY_PATH}?album=tokyo-2026`,
    );
    // URLSearchParams 与页面 searchParams 同形结果。
    expect(
      legacyPhotosRedirectPath(new URLSearchParams("album=tokyo-2026&scope=album")),
    ).toBe(`${GALLERY_PATH}?album=tokyo-2026&scope=album`);
  });

  it("scope=album 但没有 album 时丢弃（无意义的组合）", () => {
    expect(legacyPhotosRedirectPath({ scope: "album" })).toBe(GALLERY_PATH);
  });

  it("非法筛选被丢弃，不把垃圾参数带进新地址", () => {
    expect(
      legacyPhotosRedirectPath({
        album: "  ",
        scope: "global",
        kind: "video",
        year: "abc",
        month: "13",
      }),
    ).toBe(GALLERY_PATH);
    expect(legacyPhotosRedirectPath({ year: "2026", month: "0" })).toBe(
      `${GALLERY_PATH}?year=2026`,
    );
    // 分页游标 / 未知参数不转发（游标属于上一页，跨页面复用会错位）。
    expect(
      legacyPhotosRedirectPath({
        album: "x",
        cursor: "opaque-cursor",
        limit: "24",
        phone: "showcase",
        screen: "photos",
      }),
    ).toBe(`${GALLERY_PATH}?album=x`);
  });
});

describe("图片地址与尺寸", () => {
  it("缩略图优先 w640，缺了就回落", () => {
    expect(thumbnailUrl(photo)).toBe("/api/v1/media/a/w640.webp");
    expect(thumbnailUrl({ ...photo, variants: [photo.variants[0]!] })).toBe(
      "/api/v1/media/a/w320.webp",
    );
    expect(thumbnailUrl({ ...photo, variants: [] })).toBeNull();
  });

  it("灯箱优先 w1280，没有就用最大的那张", () => {
    expect(lightboxUrl(photo)).toBe("/api/v1/media/a/w640.webp");
    const with1280: Photo = {
      ...photo,
      variants: [
        ...photo.variants,
        { name: "w1280.webp", width: 1280, height: 960, bytes: 3, url: "/api/v1/media/a/w1280.webp" },
      ],
    };
    expect(lightboxUrl(with1280)).toBe("/api/v1/media/a/w1280.webp");
  });

  it("variantUrl 按给定优先级取第一个存在的", () => {
    expect(variantUrl(photo, ["w320.webp"])).toBe("/api/v1/media/a/w320.webp");
    expect(variantUrl(photo, ["nope.webp"])).toBe("/api/v1/media/a/w320.webp");
  });

  it("自然比例：宽高非法时不产生 NaN 布局", () => {
    expect(aspectRatio({ width: 800, height: 600 })).toBeCloseTo(4 / 3);
    expect(aspectRatio({ width: 0, height: 0 })).toBe(1);
    expect(aspectRatio({ width: -5, height: 10 })).toBe(1);
  });
});

describe("拍摄时间与替代文本", () => {
  it("没有拍摄时间显示「未填写日期」，不猜一个日期", () => {
    expect(formatTakenOn(null)).toBe("未填写日期");
    expect(formatTakenOn(undefined)).toBe("未填写日期");
    expect(formatTakenOn("2026-10-16")).toBe("2026-10-16");
  });

  it("alt 缺失时兜到说明，再兜到明确占位（绝不返回空串）", () => {
    expect(photoAlt(photo)).toBe("操场");
    expect(photoAlt({ ...photo, alt: "  " })).toBe("照片（未填写替代文本）");
    expect(photoAlt({ ...photo, alt: "", caption: "雨后的路口" })).toBe("雨后的路口");
  });
});

describe("类型取值", () => {
  it("三种类型都有中文标签", () => {
    expect(albumKindLabel("photo")).toBe("摄影");
    expect(albumKindLabel("screenshot")).toBe("游戏截图");
    expect(albumKindLabel("other")).toBe("其它");
  });

  it("非法类型被拒绝（不静默当成摄影）", () => {
    expect(isAlbumKind("photo")).toBe(true);
    expect(isAlbumKind("video")).toBe(false);
    expect(isAlbumKind(null)).toBe(false);
  });
});
