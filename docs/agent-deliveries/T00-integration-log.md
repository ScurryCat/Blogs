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
| 2026-10-16 | **音乐可播闭环** | 在带开发转发的隔离副本上，用真实 Chromium 验证音乐不只是「路径对」而是**真的能解码播放** | 点击声音控件后 audio 状态：`src=beneath-the-mask.mp3`、**`readyState=4`**（完全可解码）、**`duration=277.9s`**（整首）、**`paused=false` 且 `currentTime=6`**（正在播放并计时前进）、`error=null`、0 页面错误。此前只验证到「请求 200、字节数正确」，本轮证到播放层 | 无（仅验证） |
| 2026-10-16 | T02（320px 与小屏验收） | 真实浏览器在 **320px** 下逐页检查横向溢出与正文字号 | 七个页面（`/` `/about` `/map` `/weather` `/guestbook` `/posts/<slug>` `/admin/login`）**全部零横向溢出**（scrollWidth == innerWidth == 320）；文章页 `article p` 与最长正文段落均为 **16px**，满足「正文 ≥16 CSS px」。初次测量用「全页段落中位数」得到 13–15px，是把导航/页脚/免责小字算进去的**取法错误**，精确测量后不成立 | 无（仅验证） |
| 2026-10-16 | T02（旧锚点保留） | 浏览器访问 `/index.html#posts` | 重定向后 URL 为 **`/#posts`**，`#posts` 锚点元素存在且浏览器**确实滚动到位**（scrollY=1952）。对应验收「index.html#posts → /#posts 保留文章区锚点」 | 无（仅验证） |

## 待问 T02：减少动效下的人群预加载（2026-10-16）

在 `prefers-reduced-motion: reduce` 下加载 `/map`，`window.__PHANTOM_DEBUG__()` 返回 `crowd.ready = false`（普通偏好下为 `true`），`crowd.playing` 两者均为 `false`。

**这不一定是问题** —— 减少动效时跳过 700KB 人群素材的预加载，看上是**正确的省流行为**，与旧站「减少动态效果跳过播放」一致。但要向 T02 确认是有意为之，而不是「素材没加载成功」的副作用；若是前者，建议在调试信息里把状态区分开（例如 `crowd.skipped_reason = "reduced-motion"`），否则以后排查会分不清「跳过了」和「加载失败」。

**一次失败的测量（记录以免重犯）**：我原本想用「带非零 transition/animation 时长的元素数」衡量动效是否被抑制，结果该计数在 `reduce` 下从 89 变成 400 —— 400 正是我的取样上限，说明指标饱和、**不可用**。该结论作废，动效抑制应由行为验证（导航仍可达、人群画布不播放）而非元素计数得出。
| 2026-10-16 | T00（compose 开发环境一致性） | 容器里 web 与 api 是两个服务，浏览器要的同源 `/api/v1` 没有任何转发 → 容器环境下登录必然失败；而 Next 的 rewrites 在**构建期**固化，运行时设变量无效 | `dev.Dockerfile.web` 增加 `ARG DEV_API_URL`（默认空），`compose.dev.yaml` 传 `http://api:8000`。`docker compose config` 验证：arg 已传入、db 仍不公开监听、**不给 env 仍拒绝启动**（退出码 1） | 见提交 |

## 未验证：容器内镜像构建（2026-10-16 起）

`deploy/dev.Dockerfile.web` 新增了 `ARG DEV_API_URL` 并在 `npm run build` 前注入 —— 这是为了让容器环境里浏览器也能走同源 `/api/v1`（Next 的 rewrites 在构建期固化，运行时设置无效）。

已验证的只有**配置层**：`docker compose config` 能把 arg 正确渲染进 `web.build.args`。
**镜像构建与容器启动仍未验证** —— 本机 Docker daemon 未运行。有人启动 Docker Desktop 后请执行：

```
docker compose -f deploy/compose.dev.yaml --env-file deploy/.env build web
docker compose -f deploy/compose.dev.yaml --env-file deploy/.env up -d
```

在此之前不得声称容器内可运行（T00 交付单 §9 已列同一项）。
| 2026-10-16 | T02（构建期 CSS 陷阱） | T02 报告：Next 16（Turbopack/Lightning CSS）把同一规则里的 `translate` 与 `transform` 合并并**丢掉 `translate`** | **独立确认**：构建产物中基础 `.poll-q` 规则的 `translate` 确实缺失（`含 translate: False`），而覆盖规则 `transform: translateY(-20px) rotate(-8deg)` 存活。全量扫描源码：仅 1 处真实命中（`styles/legacy/poll.css` 的 `.poll-q`），另一处是 `app/globals.css` 里的注释示例 | 无（仅验证） |
| 2026-10-16 | T02（问卷几何回归） | 用真实浏览器量新旧问卷 Q 的渲染几何（T02 修完 CSS 后独立复核） | **390px 与 1280px 两个断点下偏差均为 0.0px**，面板宽度一致（350 / 504）；1280px 下新栈 `translate=none` 但 transform 内含等效 `translateY(-20px)`，净几何相同。我事前担心的「-12px 与 -20px 叠加成 -32px」**未发生** —— 断点拆分处理正确 | 无（仅验证） |
| 2026-10-16 | T02（诊断字段缺口） | 独立复核 T02 新增的 `crowd.state` 诊断：reduce 下实测为 `not-warmed` 而非 `reduced-motion` | 排除了构建陈旧（产物含 `reduced-motion`、`.next` 晚于源码）与实现遗漏（`crowd.ts:135` 分支正确）后定位到**调用方**：`transition-layer.tsx:130` 的 `if (prefersReducedMotion() \|\| !isCheapConnection()) return;` 先短路，`warm()` 从未被调用。后果：reduce 下的 `not-warmed` 与「调用方压根没跑」同值，**诊断字段在它要解决的那个问题上仍分不清**。已给出三种修法并给出倾向，交 T02 判断；不影响用户可见行为，不阻塞交付 | 待 T02 判断 |
| 2026-10-16 | T02（交付前预审） | 交付前做所有权预审 + 迁移工具写入目标审计 | **无越界**：T00 拥有的全部文件（`main/router/model_registry`、`migrations/`、两个锁文件、`tsconfig`、`next.config.ts`、`eslint.config.mjs`、`vitest.config.mts`、`features/phone/registry.ts`、`lib/api/generated/`、`contracts/`、`deploy/`、`.gitignore`）零改动；已跟踪文件的唯二修改（`app/layout.tsx`、`app/page.tsx`）均属 T02。迁移工具 `tools/legacy-migration/migrate.mjs` 的写入目标**没有任何引用 `repoRoot`**，全部落在 `apps/web` 内，旧站确为只读 | 无（仅验证） |
| 2026-10-16 | T02（文档漂移） | 发现 `migrate.mjs:15-18` 的注释仍描述旧的音乐方案（指向 `/assets/legacy/music/`、「与全新 clone 一致」），与已改成的 `/assets/music/` + 双状态不符 | 已报 T02。风险点：T05/T06/T09 会迁移更多素材、**很可能复用这个工具**，错误说明会被传播 | 待 T02 修 |
| 2026-10-16 | T02（导航来源→效果映射） | 独立验证验收矩阵第一行「地图图标/出发/列表用人群，顶部导航用 Joker，**不能按当前页面猜测**」| 真实 Chromium 高频采样 `window.__PHANTOM_DEBUG__().transition`：
① 地图页点「出发 ▸」→ **crowd=True / joker=False**；
② **在 /map 页**点顶部导航 → **joker=True / crowd=False**（决定性：按来源而非当前页面）；
③ 从 /about 点顶部导航里的「地图」链接（目的地是 /map）→ 仍是 **joker**（目的地也不决定效果）。
代码侧交叉确认：`map-view.tsx` 的三个入口（图标 277 / 出发 343 / 列表 356）均为 `source="map-travel"` | 无（仅验证） |
| 2026-10-16 | **T02 修复闭环** | 复核 T02 对我两条反馈的处置 | ① `migrate.mjs` 注释已重写：正确说明单份副本理由、引用 `.gitignore` 与 06 素材分层、指向 `MUSIC_BASE`；
② `crowd.state` 缺口按倾向方案 2 修复 —— reduce 判定收进 `warm()`（注释「单一判据」），调用方只留连接检测并调 `markSkipped("slow-connection")`。**行为复验**：普通偏好 `state='ready'`、减少动效 `state='reduced-motion'`（修复前为 `not-warmed`）|
| 2026-10-16 | T02（拒绝与披露） | 验证 T02 未记录（而是修掉）我指出的问题：过时文档与不可达状态均已消除，**没有留下"已知但不修"的痕迹** | 同上 | 无（仅验证） |
| 2026-10-16 | T02（手机直接 URL 路径） | 独立验证验收行「手机详情直接 URL、刷新、Back、展开 → 状态一致，关闭直接链接不会意外离站」 | **通过 3 项**：闭合直接链接后 URL `/?phone=home` → `/` 且 `history.length` 保持 2（**未发生 back 跳转**，符合 02 §history ⑤）；刷新前后 URL 与开启状态完全一致；Back 从 `/about?phone=home` 回到 `/about` 且未离站。
**发现 1 项可复现差异**：**直接 URL 打开时 Escape 关不掉手机**（✕ 可关）。对照实验：直接 URL 打开后焦点为 `BODY`、Escape 无效；点击 `.pw-tab` 打开后 Escape 有效。T02 工具只覆盖了点击路径。另观察：两种路径下焦点都未进入对话框，与 02 §D4.7「焦点圈定」的表述有出入（可能是刻意取舍，已请 T02 判断） | 待 T02 判断 |
| 2026-10-16 | T02（Web 存活探针） | 验证 06 §1 要求的「Web 健康检查不依赖 DB」（T10 会用） | **API 完全未运行**（8100 拒绝连接）时 `/healthz` 仍 **200 / 187B**。响应体自我描述清晰：`{"status":"ok","service":"phantom-log-web","scope":"web-liveness","note":"仅表示 Next.js 进程存活；不含数据库与 API 就绪判断。"}` —— **明确声明了自己不主张什么**，与「不用永远返回 true 的实现冒充 readiness」的要求一致 | 无（仅验证） |
| 2026-10-16 | 数据源现状（澄清） | 后端停止时首页/文章页仍 200 且内容完整，初看像「后端故障未如实报错」 | 查明原因：旧站文章数据已迁移为**内置 JSON**（`features/legacy/data/posts.json`），公开读取**尚未走后端**。因此 01 §6「后端故障返回清晰不可用提示、不伪装成没有文章」这条**目前不可验证**，要等数据源切换到 DB（T02/T10）或 T03+ 的 API 驱动页面落地。**本轮不把它记为通过** | 待数据源切换 |
| 2026-10-16 | **T02（交付入库）** | T02 交付完成并入库 | 256 文件 / 18050 行（`ebaaa6a`），**确认未夹带 T01 与 T00 的文件**；前端 typecheck / lint / test(**162**) / build **全部退出码 0**；后端 171 通过；旧站 53 通过零回归。交付前所有权预审无越界。`tasks.json` 中 T02 → **`integrated_verified`** | `ebaaa6a` |
| 2026-10-16 | **T02 修复闭环（第 2 次）** | 复验我第 26 轮报的两处问题 | **均已修复并行为验证**：直接 URL 打开后焦点从 `BODY` 变为 `BUTTON.pw-close`（**在对话框内**）、Escape **可以关闭**；点击路径焦点同样进入对话框。修复前仅点击路径的 Escape 有效 | 无（仅验证） |
| 2026-10-16 | **基础集成完成** | T00 / T01 / T02 均为 `integrated_verified`，满足 T03–T09 的开始条件 | 可以派发功能包 | 见提交 |

## 浏览器测试的时序约定（T02 实战发现，2026-10-16）

**症状**：在 React 水合完成前点击元素，点到的是原生 `<a>`，于是发生**整页跳转** —— 测试可能"通过"（页面确实变了），但它验证的**不是客户端路由**，而是浏览器原生导航。对依赖「导航来源协议」的断言（如 T04 的 `metaverse-entry`）这意味着**什么都没验到**。

