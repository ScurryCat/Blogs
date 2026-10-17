# N7 验收交付：第三轮 P5 内容架构 v3 —— 集成回归、§8 场景证据、迁移复验、资源与设备证据

> 任务书：`/Users/v/Documents/ChatGPT/Blog开发/docs/superpowers/plans/2026-10-17-p5-content-v3-agent-handoff.md`
> （第三轮 · P5 内容架构 v3，§7.1 N7 / §8 全部 / §9）
> 项目：`/Users/学习/blog/Blogs` · 分支 `main` · 共享任务 `task-8`（owner `n7-acceptance`）
> 本报告是 **N7 验收报告**，不代表产品代码由 N7 修改：N7 未改任何业务代码、未 commit / push / deploy。

---

## 1. 任务编号、实际基线、分支、接手时已有修改及保护方式

### 1.1 任务与角色

| 项 | 内容 |
| --- | --- |
| 任务编号 | N7（验收负责人），共享任务 `task-8` |
| 依据 | 任务书 §7.1 N7「集成回归、对照截图、迁移验证、资源与设备证据、未完成项；功能、视觉、真机分别判定，不能互相替代」；§8 全部清单；§9 交付格式 |
| 判定口径 | 测试通过 ≠ 视觉通过；浏览器模拟 ≠ 真实触控；缺证据的条目一律标「未通过 / 未验证」，不写「基本完成 / 应该可用」 |
| 写入范围 | `docs/agent-deliveries/N7-result.md`、`.dsh/n7/**`、`.dsh/screenshots/**`、`apps/web/tools/browser-verification/**`（任务允许）；未触碰业务代码、测试断言与依赖 |

### 1.2 实际基线（2026-10-17）

| 时点 | 事实 |
| --- | --- |
| N7 接手时 | HEAD `e02dec6`（N4b 已提交），工作区干净；前端基线（Lead 通报）87 files / 907 tests、typecheck/lint exit 0；后端 942 passed；迁移 head `b7c3e9a1d2f4`（单一 head） |
| 验收期间 | **外部第二轮会话（P6）仍在同一仓库持续提交**：`e02dec6 → 15fc5f2` 共 27 个提交（含 `features/phone/**`、`features/ins/**`、`features/journal/**`、`features/showcase/project-card.tsx` 等前端改动与多份 docs）。N7 不 revert、不覆盖、不 commit，只读验证 |
| **最终验证冻结基线** | **`9384f29`**（N7 的 fresh build、全量测试、浏览器与迁移证据均在这一提交的源码上取得；其后 `d388395` / `15fc5f2` 只改 `docs/**` 与新增 `tools/verify-all.sh`，`git diff --name-only 9384f29..HEAD` 无 `apps/**` 代码变化） |
| 迁移 head | `b7c3e9a1d2f4`（单一 head；`alembic heads` 实测只有这一条） |
| Node / npm | v26.8.1 / 11.19.0 |
| Python / uv | 3.13 + uv 0.9.18（`UV_CACHE_DIR=/Users/学习/blog/.dsh/uv-cache`） |
| Playwright | 系统 Python 的 `playwright`（chromium_headless_shell-1223），不向 `apps/web` 加依赖 |

### 1.3 验收环境（隔离栈，不依赖其他会话的服务）

| 组件 | 端口/地址 | 说明 |
| --- | --- | --- |
| PostgreSQL（N7 自建隔离集群） | `127.0.0.1:55440`（`.dsh/n7/pgdata`，PG 18.6，`pl` 用户 trust） | 验收数据 `pl_test_n7_accept`；pytest 库 `pl_test_n7`；迁移 scratch 库用后即 drop |
| 隔离 API（uvicorn） | `127.0.0.1:8107` | `DATABASE_URL=…:55440/pl_test_n7_accept`，`MEDIA_ROOT=.dsh/n7/media` |
| 旧站静态（音乐 / legacy 资源） | `127.0.0.1:8009` | `python3 -m http.server --bind 127.0.0.1`，只读 |
| Web（fresh 生产构建 + `next start`） | `127.0.0.1:3107` | 构建/启动都带 `API_INTERNAL_URL` / `DEV_API_URL` / `DEV_LEGACY_STATIC_URL` |
| 复现脚本 | `.dsh/n7/setup_stack.sh` | `db / api / web / static / all / stop / status`；数据结构见 `.dsh/n7/seed_data.py` |

**环境事故记录（如实、非产品缺陷）**：共享 PostgreSQL 集群 `.dsh/pgtest`（55432，全队共用）在验收期间被并行会话执行 `fast shutdown`（`server.log`：`2026-10-17 11:47:45 received fast shutdown request`），并出现「port 55432 尝试启动失败 → 55433 启动」的反复；导致 N7 的隔离 API 一度全部 `503 OperationalError`。为避免最终判定依赖一个会被别的会话随时停掉的共享服务，N7 **自建 `.dsh/n7/pgdata` 集群（55440）**并以其为准；共享集群恢复后也用它跑通了 N3 的旧验收脚本（见 §7.6）。未修改共享集群数据、未 drop 任何共享库。

**保护方式**：全程未对业务代码做任何修改；未执行 `git add/commit/push/reset/checkout/stash`；未重启/修改 3100 / 8100 / 3123 / 8000；对并行会话提交的前端改动只读验证。

---

## 2. 已实现的需求（N7 交付物）与逐文件清单

N7 的交付物是**可复跑的验证工具 + 证据**，不是产品功能：

**新增（未提交，按约束保留在工作区）**

