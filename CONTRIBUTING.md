# 开发与交接约定

先读 [README](README.md)、[开发指南](docs/development/README.md) 与当前任务单。本文适用于人工开发和 agent 协作，不替代站主对部署、推送、数据库操作及素材发布范围的授权。

## 1. 开始修改前

```bash
git status --short
git branch --show-current
git log -5 --oneline
```

记录基线 SHA，保留现有未提交修改。使用任务分支（如 `codex/docs-refresh`）；已有协作分支时先遵循任务约定，不擅自切换或覆盖。不要用硬重置或重写历史处理并行修改。

一项 PR 尽量只解决一个有明确验收条件的问题。跨模块任务先约定路由、DTO、状态所有权与共享文件负责人；尤其避免多人同时修改手机宿主、导航协调器、全局样式、依赖锁和数据库迁移。

## 2. 代码与产品边界

- 当前实现位于 `apps/web` 和 `apps/api`；根目录静态站保留，不因文档整理整体搬动。
- 手机内和独立页复用功能组件，沿用应用注册表、共享导航和过场协调器。不要让各 App 自建全局播放器或过场遮罩。
- 文章、手记、INS、图库、作品各自保留职责；工作草稿不等于正式内容，自动保存不等于发布。
- 修改公开条件时同时覆盖列表、封面、数量、年份和媒体权限，不能只隐藏前端入口。
- 生成的 API 类型不手工修改；契约变更与后端实现同时交付。
- 迁移应向前增加，不改写已经应用的迁移来掩盖变更。真实数据操作前确认目标、备份和回退；不在共享数据库上做破坏性演练。
- 不把示例数据、模拟 AI、视口模拟或脚本检查写成真实内容、真实模型、真机或上线结果。

## 3. 最小验证矩阵

| 改动 | 应验证的范围 |
| --- | --- |
| 文档／GitHub 模板 | `git diff --check`、新增相对链接、命令路径和变量说明 |
| 旧站逻辑／兼容 | `node --test tests/*.test.cjs`；补受影响旧 URL 的检查 |
| 前端组件／样式／路由 | typecheck、lint、Vitest、build；交互变更补页面验证 |
| 后端业务／模型／迁移 | 独立 PostgreSQL 实例上的 pytest；核对失败、跳过、迁移与数据保留 |
| API 契约 | 后端测试、OpenAPI 导出、前端类型生成、差异审阅、typecheck |
| Compose／镜像／CI | 对应静态审查及隔离运行验证；不要用静态解析替代容器启动证据 |

### 前端与旧站

以下从仓库根执行；依赖安装见开发指南：

```bash
npm --prefix apps/web run typecheck
npm --prefix apps/web run lint
npm --prefix apps/web run test -- --run
npm --prefix apps/web run build
node --test tests/*.test.cjs
```

Vitest 加 `-- --run` 进行一次性验证。构建会读取本地前端 env；生产等价验证应在不带开发代理配置的隔离环境中执行，不能把本地 `.env.local` 直接带进生产。

### 后端：先隔离，再运行

整套 pytest 需要独立、可丢弃的 PostgreSQL 18 **实例**，不是共享实例里换一个库名。部分用例会删除并重建固定名称的临时库，另一些会提交数据再清表；账号须能创建和删除自己的测试库。不要使用生产账号，不要在同一实例并行跑多组测试。

准备已存在的连接库，例如 `pl_test`，在当前 shell 的 `TEST_DATABASE_URL` 中设置并导出实际测试连接信息。库名需符合测试守卫，但守卫不能证明主机归属安全。使用没有生产 `.env`／文件密钥的独立测试环境。

```bash
uv sync --project apps/api --frozen

# TEST_DATABASE_URL 必须事先 export，并人工确认指向可丢弃的独立实例。
: "${TEST_DATABASE_URL:?请先配置独立测试数据库}"
APP_ENV=test \
DATABASE_URL="$TEST_DATABASE_URL" \
DATABASE_URL_FILE= \
SECRET_KEY=contribution-test-only-secret-not-for-production \
uv run --project apps/api pytest apps/api/tests -ra
```

