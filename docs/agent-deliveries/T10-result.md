# T10 · 交付单（容器生产化、跨模块验证与发布准备）

```text
任务：T10 / 容器生产化、跨模块验证与发布准备
状态：implemented_waiting_integration —— 部署编排、CI、备份/恢复、运维文档、发布清单与限制披露
      已交付并在本机实测通过；**容器构建与容器内启动未验证（Docker daemon 不可用）**；
      生产部署未执行、未获授权。
基线：main @ c4a5bd5（记录时刻 2026-10-16T12:57Z）；开始工作时 HEAD = dc666dd
      开始工作时已有本地改动：T05 / T06 / T07 / T08 并行开发中的未提交文件（非本包产生）
      验收快照用的 HEAD 是 65607e0（T07 接线完成、T06/T08 未提交）
外部影响：未调用任何模型或付费服务；未部署；未推送；未购买任何基础设施。
          T05–T08 在本包执行期间持续接线，本包**没有**触碰它们的目录。
```

## 1. 本轮范围

**已完成**：

1. 生产镜像定义（API / Web，非 root、锁定依赖、无密钥构建层、无源码挂载）；
2. 生产编排 `compose.prod.yaml`（gateway / web / api / db / migrate，只网关对公网，
   web 不持有 DB 凭据，媒体不是公开静态目录，迁移只跑一次且成功才起依赖服务）；
3. Caddy 网关配置（同源 `/api/v1`、保留 `Origin` 与 `Host`、`/assets/music/` 转发、
   请求体上限、结构化日志、明确**不做**业务限流）；
4. 数据库角色分离（管理员 / 迁移 / 运行三账号）与运行账号授权脚本，**在本机真实
   PostgreSQL 18 上实测**；
5. 成对备份 / 校验清单 / 隔离恢复脚本，**在本机真实 PostgreSQL 上实测**（含「恢复后撤销
   会话」这条硬要求，并用对照实验真实测出「不撤销就会复活」）；
6. 三个可执行的静态审查器（部署配置、CI 工作流、破坏性命令扫描）；
7. CI 工作流（旧站测试、前端类型 / lint / 单测 / 构建、真实 PostgreSQL API 测试、
   OpenAPI 漂移守卫、容器构建与冒烟）；
8. 发布工作流（构建 + 记录 digest，**默认不推送、不自动部署**）；
9. `docs/operations/` 四份运维文档 + 发布清单 + 限制披露；
10. 跨模块验收：三个 T00 固化的验收脚本 + 三份本包新增的端到端演练脚本，全部实测通过。

**未完成 / 未验证**：容器构建、容器内启动、真实域名 TLS、生产主机表现（原因见 §5）。

## 2. 新增与修改文件

### 新增（全部在本包独占目录内）

```text
deploy/
  prod.Dockerfile.api                 生产 API 镜像（多阶段、非 root、uv --frozen --no-dev）
  prod.Dockerfile.web                 生产 Web 镜像（多阶段、非 root、显式带 public/.next/static）
  compose.prod.yaml                   生产编排（gateway/web/api/db/migrate）
  gateway/Caddyfile                   网关（TLS、同源代理、请求体上限、日志）
  env/prod.env.example                生产环境变量示例（只有占位符）
  env/dev.env.example                 开发环境变量示例（从 deploy/env.example 迁移）
  db/init/10-roles.sh                 建迁移账号与运行账号（initdb 阶段）
  db/init/20-grants.sh                收紧 public schema 权限
  db/init/_lib/common.sh              init 脚本共用函数（放子目录，避免被入口当脚本执行）
  db/grant-runtime.sql                运行账号授权（幂等，每次迁移后执行）
  backup.py                           成对备份（pg_dump -Fc + 媒体 + 校验清单 + 清单 JSON）
  restore.py                          隔离恢复（先校验、守卫目标、逐表核对、恢复后撤销会话）
  check-prod-config.py                生产配置静态审查（42 项）
  check-ci-workflows.py               CI/发布工作流结构审查（30 项）

.github/workflows/
  ci.yml                              测试 / 契约漂移 / 编排校验 / 容器构建与冒烟
  release.yml                         按 tag 构建镜像并记录 digest（默认不推送、不部署）

docs/operations/
  README.md                           总览、事实基线、三条硬规则、一键自检
  release.md                          发布范围清单、发布步骤、回退路径、失败停止条件
  backup-restore.md                   成对备份 / 隔离恢复 / 恢复后撤销会话 / 角色分离 / RPO·RTO
  runbook.md                          健康判断、常见故障处置、日志、待自动化的定期任务
  limitations.md                      限制与未验证项（集中披露）

tests/e2e/integration/
  verify-backup-restore.py            备份→校验→隔离恢复→数据一致→撤销会话（34 项）
  verify-health-drills.py             真实 uvicorn 下的 readiness 五形态与迁移失败（11 项）
  verify-proxy-same-origin.py         反向代理形态的同源读写（真实 Chromium）+ 旧 URL + 音频（34 项）

.dockerignore                         构建上下文排除（约 800 MB → 只留镜像真正需要的输入）
```

