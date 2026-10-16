# T00 · 交付单（工程骨架）

```text
任务：T00 / 基线、工程骨架与集成负责人
状态：implemented_waiting_integration —— 骨架与共享接口已实现并通过真实测试；
      业务功能（文章 / INS / 导航 / 消息等）全部**尚未实现**，
      Docker 启动与浏览器端到端**未验证**（原因见 §5）。
基线：main @ 9d9bfe77aded4db27d4c7958b728f0634a35fcae
      开始时已有本地修改：问卷精修 4 个代码文件 + 1 个 spec（见 T00-baseline.md §3）
外部影响：未调用任何模型或付费服务；未部署；未推送。
```

## 1. 本轮范围

**已完成**：工程骨架、共享契约的可编译最小接口、隔离测试夹具、开发 Compose、OpenAPI 契约与前端类型生成链路。
**未完成**：任何业务模块。INS 属 T03、导航属 T04、日常应用属 T05、展厅 T06、COOP T07、消息 T08、成长 T09、生产化 T10。

按 T00 验收第 5 条：「基础骨架通过」与「功能尚未实现」必须分开陈述，本单所有结论都限定在前者。

## 2. 目录所有权交接

| 路径 | 现状 | 交接给 |
| --- | --- | --- |
| `apps/api/app/core/`（config / db / errors / logging） | 骨架可编译，有测试 | **T01**（之后按模块独占目录演进） |
| `apps/api/app/modules/` | 尚未创建（无业务模块） | T01 起按模块创建 |
| `apps/api/app/main.py`、`router.py`、`model_registry.py` | T00 拥有 | 保持 T00，模块通过登记接入 |
| `apps/api/migrations/` | 单一 head `0001_baseline`，无业务表 | 保持 T00 |
| `apps/web/package.json`、锁文件、`tsconfig.json`、`next.config.ts`、`eslint.config.mjs`、`vitest.config.mts` | T00 拥有 | 保持 T00，依赖走申请 |
| `apps/web/lib/api/client.ts`、`server.ts`、`features/phone/types.ts`（`registry.ts` 归 T00） | 骨架可编译，有测试 | **T02** |
| `apps/web/app/layout.tsx`、`app/page.tsx` | **占位**，仅让 `next build` 通过 | **T02**（替换为持久外壳与真实首页） |
| `deploy/`（compose.dev.yaml + dev.Dockerfile.*） | 仅开发期 | 开发启动验证后整体交 **T10** |
| `contracts/openapi.json` | 已生成，有漂移检查测试 | 保持 T00 |

## 3. 新增文件

```text
apps/api/
  pyproject.toml                 依赖与 pytest 配置（T00 拥有）
  uv.lock                        Python 锁文件（36 包）
  alembic.ini                    ASCII-only 注释（见 §6 的 locale 坑）
  app/__init__.py  app/main.py  app/router.py  app/model_registry.py
  app/core/{__init__,config,db,errors,logging}.py
  migrations/env.py  migrations/script.py.mako  migrations/versions/0001_baseline.py
  scripts/export_openapi.py      生成 contracts/openapi.json
  tests/conftest.py  tests/__init__.py
  tests/support/{__init__,module_app}.py
  tests/test_errors.py  tests/test_module_registration.py
  tests/test_isolation_and_config.py  tests/test_openapi_contract.py

apps/web/
  package.json  package-lock.json  tsconfig.json  next.config.ts
  eslint.config.mjs  vitest.config.mts  .env.example
  app/layout.tsx  app/page.tsx            （T02 占位）
  lib/api/client.ts  lib/api/server.ts  lib/api/client.test.ts
  lib/api/generated/schema.ts             （由 npm run gen:api 生成）
  features/phone/types.ts  features/phone/registry.ts  features/phone/registry.test.ts
  features/phone/__fixtures__/test-app.tsx
  scripts/gen-api-types.mjs

contracts/openapi.json
deploy/compose.dev.yaml  deploy/dev.Dockerfile.api  deploy/dev.Dockerfile.web  deploy/env.example
```

