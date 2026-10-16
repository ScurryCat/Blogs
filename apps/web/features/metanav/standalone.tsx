"use client";

/**
 * 独立页宿主：把 `MetanavView` 接到站点的导航协调器、Toast 与本机状态上。
 *
 *  - 屏幕状态放在 URL 的 `screen` / `item` 查询参数里（可分享、可刷新、Back 可用）；
 *  - 换屏用 `navigation.updateUrl`（等价于 `phone-internal`：**不播全屏过场**）；
 *  - 「进入殿堂」由 `EnterPalace` 渲染成 `SiteLink`（`metaverse-entry`），
 *    过场交给共享协调器，这里不创建任何遮罩、不使用地图人群；
 *  - 本机状态用与手机同一套键（`pl-app:metanav:v1:*`），因此手机与独立页共享足迹。
 *
 * 页面不读 `window`（除事件回调外），因此服务端预渲染与客户端水合结果一致。
 */

import { useSearchParams } from "next/navigation";
import { useMemo, type ReactNode } from "react";

import { useNavigation } from "@/features/runtime/navigation/coordinator";
import { useToast } from "@/features/runtime/toast";

import { createBrowserStateAdapter } from "./footprint";
import { isMetanavScreen, type MetanavHost } from "./host";
import { MetanavView } from "./metanav-view";

/** 由当前查询串构造换屏后的地址（保留其它参数，`item` 为空时删掉）。 */
export function buildScreenHref(
  pathname: string,
  search: string,
  screen: string,
  item: string | null,
): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  params.set("screen", screen);
  if (item) params.set("item", item);
  else params.delete("item");
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function MetanavStandalone({
  pathname = "/apps/metanav",
}: {
  pathname?: string;
}): ReactNode {
  const params = useSearchParams();
  const navigation = useNavigation();
  const toast = useToast();

  const rawScreen = params?.get("screen") ?? null;
  const item = params?.get("item") ?? null;
  // 非法屏幕名回退到默认屏幕，不执行任意路径（02 §6）。
  const screen = isMetanavScreen(rawScreen) ? rawScreen : "palaces";
  const search = params?.toString() ?? "";
  const state = useMemo(() => createBrowserStateAdapter(), []);

  const host = useMemo<MetanavHost>(
    () => ({
      mode: "site",
      openContent(request) {
        navigation.navigate(request);
      },
      changeScreen(next, nextItem) {
        navigation.updateUrl(buildScreenHref(pathname, search, next, nextItem ?? null));
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
      <MetanavView screen={screen} item={item} host={host} />
      <p className="data-notice" role="note">
        这一页可以直接分享或加入书签：地址栏里的 <code>screen</code> 决定停在哪一屏，
        专题各有自己的地址（<code>/apps/metanav/palaces/&lt;slug&gt;</code>）。
      </p>
    </>
  );
}
