# N1 交付：导航与地图（五栏目 · /posts 独立索引 · 首页摘要 · 地图单一目的地配置 · 旧链接兼容）

> 任务书：`/Users/v/Documents/ChatGPT/Blog开发/docs/superpowers/plans/2026-10-17-p5-content-v3-agent-handoff.md`（第三轮 · P5 内容架构 v3，§2 / §7.1 N1 / §7.3 / §8.1 / §9）
> 项目：`/Users/学习/blog/Blogs` · 分支 `main` · 只增改工作区文件，**未做任何 Git 提交 / 推送 / 历史改写**
> 共享任务：`task-1`（N1 导航与地图）· 本报告按任务书 §9 的八节格式提交

## 1. 任务编号、实际基线、分支、接手时已有修改及保护方式

- **任务编号**：N1（导航与地图）。交付范围按任务书 §2 与 §8.1。
- **仓库 / 分支**：`/Users/学习/blog/Blogs` · `main`。接手时只读检查到 HEAD 为
  `a7475a4 feat(messaging): 会话详情菜单…`（N0 报告记录的交接基线是 `e70ad1f`；
  第二轮并行工作已在其上追加 `01d9fe0` / `b10d4aa` / `a7475a4` 等提交，本轮不回到旧提交）。
- **接手时工作区已有修改（全部保留，未回退、未整文件覆盖）**：
  - N0 共享契约：`features/phone/types.ts`、`features/runtime/navigation/coordinator.tsx` /
    `link-guard.ts` / `site-link.tsx` / `transition-layer.tsx`、新增 `showcase-boundary.ts` 与契约测试；
  - 第二轮 dirty 文件：`app/globals.css`、`features/phone/phone-host.tsx`、
    `features/runtime/site-runtime.tsx`、`features/runtime/audio/mini-player.tsx`、
    `tests/runtime/mini-player.test.tsx`（未跟踪）；
  - 其他任务进行中的文件（gallery / journal / ins / coop 等）。
- **保护方式**：`features/phone/**`、`features/runtime/navigation/**`（N0 冻结契约）、
  `app/globals.css`、`package.json`、`docs/design-references`、第二轮 dirty 文件**一律未改**；
  导航意图只作为调用方参数使用，不改协调器语义。
- **两处经报备的最小例外**（均不涉及运行时行为改写）：
  1. `features/legacy/config.ts`：仅类型断言（`raw.map as Record<string, MapDestination>`）
     + 注释。原因：按任务书 §2.3 清空 `site.json` 的旧 map 后，`Object.entries({})` 推断为
     `never` 导致 `tsc` 报 TS2698。已先发消息报备，Lead 批准后落地。
  2. `app/posts/[slug]/page.tsx`：面包屑一行 `/#posts` + `PALACE INDEX`
     → `/posts` + `INTELLIGENCE ARCHIVE`（按 §2.2 统一「情报档案」命名；文件在
     `app/posts/` 写入范围内）。
- **Git 纪律**：按 Lead 10:49 的并行协调通知，此后不再执行任何 git 命令（此前只做过只读
  `status` / `log` / `diff` 查看基线）。未 add / commit / push / reset / checkout / stash。

## 2. 已实现的需求与逐文件修改清单

### 2.1 顶部固定五栏目（任务书 §2.1 / §8.1）

- 顶部固定五项：**文章/情报档案→`/posts`、生活/勒布朗→`/apps/leblanc`、
  作品/我的殿堂→`/showcase`、地图/东京漫游→`/map`、关于/人物档案→`/about`**。
- 桌面与移动端渲染**同一份 DOM / 同一份配置**（响应式仅隐藏副标题，不另建移动菜单）。
- 天气从一级导航移除（`/weather` 页保留，地图与手机入口可达）。
- Logo 返回首页；「作品」链接显式 `intent="enter-showcase"` 且 href 仍为 `/showcase`。
- 友链由 COOP 承担、关于页保留入口（`/about` 的 `CoopLinksSection` 已有「在 COOP 通讯录里打开」）；
  地图六本木→`/apps/coop`。COOP **不新增第六栏目**。
- 子页面高亮改为**按内容归属**（见 2.2），不再由页面手动传 key，也不只比较 URL 完全相等。

### 2.2 子页面高亮按内容归属（任务书 §2.1）

