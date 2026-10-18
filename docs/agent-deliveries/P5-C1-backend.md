# P5 · C1 后端交付单（工作草稿 + 管理侧媒体 + owner-status）

> 任务：P5 第一批后端全部实现（设计书 §3、契约 §3/§9）。
> 契约：`docs/agent-deliveries/P5-C0-integration-contract.md`（唯一接口约定）。
> 状态：**实现完成、隔离库全树验证通过**（1025 通过 / 0 失败，见 §五）；未 `git commit`，由 Lead 统一提交。
> 日期：2026-10-18/19。

---

## 一、实际修改 / 新增文件清单

### 新增

| 路径 | 说明 |
|---|---|
| `apps/api/app/modules/work_drafts/schemas.py` | 工作草稿 DTO：创建/更新/提交请求、`WorkDraftOut`/`ListOut`/`CreateOut`/`CommitResultOut`、草稿期 `data` 校验、图片归一、摘要派生 |
| `apps/api/app/modules/work_drafts/service.py` | 六接口业务实现 + commit 事务/双版本/幂等 + 并发锁 + 丢弃语义 |
| `apps/api/app/modules/work_drafts/router.py` | 六个路由（见 §二），ETag / 状态码 / 错误码接线 |
| `apps/api/migrations/versions/20261018_2342_747d6fd473d9_t10_work_drafts_and_media_retention.py` | 唯一新迁移：`work_drafts` + `work_draft_media` + 3 个索引/部分唯一索引 |
| `apps/api/tests/work_drafts/__init__.py`、`conftest.py`、`helpers.py` | 本包隔离夹具（私有临时库 `pl_test_c1_<pid>`，真实迁移 + 真实事务回滚验证） |
| `apps/api/tests/work_drafts/test_draft_crud.py` | 创建/复用/列表分页/详情/PATCH 428/412/未知字段/图片语义/丢弃/匿名 401/越权 404 |
| `apps/api/tests/work_drafts/test_commit_moment.py` | moment 提交动作矩阵、双版本、幂等、相册来源、回滚、原子性 |
| `apps/api/tests/work_drafts/test_commit_journal.py` | journal save≠publish、私密/公开、更新已公开、回滚、幂等 |
| `apps/api/tests/work_drafts/test_concurrency.py` | 并发 PATCH / 并发创建复用 / 同 key 并发回放 / 不同 key 409（独立连接 + 线程） |
| `apps/api/tests/work_drafts/test_boundaries.py` | 越权 404、草稿图片不授予匿名访问、丢弃不影响正式内容/其他引用、无公开草稿端点 |
| `apps/api/tests/work_drafts/test_migration.py` | upgrade→downgrade→upgrade + 旧数据/公开范围/相册来源保留、单一 head |
| `apps/api/tests/media/test_admin_media_api.py` | 管理侧媒体列表/详情（自带临时库，避免污染 T01 共享夹具库） |
| `apps/api/tests/auth/test_owner_status.py` | owner-status 无副作用（不建会话/不写库/不 touch last_seen_at） |

### 修改

| 路径 | 说明 |
|---|---|
| `apps/api/app/modules/work_drafts/models.py` | 补 `committed_target_version` 列、`(owner_id, commit_key)` 部分唯一索引、注释；`draft_version` 保留 |
| `apps/api/app/modules/moments/service.py` | 抽出 `_assert_publishable`；新增 `write_moment_pending`（**不 commit** 的外层事务调用路径，供 commit 复用现有校验与关系写入） |
| `apps/api/app/modules/journal/service.py` | 新增 `write_entry_pending`（同上，复用 `_assert_media_usable` / `_replace_images` / `_publish_requirement`） |
| `apps/api/app/modules/media/service.py` | 新增 `list_admin_media`（分页）/ `get_admin_media`（详情）/ `clamp_limit` |
| `apps/api/app/modules/media/schemas.py` | 新增 `MediaAdminReferenceOut`（`MediaAdminOut` + `publicly_referenced`）、`MediaAdminListOut`、`media_admin_reference_out` |
| `apps/api/app/modules/media/router.py` | 新增 `GET /admin/media`、`GET /admin/media/{id}`（上传接口契约未动） |
| `apps/api/app/modules/auth/schemas.py` | 新增 `OwnerStatusOut` |
| `apps/api/app/modules/auth/router.py` | 新增 `GET /auth/owner-status`（只读会话、不建预登录会话、不写库） |
| `apps/api/tests/test_module_registration.py` | `EXPECTED_TABLES` 增加 `work_draft_media` / `work_drafts`（登记新表是刻意的） |
| `apps/api/tests/gallery/test_migration_sources.py` | 原断言固定 `version == b7c3e9a1d2f4`，新迁移后 head 变了；改为**动态取当前 head**（这是新增迁移的必然连带修改，不改测试语义） |
| `contracts/openapi.json` | 重新导出（85 → **90** 路径） |
| `apps/web/lib/api/generated/schema.ts` | `npm run gen:api` 重新生成（只在 C1 侧更新生成文件） |

