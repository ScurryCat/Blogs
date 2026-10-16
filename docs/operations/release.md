# 发布清单与发布 / 回退流程（T10）

对应设计：[06 部署与路线](../../superpowers/specs/2026-10-16-deployment-roadmap-design.md) §6。
本文件是**操作手册**：先看「本次发布范围」，再按「发布步骤」执行；每一步都写了失败时怎么办。

> 状态词区分（ACCEPTANCE §3）：「代码就绪」「已集成」「已预览验证」「可生产发布」「已部署」
> 是五个不同状态。**本次发布停在「可生产发布（就绪报告）」**：容器与域名两条前置没有完成，
> 没有部署到任何生产环境，也没有获得部署授权。

> ⚠️ **本清单是时间点快照，会过期。** 记录时刻 2026-10-16T12:57Z，`git HEAD = c4a5bd5`，
> 当时工作区有 26 项未提交改动，且 T05 / T06 / T07 / T08 的接线在并行进行中。
> 发布前必须重新核对本节的「发布快照」与 schema 版本 —— 只要树变了，这份清单就要重签。

## 1. 本次发布范围清单

| 项 | 值 |
| --- | --- |
| 记录时刻 | 2026-10-16T12:57Z |
| 代码版本 | `git HEAD = c4a5bd5`（工作区另有 26 项未提交改动；发布前需重新核对） |
| 发布快照 | 验收时用的 `git archive HEAD` 副本 `/tmp/pl-release-snapshot`（`HEAD` 当时为 `65607e0`） |
| 前端镜像 | `deploy/prod.Dockerfile.web` → 待 CI 构建并按 `@sha256:<digest>` 固定 |
| 后端镜像 | `deploy/prod.Dockerfile.api` → 同上 |
| schema 版本 | 迁移 head **`18abac49279f`**（`20261016_2051_..._t08_messaging.py`）；单一 head |
| 配置版本 | `deploy/compose.prod.yaml` + `deploy/gateway/Caddyfile` + `deploy/env/prod.env.example` |
| 基础镜像 | PostgreSQL `postgres:18-alpine`、Caddy `caddy:2.10.2-alpine`（生产按 digest 固定） |
| 运行时 | Node 26 / Python 3.13（与 `package-lock.json`、`uv.lock` 一致） |

> schema 版本在记录期间**变过**：验收快照时 head 是 `c652ce04a8bf`（T07），随后 T05 与 T08
> 的迁移被集成，head 变成 `18abac49279f`。备份 / 恢复演练在**两个 head 上都跑通过**
> （34/34）。发布时以实际部署镜像里 `alembic_version` 的值为准。

### 本次包含的模块（快照里真实存在且可访问）

| 来源 | 内容 | 手机入口 |
| --- | --- | --- |
| T01 | 站主登录、文章只读、标签、媒体上传与权限变体、readiness | — |
| T02 | 旧站迁移外壳、地图 / 关于 / 天气 / 留言板、持久音乐、过场、手机宿主 | — |
| T03 | INS 图文（草稿 / 发布 / 撤回 / 收藏 / 分享） | `ins` |
| T04 | 异世界导航（专题 / 关键词匹配 / 搜索 / 印象空间 / 本地足迹） | `metanav` |
| T05 | 手记（journal）、放课后（leisure）、勒布朗近况（leblanc） | `journal` / `leisure` |
| T07 | COOP 友链通讯录与管理 | `coop` |

### 记录时点**尚未**进入发布快照的模块

| 来源 | 记录时点状态 | 处置 |
| --- | --- | --- |
| T06 展厅与画廊 | 工作区未提交（正在交付） | 不进快照；不显示入口 |
| T08 混合角色消息 | 工作区未提交（正在交付） | 不进快照；不显示消息页签 |
| T09 技能与探索 | 未开始 | 不显示「问题记录 / 技能」任何入口 |

> ⚠️ 记录之后 T05 / T06 / T07 / T08 都被并行接进了 `main` 与工作区（`model_registry.py`、
> `router.py`、`registry.ts`、OpenAPI 都在变）。**发布时请重新生成这一节**，不要照抄。
> 「未接入不显示坏按钮」（SHARED-CONTRACTS §4）的实现依据是手机注册表
> `apps/web/features/phone/registry.ts` —— 它以当时的实际清单为准。

> ⚠️ 另一个重要事实：**构建产物包含快照里的全部路由**。未列入发布范围的 URL（例如
> `/apps/journal`）页面本身是能打开的。发布范围说的是「我们对外承诺并验收了哪些」；
> 若要求未发布模块连直接访问都不可达，需要在网关加明确的拒绝规则（属产品决定）。

## 2. 发布前置（缺一项就不发布）

- [ ] **域名已解析**到目标主机，80 / 443 可达（Caddy 自动 HTTPS 的前提，06 §1）。
- [ ] 服务器已装 Docker Engine + Compose v2；**不使用 root 直接跑应用容器**。
- [ ] `deploy/env/prod.env` 已按 `deploy/env/prod.env.example` 填好，`chmod 600`。
- [ ] 三个口令文件（admin / migrator / app）存在且 `chmod 600`，内容与 env 文件一致。
- [ ] 镜像已由 CI 构建并记录 `@sha256` digest（`release.yml` 的 artifact），生产**不现场构建**。
- [ ] 备份目的地已挂载且**在宿主机之外**（06 §5）；最近一次备份与恢复演练记录在案。
- [ ] 素材许可与 AI 供应商 / 预算已落实（未落实 → 见 [limitations.md](limitations.md)，按限制发布）。

## 3. 发布步骤（每条都写明失败时的动作）

```bash
cd /path/to/Blogs
export ENV_FILE=deploy/env/prod.env
COMPOSE="docker compose -f deploy/compose.prod.yaml --env-file $ENV_FILE"
```

