"use client";

/**
 * 放课后 · 快捷更新区（P5 · C4；契约 §4.5 / §9.6）。
 *
 * 定位：首页/🕹️ 里的「更新进度」从站主入口进来后，只改三个日常字段
 * （追番：集数、状态、短评，可选连载中；游戏：状态、累计时长、短评）。
 * 名称、封面、评分、通关日期、全成就等**完整信息仍在下方的现有完整编辑里**，
 * 本组件不复制也不接管那张表单。
 *
 * 四条硬规则（设计书 §2.5）：
 *  1. **明确提交**：输入不即时写公开记录，只有点「提交更新」才发一次 PATCH；
 *  2. **提交中禁用**：按钮 disabled + in-flight 守卫，双击只产生一次请求；
 *  3. **失败保留输入**：失败只显示原因（含 412/422/网络），输入原样保留、不显示成功；
 *  4. **不伪造结论**：成功文案只用服务端返回的新版本与字段；总集数未知时
 *     只显示「看到第 N 集」，**不生成百分比**；「通关」与「全成就」不互相推断
 *     —— 快捷更新的 PATCH 里根本不含 `completed_on` / `all_achievements`。
 *
 * 传输：复用现有 `PATCH /admin/leisure/entries/{id}` + `If-Match` 版本（契约 §9.6，
 * 不改后端契约）；失败语义与完整编辑共用同一套分类文案。
 */

import { useRef, useState, type ReactNode } from "react";

import type { SessionStatus } from "@/features/auth/api";
import { describeWriteFailure } from "@/features/metanav/admin/session";

import { updateEntry } from "../api";
import { codepointLength, parseOptionalInt } from "../failure";
import { completionRatio, episodesLabel, playtimeLabel, progressLabel } from "../paths";
import styles from "../leisure.module.css";
import {
  EPISODES_MAX,
  KIND_LABELS,
  NOTES_MAX_CODEPOINTS,
  PLAYTIME_MAX_MINUTES,
  PROGRESS_OPTIONS,
  type LeisureAdminEntry,
  type LeisureKind,
  type LeisurePatch,
} from "../types";

/**
 * 快捷更新的表单状态。
 *
 * `airing: "keep"` 表示**不改连载状态**：只有选择「连载中 / 已完结」才把它放进 PATCH，
 * 避免「只是改集数」时顺手把一条未知的 `airing` 写成 false。
 */
export interface QuickForm {
  entryId: string;
  episodes: string;
  playtime: string;
  progress: string;
  notes: string;
  airing: "keep" | "yes" | "no";
}

export function emptyQuickForm(): QuickForm {
  return { entryId: "", episodes: "", playtime: "", progress: "", notes: "", airing: "keep" };
}

/** 选中一条记录时的初值：如实带上现有字段，站主在真实数据上改。 */
export function formFromEntry(entry: LeisureAdminEntry): QuickForm {
  return {
    entryId: entry.id,
    episodes:
      entry.anime?.episodes_watched === null || entry.anime?.episodes_watched === undefined
        ? ""
        : String(entry.anime.episodes_watched),
    playtime:
      entry.game?.playtime_minutes === null || entry.game?.playtime_minutes === undefined
        ? ""
        : String(entry.game.playtime_minutes),
    progress: entry.progress,
    notes: entry.notes,
    airing: "keep",
  };
}

/** 校验快捷输入；返回字段 → 文案，空对象表示可以提交（与完整编辑同一套长度规则）。 */
export function validateQuickForm(kind: LeisureKind, form: QuickForm): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.entryId) errors.entryId = "先选择要更新的记录";
  const allowed = PROGRESS_OPTIONS[kind].some((option) => option.value === form.progress);
  if (!form.progress) {
    errors.progress = "请选择状态";
  } else if (!allowed) {
    errors.progress = `状态必须是${KIND_LABELS[kind]}允许的取值之一`;
  }
  if (codepointLength(form.notes) > NOTES_MAX_CODEPOINTS) {
    errors.notes = `短评最多 ${NOTES_MAX_CODEPOINTS} 个字符`;
  }
  if (kind === "anime") {
    const watched = parseOptionalInt(form.episodes);
    if (watched !== null && (Number.isNaN(watched) || watched < 0 || watched > EPISODES_MAX)) {
      errors.episodes = `已看集数必须是非负整数（最多 ${EPISODES_MAX}；留空 = 未记录）`;
    }
  } else {
    const minutes = parseOptionalInt(form.playtime);
    if (
      minutes !== null &&
      (Number.isNaN(minutes) || minutes < 0 || minutes > PLAYTIME_MAX_MINUTES)
    ) {
      errors.playtime = `累计时长必须是非负整数分钟（最多 ${PLAYTIME_MAX_MINUTES}；留空 = 未记录）`;
    }
  }
  return errors;
}

