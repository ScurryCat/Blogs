/**
 * 角色消息管理视图 `/admin/messages`（T08 独占路由）。
 *
 * 用途只有一个：**把成本与运行状态如实显示出来**，不静默隐藏（08 §7、验收用例
 * 「AI 超时 / 额度耗尽 / 重试 → 成本不被静默隐藏」）。
 *
 * 它是客户端组件，因为管理端点要求站主 Cookie —— 服务端 fetch 不会带上浏览器会话，
 * 只会稳定拿到 401。浏览器同源请求则会带上 `pl_session_dev`，并由后端做真正的
 * 权限判定（`/admin` 不做路由保护是 01 §3 的安排：隐藏按钮不是安全边界）。
 *
 * 页面上出现的数字全部来自 `/api/v1/admin/messaging/overview`，没有任何是本地估算。
 */

"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { ApiClientError, apiRequest } from "@/lib/api/client";
import { ADMIN_OVERVIEW_PATH } from "@/features/messaging/paths";
import "@/features/messaging/messaging.css";

interface Overview {
  ai: { status: string; message: string; provider: string };
  ai_provider: string;
  config: Record<string, unknown>;
  limits: Record<string, number>;
  usage_today: {
    day: string;
    site_reserved_units: number;
    site_settled_units: number;
    site_request_count: number;
    site_daily_units: number;
    inflight: number;
    ai_requests_by_status: Record<string, number>;
  };
  totals: Record<string, number>;
  retention: Record<string, string | number>;
  provider_notes: string[];
}

type Phase = "loading" | "ready" | "unauthorized" | "error";

export default function AdminMessagesPage(): ReactNode {
  const [phase, setPhase] = useState<Phase>("loading");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const mountedRef = useRef(true);
  const requestRef = useRef<AbortController | null>(null);

  /**
   * 读取运行状态。
   *
   * setState 全部发生在 `await` 之后 —— 见 `character-list.tsx` 里对
   * `react-hooks/set-state-in-effect` 的说明。
   */
  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();
    requestRef.current?.abort();
    requestRef.current = controller;

    void (async () => {
      try {
        const payload = await apiRequest<Overview>(ADMIN_OVERVIEW_PATH, {
          signal: controller.signal,
        });
        if (controller.signal.aborted || !mountedRef.current) return;
        setOverview(payload);
        setError(null);
        setPhase("ready");
      } catch (failure) {
        if (controller.signal.aborted || !mountedRef.current) return;
        if (failure instanceof DOMException && failure.name === "AbortError") return;
        if (failure instanceof ApiClientError && failure.status === 401) {
          setPhase("unauthorized");
          return;
        }
        setError(
          failure instanceof ApiClientError
            ? `读取失败（HTTP ${failure.status}）：${failure.message}`
            : "连不上接口服务。",
        );
        setPhase("error");
      }
    })();

    return () => controller.abort();
  }, [reloadToken]);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const reload = useCallback(() => {
    setPhase("loading");
    setReloadToken((value) => value + 1);
  }, []);

  if (phase === "loading") {
    return (
      <div className="msg-app msg-admin">
        <p className="msg-state" role="status">
          正在读取角色消息的运行状态…
        </p>
      </div>
    );
  }

  if (phase === "unauthorized") {
    return (
      <div className="msg-app msg-admin">
      <div className="msg-state">
        <p className="msg-state-kicker">SIGN IN REQUIRED</p>
        <h1>角色消息 · 运行状态</h1>
        <p>这个页面需要站主登录。请先到登录页登录，再回来。</p>
        <p>
          <a className="msg-card" href="/admin/login">
            去登录
          </a>
        </p>
      </div>
      </div>
    );
  }

  if (phase === "error" || overview === null) {
    return (
      <div className="msg-app msg-admin">
        <div className="msg-state">
          <p className="msg-state-kicker">READ FAILED</p>
          <h1>角色消息 · 运行状态</h1>
          <p>{error}</p>
          <button type="button" className="msg-btn" onClick={reload}>
            重新读取
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="msg-app msg-admin">
      <h1>角色消息 · 运行状态</h1>
      <p className="msg-notice" role="status">
        {overview.ai.message}
      </p>

      <section>
        <h2>今天的用量（{overview.usage_today.day}，UTC）</h2>
        <ul className="msg-admin-list">
          <li>
            已结算单位：{overview.usage_today.site_settled_units} / 上限{" "}
            {overview.usage_today.site_daily_units}
          </li>
          <li>预留中单位：{overview.usage_today.site_reserved_units}</li>
          <li>请求次数：{overview.usage_today.site_request_count}</li>
          <li>当前在途：{overview.usage_today.inflight}</li>
          <li>
            按状态：
            {Object.entries(overview.usage_today.ai_requests_by_status).length === 0
              ? "（今天还没有请求）"
              : Object.entries(overview.usage_today.ai_requests_by_status)
                  .map(([status, count]) => `${status} ${count}`)
                  .join(" · ")}
          </li>
        </ul>
      </section>

      <section>
        <h2>累计</h2>
        <ul className="msg-admin-list">
          {Object.entries(overview.totals).map(([key, value]) => (
            <li key={key}>
              {key}：{value}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>限额与保留期</h2>
        <ul className="msg-admin-list">
          {Object.entries(overview.limits).map(([key, value]) => (
            <li key={key}>
              {key}：{value}
            </li>
          ))}
          {Object.entries(overview.retention).map(([key, value]) => (
            <li key={key}>
              {key}：{String(value)}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>配置（不含密钥）</h2>
        <ul className="msg-admin-list">
          {Object.entries(overview.config).map(([key, value]) => (
            <li key={key}>
              {key}：{value === null ? "—" : String(value)}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>边界说明</h2>
        <ul className="msg-admin-list">
          {overview.provider_notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