- 文章：`/posts`、`/posts/<slug>`；
- 生活：`/apps/leblanc`、`/apps/journal*`、`/apps/ins*`、`/apps/leisure*`、`/gallery*`、
  `/guestbook`、旧 `/showcase/photos`（与 `showcase-boundary.ts` 的「旧照片地址不属于殿堂边界」一致）；
- 作品：`/showcase`、`/showcase/projects/<slug>`（`/showcase/photos` 已先归生活）；
- 地图：`/map`；关于：`/about`、`/apps/coop`；
- 不占一级栏目的路径（`/`、`/weather`、`/apps/metanav`、`/velvet`、管理端等）不强行高亮。

### 2.3 `/posts` 独立文章索引与首页摘要（任务书 §2.2 / §8.1）

- 新增 `/posts`：搜索（标题 / 标签 / 正文）、分类筛选（塔罗分类）、列表 / 归档视图切换；
  `?view=archive` 由服务端解析，直达 / 刷新 / 分享都打开归档；归档按年份分组并带 `#year-YYYY` 锚点。
- 数据继续走现有链路 `readPublishedPosts()`（默认迁移基线，显式打开 API 时读 FastAPI）；
  API 读取失败如实提示，不伪装成「没有文章」。
- 首页保留主题框架，改为**摘要**：生活近况（`LeblancView`，新增 INS / 图库入口）、
  最新文章（`id="posts"`）、精选作品（API 真实数据；无数据 / 读取失败显示真实空态，不造占位）、
  归档入口（`id="archive"`，年份直达 `/posts?view=archive#year-YYYY`）；首页不再复制完整索引 / 归档。
- 旧 `/#posts`、`/#archive` 落到首页摘要区块（实测 `top≈166px` / `174px`，固定页头已计入
  `scroll-margin`），区块内都有进入 `/posts` / 归档视图的真实入口，不悬空。
- 文章列表展示名称统一「情报档案」：`/posts` 页 h1、文章详情面包屑已改；
  首页引用 `CallingCard`（预告信）保持原主题。

### 2.4 地图目的地单一配置（任务书 §2.3 / §8.1）

- 新建**唯一**目的地配置 `features/navigation/map-destinations.ts`：13 个开放地点与
  任务书 §2.3 表格一一对应（四轩茶屋→`/apps/leblanc`、涩谷→`/apps/ins`、
  青山一丁目→`/apps/journal`、神保町→`/posts`、上野→`/showcase`、三浦海岸→`/gallery`、
  秋叶原→`/apps/leisure?screen=game`、池袋→`/apps/leisure?screen=anime`、
  六本木→`/apps/coop`、浅草→`/posts?view=archive`、井之头公园→`/weather`、
  明治神宫→`/guestbook`、永田町→`/about`）。
- 地图**图标 / 右侧出发 / 下方列表三入口都读解析后的同一份 `location.to`**，不再有三份映射；
  目的地图层只改这一处，`features/legacy/data/map.json` 的 25 个地点几何 / 地名 / 位置未动。
- 移除绑定具体文章 slug 的目的地：`site.json` 的旧 `map` 配置已清空为 `{}`，`features/legacy/map.ts`
  不再 import `posts` / `legacyHrefToNext`，目的地一律是新站真实路由。
- 其余 12 个地点保持未开放：`to=null`、图标不可点、不进列表、无假链接。
- 上野三入口（图标 / 出发 / 列表）都显式带 `intent="enter-showcase"`，href 保持 `/showcase`；
  其它地点不带意图、`/showcase/photos` 类旧地址也不加意图。
- 右侧档案卡解释栏目内容（标题 / 用途说明 / 短英文名），不再显示旧文章封面或日期，
  统一用地点插画，避免把旧文章数据带进新版地图。

### 2.5 生活入口（任务书 §1 / §2.1）

- `/apps/leblanc` 与首页同一 `LeblancView`：新增「看 INS 动态」「逛生活图库」入口，
  保留手记 / 放课后 / 留言 / 异世界导航入口；说明只聚合摘要、详情属于原模块。
- 图库入口使用 N4 已确认的 URL 契约 `/gallery`（默认照片墙），地图三浦海岸同样落到 `/gallery`。

### 2.6 逐文件修改清单

**新增（11 个）**