| 文件 | 作用 |
| --- | --- |
| `apps/web/tools/browser-verification/verify-round3.py` | 第三轮 §8.1/§8.2 末行/§8.4 浏览器验收主套件（**118 项断言**，36 张截图，JSON 报告） |
| `apps/web/tools/browser-verification/verify-round3-supplement.py` | §8.1 补充套件（生活页聚合、COOP 入口、文章面包屑、普通链接/修饰键/中键原生行为、首页摘要、INS 动态；**11 项断言**） |
| `.dsh/n7/setup_stack.sh` | 隔离栈一键搭建（重建库 → 迁移 → 升站主 → 启动 API/静态服务 → fresh build → 启动 3107；支持单独重跑与 stop/status） |
| `.dsh/n7/seed_data.py` | 通过**真实管理 HTTP 流程**（登录 → CSRF/Origin → 上传媒体 → 建相册 → 发布 → 手记/作品/动态收录）写入真实数据；含公开投影自检（照片墙去重 7 张、私密/草稿不泄露、仅动态来源可见等） |
| `.dsh/n7/verify_migration.py` | 迁移复验：独立 scratch 库 `pl_test_n7_mig_<pid>` 上升降再升 + 回填 / 数据保留 / 降级安全 / 幂等 / 权限断言，结束即 drop |
| `.dsh/n7/verify_album_lifecycle.py` | 图库收录生命周期 E2E（真实 HTTP + 隔离 PostgreSQL）：纯动态来源 vs 独立来源、草稿/公开组合、撤回/重发、`album_links` 三态与 409/412/428、幂等、清理回基线 |
| `.dsh/n7/pgdata`、`.dsh/n7/pgdata-55432` | N7 自建 PostgreSQL 集群（55440 为主；55432 为跑 N3 旧脚本临时启动的**空**集群，脚本自行建/删 `pl_row6`） |
| `.dsh/n7/logs/**` | 所有命令的原始日志（构建/测试/lint/类型/浏览器/迁移/素材） |
| `.dsh/n7/*.json` | 机读证据：`browser-report.json`、`browser-supplement-report.json`、`migration-report.json`、`album-lifecycle-report.json`、`seed-summary.json` |
| `.dsh/screenshots/n7-*.png` | 40 张验收截图（桌面 + 390 + 320，见 §6） |

**明确未改**：`apps/web/**` 业务代码、`apps/api/**`、`contracts/`、依赖清单 / 锁文件、数据库共享库、第二轮 dirty 文件、Git 历史。N7 的两个浏览器脚本是**新增工具文件**（未跟踪），未改既有测试。

---

## 3. 新增 / 修改的接口、字段、路由、导航意图或数据库迁移

N7 不新增产品接口。本项记录**验收所确认的既有契约事实**（供集成负责人核对）：

| 类型 | 验收确认 |
| --- | --- |
| 路由 | `/posts`、`/posts?view=archive`、`/gallery`（`?view=albums`、`?scope=album&album=<slug>`、`?year=`、`?kind=`）、`/showcase`（只留作品）、`/showcase/photos`（**308** → `/gallery` 且保留合法参数）、旧手机深链 `?phone=showcase&screen=photos|album`（客户端转发 → 图库）全部真实可用 |
| 导航意图 | `intent="enter-showcase"` 只由主动进入殿堂边界产生；顶部「作品」、地图上野三入口、手机桌面殿堂图标、首页 CTA / 外部作品详情入口各播一次异世界短过场；`/showcase/photos` 与图库旧地址**不**产生意图（浏览器实测 `isekai=0`） |
| 图库来源模型 | `album_media_sources`（`moment_id IS NULL`=独立收录 / 非空=动态收录）行为按 §4.4–4.6 实测：配置≠公开资格；纯动态来源撤回后照片墙隐藏 + 媒体变体 404、重发恢复；独立来源在动态撤回后继续可见；草稿相册不公开、发布后自动出现 |
| 管理写接口 | `POST/PATCH /api/v1/admin/moments` 的 `album_links` 三态（不传保留 / `[]` 清空 / 非空完整替换）；409（非法媒体 / 非法相册）、412（旧版本）、428（缺 If-Match）行为与错误信封实测一致；重复提交不产生重复来源 |
| 数据库迁移 | 单一 head `b7c3e9a1d2f4`；`528a38f23614 → b7c3e9a1d2f4` 升级把迁移前全部相册图片回填为独立来源；降级会删除无独立来源的显示关系（N3 已声明的限制）；再升级回填幂等、动态来源不复活（详见 §7.3） |
| 素材 | 无新增；复核 N6 的公开目录 / 构建产物 / 浏览器实际下载（117 个 `/assets` 文件）无明智素材，`crow.webp`/`band-halftone.jpg` 404，crowd 12/12 哈希一致，短版 `isekai-showcase.webm` 242,439 B / SHA-256 `a716f8e8…` |

---

## 4. 与其他 agent 的依赖和共享文件集成情况

