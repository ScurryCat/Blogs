/**
 * 工作草稿 API 的 wire 契约（契约 §3.2 / §3.3 / §9.2）。
 *
 * 重点钉住三件事：
 *  - 路径与方法：`/api/v1/admin/work-drafts` 六个接口；
 *  - 写请求带 `X-CSRF-Token` 头，**body 里不再出现 csrf_token**（长正文超过 body 上限）；
 *  - 字段名 snake_case、图片数组顺序即 position、If-Match 用 `"<draft_version>"`。
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  commitWorkDraft,
  createWorkDraft,
  discardWorkDraft,
  getWorkDraft,
  listWorkDrafts,
  updateWorkDraft,
} from "./api";
import { makeWorkDraft, stubFetch, type FetchStub } from "./test-support";

let stub: FetchStub | null = null;

afterEach(() => {
  stub?.restore();
  stub = null;
});

describe("createWorkDraft", () => {
  it("POST /admin/work-drafts：snake_case body + X-CSRF-Token，无 csrf_token 字段", async () => {
    stub = stubFetch([
      {
        match: "/admin/work-drafts",
        method: "POST",
        status: 201,
        body: { draft: makeWorkDraft({ id: "draft-9" }), reused: false },
      },
    ]);
    const result = await createWorkDraft("csrf-token-1", {
      contentType: "moment",
      data: { text: "你好" },
      images: [
        { media_id: "m1", alt: "第一张" },
        { media_id: "m2", alt: "" },
      ],
    });

    expect(result.draft.id).toBe("draft-9");
    expect(result.reused).toBe(false);
    const request = stub.requests[0];
    expect(request?.url).toBe("/api/v1/admin/work-drafts");
    expect(request?.method).toBe("POST");
    expect(request?.headers["x-csrf-token"]).toBe("csrf-token-1");
    expect(request?.body).toEqual({
      content_type: "moment",
      data: { text: "你好" },
      images: [
        { media_id: "m1", position: 0, alt: "第一张" },
        { media_id: "m2", position: 1, alt: "" },
      ],
    });
    expect(JSON.stringify(request?.body)).not.toContain("csrf_token");
    expect(request?.body).not.toHaveProperty("target_id");
  });

  it("已有 target 时带 target_id（复用跨设备草稿）", async () => {
    stub = stubFetch([
      {
        match: "/admin/work-drafts",
        method: "POST",
        body: { draft: makeWorkDraft({ target_id: "moment-1" }), reused: true },
      },
    ]);
    const result = await createWorkDraft("csrf", {
      contentType: "moment",
      targetId: "moment-1",
      data: { text: "" },
      images: [],
    });
    expect(result.reused).toBe(true);
    expect(stub.requests[0]?.body).toMatchObject({ target_id: "moment-1" });
  });
});

describe("listWorkDrafts / getWorkDraft", () => {
  it("列表：GET + content_type/cursor/limit 查询串", async () => {
    stub = stubFetch([
      { match: "/admin/work-drafts", method: "GET", body: { items: [], next_cursor: null } },
    ]);
    const page = await listWorkDrafts({ contentType: "journal", cursor: "c1", limit: 10 });
    expect(page).toEqual({ items: [], next_cursor: null });
    const url = stub.requests[0]?.url ?? "";
    expect(url.startsWith("/api/v1/admin/work-drafts?")).toBe(true);
    expect(url).toContain("content_type=journal");
    expect(url).toContain("cursor=c1");
    expect(url).toContain("limit=10");
  });

  it("详情：GET /admin/work-drafts/{id}", async () => {
    stub = stubFetch([{ match: "/admin/work-drafts/draft-1", method: "GET", body: makeWorkDraft() }]);
    const draft = await getWorkDraft("draft-1");
    expect(draft.id).toBe("draft-1");
    expect(stub.requests[0]?.url).toBe("/api/v1/admin/work-drafts/draft-1");
  });
});

describe("updateWorkDraft", () => {
  it("PATCH + If-Match 草稿版本 + X-CSRF-Token；images 整组替换、顺序即 position", async () => {
    stub = stubFetch([
      {
        match: "/admin/work-drafts/draft-1",
        method: "PATCH",
        body: makeWorkDraft({ draft_version: 4 }),
      },
    ]);
    const saved = await updateWorkDraft("csrf-2", "draft-1", 3, {
      data: { text: "改过" },
      images: [{ media_id: "m2", alt: "b" }],
    });
    expect(saved.draft_version).toBe(4);
    const request = stub.requests[0];
    expect(request?.method).toBe("PATCH");
    expect(request?.headers["if-match"]).toBe('"3"');
    expect(request?.headers["x-csrf-token"]).toBe("csrf-2");
    expect(request?.body).toEqual({
      data: { text: "改过" },
      images: [{ media_id: "m2", position: 0, alt: "b" }],
    });
  });

  it("只给 data 时 body 不含 images（省略=不动）", async () => {
    stub = stubFetch([
      { match: "/admin/work-drafts/draft-1", method: "PATCH", body: makeWorkDraft() },
    ]);
    await updateWorkDraft("csrf", "draft-1", 1, { data: { title: "t" } });
    const body = stub.requests[0]?.body as Record<string, unknown>;
    expect(body).toHaveProperty("data");
    expect(body).not.toHaveProperty("images");
  });
});

describe("commitWorkDraft", () => {
  it("POST /commit + If-Match + 双版本字段 + commit_key", async () => {
    stub = stubFetch([
      {
        match: "/admin/work-drafts/draft-1/commit",
        method: "POST",
        body: {
          draft_id: "draft-1",
          content_type: "journal",
          target_id: "entry-1",
          target_version: 5,
          status: "published",
          visibility: "public",
          action: "publish",
          idempotent_replay: false,
        },
      },
    ]);
    const result = await commitWorkDraft("csrf-3", "draft-1", 2, {
      action: "publish",
      expectedTargetVersion: 4,
      commitKey: "22222222-2222-4222-8222-222222222222",
    });
    expect(result.status).toBe("published");
    expect(result.visibility).toBe("public");
    const request = stub.requests[0];
    expect(request?.url).toBe("/api/v1/admin/work-drafts/draft-1/commit");
    expect(request?.headers["if-match"]).toBe('"2"');
    expect(request?.headers["x-csrf-token"]).toBe("csrf-3");
    expect(request?.body).toEqual({
      action: "publish",
      expected_target_version: 4,
      commit_key: "22222222-2222-4222-8222-222222222222",
    });
  });
});

describe("discardWorkDraft", () => {
  it("DELETE + X-CSRF-Token，204 返回 undefined", async () => {
    stub = stubFetch([{ match: "/admin/work-drafts/draft-1", method: "DELETE", status: 204 }]);
    await expect(discardWorkDraft("csrf-4", "draft-1")).resolves.toBeUndefined();
    const request = stub.requests[0];
    expect(request?.method).toBe("DELETE");
    expect(request?.headers["x-csrf-token"]).toBe("csrf-4");
  });
});
