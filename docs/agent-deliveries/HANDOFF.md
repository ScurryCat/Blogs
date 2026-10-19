# 交接包 · 怪盗手机 P5 第二轮 UI

> **接手请先读这份。** 它把「现在是什么状态、怎么验证、还差什么、坑在哪」四件事讲清楚，
> 其余细节都指向已有文档，不在这里重复。
>
> 打包时间：**2026-10-17**（初版 `6320861`）｜ 当前 **`c167cbb`** ｜ 分支 `main` ｜
> **271 个提交、108 个未推送**（任务书要求"只本地提交、不自动推送"）。
>
> ⚠️ **先读 [`HANDOFF-ADDENDUM-2026-10-17.md`](./HANDOFF-ADDENDUM-2026-10-17.md)**：
> 打包之后，具备**图像输入能力**的接手者（Scurry Cat）继续做了 24+ 个提交 ——
> 包括视觉部分还原（§4.2 IM / §4.5 手记日历 / §4.6 图库 / §4.7 放课后 / §4.8 天鹅绒·印象空间·
> COOP·殿堂 等 8 份 `P3-*-visual-result.md`）、全站 a11y 对比度巡检与修复、
> 验证脚本绕过系统代理、以及天鹅绒/印象空间的手机屏登记。**B1 因此从「不可判定」变为
> 「部分还原 + 仍不可判定」**，最终结论以 addendum 为准。

> 📌 **P5 第一批（站主日常创作体验）已实现并验收通过（2026-10-19）**
>
> 提交：`3b0914e`（实现）+ `9644737`（验收期修复与验收报告）。
> 范围：`/admin` 创作台首页、INS 选图优先编辑、手记私密/公开分离编辑、服务端工作草稿
> （自动保存 / 本机恢复 / 412 冲突显式处理 / 跨设备）、共享图片选择器、放课后快捷更新、
> 前台站主快捷入口与来源上下文恢复。
> 验收：**A1–A12 全通过**；B1/B3/B4/B5 通过；**B2 真机触控/软键盘/中文输入法未验证（无设备）**。
> P5 e2e 219 断言通过 / 0 失败；后端 1025/0；前端 1123/0；隔离 build exit 0；迁移 round-trip PASS。
> **先读**：`P5-final-report.md`（总结与复验命令）→ `../acceptance/P5-acceptance-report.md`（逐条证据）
> → `P5-C0-integration-contract.md`（接口约定）。文章编辑器与完整媒体管理属第二/三批，本轮未做。
>
> **⚠️ 勘误（2026-10-19 独立验收后）**：上面「验收通过 / A1–A12 全通过」是原验收范围的历史结论，
> 独立验收在基线 `9917890` 上确认 **R1/R2/R3** 三项功能缺陷，已返工修复并复验
> （提交 `afafdf8` / `8b826c9` / `7a19eb2`，证据见 `../acceptance/P5-rework-verification-2026-10-19.md`）；
> D1 Docker 健康检查错配未修（单列上线遗留项）；B2 真机仍未验证。交接以新报告和当前 HEAD 为准。

---

## 一、一句话现状

**任务书的可验证部分已全部完成，桌面与手机两种视口全绿（七段验收 7/7 PASS）。
视觉部分已由具备图像输入能力的接手者完成 v1 部分还原，但完整整屏参考帧仍缺 ——
按 §8.1 只能判「部分还原 + 仍不可判定」，详见 addendum。**

判定依据可一条命令复验（见 §二）。**不要**把"功能全绿"当作"视觉验收通过"。

---

## 二、怎么验证（三条命令，按需选）

| 命令 | 耗时 | 覆盖 |
| --- | --- | --- |
| `tools/verify-all.sh --fast` | ~1 分钟 | 静态审计 + 前端 typecheck/lint/单测 |
| `tools/verify-all.sh --e2e` | ~15 分钟 | 上面 + 后端整树 + T02 + 多视口 + 业务流 + **六项端到端（桌面）** |
| `tools/verify-all.sh --e2e --mobile` | ~20 分钟 | 上面 + **六项端到端再跑一遍手机全屏视口 390×844** |

