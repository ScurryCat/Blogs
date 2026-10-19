"use client";

/**
 * INS 独立编辑器（P5 第一批 · C3；契约 §4.3 / §4.4）。
 *
 * 流程（设计书 §2.3）：**选择图片 → 输入文字 →（可选）收录到相册 → 预览 → 发布**。
 *
 * 硬约束：
 *  - 自动保存只走 `useWorkDraft`（服务端工作草稿），**绝不调用** `createMoment` /
 *    `updateMoment` 做自动保存（设计书 §3.1）。正式内容只在用户显式点「保存草稿 / 发布 /
 *    更新正式内容」时通过 `commitWorkDraft` 事务提交；
 *  - 草稿允许暂时没有图片；发布前集中列出**全部**阻塞原因（复用 `validateDraftForPublish`
 *    / `validateAlbumLinks`），失败保留输入、不显示虚假成功；
 *  - 连点 / 重试：`commit_key` 固定到该次提交，重试复用同一个 key（服务端幂等回放）；
 *  - 新建相册：打开新标签页前先发起 `saveNow()`（不 await，保持用户手势，避免被弹窗拦截），
 *    当前页文字 / 顺序 / alt / 收录选择都留在内存与工作草稿里；
 *  - 发布成功后给「查看动态」与「再发一条」；提交成功后离开编辑状态（避免继续改一份
 *    已 commit 的草稿导致 409），继续编辑走新的编辑页实例。
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { ApiClientError, ApiTransportError } from "@/lib/api/client";
import { newUuid } from "@/lib/ids";
import { MediaPickerDialog, MediaThumb, getAdminMedia, type PickedImage } from "@/features/media-picker";
import { commitWorkDraft } from "@/features/workspace/api";
import { ConflictNotice } from "@/features/workspace/conflict-notice";
import { EditorShell } from "@/features/workspace/editor-shell";
import { safeInternalPath, withReturnTo } from "@/features/workspace/return-context";
import { SyncStatus } from "@/features/workspace/sync-status";
import type { CommitResult, DraftAction } from "@/features/workspace/types";
import { useWorkDraft, WorkDraftSaveError } from "@/features/workspace/use-work-draft";

import { AlbumLinksEditor } from "../admin/album-links-editor";
import type { UploadedImage } from "../admin/media-uploader";
import { fieldMessages } from "../admin/session";
import {
  albumLinkSummary,
  purgeAlbumLinks,
  type MomentAlbumLink,
} from "../types";
import {
  cleanAlbumLinksForSubmit,
  collectPublishBlockers,
  commitSuccessHint,
  formatBlockers,
  readMomentDraftData,
  submitLabel,
  toMomentDraftData,
  type MomentDraftData,
} from "./draft-data";

const ALBUM_ADMIN_PATH = "/admin/albums";
const IMAGES_MAX = 9;

export interface MomentEditorProps {
  /** 编辑已有内容时是正式动态 ID；新建为 null。 */
  targetId: string | null;
  /** 目标正式内容的状态（新建为 null）。 */
  targetStatus: "draft" | "published" | null;
  /** 目标正式内容的版本（新建为 null）；提交时作为 expected_target_version。 */
  targetVersion: number | null;
  initialData: MomentDraftData;
  initialImages: PickedImage[];
  returnTo: string | null;
  csrfToken: string;
  ownerId: string;
  /** 本次编辑会话的稳定入口 id（URL `?entry=<uuid>`；刷新后本机副本据此恢复）。 */
  entryId: string;
  /**
   * 「继续编辑」指定的工作草稿 id（URL `?draft=<uuid>`；R2）。
   * 新建页用于恢复尚无正式内容的新草稿；编辑页要求草稿的 target_id 与 targetId 匹配。
   */
  draftId?: string | null;
  /**
   * 指定草稿恢复失败时「新建空白内容」的跳转地址（已去掉 draft 参数）。
   * 页面在解析 URL 时算好传入；缺省时回落到当前内容类型的官方新建路径。
   */
  newDraftHref?: string | null;
  /** 「再发一条」：由页面决定是重置还是跳到 /admin/moments/new。 */
  onStartAnother?: () => void;
}

