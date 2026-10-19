"use client";

/**
 * 工作草稿 URL 参数（P5 返工 R2 · 契约 §4.2 / §9.4）。
 *
 * 为什么需要：新建的动态/手记只有工作草稿、还没有正式内容 `target_id` 时，
 * 创作台「继续编辑」必须**唯一指定**要恢复的那份工作草稿。页面把
 * `?draft=<work_draft_id>` 解析出来交给 `useWorkDraft({ draftId })`，
 * 由 Hook 用 `GET /admin/work-drafts/{id}` 恢复（不依赖本机 localStorage / entry）。
 *
 * 注意：`draft` 参数只表示**服务端草稿身份**，与 `entry`（本机副本入口 id）和
 * `returnTo`（来源上下文）是三个不同概念，不能互相替代。
 */

/** URL 里指定工作草稿的参数名。 */
export const DRAFT_PARAM = "draft";

/**
 * 工作草稿 id 的 UUID 形状（服务端生成的是 UUID）。
 *
 * 这里只做**地址层**校验，避免把随便一个字符串当草稿 id 发给服务端：
 * - 非法参数必须在页面显示「草稿编号不合法」的准确状态，不能静默当空白新建；
 * - Hook 本身不强制 UUID（测试/未来兼容直接传 id），校验责任在页面。
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 是否是合法的工作草稿 id（UUID 形状）。 */
export function isWorkDraftId(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export interface ParsedDraftParam {
  /** 合法的草稿 id；缺失或非法为 null。 */
  draftId: string | null;
  /** 传了 `draft` 参数但不是合法 UUID：页面必须显示准确错误，不能静默新建。 */
  invalid: boolean;
  /** 原始参数值（用于在错误文案里如实展示；缺失为 null）。 */
  raw: string | null;
}

/** 从查询参数里解析 `?draft=`；缺失 → `{draftId:null, invalid:false, raw:null}`。 */
export function parseDraftParam(
  searchParams: URLSearchParams | null | undefined,
): ParsedDraftParam {
  const raw = searchParams?.get(DRAFT_PARAM) ?? null;
  if (raw === null) return { draftId: null, invalid: false, raw: null };
  if (!isWorkDraftId(raw)) return { draftId: null, invalid: true, raw };
  return { draftId: raw, invalid: false, raw };
}

/**
 * 生成「新建空白内容」地址：在 `basePath` 上保留除 `draft` / `entry` 之外的查询参数。
 *
 * 用途：指定草稿恢复失败（404/403/类型不匹配…）时，编辑器给用户一个**明确**的
 * 「新建空白内容」入口 —— 去掉 draft 参数（并换一个新的 entry），而不是把
 * 失败的草稿静默当成空白页继续编辑。
 */
export function blankContentHref(basePath: string, source: URLSearchParams | null | undefined): string {
  const params = new URLSearchParams(source?.toString() ?? "");
  params.delete(DRAFT_PARAM);
  params.delete("entry");
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}
