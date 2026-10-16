# T03 · 交付单（INS 图文发布与阅读）

```text
任务：T03 / INS 图文发布与阅读
状态：implemented_waiting_integration —— 代码、模型、路由与测试全部落地并真实跑通；
      「站主发布 → 另一浏览器读取」的完整闭环**已在真实浏览器 + 真实 PostgreSQL 上走通**
      （27/27 项浏览器检查通过，含撤回后图片不可读）。
      模型 / 路由前缀 / wiring 三项集成动作**尚未应用**（属 T00），因此还不能标记 integrated。
基线：main @ ba4fc35（开始时工作区只有 apps/web/tools/browser-verification/verify.py 的
      他人改动，未触碰）
      本轮 T03 未提交任何内容；未推送、未建分支 / worktree、未启动子 agent
外部影响：未调用任何模型或付费服务；未部署；未写入 pl_test（T00 的共享夹具库）——
          验证只在自建临时库 pl_test_t03_<pid> 与独立联调库 pl_test_t03_smoke 上进行
```

## 1. 范围

**已完成**：图文动态的后端模型 / 校验 / 公开与管理端点、媒体公开引用与公开标签的域贡献、
前端信息流 / 详情 / 图片预览 / 本机收藏 / 分享、管理端发布工作台（上传 → 排序 → alt →
草稿预览 → 发布 / 撤回 / 软删除）、相册与消息的**组合注入接口**、手机内置视图模块。

**未完成（有意不做）**：相册（T06）、角色消息与 AI（T08）、真实点赞 / 关注 / 公开评论、
视频、第三方 Instagram；也不包含任何 T08 的会话或剧情数据。

## 2. 文件

**新增（apps/api，本包独占）**

```text
app/modules/moments/models.py    moments / moment_media / moment_tags + CHECK 与索引
app/modules/moments/schemas.py   公开 DTO、管理 DTO、写入 DTO（字段级约束）
app/modules/moments/service.py   公开读取、事务内校验、发布 / 撤回 / 软删除、域贡献函数
app/modules/moments/router.py    2 条公开 + 5 条管理端点
app/modules/moments/public_refs.py  媒体公开引用检查器（默认不生效，需登记）
app/modules/moments/tags_source.py  公开标签来源（同上）
app/modules/moments/wiring.py    单点登记入口（T00 在 main.py 调用一次）
tests/moments/{__init__,conftest,helpers,t03_db}.py
tests/moments/test_models.py            15 例：真实 PostgreSQL 约束与部分索引
tests/moments/test_admin_api.py         24 例：写接口、发布门槛、If-Match、CSRF
tests/moments/test_public_api.py        18 例：列表 / 详情 / 分页 / 标签 / 跨连接可见
tests/moments/test_media_visibility.py   9 例：注册表登记前后的媒体可见性、公开标签
```

**新增（apps/web，本包独占）**

```text
features/ins/types.ts              DTO 与纯函数（码点计数、标签清洗、分页合并、变体选择）
features/ins/paths.ts              两端共用的 URL 构造（服务端 / 浏览器都能 import）
features/ins/api.ts                浏览器端读取与全部写操作（带 If-Match）
features/ins/server-api.ts         仅服务端的读取（单独文件，见 §7 的坑）
features/ins/favorites.ts          本机收藏存储（只存 UUID + 时间 + 最小摘要）
features/ins/favorites-react.ts    useSyncExternalStore 绑定
features/ins/use-feed.ts           信息流状态机（骨架 / 空 / 失败 / 加载更多 / 重置游标）
features/ins/scroll-memory.ts      「详情返回恢复滚动位置」
features/ins/composition.ts        页签与头像插槽的**组合契约**（T06 / T07 / T08 接线点）
features/ins/ins-shell.tsx         应用壳（页签、资料区、COOP 插槽、未接入不显示）
features/ins/ins-app.tsx           独立页用的客户端壳
features/ins/feed-view.tsx         信息流视图 + 标签筛选 + 加载更多
features/ins/detail-view.tsx       详情视图（撤回态 / 失败态 / 纯文本正文）
features/ins/image-preview.tsx     图片预览前景层（键盘、Escape、焦点归还）
features/ins/moment-card.tsx       卡片与骨架
features/ins/favorite-button.tsx / share-button.tsx
features/ins/saved-view.tsx        本机收藏视图（逐条重新确认是否仍公开）
features/ins/phone-view.tsx        手机内置视图（feed / detail / saved）
features/ins/phone-app.tsx         PhoneAppModule 形状（默认导出 + screens）
features/ins/phone-manifest.tsx    PhoneAppManifest（供 T00 登记）
features/ins/ins.css               本包独占样式表（页面 import，不进 legacy / globals）
features/ins/*.test.{ts,tsx}       9 个测试文件 / 91 例
```

