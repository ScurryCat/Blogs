# PHANTOM LOG 多 Agent 开发交接计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement the assigned package task-by-task. Use superpowers:subagent-driven-development only when the coordinator explicitly delegates further. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将两轮设计整理为可分发、可独立验收、可安全集成的开发任务包。

**Architecture:** 一个 Next.js / React 前端、一个模块化 FastAPI 后端、一个 PostgreSQL 数据库，以 Docker Compose 部署。手机和独立页面共用功能视图；各领域独占目录，共享注册与数据库迁移由集成负责人串行处理。

**Tech Stack:** Next.js App Router、React、TypeScript、FastAPI、PostgreSQL；SQLAlchemy / Alembic 为拟采用的数据层工具。具体依赖版本由 T00 验证并锁定。

日期：2026-10-16，Asia/Shanghai。

## 先读这几句

这是一份分工与交接计划，不是已完成的开发记录，也不是全部源码的逐行实现计划。收到一个任务包，只执行该包范围；细化实现步骤时把实际测试、代码位置和命令写入该包的交付记录。没有前置依赖时不能假装接口存在。

用户已要求整理文档供其分发。本次没有启动子 agent、创建新分支 / worktree、迁移工程、提交或推送。收到任务的 agent 不因本文件而获得操作生产环境或调用付费 AI 的额外权限。

**推荐分发单位：本目录 + 两轮原始设计。** 若使用附带 ZIP，解压到仓库根目录，保持 `docs/` 路径；ZIP 仅包含文档，不包含代码、素材、密钥或未提交的问卷补丁。

## 1. 已确认、执行默认值与待落实项

| 类别 | 内容 |
| --- | --- |
| 用户已确认 | Docker 部署；Next.js / React + FastAPI + PostgreSQL；可扩展手机；本站 INS，不接 Instagram；角色对话采用剧情选项 + AI 自由聊天；UI 参考游戏原版 |
| 用户已确认 | 增加追番、日记、游戏、作品集、照片墙和友链；合理使用勒布朗、天鹅绒房间、殿堂、印象空间 |
| 必须保留 | 地图图标、右侧出发、下方地点列表使用人群；顶部导航使用 Joker；音乐连续；既有问卷效果与配置复用 |
| 本交接采用的设计默认值 | COOP 独立友链 App；INS 动态 / 相册 / 消息；手记；放课后；作品照片展厅；专题殿堂；问题记录；技能全书 |
| 本交接采用的工程默认值 | 同源 API；单站主；访客无注册；领域独占目录；共享类型、路由注册、迁移和锁文件由集成负责人收口 |
| 上线前须落实 | 生产域名 / 服务器 / 备份目的地、素材许可；AI 供应商、预算及保留政策。未落实不阻止本地逻辑与模拟服务测试，但不能宣称真实 AI 或生产验收已完成 |

场景映射是两轮设计的推荐方案，不写成用户逐项批准过的决定。执行中可做不改变范围的技术细化；若要把友链并入 INS、取消 AI、改技术栈或增加真实用户社交，交回协调者决定，不能自行改产品方向。

## 2. 当前仓库与基线

- 仓库：`ScurryCat/Blogs`；本次整理所在分支 `codex/phantom-poll`；HEAD `1cb2124`。
- 当前实现：HTML / CSS / 原生 JS，`window.PL` + 自定义 PJAX；尚无 `apps/web`、`apps/api` 和 Compose 工程。
- 首页是 `index.html` + `assets/js/home.js`，没有 `home.html`。
- 文章在 `assets/js/posts.js`，站点 / 地图 / 问卷配置在 `assets/js/site.js`。
- 原有静态预览约定端口 8000。迁移使用独立端口，不擅自停止原预览。
- 2026-10-16 本次运行 `node --test tests/*.test.cjs`：53 通过，0 失败。这不证明新架构、浏览器视觉或 Docker 已经验证。

需保全的既有未提交文件：

```text
assets/css/poll.css
assets/js/poll.js
docs/superpowers/specs/2026-10-15-phantom-poll-design.md
tests/poll-browser.html
tests/poll-browser.js
```

两轮九份新设计文档也尚未提交。仅从远端 HEAD 创建分支不包含它们或上述问卷效果。T00 必须先取得可复现的代码基线和文档；不能执行 reset / checkout 覆盖用户文件，不能把不相关修改混入自己的功能提交。

## 3. 分发顺序