**未改**：`app/router.py`、`app/model_registry.py`（Lead 已登记 `work_drafts`，未触碰）；前端其它文件；`tools/**`。

---

## 二、接口说明（全部 `/api/v1`）

### 2.1 工作草稿 `/admin/work-drafts`

| 方法 | 路径 | 鉴权 | 行为 |
|---|---|---|---|
| POST | `/admin/work-drafts` | `require_admin_write` | 创建或恢复。已有 target 且存在 active 草稿 → **200** `{draft, reused:true}`（请求里的 data/images 不覆盖既有草稿）；否则 **201** `{draft, reused:false}`。`target_id` 不存在 / 已删除 / 非站主动态 → 404 |
| GET | `/admin/work-drafts?content_type=&cursor=&limit=` | `require_admin` | 仅本人 **active** 草稿；`updated_at DESC, id DESC`；`{items, next_cursor}`；`limit` 默认 12 / 最大 30；`content_type` 非法 → 422；切换筛选复用旧游标 → 400 |
| GET | `/admin/work-drafts/{id}` | `require_admin` | 详情（任何状态均可读，`status` 字段如实返回）；带 `ETag: "<draft_version>"`；不存在 / 非本人 → 404 |
| PATCH | `/admin/work-drafts/{id}` | `require_admin_write` + `If-Match` | 保存工作副本：锁行 → If-Match（缺失 428 / 不符 412）→ `data` 浅合并（未知键 422）→ `images` 省略=不动、给出=整组替换；成功 `draft_version+1`，响带新 ETag。非 active → 409 |
| POST | `/admin/work-drafts/{id}/commit` | `require_admin_write` + `If-Match` | 显式提交（见 §2.3） |
| DELETE | `/admin/work-drafts/{id}` | `require_admin_write` | active → discarded（204）；删除 `work_draft_media` 行、**保留草稿行**；非 active → 409；不删媒体文件、不动正式内容 |

DTO（契约 §3.3 + Lead 补充）：`WorkDraftOut = {id, content_type, target_id, target_version, draft_version, status, summary(≤120), data, images:[{media_id, position, alt, media: MediaAdminOut}], created_at, updated_at}`；`data` 按类型：
`moment = {text, tags[], album_links[{album_id, media_ids[]}]}`，
`journal = {entry_date(YYYY-MM-DD), title, content_md, mood, location, post_id|null}`。

草稿期校验（宽松、防坏数据，失败 422 字段级）：长度与正式一致（moment text≤2000、tags≤8 且单个≤24 码点；journal title≤200 / content≤20000 / mood≤24 / location≤80）、日期合法、媒体必须属于站主且 ready 未删除、未知 data 键 422。**草稿允许空 alt、允许 0 张图**；PATCH 的 `data` 只合并出现的键，`images` 省略/给出语义见契约。

### 2.2 commit（`POST /admin/work-drafts/{id}/commit`）

请求：`{action: save|publish|update, expected_target_version: int|null, commit_key: uuid}`；响应 `CommitResultOut = {draft_id, content_type, target_id, target_version, status, visibility, action, idempotent_replay}`。

实现顺序（契约 §9.3 逐条）：

1. `SELECT … FOR UPDATE` 锁草稿行；
2. **幂等回放优先于 If-Match**：committed + 同 `commit_key` → 直接回放（`idempotent_replay:true`，`target_version` 取 `committed_target_version`，不校验 If-Match）；committed + 不同 key → 409；discarded → 409；
3. 同一站主其他草稿已用过该 `commit_key` → 409（部分唯一索引 `(owner_id, commit_key) WHERE commit_key IS NOT NULL` 兜底并发）；
4. 校验 `If-Match`（428/412）→ 动作矩阵（409）→ `expected_target_version`（已有 target 缺失 → 422；不等于正式内容当前版本 → 412；新内容必须为 null，否则 422）；
5. 锁正式内容行（已有 target 时）→ 在**同一事务**内：写正式行 + 媒体关系（`moment_media` / `journal_entry_media`）+ 动态相册收录来源（`gallery.sources.validate_moment_album_links` / `replace_moment_album_links` / `prune_moment_album_links`，不直接写表）+ bump 相册版本 + 发布状态 + 写草稿 `status/commit_key/committed_target_id/committed_target_version` + 一条 `work_draft.commit` 审计，最后一次 `commit()`；
6. 任何失败 `rollback()`：草稿保持 active、正式内容不变，返回对应错误（正式内容校验失败统一 **422 VALIDATION_FAILED** + 字段，这是 commit 接口的契约差异）。

