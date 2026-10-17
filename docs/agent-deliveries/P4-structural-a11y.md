# P4 补充交付：结构可及性巡检（无效 ARIA 引用修复 + 可复用工具）

> 目的：在对比度、焦点、表单之后，补最后一类可及性检查 —— **HTML/ARIA 结构本身是否合法**
> （图片 alt、重复 id、悬空 aria 引用、控件可访问名称、main 数量、标题层级）。
> 本轮发现并修复 2 处**真实的无效 ARIA 引用**，并交付可复用巡检工具。
> 日期：2026-10-17 · 分支 `main` · **未 push**

---

## 1. 工具：`tools/audit-structure.py`（新增，可复用）

Playwright + 系统 Chromium，对 15 条主要页面/子页面检查：

| # | 检查项 | 判定 |
| --- | --- | --- |
| 1 | `<img>` 缺 `alt` 属性 | HRAD（硬问题）|
| 2 | 重复 `id` | HARD |
| 3 | `aria-controls` / `aria-labelledby` / `aria-describedby` 指向不存在的 id | HARD |
| 4 | 表单控件无可访问名称（显式 label / 包裹 label / aria-label / placeholder） | HARD |
| 5 | 按钮 / 站内链接无可访问名称（排除 aria-hidden 装饰件） | HARD |
| 6 | `<main>` 数量 / 文档标题 | HARD（main≠1） |
| 7 | 标题层级跳级（h1→h3 等） | **仅提示**（非 WCAG 失败项）|

`--json` 落盘；有硬问题时退出码 1。

## 2. 发现与修复：2 处无效 ARIA 引用

| 位置 | 问题 | 修复 |
| --- | --- | --- |
| 全站迷你播放器（`features/runtime/audio/mini-player.tsx`） | 展开按钮始终 `aria-controls="mini-panel"`，但面板只在展开时渲染 → 收起态是**悬空引用**（每页都有） | `aria-controls={expanded ? "mini-panel" : undefined}` |
| COOP 友链卡（`features/coop/friend-card.tsx`） | 「展开相识故事」按钮始终 `aria-controls="coop-story-<id>"`，故事容器只在展开时渲染 → 悬空引用（首页/关于/COOP 页都有） | `aria-controls={expanded ? ... : undefined}` |

两处都保留 `aria-expanded`（这是状态表达的正确属性），只把**引用**限定在目标存在的时机。

## 3. 巡检结果（修复后 15/15 页无硬问题）

| 页面 | alt 缺失 | 重复 id | 悬空 ARIA | 控件无名称 | main |
| --- | --- | --- | --- | --- | --- |
| home / about / posts / guestbook | 0 | 0 | 0 | 0 | 1 |
| showcase / showcase 详情 / gallery / 相册页 | 0 | 0 | 0 | 0 | 1 |
| velvet / 技能详情 / metanav / 认知定位 | 0 | 0 | 0 | 0 | 1 |
| coop / leisure / journal / 日历 / mementos | 0 | 0 | 0 | 0 | 1 |

**结果：15 页 0 个硬问题**（修复前：每页 1 个 `mini-panel` + 3 页各 3 个 coop story 悬空引用）。

补充说明（best-practice，未改）：
- 4 个应用独立页（`/apps/coop`、`/apps/leisure`、`/apps/journal`、`/apps/metanav`）没有 `h1`
  （标题用 h2；页面标题由 `<title>` 提供）。WCAG 不要求必须有 h1，故只记录；
- 站点页脚 `HIDEOUT/CONTACT` 用 h3，在 h1/h2 之后出现属「跳级」提示，非 WCAG 失败项；
- 我的脚本曾把 `<a aria-hidden tabindex="-1">` 装饰链接与「包裹式 label」的表单控件报出，工具里已按规范排除这两类。

## 4. 验证

| 检查 | 结果 |
| --- | --- |
| `tools/audit-structure.py`（15 页） | **0 硬问题**（修复后） |
| 前端单测 / typecheck / lint / build | 见本轮汇总（929 tests / 0 / 0 / exit 0） |
| `bash tools/verify-all.sh --e2e` | 见本轮汇总（两处属性改动不影响交互，预期全绿） |
| 对比度 / 焦点 / 触控目标 | 上一轮已全绿，本轮未触碰 |

## 5. 交付 & 回退

- 新增 `tools/audit-structure.py`（已加入交接包工具白名单）；
- `mini-player.tsx` / `friend-card.tsx` 两处 `aria-controls` 条件化。
- 回退：恢复两处无条件 `aria-controls` 即可（会重新引入悬空引用，不建议）。

## 6. 未完成 / 记录项

1. 应用独立页 h1 缺失与页脚标题层级：best-practice，记录不改（避免为语义微调动版式）。
2. 其余既有未完成项不变：整屏参考帧（G2/G3）、B4 决策、P4 原版图标、真机验证、品牌红面板对照度折中。
