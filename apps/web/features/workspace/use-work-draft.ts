"use client";

/**
 * 工作草稿自动保存引擎（P5 第一批 · 契约 §4.2 / §9.4，设计书 §3.1–§3.2）。
 *
 * C3 / C4 的编辑器**只通过这个 hook** 保存工作副本；它保证：
 *
 *  1. **自动保存只写 `work_drafts`**（POST/PATCH），绝不调用正式内容更新接口；
 *     正式发布/更新只能由页面显式调用 `commitWorkDraft`（api.ts）。
 *  2. 停止输入约 1s（`debounceMs`）保存一次；持续输入时最长约 5s（`maxWaitMs`）必须提交一次。
 *  3. 同一草稿的保存**串行**；用服务端 `draft_version` + 本地单调 `seq` 双重防护，
 *     旧响应不覆盖新输入（响应回来时若 `seq` 已前进，就继续保存最新内容）。
 *  4. 本机恢复副本（localStorage，key = `pl.workdraft.v1.<ownerId>.<contentType>.<targetId|new>.<targetId ?? 入口时间戳>`）：
 *     每次输入立即写；刷新后恢复文字与已上传图片关系；**未登录不读不写**；
 *     主动退出登录用 `clearAllWorkDraftLocalCopies()` 清空前缀。
 *  5. 412：暂停自动保存，保留本机输入，由页面渲染 `ConflictNotice` 调
 *     `resolveConflict("reload-latest" | "save-as-new")`。
 *  6. 401：停止自动保存，`authExpired=true`，提示「登录已失效，本机输入已保留」。
 *  7. 断网：保留本机内容、`failed` 状态与重试（不自动重发写请求）。
 *  8. 只有 `synced` 才允许「可在另一设备继续编辑」文案（见 `SYNCED_MESSAGE`）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiClientError, ApiTransportError } from "@/lib/api/client";

import { createWorkDraft, discardWorkDraft, getWorkDraft, updateWorkDraft } from "./api";
import {
  getOwnerCsrfToken,
  getOwnerSessionState,
  OwnerSessionExpiredError,
  resetOwnerSessionCache,
} from "./session";
import type { ContentType, PickedImage, SyncState, WorkDraft, WorkDraftLocalCopy } from "./types";

/** 本机恢复副本的 localStorage 前缀；退出登录时按这个前缀全清（契约 §4.2 第 3 条）。 */
export const LOCAL_COPY_PREFIX = "pl.workdraft.v1.";

/** 只有服务端确认后才能说的跨设备文案（契约 §9.4）。 */
export const SYNCED_MESSAGE = "已同步 · 可在另一设备继续编辑";

/** 编辑器当前内容（data 按内容类型、images 顺序即 position）。 */
export interface WorkDraftContent {
  data: Record<string, unknown>;
  images: PickedImage[];
}

export interface UseWorkDraftOptions {
  contentType: ContentType;
  targetId: string | null;
  /** 会话就绪后才启用（未登录/加载中时不要保存）。 */
  enabled: boolean;
  /** 站主 id：本机副本按身份隔离；未登录不读不写。 */
  ownerId: string | null;
  /** 页面读到的正式内容（编辑已有）/ 默认值（新建）。 */
  initialData: Record<string, unknown>;
  initialImages: PickedImage[];
  debounceMs?: number;
  maxWaitMs?: number;
  returnTo?: string | null;
  /** 可选：页面已有 CSRF 时直接传；否则 hook 通过 `useOwnerSession` 的模块缓存自取。 */
  csrfToken?: string;
  /**
   * 当前编辑器的入口 id（契约 §9.4 更新）：新内容每次打开生成新的 id 避免串稿，
   * 同时写进 URL `?entry=<uuid>` 让刷新后仍能恢复本机副本。页面用
   * `useEntryId()`（`./use-entry-id`）取得并传入；本机副本 key 的最后一段就是它。
   */
  entryId: string;
  /**
   * 可选：从「继续编辑」列表进入某份**尚无正式内容**的工作草稿时，直接恢复该草稿。
   * 不传时按契约 §9.4 的默认流程（已有 target 立即复用；新内容首次输入才建）。
   */
  draftId?: string | null;
}

