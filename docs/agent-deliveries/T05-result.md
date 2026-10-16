# T05 · 交付单（手记、追番游戏与勒布朗近况）

```text
任务：T05 / 手记、追番游戏与勒布朗近况
状态：implemented_waiting_integration —— 代码、测试与真实浏览器验收（93 项）全部跑通；
      模型 / 路由 / 迁移 / wiring / 手机 manifest 由集成负责人接线（见 §8），
      故本单只主张「模块可用」，不主张「已接线可用」。
基线：main @ 0eae9fd（派发 T05 / T07 的提交）
      开始时 `git status --short` 只有一条不属于本包的 M（apps/web/tests/helpers/browser.ts）
      与 T03 的在途未跟踪目录；本轮未提交、未推送、未建分支 / worktree、未启动子 agent
外部影响：未调用任何模型或付费服务；未部署；未写共享测试库 `pl_test`
          （验证只用自建 `pl_test_t05`，夹具结束即 drop，本轮零残留）
```

## 1. 本轮范围

**已完成**

| 组 | 内容 |
| --- | --- |
| 手记模型 | `journal_entries` + `journal_entry_media`：日期是 `date`（不是 timestamptz）、发布状态与可见性**两个独立列**、新建默认 draft + private、图片有序关系（position 连续唯一、alt 1–200 码点）、可选长文关系 |
| 手记公开 API | `GET /journal/entries`、`GET /journal/entries/{id}`、`GET /journal/calendar`（只聚合真正公开的记录，返回展示时区与「今天」） |
| 手记管理 API | `/admin/journal/entries` 的列表 / 详情 / 新建 / 更新 / 发布 / 撤回 / **切可见性** / 软删除（站主 + CSRF + `If-Match`） |
| 放课后模型 | `leisure_entries`：追番与游戏**共用一张表**，分类型进度枚举、可空评分、剧透标记、可空总集数 / 时长、通关与全成就**两个独立字段**；跨类型字段由数据库 CHECK 拒绝 |
| 放课后公开 API | `GET /leisure/entries`（kind / progress / 游标）、`GET /leisure/entries/{id}` |
| 放课后管理 API | `/admin/leisure/entries` 的列表 / 详情 / 新建 / 更新 / 发布 / 撤回 / 软删除 |
| 共享扩展点 | `journal/public_refs`、`leisure/wiring` 各提供一个媒体公开引用检查（**默认拒绝**注册表；不登记则公开配图对匿名 404） |
| 前端手记 | `features/journal/`：存档卡列表（按年筛选）、只标记真实公开日期的日历、正文页、手机内置应用、独立页宿主、管理端（新建 / 编辑 / 发布 / 切可见性 / 软删除 / 公开预览 / `shared_media` 提示） |
| 前端放课后 | `features/leisure/`：两个页签共用一组端点、状态与评分筛选、剧透折叠、进度条（只在总数已知时画）、手机应用、独立页宿主、管理端（按类型切换字段） |
| 勒布朗 | `features/leblanc/leblanc-view.tsx`：一句近况 + 最近公开手记 + 正在追 / 正在玩 + **现有音乐控制**（读根布局唯一的 `<audio>`）+ 留言等普通链接；四块**各自读取、各自失败** |
| 勒布朗独立入口 | `/apps/leblanc`（首页仍属 T02；接线申请见 §8） |
| 验证工具 | `features/journal/tools/verify-t05.py`（Playwright，93 项检查，含真实管理写入与失败隔离） |

**未完成 / 不在本包**：AI 角色会话（T08）、留言板重写、天气数据源、公开评论、INS 相册关系（T06）、
状态更新自动生成 INS 草稿（任务卡「不做」，明确留作后续独立连接）、第三方同步（07 §3 明确不做）。

## 2. 文件

**新增（本包独占）**

```text
apps/api/app/modules/journal/
  __init__.py  models.py  schemas.py  service.py  router.py  public_refs.py  wiring.py
apps/api/app/modules/leisure/
  __init__.py  models.py  schemas.py  service.py  router.py  rules.py  wiring.py
apps/api/app/modules/t05_dev_app.py
  本地验证入口：生产 app + 补挂尚未登记的 T05 路由（集成后请删除，见 §8.7）
apps/api/tests/journal/
  __init__.py conftest.py helpers.py
  test_privacy.py（11）test_public_journal.py（15）test_admin_journal.py（13）
  test_t05_integration_contract.py（9）
apps/api/tests/leisure/
  __init__.py conftest.py helpers.py
  test_progress_semantics.py（22）test_public_leisure.py（13）test_admin_leisure.py（13）
apps/web/features/journal/
  types.ts paths.ts api.ts failure.ts host.ts state.ts inflight.ts journal.module.css
  entry-card.tsx calendar-panel.tsx journal-view.tsx entry-reading.tsx entry-reading-loader.tsx
  phone-app.tsx standalone.tsx
  admin/journal-workspace.tsx
  tools/verify-t05.py
  paths.test.ts（15）api.test.ts（13）journal-view.test.tsx（11）
apps/web/features/leisure/
  types.ts paths.ts api.ts failure.ts host.ts state.ts inflight.ts leisure.module.css
  entry-card.tsx leisure-view.tsx phone-app.tsx standalone.tsx
  admin/leisure-workspace.tsx
  paths.test.ts（14）leisure-view.test.tsx（13）
apps/web/features/leblanc/
  leblanc-view.tsx leblanc.module.css leblanc-view.test.tsx（7）
apps/web/app/apps/journal/page.tsx
apps/web/app/apps/journal/[id]/page.tsx
apps/web/app/apps/leisure/page.tsx
apps/web/app/apps/leblanc/page.tsx
apps/web/app/admin/journal/page.tsx
apps/web/app/admin/leisure/page.tsx
docs/agent-deliveries/T05-result.md
```