未设置测试 URL、权限不足或某些连接问题可能产生 skip。报告必须列出跳过原因，不能仅依据退出码 0 宣称数据库测试通过。上述固定测试密钥只用于测试进程，不得作为任何部署配置。

### API 契约更新

在正确配置的开发／测试环境中，从仓库根执行：

```bash
uv run --project apps/api python apps/api/scripts/export_openapi.py
npm --prefix apps/web run gen:api
git diff -- contracts/openapi.json apps/web/lib/api/generated/schema.ts
```

导出脚本不需要启动 API，但会加载应用配置；不要继承生产文件密钥。生成后审阅并一并提交契约和派生类型。CI 的具体命令以 [.github/workflows/ci.yml](.github/workflows/ci.yml) 为准。

### 不作为通用一键验证的脚本

以下工具保留原样，使用前审查源码、目标路径与资源归属：

- `tools/pg-local.sh init`：删除并重建指定数据目录。
- `tools/verify-backend-isolated.sh`：固定临时目录、初始化／清理逻辑及机器相关路径，需要额外核对失败处理。
- `tools/verify-all.sh`：部分业务流使用固定端口；`--no-backend` 不等于完全不碰数据库。
- `tools/e2e-stack.sh`：重建临时集群、按端口处理进程并写种子数据。
- `tools/seed-demo-content.py`：部分选项重置管理员或删除重建数据库。
- `tools/acceptance/` 中部分脚本：固定 55432、测试库名和原开发机路径，不应直接在共享实例上运行。
- `tools/package-handoff.py`：默认输出到历史交接 ZIP，并带旧断言；先改定输出与核对范围，不覆盖历史包。

## 4. UI、素材与真实设备

交付 UI 时给出改前／改后截图、参考来源和实际验证尺寸；若无游戏完整参考，标记为适配或待复核，不能称为逐像素还原。

涉及手机时检查 320px、390px、桌面缩放、键盘、滚动、输入法和减少动态效果。真机 iOS／Android、软键盘、触控命中和真实音频需要物理设备证据；浏览器模拟不是替代品。

活动素材及实际下载的公开文件不得包含明智吾郎。合图必须检查画面并可靠分离，不能用 CSS 隐藏代替资源清理；不要按 `crow` 子串批量删除而误伤 `crowd`。新增素材记录来源、游戏版本、哈希、用途、处理方式和许可核查状态。

参考库、原始采集包与用户媒体各有边界，不能整库复制进 `public` 或镜像。没有根级开源许可证；不擅自新增许可证，也不将字体许可推及整个项目。

## 5. 提交、PR 与交接

提交前检查：

```bash
git diff --check
git diff --stat
git status --short
```

只暂存本任务已审阅的文件，保留其他人的修改。提交说明写清目的，例如 `docs: refresh project onboarding`；不要把“全部完成”当作验证结果。

PR／交接内容至少包含：

1. 基线与交付 SHA，实际修改范围和未提交状态。
2. 行为变化、兼容方式、接口／迁移／素材说明。
3. 实际执行的命令、结果与日志位置；失败、跳过和未验证分别列出。
4. UI 对照及设备信息；数据迁移的旧数据保留与回退证据。
5. 未完成项、风险、下一位负责人需要的输入；不能把阻塞藏进附件。

提交和推送、合并、发布镜像、部署服务器是不同操作；按任务授权执行。本文不授权修改分支保护、删除远端分支或开启收费服务。

## 6. 敏感信息与仓库卫生

不要提交 `.env`、令牌、Cookie、数据库／媒体备份、私密草稿、上传文件和依赖缓存。示例配置保留占位值。公开报告先脱敏，涉及可利用安全问题时不要在公开 Issue 中上传密钥或攻击细节，应先联系站主确认私密渠道。

新增交接 ZIP 默认忽略，已被跟踪的历史包不自动退出 Git。修改忽略规则不等于清理历史；不要未经授权重写历史或删除旧包。历史说明与当前文档分区维护，入口统一放在 [文档索引](docs/README.md)。
