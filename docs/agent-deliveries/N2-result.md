# N2 交付：手记 · 游戏存档式列表、预览、读取、辅助日历与返回位置

> 任务书：`/Users/v/Documents/ChatGPT/Blog开发/docs/superpowers/plans/2026-10-17-p5-content-v3-agent-handoff.md` §3、§7.1（N2）、§8.1、§9（第三轮 · P5 内容架构 v3）
> 项目：`/Users/学习/blog/Blogs` · 分支 `main` · 本文件是 **N2 子任务** 的交付报告，不代表整轮验收通过
> 状态：**功能与测试完成；视觉还原未通过**（完整游戏存档整屏参考帧未取得，见第 6 节），真机未验证。

## 1. 任务编号、实际基线、分支、接手时已有修改及保护方式

| 项 | 内容 |
| --- | --- |
| 任务 | N2（手记）：存档列表、预览、读取入口、辅助日历、参考对照（任务书 §3 / §7.1 N2 / §8.1） |
| 接手时实测（2026-10-17 10:34，只读） | 分支 `main`，`ahead origin/main 9`，HEAD `a7475a4 feat(messaging): 会话详情菜单…`；工作区 dirty |
| 基线快照 | 第二轮未提交改动全部存在：`app/globals.css`、`features/phone/phone-host.tsx`、`features/runtime/site-runtime.tsx`、`features/runtime/audio/mini-player.tsx`（未跟踪）、`tests/runtime/mini-player.test.tsx`（未跟踪）；N0 的导航契约文件亦为 dirty |
| 保护方式 | 全程**未回退 / 未覆盖**上述文件；未改 `features/phone/**`、`features/runtime/navigation/**`、`app/globals.css`、`package.json`、数据库、手记模型与权限；**未执行任何 git commit / push / deploy / 历史改写** |
| 并行会话 | Lead 通报另一会话并行开发第二轮（10:44 提交 `041ddb5` 等）。其写入的 `features/journal/journal.module.css`（`.thumbFailed` / `.figureFailed`）、`entry-card.tsx`、`entry-reading.tsx` 改动**全部保留**：我通过增量替换改 CSS，不整文件覆盖；未触碰 `entry-card.tsx` / `entry-reading.tsx`。收到 Lead 通知后未再执行 git 命令 |
| 写入范围 | 实际只改 `features/journal/**`、`app/apps/journal/**`、本报告；截图证据放 `.dsh/screenshots/`（git 忽略） |

## 2. 已实现的需求，以及逐文件修改清单

### 2.1 需求对照（任务书 §3.2 / §8.1）

| 要求 | 状态 | 落点与证据 |
| --- | --- | --- |
| 默认呈现存档列表；每行一篇真实手记，突出日期、标题、摘要 | ✅ | `SaveScreen` 为 `list` 屏默认视图；行内日期块 + 标题 + 摘要 |
| 编号只是显示顺序，不改数据库 ID，不限制为固定存档数量 | ✅ | `slotNumber(index)` → `No.01/02/…`；筛选后按当前显示顺序重排；测试用非 UUID id 证明编号与 ID 无关 |
| 选中条目显示预览 | ✅ | 右侧（窄屏在下方）`SavePreview`：日期 / 标题 / 完整日期标签 / 心情 / 地点 / 图片 / 摘要 |
| 「读取手记」进入现有完整正文阅读页 | ✅ | 独立页用 `SiteLink href=/apps/journal/<id>`（保留真实 href）；手机宿主用 `host.openContent(source="phone-link")`；浏览器实测 `/apps/journal/e2` 打开正文 |
| 保留日历切换、日期定位、返回位置、公开 / 私密规则 | ✅ | 日历屏保留；预览「在日历中定位」→ 切日历并只看该天；选中槽位与年份写入本机状态、从正文返回时恢复；列表数据仍走公开端点（服务端过滤，无草稿/私密泄露） |
| 不填充空存档、不造等级 / 地点 / 游玩时长，缺失信息用空态 | ✅ | 无记录时不渲染任何槽位；不出现 `Lv` / `NONE` / 游玩时长；缺失心情/地点/配图直接不显示，摘要缺失给明确文案 |
| 日期按原有日期语义，不因时区错一天 | ✅ | 沿用 `parseCalendarDate` 字符串语义；浏览器三时区实测（Honolulu/Kiritimati/Shanghai）日期与星期完全一致 |
| 访客只用「读取手记」等准确文案；发布/编辑仍在管理端 | ✅ | 预览主按钮「读取手记」，旁边提示「发布与编辑仍在管理端，访客界面不提供写入口」 |
| 手机紧凑视图与独立页复用业务逻辑；长标题、长正文、键盘选中、清楚焦点 | ✅（浏览器模拟，真机未验证） | 同一 `JournalView` / `SaveScreen`；`data-journal-mode="phone"` 单列 + 容器查询；长标题完整渲染不截断；`↑↓ Home End` 选中、`Enter` 读取；焦点环用内侧 box-shadow（clip-path 会裁掉 outline） |