**最后一次完整结果（`--e2e --mobile`，干净树，退出码 0；2026-10-18 更新）**：

```
静态审计（图标/路由/资源/明智资源）  PASS
前端 typecheck / lint / 单测          PASS   1123 / 1123
后端整树                              PASS   1025 / 0（P5 创作台集成后）
浏览器 T02 + 取数审计                 PASS   52 / 52
多视口 × 缩放档                       PASS   11 项
业务流验收脚本 ×4                     PASS
真实浏览器端到端                      PASS   12 项（六项流程 × 桌面 + 手机）
全部通过 ✓
```

> ⚠️ **验收注意事项**：仓库曾有两位 worker 并行。若另一端在验收过程中提交，隔离构建会
> rsync 到"半新半旧"的树，产生**假失败**（本会话实测：T02/视口/端到端三段同时报错，
> 手工复跑全部通过）。**验收前确认 `git status` 干净、且另一端不在提交。**

---

## 三、已完成 / 未完成

### 3.1 已完成（每项都有验证证据）

- **功能 / 操作 / 状态 / 回归 / 一致性** —— 任务书的判定主体，全部达成：
  桌面第一页 6 个磁贴 + 第二页 4 个磁贴、滑杆、分页、迷你播放器跨 App 连续、
  弹层滚动锁、状态保持、20 个应用内界面、必备状态与降级文案、320/390 无横向溢出、
  触控目标尺寸、代码入口与契约、交付格式。
- **手机内导航一致性专项审计 P1–P4** —— 四处"应用内状态却离开手机"全部修复，
  每项都有真实浏览器端到端证据（`phone-internal-navigation-audit.md`）。
- **移动端全屏模式长内容不可滚** —— 390×844 下手记正文根本读不到的**真实缺陷**，
  已修复并普查所有手机应用确认无同类（见 `phone-internal-navigation-audit.md` §三补五/补六）。
- **B2 头像原版化** —— 由并行的第二位 worker 完成（`85ec0c9`），双叶/摩尔加纳改用
  P5 原版黑白 sprite；他们的模型具备读图能力，交付说明见 `P2-original-avatars-result.md`。

### 3.2 未完成（外部阻塞，见 §六）

| 项 | 状态 | 卡在哪 |
| --- | --- | --- |
| **B1 整屏视觉还原**（§2.4 / §4.x 视觉 / §8.1）| 🟡 部分还原 / 仍不可判定 | 8 个界面已做 v1（见 addendum）；**完整整屏参考帧仍缺**，按 §8.1 不能判完成 |
| **B4 IM 图片消息**（§4.2）| ⛔ 需决策 | 消息模型只有 `text` + `cards`，无图片字段；属扩 API/DB，越过任务书边界 |
| **真机触控 / 软键盘**（§8.2 真机部分）| ⚠️ 未做 | 无真机；仅用 320/390 视口模拟 |

---

## 四、代码与文档地图

### 4.1 手机与各应用（`apps/web/features/`）

```
phone/            宿主：宿主与桌面、分页/滑杆/转场、mini player、弹层、状态适配器
                  关键文件：phone-provider.tsx（含 navigateScreen）、phone-host.tsx、
                  desktop.tsx、registry.ts（PHONE_APPS）、types.ts（PhoneViewProps/Host）
music/            音乐单例：跨 App/路由连续播放
journal/          手记：列表/日历/正文（手机内 screen=reading）
metanav/          异世界导航：殿堂列表/正文（手机内 screen=palace）
ins/              图文动态：feed/detail/saved/tagged 屏幕
messaging/        IM：角色列表、会话、草稿持久化
gallery/ leisure/ coop/ showcase/ velvet/ exploration/ moments/ posts/ projects/ skills/ ...
                  其余应用与站点页面
runtime/          SiteLink、路由切换（不重载文档）、滚动记忆 scroll-memory.ts
```

