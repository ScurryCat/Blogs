# P4 补充交付：表单提示文字对比度 + 键盘焦点可见性 + 滑杆命中区

> 目的：上一轮 WCAG 对比度巡检覆盖了正文/标签文字，但**表单提示文字（placeholder）**、
> **键盘焦点可见性**与**滑杆命中区**不在其覆盖内。本轮补齐这三项，形成完整的键盘/表单可及性收尾。
> 日期：2026-10-17 · 分支 `main` · **未 push**

---

## 1. 键盘焦点可见性审计（13 条页面，全部通过）

方法：真实浏览器里用 **Tab 键**逐项走查每页可交互元素（链接/按钮/输入/下拉/滑块/标签页），
比较「聚焦前/聚焦后」的计算样式（outline、box-shadow、border、background、color 任一变化即视为
有可见焦点指示）；最多 40 步/页。

| 页面 | 结论 |
| --- | --- |
| `/`、`/about`、`/posts`、`/guestbook` | 全部元素有可见焦点变化 ✅ |
| `/showcase`、`/gallery`、`/velvet` | ✅ |
| `/apps/metanav`、`/apps/metanav?screen=resolve`、`/apps/coop`、`/apps/leisure`、`/apps/journal`、`/apps/metanav/mementos` | ✅ |

原因：`styles/legacy/base.css` 的全局 `:focus-visible { outline: 3px solid var(--paper) }` 覆盖良好；
少数写了 `outline: none` 的控件都同时改边框/背景（例如留言板输入框聚焦时换左边框红色）。
**本轮未发现焦点不可见的问题，无需修改。**

## 2. 表单提示文字（placeholder）对比度修正

| 位置 | 原值 | 对比度 | 修正 |
| --- | --- | --- | --- |
| 异世界导航「认知定位 / 普通搜索」输入框 | `rgba(244,241,234,.4)` on `#141416` | **≈2.9:1**（不达 4.5） | `rgba(244,241,234,.62)` → **≈5.6:1** |
| IM 输入框（纸白底） | `#8d8781` on `#f4f1ea` | **≈3.1:1** | `#6b665f` → **≈5:1** |
| 留言板 / 天气搜索（legacy） | `var(--dim)` `#9b968e` on 深色 | ≈6:1 ✅ | 不改 |

## 3. 手机滑杆的命中区域（桌面缩放档）

- 现象：手机外壳在桌面是等比缩放的（`--z` ≈ .5），`.pw-bar` 视觉高度 13px 缩到约 6px，
  鼠标很难点中/拖动。
- 既有实现：620px 以下的外壳已用 `.pw-bar::before { inset: -20px 0 }` 把热区撑到 46px；
  **桌面缩放档没有**。
- 修复：`app/globals.css` 增加 `@media (min-width: 621px)` 的 `.pw-bar::before { inset: -12px 0 }`
  （不动移动端已有的实现）。
- 验证：隔离环境没有音乐文件，播放器处于 `pw-empty`（pointer-events:none）；在浏览器里临时移除
  `pw-empty` 后做命中测试 —— 滑杆中心、上下 ±6/±10/±13px 的 `elementFromPoint` 均落在 `.pw-bar`，
  热区扩展生效（截图环境限制已注明）。

## 4. 验证结果

| 检查 | 结果 |
| --- | --- |
| 焦点可见性（13 页面 × Tab 走查） | 全部有可见焦点变化，0 缺失 |
| placeholder 实测色值 | `rgba(244,241,234,.62)` / `#6b665f` |
| 滑杆命中测试（移除 disabled 态模拟） | 中心/上下 ±13px 均命中滑杆 |
| 对比度工具复跑（12 页面） | 仍为 4 项（均为已记录的品牌红面板黑字，与表单无关） |
| 前端 typecheck / lint / build / 单测 | 见本轮汇总（0 / 0 / exit 0 / 929 tests） |
| `bash tools/verify-all.sh --e2e` | 见本轮汇总（CSS-only 改动；上一轮同点全绿） |

## 5. 修改文件

- `apps/web/app/globals.css`：15.3 桌面缩放滑杆命中区。
- `apps/web/features/metanav/metanav.module.css`：输入框 placeholder 提亮。
- `apps/web/features/messaging/messaging.css`：IM 输入框 placeholder 加深。
- `docs/agent-deliveries/P4-form-focus-a11y.md`：本报告。

## 6. 未完成 / 记录项

1. 表单 placeholder 的对比度不属于 WCAG 正文条款的强制项（但属可用性建议），本轮已按 AA 正文口径修正。
2. 其余既有未完成项不变：整屏参考帧（G2/G3）、B4 决策、P4 原版图标、真机验证、品牌红面板对照度折中。