### 2.2 逐文件修改清单

| 文件（相对 `apps/web/`） | 类型 | 改动摘要 |
| --- | --- | --- |
| `features/journal/save-screen.tsx` | **新增**（402 行） | 存档列表 + 槽位 + 预览 + 键盘交互 + 年份筛选 + 读取/定位入口；`data-journal-slot` / `data-slot-number` / `data-journal-preview` 供测试与验收定位 |
| `features/journal/save-screen.test.tsx` | **新增**（462 行，15 例） | 存档式列表行为测试（编号顺序、预览、读取目标、键盘、筛选、空态、日期、失败态、返回位置、手机模式、日历定位） |
| `features/journal/journal-view.tsx` | 重写视图组织 | 默认 `list` = 存档列表；tab 文案「存档列表 / 日历」；年份筛选提升到本层（切屏保留）；「在日历中定位」串联两屏；日历屏保留 `EntryCard` 结果与「返回存档列表」 |
| `features/journal/state.ts` | 增量 | 新增 `rememberEntry/lastEntry`、`rememberYear/lastYear`（沿用 `JOURNAL_APP_ID="journal"`、`JOURNAL_STATE_VERSION=1`；键 `entry`、`year`） |
| `features/journal/journal.module.css` | 增量（现 937 行） | 新增存档界面样式段（槽位/预览/编号贴纸/斜切/暗色适配/焦点/容器查询/手机单列）；**保留**并行会话的 `.thumbFailed` / `.figureFailed` 等既有规则；补充页面外壳留白 `.page` |
| `features/journal/page-shell.tsx` | **新增**（15 行） | 服务端可用的页面外壳：补 fixed 顶部导航所需留白（只用于手记两个独立页，不写进 `app/globals.css`） |
| `app/apps/journal/page.tsx` | 修改 | 用 `JournalPageShell` 包裹（修掉内容被固定导航压住） |
| `app/apps/journal/[id]/page.tsx` | 修改 | 三条渲染分支统一用 `JournalPageShell` |
| `docs/agent-deliveries/N2-result.md` | **新增** | 本报告 |

**未修改（明确边界）**：`entry-card.tsx`、`entry-reading.tsx`（并行会话正在改）、`entry-reading-loader.tsx`、`phone-app.tsx`、`standalone.tsx`、`api.ts`、`paths.ts`、`types.ts`、`calendar-panel.tsx`、`features/phone/**`、`features/runtime/navigation/**`、`app/globals.css`、`package.json`、后端与数据库。

### 2.3 键盘与无障碍细节

- `role="listbox"` + `role="option"`：选中项 `tabIndex=0`（roving tabindex），其余 `-1`；`aria-selected` / `aria-posinset` / `aria-setsize` / `aria-describedby` 指向操作提示。
- `↑` / `↓` / `Home` / `End` 移动选中并把焦点同步到新槽位；`Enter` / `Space` 读取当前选中；指针点击只选中，不直接跳转。
- 焦点环：`.slot:focus-visible` 用**内侧 3px box-shadow**（`clip-path` 会裁掉 outline，黑底红环 / 选中白底黑环两种对比）。
- 触控目标：槽位行与「读取手记」≥44px（CSS `min-height: 44px`）。

## 3. 新增 / 修改的接口、字段、路由、导航意图、数据库迁移