**未改动（所有权红线，逐条核对过）**：`app/{main,router,model_registry}.py`、`app/core/**`、
`app/modules/{auth,media,tags,posts,nav,moments}/**`、`app/commands/**`、`migrations/**`、
两个锁文件、`apps/web` 的全部根配置（`package.json` / `tsconfig` / `next.config.ts` / `eslint` /
`vitest`）、`features/phone/registry.ts`、`features/{runtime,phone(除 registry),legacy}`、
`app/{layout,globals.css,page,about,map,weather,guestbook,posts,healthz}`、`components/`、
`lib/api/`、`styles/`、`tests/*`、`tools/`、`public/`、`deploy/`、`contracts/`，
以及其它包的在途目录（`features/{ins,metanav,coop,messaging,showcase,gallery,velvet,exploration}`、
`modules/{gallery,projects,messaging}`、`app/apps/{ins,metanav,coop}` 等）。

唯一「看起来像越界」的一处不是：`features/metanav/admin/session.tsx` 被我的两个管理页**导入**
（T04 故意把 `useAdminSession` / `describeWriteFailure` / 未登录提示做成可复用的管理端共用件，
它自己的交付单写明「管理端共用」）。只读引用，未修改该文件。

## 3. 模型清单与迁移意图（请 T00 生成迁移）

| 模块 | 表 | 关键约束（数据库级） |
| --- | --- | --- |
| journal | `journal_entries` | `ck_journal_entries_status_valid`（draft/published）、`ck_journal_entries_visibility_valid`（private/public）、`ck_journal_entries_version_positive`、`ck_journal_entries_title_length`（≤200 码点）、`ck_journal_entries_content_length`（≤20000 码点）、FK `post_id`→posts ON DELETE **SET NULL**；`ix_journal_entries_public_calendar`（**部分索引**：`status='published' AND visibility='public' AND deleted_at IS NULL`，键 `entry_date, id`）、`ix_journal_entries_date` |
| journal | `journal_entry_media` | 复合主键 `(entry_id, media_id)`；`uq_journal_entry_media_entry_id_position`；`ck_journal_entry_media_position_range`（0–8）；`ck_journal_entry_media_alt_length`（1–200 码点）；双 FK ON DELETE CASCADE / RESTRICT；`ix_journal_entry_media_media_id` |
| leisure | `leisure_entries` | `ck_leisure_entries_kind_valid`（anime/game）、`ck_leisure_entries_status_valid`（draft/published）、`ck_leisure_entries_version_positive`、**`ck_leisure_entries_progress_matches_kind`**（分类型进度枚举）、`ck_leisure_entries_rating_range`（null 或 1–10）、`ck_leisure_entries_total_episodes_non_negative`、`ck_leisure_entries_episodes_watched_non_negative`、`ck_leisure_entries_playtime_non_negative`、`ck_leisure_entries_title_length`（≤200）、`ck_leisure_entries_notes_length`（≤1000）、**`ck_leisure_entries_game_has_no_anime_fields`** / **`ck_leisure_entries_anime_has_no_game_fields`**（跨类型字段拒绝）、**`ck_leisure_entries_episodes_within_total`**（仅总数已知时约束）；FK `cover_media_id`→media SET NULL、`review_post_id`→posts SET NULL；`ix_leisure_entries_public_listing`（部分索引：`status='published' AND deleted_at IS NULL`，键 `kind, updated_at, id`） |

**迁移影响**：三张新表 + 5 个索引；**不修改任何既有表**，没有数据回填。
`journal_entries.post_id` 与 `leisure_entries.review_post_id` 依赖 `posts`，`*_media_id` 依赖 `media`，
因此 `MODEL_MODULES` 里两条新路径请放在 `app.modules.posts.models` 之后。

**回退限制**：`downgrade` 会连带删掉日记与娱乐记录（内容），不是纯 schema 回退 —— 生产环境请先备份。

**交叉证据**：`tests/journal/conftest.py` 先跑 `alembic upgrade head`、再 `Base.metadata.create_all` 补齐缺失表。
本轮实测 `created_by_fallback = ['journal_entries', 'journal_entry_media', 'leisure_entries']`
（集成前迁移里还没有这三张表，属预期）；一旦迁移落库，用例会自动改用真实迁移建出的表，
且 `create_all(checkfirst=True)` 不会修改已存在的表 —— 表结构不对会因为缺列 / 缺约束而失败，
不会被夹具悄悄修好。`tests/journal/test_t05_integration_contract.py` 从 `information_schema` 核对
`entry_date` 是 `date`、`published_at` 是 `timestamp with time zone`、约束名真实存在。

## 4. 契约增量

### 4.1 路由（前缀由 T00 登记，模块内部自己组合两条前缀，与 media / nav 相同）

