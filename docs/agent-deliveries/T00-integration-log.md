# T00 · 集成台账

T00 在骨架交付后持续承担集成负责人（[T00 任务卡](../superpowers/plans/2026-10-16-agent-handoff/tasks/T00-foundation.md)「后续集成职责」）。
这份文件记录每次集成**实际做了什么、验证了什么、还差什么**，避免「模块测试通过」被当成「已集成」。

集成顺序固定（SHARED-CONTRACTS §6）：

```text
审阅变更 → 接线模块（router / models / phone manifest / 组合视图）
        → 生成单头迁移并核对 drop / 数据转换 / 公共可见性
        → 重新生成 OpenAPI 与前端类型
        → 检查共享媒体公开引用
        → 跑模块测试 + 跨模块测试
        → 更新 tasks.json 状态
```

**状态词汇**（不混用）：
`not_started` → `in_progress`（已派发）→ `implemented_waiting_integration`（模块自测通过，尚未接线，**尚未集成**）→ `integrated_verified`（接线完成且跨模块验证通过）→ `completed`。

## 集成记录

| 日期 | 包 | 动作 | 验证 | 提交 |
| --- | --- | --- | --- | --- |
| 2026-10-16 | T00 | 落库交接文档、固化基线、建工程骨架 | 三套测试 53 / 51 / 22 全过；服务实际启动 | `b64b654` `4691be5` |
| 2026-10-16 | T01（依赖部分） | `uv add pillow argon2-cffi python-multipart` | 锁定 12.3.0 / 25.1.0 / 0.0.32；加完依赖后 51 测试仍全过 | `7974d73` |
| 2026-10-16 | T01（部署部分） | compose 与 env.example 增加 `MEDIA_ROOT`、`MEDIA_MAX_CONCURRENCY` | `docker compose config` 渲染通过；`MEDIA_ROOT` 与 `media_data` 挂载点逐字一致 | `7974d73` |
| 2026-10-16 | 基线（旧站） | 浏览器证据自动化：`tools/browser-check/check.py` | 问卷 10/10 + 人群 14/14，退出码 0 | `7974d73` |
| 2026-10-16 | T01（在途审阅） | 提出并跟踪 429/415 与两个无归属共享能力 | 429 `RATE_LIMITED` + `Retry-After` 已落地；`app/core/pagination.py`、`app/core/http.py` 已建 | 2026-10-16 | **T01（正式接线）** | 收到模型冻结信号，执行完整集成序列 | MODEL_MODULES 写入 4 模块；5 个 router 登记；`posts.wiring.register()` 单点登记媒体引用与标签来源；生成单一迁移 `f415083eb5d4`（8 建表 + 7 建索引，部分索引谓词完整保留）；契约重生成 10 条路径、readiness 声明 503；前端类型重生成。**空库升级 → 9 表；上一版库升级 → 9 表；`alembic heads` 唯一**。API 测试 103 通过，旧站 53 通过 | `12eb417` |
| 2026-10-16 | T01（在途回归） | T01 改共享 `app/core/` 后复查契约 | 51 个 API 测试 + 9 个信封断言全过；`create_app()` 正常构建 | 待集成 |
| 2026-10-16 | T02（在途审阅） | 素材复制红线检查 | `apps/web/public/assets/legacy/` 只含 fonts/img/sfx（6.9M）；**未带入** 15M 商业音乐与 `.gitignore` 排除的 `assets/clip/` | 待集成 |
| 2026-10-16 | T00（预演） | 用 5 个假 router 预演 T01 的登记形态 | 6 条路径全部按预期解析；**空前缀 media** 正确挂在 `/api/v1` 下；`health/live`（核心）与 `health/ready`（T01）共存；路径顺序确定 | 无（仅验证） |
| 2026-10-16 | T00（自纠） | 契约测试原本断言 `/health/ready` **必须不存在** —— 这在 T01 接线后必红，且编码的是错误规则 | 改为编码真实不变量「要么不存在，要么必须能报 503」；**注入只声明 200 的假就绪验证它会失败**，还原后 52 项全绿 | `5f96086` |
| 2026-10-16 | T01（readiness 实证） | 直接调用 `readiness_report` 跑四种故障场景（未接线也能验） | 已迁移库→`ready`；从未迁移的库→`schema: not_migrated`；媒体目录不存在→`media_storage: missing`；DB 连不上→`database: unavailable`。**四例判断全对**，响应中无路径 / 连接串 / 库名，细节只进服务端日志 | 待集成 |
| 2026-10-16 | T01（媒体引用实证） | 验证 `media/public_refs.py` 的默认拒绝语义（SHARED-CONTRACTS §5 安全边界） | 空注册表→拒绝；注册后无引用→拒绝；任一域有公开引用→公开；私密引用不推翻公开引用；重复登记报错；`reset` 回到默认拒绝。**6 例全对** | 待集成 |
| 2026-10-16 | T02（在途预警） | 只读跑 `tsc --noEmit` 发现 3 个错误（会让 `npm run build` 必红） | `audio-service.tsx:124-125` 泛型收窄成字面量 `"on"`，掩盖了「用户上次关掉音乐」这条分支；`transition-layer.tsx:115` `onReady` prop 类型是 getter 但传了对象。已精确报给 T02，未改其文件 | 待处理 |
| 2026-10-16 | T01（迁移预演） | 在**不写任何迁移文件**的前提下，用 `compare_metadata` 预演 autogenerate | 4 个 models 模块导入无错、无表名冲突；注册 8 张表，与 05 §3 中 T01 范围内的表**逐一吻合**；T03/T04 的 6 张表（moments / palaces 系）**未被预建**（符合 05 §1）；预演产出 15 项变更（8 add_table + 7 add_index），含 05 要求的 `(published_at, id)` 公开列表索引 | 待 T01 声明模型定稿 |
| 2026-10-16 | T01（挂载预演） | 用**真实 router** 做挂载预演（`module_routers` 注入，不碰生产总路由） | `tags`（prefix `/tags`）与 `health`（prefix `/health`）可导入可挂载；**`auth` 与 `media` 导入失败** —— `csrf_token_for` 定义在 `auth/service.py` 却有三处从 `app.core.csrf` 导入，`media` 被传递导入连累。已精确报给 T01 并给出两种修法 | 待 T01 修复 |
| 2026-10-16 | T01（接线形态端到端） | 在**临时库**上按接线形态跑真实 HTTP：5 个 router 全挂载，`create_app()` 正常服务 | 9 项全对：`health/live` 200；`health/ready` 未迁移→**503 `not_migrated`**、迁移后→**200 `ready`**（证明了它不是恒真桩）；`posts` 200 且形状为 `{items:[],next_cursor:null}`；`posts/<坏 slug>` 真 404；**匿名读未关联媒体 → 404（默认拒绝在完整 HTTP 栈上成立）**；`POST /admin/media` 未登录 → 401；`POST /auth/login` 缺字段 → 422 契约错误。临时库与临时媒体目录已清理 | 待集成 |

