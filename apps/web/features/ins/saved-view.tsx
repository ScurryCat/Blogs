"use client";

/**
 * 本机收藏视图（03 §7）。
 *
 * 规则：
 *  - 收藏列表通过 `useSyncExternalStore` 读取（服务端渲染为空，客户端接管后校正，
 *    不在 effect 里 setState）；
 *  - **再次打开必须重新确认内容仍公开**，因此每一条都会去读一次公开详情接口；
 *  - 已不可用的项显示「已不可用」并允许移除，不静默隐藏（03 §7）；
 *  - 界面明确写「仅此浏览器保存」，不承诺跨设备同步；
 *  - 存储不可用时仍然可以阅读（本页显示明确说明），只是收藏不会持久化。
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { ApiClientError, ApiTransportError } from "@/lib/api/client";

import { fetchMoment } from "./api";
import { useFavorites } from "./favorites-react";
import { formatPublishedAt, type Moment } from "./types";

type CheckResult =
  | { status: "available"; moment: Moment }
  | { status: "gone"; reason: string }
  | { status: "error"; reason: string };

export function SavedView(): ReactNode {
  const favorites = useFavorites();
  const [results, setResults] = useState<Record<string, CheckResult>>({});

  // 依赖是**稳定的 id 列表字符串**：状态更新不会重新触发读取；
  // 卸载时取消全部未完成请求（验收 §1：模块退出不留悬挂读取）。
  const idsKey = useMemo(
    () => favorites.entries.map((entry) => entry.id).join(","),
    [favorites.entries],
  );

  useEffect(() => {
    const ids = idsKey ? idsKey.split(",") : [];
    if (!ids.length) return undefined;
    const controllers: AbortController[] = [];
    for (const id of ids) {
      const controller = new AbortController();
      controllers.push(controller);
      void (async () => {
        const mark = (value: CheckResult) =>
          setResults((previous) => ({ ...previous, [id]: value }));
        try {
          const moment = await fetchMoment(id, controller.signal);
          if (controller.signal.aborted) return;
          mark({ status: "available", moment });
        } catch (error) {
          if (controller.signal.aborted) return;
          if (error instanceof DOMException && error.name === "AbortError") return;
          const gone = error instanceof ApiClientError && error.status === 404;
          mark({
            status: gone ? "gone" : "error",
            reason:
              error instanceof ApiTransportError
                ? "暂时读不到：网络或服务不可用。"
                : gone
                  ? "已不可用：这条动态已被撤回或删除。"
                  : `读取失败（HTTP ${(error as ApiClientError).status}）。`,
          });
        }
      })();
    }
    return () => controllers.forEach((controller) => controller.abort());
  }, [idsKey]);

  const remove = useCallback(
    (id: string) => {
      favorites.remove(id);
      setResults((previous) => {
        const next = { ...previous };
        delete next[id];
        return next;
      });
    },
    [favorites],
  );

  const total = favorites.entries.length;

  return (
    <section className="ins-saved" aria-label="本机收藏">
      <p className="ins-saved-note">
        收藏只保存在<strong>此浏览器</strong>里，不跨设备同步，也不上传正文或原图。
        {favorites.durable ? null : " 当前浏览器不允许本机存储，这里的记录刷新后会消失。"}
      </p>

      {total === 0 ? (
        <div className="ins-state" role="status">
          <p className="ins-state-kicker">EMPTY</p>
          <p>还没有收藏。在动态卡片上点「收藏」，只会记录在这台设备上。</p>
          <Link className="ins-btn" href="/apps/ins">
            去看动态
          </Link>
        </div>
      ) : (
        <ul className="ins-saved-list">
          {favorites.entries.map((entry) => {
            const state = results[entry.id];
            return (
              <li key={entry.id} className={`ins-saved-item is-${state?.status ?? "checking"}`}>
                {state?.status === "available" ? (
                  <Link className="ins-saved-link" href={`/apps/ins/${entry.id}`}>
                    <span className="ins-saved-text">{entry.excerpt || "（无文字）"}</span>
                    <span className="ins-saved-time">
                      {formatPublishedAt(state.moment.published_at)}
                    </span>
                  </Link>
                ) : (
                  <span className="ins-saved-text">
                    {entry.excerpt || "（无文字）"}
                    <em className="ins-saved-reason">
                      {state?.status === "gone" || state?.status === "error"
                        ? state.reason
                        : "正在确认是否仍可访问…"}
                    </em>
                  </span>
                )}
                <button
                  type="button"
                  className="ins-btn"
                  onClick={() => remove(entry.id)}
                  aria-label={`从收藏中移除：${entry.excerpt || entry.id}`}
                >
                  移除
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
