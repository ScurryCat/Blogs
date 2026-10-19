# PHANTOM LOG 运维文档（T10）

这些文档面向**接手部署的人**，不是设计说明。每条命令都标注了「本机是否实测过」：
本机（macOS，无 Docker daemon）能实测的是备份 / 恢复 / 迁移 / 健康检查 / 反向代理形态；
**容器构建与容器内启动没有被实测过**，文档里逐条标出。

| 文档 | 内容 |
| --- | --- |
| [release.md](release.md) | 发布清单、镜像与 schema 版本、发布步骤、回退路径、失败停止条件 |
| [backup-restore.md](backup-restore.md) | 成对备份、校验清单、隔离恢复、恢复后撤销会话、RPO / RTO 现状 |
| [runbook.md](runbook.md) | 日常运维：健康判断、日志、磁盘、证书、常见故障处置 |
| [limitations.md](limitations.md) | 本次发布的**限制与未验证项**（不粉饰，逐条给原因） |
| [trial-runbook.md](trial-runbook.md) | 受限试用（M1A）：最小配置层、网关访问保护、启动/升级/停止/回退、备份前置与远端实施单 |

## 事实基线（2026-10-16）

```text
仓库         /Users/学习/blog/Blogs   分支 main
发布快照     git HEAD（追踪文件）→ /tmp/pl-release-snapshot（本地验收用）
迁移 head    528a38f23614（20261016_2155，T09 skills and exploration；单一 head，34 张表）
本机 PostgreSQL 18.6 @ 127.0.0.1:55432（用户 pl，trust）
Node 26.8.1 / npm 11.19.0 / Python 3.13.5 / uv 0.9.18
Docker CLI 29.8.2 / Compose v5.6.0 —— **daemon 可用**（Docker Desktop；2026-10-19 D1 验证时实测）
Caddy 二进制 2.10.2（仅用于把 Caddyfile validate 跑实，未长期驻留）
```

> 2026-10-19 更新：站主授权处理 D1 后，已在**隔离 Compose**（项目 `pl-d1-verify`，端口 18080/18443）
> 实测生产镜像构建、全栈启动、健康检查联动与 migrate/grants 一次性服务；生产部署/TLS/真实域名仍未验证。
> 详见 `../acceptance/P5-D1-compose-healthcheck-2026-10-19.md`。

## 三条硬规则

1. **不要在生产维护流程里用 `docker compose down -v`**。它会删掉卷（数据库、媒体、证书）。
   仓库里所有脚本都刻意不含这个动作，`deploy/check-prod-config.py` 会把出现它的脚本判失败。
2. **恢复备份后必须撤销旧会话**（`python -m app.commands.revoke_sessions --all`）。
   备份早于「登出」时，恢复会把 `revoked_at` 覆盖回 NULL，持有旧 Cookie 的人重新获得站主
   访问权 —— 这是实测出来的（`tests/e2e/integration/verify-backup-restore.py` 第 7b 步）。
3. **不要为了「让检查通过」改业务规则**。发布检查失败时，改的是部署方式或如实登记限制。

## 一键自检

```bash
cd /Users/学习/blog/Blogs
export UV_CACHE_DIR=/Users/学习/blog/.dsh/uv-cache
export npm_config_cache=/Users/学习/blog/.dsh/npm-cache
export TEST_DATABASE_URL="postgresql+psycopg://pl@127.0.0.1:55432/pl_test"
export PG_BIN=/opt/homebrew/opt/postgresql@18/bin

# 1) 生产编排 + Caddyfile + Dockerfile + 环境变量示例的静态审查（不需要 daemon）
mkdir -p /tmp/pl-secrets && for n in admin migrator app; do printf 'x\n' > /tmp/pl-secrets/$n; done
docker compose -f deploy/compose.prod.yaml --env-file deploy/env/prod.env.example config >/dev/null  # 会因占位符失败，属预期
docker compose -f deploy/compose.prod.yaml --env-file /tmp/pl-prod.env config > /tmp/prod.yaml
python3 deploy/check-prod-config.py --compose-config /tmp/prod.yaml
python3 deploy/check-ci-workflows.py

# 2) 备份 / 恢复隔离演练（真实 PostgreSQL，会自建并清理临时库与目录）
python3 tests/e2e/integration/verify-backup-restore.py

# 3) 健康与迁移失败演练（真实 uvicorn + 真实库）
python3 tests/e2e/integration/verify-health-drills.py

# 4) 反向代理形态的同源读写（真实 Chromium，需要先有生产构建）
python3 tests/e2e/integration/verify-proxy-same-origin.py
```