| 方法与路径 | 权限 | 说明 |
| --- | --- | --- |
| `GET /api/v1/journal/entries` | 公开 | `year`(1970–9999) / `month`(1–12) / `cursor` / `limit`（默认 12、最大 30）→ `{items, next_cursor}` |
| `GET /api/v1/journal/entries/{id}` | 公开 | 草稿 / 私密 / 已删除 / 未来日期 / 不存在**统一 404 且同形** |
| `GET /api/v1/journal/calendar` | 公开 | `year` / `month` → `{months:[{month,days}], total_entries, timezone, today}` |
| `GET /api/v1/admin/journal/entries` | 站主 | `status` / `visibility` / `cursor` / `limit`（含草稿与私密） |
| `GET /api/v1/admin/journal/entries/{id}` | 站主 | 管理详情 + `ETag: "<version>"` |
| `POST /api/v1/admin/journal/entries` | 站主 + CSRF | 201；**总是 draft + private**（请求体不接受 status / visibility，`extra="forbid"`） |
| `PATCH /api/v1/admin/journal/entries/{id}` | 站主 + CSRF + `If-Match` | 只改出现过的字段；`images` 传入即完整替换；`post_id` 可传 `null` 清空 |
| `POST .../{id}/publish` | 站主 + CSRF + `If-Match` | 缺标题或正文 → 409 `CONFLICT`（带字段级 `fields`） |
| `POST .../{id}/unpublish` | 站主 + CSRF + `If-Match` | 只改状态，保留图片与长文关系与首次发布时间 |
| `POST .../{id}/visibility?visibility=public\|private` | 站主 + CSRF + `If-Match` | **立即生效**（无缓存需要失效） |
| `DELETE .../{id}` | 站主 + CSRF + `If-Match` | 204 软删除（行与图片关系保留） |
| `GET /api/v1/leisure/entries` | 公开 | `kind`(anime\|game) / `progress` / `cursor` / `limit` |
| `GET /api/v1/leisure/entries/{id}` | 公开 | 草稿 / 已删除 / 不存在统一 404 |
| `GET /api/v1/admin/leisure/entries` | 站主 | `kind` / `status` / `cursor` / `limit` |
| `GET /api/v1/admin/leisure/entries/{id}` | 站主 | 管理详情 + `ETag` |
| `POST /api/v1/admin/leisure/entries` | 站主 + CSRF | 201；**总是草稿**（`kind` 创建后不可改） |
| `PATCH /api/v1/admin/leisure/entries/{id}` | 站主 + CSRF + `If-Match` | 只改出现过的字段；可空字段传 `null` 即清空（含「改回未评分」） |
| `POST .../{id}/publish` / `.../unpublish` | 站主 + CSRF + `If-Match` | 发布只要求名称非空 |
| `DELETE .../{id}` | 站主 + CSRF + `If-Match` | 204 软删除 |

### 4.2 本模块定义的、05 未规定的细节（请登记为约定）

1. **日期是日历日期，不是时刻**：`journal_entries.entry_date` 是 PostgreSQL `date`，
   API 传输 `YYYY-MM-DD`；`leisure_entries` 的 `last_watched_on` / `started_on` / `completed_on` 同理。
   因此不存在「UTC 转换错一天」（验收 2）。
2. **展示时区是模块常量 `DISPLAY_TIMEZONE_NAME = "Asia/Shanghai"`**
   （`app/modules/journal/models.py`），`display_today()` 用它算「今天」，**不用服务器本地时区**。
   公开条件里的「日期不晚于今天」与日历响应的 `today` 都取自它。
   若希望它可配置，请 T00 在 `Settings` 加一个带默认值的字段（见 §8.5）。
3. **`post_ref` / `review_ref` 的公开过滤**：公开端点只返回**公开且未删除**的长文引用；
   草稿或已撤回文章的标题与 slug 不出现在公开响应里。管理端点用另一个构造器，能看到草稿关系并带 `public` 标记。
4. **`images` / 图片可用性**：只有 `ready` 且未删除的媒体出现在**公开**响应里；
   管理响应给出全部关系并标 `still_public`，同时用 `shared_media` 列出「仍有别的公开引用」的图片
   （05 §11：切私密不会撤回别的公开引用，管理端必须如实提示）。
5. **图片顺序必须从 0 开始、连续、唯一**（DTO 层 422 + 数据库唯一约束；与 moments 同一规则）。
   上限 9 张。
6. **游标**：手记用 `(entry_date DESC, id DESC)`、放课后用 `(updated_at DESC, id DESC)`；
   都用 `core.pagination` 的不透明游标 + **筛选指纹**（换 year / month / kind / status 复用旧游标 → 400）。
   手记的日期在游标里按**当天 UTC 00:00** 编码，与展示时区无关。
7. **放课后的两套「状态」是两个列**：`progress`（内容语义：在看 / 通关 / 弃坑…，分类型枚举）
   与 `status`（发布状态：draft / published）。合成一个列会让「已发布但在看」无法表达。
8. **通关 ≠ 全成就**：`completed_on` 与 `all_achievements` 完全独立，服务端没有任何互相推导。
9. **总数未知不算完成率**：`anime.completion_ratio` 在 `total_episodes is null`（或 ≤0、或集数未知）时为 `null`；
   `anime.episodes_label` 输出「看到第 6 集」。前端**不画进度条**、不显示百分比（验收 3）。
   `game.playtime_label` 在未填时输出「未记录时长」，不显示 0 小时。
10. **新建默认 draft + private 由服务端强制**（不是前端约定）：新建请求体里没有 `status` / `visibility`，
    带上会被 422 拒绝。
11. **`published_at` 只在首次发布时写入**；撤回与重新发布都不刷新历史时间。
12. **限流**：本包**没有**新增限流（公开读取量与文章列表同级；`nav` 的进程内限流是为匹配 / 搜索设计的）。

### 4.3 环境变量

**无新增**。`DISPLAY_TIMEZONE` 目前是模块常量（见 §4.2 第 2 条）。

## 5. 验证（全部实际执行）

前置：`export TEST_DATABASE_URL="postgresql+psycopg://pl@127.0.0.1:55432/pl_test"`
（开发期只跑本包目录，见 §9.6）。

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `uv run --project apps/api pytest apps/api/tests/journal` | 0 | **48 passed** |
| `uv run --project apps/api pytest apps/api/tests/leisure` | 0 | **48 passed** |
| `uv run --project apps/api pytest apps/api/tests/journal apps/api/tests/leisure` | 0 | **96 passed**（连跑 3 次结果一致） |
| `npm --prefix apps/web run typecheck` | 0 | tsc 无输出 |
| `npm --prefix apps/web run lint` | 0 | 0 error / 0 warning（全仓库） |
| `npm --prefix apps/web run test -- --run` | 0 | **452 passed / 46 files**；其中本包 **73 passed / 6 files**（逐文件求和核对过） |
| `DEV_API_URL=http://127.0.0.1:8100 DEV_LEGACY_STATIC_URL=http://127.0.0.1:8000 npm --prefix apps/web run build` | 0 | 路由表含 `○ /apps/journal`、`ƒ /apps/journal/[id]`、`○ /apps/leisure`、`○ /apps/leblanc`、`○ /admin/journal`、`○ /admin/leisure` |
| `node --test tests/*.test.cjs` | 0 | **53 passed / 0 failed** —— 旧站零回归 |
| `python3 apps/web/features/journal/tools/verify-t05.py` | 0 | **93 passed / 0 failed**，16 张截图（真实 chromium，无 mock） |

