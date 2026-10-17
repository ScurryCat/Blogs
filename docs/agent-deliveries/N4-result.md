# N4 交付（N4a）：统一生活图库 `/gallery`、旧照片深链兼容、「我的殿堂」只留作品

> 任务书：`/Users/v/Documents/ChatGPT/Blog开发/docs/superpowers/plans/2026-10-17-p5-content-v3-agent-handoff.md`（第三轮 · P5 内容架构 v3）§4.1、§4.4、§6.1、§7.1 N4、§8.2
> 仓库：`/Users/学习/blog/Blogs` · 分支 `main`
> 范围：**task-4（N4a）已完成**；task-5（N4b：INS「同时收录到相册」前端）依赖 N3 契约，按 Lead 安排在其后实施，完成时追加本报告第 3.2 / 7 / 8 节。
> 状态：本阶段功能、测试与视觉证据已完成；真机触控与 N7 的全量验收未由本任务执行。

## 1. 实际基线、接手状态与保护方式

| 项 | 值 |
| --- | --- |
| 接手基线（N0 记录） | 分支 `main`，HEAD `e70ad1f`；工作区 dirty（第二轮迷你播放器 + N0 契约改动） |
| 本报告落笔时观察到的 HEAD | `1b61127`（**本轮期间有其他会话/集成负责人在同一仓库持续产生提交**；N4 自身**没有** `git commit` / `push` / 部署，工作区改动全部未提交。按 Lead 协调，N4 在收尾阶段不再执行任何 git 命令，此快照只作记录、不作验收基线） |
| 迁移 head | 未触碰 `apps/api`、未执行任何迁移（N3 负责） |
| 本任务写入范围 | `apps/web/features/gallery/**`、`apps/web/features/showcase/**`、`apps/web/app/gallery/`、`apps/web/app/showcase/**`、自己的测试、本报告 |
| 明确未改 | `apps/api/**`、`features/phone/**`、`features/runtime/navigation/**`、`app/globals.css`、`package.json`、第二轮 dirty 文件（globals.css / phone-host / site-runtime / mini-player）、聊天业务 |

保护方式：只做增量修改，未回退或格式化任何他人文件；对并行的 N1/N2/N3/N5 正在编辑的文件保持只读（本报告第 7 节列出复跑时观察到的其进行中失败，均不在 N4 范围）。
本轮工作区里 N4 的文件清单见 §2。

## 2. 已实现的需求与逐文件修改清单

### 2.1 需求对照（任务书 §4.1 / §6.1 / §8.2 末行、task-4 清单）

| # | 要求 | 实现 |
| --- | --- | --- |
| 1 | 新增 `/gallery` 独立生活图库入口，默认照片墙，提供「照片墙／相册」切换；相册组织图片；照片墙读公开相册图片、无自己的上传/发布/数据副本 | `app/gallery/page.tsx`（服务端读同一批公开端点）+ `features/gallery/gallery-tabs.tsx` + `features/gallery/album-gallery.tsx`（相册卡 + 加载更多）；照片墙复用现有 `GalleryView` |
| 2 | 复用同一套图库数据与组件；INS 保留相册入口；生活页/地图进入同一模块 | INS 相册页签（`ins-tab` / `ins-gallery-view` / `GalleryTabLoader`）继续复用同一批 `features/gallery/api.ts` 取数函数，**只更新路径**；`/gallery` 为唯一独立入口（地图「三浦海岸」与生活页入口由 N1 按本报告 URL 契约接线） |
| 3 | 「我的殿堂」只保留作品与作品详情；不再含照片展区；作品配图仍归作品；`SHOWCASE_MANIFEST` 仍 10 字段、副标题改「作品」 | `app/showcase/page.tsx` 移除照片墙页签与相册可用性读取；`features/showcase/project-gallery.tsx` 移除筛选栏里的「照片墙」链接；`app/showcase/projects/[slug]/page.tsx` 移除图库样式依赖（作品「图集」仍用作品自己的 `ProjectImage`）；`features/showcase/phone-view.tsx` 移除照片屏幕的展示实现；`features/showcase/phone-manifest.ts` `subtitle: "作品"`（字段仍为固定 10 个） |
| 4 | 旧 `/showcase/photos` 保留重定向，携带 album/scope/kind/year 等合法筛选参数；旧手机照片/相册深链转发图库并保留目标相册；不因旧地址含 showcase 播放殿堂过场 | `app/showcase/photos/page.tsx` 改为**服务端 308 永久重定向** → `legacyPhotosRedirectPath()`（白名单转发 album/scope/kind/year/month）；`features/showcase/phone-view.tsx` 把旧手机 `photos` / `album` 屏幕用 `host.openSiteContent({ destination, source: "phone-link" })` 转发到图库（**不传 `intent`**），非法 album slug 退回图库首页 |
| 5 | 图库路由/路径工具与测试；改前/改后截图 | `features/gallery/paths.ts` 重写 URL 契约；新增/更新 5 个测试文件；改前（旧地址）与改后（图库三视图 + 殿堂）截图见 §6 |
| 6 | 交付报告 | 本文件 |