| 任务 | N7 验收结论（本报告证据） | N 报告坦白缺口 → N7 是否补上 |
| --- | --- | --- |
| N0（共享契约） | 契约测试全绿（942 后端 / 919 前端全量含 N0 契约用例）；浏览器行为（意图优先级、1.5s 夹取、手机完成信号、跳过）实测符合 | 补齐：真实浏览器证据 |
| N1（导航 / 地图 / `/posts`） | 五栏目 + 副标题、桌面/390/320 同配置、天气不在一级、12 个内容路径高亮、13 个地图开放点三入口一致 + 上野三入口过场、`/#posts`/`/#archive` 落点、`/posts` 搜索/分类/归档 ✅ | **补齐 N1 未完成的真实浏览器客户端交互**（N1 曾误判 hydration 失败；本环境 hydration 正常，全部客户端交互已实测） |
| N2（手记存档式） | 真实种子数据下：存档列表 8 条、编号 01–08、预览、长标题/长正文、键盘（↓/Home/Enter）、读取正文、返回恢复 No.02、日历屏按日定位、私密/草稿不泄露（页面 + 直接地址 404）、跨时区日期一致 ✅；**视觉还原仍为「未通过」**（完整存档整屏参考帧缺失，N2 已声明，N7 无法替代） | 补齐：**真实内容**验收与浏览器行为；视觉缺口如实保留 |
| N3（图库后端） | 全量 pytest 942 passed（含 gallery/moments/media 定向与迁移同步/openapi 契约）；N3 旧验收脚本在隔离 PG 上 `exit 0`（33 项断言全通过）；N7 迁移复验 15/15 ✅ | 补齐：独立复验 + 迁移升/降/再升手工证据 |
| N4a（图库前端 / 旧深链） | `/gallery` 三视图、年份/类型筛选、灯箱、真实图片解码、旧 `/showcase/photos` 308（5 组参数用例）、旧手机照片/相册深链、不误播殿堂过场、殿堂无照片展区 ✅ | 补齐：真实构建 + 真实 API 的浏览器证据（N4 当时只有 mock fixtures + 空库） |
| N4b（INS 收录联动） | 管理端 E2E（真实 HTTP + 隔离 PostgreSQL）：`album_links` 三态、草稿/公开组合、撤回→隐藏/404→重发恢复、独立来源对照、412/428/409、幂等、无半完成 ✅；前端管理界面（登录后台表单）的浏览器 E2E **未做**（见 §8 未完成项） | 补齐：**隔离 PostgreSQL 上的管理端 E2E**；管理 UI 浏览器操作如实标未做 |
| N5（殿堂短过场） | 顶部作品 / 地图上野三入口 / 手机图标 / 首页 CTA / 外部作品详情入口各一次；时长 1.5s（实测 commit 1557ms、视频 duration 1.5、静音、playing）；跳过 62–64ms、≥44px；连点 3 次只播 1 次；殿堂内部/刷新/直接地址/历史前后不重播；减少动效 67ms 直达；媒体拦截时斜切兜底 514ms 无残留；无 crowd/joker 串播；音乐元素同一实例；390/320 可用 ✅ | 补齐：fresh build 下四类入口全链路浏览器证据 |
| N6（素材） | 静态 7/7 PASS（公开目录 370 文件、构建产物 2561 文件）；浏览器实际下载 117 个 `/assets` 文件无明智、被移除 2 URL 404、platinum 封面正常、crowd 12/12；`posts.json` 中角色文字提及保留 ✅ | 补齐：在 N7 pinned fresh build 上复跑两个脚本 |
| 外部并行第二轮会话（P6） | 其在 `features/phone/**`、`features/ins/**`、`features/journal/**`、`features/showcase/project-card.tsx` 的提交只读纳入验证；N7 的最终证据固定在其 `9384f29` 快照上（其后仅 docs/工具提交） | 风险：见 §8.1（最终集成需冻结后重跑） |

**共享文件 / 热点**：N7 未与任何人争用写入 —— 未改 `features/phone/**`、`features/runtime/**`、`app/globals.css`、`package.json`、`apps/api/**`。唯一写入在任务允许的验收工具/证据范围内。

---

## 5. 所用素材来源、游戏版本、哈希与处理范围

N7 **不新增、不修改任何素材**，只复核 N6/N5 的结果：

| 复核项 | 结果 | 证据 |
| --- | --- | --- |
| 公开目录 / 构建输入无含明智原文件哈希 | PASS（扫描 370 文件） | `tools/acceptance/verify-no-akechi-assets.py` 第 1 项 |
| 点名路径移除 | PASS：`/assets/legacy/img/icon/crow.webp`、`/assets/legacy/img/band-halftone.jpg` HTTP **404** | 静态脚本第 2 项 + 浏览器下载脚本 |
| 明智别名文件名 / 运行时引用 | PASS（`crowd` 放行） | 静态脚本第 3/4 项 |
| 替换资源哈希 | PASS：`icon/mementos.webp` `d0de74b6…`、`cover/platinum.jpg` `394c37ce…`、`app/coop.png` | 静态脚本第 5 项 |
| crowd 人群过场 | PASS：12/12 精灵哈希与 `provenance.json` 一致；浏览器实测地图其他目的地仍播人群过场 | 静态脚本第 6 项 + `n7-browser-report.json` |
| 生产构建产物 | PASS：2561 个产物文件无被移除文件名引用（跳过 377 个 source map） | 静态脚本第 7 项（`.next` 为 pinned HEAD fresh build） |
| 浏览器实际下载 | PASS：7 个页面、**117 个 `/assets` 文件**逐一校验无明智；`problems=[]` | `verify-no-akechi-downloads.py` + `.dsh/screenshots/n6-download-evidence.json` |
| 殿堂短版媒体 | `/assets/clip/isekai-showcase.webm` HTTP 200，242,439 B，SHA-256 `a716f8e835eb9373639648a72a7fba3529ec99ed8bb623d24cf48b868a91ccb7`（与 N5/N6 登记一致；浏览器实测 duration=1.5s、muted、无音频串扰） | 静态脚本第 8/INFO 项 + 浏览器过场用例 |
| 三份清单与允许清单完整性 | `docs/design-references/persona-assets-{allowlist,excluded,removed}.md`、`persona-assets-manifest.csv`、`persona-curated-plan.md` 均在；`posts.json` 保留「明智」文字提及（未无关删除） | 文件存在性检查 + `grep -c 明智` |

**合规边界**：验收截图只截站点公开界面（无角色立绘特写）；本报告与证据不嵌入被排除角色图片。