export function MomentEditor({
  targetId,
  targetStatus,
  targetVersion,
  initialData,
  initialImages,
  returnTo,
  csrfToken,
  ownerId,
  entryId,
  draftId = null,
  newDraftHref = null,
  onStartAnother,
}: MomentEditorProps): ReactNode {
  const router = useRouter();

  const [text, setText] = useState(initialData.text);
  const [tagsInput, setTagsInput] = useState(initialData.tags.join(" "));
  const [images, setImages] = useState<PickedImage[]>(initialImages);
  const [albumLinks, setAlbumLinks] = useState<MomentAlbumLink[]>(initialData.album_links);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<CommitResult | null>(null);

  /** 一旦用户动过任何输入，就不再被工作草稿/本机副本的「首次回填」覆盖。 */
  const touchedRef = useRef(false);
  const seededRef = useRef(false);
  /** 一次提交的幂等键：同一动作重试复用，成功或「再发一条」后清空。 */
  const commitKeyRef = useRef<{ key: string; action: DraftAction } | null>(null);
  /** 已补取过详情的图片（缩略图用；避免反复请求）。 */
  const attemptedMediaRef = useRef<Set<string>>(new Set());
  /** 出现过 412 冲突（自动保存已暂停）；用户选择解决后需要把最新草稿回填到可编辑 state。 */
  const wasConflictRef = useRef(false);
  /** 用户在 ConflictNotice 里点的动作，用于回填后给出准确提示。 */
  const pendingConflictChoiceRef = useRef<"reload-latest" | "save-as-new" | null>(null);

  const workDraft = useWorkDraft({
    contentType: "moment",
    targetId,
    enabled: true,
    ownerId,
    initialData: initialData as unknown as Record<string, unknown>,
    initialImages,
    returnTo,
    csrfToken,
    entryId,
    draftId,
  });

  /** 把一份工作草稿 / 本机副本的内容回填到可编辑 state（首次打开与冲突解决后共用）。 */
  const applySnapshotToState = (snapshot: {
    data: Record<string, unknown>;
    images?: PickedImage[];
  }): void => {
    const data = readMomentDraftData(snapshot.data);
    setText(data.text);
    setTagsInput(data.tags.join(" "));
    setAlbumLinks(data.album_links);
    if (Array.isArray(snapshot.images)) {
      setImages(
        snapshot.images.map((image) => ({
          media_id: image.media_id,
          alt: image.alt ?? "",
          ...(image.media ? { media: image.media } : {}),
        })),
      );
    }
  };

  // 工作草稿 / 本机副本比初始内容新时做一次回填（只回填一次，之后用户输入优先）。
  useEffect(() => {
    if (seededRef.current || touchedRef.current) return;
    // 编辑已有内容 / 「继续编辑」指定草稿：优先服务端工作草稿（跨设备继续编辑），否则本机副本；
    // 新建内容（没有指定草稿）：本机副本才是「同一入口的未同步修改」，服务端草稿在首次输入后
    // 才创建、内容与界面一致，不需要回填（也避免把刚保存在的草稿当成恢复内容覆盖首帧）。
    const resumed = targetId !== null || draftId !== null;
    const snapshot = resumed ? (workDraft.draft ?? workDraft.localCopy) : workDraft.localCopy;
    if (!snapshot) return;
    seededRef.current = true;
    /* eslint-disable react-hooks/set-state-in-effect -- 一次性把「服务端工作草稿 / 本机恢复副本」同步进可编辑 state（外部状态 → React state），不是渲染期派生；seededRef 保证只发生一次。 */
    applySnapshotToState(snapshot);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [targetId, draftId, workDraft.draft, workDraft.localCopy]);

  /**
   * 412 冲突解决后重新回填（C5 e2e A6 缺陷修复）。
   *
   * 为什么需要：首帧回填有一次性守卫（用户输入后不能再被覆盖），而
   * `resolveConflict("reload-latest")` 只是在 hook 内把最新服务端草稿应用到 `draft`/本机副本，
   * 不会自动刷新编辑器自己的 state —— 于是「放弃本机修改，载入最新版本」点了没反应。
   * 这里监听「冲突 → 非冲突（synced/idle）」的成功转换，用 hook 已经取回的最新草稿
   * **显式重新 seed**（绕过一次性守卫），并给出与用户选择一致的提示。
   * 失败（仍 failed）不重新 seed：本机输入必须保留，等用户重试。
   */
  useEffect(() => {
    if (workDraft.state === "conflict") {
      wasConflictRef.current = true;
      return;
    }
    if (!wasConflictRef.current) return;
    if (workDraft.state !== "synced" && workDraft.state !== "idle") return;
    wasConflictRef.current = false;
    const choice = pendingConflictChoiceRef.current;
    pendingConflictChoiceRef.current = null;
    const snapshot = workDraft.draft ?? workDraft.localCopy;
    /* eslint-disable react-hooks/set-state-in-effect -- 冲突解决完成后把服务端最新草稿同步进可编辑 state（外部状态 → React state），这是用户显式选择后的唯一刷新时机。 */
    if (!snapshot) {
      setNotice("服务器上没有可载入的草稿；本机输入保持不变。");
    } else {
      applySnapshotToState(snapshot);
      setNotice(
        choice === "save-as-new"
          ? "已另存为新的工作草稿，编辑器继续使用本机内容。"
          : "已载入服务器上的最新版本，本机冲突修改已放弃。",
      );
    }
    setError(null);
    setFieldErrors({});
    touchedRef.current = false;
    seededRef.current = true;
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [workDraft.state, workDraft.draft, workDraft.localCopy]);

  // 编辑已有动态 / 从草稿恢复时，草稿里只有 media_id：补取详情渲染缩略图（不阻断编辑）。
  useEffect(() => {
    const missing = images.filter(
      (image) => !image.media && !attemptedMediaRef.current.has(image.media_id),
    );
    if (missing.length === 0) return;
    let cancelled = false;
    for (const image of missing) {
      attemptedMediaRef.current.add(image.media_id);
      void getAdminMedia(image.media_id)
        .then((media) => {
          if (cancelled) return;
          setImages((previous) =>
            previous.map((item) => (item.media_id === image.media_id ? { ...item, media } : item)),
          );
        })
        .catch(() => {
          // 缩略图读取失败不影响编辑与保存；保留占位即可。
        });
    }
    return () => {
      cancelled = true;
    };
  }, [images]);

  /** 把「界面当前内容」写进工作草稿（唯一的自动保存入口）。 */
  const pushDraft = (next: {
    text?: string;
    tagsInput?: string;
    images?: PickedImage[];
    albumLinks?: MomentAlbumLink[];
  }): void => {
    const nextText = next.text ?? text;
    const nextTags = next.tagsInput ?? tagsInput;
    const nextImages = next.images ?? images;
    const nextAlbums = next.albumLinks ?? albumLinks;
    workDraft.update({
      data: toMomentDraftData({ text: nextText, tagsInput: nextTags, albumLinks: nextAlbums }) as unknown as Record<string, unknown>,
      images: nextImages,
    });
  };

  const changeText = (value: string): void => {
    touchedRef.current = true;
    setText(value);
    pushDraft({ text: value });
  };

  const changeTags = (value: string): void => {
    touchedRef.current = true;
    setTagsInput(value);
    pushDraft({ tagsInput: value });
  };

  const applyImages = (next: PickedImage[]): void => {
    touchedRef.current = true;
    // 动态里移除的图片同步从收录选择里去掉：否则提交会带「不属于当前动态的媒体」被 409。
    const nextAlbums = purgeAlbumLinks(
      albumLinks,
      next.map((image) => image.media_id),
    );
    setImages(next);
    setAlbumLinks(nextAlbums);
    pushDraft({ images: next, albumLinks: nextAlbums });
  };

  const changeAlbumLinks = (next: MomentAlbumLink[]): void => {
    touchedRef.current = true;
    setAlbumLinks(next);
    pushDraft({ albumLinks: next });
  };

  /**
   * 新建相册：先**发起**一次 saveNow（不 await，保持用户手势，避免新标签页被浏览器拦截），
   * 再打开现有相册管理页（新标签页）。当前页文字 / 图片顺序 / alt / 收录选择都留在内存与
   * 工作草稿里，返回后可以直接继续。
   *
   * R1：`saveNow()` 失败改为抛错 —— 必须 `.catch`，否则会产生 unhandled rejection；
   * 空编辑器（返回 null）静默，其余失败如实显示错误（不误报已保存）。
   */
  const openAlbumAdmin = (): void => {
    void workDraft
      .saveNow()
      .then(() => undefined)
      .catch((failure: unknown) => {
        // 空编辑器启动相册页是正常路径（saveNow 返回 null），只有真失败才提示。
        setError(saveFailureMessage(failure));
      });
    if (typeof window !== "undefined") {
      window.open(ALBUM_ADMIN_PATH, "_blank", "noopener,noreferrer");
    }
  };

  const blockers = useMemo(
    () => collectPublishBlockers({ text, tagsInput, images, albumLinks }),
    [albumLinks, images, tagsInput, text],
  );
  const publishable = targetStatus !== "published";
  const saveAction: DraftAction = targetStatus === "published" ? "update" : "save";
  const conflict = workDraft.state === "conflict";
  /** R2：指定草稿恢复失败（404/403/类型或 target 不匹配）时，页面不是「空白新建」。 */
  const resumeBlocked = Boolean(workDraft.resumeError);
  const blocked = conflict || resumeBlocked;
  /** 恢复失败时的「新建空白内容」入口：由页面按 URL 算好（已去掉 draft 参数、换新 entry）。 */
  const blankHref =
    newDraftHref ?? (targetId ? `/admin/moments/${targetId}/edit` : "/admin/moments/new");
  /** 全新编辑器空内容时，「保存草稿」不伪造成功，也不强建一份空草稿。 */
  const hasAnyContent =
    text.trim().length > 0 ||
    tagsInput.trim().length > 0 ||
    images.length > 0 ||
    albumLinks.length > 0;

  const createCommitKey = (action: DraftAction): string => {
    const existing = commitKeyRef.current;
    if (existing && existing.action === action) return existing.key;
    // 服务端要求 UUID：非安全上下文（HTTP IP）没有 crypto.randomUUID，
    // 必须回落到合法 UUID v4 形状，不能是 `commit-...`（否则 422）。
    const key = newUuid();
    commitKeyRef.current = { key, action };
    return key;
  };

  const submit = async (action: DraftAction): Promise<void> => {
    if (busy) return;
    setError(null);
    setNotice(null);
    setFieldErrors({});
    if (workDraft.resumeError) {
      // R2：指定草稿没有恢复成功时，页面不是「空白新建」，不能静默继续编辑/提交。
      setError(workDraft.resumeError);
      return;
    }
    if (action === "publish" && blockers.length > 0) {
      setError(`还不能发布：${formatBlockers(blockers)}`);
      return;
    }
    if (action === "save" && !hasAnyContent) {
      setError("还没有任何内容：先写点文字或选一张图，再保存草稿。");
      return;
    }
    setBusy(true);
    try {
      // 先保证工作草稿 = 界面内容（commit 事务里双版本检查的草稿版本必须是最新的）。
      // R1：saveNow 在保存失败/412/401/暂停/未就绪时抛错 → 这里直接中止，绝不 commit 旧草稿。
      const saved = await workDraft.saveNow();
      if (!saved) {
        setError("草稿还没有同步成功，请检查网络后重试；输入都还在。");
        return;
      }
      const outcome = saved;
      const committed = await commitWorkDraft(
        csrfToken,
        outcome.draft.id,
        outcome.draft.draft_version,
        {
          action,
          expectedTargetVersion: targetId ? targetVersion : null,
          commitKey: createCommitKey(action),
        },
      );
      commitKeyRef.current = null;
      // 显式提交成功后清掉本机恢复副本：下次打开不会误报「本机有未同步的修改」。
      // 失败时**不**清（输入要保留）；只有内容版本仍等于提交快照的版本才清，
      // 提交期间用户又输入的全新内容必须保留（R1 关闭条件）。
      workDraft.discardLocalCopyIfUnchanged(outcome.contentVersion);
      setResult(committed);
    } catch (failure) {
      setError(saveFailureMessage(failure));
      setFieldErrors(fieldMessages(failure));
    } finally {
      setBusy(false);
    }
  };

  const startAnother = (): void => {
    if (onStartAnother) {
      onStartAnother();
      return;
    }
    router.replace(withReturnTo("/admin/moments/new", returnTo));
  };

  const continueEditing = (): void => {
    if (!result) return;
    router.replace(withReturnTo(`/admin/moments/${result.target_id}/edit`, returnTo));
  };

  const adoptLocal = (): void => {
    // 采用本机：hook 会把本机副本标记为待同步；界面已是本机内容（seed 时已回填）。
    workDraft.adoptLocalCopy();
    setNotice("已采用本机修改，接下来会同步到服务端工作草稿。");
  };

  const discardLocal = (): void => {
    // 放弃本机：恢复服务端工作草稿（没有就恢复页面初始内容），不静默保留本机改动。
    workDraft.discardLocalCopy();
    const snapshot = workDraft.draft;
    const data = snapshot ? readMomentDraftData(snapshot.data) : initialData;
    seededRef.current = true;
    touchedRef.current = false;
    setText(data.text);
    setTagsInput(data.tags.join(" "));
    setAlbumLinks(data.album_links);
    setImages(
      snapshot
        ? snapshot.images.map((image) => ({
            media_id: image.media_id,
            alt: image.alt ?? "",
            ...(image.media ? { media: image.media } : {}),
          }))
        : initialImages,
    );
    setNotice("已放弃本机修改，载入服务器上的内容。");
  };

  const goBack = (): void => {
    // EditorShell 的返回按钮也走同一条 returnTo；这里的成功页按钮保持一致。
    router.replace(safeInternalPath(returnTo) ?? "/admin");
  };

  const uploaderImages: UploadedImage[] = images.map((image) => ({
    mediaId: image.media_id,
    alt: image.alt,
    upload: {
      id: image.media_id,
      mime_type: image.media?.mime_type ?? "",
      bytes: image.media?.bytes ?? 0,
      width: image.media?.width ?? 0,
      height: image.media?.height ?? 0,
      status: image.media?.status ?? "ready",
      variants: image.media?.variants ?? [],
      original_url: image.media?.original_url ?? "",
    },
  }));

  // ---------- 提交成功页：离开编辑状态（避免继续 PATCH 一份已提交的草稿） ----------
  if (result) {
    const published = result.status === "published";
    return (
      <EditorShell
        title={published ? "已发布动态" : "已保存草稿"}
        subtitle="提交结果来自服务端；下面按真实状态给出下一步。"
        returnTo={returnTo}
        contentType="moment"
        status={<SyncStatus state="synced" message="已提交" lastSyncedAt={null} />}
        actions={null}
      >
        <section
          className="ins-editor-success"
          data-editor-success
          data-editor-status={published ? "published" : "draft"}
          role="status"
        >
          <h2>{published ? "发布成功" : "草稿已保存"}</h2>
          <p>{commitSuccessHint(result)}</p>
          <div className="ins-editor-success-act">
            {published ? (
              <Link className="ws-btn" href={`/apps/ins/${result.target_id}`} data-editor-view>
                查看动态
              </Link>
            ) : (
              <button type="button" className="ws-btn" onClick={continueEditing} data-editor-continue>
                继续编辑
              </button>
            )}
            <button type="button" className="ws-btn" onClick={startAnother} data-editor-again>
              再发一条
            </button>
            <button type="button" className="ws-btn" onClick={goBack} data-editor-back-source>
              返回来源
            </button>
          </div>
        </section>
      </EditorShell>
    );
  }

  const actions = (
    <>
      <button
        type="button"
        className="ws-btn"
        data-editor-save
        data-editor-submit-action={saveAction}
        disabled={busy || blocked}
        onClick={() => void submit(saveAction)}
      >
        {busy ? "提交中…" : submitLabel(saveAction)}
      </button>
      {publishable ? (
        <button
          type="button"
          className="ws-btn ws-btn-primary"
          data-editor-publish
          data-editor-submit-action="publish"
          disabled={busy || blocked}
          onClick={() => void submit("publish")}
        >
          {busy ? "提交中…" : submitLabel("publish")}
        </button>
      ) : null}
    </>
  );

  return (
    <EditorShell
      title={targetId ? "编辑动态" : "新建动态"}
      subtitle={
        targetId
          ? "自动保存写入工作草稿；只有明确提交才会改动正式内容。"
          : "先选图片、再写文字；未选图也能保存草稿。"
      }
      returnTo={returnTo}
      contentType="moment"
      status={
        <div data-editor-status={targetStatus ?? "draft"}>
          <SyncStatus
            state={workDraft.state}
            message={workDraft.syncMessage}
            lastSyncedAt={workDraft.lastSyncedAt}
          />
        </div>
      }
      actions={actions}
    >
      {workDraft.recoveryNotice ? (
        <section className="ins-editor-notice" role="status" data-editor-recovery>
          <p>{workDraft.recoveryNotice}</p>
          {/* 契约 §9.4：本机副本与服务器不一致时由用户显式选择，不静默覆盖。 */}
          <div className="ins-editor-recovery-act">
            <button type="button" className="ws-btn" onClick={adoptLocal} data-editor-recovery-adopt>
              采用本机修改
            </button>
            <button type="button" className="ws-btn" onClick={discardLocal} data-editor-recovery-discard>
              放弃本机，载入服务器内容
            </button>
          </div>
        </section>
      ) : null}
      {workDraft.authExpired ? (
        <p className="ins-editor-error" role="alert" data-editor-auth-expired>
          登录已失效，本机输入已保留。{" "}
          <Link href={withReturnTo("/admin/login", returnTo)}>去登录</Link>
        </p>
      ) : null}

      {resumeBlocked ? (
        /* R2：指定草稿没有恢复成功 —— 必须可见、不得静默当空白页正常编辑/提交。 */
        <section className="ins-editor-error" role="alert" data-editor-resume-error>
          <p>{workDraft.resumeError}</p>
          <p className="ins-editor-hint">
            这份草稿没有被加载；新建空白内容会换一份新的编辑会话（不会覆盖原草稿）。
          </p>
          <div className="ins-editor-recovery-act">
            <Link className="ws-btn" href={blankHref} data-editor-resume-blank>
              新建空白内容
            </Link>
            <Link className="ws-btn" href={returnTo ?? "/admin"} data-editor-resume-back>
              返回创作台
            </Link>
          </div>
        </section>
      ) : null}

      {conflict ? (
        <ConflictNotice
          message={workDraft.syncMessage}
          onReload={() => {
            pendingConflictChoiceRef.current = "reload-latest";
            void workDraft.resolveConflict("reload-latest");
          }}
          onSaveAsNew={() => {
            pendingConflictChoiceRef.current = "save-as-new";
            void workDraft.resolveConflict("save-as-new");
          }}
        />
      ) : null}

      {error ? (
        <p className="ins-editor-error" role="alert" data-editor-error>
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="ins-editor-notice" role="status">
          {notice}
        </p>
      ) : null}

      {/* ① 图片优先：首屏主动作是选图 / 上传，草稿允许暂时没有图片。 */}
      <section className="ins-editor-media" aria-label="图片">
        <div className="ins-editor-section-head">
          <h2>图片</h2>
          <p className="ins-editor-hint">
            {images.length === 0
              ? "草稿可以先不选图；正式发布需要 1–9 张图片。"
              : `已选 ${images.length} / ${IMAGES_MAX} 张；顺序即发布顺序。`}
          </p>
          <button
            type="button"
            className="ws-btn ws-btn-primary"
            data-media-picker-open
            onClick={() => setPickerOpen(true)}
            disabled={busy || resumeBlocked}
          >
            {images.length === 0 ? "选择图片 / 上传新图" : "编辑已选图片（排序 / 替代文本 / 移除）"}
          </button>
        </div>

        {images.length === 0 ? (
          <p className="ins-editor-hint" data-editor-media-empty>
            先点「选择图片 / 上传新图」从媒体库选或上传；没有图片也可以先写文字并保存草稿。
          </p>
        ) : (
          <ol className="ins-editor-thumbs">
            {images.map((image, index) => (
              <li key={image.media_id} className="ins-editor-thumb" data-editor-image={image.media_id}>
                {image.media ? (
                  <MediaThumb media={image.media} size="sm" />
                ) : (
                  <span className="mpx-thumb is-sm is-fallback" aria-hidden="true">
                    无预览
                  </span>
                )}
                <span className="ins-editor-thumb-meta">
                  第 {index + 1} 张 · {image.media ? `${image.media.width}×${image.media.height}` : "尺寸读取中"}
                </span>
                <span className="ins-editor-thumb-alt">
                  {image.alt.trim() ? image.alt : "（缺替代文本，发布前必填）"}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* ② 文字与标签 */}
      <section className="ins-editor-text" aria-label="文字">
        <label className="ins-editor-field">
          <span>文字（最多 2000 字，可留空；按纯文本展示）</span>
          <textarea
            value={text}
            rows={6}
            maxLength={2000}
            data-editor-field="text"
            data-editor-text
            onChange={(event) => changeText(event.target.value)}
            aria-invalid={fieldErrors.text ? true : undefined}
          />
          <small>{Array.from(text).length} / 2000 码点</small>
          {fieldErrors.text ? <em role="alert">{fieldErrors.text}</em> : null}
        </label>

        <label className="ins-editor-field">
          <span>标签（空白 / 逗号 / 顿号分隔，最多 8 个，单个 1–24 字）</span>
          <input
            type="text"
            value={tagsInput}
            data-editor-tags
            onChange={(event) => changeTags(event.target.value)}
            aria-invalid={fieldErrors.tags ? true : undefined}
          />
          {fieldErrors.tags ? <em role="alert">{fieldErrors.tags}</em> : null}
        </label>
      </section>

      {/* ③ 收录到相册（可选；复用现有 AlbumLinksEditor 语义） */}
      {images.length > 0 ? (
        <AlbumLinksEditor
          images={uploaderImages}
          links={albumLinks}
          onChange={changeAlbumLinks}
          describeError={describeEditorFailure}
          fieldError={fieldErrors.album_links ?? null}
          disabled={busy || blocked}
          onCreateAlbum={openAlbumAdmin}
        />
      ) : (
        <p className="ins-editor-hint" data-editor-albums-hint>
          「收录到相册」是可选项：先选好图片，再回来勾选要同时收录的相册。
        </p>
      )}

      {/* ④ 发布前集中列出阻塞原因 */}
      {publishable && blockers.length > 0 ? (
        <section className="ins-editor-blockers" data-editor-blockers aria-label="发布前仍需处理">
          <h2>发布前仍需处理（{blockers.length} 项）</h2>
          <ul>
            {blockers.map((blocker) => (
              <li key={`${blocker.field}:${blocker.message}`}>{blocker.message}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ⑤ 预览（不必整站渲染） */}
      <section className="ins-editor-preview-wrap" aria-label="发布预览">
        <button
          type="button"
          className="ws-btn"
          onClick={() => setPreviewOpen((value) => !value)}
          data-editor-preview-toggle
        >
          {previewOpen ? "关闭预览" : "预览（文字 / 图片顺序 / 收录摘要）"}
        </button>
        {previewOpen ? (
          <div className="ins-editor-preview" data-editor-preview>
            <p className="ins-editor-preview-text">{text || "（无文字）"}</p>
            <ol className="ins-editor-preview-images">
              {images.map((image, index) => (
                <li key={image.media_id}>
                  {image.media ? <MediaThumb media={image.media} size="sm" /> : null}
                  <span>
                    第 {index + 1} 张 · {image.alt || "（缺替代文本）"}
                  </span>
                </li>
              ))}
            </ol>
            <p className="ins-editor-hint">
              {(() => {
                const summary = albumLinkSummary(cleanAlbumLinksForSubmit(albumLinks));
                return summary.albums > 0
                  ? `收录摘要：${summary.media} 张图到 ${summary.albums} 个相册（相册未公开时暂不展示）。`
                  : "收录摘要：没有选择相册（可选项）。";
              })()}
            </p>
          </div>
        ) : null}
      </section>

      <MediaPickerDialog
        open={pickerOpen}
        csrfToken={csrfToken}
        selected={images}
        max={IMAGES_MAX}
        onConfirm={(next) => {
          setPickerOpen(false);
          applyImages(next);
          setNotice(`已更新图片选择：${next.length} 张（顺序即发布顺序）。`);
        }}
        onClose={() => setPickerOpen(false)}
      />
    </EditorShell>
  );
}

/** 提交失败的文案：冲突/缺失版本/422 字段都如实说明，并强调输入还在。 */
export function describeCommitFailure(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 412) {
      return "内容已在其他设备更新（版本冲突）。你的输入都还在：请回到来源页重新打开这条动态，再提交一次。";
    }
    if (error.status === 428) {
      return "缺少草稿版本条件，请刷新页面后重试；输入都还在。";
    }
    if (error.status === 401) {
      return "登录已失效，本机输入都还在。请重新登录后再提交。";
    }
    if (error.status === 422) {
      const detail = Object.values(fieldMessages(error)).join("；");
      return `服务端拒绝了这次提交${detail ? `：${detail}` : `：${error.message}`}。输入都还在，修改后可以重试。`;
    }
    if (error.status === 409) return error.message || "当前状态不允许这个提交动作。";
    return error.message || `提交失败（HTTP ${error.status}）。`;
  }
  if (error instanceof ApiTransportError) {
    return "连不上服务，提交没有完成；输入都还在。重试会复用同一个提交键，不会重复发布。";
  }
  return "提交失败，输入都还在，请稍后重试。";
}

/**
 * 保存（`saveNow()`）失败的展示文案（R1）。
 *
 * 显式提交前的保存失败与提交失败分开说：`WorkDraftSaveError` 已带准确中文文案
 * （412→冲突、401→登录失效、断网→本机保留…），其它错误才走提交失败文案。
 */
export function saveFailureMessage(error: unknown): string {
  if (error instanceof WorkDraftSaveError) return error.message;
  return describeCommitFailure(error);
}

/** 编辑器内其它读取（相册列表等）失败的文案。 */
export function describeEditorFailure(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 401) return "登录已失效，请重新登录后再试。";
    if (error.status === 403) return "请求来源或 CSRF 校验失败，请刷新页面后重试。";
    return error.message || `读取失败（HTTP ${error.status}）。`;
  }
  if (error instanceof ApiTransportError) return "连不上服务，请检查网络后重试。";
  return "操作失败，请稍后重试。";
}
