/**
 * 旧照片墙 `/showcase/photos` → 生活图库 `/gallery` 的重定向页（第三轮任务书 §4.1）。
 *
 * 这里只测「重定向目标」这一层（纯服务端逻辑）；真实 HTTP 状态码 / Location 头由
 * 真实构建的浏览器验收覆盖，不能用 mock 代替。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirectMock, RedirectSignal } = vi.hoisted(() => {
  class RedirectSignal extends Error {
    readonly path: string;
    constructor(path: string) {
      super(`REDIRECT ${path}`);
      this.path = path;
    }
  }
  const redirectMock = vi.fn((path: string) => {
    throw new RedirectSignal(path);
  });
  return { redirectMock, RedirectSignal };
});

vi.mock("next/navigation", () => ({
  permanentRedirect: (path: string) => redirectMock(path),
}));

import LegacyPhotosPage from "./page";

function searchParams(values: Record<string, string | string[]> = {}) {
  return Promise.resolve(values);
}

beforeEach(() => {
  redirectMock.mockClear();
});

/** 断言页面抛出了重定向，并返回目标地址（避免依赖 next 内部的重定向实现）。 */
async function redirectTarget(values: Record<string, string | string[]>): Promise<string> {
  try {
    await LegacyPhotosPage({ searchParams: searchParams(values) });
  } catch (error) {
    if (error instanceof RedirectSignal) return error.path;
    throw error;
  }
  throw new Error("旧照片墙页面没有触发重定向");
}

describe("旧照片墙重定向页", () => {
  it("根地址转到图库根地址", async () => {
    await expect(redirectTarget({})).resolves.toBe("/gallery");
    expect(redirectMock).toHaveBeenCalledTimes(1);
  });

  it("保留原相册与合法筛选参数（album / scope / kind / year / month）", async () => {
    await expect(
      redirectTarget({
        album: "tokyo-2026",
        scope: "album",
        kind: "photo",
        year: "2026",
        month: "5",
      }),
    ).resolves.toBe("/gallery?album=tokyo-2026&scope=album&kind=photo&year=2026&month=5");
  });

  it("数组形式（重复查询参数）取第一个值，不把数组拼进地址", async () => {
    await expect(redirectTarget({ album: ["tokyo-2026", "other"] })).resolves.toBe(
      "/gallery?album=tokyo-2026",
    );
  });

  it("非法筛选被丢弃（图库地址仍然有效）", async () => {
    await expect(
      redirectTarget({ kind: "video", year: "abc", scope: "global" }),
    ).resolves.toBe("/gallery");
  });
});