### 修改

```text
deploy/compose.dev.yaml        注释里的 env 示例路径改到 deploy/env/dev.env.example（T00 已交接）
contracts/openapi.json         重新生成（契约漂移守卫的前半，属 T00 交接给我的生成步骤）
apps/web/lib/api/generated/schema.ts  由 npm run gen:api 从上面的契约生成（不手改）
```

**没有修改**：`apps/api/app/**` 业务代码、`apps/api/migrations/**`、`apps/web/**` 业务代码、
`tools/acceptance/**`、`apps/web/tools/**`、任何别人的交付单。

### 关于那两个生成文件（请集成负责人确认）

`contracts/openapi.json` 与 `apps/web/lib/api/generated/schema.ts` 在我开始工作时已经与
当时的后端**漂移**（`test_openapi_contract.py` 用导出的 schema 与磁盘文件比对）。我按
SHARED-CONTRACTS §2 的约定重新生成了它们：

- 漂移原因是 T05 / T07 / T08 的模块已被登记进 `app/router.py` 的 `MODULE_ROUTER_TARGETS`，
  而契约没有同步；
- 重新生成后 `apps/api/tests/test_openapi_contract.py` **4 passed**；
- 新契约里因此出现了 `/api/v1/journal/*`、`/api/v1/leisure/*`、`/api/v1/coop/*`、
  `/api/v1/messaging/*` 等路径 —— **这是代码事实，不代表它们都在本次发布范围内**。
  发布范围见 `docs/operations/release.md` §1。

如果集成负责人认为契约应当滞后于发布范围，请把这两个文件回退并说明策略；本包不擅自决定。

## 3. 验证（全部实际执行，命令与真实输出）

### 3.1 备份 / 恢复隔离演练（真实 PostgreSQL 18）

```bash
cd /Users/学习/blog/Blogs
export TEST_DATABASE_URL="postgresql+psycopg://pl@127.0.0.1:55432/pl_test"
export UV_CACHE_DIR=/Users/学习/blog/.dsh/uv-cache
export PG_BIN=/opt/homebrew/opt/postgresql@18/bin
python3 tests/e2e/integration/verify-backup-restore.py      # 34/34 通过（退出码 0）
```

真实输出（节选，两个 schema head 上各跑通一次：`c652ce04a8bf` 与 `18abac49279f`）：

