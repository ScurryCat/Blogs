/**
 * 问题记录的失败文案（T09 · 印象空间）。
 *
 * 与 `features/velvet/failure.ts` 同形的三条底线：
 *
 *  1. **不把失败伪装成空态**：读不到 ≠ 没有记录；
 *  2. 「记录不存在或未公开」与「服务暂时不可用」是两种不同反馈；
 *  3. 文案里不出现完成度、等级或任何编造的进度。
 */

export const SERVICE_UNAVAILABLE = "暂时读不到问题记录，请稍后重试。";
export const RECORD_NOT_FOUND = "这条问题记录不存在或未公开。";

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function statusOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const value = (error as { status?: unknown }).status;
  return typeof value === "number" ? value : null;
}

function messageOf(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const value = (error as { message?: unknown }).message;
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

export interface Failure {
  kind: "not-found" | "unavailable";
  message: string;
}

export function classifyFailure(error: unknown): Failure {
  if (statusOf(error) === 404) {
    return { kind: "not-found", message: messageOf(error) || RECORD_NOT_FOUND };
  }
  return { kind: "unavailable", message: messageOf(error) || SERVICE_UNAVAILABLE };
}