**做法**（见 `apps/web/tools/browser-verification/verify.py`）：

```python
page.wait_for_function("() => typeof window.__PHANTOM_DEBUG__ === 'function'", timeout=15000)  # 等水合
page.wait_for_function("() => window.__PHANTOM_DEBUG__().<字段> === '<期望值>'", timeout=15000)  # 等业务就绪
page.click(...)                                                                                # 再交互
```

两条原则：**等能力信号而不是等时间**；**等业务状态就绪再交互**。固定 `wait_for_timeout` 在高负载下会假失败。已转给 T03 与 T04（两者都在写浏览器测试）。

**同批已知坑**（此前已记录，此处汇总）：
1. `#boot` 开屏拦截所有指针事件 —— 先按 Enter 并等 `#boot` detached；
2. 浮层（问卷等）异步渲染 —— `wait_until="load"` 之后仍要等选择器出现；
3. 开发期 `DEV_API_URL` **必须在 `next build` 时就有值**（rewrites 构建期固化）；
4. 截图统一 `device_scale_factor=2`；截图存 `.dsh/screenshots/`，不入库。

## 集成决策：`PHANTOM_POSTS_SOURCE=api` 的打开条件（2026-10-16 记录，暂不打开）

**背景**：T02 交付单 §8.1 提出，切换公开读数据源到 API 时，列表页拿不到阅读时长（`min`）——因为 `GET /posts` 按 05 §129 只返回**摘要**，而 `min` 需要 `content_md`（05 §50 确认 `posts` 表有 `excerpt` 与 `content_md`，但**没有**任何阅读时长字段）。

**查证结论**：`min` 是 T02 自己算的派生字段（`lib/api/posts.ts:105`），05 未规定它。因此这不是契约缺口，而是**切换数据源时的新增需求**。

**决策（待切换时执行，现在不做）**：若切换后仍要显示阅读时长，**在服务端计算并加入列表 DTO**（例如 `reading_minutes`），而不是让前端 N+1 逐篇取详情、也不要用摘要估算糊弄。理由是服务端本来就有 `content_md`，返回一个派生整数不会泄漏正文，且列表页保持单次请求。

**为什么现在不打开**：默认 `baseline`（迁移基线数据）是有意的过渡状态；切换数据源要与「后端故障如实报错」的验证一起做（本轮已确认该要求目前不可验证）。切换动作本身属 T02/T10 的遗留项，不阻塞 T03/T04。
| 2026-10-16 | T03（早期模型检查） | T03 刚落地 `moments/models.py` 时做迁移预演（不写文件） | 导入无错、**无表名冲突**；声明的表正是 05 规定的三张（`moments` / `moment_media` / `moment_tags`）；预演产出 7 项变更（3 建表 + 4 索引），含 `(published_at, id)` 公开列表索引。
**一次自我纠正**：预演摘要未打印 WHERE 子句，我一度怀疑 `ix_moments_public_listing` 漏了部分条件；查源码确认它带了 `postgresql_where=sql_text("status = 'published' AND deleted_at IS NULL")`，与 posts 一致、符合 05 §100「按公开条件选择部分索引」——**疑虑不成立** | 待集成 |
| 2026-10-16 | T00（仓库卫生） | 对 T02 那个 256 文件的大提交做卫生检查 | **0 个可疑条目**（无 `node_modules`/`.next`/`.venv`/`__pycache__`/`tsbuildinfo`）；文件类型全为正当资源（74 png、50 svg、45 tsx、28 ts、16 webp、14 jpg、11 css、6 json、4 md、3 ttf）；`.git` 24M、628 个跟踪文件、工作树 31M —— 对含 6.9MB 迁移素材与 15MB 音频的站点属健康 | 无（仅验证） |
| 2026-10-16 | **T02 验收工具独立复跑** | 亲手跑一遍 T02 的浏览器验收工具（那是它全部浏览器证据的来源，工具本身跑不通则证据可疑） | 带开发转发的全新构建 + 独立端口，`tools/browser-verification/verify.py` → **44 passed / 0 failed，退出码 0**，产出 21 张截图。其中包含我第 26 轮报的问题对应的检查项，且全部通过：「直接链接打开后焦点进入对话框」「直接链接打开：Escape 能关掉手机」「收起后仍在同一路径」「收起后清掉 phone 参数」「跨客户端路由：音乐元素是同一份」「播放状态延续」。T02 的 3100 服务在我两次重建 `.next` 后仍正常（200） | 无（仅验证） |
| 2026-10-16 | **T03+T04 接线全量预演** | 两个包的路由与模型均已落地，做一次完整预演（不写任何文件） | **模型**：按依赖顺序导入 6 个模块 → **表总数 14 张**，恰好等于 05 §35-46 列出的全部表（不多不少），无表名冲突。
**迁移**：预演产出 **12 项**（6 建表 `palaces`/`moments`/`palace_aliases`/`moment_media`/`moment_tags`/`palace_posts` + 6 索引），全部为新增、**无 drop**；`palaces` 与 `moments` 均带 `(published_at, id)` 公开列表索引。
**路由**：7 个模块全部挂载、无前缀冲突，契约从 10 条扩到 **24 条**，新路径与 05 的端点清单逐条吻合 | 待交付 |
| 2026-10-16 | T00（预演中的自纠） | 第一次预演脚本只导入新模块、未先导入 `media`，报 `NoReferencedTableError: moment_media.media_id 找不到 media` | **这不是 T03 的缺陷，是我的脚本缺陷**；但它暴露了一条集成约束：**`MODEL_MODULES` 的顺序必须让 `media` 在 `moments` 之前**（`moment_media.media_id` 外键指向 `media.id`）。已按正确顺序重跑通过 | 无（仅验证） |
| 2026-10-16 | T00（测试基建重构） | `create_database` / `drop_database` 的临时库白名单是一份常量，每个新包都要编辑同一个文件 → **多 agent 写-写争用**（T03 已改过一次，T04 尚未但迟早要改） | 改为可扩展登记：新增 `register_temp_database(name)` 与 `allowed_temp_databases()`，`_guard_name` 改用后者。**两层保险不变**：登记时仍要求库名像测试库，运行时仍有 `_guard_name` + `assert_test_database_url`。实测：登记前 false → 登记后 true；`phantom_log`（不像测试库）、`pl_production`（像生产库）、未登记名均被拒 | 见提交 |
| 2026-10-16 | T00（并发测试根因） | 全量跑测试时出现 21 failed + 63 errors，其中 T01 的 auth 报 `database "pl_test_t01" does not exist`（刚被 drop） | **根因是并发全量运行**：T03/T04 执行 `pytest apps/api/tests` 会连带收集并运行 T01 的测试，而 T01 的 session 夹具会创建并在结束时 drop `pl_test_t01` —— 两个并发运行互相删库。**不改代码，改为协作规则**（契约本就规定「模块测试由该包负责，跨模块测试由 T10」）：开发期只跑自己的目录，全量套件由集成负责人在无人并发时串行运行。实测按目录跑 T01 的 117 个用例全过、库被正常创建与清理 | 见提交 |

## 测试并发规则（2026-10-16 确立）

**现象**：并发运行全量套件时出现 `database "pl_test_t01" does not exist` 这类神秘失败。

**根因**：各包的 session 夹具用**固定库名**（`pl_test_t01` / `pl_test_t03` / `pl_test_t04`）建库并在会话结束时 drop。而 `pytest apps/api/tests` 会收集**整棵树**，于是 T03 的运行也会跑 T01 的测试、也会建同一个库、也会在结束时把它删掉 —— 另一个并发运行正在用的库就消失了。

**规则**（与契约「模块测试由该包负责，跨模块测试由 T10」一致）：

- **功能包开发期只跑自己的目录**，例如 `uv run --project apps/api pytest apps/api/tests/moments`；
- **全量套件由集成负责人在无人并发时串行运行**（集成前的固定动作）；
- 看到 `database ... does not exist` 这类错误时，先怀疑并发，不要当成自己的缺陷去「修」。

**已做的加固**：白名单从常量改为可扩展登记（`register_temp_database`），消除「每个新包都要编辑同一文件」的写-写争用。库名本身仍是固定的，因为 T01 有 3 处断言直接比较库名（`test_import_legacy` / `test_health_readiness` / `test_bootstrap_admin`），改成随机后缀会牵连这些已入库的用例。

