/**
 * 角色消息的前端类型与纯函数（T08）。
 *
 * 契约来源：`docs/superpowers/specs/2026-10-16-character-messaging-design.md`（08）
 * 与 `apps/api/app/modules/messaging/schemas.py`。
 *
 * 这个模块**没有** `"use client"`：服务端组件也要用这里的常量与纯函数
 * （T03 踩过的坑：把常量放在带 `"use client"` 的模块里，服务端拿到的是
 * 「客户端引用函数」，请求会变成 `?limit=function(){…}` → API 422）。
 */

// --- 常量（与后端 config.py 的默认值一致；不一致由 `usage.daily_limit` 纠正）----

export const MESSAGES_TAB_ID = "messages";
export const MESSAGES_TAB_ORDER = 40;

/** 独立页 / 手机里的角色 id 形如 `futaba` / `morgana`（小写字母 + 数字 + 连字符）。 */
const CHARACTER_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;

/** 手机屏幕名。宿主对未列出的 screen 会回退桌面，因此这里必须与 phone-app 同步。 */
export const MESSAGING_LIST_SCREEN = "messages";
export const MESSAGING_CONVERSATION_SCREEN = "conversation";

// --- DTO ------------------------------------------------------------------

export type MessageOrigin = "user" | "script" | "ai" | "system";
export type ConversationStatus = "script" | "free" | "finished";

export interface Card {
  kind: string;
  id: string;
  title: string;
  summary: string;
  url: string;
  /** 图片卡（kind=image / album_photo）：服务端 w640 变体的宽高与替代文本。 */
  width?: number | null;
  height?: number | null;
  alt?: string | null;
}

export interface Message {
  id: string;
  seq: number;
  origin: MessageOrigin;
  text: string;
  node_id: string | null;
  choice_id: string | null;
  cards: Card[];
  created_at: string;
  generation_request_id: string | null;
  is_ai: boolean;
  attribution: string;
}

export interface Choice {
  id: string;
  label: string;
}

export interface ConversationNode {
  id: string;
  ending: boolean;
  resumable: boolean;
  choices: Choice[];
  /** 只在 `status === "free"` 时有值：回到话题后会出现的那句衔接文案。 */
  resume_text: string | null;
}

export interface ConversationState {
  id: string;
  character_id: string;
  status: ConversationStatus;
  story_id: string;
  story_version: string;
  node_id: string;
  node_version: number;
  paused_node_id: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
  can_send: boolean;
  can_resume: boolean;
  can_restart: boolean;
}

export type AiStatus =
  | "ok"
  | "in_flight"
  | "replayed"
  | "disabled"
  | "not_configured"
  | "timeout"
  | "transport"
  | "upstream"
  | "invalid_output"
  | "internal"
  | "site_daily_budget"
  | "visitor_daily_limit"
  | "conversation_inflight";

export interface AiState {
  status: AiStatus | string;
  message: string;
  provider: string;
  retryable: boolean;
}

export interface Usage {
  requests_today: number | null;
  daily_limit: number;
  remaining: number | null;
  site_settled_units: number;
  site_daily_units: number;
  inflight: number;
}

export interface ConversationView {
  conversation: ConversationState;
  node: ConversationNode | null;
  messages: Message[];
  ai: AiState;
  usage: Usage;
}

export interface ConversationSummary {
  id: string;
  status: ConversationStatus;
  node_id: string;
  node_version: number;
  message_count: number;
  last_message_at: string | null;
  preview: string;
  expires_at: string;
}

export interface Character {
  id: string;
  name: string;
  handle: string;
  tagline: string;
  avatar: string;
  avatar_alt: string;
  story_id: string;
  story_version: string;
  conversation: ConversationSummary | null;
}

export interface Visitor {
  id: string;
  expires_at: string;
  absolute_expires_at: string;
}

export interface SessionView {
  visitor: Visitor;
  csrf_token: string;
  characters: Character[];
  ai: AiState;
  usage: Usage;
  disclosure: string;
}

export interface Limits {
  input_max_codepoints: number;
  max_bubbles: number;
  visitor_daily_requests: number;
  site_daily_units: number;
  site_max_concurrency: number;
  conversation_max_inflight: number;
  visitor_session_idle_seconds: number;
  conversation_idle_seconds: number;
}

export interface StatusView {
  ai: AiState;
  limits: Limits;
  provider_notes: string[];
  disclosure: string;
}

// --- 纯函数 ---------------------------------------------------------------

/**
 * Unicode **码点**计数，与后端 `len(text)`（Python 的 str 就是码点序列）一致。
 *
 * 不能用 `text.length`：那是 UTF-16 码元数，`"𠮷".length === 2` 而码点数是 1，
 * 于是「最多 1000 个字符」在前后端会差一个数量级。emoji 同理。
 */
export function codepointLength(text: string): number {
  let count = 0;
  // for…of 按码点迭代字符串，因此在代理对上只算一次。
  for (const _unit of text) count += 1;
  return count;
}