### 2.2 逐文件修改清单

**新增**

| 文件 | 作用 |
| --- | --- |
| `apps/web/app/gallery/page.tsx` | 生活图库独立入口（服务端组件）：`/gallery` 照片墙、`?view=albums` 相册、`?scope=album&album=<slug>` 相册内；失败/空态如实表达 |
| `apps/web/features/gallery/gallery-tabs.tsx` | 「照片墙／相册」切换（真实 `SiteLink`，视图属于 URL；不传 intent） |
| `apps/web/features/gallery/album-gallery.tsx` | 相册视图：相册卡网格、加载更多（游标 / 类型）、空态 / 失败态 / 加载更多失败重试 |
| `apps/web/features/gallery/gallery-tabs.test.tsx` | 切换链接 href / aria-current / 无 intent |
| `apps/web/features/gallery/album-gallery.test.tsx` | 相册视图首屏零请求、空态、失败态、加载更多（游标 + kind）、失败重试 |
| `apps/web/app/showcase/photos/page.test.tsx` | 旧照片墙重定向页：目标地址、数组参数、非法筛选丢弃 |
| `apps/web/features/showcase/legacy-gallery-forward.test.tsx` | 旧手机 `photos` / `album` 屏幕转发目标、非法 slug、**不传 intent**、StrictMode 下只提交一次 |

**修改**

| 文件 | 变化 |
| --- | --- |
| `apps/web/features/gallery/paths.ts` | `GALLERY_PATH="/gallery"`、`LEGACY_PHOTOS_PATH="/showcase/photos"`、`GalleryViewMode` / `normalizeGalleryView()`、`galleryAlbumsHref()`、`legacyPhotosRedirectPath()`；`galleryHref()` 全部指向 `/gallery`；`GALLERY_ROUTES` 增 `albumsView` / `legacyPhotos`，`standalone` 改 `/gallery` |
| `apps/web/features/gallery/gallery-view.tsx` | 页面文档与「全部」链接改用 `GALLERY_PATH`；移除不再使用的 `AlbumCard` 导入 |
| `apps/web/features/gallery/gallery.css` | 修复相册封面高度：补 `height: auto`（`<img height>` 的 presentational hint 会压过 `aspect-ratio`，真实截图抓到封面被拉成整图高） |
| `apps/web/features/gallery/ins-gallery-view.tsx` | 仅更新注释中的旧地址（取数与组件不变，INS 相册入口继续复用） |
| `apps/web/app/showcase/page.tsx` | 移除照片墙页签、相册可用性读取与 `gallery.css` 依赖；标题/描述改为「作品」；保留作品读取失败的真实提示 |
| `apps/web/app/showcase/photos/page.tsx` | 旧照片墙页面 → 308 永久重定向（保留合法筛选参数） |
| `apps/web/app/showcase/projects/[slug]/page.tsx` | 移除 `gallery.css` 导入（作品图集用 `pls-*` 样式，作品配图仍归作品） |
| `apps/web/features/showcase/phone-view.tsx` | 只保留 `projects` / `project` 作品屏幕；`photos` / `album` 屏幕改为图库兼容转发（`legacyGalleryTarget()` 纯函数 + `LegacyGalleryForward`）；错误文案不再依赖图库的失败分类模块 |
| `apps/web/features/showcase/phone-manifest.ts` | `subtitle: "作品与照片" → "作品"`；10 字段不变；注释说明 `photos`/`album` 屏幕仅为旧深链兼容 |
| `apps/web/features/showcase/project-gallery.tsx` | 移除筛选栏中的「照片墙」链接（殿堂不再有照片入口） |
| `apps/web/features/showcase/paths.ts` | 更新路由表注释（照片墙 → `/gallery`，旧地址仅重定向） |
| `apps/web/features/gallery/paths.test.ts` | 改为 `/gallery` 契约；新增视图归一、旧地址重定向白名单/丢弃规则测试 |
| `apps/web/features/gallery/gallery-view.test.tsx` | 筛选链接断言改为 `/gallery?...`，并断言「全部」= `/gallery` |
| `apps/web/features/gallery/ins-tab.test.tsx` | INS 相册深链断言改为 `/gallery?scope=album&album=...` |
| `apps/web/features/showcase/project-gallery.test.tsx` | 清单测试新增 `subtitle === "作品"`；`screens` 断言保持（旧深链兼容需要 `photos`/`album`） |

