/**
 * 放课后的失败分类与表单校验（与 journal / nav 同一原则）。
 *
 * 三类反馈分开：没有内容（正常空态）· 输入不合法（422）· 服务暂时不可用（5xx / 网络）。
 */

import { ApiClientError, ApiTransportError } from "@/lib/api/client";

import { NOTES_MAX_CODEPOINTS, PLATFORM_MAX_CODEPOINTS, TITLE_MAX_CODEPOINTS } from "./types";

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
      return { kind: "not_found", message: "这条记录现在不可读（可能已撤回或撤下）。", fields: {} };
    }
    if (error.status === 422) {
      return { kind: "invalid_input", message: error.message, fields: error.fields };
    }
    if (error.status === 401 || error.status === 403) {
      return { kind: "invalid_input", message: error.message, fields: error.fields };
    }
    return {
      kind: "unavailable",
      message: `放课后暂时不可用（HTTP ${error.status} · ${error.code}）`,
      fields: {},
    };
  }
  if (error instanceof ApiTransportError) {
    return { kind: "unavailable", message: "放课后暂时不可用：连不上服务。", fields: {} };
  }
  if (isAbort(error)) return { kind: "unavailable", message: "请求已取消", fields: {} };
  return { kind: "unavailable", message: "放课后暂时不可用，请稍后重试。", fields: {} };
}

export interface EntryForm {
  title: string;
  notes: string;
  platform: string;
  rating: string;
  total_episodes: string;
  episodes_watched: string;
  playtime_minutes: string;
}

export function emptyForm(): EntryForm {
  return {
    title: "",
    notes: "",
    platform: "",
    rating: "",
    total_episodes: "",
    episodes_watched: "",
    playtime_minutes: "",
  };
}

/** 把「空字符串」与「0」区分开：空 = 未记录（提交 null），0 是明确的值。 */
export function parseOptionalInt(value: string): number | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return Number.NaN;
  return Number(trimmed);
}

/** 本地校验（服务端仍会再校验一次，这里只是尽早给出字段级提示）。 */
export function validateForm(form: EntryForm): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.title.trim()) errors.title = "名称不能为空";
  if (codepointLength(form.title) > TITLE_MAX_CODEPOINTS) {
    errors.title = `名称最多 ${TITLE_MAX_CODEPOINTS} 个字符`;
  }
  if (codepointLength(form.notes) > NOTES_MAX_CODEPOINTS) {
    errors.notes = `短评最多 ${NOTES_MAX_CODEPOINTS} 个字符`;
  }
  if (codepointLength(form.platform) > PLATFORM_MAX_CODEPOINTS) {
    errors.platform = `平台最多 ${PLATFORM_MAX_CODEPOINTS} 个字符`;
  }
  const rating = parseOptionalInt(form.rating);
  if (rating !== null && (Number.isNaN(rating) || rating < 1 || rating > 10)) {
    errors.rating = "评分留空表示未评分；填的话是 1–10";
  }
  for (const [field, label] of [
    ["total_episodes", "总集数"],
    ["episodes_watched", "已看集数"],
    ["playtime_minutes", "时长（分钟）"],
  ] as const) {
    const value = parseOptionalInt(form[field]);
    if (value !== null && (Number.isNaN(value) || value < 0)) {
      errors[field] = `${label}必须是非负整数（留空表示未记录）`;
    }
  }
  const total = parseOptionalInt(form.total_episodes);
  const watched = parseOptionalInt(form.episodes_watched);
  if (total !== null && watched !== null && !Number.isNaN(total) && !Number.isNaN(watched) && watched > total) {
    errors.episodes_watched = "已看集数不能超过总集数（总集数不确定时请留空）";
  }
  return errors;
}