| 任务 | 职责 | 开始条件 | 可与谁并行 |
| --- | --- | --- | --- |
| [T00 基线与集成](tasks/T00-foundation.md) | 保存基线、建立工程、固定共享契约，之后负责集成 | 无 | 第一批串行 |
| [T01 后端基础](tasks/T01-api-core.md) | 文章、认证、媒体、数据库基础 | T00 | T02 |
| [T02 主站与手机](tasks/T02-web-runtime.md) | 旧站迁移、持久音乐、过场、手机宿主 | T00 | T01；真实数据验收等 T01 |
| [T03 INS 图文](tasks/T03-ins.md) | 图文发布 / 阅读 / 收藏；预留消息与相册接入边界 | T01 + T02 已集成 | T04、T05、T07 |
| [T04 异世界导航](tasks/T04-metanav.md) | 专题、关键词匹配、搜索、分类印象空间 | T01 + T02 已集成 | T03、T05、T07 |
| [T05 日常应用](tasks/T05-daily-life.md) | 手记、追番 / 游戏、勒布朗近况视图 | T01 + T02 已集成 | T03、T04、T07 |
| [T06 展厅与画廊](tasks/T06-showcase.md) | 作品、相册 / 照片墙、项目关联专题 | T04 已集成 | T08 |
| [T07 COOP](tasks/T07-coop.md) | 友链通讯录、管理与共享入口 | T01 + T02 已集成 | T03、T04、T05 |
| [T08 混合角色消息](tasks/T08-messaging.md) | 剧情 + AI、原版 IM、一对一会话与预算 | T03 已集成 | T06；外部 AI 验收另需配置 |
| [T09 技能与探索](tasks/T09-growth.md) | 天鹅绒房间、技能组合、问题记录 | T04 + T06 已集成 | 已稳定模块的独立维护 |
| [T10 部署与验收](tasks/T10-release.md) | 容器生产化、CI、备份恢复、跨模块验证 | T01 + T02 已集成 | 可先准备部署；发布验收等待本次选定模块 |

```text
T00
 ├─ T01 ─┐
 └─ T02 ─┴─ 基础集成通过
             ├─ T03 ── T08
             ├─ T04 ── T06 ── T09（同时依赖 T04）
             ├─ T05
             ├─ T07
             └─ T10：准备部署；每次发布核验选定模块
```

11 个任务包不等于同时开启 11 个 agent。建议先发 T00，再并行 T01 / T02；基础集成后挑 2–3 个功能包。可以先上线一批，不要求完成 T09 才发布。依赖的“完成”指已经集成并通过检查，不是另一个 agent 声称写完。

机器可读依赖见 [tasks.json](tasks.json)。所有任务当前为 `not_started`。

## 4. 每个 agent 的最小阅读包

1. 本 README。
2. [共享契约与所有权](SHARED-CONTRACTS.md)。
3. 自己的 `tasks/Txx-*.md`。
4. 任务卡指定的源设计章节；不要只读标题，也不需要每次读完整九份文档。
5. [验收与交付模板](ACCEPTANCE.md)。

任务卡中的路径从仓库根目录解析。`apps/`、`deploy/` 等均是将要创建的路径，不代表当前已存在。本机绝对路径仅用于查找现有参考素材，不能写进运行代码。

## 5. 可以直接复制的派发提示词

将下文中的任务卡路径换成目标任务卡；其余保持不变：

> 你负责 PHANTOM LOG 的一个独立开发包。请先阅读 `docs/superpowers/plans/2026-10-16-agent-handoff/README.md`，再读该目录内的 `SHARED-CONTRACTS.md`、`ACCEPTANCE.md` 和我指定的任务卡及其引用设计。仅执行该包，不接管整站、不递归启动其他 agent、不推送或部署生产。先验证前置依赖与工作区状态，再列出将修改的文件。遵守文件所有权，遇到共享文件变更通过集成交付单交给负责人，不覆盖别人改动。使用真实测试与浏览器证据验收；没有依赖、原版参考帧、模型配置或运行环境时准确报告缺口，不用假数据或模拟响应冒充完成。返回变更文件、测试命令与结果、截图路径、契约变更、集成步骤及遗留问题。指定任务卡：`docs/superpowers/plans/2026-10-16-agent-handoff/tasks/T03-ins.md`。

首个任务请改为 `T00-foundation.md`。此提示词允许本地实现分配的功能；提交、分支、worktree、远程消息、推送、PR 和部署仍服从用户及当前环境的授权，不因模板而扩大权限。

## 6. 原始设计与冲突处理

| 文档 | 作用 |
| --- | --- |
| [总览](../../specs/2026-10-16-next-phase-design.md) | 两轮需求入口 |
| [01 架构](../../specs/2026-10-16-stack-architecture-design.md) | 前后端边界、迁移与路由 |
| [02 手机](../../specs/2026-10-16-phone-app-platform-design.md) | 宿主、返回、持久服务 |
| [03 INS](../../specs/2026-10-16-ins-design.md) | 图文基础版 |
| [04 导航](../../specs/2026-10-16-metaverse-navigator-design.md) | 专题 / 匹配 / 搜索 |
| [05 数据 API](../../specs/2026-10-16-data-api-design.md) | 已明确的字段、响应和权限 |
| [06 部署](../../specs/2026-10-16-deployment-roadmap-design.md) | 生产条件、备份、旧数据迁移 |
| [07 功能世界](../../specs/2026-10-16-world-features-design.md) | 日常 / 友链 / 展厅 / 成长 |
| [08 角色消息](../../specs/2026-10-16-character-messaging-design.md) | 混合会话、UI、成本与保留 |

用户明确要求优先；具体产品范围看 03 / 04 / 07 / 08；已明确的数据字段看 05；分工和并行边界看本交接包。05 尚未定义的新领域，由负责 agent 先提交契约增量，经 T00 登记后实现，不能各自发明冲突的路径 / DTO / 迁移。

源文档保留，不为了分发重命名或删除。交接新增的目录、任务编号、工具命令约定是执行安排，不宣称来自游戏或用户逐字要求。