---

## 6. 改前 / 改后截图

N7 是验收角色，不产生产品「改前/改后」对照；改前/改后由 N1/N2/N4/N5/N6 各自报告提供（`docs/agent-deliveries/N*-result.md` §6）。N7 提供的是 **pinned HEAD fresh build 上的现状证据**，共 **40 张**，全部在 `/Users/学习/blog/Blogs/.dsh/screenshots/`：

| 类别 | 文件 |
| --- | --- |
| 顶部导航 / 视口 | `n7-nav-home-desktop.png`、`n7-nav-home-390.png`、`n7-nav-home-320.png` |
| 文章索引 | `n7-posts-list-desktop.png`、`n7-posts-archive-desktop.png`、`n7-responsive-posts-390/320.png` |
| 地图 / 上野三入口过场 | `n7-map-ueno-图标-mid.png`、`n7-map-ueno-「出发」-mid.png`、`n7-map-ueno-列表-mid.png`、`n7-responsive-map-390/320.png` |
| 图库三视图 / 灯箱 / 旧区手机深链 | `n7-gallery-wall-desktop.png`、`n7-gallery-albums-desktop.png`、`n7-gallery-album-scope-desktop.png`、`n7-gallery-lightbox-desktop.png`、`n7-gallery-legacy-phone-photos.png`、`n7-gallery-legacy-phone-album.png` |
| 殿堂 / 短过场 | `n7-transition-topnav-mid.png`、`n7-transition-phone-icon-mid.png`、`n7-transition-phone-after.png`、`n7-transition-390-mid.png`、`n7-transition-320-mid.png`、`n7-showcase-390/320.png`、`n7-responsive-showcase-390/320.png` |
| 手记 | `n7-journal-save-desktop.png`、`n7-journal-reading-desktop.png`、`n7-journal-calendar-desktop.png`、`n7-responsive-journal-390/320.png` |
| 补充（生活/关于/文章/INS） | `n7-extra-leblanc-desktop.png`、`n7-extra-about-desktop.png`、`n7-extra-post-detail-desktop.png`、`n7-extra-ins-desktop.png` |
| 其他视口 | `n7-responsive-home-390/320.png`、`n7-responsive-gallery-390/320.png` |

截图条件：Chromium headless（`device_scale_factor=2`），桌面 1280×900 / 390×844 / 320×844；均为 **pinned HEAD `9384f29` 的 fresh 生产构建 + 隔离 API 的真实种子数据**，不是 mock、不是 dev 服务器。

---

## 7. 测试命令和实际结果；功能 / 视觉 / 真机 / 迁移 / 资源分别判定

### 7.1 集成回归（pinned HEAD `9384f29`，工作区仅 N7 两个未跟踪工具脚本）

| # | 命令 | 执行目录 | 退出码 | 实际结果 |
| --- | --- | --- | --- | --- |
| 1 | `npm run test -- --run` | `apps/web` | **0** | **88 files / 919 tests passed**（0 failed / 0 skipped） |
| 2 | `npm run typecheck` | `apps/web` | **0** | 无输出（`tsc --noEmit` 通过） |
| 3 | `npm run lint` | `apps/web` | **0** | 无 error / warning |
| 4 | `API_INTERNAL_URL=… DEV_API_URL=… DEV_LEGACY_STATIC_URL=… npm run build`（先 `pgrep -f "next build"` 确认无并发构建） | `apps/web` | **0** | `✓ Compiled successfully`；`✓ Generating static pages (34/34)`；路由含 `ƒ /posts`、`ƒ /gallery`、`ƒ /showcase/photos` 等 |
| 5 | `TEST_DATABASE_URL=postgresql+psycopg://pl@127.0.0.1:55440/pl_test_n7 uv run pytest` | `apps/api` | **0** | **942 passed, 0 failed, 0 skipped, 1 warning in 37.22s**（warning 为第三方 `StarletteDeprecationWarning`，与改动无关；无 skip 冒充通过） |
| 6 | `uv run alembic heads` | `apps/api` | **0** | 单一 head `b7c3e9a1d2f4` |

> 说明：第 5 项使用 N7 自建隔离集群（55440）；因共享集群 55432 被并行会话停启（见 §1.3），若继续使用会把环境事故误记成产品失败。后端当时与共享基线一致（`git diff --name-only e02dec6..HEAD -- apps/api` 无变化）。

### 7.2 浏览器验收（pinned fresh build + 隔离 API + 真实种子数据）

```bash
cd apps/web
python3 tools/browser-verification/verify-round3.py --base http://127.0.0.1:3107
python3 tools/browser-verification/verify-round3-supplement.py --base http://127.0.0.1:3107
```

| 套件 | 结果 | 报告 |
| --- | --- | --- |
| 主套件（§8.1 / §8.2 末行 / §8.4 + 320/390） | **118 / 118 PASS**（0 failed；36 张截图；耗时 335.6s） | `.dsh/n7/browser-report.json` |
| 补充套件（§8.1 剩余项） | **11 / 11 PASS**（4 张截图） | `.dsh/n7/browser-supplement-report.json` |
| 完整日志 | `PASS` 行与失败原因逐条 | `.dsh/n7/logs/browser-final-pinned.log` |