## 3. 新增 / 修改的路由、URL 契约与字段

### 3.1 URL 契约（N1 地图 / 生活页入口与 N7 按此验收）

| 场景 | 地址 | 行为 |
| --- | --- | --- |
| 生活图库（默认照片墙） | `/gallery` | 照片墙；`album` / `kind` / `year` 作为筛选参数 |
| 生活图库 · 相册视图 | `/gallery?view=albums` | 相册卡列表（封面 / 类型 / 张数 / 说明 / 加载更多） |
| 相册内页 | `/gallery?scope=album&album=<slug>` | 相册自己的手工顺序 + 相册说明；`album` 无 `scope` 时仍按拍摄时间排序 |
| 我的殿堂（只留作品） | `/showcase`、`/showcase/projects/<slug>` | 不再有照片页签与照片网格 |
| 旧照片墙（兼容） | `/showcase/photos?album&scope&kind&year&month` | **308** → `/gallery?<合法筛选>`；`scope=album` 仅在带 `album` 时保留；非法 `kind`/`year`/`month` 与分页参数丢弃；手机参数不转发 |
| 旧手机照片深链 | `?phone=showcase&screen=photos`（任意页面） | 客户端转发 → `/gallery` |
| 旧手机相册深链 | `?phone=showcase&screen=album&item=<slug>` | 客户端转发 → `/gallery?scope=album&album=<slug>`；slug 非法 → `/gallery` |

导航意图：以上所有图库入口/旧地址**都不携带** `intent`；`enter-showcase` 仍只由「主动跨入作品殿堂边界」产生（N0 的 `showcase-boundary.ts` 已把 `/showcase/photos` 排除）。

### 3.2 本阶段新增 / 修改的类型与常量

| 类型 | 变化 |
| --- | --- |
| `features/gallery/paths.ts` | 新增 `GALLERY_PATH`、`LEGACY_PHOTOS_PATH`、`GalleryViewMode`、`GALLERY_VIEW_PARAM`、`GALLERY_ALBUMS_VIEW`、`normalizeGalleryView()`、`galleryAlbumsHref()`、`legacyPhotosRedirectPath()`；`GALLERY_ROUTES` 增 `albumsView`、`legacyPhotos`，`standalone` 值改为 `/gallery` |
| 组件导出 | `GalleryTabs`、`AlbumGallery`（gallery）；`legacyGalleryTarget()`、`SHOWCASE_APP_SCREENS`（showcase/phone-view，后者仍含 `photos`/`album` 以便识别旧深链） |
| 数据库 / 后端接口 | 本阶段**无**（N3 负责；前端公开 DTO 形状未变） |

