"use client";

/**
 * 独立页宿主：屏幕状态放在 URL 的 `screen` 里（可分享、可刷新、Back 可用），
 * 换屏用 `navigation.updateUrl`（`phone-internal` 语义：**不播全屏过场**）。
 */

import { useSearchParams } from "next/navigation";
import { useMemo, type ReactNode } from "react";

import { useNavigation } from "@/features/runtime/navigation/coordinator";
import { useToast } from "@/features/runtime/toast";

import { LeisureView } from "./leisure-view";
import { isLeisureScreen, type LeisureHost } from "./host";
import { createBrowserStateAdapter } from "./state";

export function buildScreenHref(pathname: string, search: string, screen: string): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  params.set("screen", screen);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function LeisureStandalone({ pathname = "/apps/leisure" }: { pathname?: string }): ReactNode {
  const params = useSearchParams();
  const navigation = useNavigation();
  const toast = useToast();

  const rawScreen = params?.get("screen") ?? null;
  // 非法屏幕名回退到默认页签，不执行任意路径（02 §6）。
  const screen = isLeisureScreen(rawScreen) ? rawScreen : "anime";
  const search = params?.toString() ?? "";
  const state = useMemo(() => createBrowserStateAdapter(), []);

  const host = useMemo<LeisureHost>(
    () => ({
      mode: "site",
      openContent(request) {
        navigation.navigate(request);
      },
      changeScreen(next) {
        navigation.updateUrl(buildScreenHref(pathname, search, next));
      },
      state,
      toast(message, options) {
        toast.show(message, { tone: options?.tone });
      },
    }),
    [navigation, pathname, search, state, toast],
  );

  return (
    <>
      <LeisureView screen={screen} host={host} />
      <p className="data-notice" role="note">
        这一页可以直接分享或加入书签：地址栏里的 <code>screen</code> 决定停在追番还是游戏
        （<code>/apps/leisure?screen=anime</code> 或 <code>?screen=game</code>）。
      </p>
    </>
  );
}
