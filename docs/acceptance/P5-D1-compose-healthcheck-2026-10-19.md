# D1 · Docker/Compose 健康检查错配：修复与隔离 Compose 验证（2026-10-19）

> 授权：站主在 P5 返工闭环后明确要求「处理D1」。本轮只做部署配置修复与**隔离** Compose 验证；
> **未部署生产、未改生产环境、未 push**。
> 基线：`9917890f…`（P5 返工基线）→ 修复提交 `d8c22ae`（+ `b597576` 检查器路径同步）；分支 `main`。
> 环境：macOS + Docker Desktop 29.8.2 / Docker Compose v5.6.0；隔离项目名 `pl-d1-verify`，
> 宿主端口 18080/18443；共享服务 3100/8100/8000/55432 全程未动。

## 0. 结论

- **D1 根因已修复**：`deploy/compose.prod.yaml` 的 API healthcheck 期望 `status == "ok"`，
  而 `apps/api/app/core/health.py` 的成功响应是 `status == "ready"`（未就绪 503 `not_ready`）。
  已统一为 `"ready"`，并加静态跨文件契约断言防回归。
- **真实隔离 Compose 验证通过**：从仓库 Dockerfile 构建 API/Web 生产镜像，`docker compose up -d`
  起完整编排（gateway/web/api/db/migrate/grants），验证 **28/28** 断言：
  依赖启动链、四个长驻服务 healthy、网关真实请求 readiness=ready、部署的 healthcheck 命令退出 0、
  旧契约 `== "ok"` 在同一健康 API 上退出 1（证明错配会误判）、停 db 后 api 变 unhealthy 且恢复、
  api/web 容器内非 root（uid 10001/10002）、清理后无残留容器。
- **验证过程中暴露并修复了 5 个此前未验证过的部署配置缺陷**（均为既有问题，非本轮改动引入；
  T10 交付时明确标注「容器构建与启动未验证」）。它们会阻止「真实启动 + 健康联动」验证，已一并修复：
  web 镜像 music 构建上下文、镜像内测试文件排除、standalone 路径、PostgreSQL 18 数据卷挂载点、
  运行账号授权（grants）自动化；另修正 initdb 脚本可执行位。
- **仍未验证（不冒充）**：生产域名/TLS/ACME、真实生产机部署、CI 构建出的 digest 镜像、
  长时间运行与备份/回滚演练；本轮没有部署到任何生产环境。

## 1. D1 根因（用户可见后果）

- `deploy/compose.prod.yaml`（修复前）：
  `sys.exit(0 if body.get("status") == "ok" else 1)`；
- `apps/api/app/core/health.py`：`"status": "ready" if ready else "not_ready"`，未就绪返回 **503**。
- 后果：API 即使完全就绪也会被判 **unhealthy**；`gateway` 的
  `depends_on: api: condition: service_healthy` 永远等不到 → 首次部署整套起不来。
  这是**健康检查契约错配**，不能靠禁用/放宽健康检查绕过。

## 2. 修复清单

### 2.1 D1 主修复

| 文件 | 修改 |
|---|---|
| `deploy/compose.prod.yaml`（api healthcheck） | `status == "ok"` → `status == "ready"`；注释写明契约来源（health.py）与后果 |
| `deploy/check-prod-config.py` | 新增 A2「健康检查契约与依赖启动」：从 health.py 解析 readiness 成功/未就绪状态词；断言 api healthcheck 打真实 `/api/v1/health/ready`、期望词与后端一致、不把未就绪当成功；db/api/web/gateway 都启用健康检查且未 `disable`；依赖链完整。另加 web 镜像构建上下文 / standalone 路径 / 测试文件排除断言（`b597576` 同步 runner 新路径断言） |

### 2.2 隔离启动验证中发现并修复的既有部署缺陷