N4b（INS 收录）将按 N3 冻结契约增加 `album_links` 前端类型与请求，见任务书 §4.3 与 `docs/agent-deliveries/N3-result.md` 第 3 节；本阶段不预先接线，避免出现「界面能选但后端未冻结」的半成品。

## 4. 与其他任务的依赖与共享文件集成

| 任务 | 集成方式 |
| --- | --- |
| N0 | 直接使用已冻结的 `NavigationIntent` / `SiteLink` / `showcase-boundary` 契约；**未改** `features/phone/**`、`features/runtime/navigation/**`。图库链接一律 `source="phone-link"`，旧地址不传 intent |
| N1 | `/gallery` 路由与 URL 契约已就绪：地图「三浦海岸」与生活页图库入口直接链到 `/gallery`（相册 → `/gallery?scope=album&album=<slug>`）；N1 的殿堂入口继续显式传 `intent="enter-showcase"`（本任务不碰） |
| N2 | 无共享文件 |
| N3 | 本阶段只消费现有公开端点（`/api/v1/gallery/albums`、`/gallery/photos`、`/gallery/photos/years`），未假造来源语义；N3 的公开 DTO 形状不变，故无需前端改动。N4b 再按冻结契约接 `album_links` |
| N5 | 未改导航/过场文件。浏览器证据中**正面对照**确认本快照里 N5 的异世界短版可播放（顶部「作品」触发 `.isekai.on`），而图库旧地址/旧手机深链只看到 Joker（`.jk.on`），证明图库不误触发殿堂过场 |
| N6 | 本任务不涉及素材；截图脚本只读取仓库内已有图片字节（mock 本地服务，不新增/不修改任何素材） |
| N7 | 可直接复用本报告 §3 URL 契约与 §6 截图路径；真实库空态证据与 mock 视觉证据分开标注，不互相冒充 |

## 5. 素材

本任务**不涉及**活动素材库、不新增/修改任何图片或视频。视觉验证用的 mock API 从 `apps/web/public/assets/legacy/img/**` 读取**仓库内已有**图片字节（不落盘、不进 Git、不改变公开目录），仅用于让照片墙/相册的自然比例、封面裁切与分组有可检查的画面。

## 6. 改前 / 改后截图

所有截图在 `/Users/学习/blog/.dsh/` 下（工作区外，不进仓库）：

**改前（旧构建 · 3100 端口旧站点，`/Users/学习/blog/.dsh/n4-before/`）**

| 文件 | 内容 |
| --- | --- |
| `before-showcase-desktop.png` | 旧「我的殿堂」：作品 / 照片墙两个页签并列，筛选栏末尾还有「照片墙」入口 |
| `before-photos-desktop.png` / `before-photos-390.png` | 旧照片墙 `/showcase/photos`（旧站内属于殿堂） |
| `before-showcase-390.png` | 旧殿堂窄屏 |

**改后（隔离生产构建 + mock fixtures，`/Users/学习/blog/.dsh/n4-after/`，`report.json` 33/33 checks）**

| 文件 | 内容 |
| --- | --- |
| `after-gallery-wall-desktop.png` / `-390` / `-320` | 新生活图库照片墙：五栏目导航、「照片墙／相册」切换、类型/年份/相册筛选、自然比例瀑布流、7 张去重照片、总数 |
| `after-gallery-albums-desktop.png` / `-390` | 相册视图：3 个相册卡（4:3 封面、类型·张数、说明、封面 alt） |
| `after-gallery-album-scope-desktop.png` | 相册内页：站主顺序 + 相册说明 |
| `after-gallery-kind-screenshot-desktop.png` | `?kind=screenshot` 筛选生效 |
| `after-gallery-lightbox-desktop.png` | 灯箱打开（真实交互） |
| `after-showcase-desktop.png` / `-390` | 改后殿堂：**没有照片页签/照片网格**，只剩作品卡片 |
| `after-showcase-project-detail-desktop.png` | 作品详情：作品图集（cover/detail/evidence）仍归作品 |

