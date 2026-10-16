# 备份与恢复（T10）

对应设计：[06 §5「备份与恢复设计」](../../superpowers/specs/2026-10-16-deployment-roadmap-design.md)。
脚本：`deploy/backup.py`（成对备份）、`deploy/restore.py`（隔离恢复）、
`deploy/db/init/*.sh`（角色分离）、`deploy/db/grant-runtime.sql`（运行账号授权）。
验收驱动：`tests/e2e/integration/verify-backup-restore.py`（34 项断言，真实 PostgreSQL）。

## 1. 备份包含什么

一次「成对备份」= 一个目录，包含：

```text
backup-<UTC 时间戳>/
  database.dump        pg_dump -Fc（custom 格式；--no-owner --no-privileges）
  media/               媒体文件全量副本（递归，保持相对路径）
  checksums.sha256     上面每个文件的 SHA-256
  manifest.json        库名、迁移版本、逐表精确行数、媒体清单、git 提交、耗时、主机
```

`manifest.json` 里**逐表 `count(*)`**（不是统计估算）是恢复后核对一致性的依据；
`checksums.sha256` 是「备份没坏」的依据。两者缺一不可 —— 06 §5 明确写了
「只看到备份命令退出 0 不能视为已经具备恢复能力」。

## 2. 备份

```bash
cd /Users/学习/blog/Blogs
export PG_BIN=/opt/homebrew/opt/postgresql@18/bin        # 生产上按实际安装路径

# 先看计划（不写任何文件）：体积、行数、媒体数量、可用空间
python3 deploy/backup.py --database-url "$DATABASE_URL" \
  --media-root /var/lib/phantom-log/media \
  --out /var/backups/phantom-log/backup-$(date -u +%Y%m%dT%H%M%SZ) --dry-run

# 真正备份
python3 deploy/backup.py --database-url "$DATABASE_URL" \
  --media-root /var/lib/phantom-log/media \
  --out /var/backups/phantom-log/backup-$(date -u +%Y%m%dT%H%M%SZ) \
  --label "每日备份" --json
```

规则与保护：

- **不覆盖**：目标目录已存在且非空 → 直接拒绝（要覆盖得显式 `--force`）。
- **只在目标目录里写**：不删除、不移动、不覆盖其他路径。
- **媒体目录不存在就报错退出**：`MEDIA_ROOT` 缺失不等于「空媒体库」。
- **空间不足直接拒绝**：按媒体体积 + 行数估算，低于预估就停。
- `--dry-run` 不落任何文件。

保留策略（06 §5 建议）：7 份日备、4 份周备、3 份月备，**至少一份加密存放在宿主机之外**。
备份是宿主机定时器或外部编排的活，不要在 API 容器里偷偷起 cron。

### 一致性窗口

备份前**短暂停止内容写入**（停止发布 / 编辑 / 上传 / 媒体清理），备份完再放开。
当前实现里媒体对象键不可原地覆写，所以「停写 → dump → 拷媒体」就足够；
将来若要不停写备份，必须先设计对象版本 / 快照协议。

## 3. 隔离恢复（每月至少一次）

```bash
# 目标必须是一个**全新**库名，且不能像生产库名（含 prod / production / live / main 一律拒绝）
python3 deploy/restore.py \
  --backup /var/backups/phantom-log/backup-20261016T120000Z \
  --target-database-url "postgresql://pl@127.0.0.1:55432/pl_restore_drill" \
  --media-root /srv/drill/media \
  --report /srv/drill/restore-report.json
```

脚本按顺序做这些事（每一步失败都写进报告并返回非零）：

1. **核对校验清单**（`--skip-checksum` 可跳过，但报告里会标注「未核对」）；
2. **守卫目标**：库名像生产 → 拒绝；库已存在且不是空库 → 拒绝（要覆盖得 `--force`）；
3. `createdb` 建空库 → `pg_restore --no-owner --no-privileges --exit-on-error`；
4. 恢复媒体到 `--media-root`（目标目录非空时拒绝）；
5. **逐表比较行数**、比较迁移版本、比较媒体数量与逐字节内容；
6. **撤销恢复出来的全部会话**（见 §4）；
7. 写恢复报告（耗时、缺失对象、校验结果）。

