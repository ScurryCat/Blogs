/**
 * 手记独立编辑页的**纯逻辑**（P5 第一批 · C4；契约 §4.5 / §9.5）。
 *
 * 这个模块**不导入 React**，也不 import `features/workspace` —— 它只处理表单语义：
 *  - 日期默认值与 `?date=` 带入（站点时区今天由 API 给出，这里只做选择与校验）；
 *  - 正式内容 ↔ 工作草稿 `data` / `images` 的映射（session 之后的回填）；
 *  - 本地校验与「发布阻塞原因」（与后端 journal 发布门槛一致：标题 + 正文）；
 *  - 提交动作语义：新建/草稿 → `save` / `publish`；**已公开 → 只有 `update`**
 *    （设计书 §2.4：修改已公开手记先保存工作副本，明确更新前访客看到原版本）；
 *  - 成功/失败文案：只用服务端返回的真实结果，不伪造成功。
 *
 * 放在单独文件的原因：这些规则要能被单测直接钉住，而组件测试不应为了「日期默认值」
 * 这种纯逻辑去挂载整个编辑器（也就不会把 workspace 的 Hook 拖进来）。
 */

import { newUuid } from "@/lib/ids";
import { isValidCalendarDate, publishBlockers, validateDraft } from "../failure";
import type { JournalAdminEntry } from "../types";

/** 正文上限（码点）：与后端 `journal.models.CONTENT_MAX_CODEPOINTS` 一致。 */
export const CONTENT_MAX_CODEPOINTS = 20_000;

/** 提交动作：与 workspace 的 `DraftAction` 结构一致（这里不 import，避免纯模块依赖 Hook 层）。 */
export type JournalCommitAction = "save" | "publish" | "update";

/** 一条手记在编辑器里的可编辑字段（不含图片；图片单独一条数组，顺序即 position）。 */
export interface JournalForm {
  entry_date: string;
  title: string;
  content_md: string;
  mood: string;
  location: string;
  post_id: string | null;
}

/** 目标手记的形态：新建 / 正式草稿 / 已公开。 */
export type JournalTargetState = "new" | "draft" | "published";

export function emptyForm(entryDate: string): JournalForm {
  return {
    entry_date: entryDate,
    title: "",
    content_md: "",
    mood: "",
    location: "",
    post_id: null,
  };
}

/** 管理端手记 → 编辑器表单（编辑已有内容时的初值）。 */
export function formFromEntry(entry: JournalAdminEntry): JournalForm {
  return {
    entry_date: entry.entry_date,
    title: entry.title,
    content_md: entry.content_md,
    mood: entry.mood,
    location: entry.location,
    post_id: entry.post?.id ?? null,
  };
}