**改后（隔离生产构建 + **真实 API** 8100/pl_test，`/Users/学习/blog/.dsh/n4-after-real/`，`report.json` 6/6 checks）**

| 文件 | 内容 | 说明 |
| --- | --- | --- |
| `real-api-gallery-wall-empty.png` | 照片墙空态「共 0 张照片」，不编造图格 | 真实 dev 库 `albums=0 / photos=0`，**这是真实现状** |
| `real-api-gallery-albums-empty.png` | 相册视图空态「还没有公开的相册」 | 同上，不生成占位相册 |
| `real-api-showcase.png` | 真实数据（1 个作品）下的殿堂：只显示作品 | 真实 API |

**重定向证据（真实 Next 生产构建，非 mock）**：对 `127.0.0.1:3101` 直接请求（`max_redirects=0`）：

| 请求 | 状态码 | Location |
| --- | --- | --- |
| `/showcase/photos` | 308 | `/gallery` |
| `/showcase/photos?album=tokyo-2026&scope=album&kind=photo&year=2026&month=5` | 308 | `/gallery?album=tokyo-2026&scope=album&kind=photo&year=2026&month=5` |
| `/showcase/photos?scope=album` | 308 | `/gallery` |
| `/showcase/photos?kind=video&year=abc` | 308 | `/gallery` |
| 真实 API 环境复验：`/showcase/photos?album=x&year=2026` | 308 | `/gallery?album=x&year=2026` |

**旧手机深链浏览器证据**（同一次 `n4-after/report.json`）：

| 起点 | 最终地址 | 观察到的过场层 |
| --- | --- | --- |
| `/showcase?phone=showcase&screen=photos` | `/gallery` | 无（未出现 `.isekai.on`，观察到 `.jk.on`） |
| `/showcase?phone=showcase&screen=album&item=tokyo-2026` | `/gallery?scope=album&album=tokyo-2026` | 无 |
| 正面对照：顶部「作品」→ 殿堂 | `/showcase` | `.isekai.on`（证明异世界短版在本构建可播） |
| 图库内「照片墙 → 相册」 | `/gallery?view=albums` | 无（`.jk.on`） |

复现脚本（工作区外，无副作用）：`/Users/学习/blog/.dsh/n4-verify/mock_api.py`、`after_shots.py`、`real_api_shots.py`；隔离构建副本 `/Users/学习/blog/.dsh/n4-verify/web/`（`next build` + `next start -p 3101`，**未动 3100 共享服务器**）。

## 7. 测试命令与实际结果

执行目录 `apps/web`。命令与数字均为本次实际运行：

| 命令 | 结果 |
| --- | --- |
| `npx vitest run features/gallery features/showcase app/showcase/photos` | **11 files / 127 tests 全部通过**，exit 0（N4 范围） |
| `npm run test -- --run`（最终复跑） | **82 files / 866 tests 全部通过**，exit 0 |
| `npm run typecheck`（最终复跑） | **exit 0** |
| `npm run lint`（最终复跑） | 1 error，位于 `features/journal/save-screen.tsx:85`（N2 正在并行改写的文件，非 N4 范围，N4 收尾时尚未落入其最终修复）；N4 范围 `npx eslint features/gallery features/showcase app/gallery app/showcase` → **0 问题** |
| 隔离副本 `next build`（生产构建，`/Users/学习/blog/.dsh/n4-verify/web`） | **exit 0**；路由清单含 `ƒ /gallery`、`ƒ /showcase`、`ƒ /showcase/photos`、`ƒ /showcase/projects/[slug]` |
| 隔离副本 `next start -p 3101` + Playwright（mock fixtures） | **33/33 checks 通过**（`n4-after/report.json`） |
| 隔离副本 + 真实 API 8100 | **6/6 checks 通过**（`n4-after-real/report.json`） |

分项状态：