**手机内换屏的统一约定**：`host.navigateScreen(screen, item)`；
应用自己的 `phone-manifest.tsx` 必须导出**分派根**与**完整 screens 列表**
（`ins/phone-manifest.tsx` 曾经只导出内层视图、screens 漏了消息两屏 —— 那是 P2 的根因）。

### 4.2 后端与数据（`apps/api/`）

- 契约 `/api/v1`，**85 个路径、36 张表、10 个迁移**，单 head `b7c3e9a1d2f4`。
- 模块：`auth / journal / posts / media / moments / messaging / nav / gallery / leisure /
  coop / showcase / exploration / projects / skills / tags`。

### 4.3 交付文档（`docs/agent-deliveries/`）

| 文档 | 用途 |
| --- | --- |
| **`P6-final-report.md`** | **结论摘要**（先读这个）|
| **`P6-acceptance-ledger.md`** | 逐条验收台账（§2–§8 + 阻塞清单 + 结论）|
| **`phone-internal-navigation-audit.md`** | 导航一致性 P1–P4 的证据与修复记录 |
| `integration-snapshot-round8/11.md` | 中途集成快照 |
| `P0-*` … `P5-*`、`T00–T10-*`、`N0–N7-*`、`P2-original-avatars-result.md` | 各阶段历史交付 |

---

## 五、验证工具体系（`tools/`）

| 脚本 | 作用 |
| --- | --- |
| `verify-all.sh` | 一键验收主入口（`--fast` / `--e2e` / `--mobile` / `--no-backend` / `--no-browser`）|
| `verify-isolated.sh` | **隔离构建**（不抢共享 `.next`）+ 起隔离站（3120）|
| `verify-backend-isolated.sh` | **独占 Postgres 集群**（55433）跑后端全树 |
| `e2e-stack.sh` | 隔离全栈：集群 55434 + API 8130 + 前端 3130 + 种子（`up/down/status`）|
| `e2e-seed-journal.py` / `e2e-seed-palaces.py` | 给隔离环境造手记/殿堂数据（**殿堂发布要求先有公开文章**）|
| `e2e-phone-scroll.py` 等 **6 个** | 六项真实浏览器端到端（支持 `E2E_VIEWPORT=390x844`）|
| `acceptance/verify-*.py` | 视口/图标/取数审计/资源引用/明智排除/媒体闭环等 |
| `pg-local.sh` | 本机 Postgres（**共享集群 55432 —— 不要用错端口停掉它**）|
| `p0-extract-sheets.py` / `p0-contact-sheets.py` / `p0-analyze-sprites.py` | P0 素材提取/对照图/属性分析 |

---

## 六、阻塞条件与解除方式

### B1 整屏视觉还原

> **状态更新（见 addendum）**：已有具备读图能力的接手者完成 **v1 部分还原**
> （8 个界面，含 IM / 手记日历 / 图库 / 放课后 / COOP / 殿堂 / 天鹅绒 / 印象空间），
> 但**完整整屏参考帧仍缺**，按 §8.1 只能判「部分还原 + 仍不可判定」。
> 下面这段是打包时的原始判断，保留作为历史记录。

**缺什么（具体）**：普通文字帧、回复选择帧（G1/G2）等参考帧；见 `reference-frame-gaps.md`
的逐项记录（P0 阶段做的缺口审计）。

**为什么不能做**：当前执行模型**没有图像输入能力**（这一点在本会话中被反复确认）。
按任务书 §8.1 的要求，缺参考帧时只能标"参考未补齐"，**不得声称视觉完成**。

**已经做过的铺垫**（接手可直接用）：
- 参考库里 563 个 sprite 已逐个提取，做了对照图（contact sheets）与尺寸/颜色属性分析；
- 图标映射表 `docs/design-references/icon-mapping.md`（含 P5R 按钮字形逐个识别）；
- 12 个头像候选的"身份 + 许可"双门核对清单 `avatar-verification-checklist.md`
  —— 且已有先例：**并行的第二位 worker 的模型能读图**，按这份清单完成了头像核对
  （`P2-original-avatars-result.md`）。

