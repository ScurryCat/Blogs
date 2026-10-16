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

## 已闭环：撤销会话上传用例（2026-10-16）

`test_upload_rejects_unknown_owner_session` 曾期望 401 却得到 201。T01 已修，**断言保持 `status=401, code="UNAUTHORIZED"`，实现未改**。根因是测试自己取错了行：`.first()` 无排序，登录轮换后拿到的是已注销的预登录会话。新写法改为「注销所有未注销会话 + 断言 `rowcount == 1`」，顺带把「登录轮换后只剩一个有效会话」也变成断言，比原来更强。T00 已复核未出现 xfail/skip/放宽状态码的痕迹。

原始记录（保留以供追溯）：

- 实现侧已核查：`require_admin_write → require_admin → load_session`，`load_session` 的 SELECT 明确带 `revoked_at.is_(None)`，判断条件没有写漏。
- 因此怀疑点在**会话可见性**：该用例用第 216 行的 session 代理覆盖 `get_session`，并在 `t01_session` 上 `commit()` 注销；若 `t01_session` 处于外层未提交事务中，另一个连接将看不到这次注销。
- **对应验收矩阵「旧会话 / 注销后复用 → 被拒绝」。不得为了变绿而删除该用例或把断言放宽成 4xx**；三种可接受结局：改夹具、改实现、或确认是鉴权绕过并按缺陷修。
- 已请 T01 按「用另一个连接验证 `revoked_at` 是否真的置位」的顺序排查。
| 2026-10-16 | T01（CLI 独立验证） | 用真实 CLI 在临时库上跑两遍旧文导入 + 站主初始化 + 匿名读封面 | **幂等**：第二遍 0 新增 / 8 unchanged，库里仍 8 行；**日期未被改成今天**（保留 2026-01-20…10-13）；Markdown 原文完整（对话扩展 2 篇、表格 7 篇、`!!!` 7 篇）；封面 8 张全部 `ready` 且归属正确；`w320.webp` 匿名 200、`original.jpg` 匿名 404、不存在的变体 404、路径穿越 404；`bootstrap_admin` 二次执行拒绝覆盖。全程未改 T01 代码 | 见提交 |
| 2026-10-16 | T01/T02（在途检查） | 三套命令逐条跑：API 测试、前端 typecheck/test/lint | API **165 通过**；前端 typecheck **退出码 0**（T01 已修好 mock 类型错误）、**78 测试全过**；但 `npm run lint` **红**：`app/admin/login/page.tsx:68` 触发 `react-hooks/set-state-in-effect`（effect 内同步 setState → 多一次渲染），同文件 75 行有失效的 eslint-disable。已报给 T01 并给出「初始态已是 loading，挂载时跳过置位」的修法 | 待 T01 修 |
| 2026-10-16 | T01（安全边界实证） | HTTP 层验证跨站写入与 CSRF（验收矩阵「跨站登录/发布请求 → 被拒绝」） | 4/4 拒绝：同源但缺 CSRF → **403**；跨站 Origin + 带 CSRF → **403**；无 Origin → **403**；跨站改密码未登录 → **403** | 见提交 |
| 2026-10-16 | T01（韧性实证） | 把 DATABASE_URL 指向无服务端口，验证「DB 不可用」的对外行为 | `/health/live` **200**（liveness 不受 DB 影响，正是拆分的意义）；`/health/ready` **503** `database: unavailable`；`/posts` 与 `/tags` 均 **503 `SERVICE_UNAVAILABLE`** —— **没有伪装成 200 空列表或 404**；响应中不含连接串、端口或 psycopg 字样 | 见提交 |
| 2026-10-16 | **T01（交付入库）** | T01 交付完成（`implemented_waiting_integration`），执行入库与状态更新 | 71 个文件 / 8383 行入库（`c21a147`），**确认未夹带 T02 的任何文件**；后端 **171 passed 退出码 0**（连跑两次）；共享库 `pl_test` **零污染**（posts/media/admin_users/tags 均为 0），T01 自建临时库已 drop。`tasks.json` 中 T01 → **`integrated_verified`**，遗留项写明 | `c21a147` |

## T01 遗留项交接（2026-10-16）

由 T01 交付单 §7/§8/§9 摘出，按归属落到具体人：

