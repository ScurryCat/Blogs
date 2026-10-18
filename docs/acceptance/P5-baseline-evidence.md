# P5 基线证据（C5a · 并行准备期快照）

> 采集：C5 ｜ 时间：2026-10-18 23:40–23:45（Asia/Shanghai）｜ 仓库：`/Users/学习/blog/Blogs`
> 目的：给 C5b 最终验收一个**可对照的真实起点**。本文件只记录实测；未测的项明确写「未执行」。
> 注意：采集期 C1–C4 正在并行落文件，工作树每秒都可能变化 —— 本快照的数字带时间戳，
> 最终验收必须以**集成完成后重新采集**的结果为准。

## 1. Git 基线

| 项 | 实测值 |
|---|---|
| 仓库 | `/Users/学习/blog/Blogs`（工作目录 `/Users/学习/blog` 子目录） |
| 分支 / 上游 | `main`（`## main...origin/main`） |
| HEAD | `d99732c15f7be27aa0051518554e5f968a7e8a29`（short `d99732c`） |
| 提交总数 | 333 |
| `git stash` | 0 条 |
| 工作树 | **不干净**（他人未提交修改，见 §1.1）；按契约 §1 这些不属于本轮，任何人不得覆盖/回滚/提交 |

### 1.1 采集时刻（23:41）的工作树状态（17 项）

**已修改（13）**——均为本轮之前/他人工作，与 P5 实现无关：

```
 M apps/api/app/model_registry.py
 M apps/api/app/router.py
 M apps/web/features/messaging/messaging.css
 M docs/agent-deliveries/HANDOFF.md
 M docs/agent-deliveries/P4-acceptance-complete-status.md
 M docs/agent-deliveries/P4-final-state.md
 M docs/agent-deliveries/P4-g2-reference-search.md
 M docs/agent-deliveries/P4-im-pixel-round2.md
 M docs/agent-deliveries/P4-visual-comparison-evidence.md
 M docs/design-references/reference-frame-sources.md
 M tools/acceptance/verify-reference-frames.py
 M tools/capture-visual-comparison.py
 M tools/package-handoff.py
```

**未跟踪（4）**——C0 本轮建立的契约/设计书/模块位与预存素材：

```
?? apps/api/app/modules/work_drafts/
?? docs/agent-deliveries/P5-C0-integration-contract.md
?? docs/design-references/frames/
?? docs/handoff/2026-10-18-p5-creator-workspace-design.md
```

### 1.2 23:43 复采：并行 worker 已开始落文件（**会持续变化，不算基线**）

```
 M apps/api/tests/test_module_registration.py                  (C1)
 M apps/web/features/leisure/admin/leisure-workspace.tsx       (C4)
 M apps/web/features/leisure/leisure.module.css                (C4)
 M docs/design-references/reference-frame-gaps.md              (文档)
?? apps/api/migrations/versions/20261018_2342_747d6fd473d9_t10_work_drafts_and_media_retention.py  (C1)
?? apps/web/features/leisure/admin/quick-update.tsx / quick-update.test.tsx                        (C4)
?? apps/web/features/media-picker/（api.ts / types.ts / media-thumb.tsx）                          (C3)
```

结论：后续采集「当前状态」时必须同时记 `git status --porcelain | wc -l` 与时间；不能用 23:41 的数字代表最终状态。

## 2. `bash tools/verify-all.sh --fast` 真实输出摘要

- 时间：2026-10-18 23:40:17 启动 → 23:42 前结束；**退出码 0**；当时 HEAD `d99732c`。
- 环境：`no_proxy=127.0.0.1,localhost,::1`、`LC_ALL=C`、`UV_CACHE_DIR`/`npm_config_cache` 指向 `Blogs/.dsh/*`。
- 命令：`cd /Users/学习/blog/Blogs && bash tools/verify-all.sh --fast`