```text
== 1. 建源库并迁移（真实 alembic）==
  ✓ 源库迁移到单一 head  c652ce04a8bf
== 2. 灌入真实内容（import_legacy）+ 造一条已撤销会话 ==
  ✓ 源库有真实文章（import_legacy 至少导入 1 篇）  posts=8
  ✓ 源库有业务表集合  17 张表
== 3. 成对备份（deploy/backup.py）==
  ✓ 备份清单记录了迁移版本  c652ce04a8bf
  ✓ 备份清单的行数与源库一致  清单 34 行 / 17 表
  ✓ 备份含 custom 格式 dump（非 0 字节）  51470 字节
  ✓ 备份含媒体文件  2 个
  ✓ 备份含校验清单
== 4. 备份目录不覆盖 ==
  ✓ 重复写入同一备份目录被拒绝  exit=1 拒绝覆盖；换一个 --out，或在确认后加 --force
== 4b. 备份之后在源库撤销会话 ==
  ✓ 源库撤销全部会话成功（revoke_sessions --all）  {"revoked": 1, ...}
== 5. 校验清单能发现被改动的备份（故意改 1 字节）==
  ✓ 改动过的备份被校验清单拦下
== 6. 隔离恢复（deploy/restore.py）==
  ✓ restore.py 退出码 0
  ✓ 恢复前后逐表行数一致  17 张表
  ✓ 恢复的媒体数量与大小与清单一致  2 个文件
  ✓ 恢复的媒体内容逐字节一致
== 7. 恢复后旧会话不可复活（06 §5 硬要求）==
  ✓ 恢复库中恢复出来的有效会话先被清零  revoked_at is null = 0
  ✓ 会话行数保留（只写 revoked_at，不删行）  count=2
== 7b. 对照实验：不做撤销那一步会怎样 ==
  ✓ 实测：不撤销会话时，备份里已撤销的会话恢复后会复活  revoked_at is null = 1 / 共 2 行
  ✓ 补跑 revoke_sessions --all 后归零（修复动作有效）
== 8. 恢复流程的目标守卫 ==
  ✓ 像生产库名的目标被拒绝
  ✓ 对非空库恢复（不加 --force）被拒绝
  ✓ 被拒绝时没有留下目标媒体目录
== 9. 角色分离：迁移账号 / 运行账号 ==
  ✓ 迁移账号能建表（迁移成功）
  ✓ 运行账号不能建表（schema 权限被收回）
  ✓ 授权前运行账号读不到业务表
  ✓ grant-runtime.sql 之后运行账号可读
  ✓ 运行账号对表只有 DML 权限（仍不能建表）
== 10. 耗时 ==
  备份 0.405 秒；隔离恢复（含校验 + 撤销会话）0.705 秒
  备份体积 56218 字节
  本次演练在 RTO 4 小时目标内  0.705 秒

== 汇总：34/34 通过 ==
```

在 head = `18abac49279f`（26 张表）上重跑同样 **34/34 通过**，备份体积 85984 字节，
备份 0.765 秒 / 恢复 1.299 秒。

### 3.2 健康就绪与迁移失败演练（真实 uvicorn + 真实库）

```bash
python3 tests/e2e/integration/verify-health-drills.py       # 11/11 通过
```

```text
  ✓ 空库下 liveness 仍为 200（只说明进程活着）  status=200
  ✓ 空库下 readiness 为 503（不返回假 ready）  status=503
  ✓ readiness 明确指向 schema 未迁移  {'database': 'ok', 'schema': 'not_migrated', 'media_storage': 'ok'}
  ✓ 迁移后 readiness 为 200 且 status=ready  status=200 ready      ← 同一进程内自动恢复
  ✓ 媒体目录缺失时 readiness 为 503  media_storage=missing
  ✓ 未就绪响应不泄漏路径 / 库名 / 表名
  ✓ 媒体目录只读时 readiness 为 503（实际写探针文件，而不是只看权限位）  media_storage=not_writable
  ✓ DB 指向不可达端口时 liveness 仍 200
  ✓ DB 不可达时 readiness 为 503  database=unavailable
  ✓ 只迁移到基线时 readiness 为 503（缺业务表 = 迁移没跑完）
  ✓ 补跑迁移到 head 后 readiness 恢复 200（数据未被删除）
== 汇总：11/11 通过 ==
```

### 3.3 反向代理形态的同源读写（真实 Chromium）

用透明 HTTP 反向代理复刻网关语义（**保留 `Origin` 与 `Host`**），浏览器 → 代理 → API：

```bash
python3 tests/e2e/integration/verify-proxy-same-origin.py --web-dir <生产构建目录>
# 在验收快照上 34/34；在当前工作区上同样 34/34
```