| 文件 | 说明 |
| --- | --- |
| `apps/web/features/navigation/site-nav.ts` | 五栏目唯一配置 + 内容归属高亮（`activeSection`）+ COOP 归属常量 + 天气/图库/留言路径常量 |
| `apps/web/features/navigation/site-nav-links.tsx` | 客户端链接栏（`usePathname` 计算归属高亮、传 intent；桌面/移动同一份 DOM） |
| `apps/web/features/navigation/map-destinations.ts` | 13 个开放地点目的地**单一配置**（href / 英文短名 / 标题 / 用途说明 / 上野意图） |
| `apps/web/features/navigation/navigation.css` | 新增样式：五栏目页头、`/posts` 索引、首页摘要；**未改 `app/globals.css` / 迁移样式副本** |
| `apps/web/features/navigation/post-row.tsx` | 文章行展示组件（首页摘要与 `/posts` 共用，无客户端状态） |
| `apps/web/features/navigation/posts-view.tsx` | `/posts` 客户端视图（搜索 / 分类 / 列表·归档切换 / 地址栏同步 / 空态 / 降级提示） |
| `apps/web/app/posts/page.tsx` | `/posts` 服务端页面（解析 `?view=archive`，用现有文章数据链路） |
| `apps/web/tests/navigation/site-nav.test.tsx` | 五栏目 / 归属高亮 / 页头渲染（33 例） |
| `apps/web/tests/navigation/map-destinations.test.tsx` | 单一配置 / 三入口一致性 / 上野意图 / 几何不变（14 例） |
| `apps/web/tests/navigation/posts-index.test.tsx` | `/posts` 搜索、分类、视图切换、直达归档、空态（11 例） |
| `apps/web/tests/navigation/home-summaries.test.tsx` | 首页摘要、真实空态、旧锚点兼容（8 例） |

**修改（10 个）**

| 文件 | 说明 |
| --- | --- |
| `apps/web/components/ui/site-header.tsx` | 服务端页头：改由统一配置驱动、接入 `SiteNavLinks`、Logo 首页、天气移除、转出 `MAIN_NAV` 供页脚复用 |
| `apps/web/features/legacy/map.ts` | 目的地解析改读 `features/navigation/map-destinations.ts`；`MapDestinationInfo` 增加 `intent`；删除文章 slug / 旧 HTML 入口解析 |
| `apps/web/features/legacy/data/site.json` | 旧 `map`（13 条、含文章 slug 绑定）清空为 `{}`，避免第二份目的地配置 |
| `apps/web/features/legacy/pages/map-view.tsx` | SVG 图标链接支持 `intent`；三入口统一读 `location.to`；档案卡去掉旧文章封面/日期，统一地点插画 |
| `apps/web/features/legacy/pages/home-index.tsx` | 由「完整宫殿索引」重写为首页摘要组件：`HomeLatestPosts` / `HomeFeaturedWorks` / `HomeArchiveEntry` |
| `apps/web/app/page.tsx` | 首页改摘要：最新文章 / 精选作品（服务端读公开作品，失败如实降级）/ 归档入口；移除完整索引与归档 |
| `apps/web/features/leblanc/leblanc-view.tsx` | 生活汇总入口补 INS / 图库；说明只聚合摘要 |
| `apps/web/features/legacy/config.ts` | **仅类型断言 + 注释**（Lead 已批准的最小改动，见 §1 例外） |
| `apps/web/app/posts/[slug]/page.tsx` | 面包屑改 `INTELLIGENCE ARCHIVE` → `/posts`（统一「情报档案」命名，一行） |
| `apps/web/tests/legacy/data.test.ts` | 地图基线断言同步新语义（开放 13、默认 18→`/apps/leblanc`、无 slug 绑定、`site.map={}`） |

## 3. 新增 / 修改的接口、字段、路由、导航意图或数据库迁移

| 类型 | 变化 |
| --- | --- |
| 路由 | **新增** `/posts`（服务端页面 + 客户端索引视图）；`/posts?view=archive` 打开归档视图；`/posts/[slug]` 保留。 |
| 前端类型 | 新增 `NavSectionKey` / `MainNavItem`（`features/navigation/site-nav.ts`）、`MapDestinationConfig`（`map-destinations.ts`）、`PostsViewMode`。 |
| 导航意图 | 不改 N0 冻结的 `NavigationIntent` / `NavigationRequest.intent` 契约；调用方显式使用：顶部「作品」、地图上野三入口、首页「我的殿堂」CTA。`/showcase/photos` 等旧地址不带意图。 |
| 地图目的地 | `site.json.map` 由旧站逐字段配置（13 条，含 `post` slug 绑定）改为空对象；唯一来源为新模块。`MapDestinationInfo` 字段改为 `{href,en,title,note,intent?}`（删除 `cover`/`date`）。 |
| 数据库迁移 | 无。 |
| 后端接口 | 无新增/修改。首页精选作品复用现有 `fetchProjectsOnServer()`（`/api/v1/projects`）；文章复用 `readPublishedPosts()`。 |
| 配置 | 五栏目、天气不占一级栏目、COOP 归属「关于」、`/gallery`（默认照片墙）、`/guestbook` 等常量集中到 `site-nav.ts`。 |

