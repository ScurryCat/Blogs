"use client";

/**
 * 问题记录的手机内置应用（T09 · 印象空间）。
 *
 * 与技能全书同形：手机与独立页读**同一份数据**、渲染**同一个**视图组件。
 * 这里只负责屏幕路由与「在独立页打开」的宿主调用（02 §4：模块不播动画、
 * 不锁 body、不加音频、不覆写 history）。
 *
 * 屏幕：
 *   - `records` 列表（默认屏）—— 与 `/apps/metanav/mementos` 同一份数据；
 *   - `record`  单条（`item` 是 slug；非 slug 显示「不存在」，不执行任意路径）。
 *
 * **不替代 T04 的分类探索**：分类屏仍在 T04 的 metanav 应用里
 * （`screen=mugen`），这里只提供一条通往它的入口链接。
 */

import type { ReactNode } from "react";

import type { PhoneViewProps } from "@/features/phone/types";

import { useFeatureFetch } from "@/features/growth-fetch/use-fetch";

import { fetchRecord, fetchRecords, fetchRecordStats } from "./api";
import { classifyFailure } from "./failure";
import { MementosReading } from "./mementos-reading";
import { MementosView } from "./mementos-view";
import { CATEGORY_EXPLORATION_PATH, MEMENTOS_PATH } from "./paths";
import "@/features/exploration/exploration.css";
import {
  RECORD_PAGE_SIZE,
  type RecordDetail,
  type RecordPage,
  type RecordStats,
} from "./types";

interface Loaded {
  page: RecordPage;
  stats: RecordStats | null;
}

/** 与 `phone-app.tsx` 的 `screens` 保持一致；顺序即默认屏优先顺序。 */
export const EXPLORATION_APP_SCREENS = ["records", "record"] as const;

/** slug 只允许小写字母 / 数字 / 连字符 —— 与后端的 SLUG_PATTERN 一致。 */
export function isRecordSlug(value: string | null | undefined): value is string {
  return !!value && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export function ExplorationPhoneView({ screen, item, host }: PhoneViewProps): ReactNode {
  if (screen === "record") {
    if (!isRecordSlug(item)) {
      return (
        <Missing
          title="这条记录不存在"
          body="链接里的名字不是有效的记录 slug。"
          onBack={() => host.navigateScreen("records")}
        />
      );
    }
    return (
      <RecordScreen
        slug={item}
        onOpenFull={() =>
          host.openSiteContent({
            destination: `${MEMENTOS_PATH}/${encodeURIComponent(item)}`,
            source: "phone-link",
          })
        }
      />
    );
  }

  return (
    <RecordsScreen
      onOpenRecord={(slug) => host.navigateScreen("record", slug)}
      onOpenFull={() =>
        host.openSiteContent({ destination: MEMENTOS_PATH, source: "phone-link" })
      }
      onOpenCategory={() =>
        host.openSiteContent({ destination: CATEGORY_EXPLORATION_PATH, source: "phone-link" })
      }
    />
  );
}

function Missing({
  title,
  body,
  onBack,
}: {
  title: string;
  body: string;
  onBack: () => void;
}): ReactNode {
  return (
    <div className="pme-wrap">
      <p className="pme-kicker">NOT FOUND</p>
      <h2 className="pme-title">{title}</h2>
      <p className="pme-hint">{body}</p>
      <div className="pme-actions">
        <button className="pme-button" type="button" onClick={onBack}>
          回到列表
        </button>
      </div>
    </div>
  );
}

function RecordsScreen({
  onOpenRecord,
  onOpenFull,
  onOpenCategory,
}: {
  onOpenRecord: (slug: string) => void;
  onOpenFull: () => void;
  onOpenCategory: () => void;
}): ReactNode {
  const { state, reload } = useFeatureFetch<Loaded>("records", async (signal) => {
    const page = await fetchRecords({ limit: RECORD_PAGE_SIZE }, signal);
    const stats = await fetchRecordStats(signal).catch(() => null);
    return { page, stats };
  });

  if (state.status === "loading") {
    return (
      <p className="pme-hint" role="status">
        正在读取问题记录…
      </p>
    );
  }

  if (state.status === "failed") {
    return (
      <div className="pme-wrap" role="alert">
        <p className="pme-alert">{classifyFailure(state.error).message}</p>
        <div className="pme-actions">
          <button className="pme-button" type="button" onClick={reload}>
            重新读取
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <MementosView
        initialRecords={state.data.page.items}
        initialCursor={state.data.page.next_cursor}
        stats={state.data.stats}
        loadError={null}
        workStatus={null}
      />
      <p className="pme-hint">
        <button className="pme-button pme-button-ghost" type="button" onClick={onOpenFull} data-open-full="">
          在独立页打开
        </button>{" "}
        <button className="pme-button pme-button-ghost" type="button" onClick={onOpenCategory} data-open-category="">
          按文章分类探索
        </button>
      </p>
      {state.data.page.items.length ? (
        <ul className="pme-links" aria-label="快速跳到记录详情">
          {state.data.page.items.map((record) => (
            <li key={record.id}>
              <button
                className="pme-chip"
                type="button"
                onClick={() => onOpenRecord(record.slug)}
                data-phone-record={record.slug}
              >
                {record.title}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function RecordScreen({
  slug,
  onOpenFull,
}: {
  slug: string;
  onOpenFull: () => void;
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
      <div className="pme-wrap" role="alert" data-phone-record-failure={failure.kind}>
        <p className="pme-alert">{failure.message}</p>
        <div className="pme-actions">
          <button className="pme-button" type="button" onClick={reload}>
            重新读取
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <MementosReading record={state.data} backWorkStatus={null} />
      <p className="pme-hint">
        <button className="pme-button pme-button-ghost" type="button" onClick={onOpenFull} data-open-full="">
          在独立页打开这条记录
        </button>
      </p>
    </div>
  );
}