/** 只接受字符串字段；未知/缺字段一律回退（服务端草稿可能来自旧版本或另一页）。 */
function text(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * 工作草稿 `data` → 表单。**只在「首次挂载、用户还没开始编辑」时用**（见组件注释），
 * 因此这里对坏数据做保守回退，而不是抛错。
 */
export function formFromData(data: unknown, fallback: JournalForm): JournalForm {
  if (typeof data !== "object" || data === null) return fallback;
  const record = data as Record<string, unknown>;
  const entryDate = text(record.entry_date, fallback.entry_date);
  const rawPostId = record.post_id;
  // `post_id: null` / 空串 = 明确的「不关联」；只有**缺失该键**时才回退到初值。
  const postId =
    typeof rawPostId === "string" && rawPostId
      ? rawPostId
      : rawPostId === null || rawPostId === ""
        ? null
        : fallback.post_id;
  return {
    entry_date: isValidCalendarDate(entryDate) ? entryDate : fallback.entry_date,
    title: text(record.title, fallback.title),
    content_md: text(record.content_md, fallback.content_md),
    mood: text(record.mood, fallback.mood),
    location: text(record.location, fallback.location),
    post_id: postId,
  };
}

/** 表单 → 工作草稿 `data`（字段名即契约 §3.3 的 journal data 键）。 */
export function toDraftData(form: JournalForm): Record<string, unknown> {
  return {
    entry_date: form.entry_date,
    title: form.title,
    content_md: form.content_md,
    mood: form.mood,
    location: form.location,
    post_id: form.post_id,
  };
}

/**
 * 本地校验：字段长度 + 日期合法性（与后端同规则、同上限）。
 * 发布门槛不在这里 —— 见 `publishBlockersFor`。
 */
export function validateEditorForm(form: JournalForm): Record<string, string> {
  const errors = validateDraft(form);
  if ([...form.content_md].length > CONTENT_MAX_CODEPOINTS) {
    errors.content_md = `正文最多 ${CONTENT_MAX_CODEPOINTS} 个字符`;
  }
  return errors;
}

/** 发布前还缺什么（与后端 journal 发布门槛一致：标题、正文非空）。 */
export function publishBlockersFor(form: JournalForm): string[] {
  return publishBlockers({ title: form.title, content_md: form.content_md });
}

/** 本机今天（**只在站点时区今天取不到时兜底**；正常情况下用 API 的 `today`）。 */
export function localToday(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * 新建页的初始日期：
 *  1. `?date=` 合法（真实存在的日历日期）→ 用它（日历选中的日期）；
 *  2. 否则用站点时区的 `today`（API 给出）；
 *  3. 两者都不可用 → 本机今天（界面同时提示站点时区暂时取不到）。
 */
export function resolveInitialDate(
  rawDate: string | null | undefined,
  today: string | null | undefined,
  now: Date = new Date(),
): string {
  const candidate = typeof rawDate === "string" ? rawDate.trim() : "";
  if (isValidCalendarDate(candidate)) return candidate;
  const siteToday = typeof today === "string" ? today.trim() : "";
  if (isValidCalendarDate(siteToday)) return siteToday;
  return localToday(now);
}

/** `?date=` 被采用时给用户的一句辅助说明（不弹窗）。 */
export function initialDateHint(
  rawDate: string | null | undefined,
  resolved: string,
  today: string | null | undefined,
): string | null {
  const candidate = typeof rawDate === "string" ? rawDate.trim() : "";
  if (candidate && !isValidCalendarDate(candidate)) {
    return "地址里的 date 不是有效日期，已改用站点时区的今天。";
  }
  if (candidate && isValidCalendarDate(candidate)) return "日期来自日历选中的那一天。";
  if (!isValidCalendarDate(typeof today === "string" ? today.trim() : "")) {
    return "站点时区今天暂时取不到，日期先按本机今天；可以直接改。";
  }
  return `日期默认是站点时区的今天（${resolved}）。`;
}

/** 目标手记的形态。 */
export function targetState(entry: JournalAdminEntry | null): JournalTargetState {
  if (!entry) return "new";
  return entry.status === "published" ? "published" : "draft";
}

/**
 * 允许的提交动作（契约 §3.3 journal 行）：
 *  - 新建：`save`（建 draft+private）/ `publish`（建并发布+public）；
 *  - 正式草稿：`save` / `publish`；
 *  - 已公开：**只有 `update`**（「更新正式内容」；已公开内容不能再用 save 改正式行）。
 */
export function allowedActionsFor(entry: JournalAdminEntry | null): JournalCommitAction[] {
  const state = targetState(entry);
  if (state === "published") return ["update"];
  return ["save", "publish"];
}

/** 提交动作按钮文案（「保存」永远不等于「公开」）。 */
export const ACTION_LABELS: Record<JournalCommitAction, string> = {
  save: "保存草稿",
  publish: "公开这篇",
  update: "更新正式内容",
};

/** 提交时带上的正式内容版本（新建为 null；已有内容用打开时的版本做乐观并发检查）。 */
export function expectedTargetVersion(entry: JournalAdminEntry | null): number | null {
  return entry ? entry.version : null;
}

/**
 * 幂等提交键：同一次提交（含网络重试）复用同一个 key，避免生成重复正式内容。
 *
 * 服务端 `work_drafts.commit_key` 是 UUID；`crypto.randomUUID` 在非安全上下文
 * （HTTP 公网 IP）不存在，回落必须仍是合法 UUID v4（不能是 `ck-...`）。
 */
export function newCommitKey(): string {
  return newUuid();
}

/** 已公开手记的辅助提示：明确「更新前访客仍看到原版本」（设计书 §2.4）。 */
export function publishedEditHint(entry: JournalAdminEntry | null): string | null {
  if (!entry || entry.status !== "published") return null;
  return "这篇已经公开。自动保存只写工作副本；点「更新正式内容」之前，访客看到的仍是原版本。";
}

/** 成功文案需要的服务端结果字段（结构兼容 workspace 的 `CommitResult`）。 */
export interface CommitOutcome {
  action: JournalCommitAction;
  status: "draft" | "published";
  visibility: "private" | "public" | null;
  target_version: number;
  target_id: string;
  idempotent_replay?: boolean;
}

/**
 * 提交成功后的如实说明：只写服务端返回的结论。
 * 幂等回放必须说明「之前已经成功」，不能说成又保存了一次。
 */
export function describeCommitSuccess(outcome: CommitOutcome): string {
  if (outcome.idempotent_replay) {
    return `这次提交之前已经成功过（幂等回放，没有生成重复内容）。当前版本 ${outcome.target_version}。`;
  }
  if (outcome.action === "publish") {
    return `已公开（版本 ${outcome.target_version}）：访客现在可以看到这一篇。`;
  }
  if (outcome.action === "update") {
    return `已更新正式内容（版本 ${outcome.target_version}）：访客现在看到的是新版本。`;
  }
  // save：可能是新建草稿，也可能是更新已有的正式草稿；公开状态**不变**。
  if (outcome.visibility === "public") {
    return `已保存（版本 ${outcome.target_version}）。这篇本来就是公开的，公开状态没有改变。`;
  }
  return `已保存为草稿且仅自己可见（版本 ${outcome.target_version}）。要公开请单独点「公开这篇」。`;
}

/** 状态/版本的辅助信息（不占主界面，按 §4.8 放在辅助文本里）。 */
export function statusLine(entry: JournalAdminEntry | null, dirty: boolean): string {
  const state = targetState(entry);
  if (state === "new") {
    return dirty ? "尚未保存 · 会自动保存工作副本" : "新的一篇 · 保存后是草稿且仅自己可见";
  }
  const visibility = entry?.visibility === "public" ? "公开" : "仅自己可见";
  const status = state === "published" ? "已发布" : "草稿";
  return `${status} · ${visibility} · 正式版本 ${entry?.version ?? "?"}`;
}

/** 公开文章下拉选项（来自公开文章列表；没有管理端文章接口，只用真实公开数据）。 */
export interface PostOption {
  id: string;
  label: string;
}

export function postOptions(items: readonly { id: string; title: string; slug: string }[]): PostOption[] {
  return items.map((item) => ({ id: item.id, label: item.title || item.slug }));
}

/**
 * 关联文章的可选项：保证「当前已关联的那篇」即使不在前 30 条公开列表里也仍然可见，
 * 不会因为分页/排序不在当前页就被误判成「已失效」。
 */
export function postOptionsWithCurrent(
  items: readonly { id: string; title: string; slug: string }[],
  current: { id: string; title: string; slug: string } | null,
): PostOption[] {
  const options = postOptions(items);
  if (current && !options.some((option) => option.id === current.id)) {
    options.unshift({ id: current.id, label: `${current.title || current.slug}（当前关联）` });
  }
  return options;
}