**给 T05–T09 的提示**：在自己的测试支撑文件里调用 `register_temp_database("pl_test_tXX")` 登记，不要编辑 `tests/core/t01_db.py` 的白名单常量。
| 2026-10-16 | T03/T04（分目录验证） | 并发干扰排除后，分别跑两个包自己的目录 | **T03 `tests/moments` → 64 passed**；**T04 `tests/nav` → 59 passed**，均 0 失败。确证先前的 21 failed / 63 errors 与后续的 44 errors **纯粹是并发全量运行互相删库**，不是两个包的缺陷。同时也证明我上一轮的白名单重构**没有破坏任何测试** | 无（仅验证） |
| 2026-10-16 | T03（采纳登记机制） | T03 改为 `T03_DATABASE_NAME = register_temp_database("pl_test_t03")`，并把自己的库名从 T01 文件的内置白名单里移除 | 争用点已消除：新包不再需要编辑 `tests/core/t01_db.py`。另注意到有人在 `_ensure_tables` 补了一条好洞察 —— `Base.metadata` 是**进程级共享**的注册表，拿它断言「迁移覆盖度」会把其他域的表也算成漏建 | 已生效 |
| 2026-10-16 | T03（组合接口一致性） | 检查任务卡约束「INS 壳允许注入相册/消息页签，**不自行导入尚不存在的 T06/T08 模块**，未接入不显示」 | `features/ins/composition.ts` 定义的是**注入点而非实现**：`INS_TABS`（内置页签）+ `InsTabContribution`（外部贡献）+ `resolveTabs()`（未注入的页签不出现在结果里）；全文**无任何** `features/{gallery,messaging,showcase}` 导入 | 待交付 |
| 2026-10-16 | T04（导航来源一致性） | 检查「只在明确进入殿堂时发送 `metaverse-entry`」「不独立创建全屏遮罩或使用地图人群」 | **未发现**自造遮罩或人群调用。`metaverse-entry` 只在三处发送，且都在**点击处理**里：`palace-card.tsx` 的 `SiteLink source="metaverse-entry"`、`palaces-screen.tsx` 的显式进入、`search-screen.tsx` 的 `ResultLink`——后者渲染结果时**不发任何 source**，点击殿堂结果是认知入口、点击文章结果是 `phone-link` 普通跳转（符合 04 §7 与验收「匹配结果不触发全屏动画」）| 待交付 |
| 2026-10-16 | T04（确定性匹配预检） | 独立验证规范化层与 `not_found` 语义（任务卡要求 NFKC/trim/大小写/别名、**禁止模型猜测**） | **规范化全部正确**：全角→半角（`ＭＥＴＡＶＥＲＳＥ`→`metaverse`）、大小写折叠、首尾 trim、内部连续空白折叠、`\u3000` 全角空格归一；`nav.normalize_keyword` 与 `core.text.normalize_for_match` **同一规则**（单一事实源，不各写一套）。
**语义正确**：`POST /nav/resolve` 无任何 `try/except`，数据库故障正常冒泡为 5xx，**不会被吞成 not_found**；`not_found` 是响应体 status 字段（HTTP 200），符合 05 §163「not_found 是正常 200 业务结果，API 故障是 5xx」。
**一次自我纠正**：我把 `①` 的期望值写成原值，判为不符；实际 NFKC 本就把 `①` 分解为 `1` —— 实现正确，是我的预期错了 | 待交付 |
| 2026-10-16 | T03（前端早期预警） | 只读 `tsc --noEmit`，T04 的页面已落地触发了全量检查 | **2 个类型错误，均在 T03 的 `features/ins/`**，且是同一处写法：`moment.images.length ? variantUrl(moment.images[0]) : null` ——`.length` 为真**不会**让 TS 收窄索引访问，而 tsconfig 开着 `noUncheckedIndexedAccess`（`images[0]` 恒为 `T | undefined`）。已给出「先把首图取进变量再判空」的改法，并明确**不要为了消错去关该严格设置** | 待 T03 修 |
| 2026-10-16 | T03（前端预警·第 2 轮） | 上一轮 2 处已修 ✓；新文件带来 1 个新类型错误 | `features/ins/phone-view.tsx:60` 报 `string | null` 不能赋给 `string`。**核查后确认不是功能缺陷**——`phone-view.tsx:40` 的守卫**确实 return**（非法 item 只渲染「不存在」，不会走到详情视图）。根因是 `types.ts:109` 的 `isMomentId(...): boolean` 缺类型谓词，TS 无法在调用处收窄；改为 `value is string` 即可 | 待 T03 修 |
| 2026-10-16 | T00（跨包模式记录） | 发现一批同形状判定函数声明为 `: boolean` 而非类型谓词 | `isNotFound`(T03) / `isPhoneHome`(T02) / `isAbort`(T04) 等。当前用法都是「分支判断」故未报错，但调用方一旦指望收窄（如 `if (!isPhoneHome(s)) return;` 后访问 `s.phone`）就会静默失效。已提醒 T03 顺手处理自己的那个；另两个留待集成时统一提给对应包 | 待集成处理 |
| 2026-10-16 | T04（前端早期预警） | T03 上一轮的类型错误已修 ✓；新错误转到 T04 的 `features/metanav/admin/palace-admin-editor.tsx` | 2 个错误且**第二个是第一个的连锁反应**：89 行用三元派生 `serverKey`，而类型收窄**不会传播到派生值**，所以 94 行 `state.data` 报「`data` 不存在于 `LoadState`」；`palace` 沦为 `any` 后 100 行 `item` 成了隐式 any。已给出「把收窄提到 `palace` 上」的改法，并提示**修第一处即可让第二处消失**，在第 100 行单独加注解是治标 | 待 T04 修 |
| 2026-10-16 | T04（做法确认） | 检查其注释所述「渲染期按 props 调整状态」是否为正确模式 | 正确：用 `(id, version)` 作标记在渲染期调整状态，避免 effect 内同步 setState 的级联渲染 —— 正是我在 T01 那边拦下的 `react-hooks/set-state-in-effect` 所要避免的写法 | 无（仅验证） |
| 2026-10-16 | T04（类型错误已修） | 复跑 `tsc --noEmit` | **退出码 0** ✓ —— 上一轮报的两处（含连锁的隐式 any）已随第一处修好而消失，验证了「修根因即可让连锁错误自动消失」的判断 | 无（仅验证） |
| 2026-10-16 | T03（lint 预警） | `npm run lint` → **5 error + 4 warning，全在 `features/ins/`** | **① `Cannot access refs during render` × 3**（`use-feed.ts:70` 的 `tagRef.current = tag` 等）：渲染期改 ref 是纯度违规，并发渲染下可能「渲染了却不提交」导致 ref 与已提交 UI 不同步，**属实缺陷**，已给改法。
**② `setState synchronously within an effect` × 2**（`favorite-button.tsx:32`、`saved-view.tsx:37`）：T03 的动机（避免水合不一致）**正确**，但仓库里 T04 的 `features/metanav/footprint-react.ts` 已用 `useSyncExternalStore` 解掉同一问题并写明理由 —— 已建议照抄该文件，兼顾无 effect-setState、无调用点偏好与跨标签页订阅。
**③ `<img>` 警告 × 4**：**不阻塞**（失败的是 error），并给出 T02「保留 `<img>` + 一行带理由的定向豁免」的先例 | 待 T03 修 |
| 2026-10-16 | T00（手机登记清单前置） | 两个包已建页面但尚无 `PhoneAppModule` 形状的模块；登记是集成关键路径 | `features/phone/registry.ts` 的 `PHONE_APPS` **仍刻意留空**（未接入不放占位应用，符合 §4），且**无任何包改动过它** ✓。已把精确清单前置给 T03/T04：`PhoneAppModule` 需 `default` 默认导出 + `screens` + 可选 `dispose`；`PhoneAppManifest` 固定 10 字段（`id`/`name`/`subtitle`/`icon`/`order`/`kind`/`canonical_path`/`loader`/`feature_flag`/`state_version`），并明确 `icon` 必须是仓库真实存在的资源（我会核对）、`canonical_path` 要对齐 02 的 `/apps/*`、`feature_flag` **只是可见性不是鉴权**。另提示 T03 现为具名导出（宿主取 `module.default`）需补默认导出 | 待交付 |
| 2026-10-16 | T04（类型错误已修·复验） | 复跑 `npm run lint` 与前端测试 | lint 仍 5 error（T03 的，未修）；**前端测试 20 文件 / 201 通过**（较上次 16/162 增长，两包在补测试）| 无（仅验证） |
| 2026-10-16 | **T03（05 规格一致性审计）** | 独立审计 moments 是否落实 05 的具体数字与事务约束（不依赖其自测） | **逐条符合**：
① 文本 ≤2000 码点 —— `TEXT_MAX_CODEPOINTS = 2000`，且**落在数据库 CHECK**（`char_length(text) <= 2000`），符合 05 §64「不能只靠管理表单」；
② 发布须 1–9 张 ready 图片 —— `publish_moment` 先查数量（<1 / >9 各自 409），再查全部媒体 `ready` 且未删除，否则 409 并列出未就绪 ID；
③ 最多 8 个标签 —— `TAGS_MAX = 8`，schema 层去空白/去重/去空 + 单个 1–24 码点；
④ **发布时间服务端生成**（`utcnow()`，注释写明不信任客户端时钟）；
⑤ **单事务** —— `get_session` 每请求一个 Session 且「提交由 service 决定」，变更路径只有一次 `_commit()`，覆盖文字/图片顺序/标签/版本，符合 05 §102；
⑥ `IntegrityError` 被翻译成可读 **409 而非 500**（唯一约束的兜底）；
⑦ 草稿可无图（门槛只在发布时查）、撤回保留图片与标签关系。
另注意到一处刻意的正确设计：管理回执**如实返回未 ready 的图片**（不静默过滤），以便表单显示「不能发布」，而非看起来少了一张图 | 待交付 |
| 2026-10-16 | **T04（规格一致性审计）** | 独立审计足迹上限、LIKE 转义、搜索排序稳定性、宿主模块形状 | **逐条符合**：
① **LIKE 转义** —— `_like_pattern` 把 `%` / `_` / `\` 全部转义且 `.like(..., escape="\\")`，符合 05 §6（否则用户输入会意外变成通配查询）；
② **足迹上限 30、可清除** —— `FOOTPRINT_LIMIT = 30`（注明 04 §9），**读取与写入两侧都 `slice`**（防手改 localStorage 绕过）、同 slug 去重置顶、有 `clearFootprint()`；
③ **搜索排序稳定** —— 游标元组 `(rank, published_at, id, kind)`，落实 05 §140「同分按 `published_at DESC, id DESC` 稳定排序，再加 kind 最终区分」；游标另带 q/kind/tag **过滤指纹**（与 moments 的标签指纹同一套路）；
④ **宿主模块已就绪** —— `features/metanav/index.tsx` 已是 `PhoneAppModule` 形状（`export default MetanavApp` + `export const screens`），且头部注释按协议写明：只用 `PhoneViewProps`、不碰全局/DOM、`metaverse-entry` 只在明确进入时发、足迹走 `host.state`、卸载即取消读取。**我第 41 轮清单里的模块项它已自行满足**，只差 manifest 取值。
另注意到：文档未规定处（别名/关系条数上限）它做了明确取舍并在注释里说明依据 | 待交付 |
| 2026-10-16 | **T02（交付后修复）** | 复核 T02 对已入库文件的交付后改动（`site-link.tsx`、`map-view.tsx`、`verify.py`）| **修的是一个真实竞态**：Next 16 在 `document` 上挂了自己的点击处理，等到**冒泡阶段**才 `preventDefault` 时浏览器可能已开始整页跳转（注释记录实测：window 冒泡处 `defaultPrevented` 已是 true，页面依旧重载）。改为 **捕获阶段** `onClickCapture` + `stopPropagation()`，两处入口（`SiteLink` 与地图的 `SvgSiteLink`）都改；并**补了回归测试** `client_navigation()`，覆盖顶部导航/地图图标/地图列表/手机站点链接四类入口。根因定位 → 两处同改 → 补回归测试，处理完整 | 待入库 |
| 2026-10-16 | T03（JSX 注释，已自愈） | 一次构建失败，报 `Expected '</', got 'ident'` | 初判为 T03 编辑中间态，**下一轮复查已消失**（它自行修好）。期间我做了最小复现确证判据，结论可复用：裸 `/* */` 在 **JS 表达式位置合法**（三元 else 分支，退出码 0），在 **JSX 子元素位置非法**（报 TS17008）——**判据是注释所处位置，不是注释里有没有 `<img>`** | 已自愈 |
| 2026-10-16 | T04（测试文件类型错误） | `tsc --noEmit` → **9 个错误全在 `metanav-view.test.tsx`** | **① `ReturnType<typeof vi.fn>` 是未特化的 `Mock<Procedure \| Constructable>`**，不能赋给宿主的具体签名（7 个 2322）；已给带类型参数的改法。
**② `let navigation` 只在闭包内赋值**，TS 控制流分析看不到，使用处仍视为初始值 `null`，对 `null` 可选链即得 **`never`**（3 个 2339）——**TS 已知局限、非逻辑错误**；已给「使用处收回声明类型」与「对象持有者」两种改法。
并明确**不要为消错把测试文件排除出 tsconfig** | 待 T04 修 |
| 2026-10-16 | **T02 交付后修复入库** | 复核并入库 T02 的 4 个增量（`3320aaa`）| 修掉的是**只在部分路径复现**的整页重载：`/`→`/about`、`/map`→`/posts/*` 重载，`/about`→`/map`、`/map`→`/weather` 正常；后果是音乐被打断、过场收尾失效。改为 `onClickCapture` + `stopPropagation`（`SiteLink` 与 `SvgSiteLink` 两处），并新增 `client_navigation()` 回归检查覆盖四类入口。**入库前确认未夹带 T03/T04 的文件** | `3320aaa` |
| 2026-10-16 | **T02（Escape 根因澄清）** | T02 说明我第 26 轮报的 Escape 失效根因 | **问卷浮层在手机之后才入弹层栈并压在手机上面**；点击打开的路径顺序恰好相反，所以 T02 自己的工具里那条检查是过的、**只有独立的外部测量才暴露出来**。另澄清：「焦点圈定」**不是刻意取舍，是漏了**，现已补上（焦点进 `.pw-close`、`.pw-tab` 随背景 inert、Tab 在对话框内首尾相接）。→ 印证我第 26 轮**把它报出来而不是假定为有意设计**是对的 | 无（已修） |
| 2026-10-16 | T04（构建阻塞·已报） | `npm run build` 失败于 `features/metanav/host.ts:17` | **全仓库唯一构建阻塞点**：该文件用了 `useCallback/useEffect/useState` 但**没有 `"use client"`**，且同时被客户端组件（`palace-reading-loader.tsx`）与服务端组件路径（`palace-reading.tsx` ← 殿堂页）导入，于是在服务端图里也要求它是客户端模块。已给出「加 `"use client"`」与「把 hooks 拆到 `host-react.ts`」两种修法，**由 T04 按自身判断选择**；并明确要求它自己跑一次 `npm run build`（`typecheck` 过 ≠ 构建过） | 待 T04 修 |

### T00 自我更正：不存在「tsc 接受而 SWC 拒绝」的证据（2026-10-16）

我在给 T03 的预警里写过「实测过 `tsc` 接受、而 Turbopack 的 SWC 解析器拒绝同一份代码的情形」。**这句话没有证据支撑，已向 T03 更正。**

实情：我用 `next/dist/build/swc` 的 `parse` 直接测了三种写法（裸 `/* */` 在三元真分支、文件头 `eslint-disable`、`// eslint-disable-next-line`），**三种全部通过**；`tsc --noEmit` 对整棵树也是退出码 0。因此那次构建失败**最可能是 T03 编辑过程中的中间态**（文件在我跑构建的瞬间尚未写完），**不是解析器差异**。