## 待办队列

### 等 T01 文件落地后立刻做（现在接线会 `ModuleNotFoundError`，应用与 51 个测试一起红）

- [x] ~~写入 `MODEL_MODULES`：`app.modules.auth.models` → `app.modules.media.models` → `app.modules.tags.models` → `app.modules.posts.models`（按依赖顺序）
- [x] ~~在 `app/router.py` 登记 5 个 router：`auth→/auth`、`posts→/posts`、`tags→/tags`、`media→""`（内部组合 `/media` 与 `/admin/media`）、`health→/health`
- [x] ~~在 `app/main.py` 显式注册（改为 `posts.wiring.register()` 单点）：`from app.modules.posts import public_refs as _posts_public_refs; _posts_public_refs.register()`（不注册 = 公开文章封面图对匿名 404，「安全但坏」）
- [x] ~~按 `MODEL_MODULES` 生成**单一**新 revision（建表 + 索引 + 唯一 / CHECK），核对 drop、数据转换、公共可见性
- [x] ~~迁移链验证：从**空库**升级 + 从上一版测试库升级；确认 `alembic heads` 只有一个
- [x] ~~重新生成 `contracts/openapi.json` 与 `apps/web/lib/api/generated/schema.ts`
- [ ] 跑 API 测试 + 跨模块测试；更新 `tasks.json` 状态

### 已提出、待应用

- [x] ~~`app/core/errors.py` 补 **429 `RATE_LIMITED`** 与 **415 `UNSUPPORTED_MEDIA_TYPE`**，并让 `ApiError` 能携带响应头~~ —— T01 已落地（429 + `Retry-After` 已在 `errors.py`），集成时审阅
- [x] ~~**游标分页共用件**（05 §6）~~ —— T01 已建 `app/core/pagination.py`（「不透明游标分页」），集成时审阅其过滤指纹与 400 语义
- [x] ~~**管理接口与媒体的 `Cache-Control: private, no-store`**~~ —— T01 已建 `app/core/http.py`（「共享缓存的默认关闭」），集成时确认是按路径统一施加而非各 router 自觉
- [ ] `apps/web/lib/api/client.ts` 的 `ApiRequestOptions` 增加 `headers?: Record<string, string>`，让写操作能带 `X-CSRF-Token`（属于 T02 的文件，等 T02 交付后统一加，T03+ 也会用）
- [x] ~~替换 `test_model_registry_is_explicit_and_has_no_tables_yet`~~ —— 已改为钉死 8 张表；同轮还修掉另一处写死 revision 号的脆弱断言：它的断言「registered_tables() == ()」是 T00 阶段的不变量（不许预建业务表），T01 接线后必然为假。新断言应改为把表集合钉死为 05 §3 中 T01 范围内的 8 张表，这样「有人悄悄加表却没更新清单」会失败
- [ ] 审阅 T01 新增共享件的归属：`concurrency / cookies / csrf / deps / health / http / pagination / passwords / preconditions / text` 共 10 个模块，确认没有把业务逻辑塞进 `app/core/`