/** 去掉首尾空白并把内部空白折叠成单个空格 —— 与后端 `" ".join(text.split())` 一致。 */
export function normalizeInput(text: string): string {
  return text.split(/\s+/u).filter(Boolean).join(" ");
}

export function isCharacterId(value: string | null | undefined): boolean {
  return typeof value === "string" && CHARACTER_ID_RE.test(value);
}

/** 角色 id 归一：URL 段里允许大写与多余空白，但只接受合法形状。 */
export function normalizeCharacterId(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim().toLowerCase();
  return isCharacterId(candidate) ? candidate : null;
}

/**
 * 生成幂等 ID。`crypto.randomUUID` 在旧 Safari / 非安全上下文里可能不存在，
 * 因此提供降级 —— 幂等键只要求「同一会话内不重复」，不需要密码学强度。
 */
export function newClientId(prefix: string): string {
  const random =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replace(/-/g, "")
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${random}`.slice(0, 64);
}

/** 一条消息的展示归类：决定气泡在左还是在右、有没有 AI 标记。 */
export type BubbleSide = "in" | "out" | "note";

export function bubbleSide(message: Message): BubbleSide {
  if (message.origin === "user") return "out";
  if (message.origin === "system") return "note";
  return "in";
}

/**
 * 把连续的同源 AI 气泡分组：一次生成的多个短气泡只显示**一个** AI 标记。
 *
 * 这不是纯装饰：每个气泡都挂一个标记在 390px 上会把正文挤成两行。
 */
export function groupAiRuns(messages: readonly Message[]): number[] {
  const groups: number[] = [];
  let current = 0;
  for (const [index, message] of messages.entries()) {
    const previous = index > 0 ? messages[index - 1] : undefined;
    const sameRun =
      message.origin === "ai" &&
      previous !== undefined &&
      previous.origin === "ai" &&
      previous.generation_request_id !== null &&
      previous.generation_request_id === message.generation_request_id;
    if (!sameRun) current += 1;
    groups.push(current);
  }
  return groups;
}

/** 首个承担 AI 标记的条目（同一次生成的第一条）。 */
export function aiBadgeIndices(messages: readonly Message[]): Set<number> {
  const groups = groupAiRuns(messages);
  const seen = new Set<number>();
  const badges = new Set<number>();
  for (const [index, message] of messages.entries()) {
    if (message.origin !== "ai") continue;
    const group = groups[index] ?? index;
    if (seen.has(group)) continue;
    seen.add(group);
    badges.add(index);
  }
  return badges;
}

/** 时间显示：同一天只给 `HH:MM`，否则给 `MM-DD HH:MM`（本地时区）。 */
export function formatTimestamp(iso: string, now: Date = new Date()): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return "";
  const pad = (input: number) => String(input).padStart(2, "0");
  const time = `${pad(value.getHours())}:${pad(value.getMinutes())}`;
  const sameDay =
    value.getFullYear() === now.getFullYear() &&
    value.getMonth() === now.getMonth() &&
    value.getDate() === now.getDate();
  return sameDay ? time : `${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${time}`;
}

/** 会话列表里的一句摘要：折叠空白并截断，不注入任何标记。 */
export function previewOf(text: string, limit = 36): string {
  const flattened = text.split(/\s+/u).filter(Boolean).join(" ");
  if (codepointLength(flattened) <= limit) return flattened;
  const points = Array.from(flattened);
  return `${points.slice(0, Math.max(0, limit - 1)).join("")}…`;
}

/**
 * 降级状态 → 界面上的一句话 + 语气。
 *
 * 硬规则：说的是**服务**（模型不可用 / 今天的额度），绝不冒充角色「不想理你」
 * 或者「下线了」（08 §7）。
 */
export function aiNotice(ai: AiState): ChatNotice | null {
  switch (ai.status) {
    case "ok":
    case "replayed":
      return null;
    case "in_flight":
      return { tone: "info", text: ai.message || "上一条还在生成中…" };
    case "visitor_daily_limit":
    case "site_daily_budget":
      return {
        tone: "warn",
        text: ai.message || "自由聊天今天的额度已经用完，预设剧情仍然可以继续。",
      };
    case "disabled":
    case "not_configured":
      return { tone: "warn", text: ai.message || "自由聊天暂时不可用，预设剧情仍然可以继续。" };
    case "conversation_inflight":
      return { tone: "info", text: ai.message || "上一条还在生成中，稍等一下。" };
    default:
      return {
        tone: "warn",
        text: ai.message || "这次没有拿到回复，你可以再试一次，或者回到剧情。",
      };
  }
}

/** 界面上的一条提示：`tone` 决定颜色，`text` 直接显示（纯文本）。 */
export interface ChatNotice {
  tone: "info" | "warn";
  text: string;
}

/** 剧情是否正暂停在自由聊天里。 */
export function isPaused(view: ConversationView): boolean {
  return view.conversation.status === "free";
}

/** 剧情刚出现了一屏新的 script 行？用于决定要不要滚到底。 */
export function lastMessageId(view: ConversationView): string | null {
  return view.messages.at(-1)?.id ?? null;
}