**待 T02 交付后由 T00 处理**
- [ ] `apps/web/lib/api/client.ts` 的 `ApiRequestOptions` 增加 `headers?: Record<string, string>`，让写操作可带 `X-CSRF-Token`（服务端 body 与 header 两种都已支持，属「更方便」而非必须）
- [ ] 决定 dev / preview 是否需要 `/api/v1` rewrite：不加则浏览器里登录页只能看到失败态（T01 §5.4 已如实记录为未验证项）
- [ ] T02 需在管理外壳提供「已登录 / 未登录」入口（未登录跳 `/admin/login`）；**T01 不做路由保护，隐藏按钮不是安全边界**（01 §3）

**属 T10（部署与跨模块验收）**
- [ ] `list_orphan_objects` 的保留期与执行者（目前只报告，无定时任务）
- [ ] `auth_rate_limits` 的定期清理兜底（现为机会式清理）
- [ ] 生产前确认网关**确实覆写** `X-Forwarded-For`，否则登录限流会被绕过或误伤
- [ ] Docker/Compose 内的真实启动、HTTPS 下的 `__Host-` Cookie、真实反代下的 `TRUST_PROXY_HEADERS`、上传并发压测

**给后续模块的约束**
- [ ] T08 的访客会话**不要复用 `sessions` 表**（05 §11 明确要求站主会话与访客会话分离）
| 2026-10-16 | T00（旧 URL 兼容） | 契约把「旧 URL 兼容配置」归 T00；实测新栈上所有旧地址原本都是 **404** | 在 `apps/web/next.config.ts` 加入 6 条重定向（`/index.html`→`/`、about/map/weather/guestbook、`/post.html?p=<slug>`→`/posts/<slug>`）。手工构建 + 隔离副本实测：五个静态入口 308 正确；有效 slug 跟随重定向 **200**、无效 slug 跟随重定向 **404**（不掩盖错误）、`/post.html` 无 `p` **404** | 见提交 |
| 2026-10-16 | T00（新栈运行时冒烟） | 用 T02 正在跑的生产服务（3100）做只读冒烟，补上「只验过 build、没验过 runtime」的缺口 | 8 个页面全部 200（`/` 70KB、`/about`、`/map`、`/weather`、`/guestbook`、`/admin/login`、`/healthz` 187B、`/posts/<slug>` 40KB）；非法 slug **404**；**文章正文服务端渲染**（原始 HTML 即含标题与正文，不依赖 JS，符合 01 §4） | 无（仅验证） |

## 待办：旧 URL 重定向的运行时复验（2026-10-16 起）

`apps/web/next.config.ts` 的 6 条重定向已在**隔离副本**里做过完整运行时验证（手工构建 + `next start` + curl），结论见上表。之所以用隔离副本：T02 当时正在重建 `.next`，并发构建会互相破坏。

**待 T02 交付后**，在正式 apps/web 上重启一次服务复验下列三条即可（预期与隔离副本一致）：

```
/post.html?p=phantom-blog-launch  → 308 → /posts/phantom-blog-launch → 200
/post.html?p=does-not-exist       → 308 → /posts/does-not-exist      → 404（不掩盖错误）
/post.html（无 p）                 → 404
```

一个已知的外观问题（**不是缺陷**）：Next 会把未匹配的源查询串附加到目标，因此跳转后是 `/posts/<slug>?p=<slug>`。试过 `destination: "/posts/:slug?"` 想去掉，**Next 16 不支持这种写法**（实测无效），故保留简洁写法。多余参数对页面无影响；若将来要 canonical 绝对干净，需要改用 `middleware.ts` 自行构造 Location —— 代价是给每个请求加一层，判断为不值得。
| 2026-10-16 | T02（问卷迁移实证） | 真实 Chromium 加载新栈首页，逐项比对迁移后的问卷与旧站 | **「必须保留」项成立**：84% 半透明底板、`07.3%` 整数与小数分列、结果标签、评论条、「本地展示 · 非全站统计」真实性声明全部保留；类名结构与旧站一致（`poll-panel`/`poll-intro`/`poll-tile`）。截图 `.dsh/screenshots/new-poll-mobile.png` | 无（仅验证） |
| 2026-10-16 | T02（发现回归） | 同一轮浏览器加载发现唯一失败请求：`404 /assets/legacy/music/beneath-the-mask.mp3` | 音乐在新栈**无法播放**。T02 注释称「与全新 clone 行为一致、非新引入缺陷」，**该结论不成立** —— 三首曲子已入库（`.gitignore` 注释确认站主有意保留），旧站在全新 clone 下可正常播放，故属相对旧站的**功能回归**，而「音乐连续」是 README 明列的必须保留项。已给出两方案（复制进 public / 改用旧站 `/assets/music/` 路径 + 网关提供），并推荐后者（06 §「素材分层」明确不把素材库复制进公开镜像）| 待 T02 决断 |

