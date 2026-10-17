# P4 补充交付：减少动效 / 触控目标加固 + 手机宿主样式表缺失修复

> 目的：对 13 轮视觉还原做一轮**可及性收尾**（`prefers-reduced-motion`、触控目标尺寸），
> 并在核对手机宿主样式时发现并修复一个**与第 1 轮同类**的真实缺陷：
> 三张样式表只被独立页面 import，手机宿主（首页 `/?phone=…`）里的对应界面完全没有样式。
> 日期：2026-10-17 · 分支 `main` · **未 push**

---

## 1. 减少动效（prefers-reduced-motion）加固

视觉还原 v1 给多个界面加了悬停位移/过渡（卡片抬升、旋转过渡）。`prefers-reduced-motion: reduce`
下应**不做位移动画**（第二轮 §7 的减少动效要求）。此前：`journal / leisure / metanav / leblanc`
完全没有 reduce 块，`coop / showcase / velvet / exploration / gallery` 的 reduce 块只覆盖旧规则，
**新增的过渡未被覆盖**。

处理（各文件末尾追加 reduce 块）：`.calendarPane .day`（手记日历）、`.card`（COOP/放课后/导航/殿堂）、
`.photo-tile`+`.plg-album-card`（图库）、`.plv-card`（天鹅绒）、`.pme-card`（印象空间）、
`.msg-role`（IM）—— 统一 `transition: none`，并把悬停位移 `transform: none`。

验证（Playwright `reduced_motion="reduce"`，真实浏览器）：8 个页面组件实测
`transitionProperty == "none"`；悬停后无位移。普通模式下动画保持（实测 `0.16s`，未误伤））。
> 说明：Chrome 对 `transition: none` 的 `transitionDuration` 会报 `0.001s`（实现细节），
> 判定以 `transitionProperty: none` 为准。

## 2. 触控目标 ≥44px（第二轮 §8.2）

用真实浏览器在手机宿主内测量所有可交互元素的 `offsetWidth/offsetHeight`（排除行内文本链接，
按 WCAG 2.5.8 行内豁免），修复本会话涉及的模块：

| 模块 | 修复内容 |
| --- | --- |
| 手记 | 页签/主按钮（37–43px → 44）、年份筛选 select（42 → 44） |
| 放课后 | 页签（33 → 44）、下拉（40–42 → 44）、按钮 |
| COOP | 标签筛选 chip（32–33 → 44）、卡内外链/展开按钮（34–40 → 44） |
| 异世界导航 | 页签（36–39 → 44）、输入/下拉/按钮/候选 |
| 天鹅绒 | 页签（39 → 44）、按钮/下拉、证据链入口 |
| 印象空间 | 筛选号牌（38–39 → 44）、按钮/关联入口 |
| INS | 手机页签（28 → 44）、标签 chip（34 → 44）、按钮（40 → 44） |
| 我的殿堂 / 图库 | 复核为 0 个不达标（此前已 ≥44） |

复核结果：9 个手机应用里**非行内**可交互元素全部 ≥44px；仅剩 COOP 文案句中的两个行内文字链接
（22px 高，WCAG 2.5.8 行内豁免，不改）。

## 3. 发现的真实缺陷：手机宿主的三张样式表没有加载

**现象**：全新打开 `/?phone=…`（deep link，不经独立页）时：
- 手机 INS：页签背景是浏览器默认灰 `rgb(239,239,239)`、动态卡是裸 DOM（截图
  `.dsh/vis2/phonecss/before-phone-ins.png`）；
- 手机殿堂：`.pls-card` 背景透明、按钮只有 28px 高（未套用 showcase.css）；
- 手机 INS 相册页签：gallery.css 未加载。

**根因**：`ins.css` / `gallery.css` / `showcase.css` 是普通全局 CSS，但只被各自**独立页面**
（`app/apps/ins/*`、`app/gallery`、`app/showcase*`）import；手机宿主渲染在**首页** `/`，
而首页没有 import 这三张表 → 手机内对应界面完全没有样式。与第 1 轮 `messaging.css` 的缺陷同类。

**修复**：在根布局 `app/layout.tsx` 统一 import 三张表（与 `messaging.css` 同一处理），
并注明理由。三张表的类名分别带 `.ins-` / `.plg-` / `.pls-` 前缀，不污染全站。

**验证**（fresh deep link，修复后）：
- 手机 INS 页签 `color: rgb(244,241,234)`、高度 44px；空态面板正常；
- 手机殿堂卡 `background rgb(10,10,11)`、`border rgb(244,241,234)`、红硬阴影 `rgb(211,18,42) 5px 5px`、按钮 44px；
- 手机 INS 相册页签套用 gallery.css（`.plg-wrap` 被加载、文字纸白）。

## 4. 修改文件

| 文件 | 改动 |
| --- | --- |
| `apps/web/app/layout.tsx` | 新增 `ins.css` / `gallery.css` / `showcase.css` 根布局 import（修手机宿主无样式；附注释） |
| `apps/web/features/{journal,leisure,coop,metanav,velvet,exploration,ins}/*.css` | 追加 reduce-motion 块与/或 `min-height: 44px` 触控目标（详见 §1/§2） |
| `docs/agent-deliveries/P4-motion-touch-a11y.md` | 本报告 |

**未改动**：数据/API/业务逻辑；未改变任何文案与页面结构；未动 `.dsh/` 之外的证据目录。

## 5. 验证结果

| 命令 / 检查 | 结果 |
| --- | --- |
| `npm run test -- --run` | **90 files / 929 tests passed** |
| `npm run typecheck` / `npm run lint` / `npm run build` | 0 / 0 / exit 0 |
| reduce-motion 实测（8 个页面组件） | `transitionProperty: none`，悬停无位移；普通模式 0.16s 保留 |
| 触控目标实测（9 个手机应用） | 非行内可交互元素全部 ≥44px；仅 2 个行内文本链接（豁免） |
| 手机 deep link 样式（5 项断言） | 全部 PASS（INS 页签/殿堂卡/按钮/相册页签） |
| 交接包自带完整验收 | `bash tools/verify-all.sh --e2e`：1–6 段全部 PASS（T02 **52/52**、多视口 11、业务流 4/4）；第 7 段首跑因**隔离集群残留进程**环境问题失败（见 §6 备注），清理后**六条端到端 × 桌面/移动共 12 项全部 PASS** |

## 6. 未完成 / 记录项

1. **手机宿主自带的**音乐迷你播放器按钮（32–37px）仍小于 44px：属宿主播放器设计（旧站 chrome），
   本轮未改，记录为后续可及性候选。
2. COOP 文案中的两个行内文字链接（22px 高）按 WCAG 2.5.8 行内豁免，不改。
3. 其他既有未完成项不变：整屏参考帧（G2/G3）、B4 决策、P4 原版图标、真机验证。

## 7. 环境备注：隔离集群残留进程导致 e2e 假失败

`verify-all.sh --e2e` 第 7 段首跑失败在 `tools/e2e-stack.sh up`：`psql` 报
`could not open file "global/pg_filenode.map"`。原因不是代码：此前审计用的隔离栈
（`/tmp/pl-e2e-stack`）被删除/重建过，但**一个旧 postgres 进程仍占着 55434 端口**，
新的 `up` 连到了「数据目录已不存在」的旧进程。处理：`kill` 该进程 + 重置
`/tmp/pl-e2e-stack` 后 `up` 正常（6/6），六条端到端桌面 + 移动各跑一遍全部 PASS。
若后续再遇到：`lsof -ti tcp:55434 | xargs kill` 后重跑即可（共享 55432 集群不要动）。
