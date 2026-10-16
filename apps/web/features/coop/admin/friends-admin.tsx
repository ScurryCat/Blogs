"use client";

/**
 * `/admin/friends` 的客户端主体：维护、排序、发布 / 撤回、软删除。
 *
 *  - 页面**不做**访问控制（01 §3：隐藏按钮不是安全边界）：真实权限、CSRF、
 *    版本条件与校验都在 FastAPI；
 *  - 每个写操作都带 CSRF token 与 `If-Match`；412 时**保留站主没保存的输入**，
 *    只提示「先重新读取最新版本」（05 §7）；
 *  - 排序只提交真的变了的行（见 `admin/form.ts` 的 `planReorder`）；
 *  - 头像走 T01 的共享上传端点（`POST /admin/media`），拿到 `id` 后写入
 *    `avatar_media_id`；不另写一套上传，也不绕过媒体授权。
 */

import { useCallback, useEffect, useState, type ChangeEvent, type ReactNode } from "react";

import { ApiClientError } from "@/lib/api/client";
import {
  AdminNotice,
  describeWriteFailure,
  unauthorisedHint,
  useAdminSession,
} from "@/features/metanav/admin/session";

import {
  createFriendLink,
  deleteFriendLink,
  listAdminFriendLinks,
  publishFriendLink,
  unpublishFriendLink,
  updateFriendLink,
  uploadAvatar,
} from "../api";
import type { FriendDraft, FriendLinkAdmin } from "../types";
import { emptyDraft, draftFromLink, draftToCreate, draftToPatch, planReorder } from "./form";

type ListState =
  | { status: "loading" }
  | { status: "ready"; items: FriendLinkAdmin[] }
  | { status: "failed"; message: string };

type EditorState =
  | { mode: "closed" }
  | { mode: "create"; draft: FriendDraft }
  | { mode: "edit"; id: string; version: number; draft: FriendDraft; original: FriendLinkAdmin };