```text
app/apps/ins/page.tsx                `/apps/ins`（服务端读第一页 + 标签筛选）
app/apps/ins/[id]/page.tsx           `/apps/ins/<uuid>`（非 UUID 直接 404）
app/apps/ins/collections/page.tsx    `/apps/ins/collections`（本机收藏的静态路径）
app/admin/moments/page.tsx           管理列表 + 发布工作台
app/admin/moments/[id]/page.tsx      单条编辑（同一个工作台的等价入口）
```

**修改（共享文件，最小且必要）**

```text
apps/api/tests/core/t01_db.py
  - _ensure_tables 改成只扫 T01 自己的 8 张表（新增常量 T01_TABLES）。
    原因：`Base.metadata` 是全进程共享的注册表，T03 的模型一旦在同一次 pytest 进程里
    被导入，旧写法会把 moments 三张表也算成「T01 漏掉的表」，导致
    tests/core/test_schema_evidence.py 误报。
  - 曾按旧机制把 pl_test_t03 加进 ALLOWED_TEMP_DATABASES；T00 提供
    register_temp_database 后已改为逐包登记，该处的 T03 常量已删除（工作区当前状态）。
apps/web/tests/helpers/browser.ts
  + stubScrollTo()：jsdom 没实现 window.scrollTo，滚动恢复的测试需要可断言的替身。
```

**未改动**（所有权红线）：`app/{main,router,model_registry}.py`、`migrations/`、两个锁文件、
`app/core/`、`app/modules/{auth,media,tags,posts}/`、`features/{runtime,phone,legacy,auth}/`、
`components/ui/`、`lib/api/`、`app/{layout.tsx,globals.css,admin/layout.tsx}` 与其页面、
`contracts/`、`deploy/`、旧站 HTML / assets / `tests/*.cjs`。

## 3. 模型清单与迁移意图（集成申请 A）

`MODEL_MODULES` 追加：**`app.modules.moments.models`**（依赖 `auth` / `media` / `tags`，因此排在它们之后）。

| 表 | 列 | 数据库级约束与索引 |
| --- | --- | --- |
| `moments` | `id` / `author_id` / `text` / `status` / `published_at` / `created_at` / `updated_at` / `deleted_at` / `version` | `pk_moments`；`fk_moments_author_id_admin_users`（RESTRICT）；`ck_moments_status_valid`（draft/published）；`ck_moments_version_positive`（≥1）；`ck_moments_text_length`（`char_length(text) <= 2000`）；`ix_moments_public_listing (published_at, id) WHERE status='published' AND deleted_at IS NULL`（部分索引）；`ix_moments_author_created_at (author_id, created_at)` |
| `moment_media` | `moment_id` / `media_id` / `position` / `alt` | `pk_moment_media`（= 同一动态的 media_id 唯一）；`uq_moment_media_moment_id_position`（同一动态 position 唯一）；`fk_…_moments`（CASCADE）、`fk_…_media`（RESTRICT）；`ck_moment_media_position_range`（0–8）；`ck_moment_media_alt_length`（1–200 码点）；`ix_moment_media_media_id` |
| `moment_tags` | `moment_id` / `tag_id` | `pk_moment_tags`（组合唯一）；双 FK（CASCADE）；`ix_moment_tags_tag_id` |

