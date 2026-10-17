# P3 补充交付：印象空间视觉细化 v1（问题档案）+ 四个详情页顶栏遮挡修复

> 任务书：`2026-10-17-p5-phone-ui-v2-agent-brief.md`（第二轮）§4.8「天鹅绒房间 + 印象空间」、§8.1。
> 承接：交接包 `docs/handoff-package-2026-10-17.zip` 的 B1「整屏视觉还原」。
> 上一轮已把天鹅绒/印象空间登记进手机桌面并细化天鹅绒；本轮处理 `/apps/metanav/mementos`。
> 日期：2026-10-17 · 分支 `main` · **未 push / 未部署**

---

## 1. 完成范围

| 任务书条目（§4.8「印象空间」） | 状态 | 说明 |
| --- | --- | --- |
| 问题记录列表的视觉 | 🟡 v1 完成 | 问题卡＝**档案条目**：品红左光条 + 硬阴影 + 交替微旋转 + 悬停抬升；`No.01..` 登记编号（CSS counter，只是列表顺序）；标题用展示字体；摘要纸白 |
| 工作状态语义 | ✅ 保持（强化） | 状态仍是**文字印章**（不是进度条/百分比）：已解决＝绿印章、暂搁置＝灰印章、其余品红印章；后端没有完成度字段，界面也不发明 |
| 统计与筛选 | 🟡 v1 | 统计计数＝品红号牌；筛选 chip＝撕纸斜切牌，当前项品红反白 |
| 问题详情页 | 🟡 v1 | 详情面板＝档案板（品红描边 + 硬阴影）、章节标题＝品红撕纸牌、正文纸白、关联入口/按钮号牌化 |
| 手机/窄屏 | ✅ | `.pme-wrap` 加容器查询：手机宿主内单列、取消旋转、字号收敛 |
| **顺手修复的缺陷**：四个详情页被固定 HUD 压住 | ✅ | 见 §1.1 |
| 完整整屏参考帧 | ⛔ 仍缺 | 本地只有天鹅绒/牢房元件表（T09 已定暗紫品红冷调），无印象空间整屏帧 → 只标 v1 部分还原 |

### 1.1 四个详情页仍在固定 HUD 之下（此前只修了顶层页面）

上一轮扫描并修复了顶层页面（`/showcase`、`/velvet`、`/gallery`、`/apps/*`）的顶部留白，
但**子路由页**没有一起覆盖。本轮扫描 `app/` 全目录，发现 4 个文件仍是裸 `section.shell`：

- `app/velvet/[slug]/page.tsx`（技能详情，3 处分支）
- `app/apps/metanav/palaces/[slug]/page.tsx`（殿堂阅读，3 处）
- `app/apps/metanav/mementos/page.tsx`（2 处）
- `app/apps/metanav/mementos/[slug]/page.tsx`（3 处）

全部改用共享 `AppPageShell`。实测四个页面 `.app-page` 计算 `padding-top: 96px`（HUD 66 + 30），
标题不再被压住 —— **至此仓库里已没有裸 `section.shell` 页面**（`grep` 结果为空）。

## 2. 修改文件

| 文件 | 改动 |
| --- | --- |
| `apps/web/features/exploration/exploration.css` | 新增「印象空间视觉细化 v1」段落（约 +330 行）：档案卡（编号 counter/品红硬阴影/撕裂标题/状态印章）、统计与筛选号牌、详情档案板、章节牌、关联入口与按钮号牌、`@container` 窄屏、`prefers-reduced-motion` 关位移；只用 `.pme-` 前缀、不覆写全站变量 |
| `apps/web/app/velvet/[slug]/page.tsx` | 3 个渲染分支改用 `AppPageShell` |
| `apps/web/app/apps/metanav/palaces/[slug]/page.tsx` | 3 个分支改用 `AppPageShell` |
| `apps/web/app/apps/metanav/mementos/page.tsx` | 2 个分支改用 `AppPageShell` |
| `apps/web/app/apps/metanav/mementos/[slug]/page.tsx` | 3 个分支改用 `AppPageShell` |
| `docs/design-references/reference-frame-gaps.md` | §6.8 补充印象空间判定（元件表级、无整屏帧） |
| `docs/agent-deliveries/P3-mementos-visual-result.md` | 本报告 |

**未改动**：问题记录的数据/API/权限、工作状态语义（没有完成度/百分比）、
撤回引用的整条消失规则、手机宿主逻辑、任何后端。

## 3. 素材与参考

| 参考 | 路径 | 用途 |
| --- | --- | --- |
| P5 天鹅绒/牢房元件表 | `persona5-spriters/p5/hud/92152-velvet-prison.png` | 牢门/冷光/名簿气质；印象空间沿用「档案/名录」气质但保持 T09 定的**暗紫品红冷调**，与天鹅绒蓝黑区分 |
| 站点既有暗紫主题 | `features/exploration/exploration.css`（T09） | 变量 `--m-plum` 等只在 `.pme-wrap` 子树内生效 |

> 本地参考库**没有**印象空间整屏帧；只做档案语言 v1，整屏还原仍标未完成。

## 4. 视觉证据

工作区外（本地，不入库）：`/Users/学习/blog/Blogs/.dsh/screenshots/` 与 `.dsh/vis2/`

| 文件 | 内容 |
| --- | --- |
| `.dsh/vis2/mementos-before.png` / `mementos-detail-before.png` | **改前**：标题被 HUD 压住、朴素暗紫卡片 |
| `p8-mementos-after.png` | **改后**：档案卡（No.01/02… 编号、品红硬阴影、展示字体标题、状态印章）、统计/筛选号牌、顶部留白已修 |
| `p8-mementos-detail-after.png` | **改后**详情：档案板 + 品红章节牌 + 纸白正文 |
| `p8-mementos-390-after.png` | 390×844：单列、无横向溢出 |
| `p8-mementos-phone-after.png` | 手机宿主（斜屏）内 7 张档案卡 |

## 5. 验证结果

| 命令 / 检查 | 结果 |
| --- | --- |
| `cd apps/web && npm run test -- --run` | **90 files / 929 tests passed**，exit 0 |
| `npx vitest run features/exploration` | 4 files / **38 tests passed**（含样式隔离测试） |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0（0 error / 0 warning） |
| `npm run build` | exit 0（34 静态页） |
| 真实浏览器（隔离 e2e 全栈 + 7 条真实问题记录种子） | **11/11**：7 张档案卡、`No.` 编号 counter 生效、列表/详情/390/手机宿主均正常且无横向溢出、卡片里没有完成度/百分比、四个子路由页 `padding-top` 均为 96px、无 JS 错误 |

## 6. 未完成项

1. **印象空间整屏参考帧仍缺** → 只标档案语言 v1 部分还原。
2. 异世界导航经典红眼图标（G3）仍缺；天鹅绒整屏帧仍缺。
3. **P4 原版图标**：手机桌面位图图标仍是第二轮 AI 生成线条图标，本地无原版应用图标素材。
4. 真机触控、软键盘、移动 Safari 未验证（沿用交接包 §3.2）。

## 7. 集成说明与回退

- **改动**：`exploration.css` 追加段落 + 四个页面外壳统一；无数据/API 变更。
- **回退**：删除 `exploration.css` 末尾「视觉细化 v1」段落 → 回 T09 原样式；
  四个页面换回 `section.shell` 即可（顶栏遮挡会回来，不建议）。
- 与 `verify-all.sh --fast` 兼容（静态审计 + 单测 + typecheck/lint 全部通过）。