覆盖要点（摘要）：五栏目 + 副标题（桌面/390/320 同配置、无天气项、Logo 回首页、12 条路径高亮、`/#posts` `/#archive` 落点）；`/posts` 搜索「雪国」1 条、TECH 2 条、归档视图与直达 `?view=archive`；地图 13 开放点 + 13/13 三入口一致 + 12 未开放无假入口 + 上野三入口各播一次 isekai（1.75s / 1.57s / 2.47s，均 `kind=isekai, crowd=0, joker=0`）+ 其他目的地 crowd；`/gallery` 墙 7 张去重、年份/类型筛选、灯箱、相册 3 个（草稿不出现）、相册内 4 张、旧 `/showcase/photos` 308 ×5、旧手机照片/相册深链落图库且 `isekai=0`；殿堂短过场全链路（含跳过 62ms、连点 1 次、减少动效 67ms、媒体失败斜切兜底 514ms、内部/刷新/历史不重播、音乐同一元素）；手记存档式全流程；390/320 六页面无横向溢出。

### 7.3 迁移复验（独立 scratch 库，用后 drop）

```bash
cd apps/api
UV_CACHE_DIR=… uv run python ../../.dsh/n7/verify_migration.py
```

结果：**15 / 15 PASS**；数据库 `pl_test_n7_mig_25140`，结束即 drop。关键数据：

| 阶段 | 断言结果 |
| --- | --- |
| 升到 N3 前 `528a38f23614` | 造历史数据：albums=2 / album_media=3 / moments=1；来源表不存在 |
| 升级 `b7c3e9a1d2f4` | 3 条历史关系 100% 保留（排序 / alt / caption / taken_on 逐项一致）；`album_media_sources` = 3 且全部 `moment_id IS NULL`（独立来源回填）；缺来源关系 = 0；**单一 head** |
| 混合来源 | 3 独立 + 2 动态来源；无缺来源关系 |
| 降级 `528a38f23614` | 成功；来源表消失；**无独立来源的纯动态显示关系被删除**（3 条历史关系保留）；alembic current 正确 |
| 再升级 head | 回填幂等（3 独立来源）；动态来源不复活；关系数 3 |
| 权限断言（用 N3 唯一实现 `public_media_ids` / `public_album_exists_for_media`） | 独立来源图片公开可见 = true；降级后遗留的纯动态图片不再公开 = false/not in public ids |

### 7.4 图库收录生命周期 E2E（真实 HTTP + 隔离 PostgreSQL）

```bash
cd apps/api && UV_CACHE_DIR=… uv run python ../../.dsh/n7/verify_album_lifecycle.py
```

结果：**34 / 34 PASS**（脚本自建自清，公开投影从 7 张回到 7 张、3 个公开相册不变；本轮新建图片全部不再公开）。覆盖：

- 相册公开后移除图片 → 建仅动态来源的动态 → **草稿阶段不公开**（管理端配置可见）→ 动态发布后进入照片墙（7→8）且媒体变体 200 → 撤回动态 → 隐藏且媒体 **404**（7）→ 配置保留 → 重发恢复（8）；
- 独立来源 + 动态来源并存 → 动态撤回后图仍可见（不是按 media_id 一刀切）；
- 公开动态 + 草稿相册 → 图库不公开、不自动发布相册 → 相册发布后自动出现（10）；
- `album_links` 不传保留 / `[]` 清空 / 相同配置重复提交无重复来源；非法媒体 409、无效相册 409、旧版本 412、缺 If-Match 428、失败无半完成状态。

### 7.5 §8.2 生命周期矩阵（任务书表格逐行）

| 用例 | 结论 | 证据 |
| --- | --- | --- |
| 历史相册图片迁移 | ✅ 保留图片/排序/说明/公开范围，成为独立来源 | §7.3 迁移复验 |
| 草稿动态＋公开相册，仅动态来源 | ✅ 不公开；管理端可看配置 | §7.4 |
| 公开动态＋草稿相册 | ✅ 图库不公开；不自动发布相册 | §7.4 |
| 动态与相册都公开 | ✅ 图片出现；重复提交无重复关系 | §7.4 + `test_moment_album_links.py` |
| 多相册同图 | ✅ 全局墙仅一张（7 张去重、media_id 无重复）；主要归属稳定 | 浏览器 + 种子自检 + `test_wall_sources.py` |
| 不传 `album_links` | ✅ 原选择保留；换图失效来源清理 | §7.4 + 后端用例 |
| 传空数组 | ✅ 清空本动态选择，其他来源不影响 | §7.4 |
| 唯一动态来源撤回/删除 | ✅ 停止展示、不删媒体；最后公开引用失效媒体 404 | §7.4 + N3 脚本 |
| 还有独立或其他公开动态来源 | ✅ 同相册图片仍可展示 | §7.4（独立来源对照） |
| 重新发布 | ✅ 只恢复保留配置；移除的不复活 | §7.4 + N3 脚本 |
| 相册侧单图/整组移除 | ✅ 同步清理动态配置；重发不加回 | N3 脚本第二段全通过 |
| 相册撤回后重发 | ✅ 公开投影随状态变化、媒体与配置正确 | `test_album_unpublish_then_republish…`（pytest 942）|
| 非法媒体/相册、旧版本并发、事务失败 | ✅ 409/409/412/428，无半完成 | §7.4 |
| 前端去新建相册再返回 | ⚠️ 未做浏览器管理 UI E2E（N4b 单测覆盖；N7 未登录后台操作表单） | 见 §8.2 |
| 旧页面和手机照片深链 | ✅ 308 带参数落图库；旧手机深链落图库且不触发殿堂过场 | 浏览器主套件 |

### 7.6 其他验收脚本（复跑）