「最多 8 个标签」「发布需 1–9 张 ready 图」是跨行约束，按 05 §3 由 service 在同一事务里验证。

## 4. 端点增量（公开 2 条属 05 §6 已规定；管理 5 条属 05 §7 已规定）

| 方法与路径 | 说明 |
| --- | --- |
| `GET /api/v1/moments` | `tag` / `cursor` / `limit`（12，最大 30）→ `{items, next_cursor}`；`Cache-Control: no-store` |
| `GET /api/v1/moments/{id}` | 草稿 / 撤回 / 删除 / 未到时间 / 非 UUID **统一 404** |
| `GET /api/v1/admin/moments` | 含草稿；`?status=draft\|published`，非法值 422；`private, no-store` |
| `GET /api/v1/admin/moments/{id}` | 带 `version` 与 `ETag: "n"` |
| `POST /api/v1/admin/moments` | 201；草稿可空；引用的媒体必须 ready 否则 409 |
| `PATCH /api/v1/admin/moments/{id}` | 传 `images` 时**完整替换**有序关系；`If-Match` 必需 |
| `POST /api/v1/admin/moments/{id}/publish` | 门槛：1–9 张 ready 图，否则 409；服务端生成 `published_at` |
| `POST /api/v1/admin/moments/{id}/unpublish` | 回到 draft，清 `published_at`，保留图片与标签关系 |
| `DELETE /api/v1/admin/moments/{id}` | 204 软删除；`If-Match` 必需 |

**T03 定义的、文档未规定的传输细节（请登记为约定）**

1. **图片顺序必须从 0 开始且连续、不重复**：只唯一是不够的（`0,2` 会被 422 拒绝）。
   理由：位置唯一但断号在界面上没有意义，会在「第 2 张」处静默错位。
2. **`alt` 是发布门槛的一部分**：写入时 schema 就要求 1–200 码点（不是发布时才校验）。
3. **标签在写入时清洗**：去首尾空白 → 丢空 → 按显示名去重（保留首次出现顺序）；
   最多 8 个、单个 ≤24 码点，越界 422。**不做大小写折叠**（slug 归一由 tags 域负责）。
4. **`GET /tags` 现在会同时包含动态与文章的标签**（动态域登记后）。仅被草稿使用
   的动态标签不会出现；动态撤回后该标签也会从公开列表消失（有测试）。
5. **媒体公开引用检查名 = `moments`，公开标签来源名 = `moments`**（可断言）。
6. **管理回执的 `images_admin`**：`[{media_id, position, alt}]`，可直接回填到 PATCH；
   它**不过滤**未 ready 的图（表单要能看到并提示「不能发布」）。
7. **`published_at` 在公开响应里可空**：管理回执复用同一个形状（草稿没有发布时间）。

## 5. 验证（全部实际执行，命令与退出码）

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `uv run --project apps/api pytest apps/api/tests/moments` | 0 | **65 passed** |
| `npm --prefix apps/web run typecheck` | 0 | tsc 无输出 |
| `npm --prefix apps/web run lint` | 0 | 0 error / 0 warning |
| `npm --prefix apps/web run test -- --run` | 0 | **32 files / 304 passed**（其中 `features/ins` 9 files / 91 例） |
| `npm --prefix apps/web run build` | 0 | 20 条路由，含 `ƒ /apps/ins`、`ƒ /apps/ins/[id]`、`○ /apps/ins/collections`、`○ /admin/moments`、`ƒ /admin/moments/[id]` |
| `node --test tests/*.test.cjs` | 0 | **53 passed / 0 failed**（旧站零回归） |
| `python3 .dsh/t03-smoke/browser-verify.py` | 0 | **27/27 checks passed**，7 张截图（见 §5.2） |