**解除方式（二选一）**：
1. 提供 G1/G2 等参考帧 **+ 具备图像输入能力的执行环境**；
2. 让一位**能读图的协作方**把每屏还原意见写成**文字反馈**（"某屏某处应如何"），
   我按文字指令改 —— 先例同上。

### B4 IM 图片消息

**现状**：`Message` 模型只有 `text` + `cards`，没有图片字段（这是数据模型事实，非实现遗漏）。

**解除方式（需产品决策）**：
1. 扩消息 API/DB 支持图片（工作量大，超出任务书边界）；或
2. 把需求改为"内容卡片带预览图"（贴近现有 `cards` 能力，改动小）。

---

## 七、接手后的第一步（建议顺序）

1. `git status` 确认工作区干净；`git log --oneline -5` 确认 HEAD 是你预期的提交。
2. `tools/verify-all.sh --fast` 跑一遍（1 分钟），确认基础链路是绿的。
3. 读 `docs/agent-deliveries/P6-final-report.md` 的结论与验证矩阵。
4. 若要做视觉：先读 `reference-frame-gaps.md` + `avatar-verification-checklist.md`，
   并按 §六 的方式准备"读图"能力 —— **没有读图能力前不要开始视觉还原**，
   否则只能产出"猜测式"改动，反而破坏可验证性。
5. 若要做图片消息：先拍板 §六 B4 的两种方案之一。

---

## 八、踩坑清单（都是本会话真实踩过并留了记录的）

1. **Chrome 对 `matrix()/matrix3d()` 的序列化会破坏命中测试**：斜屏滑杆曾是"能渲染不能拖"，
   修法是"单层 2D 变换链 + 变换感知的指针数学"（`features/phone/` + 对应单测）。
2. **滚动记忆的三个根因**（很容易只修一个就以为好了）：容器找错（真实容器是 `.pw-appbody`，
   不是 `.pw-screen`）、卸载时 DOM 已被摘除（`connected=false`）、保存监听器覆盖了恢复值。
3. **jsdom 测不出真实滚动**：涉及真实滚动的断言必须在隔离全栈里用浏览器验证。
4. **移动端"不能滚"要量 `scrollHeight/clientHeight` 定位**，不要凭截图猜；全屏模式下滚动的是
   `.pw-appbody`，不是窗口，`scrollIntoView` 也可能无祖先可滚。
5. **共享 `.next` / 共享测试库会互相踩**：一律用 `verify-isolated.sh` / `e2e-stack.sh`。
6. **别用错端口停共享 Postgres**：`pg-local.sh stop` 必须带 `PGDATA` 与 `PL_PG_PORT`，
   否则会停掉 55432 的共享集群（本会话发生过一次，已重启恢复）。
7. **E2E 会受环境时序影响**：源码比构建新时 `e2e-stack.sh` 会自动重建；
   若仍失败，先手工复跑一次再判断是不是代码问题。

---

## 九、证据在哪

- **测试/审计数字**：`P6-acceptance-ledger.md`（逐条）、`P6-final-report.md`（汇总）。
- **截图**：`/Users/学习/blog/.dsh/screenshots/`（130 张，51MB，**未入库**）——
  含各阶段桌面/手机/320/390 视口与 P0 素材对照图。
- **P0 分析产物**：`/Users/学习/blog/.dsh/artbook/contact-*.png`（P0 素材对照图）与
  `/Users/学习/blog/.dsh/p0-before/`（P0 基线截图），均未入库。
- **运行日志**：`/tmp/vf-*.log`、`/tmp/e2e-*.log`（**易失**，重要结论已写进上面两份文档）。

---

## 十、这个包的内容

```
HANDOFF.md                      ← 本文件
docs/agent-deliveries/*.md      ← 交付文档（数量以 MANIFEST.txt 为准）
tools/*.py, tools/*.sh          ← 验证与生成脚本（数量以 MANIFEST.txt 为准）
tools/acceptance/*.py           ← 验收检查脚本
MANIFEST.txt                    ← 文件清单与打包说明
```

