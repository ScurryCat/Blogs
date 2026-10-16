/**
 * 三种反馈必须是三种（04 §4B / 验收 2）：未找到 · 输入不合法 · 服务不可用。
 * 另外验证长度按 **Unicode 码点** 计数（05 §2），与后端一致。
 */

import { describe, expect, it } from "vitest";

import { ApiClientError, ApiTransportError } from "@/lib/api/client";

import {
  KEYWORD_MAX,
  SEARCH_MAX,
  classifyFailure,
  codepointLength,
  validateKeywords,
  validateSearchQuery,
} from "./failure";

function clientError(status: number, code: string, fields: Record<string, string[]> = {}) {
  return new ApiClientError(status, { code, message: `HTTP ${status}`, fields }, "req-1");
}

describe("码点计数", () => {
  it("按 Unicode 码点而不是 UTF-16 码元计数", () => {
    expect(codepointLength("abc")).toBe(3);
    expect(codepointLength("怪盗")).toBe(2);
    expect(codepointLength("🎭")).toBe(1);
    expect("🎭".length).toBe(2); // 说明为什么不能用 String.length
  });
});

describe("关键词校验", () => {
  it("三项都必填，纯空白不算填了", () => {
    const errors = validateKeywords({ name: "   ", location: "", cognition: "据点" });
    expect(errors.name).toBeTruthy();
    expect(errors.location).toBeTruthy();
    expect(errors.cognition).toBeUndefined();
  });

  it("接受 80 个码点，拒绝 81 个（按码点而不是字节）", () => {
    expect(validateKeywords({ name: "a".repeat(KEYWORD_MAX), location: "L", cognition: "C" })).toEqual({});
    const tooLong = validateKeywords({
      name: "字".repeat(KEYWORD_MAX + 1),
      location: "L",
      cognition: "C",
    });
    expect(tooLong.name).toContain("80");
  });

  it("emoji 按 1 个码点算，不因为 UTF-16 长度被误判超长", () => {
    const value = "🎭".repeat(KEYWORD_MAX);
    expect(validateKeywords({ name: value, location: "L", cognition: "C" })).toEqual({});
  });
});

describe("搜索词校验", () => {
  it("空白与超长分别报错，正常词通过", () => {
    expect(validateSearchQuery("   ")).toBeTruthy();
    expect(validateSearchQuery("字".repeat(SEARCH_MAX + 1))).toBeTruthy();
    expect(validateSearchQuery("斜切菜单")).toBeNull();
  });
});

describe("失败分类", () => {
  it("404 是「没找到」，422 是输入问题，5xx / 网络是「暂时不可用」", () => {
    expect(classifyFailure(clientError(404, "NOT_FOUND")).kind).toBe("not_found");
    expect(classifyFailure(clientError(422, "UNPROCESSABLE")).kind).toBe("invalid_input");
    expect(classifyFailure(clientError(429, "RATE_LIMITED")).kind).toBe("rate_limited");
    expect(classifyFailure(clientError(503, "SERVICE_UNAVAILABLE")).kind).toBe("unavailable");
    expect(classifyFailure(new ApiTransportError("连不上")).kind).toBe("unavailable");
  });

  it("422 的字段错误被保留，界面可以定位到具体输入框", () => {
    const failure = classifyFailure(
      clientError(422, "UNPROCESSABLE", { "body.cognition": ["不能为空"] }),
    );
    expect(failure.fields["body.cognition"]).toEqual(["不能为空"]);
  });

  it("not_found 与 unavailable 的文案不同（不能用「没有反应」掩盖服务错误）", () => {
    const notFound = classifyFailure(clientError(404, "NOT_FOUND"));
    const unavailable = classifyFailure(clientError(500, "INTERNAL"));
    expect(notFound.message).not.toBe(unavailable.message);
    expect(unavailable.message).toContain("HTTP 500");
  });
});