export interface UseWorkDraftResult {
  /** 服务端工作草稿（未创建/未加载时 null；本机恢复时 `data`/`images` 反映恢复内容）。 */
  draft: WorkDraft | null;
  state: SyncState;
  /** 面向用户的中文状态文案（安静提示用）。 */
  syncMessage: string;
  /** 本机恢复副本被采用时的说明；未采用为 null。 */
  recoveryNotice: string | null;
  update(next: { data?: Record<string, unknown>; images?: PickedImage[] }): void;
  saveNow(): Promise<WorkDraft | null>;
  discard(): Promise<void>;
  resolveConflict(choice: "reload-latest" | "save-as-new"): Promise<void>;
  lastSyncedAt: string | null;
  // --- 以下为契约之外的新增可选能力（页面可不用） ---
  /** 本机恢复副本原文（新内容尚未建服务端草稿时也拿得到）。 */
  localCopy: WorkDraftLocalCopy | null;
  /** 显式采用本机副本并立即同步。 */
  adoptLocalCopy(): void;
  /**
   * 丢弃本机副本（不删除服务端草稿）。
   *
   * 推荐用途：**显式提交成功后**（commit 成功、页面即将离开或切换内容）调用一次，
   * 避免下次打开同一内容时误报「本机有未同步的修改」；失败时不要调用（保留本机内容）。
   */
  discardLocalCopy(): void;
  /** 登录已失效（401）：页面据此给「去登录」链接并停止自动保存。 */
  authExpired: boolean;
}

/**
 * 本机副本 key（契约 §4.2 第 3 条）：
 * `pl.workdraft.v1.<ownerId>.<contentType>.<targetId|new>.<targetId ?? 入口时间戳>`。
 */
export function workDraftLocalCopyKey(
  ownerId: string,
  contentType: ContentType,
  targetId: string | null,
  entryId: string,
): string {
  const scope = targetId ?? "new";
  const suffix = targetId ?? entryId;
  return `${LOCAL_COPY_PREFIX}${ownerId}.${contentType}.${scope}.${suffix}`;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readLocalCopy(key: string | null): WorkDraftLocalCopy | null {
  if (!key) return null;
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WorkDraftLocalCopy> | null;
    if (!parsed || typeof parsed !== "object" || typeof parsed.savedAt !== "string") return null;
    const data =
      parsed.data && typeof parsed.data === "object" ? (parsed.data as Record<string, unknown>) : {};
    const images = Array.isArray(parsed.images) ? (parsed.images as PickedImage[]) : [];
    return {
      data,
      images,
      draftId: typeof parsed.draftId === "string" ? parsed.draftId : null,
      draftVersion: typeof parsed.draftVersion === "number" ? parsed.draftVersion : null,
      savedAt: parsed.savedAt,
      returnTo: typeof parsed.returnTo === "string" ? parsed.returnTo : null,
    };
  } catch {
    return null;
  }
}

function writeLocalCopy(key: string | null, copy: WorkDraftLocalCopy): void {
  if (!key) return;
  const store = storage();
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(copy));
  } catch {
    // 隐私模式/配额满：本机副本可用性降级，但绝不阻断输入与自动保存。
  }
}

function removeLocalCopy(key: string | null): void {
  if (!key) return;
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(key);
  } catch {
    // ignore
  }
}

/**
 * 主动退出登录时清空**全部**本机恢复副本（契约 §3.2 / §9.4）。
 *
 * 只清 `pl.workdraft.v1.` 前缀；不保存任何认证凭据或 CSRF（CSRF 从不落盘）。
 */
export function clearAllWorkDraftLocalCopies(): void {
  const store = storage();
  if (!store) return;
  try {
    const keys: string[] = [];
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key && key.startsWith(LOCAL_COPY_PREFIX)) keys.push(key);
    }
    for (const key of keys) store.removeItem(key);
  } catch {
    // ignore
  }
}