1. **渲染并审查编排**（本机已实测，不需要 daemon）
   ```bash
   $COMPOSE config > /tmp/prod.yaml
   python3 deploy/check-prod-config.py --compose-config /tmp/prod.yaml --caddy "$(command -v caddy)"
   ```
   失败 → **停止发布**。检查项见脚本输出（端口 / 网络 / secrets / privileged / `down -v`）。

2. **做部署前成对备份**（06 §6 第 3 步：发布前必须有一次配套备份）
   ```bash
   python3 deploy/backup.py --database-url "$PROD_DATABASE_URL" \
     --media-root /var/lib/phantom-log/media --out "$PL_BACKUP_DIR/pre-release-$(date -u +%Y%m%dT%H%M%SZ)" \
     --label "发布前备份"
   ```
   失败 → **停止发布**；不要用「上一次的备份」凑合。
   同时进入维护窗口：停止接受内容写入（站点提示维护中），保证快照一致。

3. **只跑一次迁移**（migrate 一次性服务；失败则不启动依赖新 schema 的服务）
   ```bash
   $COMPOSE up -d db
   $COMPOSE run --rm migrate            # alembic upgrade head，成功即退出
   ```
   失败 → 保持旧应用在线、**不要**执行 downgrade、保留现场；按 §4 回退。
   成功 → 立刻补运行账号权限（表是新建的）：
   ```bash
   $COMPOSE exec -T db psql -U "$POSTGRES_ADMIN_USER" -d "$POSTGRES_DB" \
     -v app_user="$POSTGRES_APP_USER" -f /docker-entrypoint-initdb.d/../grant-runtime.sql
   ```
   > 注：这个路径依赖镜像里的 initdb 目录挂载位置；如果用不了，直接从仓库执行
   > `psql ... -f deploy/db/grant-runtime.sql`。本机已实测该 SQL 幂等可用。

4. **启动新镜像并等就绪**
   ```bash
   $COMPOSE up -d api web gateway
   $COMPOSE ps                       # migrate 应为 Exited(0)，其余 healthy
   curl -fsS https://<域名>/api/v1/health/ready   # 必须返回 {"status":"ready",...}
   ```
   失败 → `docker compose logs api`；**不要**靠 `restart` 反复重启掩盖未就绪。
   DB / schema / 媒体任何一项不就绪，readiness 就是 503（本机已用真实进程验证五种故障形态）。

5. **跑发布冒烟**（06 §6 第 5 步：登录、列表、详情、发布 / 撤回）
   - 首页、`/posts/<slug>`、`/map`、`/about`、`/apps/ins`、`/apps/metanav` 均 200；
   - 站主登录成功、注销成功；
   - 发布一条图文 → 另一个浏览器可见 → 撤回后不可见；
   - 上传一张图 → 匿名可读派生变体、原图匿名 404；
   - `/assets/music/beneath-the-mask.mp3` 200 且 `Accept-Ranges: bytes`（拖动播放）。

6. **开放写入并记录恢复点**
   记录：本次 digest、schema head、备份目录与校验清单摘要、冒烟结果、发布耗时。
   写入 `docs/operations/release-log.md`（或团队实际使用的发布记录）。

## 4. 回退路径（06 §6）

| 情形 | 动作 | 禁止 |
| --- | --- | --- |
| 应用有问题、schema 兼容 | 切回**上一个兼容的旧镜像**（`API_IMAGE` / `WEB_IMAGE` 换回旧 digest） | 不需要动数据库 |
| schema 已不兼容、必须回退数据 | 经**站主确认**后，把发布前备份恢复到**新库**，再切连接串 | 不自动 downgrade；不覆盖故障现场；不删除新数据 |
| 迁移中途失败 | 保持旧应用在线，只修迁移；必要时按上一条恢复 | 不在生产上反复 `upgrade / downgrade` 试错 |
| 完全无法恢复 | 旧静态站作为**只读应急入口** | 不做「一边用旧数据展示一边继续接受新后台写入」 |

回退演练与恢复演练的记录模板见 [backup-restore.md](backup-restore.md) §4。

## 5. 发布失败停止条件（明确写下来，避免临场争论）

1. `deploy/check-prod-config.py` 有任何一条失败；
2. 发布前备份没有成功，或校验清单核对失败；
3. 迁移失败，或 readiness 在 10 分钟内没有变成 `ready`；
4. 冒烟里出现「草稿被匿名读到」「原图匿名可读」「会话在恢复后复活」中的任意一条；
5. 磁盘剩余空间低于镜像 + 媒体 + 日志预估之和。

出现任一条 → 停止发布，按 §4 回退，并把实际现象与耗时写进发布记录。

## 6. 本机已实测 / 未实测（不要混写）

**已实测**（命令与输出见 [T10 交付单](../agent-deliveries/T10-result.md)）：

- `docker compose -f deploy/compose.prod.yaml --env-file … config`（渲染成功，退出码 0）；
- `caddy validate`（Caddy 2.10.2 真实二进制，`Valid configuration`）；
- 迁移、readiness 五种故障形态、反向代理同源写路径、旧 URL 重定向、音频 Range；
- 成对备份 → 校验清单 → 隔离恢复 → 逐表行数一致 → 恢复后撤销会话；
- 角色分离（迁移账号能建表、运行账号不能建表、授权后可 DML）。

**未实测**（原因见 [limitations.md](limitations.md)）：

- `docker build`（两个生产镜像）、`docker compose up`、容器内启动与健康联动；
  本机 Docker daemon 未运行（`/Users/v/.docker/run/docker.sock` 不存在）；
- 真实域名下的 TLS / Cookie / ACME；
- 生产主机上的防火墙、磁盘与内存表现。