前置：`export TEST_DATABASE_URL="postgresql+psycopg://pl@127.0.0.1:55432/pl_test"`。
**只跑自己的目录**（`apps/api/tests/moments`）：全量套件由 T00 在无人并发时串行运行
（并发共用库名会让各包的临时库互相 drop，见 T00 的说明）。

### 5.1 真实 PostgreSQL（不是 SQLite，也不写共享库）

T03 夹具在同一个本机测试集群上**自建** `pl_test_t03_<pid>` 与
`pl_test_t03_<pid>_second`（后者用于「另一浏览器」的独立连接），名字经 T00 的
`register_temp_database` 登记 + `assert_test_database_url` 校验，用例结束即 drop。
**带 pytest 进程 pid**：同机并行跑测试时不会互相 drop 对方的库。

`pl_test`（T00 的共享夹具库）本轮**零写入**。

约束证据（`tests/moments/test_models.py`，全部由 PostgreSQL 实际执行）：
`ck_moments_status_valid` / `ck_moments_text_length` / `ck_moments_version_positive` /
`ck_moment_media_position_range` / `ck_moment_media_alt_length` / `pk_moment_media` /
`uq_moment_media_moment_id_position` / `ix_moments_public_listing`（`pg_indexes` 里确认
定义含 `WHERE status='published' AND deleted_at IS NULL`）/ `fk` 的 RESTRICT 行为。
`t03_schema_report()["created_by_fallback"]` 会如实报告哪些表是夹具补的 —— 集成迁移
落地后该列表应为空（现在如实报告为 `['moment_media','moment_tags','moments']`）。

### 5.2 真实浏览器（Playwright + 系统 chromium；两个 BrowserContext，无 mock）

**这就是 T03 的核心验收用例 1**，也顺带补上了 T02 交付单 §5 第一条的未验证项
（「T01 公开 API 的端到端渲染」——**已走通**，见本节末尾的补充证据）。

环境：真实 PostgreSQL（`pl_test_t03_smoke`）+ 真实媒体目录 + 真实 API 进程 +
真实 Next 进程（`DEV_API_URL` 在 `next build` 时就有值）。

```text
站主（Context A）                         第二浏览器（Context B，无痕）
  登录 /admin/login ──────────────────────▶ 会话写入 HttpOnly Cookie
  新建草稿（POST 201）
  上传 PNG（POST /admin/media 201）
  填 alt / 文字 / 标签
  保存（PATCH 200，带 If-Match）
  发布（POST …/publish 200）
                                    ─────▶ 打开 /apps/ins：看到同一条图文、同一图序与时间
                                           图片 naturalWidth > 0（真的加载出来了）
                                    ─────▶ 打开 /apps/ins/<uuid>：完整正文 + 替代文本
                                    ─────▶ 点图 → 预览层出现，加载可用的最大变体
                                           Escape 关闭；预览期间 audio 仍是 1 个
                                    ─────▶ /apps/ins/<随机 UUID> → 404
                                           /apps/ins/messages → 404（静态段没被动态段吞掉）
                                    ─────▶ 390px：scrollWidth == clientWidth（无横向溢出）
  撤回（POST …/unpublish 200）
                                    ─────▶ 公开列表不再包含它；详情 404；
                                           同一张图的 w320 变体 404（媒体引用检查生效）
                                    ─────▶ 详情页显示「这条动态已经撤回或不可访问」
```

27 项检查逐条 PASS，截图（绝对路径，位于仓库外）：

