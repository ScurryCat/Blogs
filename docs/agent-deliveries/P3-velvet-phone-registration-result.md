# P3 补充交付：天鹅绒/印象空间登记进手机桌面 + 天鹅绒视觉细化 v1（§4.8）

> 任务书：`2026-10-17-p5-phone-ui-v2-agent-brief.md`（第二轮）§4.8「天鹅绒房间 + 印象空间」、§2.2 手机桌面。
> 承接：交接包 `docs/handoff-package-2026-10-17.zip` 的 B1 / P4（手机桌面与图标）。
> 日期：2026-10-17 · 分支 `main` · **未 push / 未部署**

---

## 1. 完成范围

| 任务书条目 | 状态 | 说明 |
| --- | --- | --- |
| §4.8「天鹅绒房间 / 印象空间作为手机内置应用」 | ✅ **补登记完成** | 两包的 `phone-manifest.ts` 早已交付，但**从未登记进 `PHONE_APPS`**：`?phone=velvet` / `?phone=mementos` 会静默回落到桌面，桌面也没有入口。本轮补登记（order 70 / 80），桌面第 2 页自动追加两个入口，deep link 直接打开对应应用 |
| §2.2 手机桌面 | ✅ | 宿主「固定排列之外已登记应用追加到末页」的既有机制生效，未改宿主布局；桌面 2 页不变（第 2 页 4 个站点链接 + 2 个新应用） |
| 桌面图标资源 | ✅ 修复缺陷 | 桌面 `ICON_STYLE="raster"` 会请求 `app/<id>.png`，两个新应用没有位图 → **裂图**。补 `app/velvet.png` / `app/mementos.png`（由本清单允许的 `icon/queen.webp`、`icon/mementos.webp` 做 WebP→PNG 格式转换，非 AI 重绘），并在 `registry.test.ts` 加回归断言防再犯 |
| §4.8 天鹅绒「蓝色空间、技能全书、选择条目的视觉」 | 🟡 v1 细化 | 站点已有 T09 的蓝黑主题；本轮按 `92152-velvet-prison` 元件表补**登记簿**观感：技能卡带 `No.01..` 登记编号、冷色描边 + 冷光硬阴影、撕裂字体标题、页签/合体面板冷色号牌、`×` 刻印放大 |
| 完整整屏参考帧 | ⛔ 仍缺 | 本地只有 HUD 元件表（蓝黑牢房背景、名簿网格、撕裂标签），无整屏 → 只标 v1 部分还原 |
| 印象空间视觉细化 | ⏭ 留待下一轮 | 本轮先打通入口并验证可打开（列表正常，`exploration.css` 已有独立暗紫主题，尚未做视觉复核与细化） |

## 2. 修改文件

| 文件 | 改动 |
| --- | --- |
| `apps/web/features/phone/registry.ts` | 登记 `VELVET_MANIFEST`（70）/ `EXPLORATION_MANIFEST`（80），补注释说明「§4.8 要求 + manifest 早已交齐但未登记」 |
| `apps/web/features/phone/registry.test.ts` | 桌面应用清单断言追加 `velvet`/`mementos`；**新增回归测试**：每个登记应用必须有 `app/<id>.png` 或自绘 SVG 图标（防裂图） |
| `apps/web/tests/phone/phone-host.test.tsx` | 第 2 页断言追加 `velvet`/`mementos`（固定排列之外的登记应用追加在末页） |
| `apps/web/public/assets/legacy/img/app/velvet.png`（新增） | `icon/queen.webp` → PNG 格式转换（160×160 RGBA），非 AI 重绘 |
| `apps/web/public/assets/legacy/img/app/mementos.png`（新增） | `icon/mementos.webp` → PNG 格式转换（128×128 RGBA），非 AI 重绘 |
| `apps/web/features/velvet/velvet.css` | 新增「视觉细化 v1」段落（约 +330 行）：登记编号 counter、冷色卡片/页签/合体面板/按钮/结果条、`@container` 窄屏、`.plv-room` 容器类型；全部 `.plv-` 前缀、不覆写全站变量（`velvet-css.test.ts` 通过） |
| `docs/design-references/persona-assets-allowlist.md` | app 图标 10→12 张；新增 §2.4 记录两张格式转换图标的来源、处理与哈希前 16 位 |
| `docs/design-references/reference-frame-gaps.md` | 补充「天鹅绒：只有元件表、无整屏帧」判定（§6.8） |
| `docs/agent-deliveries/P3-velvet-phone-registration-result.md` | 本报告 |