| 维度 | 状态 | 说明 |
| --- | --- | --- |
| 功能 | 通过（本任务范围） | URL 契约、重定向、旧手机深链、殿堂只留作品、相册/照片墙切换均有单元 + 浏览器证据 |
| 视觉 | 部分通过 | 桌面 / 390 / 320 截图已对照；**原版参考帧对照不属于本任务**，最终视觉判定交 N7 |
| 真机 | 未验证 | 触控目标、软键盘、真实手机浏览器由 N7 负责；本任务只做 Chromium 桌面/窄视口 |
| 迁移 | 不适用 | 本阶段无数据库变更（N3 负责） |
| 资源复核 | 不适用 | 本任务不涉及素材（N6 负责） |
| 后端契约 | 未由本任务证明 | 空态/真实数据只证明前端对当前公开 DTO 的消费；来源持久化、撤回矩阵由 N3 测试与 N7 复验 |

## 8. 未完成项、已知限制与回退说明

**关于本轮并行写入**：第三轮实施期间还有另一个会话在同一仓库做第二轮（P0–P3）开发并持续 `git commit`，可能影响 `app/globals.css`、图标与 showcase / journal 等文件。N4 只增量修改本任务范围；若上述共享文件出现非 N4 改动，N4 不去 revert / 不运行 git 命令，由 Lead 在最终集成时统一核对。

**未完成 / 交由他人**

1. **N4b（task-5）**：INS 编辑界面「同时收录到相册」、草稿保留、`album_links` 请求/响应、409/412/422 真实错误展示。N3 契约已冻结，本报告完成时尚未开始；完成时在本文件追加。
2. **INS 相册页签的浏览器端到端**：共享 dev 库没有公开相册，INS 页签在真实环境中不出现（`isAvailable=false` 是设计行为）；本任务用 `features/gallery/ins-tab.test.tsx`（16 例，含新的 `/gallery` 深链断言）覆盖，未用 mock 冒充 INS 集成通过。
3. **地图 / 生活页入口**：由 N1 接线到 `/gallery`（本任务已提供 URL 契约与路由），尚未在 N1 完成后做联合浏览器复验。
4. **真机 / 触控 / N7 全量验收**：未执行。

**已知限制**

- 视觉截图使用 mock fixtures（原因：真实 dev 库 `albums=0`），报告第 6 节已把 mock 视觉证据与真实 API 空态证据分表标注；mock 只影响画面内容，不影响路由、重定向与交互行为。
- 隔离构建副本在构建时对并行 agent 的无关类型/lint 错误做了忽略（副本内 `next.config.ts` 临时配置，**仓库文件未改**），因此该构建只用于浏览器证据；仓库本身当前 `typecheck` exit 0。
- 相册视图的「加载更多」以 30 个为上限服务端分页（API `MAX_LIMIT=30`），已实现客户端追加；真实库相册数量不足 30 时不可见该按钮，属正常。
- 截图中底部迷你播放器在部分整页截图里与页脚重叠，是第二轮全局播放器的既有布局表现（`app/globals.css` / 播放器组件归第二轮与 N5），不在 N4 修改范围，已在报告中标注给 N7。
- 旧手机深链转发是一次客户端重定向（先进入手机壳再换页到图库）；视觉上手机壳会短暂出现。这是不改 `features/phone/**`（共享热点）前提下的最小侵入方案；若 N7 认为需要更平滑，可在 N5/N7 集成阶段评估。

**回退说明**

- 本任务改动全部可用 `git checkout -- <文件>` / 删除新增文件恢复；无数据库迁移、无素材改动、无依赖变更、无 Git 历史改写。
- 回退顺序建议：先删 `app/gallery/` 与 `features/gallery/{gallery-tabs,album-gallery}.tsx` 及其测试，再恢复 `app/showcase/photos/page.tsx` 旧页面与 `features/gallery/paths.ts`；回退后旧手机深链与旧照片墙行为回到第二轮状态。
- 本轮未提交任何 Git 对象；生产服务器（3100）和共享 API（8100）未被本任务重启或改配置。