```text
/Users/学习/blog/.dsh/screenshots/t03-admin-empty.png
/Users/学习/blog/.dsh/screenshots/t03-admin-published.png
/Users/学习/blog/.dsh/screenshots/t03-visitor-feed.png
/Users/学习/blog/.dsh/screenshots/t03-visitor-detail.png
/Users/学习/blog/.dsh/screenshots/t03-visitor-preview.png
/Users/学习/blog/.dsh/screenshots/t03-visitor-feed-390.png
/Users/学习/blog/.dsh/screenshots/t03-visitor-withdrawn.png
```

**验收脚手架（不是生产接线）**：`app/router.py` 与 `app/model_registry.py` 由 T00 拥有，
T03 不改它们，因此在接线前 `uvicorn app.main:app` 里没有 `/api/v1/moments`。
联调用一个**进程外补丁**（`.dsh/t03-smoke/sitecustomize.py`，通过 `PYTHONPATH` +
`T03_SMOKE_WIRING=1` 生效）把 `("moments", "app.modules.moments.router")` 与
`app.modules.moments.models` 追加进清单，并调用一次 `moments.wiring.register()` ——
**它做的正是 §6 里要求 T00 做的三件事**，仓库里的生产文件一个字节都没改。

**补充证据：T02 交付单 §5 第一条（T01 公开 API 的端到端渲染）已走通**，附带一条真实限制：

```text
同一个联调库里插一篇公开文章 →
  GET /api/v1/posts                     → 200，items 里就是它（真实 PostgreSQL）
  PHANTOM_POSTS_SOURCE=api 重新 build + start
  GET /posts/t03-smoke-post             → 200，页面渲染出「T03 联调文章 / 正文来自真实数据库」
构建产物里 /posts/[slug] 从 ● (SSG) 变为 ƒ (Dynamic)
```

**限制（请 T00 决定）**：`PHANTOM_POSTS_SOURCE=api` 下**必须重新构建**，
让 `/posts/[slug]` 从 SSG 变成 Dynamic；否则运行时会报
`Page changed from static to dynamic at runtime … reason: no-store fetch …/api/v1/posts/<slug>`
并返回 500（实测）。也就是说「打开 API 数据源」不是纯运行时开关，需要一起改构建产物。
这也是 T02 把默认值留在 `baseline` 的原因；T03 只把这条路径**验证到能工作**，没有改 T02 的默认值。


### 5.3 联调中抓到并修掉的 5 个真实缺陷（都有回归测试或浏览器证据）

1. **PATCH 的 `images` 到 service 时是 dict**：router 用
   `model_dump(exclude_unset=True)` 取「只改了哪些字段」，service 却直接访问
   `image.media_id` → `AttributeError` → **500**。单元测试因为直接构造模型实例没抓到。
   修法：service 归一化 dict / 模型两种输入；新增**从 HTTP 入口进**的回归用例。
2. **写操作没有带 CSRF token**：共享客户端没有 `headers` 选项，而我把 token 忘了放进 body，
   于是所有管理写操作在生产形态下都是 403「CSRF 校验失败」。真实浏览器联调抓到。
   修法：`withCsrf()` 把 token 合进请求体（服务端本就接受该字段）；
   测试断言每个写请求的 body 里都有 `csrf_token`。
3. **`FEED_PAGE_SIZE` 从带 `"use client"` 的模块导入到服务端组件**：服务端拿到的是
   「客户端引用函数」，请求变成 `?limit=function(){throw Error(...)}` → **API 422**
   → 页面显示「读取动态失败」（截图 + API 访问日志抓到）。
   修法：常量移到无 `"use client"` 的 `types.ts`；新增断言与说明。
4. **服务端首屏失败后失败提示永不消失**：客户端已经读到内容，页面上却仍挂着
   「READ FAILED（HTTP 422）」和卡片并存。修法：把服务端错误当作客户端的**初始错误状态**，
   客户端重试成功即清掉；新增回归用例。