修改 `apps/api/.venv/`、`apps/web/node_modules/`、`.next/` 为本地构建产物，不入库。

## 4. 验证（全部实际执行）

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `node --test tests/*.test.cjs` | 0 | **53 passed / 0 failed** —— 旧站测试零回归 |
| `uv sync --project apps/api --frozen` | 0 | Audited 36 packages |
| `uv run --project apps/api pytest apps/api/tests` | 0 | **51 passed**（含 3 个真实 PostgreSQL 用例） |
| `npm --prefix apps/web ci --dry-run` | 0 | 锁文件与 package.json 一致，无 peer 冲突 |
| `npm --prefix apps/web run typecheck` | 0 | tsc 无输出 |
| `npm --prefix apps/web run lint` | 0 | eslint 无告警 |
| `npm --prefix apps/web run test -- --run` | 0 | **22 passed**（注册表 12 + API 客户端 10） |
| `npm --prefix apps/web run build` | 0 | 静态页 `3/3` 生成 |
| `uv run --project apps/api python apps/api/scripts/export_openapi.py` | 0 | 写入 `contracts/openapi.json` |
| `npm --prefix apps/web run gen:api` | 0 | 写入 `lib/api/generated/schema.ts` |
| `docker compose -f deploy/compose.dev.yaml --env-file deploy/env.example config` | 0 | 渲染出 api / db / migrate / web |
| `docker compose -f deploy/compose.dev.yaml config`（不给 env） | 1 | **刻意如此**：拒绝在缺少密码与密钥时启动 |

### 真实服务启动（非 Docker）

以本机进程实际启动并验证，不是只跑测试：

```text
uvicorn app.main:app --host 127.0.0.1 --port 8100
  GET /api/v1/health/live → 200 {"status":"ok","service":"phantom-log-api","checked_at":"…Z"}
                            响应头含 x-request-id
  GET /api/v1/nope        → 404 {"error":{"code":"NOT_FOUND","message":"Not Found","fields":{}},"request_id":"…"}
  GET /api/v1/health/ready→ 404（刻意不存在）

npm run start（Next.js，端口 3100）
  GET /               → 200，5141 bytes
```

### 真实 PostgreSQL 证据

测试用独立集群（本机 `postgresql@18`，项目内数据目录，端口 **55432**，非 5432），迁移确实执行：

```text
pl_test=# select version_num from alembic_version;  → 0001_baseline
pl_test=# \dt                                        → 仅 alembic_version（无任何业务表）
```

`apps/api/tests/` 的 51 个用例里，3 个标记 `@pytest.mark.database`：库可连且已迁移、事务夹具确实回滚、迁移链只有一个 head。

**未运行项**（不得当作通过）：

- Docker 容器启动、Compose 健康检查联动、`migrate` 服务实际执行 —— **Docker daemon 未运行**（`/Users/v/.docker/run/docker.sock` 不存在），本轮无法验证。
- **新栈**的浏览器自动化（视觉、过场、音乐、320/390px）—— 未建立。T02 接手时应先补浏览器测试基础。
- 前端对 API 的真实请求链路 —— 首页占位不调用 API；SSR 读取要等 T02。

### 旧站浏览器验收（本轮补做）

环境里有系统级 Playwright 1.60 + chromium-1223（`~/Library/Caches/ms-playwright`），因此旧站原本「需要人工点击」的浏览器检查已经可以自动化，脚本见 `/Users/学习/blog/.dsh/browser-check.py`：

```text
tests/poll-browser.html → 点击 #run → ALL BROWSER CHECKS PASSED
  10 项断言全过：可复用 create API / 半透明底板与紧凑短问题 / 参考框+结果标签+百分比整数小数分列 /
  Q 与票数框不重叠 / 重复显示与同 ID 镜像 / 关闭淡出 / 计时器取消 / Escape 关闭 / 纯文本渲染 / PJAX 清理
截图：/Users/学习/blog/.dsh/screenshots/{poll-inline-mobile,poll-inline-desktop,index-desktop}.png
```

