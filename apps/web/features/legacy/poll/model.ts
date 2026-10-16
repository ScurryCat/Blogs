/**
 * 问卷规则（无 DOM / 无 React）—— 旧站 `assets/js/poll-model.js` 的 TypeScript 迁移。
 *
 * **语义不变**（9aa6a83 是权威状态）：
 *  - `base` 是配置里的**设定票数**，访客那一票只叠加在自己浏览器里；
 *    界面上的百分比永远标注「本地展示 · 非全站统计」，迁移不把它「升级」成全站真实票数。
 *  - 存储按问卷 id 隔离（`pl-poll-v2:<id>`），区分 `seen` 与 `vote`；
 *    关闭只记录见过、不加票；同一题只加一票；旧 `pl-poll-v1` 只迁移到默认题。
 *  - 存储不可用时退化为页面内内存，交互仍能完成。
 *  - 文本一律按纯文本处理，不执行 HTML / 脚本 / 事件属性。
 */

export interface PollOption {
  value: string;
  label: string;
}

export interface PollInput {
  id: string;
  title?: string | null;
  question: string;
  questionHighlight?: string[] | null;
  options: PollOption[];
  main: string;
  base: Record<string, number>;
  comment?: { author?: string | null; text: string; highlight?: string[] | null } | null;
}

export interface PollComment {
  author: string;
  text: string;
  highlight: string[];
}

export interface PollConfig {
  id: string;
  title: string;
  question: string;
  questionHighlight: string[];
  options: PollOption[];
  main: string;
  base: Record<string, number>;
  comment: PollComment | null;
}

export interface PollState {
  seen: boolean;
  vote: string | null;
}

export interface PollTally {
  n: Record<string, number>;
  pct: Record<string, number>;
  total: number;
}

/** 旧站默认问卷 id（旧记录只迁移到它）。 */
export const DEFAULT_POLL_ID = "phantom-thieves-belief";
const LEGACY_KEY = "pl-poll-v1";

/** 只依赖 getItem / setItem / removeItem，测试可注入。 */
export interface PollStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const emptyState = (): PollState => ({ seen: false, vote: null });
const copyState = (state: PollState): PollState => ({ seen: state.seen, vote: state.vote });

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`Poll ${name} must be nonempty text`);
  }
  return value.trim();
}

function highlights(value: unknown, name: string): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new TypeError(`Poll ${name} highlights must be an array`);
  return value.map((item) => text(item, `${name} highlight`));
}

export function normalize(input: PollInput): PollConfig {
  if (!input || typeof input !== "object") throw new TypeError("Poll config is required");
  const id = text(input.id, "id");
  if (!Array.isArray(input.options) || input.options.length !== 2) {
    throw new TypeError("Poll options must contain exactly two options");
  }
  const options: PollOption[] = input.options.map((option) => ({
    value: text(option?.value, "option value"),
    label: text(option?.label, "option label"),
  }));
  const [first, second] = options as [PollOption, PollOption];
  if (first.value === second.value || first.label === second.label) {
    throw new TypeError("Poll option values and labels must be distinct");
  }
  if (!options.some((option) => option.value === input.main)) {
    throw new TypeError("Poll main must be a current option value");
  }
  const base: Record<string, number> = {};
  for (const option of options) {
    const count = input.base?.[option.value];
    if (typeof count !== "number" || !Number.isFinite(count) || count < 0) {
      throw new TypeError(`Poll base.${option.value} must be a finite nonnegative number`);
    }
    base[option.value] = count;
  }
  const config: PollConfig = {
    id,
    title: text(input.title == null ? "怪盗ch" : input.title, "title"),
    question: text(input.question, "question"),
    questionHighlight: highlights(input.questionHighlight, "question"),
    options,
    main: input.main,
    base,
    comment: null,
  };
  if (input.comment != null) {
    config.comment = {
      author: text(input.comment.author == null ? "匿名" : input.comment.author, "comment author"),
      text: text(input.comment.text, "comment text"),
      highlight: highlights(input.comment.highlight, "comment"),
    };
  }
  return config;
}

/** `7.3` → `07.3%`（整数两位、小数一位，与参考图的整数 / 小数分列对应）。 */
export function formatPercent(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new TypeError("Poll percentage must be between 0 and 100");
  }
  const [whole = "0", fraction = "0"] = value.toFixed(1).split(".");
  return `${whole.padStart(2, "0")}.${fraction}%`;
}

export interface PollStore {
  get(config: PollInput): PollState;
  markSeen(config: PollInput): PollState;
  vote(config: PollInput, value: string): PollState;
  reset(config: PollInput): PollState;
  tally(config: PollInput): PollTally;
  subscribe(id: string, listener: (state: PollState) => void): () => void;
  /** 供 React 的 useSyncExternalStore 使用：无订阅时的当前快照。 */
  snapshot(id: string): PollState;
}