| # | 文件 | 问题（实测现象） | 修复 |
|---|---|---|---|
| 1 | `deploy/prod.Dockerfile.web` + `.github/workflows/release.yml` 契约 | 生产 web 镜像构建把整个仓库上下文塞进 `public/assets/music/`（`FROM scratch AS music; COPY . /music/`），`next build` 的 tsc 去类型检查 `public/` 下重复源码而失败；CI 传入的 `music` 命名上下文实际没被使用 | 删除伪 stage，直接 `COPY --from=music / ./public/assets/music/`（使用 `--build-context music=assets/music`，与 release.yml/T10 文档一致）；`check-prod-config.py` 增加 Dockerfile/workflow 一致性断言 |
| 2 | `.dockerignore` | 只排除了 `apps/web/tests`，feature 目录下 `*.test.tsx` 仍进镜像；镜像内 tsc 因缺 `@/tests/helpers/*` 失败 | 排除 `apps/web/**/*.test.ts(x)`；`check-prod-config.py` 断言该排除存在（生产镜像不带测试） |
| 3 | `deploy/prod.Dockerfile.web` | builder 把 `apps/web` 铺在 `/srv/web`，`outputFileTracingRoot` 计算为 `/`，standalone 产出 `srv/web/server.js`，而 runner COPY/CMD 用的是 `apps/web/server.js` → 容器启动即 `MODULE_NOT_FOUND` | builder 保留 `/srv/apps/web` 层级（追踪根 `/srv`），runner COPY 源改 `/srv/apps/web/...`；`check-prod-config.py` 断言布局与 CMD 一致 |
| 4 | `deploy/compose.prod.yaml` + `deploy/compose.dev.yaml`（db 卷） | `postgres:18-alpine` 的数据目录改为 `/var/lib/postgresql/<major>/docker`，旧挂载点 `/var/lib/postgresql/data` 被 entrypoint 判为「未使用旧挂载」并**拒绝启动** | 卷挂载改为 `/var/lib/postgresql`（两个 compose 文件；附升级说明） |
| 5 | `deploy/compose.prod.yaml`（新增 `grants` 一次性服务）、`docs/operations/release.md` | 迁移只建表（owner=迁移账号），运行账号没有表权限；原流程把 `grant-runtime.sql` 留给人工，且文档中的容器内路径实际不存在 → 首次启动 api 必然 readiness 503，gateway 永远不启动 | 新增 `grants` 一次性服务（postgres 镜像 + 只读挂载 `deploy/db/grant-runtime.sql`，跑完 Exited(0)）；`api` 增加 `grants: service_completed_successfully` 依赖；`release.md` 改为 `run --rm grants` / 说明 `up -d` 自动完成；`check-prod-config.py` 断言依赖链 |
| 6 | `deploy/db/init/*.sh`（git mode） | Docker Desktop 把 bind mount 脚本按「可执行」处理，但 git 里是 100644 → entrypoint 执行失败：`bad interpreter: Permission denied`，角色未创建 | 三个 init 脚本改为 `100755`（可执行）；仍支持被 source 的路径 |

> 说明：2.2 的 5+1 项不是 D1 契约本身，但都是「在隔离 Compose 里真实启动并验证健康/依赖」的必要前置；
> 此前 T10 交付单与 `docs/operations/limitations.md` 均明确标注「容器构建与启动未验证」，本轮把这几项验证做实。

## 3. 验证证据

### 3.1 静态检查（可重复、无需 daemon 之外的环境）

```sh
# 渲染生产编排（用带 digest 的占位环境；secrets 用临时文件）
docker compose -f deploy/compose.prod.yaml --env-file /tmp/pl-d1-static/prod.env config --format yaml > /tmp/pl-d1-static/rendered.yaml
python3 deploy/check-prod-config.py --compose-config /tmp/pl-d1-static/rendered.yaml
# → 60/60 通过（含 A2：api healthcheck=ready 与 health.py 一致、依赖链 db→migrate→grants→api→web→gateway）
python3 deploy/check-ci-workflows.py
# → 30/30 通过
```

### 3.2 真实隔离 Compose（Docker Desktop）

```sh
# 1) 从仓库 Dockerfile 构建生产镜像（本地 tag，不推送）
docker build -f deploy/prod.Dockerfile.api -t phantom-log-api:d1-verify .
docker build -f deploy/prod.Dockerfile.web --build-context music=assets/music -t phantom-log-web:d1-verify .
#    API 镜像 id e0ad77e0437d（444MB）；Web 镜像 id f56538fe6d26（489MB）

# 2) 起隔离编排 + 断言（项目名/端口/临时 secrets 全隔离）
python3 tools/verify-compose-healthcheck.py --json /tmp/pl-d1-verify/result.json
# → 28/28 通过，exit 0
```