**但「构建 ≠ 类型检查」这个结论仍然成立，且有一个确凿得多的例子**：`features/metanav/host.ts` 缺 `"use client"` 时 `tsc` 完全不报错（它只做类型检查、不理解 React 的 Server/Client 边界），而 `next build` 直接失败。这类「构建专属」错误是 `tsc` 结构上就看不见的 —— 所以四条命令（`typecheck` / `lint` / `test` / `build`）必须都跑。

**教训**：把「我的推断」和「我实测到的事实」分开陈述。这次我把一个未经证实的因果当成实测结论说了出去，对方可能会照着去排查一个不存在的问题。
| 2026-10-16 | **T03+T04 前端达标** | 四条前端命令 + 后端 + 旧站全量复跑 | **typecheck 0 / lint 0 / test 24 文件 248 通过 / build 0**；旧站 `node --test` **53 通过零回归**；API 既有目录 **117 通过**。T03 修的 3 个 lint error（含 `no-html-link-for-pages`）与 T04 的 `host.ts` `"use client"` 均已生效 | 无（仅验证） |
| 2026-10-16 | **T03+T04 跨包冒烟** | 验证新页面是否与 T02 已验证的既有行为共存 | `/apps/ins` **9 个 `ins-app` 元素、水合 True** ✓；`/apps/metanav` **水合 True** ✓；**手机桌面仍只显示 4 个已登记 site-link 应用**（情报宫殿/地图东京/天气预报/档案关于我），**INS 与导航均未出现** ——证明「未登记不显示坏按钮」的规则在并行开发下依然成立（登记是我的集成动作）。T02 的既有行为亦未回归：音乐元素唯一 ✓、手机可开 ✓、Escape 可关 ✓ | 无（仅验证） |
| 2026-10-16 | **T00（验证受阻·已协调）** | T02 的 44 项浏览器回归**无法跑完** | 连续三次启动验证服务（独立端口），均在 10 秒–2 分钟内被 **SIGTERM** 杀掉；日志显示干净启动、无崩溃无 OOM，属**外部按名字匹配的 `pkill`**（T02 此前承认用过 `pkill -f "next-server"` / `pkill -f "next dev"`）。已请 T03/T04 改为**按端口或 PID 精确杀**（`lsof -ti tcp:<port> | xargs kill`），并保留该项为待补验证。另发现：T02 仍在跑的 **3100 服务会按需读取新构建**（`/apps/ins` 返回 200 且含内容），但**客户端 chunk 是旧的**，水合失败（`__PHANTOM_DEBUG__ is not a function`），故只能用于**服务端渲染**检查、不能用于运行时检查 | 待服务稳定后补跑 |
| 2026-10-16 | T00（自身失误） | 我用的 `setsid` 在 macOS 上**不存在**（属 util-linux） | 已改用受管后台任务与同调用内启动的方式，记录以免重犯 | 无 |
| 2026-10-16 | **共享缺陷修复 `5f6f0ab`** | T04 在真实浏览器验收中抓到「清除足迹」静默失效，T00 确认并修复 | **根因**（`features/runtime/storage.ts` 的 `LocalStateService.clear`）：内存按前缀清对了，但持久层**只遍历本实例写过的键**（内部 `written` 集合）；换页后是新实例、集合为空，而内存本来也是空的 —— 于是 `clear()` **一个键都删不掉**。**单实例单测结构上抓不到**（写入与清除发生在同一实例，`written` 恰好是满的），只有真实浏览器验收能暴露。
**修法**：`collectKeys(prefix)` = 本实例写过的 ∪ 存储里已有的同前缀键；`StorageLike` 增加可选 `length`/`key(index)` 枚举能力（真实 `localStorage` 天然满足，`createMemoryStorage` 补上）；**先收集再删除**，避免边遍历 `key(i)` 边删导致下标错位漏键。
**回归测试有效性已证明**：临时还原旧逻辑 → 4 例中 **3 例失败**；恢复修复 → 4 例全过。测试刻意**每个用例都换一个实例**调用 `clear()` 以模拟换页，并用 jsdom 真实 `localStorage` 而非替身 | `5f6f0ab` |
| 2026-10-16 | T04（自述与释放） | T04 承认 `pkill -f next-server` 是它所为，改用按 PID 精确杀，并释放 3100/8100 | 承认并改正 + 主动说明占用的进程与日志位置，使我能起干净服务做跨包回归。**T04 四条命令全绿**（typecheck/lint/test **297 通过**/build 0）、后端 nav 59 通过、旧站 53 通过、真实浏览器验收 **35/35** | 待交付 |

## 未决缺陷：地图的 `/` 目的地会整页重载（2026-10-16，T00 独立测量）

**现象**：在 `/map` 点击 `.mp-svg .loc.on`（其 `href` 为 `/`）会触发**文档级导航**（真正的整页重载），而不是客户端导航。

**证据**（真实 Chromium，两个独立测法）：

| 测法 | 结果 |
| --- | --- |
| 页面内打 `window.__mark` 标记，点击后检查标记是否存活 | **8/8 次标记丢失**（文档被重建），路径都变为 `/` |
| Playwright 侧监听 `load` 事件（不注入页面脚本） | **4/4 次出现文档级导航** |

**对照**（同一组件、同一页面）：`href` 为 `/posts/...` 的地图图标 → **客户端导航**（标记存活、无 `load` 事件）。所以差异**与「是否已选中」无关**（我做了分离实验：hover 使文章图标成为 `.on` 后点击仍是客户端导航），**与目的地在不在站内也无关**，只与**目的地是 `/`** 相关。

**为什么算缺陷**：整页重载会重建音频、**打断音乐连续性**，并让过场收尾失效 —— 正是 T02 交付单 §7 记录的那一类后果。T02 新增的 `client_navigation()` 回归检查覆盖了四类入口，但**没有覆盖 `/` 这个目的地**，所以它没抓到。

**已知的旁证（重要线索）**：这个现象有**海森堡效应** —— 一旦在页面里注入 `document` 的捕获阶段 `click` 监听器，重载就不再发生（标记存活、无 `unload` 事件）。说明它与**事件时序**强相关，很可能仍是「谁先处理这次点击」的竞态，只是在 `href="/"` 这条路径上稳定触发。

**我尚未确定的部分（不要当成已知）**：根因未定位。我没有证明是 `link-guard` / `coordinator` / `SvgSiteLink` / Next 的哪一环；也没有证明 `/` 在 coordinator 里走了哪条分支。`coordinator.tsx:241-252` 有两处提前返回（站外目的地、同 path+search），但都不适用于 `/map` → `/`。

**影响**：T02 的 44 项浏览器套件**无法跑完**（它恰好在 reduce 场景点击该元素后取 `__PHANTOM_DEBUG__`，此时文档正在重建）。因此**跨包浏览器全量回归仍记为「未完成」**。
| 2026-10-16 | **T04 交付入库 + 接线完成** | 复核、入库（`2245704`，54 文件 / 9674 行）并完成全部接线（`b78d8ad`）| ① `MODEL_MODULES` 追加 nav；② `MODULE_ROUTER_TARGETS` 登记 nav 并**删除 `dev_app.py`**（避免留下第二套接线）；③ 单头迁移 `2b4578a96db1`：**3 建表 + 2 显式索引、零 drop**，已在真实 PostgreSQL 上 upgrade 并核对落库约束（部分索引 `ix_palaces_public_listing`、唯一 slug、字段 CHECK、同专题文章与顺序分别唯一）；④ 契约 **10 → 18 条路径**（新增 8 条 nav 端点，与 05 逐条吻合）+ 前端类型重生成；⑤ 手机登记 metanav，**图标经核对是仓库内真实资源**（10.4KB）。
**真实浏览器确认**：手机桌面 `['palace','metanav','tokyo','cast','profile']`，点开「导航」渲染出真实内容。
两处**冻结断言按设计拦下了这次改动**并被更新：`EXPECTED_TABLES` 加入 3 张 nav 表；桌面清单断言从「为空」改为表达真正的不变量，并**新增一条测试检查每个登记应用的图标文件真实存在** | `2245704` `b78d8ad` |
| 2026-10-16 | T00（自身操作失误） | 浏览器验证时水合失败，chunk 返回 500 | **原因是我自己**：端口 3199 上残留了先前的服务，它服务的是已被替换的旧 `.next`，chunk 对不上。按我给别人定的规则用 `lsof -ti tcp:3199 \| xargs kill` 清理后一次通过。记录以示：这条规则我自己也会犯 | 已修正 |

### T00 撤回：地图 `/` 目的地**没有**整页重载缺陷（2026-10-16）

我在上一轮以「未决缺陷」记录过：点击地图上 `href="/"` 的地点会整页重载。**该结论不成立，现予撤回。**

**它实际是客户端导航**，三重证据：

1. **T02 套件里那条检查通过**：`PASS 地图地点图标：客户端导航（不整页重载） — http://127.0.0.1:3199/` —— 用的判据正是 `performance.timeOrigin` 是否变化；
2. **我重测 4/4 同文档**：同一判据（`performance.timeOrigin`，**完全不注入页面脚本**）在默认动效下 4/4、减少动效下 3/3 都是「文档未被重建」；
3. **协调器轨迹**：点击后 150ms 起 `navigating=True, pending="/"`，900ms 时路径已到 `/` 且 `navigating=False`，全程 `window.__mark` 存活。

**我为什么误判**：用了两种会被自己扰动的测法 —— `window.__mark` 标记存活判定，以及 Playwright 的 `load` 事件计数。前者在页面里注入脚本、后者把客户端导航途中的资源加载误计为文档导航；更早还有一次是**忘了关 `#boot` 开屏**，点击根本没落到图标上。三种测法互相矛盾时，我应当先怀疑测法，而不是先写「未决缺陷」。

**教训（与上一次 `tsc`/SWC 那次同类，已第二次）**：把「我观察到的现象」与「我推断的原因」分开陈述；**优先使用不注入、不扰动被测系统的判据**（`performance.timeOrigin`、Playwright 侧的导航事件），并在写下缺陷前用第二种**互不相关**的方法交叉验证。

### 本轮真正修掉的两处（在 T02 的验收工具里）

1. **`client_navigation` 的第 4 个用例自相矛盾**：先点 `.pw-tab`，紧接着**再点一次 `.pw-tab`** —— 面板一旦打开，`.pw-scrim` 就盖住启动器，第二次点击被拦到超时。旧写法在首帧尚未水合时第一次点击被吞掉，于是偶然通过；水合变快后稳定失败。已改为「先打开手机 → 等 `.pw-wrap.on .pw-app` 出现 → 点手机里的站点链接磁贴」，并写明原因。
2. **桌面清单断言陈旧**：`tiles == ["palace","tokyo","cast","profile"]` 在我登记 metanav 后必然失败。已更新为含 metanav 的完整清单，与两处 vitest 断言保持一致。