| 脚本 | 结果 |
| --- | --- |
| `tools/acceptance/verify-album-moment-retract.py`（N3 扩展版，自建 `pl_row6` 库 + 临时 uvicorn:8131） | **exit 0，总判定「全部通过」**；第一段（撤回动态但独立相册引用仍可见）与第二段（仅动态同步来源撤回→隐藏/404→重发恢复→相册侧移除→重发不加回）全部 ✓；日志 `.dsh/n7/logs/n3-retract-script.log` |
| `tools/acceptance/verify-no-akechi-assets.py` | **PASS：7 项检查全部通过**（公开目录 370 文件 / 构建产物 2561 文件 / crowd 12/12） |
| `tools/acceptance/verify-no-akechi-downloads.py --base-url http://127.0.0.1:3107` | **PASS**：浏览器实际下载 117 个 `/assets` 文件无明智；2 个被移除 URL 404；platinum 封面正常；crowd 12/12；证据 `.dsh/screenshots/n6-download-evidence.json` |
| 普通入口仍 Joker 补充探针 | `/about` → 点顶部「地图」：过场中 `.jk.on=true`、`navigation.kind="joker"`、落 `/map`（日志 `.dsh/n7/logs/joker-probe.log`） |

### 7.7 §8 清单逐条判定

#### §8.1 导航、内容与手记

| 条目 | 功能 | 视觉 | 证据 |
| --- | --- | --- | --- |
| 顶部五栏目及副标题正确，移动端同配置，天气不再一级栏目 | ✅ | ✅（截图看五项排布，未与原版逐帧比对） | 浏览器：5 项文本/href 完全匹配；390/320 同一份 DOM；`.hud-nav` 无 weather；`/weather` 200 |
| 文章 / 生活 / 作品子页面高亮正确；Logo、关于页 COOP、生活留言入口可用 | ✅ | ✅ | 浏览器：12 条路径 `aria-current` 归属；Logo `/`；关于页 COOP 链接；生活页留言入口 |
| 13 个开放地图地点映射正确，三入口一致，无具体文章 slug 旧绑定 | ✅ | ✅（地点插画/地名不变；几何未逐像素对比，委托 N1 单测） | 浏览器：13/13 图标/出发/列表 href 完全一致；无 `.html`/slug 绑定；12 个未开放不是 `<a>` |
| 其余地点没有假入口；用途说明清楚，不改变图形与原地名 | ✅ | ⚠️ 视觉未逐像素对照 | 浏览器：12 `.loc.off` 无 href；13 个档案卡 note 非空；地图几何由 `features/legacy/data/map.json` 未改（N1 单测 14 例） |
| `/posts` 搜索、分类、归档可用，首页摘要与旧 `#posts` `#archive` 不断链 | ✅ | ✅ | 浏览器：搜索 1 条 / TECH 2 条 / 归档 `#year-2026` / 直达归档；旧锚点落视口内且区块内有真实入口 |
| 文章、手记、动态用途与发布提示明确，勒布朗只聚合摘要 | ✅ | ⚠️ 文案视觉未评审 | 补充套件：生活页 978 字符摘要 + 5 入口；手记预览「发布与编辑仍在管理端」；文章详情面包屑「情报档案」 |
| 手记完整游戏参考和改前/改后对照；存档列表、预览、读取、日历、返回位置可用 | ✅（功能） | **❌ 未通过**：完整存档整屏参考帧缺失（N2 §6.2 已声明，N7 无法补齐） | 浏览器：8 条真实手记、编号、预览、读取、返回恢复 02、日历按日定位；视觉判定维持 N2 结论 |
| 私密手记不泄露；日期、长标题、长正文、空列表、较多记录、键盘正常 | ✅（空列表仅 jsdom） | ✅ | 浏览器：8 条列表不含私密/草稿；直接地址 404；跨时区日期一致；长标题 71 字符完整 + 无横向溢出；键盘 ↓/Home/Enter；空列表状态由 `journal-view`/`save-screen` 单测覆盖（N7 种子数据各年份均有记录，浏览器未构造空列表） |

#### §8.2 图库与收录生命周期矩阵

见 §7.5（逐行证据）。唯一缺口：**前端管理界面浏览器 E2E 未做**（`album_links` 编辑表单在登录后台；N7 用真实管理 HTTP 端点 + 隔离库验证了契约与事务，未在浏览器里填表单）。

#### §8.3 素材

| 条目 | 状态 | 证据 |
| --- | --- | --- |
| 活动库、默认索引、开发预览、公开目录、实际网络下载均无明智 | ✅（公开目录/构建产物/下载；默认参考入口仍指向旧库属 N6 已声明缺口） | 两个 N6 脚本在 pinned build 上 PASS |
| 多人图/合图/动画/视频/书籍提取有画面复核记录；不确定未进允许清单 | ✅（记录完整；N7 复核清单存在与哈希一致性，不重复主观画面复核） | 三份清单 + manifest.csv |
| COOP、印象空间 `crow.webp` 引用替换；旧源图/副本/缩略图不再被构建带回 | ✅ | 静态脚本第 2/4/5/7 项 |
| crowd 人群过场仍完整可用 | ✅ | 12/12 哈希 + 浏览器地图其他目的地 crowd 过场 |
| 原始采集包离线、移除可恢复；排除清单无角色图片；文字提及未删 | ✅ | `persona-assets-removed.md` / `excluded.md`；`posts.json` 保留文字提及 |
| 新图标映射、来源、哈希、处理范围、许可状态与恢复清单完整 | ✅ | `docs/design-references/**` 清单齐全 |

#### §8.4 过场与跨设备

