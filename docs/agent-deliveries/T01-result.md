# T01 · 交付单（文章、站主认证与共享媒体）

```text
任务：T01 / 文章、站主认证与共享媒体（后端基础 + 最小登录页）
状态：implemented_waiting_integration —— 代码、迁移与测试全部落地并真实跑通；
      集成动作（MODEL_MODULES / 路由登记 / wiring 登记 / 迁移）已由 T00 在
      main 分支工作区完成并复核，本单记录的是**可复核的增量与证据**，不是「应该没问题」。
基线：main @ 819c64d，开始时工作区干净（`git status --short` 为空）
      本轮 T01 未提交任何内容；未推送、未建分支 / worktree、未启动子 agent
外部影响：未调用任何模型或付费服务；未部署；未写入 pl_test（T00 的共享测试库）——
          验证只在自己的临时库 pl_test_t01 / pl_test_t01_empty 上进行
```

## 1. 范围

**已完成**：`app/core/` 共享能力扩展、`modules/{auth,media,posts,tags}`、两个 CLI 命令、
真实 readiness 端点、最小登录页与前端登录接线、117 个后端用例 + 26 个前端用例。

**未完成（有意不做）**：INS / 导航 / 消息 / 日常应用 / 展厅 / COOP / 成长（属 T03–T09）；
文章写接口与文章管理后台（05 §7 明确为后续独立功能）；公开注册、公共留言、真实投票统计；
管理外壳 `/admin` 的布局与受保护页面（T02）。现有静态站源文件与 `assets/` 未做任何改动。

## 2. 新增与修改文件

**修改（T00 交给 T01 所有的文件）**

```text
apps/api/app/core/config.py        + MEDIA_ROOT / MEDIA_MAX_* / 会话与限流参数 / TRUST_PROXY_HEADERS
                                   + safe_summary 增加媒体字段；既有环境变量语义未变
apps/api/app/core/errors.py        + CODE_RATE_LIMITED(429) / CODE_UNSUPPORTED_MEDIA_TYPE(415)
                                   + ApiError.headers（429 的 Retry-After）
                                   + DBAPIError → 503 处理器（数据库故障不伪装 404 / 空列表）
                                   + 错误响应统一带 Cache-Control: no-store
```

**新增（apps/api）**

```text
app/core/cookies.py        会话 Cookie 名与属性（生产 __Host-pl_session / 开发 pl_session_dev）
app/core/passwords.py      Argon2id 哈希、校验、needs_rehash、密码策略
app/core/csrf.py           CSRF token 派生与校验、Origin 同源 / 白名单校验
app/core/pagination.py     不透明游标编码 / 解码 + 筛选指纹（无效或不符 → 400）
app/core/preconditions.py  ETag / If-Match（缺头 428、版本不符 412、通配 400）
app/core/concurrency.py    有界图片处理（anyio CapacityLimiter + to_thread）
app/core/http.py           no_store / private_no_store 依赖 + 私有路径兜底中间件
app/core/deps.py           进程级 engine / sessionmaker、请求会话、媒体目录依赖
app/core/text.py           NFKC 规范化（标签 slug / 后续搜索共用）
app/core/health.py         真实 /health/ready：DB + schema + 媒体目录可写
app/modules/auth/{models,schemas,service,ratelimit,deps,router}.py
app/modules/media/{models,storage,pipeline,public_refs,service,schemas,router}.py
app/modules/tags/{models,schemas,service,router}.py
app/modules/posts/{models,schemas,service,router,public_refs,tags_source,wiring}.py
app/commands/{__init__,bootstrap_admin,import_legacy}.py
tests/core/{t01_db,test_shared_capabilities,test_health_readiness,test_schema_evidence}.py
tests/auth/{helpers,test_login_flow,test_bootstrap_admin}.py
tests/media/{helpers,test_pipeline,test_upload_api,test_media_access}.py
tests/posts/{helpers,test_public_posts,test_import_legacy}.py
tests/tags/test_public_tags.py
（每个测试目录含 __init__.py 与 conftest.py，conftest 只把 tests/core/t01_db.py 的夹具暴露给本目录）
```

**新增（apps/web，T01 独占）**

```text
features/auth/api.ts            共享 API 客户端上的会话 / 登录 / 注销
features/auth/validation.ts     输入校验 + 后端 code → 文案 + 字段错误映射
features/auth/api.test.ts       9 个用例（路径、body、写操作不重试、错误分类）
features/auth/validation.test.ts 10 个用例
app/admin/login/page.tsx        最小登录页（客户端组件）
app/admin/login/page.test.tsx   7 个组件用例（真实交互 + act）
```