```
────────────────────────────────────────────────────────
▶ 1/6 静态审计（引用完整性 / 素材许可）
────────────────────────────────────────────────────────
  图标/路由：  （无问题 ✓：10 个图标全部存在、在清单内、哈希一致，且未引用已移除资源）
  资源引用：✓ 生产代码里的静态资源引用全部能找到对应文件
  明智资源：PASS: 7 项检查全部通过 —— 公开目录/构建输入/构建产物无明智吾郎素材，crowd 过场完整。

────────────────────────────────────────────────────────
▶ 2/6 前端 typecheck / lint / 单测
────────────────────────────────────────────────────────
  typecheck：✓ 无错误
  lint：0 个 error
  单测：      Tests  936 passed (936)

════════════════════════════════════════════════════════
  验收汇总
════════════════════════════════════════════════════════
  静态审计（图标/路由/资源/明智资源） PASS  见 /tmp/vf-*.log
  前端 typecheck / lint / 单测   PASS        Tests  936 passed (936)
  后端整树                       SKIP  （本轮跳过）
  浏览器 T02 + 取数审计       SKIP  （本轮跳过）
  多视口 × 缩放档             SKIP  （本轮跳过）
  业务流验收脚本 ×4          SKIP  （本轮跳过）
  真实浏览器端到端 ×6       SKIP  （未加 --e2e）

  已跑的段全部通过 ✓（跳过 5 段；代码状态：d99732c）
```

**解读**：`--fast` 只覆盖静态审计 + typecheck/lint/前端单测；后端/浏览器/端到端在并行期按契约 §9.8-4 跳过。
本次未跑后端整树与构建（避免与并行 worker 抢独立集群端口、避免覆盖共享 `.next`）。

## 3. 现有测试数量（基线）

| 层 | 数量 | 来源 / 说明 |
|---|---|---|
| 前端单测 | **936 passed / 936** | `--fast` 段 2 实测（vitest）；测试文件 91 个（`find apps/web -name "*.test.ts*"` 不含 node_modules） |
| 后端用例（收集数） | **952**（68 个测试文件） | `uv run --project apps/api pytest apps/api/tests --collect-only -q` 逐文件计数求和；**本次未跑整树** |
| 后端最近一次整树全绿（历史） | 952 passed / 0 failed | `P4-final-state.md` §1、`HANDOFF.md` §十一（2026-10-18 记录） |
| 迁移 | 10 个版本，单 head `b7c3e9a1d2f4` | `ls apps/api/migrations/versions/*.py` + `uv run alembic heads` |
| OpenAPI 路径 | **85** | `contracts/openapi.json` 解析（P5 新路由尚未导出，C1 合并点重导出） |

## 4. 服务端口与健康（常驻，**不要杀**）

23:44 实测（`lsof` LISTEN + curl）：

| 端口 | PID | 用途 | 实测 |
|---|---|---|---|
| 8000 | 19294 | 旧静态站/素材 | `GET /` → **200** |
| 8100 | 56146 | 共享 dev API（共享库 pl_test） | `GET /api/v1/posts` → **200** |
| 3100 | 76798 | 共享 `next start` 验证站 | `GET /` → **200**；`/admin/login` → **200** |
| 3120 | 80348（探测时被其他 worker 换过 pid） | 他人 `verify-isolated.sh` 隔离站残留/运行中 | `GET /` → **200**；**不是本任务起的，不要杀** |
| 55432 | 14164 | 共享 Postgres（pl_test） | `pg_isready` → **accepting connections** |
| 3130 | — | 隔离前端（e2e-stack） | 空闲 |
| 8130 | — | 隔离 API（e2e-stack） | 空闲 |
| 55434 | — | 隔离集群（e2e-stack） | 空闲 |
| 55435 / 55436 | — | C1 / C5 独立后端测试集群 | 空闲 |

**基线落差（P5 待实现，23:44 实测）**：