| 类型 | 变化 |
| --- | --- |
| 后端接口 / DTO | **无**（只用现有公开端点 `GET /journal/entries`、`GET /journal/calendar`、`GET /journal/entries/{id}`） |
| 数据库 / 模型 / 权限 | **无**（未新建模型、未改迁移、未改公开/私密规则） |
| 路由 | 不变：`/apps/journal`（`?screen=list|calendar`）、`/apps/journal/<id>` |
| 手记屏幕集合 | 不变：`JOURNAL_SCREENS = ["list","calendar"]`（口径交给现有手机清单，未改 `features/phone/**`） |
| 本机状态键（版本化存储 `journal`） | 新增 `entry`（上次选中手记 ID，返回位置）、`year`（上次年份筛选）；沿用既有 `screen` 辅助函数 |
| 导航意图 | **无**（读取手记是普通站内导航：独立页 `source="top-nav"`、手机宿主 `source="phone-link"`；不新增 `intent`、不涉及殿堂过场） |
| 素材 / 构建 | **无新增公开素材**，不涉及构建输入 |

## 4. 与其他 agent 的依赖和共享文件集成情况

| 相关方 | 集成情况 |
| --- | --- |
| N0 共享契约 | 只**读取**使用 `SiteLink`（`source` / 保留 href 语义）与 `JournalHost` 接口；未改 `features/runtime/navigation/**`、`features/phone/**` |
| N1 导航 / 地图 | after 截图显示其「文章/生活/作品/地图/关于」五栏目已生效；我**未改** `site-header`。手记页高亮由 N1 的统一配置负责 |
| N5 殿堂过场 | 无调用关系；读取手记不触发殿堂意图。浏览器截图时观察到 N5 过渡层开发中的瞬态 `pageerror`（非手记模块输出，复跑已消失） |
| N6 素材 | N6 已复核并要求：`92140-save-load.png` 只是元件表、**没有完整存档整屏参考帧**；`.dsh/p0-analysis/` 头像裁片未审核不得接入。我未使用任何角色裁片，见第 5 节 |
| 并行第二轮会话 | 其在 `journal.module.css` / `entry-card.tsx` / `entry-reading.tsx` 的改动保留（CSS 增量修改、未整文件覆盖）；`entry-reading.tsx` 的 `ReadingFigure` 图片失败占位与我改的页面外壳共存并通过全量测试 |
| N7 验收 | 可直接复跑第 7 节命令；截图与量测见 `.dsh/screenshots/n2-*`；完整参考帧缺口需在验收报告中标「视觉未通过」 |
| 遗留共享问题（报告给 Lead/N7） | `/apps/journal` 原先内容会被 fixed 顶栏压住；我用 `JournalPageShell` **只在本任务页面**补留白。同类问题在 `/apps/leisure` 仍存在（不在我的写入范围，未改） |

## 5. 所用素材来源、游戏版本、哈希与处理范围

| 项 | 内容 |
| --- | --- |
| 参考素材 | `Persona 5`（P5，非 P5R）HUD 元件表 `/Users/v/Documents/ChatGPT/Blog开发/assets/reference/persona5-spriters/p5/hud/92140-save-load.png` |
| SHA-256 | `07472377be750924f595acd7f8365b07900254df3a67899099a5521818068717`（本地副本：`.dsh/screenshots/n2-reference-92140-save-load.png`，仅离线对照，**未接入任何公开目录 / 构建输入**） |
| 画面复核 | N6 已实测画面：No.1–16 斜切编号块、SAVE DATA / NETWORK DATA 字样、戻る/決定 提示、难度标签、PLAY TIME / Lv、灰底存档槽；**无明智吾郎**。属离线开发参考 |
| 处理范围 | 未裁切、未生成缩略图、未进入 `apps/web/public/assets`；浏览器下载物不新增任何参考库文件 |
| 许可状态 | 随任务书给定的本地参考库；**未引用其进入公开产物**，不改变原库 |
| 使用的真实站点素材 | 截图测试数据中的配图使用既有公开资源 `/assets/legacy/img/morgana-thief.webp`（站点原有文件，未新增）；报告截图未包含明智角色图 |

## 6. 改前 / 改后截图；原版参考帧与对照说明

### 6.1 截图清单（均在 `/Users/学习/blog/Blogs/.dsh/screenshots/`）

| 改前（N2 实现前） | 改后（本次实现） |
| --- | --- |
| `n2-before-desktop-save-list.png` | `n2-after-desktop-save-list.png` |
| `n2-before-desktop-calendar.png` | `n2-after-desktop-calendar.png` |
| `n2-before-desktop-calendar-day.png` | `n2-after-desktop-calendar-day.png` |
| `n2-before-mobile-save-list.png`（390px） | `n2-after-mobile-save-list.png`（390px） |
| `n2-before-phone-compact.png` | `n2-after-phone-compact.png`、`n2-after-phone-compact-scrolled.png` |
| — | `n2-after-desktop-keyboard-focus.png`（键盘选中 + 焦点环） |
| — | `n2-after-reading-entry.png`（读取后 `[data-journal-reading]` 正文） |
| — | `n2-after-back-restored.png`（浏览器返回后恢复 No.02 选中） |

