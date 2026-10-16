/**
 * 登录校验与错误文案的单元测试。
 */

import { describe, expect, it } from "vitest";

import { ApiClientError, ApiTransportError } from "@/lib/api/client";

import {
  describeLoginError,
  fieldErrorsFromApi,
  hasFieldErrors,
  needsFreshSession,
  validateLoginInput,
} from "./validation";

function apiError(status: number, code: string, fields: Record<string, string[]> = {}, message = "服务端消息") {
  return new ApiClientError(status, { code, message, fields }, "req-1");
}

describe("validateLoginInput", () => {
  it("拒绝空用户名与空密码", () => {
    const errors = validateLoginInput("   ", "");
    expect(errors.username).toBe("请输入用户名");
    expect(errors.password).toBe("请输入密码");
    expect(hasFieldErrors(errors)).toBe(true);
  });

  it("用户名长度边界与后端一致（3–64）", () => {
    expect(validateLoginInput("ab", "password-1234").username).toContain("3–64");
    expect(validateLoginInput("a".repeat(65), "password-1234").username).toContain("3–64");
    expect(validateLoginInput("abc", "password-1234").username).toBeUndefined();
  });

  it("合法输入没有字段错误", () => {
    const errors = validateLoginInput("  owner  ", "a-long-enough-password");
    expect(hasFieldErrors(errors)).toBe(false);
  });

  it("不做密码强度前置判断（强度只由服务端与 CLI 决定）", () => {
    // 短密码在前端只算「填了」，具体拒绝交给服务端，避免两套规则漂移。
    expect(validateLoginInput("owner", "short").password).toBeUndefined();
  });
});

describe("describeLoginError", () => {
  it("按 code 给出可操作文案", () => {
    expect(describeLoginError(apiError(401, "UNAUTHORIZED"))).toBe("用户名或密码不正确。");
    expect(describeLoginError(apiError(403, "FORBIDDEN"))).toContain("登录凭证已过期");
    expect(describeLoginError(apiError(429, "RATE_LIMITED"))).toContain("过于频繁");
    expect(describeLoginError(apiError(503, "SERVICE_UNAVAILABLE"))).toContain("暂时不可用");
  });

  it("未知 code 回退到服务端 message", () => {
    expect(describeLoginError(apiError(500, "INTERNAL", {}, "服务器内部错误"))).toBe("服务器内部错误");
  });

  it("传输层错误单独提示，不伪装成凭据错误", () => {
    expect(describeLoginError(new ApiTransportError("boom"))).toContain("无法连接");
    expect(describeLoginError(new Error("???"))).toBe("登录失败，请稍后重试。");
  });
});

describe("fieldErrorsFromApi", () => {
  it("把服务端字段错误映射到表单字段", () => {
    const error = apiError(422, "UNPROCESSABLE", {
      username: ["用户名不合法"],
      "credentials.password": ["密码太短"],
      other: ["忽略"],
    });
    expect(fieldErrorsFromApi(error)).toEqual({
      username: "用户名不合法",
      password: "密码太短",
    });
  });

  it("非 API 错误不会造出字段错误", () => {
    expect(fieldErrorsFromApi(new Error("x"))).toEqual({});
  });
});

describe("needsFreshSession", () => {
  it("401 / 403 需要重新取预登录会话，其余不需要", () => {
    expect(needsFreshSession(apiError(401, "UNAUTHORIZED"))).toBe(true);
    expect(needsFreshSession(apiError(403, "FORBIDDEN"))).toBe(true);
    expect(needsFreshSession(apiError(429, "RATE_LIMITED"))).toBe(false);
    expect(needsFreshSession(new Error("x"))).toBe(false);
  });
});
