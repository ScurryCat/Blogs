"use client";

/**
 * INS 独立编辑页的页面容器（P5 第一批 · C3）。
 *
 * 职责：
 *  - 读 `?returnTo=`（只接受站内白名单目标，见 `safeInternalPath`）；
 *  - 站主身份：`useOwnerSession` 确认 `owner` 后才渲染编辑器；匿名/失败给登录入口
 *    （**隐藏入口不是授权**，后端仍会校验，这里只是前端体验）；
 *  - 编辑已有动态：先读正式内容作为编辑器种子（再交给 `useWorkDraft` 复用/创建工作副本）；
 *  - 新建动态：无需先建正式草稿，打开即编辑，「再发一条」重置一个全新入口。
 *
 * 桌面渲染在 `.admin-shell` 管理外壳内；≤620px 的全屏单列由 C2 的 `EditorShell` 负责。
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { ApiClientError, ApiTransportError } from "@/lib/api/client";
import type { PickedImage } from "@/features/media-picker";
import { blankContentHref, parseDraftParam } from "@/features/workspace/draft-url";
import { readReturnTo, withReturnTo } from "@/features/workspace/return-context";
import { useOwnerSession } from "@/features/workspace/session";
import { createEntryId, useEntryId, withEntryId } from "@/features/workspace/use-entry-id";

import { fetchAdminMoment } from "../api";
import { isMomentId, type MomentAdmin } from "../types";
import "@/features/ins/ins.css";
import {
  EMPTY_MOMENT_DRAFT_DATA,
  type MomentDraftData,
} from "./draft-data";
import { MomentEditor } from "./moment-editor";

export interface MomentEditorPageProps {
  /** 编辑已有动态时是 UUID；新建为 null。 */
  targetId: string | null;
}

interface EditorSeed {
  data: MomentDraftData;
  images: PickedImage[];
  targetStatus: "draft" | "published" | null;
  targetVersion: number | null;
}

const EMPTY_SEED: EditorSeed = {
  data: EMPTY_MOMENT_DRAFT_DATA,
  images: [],
  targetStatus: null,
  targetVersion: null,
};

/** 正式内容 → 编辑器种子（图片按 position 排序；alt 保留服务端值）。 */
export function seedFromMomentAdmin(moment: MomentAdmin): EditorSeed {
  const images = [...moment.images_admin]
    .sort((left, right) => left.position - right.position)
    .map((image) => ({ media_id: image.media_id, alt: image.alt }) satisfies PickedImage);
  return {
    data: {
      text: moment.text,
      tags: moment.tags.map((tag) => tag.name),
      album_links: (moment.album_links ?? []).map((link) => ({
        album_id: link.album_id,
        media_ids: [...link.media_ids],
      })),
    },
    images,
    targetStatus: moment.status,
    targetVersion: moment.version,
  };
}

function describeLoadFailure(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 401) return "登录已失效，请重新登录后再打开编辑器。";
    if (error.status === 403) return "请求来源或 CSRF 校验失败，请刷新页面后重试。";
    if (error.status === 404) return "这条动态不存在或已被删除。";
    return `读取动态失败（HTTP ${error.status}）：${error.message}`;
  }
  if (error instanceof ApiTransportError) return "连不上服务，暂时无法读取这条动态。";
  return "读取动态失败。";
}