/** a 是否比 b 更新（非法时间视为「不更新」）。 */
function isNewer(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = a ? Date.parse(a) : Number.NaN;
  const right = b ? Date.parse(b) : Number.NaN;
  if (Number.isNaN(left)) return false;
  if (Number.isNaN(right)) return true;
  return left > right;
}

function hasContent(content: WorkDraftContent): boolean {
  if (content.images.length > 0) return true;
  return Object.values(content.data).some((value) => {
    if (value === null || value === undefined) return false;
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  });
}

/** 面向用户的失败文案（412/401 走专门状态，这里只兜其余）。 */
function describeDraftError(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 404) return "工作草稿不存在或已被丢弃，本机输入已保留。";
    if (error.status === 409) return error.message || "当前状态不允许这个操作，本机输入已保留。";
    if (error.status === 422) return "草稿内容不合法，请检查后重试（本机输入已保留）。";
    return error.message || `同步失败（HTTP ${error.status}），本机输入已保留。`;
  }
  if (error instanceof ApiTransportError) {
    return "无法连接到服务，本机输入已保留。请检查网络后点重试。";
  }
  return "同步失败，本机输入已保留。请稍后重试。";
}

export function useWorkDraft(options: UseWorkDraftOptions): UseWorkDraftResult {
  const {
    contentType,
    targetId,
    enabled,
    ownerId,
    initialData,
    initialImages,
    returnTo = null,
    csrfToken,
    entryId,
    draftId = null,
  } = options;
  const debounceMs = options.debounceMs ?? 1000;
  const maxWaitMs = options.maxWaitMs ?? 5000;

  // 最新 options：事件回调/异步链里读 ref，避免闭包拿到旧 props（也不在渲染期写 ref）。
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  // --- 与 React 无关的引擎状态（全部放 ref，异步链里读写） -------------------
  const contentRef = useRef<WorkDraftContent>({ data: initialData, images: initialImages });
  const seqRef = useRef(0);
  const dirtyRef = useRef(false);
  const draftRef = useRef<WorkDraft | null>(null);
  const localCopyRef = useRef<WorkDraftLocalCopy | null>(null);
  const localKeyRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  /** 暂停自动保存的原因：null=正常；"conflict" / "auth" / "fatal"。 */
  const pausedRef = useRef<"conflict" | "auth" | null>(null);
  const pumpingRef = useRef<Promise<void> | null>(null);
  const initRef = useRef<Promise<void> | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- 对外状态 -------------------------------------------------------------
  const [draft, setDraft] = useState<WorkDraft | null>(null);
  const [state, setState] = useState<SyncState>("idle");
  const [failureMessage, setFailureMessage] = useState<string | null>(null);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [localCopy, setLocalCopy] = useState<WorkDraftLocalCopy | null>(null);
  const [authExpired, setAuthExpired] = useState(false);

  const applyDraft = useCallback((next: WorkDraft | null) => {
    draftRef.current = next;
    if (mountedRef.current) setDraft(next);
  }, []);
  const applyLocalCopy = useCallback((next: WorkDraftLocalCopy | null) => {
    localCopyRef.current = next;
    if (mountedRef.current) setLocalCopy(next);
  }, []);

  const clearTimers = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (maxTimerRef.current !== null) {
      clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
  }, []);

  /** 落本机副本（未登录/无 key 时不写：契约「未登录不读不写」）。 */
  const persistLocal = useCallback(
    (savedAt: string, meta?: { draftId?: string | null; draftVersion?: number | null }) => {
      const key = localKeyRef.current;
      if (!key || !optionsRef.current.ownerId) return;
      const current = draftRef.current;
      const copy: WorkDraftLocalCopy = {
        data: contentRef.current.data,
        images: contentRef.current.images,
        draftId: meta?.draftId !== undefined ? meta.draftId : (current?.id ?? null),
        draftVersion:
          meta?.draftVersion !== undefined ? meta.draftVersion : (current?.draft_version ?? null),
        savedAt,
        returnTo: optionsRef.current.returnTo ?? null,
      };
      writeLocalCopy(key, copy);
      localCopyRef.current = copy;
      if (mountedRef.current) setLocalCopy(copy);
    },
    [],
  );

  const resolveCsrf = useCallback(async (): Promise<string> => {
    const explicit = optionsRef.current.csrfToken;
    if (explicit) return explicit;
    const cached = getOwnerSessionState();
    if (cached.status === "owner" && cached.session?.csrf_token) return cached.session.csrf_token;
    return getOwnerCsrfToken();
  }, []);

  /** 把一次保存失败映射成状态（412/401 有专门停机语义）。 */
  const handleSaveFailure = useCallback((error: unknown) => {
    if (
      error instanceof OwnerSessionExpiredError ||
      (error instanceof ApiClientError && error.status === 401)
    ) {
      pausedRef.current = "auth";
      if (mountedRef.current) {
        setAuthExpired(true);
        setFailureMessage("登录已失效，本机输入已保留。请重新登录后再继续。");
        setState("failed");
      }
      resetOwnerSessionCache();
      return;
    }
    if (error instanceof ApiClientError && error.status === 412) {
      pausedRef.current = "conflict";
      if (mountedRef.current) {
        setFailureMessage("草稿已在其他设备或标签页更新，自动保存已暂停。请选择如何处理本机修改。");
        setState("conflict");
      }
      return;
    }
    if (mountedRef.current) {
      setFailureMessage(describeDraftError(error));
      setState("failed");
    }
  }, []);

  /** 串行保存队列：一次只允许一个保存请求在途；完成后再看是否还有新输入。 */
  const pump = useCallback((): Promise<void> => {
    if (pumpingRef.current) return pumpingRef.current;
    const run = (async () => {
      // 等初始化（已有 target 的 POST 复用）完成再发写请求，避免重复建草稿。
      await initRef.current;
      while (mountedRef.current && optionsRef.current.enabled && dirtyRef.current && pausedRef.current === null) {
        dirtyRef.current = false;
        const seqAtStart = seqRef.current;
        const content: WorkDraftContent = {
          data: contentRef.current.data,
          images: contentRef.current.images,
        };
        if (mountedRef.current) {
          setFailureMessage(null);
          setState("saving");
        }
        let saved: WorkDraft;
        try {
          const csrf = await resolveCsrf();
          const current = draftRef.current;
          if (!current) {
            // 新内容第一次真实输入：此时才创建工作草稿（避免空的「继续编辑」条目）。
            const created = await createWorkDraft(csrf, {
              contentType: optionsRef.current.contentType,
              targetId: optionsRef.current.targetId,
              data: content.data,
              images: content.images,
            });
            saved = created.draft;
            if (!mountedRef.current) return;
            applyDraft(saved);
            setLastSyncedAt(saved.updated_at);
            if (seqRef.current === seqAtStart) {
              persistLocal(saved.updated_at, {
                draftId: saved.id,
                draftVersion: saved.draft_version,
              });
              setState("synced");
            } else {
              dirtyRef.current = true;
            }
            continue;
          }
          saved = await updateWorkDraft(csrf, current.id, current.draft_version, {
            data: content.data,
            images: content.images,
          });
        } catch (error) {
          dirtyRef.current = true;
          handleSaveFailure(error);
          return;
        }

        const knownVersion = draftRef.current?.draft_version ?? 0;
        if (saved.draft_version < knownVersion) {
          // 旧响应：丢弃，不覆盖本机内容；保持本机内容并提示重试（串行队列下不应发生）。
          dirtyRef.current = true;
          if (mountedRef.current) {
            setFailureMessage("同步响应乱序，本机内容已保留。请重试。");
            setState("failed");
          }
          return;
        }
        const stillCurrent = seqRef.current === seqAtStart;
        if (stillCurrent) {
          applyDraft(saved);
        } else {
          // 旧响应不能覆盖新输入：只更新时间/版本元数据，内容保持用户最新一轮。
          applyDraft({ ...saved, data: contentRef.current.data, images: contentRef.current.images });
        }
        if (mountedRef.current) setLastSyncedAt(saved.updated_at);
        if (stillCurrent) {
          persistLocal(saved.updated_at, { draftId: saved.id, draftVersion: saved.draft_version });
          if (mountedRef.current) setState("synced");
        } else {
          // 输入在请求在途时又变了：本机副本保持 update() 写入的更晚时间，继续下一轮。
          dirtyRef.current = true;
        }
      }
    })().finally(() => {
      pumpingRef.current = null;
    });
    pumpingRef.current = run;
    return run;
  }, [applyDraft, handleSaveFailure, persistLocal, resolveCsrf]);

  const flush = useCallback(() => {
    clearTimers();
    void pump();
  }, [clearTimers, pump]);

  const scheduleSave = useCallback(
    (immediate = false) => {
      if (!optionsRef.current.enabled || pausedRef.current !== null) return;
      const debounce = Math.max(0, optionsRef.current.debounceMs ?? 1000);
      const maxWait = Math.max(0, optionsRef.current.maxWaitMs ?? 5000);
      if (debounceTimerRef.current !== null) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(
        () => {
          debounceTimerRef.current = null;
          flush();
        },
        immediate ? 0 : debounce,
      );
      if (maxTimerRef.current === null) {
        maxTimerRef.current = setTimeout(() => {
          maxTimerRef.current = null;
          flush();
        }, maxWait);
      }
    },
    [flush],
  );

  // -------- 初始化：读本机副本；已有 target 立即建/复用服务端草稿 ----------
  // 异步闭包里做状态重置与读取：既避免 effect 同步 setState 的级联渲染，
  // 又保证所有「等初始化完成」的保存请求都通过 initRef 排序。
  useEffect(() => {
    mountedRef.current = true;
    if (!enabled || !ownerId) return;

    const controller = new AbortController();
    const init = (async () => {
      const key = workDraftLocalCopyKey(ownerId, contentType, targetId, entryId);
      localKeyRef.current = key;
      const copy = readLocalCopy(key);
      applyDraft(null);
      draftRef.current = null;
      dirtyRef.current = false;
      pausedRef.current = null;
      seqRef.current = 0;
      setFailureMessage(null);
      setAuthExpired(false);
      setLastSyncedAt(null);
      setRecoveryNotice(null);

      if (copy) {
        contentRef.current = { data: copy.data, images: copy.images };
        applyLocalCopy(copy);
      } else {
        contentRef.current = { data: initialData, images: initialImages };
        applyLocalCopy(null);
      }

      if (!targetId) {
        // 新内容：不在挂载时建草稿（避免空的「继续编辑」条目）；有本机副本则先展示恢复内容。
        if (copy) {
          dirtyRef.current = true; // 本机内容尚未同步到服务器 → 下次输入或 saveNow 时同步
          setRecoveryNotice("已恢复本机未同步的修改（本机副本）。");
          setState("local-only");
        } else {
          setState("idle");
        }
        return;
      }

      // 已有内容：立即 POST 创建/复用，把跨设备继续编辑的前提（服务端草稿）准备好。
      setState("saving");
      const seqAtStart = seqRef.current;
      try {
        const csrf = await resolveCsrf();
        if (!mountedRef.current) return;
        if (draftId) {
          // 「继续编辑」列表点进来的指定草稿：直接读详情（不新建）。
          const resumed = await getWorkDraft(draftId, controller.signal);
          if (!mountedRef.current) return;
          const localNewer = copy ? isNewer(copy.savedAt, resumed.updated_at) : false;
          if (seqRef.current > seqAtStart) {
            applyDraft({ ...resumed, data: contentRef.current.data, images: contentRef.current.images });
            dirtyRef.current = true;
            setState("local-only");
          } else if (localNewer && copy) {
            contentRef.current = { data: copy.data, images: copy.images };
            applyDraft({ ...resumed, data: copy.data, images: copy.images });
            dirtyRef.current = true;
            setRecoveryNotice("已恢复本机未同步的修改（本机副本）。");
            setState("local-only");
          } else {
            contentRef.current = { data: resumed.data, images: resumed.images };
            applyDraft(resumed);
            persistLocal(resumed.updated_at, {
              draftId: resumed.id,
              draftVersion: resumed.draft_version,
            });
            setLastSyncedAt(resumed.updated_at);
            setState("synced");
          }
          return;
        }
        const { draft: created } = await createWorkDraft(
          csrf,
          {
            contentType,
            targetId,
            data: contentRef.current.data,
            images: contentRef.current.images,
          },
          controller.signal,
        );
        if (!mountedRef.current) return;
        if (seqRef.current > seqAtStart) {
          // 初始化在途时用户已输入：旧响应不能覆盖新输入，保留本机内容并继续同步。
          applyDraft({ ...created, data: contentRef.current.data, images: contentRef.current.images });
          dirtyRef.current = true;
          persistLocal(new Date().toISOString(), {
            draftId: created.id,
            draftVersion: created.draft_version,
          });
          setState("local-only");
          return;
        }
        const localNewer = copy ? isNewer(copy.savedAt, created.updated_at) : false;
        if (localNewer && copy) {
          // 本机副本比服务器新：采用本机内容（不静默覆盖服务器，等用户输入或显式操作再保存）。
          contentRef.current = { data: copy.data, images: copy.images };
          applyDraft({ ...created, data: copy.data, images: copy.images });
          dirtyRef.current = true;
          setRecoveryNotice("已恢复本机未同步的修改（本机副本）。");
          setState("local-only");
          return;
        }
        contentRef.current = { data: created.data, images: created.images };
        applyDraft(created);
        if (copy) setRecoveryNotice("已载入服务器上较新的工作草稿。");
        persistLocal(created.updated_at, {
          draftId: created.id,
          draftVersion: created.draft_version,
        });
        setLastSyncedAt(created.updated_at);
        setState("synced");
      } catch (error) {
        if (!mountedRef.current) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        handleSaveFailure(error);
      }
    })();
    initRef.current = init;
    return () => {
      controller.abort();
    };
    // initialData/initialImages 只作为首帧种子：它们变化由下面的「种子」effect 处理。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentType, targetId, enabled, ownerId, draftId, entryId]);

  // 页面异步读到正式内容后再把 initialData 传进来：用户未输入时用它做种子。
  useEffect(() => {
    if (seqRef.current !== 0 || draftRef.current !== null || localCopyRef.current !== null) return;
    contentRef.current = { data: initialData, images: initialImages };
  }, [initialData, initialImages]);

  // 卸载：停掉定时器、标记不可写（本机副本已在每次输入时落盘，不做同步卸载刷盘）。
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimers();
    };
  }, [clearTimers]);

  // 有未同步本机改动时，离开页面前安静提示一次（契约 §9.4）。
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "本机有尚未同步的修改";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  const update = useCallback(
    (next: { data?: Record<string, unknown>; images?: PickedImage[] }) => {
      const current = contentRef.current;
      contentRef.current = {
        data: next.data !== undefined ? next.data : current.data,
        images: next.images !== undefined ? next.images : current.images,
      };
      seqRef.current += 1;
      const opts = optionsRef.current;
      if (opts.ownerId) {
        if (!localKeyRef.current) {
          localKeyRef.current = workDraftLocalCopyKey(
            opts.ownerId,
            opts.contentType,
            opts.targetId,
            opts.entryId,
          );
        }
        // 本机副本立即写（刷新可恢复）；未登录不写。
        persistLocal(new Date().toISOString());
      }
      if (!opts.enabled || pausedRef.current !== null) return;
      dirtyRef.current = true;
      if (mountedRef.current) {
        setFailureMessage(null);
        setState("local-only");
      }
      scheduleSave();
    },
    [persistLocal, scheduleSave],
  );

  const saveNow = useCallback(async (): Promise<WorkDraft | null> => {
    clearTimers();
    if (!optionsRef.current.enabled || !optionsRef.current.ownerId) return draftRef.current;
    if (pausedRef.current !== null) return draftRef.current;
    if (!dirtyRef.current && draftRef.current) return draftRef.current;
    if (!dirtyRef.current && draftRef.current === null && !hasContent(contentRef.current)) return null;
    dirtyRef.current = true;
    await pump();
    return draftRef.current;
  }, [clearTimers, pump]);

  const discard = useCallback(async (): Promise<void> => {
    clearTimers();
    const current = draftRef.current;
    try {
      if (current) {
        const csrf = await resolveCsrf();
        await discardWorkDraft(csrf, current.id);
      }
      removeLocalCopy(localKeyRef.current);
      applyLocalCopy(null);
      applyDraft(null);
      dirtyRef.current = false;
      pausedRef.current = null;
      if (mountedRef.current) {
        setRecoveryNotice(null);
        setLastSyncedAt(null);
        setFailureMessage(null);
        setState("idle");
      }
    } catch (error) {
      handleSaveFailure(error);
    }
  }, [applyDraft, applyLocalCopy, clearTimers, handleSaveFailure, resolveCsrf]);

  const resolveConflict = useCallback(
    async (choice: "reload-latest" | "save-as-new"): Promise<void> => {
      const current = draftRef.current;
      try {
        const csrf = await resolveCsrf();
        if (choice === "reload-latest") {
          if (!current) {
            pausedRef.current = null;
            dirtyRef.current = false;
            if (mountedRef.current) setState("idle");
            return;
          }
          const latest = await getWorkDraft(current.id);
          contentRef.current = { data: latest.data, images: latest.images };
          seqRef.current += 1; // 让任何在途旧响应失效
          applyDraft(latest);
          persistLocal(latest.updated_at, {
            draftId: latest.id,
            draftVersion: latest.draft_version,
          });
          dirtyRef.current = false;
          pausedRef.current = null;
          if (mountedRef.current) {
            setLastSyncedAt(latest.updated_at);
            setFailureMessage(null);
            setRecoveryNotice(null);
            setState("synced");
          }
          return;
        }
        // save-as-new：用本机内容新建草稿；原草稿一行都不动。
        const local = contentRef.current;
        const { draft: created } = await createWorkDraft(csrf, {
          contentType: optionsRef.current.contentType,
          targetId: null,
          data: local.data,
          images: local.images,
        });
        contentRef.current = { data: created.data, images: created.images };
        seqRef.current += 1;
        applyDraft(created);
        persistLocal(created.updated_at, {
          draftId: created.id,
          draftVersion: created.draft_version,
        });
        dirtyRef.current = false;
        pausedRef.current = null;
        if (mountedRef.current) {
          setLastSyncedAt(created.updated_at);
          setFailureMessage(null);
          setRecoveryNotice("已另存为新的工作草稿，原草稿未被覆盖。");
          setState("synced");
        }
      } catch (error) {
        handleSaveFailure(error);
      }
    },
    [applyDraft, handleSaveFailure, persistLocal, resolveCsrf],
  );

  const adoptLocalCopy = useCallback(() => {
    const copy = localCopyRef.current;
    if (!copy) return;
    contentRef.current = { data: copy.data, images: copy.images };
    seqRef.current += 1;
    if (draftRef.current) {
      applyDraft({ ...draftRef.current, data: copy.data, images: copy.images });
    }
    if (mountedRef.current) {
      setRecoveryNotice("已采用本机未同步的修改，正在同步到服务器。");
      setState("local-only");
    }
    if (optionsRef.current.enabled && pausedRef.current === null) {
      dirtyRef.current = true;
      scheduleSave(true);
    }
  }, [applyDraft, scheduleSave]);

  const discardLocalCopy = useCallback(() => {
    removeLocalCopy(localKeyRef.current);
    applyLocalCopy(null);
    if (mountedRef.current) setRecoveryNotice(null);
  }, [applyLocalCopy]);

  const syncMessage = useMemo(() => {
    switch (state) {
      case "local-only":
        return "已保存在本机，尚未同步到服务器";
      case "saving":
        return "正在同步工作草稿…";
      case "synced":
        return SYNCED_MESSAGE;
      case "failed":
        return failureMessage ?? "同步失败，本机输入已保留";
      case "conflict":
        return "草稿已在其他设备更新，自动保存已暂停";
      default:
        return "";
    }
  }, [state, failureMessage]);

  return {
    draft,
    state,
    syncMessage,
    recoveryNotice,
    update,
    saveNow,
    discard,
    resolveConflict,
    lastSyncedAt,
    localCopy,
    adoptLocalCopy,
    discardLocalCopy,
    authExpired,
  };
}