**未改动**：天鹅绒/印象空间的数据、API、权限与业务语义（没有等级/熟练度等数值）；
手机桌面固定排列与宿主逻辑；其他应用。

## 3. 素材与参考

| 参考 | 路径 | 用途 |
| --- | --- | --- |
| P5 天鹅绒/牢房元件表 | `persona5-spriters/p5/hud/92152-velvet-prison.png` | 蓝黑牢房背景 + 冷光；「ペルソナの登録 / 名簿記載」的**名簿网格**语言、現在のステータス 白色栏目牌、撕裂字体 |
| 站点既有冷色主题 | `features/velvet/velvet.css`（T09） | 冷色变量只在 `.plv-room` 子树内生效，未改全站红黑 |
| 迁移图标素材 | `icon/queen.webp`、`icon/mementos.webp`（均在本清单允许范围） | 桌面 34×34 raster 图标源；仅容器格式转换 |

## 4. 视觉证据

工作区外（本地，不入库）：`/Users/学习/blog/Blogs/.dsh/screenshots/` 与 `.dsh/vis2/`

| 文件 | 内容 |
| --- | --- |
| `p8-phone-desktop-page2.png` | 桌面第 2 页：站点链接 + **天鹅绒 / 印象空间**两个新入口（图标 `naturalWidth>0`，非裂图） |
| `p8-phone-velvet.png` | 手机内天鹅绒：7 张登记簿技能卡 |
| `p8-phone-mementos.png` | 手机内印象空间：问题记录列表可打开 |
| `p8-velvet-after.png` | 改后 `/velvet`：冷色号牌页签、合体登记台 + 大 `×`、`No.01/02/03` 登记编号、撕裂字体技能名 |
| `p8-velvet-skill-after.png` | 技能详情页（`/velvet/<slug>`） |
| `p8-velvet-390-after.png` | 390×844：单列、无横向溢出 |
| `.dsh/vis2/velvet-before.png` | 改前 `/velvet`（同页，蓝黑但无登记簿语言） |

## 5. 验证结果

| 命令 / 检查 | 结果 |
| --- | --- |
| `cd apps/web && npm run test -- --run` | **90 files / 929 tests passed**，exit 0 |
| `npx vitest run features/phone` | 2 files / **19 tests passed**（含新增图标回归） |
| `npx vitest run tests/phone` | 3 files / **30 tests passed**（第 2 页清单） |
| `npx vitest run features/velvet` | 8 files / **58 tests passed**（含样式隔离） |
| `npm run typecheck` / `npm run lint` / `npm run build` | 0 / 0 / exit 0 |
| 真实浏览器（隔离 e2e 全栈 + 7 条种子技能） | 桌面第 2 页出现「天鹅绒 / 印象空间」，图标已解码；点开天鹅绒渲染 7 张卡；返回桌面再开印象空间成功；`/velvet` 7 张卡、登记编号 `No.` counter 生效、卡片冷色描边 `rgba(159,216,255,.4)`、合体面板 + `×`、390 无横向溢出、手机宿主 7 张卡、无 JS 错误 |
| 技能详情页 | 打开正常（`/velvet/react-next-app-router`，页面类 `.plv-gate/.plv-section`）；脚本里按 `.plv-project-row` 找是断言写错，**非缺陷** |

## 6. 未完成项

1. **天鹅绒整屏参考帧仍缺** → 只标视觉细化 v1。
2. **印象空间视觉细化未做**（本轮只验证入口与列表可用；其 `exploration.css` 暗紫主题下一轮复核）。
3. 异世界导航经典红眼图标（G3）仍缺。
4. 手机桌面图标系统（P4）仍有更大目标：位图图标是第二轮 AI 生成的线条图标，未用原版图标；
   这也是「P4 原版图标」的遗留项（本地无原版应用图标素材）。
5. 真机触控、软键盘、移动 Safari 未验证（沿用交接包 §3.2）。

## 7. 集成说明与回退

- **改动**：`registry.ts` 增两个登记项、两份测试断言、两个新增位图图标、`velvet.css` 追加段落；
  无数据与 API 变更。
- **回退**：从 `PHONE_APPS` 移除两个 manifest 即可回到 7 应用桌面（图标/样式改动可保留）；
  `velvet.css` 删除末尾「视觉细化 v1」段落回到 T09 原样式。
- 与 `verify-all.sh --fast` 兼容（静态审计 + 单测 + typecheck/lint 全部通过）。