5. **`useOverlay` 在 providers 之外的空操作替身让预览关不掉**：`/admin` 下的草稿预览
   在键盘用户手里「进去出不来」（Escape 被吞）。修法：预览的 `onKeyDown` 加一条
   `defaultPrevented` 双保险 —— 有宿主时不重复关闭，没宿主时补上；新增断言。

另外两条是流程性的：`next start` 与 `.next` 的 chunk 一致性（重建后必须重启服务，
否则静态 chunk 500 让**所有**按钮失效），以及本机 Python 的 `urllib` 会走 macOS
系统代理自动探测、对 127.0.0.1 也返回空 502（验收脚本因此改用 `http.client`）。

## 6. 集成申请（按优先级）

### A. 必须（不做就等于没接线）

1. **模型注册**：`MODEL_MODULES` 追加 `app.modules.moments.models`（顺序在 tags 之后）。
2. **路由登记**：`MODULE_ROUTER_TARGETS` 追加 `("moments", "app.modules.moments.router")`
   （前缀 `/moments` 与 `/admin/moments`，与现有模块不冲突）。
3. **wiring 登记**：`app/main.py` 的 `register_content_domains()` 里调用
   `from app.modules.moments import wiring as moments_wiring; moments_wiring.register()`。
   **不登记 = 匿名读动态图片一律 404**（默认拒绝是刻意的安全默认值）。
   `registered_contributions()` 的期望值是 `('moments', 'posts', 'tags:moments', 'tags:posts')`。
4. **迁移**：由 T00 生成单一 head（三张表 + 上述约束与索引）。T03 **没有**写迁移文件、
   没有执行迁移、没有改 `model_registry.py`。

### B. 前端接线

5. **手机应用登记**（`features/phone/registry.ts` 归 T00）。清单取值如下，可原样登记：

```ts
import { INS_MANIFEST } from "@/features/ins/phone-manifest";
export const PHONE_APPS: readonly PhoneAppManifest[] = Object.freeze([INS_MANIFEST]);
```

| 字段 | 取值 |
| --- | --- |
| `id` | `"ins"` |
| `name` | `"INS"` |
| `subtitle` | `"图文动态 · 相册与消息后续接入"` |
| `icon` | `/assets/legacy/img/icon/joker.webp`（仓库内真实存在，T02 迁移的旧站素材） |
| `order` | `10` |
| `kind` | `"embedded"` |
| `canonical_path` | `"/apps/ins"` |
| `loader` | `async () => import("@/features/ins/phone-app")`（该模块 `export default InsPhoneView` + `export const screens = ["feed","detail","saved"]`） |
| `feature_flag` | `null` |
| `state_version` | `1`（对应本机收藏键 `ins.favorites.v1`） |

6. **组合接口**（T06 / T07 / T08 用，T00 接线，本包只定义契约）：
   - 页签注入：`<InsShell tabContributions={[{id, label, ariaLabel, order, isAvailable?, render}]} />`，
     内置页签 id 是 `feed` / `saved`（外部不得占用，占用会抛 `InsTabConflictError`）。
     **`isAvailable()` 返回 false 的页签完全不渲染**；不注入就没有按钮（没有「敬请期待」）。
   - COOP 入口：`<InsShell profile={{ coop: <T07 的组件 /> }} />` 渲染在头像区；
     不注入时不渲染任何友链入口。
   - 手机侧：`features/ins/phone-app.tsx` 的 `screens` 只有 `feed/detail/saved`，
     **不含 `messages`** —— 未列出的 screen 由宿主正确回退桌面。
7. **`DEV_API_URL` 的构建期要求与一处真实缺口（重要）**：Next 的 rewrites 在
   `next build` 时固化，因此联调必须 `DEV_API_URL=http://127.0.0.1:8100 npm run build`
   再 `npm run start`；另外 **API 的 `CORS_ORIGINS` 必须包含 `http://127.0.0.1:3100`**，
   否则浏览器的写请求会被拒（见 §8 第 1 条）。

