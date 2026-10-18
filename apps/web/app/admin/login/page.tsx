"use client";

/**
 * 最小站主登录页（T01；P5 由 C2 支持 `?returnTo=` 返回来源页）。
 *
 * 范围（SHARED-CONTRACTS §2）：T01 只负责这一张登录视图；管理外壳（/admin 的布局、
 * 导航、受保护页面）由 T02 负责。
 *
 * 行为要点：
 *  - 挂载时读取 `GET /api/v1/auth/session`：建立预登录会话并拿到 CSRF token；
 *  - 卸载（或重新读取）时 abort 进行中的请求，不留悬挂读取与监听（验收 §1）；
 *  - 提交期间锁定按钮，失败保留输入（不清空已填内容），密码不回显到任何地方；
 *  - 不使用 localStorage / sessionStorage 保存任何凭据或 CSRF token（05 §5.8）；
 *  - **P5**：支持 `?returnTo=<safeInternalPath>`。登录成功后 `router.replace(returnTo)`；
 *    参数非法/为空但有 returnTo 时回 `/admin`；**没有 returnTo 参数时保持旧行为**（显示已登录态）；
 *  - **P5**：主动退出登录时调用 `clearAllWorkDraftLocalCopies()` 清空本机恢复副本，
 *    并让站主身份探针缓存失效（前台入口立即消失）。
 */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { fetchSession, login, logout, type SessionStatus } from "@/features/auth/api";
import {
  describeLoginError,
  fieldErrorsFromApi,
  hasFieldErrors,
  needsFreshSession,
  validateLoginInput,
  type LoginFieldErrors,
} from "@/features/auth/validation";
import { readReturnTo } from "@/features/workspace/return-context";
import { resetOwnerSessionCache } from "@/features/workspace/session";
import { clearAllWorkDraftLocalCopies } from "@/features/workspace/use-work-draft";

/**
 * 登录成功后的站内返回（契约 §9.5）。
 *
 * 单独做成子组件：只有确实带 `?returnTo=` 参数时才挂载，因此调用 `useRouter`
 * 的时机受控，未带参数的原有用例（jsdom 里没有 App Router）不受影响。
 */
function LoginReturnRedirect({ target }: { target: string }) {
  const router = useRouter();
  useEffect(() => {
    // replace：登录页不留在后退栈里。
    router.replace(target);
  }, [router, target]);
  return <p role="status">正在返回来源页面…</p>;
}

type Phase = "loading" | "ready" | "submitting" | "unavailable";

const FIELD_STYLE = {
  display: "block",
  width: "100%",
  boxSizing: "border-box" as const,
  marginTop: 4,
  padding: "8px 10px",
  font: "inherit",
};

