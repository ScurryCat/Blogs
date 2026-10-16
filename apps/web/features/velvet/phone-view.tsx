"use client";

/**
 * 手机内置应用里的技能全书（T09）。
 *
 * 手机与独立页读**同一份数据**、渲染**同一个** `VelvetView`
 * （SHARED-CONTRACTS §1）—— 这里只负责把宿主能提供的两件事接上：
 *
 *   - 领域筛选：手机内换屏（`screen` + `item`），不触发全站转场；
 *   - 「到独立页看完整内容」：`openSiteContent({ source: "phone-link" })`，
 *     由**宿主**决定过场效果，本模块不播动画、不锁 body、不加音频（02 §4）。
 *
 * 手机里刻意**不**放合体选择器以外的重型内容：`VelvetView` 已经把两个下拉
 * 压成一行（< 720px 时纵向堆叠），320px 下可用。
 */

import type { ReactNode } from "react";

import type { PhoneViewProps } from "@/features/phone/types";

import { useFeatureFetch } from "@/features/growth-fetch/use-fetch";

import { fetchSkill, fetchSkills } from "./api";
import { classifyFailure } from "./failure";
import { VELVET_PATH } from "./paths";
import { SkillReading } from "./skill-reading";
import "@/features/velvet/velvet.css";
import { SKILL_PAGE_SIZE, type SkillDetail, type SkillPage } from "./types";
import { VelvetView } from "./velvet-view";

/** 与 `phone-app.tsx` 的 `screens` 保持一致；顺序即默认屏优先顺序。 */
export const VELVET_APP_SCREENS = ["book", "skill"] as const;

/** slug 只允许小写字母 / 数字 / 连字符 —— 与后端的 SLUG_PATTERN 一致。 */
export function isSkillSlug(value: string | null | undefined): value is string {
  return !!value && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export function VelvetPhoneView({ screen, item, host }: PhoneViewProps): ReactNode {
  if (screen === "skill") {
    if (!isSkillSlug(item)) {
      return (
        <Missing
          title="这门技能不存在"
          body="链接里的名字不是有效的技能 slug。"
          onBack={() => host.navigateScreen("book")}
        />
      );
    }
    return (
      <SkillScreen
        slug={item}
        onOpenFull={() =>
          host.openSiteContent({ destination: `/velvet/${encodeURIComponent(item)}`, source: "phone-link" })
        }
      />
    );
  }

  return (
    <BookScreen
      onOpenSkill={(slug) => host.navigateScreen("skill", slug)}
      onOpenFull={() =>
        host.openSiteContent({ destination: VELVET_PATH, source: "phone-link" })
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
    <div className="plv-room">
      <p className="plv-kicker">NOT FOUND</p>
      <h2 className="plv-title">{title}</h2>
      <p className="plv-hint">{body}</p>
      <div className="plv-actions">
        <button className="plv-button" type="button" onClick={onBack}>
          回到技能全书
        </button>
      </div>
    </div>
  );
}

function BookScreen({
  onOpenSkill,
  onOpenFull,
}: {
  onOpenSkill: (slug: string) => void;
  onOpenFull: () => void;
}): ReactNode {
  const { state } = useFeatureFetch<SkillPage>("book", (signal) =>
    fetchSkills({ limit: SKILL_PAGE_SIZE }, signal),
  );

  if (state.status === "loading") {
    return (
      <p className="plv-hint" role="status">
        正在读取技能全书…
      </p>
    );
  }

  const skills = state.status === "ready" ? state.data.items : [];
  const cursor = state.status === "ready" ? state.data.next_cursor : null;

  return (
    <div className="plv-room">
      <VelvetView
        initialSkills={skills}
        initialCursor={cursor}
        loadError={state.status === "failed" ? classifyFailure(state.error).message : null}
        domain={null}
        headingLevel="h2"
      />
      <p className="plv-hint">
        在手机里点技能卡片会先在本应用内换屏（不播全站过场）。
        {" "}
        <button className="plv-button" type="button" onClick={onOpenFull} data-open-full="">
          在独立页打开
        </button>
      </p>
      {skills.length ? (
        <ul className="plv-evidence-list" aria-label="快速跳到技能详情">
          {skills.map((skill) => (
            <li key={skill.id}>
              <button
                className="plv-tab"
                type="button"
                onClick={() => onOpenSkill(skill.slug)}
                data-phone-skill={skill.slug}
              >
                {skill.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SkillScreen({
  slug,
  onOpenFull,
}: {
  slug: string;
  onOpenFull: () => void;
}): ReactNode {
  const { state, reload } = useFeatureFetch<SkillDetail>(slug, (signal) =>
    fetchSkill(slug, signal),
  );

  if (state.status === "loading") {
    return (
      <p className="plv-hint" role="status">
        正在读取技能…
      </p>
    );
  }

  if (state.status === "failed") {
    const failure = classifyFailure(state.error);
    return (
      <div className="plv-room" role="alert" data-phone-skill-failure={failure.kind}>
        <p className="plv-alert">{failure.message}</p>
        <div className="plv-actions">
          <button className="plv-button" type="button" onClick={reload}>
            重新读取
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <SkillReading skill={state.data} />
      <p className="plv-hint">
        <button className="plv-button" type="button" onClick={onOpenFull} data-open-full="">
          在独立页打开这门技能
        </button>
      </p>
    </div>
  );
}
