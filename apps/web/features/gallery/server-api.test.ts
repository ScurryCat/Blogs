/**
 * 服务端路径前缀（T06 真实缺陷的回归）。
 *
 * `lib/api/server.ts` 的 `serverApiRequest` **自己**会加 `/api/v1`，而浏览器端的
 * `apiRequest` 需要完整路径。第一版两边共用同一组带前缀的常量，于是服务端请求变成
 * `/api/v1/api/v1/projects/...` —— 页面表现为「作品详情 404」，而应用日志里是路径错了。
 * 这个用例把两边的形状钉住：**服务端一组必须不带前缀**。
 */

import { describe, expect, it } from "vitest";

import {
  albumDetailRelPath,
  albumListRelQuery,
  wallRelQuery,
  GALLERY_API,
  GALLERY_REL,
} from "@/features/gallery/paths";
import { projectListRelQuery, projectRelPath, PROJECTS_API, PROJECTS_REL } from "@/features/showcase/paths";

describe("服务端路径不带 /api/v1（否则会拼成 /api/v1/api/v1）", () => {
  it("相册：相对路径与浏览器路径只差前缀", () => {
    expect(GALLERY_REL.albums).toBe("/gallery/albums");
    expect(GALLERY_API.albums).toBe(`/api/v1${GALLERY_REL.albums}`);
    expect(GALLERY_REL.albums.startsWith("/api/")).toBe(false);
  });

  it("照片墙查询串：相对路径保留全部筛选条件", () => {
    const relative = wallRelQuery({ kind: "photo", year: 2026, cursor: "c1" });
    expect(relative.startsWith("/gallery/photos?")).toBe(true);
    expect(relative).toContain("kind=photo");
    expect(relative).toContain("year=2026");
    expect(relative).toContain("cursor=c1");
    expect(relative).not.toContain("/api/v1");
  });

  it("相册列表与详情：相对路径", () => {
    const list = albumListRelQuery({ kind: "screenshot" });
    expect(list).toBe("/gallery/albums?kind=screenshot");
    expect(albumDetailRelPath("tokyo-2026")).toBe("/gallery/albums/tokyo-2026");
  });

  it("作品：相对路径与浏览器路径只差前缀", () => {
    expect(PROJECTS_REL.list).toBe("/projects");
    expect(PROJECTS_API.list).toBe(`/api/v1${PROJECTS_REL.list}`);
    expect(projectRelPath("p5-blog")).toBe("/projects/p5-blog");
    const list = projectListRelQuery({ maintenance: "active", tech: "Next.js" });
    expect(list.startsWith("/projects?")).toBe(true);
    expect(list).not.toContain("/api/v1");
  });

  it("slug 在相对路径里同样做编码（不接受任意路径）", () => {
    expect(projectRelPath("a/b")).toBe("/projects/a%2Fb");
    expect(albumDetailRelPath("a b")).toBe("/gallery/albums/a%20b");
  });
});