补充证据：`n2-after-measurements.json`（DOM 量测）、`n2-screenshot-script.py`（可复跑脚本）、`n2-timezone-check-script.py`。

**拍摄条件与差异说明（重要）**：
- 改前截图来自既有构建服务 `http://127.0.0.1:3100`（N2 改动前的源码快照，站点外壳为 N1 五栏目整合前）；
- 改后截图来自本地开发服务 `http://localhost:3123`（工作区当前源码，含 N1 五栏目等并行改动）。
- 因此站点外壳不能逐像素对照；**手记内容区**是同一路由、同一数据形状下的前后对照。
- 本地开发库没有公开手记内容（公开端点为 `items: []`），截图中的手记数据是通过 Playwright 路由注入的**与公开 DTO 同形**的测试数据。这只证明「界面在给定真实数据结构下的渲染与交互」，**不能替代真实内容验收**（需 N7 用种子数据复验）。

### 6.2 原版参考帧与对照说明

| 项 | 结论 |
| --- | --- |
| 任务书要求 | 以元件表为起点，补齐**可追溯的完整游戏存档界面参考帧**，再校准标题、日期区、列表、选中态与预览比例 |
| 实际取得 | **未取得完整整屏参考帧**。N6 独立复核确认：`persona5-spriters` 与 `persona-dist/media/image` 中只有元件表，没有可确认的完整存档界面整屏截图/参考帧（已记录于 N6 报告与 `docs/design-references/icon-mapping.md`） |
| 已做的对照 | 只按元件表可确证的元素校准：斜切编号贴纸（No.01…）、`SAVE DATA` 标题、红/黑/纸白三色与斜切边缘、灰色槽位底与选中反白、预览大日期块、`No.01 / 08` 比例行。**原版的整屏构图、标题与日期区比例、列表/预览列宽、选中态动效均无法核对** |
| 视觉判定 | **视觉还原：未通过**（参考帧缺口，不能声称还原）。功能、交互、日期语义、键盘与返回位置按第 7 节证据判定 |

## 7. 测试命令和实际结果（功能 / 视觉 / 真机 / 迁移 / 资源分别列状态）

### 7.1 命令与结果

执行目录：`/Users/学习/blog/Blogs/apps/web`（2026-10-17 10:54–10:55，工作区基线见第 1 节；含并行 agent 改动）

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `npm run test -- --run` | 0 | **83 files / 874 tests passed**（其中手记套件 4 files / 54 tests：`journal-view` 11 + `save-screen` 15 + `paths` 15 + `api` 13） |
| `npm run typecheck` | 0 | 无输出（`tsc --noEmit` 通过） |
| `npm run lint` | 0 | 无输出（ESLint 通过） |

定向测试：`npx vitest run features/journal` → 4 files / 54 tests passed（改动过程中出现过 2 个并发 agent 文件的瞬态失败，最终全量运行全部通过；N5 过渡层测试与 N1 测试类型问题由各自负责人修复，与本任务无关）。

浏览器行为实测（Playwright + Chromium，脚本 `n2-screenshot-script.py`）：

| 检查 | 结果 |
| --- | --- |
| 存档列表默认呈现、8 行真实记录、编号 01–08 | ✅（`desktop_slots: 8`、`slotNumbers: 01…08`） |
| 默认选中 No.01、预览含标题/摘要/完整日期 | ✅ |
| 点「读取手记」进入 `/apps/journal/e2`，页面渲染 `[data-journal-reading]` | ✅（`reading_flow.heading = 把拖了很久的几件小事做完了`） |
| 浏览器返回后恢复 No.02 选中与预览 | ✅（`back_restore.selectedSlot = 02`） |
| 键盘 `ArrowDown` 后焦点在 `role=option` 的 No.02 上 | ✅（`keyboard_focus = {tag: LI, role: option, selected: true}`） |
| 日历切页 + 点日期只看该天 | ✅（`calendar_day_pick = true`） |
| 手机面板内单列紧凑视图（**视口宽度无关**，按容器宽度） | ✅（`n2-after-phone-compact*.png`） |
| 日期三时区一致性 | ✅ Honolulu(-10) / Kiritimati(+14) / Shanghai(+8) 下 `2026-10-09 周五`、`2026-01-01 周四` 完全一致（`n2-timezone-check-script.py`） |