export function MomentEditorPage({ targetId }: MomentEditorPageProps): ReactNode {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = readReturnTo(searchParams);
  const owner = useOwnerSession();
  // R2：「继续编辑」指定草稿 → URL `?draft=<uuid>`。非法值显示准确错误，绝不静默新建。
  const parsedDraft = parseDraftParam(searchParams);
  const draftId = parsedDraft.draftId;
  const newDraftHref = blankContentHref(
    targetId ? `/admin/moments/${targetId}/edit` : "/admin/moments/new",
    searchParams,
  );

  const [seed, setSeed] = useState<EditorSeed | null>(targetId ? null : EMPTY_SEED);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [epoch, setEpoch] = useState(0);
  /** 「再发一条」时强制换一个入口 id（先写回 URL，再以新 id 重挂编辑器，避免串稿）。 */
  const [entryOverride, setEntryOverride] = useState<string | null>(null);
  /** 当前编辑会话的稳定入口 id（URL `?entry=`；刷新后不变 → 本机副本可恢复）。 */
  const hookEntryId = useEntryId();
  const entryId = entryOverride ?? hookEntryId;
  /** 新建页的「再发一条」：递增 epoch 让 useWorkDraft 以新入口重新开始。 */
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    // 非 UUID 在下面会显示「编号不合法」，不要为它发一次注定 404 的请求。
    if (!targetId || !isMomentId(targetId)) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setSeed(null);
    setLoadError(null);
    setMissing(false);
    try {
      const moment = await fetchAdminMoment(targetId, controller.signal);
      if (controller.signal.aborted) return;
      setSeed(seedFromMomentAdmin(moment));
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure instanceof DOMException && failure.name === "AbortError") return;
      if (failure instanceof ApiClientError && failure.status === 404) {
        setMissing(true);
        return;
      }
      setLoadError(describeLoadFailure(failure));
    }
  }, [targetId]);

  useEffect(() => {
    if (owner.status !== "owner" || !targetId) return undefined;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- setState 都在 await 之后，这里只是发起请求。
    void load();
    return () => requestRef.current?.abort();
  }, [load, owner.status, targetId]);

  const retry = (): void => {
    if (!targetId) return;
    void load();
  };

  // ---------- 身份 / 非法 id / 读取状态 ----------
  if (targetId && !isMomentId(targetId)) {
    return (
      <section className="ins-state" role="status">
        <p className="ins-state-kicker">BAD ID</p>
        <h1>动态编号不合法</h1>
        <p>编辑页地址里的动态 ID 必须是 UUID。</p>
        <Link className="ins-btn" href="/admin/moments">
          回到动态管理
        </Link>
      </section>
    );
  }

  // R2：`?draft=` 不是 UUID 时不能静默当空白新建（那会让人以为已恢复草稿）。
  if (parsedDraft.invalid) {
    return (
      <section className="ins-state" role="status" data-editor-bad-draft>
        <p className="ins-state-kicker">BAD DRAFT</p>
        <h1>草稿编号不合法</h1>
        <p>
          继续编辑链接里的工作草稿 ID 必须是 UUID，这份草稿没有被加载；请回到创作台重新选择，
          或新建空白内容。
        </p>
        <div className="ins-admin-act">
          <Link className="ins-btn" href={newDraftHref}>
            新建空白内容
          </Link>
          <Link className="ins-btn" href="/admin">
            回到创作台
          </Link>
        </div>
      </section>
    );
  }

  if (owner.status === "loading") {
    return <p className="ins-loading">正在确认站主身份…</p>;
  }

  if (owner.status !== "owner") {
    return (
      <section className="ins-state" role="status">
        <p className="ins-state-kicker">SIGN IN</p>
        <h1>需要站主登录</h1>
        <p>
          {owner.status === "failed"
            ? "无法确认站主身份（服务暂时不可用或响应异常）。请稍后重试或重新登录。"
            : "编辑器只对站主开放；请先到登录页建立会话。"}
        </p>
        <p className="ins-editor-hint">
          隐藏入口不是授权：即使直接访问本地址，后端也会校验站主会话。
        </p>
        <Link
          className="ins-btn"
          href={returnTo ? withReturnTo("/admin/login", returnTo) : "/admin/login"}
        >
          去登录
        </Link>
      </section>
    );
  }

  if (missing) {
    return (
      <section className="ins-state" role="status">
        <p className="ins-state-kicker">NOT FOUND</p>
        <h1>这条动态不存在</h1>
        <p>它可能已被删除，或链接里的编号不正确。</p>
        <Link className="ins-btn" href="/admin/moments">
          回到动态管理
        </Link>
      </section>
    );
  }

  if (loadError) {
    return (
      <section className="ins-state ins-state-error" role="alert">
        <p className="ins-state-kicker">READ FAILED</p>
        <h1>无法读取这条动态</h1>
        <p>{loadError}</p>
        <div className="ins-admin-act">
          <button type="button" className="ins-btn" onClick={retry}>
            重新读取
          </button>
          <Link className="ins-btn" href="/admin/moments">
            回到动态管理
          </Link>
        </div>
      </section>
    );
  }

  if (!seed) {
    return <p className="ins-loading">正在读取动态…</p>;
  }

  // 入口 id 是客户端从 URL 读/生成的：拿到非空值后才挂编辑器（服务端渲染一致）。
  if (!entryId) {
    return <p className="ins-loading">正在准备编辑器…</p>;
  }

  // 登录成功但本站主 ID 为空（形状不对）时不给写入口；后端仍会拦截。
  const ownerId = owner.session?.user?.id ?? null;
  const csrfToken = owner.session?.csrf_token ?? "";
  if (!ownerId || !csrfToken) {
    return (
      <section className="ins-state ins-state-error" role="alert">
        <p className="ins-state-kicker">SESSION INCOMPLETE</p>
        <h1>站主会话不完整</h1>
        <p>缺少用户标识或 CSRF 信息，暂时不能编辑。请重新登录后再试。</p>
        <Link className="ins-btn" href={returnTo ? withReturnTo("/admin/login", returnTo) : "/admin/login"}>
          去登录
        </Link>
      </section>
    );
  }

  return (
    <MomentEditor
      key={`${targetId ?? "new"}:${draftId ?? "blank"}:${epoch}`}
      targetId={targetId}
      targetStatus={seed.targetStatus}
      targetVersion={seed.targetVersion}
      initialData={seed.data}
      initialImages={seed.images}
      returnTo={returnTo}
      csrfToken={csrfToken}
      ownerId={ownerId}
      entryId={entryId}
      draftId={draftId}
      newDraftHref={newDraftHref}
      onStartAnother={() => {
        if (targetId) {
          // 编辑页「再发一条」：去新建页（不带 target，避免继续写同一个正式内容）。
          const nextEntry = createEntryId();
          router.replace(withEntryId(withReturnTo("/admin/moments/new", returnTo), nextEntry));
          return;
        }
        // 新建页「再发一条」：换入口 id + 重挂编辑器 → 全新本机副本与本机草稿，
        // 不会把上一条提交过的内容串到新会话里。
        // R2：同时**去掉 `?draft=`**，否则新会话会继续恢复上一条草稿（不是空白内容）。
        const nextEntry = createEntryId();
        setEntryOverride(nextEntry);
        setEpoch((value) => value + 1);
        if (typeof window !== "undefined") {
          router.replace(withEntryId(withReturnTo("/admin/moments/new", returnTo), nextEntry));
        }
      }}
    />
  );
}