## 待 T10：音乐文件的服务路径（2026-10-16）

新栈的播放器指向 `/assets/legacy/music/<file>`，但 `public/` 下**没有**这些文件（T02 有意不重复入库 15MB 版权音频）。
T00 建议改为引用旧站同一路径 `/assets/music/<file>`，仓库保持单份副本。若采纳，**切换后网关必须继续提供 `/assets/music/`**，
否则「音乐连续」这条必须保留项在新站失效。三首曲目已在仓库根 `assets/music/` 入库（`.gitignore` 有专门注释说明撤下方式）。
| 2026-10-16 | T02（手机 20 次循环） | 真实 Chromium 独立复现验收矩阵「关闭手机、换 App、换路由，各重复 20 次 → 无重复音频、监听和残留遮罩」 | 开关手机 **20 次**后：`audio` 1→1、`audio[data-pl-music]` 1→1、`.pw-wrap` 1→1、`.crowd.on` 0→0、body 无残留锁定、页面错误 0。T02 自建工具亦覆盖此项（`tools/browser-verification/verify.py`），本轮为独立复现 | 无（仅验证） |
| 2026-10-16 | T02（音乐连续性） | 用**元素身份标记**验证客户端路由下播放器是否被重建（比计数更强的证据） | 先给 `audio` 元素打 `dataset.plIdentity`，再点击站内链接导航 **25 次**：audio 数仍为 **1**，**身份标记存活**（播放器未被重建），`window.__docMarker` 仍在（同一 document，未整页重载），页面错误 0。对照实验：`page.goto()` 整页导航 20 次后 identity 丢失、但 audio 数仍为 1 —— 与 01 §4 记录的「迁移期整页跳转可能重载」的临时边界一致 | 无（仅验证） |
| 2026-10-16 | T00（开发期同源转发） | 音乐改用旧站路径后，开发环境 Next 独占端口 → `/assets/music/` 与同源 `/api/v1` 都 404，导致「音乐可播」与「浏览器登录成功路径」无法本地验证 | `next.config.ts` 增加 **env 开关的两条 rewrite**（不设变量→不生成规则，生产不受影响）。隔离副本实测：音乐 **200 / 4447278B / audio/mpeg**（字节数与旧站一致）、`/api/v1/health/live` 与 `/posts` 同源返回 JSON | 见提交 |
| 2026-10-16 | **T01 未验证项闭环** | 借上面的转发，在真实 Chromium 里验证 T01 交付单 §8 第 2 条「浏览器里的登录成功路径」 | `/admin/login` 发出同源 `/api/v1/auth/session`；填入 CLI 初始化的账号并提交 → 页面出现 **「已登录：pl-verify」** 与注销入口，**页面错误 0**；截图 `.dsh/screenshots/new-login-success.png`。T01 该项原因「预览无同源 /api/v1 代理」已消除 | 无（仅验证） |

## 开发期代理的构建期约束（重要，2026-10-16 实测）

`DEV_API_URL` / `DEV_LEGACY_STATIC_URL` **必须在 `next build` 时就有值**。Next 的 `rewrites()` 在构建期求值并写进路由清单，只在 `next start` 时设置**不会生效** —— 我第一次就是这样测出 404，带变量重建后才通过。已写进 `apps/web/.env.example`。

生产不要设这两个变量：`/api/v1` 与 `/assets/music/` 由网关转发（06 §1 只有网关对公网开放）。

**T10 待办**：网关需转发 `/assets/music/`（否则「音乐连续」在新站失效）与 `/api/v1`。