## 7. 未验证项及原因（不得当作已通过）

1. **Docker / 容器内运行**：Docker daemon 未运行，未做容器内联调（属 T10）。
2. **真机（Android / iOS）与软键盘、触控**：只有桌面 chromium；390/320px 只验证了
   布局与横向溢出，没有真机手势。**多图左右滑动**因此也没有真机证据（按钮与键盘路径
   已在浏览器里验证）。
3. **Safari / Firefox**：未测。`useSyncExternalStore` + `localStorage` 的降级路径有单测，
   但真实隐私模式未验证。
4. **音频真的出声**：无头 chromium 无音频设备；只断言了「预览期间 `audio[data-pl-music]`
   数量不增加」。
5. **跨浏览器并发编辑**：412 有 API 测试与组件测试，但没有两个真实浏览器同时编辑同一条
   的端到端录制。
6. **本机收藏的真实浏览器取数**：收藏列表在浏览器里读过（`/apps/ins/collections` 可打开），
   但**「收藏 → 刷新页面 → 仍在」这条完整链路没有截图证据**（组件测试覆盖了写入与
   重新确认逻辑）。
7. **相册 / 消息页签**：组合接口有单测（注入 / 不注入 / `isAvailable` 为 false），
   但 T06 / T08 的模块尚不存在，因此**没有任何真实组合**被验证。
8. **`/tags` 与文章共存的真实渲染**：T03 只验证了 `/tags` 的返回集合（含文章标签），
   没有验证「文章标签出现 in INS 筛选条」的观感 —— 当前实现只把**动态里真的出现过**的
   标签放进筛选条，首屏为空时才退回 `/tags`。
9. **迁移方向**：模型与迁移的一致性验证属 T00（本轮 T03 只提供 `created_by_fallback`
   报告与约束证据）。

## 8. 遗留与需要外部选择的问题

1. **【需要决策，会阻塞管理写操作】浏览器 → Next(3100) 的同源 POST 不带 `Origin`**。
   真实浏览器实测：Chrome 只在跨源 / CORS 请求上发送 `Origin`，因此
   `Next(rewrite) → API` 的 POST 到了 API 时 `Origin` 为空，而 `app/core/csrf.py` 的
   `verify_origin` 按 05 §5「缺失 Origin 的状态变更请求一律拒绝」返回 403。
   这是**集成层形态与设计假设不一致**（05 §5 假设浏览器直接同源访问 API），不是
   T03 的缺陷，T03 也不改 `app/core/`（T01 所有）。
   候选处理（请 T00 / T01 决定）：
   - (a) 网关 / Next 转发时补 `Origin`（本次联调用的是这个，见 §5.2 的脚手架）；
   - (b) 生产形态下浏览器直连同源 API（不经过 Next 的 rewrite），此时 `Origin` 与 `Host`
     自然一致；
   - (c) 在 `verify_origin` 的语义里把「完全没有 `Origin` 且 `Sec-Fetch-Site: same-origin`」
     视为同源。
   注：T01 交付单 §7 第 6 条早就指出共享客户端缺 `headers` 选项，登录页当时也因此
   只能走 body 字段；本条的**根因不是 token 传输方式**，而是 `Origin` 头本身缺失。
2. **`/admin` 只提供入口，不做路由保护**：这是 01 §3 的安排（权限在后端），
   但当前 `app/admin/moments` 在**服务端渲染**时会先读一次会话，未登录时显示明确提示
   而不是白屏 —— 若 T00 想改成重定向到 `/admin/login`，请按所有权申请改 `app/admin/layout.tsx`。
3. **分享与收藏的排序/上限策略**：收藏上限 200 条（超出丢最旧），分享优先
   `navigator.share`、回落剪贴板、再回落可复制的输入框。这两个数值没有外部依据，
   如需调整请指定。