/**
 * 构造 PATCH body（纯函数，单测直接钉住「不含哪些字段」）。
 *
 * 关键：游戏分支**永远不出现** `completed_on` / `all_achievements` —— 状态选「通关」
 * 不等于自动记通关日期，全成就也不能由任何其它字段推断（契约 §9.6）。
 */
export function buildQuickPatch(kind: LeisureKind, form: QuickForm): LeisurePatch {
  const notes = form.notes;
  if (kind === "anime") {
    const watched = parseOptionalInt(form.episodes);
    return {
      progress: form.progress,
      episodes_watched:
        watched === null || Number.isNaN(watched) ? null : Math.trunc(watched),
      notes,
      ...(form.airing === "keep" ? {} : { airing: form.airing === "yes" }),
    };
  }
  const minutes = parseOptionalInt(form.playtime);
  return {
    progress: form.progress,
    playtime_minutes:
      minutes === null || Number.isNaN(minutes) ? null : Math.trunc(minutes),
    notes,
  };
}

/**
 * 追番百分比预览：**总集数未知 → null**（界面只显示「看到第 N 集」，不显示百分比）。
 * 直接复用公开视图同一套 `completionRatio`（服务端规则的前端兜底镜像）。
 */
export function quickCompletionRatio(
  form: QuickForm,
  entry: LeisureAdminEntry | null,
): number | null {
  if (!entry?.anime) return null;
  const watched = parseOptionalInt(form.episodes);
  if (watched === null || Number.isNaN(watched)) return null;
  return completionRatio(watched, entry.anime.total_episodes);
}

function successMessage(kind: LeisureKind, updated: LeisureAdminEntry): string {
  const parts = [`状态「${updated.progress_label || progressLabel(kind, updated.progress)}」`];
  if (kind === "anime" && updated.anime) {
    parts.push(updated.anime.episodes_label);
  }
  if (kind === "game" && updated.game) {
    parts.push(updated.game.playtime_label);
  }
  parts.push(`版本 ${updated.version}`);
  return `已更新：${parts.join(" · ")}（刷新后公开页即时生效）`;
}