### 5.1 真实 PostgreSQL（不是 SQLite，也不写共享库）

`tests/journal/conftest.py` 经共享 helper `tests.core.t01_db.register_temp_database("pl_test_t05")` 登记库名，
用共享的 `create_database` / `drop_database`；`tests/leisure/conftest.py` 复用同一份夹具（一个包一个临时库，不做两份）。

**一处需要集成方知道的夹具细节**：服务层写路径会 `Session.commit()`（05 §4 要求「返回成功即已落库」），
而这会把夹具的外部事务一起提交，`rollback()` 便不再能撤销它。因此夹具在回滚后**再显式清理本包的表**
（`_truncate_t05_tables`，只 TRUNCATE 自己的三张表）。
这个坑是真实踩到的：修好之前 `GET /journal/calendar?month=2` 会多返回一个月（上一个用例提交的数据）。

约束证据（用例断言的是真实约束行为，而不是「模型里写了 CHECK」）：
跨类型字段（追番带 `platform`、游戏带 `total_episodes`）→ `IntegrityError`；
「追番：通关」这种状态 → `IntegrityError`；评分 11 / 0 → `IntegrityError`；
集数超过已知总数 → `IntegrityError`；总数未知时「看到第 6 集」**可以**存；
约束名从 `pg_constraint` 逐个核对，部分索引从 `pg_indexes` 核对定义。

### 5.2 真实服务（uvicorn + 真实 dev 库）

```text
DB      pl_test_t05_dev（本机测试集群 55432；alembic upgrade head + T01 的 import_legacy --apply --no-covers
                         + 手写的真实演示数据 + T05 三张表 create_all 补齐）
API     APP_ENV=dev DATABASE_URL=…pl_test_t05_dev SECRET_KEY=… \
          CORS_ORIGINS=http://127.0.0.1:3100 \
          uvicorn app.modules.t05_dev_app:app --port 8100
        GET  /api/v1/journal/entries            → 200，3 篇（私密与草稿均不在）
        GET  /api/v1/journal/calendar?year=2026 → 2026-10-09/14/16 各 1，timezone=Asia/Shanghai
        GET  /api/v1/journal/entries/<私密 id>   → 404
        GET  /api/v1/journal/entries/<草稿 id>   → 404
        GET  /api/v1/leisure/entries?kind=anime → 3 条；总数未知那条 completion_ratio=null
        GET  /api/v1/leisure/entries?kind=game  → 2 条；通关那条 all_achievements=false、playtime_label=未记录时长
        GET  /api/v1/leisure/entries/<草稿 id>   → 404
WEB     DEV_API_URL=… DEV_LEGACY_STATIC_URL=… npm run build && API_INTERNAL_URL=… npm run start（端口 3100）
        /apps/journal、/apps/leisure、/apps/leblanc、/admin/journal、/admin/leisure → 全 200
```

### 5.3 真实浏览器验收（Playwright + 系统 chromium，93/93）

`apps/web/features/journal/tools/verify-t05.py`。三个时序坑按 T02 / T04 的结论处理：
点击前等 `window.__PHANTOM_DEBUG__` 出现（水合完成）、`#boot` 用 Enter 关掉并等 detached、
判断整页重载用 `performance.timeOrigin` 是否变化。

关键证据（逐条对应验收）：

```text
验收1 公开列表 3 篇；私密标题 / 草稿标题 / 私密正文均不在列表 HTML 里
验收1 公开响应（列表 + 详情）里没有 visibility / version / deleted_at / status / storage_key / private / draft
验收1 私密详情 URL → HTTP 404；草稿详情 URL → HTTP 404；不存在的 id → 404（三者同形）
验收1 直接改库把一篇公开手记切成 private → **下一次请求** 详情 404、列表无它、日历不再计数；
      切回 public → 立即 200（可逆）
验收2 日历只标记 2026-10-09 / 10-14 / 10-16；私密的 10-15 没有标记
验收2 日历没有「隐藏 / 未完成」字样；明确标注 Asia/Shanghai 与 today=2026-10-16
验收2 展示时区当天的手记公开可见（不是被当成未来）；日期渲染为 2026.10 + 周五，没有错一天
验收3 总数未知的卡片显示「看到第 6 集」，**没有进度条**、没有百分比；
      总数已知的卡片(dataset completion=1)才有进度条
验收3 未评分的卡片标「未评分」，不显示 0 分；已评分的显示 9 / 10
验收3 草稿游戏记录不在公开页；通关与全成就分开显示（通关 2026-06-01 + 还没全成就）；未记录时长不显示 0 小时
验收3 公开响应里没有 steam / bangumi 字样（后端用例逐字段断言）
验收4 独立页换屏写进 URL 且 timeOrigin 不变（无整页重载）；刷新与 Back 保持同一屏
验收4 手机桌面不出现未登记的应用（未接入不显示空功能）；手机侧没有第二个音频元素
验收4 Escape 关闭手机（外壳 hidden）；放课后独立页与手记独立页在同一站里共存
验收4 匿名读 / 写管理端点 → HTTP 401
验收5 勒布朗四块渲染；音乐块存在；有留言等普通中文链接
验收5 打开勒布朗不会自动出声（audio.paused === true）、音乐元素唯一
验收5 在浏览器里 abort 掉 /api/v1/{journal,leisure}/ 之后重开：整页仍在、音乐块仍在、
      音乐元素仍唯一、降级块给出明确文案（不是空数据）、普通链接仍可用
验收6 未登录时管理页说明需要登录；真实登录后管理列表含草稿与私密标记
验收6 新建 → 明确提示「已新建为草稿且仅自己可见」；发布 → 设为公开 → 公开入口出现
验收6 撤回为草稿 → 公开入口立即看不到；SQL 核对新建的手记确实落库
验收6 放课后管理端新建游戏记录 → 落库 → 发布后出现在公开页签
响应式 320 / 390px 三个页面横向溢出全部 0px
```

