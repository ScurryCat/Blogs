/**
 * 页脚跑马灯 —— 旧站 `core.js` 的 `ticker()` 迁移。
 * 内容重复两遍以保证无缝循环（与旧站一致），整体 `aria-hidden`。
 */

import type { ReactNode } from "react";

import { site } from "../config";

export function Ticker(): ReactNode {
  // 重复两遍做无缝循环；两遍在同一个父节点下，key 必须唯一。
  const items = [...site.ticker, ...site.ticker];
  return (
    <div className="ticker" aria-hidden="true">
      <div className="ticker-in">
        {items.map((text, index) => (
          <span key={index}>
            {text}
            &nbsp;&nbsp;
            <em>★</em>
            &nbsp;&nbsp;
          </span>
        ))}
      </div>
    </div>
  );
}