两个必须知道的坑（写进这里避免 T02 重踩）：旧站 `#boot` 开屏会拦截全部指针事件，必须先用 Enter / Space / Escape 或点击关掉；问卷浮层是 JS 渲染的，`wait_until="load"` 之后仍要等 `.poll-panel` 出现再截图。

## 5. 锁定版本

```text
Node 26.8.1 | npm 11.19.0 | Python 3.13.5 | uv 0.9.18
PostgreSQL 18.6（本机 Homebrew，测试集群端口 55432）
Docker CLI 29.8.2 / Compose v5.5.1（daemon 未运行）
git 2.39.5

next 16.4.2 | react 19.3.1 | react-dom 19.3.1
typescript 5.9.3 | vitest 5.0.5 | jsdom 30.1.3 | @vitejs/plugin-react 6.1.2
eslint 9.39.5 | eslint-config-next 16.4.2 | openapi-typescript 7.13.0
@types/node 26.6.5 | @types/react 19.3.0 | @types/react-dom 19.3.0

fastapi 0.143.2 | starlette 1.8.0 | sqlalchemy 2.1.4 | alembic 1.20.0
pydantic 2.14.1 | pydantic-settings 2.16.0 | psycopg 3.3.6 | uvicorn 0.54.0 | pytest 9.1.1
```

## 6. T00 定义的新约定（原设计文档未规定，T01–T09 请继承）

设计文档明确未规定的项由 T00 定下，避免各包各自发明：

| 项 | T00 取值 |
| --- | --- |
| 健康端点 | liveness = `/api/v1/health/live`（06 §1 给定）。**`/health/ready` 刻意不存在**，真实检查留 T01/T10 |
| 错误 code | 除 `VERSION_CONFLICT`（05 §9 给定）外全部由 T00 定义：`VALIDATION_FAILED` `NOT_FOUND` `METHOD_NOT_ALLOWED` `UNAUTHORIZED` `FORBIDDEN` `PRECONDITION_REQUIRED` `VERSION_CONFLICT` `CONFLICT` `PAYLOAD_TOO_LARGE` `UNPROCESSABLE` `SERVICE_UNAVAILABLE` `INTERNAL` |
| request_id 头 | `X-Request-ID`（响应头与响应体同值；调用方传入则沿用） |
| 环境变量 | `APP_ENV`(dev/test/prod) `DATABASE_URL` `SECRET_KEY`（≥32 字符，无默认值）`APP_VERSION` `CORS_ORIGINS`；前端 `API_INTERNAL_URL`（仅服务端） |
| 测试库标记 | 库名必须命中 `pl_test` / `test_pl` / `*_test` 之一；含 prod/production/live/main 一律拒绝（`app/core/db.py`） |
| 开发端口 | web 3100、api 8100（都在 127.0.0.1）；旧站 8000 预览**保持不变** |
| 迁移布局 | `apps/api/alembic.ini` + `migrations/{env.py,script.py.mako,versions/}`；连接串只从环境或 `-x db_url=` 读取 |
| 约束命名 | SQLAlchemy `NAMING_CONVENTION`（`pk_/fk_/uq_/ck_/ix_` 前缀），写进 `Base.metadata` |
| 手机宿主签名 | 见 `features/phone/types.ts`：十字段 manifest + 八项宿主能力；`loader` 仅 embedded 有 |
| 测试库连接 | `TEST_DATABASE_URL`（仅测试读取，conftest 强制校验库名） |

## 7. 过程中发现并解决的真实问题

