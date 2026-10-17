"use client";

/**
 * 技能全书（07 §6「天鹅绒房间」）。
 *
 * 这是 `/velvet` 与手机内置应用**共用**的同一份视图（SHARED-CONTRACTS §1：
 * 同一内容在手机与 canonical 页面使用同一功能视图和数据）。
 *
 * 四件它刻意**不做**的事（07 §6、任务卡「不做」清单）：
 *
 *  1. 不显示等级 / 熟练度 / 完成度 —— 数据里没有这些字段，界面也不发明一个；
 *  2. 不把 `project_count` 说成「掌握度」：文案是「关联作品 N 件」，
 *     它是当前公开关联作品的实时计数；
 *  3. 不实现抽卡、面具养成或装备系统；
 *  4. 不用 AI 生成技能描述 —— 全部字段都来自站主手写的内容。
 *
 * 空态（07 §6 末段、验收 6）：真的没有公开技能时明确说明「技能全书还在整理」，
 * 并给出通往作品展厅的入口，而不是摆一排占位卡片。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { SiteLink } from "@/features/runtime/navigation/site-link";

import { fetchSkills } from "./api";
import { isAbort, SERVICE_UNAVAILABLE } from "./failure";
import { skillPath, velvetHref, VELVET_PATH } from "./paths";
import { SkillComboPanel } from "./skill-combo";
import "@/features/velvet/velvet.css";
import {
  SKILL_DOMAINS,
  SKILL_PAGE_SIZE,
  truncateScope,
  type SkillDomain,
  type SkillSummary,
} from "./types";

export interface VelvetViewProps {
  /** 服务端已经读到的第一页（可能为空数组）。 */
  initialSkills: readonly SkillSummary[];
  initialCursor: string | null;
  /** 服务端读取失败的原因；非 null 时首屏显示明确失败态而不是空态。 */
  loadError?: string | null;
  /** 当前领域筛选（来自 URL，服务端解析后传入）。 */
  domain?: SkillDomain | null;
  /**
   * 标题层级。
   *
   * 独立页 `/velvet` 由本视图自己出 `h1`（页面上只有一个主标题）；
   * 手机内置应用里宿主已经有自己的标题栏，本视图降成 `h2`，避免一页两个 `h1`。
   */
  headingLevel?: "h1" | "h2";
}