`apps/web/app/admin/layout.tsx` 是 **T02** 新建的，不属于 T01；我的页面挂在它的外壳下。

## 3. 模型清单与迁移意图

模型已冻结并由 T00 生成单一 revision：
**`apps/api/migrations/versions/20261016_1729_f415083eb5d4_posts_tags_media_and_site_owner_tables.py`**
（8 张表 + 7 个索引；`alembic heads` 单头；空库与上一版库均可升级）。

| 模块 | 表 | 关键约束（数据库级） |
| --- | --- | --- |
| auth | `admin_users` | 唯一 `username`；`length(username)` 3–64 |
| auth | `sessions` | 唯一 `token_hash`；`expires_at > created_at`；`last_seen_at >= created_at`；`user_id` 可空（预登录）、FK→admin_users ON DELETE CASCADE；`ix_sessions_expires_at` |
| auth | `audit_events` | FK actor→admin_users ON DELETE SET NULL；`ix_audit_events_at`；`metadata` JSONB（属性名 `extra`，避免与 `Base.metadata` 冲突） |
| auth | `auth_rate_limits` | 唯一 `(key_hash, window_start)`；`count >= 0`；`ix_auth_rate_limits_expires_at` |
| media | `media` | 唯一 `storage_key`；FK owner→admin_users ON DELETE RESTRICT；`status in (processing, ready, failed)`；`bytes >= 0`；`width > 0 and height > 0`；`length(sha256) = 64`；`ix_media_sha256`、`ix_media_created_at`；`variants` JSONB |
| tags | `tags` | 唯一 `slug` |
| tags | `post_tags` | 复合主键 `(post_id, tag_id)`（即组合唯一）；双 FK ON DELETE CASCADE |
| posts | `posts` | 唯一 `slug`；FK cover→media ON DELETE SET NULL；`status in (draft, published)`；`version >= 1`；**部分索引** `ix_posts_public_listing (published_at, id) WHERE status='published' AND deleted_at IS NULL`；`ix_posts_category_published_at` |

迁移由 T00 生成与执行，并已在空库与上一版测试库两个方向验证；T01 侧另有一条交叉证据
（`tests/core/test_schema_evidence.py`）：本会话的表必须由真实迁移建出，否则用例失败。

## 4. 端点为集成增量（05 §6 / §7 已规定者不含在「增量」内）

| 方法与路径 | 来源 | 说明 |
| --- | --- | --- |
| `GET /api/v1/posts` | 05 §6 | category / tag / cursor / limit（12，最大 30），`{items, next_cursor}` |
| `GET /api/v1/posts/{slug}` | 05 §6 | 草稿 / 删除 / 未到发布时间 / 不存在统一 404 |
| `GET /api/v1/tags` | 05 §6 | 只返回有公开文章的标签；草稿专用标签不出现 |
| `GET /api/v1/media/{id}/{variant}` | 05 §6 | 变体枚举 `original` / `w320.webp` / `w640.webp` / `w1280.webp` |
| `POST /api/v1/admin/media` | 05 §7 | multipart 单图上传，201 返回 ready 元数据 |
| `GET /api/v1/auth/session` | 05 §7 | 无会话时建立 10 分钟预登录会话并返回 CSRF token |
| `POST /api/v1/auth/login` | 05 §7 | 校验 Origin + CSRF + 限流 → 认证 → 轮换会话 |
| `POST /api/v1/auth/logout` | 05 §7 | 204；无有效会话时幂等清 Cookie |
| `GET /api/v1/health/ready` | 06 §3（T01 任务卡第 8 条） | **新增**：DB + schema + 媒体目录；未就绪 503 |

**T01 定义的、文档未规定的传输细节（请登记为约定）**

1. **健康端点响应形状**：`{"status":"ready"|"not_ready","service","version","checks":{"database","schema","media_storage"},"checked_at"}`；
   就绪 200、未就绪 **503**，**不使用错误信封**（它是编排器读的状态信号，不是业务错误）。
   检查值为状态词 `ok` / `unavailable` / `not_migrated` / `missing` / `not_writable`；
   不比较具体 revision 号（写死版本号会在每次迁移后变成假告警），而是校验
   `alembic_version` 单行 + 运行时模型声明的表是否都已落库。