```text
== 2. 代理 → API / web 直通 ==
  ✓ 经代理可达 /api/v1/health/live（200） / ready（200，真就绪） / web /healthz（200）
  ✓ liveness 响应带 x-request-id
== 3. 同源校验 ==
  ✓ Host=blog.example.test 时能读到会话端点（说明 Host 被转发而非被改写）
  ✓ 会话端点下发了预登录 Cookie  __Host-pl_session
  ✓ 伪造 Origin 的登录被拒（403）
  ✓ 同源 Origin 的登录通过（200）
  ✓ 带会话 Cookie 复读会话 = authenticated（完整同源写路径通了）
  ✓ 缺 Origin 的写请求被拒（403，符合 05 §5）
== 4. 经代理的旧 URL 重定向与 404 ==
  ✓ /post.html?p=… → /posts/…（308，跟随可达 200）；/index.html、/map.html、/about.html、/guestbook.html 同理
  ✓ 不存在的 slug 返回真 404（不跳首页）
== 5. /assets/music/ ==
  ✓ 200（4447278 字节）；Accept-Ranges: bytes；Range 请求 206 且长度 1024
== 6. 真实 Chromium ==
  ✓ 真实浏览器经代理登录成功（页面上下文内 authenticated=true）
  ✓ 登录后界面显示「已登录」并出现注销按钮
  ✓ 登录请求确实以 POST /api/v1/auth/login 发出（经代理，不是直连 API）
  ✓ 恶意 Origin 的登录在浏览器里被拒（403）
== 汇总：34/34 通过 ==
截图：/tmp/pl-t10-proxy-49706/screenshots/{login-filled,after-login}.png
```

**这一条纠正了一个真实的集成形态问题**：T03 交付单 §8 第 1 条报告「浏览器经 Next rewrite
的同源 POST 丢失 `Origin` → 403」。生产形态是**网关直转 API**，实测 `Origin` 与 `Host`
都被保留，同源写路径正常（登录 200、会话可用）。因此不需要为它改 `app/core/csrf.py`
（候选处理 (c) 不必做）；需要保证的只是网关**不要**改写 `Host`、**不要**删 `Origin` ——
这一点已写进 Caddyfile 注释、`deploy/check-prod-config.py` 的断言与
`docs/operations/runbook.md` §2.4。

### 3.4 部署配置静态审查（不需要 daemon）

```bash
docker compose -f deploy/compose.prod.yaml --env-file /tmp/pl-prod.env config > /tmp/prod.yaml   # 退出码 0
python3 deploy/check-prod-config.py --compose-config /tmp/prod.yaml --caddy /tmp/caddybin/caddy   # 42/42
python3 deploy/check-ci-workflows.py                                                             # 30/30
```

关键断言与真实结果：

```text
  ✓ 编排里有 gateway / web / api / db / migrate
  ✓ 只有 gateway 发布宿主端口  发布了端口: ['gateway']
  ✓ db 在 internal 网络上 / api 同时接内部数据网络 / web 不在数据库网络上
  ✓ web 不持有任何数据库凭据（环境变量名） / web 没有 DATABASE_URL
  ✓ 没有服务挂载仓库源码目录（生产不挂源码）
  ✓ 没有 privileged 服务 / 没有挂载 docker socket
  ✓ api / web / gateway: read_only 根文件系统 + cap_drop ALL + no-new-privileges
  ✓ 没有服务使用 latest 标签；api / web 镜像按 digest 固定
  ✓ API 的 handle 在兜底 handle 之前（顺序 ['handle /api/v1/*', 'handle /assets/music/*',
      'handle /gateway-healthz', 'handle']）
  ✓ 没有改写 Host / 没有删除 Origin
  ✓ caddy validate 通过（v2.10.2 h1:g/gTYjGMD0dec+UgMw8SnfmJ3I9+M2TdvoRL/Ovu6U8=）
  ✓ prod.Dockerfile.*: 构建层没有密钥类 ARG / ENV；非 root；锁定依赖
  ✓ web 镜像显式包含 public 与 .next/static
  ✓ prod.env.example / dev.env.example: 没有像真值的密钥
  ✓ .dockerignore 没有排除镜像需要的输入路径（music 走独立上下文）
  ✓ 脚本与编排里没有可执行的 down -v
== 汇总：42/42 通过 ==
```

> `caddy validate` 用的是**真实 Caddy 2.10.2 二进制**（与 `compose.prod.yaml` 里固定的
> `caddy:2.10.2-alpine` 同版本）。校验时把 `storage`/日志路径临时改到可写目录，
> 因此 `Valid configuration` 证明的是配置能被解析与构建，**不是** TLS 可用。

`docker compose -f deploy/compose.prod.yaml config` **不给 env** 时退出码 1（刻意如此：
密码 / 密钥缺失时拒绝启动）；`compose.dev.yaml` 同样保留了这道守卫。

### 3.5 数据库角色分离（真实 PostgreSQL）

