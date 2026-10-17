"use client";

/**
 * 管理端单条动态 `/admin/moments/<uuid>`（T03）。
 *
 * 与列表页共用同一个工作台组件：`?id` 形式只是把该条动态直接打开，
 * 因此「列表 → 编辑」与「直接打开某条」走的是同一套读写逻辑，不会出现两套行为。
 *
 * 非 UUID / 缺失 id：显示明确提示并指向列表页，不做任意跳转。
 */

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { fetchAdminMoment, updateMoment } from "@/features/ins/api";
import { AlbumLinksEditor } from "@/features/ins/admin/album-links-editor";
import { MediaUploader, type UploadedImage } from "@/features/ins/admin/media-uploader";
import { fieldMessages, useAdminSession } from "@/features/ins/admin/session";
import {
  albumLinkSummary,
  cleanAlbumLinks,
  isMomentId,
  purgeAlbumLinks,
  validateAlbumLinks,
  validateDraftForPublish,
  type MomentAdmin,
  type MomentAlbumLink,
} from "@/features/ins/types";
import "@/features/ins/ins.css";

export default function AdminMomentDetailPage(): ReactNode {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const rawId = typeof params?.id === "string" ? params.id : "";
  const { session, phase, message: sessionMessage, describe, isConflict } = useAdminSession();

  const [moment, setMoment] = useState<MomentAdmin | null>(null);
  const [text, setText] = useState("");
  const [tags, setTags] = useState("");
  const [images, setImages] = useState<UploadedImage[]>([]);
  // 动态 → 相册的收录选择（第三轮 §4.2）：与列表页共用同一个编辑组件与语义。
  const [albumLinks, setAlbumLinks] = useState<MomentAlbumLink[]>([]);
  const [albumFieldError, setAlbumFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!isMomentId(rawId)) return;
    setBusy(true);
    setError(null);
    setAlbumFieldError(null);
    try {
      const payload = await fetchAdminMoment(rawId);
      setMoment(payload);
      setText(payload.text);
      setTags(payload.tags.map((tag) => tag.name).join(" "));
      setImages(
        payload.images_admin.map((image) => ({
          mediaId: image.media_id,
          alt: image.alt,
          upload: {
            id: image.media_id,
            mime_type: "",
            bytes: 0,
            width: 0,
            height: 0,
            status: "ready",
            variants: [],
            original_url: "",
          },
        })),
      );
      setAlbumLinks(
        (payload.album_links ?? []).map((link) => ({
          album_id: link.album_id,
          media_ids: [...link.media_ids],
        })),
      );
    } catch (failure) {
      setError(describe(failure));
    } finally {
      setBusy(false);
    }
  }, [describe, rawId]);

  useEffect(() => {
    // 会话就绪后读一次这条动态。`load` 的 setState 都在 `await` 之后，
    // 因此这里只是发起请求，不是级联渲染。
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 见上：setState 在 await 之后。
    if (session?.authenticated) void load();
  }, [load, session?.authenticated]);

  if (!isMomentId(rawId)) {
    return (
      <section className="ins-state" role="status">
        <p className="ins-state-kicker">BAD ID</p>
        <h1>动态编号不合法</h1>
        <p>管理端单条动态的地址必须是 UUID。请从列表进入。</p>
        <Link className="ins-btn" href="/admin/moments">
          回到动态列表
        </Link>
      </section>
    );
  }

  if (phase === "loading" || (session?.authenticated && busy && !moment)) {
    return <p className="ins-loading">正在读取动态…</p>;
  }

  if (!session?.authenticated) {
    return (
      <section className="ins-state" role="status">
        <p className="ins-state-kicker">SIGN IN</p>
        <h1>需要站主登录</h1>
        <p>{sessionMessage ?? "请先到站主登录页建立会话。"}</p>
        <Link className="ins-btn" href="/admin/login">
          去登录
        </Link>
      </section>
    );
  }

  const save = async (): Promise<void> => {
    if (!moment) return;
    const cleanedTags = tags
      .split(/[\s,，、]+/)
      .map((tag) => tag.trim())
      .filter(Boolean);
    const imageInputs = images.map((image, index) => ({
      media_id: image.mediaId,
      position: index,
      alt: image.alt.trim(),
    }));
    const issues = validateDraftForPublish({ text, images: imageInputs });
    const cleanedAlbumLinks = cleanAlbumLinks(albumLinks);
    const albumIssues = validateAlbumLinks(
      cleanedAlbumLinks,
      imageInputs.map((image) => image.media_id),
    );
    if (albumIssues.length) {
      setError(albumIssues.map((issue) => issue.message).join("；"));
      return;
    }
    setBusy(true);
    setError(null);
    setAlbumFieldError(null);
    try {
      const updated = await updateMoment(session.csrf_token, moment.id, moment.version, {
        text,
        tags: cleanedTags,
        images: imageInputs,
        // 完整选择（含 `[]` = 清空）；服务端负责事务内协调动态与相册（N3 契约 §3.6）。
        album_links: cleanedAlbumLinks,
      });
      setMoment(updated);
      setAlbumLinks(
        (updated.album_links ?? []).map((link) => ({
          album_id: link.album_id,
          media_ids: [...link.media_ids],
        })),
      );
      const albumSummary = albumLinkSummary(cleanedAlbumLinks);
      setNotice(
        `${
          issues.length
            ? `已保存（v${updated.version}）。还不能发布：${issues.map((issue) => issue.message).join("；")}`
            : `已保存（v${updated.version}）。`
        }${
          albumSummary.albums > 0
            ? ` 已收录 ${albumSummary.media} 张图到 ${albumSummary.albums} 个相册（相册未公开时暂不展示）。`
            : ""
        }`,
      );
    } catch (failure) {
      // 冲突时**保留输入**：只显示原因，不动 text / tags / images / albumLinks。
      setError(describe(failure));
      setAlbumFieldError(fieldMessages(failure).album_links ?? null);
      if (isConflict(failure)) {
        setNotice("版本冲突：输入都还在。点「重新读取」拿到最新版本后再决定怎么改。");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <header className="ins-admin-head">
        <h1>编辑动态</h1>
        <p>
          <Link href="/admin/moments">← 回到列表</Link>
          {moment ? ` · v${moment.version} · ${moment.status === "published" ? "已发布" : "草稿"}` : null}
        </p>
      </header>

      {error ? (
        <p className="ins-admin-notice" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="ins-admin-message" role="status">
          {notice}
        </p>
      ) : null}

      <label className="ins-admin-field">
        <span>文字（最多 2000 字）</span>
        <textarea value={text} rows={5} maxLength={2000} onChange={(event) => setText(event.target.value)} />
      </label>

      <label className="ins-admin-field">
        <span>标签（空白 / 逗号分隔）</span>
        <input type="text" value={tags} onChange={(event) => setTags(event.target.value)} />
      </label>

      <MediaUploader
        csrfToken={session.csrf_token}
        images={images}
        onChange={(nextImages) => {
          setImages(nextImages);
          // 移除的图片同步从收录选择里清掉，避免保存时被服务端 409 拒绝。
          setAlbumLinks((previous) =>
            purgeAlbumLinks(previous, nextImages.map((image) => image.mediaId)),
          );
        }}
        disabled={busy}
      />

      <AlbumLinksEditor
        images={images}
        links={albumLinks}
        onChange={setAlbumLinks}
        describeError={describe}
        fieldError={albumFieldError}
        disabled={busy}
      />

      <div className="ins-admin-act">
        <button type="button" className="ins-btn" onClick={() => void save()} disabled={busy || !moment}>
          保存草稿
        </button>
        <button type="button" className="ins-btn" onClick={() => void load()} disabled={busy}>
          重新读取
        </button>
        <button type="button" className="ins-btn" onClick={() => router.push("/admin/moments")}>
          回到列表
        </button>
      </div>
    </div>
  );
}