动作矩阵：

| 正式内容当前状态 | 允许 action |
|---|---|
| 新内容（无 target） | `save`（建正式草稿）/ `publish`（建并发布） |
| moment/journal 为 `draft` | `save` / `publish` |
| 已 `published` | `update`（不合法动作 → 409 且返回可行动作） |

版本语义：新内容 version 从 1 开始（一次提交一次版本）；已有内容每次提交 +1（发布不再额外 +1）。journal：`save` 只写 draft+private（不改变公开状态），`publish` 置 published+public 并复用「标题与正文非空」门槛；`update` 保持原 status/visibility，草稿 data 中未出现的字段保留正式内容原值。moment：`publish` 复用 1–9 张 ready 图片门槛；`update` 不刷新 `published_at`。

### 2.3 管理侧媒体

| 方法 | 路径 | 鉴权 | 行为 |
|---|---|---|---|
| GET | `/admin/media?cursor=&limit=&status=` | `require_admin` | 站主媒体分页，`created_at DESC, id DESC`，只列本人未删除媒体；**`limit` 默认 12、最大 30（沿用 `core.pagination`），超过 → 422**（FastAPI 参数校验，错误体字段 `query.limit`）；`status` 可选 `processing/ready/failed`，非法 → 422；列表项 = `MediaAdminOut` + `publicly_referenced` |
| GET | `/admin/media/{id}` | `require_admin` | 详情，同样带 `publicly_referenced`；非本人 / 已删除 / 不存在 → 404 |

`publicly_referenced` 走统一扩展点 `media.public_refs.is_publicly_referenced`（只读、带公开条件；未登记 = 不公开）。**已知偏差**：该扩展点只有逐 id 接口，本实现按页面（≤30）逐项调用；未新增「跨域批量检查」注册能力（见 §六）。

### 2.4 `GET /auth/owner-status`

- 200，响应恰好 `{authenticated: bool, user: {id, username}|null}`；`private, no-store`。
- 读会话但**不创建预登录会话、不写库、不 touch `last_seen_at`**（不调用 `require_admin`）。
- 匿名 / 预登录 / 过期 / 已注销 / 账号禁用 → `authenticated:false, user:null`。

---

## 三、迁移说明

`revision = 747d6fd473d9`，`down_revision = b7c3e9a1d2f4`（接在既有唯一 head 之后），单一 head。

- 新增 `work_drafts`：`id/owner_id(FK admin_users RESTRICT)/content_type/check/target_id(uuid null, 无外键多态)/target_version/data jsonb not null/status check/draft_version/commit_key/committed_target_id/committed_target_version/created_at/updated_at`；
- 新增 `work_draft_media`：复合主键 `(draft_id, media_id)`、`position 0–8` 唯一、`alt varchar(200) not null default ''`、FK `draft_id CASCADE` / `media_id RESTRICT`、索引 `media_id`；
- 索引：`uq_work_drafts_active_target`（partial unique：(owner_id, content_type, target_id) WHERE target_id IS NOT NULL AND status='active'）、`uq_work_drafts_owner_commit_key`（partial unique：(owner_id, commit_key) WHERE commit_key IS NOT NULL）、`ix_work_drafts_owner_updated`（owner_id, content_type, updated_at, id，正向 B-tree 支持 DESC 反向扫描）；
- **只新增两张表，不改任何既有表**，因此升级/降级都不丢旧内容、旧公开范围与相册来源关系；`test_migration_sync` 通过（模型与迁移无漂移）。

---

## 四、契约导出

- `uv run --project apps/api python apps/api/scripts/export_openapi.py` → `contracts/openapi.json`：路径 **85 → 90**（新增 `/admin/work-drafts`、`/admin/work-drafts/{draft_id}`、`/admin/work-drafts/{draft_id}/commit`、`/admin/media/{media_id}`、`/auth/owner-status`；`/admin/media` 增加 `get`）；`tests/test_openapi_contract.py` 通过。
- `cd apps/web && npm run gen:api` → `apps/web/lib/api/generated/schema.ts`（生成文件，仅 C1 更新）。

---

## 五、测试命令与真实结果

环境（每次 bash 均带）：

```sh
export UV_CACHE_DIR=/Users/学习/blog/Blogs/.dsh/uv-cache
export no_proxy=127.0.0.1,localhost,::1 NO_PROXY=127.0.0.1,localhost,::1
export LC_ALL=C
export TEST_DATABASE_URL=postgresql+psycopg://pl@127.0.0.1:55435/pl_test
export DATABASE_URL=$TEST_DATABASE_URL
export SECRET_KEY=dev-secret-0123456789abcdefghijklmnop APP_ENV=dev MEDIA_ROOT=/tmp/pl-test-media
```

1. 本包 + 新增测试（隔离集群 55436）：