```text
  ✓ 源库迁移到单一 head（真实 alembic，迁移账号执行）
  ✓ 迁移账号能建表（迁移成功）
  ✓ 运行账号不能建表 → ERROR: permission denied for schema public
  ✓ 授权前运行账号读不到业务表 → ERROR: permission denied for table posts
  ✓ grant-runtime.sql 之后运行账号可读 / 可 INSERT
  ✓ 运行账号仍然不能建表（只有 DML）
```

三个角色 **NOSUPERUSER / NOCREATEDB / NOCREATEROLE**，与 `deploy/db/init/10-roles.sh` 一致。

### 3.6 T00 固化的验收脚本（本包重跑）

```bash
cd apps/api
uv run python ../../tools/acceptance/verify-ins-media-loop.py          # 全部通过
uv run python ../../tools/acceptance/verify-media-multiref.py          # 全部通过
uv run python ../../tools/acceptance/verify-restore-revokes-sessions.py # 复现出「会话复活」
```

```text
verify-ins-media-loop：登录 → 上传 → 草稿匿名 404 → 发布 → 匿名读列表与详情 →
  派生变体匿名可读（wiring 生效）→ 原图匿名 404 / 站主 200 → 撤回后派生变体也不可读
verify-media-multiref：同图两处引用，撤一处仍公开、全撤才不可读
verify-restore-revokes-sessions：备份早于登出时，恢复把 revoked_at 覆盖回 NULL，
  用登出前保存的 Cookie 重放 → authenticated=True（**确实复活**）
```

> 这两个 INS 脚本用固定端口 8124 / 8125。第一次运行时端口被并行包的进程占着，
> 脚本因为「uvicorn 起不来」而整段失败（表现为一堆 502）；**按端口精确腾出端口后全部通过**。
> 这不是脚本或实现的缺陷，但值得记下来：固定端口在多 agent 并行时会互相踩。

### 3.7 契约漂移守卫

```bash
DATABASE_URL=… APP_ENV=test SECRET_KEY=… uv run --project apps/api python apps/api/scripts/export_openapi.py
npm --prefix apps/web run gen:api
uv run --project apps/api pytest apps/api/tests/test_openapi_contract.py     # 4 passed
```

### 3.8 测试套件（真实数字与真实的坑）

| 套件 | 命令 | 结果 |
| --- | --- | --- |
| 旧站零回归 | `node --test tests/*.test.cjs` | **53 passed / 0 failed** |
| 前端单测（验收快照） | `npm --prefix apps/web run test -- --run` | **452 passed / 46 files** |
| 前端类型 / lint（快照与当前树） | `npm --prefix apps/web run typecheck` / `lint` | 退出码 0（两处都过） |
| 前端生产构建（快照） | `npm --prefix apps/web run build` | 成功，27 个页面 |
| 前端生产构建（当前树） | 同上 | 成功（T06/T08 接线后重建，27 页 + `/showcase*` 等） |
| 后端分目录（当前树，逐个跑） | `pytest apps/api/tests/<dir>` | auth 28、posts 18、media 33、moments 65、nav 59、coop 84、journal 48、leisure 48、messaging 160、gallery 65、projects 78，**全绿**；core 37、共享 5 个文件 54，**全绿** |
| 后端整棵树 | `pytest apps/api/tests` | **747–778 passed，另有 5–7 failed + 30 errors，且每次结果都不一样** |

**关于整棵树的失败，必须说清楚**（T00 的并发规则、T05/T07 接线彩排都记录过同一个坑）：

```text
FAILED apps/api/tests/core/test_health_readiness.py::test_ready_...           ← 单独跑 37 passed
FAILED apps/api/tests/core/test_health_readiness.py::test_readiness_router_...← 单独跑 37 passed
FAILED apps/api/tests/test_migration_sync.py::test_models_and_migrations_are_in_sync        ← 单独 2 passed
FAILED apps/api/tests/test_migration_sync.py::test_expected_tables_exist_after_migration    ← 单独 2 passed
FAILED apps/api/tests/test_module_registration.py::test_model_registry_matches_...          ← 单独通过
```

- 同一命令连续三次运行，失败集合不同（第二次还多出 `auth` / `posts` 两个失败和 30 个 error），
  输出里出现过 `database "pl_test_tXX" does not exist`；