## 4. 与其他 agent 的依赖和共享文件集成情况

- **N0（冻结契约）**：`NavigationIntent` / `SiteLink.intent` / 协调器与手机完成信号均**只读使用**，
  未修改 `features/runtime/navigation/**`、`features/phone/**`、`app/globals.css`、`package.json`。
- **N5（殿堂短过场）**：N1 只负责**入口与意图声明**；异世界短版的实际媒体与播放由 N5 提供、
  N0 提供契约。N1 未改 `transition-layer.tsx`，也未追加 `.isekai` 样式。
- **N4（图库）**：按 Lead 转达的 URL 契约使用 `/gallery`（默认照片墙，`/gallery?view=albums` 为相册视图）；
  N1 不实现图库。实施期间 N4 的 `/gallery` 路由已落地（实测 HTTP 200，`?view=albums` 200），
  地图三浦海岸与生活页图库入口不再 404。
- **N6（素材）**：不涉及；N1 未新增媒体、未改图标引用、未动 `docs/design-references`。
- **N2（手记）**：无共享文件；`features/journal/save-screen.tsx` 的 lint 报错在其进行中阶段出现，
  收尾时已由 N2 修复（最终 lint exit 0）。
- **并行第二轮会话**：按 Lead 10:49 协调停止所有 git 命令；收尾时核对本人 16 个文件的 mtime 均为
  自己最后编辑时间（10:38–10:42），未被对方覆盖。`features/legacy/config.ts` 属交叉文件，
  只做了批准过的类型断言，请集成时留意。
- **并行任务进行中导致的失败（非 N1 引入，详见 §7）**：
  `features/ins/album-links.test.ts`（10 个 TS 错误）与 `features/ins/moment-workspace.test.tsx`
  （`ReferenceError: Cannot access 'MEDIA' before initialization`）是 N4b 收尾前的新文件。

## 5. 素材

本任务**不涉及素材**：地图仍用既有地图底图 / 地点插画 / 标签 SVG（`features/legacy/data/map.json`
与 `public/assets/legacy/img/map/`），未新增、未删除、未重新生成任何图片或媒体，无游戏版本 / 哈希 /
处理范围需要记录。图标安全与来源核对属于 N6。

## 6. 改前 / 改后截图

截图目录：`/Users/学习/blog/Blogs/.dsh/screenshots/`（仓库内，未提交）。

| 改前（当前工作区旧页面） | 改后（本次实现） |
| --- | --- |
| `n1-before-header.png`：POSTS 文章 / MAP 地图 / **WEATHER 天气** / GUESTBOOK 留言 / ABOUT 关于 | `n1-after-header.png`：文章/情报档案、生活/勒布朗、作品/我的殿堂、地图/东京漫游、关于/人物档案；「文章」红色下划线高亮 |
| `n1-before-header-mobile.png` | `n1-after-header-mobile.png`（390px：五项中文主栏目，无横向溢出）；`n1-after-tiny.png`（320px，无溢出） |
| `n1-before-home.png`：首页含完整宫殿索引 + 完整归档 | `n1-after-home.png` / `n1-after-mobile.png`；`n1-after-home-latest.png`（最新文章摘要 + `/posts` 入口）；`n1-after-home-archive.png`（归档入口 + 年份直达）；`n1-after-home-works.png`（共享 dev server 未配 API 时的**真实空态**）；`n1-after-home-works-real.png` / `n1-after-home-real.png`（配置 `API_INTERNAL_URL` 的同源镜像渲染：真实作品「这个 P5 博客」卡片） |
| `n1-before-map.png`：开放地点多为文章 slug、青山一丁目/池袋/三浦海岸为 CLOSED | `n1-after-map.png`（默认四轩茶屋：LIFE 生活·勒布朗）；`n1-after-map-ueno.png` / `n1-after-map-ueno-card.png`（**选中上野：SHOWCASE / 作品·我的殿堂 / 出发→`/showcase`**）；`n1-after-map-card.png`；`n1-after-map-mobile.png` |
| `/posts` 改前为 404（`目标已消失`） | `n1-after-posts.png`（列表 + 搜索 + 分类 chips + 视图切换）、`n1-after-posts-archive.png`（归档视图，`2026` 年份分组）、`n1-after-posts-archive-mobile.png`、`n1-after-posts-mobile.png`、`n1-after-posts-tiny.png`（320px） |

