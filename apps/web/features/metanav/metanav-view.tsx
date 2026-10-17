"use client";

/**
 * 主视图：屏幕路由（已发现殿堂 / 认知定位 / 普通搜索 / 印象空间）。
 *
 * 手机里的内置应用与独立页渲染的是**同一个** `MetanavView`，只是宿主不同
 * （见 `host.ts` 的对照表）。
 *
 * 殿堂阅读视图：**手机里是 `screen=palace` 这条屏幕**（留在手机内，§3.3 导航一致性）；
 * 独立页仍走 canonical 页面（`/apps/metanav/palaces/<slug>`），来源固定为
 * `metaverse-entry`（04 §4A / §7）。
 *
 * 非法屏幕名回退到默认的「已发现殿堂」，不执行任意路径（02 §6）。
 */

import type { ReactNode } from "react";

import { isMetanavScreen, type MetanavHost } from "./host";
import styles from "./metanav.module.css";
import { MugenScreen } from "./mugen-screen";
import { PalacesScreen } from "./palaces-screen";
import { PalaceReadingLoader } from "./palace-reading-loader";
import { ResolveScreen } from "./resolve-screen";
import { SearchScreen } from "./search-screen";

export function MetanavView({
  screen,
  item,
  host,
}: {
  screen: string | null;
  item?: string | null;
  host: MetanavHost;
}): ReactNode {
  const active = isMetanavScreen(screen) ? screen : "palaces";

  return (
    <div className={styles.wrap} data-metanav-screen={active} data-metanav-item={item ?? ""}>
      {active === "resolve" ? <ResolveScreen host={host} /> : null}
      {active === "search" ? <SearchScreen host={host} /> : null}
      {active === "mugen" ? <MugenScreen host={host} /> : null}
      {active === "palaces" ? <PalacesScreen host={host} /> : null}
      {active === "palace" && item ? (
        <div>
          <div className={styles.actions}>
            <button
              className={`${styles.button} ${styles.buttonGhost}`}
              type="button"
              onClick={() => host.changeScreen("palaces")}
            >
              返回导航
            </button>
          </div>
          <PalaceReadingLoader slug={item} onBack={() => host.changeScreen("palaces")} />
        </div>
      ) : null}
    </div>
  );
}