**结果**:`tools/browser-verification/verify.py` **48 passed / 0 failed** —— **跨包浏览器全量回归完成**（此前因上述两点一直记为「未完成」）。
| 2026-10-16 | **批次 2 派发** | T04 集成完成后，按 README「基础集成后并行 2–3 个功能包」派发 T05、T07 | T05（手记 / 追番游戏 / 勒布朗近况）与 T07（COOP 友链）开始条件（T01+T02 已集成）满足，与收尾中的 T03 并行。两份派发均带上积累的既有约束：**SiteLink 规则**（禁裸 `<a>` 与自写 onClick 拦截）、`"use client"` 与「构建 ≠ 类型检查」、`noUncheckedIndexedAccess`、登记式临时库（`register_temp_database`）、**只跑自己目录**的并发规则、**按端口精确杀**、手机登记清单（`phone-app.tsx` + 10 字段 manifest、图标须真实存在）、以及浏览器验证的三个时序坑（等水合、`#boot` 拦截、用 `performance.timeOrigin` 判整页重载而非注入标记/load 计数）| 见提交 |
| 2026-10-16 | **T04 seed 跨包独立验证** | 独立验证 T04 的两个关键宣称（幂等、数据不足整体不写），并**首次把 T01 导入与 T04 seed 串起来跑** | 流程：新建临时库 → `alembic upgrade head`（含我的 nav 迁移）→ T01 的 `import_legacy --apply` → **8 篇 published 文章** ✓ （第一次验证这两个域能配合）→ T04 的 `seed`。
① dry-run 正确报告 `found_posts` 4 篇、`missing_posts: []`、`would_create: True`；
② `--apply --publish` 落库：专题 `phantom-base` **published、4 篇文章、6 个别名**（含规范化值）；
③ **幂等属实**：二次运行 `created: False`，专题数仍 1、别名数仍 6；
④ **数据不足整体不写属实**：空库跑 `--apply --publish` → `public_post_count: 0`、**退出码 2**、**专题数 0**。
**我自己建的三个临时库已全部 drop**，未留残留 | 无（仅验证） |
| 2026-10-16 | **T04 验收行「殿堂所有文章撤回」端到端验证** | 独立验证验收矩阵该行：「列表、详情、搜索、匹配、重访均不暴露」 | 临时库 → 迁移 → 导入 8 篇旧站文章 → seed 发布专题 → 逐项确认可见 → **撤回该专题全部 4 篇文章** → 复查：
**撤回前**：列表 `['phantom-base']`、详情 **200**、搜索 `['phantom-base']`、匹配 **found**；
**撤回后**：列表 `[]`、详情 **404**（不暴露存在性）、搜索 `[]`、匹配 **not_found**。**五项判定全部通过**。
口径说明：「重访」指的是前端本机足迹（`footprint`），由 T04 的浏览器验收 35/35 覆盖，**我的脚本没测它** | 无（仅验证） |
| 2026-10-16 | T00（测试陷阱记录） | 我第一次跑上述验证时「撤回前」就什么都看不到，差点误判为缺陷 | **根因是测试写法**：`app/main.py` 在**模块级**构造 `app = create_app()`（供 uvicorn），而 `get_engine()` 是 **`lru_cache`** 的 —— 先导入 `app.main` 再显式传 `Settings(database_url=...)` **改不动已缓存的引擎**，于是 API 查的是环境变量里的 `pl_test`（空库）。**正确做法：在导入 `app.main` 之前把 `DATABASE_URL` 设成目标库**。这是「端到端脚本复用生产 app」时的通用陷阱，值得写下来 | 无 |
| 2026-10-16 | **T04 端点契约一致性抽查** | nav 端点刚接入，抽查是否与全局契约一致（11 项，只读不写）| **全部通过**：
① 公开列表返回 `{items, next_cursor}` 且 `Cache-Control: no-store`；
② 详情 404 的形状为 `{error:{code,message,fields},request_id}`、带 `X-Request-ID` 头、`no-store`；
③ 管理端点未登录 **401**、错误信封形状一致、响应不可入共享缓存；
④ 匹配端点返回 **200**（`not_found` 是业务结果而非错误）；
⑤ 非法游标 **400**（不是静默退化为首屏）| 无（仅验证） |
| 2026-10-16 | T00（预期修正·第三次） | 上述抽查我最初把「管理响应须带 `private`」写成判据，401 只有 `no-store`，一度记为不一致 | **核查后是我的预期错了**：中间件文档明确「只在响应没自带 `Cache-Control` 时补上」，而 `errors.py` 已给所有错误响应加 `no-store`（注释：被缓存的 401/404 会把临时故障固化成长期状态）。**`no-store` 比 `private, no-store` 更严格**（任何缓存都不得存储），要求已满足；管理**成功**响应才带 `private, no-store`（有测试断言）。判据已改为契约实际要求并复跑通过。
→ **同类自我更正已第三次**（前两次：`tsc`/SWC 的无证据推断、地图 `/` 的假阳性缺陷）。共同点都是**我的预期/测法**而非代码。已形成习惯：写缺陷前先回到契约原文与实现注释核对判据 | 无 |
| 2026-10-16 | **验收行「迁移失败」验证** | 就绪检查对三种迁移故障形态的判定（此前只验过「库不可用」）| **三种全部正确识别为 503 / not_ready**：
① **中途失败**（`alembic_version` 已记 head 但缺表）→ 503，且 `checks` 里 **`database: ok` 与 `schema: not_migrated` 分开**（能区分「库挂了」与「没迁完」），响应体**不泄漏缺哪张表**；
② **完全未迁移**（空库）→ 503、`schema: not_migrated`；
③ **平行 head**（`alembic_version` 两行，契约 §5 禁止）→ 503、`schema: not_migrated`；
④ 对照（迁移完成 + 媒体目录就绪）→ **200 / status=ready**，三项 checks 均 ok。
另确认媒体目录缺失/不可写会（正确地）让服务不就绪 —— 写不了媒体的实例不该被判定可用 | 无（仅验证） |
| 2026-10-16 | T00（对照组写法修正） | 对照组最初跑成 503，我差点记为缺陷 | 原因是**我的脚本没建媒体目录**，`media_storage: missing` 是设计行为（`check_media_storage` 要求存在 + 是目录 + 真能写，用探针文件验证且用完即删）。补上目录后对照组 200。**这是第四次「我的预期/写法而非代码」**，同样在核对实现注释后解决 | 无 |
| 2026-10-16 | **验收行「磁盘不足」验证** | 用「媒体根不可写」模拟写盘失败（与 ENOSPC 走同一条 `OSError` 路径），验证该行要求的三点：明确错误 / 不返回假 ready / **不覆盖现有数据** | **四项全部通过**：
① 就绪检查 **503**，`media_storage: not_writable`，且 `database` 与 `schema` **仍如实报 ok**（故障定位不被掩盖），**不是假 ready**；
② 写入失败抛**干净的业务错误 503 `SERVICE_UNAVAILABLE`**（`_storage_unavailable` 把 `OSError` 翻译成可读错误），不是原始异常；
③ **已有对象字节未变** —— 对象键含每次新生成的 UUID，写入不可能覆盖既有文件；
④ **未留半成品**：失败时 `cleanup_objects` 清掉已写入的对象（文件数 1 → 1）。
口径：未真造出满盘的磁盘，用的是不可写目录；两者在代码里同为 `OSError`，故结论对 ENOSPC 成立，但**这是推断而非实测** | 无（仅验证） |
| 2026-10-16 | T00（差点记下一次**假通过**） | 上述验证第一版只断言「抛出了 ApiError」就判过 | 实际那次是 **422**，因为我的最小 PNG 在**图片处理阶段**就被拒了、**根本没走到存储写入路径** —— 检查的是错误的分支。换成仓库里的真实图片后才得到 503。**这与此前几次「假缺陷」互为镜像：不核对「测的到底是哪条路径」会得到假通过**，而假通过比假缺陷更危险（它会让未验证的东西看起来已验证）| 已修正 |

## 容错组验收完成：四项全部独立验证（2026-10-16）

验收行「API 重启、DB 不可用、磁盘不足、迁移失败 → 明确未就绪 / 错误，不返回假 ready，不覆盖现有数据」现已**四项全部独立验证**：

| 场景 | 关键证据 |
| --- | --- |
| **DB 不可用** | live 200 / ready 503 / 公开读 503 且不泄漏 |
| **迁移失败** | 三种形态（中途失败 / 未迁移 / 平行 head）均 503，且 `database` 与 `schema` 分开报告、响应不泄漏缺哪张表 |
| **磁盘不足** | ready 503 `media_storage: not_writable`；写入抛干净 503 而非原始异常；**已有对象字节未变**；无半成品 |
| **API 重启** | **SIGKILL**（严于 SIGTERM）：中断期间如实失败（连不上，非假 ready / 非假数据）；重启后 ready 200、公开读恢复，且 **posts 8→8、palaces 1→1、aliases 6→6、标题与专题行校验和完全一致** |

后三项的脚本均自建临时库与媒体目录，**跑完自行 drop/删除**，无残留。

**口径说明**：「磁盘不足」用不可写目录模拟（与 ENOSPC 同走 `OSError`），结论对 ENOSPC 属**推断**而非实测；「API 重启」用的是真实 uvicorn + 真实 PostgreSQL + HTTP 请求，属实测。
| 2026-10-16 | **验收行「API 重启」验证** | 真实 uvicorn + 真实 PostgreSQL + HTTP 请求（11 项）| ① 启动后 ready 200、公开读有数据；② **SIGKILL** 中断期间请求**如实失败**（连不上，**不是假 ready、也不是假数据**）；③ 重启后 ready 200、公开读恢复，且**数据完全未变**：posts 8→8、palaces 1→1、aliases 6→6、文章标题串校验和与专题行校验和**逐一相同** | 无（仅验证） |
| 2026-10-16 | **T05+T07 早期模型检查** | 三个新域（journal / leisure / coop）刚落地 models 时做导入与迁移预演（不写文件）| **8 个模块按依赖顺序导入成功、无表名冲突、表总数 16**；新声明 5 张表：`journal_entries`、`journal_entry_media`、`leisure_entries`、`friend_links`、`friend_link_tags`。
**预演 11 项变更**（5 建表 + 6 索引），**全部为新增、零 drop**；索引覆盖公开列表/日历/日期/关联媒体等查询面。
**约定继承良好**：三个域的公开列表索引**都用了部分索引**（journal 与 leisure 用 `postgresql_where=sql_text(...)`，coop 抽成共享常量 `_PUBLIC_LISTING_WHERE`），与 posts / palaces / moments 的既定模式一致 | 待交付 |

## 会话状态观察：三个 agent 从注册表消失但仍在写（2026-10-16）

`list_agents` 只剩 lead，T03/T05/T07 均查不到，给 T03 发消息报 `active teammate not found`。但**文件仍在被修改**（近 2 分钟 8 个、近 10 分钟 33 个），说明它们**仍在运行、只是不可寻址** —— 我无法再向它们发送协调消息（包括「请收尾交付」）。

**处置**：不再依赖消息协调，改为**以磁盘产物为准**推进；持续用文件 mtime 判断各包是否仍在写。若某包静默且代码全绿，则按「已交付但缺交付单」处理并如实记录。

## T03 集成准备（已完成，接线本身随时可做）

T03 的 `moments/wiring.py` 明确写出集成动作，并做完了两半验证：

- **wiring**：`moments_wiring.register()` 贡献**两项** —— `media/public_refs` 与 `tags/service`。登记后媒体公开引用 `['moments','posts']`、标签来源 `('moments','posts')`；登记前为空（**默认拒绝**生效）。
- **契约**：加 moments router 后 **18 → 24 条路径**（新增 6 条：`/moments`、`/moments/{id}`、`/admin/moments` 及 publish/unpublish）。
- **幂等性**：同一进程内连续两次 `create_app()` 安全（路由一致 18 条、登记未被清空），**进程级守卫是唯一防线** —— 底层 `wiring.register()` **本身不幂等**（重复调用抛 `DuplicateCheckerError`）。
- **一处设计确认**：`create_app(module_routers=…)` 的**测试路径不触发内容域登记**（我最初用它做彩排，只见 posts 引用，正是这个原因）—— 与「None = 生产接线、显式 dict = 测试接线」的既定设计一致。

