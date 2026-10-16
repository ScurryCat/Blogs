"use client";

/**
 * 留言板 —— 旧站 `assets/js/guestbook.js` 的 React 迁移。
 *
 * 保留：本地示例模式（留言只存在访客自己浏览器里）、相对时间、站主标记、
 * 字数提示、30 秒冷却、纯文本渲染（正文不渲染 Markdown）、刷新按钮与失败态。
 * 界面文案明确写着「示例模式，换设备就看不到」，**不伪装成共享留言**。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { site } from "@/features/legacy/config";
import { createGuestbookStore, type GuestbookEntry, type GuestbookStore } from "@/features/legacy/guestbook/store";

const LIMIT_NAME = site.guestbook.maxName || 20;
const LIMIT_TEXT = site.guestbook.maxText || 500;
const COOLDOWN = (site.guestbook.cooldown || 30) * 1000;
const OWNER_NAMES = [site.author, "JOKER", "站主"].filter(Boolean);

/** 相对时间：刚发出来的留言要让人看到「刚刚」，而不是一串 ISO 时间。 */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) return "";
  const seconds = Math.max(0, (now - timestamp) / 1000);
  if (seconds < 60) return "刚刚";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  if (seconds < 86400 * 30) return `${Math.floor(seconds / 86400)} 天前`;
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function GuestbookView(): ReactNode {
  const [store, setStore] = useState<GuestbookStore | null>(null);
  const [rows, setRows] = useState<GuestbookEntry[] | null>(null);
  const [listError, setListError] = useState("");
  const [note, setNote] = useState("");
  const [noteKind, setNoteKind] = useState<"" | "warn" | "ok" | "err">("");
  const [count, setCount] = useState("");
  const [freshId, setFreshId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  const [text, setText] = useState("");

  // 存储适配器只在客户端建（localStorage 不在模块顶层读）。
  useEffect(() => {
    // 存储适配器只在客户端建，且延后一拍：渲染期不碰 localStorage，
    // effect 里同步 setState 又会级联渲染。
    const frame = window.requestAnimationFrame(() => {
      let storage: Storage | null = null;
      try {
        storage = window.localStorage;
      } catch {
        storage = null;
      }
      setStore(createGuestbookStore(site.guestbook, storage));
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const load = useCallback(async (target: GuestbookStore) => {
    try {
      const list = await target.list();
      setRows(list);
      setListError("");
    } catch (error) {
      setRows([]);
      setListError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    if (!store) return;
    const start = window.setTimeout(() => void load(store), 0);
    return () => window.clearTimeout(start);
  }, [load, store]);

  const say = (message: string, kind: "" | "warn" | "ok" | "err" = "") => {
    setNote(message);
    setNoteKind(kind);
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!store) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    const contact = String(data.get("contact") ?? "").trim();
    const body = String(data.get("text") ?? "").trim();

    if (!name) return say("名字还没填。", "warn");
    if (!body) return say("留言是空的。", "warn");
    if (body.length > LIMIT_TEXT) return say(`留言超过 ${LIMIT_TEXT} 字。`, "warn");

    let last = 0;
    try {
      last = Number(window.localStorage.getItem("pl-gb-last") ?? 0);
    } catch {
      last = 0;
    }
    if (Date.now() - last < COOLDOWN) {
      return say(`刚发过一条，${Math.ceil((COOLDOWN - (Date.now() - last)) / 1000)} 秒后再来。`, "warn");
    }

    setSending(true);
    say("寄出中…");
    try {
      const row = await store.add({ name, text: body, contact, page: window.location.pathname });
      try {
        window.localStorage.setItem("pl-gb-last", String(Date.now()));
      } catch {
        // 忽略：冷却记不住不影响留言。
      }
      form.reset();
      setText("");
      setCount("");
      say(
        store.mode === "local"
          ? "已存进你自己的浏览器（示例模式，换设备就看不到）。"
          : "收到了，谢谢。",
        "ok",
      );
      await load(store);
      setFreshId(row.id);
    } catch (error) {
      say(`没寄出去：${error instanceof Error ? error.message : String(error)}`, "err");
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="shell gb" aria-labelledby="gb-h">
      <header className="sec-h">
        <span className="no">01</span>
        <h2 id="gb-h">
          <span className="en">Guestbook</span>
          <span className="cn">留言</span>
        </h2>
        <p className="aside">
          LEAVE A TRACE <b>↑</b>
        </p>
      </header>
      <p className="gb-lead">{site.guestbook.greeting || "留下你的足迹。"}</p>

      <form className="gb-form" noValidate ref={formRef} onSubmit={onSubmit}>
        <div className="gb-row">
          <label className="gb-f">
            <span>
              名字 <i>必填</i>
            </span>
            <input
              name="name"
              type="text"
              maxLength={LIMIT_NAME}
              autoComplete="nickname"
              placeholder="怎么称呼你？"
              required
            />
          </label>
          <label className="gb-f">
            <span>
              联系方式{" "}
              <i>{store?.contactStaysLocal ? "只在你自己浏览器里" : "仅站主可见，不会公开"}</i>
            </span>
            <input
              name="contact"
              type="text"
              maxLength={60}
              autoComplete="email"
              placeholder="邮箱或主页（选填）"
            />
          </label>
        </div>
        <label className="gb-f">
          <span>
            留言 <i>纯文本，最多 {LIMIT_TEXT} 字</i>
          </span>
          <textarea
            name="text"
            rows={5}
            maxLength={LIMIT_TEXT}
            placeholder="想说什么都行。"
            required
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setCount(event.target.value.length ? `${event.target.value.length} / ${LIMIT_TEXT}` : "");
            }}
          />
        </label>
        <div className="gb-act">
          <button className="btn red" type="submit" disabled={sending}>
            <span>寄出 ▸</span>
          </button>
          <span className="gb-count" aria-live="polite">
            {count}
          </span>
        </div>
        <p className={`gb-note${noteKind ? ` ${noteKind}` : ""}`} role="status" aria-live="polite">
          {note}
        </p>
      </form>

      <div className="gb-list-h">
        <p className="kick">{"// 全部留言"}</p>
        <button className="gb-reload" type="button" onClick={() => store && void load(store)}>
          刷新
        </button>
      </div>
      <ul className="gb-l" aria-live="polite">
        {listError ? (
          <li className="gb-empty err">留言读不出来：{listError}</li>
        ) : rows === null ? (
          <li className="gb-empty">读取中…</li>
        ) : rows.length === 0 ? (
          <li className="gb-empty">还没有留言。要不要当第一个？</li>
        ) : (
          rows.map((row) => {
            const mine = OWNER_NAMES.includes((row.name || "").trim());
            return (
              <li className={`gb-i${mine ? " owner" : ""}${freshId === row.id ? " fresh" : ""}`} key={row.id}>
                <div className="gb-h">
                  <b className="gb-n">{row.name}</b>
                  {mine ? <span className="gb-tag">站主</span> : null}
                  <time className="gb-t" dateTime={row.at}>
                    {timeAgo(row.at)}
                  </time>
                </div>
                {/* 留言正文按纯文本处理：换行转 <br>，不渲染 Markdown / HTML。 */}
                <p className="gb-m">
                  {row.text.split("\n").map((line, index) => (
                    <span key={index}>
                      {index > 0 ? <br /> : null}
                      {line}
                    </span>
                  ))}
                </p>
              </li>
            );
          })
        )}
      </ul>
    </section>
  );
}