演练结束后：用对应镜像启动一套**隔离**服务，核对文章 / 动态 / 关系数量与关键流程。
演练**不得**连接生产数据库或覆盖生产卷。

数据库角色与授权要**单独重建**（06 §5）：单库 dump 不含集群身份配置。新建集群时
`deploy/db/init/*.sh` 会建好角色；已存在的集群用 `deploy/db/grant-runtime.sql` 补授权。

## 4. 恢复后必须撤销旧会话（最重要的一条）

**问题（已实测）**：备份若早于「登出 / 撤销」，恢复会把 `sessions.revoked_at` 覆盖回 `NULL`，
于是**持有旧 Cookie 的人重新获得站主访问权**。

```bash
# 恢复流程的最后一步，必须在开放访问之前执行
uv run --project apps/api python -m app.commands.revoke_sessions --all
```

语义（`apps/api/app/commands/revoke_sessions.py`）：

- `--all`：撤销全部有效会话，**包括 `user_id` 为 NULL 的预登录会话**；
- `--username <名字>`：只撤该站主自己的会话，**不动预登录会话**；
- 只写 `revoked_at`，**不删除行**（审计可追溯）；幂等。

实测证据（`tests/e2e/integration/verify-backup-restore.py`）：

```text
== 7. 恢复后旧会话不可复活 ==
  ✓ 恢复库中恢复出来的有效会话先被清零  revoked_at is null = 0
  ✓ 会话行数保留（只写 revoked_at，不删行）  count=2
== 7b. 对照实验：不做撤销那一步会怎样 ==
  ✓ 实测：不撤销会话时，备份里已撤销的会话恢复后会复活  revoked_at is null = 1 / 共 2 行
  ✓ 补跑 revoke_sessions --all 后归零（修复动作有效）
```

另有 T00 固化的小脚本 `tools/acceptance/verify-restore-revokes-sessions.py`
（用真实 Cookie 重放，含两个测量陷阱说明）。

## 5. 角色分离与口令

| 角色 | 用途 | 权限 |
| --- | --- | --- |
| `pl_admin` | 只用于建库 / 建角色 / 应急 | 超级用户（口令走 Docker secret） |
| `pl_migrator` | `alembic upgrade head` | 表 owner + `public` 的 CREATE |
| `pl_app` | API 运行账号 | 只 DML（SELECT / INSERT / UPDATE / DELETE）+ 序列 USAGE |

- 运行账号**不能**建表 / 建库 / 建角色（实测：`ERROR: permission denied for schema public`）。
- 每次迁移后要补运行账号对新表的权限：
  `psql -v app_user=pl_app -f deploy/db/grant-runtime.sql`（幂等，已实测）。
- 口令**不进 Git**：`deploy/env/prod.env` 与三个 `*_PASSWORD_FILE` 都是工作区外/被忽略的文件，
  `chmod 600`。Compose secrets 只做访问隔离，**不等于磁盘加密**（06 §2）。

**一处如实记录的残留**：`migrate` / `api` 的 `DATABASE_URL` 目前是插值字符串，所以这两个
角色的口令会出现在对应容器的环境变量里（`docker inspect` 可见）。要彻底消除需要应用侧支持
`DATABASE_URL_FILE`（属 `apps/api/app/core/`，T01 所有），已作为集成申请写在 T10 交付单里。

## 6. RPO / RTO 现状

06 §5 的目标是 **RPO 24 小时 / RTO 4 小时**，那是**待演练验证的目标，不是保证**。

本机演练实测（数据量很小：17 张表 34 行 + 2 个媒体文件）：

```text
备份 0.4 秒；隔离恢复（含校验和 + 撤销会话）0.7 秒；备份体积约 56 KB
```

这只说明**流程本身能在秒级跑通**，不代表生产规模下的耗时。真实 RTO 必须在生产数据量级上
重测，并把结果写回本文件。生产备份频率决定实际 RPO：每日备份 = RPO 最坏 24 小时。

## 7. 明确不做的事

- 不执行 `docker compose down -v`；不删除或覆盖未知卷；
- 不做自动 downgrade 迁移；
- 不在本机/演练环境连接生产数据库；
- 不把「备份命令退出 0」当成恢复能力；
- 不把媒体文件或镜像当成备份（06 §4：图片文件与 volume 不是备份，重拉镜像不能代替恢复数据）。