**我的脚本两次失误**（都不是代码问题）：先手动 `posts_wiring.register()` 再 `create_app()` → 触发重复登记报错；`SECRET_KEY` 只写了 31 字符被校验拦下（说明长度校验有效）。
| 2026-10-16 | **T03 集成准备** | 三个 agent 不可寻址但仍在写；改为以磁盘产物为准 | T03 全量复验**全绿**：moments **65 passed**、既有域 **176 passed**（零回归）、typecheck/lint/build **0**、前端 **304 passed**。集成动作已两半验证：wiring 登记后媒体引用与标签来源均变为 `('moments','posts')`；契约 18→**24 条**；二次 `create_app()` 安全（但底层 `register()` 不幂等，进程级守卫是唯一防线）| 待集成 |
| 2026-10-16 | **T03 交付入库 + 接线完成** | 复核、入库（`4231996`，56 文件 / 10318 行）并完成接线（`6f494f5`）| ① `MODEL_MODULES` 追加 moments；② 路由登记；③ `register_content_domains()` 追加 `moments_wiring.register()` —— **不做这一步 = 匿名读动态图片一律 404**，实测贡献 `('moments','posts','tags:moments','tags:posts')` **与交付单期望值逐字一致**；④ 单头迁移 `cfd959a27f73`：**3 建表 + 4 索引、零 drop**，真实 PG 上核对到 `ck_moments_text_length`（2000 码点 CHECK）与 `moment_media` 位置唯一约束；⑤ 契约 **18 → 24 条** + 前端类型重生成；⑥ 手机登记 `INS_MANIFEST`（order 10，在 metanav 前）。
**真实浏览器确认**：桌面 `['ins','palace','metanav','tokyo','cast','profile']`（6 项顺序正确），点开 INS 渲染真实内容。
三处**冻结断言按设计拦下改动**并更新：`EXPECTED_TABLES`（+3 张）、两处桌面清单、`verify.py` | `4231996` `6f494f5` |
| 2026-10-16 | **T03 §8.1 集成发现（待 T10 决策）** | 浏览器经 **Next rewrite** 的同源 POST **不带 `Origin`** | 真实浏览器实测：Chrome 不为此形态发送 `Origin`，而 `app/core/csrf.py` 的 `verify_origin` 按 05 §5「缺失 Origin 的状态变更请求一律拒绝」返回 **403** —— **会阻塞管理写操作**。属**集成层形态与设计假设不一致**（05 §5 假设浏览器直连同源 API），非 T03 缺陷。开发期用代理补 `Origin` 绕过。**生产形态需 T10 确认**：网关转发是否补 / 保留 `Origin`。已记入 T10 交接清单 | 待 T10 |

### T00 更正：T03 §8.1 的「Origin 缺失」**不复现**（2026-10-16）

T03 报告「浏览器经 Next rewrite 的同源 POST 不带 `Origin`，被 `verify_origin` 按 05 §5 拒为 403」，我记为待 T10 决策。**我实测后确认该诊断不成立**，现更正：

**三步证据**（真实 uvicorn + 真实 PostgreSQL + 真实 Chromium）：

| 步骤 | 结果 | 说明 |
| --- | --- | --- |
| API 直连**不带** `Origin` | `缺少 Origin，拒绝状态变更请求` | 基线：两种失败信息可区分 |
| API 直连**带** `Origin: ...:3100` | `CSRF 校验失败` | 基线：来源校验已通过 |
| **经 Next rewrite（3100）带 `Origin`** | `CSRF 校验失败` | **Next 转发了 `Origin`** |
| **真实浏览器**同源 POST（经 rewrite） | `CSRF 校验失败` | **浏览器确实发了 `Origin`** |
| 真实浏览器 `session → 带 token 登录` | **`authenticated: true`** | 管理写链路**完全可用** |

**结论**：T03 看到的 403 是**它自己列出的第 2 个缺陷**（写操作没带 CSRF token，共享客户端缺 `headers` 选项），而那个它**已经修了**（token 走请求体）；「缺少 Origin」是对同一个 403 的误判。**无需 T10 为 Origin 采取动作**。

**保留给 T10 的一条**（仍然合理）：网关转发 `/api/v1` 时**必须保留 `Origin` 与 `Host`**，否则 `verify_origin` 的同源比对会失败 —— 这是「转发要保头」的常规要求，不是本次的缺口。
| 2026-10-16 | **T00 更正：Origin 问题不复现** | 独立实测 T03 §8.1 的诊断 | **五步证据**证明 `Origin` 确实被浏览器发出、也被 Next rewrite 转发：API 直连不带 Origin 报「缺少 Origin」、带 Origin 报「CSRF 校验失败」；经 rewrite 与真实浏览器同样报「CSRF 校验失败」；真实浏览器 `session → 带 token 登录` 返回 **authenticated: true**。→ T03 看到的 403 是它**自己已修**的「写操作没带 CSRF token」，不是 Origin 缺失。**降级为「无需 T10 动作」**，仅保留「网关转发须保留 Origin/Host」的常规要求 | 已更正 |
| 2026-10-16 | **T05/T07 在途健康检查** | 两个包的前端落地后跑全量四条命令 | **typecheck 0 / lint 0 / test 40 文件 379 通过 / build 0**。路由表已含 `/apps/coop`、`/apps/journal`、`/apps/journal/[id]`、`/apps/leisure`、`/apps/leblanc`。T07 已修掉此前我看到的 2 个 `set-state-in-effect` error；现仅剩 2 条 `react-hooks/exhaustive-deps` **warning**（不阻塞）。手机登记就绪：journal / leisure / coop **都已建 `phone-app.tsx`**，coop 另带 `phone-manifest.tsx` | 待交付 |
| 2026-10-16 | **数据源切换决策更新** | 补入 T03 实测到的新约束 | 打开 `PHANTOM_POSTS_SOURCE=api` **必须重新构建**：`/posts/[slug]` 要从 SSG 变 Dynamic，否则运行时报 `Page changed from static to dynamic at runtime … reason: no-store fetch` 并 500。这是 T02 的所有权范围（T03 只报告）。**接上我此前记录的决策**：切换时若仍要显示阅读时长，应在服务端算好加进列表 DTO（不要 N+1）；且**切换动作与重新构建是同一步**，不能只在运行时改环境变量 | 待切换时执行 |
| 2026-10-16 | **T07 外链安全审计** | 独立实测 `normalize_external_url`（验收第 2 条：`javascript:` / `data:` 不能成为可执行外链）| **15 个恶意/非法输入全部被拒**：`javascript:alert(1)`、大小写变形 `JavaScript:`、前置空白、**制表符混淆 `java\tscript:`**（朴素前缀检查最常漏的一种）、`data:text/html,<script>…`、`vbscript:`、`file://`、协议相对 `//example.com`、相对路径、`ftp:`、`mailto:`、空串/纯空白、`http://` 与 `https://`（无主机）。**4 个合法输入正确规范化**：`HTTP://EXAMPLE.COM/A` → `http://example.com/A`（scheme 与主机小写、path 保留）。
实现是**三层防御**：服务层校验 + **数据库 CHECK 约束**（服务被绕过也写不进可执行 scheme）+ **发布时复检**（手工写库或历史数据里的非法 scheme 不能借发布变成公开外链）| 待交付 |
| 2026-10-16 | **T05 隐私审计** | 检查「草稿/私密日记在所有公开入口都不可见」是否收敛到单一事实源 | `public_conditions()` **一处定义**，返回**四重条件**（`status=published`、`visibility=public`、`deleted_at IS NULL`、**`entry_date <= 展示时区的今天`** —— 最后一条能防未来日期的草稿泄漏），被**列表 / 详情 / 日历** 三个公开端点共用，**还被媒体公开引用检查复用**（第 559 行）——所以私密日记的图片也不会因别处引用而泄漏。数据库**部分索引**的条件与它一致（模型注释明确写出）。三个公开端点均经 service 层，无旁路 | 待交付 |
| 2026-10-16 | **T07 内容真实性审计** | 检查「角色联系人不在真实友链列表、旧示例不被描述成真实朋友」（验收第 3 条）| 先查旧站素材：`assets/js/site.js` 的 `coop` 是 **6 个 Persona 5 虚构角色**（摩尔加纳 / 双叶 / 祐介 / 真 / 龙司 / 春），带游戏内的 `rank`（9/7/6/8/4/5），且 **url 全部指向同一个占位符 `https://github.com/`** —— 是模板演示数据，不是真实友链。
**T07 的处理超出要求**：① **完全没有 seed/import 模块**，一处都没导入；② 模型**不建 `rank`/`affection`/`favor` 列**（注释写明「阿尔卡那是装饰用的文字，不是等级」）；③ 界面**明确向用户说明**——「摩尔加纳属于同人剧情，不是这里的友链」「角色消息里的双叶、摩尔加纳属于同人剧情，不在这份名单里」；④ 自带 `tools/verify-coop.py` 把 6 个旧示例名列为**必须不出现**的断言名单。另注：`coop/models.py` 注明「真实友链与虚构角色分别建模」（05 §11）| 待交付 |
| 2026-10-16 | **T05 时区审计** | 独立实测「日期按明确展示时区处理，**不因 UTC 转换错一天**」的跨午夜边界 | `display_today()` 用显式 `DISPLAY_TIMEZONE = Asia/Shanghai` 而非服务器本地时区；**五个边界全部正确**：
`UTC 15:59:59` → 沪 23:59:59 → **仍为 16 日**；`UTC 16:00:00` → 沪次日 00:00 → **17 日**（这是最容易错的一格）；`UTC 23:30` → 17 日；**裸时间按 UTC 处理**（源码注明「裸时间正是错一天的来源」）→ 17 日；带沪时区的 00:30 → 17 日。**无 off-by-one**。
集成待办：`DISPLAY_TIMEZONE_NAME` 目前是模块常量，T05 的注释指向交付单的集成申请要把它挪进 `Settings` —— 接线时处理 | 待交付 |

## T05 + T07 集成就绪预检（2026-10-16，交付前）

三个新域都自带 `wiring.py` 并写明集成方式。**登记预演**（全新进程、直接调用各 register）：

| 时点 | 媒体公开引用 | 标签来源 |
| --- | --- | --- |
| 登记前 | （空，默认拒绝） | （空） |
| 登记 posts + moments | `['moments','posts']` | `('moments','posts')` |
| **再登记 journal + leisure + coop** | **`['coop','journal','leisure','moments','posts']`** | **`('moments','posts')`** |

即：三个新域**都贡献媒体公开引用**（日记封面/正文图、娱乐封面、友链头像），而**只有 posts 与 moments 贡献公开标签来源**。

**T07 关于标签的决定是刻意的**（`coop/models.py` 与 `coop/wiring.py` 都写明了理由）：友链标签存在自带的 `friend_link_tags` 表，**不进共享 `tags` 表** ——
「把友链标签混进去会改变 `GET /api/v1/tags` 的含义，也会让撤回友链影响文章标签统计」。它还用 `verify_contributions()` 把这条决定变成**可执行断言**，防止后人「顺手」加一条全局注册而没有更新文档。