export function createStore(storage: PollStorage | null, options: { defaultId?: string } = {}): PollStore {
  const defaultId = options.defaultId ?? DEFAULT_POLL_ID;
  const memory = new Map<string, PollState>();
  const subscribers = new Map<string, Set<(state: PollState) => void>>();
  const keyOf = (id: string) => `pl-poll-v2:${encodeURIComponent(id)}`;

  function read(name: string): string | null {
    try {
      return storage ? storage.getItem(name) : null;
    } catch {
      return null;
    }
  }

  function write(id: string, state: PollState): void {
    try {
      storage?.setItem(keyOf(id), JSON.stringify(state));
    } catch {
      // 内存仍是权威，交互继续。
    }
  }

  function parse(raw: string | null): PollState | null {
    try {
      const value = JSON.parse(raw ?? "null") as unknown;
      if (!value || typeof value !== "object" || Array.isArray(value)) return null;
      const record = value as { seen?: unknown; vote?: unknown };
      return {
        seen: record.seen === true,
        vote: typeof record.vote === "string" ? record.vote : null,
      };
    } catch {
      return null;
    }
  }

  function stateFor(config: PollConfig): PollState {
    if (!memory.has(config.id)) {
      const raw = read(keyOf(config.id));
      let saved = parse(raw);
      if (raw == null && config.id === defaultId) {
        const legacy = parse(read(LEGACY_KEY));
        if (legacy) {
          saved = { seen: legacy.seen, vote: legacy.vote };
          write(config.id, saved);
        }
      }
      memory.set(config.id, saved ?? emptyState());
    }
    const state = memory.get(config.id) ?? emptyState();
    const vote = config.options.some((option) => option.value === state.vote) ? state.vote : null;
    return { seen: state.seen || Boolean(vote), vote };
  }

  function notify(id: string, state: PollState): void {
    const listeners = subscribers.get(id);
    if (listeners) for (const listener of [...listeners]) listener(copyState(state));
  }

  function save(config: PollConfig, state: PollState): PollState {
    memory.set(config.id, copyState(state));
    write(config.id, state);
    notify(config.id, state);
    return copyState(state);
  }

  return {
    get: (input) => stateFor(normalize(input)),
    snapshot: (id) => copyState(memory.get(id) ?? emptyState()),
    markSeen(input) {
      const config = normalize(input);
      const state = stateFor(config);
      return state.seen ? state : save(config, { ...state, seen: true });
    },
    vote(input, value) {
      const config = normalize(input);
      if (!config.options.some((option) => option.value === value)) {
        throw new TypeError("Poll vote must be a current option value");
      }
      const state = stateFor(config);
      return state.vote ? state : save(config, { seen: true, vote: value });
    },
    reset(input) {
      const config = normalize(input);
      const state = emptyState();
      memory.set(config.id, state);
      try {
        if (storage) {
          if (config.id === defaultId) storage.removeItem(LEGACY_KEY);
          storage.removeItem(keyOf(config.id));
        }
      } catch {
        // 删除被拒时写一个墓碑，避免旧记录再次迁入。
        write(config.id, state);
      }
      notify(config.id, state);
      return copyState(state);
    },
    tally(input) {
      const config = normalize(input);
      const state = stateFor(config);
      const n: Record<string, number> = {};
      for (const option of config.options) {
        n[option.value] = (config.base[option.value] ?? 0) + (state.vote === option.value ? 1 : 0);
      }
      const counts = Object.values(n);
      const total = counts.reduce((sum, count) => sum + count, 0);
      // 缩放到最大票数再求和：两个有限大数相加溢出时百分比仍然有限。
      const scale = Math.max(...counts);
      const scaledTotal = scale ? counts.reduce((sum, count) => sum + count / scale, 0) : 0;
      const pct: Record<string, number> = {};
      for (const option of config.options) {
        pct[option.value] = scaledTotal ? ((n[option.value] ?? 0) / scale / scaledTotal) * 100 : 0;
      }
      return { n, pct, total };
    },
    subscribe(id, listener) {
      const appId = text(id, "id");
      if (typeof listener !== "function") throw new TypeError("Poll subscriber must be a function");
      if (!subscribers.has(appId)) subscribers.set(appId, new Set());
      const listeners = subscribers.get(appId)!;
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) subscribers.delete(appId);
      };
    },
  };
}

/** 浏览器 localStorage；不可用（无痕 / 被禁）时返回 null，由内存兜底。 */
export function browserStorage(): PollStorage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}