2. **CSRF token 传输**：优先请求头 `X-CSRF-Token`；同时接受 JSON body 字段 `csrf_token`
   与表单字段 `csrf_token`（multipart / urlencoded）。三者校验完全一致（常量时间比较）。
   最小登录页当前用 body 字段，因为共享客户端还没有 `headers` 选项（见 §7 第 6 条）。
3. **错误响应统一带 `Cache-Control: no-store`**（信封形状不变）。
4. **公开读取 `Cache-Control: no-store`；管理 / 认证响应 `private, no-store`；媒体响应
   `private, no-store` + `X-Content-Type-Options: nosniff`**（01 §6、05 §7/§8）。
5. **媒体变体命名**：`original`（原图，仅站主）/ `w320.webp` / `w640.webp` / `w1280.webp`；
   不放大超过原图宽度，因此小图可能只有部分变体（上传响应里的 `variants` 是权威清单）。
   未知变体名、非 UUID、不存在的 UUID、路径穿越一律 **404**（不区分「不存在」与「无权」）。
6. **旧日期导入约定**：`display_date`（只有日期）→ `published_at` = 该日期 **UTC+8 当天 00:00**
   （常量 `LEGACY_TIMEZONE`，见 `app/commands/import_legacy.py` 顶部 docstring）。
   已存在文章的 `published_at` 与 `status` 永不被重新导入覆盖（撤回过的文章不会被悄悄重新发布）。

## 5. 验证（全部实际执行，命令与退出码）

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `uv run --project apps/api pytest apps/api/tests` | 0 | **171 passed**（T00 的 54 + T01 的 117），1 个第三方 DeprecationWarning |
| `… pytest apps/api/tests/core` | 0 | 37 passed |
| `… pytest apps/api/tests/auth` | 0 | 23 passed |
| `… pytest apps/api/tests/posts` | 0 | 18 passed |
| `… pytest apps/api/tests/media` | 0 | 33 passed |
| `… pytest apps/api/tests/tags` | 0 | 6 passed |
| `npm --prefix apps/web run test -- --run features/auth app/admin/login` | 0 | **26 passed / 3 files** |
| `npm --prefix apps/web run test -- --run` | 0 | 159 passed / 16 files（含 T02 在途用例） |
| `npm --prefix apps/web run typecheck` | 0 | tsc 无输出 |
| `npm --prefix apps/web run lint` | 0 | eslint 无告警 |
| `npm --prefix apps/web run build` | 0 | 路由表含 `○ /admin/login`（静态预渲染） |
| `node --test tests/*.test.cjs` | 0 | **53 passed / 0 failed** —— 旧站零回归 |

前置：`export TEST_DATABASE_URL="postgresql+psycopg://pl@127.0.0.1:55432/pl_test"`。
没有它时数据库用例**skip 并说明原因**，不会退化成 SQLite。

### 5.1 真实 PostgreSQL（不是 SQLite，也不写共享库）

T01 夹具在同一个本机测试集群上自建 **`pl_test_t01`**（迁移 + 建表）与
**`pl_test_t01_empty`**（始终为空，用于 readiness 的未迁移分支），用例结束即 drop；
名字硬编码并再经 `assert_test_database_url` 校验，只有这两个名字允许被删除。
`pl_test`（T00 的共享夹具库）本轮**零写入**：
`select count(*) from posts|media|admin_users|tags` 全为 `0`。

约束证据（`tests/core/test_schema_evidence.py`）：`uq_admin_users_username`、
`ck_media_status_valid`、`ck_posts_status_valid`、`uq_posts_slug`、
`ix_posts_public_listing`（部分索引定义含 status / deleted_at）均由 PostgreSQL 实际执行 / 存在。

### 5.2 真实服务（uvicorn，非 Docker）

```text
APP_ENV=dev DATABASE_URL=…/pl_test MEDIA_ROOT=/tmp/pl-t01-media \
  uv run --project . uvicorn app.main:app --host 127.0.0.1 --port 8123

GET /api/v1/health/live                       → 200 {"status":"ok",…}  响应头含 x-request-id
GET /api/v1/health/ready（媒体目录存在）        → 200 ready，checks 三项全 ok
GET /api/v1/health/ready（运行中删除媒体目录）   → 503 not_ready，media_storage=missing
GET /api/v1/health/ready（恢复目录后）          → 200 ready
GET /api/v1/posts                              → 200 {"items":[],"next_cursor":null}
POST /api/v1/admin/media（未登录）              → 401 UNAUTHORIZED
GET /api/v1/media/000…000/w320.webp             → 404 NOT_FOUND
```