1. **TypeScript 三方挤兑**：npm 默认装 TS 7.0.2 → `eslint-config-next` 内置的 typescript-eslint 直接抛错拒绝 TS 7；降到 TS 6.0.3 后 `openapi-typescript@7.13`（peer 写死 `^5.x`，且无更新版本）导致 `npm ci` ERESOLVE 失败。最终取三者的支持区间交集 **TypeScript 5.9.3**，`npm ci` 恢复退出码 0。**不要随手升级 TS**，升级前先确认 typescript-eslint 与 openapi-typescript 的支持范围。
2. **alembic.ini 的 locale 陷阱**：Alembic 用 *locale* 编码读 ini，`LC_ALL=C` 下中文注释触发 `UnicodeDecodeError`。该文件已改为 ASCII-only 注释。
3. **FastAPI 0.143 的 `app.routes`**：不再暴露 `.path`（出现 `_IncludedRouter`），路由断言已改为行为断言（真实请求 + OpenAPI 路径顺序）。
4. **Next 的 `no-assign-module-variable`**：`const module = …` 会被 ESLint 判错（与打包器全局冲突），已改名。
5. **误报过的自查**：秘密扫描最初把 `alembic.ini` 的 `keys = console` 当成凭据，已收紧为凭据键名词表。

## 8. 集成申请

- **路由增量**：`/api/v1/health/live`（meta）。模块路由通过 `app/router.py:register_module_router(name, router)` 登记，前缀自动加 `/api/v1`，重复名或重复前缀立即报错。
- **模型增量**：无。模块把自己的 `app.modules.<x>.models` 路径交给 T00 写入 `MODEL_MODULES`（显式清单，不做目录扫描），由 T00 串行生成迁移，保持单一 head。
- **OpenAPI / 前端类型**：模块接线后由 T00 重新运行两个生成命令；`apps/api/tests/test_openapi_contract.py` 会在契约漂移时失败。
- **媒体公开引用检查**：默认不生效（符合 SHARED-CONTRACTS §5），T00 在相册/日记/作品接入时显式注册。
- **依赖**：本轮新增全部依赖已写入锁文件；其他任务不并行重写 `package.json` / `pyproject.toml`，需要新依赖请提交申请。

### T01 / T02 启动说明

```bash
# 一次性：起本机测试库（项目内、端口 55432，不碰全局服务）
mkdir -p .dsh/pgtest/sock
/opt/homebrew/opt/postgresql@18/bin/initdb -D .dsh/pgtest/data -U pl --auth=trust --encoding=UTF8 --locale=C
LC_ALL=C /opt/homebrew/opt/postgresql@18/bin/postgres -D .dsh/pgtest/data -p 55432 \
  -k .dsh/pgtest/sock -c listen_addresses=127.0.0.1 &
/opt/homebrew/opt/postgresql@18/bin/createdb -h 127.0.0.1 -p 55432 -U pl pl_test

# 每次开发
export TEST_DATABASE_URL="postgresql+psycopg://pl@127.0.0.1:55432/pl_test"
uv run --project apps/api pytest apps/api/tests        # 不带 TEST_DATABASE_URL 会 skip 而非失败
cd apps/web && npm run dev                            # http://127.0.0.1:3100
```

注意：没有 `TEST_DATABASE_URL` 时数据库用例**skip 并说明原因**，不会静默退化成 SQLite（05 §10 禁止用 SQLite 冒充 PostgreSQL）。

## 9. 遗留与需要的外部选择

1. **Docker 启动未验证**：本机 Docker daemon 未运行。需要有人启动 Docker Desktop 后执行
   `docker compose -f deploy/compose.dev.yaml --env-file deploy/.env up -d` 才算完成「开发启动」验收。在验证之前，`deploy/` **不得宣称可用**。
2. **浏览器自动化未建立**：新栈缺视觉/无障碍/过场回归手段；T02 接手时应先补浏览器测试基础，再迁旧页面。
3. **`apps/web/app/` 是占位**：T02 替换为真实根布局与首页前，`next start` 只呈现骨架说明页。
4. **迁移账号与运行账号未分离**：开发 Compose 共用同一账号；06 §5 要求生产分开，属 T10。
5. **媒体目录约定未落地**：`media_data` 卷已声明，但访问控制、变体命名（如 `w640.webp`）与公开引用检查要等 T01/T06 实现。
6. **问卷精修仍未提交**：4 个代码文件 + 1 个 spec 仍是工作区改动，未进入 main，也未推送（见 `T00-baseline.md` §3）。
