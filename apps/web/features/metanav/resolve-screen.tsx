"use client";

/**
 * 认知定位：可选的仪式，不是谜题（04 §4B）。
 *
 *  - 三个字段按正常表单**纵向**排列，每项都有普通中文说明；
 *  - 输入可打字，也可从公开候选里选（候选来自公开专题的关键词，不猜拼音与错别字）；
 *  - 提交后只有四种反馈：找到一个、找到多个需要选择、未找到、导航暂时不可用
 *    （最后一种**不是**「没有反应」，也不是 not_found）；
 *  - 未找到时保留输入、给已发布专题的建议与普通搜索入口，不惩罚输错；
 *  - **提交不会立刻强制跳转**：找到之后要再点「进入殿堂」。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";

import { listPalaces, resolveKeywords } from "./api";
import { classifyFailure, isAbort, validateKeywords, type Failure } from "./failure";
import { abortAll, trackController } from "./inflight";
import type { MetanavHost } from "./host";
import { useLoader } from "./host";
import styles from "./metanav.module.css";
import { EnterPalace, KeywordChips } from "./palace-card";
import {
  FIELD_GUIDES,
  PALACE_FIELDS,
  type KeywordInput,
  type PalaceField,
  type PalaceSummary,
  type ResolveResult,
} from "./types";

const EMPTY_INPUT: KeywordInput = { name: "", location: "", cognition: "" };

type SubmitState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; result: ResolveResult; input: KeywordInput }
  | { status: "failed"; failure: Failure; input: KeywordInput };

/** 公开候选：从当前公开专题的关键词里收集，供输入框的 datalist 使用。 */
function candidatesFrom(palaces: readonly PalaceSummary[]): Record<PalaceField, string[]> {
  const collected: Record<PalaceField, string[]> = { name: [], location: [], cognition: [] };
  for (const palace of palaces) {
    for (const field of PALACE_FIELDS) {
      const value = palace.keywords[field];
      if (value && !collected[field].includes(value)) collected[field].push(value);
    }
  }
  return collected;
}