**集成待办清单**（交付后按此执行）：
1. `MODEL_MODULES` += journal / leisure / coop models
2. `MODULE_ROUTER_TARGETS` += 三个 router
3. `register_content_domains()` += 三个 `wiring.register()`
4. 生成单头迁移（预演：5 张表 + 6 索引，零 drop）
5. 契约重生成 + 前端类型（预计 24 → 30+ 条路径）
6. 手机登记 journal / leisure / coop（三者都已建 `phone-app.tsx`，coop 另带 manifest）
7. **删除** `coop/dev_app.py` 与 `coop/dev_tables.py`（T07 的本地验证入口）
8. T05 的 `DISPLAY_TIMEZONE_NAME` 从模块常量挪进 `Settings`
| 2026-10-16 | **T05/T07 集成就绪预检** | 交付前做 wiring 登记预演与集成交付清单 | 登记后媒体公开引用 = **`['coop','journal','leisure','moments','posts']`**、标签来源 = **`('moments','posts')`**；三个新域都贡献媒体引用，只有 posts/moments 贡献标签来源。**T07 不登记标签来源是刻意的**（友链标签走自带的 `friend_link_tags`，避免改变 `GET /tags` 含义、避免撤回友链影响文章标签统计），并用 `verify_contributions()` 做成可执行断言。已整理 8 条集成待办（含删除 `coop/dev_app.py`、时区挪进 Settings）| 待交付 |
| 2026-10-16 | **批次 3 派发** | 按任务卡的**开始条件**逐条核对后派发 T06、T08 | T06（作品与记忆画廊）条件为「T04 已集成」**已满足**；T08（IM 与剧情/AI 混合消息）条件为「T03 已集成」**已满足**，且两者卡片都写明「可与对方并行」。**T09 条件为「T04 + T06 已集成」—— T06 尚未集成，故不派发**（按卡片条件等待）。
两份派发均带上积累的既有约束：SiteLink 规则、`"use client"` 与「构建 ≠ 类型检查」、`noUncheckedIndexedAccess`、登记式临时库、只跑自己目录、按端口精确杀、手机登记清单、浏览器验证三个时序坑（含用 `performance.timeOrigin` 判整页重载）。
T08 另加三条硬要求：**访客会话不复用 `sessions` 表**、**会话 A 不得读到会话 B**（要端到端证明）、**AI 适配层可替换 + 默认模拟**（不得采购/搜密钥/启用收费调用，AI 失败不得让剧情不可用）。
T06 另加：**不伪造奖项或数字**、**同一媒体不重复上传**（复用 media ID）、作品只链接当前公开专题且不露出隐藏标题 | 见提交 |
| 2026-10-16 | **T05/T07 接线全量彩排** | 交付前在内存中模拟接线，得出可逐项对照的预测值 | **模型**：9 个模型模块、**表总数 19**（当前 14 + 新增 5：`journal_entries` / `journal_entry_media` / `leisure_entries` / `friend_links` / `friend_link_tags`），无表名冲突。
**迁移**：预演 **11 项**（5 建表 + 6 索引），全部为新增、零 drop。
**契约**：**45 条路径**（当前 24 + 21）。新增明细：journal 3 公开 + 5 管理（含 `/visibility` 切换）、leisure 2 公开 + 4 管理、coop `/coop/links`、`/coop/links/{id}`、**`/coop/tags`** + 4 管理。
→ **`/coop/tags` 印证了 T07 的标签决定**：友链标签通过**自己的端点**提供（供界面筛选），而不混进全局 `/api/v1/tags` —— 既满足「标签筛选」的功能要求，又不改变全局标签的语义 | 待交付 |
| 2026-10-16 | **验收行「同图所有公开引用撤回」多引用语义验证** | 此前只验过「单个内容撤回后图片 404」，**没验多引用下的语义** —— 而验收要求的关键正在这里 | 用两个动态引用**同一 media**（同一次上传）端到端验证，**六项全部通过**：
① 上传一次得到 original + w320 + w640；② 两个动态复用同一 media（未重复保存图像）；
③ 两处引用都在 → 派生变体匿名 **200**，而**原图匿名始终 404**（永远仅管理用途）；
④ **只撤回一处** → 该动态公开详情 404，但派生变体**仍公开可读**（另一处引用还在）；
⑤ **全部撤回** → 派生变体匿名 **404**。
→ 证实 `media/public_refs` 是「任一已登记域声明公开引用即可读」的**任一语义**，撤回只在无可达引用时才生效 | 已固化为验收工具 |
| 2026-10-16 | **验收行「隔离恢复 DB + 媒体」安全部分：会话复活** | 独立实测「旧会话撤销」这条要求 | **发现真实风险：恢复备份会让已撤销的会话复活。** 流程：登录 → `pg_dump`（此时会话有效）→ 登出（撤销，确认失效）→ 恢复到全新库 → **显式重放登出前保存的 Cookie** → **`authenticated=True`**。
恢复后的 sessions 表两行：预登录会话 `revoked=20:07:59`、**登录会话 `revoked=NULL`** —— 备份早于登出，恢复把 `revoked_at` 覆盖回 `NULL`，于是持有旧 Cookie 者重新获得站主访问权。
**T10 待办**：恢复流程必须包含「恢复后撤销 / 清空全部会话」。当前只有单个 `revoke_session`，**没有「撤销全部」入口**；可用 `UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL;`（或清空该表）。
已固化为 `tools/acceptance/verify-restore-revokes-sessions.py` | 待 T10 |
| 2026-10-16 | T00（两次测量陷阱，均当场修正） | 上述验证第一版得到「**未复活**」的结论 | **那是假通过**：登出时服务器下发 `Set-Cookie` 清除会话，我的 cookie jar 照做，于是恢复后的请求**根本没带旧 Cookie** —— 测的是「无 Cookie 请求」。修正为「登出前抓 Cookie 原文 + 恢复后用显式 `Cookie` 头 + 无 jar 的 opener 重放」后才看到真实结果。第二版又发现查库只取第一行会看到**误导性的 `revoked_at`**（登录流程会产生多行），改为列出全部行 | 已修正 |
| 2026-10-16 | **新增 `revoke_sessions` 运维 CLI** | 上一轮发现「恢复备份让已撤销会话复活」后，把修复动作补成工具 | `python -m app.commands.revoke_sessions --all`（或 `--username <名字>`）。遵循既有 CLI 约定：**必须显式给出范围**（无默认值，退出码 2 拒绝）、只写 `revoked_at` 不删行（审计可追溯）、幂等、输出不含 token。
**语义细节**：`--username` 只撤该站主自己的会话，**不动预登录会话**（`user_id` 为 NULL，不属于任何站主）—— 清那种会话要用 `--all`。
验证：HTTP 端到端 7 项全过（关键项是**撤销后旧 Cookie 确实失效**）；单元测试 5 例；auth 目录 28 通过零回归；已集成域全量 **300 通过** | `8b24e96` |
| 2026-10-16 | T00（测试脚手架连错四轮） | 上述 CLI 的单元测试我改了四轮才通过 | 依次是：① `t01_database_url` **只建空库**、建表在 `t01_schema_report`（须依赖 `t01_session`）；② 漏了必填的 `csrf_secret` 列；③ `token_hash` 有**唯一约束**而我每个测试用同一对固定值；④ 把 `--username` 的语义写错（它本就不该动预登录会话）。**四次都是测试写法而非被测对象** —— 与前几轮的测量错误同一类，说明「先怀疑自己的测法」这条纪律仍然必要 | 已修正 |
| 2026-10-16 | **T06/T08 早期检查** | 两个新包开始产出后做模型与结构检查 | **T06**：`projects` / `gallery` 两个域已建齐（models/router/schemas/service/**wiring**/**public_refs**，与既有域同构）；模型导入无冲突，声明 **4 张表**（`projects`、`albums`、`album_media`、`project_media`）+ **7 个索引**，迁移预演 11 项。两处细节符合约定：**`ix_projects_palace_id`**（卡片要求「作品可有可空 palace 外键」）与两个**部分列表索引**（`ix_projects_public_listing` / `ix_albums_public_listing`，沿用 posts/palaces/moments/journal 的一致模式）。
**T08**：`messaging` 域已分出 `ai/` 适配层子目录 + `characters.py` / `config.py` / `content.py` / `stories`，与它卡片的「可替换适配层」要求一致 | 待交付 |
| 2026-10-16 | T00（过滤条件写窄） | 首次列 T06 的表时只看到 2 张 | 我用了单数形式过滤（`project`/`album`），漏掉复数表名 `projects` / `albums`。**这类「过滤条件本身写错导致漏看」与前几轮的测量错误同类**，改为列出全表后确认是 4 张 | 已修正 |
| 2026-10-16 | **批次 4 派发：T10** | T10 卡片条件为「T01 + T02 已集成」**已满足**，且卡片明确「可先准备部署」 | 派发 T10（容器生产化、CI、备份恢复、跨模块验证、发布准备）。**交付前把 T00 已查实的事项全部交接**，避免它重新发现：
① 恢复备份让已撤销会话复活 + 新增的 `revoke_sessions` CLI（含 `--username` 不动预登录会话的语义）；
② 网关须转发 `/assets/music/`，且转发 `/api/v1` 时**保留 `Origin` 与 `Host`**；
③ `PHANTOM_POSTS_SOURCE=api` 的切换与**重新构建是同一步**（否则运行时 500）；
④ CI 可用的既有测试资源与**契约漂移守卫**；⑤ 四个验收工具；⑥ 全部已知未验证项。
并明确告知：**Docker daemon 未运行**，容器项不得声称已验证，只做实 `compose config` 语法、静态审查、CI 工作流与**可在本机真实 PostgreSQL 上实测的备份/恢复脚本** | 见提交 |
| 2026-10-16 | **T07 交付入库 + 接线完成** | 复核、入库（`4941880`，48 文件 / 7502 行）并接线（`5c223e5`）| **入库前修掉一处真实缺陷**：`service.list_public_tags()` 返回 `(规范值, 展示名)`，而 docstring、router 解包顺序与 `FriendTagOut(name=…, normalized=…)` 都按 `(展示名, 规范值)` —— **API 的 name 与 normalized 互换**；因展示名取「排序最靠前的友链写法」，当它恰好等于规范值时互换不可见，表现为**间歇性失败**（实测 84 过 → 连续 83+1 失败）。修正后连跑 4 次稳定。
接线：模型/路由/wiring 登记、单头迁移 `c652ce04a8bf`（**2 表 + 2 索引、零 drop**；头像外键落库为 **ON DELETE SET NULL**；含 `ck_friend_links_url_http_scheme` 数据库层兜底）、契约 **24 → 31 条**、前端类型重生成、删除 `dev_app.py`/`dev_tables.py`、手机登记 COOP。
**两处入口接线（属别人文件，由我做）**：① `/about` 第 02 区把旧站快照的 **6 张 P5 角色示例卡**（带 `RANK UP` 与好感度进度条）换成 `<CoopLinksSection />` —— **这一步才真正满足验收第 3 条**；② INS 资料区接 `<CoopEntry />`。
**浏览器确认**：`/about` 第 02 区变为「真实友链」，页面**不再出现 `RANK UP` 与「COOP 等级」**，角色名只出现在「不属于这份名单」的说明句中；手机桌面顺序 `['ins','palace','tokyo','cast','coop','profile','metanav']`。
**order 决策**：T07 建议自取 30，但 07 §7 首屏顺序为 INS/手记/放课后/COOP/异世界导航，30 会让 COOP 排在导航之后、与设计相反。本次按设计**预留序位**（ins 10 / coop 40 / metanav 50，留出手记 20、放课后 30），并注明应用与 site-link 共用命名空间导致交错 | `4941880` `5c223e5` |
| 2026-10-16 | **T05 交付入库 + 接线完成** | 复核、入库（`65607e0`，73 文件 / 13565 行）并接线（`a7d58c8`）| 单头迁移 `a149458fb34e`：**3 建表 + 4 显式索引、零 drop**，落库 **21 个约束**，含 `ck_journal_entries_visibility_valid` 与 leisure 的**跨字段完整性**（`anime_has_no_game_fields` / `game_has_no_anime_fields` / `progress_matches_kind` / `episodes_within_total`）—— 把「追番与游戏共用一张表」的设计在数据库层保护住。契约 **31 → 45 条**。
**两处序位修正**：① T05 建议 journal/leisure 取 order 30/40，会与已登记的 coop(40) 冲突并把放课后排到 COOP 之后（与 07 §7 相反），改用我预留的 **20/30**；② **发现 coop manifest 的实际 order 仍是 30** —— 我上一轮只在注释里写了 40、没改实际值，导致它与 leisure(30) 打平后按 id 排序，已修正为 40。leisure 图标由 oracle.webp 改为 fox.webp，避免与 metanav 同图标。
**首页接线** `<LeblancView />`（位置按 07 §3 与 T05 §8.8）；`/apps/leblanc` 独立入口保留。
**T05 如实记录的一条**：手记/放课后**未接进 nav 搜索**，所以「私密不进搜索」目前是因为没接、**不是过滤** —— 这类区分正是交付单该有的诚实度。
T05 另报告一个**测试陷阱**：服务层 `Session.commit()` 会提交测试夹具的外部事务、rollback 撤不掉，它在 conftest 里加了提交后的显式 TRUNCATE | `65607e0` `a7d58c8` |
| 2026-10-16 | **T10 交付前审查（备份/恢复/CI）** | 在 T10 交付前先审它的安全关键产物 | **备份/恢复脚本的安全设计到位**：`backup.py` 目标目录非空即拒绝（需显式 `--force`）、**不做任何 `DROP`、不碰卷**；`restore.py` **永不 DROP 数据库**、媒体目标非空即拒绝、有 **sha256 校验清单**、不执行 `down -v`、不做 downgrade。
**我交接的那条被完整落实**：`restore.py` 在恢复后调用 `revoke_sessions --all`，并在注释里写明「否则备份里 `revoked_at = NULL` 的会话会复活」，**还引用了我的复现脚本** `tools/acceptance/verify-restore-revokes-sessions.py`；另提供 `--skip-revoke`（带后果警告）；`docs/operations/README.md` 也把这一步列为恢复流程必做。
**CI 覆盖卡片全部要求**：API（真实 PostgreSQL 18 服务容器 + 全量 pytest）、Web（类型/lint/单测/生产构建）、**旧站零回归**（`node --test`）、**compose 配置校验**（prod 与 dev，且含「不给 env 时 compose 必须失败」的守卫）。`release.yml` 只构建与记录 digest，**推送默认关闭**（符合「CI 不自动推送生产部署」）。
**诚实标注**：`ci.yml` 顶部写明「本次没有 GitHub 远端，本工作流**没有被真正运行过**」 | 待交付 |
| 2026-10-16 | **三个验收工具回归（已集成 7 包状态）** | 工具是在更早状态写的，集成后应仍通过 | `verify-ins-media-loop` / `verify-media-multiref` / `verify-restore-revokes-sessions` **三个全部通过**。
过程中撞到一个**工具自身的缺陷**：脚本把服务输出丢进 `DEVNULL` 且只等 40s。集成到 9 个内容域后冷启动变慢，脚本**静默失败**（表现为 502 / URLError，**没有任何诊断信息**，还留下占端口的进程，害我第二次跑也失败）。已改为：服务输出写 `/tmp/pl-acceptance-<port>.log`、等待延长到 60s。
（排查顺序值得一提：先确认 **app 构造正常**（45 条路径）→ 排除自己的集成 → 再看端口占用 → 才发现是脚本的等待与诊断缺失）| `436d4cb` |
| 2026-10-16 | **修 INS 底部死链**（T08 的跨模块发现） | T08 报告 `features/ins/ins-shell.tsx` 底部链接指向不存在的路由 | **核实属实**：`app/posts/` 只有 `[slug]`、**没有 index 页**，所以「长文在博客里」指向的 `/posts` 必然 404；而且它用的是 `next/link` 的 `<Link>` 而非 `SiteLink`（违反站内链接规则）。改为 `<SiteLink href="/#posts" source="phone-link">` —— 首页保留 `#posts` 锚点，且走统一导航 | `436d4cb` |
| 2026-10-16 | **T08 交付入库** | 复核并入库（`c5602c5`，76 文件 / 14734 行）| 后端 23 个文件（含 **`ai/` 适配层**，默认本地模拟不联网不计费）、测试 16 个文件、前端 20 个文件、13 份设计参考截图。T08 自测：后端 **160 例**、前端 58 例、真实浏览器 **42/42**、旧站 53 零回归、build 0。
**两条诚实标注**：① **真实模型联调与费用未做**（无凭证无预算，且明确不得采购或启用收费调用）；② **原版 IM 视觉还原本身未验证** —— 手上只有元件素材表、没有完整参考帧，因此只做了结构 + 已确证语汇的原创适配。
**三条跨模块发现**：不需要 Origin 补丁（它自建访客写闸门兼容 Next rewrite 形态）；INS 死链（已修）；数据源未切换时内容卡片指向 404（api 构建下 200，附对照数据）；390px 下问卷浮层盖住输入区（附截图）| `c5602c5` |
| 2026-10-16 | **T08 接线完成** | 模型/路由/迁移/契约/前端两处 | 契约 **45 → 55 条**、表 **19 → 25 张**（迁移 `18abac49279f`，6 建表、零 drop）。**重点核验 T08 特别强调的那条**：`uq_ai_requests_one_inflight` 落库为**部分唯一索引** —— `CREATE UNIQUE INDEX … ON ai_requests USING btree (conversation_id) WHERE ((status)::text = 'pending'::text)` ✓；它也建了**独立的 `visitor_sessions`**，不复用站主 `sessions`。
**无需 `wiring.register()`**：该域不向任何共享注册表贡献（无自有媒体、不产生公开标签、会话不进公开搜索），并自带 `verify_no_shared_contributions()`；集成后实测内容域贡献**未变** ✓。
前端两处：`InsApp` → `InsAppWithMessages`（必须换组件：页签含函数，不能跨服务端/客户端边界传）；`phone-app.tsx` 加屏幕分派。
**验证用逐目录串行**：整树合跑时撞到 `database "pl_test_t01" does not exist — It seems to have just been dropped`，即并行包跑整棵树 drop 了共享临时库（我们记录的并发规则）。逐目录串行得到 **16 套件 640 项全绿** | `c5602c5` `c4a5bd5` |
| 2026-10-16 | T00（两次写坏冻结清单） | 更新 `EXPECTED_TABLES` 到 25 张时连错两次 | ① 插入破坏了**字母序**（`conversations` 放到 `audit_events` 前）；② 修的时候脚本**漏调 `import_all_models()`**，`registered_tables()` 返回空，于是把清单**写成空元组**。两次都是「改断言」这一步出的错 —— 与前几轮同类 | 已修正 |
| 2026-10-16 | **发现并修复：T08 消息功能在手机上不可达** | 接线后用浏览器验证手机端（这是接线的用户可见结果）| 桌面顺序正确 `['ins','palace','journal','tokyo','cast','leisure','coop','profile','metanav']`，但 INS 页签只有 `['动态','收藏']` —— **消息页签没出现**。
根因：canonical 页面 `app/apps/ins/page.tsx` 已换成 `InsAppWithMessages` ✓，而**手机打开的是 `features/ins/phone-view.tsx` 的 `InsPhoneView`**，它渲染 `InsShell` 时没传 `tabContributions`。
**这是真实缺口而非观感问题**：T08 已登记 `screens = ["messages","conversation"]`，但手机里只有 `conversation` 能回到 `messages`，**没有任何入口能首次进入 `messages`** —— 功能齐全但用户到不了。
修法：注入一个消息页签，与 canonical 的 `MESSAGES_TAB` 用**同一个 id/label/order**，只改一处 —— `CharacterList` 的 `onOpen` 接到**宿主** `navigateScreen("conversation")`，点角色留在手机里。
**端到端验证（真实 API + 真实 Chromium 390px）**：页签出现且 `aria-selected` 切换正确；角色列表**真实加载**出双叶/摩尔加纳、无错误态；对照实验（不起 API）显示「READ FAILED 读不到角色列表 + 重试」—— 降级得体 | `0888e73` |
| 2026-10-16 | **T10 交付**（发布准备）| 部署编排 / CI / 备份恢复 / 运维文档 / 发布清单 | 实测：备份恢复演练 **34/34**（真实 PG：成对备份 → 校验清单 → 隔离恢复到全新库 → 逐表行数一致 → 恢复后撤销会话，并做对照实验**真实测出「不撤销就会复活」**）；健康演练 **11/11**（DB 掉线/schema 未迁移/媒体缺失/只读/迁移半途一律 503 且不泄漏路径）；**反向代理同源写路径 34/34**（真实 Chromium）；`compose config` 0、`caddy validate` 通过、静态审查 42/42 与 30/30。
**它独立复现了我在 T03 的更正**：生产网关直转 API 时 `Origin`/`Host` 都保留，T03 §8 的 403 在生产形态下**不存在**，因此**不需要**改 `verify_origin` —— 与我此前 5 步实测的结论一致。
**未验证（如实）**：容器构建 / `compose up` / 容器内 readiness 与非 root（Docker daemon 不可用，跑通前 `deploy/` 不得宣称可用）；真实域名 TLS 与 `__Host-` Cookie；T02 的 48 项浏览器套件未重跑；真机触控软键盘、Safari/Firefox、音频出声、磁盘塞满演练、GH Actions 实际执行。
**T10 请求我批准两处最小集成修复**：① `next.config.ts` 加 `output:"standalone"` + `outputFileTracingRoot`（06 §2 要求）；② `app/core/` 支持 `DATABASE_URL_FILE`（目前 DB 口令进容器环境变量，`docker inspect` 可见，它已如实披露）。待处理 | 待交付 |
| 2026-10-16 | **采纳 T10 申请 §6.1：启用 standalone** | Next.js standalone 是 06 §2 的明确要求 | `next.config.ts` 加 `output: "standalone"` + `outputFileTracingRoot` 锁到**仓库根**（monorepo 不锁会让 standalone 目录结构随锁文件位置漂移、runner 的 COPY 路径失配）。`next start` 仍可用，本地开发与 T02 套件不受影响。
runner 段相应重写：COPY standalone/static/public，**CMD 改为 `node apps/web/server.js`**（路径带 `apps/web/` 前缀），并移除 runner 阶段的 `npm ci`（standalone 自带最小 node_modules）。
**我改出的一个严重问题（自查抓到）**：改完出现**两个 CMD**（新的 server.js 与旧的 `next start`），Docker 只认最后一个 —— 那样镜像会走 `next start`，而对应的依赖安装与完整 `.next` COPY 已被我删掉，**能构建但跑不起来**。已删旧 CMD。
**验证（无 Docker 下尽量做实）**：按 Dockerfile 的 COPY 逐条复刻 runner 布局到临时目录，真实运行 `node apps/web/server.js`：`/` `/about` `/apps/ins` → 200；`public` 资源 → 200；`.next/static` chunk → 200。**文件布局与入口已验证**，容器本身仍未验证 | `d457e88` |

