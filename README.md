# PHANTOM LOG · 怪盗日志

一个以《Persona 5》视觉语言为主题的个人博客与生活记录站。

这里既有文章、日记、图文动态和作品，也有东京地图、怪盗手机、异世界导航、角色消息与持续播放的音乐。P5 元素负责组织体验，内容仍然来自真实的学习、生活与创作：不为了填满地图而制造栏目，也不以游戏化装饰替代阅读和操作。

当前主应用使用 **Next.js / React + FastAPI + PostgreSQL**，配套 Docker Compose 部署配置。仓库根目录保留早期静态站作为迁移来源与回归基线；它不是新版应用的启动入口。

[本地启动](#本地启动) · [文档索引](docs/README.md) · [开发指南](docs/development/README.md) · [参与开发](CONTRIBUTING.md) · [部署与运维](docs/operations/README.md)

## 当前阶段

截至 2026-10-19，项目处于“主要功能已接入、创作台第一批收口、准备受限个人试用”的阶段，**不是已经完成生产上线的版本**。

- 访客侧已有文章、生活、作品、地图、关于，以及手机内置应用。
- 站主侧已有动态、手记、图片选择、工作草稿和娱乐进度快捷更新；其他模块保留各自的管理入口。
- 站内完整文章创作与完整媒体管理仍在后续路线中。当前有文章读取能力，不等于已有完整文章编辑器。
- 角色消息支持剧情选项与模拟自由聊天，**未接入真实 AI 模型**；INS 是本站图文应用，不连接真实 Instagram。
- 已有本地隔离 Compose 验证记录；真实域名、HTTPS、生产服务器部署和 iOS／Android 真机验收不能据此认定通过。
- M1A 受限试用配置层已加入仓库，入口见 [试用手册](docs/operations/trial-runbook.md)；本次文档整理未独立复验其运行结论，也不代表已远端部署。

提交方报告、独立验收、真机验证和生产状态分别记录，旧报告中的测试数字不自动代表当前版本。参见 [返工验证记录](docs/acceptance/P5-rework-verification-2026-10-19.md)、[D1 容器验证记录](docs/acceptance/P5-D1-compose-healthcheck-2026-10-19.md) 与 [创作台交付说明](docs/agent-deliveries/P5-final-report.md)。

## 内容与功能

### 五个主栏目

| 栏目 | P5 名称 | 入口与职责 |
| --- | --- | --- |
| 文章 | 情报档案 | `/posts`：完整主题、技术记录、题解；搜索、分类与归档 |
| 生活 | 勒布朗 | `/apps/leblanc`：汇总手记、动态、追番／游戏和图库近况 |
| 作品 | 我的殿堂 | `/showcase`：项目、个人职责、过程与成果 |
| 地图 | 东京漫游 | `/map`：通过地点进入稳定栏目 |
| 关于 | 人物档案 | `/about`：个人介绍与相关入口 |

文章负责长期表达，手记记录某一天，INS 分享图片优先的短近况，图库整理图片，作品展示成果。它们可以互相链接，但不自动复制正文。勒布朗只汇总摘要，不另建一种“生活记录”。

### 怪盗手机与世界入口

| 模块 | 用途 |
| --- | --- |
| INS | 图文动态、相册入口、收藏与角色消息；动态发布至少包含一张图片 |
| 手记 | 真实记录的存档列表、辅助日历与完整阅读页；公开和私密分开 |
| 放课后 | 追番、游戏状态、进度与短评 |
| COOP | 友链通讯录与关系档案，不虚构好感度或等级 |
| 我的殿堂 | 作品列表和详情；生活照片已归入独立图库 |
| 异世界导航 | 关键词匹配、专题与直接浏览入口 |
| 天鹅绒房间 | 技能全书、能力档案 |
| 印象空间 | 问题记录、探索与解决过程 |

桌面端手机采用手持斜屏，小屏采用全屏界面；手机内视图与独立页面复用功能模块。音乐和会话状态跨内部切换保留。设备兼容性仍须按具体真机证据验收。

### 图库与图片收录

`/gallery` 提供照片墙／相册切换。INS 中选择“同时收录到相册”时复用同一媒体，不重复上传；照片墙读取符合公开条件的相册图片，并按媒体 ID 去重。

撤回或删除动态，只取消这条动态带来的相册展示关系；若图片还有其他公开动态或独立收录来源，仍可展示。撤回不等于删除底层文件，草稿相册也不会因收录而自动公开。

### 地图与过场

地图图标、右侧“出发”和地点列表共用目的地配置。地点与栏目是本网站的主题映射，不宣称是原游戏地点的实际功能。

- 普通站点／顶部导航沿用 Joker 帷幕。
- 地图旅行沿用车站人群过场。
- 主动从殿堂外进入作品列表或详情，使用默认约 1.5 秒的异世界短过场；手机入口播放后仍留在手机内。
- 殿堂内部切换、进入图库、刷新和历史前进后退不重复播放进入过场。
- 减少动态效果、跳过、播放失败和超时均须能够继续导航。

## 技术结构

| 层 | 当前选择 | 主要位置 |
| --- | --- | --- |
| Web | Next.js 16、React 19、TypeScript、App Router | `apps/web/` |
| API | FastAPI、Pydantic、SQLAlchemy 2、Alembic、psycopg | `apps/api/` |
| 数据 | PostgreSQL 18；受控媒体目录／持久卷 | `apps/api/app/`、`deploy/` |
| 契约 | OpenAPI 与生成的前端类型 | `contracts/openapi.json` |
| 运行 | Docker Compose、生产 Caddy 同源网关 | `deploy/` |
| 验证 | Vitest、pytest、旧站 Node 测试、端到端脚本 | 各应用测试与 `tests/` |

具体依赖版本以 `package-lock.json` 和 `uv.lock` 为准。CI 与镜像当前采用 Node 26、Python 3.13；Node 26 是仓库使用的基线，不是在此宣称的最低兼容版本。

生产请求路径为：

```text
浏览器 → Caddy → Next.js（页面与静态资源）
              → FastAPI（/api/v1、受权限控制的媒体）
                         → PostgreSQL + 媒体持久卷
```

浏览器使用同源 `/api/v1`；Next.js 服务端读取 `API_INTERNAL_URL`。数据库凭据和内部地址不放进 `NEXT_PUBLIC_*`。上传媒体由 API 检查访问权限，不把整个上传目录挂成公开静态目录。

## 本地启动

推荐开发方式：**Docker 运行数据库与 API，主机运行 Next.js**。需要 Git、Node 26／npm，以及可用的 Docker Engine 或 Docker Desktop 与 Compose v2+。后端在容器中运行时，不要求主机安装 Python／uv。

以下命令均从仓库根目录执行。已有工作副本直接进入目录，不必重新克隆：

```bash
git clone https://github.com/ScurryCat/Blogs.git
cd Blogs
```

### 1. 准备本地配置

仅首次复制；文件已存在时保留原配置：

```bash
cp -n deploy/env/dev.env.example deploy/.env
cp -n apps/web/.env.example apps/web/.env.local
```

编辑 `deploy/.env`，将 `POSTGRES_PASSWORD` 和 `SECRET_KEY` 分别替换为独立随机值。例如分别运行一次 `openssl rand -hex 32`，不要把生成值提交到 Git。开发数据库口令使用十六进制可避免拼接连接串时的特殊字符问题。

编辑 `apps/web/.env.local`，确保以下两项均启用：

```dotenv
API_INTERNAL_URL=http://127.0.0.1:8100
DEV_API_URL=http://127.0.0.1:8100
```

不要直接使用示例口令。已有 PostgreSQL 卷时也不要任意更换初始化口令；修改 env 不会自动修改库内账号密码。

### 2. 启动后端并创建站主账号

默认 Compose 项目名为 `phantom-log-dev`。先确认该项目、3100／8100 端口没有被另一份开发环境使用；如需并行实例，先调整隔离配置，不要接管已有资源。

```bash
docker compose -f deploy/compose.dev.yaml --env-file deploy/.env config --quiet
docker compose -f deploy/compose.dev.yaml --env-file deploy/.env up -d --build db api
docker compose -f deploy/compose.dev.yaml --env-file deploy/.env ps
curl --fail --retry 10 --retry-delay 2 --retry-connrefused --max-time 5 \
  http://127.0.0.1:8100/api/v1/health/ready
```

Compose 会先完成迁移。readiness 失败时先查日志，不要继续假定数据库可用。确认就绪后创建账号：

```bash
docker compose -f deploy/compose.dev.yaml --env-file deploy/.env exec api \
  python -m app.commands.bootstrap_admin --username owner
```

交互输入至少 12 字符的密码；用户名 `owner` 只是示例，没有默认密码。命令拒绝覆盖已有账号，不要为了重复启动而重置密码。

### 3. 启动前端

```bash
npm --prefix apps/web ci
npm --prefix apps/web run dev -- --hostname 127.0.0.1
```

- 网站：<http://127.0.0.1:3100>
- 站主管理：<http://127.0.0.1:3100/admin/login>
- 开发 API 文档：<http://127.0.0.1:8100/docs>

首次启动是空数据库：在管理端建立真实内容即可，不自动填充假动态或假照片。旧站文章导入、主机运行 API、音乐资源和故障排查见 [开发指南](docs/development/README.md)。

**当前开发编排限制：** 不推荐直接启动 Compose 的 `web` 服务。其运行端口与端口映射／健康探测不一致，且镜像未复制 `public/`；以上流程只启动 `db api` 并绕开该路径。这不等于生产镜像也有同样问题，也不表示本次已修复部署代码。

停止本次开发后端可以执行 `docker compose -f deploy/compose.dev.yaml --env-file deploy/.env stop`，前端使用 Ctrl+C。停止不删除数据；不要用删卷命令来“解决”配置或迁移错误。

## 仓库布局

```text
Blogs/
├── apps/
│   ├── web/                  # 当前 Next.js 应用、功能模块、测试与必要公开资源
│   └── api/                  # FastAPI、模型、迁移、命令与后端测试
├── contracts/                # OpenAPI 契约
├── deploy/                   # 开发／生产编排、镜像、网关、备份恢复
├── docs/                     # 文档入口、设计、验收、交付记录与历史包
├── tests/                    # 旧站回归与跨应用集成／端到端脚本
├── tools/                    # 开发、迁移、素材处理与交接工具
├── assets/                   # 旧站资源与迁移来源；不等于新版全部公开目录
├── .github/                  # CI／发布工作流、Issue 与 PR 模板
├── index.html、post.html 等  # 保留的早期静态站
└── CONTRIBUTING.md           # 开发、验证与交接约定
```

不把根目录静态站直接当作新版部署产物，也不把整个仓库当作公开 Web 根目录。旧站玩法、问卷组件与 PJAX 说明保留在 [静态站历史说明](docs/legacy/README-static-site.md)。

## 开发与验证

根目录没有 npm 工作区脚本；前端命令通过 `--prefix apps/web` 执行：

```bash
npm --prefix apps/web run typecheck
npm --prefix apps/web run lint
npm --prefix apps/web run test -- --run
npm --prefix apps/web run build
node --test tests/*.test.cjs
```

后端测试必须使用**独立、可丢弃的 PostgreSQL 实例**：部分测试会重建固定名称的临时数据库，不能只换连接串中的数据库名便视为隔离。没有 `TEST_DATABASE_URL` 时可能跳过数据库测试；绿色结果不能代替数据库验证。

完整测试前置、API 契约生成与提交要求见 [CONTRIBUTING](CONTRIBUTING.md)。工作流见 [CI](.github/workflows/ci.yml) 与 [镜像发布](.github/workflows/release.yml)；文件存在不代表 GitHub 远端执行成功，镜像构建也不代表生产部署。

## 后续路线

以下是已确认方向的摘要，不是完成清单；每阶段都需要对应版本的验收证据。

| 阶段 | 目标 |
| --- | --- |
| M0 · 收口 | 草稿可靠性、手机输入、图库权限、过场和容器证据的独立复验 |
| M1 · 个人试用 | 受限访问环境、配套备份恢复、iOS／Android 真机实际使用 |
| M2 · 文章创作 | 站内 Markdown 编辑、预览、草稿、发布撤回与导入导出 |
| M3 · 媒体维护 | 查找整理、引用位置、相册操作、受控回收与恢复 |
| M4 · 公开发布 | 阅读与性能、分享和检索、安全、素材、域名 HTTPS 与回退 |
| M5 · 世界深化 | 日常创作稳定后，再接真实 AI 与更有实际用途的 P5 关联 |

不在日常文档整理中自动部署服务器、购买服务或接通收费模型。现有创作台设计见 [第一批设计与范围](docs/handoff/2026-10-18-p5-creator-workspace-design.md)。

## 素材、版权与公开边界

这是个人 P5 主题项目，不是 ATLUS／SEGA 官方产品。游戏图像、音频、字体和第三方资源各有来源与权利归属；“非商业”或“已经入库”不等于获得公开分发授权。

- 仓库目前没有根级开源许可证，不提供虚构的 MIT／Apache 许可或徽章。字体等单独附带的许可不能自动覆盖整个项目。
- [素材精选规则](docs/design-references/persona-curated-plan.md)、[资源清单](docs/design-references/persona-assets-manifest.csv) 与 [图标映射](docs/design-references/icon-mapping.md) 保留来源和复核入口。
- 活动素材及实际公开资源不包含明智吾郎是既定要求；多人合图／视频需要检查实际画面，不能仅靠文件名或 CSS 隐藏判定。不要按 `crow` 子串清理，以免误伤 `crowd` 人群资源。
- 原始采集包、本地参考库、用户上传媒体、密钥、数据库备份不是公开静态资源，不应自动进入 Git 或镜像。
- 已跟踪的音乐、素材与历史交接包在本轮整理中保持不变；上线前仍需逐项确认使用与分发范围。忽略规则不会撤回已经跟踪的文件。

完整资料从 [文档索引](docs/README.md) 进入；遇到冲突先检查文档日期、代码版本与证据范围，不以历史“全部通过”代替当前验证。
