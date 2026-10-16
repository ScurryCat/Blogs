/**
 * 印象空间的 URL 构造与失败分类（T09）。
 *
 * 地址拼错不会让类型检查失败，只会让读者点到 404；失败分类错了会让
 * 「服务挂了」被说成「没有这条记录」。两者都当作契约来断言。
 */

import { describe, expect, it } from "vitest";

import { ApiClientError, ApiTransportError } from "@/lib/api/client";

import { classifyFailure, isAbort, RECORD_NOT_FOUND, SERVICE_UNAVAILABLE } from "./failure";
import {
  ADMIN_EXPLORATION_PAGE,
  adminRecordListQuery,
  adminRecordPagePath,
  adminRecordPath,
  CATEGORY_EXPLORATION_PATH,
  MEMENTOS_PATH,
  mementosBackHref,
  mementosHref,
  RECORDS_API,
  RECORDS_REL,
  recordDetailRelPath,
  recordHref,
  recordListQuery,
  recordListRelQuery,
  recordPath,
  recordRelPath,
} from "./paths";
import { evidenceKindLabel, isWorkStatus, resolvedSummary, workStatusLabel } from "./types";

describe("exploration paths", () => {
  it("canonical 地址与分类探索地址分开（不替代 T04）", () => {
    expect(MEMENTOS_PATH).toBe("/apps/metanav/mementos");
    expect(CATEGORY_EXPLORATION_PATH).toBe("/apps/metanav?screen=mugen");
    expect(ADMIN_EXPLORATION_PAGE).toBe("/admin/exploration");
  });

  it("单条记录地址带编码后的 slug", () => {
    expect(recordHref("animation-pointer-events")).toBe(
      "/apps/metanav/mementos/animation-pointer-events",
    );
    expect(recordHref("a b/c")).toBe("/apps/metanav/mementos/a%20b%2Fc");
  });

  it("浏览器路径带 /api/v1，服务端相对路径不带", () => {
    expect(RECORDS_API.list).toBe("/api/v1/exploration/records");
    expect(RECORDS_API.stats).toBe("/api/v1/exploration/records/stats");
    expect(RECORDS_REL.list).toBe("/exploration/records");
    expect(recordRelPath("x")).toBe("/exploration/records/x");
    expect(recordDetailRelPath("x")).toBe("/exploration/records/x");
    expect(recordListRelQuery({ work_status: "pending" })).toBe(
      "/exploration/records?work_status=pending",
    );
  });

  it("公开与管理路径不混用", () => {
    expect(recordPath("x")).toBe("/api/v1/exploration/records/x");
    expect(adminRecordPath("abc")).toBe("/api/v1/admin/exploration/records/abc");
    expect(adminRecordPagePath("abc")).toBe("/admin/exploration/abc");
  });

  it("列表查询串只包含给过的参数", () => {
    expect(recordListQuery()).toBe("/api/v1/exploration/records");
    expect(recordListQuery({ work_status: "resolved", limit: 5 })).toBe(
      "/api/v1/exploration/records?work_status=resolved&limit=5",
    );
    expect(adminRecordListQuery({ status: "draft" })).toBe(
      "/api/v1/admin/exploration/records?status=draft",
    );
  });

  it("筛选地址与返回地址保留工作状态", () => {
    expect(mementosHref()).toBe("/apps/metanav/mementos");
    expect(mementosHref({ work_status: "archived" })).toBe(
      "/apps/metanav/mementos?work_status=archived",
    );
    expect(mementosBackHref("resolved")).toBe("/apps/metanav/mementos?work_status=resolved");
    expect(mementosBackHref(null)).toBe("/apps/metanav/mementos");
  });
});

describe("exploration failure classification", () => {
  it("404 → not-found，文案是「不存在或未公开」", () => {
    const failure = classifyFailure(new ApiClientError(404, { code: "NOT_FOUND", message: "", fields: {} }, null));
    expect(failure.kind).toBe("not-found");
    expect(failure.message).toBe(RECORD_NOT_FOUND);
  });

  it("503 / 网络错误 → unavailable，文案是「暂时读不到」", () => {
    expect(classifyFailure(new ApiClientError(503, { code: "SERVICE_UNAVAILABLE", message: "", fields: {} }, null)).kind).toBe(
      "unavailable",
    );
    // 传输层错误没有 HTTP 状态：落到默认文案（不把「断网」这种底层措辞直接给读者）。
    expect(classifyFailure(new ApiTransportError("")).message).toBe(SERVICE_UNAVAILABLE);
    expect(classifyFailure(new Error("boom")).kind).toBe("unavailable");
  });

  it("服务端给了具体消息时优先用它（不吞掉真实原因）", () => {
    const failure = classifyFailure(
      new ApiClientError(404, { code: "NOT_FOUND", message: "这条问题记录不存在或未公开", fields: {} }, null),
    );
    expect(failure.message).toBe("这条问题记录不存在或未公开");
  });

  it("AbortError 被识别为取消（不当成失败展示）", () => {
    expect(isAbort(new DOMException("Aborted", "AbortError"))).toBe(true);
    expect(isAbort(new Error("Aborted"))).toBe(false);
  });
});

describe("exploration types", () => {
  it("工作状态是四个固定值，标签来自同一份表", () => {
    for (const value of ["pending", "investigating", "resolved", "archived"]) {
      expect(isWorkStatus(value)).toBe(true);
    }
    expect(isWorkStatus("closed")).toBe(false);
    expect(isWorkStatus(null)).toBe(false);
    expect(workStatusLabel("resolved")).toBe("已解决");
    // 未知值原样返回，不编一个中文标签。
    expect(workStatusLabel("closed")).toBe("closed");
  });

  it("链接类型标签未知时回落到「链接」", () => {
    expect(evidenceKindLabel("proof")).toBe("验证");
    expect(evidenceKindLabel("weird")).toBe("链接");
  });

  it("已解决的摘要带日期，未解决的不带", () => {
    expect(
      resolvedSummary({
        id: "1",
        slug: "s",
        title: "t",
        excerpt: "",
        work_status: "resolved",
        work_status_label: "已解决",
        resolved_at: "2026-10-16T12:00:00Z",
        published_at: "2026-10-16T04:00:00Z",
        post_count: 0,
        project_count: 0,
      }),
    ).toBe("已解决 · 2026-10-16");
    expect(
      resolvedSummary({
        id: "1",
        slug: "s",
        title: "t",
        excerpt: "",
        work_status: "pending",
        work_status_label: "待探索",
        resolved_at: null,
        published_at: "2026-10-16T04:00:00Z",
        post_count: 0,
        project_count: 0,
      }),
    ).toBe("待探索");
  });
});