浏览器控制台观察到的与本任务无关的噪声（如实记录）：2 条 `/assets/music/beneath-the-mask.mp3` 404（我的开发服务未设 `DEV_LEGACY_STATIC_URL`，与手记无关）；N1 `SiteNavLinks` 的 `key` prop 警告；N5 过渡层开发中的一次瞬态 `pageerror`（复跑消失）。

### 7.2 分项状态

| 维度 | 状态 | 依据 |
| --- | --- | --- |
| 功能 | **通过（前端模拟范围）** | 手记 54 例 + 全量 874 例 + 浏览器交互实测；真实内容/种子数据待 N7 |
| 视觉 | **未通过** | 完整存档整屏参考帧缺口（第 6 节）；只在浏览器里做了自洽性核对 |
| 真机 / 触控 | **未验证** | 只用 Playwright Chromium；未做真实触控、软键盘、斜屏四角命中（本页无输入框） |
| 迁移 / 数据库 | **不涉及** | 未改模型、权限、迁移；无数据库写入 |
| 资源复核 | **通过（本任务范围）** | 未新增公开素材；参考图仅离线对照且 N6 已复核无明智；报告截图无明智角色图 |

## 8. 未完成项、已知限制、需要的权限或外部条件、恢复 / 回退说明

### 8.1 未完成 / 未验证

1. **完整游戏存档整屏参考帧缺失**：无法校准整屏构图、标题区/日期区/列表/预览比例与选中态细节 → 视觉还原**未通过**。需要用户/集成负责人提供可追溯的 P5 存档界面整屏截图（游戏内截图或可信来源），再补充一轮视觉对照。
2. **真实内容验收未做**：本地库无公开手记，截图数据为注入的 DTO 同形 fixture；需要 N7 用种子数据在真实 API 上复跑列表/预览/读取/日历/私密不泄露场景。
3. **真机与系统输入**：触控目标、软键盘、中文输入法、320px 极窄屏只做了浏览器模拟（390px 与手机面板），真机证据留给 N7。
4. **手记正文页的长文/图片失败视觉**：本次只验证能进入正文；正文图片失败占位由并行会话的 `ReadingFigure` 覆盖，未与本任务合并验证（超出 N2 写入范围）。
5. **/apps 其它页面的顶栏留白**：`/apps/leisure` 等仍会被 fixed 顶栏压住（同类问题），我只修了手记两个页面；建议 N0/N1 统一在共享外壳处理。
6. **手机「简洁列表 → 预览」的滚动体验**：窄屏预览在列表下方，点选后自动 `scrollIntoView`；未做原版那种同屏「列表 + 大预览」的双栏比例（缺参考帧，且手机面板宽度限制），留待视觉复核后调整。

### 8.2 已知限制

- 返回位置依赖宿主本机状态服务（`journal:entry` / `journal:year`）：换设备/清存储不恢复；存储不可用时静默降级为「默认第一篇」，不阻塞读取（选中位置非关键操作，未弹提示）。
- 编号是**当前筛选结果的显示顺序**（例如筛到 2026 年后从 No.01 重排），不是稳定 ID，也不对应游戏固定 16 档；这是任务书 §3.2 的要求。
- 日历屏的筛选结果仍使用既有 `EntryCard`（并行会话在改它的图片失败占位），与存档列表使用两套展示组件；读取都进入同一正文路由。
- `No.01 / 08` 的「08」是当前筛选下的槽位总数，不是全站手记总数（页面另有「共 N 篇」文案）。

### 8.3 恢复 / 回退说明

- 本任务改动集中在 `features/journal/`（新增 `save-screen.tsx`、`save-screen.test.tsx`、`page-shell.tsx`；修改 `journal-view.tsx`、`state.ts`、`journal.module.css`）与 `app/apps/journal/` 两个页面文件。无数据库迁移、无后端接口变更、无公开素材新增。
- 回退方式：按文件恢复即可。**注意** `journal.module.css` 含有并行会话的既有改动（`.thumbFailed` / `.figureFailed` 等），回退时**不要整文件覆盖**，只回退本报告列出的存档界面样式段与暗色适配段；`entry-card.tsx` / `entry-reading.tsx` 我没有改动，回退时不要动它们。
- 本任务未执行 git commit / push / deploy，工作区改动由集成负责人统一处理。