**「运行中删目录 → 立刻 503 → 恢复后 200」这条是本轮最重要的 readiness 证据**：
它证明就绪是每次请求的真实检测，不是启动时算好的一次性标志。

### 5.3 真实 CLI

```text
python -m app.commands.import_legacy --dry-run --json --repo-root …/Blogs
  → exit 0；{"dry_run":true,"total":8,"created":8,"updated":0,"unchanged":0,"issues":[]}
     slugs 与 assets/js/posts.js 的 8 篇逐一对应；库内 0 行（dry-run 不写）
python -m app.commands.bootstrap_admin --username ab --password-stdin <<< short
  → exit 2（用户名长度），stderr 只有策略原因，无密码 / 哈希 / 连接串
```

### 5.4 浏览器（真实 Chromium，Playwright；无 mock）

页面 `http://127.0.0.1:3100/admin/login`（`next start`），320×568 / 390×844 / 1280×800：

| 检查 | 结果 |
| --- | --- |
| 表单与标签 | 自有 h1、`label[for=username/password]`、`type=password`、`autocomplete=username/current-password` 全部存在 |
| 横向溢出 | 320 与 390 下 `scrollWidth == clientWidth`（无横向滚动条） |
| 键盘 | Tab：用户名 → 密码 → 提交；Enter 提交空表单 → 「请输入用户名 / 请输入密码」，`aria-invalid=true`、`aria-describedby=username-error` |
| 失败状态 | 预览环境无同源 `/api/v1` 代理 → 明确显示「服务返回了非契约响应（HTTP 404）」+「重新连接」按钮，不静默空白；填了用户名后提交失败仍保留输入 |
| 凭据本地化 | 页面自身不写 localStorage / sessionStorage（快照里的键来自 T02 的站点运行时，与本页无关） |

截图：`.dsh/screenshots/t01/login-mobile320.png`、`login-mobile390.png`、`login-desktop.png`、
`login-390-keyboard.png`（`full_page`，位于仓库外的工作区临时目录，未入库）。

交互提示（不是缺陷，供 T10 记录）：T02 的启动闸门 `#boot` 会覆盖首屏并拦截指针事件，
需先点击一次才消失；键盘路径不受影响（Tab / Enter 可用）。

## 6. 必须有的测试逐条对照

| 任务卡要求 | 用例位置 | 关键断言 |
| --- | --- | --- |
| 已登录站主读公开 posts / tags 仍无草稿、私密字段、草稿专用标签 | `tests/posts/test_public_posts.py::test_logged_in_admin_still_gets_public_view_only` | 登录后列表只有公开文章；键集恰为 9 个公开字段；响应文本不含 `storage_key`/`sha256`/`version`/`status`/`deleted_at`/`original`；草稿详情 404；草稿标签不在 `/tags` |
| 跨站登录 / 发布、旧会话、注销后复用被拒；预登录无管理权 | `tests/auth/test_login_flow.py`（4 个用例） | 跨站 Origin 与缺 Origin 均 403；登录轮换会话与 CSRF，旧 Cookie 再上传 401；注销后复用 401；预登录 + 正确 CSRF 上传仍 401 |
| 假 PNG / 损坏图 / >8 MiB / 像素超限 | `tests/media/test_upload_api.py`（4 个用例）+ `test_pipeline.py` | 415 / 422 / 413 / 422；每次拒绝后 `media` 表无 ready 行且媒体目录 0 个文件 |
| EXIF 方向 / GPS | `tests/media/test_pipeline.py::test_exif_orientation_applied_and_metadata_removed` + 上传用例 | 600×400 orientation=6 → 400×600；派生图 `getexif()` 为空、无 APP1 段、相机型号与 GPS 字符串不在字节里；PNG 文本块也被清掉 |
| 变体猜测 / 未关联媒体 / 原图 / 路径穿越 | `tests/media/test_media_access.py` | 12 种猜测与穿越写法全部 404；未关联 / 草稿封面 / 已删除 / processing 均 404；匿名原图 404 而站主 200；文件缺失时 404 |
| 一张图两处公开引用，撤回一处 / 全部 | `tests/media/test_media_access.py::test_two_public_references_one_revoked_still_public` + `test_retracting_the_post_revokes_the_media` | 撤回一处仍 200；全部撤回后 404；反向顺序同样成立 |
| 写文件失败 / DB 提交失败 | `tests/media/test_upload_api.py`（2 个用例） | 磁盘故障 → 503 且已写入的半截对象被清理；提交失败 → 503、无 ready 记录、4 个对象留在盘上并被 `list_orphan_objects` 全部报为未引用 |
| 重复导入 / 缺失 slug / DB 断线 | `tests/posts/test_import_legacy.py`、`tests/posts/test_public_posts.py::test_database_failure_is_503_not_404_or_empty_list` | 二次导入 created=0 / unchanged=8；发布时间不变为导入日；缺 slug / 坏日期 / 空正文被报告而不导入；DB 断线时列表、详情、标签全 503（不是 404、不是空列表） |