**截图（16 张，绝对路径）**：`/Users/学习/blog/.dsh/screenshots/`
`t05-journal-{desktop,390,320}.png`、`t05-journal-calendar-{desktop,390}.png`、
`t05-leisure-{anime-desktop,game-desktop,390,320}.png`、
`t05-leblanc-{desktop,390,320,degraded}.png`、
`t05-admin-{journal,leisure}-desktop.png`、`t05-admin-flow-public-desktop.png`。

### 5.4 本轮抓到并修掉的真实缺陷（都有回归方式）

1. **`journal_entry_media` 的 relationship 解析不到目标类**（`InvalidRequestError`）：
   带 `position` / `alt` 载荷的显式关联表 + `relationship()` 需要额外映射一个关联对象类。
   服务层本来就按 position 排序直接查表，因此删掉 relationship 并注明理由（不是绕过问题）。
2. **公开详情泄漏草稿长文的标题**：`post_ref_out` 一开始只判「未删除」。
   已拆成 `post_ref_out`（公开：只认 published + 未删除）与 `admin_post_ref_out`（管理：含草稿 + `public` 标记），
   并有专门用例断言草稿标题不出现在公开响应文本里。
3. **`Media.is_ready` 是属性不是方法**：`media.is_ready()` 直接 `TypeError` → 500。
   已改为属性访问；`test_cover_must_be_ready` 现在断言的是 409（不是 500）。
4. **`LeisureAdminOut(**base.model_dump(), updated_at=…)` 关键字重复** → `TypeError` → 500。
   已去掉重复传参并在代码里注明。
5. **夹具的事务泄漏**（见 §5.1）：服务层 `commit()` 会提交外部事务，导致上一个用例的数据留在库里，
   表现为「日历多返回一个月」。已加显式清理。
6. **`monthGrid` 末尾没有补齐整周**：最后一行比上面少几格、网格错位。已补齐（单测钉住 7 的倍数）。
7. **管理端异步加载的「编辑旧数据」竞态**：浏览器验收里点「编辑」后立刻点「撤回」，
   结果撤回了**上一条**（脚本等待不足，但也说明界面没有让「正在编辑哪一条」可判定）。
   已给编辑器加 `data-journal-editor` / `data-leisure-editor`，脚本改成等目标记录载入后再操作。
8. **没有封面时画了一个占满半屏的空框**：记录本身只有两行字，装饰盖过了业务。
   已把空封面改成一条细带（07 §3 的要求是内容可读）。

## 6. 任务卡「验收」逐条对照

| 验收 | 证据 |
| --- | --- |
| 1 草稿 / 私密在所有公开入口不可见，切 private 后新请求立即生效 | 后端 `test_privacy.py`（11 例：列表 / 详情 / 日历 / 图片 / 分享文本 / 站主登录读公开端点 / 新建默认值 / unpublish 立即生效）；浏览器 9 项（含直接改库切换后**下一次请求**即生效、再切回可逆） |
| 2 日期按明确展示时区，不因 UTC 错一天；日历空态不显示隐藏记录数量 | 后端 `test_public_journal.py`（`display_today(16:30Z)==10-17`、当天可见而展示时区的明天不可见、`entry_date` 列类型是 `date`、空月份 `months==[]`）；浏览器 6 项（时区标注、标记集合、无隐藏暗示、不错一天） |
| 3 总集数空 / 弃坑 / 搁置 / 零评分与未评分展示正确；无第三方同步暗示 | 后端 `test_progress_semantics.py`（22 例：标签与比例规则、跨类型字段与评分 / 集数的数据库约束、`all_achievements` 三态、响应里无 steam/bangumi）；前端 `paths.test.ts`（14 例，与后端同一组样例）+ 浏览器 12 项 |
| 4 手机与独立页数据一致、可返回；公共管理写入被拒绝 | 前端 `journal-view.test.tsx` / `leisure-view.test.tsx` 各自渲染 `phone-app` 的默认导出与 `PhoneViewProps`（两宿主同一视图、同一组端点、`dispose()` 取消）；浏览器 10 项（独立页换屏 / 刷新 / Back / 手机宿主 Escape / 手机桌面无坏按钮 / 匿名读写 401）。**手机桌面里的完整流程在 manifest 登记前无法验证**，见 §9.2 |
| 5 勒布朗不因一个应用 API 失败导致音乐或整页消失；不自动调用 AI / 开启声音 | 前端 `leblanc-view.test.tsx`（7 例：单块失败 / 两个应用失败 / **全部失败**时整页与音乐仍在；放进真实 `SiteRuntime` 断言 `audio[data-pl-music]` 唯一且 `play()` 未被自动调用；点了才调用一次）；浏览器 6 项（含浏览器里 abort 两个 API 后重开） |
| 6 有真实持久化管理入口，不只交付硬编码演示卡片 | 后端 `test_admin_journal.py`（13）/ `test_admin_leisure.py`（13）走真实 HTTP：登录 → 新建 → 更新 → 发布 → 撤回 → 切可见性 → 软删除，`If-Match` 428/412、CSRF 403、跨类型字段 422、封面未 ready 409；浏览器 11 项含**新建并 SQL 核对落库**、发布后出现在公开页、撤回后立即消失 |

