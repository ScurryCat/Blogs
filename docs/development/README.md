# 本地开发指南

面向当前 Next.js＋FastAPI 应用。基础安装步骤见 [项目 README](../../README.md#本地启动)；本页补充配置、更新、可选流程与排错。除特别说明外，命令从仓库根目录执行。

本指南的命令已按 2026-10-19 代码配置核对；本次文档整理没有重新启动数据库、执行迁移或重跑完整应用测试。历史验证见 [验收入口](../README.md#验收和交付资料怎么读)。

## 1. 环境与目录

- Node 26／npm：与当前 CI 和镜像基线对齐，依赖以 `apps/web/package-lock.json` 为准。
- Docker Engine／Desktop 与 Compose v2+：推荐用于 PostgreSQL 18 和 API。
- 只有选择主机运行 API 时才需要 Python 3.13、uv 和独立开发 PostgreSQL；CI 使用 uv 0.9.18，Python 依赖由 `apps/api/uv.lock` 锁定。
- 前端根为 `apps/web`，后端根为 `apps/api`；仓库根没有 `package.json`。

| 配置文件 | 用途 | 是否提交 |
| --- | --- | --- |
| `deploy/env/dev.env.example` | 开发编排示例 | 是 |
| `deploy/.env` | 本指南采用的本地 Compose 配置路径 | 否 |
| `apps/web/.env.example` | 前端变量说明 | 是 |
| `apps/web/.env.local` | 主机运行 Next.js 的本地配置 | 否 |
| `apps/api/.env` | 仅主机运行 API 时使用 | 否 |
| `deploy/env/prod.env.example` | 生产配置示例，不是生产密钥 | 是 |

Compose 的配置路径由 `--env-file` 明确指定；使用其他路径时，所有相关命令保持一致。不要覆盖已有 env，不要把真实渲染配置或含口令的日志附进公开 Issue。

## 2. 推荐开发方式

按 README 启动 `db api`，主机运行 `npm --prefix apps/web run dev -- --hostname 127.0.0.1`。API 端口为 8100，Web 为 3100，开发 PostgreSQL 不映射主机端口。

开发编排的数据库和媒体各有持久卷。相同 Compose 项目名会重用同一组资源；在已有实例上执行命令前，确认实例属于当前任务。并行环境需要项目名、端口、数据卷一并隔离。

### 更新代码后

- Web 的 `dev` 提供热更新；依赖或锁文件变化后重跑 `npm --prefix apps/web ci`。
- Docker API 没有挂载源码用于热更新；修改后端后重新构建 API。迁移涉及数据，已有真实内容时先做数据库与媒体配套备份。

```bash
docker compose -f deploy/compose.dev.yaml --env-file deploy/.env up -d --build api
docker compose -f deploy/compose.dev.yaml --env-file deploy/.env logs --tail 100 migrate api
curl --fail --retry 10 --retry-delay 2 --retry-connrefused --max-time 5 \
  http://127.0.0.1:8100/api/v1/health/ready
```

这里的日志仅用于本地诊断，分享前检查是否包含敏感内容。停止服务不等于清理数据，不要默认删卷。

### 前端 API 转发

`apps/web/.env.local` 必须同时启用：

```dotenv
API_INTERNAL_URL=http://127.0.0.1:8100
DEV_API_URL=http://127.0.0.1:8100
```

前者用于 Next.js 服务端，后者让浏览器的同源 `/api/v1` 请求转发到 API。只配置前者可能导致页面能读取数据、登录等浏览器操作却失败。统一使用 `127.0.0.1`，不要在一次登录流程里混用 `localhost`。

修改变量后重启开发服务。构建模式的 rewrites 在 `next build` 时固化，仅在 `next start` 时添加变量无效；面向生产的构建不设置 `DEV_API_URL`／`DEV_LEGACY_STATIC_URL`，生产由网关分流。不要把带开发代理的本地构建当成生产构建交付。

## 3. 主机运行 API（可选）

只有需要后端热更新时才采用这一方式，不要同时启动另一个占用 8100 的容器 API。

先准备一个归自己所有的 PostgreSQL 18 开发数据库和账号，再手工创建 `apps/api/.env`。以下是字段示意，不是可以直接使用的账号：

```dotenv
APP_ENV=dev
DATABASE_URL=postgresql+psycopg://YOUR_USER:URL_ENCODED_PASSWORD@127.0.0.1:YOUR_PORT/YOUR_DEV_DB
SECRET_KEY=REPLACE_WITH_A_SEPARATE_RANDOM_SECRET_AT_LEAST_32_CHARACTERS
CORS_ORIGINS=http://127.0.0.1:3100
MEDIA_MAX_CONCURRENCY=2
```

替换全部占位值；口令含特殊字符时需 URL 编码。不要把 Compose 的 env 直接复制成 API env：API 配置拒绝不认识的 `POSTGRES_*` 等字段。默认媒体位置为 `apps/api/var/media`，不进入 Git。

在确认迁移目标正确并完成必要备份后，进入后端目录：

```bash
cd apps/api
uv sync --frozen
mkdir -p var/media
uv run alembic upgrade head
uv run python -m app.commands.bootstrap_admin --username owner
uv run uvicorn app.main:app --host 127.0.0.1 --port 8100 --reload
```

已有管理员时跳过创建账号，不默认传 `--reset-password`。迁移失败即停止，不能删库重新来过后声称原数据迁移成功。

## 4. 初始内容与旧站导入

迁移只创建／升级结构，不自动导入演示数据。先通过 `/admin/login` 登录，使用管理入口建立自己的动态、手记、相册、作品或娱乐记录。站内完整文章编辑器仍属于后续开发，不要按动态编辑器推断文章管理已完成。

如确实需要导入根目录旧站文章，可使用已有导入命令。以下在 `apps/api` 目录、已配置正确开发数据库的主机环境执行；容器 API 镜像没有旧站完整源目录，不能原样套用：

```bash
uv run python -m app.commands.import_legacy --dry-run --repo-root ../.. --no-covers
```

先审阅 dry-run 输出及目标配置。注意：**新增 slug 会直接以已发布状态导入**，不是导入为草稿。确认内容可公开、备份与目标后，才手工执行写入：

```bash
uv run python -m app.commands.import_legacy --apply --repo-root ../.. --no-covers
```

该命令按 slug 匹配，会更新同 slug 内容，不是无条件追加；已有文章保留原发布状态，新文章直接发布。上例不导入封面。需要封面时先阅读 `uv run python -m app.commands.import_legacy --help` 和源代码，核对媒体目录及管理员归属。

不要把 `tools/seed-demo-content.py` 当作安全的默认初始化入口：部分选项会重置同名管理员或删除重建数据库。

## 5. 音乐与静态资源

新版必要公开资源位于 `apps/web/public/`，原始参考库并非公开目录。音乐当前保留在根目录 `assets/music/`，主机 Next.js 默认不会直接提供这些文件。

确需本地预览音乐时，可让仅监听回环地址的静态服务提供 `/assets/music/`，并在前端 env 启用 `DEV_LEGACY_STATIC_URL` 指向该服务。应使用支持 Range 的服务验证拖动和恢复；简单静态服务器能取到文件不代表完整音频行为通过。不要为了预览而向局域网／公网暴露整个仓库。

生产 Web 镜像有单独的 `music` 构建上下文，详见 `deploy/prod.Dockerfile.web`。资源存在、请求成功、实际出声、自动播放权限与跨页续播是不同检查项；版权与分发范围另行核对。

旧版静态站仍可独立预览，但其启动方式、Supabase 留言适配和 PJAX 约定只适用于 [历史版本](../legacy/README-static-site.md)。

## 6. 常见问题

| 现象 | 优先检查 |
| --- | --- |
| Web 页面正常，登录／保存 404 | `DEV_API_URL` 是否启用；重启开发服务或重新构建 |
| API 无法连接数据库 | Compose `db`／`migrate` 状态、账号口令与已有卷是否匹配 |
| 容器启动但 readiness 失败 | `/api/v1/health/ready` 与 API／迁移日志；不要只看 liveness |
| `docker compose up` 后 Web 不可访问 | 当前 dev `web` 监听 3100，映射／探测 3000，且未复制 `public/`；改用本指南的主机 Next.js |
| 空列表、没有图片 | 新数据库没有业务内容；确认管理端发布状态和媒体公开条件 |
| BGM 不播放 | 静态来源、用户播放手势、音频请求与浏览器策略；不要先改自动播放规则 |
| env 校验有未知字段 | 是否把 Compose env 误当作 API env，或继承了其他环境变量 |
| 测试全绿却没访问数据库 | 查看 skip 原因；确认独立测试实例和 `TEST_DATABASE_URL` |

## 7. 测试与发布边界

验证矩阵、测试数据库隔离与契约生成见 [CONTRIBUTING](../../CONTRIBUTING.md)。`tools/verify-all.sh`、`tools/e2e-stack.sh`、`tools/pg-local.sh` 等不是通用无副作用命令：使用前审查固定端口、路径、删库／清理和种子逻辑。

本地开发成功不等于生产可发布。生产配置、访问控制、数据库角色、备份／恢复、HTTPS 和真实设备应按 [运维入口](../operations/README.md) 单独验收。不要沿用旧静态站的“git pull 就是部署”流程。
