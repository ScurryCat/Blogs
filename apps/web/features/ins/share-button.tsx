"use client";

/**
 * 分享按钮（03 §2「复制链接」/ §4「URL 分享到 canonical 详情页」）。
 *
 * 规则：
 *  - 分享的是 **canonical 独立页地址**（`/apps/ins/<uuid>`），不带手机参数、
 *    不含聊天正文或身份凭据（SHARED-CONTRACTS §4）；
 *  - 剪贴板不可用（非 HTTPS、权限拒绝、旧浏览器）时给出**可选中的文本框**，
 *    不谎报「已复制」；
 *  - 优先用 `navigator.share`，不可用时回落到复制。
 */

import { useCallback, useRef, useState, type ReactNode } from "react";

import { canonicalMomentPath } from "./types";

export interface ShareButtonProps {
  momentId: string;
  title?: string;
}

export function ShareButton({ momentId, title = "图文动态" }: ShareButtonProps): ReactNode {
  const [message, setMessage] = useState<string | null>(null);
  const [manualUrl, setManualUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const share = useCallback(async () => {
    const path = canonicalMomentPath(momentId);
    const absolute = typeof window === "undefined" ? path : `${window.location.origin}${path}`;

    // 1) 系统分享面板（手机浏览器有）。
    const navigatorWithShare = navigator as Navigator & {
      share?: (data: { title?: string; url?: string }) => Promise<void>;
    };
    if (typeof navigatorWithShare.share === "function") {
      try {
        await navigatorWithShare.share({ title, url: absolute });
        setMessage("已打开系统分享。");
        setManualUrl(null);
        return;
      } catch (error) {
        // 用户取消不算失败；其他错误继续走复制。
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }

    // 2) 剪贴板。不可用时把地址显示出来让用户自己复制。
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(absolute);
      setMessage("链接已复制。");
      setManualUrl(null);
    } catch {
      setManualUrl(absolute);
      setMessage("无法自动复制，请手动复制下面的地址。");
      // 暴露给键盘用户：聚焦到输入框并全选。
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [momentId, title]);

  return (
    <span className="ins-share">
      <button type="button" className="ins-btn" onClick={() => void share()}>
        分享
      </button>
      {message ? (
        <span className="ins-share-note" role="status">
          {message}
        </span>
      ) : null}
      {manualUrl ? (
        <label className="ins-share-manual">
          <span className="visually-hidden">分享地址</span>
          <input ref={inputRef} type="text" readOnly value={manualUrl} />
        </label>
      ) : null}
    </span>
  );
}