export function QuickUpdate({
  session,
  entries,
  onUpdated,
}: {
  session: SessionStatus;
  /** 由管理端已读取的列表传入（与完整编辑共用一次取数，不重复请求）。 */
  entries: LeisureAdminEntry[] | null;
  onUpdated?: () => void | Promise<void>;
}): ReactNode {
  const [kind, setKind] = useState<LeisureKind>("anime");
  const [form, setForm] = useState<QuickForm>(emptyQuickForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<string | null>(null);
  // 同一 tick 内连点两次时 setState 还没提交，按钮 disabled 也可能来不及；再加一道同步守卫。
  const inFlight = useRef(false);

  const candidates = (entries ?? []).filter((entry) => entry.kind === kind);
  const selected = candidates.find((entry) => entry.id === form.entryId) ?? null;
  const options = PROGRESS_OPTIONS[kind];

  const resetResult = () => {
    setError(null);
    setFieldErrors({});
    setSuccess(null);
  };

  const switchKind = (next: LeisureKind) => {
    setKind(next);
    setForm(emptyQuickForm());
    resetResult();
  };

  const pickEntry = (entryId: string) => {
    const entry = (entries ?? []).find((item) => item.id === entryId) ?? null;
    setForm(entry ? formFromEntry(entry) : emptyQuickForm());
    resetResult();
  };

  const submit = async () => {
    if (inFlight.current) return;
    resetResult();
    const found = validateQuickForm(kind, form);
    setFieldErrors(found);
    if (Object.keys(found).length) {
      setError(
        found.entryId
          ? "先选择要更新的记录。改动没有提交。"
          : "还有需要修正的字段，见下方提示。改动没有提交。",
      );
      return;
    }
    if (!selected) {
      setError("先选择要更新的记录。改动没有提交。");
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    try {
      // 只提交用户明确确认的快捷字段；版本来自列表里的真实数据（If-Match）。
      const patch = buildQuickPatch(kind, form);
      const updated = await updateEntry(selected.id, patch, selected.version, session.csrf_token);
      // 成功文案只用服务端返回的新值，不拼凑「预计」。
      setSuccess(successMessage(kind, updated));
      // 列表里的版本会变旧：让管理端重读一次，下一次提交用新版本。
      await onUpdated?.();
    } catch (failure) {
      // 失败：输入原样保留（form 不动），只显示原因。
      setError(describeWriteFailure(failure).message);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  const ratio = kind === "anime" ? quickCompletionRatio(form, selected) : null;
  const watched = parseOptionalInt(form.episodes);
  const playtime = parseOptionalInt(form.playtime);
  const watchedValue = watched !== null && !Number.isNaN(watched) ? watched : null;
  const playtimeValue = playtime !== null && !Number.isNaN(playtime) ? playtime : null;

  return (
    <section
      className={styles.quick}
      aria-labelledby="leisure-quick-title"
      data-leisure-quick={kind}
    >
      <header className={styles.quickHead}>
        <div>
          <p className="kick">{"// Quick Update"}</p>
          <h2 className={styles.title} id="leisure-quick-title">
            快捷更新
          </h2>
          <p className={styles.hint}>
            只改日常的几个字段，点「提交更新」才会写入公开记录；名称、封面、评分、
            通关日期与全成就仍在下方完整编辑里维护。
          </p>
        </div>
        <nav className={styles.tabs} aria-label="快捷更新类型">
          {(["anime", "game"] as const).map((item) => (
            <button
              key={item}
              type="button"
              className={styles.tab}
              aria-current={item === kind ? "true" : undefined}
              data-leisure-quick-kind={item}
              onClick={() => switchKind(item)}
            >
              {KIND_LABELS[item]}
            </button>
          ))}
        </nav>
      </header>

      {entries === null ? (
        <p className={styles.empty} role="status">
          记录还没读出来，暂时不能快捷更新。可以先用下方完整编辑。
        </p>
      ) : candidates.length === 0 ? (
        <p className={styles.empty}>
          这个类型还没有记录。先到下方完整编辑新建一条，再回来用快捷更新。
        </p>
      ) : (
        <div className={styles.quickBody}>
          <label className={styles.field}>
            <span className={styles.label}>更新哪一条（含草稿）</span>
            <select
              className={styles.select}
              value={form.entryId}
              onChange={(event) => pickEntry(event.target.value)}
            >
              <option value="">请选择…</option>
              {candidates.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.title || "（无标题）"} · {entry.progress_label}
                </option>
              ))}
            </select>
            {fieldErrors.entryId ? (
              <span className={styles.fieldError}>{fieldErrors.entryId}</span>
            ) : null}
          </label>

          {selected ? (
            <p className={styles.hint} data-leisure-quick-current={selected.id}>
              当前：{progressLabel(kind, selected.progress)}
              {kind === "anime" && selected.anime
                ? ` · ${selected.anime.episodes_label}`
                : ""}
              {kind === "game" && selected.game ? ` · ${selected.game.playtime_label}` : ""}
              {" · "}
              {selected.status === "published" ? "已发布" : "草稿（公开页不可见）"} · 版本{" "}
              {selected.version}
            </p>
          ) : null}

          <div className={styles.row2}>
            {kind === "anime" ? (
              <label className={styles.field}>
                <span className={styles.label}>已看集数（留空 = 未记录）</span>
                <input
                  className={styles.input}
                  value={form.episodes}
                  inputMode="numeric"
                  data-leisure-quick-episodes
                  aria-invalid={fieldErrors.episodes ? "true" : undefined}
                  onChange={(event) => setForm({ ...form, episodes: event.target.value })}
                />
                {fieldErrors.episodes ? (
                  <span className={styles.fieldError}>{fieldErrors.episodes}</span>
                ) : null}
              </label>
            ) : (
              <label className={styles.field}>
                <span className={styles.label}>累计时长（分钟；整值提交，留空 = 未记录）</span>
                <input
                  className={styles.input}
                  value={form.playtime}
                  inputMode="numeric"
                  data-leisure-quick-playtime
                  aria-invalid={fieldErrors.playtime ? "true" : undefined}
                  onChange={(event) => setForm({ ...form, playtime: event.target.value })}
                />
                {fieldErrors.playtime ? (
                  <span className={styles.fieldError}>{fieldErrors.playtime}</span>
                ) : null}
              </label>
            )}

            <label className={styles.field}>
              <span className={styles.label}>状态</span>
              <select
                className={styles.select}
                value={form.progress}
                data-leisure-quick-progress
                aria-invalid={fieldErrors.progress ? "true" : undefined}
                onChange={(event) => setForm({ ...form, progress: event.target.value })}
              >
                <option value="">请选择…</option>
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {fieldErrors.progress ? (
                <span className={styles.fieldError}>{fieldErrors.progress}</span>
              ) : null}
            </label>

            {kind === "anime" ? (
              <label className={styles.field}>
                <span className={styles.label}>连载中（可选；不改就不提交）</span>
                <select
                  className={styles.select}
                  value={form.airing}
                  data-leisure-quick-airing
                  onChange={(event) =>
                    setForm({ ...form, airing: event.target.value as QuickForm["airing"] })
                  }
                >
                  <option value="keep">不改</option>
                  <option value="yes">连载中</option>
                  <option value="no">已完结</option>
                </select>
              </label>
            ) : null}
          </div>

          <label className={styles.field}>
            <span className={styles.label}>短评</span>
            <textarea
              className={styles.textarea}
              value={form.notes}
              data-leisure-quick-notes
              aria-invalid={fieldErrors.notes ? "true" : undefined}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
            />
            {fieldErrors.notes ? (
              <span className={styles.fieldError}>{fieldErrors.notes}</span>
            ) : null}
          </label>

          <div className={styles.preview} aria-label="提交后会怎样">
            <p className={styles.hint}>提交前预览（与公开页同一套展示规则）：</p>
            {kind === "anime" ? (
              <p
                className={styles.hint}
                data-leisure-quick-ratio={ratio === null ? "none" : String(ratio)}
              >
                {episodesLabel(watchedValue, selected?.anime?.total_episodes ?? null)}
                {ratio === null
                  ? "（总集数未知，不生成完成率）"
                  : `（约 ${Math.round(ratio * 100)}%）`}
              </p>
            ) : (
              <p className={styles.hint}>
                {playtimeLabel(playtimeValue)}
                {" · "}
                {selected?.game?.completed_on
                  ? `通关日期 ${selected.game.completed_on}`
                  : "通关日期未记录"}
                {" · "}
                {selected?.game?.all_achievements === true
                  ? "已全成就"
                  : selected?.game?.all_achievements === false
                    ? "还没全成就"
                    : "全成就未记录"}
                {"（这两项只在下方完整编辑里改，快捷更新不会推断）"}
              </p>
            )}
          </div>

          {kind === "game" ? (
            <p className={styles.hint}>
              说明：状态选「通关」不会自动填写通关日期；「全成就」也不会由通关或时长推断。
              它们是两个独立字段，需要时到下方完整编辑里分别记录。
            </p>
          ) : null}

          {error ? (
            <p className={styles.notice} role="alert" data-leisure-quick-error>
              {error}
            </p>
          ) : null}
          {success ? (
            <p
              className={`${styles.notice} ${styles.noticeInfo}`}
              role="status"
              data-leisure-quick-success
            >
              {success}
            </p>
          ) : null}

          <div className={styles.actions}>
            <button
              className={styles.button}
              type="button"
              disabled={submitting}
              data-leisure-quick-submit
              onClick={() => void submit()}
            >
              {submitting ? "提交中…" : "提交更新"}
            </button>
            <span className={styles.hint}>
              提交中按钮会禁用，防止连点生成两次更新。
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
