"use client";

/**
 * 手记独立编辑页的数据装载器（P5 第一批 · C4）。
 *
 * 页面是客户端交互（草稿自动保存、图片选择、Markdown 预览），所以这里负责把页面
 * 打开前必须就绪的三件事读出来，再把**静态初值**交给 `JournalEditor`：
 *  1. 站主会话（只有 owner 才继续；匿名/失败不渲染编辑器）；
 *  2. 新建：站点时区「今天」（`GET /journal/calendar` 的 `today`/`timezone`）用于日期默认值；
 *     编辑：正式手记（`GET /admin/journal/entries/{id}`）与图片媒体详情；
 *  3. 关联文章的可选项（公开文章列表；失败不阻塞编辑，只提示暂时不能关联）。
 *
 * 注意：装载器**不做访问控制**（隐藏入口不是安全边界，权限在 FastAPI）；它只是按
 * 真实会话状态给出「去登录 / 重新读取 / 这篇不存在」等如实的界面状态。
 */

import { useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { getAdminMedia, type PickedImage } from "@/features/media-picker";
import { SiteLink } from "@/features/runtime/navigation/site-link";
import { readReturnTo } from "@/features/workspace/return-context";
import { useEntryId } from "@/features/workspace/use-entry-id";
import { useOwnerSession } from "@/features/workspace/session";
import { apiRequest } from "@/lib/api/client";

import { getAdminEntry, getCalendar } from "../api";
import styles from "../journal.module.css";
import type { JournalAdminEntry } from "../types";
import { JournalEditor } from "./journal-editor";
import {
  initialDateHint,
  postOptions,
  postOptionsWithCurrent,
  resolveInitialDate,
  type PostOption,
} from "./model";

interface SiteToday {
  today: string;
  timezone: string;
}

interface PublicPost {
  id: string;
  slug: string;
  title: string;
}

/** 站点时区「今天」（公开日历接口给出；取不到时组件层会用本机今天并在页面说明）。 */
function useSiteToday(enabled: boolean): { value: SiteToday | null; failed: boolean } {
  const [value, setValue] = useState<SiteToday | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    getCalendar({})
      .then((calendar) => {
        if (cancelled) return;
        setValue({ today: calendar.today, timezone: calendar.timezone });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { value, failed };
}

/** 公开文章列表（关联文章的可选项）：失败只降级这一项，不影响编辑器。 */
function usePublicPosts(enabled: boolean): {
  items: PublicPost[] | null;
  error: string | null;
} {
  const [items, setItems] = useState<PublicPost[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    apiRequest<{ items: PublicPost[]; next_cursor: string | null }>("/posts?limit=30")
      .then((page) => {
        if (!cancelled) setItems(page.items);
      })
      .catch(() => {
        if (cancelled) return;
        setError("公开文章列表暂时读不到，可以先不关联文章。");
        setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { items, error };
}

/**
 * 编辑已有手记时尽力补取图片的媒体详情（缩略图/尺寸）。
 *
 * 单张失败**不算整页失败**：仍然保留 `media_id + alt`，界面显示「缩略图暂时取不到」，
 * 不把「不在媒体库第一页/详情读失败」误判成「图片已失效」。
 */
async function loadEntryImages(entry: JournalAdminEntry): Promise<PickedImage[]> {
  const sorted = [...entry.images].sort((a, b) => a.position - b.position);
  return Promise.all(
    sorted.map(async (image) => {
      try {
        const media = await getAdminMedia(image.media_id);
        return {
          media_id: image.media_id,
          alt: image.alt,
          position: image.position,
          media,
        } satisfies PickedImage;
      } catch {
        return { media_id: image.media_id, alt: image.alt, position: image.position };
      }
    }),
  );
}

function Loading({ message }: { message: string }): ReactNode {
  return (
    <p className={styles.empty} role="status">
      {message}
    </p>
  );
}

function NeedLogin(): ReactNode {
  return (
    <div className={styles.empty} role="status">
      <h1 className={styles.title}>需要站主登录</h1>
      <p>手记编辑器只对站主开放；管理接口与工作草稿接口都会在后端再验证一次身份。</p>
      <SiteLink className={styles.button} href="/admin/login" source="top-nav">
        去登录
      </SiteLink>
    </div>
  );
}

function SessionFailed(): ReactNode {
  return (
    <div className={styles.empty} role="alert">
      <p>现在无法确认站主登录状态（网络或服务问题）。本页不会假装能编辑。</p>
      <SiteLink className={styles.button} href="/admin/login" source="top-nav">
        去登录页重新确认
      </SiteLink>
    </div>
  );
}

/** `/admin/journal/new` 的客户端装载器（支持 `?date=YYYY-MM-DD` 与 `?returnTo=`）。 */
export function JournalNewEditor(): ReactNode {
  const params = useSearchParams();
  const session = useOwnerSession();
  // 本机副本的稳定入口 id（C2 `useEntryId`）：写进 URL `?entry=`，刷新后还能恢复本机草稿。
  const entryId = useEntryId();
  const owner = session.status === "owner" && session.session?.user ? session.session : null;
  const today = useSiteToday(owner !== null);
  const posts = usePublicPosts(owner !== null);

  if (session.status === "loading") return <Loading message="正在确认站主身份…" />;
  if (session.status === "anonymous") return <NeedLogin />;
  if (!owner) return <SessionFailed />;
  if (!today.value && !today.failed) return <Loading message="正在读取站点时区…" />;
  if (!entryId) return <Loading message="正在准备编辑器…" />;

  const dateParam = params?.get("date") ?? null;
  const returnTo = readReturnTo(params);
  const initialDate = resolveInitialDate(dateParam, today.value?.today ?? null);
  const hint = initialDateHint(dateParam, initialDate, today.value?.today ?? null);

  return (
    <JournalEditor
      mode="new"
      entry={null}
      initialDate={initialDate}
      dateHint={hint}
      ownerId={owner.user!.id}
      csrfToken={owner.csrf_token}
      returnTo={returnTo}
      posts={posts.items ? postOptions(posts.items) : null}
      postsError={posts.error}
      images={[]}
      timezone={today.value?.timezone ?? null}
      today={today.value?.today ?? null}
      entryId={entryId}
    />
  );
}

/** `/admin/journal/[id]/edit` 的客户端装载器。 */
export function JournalEditEditor({ entryId }: { entryId: string }): ReactNode {
  const params = useSearchParams();
  const session = useOwnerSession();
  // 入口 id 只用于本机副本 key 与 URL 展示（key 最后一段仍是 targetId，不会串稿）。
  const editorEntryId = useEntryId();
  const owner = session.status === "owner" && session.session?.user ? session.session : null;
  const today = useSiteToday(owner !== null);
  const posts = usePublicPosts(owner !== null);
  const [nonce, setNonce] = useState(0);
  const [load, setLoad] = useState<
    | { status: "loading" }
    | { status: "ready"; entry: JournalAdminEntry; images: PickedImage[] }
    | { status: "failed"; message: string; retryable: boolean }
  >({ status: "loading" });

  useEffect(() => {
    if (!owner) return;
    let cancelled = false;
    getAdminEntry(entryId)
      .then(async (entry) => {
        if (cancelled) return;
        const images = await loadEntryImages(entry);
        if (cancelled) return;
        setLoad({ status: "ready", entry, images });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const status =
          error && typeof error === "object" && "status" in error
            ? (error as { status?: number }).status
            : undefined;
        const notFound = status === 404;
        setLoad({
          status: "failed",
          message: notFound
            ? "这篇手记不存在、已被删除，或者不属于当前站主（404）。"
            : `读取这篇手记失败${status ? `（HTTP ${status}）` : ""}；可以重试。`,
          retryable: !notFound,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [owner, entryId, nonce]);

  if (session.status === "loading") return <Loading message="正在确认站主身份…" />;
  if (session.status === "anonymous") return <NeedLogin />;
  if (!owner) return <SessionFailed />;
  if (!editorEntryId) return <Loading message="正在准备编辑器…" />;
  if (load.status === "loading") return <Loading message="正在读取这篇手记…" />;
  if (load.status === "failed") {
    return (
      <div className={styles.empty} role="alert" data-journal-editor-error>
        <p>{load.message}</p>
        <div className={styles.actions}>
          {load.retryable ? (
            <button
              className={styles.button}
              type="button"
              onClick={() => {
                setLoad({ status: "loading" });
                setNonce((value) => value + 1);
              }}
            >
              重新读取
            </button>
          ) : null}
          <SiteLink
            className={`${styles.button} ${styles.buttonGhost}`}
            href="/admin/journal"
            source="top-nav"
          >
            回到手记列表
          </SiteLink>
        </div>
      </div>
    );
  }

  const returnTo = readReturnTo(params);
  const postsWithCurrent = posts.items
    ? postOptionsWithCurrent(posts.items, load.entry.post)
    : load.entry.post
      ? postOptionsWithCurrent([], load.entry.post)
      : null;

  return (
    <JournalEditor
      mode="edit"
      entry={load.entry}
      initialDate={load.entry.entry_date}
      dateHint={null}
      ownerId={owner.user!.id}
      csrfToken={owner.csrf_token}
      returnTo={returnTo}
      posts={postsWithCurrent as PostOption[] | null}
      postsError={posts.error}
      images={load.images}
      timezone={today.value?.timezone ?? null}
      today={today.value?.today ?? null}
      entryId={editorEntryId}
    />
  );
}
