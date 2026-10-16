"use client";

/**
 * 单条问题记录的浏览器端加载器（与技能详情加载器同形）。
 *
 * 三种状态必须分开（07 §6、ACCEPTANCE §1「失败状态可用」）：
 *   1. 读到 → `MementosReading`；
 *   2. 404（不存在 / 未发布 / 已撤回）→ 明确的「不存在或未公开」；
 *   3. 服务不可用 → 「暂时读不到」+ 重试，**不伪装成不存在**。
 */

import type { ReactNode } from "react";

import { useFeatureFetch } from "@/features/growth-fetch/use-fetch";
import { SiteLink } from "@/features/runtime/navigation/site-link";

import { fetchRecord } from "./api";
import { classifyFailure } from "./failure";
import { MementosReading } from "./mementos-reading";
import { MEMENTOS_PATH } from "./paths";
import type { RecordDetail } from "./types";
import "@/features/exploration/exploration.css";

export function MementosReadingLoader({
  slug,
  backWorkStatus = null,
}: {
  slug: string;
  backWorkStatus?: string | null;
}): ReactNode {
  const { state, reload } = useFeatureFetch<RecordDetail>(slug, (signal) =>
    fetchRecord(slug, signal),
  );

  if (state.status === "loading") {
    return (
      <p className="pme-hint" role="status">
        正在读取这条记录…
      </p>
    );
  }

  if (state.status === "failed") {
    const failure = classifyFailure(state.error);
    return (
      <div className="pme-wrap" role="alert" data-record-failure={failure.kind}>
        <p className="pme-alert">{failure.message}</p>
        <div className="pme-actions">
          <button className="pme-button" type="button" onClick={reload}>
            重新读取
          </button>
          <SiteLink className="pme-button pme-button-ghost" href={MEMENTOS_PATH} source="phone-link">
            回到问题记录列表
          </SiteLink>
        </div>
      </div>
    );
  }

  return <MementosReading record={state.data} backWorkStatus={backWorkStatus} />;
}