补充覆盖（任务卡与 05 §10 要求但未单列在上表）：分页同时间戳稳定（5 篇同秒、limit=2 翻 3 页、
无重无漏）、游标与筛选绑定（换 category 复用旧游标 400）、limit 边界（0/31 → 422，30 → 200）、
全角与大小写标签归一、会话绝对 / 空闲过期与节流写入（`now` 注入）、禁用账号立即失效、
登录限流 429 + `Retry-After`、成功登录清空失败桶、审计事件不落密码。

## 7. 集成申请（T00 已应用的部分标注「已接线」）

1. **依赖（已应用）**：`pillow>=12.3.0`、`argon2-cffi>=25.1.0`、`python-multipart>=0.0.32`
   （实测锁定 pillow 12.3.0 / argon2-cffi 25.1.0 / python-multipart 0.0.32）。
   理由：图片解码 / 变体 / EXIF（pillow）、Argon2id 密码哈希（argon2-cffi）、
   multipart 上传解析（python-multipart，FastAPI 的 `UploadFile` 必需）。
2. **模型注册（已接线）**：`MODEL_MODULES = ("app.modules.auth.models", "app.modules.media.models",
   "app.modules.tags.models", "app.modules.posts.models")`。
3. **路由登记（已接线）**：`auth → /auth`、`posts → /posts`、`tags → /tags`、
   `media → ""`（内部组合 `/media` 与 `/admin/media`）、`health → /health`。
4. **内容域扩展点（已接线）**：`app/main.py` 调 `app.modules.posts.wiring.register()`，
   一次性登记媒体公开引用检查（`posts`）与公开标签来源（`tags:posts`）。
   只登记前者会让 `GET /tags` 永远返回空数组 —— 两者必须同进同退。
5. **环境变量（已应用）**：`MEDIA_ROOT`（默认 `apps/api/var/media`，生产为媒体卷挂载点）、
   `MEDIA_MAX_CONCURRENCY`（默认 2）；`deploy/compose.dev.yaml` 的 api 服务与 `deploy/env.example`
   已同步（`MEDIA_ROOT` 与 `media_data` 挂载点一致）。
   另有带默认值、可按需暴露的：`MEDIA_MAX_BYTES`(8 MiB)、`MEDIA_MAX_PIXELS`(40MP)、
   `MEDIA_MAX_SIDE`(8192)、`SESSION_ABSOLUTE_TTL_SECONDS`(8h)、`SESSION_IDLE_TTL_SECONDS`(30m)、
   `PRELOGIN_TTL_SECONDS`(10m)、`LOGIN_RATE_LIMIT_PER_MINUTE`(5)、`TRUST_PROXY_HEADERS`(false)。
6. **前端（待 T02 交付后统一处理，当前不阻塞）**：`lib/api/client.ts` 的
   `ApiRequestOptions` 增加 `headers?: Record<string, string>`，让写操作能带 `X-CSRF-Token`。
   服务端两种传输都已支持并测试，因此这是「更方便」而非「必须」。
   `next.config.ts` 的 dev rewrite 同理：目前预览环境无同源 `/api/v1`，登录页在浏览器里
   只能显示失败态（§5.4），成功路径由 vitest 组件测试覆盖。
7. **前端登录接线**：登录页是 `app/admin/login/page.tsx`，已在 T02 的 `app/admin/layout.tsx`
   外壳下渲染（实测截图见 §5.4）；不需要 T02 额外改动即可访问。
8. **可见性清单**：T01 需要 T02 在管理外壳里提供「已登录 / 未登录」入口（例如未登录跳到
   `/admin/login`）。T01 只提供页面与会话 API，不做路由保护 —— 隐藏按钮不是安全边界（01 §3）。

## 8. 未验证项及原因（不得当作已通过）

1. **Docker / Compose 内的真实启动**：本机 Docker daemon 未运行，未做容器内
   readiness、媒体卷挂载与冷启动验证（属 T10）。
