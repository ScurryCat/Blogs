"use client";

/**
 * 独立页宿主：把 `JournalView` 接到站点的导航协调器、Toast 与本机状态上。
 *
 *  - 屏幕状态放在 URL 的 `screen` 查询参数里（可分享、可刷新、Back 可用）；
 *  - 换屏用 `navigation.updateUrl`（等价于 `phone-internal`：**不播全屏过场**）；
 *  - 打开某篇手记由 `EntryReading` 里的 `SiteLink` 完成（`top-nav`），
 *    过场交给共享协调器，这里不创建任何遮罩。
 */

import { useSearchParams } from "next/navigation";
import { useMemo, type ReactNode } from "react";

import { useNavigation } from "@/features/runtime/navigation/coordinator";
import { useToast } from "@/features/runtime/toast";
import { JournalView } from "./journal-view";
import { isJournalScreen, type JournalHost } from "./host";
import { createBrowserStateAdapter } from "./state";

/** 由当前查询串构造换屏后的地址（保留其它参数）。 */
export function buildScreenHref(pathname: string, search: string, screen: string): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  params.set("screen", screen);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function JournalStandalone({ pathname = "/apps/journal" }: { pathname?: string }): ReactNode {
  const params = useSearchParams();
  const navigation = useNavigation();
  const toast = useToast();

  const rawScreen = params?.get("screen") ?? null;
  // 非法屏幕名回退到默认屏幕，不执行任意路径（02 §6）。
  const screen = isJournalScreen(rawScreen) ? rawScreen : "list";
  const search = params?.toString() ?? "";
  const state = useMemo(() => createBrowserStateAdapter(), []);

  const host = useMemo<JournalHost>(
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
      <JournalView screen={screen} host={host} />
      <p className="data-notice" role="note">
        这一页可以直接分享或加入书签：地址栏里的 <code>screen</code> 决定停在列表还是日历，
        每篇手记有自己的地址（<code>/apps/journal/&lt;id&gt;</code>）。
      </p>
    </>
  );
}