4. **`excerptOf` 的截断长度**（卡片 140 码点、预览标题 40）与标签筛选条的展示上限
   （当前不设上限）都是观感参数，等真实内容变多后可再调。
5. **图片预览的焦点陷阱**：当前只保证「打开时焦点进关闭按钮、关闭时还给触发元素」，
   没有做完整的 Tab 循环（`aria-modal` 已声明）。若 T10 的无障碍验收要求焦点陷阱，
   需要扩展 `features/ins/image-preview.tsx`（属本包，可回改）。
6. **`.next` 是共享构建产物**：本次联调为了 `DEV_API_URL` 重建过它（现已用同一变量重启
   `next start`，3100 在跑）。做最终集成回归前请用**你自己的 `DEV_API_URL`** 重新
   `npm run build`（或清掉 `DEV_API_URL`），否则 `/api/v1` 会被转发到已停止的 8100。
7. **联调脚手架未入库**：`.dsh/t03-smoke/` 在 `.dsh/` 下（工作区临时目录），
   不属于仓库内容；其中的 `sitecustomize.py` / `prepare.py` / `reset.py` /
   `browser-verify.py` 记录了完整复现步骤。要不要把它整理成仓库内的
   `tools/browser-verification/ins-*.py`（像 T02 那样）由 T00 决定。
8. **`PHANTOM_POSTS_SOURCE=api` 需要重新构建**（见 §5.2 补充证据）：打开 API 数据源后
   `/posts/[slug]` 必须变成 Dynamic，否则运行时 500。这是 T02 的所有权范围，T03 只报告。
9. **当前工作区的 3100 状态**：为了本次联调，`.next` 是用 `DEV_API_URL=http://127.0.0.1:8100`
   构建的，而**我的 API 进程已停止**。`next start` 仍在 3100 跑着（避免再动别人端口）。
   做最终集成回归前请用你自己的配置重新 `npm run build`；否则 `/api/v1` 会转发到 8100
   并失败（届时 `/apps/ins` 会显示明确失败态而不是空列表，这是设计行为）。

## 9. 复现命令

```bash
cd /Users/学习/blog/Blogs
export npm_config_cache=/Users/学习/blog/.dsh/npm-cache
export UV_CACHE_DIR=/Users/学习/blog/.dsh/uv-cache
export TEST_DATABASE_URL="postgresql+psycopg://pl@127.0.0.1:55432/pl_test"

# 后端（自建 pl_test_t03_<pid>，用例结束自动 drop）
uv run --project apps/api pytest apps/api/tests/moments          # 65 passed
# 前端
npm --prefix apps/web run typecheck && npm --prefix apps/web run lint
npm --prefix apps/web run test -- --run                          # 304 passed
DEV_API_URL=http://127.0.0.1:8100 npm --prefix apps/web run build
# 旧站零回归
node --test tests/*.test.cjs                                     # 53 passed

# 真实浏览器闭环（需要 §5.2 说明的三件套：联调库 + API + Web）
APP_ENV=dev DATABASE_URL="$TEST_DATABASE_URL" SECRET_KEY=… \
  uv run --project apps/api python .dsh/t03-smoke/prepare.py     # 建库 + 真实迁移 + 建站主
T03_SMOKE_WIRING=1 PYTHONPATH=".dsh/t03-smoke:apps/api" \
  APP_ENV=dev DATABASE_URL=…pl_test_t03_smoke SECRET_KEY=… \
  MEDIA_ROOT=.dsh/t03-smoke/media CORS_ORIGINS=http://127.0.0.1:3100 \
  uv run --project apps/api uvicorn app.main:app --port 8100
DEV_API_URL=http://127.0.0.1:8100 npm --prefix apps/web run start
python3 .dsh/t03-smoke/browser-verify.py                         # 27/27 passed
```

清理：临时库由夹具自动 drop；`pl_test_t03_smoke` 与 `.dsh/t03-smoke/media` 是联调用的
工作区临时对象，可随时删除。