## 7. 每包必做清单（ACCEPTANCE §1）

- **需求有对应测试，先写会失败的断言**：`test_privacy.py` 是全包最重要的一组，它在我实现公开条件**之前**
  就写好了（第一次运行确实红：`InvalidRequestError` → 修模型；随后 4 条因 `journal_client` 不含 media 路由而红）。
  没有「永远通过的快照」。
- **类型检查 / 模块测试 / 数据库约束 / 构建都有真实命令与退出码**（§5）；未运行项单列（§9）。
- **新公开内容在列表、详情、搜索、分享、图片路径都验证权限**：手记的列表 / 详情 / 日历 / 图片四条路径
  都有私密与草稿的负向用例；「分享」路径 = canonical URL（浏览器验证直接 URL + 刷新 + Back，私密与草稿是真 404）。
  放课后同理（列表 / 详情 / 封面 / 长评引用）。搜索：本包**没有**接进 T04 的搜索（见 §10.3）。
- **320 / 390px、键盘返回、关闭、焦点、减少动态效果、失败状态**：320 / 390 三个页面横向溢出 0px 并截图；
  表单是原生 `label` + `input` / `select` / `textarea`，键盘可用；Escape 分层沿用宿主协议；
  失败态有明确文案 + 「重新读取 / 重试」，与「空数据」文案不同；减少动态效果由 T02 的协调器统一处理，本包不覆盖。
- **只有实际行为 / 内容才显示图标、计数与成功提示**：日历计数来自真实公开记录；
  完成率只在总数已知时出现；「共 N 篇 / N 条」来自真实返回；没有假按钮（未接入的能力不显示入口）。
- **模块退出取消读取与监听**：`useLoader` 卸载即 abort；事件回调里的请求登记进 `inflight.ts`，
  `dispose()` 一次取消（两个包的用例都用「永不 resolve 的请求 + 断言 signal.aborted」验证）；
  晚到的响应被 `isAbort()` 拦住，不写回状态。**音乐单例与动画规则未触碰**（浏览器断言 `audio[data-pl-music]` 唯一）。
- **不新增生产密钥 / 绝对本机素材路径 / 任意 HTML 执行 / 未授权外部调用** ✓
  （正文用 T02 的节点树渲染器，没有 `dangerouslySetInnerHTML`；没有调用任何模型）。

## 8. 集成申请（T00 动作）

1. **模型注册**：`MODEL_MODULES` 追加 `"app.modules.journal.models"` 与
   `"app.modules.leisure.models"`（放在 `app.modules.posts.models` 之后，二者都引用 posts / media）。
2. **路由登记**：`MODULE_ROUTER_TARGETS` 追加
   `("journal", "app.modules.journal.router")` 与 `("leisure", "app.modules.leisure.router")`。
   两条 router 都是**空前缀容器**，内部自己组合 `/journal` + `/admin/journal/entries` 与
   `/leisure` + `/admin/leisure/entries`（与 media / nav 同样的做法）。
   登记后请删除 `app/modules/t05_dev_app.py`（它只是「路由还没登记」时的本地验证入口）。
3. **迁移**：按 §3 生成单头 revision。我**没有**写 `migrations/`，也没有执行过任何迁移
   （只在自建 dev 库上用 `alembic upgrade head` + T05 三张表的 `create_all`）。
4. **Wiring（必须，不是可选）**：在 `app/main.py` 的 `register_content_domains()` 里各加一行

   ```python
   from app.modules.journal import wiring as journal_wiring
   from app.modules.leisure import wiring as leisure_wiring
   journal_wiring.register()   # 贡献 media:journal
   leisure_wiring.register()   # 贡献 media:leisure
   ```

   **不登记时**：一篇已发布且 public 的日记、一条已发布的追番条目，它们的图片对匿名访客一律 404
   （`media/public_refs` 是默认拒绝的注册表）。这不是可选优化，而是「公开配图能不能被看到」的前提。
   两个域都**不贡献公开标签来源**（都没有标签字段），`verify_no_shared_tag_contributions()` 是可执行断言。
5. **环境变量**：无新增。可选：若希望展示时区可配置，请在 `apps/api/app/core/config.py`（T01 所有）
   加一个带默认值的字段并把 `journal/models.py` 的 `DISPLAY_TIMEZONE_NAME` 指向它 —— 当前是模块常量，
   行为已由测试钉住，不配置也不会错。
6. **OpenAPI / 前端类型**：接线后重跑 `export_openapi.py` 与 `npm run gen:api`
   （`contracts/openapi.json` 会漂移一次，属预期）。本包前端类型是**手写并注明与 OpenAPI 同形**的
   （与 nav / moments 的做法一致）：`features/{journal,leisure}/types.ts`。
7. **手机 manifest 登记**（原样可抄，字段与 SHARED-CONTRACTS §4 一致）：

   ```ts
   {
     id: "journal",
     name: "手记",
     subtitle: "日记与日历",
     icon: "/assets/legacy/img/icon/morgana.webp",
     order: 30,                                   // ins(10) < metanav(20) < journal(30) < leisure(40)
     kind: "embedded",
     canonical_path: "/apps/journal",
     loader: () => import("@/features/journal/phone-app"),
     feature_flag: null,
     state_version: 1,                            // 与 features/journal/state.ts 的 JOURNAL_STATE_VERSION 一致
   },
   {
     id: "leisure",
     name: "放课后",
     subtitle: "追番与游戏",
     icon: "/assets/legacy/img/icon/oracle.webp",
     order: 40,
     kind: "embedded",
     canonical_path: "/apps/leisure",
     loader: () => import("@/features/leisure/phone-app"),
     feature_flag: null,
     state_version: 1,                            // 与 features/leisure/state.ts 的 LEISURE_STATE_VERSION 一致
   }
   ```

   **`icon` 都是仓库里已有的迁移图标资源**（`apps/web/public/assets/legacy/img/icon/`，可 `ls` 核对）：
   `morgana.webp` 用于手记（摩尔加纳是怪盗团里最贴近「记下来」的角色气质），
   `oracle.webp` 用于放课后（佐仓双叶在设定里就是游戏玩家）。未新增任何素材，也未使用外链。
   若要换成别的，任何 `/assets/legacy/img/icon/*.webp` 都可以；`oracle.webp` 目前也被 metanav 使用，
   如果希望桌面图标不重复，可把 leisure 换成 `fox.webp`（喜多川祐介 —— 艺术鉴赏气质）。

   `phone-app.tsx` 的模块形状：都是 `default` = 收 `PhoneViewProps` 的组件、
   `screens`（journal `["list","calendar"]` / leisure `["anime","game"]`）、`dispose()` = `abortAll()`。
