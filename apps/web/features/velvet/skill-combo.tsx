"use client";

/**
 * 「合体」筛选（07 §6）—— 选两个技能，只看**同时**用到它们的公开作品。
 *
 * 这个控件的核心不是外观，而是**三种结果的区分**（07 §6、任务卡验收 1）：
 *
 * | 情况 | 服务端 | 界面 |
 * | --- | --- | --- |
 * | 两个技能相同 | 422 | 明确提示「需要两个不同的技能」，不发请求冒充结果 |
 * | 技能不存在 / 未发布 | 404 | 「技能不存在或未公开」，与空交集分开 |
 * | 交集为空 | 200 + `items: []` | 「还没有同时用到这两个技能的公开作品」 |
 *
 * 空交集**绝不**用 AI 或模板编造一件作品（07 §6 末段）—— 所以这里没有任何
 * 「推荐 / 生成」按钮，也没有占位卡片；只有一句实话和通往作品展厅的入口。
 *
 * 重复选择同一技能在前端就挡住（`disabled` + 提交前的判断），
 * 但**服务端才是权威**：绕过界面直接请求也会拿到 422（后端有用例）。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { SiteLink } from "@/features/runtime/navigation/site-link";

import { fetchCombo } from "./api";
import { describeComboFailure, isAbort } from "./failure";
import { projectPath } from "./paths";
import "@/features/velvet/velvet.css";
import { COMBO_EMPTY_NOTE, domainLabel, type SkillCombo, type SkillSummary } from "./types";

export interface SkillComboPanelProps {
  /** 当前已加载的公开技能（两个下拉都从这里取值，不额外请求）。 */
  skills: readonly SkillSummary[];
}

export function SkillComboPanel({ skills }: SkillComboPanelProps): ReactNode {
  const [first, setFirst] = useState<string>("");
  const [second, setSecond] = useState<string>("");
  /**
   * 结果与「它属于哪一对选择」配对保存。
   *
   * 为什么不是「一个 result + 一个 effect 在选项变化时清空它」：在 effect 体里同步
   * `setState` 会触发级联渲染（`react-hooks/set-state-in-effect`），而且读的时候
   * 仍然可能短暂看到**上一对选择**的结果。配对保存让「过期的结果」根本无法被渲染：
   * 键不匹配就等于没有结果。
   */
  const [result, setResult] = useState<{ key: string; combo: SkillCombo } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const inflight = useRef<AbortController | null>(null);

  useEffect(() => () => inflight.current?.abort(), []);

  const sameSkill = first !== "" && first === second;
  const ready = first !== "" && second !== "" && !sameSkill;
  const selectionKey = `${first}>${second}`;

  const bySlug = useMemo(() => {
    const map = new Map<string, SkillSummary>();
    for (const skill of skills) map.set(skill.slug, skill);
    return map;
  }, [skills]);

  const run = useCallback(async () => {
    if (!ready) return;
    const key = `${first}>${second}`;
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;
    setLoading(true);
    setResult(null);
    setFailure(null);
    try {
      const payload = await fetchCombo(first, second, controller.signal);
      setResult({ key, combo: payload });
    } catch (error) {
      if (isAbort(error)) return;
      setFailure({ key, message: describeComboFailure(error) });
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [first, second, ready]);

  // 只有「属于当前这一对选择」的结果 / 错误才会被渲染；换了选择自然就看不到了。
  const visibleResult = result && result.key === selectionKey ? result.combo : null;
  const visibleFailure = failure && failure.key === selectionKey ? failure.message : null;

  if (skills.length < 2) {
    return (
      <section className="plv-section" aria-labelledby="velvet-combo-heading">
        <h2 id="velvet-combo-heading">合体</h2>
        <p className="plv-hint">
          「合体」需要至少两门已公开的技能。现在只有 {skills.length} 门，
          所以这里不显示选择器 —— 没有可组合的内容时不给一个点不动的控件。
        </p>
      </section>
    );
  }

  return (
    <section className="plv-section" aria-labelledby="velvet-combo-heading" data-combo="">
      <h2 id="velvet-combo-heading">合体</h2>
      <p className="plv-hint">
        选两个技能，只看<b>同时</b>用到它们的公开作品。结果是交集：只有一件作品同时关联
        两者时才会出现；没有交集就是没有，不会临时生成一个作品。
      </p>

      <div className="plv-combo">
        <label className="plv-field">
          <span className="plv-field-label">技能 A</span>
          <select
            className="plv-select"
            value={first}
            onChange={(event) => setFirst(event.target.value)}
            data-combo-a=""
          >
            <option value="">请选择</option>
            {skills.map((skill) => (
              <option key={skill.id} value={skill.slug}>
                {`${skill.name}（${domainLabel(skill.domain)}）`}
              </option>
            ))}
          </select>
        </label>
        <span className="plv-glyph" aria-hidden="true">
          ×
        </span>
        <label className="plv-field">
          <span className="plv-field-label">技能 B</span>
          <select
            className="plv-select"
            value={second}
            onChange={(event) => setSecond(event.target.value)}
            data-combo-b=""
          >
            <option value="">请选择</option>
            {skills.map((skill) => (
              <option key={skill.id} value={skill.slug} disabled={skill.slug === first}>
                {`${skill.name}（${domainLabel(skill.domain)}）`}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="plv-actions">
        <button
          className="plv-button"
          type="button"
          onClick={() => void run()}
          disabled={!ready || loading}
          data-combo-run=""
        >
          {loading ? "正在筛选…" : "显示合体结果"}
        </button>
        {result ? (
          <button
            className="plv-button plv-button-ghost"
            type="button"
            onClick={() => {
              setResult(null);
              setFirst("");
              setSecond("");
            }}
          >
            清空
          </button>
        ) : null}
      </div>

      {sameSkill ? (
        <p className="plv-alert" role="alert" data-combo-same="">
          技能 A 与技能 B 是同一个技能。「合体」需要两个不同的技能 ——
          选同一个不会返回它的全部作品。
        </p>
      ) : null}

      {visibleFailure ? (
        <p className="plv-alert" role="alert" data-combo-failure="">
          {visibleFailure}
        </p>
      ) : null}

      {visibleResult ? (
        <div className="plv-evidence" data-combo-result="">
          <h3>
            {visibleResult.a.name} × {visibleResult.b.name}
          </h3>
          {visibleResult.items.length === 0 ? (
            <p className="plv-empty" role="status" data-combo-empty="">
              {visibleResult.note || COMBO_EMPTY_NOTE}
              {" "}
              想要一件同时用到两者的作品，只能真的做出来再发布 ——
              这一页不会替你生成一个。
              {" "}
              <SiteLink href="/showcase" source="phone-link">
                看看已有的作品
              </SiteLink>
            </p>
          ) : (
            <ul className="plv-project-list">
              {visibleResult.items.map((project) => (
                <li className="plv-project-row" key={project.id} data-combo-project={project.slug}>
                  <p className="plv-project-title">
                    <SiteLink href={projectPath(project.slug)} source="phone-link">
                      {project.title}
                    </SiteLink>
                  </p>
                  {project.summary ? (
                    <p className="plv-project-summary">{project.summary}</p>
                  ) : null}
                  <p className="plv-card-meta">
                    <span>{project.maintenance_label}</span>
                    <span>{project.published_at.slice(0, 10)}</span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {!ready && !sameSkill && (first || second) ? (
        <p className="plv-hint">
          {first && !second
            ? `再给技能 B 选一个不等于「${bySlug.get(first)?.name ?? first}」的技能。`
            : "还需要选中技能 A。"}
        </p>
      ) : null}
    </section>
  );
}