export function FriendsAdmin(): ReactNode {
  const { state: sessionState, reload: reloadSession } = useAdminSession();
  const [editor, setEditor] = useState<EditorState>({ mode: "closed" });
  const [notice, setNotice] = useState<{ tone: "info" | "error"; message: ReactNode } | null>(null);
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0);
  // 「加载中」是派生状态（requestKey 与结果配对），不在 effect 里同步 setState ——
  // 后者会触发级联渲染（React 的 set-state-in-effect，T04 的 useLoader 已记录该经验）。
  const requestKey = String(nonce);
  const [result, setResult] = useState<{
    key: string;
    status: "ready" | "failed";
    items: FriendLinkAdmin[];
    message: string | null;
  } | null>(null);

  const csrf = sessionState.status === "ready" ? sessionState.session.csrf_token : null;

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    listAdminFriendLinks(controller.signal)
      .then((page) => {
        if (cancelled) return;
        setResult({ key: requestKey, status: "ready", items: page.items, message: null });
      })
      .catch((error: unknown) => {
        if (cancelled || controller.signal.aborted) return;
        const message =
          error instanceof ApiClientError
            ? `读取失败（HTTP ${error.status} · ${error.code}）`
            : "连不上服务，读不到友链列表。";
        setResult({ key: requestKey, status: "failed", items: [], message });
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [requestKey]);

  const list: ListState =
    result && result.key === requestKey
      ? result.status === "ready"
        ? { status: "ready", items: result.items }
        : { status: "failed", message: result.message ?? "读取失败" }
      : { status: "loading" };

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  const run = useCallback(
    async (action: () => Promise<unknown>, successMessage: string | null, keepDraft = false) => {
      setBusy(true);
      setNotice(null);
      try {
        await action();
        if (successMessage) setNotice({ tone: "info", message: successMessage });
        reload();
        if (!keepDraft) setEditor({ mode: "closed" });
      } catch (error) {
        const failure = describeWriteFailure(error);
        setNotice({ tone: "error", message: failure.message });
        // 412 / 428：站主的输入留着，让他决定是否覆盖（这里不动 editor）。
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  if (sessionState.status === "loading") {
    return (
      <AdminNotice>
        <span role="status">正在确认站主会话…</span>
      </AdminNotice>
    );
  }

  if (sessionState.status === "failed") {
    return (
      <AdminNotice tone="error">
        {sessionState.message}
        <button type="button" onClick={reloadSession}>
          重试
        </button>
      </AdminNotice>
    );
  }

  if (sessionState.session.authenticated !== true || !csrf) {
    return <AdminNotice tone="error">{unauthorisedHint()}</AdminNotice>;
  }

  return (
    <div className="coop-admin">
      <header className="coop-admin-head">
        <h2>友链 / 协助者</h2>
        <p>
          这里维护的是<strong>真实站点</strong>。角色联系人属于同人剧情（另一个数据域），
          不要把虚构角色加进这份名单。
        </p>
        <div className="coop-admin-actions">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setNotice(null);
              setEditor({ mode: "create", draft: emptyDraft() });
            }}
          >
            新建友链
          </button>
          <button type="button" onClick={reload} disabled={busy}>
            重新读取
          </button>
        </div>
      </header>

      {notice ? (
        <AdminNotice tone={notice.tone}>
          <span role={notice.tone === "error" ? "alert" : "status"}>{notice.message}</span>
        </AdminNotice>
      ) : null}

      {list.status === "loading" ? (
        <p role="status">正在读取友链…</p>
      ) : null}
      {list.status === "failed" ? (
        <p role="alert">
          {list.message}
          <button type="button" onClick={reload}>
            重试
          </button>
        </p>
      ) : null}
      {list.status === "ready" && list.items.length === 0 ? (
        <p role="status">还没有友链。真实站点才加进来；示例角色不是朋友。</p>
      ) : null}

      {list.status === "ready" && list.items.length > 0 ? (
        <table className="coop-admin-table">
          <caption className="sr-only">友链列表，按站主排序</caption>
          <thead>
            <tr>
              <th scope="col">顺序</th>
              <th scope="col">站名</th>
              <th scope="col">地址</th>
              <th scope="col">状态</th>
              <th scope="col">标签</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            {list.items.map((item, index) => (
              <tr key={item.id} data-friend-row={item.id}>
                <td>
                  <span className="coop-admin-pos">{item.position}</span>
                  <button
                    type="button"
                    aria-label={`把 ${item.name} 上移`}
                    disabled={busy || index === 0}
                    onClick={() => reorder(list.items, index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`把 ${item.name} 下移`}
                    disabled={busy || index === list.items.length - 1}
                    onClick={() => reorder(list.items, index, 1)}
                  >
                    ↓
                  </button>
                </td>
                <td>{item.name}</td>
                <td className="coop-admin-url">{item.url}</td>
                <td>
                  {item.deleted_at
                    ? "已删除"
                    : item.status === "published"
                      ? "已发布"
                      : "草稿"}
                </td>
                <td>{item.tags.map((tag) => tag.name).join("、")}</td>
                <td className="coop-admin-row-actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      setEditor({
                        mode: "edit",
                        id: item.id,
                        version: item.version,
                        draft: draftFromLink(item),
                        original: item,
                      })
                    }
                  >
                    编辑
                  </button>
                  {item.status === "published" ? (
                    <button
                      type="button"
                      disabled={busy || Boolean(item.deleted_at)}
                      onClick={() =>
                        run(
                          () => unpublishFriendLink(item.id, item.version, csrf),
                          `已撤回「${item.name}」，公开入口立刻读不到。`,
                        )
                      }
                    >
                      撤回
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy || Boolean(item.deleted_at)}
                      onClick={() =>
                        run(
                          () => publishFriendLink(item.id, item.version, csrf),
                          `已发布「${item.name}」。`,
                        )
                      }
                    >
                      发布
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy || Boolean(item.deleted_at)}
                    onClick={() => {
                      if (!window.confirm(`删除「${item.name}」？这是软删除，媒体文件不会被删。`)) return;
                      void run(() => deleteFriendLink(item.id, item.version, csrf), `已删除「${item.name}」。`);
                    }}
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {editor.mode !== "closed" ? (
        <FriendEditor
          title={editor.mode === "create" ? "新建友链（草稿）" : "编辑友链"}
          draft={editor.draft}
          busy={busy}
          csrf={csrf}
          onChange={(draft) =>
            setEditor((current) => (current.mode === "closed" ? current : { ...current, draft }))
          }
          onCancel={() => setEditor({ mode: "closed" })}
          onNotice={setNotice}
          onSave={() => {
            if (editor.mode === "create") {
              void run(
                () => createFriendLink(draftToCreate(editor.draft), csrf),
                "已保存为草稿。确认无误后再发布。",
              );
              return;
            }
            const patch = draftToPatch(editor.draft, editor.original);
            if (Object.keys(patch).length === 0) {
              setNotice({ tone: "info", message: "没有改动需要保存。" });
              return;
            }
            void run(
              () => updateFriendLink(editor.id, patch, editor.version, csrf),
              "已保存。",
            );
          }}
        />
      ) : null}
    </div>
  );

  async function reorder(items: readonly FriendLinkAdmin[], index: number, delta: -1 | 1): Promise<void> {
    const plan = planReorder(items, index, delta);
    if (!plan) return;
    setBusy(true);
    setNotice(null);
    try {
      // 逐条写回真正变化的行（每行带自己的 If-Match），完成后重新读取一次列表。
      for (const change of plan.changes) {
        await updateFriendLink(change.id, { position: change.position }, change.version, csrf as string);
      }
    } catch (error) {
      const failure = describeWriteFailure(error);
      setNotice({ tone: "error", message: `排序没有完全保存：${failure.message}` });
    } finally {
      setBusy(false);
      reload();
    }
  }
}

function FriendEditor({
  title,
  draft,
  busy,
  csrf,
  onChange,
  onCancel,
  onSave,
  onNotice,
}: {
  title: string;
  draft: FriendDraft;
  busy: boolean;
  csrf: string;
  onChange: (draft: FriendDraft) => void;
  onCancel: () => void;
  onSave: () => void;
  onNotice: (notice: { tone: "info" | "error"; message: ReactNode }) => void;
}): ReactNode {
  const update = (field: keyof FriendDraft) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    onChange({ ...draft, [field]: event.target.value });

  const onUpload = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const media = await uploadAvatar(file, csrf);
      onChange({ ...draft, avatarMediaId: media.id });
      onNotice({ tone: "info", message: `头像已上传，媒体 id：${media.id}` });
    } catch (error) {
      const failure = describeWriteFailure(error);
      onNotice({ tone: "error", message: `头像上传失败：${failure.message}` });
    }
  };

  return (
    <form
      className="coop-admin-editor"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <h3>{title}</h3>

      <label htmlFor="coop-name">
        站名
        <input id="coop-name" value={draft.name} onChange={update("name")} required maxLength={80} />
      </label>

      <label htmlFor="coop-url">
        HTTP(S) 地址
        <input
          id="coop-url"
          value={draft.url}
          onChange={update("url")}
          required
          placeholder="https://example.com/"
        />
      </label>

      <label htmlFor="coop-summary">
        简介（纯文本）
        <textarea id="coop-summary" value={draft.summary} onChange={update("summary")} rows={3} maxLength={500} />
      </label>

      <label htmlFor="coop-story">
        相识故事（可空，纯文本）
        <textarea id="coop-story" value={draft.story} onChange={update("story")} rows={4} maxLength={4000} />
      </label>

      <label htmlFor="coop-arcana">
        阿尔卡那装饰（可空，不是等级）
        <input id="coop-arcana" value={draft.arcana} onChange={update("arcana")} maxLength={60} placeholder="IX · HERMIT" />
      </label>

      <label htmlFor="coop-tags">
        标签（逗号分隔）
        <input id="coop-tags" value={draft.tags} onChange={update("tags")} placeholder="前端, 算法" />
      </label>

      <label htmlFor="coop-position">
        排序值（越小越靠前）
        <input id="coop-position" type="number" min={0} max={100000} value={draft.position} onChange={update("position")} />
      </label>

      <label htmlFor="coop-avatar-id">
        头像媒体 id（可空；也可直接上传）
        <input id="coop-avatar-id" value={draft.avatarMediaId} onChange={update("avatarMediaId")} />
      </label>

      <label htmlFor="coop-avatar-file">
        上传头像（走共享媒体权限）
        <input id="coop-avatar-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void onUpload(event)} />
      </label>

      <div className="coop-admin-actions">
        <button type="submit" disabled={busy}>
          {busy ? "正在保存…" : "保存"}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>
          取消
        </button>
      </div>
      <p className="coop-admin-hint">
        412（内容已在别处更新）时输入会保留：先「重新读取」，确认版本后再决定要不要覆盖。
      </p>
    </form>
  );
}
