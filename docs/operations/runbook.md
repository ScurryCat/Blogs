# 运维手册（T10）

面向「站点正在跑，现在出问题了」的场景。每条都给：**怎么判断**、**怎么处置**、**不要做什么**。

## 1. 健康判断：三个层次，不要混

| 端点 | 位置 | 说明什么 | 不说明什么 |
| --- | --- | --- | --- |
| `/gateway-healthz` | 网关自身 | Caddy 进程在响应 | 后端是否可用 |
| `/healthz` | web | Next.js 进程在响应（不查 DB、不查 API） | 整站是否可用 |
| `/api/v1/health/live` | API | API 进程在响应 | DB / schema / 媒体 |
| `/api/v1/health/ready` | API | **数据库连通 + schema 已迁移 + 媒体目录可写** | 内容是否正确 |

`ready` 的 503 响应体只给状态词与检查名，**不含路径、连接串、库名、表名、异常文本**：

```json
{"status":"not_ready","service":"phantom-log-api","version":"0.0.0",
 "checks":{"database":"ok","schema":"not_migrated","media_storage":"ok"},
 "checked_at":"2026-10-16T12:23:12.542472Z"}
```

本机实测的五种形态（`tests/e2e/integration/verify-health-drills.py`，11/11 通过）：

| 形态 | live | ready | checks |
| --- | --- | --- | --- |
| 空库（未迁移） | 200 | 503 | `schema: not_migrated` |
| 迁移到 head | 200 | **200** | 全 ok（同一进程内自动恢复，无需重启） |
| 媒体目录缺失 | 200 | 503 | `media_storage: missing` |
| 媒体目录只读 | 200 | 503 | `media_storage: not_writable`（实际写探针文件，不看权限位） |
| DB 不可达 | 200 | 503 | `database: unavailable` |

**不要**用 `live` 判断「能不能对外服务」；`ready` 才是。

## 2. 常见故障处置

### 2.1 readiness 一直 503，`database: unavailable`
1. `docker compose ps db` 看容器状态；
2. `docker compose exec db pg_isready -U <admin> -d <db>`；
3. 看 API 日志里的 `readiness: 数据库不可用`；
4. 连接池/口令变更后要重启 API（引擎是进程级单例）。
**不要**把 API 的 `restart` policy 调成无限重启来「等它自己好」。

### 2.2 `schema: not_migrated`
1. `docker compose run --rm migrate` 看真实报错；
2. 若是「表缺了」：迁移没跑完，或跑完没补运行账号权限；
3. 迁移成功后补授权（幂等）：
   `psql -U <admin> -d <db> -v app_user=<app> -f deploy/db/grant-runtime.sql`；
4. **不要**在生产上反复 `upgrade / downgrade` 试错。

### 2.3 `media_storage: not_writable`
1. 磁盘是否满：`df -h`；
2. 卷是否只读挂载 / 属主变了：`docker compose exec api ls -ld /var/lib/phantom-log/media`；
3. 属主应是镜像里的 `phantom`（uid 10001）。**不要**为了让检查通过把目录 `chmod 777`。

### 2.4 登录被拒（403 `FORBIDDEN`）
- `缺少 Origin，拒绝状态变更请求`：说明**网关把 `Origin` 弄丢了**。
  检查反代是否删了该头；Caddy 的 `reverse_proxy` 默认透传，不要加 `header_up -Origin`。
- 同源比对是按 `Origin` 的 netloc 与 `Host` 比对（scheme 不参与，因为反代终止 TLS）。
  所以**不要**改写 `Host`，否则所有写请求都会 403。
- 本机已实测：同源 Origin 的登录 200、伪造 Origin 403、缺 Origin 403、带 Cookie 复读会话 `authenticated: true`。

### 2.5 登录被限流（429）
登录限流是「每 IP 每分钟 5 次」，实现是 PostgreSQL 短期表 + 进程内计数。
- `TRUST_PROXY_HEADERS=true` 时读 `X-Forwarded-For` 的第一个地址；**必须是网关覆写的**，
  否则可以伪造。直连部署时保持 `false`。
- 多 worker / 多实例时阈值会 × 进程数；严格全局限流需要网关或共享计数（尚未实现）。

### 2.6 磁盘满
- 日志：编排里已限制 `json-file` 为 `10m × 5`；
- 媒体：`MEDIA_ROOT` 是持久卷，增长来自上传（单文件上限 8 MiB，并发 2）；
- 备份目录**不要**和生产数据卷放在同一个文件系统上；
- 磁盘满时 readiness 会因为媒体探针写失败变成 503 —— 这是设计行为，不是误报。

### 2.7 证书 / 域名
- Caddy 的自动 HTTPS 需要：域名已解析、80/443 可达、`caddy_data` 卷持久化；
- 证书卷丢了会重新签发，可能触发 ACME 速率限制；
- **没有域名时只能 HTTP 冒烟**，不要把「容器起来了」当成「TLS 配好了」。

## 3. 日志

| 来源 | 位置 | 内容 |
| --- | --- | --- |
| 网关 | `caddy_data` 卷里的 `/data/logs/access.log`（JSON，10 MiB × 5） | request id、路径、耗时、状态；**隐藏 Cookie / Authorization** |
| API | `docker compose logs api` | 结构化日志含 request id、路径模板、耗时、状态；不记录 Cookie、密码、原始搜索条件 |
| Web | `docker compose logs web` | Next 的服务端日志 |
| 备份 | `manifest.json` + `restore-report.json` | 耗时、数量、校验结果 |

监测最少要覆盖：5xx 比例、磁盘剩余、容器内存 / 重启次数、**最近一次备份成功时间**。
只检查首页在线不算监测（06 §9）。

## 4. 需要人工决定的定期任务（尚未自动化）

| 任务 | 频率 | 现状 |
| --- | --- | --- |
| 成对备份 | 每日（保留 7 日 / 4 周 / 3 月） | 脚本已就绪，**调度未接**（用宿主机定时器，不要在 API 容器里起 cron） |
| 隔离恢复演练 | 每月 | 脚本已就绪（`deploy/restore.py`），**调度未接** |
| 备份异地加密副本 | 每次备份 | **未落实**（需要站主提供目的地与密钥保管方式） |
| 媒体孤儿清理 | 待定 | 目前只报告不删除；需要保留期策略 |
| 过期限流行清理 | 待定 | 目前机会式清理 |
| 依赖 / 基础镜像更新 | 待定 | 需要重新跑 CI 与隔离恢复演练 |

## 5. 紧急联系与权限边界

- 生产部署与数据覆盖需要**站主明确指令**；本仓库的脚本不会自动做这两件事。
- 恢复生产备份是**数据回退**：需要站主确认，并且要保留故障现场与故障后的新数据备份。
- 没有密钥的情况下无法恢复会话；请通过 `bootstrap_admin` 重置站主口令（会写审计）。
