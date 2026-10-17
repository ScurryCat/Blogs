/**
 * 管理端单条动态 `/admin/moments/<uuid>`（第三轮 §4.2：N4b 的另一条编辑路径）。
 *
 * 这个页面与列表页工作台是两套代码，因此「同时收录到相册」必须在这里也覆盖一次：
 *  - 读取时把服务端回执的 `album_links` 回填到编辑区；
 *  - 保存时把完整选择随 PATCH 一起提交（不能只更新文字 / 图片）；
 *  - 412 冲突保留选择（不静默清空）。
 */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MOMENT_ID = "11111111-1111-4111-8111-111111111111";
const ALBUM_ID = "33333333-3333-4333-8333-333333333333";
const MEDIA_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: MOMENT_ID }),
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: vi.fn() }),
}));

import AdminMomentDetailPage from "./page";
import { stubFetch, type FetchStub } from "@/features/ins/test-support";
import { advance, click, render, resetDocument } from "@/tests/helpers/render";

let stub: FetchStub | null = null;

const SESSION = {
  authenticated: true,
  user: { id: "99999999-9999-4999-8999-999999999999", username: "owner" },
  csrf_token: "csrf-token",
  expires_at: "2026-10-18T00:00:00Z",
  prelogin: false,
};

const ALBUM_ADMIN = {
  id: ALBUM_ID,
  slug: "tokyo-2026",
  title: "东京相册",
  description: "",
  kind: "photo",
  kind_label: "摄影",
  position: 0,
  status: "draft",
  published_at: null,
  version: 1,
  photo_count: 1,
  photos: [],
};

const MOMENT = {
  id: MOMENT_ID,
  text: "操场上的下午",
  tags: [],
  published_at: null,
  images: [],
  status: "draft",
  version: 2,
  created_at: "2026-10-16T04:00:00Z",
  updated_at: "2026-10-16T04:00:00Z",
  images_admin: [{ media_id: MEDIA_ID, position: 0, alt: "操场" }],
  album_links: [{ album_id: ALBUM_ID, media_ids: [MEDIA_ID] }],
};

const SESSION_ROUTE = { match: "/auth/session", body: SESSION };
const ALBUM_ROUTE = { match: "/admin/albums", body: { items: [ALBUM_ADMIN], next_cursor: null } };

beforeEach(() => {
  resetDocument();
  pushMock.mockClear();
});

afterEach(() => {
  stub?.restore();
  stub = null;
  resetDocument();
});

describe("管理端单条动态页面（收录选择）", () => {
  it("读取动态时回填收录选择，保存时随 PATCH 完整提交", async () => {
    stub = stubFetch([
      SESSION_ROUTE,
      ALBUM_ROUTE,
      { match: "/admin/moments/", method: "PATCH", body: { ...MOMENT, version: 3 } },
      { match: "/admin/moments/", body: MOMENT },
    ]);
    const view = render(<AdminMomentDetailPage />);
    await advance(60);

    // 相册与已勾选的图片都被回填（相册标题来自管理相册列表）。
    expect(view.container.textContent).toContain("东京相册");
    expect(view.container.querySelector<HTMLInputElement>(".ins-admin-album-media input")?.checked).toBe(
      true,
    );

    click(
      [...view.container.querySelectorAll("button")].find((button) => button.textContent === "保存草稿") ??
        null,
    );
    await advance(60);

    const patch = stub.requests.find((request) => request.method === "PATCH");
    expect((patch?.headers ?? {})["if-match"]).toBe('"2"');
    expect((patch?.body as Record<string, unknown>)?.album_links).toEqual([
      { album_id: ALBUM_ID, media_ids: [MEDIA_ID] },
    ]);
    view.unmount();
  });

  it("412 冲突：保留收录选择与文字，提示重新读取", async () => {
    stub = stubFetch([
      SESSION_ROUTE,
      ALBUM_ROUTE,
      {
        match: "/admin/moments/",
        method: "PATCH",
        status: 412,
        body: {
          error: {
            code: "VERSION_CONFLICT",
            message: "内容已在别处更新",
            fields: { version: ["当前版本为 3"] },
          },
          request_id: "r",
        },
      },
      { match: "/admin/moments/", body: MOMENT },
    ]);
    const view = render(<AdminMomentDetailPage />);
    await advance(60);

    const textarea = view.container.querySelector<HTMLTextAreaElement>("textarea");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(textarea, "冲突中的改动");
    await act(async () => {
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await advance(10);

    click(
      [...view.container.querySelectorAll("button")].find((button) => button.textContent === "保存草稿") ??
        null,
    );
    await advance(60);

    expect(view.container.textContent).toContain("版本冲突");
    expect(view.container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("冲突中的改动");
    expect(view.container.querySelector<HTMLInputElement>(".ins-admin-album-media input")?.checked).toBe(
      true,
    );
    view.unmount();
  });
});
