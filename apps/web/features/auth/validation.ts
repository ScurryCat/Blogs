/**
 * 登录页的输入校验与错误文案（与后端 05 §9 的错误 code 对齐）。
 *
 * 放在这里而不是写在组件里，是为了让「什么算合法输入」「某个 code 该显示什么」
 * 可以被单独测试；组件只负责把它们渲染出来。
 *
 * 前端校验只是**提前反馈**，不是安全边界：服务端仍会独立校验（05 §2）。
 */

import { ApiClientError, ApiTransportError } from "@/lib/api/client";

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 64;
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 1024;

export interface LoginFieldErrors {
  username?: string;
  password?: string;
}

export function validateLoginInput(username: string, password: string): LoginFieldErrors {
  const errors: LoginFieldErrors = {};
  const trimmed = username.trim();
  if (!trimmed) {
    errors.username = "请输入用户名";
  } else if (trimmed.length < USERNAME_MIN_LENGTH || trimmed.length > USERNAME_MAX_LENGTH) {
    errors.username = `用户名长度需在 ${USERNAME_MIN_LENGTH}–${USERNAME_MAX_LENGTH} 个字符之间`;
  }
  if (!password) {
    errors.password = "请输入密码";
  } else if (password.length > PASSWORD_MAX_LENGTH) {
    errors.password = `密码最长 ${PASSWORD_MAX_LENGTH} 个字符`;
  }
  return errors;
}

export function hasFieldErrors(errors: LoginFieldErrors): boolean {
  return Boolean(errors.username || errors.password);
}

/**
 * 把服务端错误翻译成给站主看的文案。
 *
 * 已知 code 用本站文案；未知 code 用服务端 message（服务端已经保证不含堆栈与路径）。
 */
export function describeLoginError(error: unknown): string {
  if (error instanceof ApiTransportError) {
    return "无法连接到服务，请检查网络后重试。";
  }
  if (error instanceof ApiClientError) {
    switch (error.code) {
      case "UNAUTHORIZED":
        return "用户名或密码不正确。";
      case "FORBIDDEN":
        return "登录凭证已过期或来源不被信任，请刷新页面后重试。";
      case "RATE_LIMITED":
        return "登录尝试过于频繁，请稍后再试。";
      case "VALIDATION_FAILED":
      case "UNPROCESSABLE":
        return "输入不合法，请检查后重试。";
      case "SERVICE_UNAVAILABLE":
        return "服务暂时不可用，请稍后重试。";
      default:
        return error.message || "登录失败，请稍后重试。";
    }
  }
  return "登录失败，请稍后重试。";
}

/** 服务端字段级错误（`error.fields`）转成表单字段错误。 */
export function fieldErrorsFromApi(error: unknown): LoginFieldErrors {
  if (!(error instanceof ApiClientError)) return {};
  const fields: LoginFieldErrors = {};
  for (const [key, messages] of Object.entries(error.fields ?? {})) {
    const message = Array.isArray(messages) ? messages[0] : undefined;
    if (!message) continue;
    const normalized = key.split(".").pop() ?? key;
    if (normalized === "username") fields.username = message;
    if (normalized === "password") fields.password = message;
  }
  return fields;
}

/** 会话中途失效（403 / 401）需要重新取一次预登录会话再试。 */
export function needsFreshSession(error: unknown): boolean {
  return error instanceof ApiClientError && (error.status === 403 || error.status === 401);
}