- 上述每一项**在对应目录里单独运行都通过**；
- 原因：`apps/api/tests/conftest.py` 的会话级夹具会在 `TEST_DATABASE_URL` 指向的**共享库**
  （本机是 `pl_test`）上执行 `alembic upgrade head`，而并行包正在同一共享库上重建 schema；
  另有 `test_module_registration.py` 的 `EXPECTED_TABLES` 冻结清单需要随每个新内容域更新。
- 因此本包**不把整棵树的数字当成发布判据**，发布判据是分目录结果 + 三条端到端演练。
  整棵树的权威结论归集成负责人（T00），并且应当在**所有包停止写入**后再跑一次。

### 3.9 验收矩阵逐条对照（ACCEPTANCE §2，本包主责行）

| 场景 | 本包证据 | 结果 |
| --- | --- | --- |
| 地图图标 / 出发 / 列表；顶部导航 | T02 的 48 项浏览器套件（本包未重跑，原因见 §5） | 沿用 T02，未重跑 |
| 关闭手机 / 换 App / 换路由各 20 次 | 同上 | 沿用 T02，未重跑 |
| 手机详情直接 URL、刷新、Back | 同上 | 沿用 T02，未重跑 |
| 旧 post.html 查询和首页 hash | §3.3 `/post.html?p=…`、`/index.html` 真实经代理 308 → 200；**hash 未在代理形态下重测** | 部分 |
| 发布一条图文并在另一浏览器读取 | §3.6 verify-ins-media-loop（真实 HTTP，站主写 / 匿名读） | ✓ |
| 动态撤回但照片仍在公开相册 | §3.6 verify-media-multiref（同图多引用） | ✓ |
| 同图所有公开引用撤回 | §3.6 verify-media-multiref + verify-ins-media-loop 的撤回段 | ✓ |
| 日记 private 或 draft | 本包未测（属 T05 / T10 行的后半，需按发布范围补） | **未验证** |
| 殿堂所有文章撤回 | 本包未重跑（T04 交付单 §5.3 有 35/35） | 沿用 T04 |
| 剧情 → 自由输入 → 回到剧情 | 本包未测（T08 当时未接线） | **未验证** |
| 会话 A 请求 B 的 UUID | 同上 | **未验证** |
| AI 超时 / 额度耗尽 / 重试 | 同上；且真实 AI 默认走模拟 | **未验证** |
| 作品 / 技能没有匹配 | T06 的 65/78 个用例在各自目录通过；浏览器层未测 | 部分 |
| API 重启、DB 不可用、磁盘不足、迁移失败 | §3.2 覆盖 DB 不可用 / schema 未迁移 / 媒体缺失 / 媒体只读 / 迁移半途；**磁盘不足只在备份脚本里有空间预检，未做真实塞满演练** | 大部分 |
| 隔离恢复 DB + 媒体 | §3.1（34/34，含旧会话撤销与对照实验） | ✓ |

## 4. 发布清单（摘要；完整版在 `docs/operations/release.md`）

- **发布范围**（验收快照里真实存在）：T01 认证 / 文章 / 媒体、T02 外壳与手机宿主、
  T03 INS、T04 导航、T05 手记与放课后、T07 COOP。
- **未启用**：T06 展厅（记录时点未提交）、T08 消息（记录时点未提交）、T09 技能。
  手机注册表只登记已交付的应用，未接入的能力不出现入口。
- **版本**：镜像待 CI 构建并按 `@sha256` 固定；schema head 记录时点为 `18abac49279f`；
  配置版本是 `compose.prod.yaml` + `gateway/Caddyfile` + `env/prod.env.example`。
- **限制披露**：见 §5 与 `docs/operations/limitations.md`（mock 模型、音乐 / 游戏素材许可缺口、
  未配置域名、音频未真实出声、真机与 Safari/Firefox 未测、热力图需联网产物等）。
- **失败停止条件**：静态审查失败、发布前备份失败、迁移失败或 readiness 10 分钟未就绪、
  冒烟出现「草稿被匿名读到 / 原图匿名可读 / 会话恢复后复活」、磁盘不足 —— 任一命中即停止并回退。

## 5. 未验证项及原因（不得当作已通过）