export default function AdminLoginPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");
  /** 登录成功后的站内返回目标；null = 本页没有 returnTo 参数（保持旧行为）。 */
  const [returnTarget, setReturnTarget] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  // 读取 `?returnTo=`：先经 safeInternalPath 白名单校验，非法回 `/admin`（契约 §9.5）。
  // 用 window.location 而不是 useSearchParams：本页是纯客户端视图，也避免静态渲染时的
  // Suspense 边界要求；没有参数时不设置目标，保持原登录页行为。
  useEffect(() => {
    if (typeof window === "undefined") return;
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      if (!params.has("returnTo")) return;
      setReturnTarget(readReturnTo(params) ?? "/admin");
    })();
  }, []);

  /**
   * 读取会话状态。
   *
   * 注意：这里**同步部分不调用 setState** —— 置位「加载中」由调用方决定
   * （初始态本来就是 loading；用户点「重新连接」时在事件处理里显式置位）。
   * 这样 effect 里调用它不会触发「挂载即同步 setState」的额外渲染。
   */
  const loadSession = useCallback(async (announce = false): Promise<void> => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const payload = await fetchSession(controller.signal);
      setSession(payload);
      setPhase("ready");
      if (announce) setStatusMessage("已重新获取登录凭证，请重试。");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setFormError(describeLoginError(error));
      setPhase("unavailable");
    }
  }, []);

  useEffect(() => {
    // 挂载时读取一次会话，用于拿到 CSRF token（初始 phase 已是 "loading"，
    // 因此这里同步部分不置位任何状态，只发起请求）。
    const controller = new AbortController();
    requestRef.current = controller;
    void (async () => {
      try {
        const payload = await fetchSession(controller.signal);
        setSession(payload);
        setPhase("ready");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFormError(describeLoginError(error));
        setPhase("unavailable");
      }
    })();
    return () => {
      // 卸载时取消未完成的读取：模块退出不留挂起请求（验收 §1）。
      controller.abort();
      requestRef.current = null;
    };
  }, []);

  async function refreshSession(): Promise<void> {
    setPhase("loading");
    setFormError(null);
    await loadSession();
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);
    setStatusMessage("");

    const localErrors = validateLoginInput(username, password);
    setFieldErrors(localErrors);
    if (hasFieldErrors(localErrors)) return;
    if (!session) {
      setFormError("登录凭证尚未就绪，请稍后重试。");
      return;
    }

    setPhase("submitting");
    try {
      const payload = await login({ username: username.trim(), password }, session.csrf_token);
      // 登录成功：会话与 CSRF token 都已被服务端轮换，用响应里的新状态覆盖本地。
      setSession(payload);
      setPassword("");
      setFieldErrors({});
      setStatusMessage("登录成功。");
      setPhase("ready");
      // 让创作台/前台入口的站主身份探针缓存失效：下次挂载会重新确认已登录。
      resetOwnerSessionCache();
    } catch (error) {
      setFieldErrors(fieldErrorsFromApi(error));
      setFormError(describeLoginError(error));
      setPhase("ready");
      if (needsFreshSession(error)) {
        // 403（CSRF / Origin）或 401：重新取一次预登录会话，让用户可以直接重试。
        setPhase("loading");
        await loadSession(true);
      }
    }
  }

  async function handleLogout(): Promise<void> {
    if (!session) return;
    setFormError(null);
    setPhase("submitting");
    try {
      await logout(session.csrf_token);
      // P5：主动退出登录清除全部本机恢复副本（契约 §3.2 / §9.4），并让入口缓存失效。
      clearAllWorkDraftLocalCopies();
      resetOwnerSessionCache();
      setStatusMessage("已注销。");
      setPhase("loading");
      await loadSession();
    } catch (error) {
      setFormError(describeLoginError(error));
      setPhase("ready");
    }
  }

  const authenticated = session?.authenticated === true;
  const busy = phase === "loading" || phase === "submitting";
  const redirecting = authenticated && returnTarget !== null;

  return (
    <main style={{ maxWidth: 420, margin: "0 auto", padding: "24px 16px", fontFamily: "system-ui, sans-serif" }}>
      {redirecting ? <LoginReturnRedirect target={returnTarget} /> : null}
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>PHANTOM LOG · 站主登录</h1>
      <p style={{ marginTop: 0, color: "#555", fontSize: 14 }}>
        本站没有公开注册；账号由部署期 CLI 初始化。
      </p>

      {phase === "unavailable" ? (
        <section role="alert" style={{ border: "1px solid #b00", padding: 12, marginBottom: 12 }}>
          <p style={{ margin: 0 }}>{formError ?? "服务暂时不可用。"}</p>
          <button type="button" onClick={() => void refreshSession()} style={{ marginTop: 8 }}>
            重新连接
          </button>
        </section>
      ) : null}

      {authenticated && session ? (
        <section>
          <p role="status">
            已登录：<strong>{session.user?.username}</strong>
          </p>
          <p style={{ fontSize: 14, color: "#555" }}>
            管理外壳与受保护页面由 T02 提供；本页只负责建立站主会话。
          </p>
          <button type="button" onClick={() => void handleLogout()} disabled={busy}>
            注销
          </button>
        </section>
      ) : (
        <form onSubmit={handleSubmit} noValidate>
          <div style={{ marginBottom: 12 }}>
            <label htmlFor="username">用户名</label>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              aria-invalid={fieldErrors.username ? true : undefined}
              aria-describedby={fieldErrors.username ? "username-error" : undefined}
              disabled={busy}
              style={FIELD_STYLE}
            />
            {fieldErrors.username ? (
              <p id="username-error" role="alert" style={{ color: "#b00", margin: "4px 0 0", fontSize: 14 }}>
                {fieldErrors.username}
              </p>
            ) : null}
          </div>

          <div style={{ marginBottom: 12 }}>
            <label htmlFor="password">密码</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={fieldErrors.password ? true : undefined}
              aria-describedby={fieldErrors.password ? "password-error" : undefined}
              disabled={busy}
              style={FIELD_STYLE}
            />
            {fieldErrors.password ? (
              <p id="password-error" role="alert" style={{ color: "#b00", margin: "4px 0 0", fontSize: 14 }}>
                {fieldErrors.password}
              </p>
            ) : null}
          </div>

          <button type="submit" disabled={busy}>
            {phase === "submitting" ? "登录中…" : "登录"}
          </button>

          <p aria-live="polite" style={{ minHeight: 20, fontSize: 14 }}>
            {statusMessage}
          </p>
          {formError ? (
            <p role="alert" style={{ color: "#b00" }}>
              {formError}
            </p>
          ) : null}
        </form>
      )}
    </main>
  );
}
