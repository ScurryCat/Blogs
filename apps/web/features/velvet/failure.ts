/**
 * 天鹅绒房间的失败文案（T09）。
 *
 * 为什么单独一个模块：技能全书、合体、技能详情、管理页要给出**同一套**失败说明。
 * 每个组件各写一份「加载失败」的结果是：同一张页面在不同位置说不同的话，
 * 而「服务不可用」被写成「没有技能」——那是最糟的一种，因为读者会以为真的没有内容。
 *
 * 三条底线（07 §6、ACCEPTANCE §1「失败状态可用」）：
 *
 *  1. **不把失败伪装成空态**：读不到 ≠ 没有内容；
 *  2. 「技能不存在或未公开」与「服务暂时不可用」是两种不同反馈；
 *  3. 文案里不出现等级、完成度或任何编造的进度。
 */

export const SERVICE_UNAVAILABLE = "暂时读不到内容，请稍后重试。";
export const SKILL_NOT_FOUND = "技能不存在或未公开。";
export const SAME_SKILL = "「合体」需要两个不同的技能。";

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** 从错误对象取出 HTTP 状态码（`ApiClientError` 的形状由 T02 的客户端固定）。 */
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

/** 一次读取失败的分类（界面据此决定措辞与是否有「重新读取」）。 */
export interface Failure {
  kind: "not-found" | "unavailable";
  message: string;
}

export function classifyFailure(error: unknown): Failure {
  const status = statusOf(error);
  if (status === 404) {
    return { kind: "not-found", message: messageOf(error) || SKILL_NOT_FOUND };
  }
  return { kind: "unavailable", message: messageOf(error) || SERVICE_UNAVAILABLE };
}

/**
 * 「合体」失败：404 是「有 skillslug 不存在 / 未公开」，422 是「两个技能相同」。
 * 两者都不应该被说成「还没有对应作品」—— 那是另一回事（空交集是 200）。
 */
export function describeComboFailure(error: unknown): string {
  const status = statusOf(error);
  if (status === 404) return SKILL_NOT_FOUND;
  if (status === 422) return SAME_SKILL;
  return messageOf(error) || SERVICE_UNAVAILABLE;
}