| 2026-10-16 | **采纳 T10 申请 §6.6：验收脚本动态端口** | 固定端口在并行时会撞车 | **这也是我自己踩过的坑**：上一轮某脚本在 8124 整段失败、打印一堆 502/URLError，看起来像被测对象坏了，实际是端口被遗留进程占用。三个脚本统一改为「默认端口被占用时自动换空闲端口」，可用 `PL_ACCEPTANCE_PORT` 显式指定。**实测**：占用 8124 后实跑 → 自动换端口并全部通过（退出码 0）| `fc37afd` |

| 2026-10-16 | **采纳 T10 申请 §6.2：DATABASE_URL_FILE** | 此前 DB 口令以插值进容器环境变量、`docker inspect` 可见 | `Settings` 加 `database_url_file` + `model_validator`：**文件优先**、**去掉结尾换行**（Docker secrets 常带换行，直接拼进连接串会得到末尾带 `\n` 的 URL，报错很难指向真正原因）、**文件缺失或为空立刻失败**（静默回退会连到另一个库）、文件内容过同一套 PostgreSQL 校验。
实现上的次序问题：`database_url` 原为必填，那样只给 FILE 时会在读到文件之前先报「缺少字段」；改为默认空串并把「都没给」交给校验器，同时让既有的 `_require_postgres` 放行空串。净效果不变。5 个新用例 + 既有 30 例共 **35 通过**，core/auth/守卫零回归 | `02af498` |

| 2026-10-16 | **T06 交付入库** | 最后一个功能包 | 入库 `f529891`（81 文件 / 17344 行）。后端 **143 passed**（既有目录 122 零回归、连跑 3 次一致）；前端 **609 passed / 57 文件**；build 0；旧站 53 零回归；真实浏览器 **47/47**（3 次一致）；seed 幂等。
**第一件作品是真实的**：p5-blog —— 真实仓库地址、真实技术栈、可复现成果（旧站 53 项测试 + 新站迁移链），效果图用仓库已有的旧站封面素材经 T01 真实媒体服务上传；**没有奖项/星数/用户数/下载量**（projects 表根本没有这些列）。
**T06 自述开发中修掉 10 个真实缺陷**，典型：`serverApiRequest` 自带 `/api/v1` 导致请求变成 `/api/v1/api/v1/...`（详情 404）；相册筛选链接漏 `scope`（筛选看似没生效）。
**未验证（如实）**：Docker；手机面板与 `/apps/ins` 相册页签（待我接线）；**仓库里没有任何真实照片素材** —— 画廊线上内容为空，浏览器验收用的是脚本临时上传、名字写明「验证用」的相册；`year/month` 只有单年份覆盖 | `f529891` |