**证据说明（不冒充真实浏览器结论）**：

- 「地图选中上野」与「首页真实精选作品」两张截图在**同源代码镜像 dev server**上生成
  （唯一差别：临时把镜像里的 `DEFAULT_LOCATION_ID` 改为 6 以呈现选中上野的档案卡；
  线上默认仍为 18 四轩茶屋；镜像同时配置了 `API_INTERNAL_URL` 以显示真实作品）。
  截图不覆盖仓库代码，镜像已删除。
- 其余截图来自共享 dev server（`http://127.0.0.1:3123`，当前工作区热更新），SSR 渲染。
- 本环境浏览器**未完成 React hydration**（见 §8），因此涉及客户端状态切换的截图
  （如点击选中地图地点、点分类 / 视图按钮）无法用真实浏览器取得，只能由 jsdom 行为测试覆盖；
  未用 DOM 伪造或 PS 截图冒充。

## 7. 测试命令和实际结果

执行目录 `cd /Users/学习/blog/Blogs/apps/web`：

| 命令 | 结果 | 退出码 | 说明 |
| --- | --- | --- | --- |
| `npm run test -- --run`（10:54，N4b 新文件出现前） | **83 files / 874 tests passed** | 0 | N1 新增 4 个测试文件 66 例；同步更新的 `tests/legacy/data.test.ts` 17 例 |
| `npx vitest run tests/navigation tests/legacy/data.test.ts`（N1 单独） | **5 files / 83 tests passed** | 0 | N1 自身范围全绿 |
| `npm run lint`（10:58 最终） | 无 error / warning | 0 | — |
| `npx eslint`（N1 全部文件 + 更新测试） | 无 error / warning | 0 | — |
| `npm run typecheck`（10:43，N4b 新文件出现前） | 无错误 | 0 | — |
| `npm run typecheck`（10:55 / 10:58 最终复跑） | **10 个错误，全部位于 `features/ins/album-links.test.ts`**（`'schema' is possibly 'undefined'` 等） | 2 | N4b **进行中**的新测试文件（10:55 创建），不是 N1 文件；错误清单里没有任何 N1 文件 |
| `npm run test -- --run`（10:58 最终复跑） | 85 files passed / **1 file failed**；894 tests passed | 1 | 失败文件为 N4b 进行中的 `features/ins/moment-workspace.test.tsx`：`ReferenceError: Cannot access 'MEDIA' before initialization`；其余 85 个文件全绿 |
| 基线对照（N0 报告） | 71 files / 739 tests | 0 | 本轮新增的测试来自 N1 / N4 / N5 等并行任务 |

**浏览器证据（Playwright + 系统 Chromium 148，`http://127.0.0.1:3123`）**：

| 检查类别 | 结果 |
| --- | --- |
| SSR / DOM / 静态可见性检查（五栏目文本、无天气项、Logo href、`#posts`/`#archive` 落点、地图 13 个可点 + 12 个未开放无链接、列表与图标 href、`/posts` 标题与 8 行、归档视图与 `#year-2026`、8 个子页面高亮、旧锚点滚动位置、390px/320px 无横向溢出等） | **全部通过**（33 / 38 项） |
| 客户端交互检查（点击 `/posts` 分类与视图切换、鼠标选中地图上野、Logo 客户端路由） | **5 项失败**，原因见 §8：本 sandbox 的 Chromium 未完成 React hydration（页面脚本加载、0 个 pageerror，但 React 未创建 root）——在**旧生产构建（3100）与当前 dev server（3123）上同样复现**，属环境/并行工作区的既有问题，不是 N1 代码；交互行为改由 jsdom 行为测试覆盖（`tests/navigation/*`，66 例全绿） |

功能 / 视觉 / 真机 / 迁移 / 资源复核状态：

