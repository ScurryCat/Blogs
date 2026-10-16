"use client";

/**
 * 专题阅读页的浏览器侧数据源（独立页）。
 *
 * 为什么有它：生产环境由 Next 服务端用 `API_INTERNAL_URL` 读取并渲染（见
 * `app/apps/metanav/palaces/[slug]/page.tsx`，那条路径能返回**真正的 404**）。
 * 本地开发不配置内部地址时，同一个视图改由浏览器同源读取 —— 与手机里的路径一致
 * （01 §2：浏览器只访问同源 `/api/v1`），不会因为少一个环境变量就白屏。
 *
 * 读取失败**不伪装成「没有文章」**：明确区分「已不再公开」与「服务不可用」。
 */

import type { ReactNode } from "react";

import { getPalace, listPalaces } from "./api";
import { useLoader } from "./host";
import { PalaceReading } from "./palace-reading";

export function PalaceReadingLoader({ slug }: { slug: string }): ReactNode {
  const { state, reload } = useLoader(
    async (signal) => {
      const palace = await getPalace(slug, signal);
      const others = await listPalaces(signal);
      return {
        palace,
        related: others.items.filter((item) => item.slug !== slug).slice(0, 3),
      };
    },
    [slug],
  );

  if (state.status === "loading") {
    return (
      <p className="data-notice" role="status">
        正在读取殿堂…
      </p>
    );
  }

  if (state.status === "failed") {
    // `state.failure` **已经是** classifyFailure 的结果（useLoader 里做的），
    // 再分类一次会把它降级成「服务不可用」——真实浏览器验收抓到过这个 bug。
    const failure = state.failure;
    return (
      <div className="data-notice" role="alert">
        {failure.kind === "not_found" ? (
          <>
            <p>这座殿堂现在不可读：可能已撤回、已撤下，或它关联的文章都已不再公开。</p>
            <p>这不是链接坏了，而是当前公开状态如此。</p>
          </>
        ) : (
          <p>{failure.message}</p>
        )}
        <button className="btn" type="button" onClick={reload}>
          <span>重新读取</span>
        </button>
      </div>
    );
  }

  return <PalaceReading palace={state.data.palace} related={state.data.related} />;
}
