"use client";

/**
 * 手机内置视图：INS（T03 交付，由 T00 在 `features/phone/registry.ts` 登记；
 * 宿主读取的模块形状见同目录的 `phone-app.tsx`）。
 *
 * 宿主契约（`features/phone/types.ts`、02 §4）：
 *  - 只用 `PhoneViewProps` 的四个字段与 `host` 的八项能力；
 *  - **不碰全局 DOM、不锁 body、不新增 `<audio>`、不覆写 history**；
 *  - 非法 `item`（不是 UUID）显示「未找到」，**不执行任意路径**；
 *  - 音乐继续播放：本视图不创建、不播放任何音频（验收用例 6）。
 *
 * 与独立页共用同一套组件与数据（03 §1：「同一内容在手机与 canonical 页面使用
 * 同一功能视图和数据」）：`InsShell` + `FeedView` + `DetailView` + `SavedView`。
 *
 * 消息页签 **不在这里**：它属 T08，未接入时不显示按钮，也不显示在线状态（验收用例 5）。
 */

import { useCallback, type ReactNode } from "react";

import type { PhoneViewProps } from "@/features/phone/types";

import { DetailView } from "./detail-view";
import { FeedView } from "./feed-view";
import { InsShell } from "./ins-shell";
import { INS_SAVED_TAB } from "./composition";
import { isMomentId } from "./types";

/** 与 `phone-app.tsx` 的 `screens` 保持一致；顺序即默认屏优先顺序。 */
export const INS_APP_SCREENS = ["feed", "detail", "saved"] as const;

export function InsPhoneView({ screen, item, mode, host }: PhoneViewProps): ReactNode {
  const openDetail = useCallback(
    (momentId: string) => {
      // 宿主管理返回与历史（02 §6）；应用只声明目的地，不直接改 history。
      host.navigateScreen("detail", momentId);
    },
    [host],
  );

  if (screen === "detail") {
    if (!isMomentId(item)) {
      // 非法 / 缺失 ID：明确提示，不猜也不跳转（不执行任意路径）。
      return (
        <div className="ins-app">
          <div className="ins-state" role="status">
            <p className="ins-state-kicker">NOT FOUND</p>
            <h2>这条动态不存在</h2>
            <p>链接里的编号不是有效的动态 ID。</p>
            <button type="button" className="ins-btn" onClick={() => host.navigateScreen("feed")}>
              回到动态
            </button>
          </div>
        </div>
      );
    }
    return (
      <InsShell
        renderFeed={() => null}
        // 手机里不显示「返回列表」：返回由宿主统一处理（02 §6）。
        detail={<DetailView momentId={item} hideBackLink />}
      />
    );
  }

  if (screen === "saved") {
    return <InsShell initialTab={INS_SAVED_TAB} renderFeed={() => null} />;
  }

  return (
    <InsShell
      renderFeed={() => <FeedView tag={null} />}
      headerExtra={
        <p className="ins-phone-hint" role="note">
          {mode === "expanded"
            ? "展开视图：点图片预览，点「查看详情」进入完整动态。"
            : "点卡片图片预览，点「查看详情」进入完整动态。"}
        </p>
      }
    />
  );
}

/**
 * 打开某个动态的屏幕目标（纯函数，供其他应用或测试使用）。
 * 调用方拿到后再交给宿主的 `navigateScreen`，不直接操作 history。
 */
export function momentScreenTarget(momentId: string): { screen: string; item: string } {
  return { screen: "detail", item: momentId };
}

export { openDetailViaHost };

function openDetailViaHost(host: PhoneViewProps["host"], momentId: string): void {
  if (!isMomentId(momentId)) return;
  const target = momentScreenTarget(momentId);
  host.navigateScreen(target.screen, target.item);
}
