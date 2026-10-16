/**
 * 失败分类与输入校验。
 *
 * 04 §4B 要求三种反馈**必须分开**：
 *   未找到（业务结果，200）· 输入不合法（422）· 导航暂时不可用（5xx / 网络）。
 * 因此这里把异常映射成可判定的枚举，界面按枚举给文案，不靠 message 猜。
 *
 * 关键词长度按 **Unicode 码点**计数（05 §2），与后端一致：`[...value].length`，
 * 不用 `String.length`（后者数的是 UTF-16 码元，emoji 与部分汉字会算错）。
 */

import { ApiClientError, ApiTransportError } from "@/lib/api/client";

import { PALACE_FIELDS, type KeywordInput, type PalaceField } from "./types";

export const KEYWORD_MIN = 1;
export const KEYWORD_MAX = 80;
export const SEARCH_MAX = 80;

export type FailureKind = "not_found" | "invalid_input" | "rate_limited" | "unavailable";

export interface Failure {
  kind: FailureKind;
  message: string;
  /** 字段级错误（后端 422 的 fields，键是点号路径）。 */
  fields: Record<string, string[]>;
}

/** 码点数量（不是 UTF-16 长度）。 */
export function codepointLength(value: string): number {
  return [...value].length;
}

/** 关键词校验：trim 后 1–80 码点。返回字段 → 错误文案。 */
export function validateKeywords(input: KeywordInput): Partial<Record<PalaceField, string>> {
  const errors: Partial<Record<PalaceField, string>> = {};
  for (const field of PALACE_FIELDS) {
    const value = (input[field] ?? "").trim();
    if (!value) {
      errors[field] = "这一项不能为空";
      continue;
    }
    const length = codepointLength(value);
    if (length > KEYWORD_MAX) {
      errors[field] = `最多 ${KEYWORD_MAX} 个字符（当前 ${length}）`;
    }
  }
  return errors;
}

export function validateSearchQuery(value: string): string | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "请输入要搜索的词";
  if (codepointLength(trimmed) > SEARCH_MAX) return `最多 ${SEARCH_MAX} 个字符`;
  return null;
}

export function classifyFailure(error: unknown): Failure {
  if (error instanceof ApiClientError) {
    if (error.status === 404) {
      return { kind: "not_found", message: "没有找到对应的内容", fields: {} };
    }
    if (error.status === 422) {
      return { kind: "invalid_input", message: error.message, fields: error.fields };
    }
    if (error.status === 429) {
      return {
        kind: "rate_limited",
        message: "请求太频繁了，稍等一下再试。",
        fields: {},
      };
    }
    if (error.status === 401 || error.status === 403) {
      return { kind: "invalid_input", message: error.message, fields: error.fields };
    }
    return {
      kind: "unavailable",
      message: `导航暂时不可用（HTTP ${error.status} · ${error.code}）`,
      fields: {},
    };
  }
  if (error instanceof ApiTransportError) {
    // 网络层失败与「没有这个专题」是完全不同的两件事（04 §4B）。
    return { kind: "unavailable", message: "导航暂时不可用：连不上服务。", fields: {} };
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return { kind: "unavailable", message: "请求已取消", fields: {} };
  }
  return { kind: "unavailable", message: "导航暂时不可用，请稍后重试。", fields: {} };
}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