8. **勒布朗接线**（首页 `apps/web/app/page.tsx` 属 T02）：新增路由 `/apps/leblanc` 只是**便于验收与自查**的
   独立入口；勒布朗的正式位置是首页的一块。接线方式二选一：

   - 在 `app/page.tsx` 里插入 `<LeblancView />`（客户端组件，可以直接放在服务端页面里）；
   - 或按布局需要只取其中某几块（`LeblancView` 内部四块彼此独立，可拆分复用）。

   建议插在 `HomeHero` 之后、`HomePalaceIndex` 之前，并在集成后决定是否保留 `/apps/leblanc`
   （保留它的好处：站主能直接分享「近况」页；坏处：多一个入口）。
9. **`.env.example` / Compose**：本包不新增变量，无需改动。

## 9. 未验证项及原因（不得当作已通过）

1. **Docker / Compose 内的启动**：本机 Docker daemon 未运行（T00 已知），所有验证都是本机进程
   （uvicorn + `next start` + 真实 PostgreSQL 18）。容器内行为属 T10。
2. **手机面板里的完整 T05 流程**：`features/phone/registry.ts` 由集成负责人拥有，两个 manifest
   还没登记，因此 `?phone=journal` / `?phone=leisure` 在真实浏览器里会按宿主协议**回退桌面**
   （这是正确行为：未登记不执行任意路径）。手机侧现有证据是组件级的（两个包各自的 `phone-app.test`
   形状用例 + `dispose()` 取消请求 + 与独立页共用同一视图），以及浏览器里「手机桌面不出现未登记应用」
   与「手机不新增第二个音频元素」。**登记后需要补一次真实面板验证**（属集成 / T10）。
3. **手记 / 放课后接进 T04 的搜索**：`GET /nav/search` 只检索文章与专题（T04 的既定范围）。
   本包**没有**修改 nav 的搜索端点，也没有声称日记可被搜索到；若需要「搜索手记」，
   请在 T04 的搜索里加数据源（那会牵涉 T04 的文件所有权）。这也意味着
   「私密日记不会出现在搜索里」目前是**因为没有接进去**，不是因为过滤 —— 交付单如实记录这一点。
4. **AI 读取路径**：T08 的角色消息尚未接入，本包没有任何 AI 调用。
   「私密日记不进 AI 上下文」这条集成矩阵项在 T08 落地前无法端到端验证；
   服务端侧可保证的是公开端点不返回私密内容（已测）。
5. **跨浏览器与移动端真机**：只用 Chromium（Playwright 自带版本）验证；Safari / Firefox / iOS 未测。
6. **`prefers-reduced-motion`**：手记 / 放课后 / 勒布朗都没有自己的动画，
   减少动态效果由 T02 的导航协调器统一处理（本包不覆盖，也没有新增动效）。
7. **原图与图片删除**：本包只引用已有媒体，不做上传与删除（属 T01 / T06）。
   「同一张图被日记与公开相册同时引用」这条集成矩阵项，本包验证的是**引用计数语义**
   （`shared_media` + 匿名可读性），真实相册由 T06 交付后需要再跑一次联合验证。
8. **`pl_test` 零写入未被独立复核**：本包全部数据库用例只在自己的 `pl_test_t05` 上跑，
   但「共享库零写入」这条结论来自夹具设计（只在自建库上建表）而不是逐表计数复核。
9. **管理端只在桌面视口验证**：`/admin/journal` 与 `/admin/leisure` 没有做 320 / 390 的几何断言
   （后台按桌面使用，与 T04 的做法一致），但**没有**出现横向溢出以外的可用性问题需要说明。
10. **`/apps/leblanc` 的元数据**：页面标题 / 描述是手写的，没有做 SEO 或结构化数据验证。

## 10. 遗留与需要外部选择

1. **手记摘要取「第一段」**：`entry_excerpt()` 取正文第一段纯文本（并按码点截断）。
   截图里能看到「## 今天」这种标题行会被当作第一段（`把手机应用接上` 那篇显示「今天」）。
   要更漂亮需要「跳过标题行 + 取首个正文段」的规则 —— 这会改变公开列表的语义，
   因此留作站主 / 集成方的选择，而不是我单方面决定。
2. **放课后没有长评发布的入口**：`review_post_id` 字段与展示都做了，但管理表单暂时只能通过
   API 设置（前端的文章选择器需要一个「列出全部文章」的端点，而文章管理属后续功能，T04 也遇到同一问题）。
3. **手记的标签 / 位置结构化**：`location` 是自由文本（07 §3 的「地点文字」）。
   若要变成可选地点表或与地图地点关联，需要先定契约增量。
4. **`progress` 的枚举扩展**：目前严格按 07 §3 的五个值 / 类型。
   要加「二刷」「重玩」这类状态需要同时改数据库 CHECK、DTO 与前端，属显式决定。