| 条目 | 状态 | 证据 |
| --- | --- | --- |
| 顶部作品、地图三入口、手机图标、外部作品详情入口各播一次短过场 | ✅ | 浏览器：5 类入口均 `kind=isekai`、各 1 次、`crowd=0 joker=0`；1.5s 视频 |
| 殿堂内部切换/回列表/展开不重播；图库旧地址不误判 | ✅ | 浏览器：内部点导航/换作品 `isekai=0`；`/showcase/photos`、旧手机深链 `isekai=0` |
| 手机目标提交可结束过场，之后仍在斜屏 App 内，音乐连续 | ✅（音乐连续性=同一 audio 元素且数量 1→1；斜屏外观截图确认） | 浏览器：`?phone=showcase`、`.pw-wrap.on`、过场收起；`__firstAudio` 同一实例 |
| 默认约 1.5 秒（1–2 秒）；跳过、连点、取消、播放失败、未就绪兜底可用 | ✅ | 浏览器：视频 duration=1.5 / commit 1557ms；跳过 62ms、Escape 已在 N5 单测+浏览器；连点 1 次；拦截媒体→514ms 斜切兜底无黑屏；`ready=false` 兜底 |
| 无三套动画串播；其他地图仍人群，其他普通入口仍 Joker | ✅ | 浏览器：isekai 期间 crowd/joker 计数 0；地图其他目的地 kind=crowd；顶部普通导航 kind=joker（探针） |
| 刷新、直接地址、历史前后、新标签页不自动重播；减少动效不等待视频 | ✅ / ⚠️（新标签页无头环境不可见，仅验证「不拦截原生行为」） | 浏览器：direct/reload/back/forward 计数不变；reduced-motion 67ms 直达；Ctrl/中键：无 preventDefault、无 SPA 导航、URL 不变（headless 不产生可访问新标签页，如实标注） |
| 320px、390px 布局可用；长内容、图片失败、加载、空态、错误均检查 | ✅ 视口；⚠️ 加载/空态/错误主要靠单测与 N4 截图 | 浏览器：6 页面 × 390/320 无横向溢出；长标题/长正文实测；图片真实解码；错误/空态由单测 + N4 报告证据 |
| 真实触控、软键盘、中文输入法、桌面缩放、键盘操作分别有证据；触控目标≥44px | **❌ 真机未验证**；键盘 ✅；跳过按钮 111×44 ✅；软键盘/输入法/桌面缩放未由 N7 验证 | 见 §8.1 未完成项；P6 会话另有 `tools/acceptance/verify-viewports.py` 多视口/缩放档证据（非 N7 独立复跑） |
| 斜屏四角、滑杆两端、底部入口可准确操作；无回退第二轮命中修复 | **❌ 未验证（无真机）** | 属第二轮 P0/P1 真机范围；N7 无触控设备，浏览器模拟不能替代 |

### 7.8 分项状态汇总（不能互相替代）

| 维度 | 状态 | 依据 |
| --- | --- | --- |
| 功能 | **通过**（本报告 §7.1–7.7 所列范围） | 前端 919 tests、后端 942 passed、浏览器 118+11、生命周期 34、迁移 15、N3/N6 脚本 |
| 视觉 | **部分通过 / 有明确未通过项**：导航/地图/图库/过场/320-390 布局自洽且截图留存；**手记「游戏存整屏还原」未通过**（参考帧缺失）；**未做原版逐帧像素比对** | 本报告 §6/§7.7 + N2 §6.2 |
| 真机 | **未验证**：无真实触控设备、无 Safari；软键盘 / 中文输入法 / 桌面缩放未由 N7 验证 | 见 §8.1 |
| 迁移 | **通过**：单一 head、升/降/再升、回填、幂等、权限断言 | §7.3 |
| 资源复核 | **通过**（公开目录 / 构建输入 / 构建产物 / 实际下载 / crowd / 短版哈希） | §5、§7.6 |

---

## 8. 未完成项、已知限制、需要的权限或外部条件、恢复 / 回退说明

### 8.1 未完成 / 未验证（必须保留，不许用「基本完成」替代）

1. **真机触控与移动 Safari 未验证（N7 最大缺口）**：本环境没有真实触控设备。§8.4 的「真实触控、软键盘、中文输入法、桌面缩放、斜屏四角/滑杆两端/底部入口准确操作」以及 N5 的「Safari 对 VP9+alpha 短版解码」均**未验证**；浏览器模拟不能替代真机。若 Safari 不解码 alpha，按 N5 设计会走斜切兜底（不会绿屏/黑屏），但「Safari 用户是否能看到异世界短版」仍未知。
2. **管理端 INS 收录表单的浏览器 E2E 未做**：N7 用真实管理 HTTP 端点 + 隔离 PostgreSQL 验证了 `album_links` 契约、事务、409/412/428 与公开投影（34/34），但没有在浏览器里登录后台、操作「同时收录到相册」表单、走「新建相册后返回草稿」UI 流程；该 UI 由 N4b 单测覆盖。
3. **手记视觉还原未通过**：完整游戏存档整屏参考帧仍缺（N2/N6 已声明），N7 只做功能与自洽性验收，**不宣称视觉还原通过**。
4. **§8.1「空列表」浏览器证据缺口**：N7 种子数据 2024–2026 每年都有记录，未构造「筛选后空列表」的浏览器场景；空态由 `save-screen`/`journal-view` 单测覆盖。
5. **§8.4「新标签页不自动重播」**：headless Chromium 不产生可访问的新标签页（Ctrl+点击只触发 pointerdown/mousedown，middle click 得到 `about:blank`），N7 只能证明「点击未被拦截、本页不发起 SPA 导航」；真实新标签页行为需带界面浏览器/真机。
6. **视觉原版对照**：所有视觉判定为「自洽性 + 截图留存」，除 N2 的明确未通过项外，未做原版参考帧逐像素比对（P5 场景部分参考帧缺失）。
7. **外部并行会话导致的最终集成风险（最重要）**：验收期间外部第二轮/P6 会话持续提交（`e02dec6 → 15fc5f2` 共 27 个提交，含 `features/phone/**`、`features/ins/**`、`features/journal/**`、`features/showcase/project-card.tsx` 等前端改动）。N7 的最终证据冻结在 **`9384f29`**；此后仅 `docs/**` 与新增 `tools/verify-all.sh`（`git diff --name-only 9384f29..HEAD` 无 `apps/**` 代码变化）。**若集成负责人之后继续合并新的前端提交，需要在新 HEAD 冻结后重跑 `verify-round3.py` / 全量测试，本报告结论不能自动延续到更新的代码状态。**