**未包含**（有意）：源代码（在仓库里）、`.dsh/` 下的截图与分析产物（体积大、未入库）、
以及任何凭据（本包内无密钥/密码）。

---

## 十一、当前验收摘要（2026-10-18，覆盖上文历史数字）

> 上文是**历史正文**（初版打包前后），保留不改；接手时请以本节 + 包顶横幅为准，
> 不要再自行拼凑旧段落里的 924 / 931 等历史数字。

- **基线**：代码以包内 `git` 提交为准（见包顶横幅 `HEAD`）。
- **回归数字**：前端 **933** 单测；后端 **952** 用例；`bash tools/verify-all.sh --e2e --mobile`
  → **7/7 段全绿**（静态审计、typecheck/lint/单测、后端、T02 52/52、多视口 11、业务流 4/4、
  端到端 12 项：桌面 6 + 移动 6）。
- **独立验收 v2**（`docs/acceptance/2026-10-17-handoff-v2-acceptance.md`）结论：
  **功能阶段通过，完整验收未通过**。已按报告完成：
  - **F1** 统一素材入口迁移：默认只进 `persona-curated/` 精选库，旧库降级「离线档案」
    （`tools/acceptance/verify-reference-entry.py` 11 项通过）；
  - **F2** 原版图标：metanav 经典红眼 + ins 原版消息标识接入桌面实际渲染分支；
    其余 8 个 App 标为适配设计（见 `docs/design-references/original-app-icons.md`）；
  - **F3** INS 收录相册：cursor 全量分页 + 列表外已选相册详情补取（仅 404 判删除）。
  - **管理端 INS 收录 UI 真实浏览器全流程**已补齐：`tools/e2e-ins-album-links-ui.py` 9/9；
    期间修复管理列表 limit>30 的 422、画廊写接口 CSRF body 字段的 422/500。
  - 返工记录：`docs/agent-deliveries/P4-acceptance-v2-fixes.md`。
- **参考帧补齐（2026-10-18，三批 17 张 → R1 后 21 张）**：P5/5R 完整帧 + 辅助帧；
  **R1 纠正（2026-10-18）**：原标 G2 的 P4 选项帧、P4 天鹅绒帧、P5 日期推进帧已重标为辅助参考；
  P5R 天鹅绒/东京地点选择地图已换成正确帧；**G2 已由站主于 2026-10-18 提供并入库**。原 G2 说明：
  P5R 6（G2 回复选择 / G1 普通对话 ×2 /
  IM 完整屏 ×2 / 手机 HUD）+ P5 6（**存档/读取** / 手机主屏 / 日历 / 五维状态 / 校内地图 /
  东京地图）+ 5（天鹅绒房间 / 印象空间 / COOP / 殿堂 / 放课后），
  `verify-reference-frames.py` **22/22**；来源核实见 `reference-frame-sources.md`
  （官方 3 张：PS CDN 1 + Steam 官方截图 2；可追溯非官方 12；未核实 2=IM 两帧）；
  整屏参考帧缺口已收口（详见 `P4-reference-frames-round3.md`）。
- **移动引擎证据（2026-10-18）**：WebKit + iPhone 视口 24/24（首页/手机/IM/图库灯箱/触控点按），
  但**不等于真机**；软键盘/中文输入法/真实触控仍需真机（`P4-mobile-engine-evidence.md`）。
- **IM 整屏视觉修形（2026-10-18，两轮，IM 优先）**：纸白宽消息条 + 白纸黑框拍立得头像 +
  放大 IM wordmark + 红点操作提示 + 4:3 大图片卡；messaging 测试 71/71；仍标部分还原
  （`P4-im-visual-refinement.md`）。
- **手记整屏视觉修形第一轮（2026-10-18）**：存档列表纸白/深红大槽位 + SAVE DATA 大字；
  日历黑底大字网格（周日红/周六青）、记录日红数字+下划线、TODAY 贴纸；手记测试 55/55；
  仍标部分还原（`P4-journal-visual-refinement.md`）。