验证断言摘录（真实输出）：

- `docker compose up 成功`；六个服务容器全部创建；
- **db healthy → migrate Exited(0) → grants Exited(0) → api healthy → web healthy → gateway healthy**；
- 经网关真实请求：`GET /gateway-healthz → 200 ok`；
  `GET /api/v1/health/ready → 200 {"status":"ready","checks":{"database":"ok","schema":"ok","media_storage":"ok"}}`；
  `GET /healthz → 200`、`GET / → 200`；
- 在 api 容器内执行**编排实际部署的 healthcheck 命令**（从 `docker inspect` 读取）→ **exit 0**；
- 同一命令改成旧契约 `== "ok"` → **exit 1**（证明修复前会永远 unhealthy）；
- **失败检测**：停 db → api 变 `unhealthy`（容器仍 running，未崩溃）→ 重启 db → api 回 `healthy`，
  网关 readiness 恢复 200；
- 容器内 `id -u`：api=10001、web=10002（非 root）；
- 结束清理后本项目剩余容器 **0**，无残留卷/网络。

### 3.3 证据文件

| 内容 | 路径 |
|---|---|
| 隔离 Compose 验证 JSON（28 项断言 + 命令记录 + 构建/仓库信息） | `docs/acceptance/evidence/p5-rework-2026-10-19/d1-compose-verify.json` |
| 验证日志 | `docs/acceptance/evidence/p5-rework-2026-10-19/d1-compose-verify.log` |
| 静态检查日志（60/60） | `docs/acceptance/evidence/p5-rework-2026-10-19/d1-static-check.log` |
| CI workflow 检查日志（30/30） | `docs/acceptance/evidence/p5-rework-2026-10-19/d1-ci-workflow-check.log` |
| 镜像构建日志 / 运行时事实 | `docs/acceptance/evidence/p5-rework-2026-10-19/d1-runtime-facts.txt`、`d1-*-image-build.log` |
| 完整证据目录 | `/Users/学习/blog/rework-evidence/after/d1/`（含 diff、渲染编排、镜像 ID、日志） |

## 4. 与 D1 关闭条件对照

任务书（返工包 REWORK-SPEC §D1）要求：

| 要求 | 本报告 |
|---|---|
| 统一健康检查契约 | ✅ compose `status == "ready"` 与 `health.py` 一致；静态跨文件断言防单边改动 |
| 在隔离 Compose 环境验证健康与依赖启动 | ✅ 全栈 `up -d` + 28 项断言：依赖链、四服务 healthy、网关真实 readiness、迁移/授权一次性任务 |
| 不得通过禁用健康检查绕过 | ✅ db/api/web/gateway 健康检查全部启用；静态检查显式断言无 `disable` |
| 不擅自操作生产环境 | ✅ 只使用隔离项目/端口/本机镜像；未部署生产、未 push |
| 不能通过放宽/跳过 | ✅ 保留 503 not_ready 语义；负向测试证明真故障会变 unhealthy |

## 5. 未验证 / 边界（如实）

1. **生产域名 / TLS / ACME / `__Host-`+`Secure` Cookie**：本机没有域名与公网 80/443，未验证。
2. **真实生产宿主机部署**：本轮只在 Docker Desktop 本机隔离环境验证；未在任何生产/预发机器执行。
3. **CI 构建的 digest 镜像**：`release.yml` 的远端构建/推送未执行；验证用的是本机从同一份 Dockerfile
   构建的镜像（内容一致，但 digest/registry 行为未验证）。
4. **长时间运行、备份/恢复、回滚演练**：未在本轮执行。
5. 本机 smoke 使用 `SITE_ADDRESS=http://127.0.0.1` + 宿主端口 18080；生产环境需真实域名并保持 80/443。

## 6. 环境安全与清理

- 共享环境（8000/8100/3100/55432）全程未动；隔离栈使用唯一项目名 `pl-d1-verify` 与 18080/18443，
  结束已 `down` 并删除本项目容器/卷/网络（无残留）。
- 只本地构建镜像（`phantom-log-api:d1-verify` / `phantom-log-web:d1-verify`），未推送 registry；
  未使用 `down -v` 或任何生产维护破坏性动作。
- 仓库未 push；修复与文档只在本地提交。