### 8.2 已知限制与环境说明

1. **隔离栈**：N7 用自建 PG 集群（55440）+ API 8107 + fresh build 3107 + 只读静态 8009；共享集群 `.dsh/pgtest`（55432）在验收期间被并行会话停启（见 §1.3），N7 未修改共享库，只在恢复后用其跑通 N3 旧脚本。正式判定以 55440 隔离栈为准。
2. **迁移降级限制**（N3 已声明）：`b7c3e9a1d2f4` 降级会删除「没有任何独立来源」的相册显示关系，动态收录配置不可从旧 schema 无损恢复；生产降级前必须备份。N7 的迁移复验仅在 scratch 库进行并已 drop。
3. **测试数据**：真实内容由 `.dsh/n7/seed_data.py` 通过真实管理端点写入 `pl_test_n7_accept`（2 公开相册 + 1 草稿相册 + 1 个仅动态来源相册 + 8 公开手记 + 1 私密 + 1 草稿 + 2 作品 + 2 动态），媒体为现场生成的 PNG，不含游戏素材；该库与种子脚本不在产品构建中。
4. **地图 SVG 图标自动化点击**：Playwright 零延迟 `mouse.click`（move→down→up 同帧）会因 hover 触发 React 重排而丢 click；用「先 hover 停稳再按」的真实人类节奏则正常导航（`.dsh/n7/logs/map-click-timing.log`）。这是自动化时序问题，不是产品缺陷；`verify.py`（T02）点击的是已选中图标所以不受影响。
5. **不把模拟当证据**：浏览器证据均来自真实 Chromium + fresh 生产构建 + 真实 API；凡只有 jsdom 覆盖的条目已在 §7.7 逐条标注。

### 8.3 恢复 / 回退说明

验收本身无产品回退动作（未改业务代码、无迁移施加到共享库）：

```bash
# 停止 N7 隔离服务（不影响其他会话的 3100/8100/3123/55432）
cd /Users/学习/blog/Blogs && .dsh/n7/setup_stack.sh stop

# 停止 N7 自建 PostgreSQL 集群（数据保留在 .dsh/n7/pgdata，可随时再起）
/opt/homebrew/opt/postgresql@18/bin/pg_ctl -D /Users/学习/blog/Blogs/.dsh/n7/pgdata stop
# 临时 55432 空集群（若曾启动）：同样 pg_ctl -D .dsh/n7/pgdata-55432 stop

# 彻底清理隔离验收数据（可选，仅限 N7 自建目录/库）
#   删除数据库 pl_test_n7_accept / pl_test_n7；删除 .dsh/n7/pgdata*、.dsh/n7/media
# 重跑完整验收：
cd /Users/学习/blog/Blogs && .dsh/n7/setup_stack.sh all   # 重建库+种子+API+静态+fresh build+3107
cd apps/web && python3 tools/browser-verification/verify-round3.py --base http://127.0.0.1:3107
```

N7 新增的两个浏览器脚本是**未跟踪文件**，集成时是否入库由 N0/Lead 决定（任务约束禁止 N7 自行 commit）。

---

## 附录 A · 证据文件索引

| 类别 | 路径 |
| --- | --- |
| 浏览器主报告（118 checks） | `.dsh/n7/browser-report.json` |
| 浏览器补充报告（11 checks） | `.dsh/n7/browser-supplement-report.json` |
| 迁移报告（15 checks） | `.dsh/n7/migration-report.json` |
| 图库生命周期报告（34 checks） | `.dsh/n7/album-lifecycle-report.json` |
| 种子数据摘要 | `.dsh/n7/seed-summary.json` |
| 日志（测试/构建/lint/类型/浏览器/迁移/素材/环境事故） | `.dsh/n7/logs/`（`web-test.log`、`web-build.log`、`web-typecheck.log`、`web-lint.log`、`api-pytest-full.log`、`browser-final-pinned.log`、`n3-retract-script.log`、`joker-probe.log`、`map-click-timing.log`、`pg-*.log`） |
| 截图（40 张） | `.dsh/screenshots/n7-*.png`、`.dsh/screenshots/n6-*.png`（素材复验） |
| 可复跑工具 | `apps/web/tools/browser-verification/verify-round3.py`、`…-supplement.py`、`.dsh/n7/{setup_stack.sh,seed_data.py,verify_migration.py,verify_album_lifecycle.py}` |
| 任务书 | `/Users/v/Documents/ChatGPT/Blog开发/docs/superpowers/plans/2026-10-17-p5-content-v3-agent-handoff.md` |

## 附录 B · 最终判定一句话

**在冻结基线 `9384f29`（fresh 生产构建 + 隔离 PostgreSQL/API 栈）上，第三轮 N1–N6 的功能与数据契约验收全部通过**（前端 919 / 后端 942 / 浏览器 118+11 / 生命周期 34 / 迁移 15 / N3 与 N6 脚本全通过）。
**视觉：除「手记完整游戏存档还原」明确未通过外，其余为自洽性通过并留档；真机触控与 Safari：未验证；管理端 INS 收录表单的浏览器 E2E：未做。**
**外部并行会话仍在写入，最终上线前需在冻结 commit 上重跑本报告附录 A 的命令。**