```sh
cd apps/api
uv run pytest tests/work_drafts tests/media/test_admin_media_api.py tests/auth/test_owner_status.py -q
# → 73 passed
```

   - `tests/work_drafts`：58 例（crud 18 / moment commit 17 / journal commit 11 / 并发 4 / 边界 5 / 迁移 3）；
   - `tests/media/test_admin_media_api.py`：10 例；`tests/auth/test_owner_status.py`：5 例。

2. 受影响的既有套件（55436）：`tests/test_openapi_contract.py tests/test_module_registration.py tests/test_migration_sync.py tests/moments tests/journal tests/media tests/auth` → **全绿**。

3. 全树隔离验收（每个测试包私有库、独立 Postgres 集群）：

```sh
bash tools/verify-backend-isolated.sh 55435
# → PASS：1025 通过 / 0 失败（既有 952 基线 + 本批新增 73 例 = 1025；
#    数字来自脚本进度点统计，日志 /tmp/pl-backend-isolated-55435.log）
```

> 说明：全树脚本以「进度点」统计通过数（pytest `-q` 输出含回车覆盖），因此数字是解析值；
> 失败数为 0、退出码 0 是硬判据（本轮实测：进度点 1025、失败行 0、退出码 0）。
> 本轮第一次全树跑出的 1 个失败是
> `tests/gallery/test_migration_sources.py` 固定断言旧 head —— 新迁移后 head 变了，
> 已改为动态取当前 head（见 §一「修改」），复跑通过。
> 另有一次单跑 `tests/auth` 遇到 1 例既有 `test_login_rate_limit_returns_429_with_retry_after`
> 在**整分钟边界**（23:59→00:00 窗口翻转）偶发失败，紧接重跑全绿；与本次改动无关。

4. 迁移单独验证：

```sh
# test_migration.py：upgrade(b7c3e9a1d2f4) → 写旧数据 → head → downgrade -1 → head
# 断言：旧动态/手记/相册关系/相册来源行数与字段原样保留、新表可重复建删、单一 head
```

---

## 六、未完成项 / 已知偏差与风险（如实单列）

1. **media 列表的 `publicly_referenced` 未做跨域批量查询**：共享扩展点
   `media.public_refs` 只有逐 id `is_publicly_referenced`，没有批量注册接口；
   页面 ≤30 时逐项调用是有界的，但严格说仍是 N+1。若 C5/后续要求真正批量，
   需要给扩展点增加批量检查器（涉及 posts/moments/journal/gallery/projects/coop/leisure 七个域）。
2. **`GET /admin/media` 不支持 `q` 搜索**：契约 §3.4 标注「可省」（文件名不入库、id 前缀搜索价值低），本批未实现。
3. **幂等回放的 `action` 回显请求值**：草稿表没有 action 列，契约也未要求持久化 action；回放的
   `target_id`/`target_version`/`idempotent_replay` 是权威的，`status`/`visibility` 取正式内容当前值。
4. **commit 失败错误码差异**：正式内容发布校验失败在 commit 接口统一返回 **422**（契约 §3.3 要求），
   与既有管理写接口的 409 不同；这是刻意按契约实现，不是回归。
5. **草稿图片「未设置 vs 清空」不可区分**：`images` 省略=不动、给出=整组替换；提交时草稿的图片关系
   始终视为完整选择（编辑已有内容时前端需用本机恢复副本/正式内容初始化图片）。契约未要求区分。
6. **`GET /admin/work-drafts/{id}` 对 committed/discarded 也返回详情**（status 字段如实），
   列表只返回 active；这是为了让网络重试与审计能看到状态，未额外限制。
7. **真机未验证**：本轮无真机（触控/软键盘/中文输入法）——与前后端分工一致，C5 只做 WebKit+视口。
8. **未提交**：按规则不 `git commit/push`；工作区还包含其他 worker 的未提交改动，Lead 合并时请注意
   只提交 P5 相关路径（本单「修改/新增」清单即 C1 写作用域）。

---

## 七、给 C5 的验收提示

- 管理媒体默认分页：不传 `limit` 时 `limit=12`；`limit>30` → 422（错误字段 `query.limit`）。
- `GET /auth/owner-status` 无副作用：匿名调用前后 `sessions` 表行数不变；响应体只有
  `{authenticated, user}` 两个键；`Cache-Control: private, no-store`。
- 幂等：同一 `commit_key` 重试返回 `idempotent_replay:true` 且正式内容/媒体关系/相册来源不重复；
  不同 key、跨草稿同 key → 409。
- 事务回滚：发布校验失败（无图 / 空 alt / 非法相册 / 非法文章引用）与模拟提交前异常时，
  草稿仍 active、正式内容与相册来源不变（测试 `test_work_drafts/test_commit_*.py` 有逐条断言）。
