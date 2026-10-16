"use client";

/**
 * 放课后管理端（05 §7、验收 3/6）。
 *
 * 边界与手记管理一致：**不做访问控制**（隐藏入口不是安全边界），权限在 FastAPI；
 * 412 时保留未保存输入，不自动覆盖。
 *
 * 三条如实呈现的规则：
 *  1. **类型决定字段**：追番表单不显示平台 / 时长 / 全成就，游戏表单不显示季度 / 集数；
 *     提交时本地也拒绝跨类型字段（服务端还有字段级 422 与数据库 CHECK 兜底）；
 *  2. **总集数留空就不算完成率**：本地预览用与后端同一规则给出「看到第 6 集」；
 *  3. **通关 ≠ 全成就**：两个控件彼此独立，不去自动勾选对方。
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";

import type { SessionStatus } from "@/features/auth/api";
import { useAdminSession } from "@/features/metanav/admin/session";
import { SiteLink } from "@/features/runtime/navigation/site-link";
import { ApiClientError } from "@/lib/api/client";

import {
  createEntry,
  deleteEntry,
  getAdminEntry,
  listAdminEntries,
  publishEntry,
  unpublishEntry,
  updateEntry,
} from "../api";
import { emptyForm, parseOptionalInt, validateForm, type EntryForm } from "../failure";
import styles from "../leisure.module.css";
import {
  completionRatio,
  crossKindFields,
  episodesLabel,
  playtimeLabel,
  progressLabel,
  ratingLabel,
} from "../paths";
import { KIND_LABELS, PROGRESS_OPTIONS, type LeisureAdminEntry, type LeisureKind } from "../types";

function describeWriteFailure(error: unknown): { message: string; conflict: boolean } {
  if (error instanceof ApiClientError) {
    if (error.status === 412) {
      return {
        message: "这条记录已在别处更新（412）。你的输入还留着：先重新读取最新版本，再决定。",
        conflict: true,
      };
    }
    if (error.status === 428) {
      return { message: "缺少版本条件（428）：请重新读取这一条再提交。", conflict: true };
    }
    if (error.status === 409) return { message: error.message, conflict: false };
    if (error.status === 401) return { message: "需要站主登录（401）。", conflict: false };
    if (error.status === 422) {
      const fields = Object.entries(error.fields)
        .map(([key, messages]) => `${key}：${messages.join("；")}`)
        .join(" / ");
      return { message: `字段校验失败（422）：${fields || error.message}`, conflict: false };
    }
    return { message: `保存失败（HTTP ${error.status} · ${error.code}）`, conflict: false };
  }
  return { message: "连不上服务，改动没有保存。", conflict: false };
}

export function LeisureWorkspace(): ReactNode {
  const { state: sessionState } = useAdminSession();

  if (sessionState.status === "loading") {
    return (
      <p className={styles.empty} role="status">
        正在读取站主会话…
      </p>
    );
  }
  if (sessionState.status === "failed") {
    return (
      <div className={styles.empty} role="alert">
        <p>{sessionState.message}</p>
        <SiteLink className={styles.button} href="/admin/login" source="top-nav">
          去登录
        </SiteLink>
      </div>
    );
  }
  return <Workspace session={sessionState.session} />;
}

function Workspace({ session }: { session: SessionStatus }): ReactNode {
  const [kind, setKind] = useState<LeisureKind>("anime");
  const [entries, setEntries] = useState<LeisureAdminEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; tone: "info" | "error" } | null>(null);
  const [editing, setEditing] = useState<LeisureAdminEntry | null>(null);
  const [form, setForm] = useState<EntryForm>(emptyForm);
  const [progress, setProgress] = useState("wish");
  const [season, setSeason] = useState("");
  const [airing, setAiring] = useState(false);
  const [platform, setPlatform] = useState("");
  const [startedOn, setStartedOn] = useState("");
  const [completedOn, setCompletedOn] = useState("");
  const [allAchievements, setAllAchievements] = useState<"" | "yes" | "no">("");
  const [lastWatchedOn, setLastWatchedOn] = useState("");
  const [spoilers, setSpoilers] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const authenticated = session.authenticated;
  const csrfToken = session.csrf_token;

  const reload = useCallback(async () => {
    try {
      const page = await listAdminEntries({ limit: 30 });
      setEntries(page.items);
      setLoadError(null);
    } catch (error) {
      setEntries(null);
      setLoadError(describeWriteFailure(error).message);
    }
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    listAdminEntries({ limit: 30 })
      .then((page) => {
        if (!cancelled) {
          setEntries(page.items);
          setLoadError(null);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(describeWriteFailure(error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [authenticated]);

  if (!authenticated) {
    return (
      <div className={styles.empty} role="status">
        <h1 className={styles.title}>需要站主登录</h1>
        <p>
          管理接口只接受已登录的站主会话。请先到{" "}
          <SiteLink href="/admin/login" source="top-nav">
            站主登录
          </SiteLink>
          。
        </p>
        <p className={styles.hint}>说明：本页不做路由保护 —— 真正的权限判断在后端（01 §3）。</p>
      </div>
    );
  }

  const resetToKind = (next: LeisureKind) => {
    setKind(next);
    setEditing(null);
    setForm(emptyForm());
    setProgress("wish");
    setSeason("");
    setAiring(false);
    setPlatform("");
    setStartedOn("");
    setCompletedOn("");
    setAllAchievements("");
    setLastWatchedOn("");
    setSpoilers(false);
    setErrors({});
    setNotice(null);
  };

  const loadEntry = async (entry: LeisureAdminEntry) => {
    setNotice(null);
    try {
      const fresh = await getAdminEntry(entry.id);
      setKind(fresh.kind);
      setEditing(fresh);
      setErrors({});
      setForm({
        title: fresh.title,
        notes: fresh.notes,
        platform: fresh.game?.platform ?? "",
        rating: fresh.rating === null ? "" : String(fresh.rating),
        total_episodes:
          fresh.anime?.total_episodes === null || fresh.anime?.total_episodes === undefined
            ? ""
            : String(fresh.anime.total_episodes),
        episodes_watched:
          fresh.anime?.episodes_watched === null || fresh.anime?.episodes_watched === undefined
            ? ""
            : String(fresh.anime.episodes_watched),
        playtime_minutes:
          fresh.game?.playtime_minutes === null || fresh.game?.playtime_minutes === undefined
            ? ""
            : String(fresh.game.playtime_minutes),
      });
      setProgress(fresh.progress);
      setSeason(fresh.anime?.season ?? "");
      setAiring(Boolean(fresh.anime?.airing));
      setStartedOn(fresh.game?.started_on ?? "");
      setCompletedOn(fresh.game?.completed_on ?? "");
      setAllAchievements(
        fresh.game?.all_achievements === true
          ? "yes"
          : fresh.game?.all_achievements === false
            ? "no"
            : "",
      );
      setLastWatchedOn(fresh.anime?.last_watched_on ?? "");
      setSpoilers(fresh.notes_have_spoilers);
    } catch (error) {
      setNotice({ message: describeWriteFailure(error).message, tone: "error" });
    }
  };

  const payload = () => {
    const base = {
      title: form.title.trim(),
      progress,
      rating: parseOptionalInt(form.rating),
      notes: form.notes,
      notes_have_spoilers: spoilers,
    };
    if (kind === "anime") {
      return {
        ...base,
        season: season.trim() || null,
        total_episodes: parseOptionalInt(form.total_episodes),
        episodes_watched: parseOptionalInt(form.episodes_watched),
        last_watched_on: lastWatchedOn || null,
        airing,
      };
    }
    return {
      ...base,
      platform: form.platform,
      playtime_minutes: parseOptionalInt(form.playtime_minutes),
      started_on: startedOn || null,
      completed_on: completedOn || null,
      all_achievements:
        allAchievements === "yes" ? true : allAchievements === "no" ? false : null,
    };
  };

  const localCrossKind = crossKindFields(
    kind,
    kind === "anime"
      ? { platform: form.platform, playtime_minutes: form.playtime_minutes }
      : { season, total_episodes: form.total_episodes },
  );

  const submit = async () => {
    const found = validateForm(form);
    setErrors(found);
    if (Object.keys(found).length || localCrossKind.length) return;
    setNotice(null);
    try {
      if (editing) {
        const saved = await updateEntry(editing.id, payload(), editing.version, csrfToken);
        setEditing(saved);
        setNotice({ message: "已保存。", tone: "info" });
      } else {
        const created = await createEntry({ kind, ...payload() }, csrfToken);
        setEditing(created);
        setNotice({ message: "已新建为草稿。要公开请点「发布」。", tone: "info" });
      }
      await reload();
    } catch (error) {
      setNotice({ message: describeWriteFailure(error).message, tone: "error" });
    }
  };

  const act = async (
    action: (entry: LeisureAdminEntry) => Promise<LeisureAdminEntry>,
    success: string,
  ) => {
    if (!editing) return;
    setNotice(null);
    try {
      const updated = await action(editing);
      setEditing(updated);
      setNotice({ message: success, tone: "info" });
      await reload();
    } catch (error) {
      setNotice({ message: describeWriteFailure(error).message, tone: "error" });
    }
  };

  const remove = async () => {
    if (!editing) return;
    try {
      await deleteEntry(editing.id, editing.version, csrfToken);
      setEditing(null);
      setNotice({ message: "已软删除（数据保留）。", tone: "info" });
      await reload();
    } catch (error) {
      setNotice({ message: describeWriteFailure(error).message, tone: "error" });
    }
  };

  const previewTotal = parseOptionalInt(form.total_episodes);
  const previewWatched = parseOptionalInt(form.episodes_watched);
  const previewRatio = completionRatio(
    previewWatched !== null && !Number.isNaN(previewWatched) ? previewWatched : null,
    previewTotal !== null && !Number.isNaN(previewTotal) ? previewTotal : null,
  );

  return (
    <div>
      <header className={styles.bar}>
        <div>
          <p className="kick">{"// Leisure Admin"}</p>
          <h1 className={styles.title}>放课后管理</h1>
          <p className={styles.lead}>
            追番与游戏共用一张表：先选类型，再填该类型自己的进度字段。
            新建的条目是<strong>草稿</strong>，点「发布」后才出现在公开页签。
          </p>
        </div>
        <nav className={styles.tabs} aria-label="管理类型">
          {(["anime", "game"] as const).map((item) => (
            <button
              key={item}
              type="button"
              className={styles.tab}
              aria-current={item === kind ? "true" : undefined}
              onClick={() => resetToKind(item)}
            >
              {KIND_LABELS[item]}
            </button>
          ))}
        </nav>
      </header>

      {notice ? (
        <p className={styles.notice} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.message}
        </p>
      ) : null}
      {loadError ? (
        <p className={styles.notice} role="alert">
          {loadError}
        </p>
      ) : null}

      <h2 className={styles.title}>全部记录（含草稿）</h2>
      {entries === null && !loadError ? (
        <p className={styles.empty} role="status">
          正在读取…
        </p>
      ) : null}
      {entries !== null && !entries.length ? (
        <p className={styles.empty}>还没有任何记录。用下面的表单添加第一条。</p>
      ) : null}
      {entries !== null && entries.length ? (
        <ul className={styles.adminList}>
          {entries.map((entry) => (
            <li className={styles.adminRow} key={entry.id}>
              <div className={styles.chips}>
                <span className={styles.chip}>{KIND_LABELS[entry.kind]}</span>
                <span className={styles.chip}>{entry.progress_label}</span>
                <span className={styles.chip}>{ratingLabel(entry.rating)}</span>
                <span
                  className={`${styles.statusChip} ${
                    entry.status === "published" ? styles.statusPublished : styles.statusDraft
                  }`}
                >
                  {entry.status === "published" ? "已发布" : "草稿"}
                </span>
                <span className={styles.chip}>{entry.public ? "公开可见" : "不可见"}</span>
              </div>
              <strong>{entry.title}</strong>
              <div className={styles.actions}>
                <button
                  className={`${styles.button} ${styles.buttonGhost}`}
                  type="button"
                  onClick={() => void loadEntry(entry)}
                >
                  编辑
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <section
        aria-labelledby="leisure-editor"
        // 同 journal：把「正在编辑哪一条」暴露出来，避免在旧数据上误操作。
        data-leisure-editor={editing?.id ?? "new"}
      >
        <h2 className={styles.title} id="leisure-editor">
          {editing ? `编辑：${editing.title}` : `新建${KIND_LABELS[kind]}记录`}
        </h2>
        {editing ? (
          <p className={styles.hint}>
            版本 {editing.version}（保存 / 发布 / 删除都带它，冲突时不会被静默覆盖）；
            类型创建后不可更改。
          </p>
        ) : null}

        <div className={styles.adminForm}>
          <div className={styles.row2}>
            <label className={styles.field}>
              <span className={styles.label}>名称</span>
              <input
                className={styles.input}
                value={form.title}
                aria-invalid={errors.title ? "true" : undefined}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
              />
              {errors.title ? <span className={styles.fieldError}>{errors.title}</span> : null}
            </label>
            <label className={styles.field}>
              <span className={styles.label}>进度</span>
              <select
                className={styles.select}
                value={progress}
                onChange={(event) => setProgress(event.target.value)}
              >
                {PROGRESS_OPTIONS[kind].map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>评分（留空 = 未评分）</span>
              <input
                className={styles.input}
                value={form.rating}
                inputMode="numeric"
                aria-invalid={errors.rating ? "true" : undefined}
                onChange={(event) => setForm({ ...form, rating: event.target.value })}
              />
              {errors.rating ? <span className={styles.fieldError}>{errors.rating}</span> : null}
            </label>
          </div>

          {kind === "anime" ? (
            <div className={styles.row2}>
              <label className={styles.field}>
                <span className={styles.label}>季度（可空）</span>
                <input
                  className={styles.input}
                  value={season}
                  onChange={(event) => setSeason(event.target.value)}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>总集数（留空 = 不确定）</span>
                <input
                  className={styles.input}
                  value={form.total_episodes}
                  inputMode="numeric"
                  aria-invalid={errors.total_episodes ? "true" : undefined}
                  onChange={(event) => setForm({ ...form, total_episodes: event.target.value })}
                />
                {errors.total_episodes ? (
                  <span className={styles.fieldError}>{errors.total_episodes}</span>
                ) : null}
              </label>
              <label className={styles.field}>
                <span className={styles.label}>已看集数（可空）</span>
                <input
                  className={styles.input}
                  value={form.episodes_watched}
                  inputMode="numeric"
                  aria-invalid={errors.episodes_watched ? "true" : undefined}
                  onChange={(event) => setForm({ ...form, episodes_watched: event.target.value })}
                />
                {errors.episodes_watched ? (
                  <span className={styles.fieldError}>{errors.episodes_watched}</span>
                ) : null}
              </label>
              <label className={styles.field}>
                <span className={styles.label}>最近观看日期（可空）</span>
                <input
                  className={styles.input}
                  type="date"
                  value={lastWatchedOn}
                  onChange={(event) => setLastWatchedOn(event.target.value)}
                />
              </label>
              <label className={styles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={airing}
                  onChange={(event) => setAiring(event.target.checked)}
                />
                连载中（手动维护，不同步第三方）
              </label>
            </div>
          ) : (
            <div className={styles.row2}>
              <label className={styles.field}>
                <span className={styles.label}>平台（可空）</span>
                <input
                  className={styles.input}
                  value={form.platform}
                  aria-invalid={errors.platform ? "true" : undefined}
                  onChange={(event) => setForm({ ...form, platform: event.target.value })}
                />
                {errors.platform ? <span className={styles.fieldError}>{errors.platform}</span> : null}
              </label>
              <label className={styles.field}>
                <span className={styles.label}>时长（分钟，留空 = 未记录）</span>
                <input
                  className={styles.input}
                  value={form.playtime_minutes}
                  inputMode="numeric"
                  aria-invalid={errors.playtime_minutes ? "true" : undefined}
                  onChange={(event) => setForm({ ...form, playtime_minutes: event.target.value })}
                />
                {errors.playtime_minutes ? (
                  <span className={styles.fieldError}>{errors.playtime_minutes}</span>
                ) : null}
              </label>
              <label className={styles.field}>
                <span className={styles.label}>开始日期（可空）</span>
                <input
                  className={styles.input}
                  type="date"
                  value={startedOn}
                  onChange={(event) => setStartedOn(event.target.value)}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>通关日期（可空）</span>
                <input
                  className={styles.input}
                  type="date"
                  value={completedOn}
                  onChange={(event) => setCompletedOn(event.target.value)}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>全成就（独立于通关）</span>
                <select
                  className={styles.select}
                  value={allAchievements}
                  onChange={(event) =>
                    setAllAchievements(event.target.value as "" | "yes" | "no")
                  }
                >
                  <option value="">未记录</option>
                  <option value="yes">已全成就</option>
                  <option value="no">还没全成就</option>
                </select>
              </label>
            </div>
          )}

          <label className={styles.field}>
            <span className={styles.label}>短评</span>
            <textarea
              className={styles.textarea}
              value={form.notes}
              aria-invalid={errors.notes ? "true" : undefined}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
            />
            {errors.notes ? <span className={styles.fieldError}>{errors.notes}</span> : null}
          </label>

          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={spoilers}
              onChange={(event) => setSpoilers(event.target.checked)}
            />
            这段短评含剧透（公开页默认折叠，读者主动展开才显示）
          </label>

          {localCrossKind.length ? (
            <p className={styles.notice} role="alert">
              当前类型不接受这些字段：{localCrossKind.join("、")}。
            </p>
          ) : null}

          <div className={styles.actions}>
            <button
              className={styles.button}
              type="button"
              disabled={localCrossKind.length > 0}
              onClick={() => void submit()}
            >
              {editing ? "保存" : "新建草稿"}
            </button>
            {editing && editing.status === "draft" ? (
              <button
                className={`${styles.button} ${styles.buttonGhost}`}
                type="button"
                onClick={() =>
                  void act((entry) => publishEntry(entry.id, entry.version, csrfToken), "已发布。")
                }
              >
                发布
              </button>
            ) : null}
            {editing && editing.status === "published" ? (
              <button
                className={`${styles.button} ${styles.buttonGhost}`}
                type="button"
                onClick={() =>
                  void act(
                    (entry) => unpublishEntry(entry.id, entry.version, csrfToken),
                    "已撤回为草稿。",
                  )
                }
              >
                撤回为草稿
              </button>
            ) : null}
            {editing ? (
              <button
                className={`${styles.button} ${styles.buttonDanger}`}
                type="button"
                onClick={() => void remove()}
              >
                删除（软删除）
              </button>
            ) : null}
          </div>

          <div className={styles.preview} aria-label="保存后会怎样">
            <p className={styles.hint}>预览（与公开页同一套规则，不额外加工）：</p>
            <p>
              <strong>{form.title || "（还没有名称）"}</strong> ·{" "}
              {progressLabel(kind, progress)} · {ratingLabel(parseOptionalInt(form.rating))}
            </p>
            {kind === "anime" ? (
              <p className={styles.hint}>
                {episodesLabel(
                  previewWatched !== null && !Number.isNaN(previewWatched) ? previewWatched : null,
                  previewTotal !== null && !Number.isNaN(previewTotal) ? previewTotal : null,
                )}
                {previewRatio === null ? "（总集数不确定，不显示完成率）" : `（约 ${Math.round(previewRatio * 100)}%）`}
              </p>
            ) : (
              <p className={styles.hint}>
                {playtimeLabel(
                  (() => {
                    const value = parseOptionalInt(form.playtime_minutes);
                    return value !== null && !Number.isNaN(value) ? value : null;
                  })(),
                )}
                {completedOn ? ` · 通关 ${completedOn}` : ""}
                {allAchievements === "yes"
                  ? " · 全成就"
                  : allAchievements === "no"
                    ? " · 还没全成就"
                    : " · 未记录全成就"}
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

export { parseOptionalInt };