| 检查 | 结果 | 说明（对应任务） |
|---|---|---|
| `GET http://127.0.0.1:3100/admin` | **404** | `/admin` 创作台首页尚不存在（C2） |
| `GET http://127.0.0.1:8100/api/v1/auth/owner-status` | **404** | 无副作用站主探针尚未实现（C1/C2） |
| `apps/web/features/workspace/` | 23:41 时**不存在** | C2 共享模块（随后 23:43 起 C3/C4 文件开始出现） |
| `apps/web/features/media-picker/` | 23:41 时**不存在** | C3 共享图片选择器 |
| `apps/web/app/admin/page.tsx` | **不存在** | 创作台首页（C2） |
| `apps/api/app/modules/work_drafts/` | 仅 C0 骨架（`router.py` 空 `APIRouter`；models/schemas/service 占位） | C1 实现中（23:42 迁移文件已出现） |
| `contracts/openapi.json` | 85 路径，**不含** work-drafts / admin-media 新接口 | C1 合并点重导出 |
| `apps/web/lib/api/client.ts` | `ApiRequestOptions` **无 `headers` 字段** | C2 需按契约 §9.2 增加（X-CSRF-Token） |

## 5. 演示账号与登录方式

- **隔离栈（本任务验收主用，3130/8130/55434）**：
  - 账号：`owner` / `e2e-password-123`（`tools/e2e-stack.sh` 第 88–89 行 `bootstrap_admin --username owner --password-stdin`）。
  - 登录页：`http://127.0.0.1:3130/admin/login`；表单选择器 `input[name=username]`、`input[name=password]`、`button[type=submit]`。
  - 首页有 `#boot` 过场闸门：Playwright 需先 `page.keyboard.press("Enter")`（既有 e2e 脚本的 `boot()` 模式）。
- **共享 dev 环境（8100 的 pl_test，只读回归用）**：存在 `owner` 与 `demo-seeder` 两个管理员。
  e2e 脚本默认 `E2E_ADMIN_USER=demo-seeder` / `E2E_ADMIN_PASSWORD=demo-seeder-password-123`（可用环境变量覆盖）。
  （`P4-final-state.md` 曾写「demo-seeder 密码不写入仓库」，与实际脚本默认值不一致；以脚本/env 为准。）
- **登录限流**：每 IP 每分钟 **5 次**（`apps/api/app/modules/auth/ratelimit.py`，超限 429 + `Retry-After`）。
  e2e 设计为**每次运行只登录 1 次**；第二设备用第二上下文复制 cookie 或 API 直连，避免 429 误判。

## 6. 隔离栈用法（写型 e2e / 迁移专用）

```sh
bash tools/e2e-stack.sh up        # 独立集群 55434 + API 8130 + 前端 3130；首次约 3 分钟（含一次隔离构建）
bash tools/e2e-stack.sh status    # 集群/API/前端状态
bash tools/e2e-stack.sh down      # 只停本脚本起的进程与集群（不会碰 8000/8100/55432）
```

- `up` 会建库 `pl_e2e`、`alembic upgrade head`、`bootstrap_admin`、导入旧文章、种手记/殿堂、起隔离 API/前端。
- **每次 `up` 会重建/覆盖 `pl_e2e`**：迁移测试要放在 `up` 之后、`down` 之前；e2e 中途不要 `up`。
- 源码比隔离构建新时会自动重新构建（提示「源码比构建新，重新构建」），约 2 分钟；这是正常行为。
- 隔离栈数据只用于测试：写型 e2e 打 `http://127.0.0.1:3130`，**不写**共享 55432。
- 常驻 8000/8100/3100/55432 是验证前置，**任何清理动作都不得 kill 它们**（HANDOFF §八-6）。

## 7. 浏览器 / Playwright 环境