- **功能**：通过（jsdom 行为测试 66 例 + SSR DOM 断言）。
- **视觉**：桌面 1440 / 390 / 320 截图已出，P5 风格与旧站一致；**真实浏览器客户端交互复验未完成**（hydration 限制，见 §8）。
- **真机**：未验证（属 N7）。
- **迁移**：不适用（无数据库迁移）。
- **资源复核**：不适用（不涉及素材，N6 负责）。

## 8. 未完成项、已知限制、需要的权限或外部条件，以及恢复 / 回退说明

1. **浏览器 hydration 环境限制（最重要）**：本 sandbox 的 Playwright Chromium（148）打开共享 dev server
   （3123）与旧生产构建（3100）时，页面脚本全部加载且无 JS 异常，但 `ReactDevTools.renderers.length === 0`、
   等待 3 分钟仍无 root —— 客户端交互（点击分类 / 切换视图 / 鼠标选中地图地点）无法在浏览器中真实复验。
   已用 SSR DOM 检查 + jsdom 行为测试替代，**不宣称客户端交互已通过真实浏览器验收**；请 N7 在能正常
   hydration 的浏览器 / 环境中按 §8.1 复验（重点：地图选中与三入口过场、`/posts` 搜索分类归档、旧锚点滚动）。
2. **首页「精选作品」需要 `API_INTERNAL_URL`**：共享 dev server 未配置该变量，首页显示真实空态
   （「接口服务尚未配置，暂时无法读取作品」）；已在配置了 API 的同源镜像上验证真实作品卡片与
   `/showcase`、`/showcase/projects/<slug>` 链接。集成环境请确认服务端变量，N7 复验真实作品摘要。
3. **图库依赖 N4**：`/gallery` 路由实施期间已由 N4 落地（默认照片墙，`?view=albums` 相册视图）；
   N1 只做入口，图库本身不在 N1 范围。
4. **殿堂过场依赖 N5**：N1 只显式声明 `intent="enter-showcase"`（顶部作品、地图上野三入口、首页 CTA），
   实际短过场媒体 / 播放 / 降级属 N5；本报告不宣称过场已验收。
5. **仍使用旧命名的相邻位置（不在 N1 写入范围，建议集成阶段处理）**：
   - `features/legacy/pages/home-hero.tsx` 首页快捷菜单仍写 `PALACE INDEX 文章` / `FORECAST 天气`；
   - `app/not-found.tsx` 文案「返回宫殿索引」；
   - `features/phone/legacy-apps.ts` 手机端旧应用名（`features/phone/**` 冻结，需 N0 决定）。
   上述均不影响顶部五栏目与 `/posts` 索引，但若要彻底执行 §2.2「统一情报档案命名」，需要这些 owner 一起改。
6. **`/#posts`、`/#archive` 的兼容方式**是「首页摘要区块 + 入口」，不再复制完整搜索页（符合任务书允许的
   「有意义的兼容位置」）；旧 `index.html#posts` 等服务端重定向仍由 `next.config.ts`（T00 owner）处理，N1 未改。
7. **`features/legacy/config.ts` 的例外改动**：仅类型断言，已获 Lead 批准；若集成方希望还原，可回退该断言并把
   `site.json.map` 恢复为非空对象（但那样会重新引入旧 slug 绑定，不建议）。
8. **并行任务未收尾的验证噪声**：最终一次全量 test / typecheck 的失败全部来自 N4b 进行中的
   `features/ins/**` 新文件（见 §7），N1 自身 5 个测试文件 83 例、N1 文件 eslint、以及 N4b 文件出现前的
   全量 test（83/874）与 typecheck 均为 0 退出；请集成时以 N4b 修复后的全量为准。
9. **回退方式**（无 Git 操作）：
   - 新增文件：删除 `features/navigation/{site-nav,site-nav-links,map-destinations,post-row,posts-view}.ts(x)`、
     `features/navigation/navigation.css`、`app/posts/page.tsx`、`tests/navigation/`；
   - 修改文件：按 §2.6 恢复原内容（`site-header.tsx`、`legacy/map.ts`、`site.json` 的 map 段、
     `legacy/pages/map-view.tsx`、`legacy/pages/home-index.tsx`、`app/page.tsx`、
     `features/leblanc/leblanc-view.tsx`、`legacy/config.ts` 一行、`app/posts/[slug]/page.tsx` 面包屑、
     `tests/legacy/data.test.ts`）；
   - 无数据库迁移、无新增依赖、无媒体/公开资源变化，回退不影响后端或其他 feature。