export function VelvetView({
  initialSkills,
  initialCursor,
  loadError = null,
  domain = null,
  headingLevel = "h1",
}: VelvetViewProps): ReactNode {
  const [skills, setSkills] = useState<readonly SkillSummary[]>(initialSkills);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(loadError);
  const inflight = useRef<AbortController | null>(null);

  /**
   * 服务端结果变化（切换领域后重新渲染）时把本地列表重置成新的那一份，
   * 避免显示上一份筛选的数据。
   *
   * 用「记住上一次的键」而不是 `useEffect`：在 effect 体里同步 `setState`
   * 会触发级联渲染，被 `react-hooks/set-state-in-effect` 判为错误
   * （T04 / T06 都为此重写过）。这个写法是 React 文档给出的
   * 「props 变化时重置 state」标准做法：在渲染期间比较，需要时才 set。
   */
  const incomingKey = `${domain ?? ""}|${initialCursor ?? ""}|${loadError ?? ""}|${
    initialSkills.length
  }|${initialSkills[0]?.id ?? ""}`;
  const [syncedKey, setSyncedKey] = useState(incomingKey);
  if (syncedKey !== incomingKey) {
    setSyncedKey(incomingKey);
    setSkills(initialSkills);
    setCursor(initialCursor);
    setFailure(loadError);
  }

  // 卸载时取消在途请求（ACCEPTANCE §1「模块退出取消读取与监听」）。
  useEffect(() => () => inflight.current?.abort(), []);

  /** 首屏读取失败后原地重试（不需要整页刷新）。 */
  const reload = useCallback(async () => {
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;
    setLoading(true);
    try {
      const page = await fetchSkills({ domain, limit: SKILL_PAGE_SIZE }, controller.signal);
      setSkills(page.items);
      setCursor(page.next_cursor);
      setFailure(null);
    } catch (error) {
      if (isAbort(error)) return;
      setFailure(SERVICE_UNAVAILABLE);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [domain]);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;
    setLoading(true);
    try {
      const page = await fetchSkills({ cursor, domain, limit: SKILL_PAGE_SIZE }, controller.signal);
      setSkills((previous) => [...previous, ...page.items]);
      setCursor(page.next_cursor);
      setFailure(null);
    } catch (error) {
      if (isAbort(error)) return;
      setFailure(SERVICE_UNAVAILABLE);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [cursor, domain]);

  const hasSkills = skills.length > 0;
  const Heading = headingLevel;

  return (
    <div className="plv-room" data-velvet-root="">
      <header className="plv-bar">
        <div>
          <p className="plv-kicker">{"// VELVET ROOM"}</p>
          <Heading className="plv-title">技能全书</Heading>
          <p className="plv-lead">
            这里记录已学习的领域、能力范围与<b>真实作品证据</b>。能力和作品的关系只有一份：
            技能页列出的作品就是作品页里写着的技能（
            <SiteLink href="/showcase" source="phone-link">
              我的殿堂
            </SiteLink>
            ）。
          </p>
        </div>
      </header>

      <section className="plv-gate" aria-labelledby="velvet-filter">
        <h2 id="velvet-filter" className="plv-hint">
          按领域查看
        </h2>
        <nav className="plv-tabs" aria-label="技能领域筛选">
          <SiteLink
            className="plv-tab"
            href={velvetHref()}
            source="phone-link"
            aria-current={domain === null ? "true" : undefined}
          >
            全部
          </SiteLink>
          {SKILL_DOMAINS.map((item) => (
            <SiteLink
              key={item.value}
              className="plv-tab"
              href={velvetHref({ domain: item.value })}
              source="phone-link"
              aria-current={domain === item.value ? "true" : undefined}
            >
              {item.label}
            </SiteLink>
          ))}
        </nav>
      </section>

      {failure ? (
        <p className="plv-alert" role="alert">
          {failure}{" "}
          <button
            type="button"
            className="plv-button"
            onClick={() => void reload()}
            disabled={loading}
          >
            {loading ? "正在重新读取…" : "重新读取"}
          </button>
        </p>
      ) : null}

      {!failure && !hasSkills ? (
        <p className="plv-empty" role="status" data-velvet-empty="">
          {domain
            ? "这个领域下还没有公开的技能。"
            : "技能全书还在整理：目前没有已发布的能力条目。"}
          {" "}未提供掌握证据的技能会保持草稿，不会自封等级出现在这里。
        </p>
      ) : null}

      {hasSkills ? (
        <SkillComboPanel skills={skills} />
      ) : null}

      {hasSkills ? (
        <ul className="plv-cards" data-velvet-skills="">
          {skills.map((skill) => (
            <li key={skill.id}>
              <SiteLink
                className="plv-card"
                href={skillPath(skill.slug)}
                source="phone-link"
                data-skill={skill.slug}
              >
                <span className="plv-card-head">
                  <span className="plv-card-name">{skill.name}</span>
                  <span className="plv-card-domain">{skill.domain_label}</span>
                </span>
                {skill.scope ? (
                  <span className="plv-card-scope">{truncateScope(skill.scope)}</span>
                ) : null}
                <span className="plv-card-meta">
                  <span>
                    关联作品 <strong>{skill.project_count}</strong> 件
                  </span>
                  {skill.links.length ? <span>外部证据 {skill.links.length} 条</span> : null}
                </span>
              </SiteLink>
            </li>
          ))}
        </ul>
      ) : null}

      {cursor ? (
        <div className="plv-actions">
          <button
            className="plv-button plv-button-ghost"
            type="button"
            onClick={() => void loadMore()}
            disabled={loading}
          >
            {loading ? "正在读取…" : "读取更多技能"}
          </button>
        </div>
      ) : null}

      <p className="plv-hint" data-velvet-path={VELVET_PATH}>
        这一页可以直接分享：<code>/velvet</code> 是技能全书的固定地址，
        每个技能也有自己的地址（<code>/velvet/&lt;slug&gt;</code>）。
      </p>
    </div>
  );
}