2. **浏览器里的登录成功路径**：预览环境没有同源 `/api/v1` 代理（`next.config.ts` 属 T02 /
   集成阶段），因此真实浏览器只验证到「读取会话失败 → 明确失败态 + 重试」；
   成功 / 401 / 429 / 注销交互由 vitest 组件测试覆盖（26 passed），**不是**浏览器证据。
3. **跨浏览器与移动端真机**：只用 Chromium（Playwright 自带版本）验证；Safari / Firefox /
   iOS 键盘行为未测。`prefers-reduced-motion` 对登录页无动画，未做专门验证。
4. **生产 Cookie 属性**：`__Host-pl_session` + Secure + HttpOnly + SameSite=Lax 由单元测试断言
   （`tests/core/test_shared_capabilities.py`），未在 HTTPS 真实域名下验证。
5. **代理头**：`TRUST_PROXY_HEADERS=true` 的分支只在单元层面覆盖（`client_ip`），
   未在真实反向代理后验证（属 T10）。
6. **上传的并发上限**：`MEDIA_MAX_CONCURRENCY` 的有界性用受控并发测试断言
   （不超过 2），未在真实多请求压测下测量吞吐与内存。
7. **旧封面导入的图片质量**：只断言「文件落位 + ready + 尺寸/变体正确」，
   未做人工目视比对（8 张封面已随导入流程复制到媒体目录，可人工抽检）。
8. **迁移本身的两个方向验证**（空库 / 上一版库）由 T00 完成，不在本单证据内；
   T01 只在 §5.1 提供「表由真实迁移建出」的交叉证据。

## 9. 遗留问题与需要的外部选择

1. **`media` 表的软删除不做物理清理**：`list_orphan_objects` 只报告（未引用对象 + 超过 7 天
   仍未 ready 的记录），实际删除需要保留期策略与备份确认（05 §8）。目前**没有**定时任务调用它，
   需要 T10 决定清理窗口与执行者。
2. **登录限流的 IP 来源**：默认用 TCP 对端地址；只有 `TRUST_PROXY_HEADERS=true` 才读
   `X-Forwarded-For`。上生产前必须确认网关确实覆写该头，否则限流会被绕过或误伤。
3. **管理侧媒体列表未实现**：T01 只提供上传（响应即权威元数据）与匿名读取。
   上传响应已含完整变体清单（含 `original`），因此「某变体是否存在」在管理侧可判定；
   公开端点维持统一 404 是有意的（不泄漏存在性）。
4. **`auth_rate_limits` 只有机会式清理**：每次登录尝试前清理过期桶（保留 24 小时）；
   如果站点长期没有登录流量，过期行会留存，需要 T10 的定期任务兜底。
5. **审计事件只覆盖 T01 的动作**（登录成功 / 失败、注销、CLI 初始化）。发布、上传、
   媒体删除等动作的审计由对应模块补（上传目前**没有**写审计，是有意的范围控制）。
6. **`sessions` 表名与后续访客会话必须分开**：T08 的访客会话凭证不要复用 `sessions`
   （05 §11 明确要求分离），否则站主会话与访客会话会互相影响。
7. **旧站 `posts.js` 仍是首页数据源**：本次只做「导入 + 幂等」，没有切换数据源。
   正式切换后不能继续双写（06 §8），切换动作属 T02 / T10。

## 10. 复现命令

```bash
cd /Users/学习/blog/Blogs
export TEST_DATABASE_URL="postgresql+psycopg://pl@127.0.0.1:55432/pl_test"

# 后端（含 T01 自建临时库的创建与销毁）
uv run --project apps/api pytest apps/api/tests            # 171 passed
# 前端
npm --prefix apps/web run test -- --run features/auth app/admin/login   # 26 passed
npm --prefix apps/web run typecheck && npm --prefix apps/web run lint && npm --prefix apps/web run build
# 旧站零回归
node --test tests/*.test.cjs                                # 53 passed
# 真实服务 readiness（先建媒体目录）
APP_ENV=dev DATABASE_URL="$TEST_DATABASE_URL" SECRET_KEY="t01-local-smoke-secret-key-0123456789abcdef" \
  MEDIA_ROOT=/tmp/pl-t01-media uv run --project apps/api uvicorn app.main:app --port 8123 &
curl -s http://127.0.0.1:8123/api/v1/health/ready           # ready/200
rm -rf /tmp/pl-t01-media && curl -s http://127.0.0.1:8123/api/v1/health/ready   # not_ready/503
```

清理：T01 的临时库由夹具自动 drop；媒体临时目录在 `/tmp` 下，可随时删除。