5. **勒布朗的「最新照片」**：07 §3 建议里包含它，但那需要 T06 的相册数据；
   本包**没有**显示这一块（未接入不显示空功能），等 T06 集成后再加一个块即可。
6. **勒布朗的惣治郎欢迎语**：07 §3 提到可作为可关闭的短篇同人文案、后续与角色会话连接。
   本包只放了一句站主手写的**真实**近况（`CURRENT_STATUS`），没有写同人对话，
   也没有做「每次访问强制对话」（明确禁止）。
7. **展示时区是否可配置**：见 §8.5。当前是模块常量，行为已被测试钉住。
8. **`next start` 之外的部署形态**：生产网关需要转发 `/api/v1` 与 `/assets/music/`
   （后者是 T02 已登记的集成申请，本轮开发期用 `DEV_LEGACY_STATIC_URL` 复刻）。

## 11. 复现命令（从零到浏览器证据）

```bash
cd /Users/学习/blog/Blogs
export UV_CACHE_DIR=/Users/学习/blog/.dsh/uv-cache
export npm_config_cache=/Users/学习/blog/.dsh/npm-cache
export TEST_DATABASE_URL="postgresql+psycopg://pl@127.0.0.1:55432/pl_test"

# 1) 后端模块测试（自建 pl_test_t05，结束自动 drop）
uv run --project apps/api pytest apps/api/tests/journal apps/api/tests/leisure   # 96 passed

# 2) 前端
npm --prefix apps/web run typecheck && npm --prefix apps/web run lint
npm --prefix apps/web run test -- --run                                          # 452 passed（本包 73）
node --test tests/*.test.cjs                                                     # 53 passed（旧站）

# 3) 真实数据 + 真实服务（本地 dev 库，名字带 test 以便通过守卫）
/opt/homebrew/opt/postgresql@18/bin/createdb -h 127.0.0.1 -p 55432 -U pl pl_test_t05_dev
cd apps/api
export APP_ENV=dev DATABASE_URL="postgresql+psycopg://pl@127.0.0.1:55432/pl_test_t05_dev" \
       SECRET_KEY="t05-local-dev-secret-key-0123456789abcdefg" MEDIA_ROOT=/tmp/pl-t05-media \
       CORS_ORIGINS="http://127.0.0.1:3100"
uv run --project . alembic -x db_url="$DATABASE_URL" upgrade head
uv run --project . python -m app.commands.import_legacy --apply --no-covers --repo-root ../..
uv run --project . python -m app.commands.bootstrap_admin --username owner --password-stdin <<< "t05-owner-password-123"
# 补建 T05 三张表（集成迁移生成后这一步就不需要了）
uv run --project . python -c "
import app.model_registry as mr
from app.core.db import Base, create_db_engine
mr.import_all_models()
eng = create_db_engine('$DATABASE_URL')
names = ['journal_entries','journal_entry_media','leisure_entries']
Base.metadata.create_all(eng, tables=[Base.metadata.tables[n] for n in names])"
# 演示数据：三条公开手记 + 一条私密 + 一条草稿；三条追番 + 两条游戏 + 一条草稿
uv run --project . python /tmp/t05_seed.py      # 脚本见 §11.1

# CORS_ORIGINS 是必需的：Next 的 dev rewrite 转发时 API 看到的 Host 是 127.0.0.1:8100，
# 而浏览器的 Origin 是 127.0.0.1:3100，不同源会被 CSRF 的来源校验 403 拒绝。
uv run --project . uvicorn app.modules.t05_dev_app:app --host 127.0.0.1 --port 8100 &
cd ../web
# DEV_LEGACY_STATIC_URL 指向已经在跑的旧站预览（8000），用来复刻生产网关对 /assets/music/ 的转发
DEV_API_URL=http://127.0.0.1:8100 DEV_LEGACY_STATIC_URL=http://127.0.0.1:8000 npm run build
API_INTERNAL_URL=http://127.0.0.1:8100 npm run start &      # 端口 3100
cd ../..
python3 apps/web/features/journal/tools/verify-t05.py        # 93 passed / 0 failed

# 收尾：按端口精确停止自己的服务（不要按名字 pkill，会影响其他人；8000 是旧站预览，不动它）
lsof -ti tcp:8100 | xargs -r kill
lsof -ti tcp:3100 | xargs -r kill
```

### 11.1 演示数据脚本（`/tmp/t05_seed.py` 的等价内容）

幂等：按标题查重，已存在就跳过。内容全部是**真实可读**的记录，不是占位字符串：

```python
# 手记：3 篇公开（2026-10-16 / 10-14 / 10-09）+ 1 篇 private + 1 篇 draft
#   「把手机应用接上了」正文含 Markdown 标题、粗体、行内代码与列表
#   「（私密）今天不开心」「（草稿）还没写完的一篇」用于验证公开入口看不到
# 放课后：3 条追番（看完 10/10、在看且**总数未知**、搁置 8/24）+ 2 条游戏（通关但没全成就、在玩且有时长）+ 1 条草稿
```

（完整脚本随本轮命令运行过两次，第二次为幂等 no-op；集成方若需要可向我索取。）

## 12. 清理状态

- `pl_test_t05`：由夹具在会话结束自动 drop（已确认不在 `psql -l` 列表里）。
- `pl_test_t05_probe`：我为了拿服务端堆栈临时建的库，已 drop。
- `pl_test_t05_dev`：本地 dev 库，**保留**（便于集成方复核我的浏览器证据）；可随时 `dropdb`。
- `/tmp/pl-t05-media`、`/tmp/t05-*.log`：临时目录与日志，可随时删除。
- 端口 8000 上的旧站静态预览**不是本包启动的**，未触碰；控制台里已无本包启动的进程（8100 / 3100 均已停止）。
- 截图在 `/Users/学习/blog/.dsh/screenshots/`（仓库外的工作区临时目录，未入库）。