| 项 | 实测 |
|---|---|
| `python3` Playwright | 1.60（`sync_playwright` 可 import） |
| Chromium | 默认缓存 `~/Library/Caches/ms-playwright/chromium-1223`（headless 可启动，`GET 8100/api/v1/posts` 实测 200） |
| WebKit | 仓库 `.dsh/ms-playwright/webkit-2287`；跑 WebKit 需 `PLAYWRIGHT_BROWSERS_PATH=<Blogs>/.dsh/ms-playwright`（**不等于真机**） |
| 代理坑 | 必须 `no_proxy=127.0.0.1,localhost,::1`（系统代理会让 Python urllib 把本地请求送代理 → 502/超时，而 curl 正常） |
| 截图根 | `.dsh/screenshots/`（基线已有 201 个条目；P5 新截图放 `.dsh/screenshots/p5-workspace/` 与 `p5-*`） |
| 测试图片 | 由 e2e 脚本用标准库生成 800×600 PNG，不依赖外部资源/PIL |

## 8. 基线期已知环境坑（写进 C5b 的操作纪律）

1. **共享 `/tmp/vf-*.log` 会被并行 verify 覆盖**：本快照采集时（23:40–23:43）检测到另一路 worker 在写 `/tmp/vf-backend.log`、`/tmp/vf-browser.log`。C5 自己的日志一律用 `/tmp/p5-*`，证据落文档不落 `/tmp`。
2. **3120 隔离站是别人起的**：pid 在探测期间变化（65286 → 80348），说明有并行 verify-isolated 在跑；不要停它，也不要用它做写型测试。
3. **工作树在变**：C1–C4 落文件期间 `--fast` 通过只代表当时快照；最终结论必须重跑并记录 HEAD。
4. **不要 `npm run build`**：会覆盖共享 `.next`；构建证据等 C0 合并点或用 `e2e-stack.sh` 的隔离构建。
5. **e2e-stack 端口固定**：55434/8130/3130；后端独立测试集群用 55436（C5），不要占用 55435（C1 的）。
6. **dev 媒体根在 `/tmp` 下易失**（历史坑）：媒体 404 先查 `MEDIA_ROOT`。

### 8.1 e2e 骨架自测（C5a 产出，不是 P5 功能验收）

- `tools/e2e-p5-workspace.py`（新增，骨架 + 11 个场景函数 + 契约 §9.5 选择器清单）：
  - 骨架模式（`P5_E2E_READY` 未设）：打印场景/选择器清单，**退出码 0**（实测 23:47）；
  - `python3 -m py_compile` 通过；
  - 内建 PNG 生成器实测：800×600 RGB PNG，`file`/PIL 均可读（不依赖 PIL 于运行环境，仅用于自测）；
  - **未在隔离栈上真正运行**（C5a 不抢并行资源；C5b 执行）。
- 选择器落差检查（只读）：C2 的冲突提示实际属性是 `data-workspace-conflict*`（契约 §9.5 未定义），
  C3 的 `data-media-picker-upload` 已落在 `input[type=file]`；e2e 已按实际实现适配，其余缺口见
  `P5-acceptance-plan.md` §6。
- 快照后变化（23:47–23:50，**不算基线**）：C1 `GET /auth/owner-status` 代码已落地；
  C2 `features/workspace/` 与 `app/admin/page.tsx`、C3 `features/media-picker/` 开始出现；
  C3/C4 独立编辑页路由尚未出现。

## 9. 本次基线**未执行**的事（明确列出）

- 后端整树 pytest（`verify-backend-isolated.sh`）：并行期会产生「半新半旧」假失败（HANDOFF §二），留给 C5b。
- 前端 `npm run build`：覆盖共享 `.next`，只在合并点执行。
- `tools/e2e-stack.sh up` 与浏览器 e2e：会占用 55434/8130/3130 并重建隔离库，C5a 不与并行 worker 抢资源；脚本骨架已就绪（`tools/e2e-p5-workspace.py`），C5b 执行。
- 迁移 upgrade/downgrade/upgrade 与旧数据保留：C5b 在隔离库执行（计划见 `P5-acceptance-plan.md` B4）。
- 真机触控/软键盘/中文输入法：**无设备，只能未验证**（外部阻塞）。