1. **容器构建与容器内启动（最重要的一条）**：本机 Docker daemon 未运行
   （`/Users/v/.docker/run/docker.sock` 不存在；`docker info` 的 Server 段报
   `dial unix …: connect: no such file or directory`）。因此 **`docker build`、
   `docker compose up`、容器内 readiness 联动、migrate 一次性任务、容器内非 root 检查
   全部未验证**。本轮能做实的是：`compose config` 渲染、Dockerfile 与编排的静态审查、
   `caddy validate`、以及把同样的启动逻辑在**本机进程**上跑通。
2. **真实域名 / TLS / ACME / `__Host-` Cookie 在 HTTPS 下的行为**：没有域名与 80/443。
3. **T02 的 48 项浏览器套件（`apps/web/tools/browser-verification/verify.py`）未重跑**：
   它需要 Web + API + 旧站 8000 三个服务同时在线，且**明确要求不要修改该脚本**。
   本包对手机 / 地图 / 音乐三项的结论沿用 T02 的证据，没有新证据。
4. **音频真实出声**：无头 Chromium 没有音频设备；只验证到「200 + Accept-Ranges + Range 206」
   （代理形态）与 T02 的「元素唯一 / `play()` 被调用 / 跨页延续」。
5. **真机（Android / iOS）、软键盘、触控、Safari / Firefox**：本机只有桌面 Chromium。
6. **磁盘不足的真实演练**：备份脚本有空间预检，readiness 有媒体写探针；没有把磁盘真的塞满跑一遍。
7. **生产主机资源表现**（2 vCPU / 4 GiB 预算下的 SSR、图片处理、RSS）：没有生产主机。
8. **T08 相关验收行**（剧情往返、会话隔离、AI 超时 / 预算）：记录时点 T08 未接线，
   且真实 AI 默认走模拟。
9. **T06 相关浏览器验收**：记录时点未提交。
10. **GitHub Actions 是否真的能跑通**：本机没有远端，`ci.yml` / `release.yml` **没有被执行过**；
    本包做的是结构审查（30/30）与「本地等价命令都跑通」。

## 6. 集成申请（需要集成负责人 / 模块所有者动作）

1. **`next.config.ts` 加 `output: "standalone"`（重要，属 T00 所有的共享文件）**。
   06 §2 明确要求 Next.js 输出 standalone；当前镜像**没有**用它，而是用 `next start` 跑
   `.next` 生产构建（同样不是 dev server、同样不挂源码，只是镜像更大）。需要的最小改动：

   ```ts
   const nextConfig: NextConfig = {
     output: "standalone",
     // 锁定追踪根，避免 monorepo 里 standalone 目录结构随锁文件位置漂移
     outputFileTracingRoot: path.join(__dirname, "../../"),
     …
   };
   ```

   启用后把 `deploy/prod.Dockerfile.web` 的 runner 换成
   `COPY --from=builder /srv/web/.next/standalone ./` + `COPY … /.next/static` + `CMD ["node","server.js"]`
   （Dockerfile 文件头已写好这段注释）。**本包没有擅自改 `next.config.ts`**。
2. **`DATABASE_URL_FILE` 支持（属 `apps/api/app/core/config.py`，T01 所有）**。
   现在 `migrate` / `api` 的数据库口令以插值形式进容器环境变量（`docker inspect` 可见）。
   加上 `DATABASE_URL_FILE`（或等价的 `*_FILE` 支持）后，`compose.prod.yaml` 可以把
   `DATABASE_URL` 也改成文件注入，彻底消除残留。当前已在示例文件与运维文档里如实披露。
3. **`deploy/env.example` 与新的 `deploy/env/*.env.example` 并存**：本包保留了旧文件
   （`compose.dev.yaml --env-file deploy/env.example config` 实测仍退出码 0），
   新文档统一指向 `deploy/env/dev.env.example`。要不要删掉旧文件由 T00 决定，本包不擅自删。
4. **契约与类型生成文件已重新生成**（见 §2）：请确认发布范围与契约的一致性策略。
5. **整棵树的后端测试需要在「所有包停止写入」后由集成负责人串行跑一次**：本包实测到
   共享 `pl_test` 库与并行包互相重建 schema，导致整棵树结果不稳定（§3.8）。