- **协助者 COOP 整屏视觉修形第一轮（2026-10-18）**：纸白卡面 + 红黑斜切插画区 +
  拍立得头像 + 黑色姓名条 + 深红大序号；COOP 测试 79/79；仍标部分还原
  （`P4-coop-visual-refinement.md`；不伪造 RANK/好感度）。
- **我的殿堂 Showcase 整屏视觉修形第一轮（2026-10-18）**：暗红/黑斜切宝库墙 + 金色宝箱辉光 +
  金色 TREASURE 贴牌 + 纸白宝物卡（黑厚框/硬阴影/EXHIBIT 编号）+ 金色页签；Showcase 测试 50/50；
  仍标部分还原（`P4-showcase-visual-refinement.md`）。
- **天鹅绒房间整屏视觉修形第一轮（2026-10-18）**：深蓝丝绒条纹 + 冷光 + 金/冰饰线 +
  白色登记板技能卡（钢印编号/冰蓝左沿）+ REGISTRY 金贴牌；Velvet 测试 59/59；
  仍标部分还原（`P4-velvet-visual-refinement.md`）。
- **印象空间整屏视觉修形第一轮（2026-10-18）**：黑暗隧道冷光 + 黄黑警示条 +
  荧光绿档案箱/号牌 + AWARENESS AREA 贴牌 + 线路牌状态徽标；Exploration 测试 39/39；
  仍标部分还原（`P4-mementos-visual-refinement.md`）。
- **放课后整屏视觉修形第一轮（2026-10-18）**：黑暗击球笼 + 黄灯管排 + 笼网斜纹 +
  BATTING CAGE 贴牌 + 黄色霓虹记分板卡片；Leisure 测试 27/27；仍标部分还原
  （`P4-leisure-visual-refinement.md`）。
- **整屏视觉修形第一轮完成（2026-10-18）**：10 个界面 / 9 轮，对照表 13 个可映射界面全部覆盖
  （1 个对象不适用），索引 `P4-visual-refinement-summary.md`；下一阶段逐像素第二轮（IM 优先）。
- **视觉对照证据（2026-10-18）**：22 张参考帧 ↔ 站点 14 界面并排对照（截图 + 逐项结论），
  见 `P4-visual-comparison-evidence.md`；**整屏还原仍未通过**（13 项部分对照、2 项未实现）。
- **IM 图片消息（Phase 1 已实现，2026-10-18）**：站主拍板方案 A；剧本图片卡
  （`image`/`album_photo`）+ 白框拍立得 + 灯箱 + 撤回/失效降级；后端 9 / 前端 4 / e2e 8/8；
  Phase 2 AI 选图与 Phase 3 访客引用相册仍未做（可选）。
- **仍未关闭**：真实设备（触控/软键盘/中文输入法/移动 Safari）；
  剩余 8 枚手机图标原作定稿（AI 位图回退已移除，现为自绘适配）。
- **管理端隔离全流程（2026-10-18）**：草稿保留 + 新标签建相册 + 图库展示 + 撤回联动，
  隔离栈真实浏览器 **19/19**（`P4-acceptance-complete-admin-flow.md`）。
- **完整验收（2026-10-18）返工**：R2/R3 图片灯箱 Escape/失败降级已修复（e2e 60/60）；
  R1 三张错标参考帧已纠正并补正确 P5R 天鹅绒/东京地图/IM 帧；G2 已由站主提供（22/22）；§6 相册上限提示、
  详情中性文案、WebKit 断言增强（28/28）、历史文档标注已完成（`P4-acceptance-complete-*.md`）。
  整屏逐像素还原仍是「部分」状态。
- **对独立验收报告 v2 的逐项回应**：`docs/agent-deliveries/acceptance-v2-response.md`
  （逐条列出已修复项、证据命令与仍需外部输入的项）。
- 在这些缺口收口前，保持「功能阶段通过，完整验收未通过」的状态。