### 等 T02 交付后做

- [ ] 审阅 `apps/web` 全量新增目录（含 `styles/`、`tools/` 等未在所有权表中列出的新目录），确认没有越过 `apps/web/app/globals.css` 之类的既定边界
- [ ] 确认问卷迁移后 `tests/poll-browser.html` 的**同一套 10 项断言**仍然通过（`tools/browser-check/check.py --page poll`）
- [ ] 手机接入的 registry 变更走 T00：`features/phone/registry.ts` 归 T00，T02 只提申请
- [ ] 旧站资产复制到 `apps/web/public/assets/legacy/` 后，核对没有把 `assets/clip/`（.gitignore 排除的官方过场影像）或商业音乐带进公开镜像
- [ ] 跑 `npm --prefix apps/web run typecheck|lint|test -- --run|build` 与旧站 `node --test tests/*.test.cjs`

## 已知的集成风险

1. **并行编辑**：T01 与 T02 共用一个工作区，靠目录独占隔离。集成前先 `git status` 确认没有第三方文件混入；我提交时只 `git add` 明确路径（已验证过一次没有夹带）。
2. **锁文件与共享配置**：任何包都不得自行改 `pyproject.toml` / `uv.lock` / `package.json` / `package-lock.json` / `tsconfig.json` / `next.config.ts`。需要就申请，由我一次性应用。
3. **单一 head**：模块不写 `migrations/`。一旦出现平行 head，`alembic heads` 会返回多个，交接计划明令禁止。
4. **迁移不由模块自证**：模块测试里的 `Base.metadata.create_all` 是临时手段，只证明 service 逻辑；真实迁移链的验证在 T00 这里。
| 2026-10-16 | T00（补接线遗漏） | T01 的 `install_private_cache_control` 写着「供 create_app 调用」但一直没装 | 已在 `create_app()` 装上。隔离验证：私有前缀下**忘了加头的端点在 200 时会被补上 `private, no-store`**，非私有前缀不受影响（T03+ 新增管理路由时这是兜底） | 见提交 |

## 一次自我纠正（2026-10-16）

排查「公开读 404 缺 `Cache-Control`」时，我先判断是我的中间件缺失所致，并据此外推出「中间件覆盖了异常响应」。**A/B 验证推翻了这个结论**：把中间件换成空操作后，404 仍然带 `no-store`。

真正的原因是 T01 在 `app/core/errors.py:135` 给所有错误响应默认加了 `Cache-Control: no-store`。两件事的真实分工是：

- **错误响应**（401 / 404 / 409 / 422 …）：由 `errors.py` 统一带 `no-store`，与中间件无关；
- **成功响应**：由各路由自行声明；`PrivateCacheControlMiddleware` 只对 `/api/v1/admin/`、`/api/v1/auth/`、`/api/v1/media/` 下**漏加头**的成功响应兜底。

记下来的理由：这类「以为是自己修的、其实是别人修的」结论如果不验证就写进交付单，会让后来者误判失效路径。
| 2026-10-16 | T00（新增迁移守卫） | 加入 `tests/test_migration_sync.py`：模型声明必须与 `upgrade head` 后的库结构一致，且声明的表都真实存在 | 反证验证：临时给 `Tag` 注入一列 `drift_probe` → 测试失败并指出 `Detected added column 'tags.drift_probe'`；还原后通过（`diff` 确认逐字节还原，T01 文件未被污染）。先跑一次漂移检查确认 T01 冻结点之后**未改模型**（无漂移） | 见提交 |

## 未决缺陷（2026-10-16）

`apps/api/tests/media/test_upload_api.py::test_upload_rejects_unknown_owner_session` 期望 **401**，实际 **201**（上传成功并返回完整 media 记录）。

- 实现侧已核查：`require_admin_write → require_admin → load_session`，`load_session` 的 SELECT 明确带 `revoked_at.is_(None)`，判断条件没有写漏。
- 因此怀疑点在**会话可见性**：该用例用第 216 行的 session 代理覆盖 `get_session`，并在 `t01_session` 上 `commit()` 注销；若 `t01_session` 处于外层未提交事务中，另一个连接将看不到这次注销。
- **对应验收矩阵「旧会话 / 注销后复用 → 被拒绝」。不得为了变绿而删除该用例或把断言放宽成 4xx**；三种可接受结局：改夹具、改实现、或确认是鉴权绕过并按缺陷修。
- 已请 T01 按「用另一个连接验证 `revoked_at` 是否真的置位」的顺序排查。