6. **`tools/acceptance/verify-ins-media-loop.py` / `verify-media-multiref.py` 的固定端口
   （8124 / 8125）在多 agent 并行时会被占用**：脚本会整段失败并打印一堆 502。
   若要并入 CI，建议改成可传端口或端口 0 探测（属 T00 的 `tools/acceptance/**`，本包不改）。

## 7. 遗留与需要外部选择

1. **域名、服务器、备份目的地、素材许可、AI 供应商与预算**：全部仍未落实 —— 06 §10 列的就是
   这几项，本次发布按「限制披露」处理，没有假装已上线。
2. **`cut` 掉的容器验证**：需要有人启动 Docker Desktop 后执行
   `docker build -f deploy/prod.Dockerfile.api .`、
   `docker build -f deploy/prod.Dockerfile.web --build-context music=assets/music .`、
   `docker compose -f deploy/compose.prod.yaml --env-file deploy/env/prod.env up -d`，
   并把真实输出补进本交付单。**在这些跑通之前，`deploy/` 不得宣称容器可用。**
3. **媒体孤儿清理与限流表清理没有调度**：脚本 / 查询已有，执行者与保留期需要决定。
4. **`published_at` 时区形态**：响应是 `+08:00`（数据库会话时区），05 §2 写 UTC ISO 8601。
   既有全局约定问题，请 T00 决定是否给连接统一设 `timezone=UTC`。
5. **手机注册表与发布范围的关系**：注册表随每个包接线而变化。发布前请以当时的
   `features/phone/registry.ts` 为准重新生成发布范围那一节。

## 8. 复现（从零到本单的全部证据）

```bash
cd /Users/学习/blog/Blogs
export UV_CACHE_DIR=/Users/学习/blog/.dsh/uv-cache
export npm_config_cache=/Users/学习/blog/.dsh/npm-cache
export TEST_DATABASE_URL="postgresql+psycopg://pl@127.0.0.1:55432/pl_test"
export PG_BIN=/opt/homebrew/opt/postgresql@18/bin

# 1) 旧站零回归
node --test tests/*.test.cjs                                    # 53 passed

# 2) 后端（分目录；不要用整棵树做判据，原因见交付单 §3.8）
uv sync --project apps/api --frozen
for d in core auth posts media moments nav coop journal leisure messaging gallery projects; do
  uv run --project apps/api pytest "apps/api/tests/$d"
done
uv run --project apps/api pytest apps/api/tests/test_errors.py apps/api/tests/test_isolation_and_config.py \
  apps/api/tests/test_module_registration.py apps/api/tests/test_openapi_contract.py apps/api/tests/test_migration_sync.py

# 3) 前端
npm --prefix apps/web run typecheck && npm --prefix apps/web run lint
npm --prefix apps/web run test -- --run
npm --prefix apps/web run build

# 4) 契约漂移守卫
DATABASE_URL="$TEST_DATABASE_URL" APP_ENV=test SECRET_KEY="t10-drift-secret-key-0123456789abcdefgh" \
  uv run --project apps/api python apps/api/scripts/export_openapi.py
npm --prefix apps/web run gen:api
git diff --stat -- contracts/openapi.json apps/web/lib/api/generated   # 应为空

# 5) 生产编排与配置静态审查（不需要 Docker daemon）
docker compose -f deploy/compose.prod.yaml --env-file /tmp/pl-prod.env config > /tmp/prod.yaml
python3 deploy/check-prod-config.py --compose-config /tmp/prod.yaml --caddy /tmp/caddybin/caddy
python3 deploy/check-ci-workflows.py

# 6) 三条端到端演练
python3 tests/e2e/integration/verify-backup-restore.py
python3 tests/e2e/integration/verify-health-drills.py
python3 tests/e2e/integration/verify-proxy-same-origin.py

# 7) T00 固化的验收脚本（注意端口 8124 / 8125 的占用）
cd apps/api
uv run python ../../tools/acceptance/verify-ins-media-loop.py
uv run python ../../tools/acceptance/verify-media-multiref.py
uv run python ../../tools/acceptance/verify-restore-revokes-sessions.py
```

清理：本包所有演练脚本自建并自动清理临时库与临时目录；`/tmp/pl-release-snapshot`
与 `/tmp/pl-t10-proxy-*` 是本地工作副本，可随时删除。
