/**
 * 失败分类与输入校验（手记）。
 *
 * 三类反馈必须分开（与 nav 的 `failure.ts` 同一原则）：
 *   没有内容（正常空态）· 输入不合法（422）· 服务暂时不可用（5xx / 网络）。
 * 界面按可判定的枚举给文案，不靠 message 猜。
 *
 * 长度按 **Unicode 码点**计数（05 §2），与后端一致：`[...value].length`。
 */

import { ApiClientError, ApiTransportError } from "@/lib/api/client";

import { LOCATION_MAX_CODEPOINTS, MOOD_MAX_CODEPOINTS, TITLE_MAX_CODEPOINTS } from "./types";

export type FailureKind = "not_found" | "invalid_input" | "unavailable";

export interface Failure {
  kind: FailureKind;
  message: string;
  fields: Record<string, string[]>;
}

export function codepointLength(value: string): number {
  return [...value].length;
}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function classifyFailure(error: unknown): Failure {
  if (error instanceof ApiClientError) {
    if (error.status === 404) {
      return { kind: "not_found", message: "这篇手记现在不可读（可能已撤回或撤下）。", fields: {} };
    }
    if (error.status === 422) {
      return { kind: "invalid_input", message: error.message, fields: error.fields };
    }
    if (error.status === 401 || error.status === 403) {
      return { kind: "invalid_input", message: error.message, fields: error.fields };
    }
    return {
      kind: "unavailable",
      message: `手记暂时不可用（HTTP ${error.status} · ${error.code}）`,
      fields: {},
    };
  }
  if (error instanceof ApiTransportError) {
    return { kind: "unavailable", message: "手记暂时不可用：连不上服务。", fields: {} };
  }
  if (isAbort(error)) {
    return { kind: "unavailable", message: "请求已取消", fields: {} };
  }
  return { kind: "unavailable", message: "手记暂时不可用，请稍后重试。", fields: {} };
}

/** 日期必须是 `YYYY-MM-DD` 且是真实存在的日历日期（不是一个格式对但不存在的日子）。 */
export function isValidCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((value ?? "").trim());
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const stamp = new Date(Date.UTC(year, month - 1, day));
  return (
    stamp.getUTCFullYear() === year &&
    stamp.getUTCMonth() === month - 1 &&
    stamp.getUTCDate() === day
  );
}

export interface DraftInput {
  entry_date: string;
  title: string;
  content_md: string;
  mood: string;
  location: string;
}

/** 新建 / 编辑表单的本地校验。返回字段 → 文案；空对象表示可以提交。 */
export function validateDraft(input: DraftInput): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!isValidCalendarDate(input.entry_date)) {
    errors.entry_date = "请填写有效日期（YYYY-MM-DD）";
  }
  if (codepointLength(input.title) > TITLE_MAX_CODEPOINTS) {
    errors.title = `标题最多 ${TITLE_MAX_CODEPOINTS} 个字符`;
  }
  if (codepointLength(input.mood) > MOOD_MAX_CODEPOINTS) {
    errors.mood = `心情最多 ${MOOD_MAX_CODEPOINTS} 个字符`;
  }
  if (codepointLength(input.location) > LOCATION_MAX_CODEPOINTS) {
    errors.location = `地点最多 ${LOCATION_MAX_CODEPOINTS} 个字符`;
  }
  return errors;
}

/** 发布前的前置条件提示（与服务端的 409 门槛一致，避免「点了才知道不行」）。 */
export function publishBlockers(input: { title: string; content_md: string }): string[] {
  const blockers: string[] = [];
  if (!input.title.trim()) blockers.push("还没有标题");
  if (!input.content_md.trim()) blockers.push("还没有正文");
  return blockers;
}