export function ResolveScreen({ host }: { host: MetanavHost }): ReactNode {
  const [input, setInput] = useState<KeywordInput>(EMPTY_INPUT);
  const [errors, setErrors] = useState<Partial<Record<PalaceField, string>>>({});
  const [submit, setSubmit] = useState<SubmitState>({ status: "idle" });
  const controllerRef = useRef<AbortController | null>(null);
  // 公开候选与「未找到时的建议」都来自同一份公开专题列表（失败时不显示建议，不编造）。
  const { state: listState } = useLoader((signal) => listPalaces(signal), []);
  const publicPalaces = useMemo(
    () => (listState.status === "ready" ? listState.data.items : []),
    [listState],
  );
  const candidates = useMemo(() => candidatesFrom(publicPalaces), [publicPalaces]);

  const update = (field: PalaceField, value: string) => {
    setInput((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field]: undefined }));
  };

  const runResolve = useCallback(async () => {
      const validation = validateKeywords(input);
      setErrors(validation);
      if (Object.keys(validation).length) {
        setSubmit({ status: "idle" });
        return;
      }
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      // 登记到未完成请求表：卸载或宿主 dispose() 时会被取消，晚到的响应不写回状态。
      const untrack = trackController(controller);
      setSubmit({ status: "running" });
      try {
        const result = await resolveKeywords(input, controller.signal);
        if (controller.signal.aborted) return;
        setSubmit({ status: "done", result, input });
      } catch (error) {
        if (isAbort(error) || controller.signal.aborted) return;
        setSubmit({ status: "failed", failure: classifyFailure(error), input });
      } finally {
        untrack();
      }
  }, [input]);

  // 退出这一屏就取消未完成的定位请求（02 §4：模块退出取消读取与监听）。
  useEffect(() => () => {
    abortAll();
  }, []);

  const onSubmit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      void runResolve();
    },
    [runResolve],
  );

  return (
    <div className={styles.wrap}>
      <header className={styles.bar}>
        <div>
          <p className="kick">{"// Cognitive Positioning"}</p>
          <h2 className={styles.title}>认知定位</h2>
          <p className={styles.lead}>
            三项都填对才找得到同一座殿堂。这不是密码或权限验证：填不出来也可以直接用
            「已发现殿堂」或普通搜索，不扣任何东西。
          </p>
        </div>
        <nav className={styles.tabs} aria-label="导航方式">
          <button className={styles.tab} type="button" onClick={() => host.changeScreen("palaces")}>
            已发现殿堂
          </button>
          <button className={styles.tab} type="button" aria-current="true">
            认知定位
          </button>
          <button className={styles.tab} type="button" onClick={() => host.changeScreen("search")}>
            普通搜索
          </button>
          <button className={styles.tab} type="button" onClick={() => host.changeScreen("mugen")}>
            印象空间
          </button>
        </nav>
      </header>

      <form className={styles.form} onSubmit={onSubmit} noValidate>
        {FIELD_GUIDES.map((guide) => {
          const listId = `metanav-candidates-${guide.field}`;
          const error = errors[guide.field];
          return (
            <div className={styles.field} key={guide.field}>
              <label className={styles.label} htmlFor={`metanav-${guide.field}`}>
                {guide.label}
              </label>
              <p className={styles.hint} id={`${listId}-hint`}>
                {guide.hint}
              </p>
              <input
                className={styles.input}
                id={`metanav-${guide.field}`}
                name={guide.field}
                list={listId}
                value={input[guide.field]}
                placeholder={guide.placeholder}
                autoComplete="off"
                aria-invalid={error ? "true" : "false"}
                aria-describedby={error ? `${listId}-error` : `${listId}-hint`}
                onChange={(event) => update(guide.field, event.target.value)}
              />
              <datalist id={listId}>
                {candidates[guide.field].map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
              {error ? (
                <p className={styles.fieldError} id={`${listId}-error`} role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          );
        })}
        <div className={styles.actions}>
          <button className={styles.button} type="submit" disabled={submit.status === "running"}>
            {submit.status === "running" ? "定位中…" : "开始定位"}
          </button>
          <button
            className={`${styles.button} ${styles.buttonGhost}`}
            type="button"
            onClick={() => {
              setInput(EMPTY_INPUT);
              setErrors({});
              setSubmit({ status: "idle" });
            }}
          >
            清空
          </button>
        </div>
      </form>

      <div aria-live="polite">
        {submit.status === "done" && submit.result.status === "found" ? (
          <section className={styles.result} data-result="found">
            <p className="kick">{"// Found"}</p>
            <h3 className={styles.cardTitle}>{submit.result.matches[0]?.title}</h3>
            {submit.result.matches[0] ? <KeywordChips palace={submit.result.matches[0]} /> : null}
            <p className={styles.hint}>确认无误后点「进入殿堂」；现在留在这一页也没关系。</p>
            <div className={styles.actions}>
              {submit.result.matches[0] ? (
                <EnterPalace palace={submit.result.matches[0]} host={host} />
              ) : null}
            </div>
          </section>
        ) : null}

        {submit.status === "done" && submit.result.status === "ambiguous" ? (
          <section className={styles.result} data-result="ambiguous">
            <p className="kick">{"// Multiple Targets"}</p>
            <h3 className={styles.cardTitle}>有 {submit.result.matches.length} 座殿堂符合这组关键词</h3>
            <p className={styles.hint}>不随机挑一个 —— 请自己确认要进哪一座。</p>
            <ul className={styles.results}>
              {submit.result.matches.map((palace) => (
                <li className={styles.result} key={palace.slug}>
                  <h4 className={styles.cardTitle}>{palace.title}</h4>
                  <KeywordChips palace={palace} />
                  <div className={styles.actions}>
                    <EnterPalace palace={palace} host={host} label="进入这座殿堂" />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {submit.status === "done" && submit.result.status === "not_found" ? (
          <section className={styles.result} data-result="not_found">
            <p className="kick">{"// Not Found"}</p>
            <h3 className={styles.cardTitle}>没有匹配的殿堂</h3>
            <p className={styles.hint}>
              输入已保留，可以直接改一项再试。也许关键词不是站主维护的那组，用普通搜索更快。
            </p>
            <div className={styles.actions}>
              <button className={styles.button} type="button" onClick={() => host.changeScreen("search")}>
                去普通搜索
              </button>
              <button
                className={`${styles.button} ${styles.buttonGhost}`}
                type="button"
                onClick={() => host.changeScreen("palaces")}
              >
                看已发现殿堂
              </button>
            </div>
            {publicPalaces.length ? (
              <>
                <p className={styles.hint}>已经发布的殿堂（可以直接进）：</p>
                <ul className={styles.candidates}>
                  {publicPalaces.slice(0, 4).map((palace) => (
                    <li key={palace.slug}>
                      <EnterPalace
                        palace={palace}
                        host={host}
                        label={palace.title}
                        className={`${styles.button} ${styles.buttonGhost}`}
                      />
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>
        ) : null}

        {submit.status === "failed" ? (
          <section className={styles.result} data-result="unavailable" role="alert">
            <p className="kick">{"// Navigator Offline"}</p>
            <h3 className={styles.cardTitle}>导航暂时不可用</h3>
            <p className={styles.hint}>{submit.failure.message}</p>
            <p className={styles.hint}>这和「没有找到」不是一回事：输入还在，稍后再试一次即可。</p>
            <div className={styles.actions}>
              <button
                className={styles.button}
                type="button"
                onClick={() => {
                  void runResolve();
                }}
              >
                重试
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
