# P5 验收计划（站主创作台 · 第一批）

> 验收 owner：C5 ｜ 编写：2026-10-18（C5a，并行准备期）｜ 状态：**计划完成，条目均未验证**
> 依据：
> - 设计书 `docs/handoff/2026-10-18-p5-creator-workspace-design.md` §五（验收标准与交付要求）
> - 集成契约 `docs/agent-deliveries/P5-C0-integration-contract.md` §6（验收映射）、§7（命令与环境）、§9.5（data-* 选择器）
> - 验证体系与踩坑：`docs/agent-deliveries/HANDOFF.md`、`docs/agent-deliveries/P4-final-state.md`
>
> **本文件是计划，不是结论。C5b 执行结果见 `docs/acceptance/P5-acceptance-report.md`（2026-10-19）。** 任何条目在真实命令跑出证据之前都只能是「未验证」；
> 禁止把「单测覆盖了」「看代码像是对的」写成「通过」。

## 0. 状态图例与判定规则

| 状态 | 含义 | 允许的证据 |
|---|---|---|
| **未验证** | 还没在本次验收里真实执行，或执行被环境阻塞 | —（最终报告必须单列） |
| **通过** | 真实命令/浏览器执行成功，证据可复跑 | 命令 + 退出码 + 通过/失败数 + 截图路径（如适用） |
| **失败** | 真实执行失败，或与设计书/契约冲突 | 命令 + 失败输出/截图 + 疑似归属（C1–C4） |
| **不适用** | 本轮边界外（文章编辑器、完整媒体管理、生产部署、真机取证等） | 契约 §0 / 设计书 §一 的边界说明 |

判定规则：

1. 一条验收项可能由多条检查组成（后端 + 前端 + 浏览器）。**全部检查通过**才记「通过」；
   部分通过 → 记「失败」并在报告里写清哪一部分未过。
2. 环境受限无法执行（如无真机）→「未验证」，不得写「不适用」掩盖；
   「不适用」只用于契约明确排除的范围。
3. 浏览器 e2e 的时间/视口/引擎必须写进证据（引擎 ≠ 真机，WebKit 也不能替代真机）。
4. 失败先发消息给 Lead + 对应 owner（C1/C2/C3/C4），**C5 不修 apps/** 源码**；
   修复后复跑同一命令，不允许「部分还原」或手工绕过。
5. 写入型 e2e 只允许打隔离栈（55434/8130/3130）；共享 8000/8100/3100/55432 只读。
6. 最终报告中，「未验证」项必须单独成节（真机触控/软键盘/中文输入法只能在此节）。

## 1. 验收环境与前置

### 1.1 固定环境变量（每条命令前）

```sh
export no_proxy=127.0.0.1,localhost,::1 NO_PROXY=127.0.0.1,localhost,::1
export LC_ALL=C
export UV_CACHE_DIR=/Users/学习/blog/Blogs/.dsh/uv-cache
export npm_config_cache=/Users/学习/blog/Blogs/.dsh/npm-cache
```

### 1.2 常驻服务（**只读，不许杀**）

| 端口 | 用途 | 验收用法 |
|---|---|---|
| 8000 | 旧静态站/素材 | 只排障时 curl |
| 8100 | 共享 dev API（pl_test 共享库） | **不写**；仅 Baseline/回归读取 |
| 3100 | 共享 `next start` 验证站 | 只读回归（现有 P4 脚本）；**本轮写型 e2e 不用它** |
| 55432 | 共享 Postgres（pl_test） | 只读；禁止破坏性迁移 |

### 1.3 隔离栈（所有写型 e2e / 迁移测试用）

```sh
bash tools/e2e-stack.sh up        # 集群 55434 + API 8130 + 前端 3130；每次 up 重建数据库
bash tools/e2e-stack.sh status
bash tools/e2e-stack.sh down      # 只停自己起的进程/集群
```

- 站主账号：`owner` / `e2e-password-123`（`e2e-stack.sh` 内 `bootstrap_admin` 创建）。
- 登录入口：`http://127.0.0.1:3130/admin/login`（前端 `input[name=username]` / `input[name=password]`）。
- **登录限流：每 IP 每分钟 5 次**（`LOGIN_RATE_LIMIT_PER_MINUTE`，超限 429 + Retry-After）。
  e2e 每次运行最多 1 次真实登录；第二个设备/上下文复用 cookie（`context.add_cookies`）或 API 直连。
- 隔离栈 `up` 会按源码新旧自动重建前端（约 2 分钟）；源码比构建新时属正常现象。
- 写型 e2e 的测试数据（动态/手记/媒体）只落在 `pl_e2e`，不污染站主真实内容。

### 1.4 浏览器与 Playwright

- `python3` + Playwright 1.60；Chromium 在默认缓存（`~/Library/Caches/ms-playwright/chromium-1223`）。
- WebKit 在仓库 `.dsh/ms-playwright/webkit-2287`：跑 WebKit 时 `PLAYWRIGHT_BROWSERS_PATH=.dsh/ms-playwright`
  （或 `E2E_ENGINE=webkit`，新脚本内已处理）。
- 截图统一落 `.dsh/screenshots/p5-workspace/`（e2e）、`.dsh/screenshots/p5-*`（迁移/构建证据）。
- 测试图片由脚本生成（800×600 PNG），不依赖外部资源。

### 1.5 后端 / 前端命令

```sh
# 后端全树（独立集群，端口自选未占用：C5 用 55436）
bash tools/verify-backend-isolated.sh 55436

# 后端单域（C1 新测试）
cd apps/api
TEST_DATABASE_URL=postgresql+psycopg://pl@127.0.0.1:55436/pl_test \
DATABASE_URL=$TEST_DATABASE_URL SECRET_KEY=dev-secret-0123456789abcdefghijklmnop \
  uv run pytest tests/work_drafts tests/media -x -q

# 前端（只跑本轮域，不整树）
cd apps/web && npx vitest run features/workspace features/media-picker features/ins features/journal features/leisure

# 前端静态门
cd apps/web && npm run typecheck && npm run lint && npm run test -- --run

# 隔离构建 + 浏览器 T02/取数审计（不抢共享 .next）
bash tools/verify-isolated.sh 3120
```

> ⚠️ 并行期约定（契约 §9.8-4）：不要在 C1–C4 还在写文件时跑整树 `verify-all`/`next build`；
> C5b 在 Lead 宣布「集成完成」后统一跑。`npm run build` 会覆盖共享 `.next`，只在合并点由 C0/C5 协调执行。

## 2. 验收执行顺序（C5b）

| 阶段 | 内容 | 预估 |
|---|---|---|
| P0 | 确认 HEAD / `git status`，确认无其他 worker 正在写；起隔离栈 `up`（含迁移 head） | ~4 min |
| P1 | 后端全树 `verify-backend-isolated.sh 55436` + C1 单域；前端 typecheck/lint/test --run | ~6 min |
| P2 | 浏览器 e2e：`P5_E2E_READY=1 python3 tools/e2e-p5-workspace.py http://127.0.0.1:3130`（桌面 Chromium） | ~6–10 min |
| P3 | 移动视口（320/390）+ WebKit 冒烟（`E2E_ENGINE=webkit`） | ~3 min |
| P4 | 迁移 B4（隔离栈 55434 的 `pl_e2e` dump → `pl_mig` round-trip + 旧数据保留断言） | ~4 min |
| P5 | gen:api / openapi 漂移检查 + 既有回归（A10）+ 隔离构建 | ~6 min |
| P6 | 汇总证据 → `docs/acceptance/P5-acceptance-report.md`；失败项发消息 | ~20 min |

执行后必做：`bash tools/e2e-stack.sh down`；确认 8000/8100/3100/55432 仍在。

## 3. A 类验收项（功能与数据，A1–A12）

### 3.1 汇总表

| # | 验收项（设计书 §五 / 契约 §6） | 检查方式 | owner | 当前状态 |
|---|---|---|---|---|
| A1 | 访客看不到管理入口；直接请求管理接口无法越权 | 后端 pytest + 浏览器 e2e + 前端单测 | C1/C2/C3/C4 → C5 | 未验证 |
| A2 | 前台进入编辑再返回：来源页/筛选/手机上下文恢复 | 浏览器 e2e + 前端单测 | C3/C4 → C5 | 未验证 |
| A3 | INS 多图上传/排序/替代文本/相册收录；新建相册往返不丢草稿 | 浏览器 e2e + 前端单测 | C3 → C5 | 未验证 |
| A4 | 手记无需媒体 ID；普通保存不会意外公开 | 浏览器 e2e + 前端单测 + 后端语义测试 | C4/C1 → C5 | 未验证 |
| A5 | 编辑公开内容时自动保存不改匿名视图；明确提交才更新 | 后端 pytest + 浏览器 e2e | C1/C2/C3/C4 → C5 | 未验证 |
| A6 | 跨设备恢复已同步草稿；版本冲突不静默覆盖 | 后端 412 测试 + 前端乱序/冲突单测 + e2e 双上下文/API | C1/C2 → C5 | 未验证 |
| A7 | 断网/刷新/登录失效/上传失败有准确反馈与恢复 | 前端单测 + e2e（offline / 上传失败） | C2/C3/C4 → C5 | 未验证 |
| A8 | 重复提交不生成重复内容/收录关系；失败不产生半完成关系 | 后端幂等/回滚 pytest + e2e API 级 | C1 → C5 | 未验证 |
| A9 | 私密草稿图片不能匿名访问；丢弃草稿不破坏其他引用 | 后端 pytest + e2e API 级 | C1 → C5 | 未验证 |
| A10 | 动态撤回/重发/相册移除/多来源引用无回归 | 后端整树 + 既有验收脚本回归 + 旧管理流程 e2e | C1 → C5 | 未验证 |
| A11 | 媒体/相册分页正常；选中对象不在当前页不误判失效 | 前端分页单测 + 浏览器 e2e | C3 → C5 | 未验证 |
| A12 | 追番/游戏更新失败不显示虚假成功 | 前端单测 + 浏览器 e2e | C4 → C5 | 未验证 |

### 3.2 逐条检查

#### A1 · 访客看不到管理入口；管理接口无法越权

- **检查方式**：后端 pytest（鉴权）+ 浏览器 e2e（匿名上下文）+ 前端单测（`useOwnerSession` 条件渲染）+ 人工代码抽查（只读）。
- **命令 / 工具**：
  - `cd apps/api && ... uv run pytest tests/auth tests/work_drafts tests/media -x -q`
  - `P5_E2E_READY=1 python3 tools/e2e-p5-workspace.py http://127.0.0.1:3130` → 场景 `workspace-home`、`front-entries-return` 的匿名断言
  - `cd apps/web && npx vitest run features/workspace features/ins features/journal features/leisure`
- **通过标准**：
  - 匿名访问 `/admin`、`/admin/moments/new`、`/admin/journal/new`、`/admin/leisure` 不渲染 `[data-workspace-home]`/`[data-editor]` 或给出登录入口；
  - 前台 `/apps/ins`、`/apps/journal`、`/apps/leisure`、`/apps/leblanc` 匿名页**存在 0 个** `[data-owner-entry]`（隐藏入口不是授权）；
  - 匿名请求 `POST/GET/PATCH/DELETE /api/v1/admin/work-drafts*`、`GET /api/v1/admin/media*` 全部 401；
  - 写请求缺 CSRF/Origin → 403/422（沿用现有机制，不得放宽）；
  - 前端单测覆盖「匿名时 `useOwnerSession` 不渲染入口、不读取本机草稿」。
- **当前状态**：未验证。

#### A2 · 从前台进入编辑再返回，来源页/筛选/手机上下文恢复

- **检查方式**：浏览器 e2e（4 个入口 + 手机浮层 + 非法 returnTo）+ 前端单测（`safeInternalPath`/`withReturnTo`/`readReturnTo`）。
- **命令 / 工具**：`P5_E2E_READY=1 python3 tools/e2e-p5-workspace.py` → 场景 `front-entries-return`；`cd apps/web && npx vitest run features/workspace`。
- **通过标准**：
  - INS 列表 `data-owner-entry="ins-new"`、INS 详情 `ins-edit`、手记列表/日历 `journal-new`（日历选中日再带 `date=`）、手记正文 `journal-edit`、放课后 `leisure-quick`、勒布朗总览 `leblanc-start-moment/journal/leisure` 均可点击且进入对应编辑页；
  - 进入后点「返回」（`[data-editor-return]`）或取消/成功返回，URL **完全恢复**来源 path+query（含 `tag=`、日历 `date`、`phone/screen/item` 三元组）；
  - 带 `?phone=ins&screen=feed` 进入编辑时：跳转后 URL **无** `phone=`，`.pw-wrap` 不可见（编辑器不被浮层遮挡）；返回后 `phone/screen` 恢复且手机浮层重新打开；
  - `returnTo=https://evil.example/...`、`//evil`、反斜杠、控制字符 → 一律回 `/admin`；
  - `/admin/login?returnTo=...` 登录成功回来源页（合法），非法回 `/admin`。
- **当前状态**：未验证。

#### A3 · INS 多图上传/排序/替代文本/相册收录；新建相册往返不丢草稿

- **检查方式**：浏览器 e2e（选图优先、上传、排序、alt、草稿、发布、相册往返）+ 前端 vitest（选择器分页/顺序/alt/超限/公开提示；编辑器阻塞原因/失败保留）+ 既有相册回归脚本。
- **命令 / 工具**：
  - `P5_E2E_READY=1 python3 tools/e2e-p5-workspace.py` → `ins-editor-autosave`、`media-picker-pagination`、`album-roundtrip`（如实现）；
  - `cd apps/web && npx vitest run features/media-picker features/ins`
  - 旧流程回归：`E2E_ADMIN_USER=owner E2E_ADMIN_PASSWORD=e2e-password-123 E2E_SHOTS_DIR=.dsh/screenshots/p5-e2e python3 tools/e2e-ins-album-links-ui.py http://127.0.0.1:3130`
- **通过标准**：
  - `/admin/moments/new` 首屏即可选图/上传（不先建正式动态）；可多选、移除、调整顺序（顺序=数组顺序）、逐图 alt；
  - 未选图可写文字并保存工作草稿；发布前缺图时 `[data-editor-blockers]` 集中列出阻塞原因；
  - 上传失败（伪造非图片文件/超限）保留已选与文字，不显示成功；
  - 相册收录复用 `[data-album-picker]`；进入新建相册前 `saveNow()`，返回后文字/图片顺序/alt/收录选择全部恢复；
  - 发布成功后提供「查看动态」「再发一条」；`/apps/ins` 与公开 API 能读到新动态；
  - 草稿保存**从不**调用 `/api/v1/admin/moments` 正式更新接口（后端测试 + 网络请求抽查：浏览器 route 记录写请求 path）。
- **当前状态**：未验证。

#### A4 · 手记无需媒体 ID；普通保存不会意外公开

- **检查方式**：浏览器 e2e + 前端 vitest + 后端 pytest（commit `save` 语义）。
- **命令 / 工具**：`P5_E2E_READY=1 python3 tools/e2e-p5-workspace.py` → `journal-private-public`；`cd apps/web && npx vitest run features/journal`；后端 `pytest tests/work_drafts -k "journal and save" -q`。
- **通过标准**：
  - 手记编辑页图片入口是共享选择器，「媒体 ID」输入框不存在（页面文本/控件断言）；
  - 新手记默认 `draft + private`（管理 API 详情 `status=draft`、`visibility=private`）；
  - 点「保存」（save）后公开 `GET /api/v1/journal/entries`、日历、正文均**读不到**；
  - 自动保存/手动保存都不改变公开状态；公开必须走独立的明确动作（`publish`），成功后公开列表可见；
  - 后端 commit `save` 后正式行状态断言（C1 测试覆盖）。
- **当前状态**：未验证。

#### A5 · 编辑公开内容时自动保存不改匿名视图；明确提交才更新

- **检查方式**：后端 pytest + 浏览器 e2e（公开内容工作副本）。
- **命令 / 工具**：`pytest tests/work_drafts -q`（自动保存只写 work_drafts、正式内容 version/updated_at 不变）；e2e 场景 `ins-editor-autosave`（编辑已发布动态）、`journal-private-public`（编辑已公开手记）。
- **通过标准**：
  - 打开已发布动态/手记 → 创建或复用工作草稿；输入并等自动保存 `synced` 后，匿名 `GET /api/v1/moments/{id}` / `GET /api/v1/journal/entries/{id}` 内容与 version **不变**；
  - 明确提交（`update`）后匿名内容才变化，且版本 +1；
  - 手记公开编辑期间访客始终看到原版本（旧正文），不是半成品。
- **当前状态**：未验证。

#### A6 · 跨设备恢复已同步草稿；版本冲突不静默覆盖

- **检查方式**：后端 pytest（PATCH 并发 412、幂等回放优先）+ 前端 vitest（乱序丢弃、冲突状态机）+ 浏览器 e2e（第二上下文 / API 直连模拟第二设备）。
- **命令 / 工具**：`pytest tests/work_drafts -k "conflict or version or concurrent" -q`；`npx vitest run features/workspace`；e2e 场景 `draft-recovery-conflict`。
- **通过标准**：
  - 设备 A 自动保存 `synced` 后，设备 B（第二上下文或 API 直连）能看到草稿并在编辑器/创作台「继续编辑」打开，内容一致；`synced` 前的文案不得声称可跨设备；
  - 设备 B 先 PATCH 把 `draft_version` +1 → 设备 A 旧版本自动保存收到 412 → 状态为 `data-sync-state="conflict"`，`ConflictNotice` 出现，本地输入保留、**服务端草稿未被静默覆盖**（GET 校验仍是 B 的内容）；
  - 「放弃本机修改，载入最新版本」用服务器最新内容替换本地；「另存为新草稿」产生新草稿且原草稿不变；
  - 并发两个 PATCH：后到者 412（后端测试）；`If-Match` 缺失 428。
- **当前状态**：未验证。

#### A7 · 断网/刷新/登录失效/上传失败有准确反馈与恢复

- **检查方式**：前端 vitest（mock 网络失败/401/上传失败）+ 浏览器 e2e（`context.set_offline`、上传伪造文件、清 cookie 模拟 401）。
- **命令 / 工具**：`npx vitest run features/workspace features/ins features/journal features/leisure`；e2e 场景 `offline-upload-failure`（离线 → `failed` + 本机内容保留；恢复网络 → 先读版本再保存；刷新/继续编辑恢复已同步文字与图片关系）。
- **通过标准**：
  - 断网：本机恢复副本保留输入，界面显示 `failed`（含重试），无假「已同步」；恢复连接后不直接覆盖服务端（先取版本）；
  - 刷新：已同步的文字与已上传图片关系可恢复（至少经 `/admin` 继续编辑路径，见 §6 待澄清 G1）；
  - 登录失效（401）：停止自动保存，显示「登录已失效，本机输入已保留」+ 去登录链接（带 returnTo）；
  - 上传失败：保留已选/已填，明确失败原因，不出现成功态；
  - 待上传的本地文件刷新后如无法恢复，明确提示重新选择（不得假装恢复）。
- **当前状态**：未验证。

#### A8 · 重复提交不生成重复内容/收录关系；失败不产生半完成关系

- **检查方式**：后端 pytest（幂等/回滚）+ e2e API 级（`publish-idempotency`）。
- **命令 / 工具**：`pytest tests/work_drafts -k "idempot or commit or rollback" -q`；e2e 场景 `publish-idempotency`。
- **通过标准**：
  - 同一 `commit_key` 重复 commit：200 + `idempotent_replay:true`，`target_id` 相同，正式内容只有 1 条，相册来源关系不重复；
  - 不同 key 二次提交已 committed 草稿 → 409；
  - 相同 key 被其他草稿使用 → 409；
  - 发布校验失败（如 0 张 ready 图）→ 422，草稿仍 active、正式内容与相册来源不变（回滚）；
  - 事务原子性：模拟第三步失败 → 正式行/媒体关系/相册来源全部回滚（后端测试）。
- **当前状态**：未验证。

#### A9 · 私密草稿图片不能匿名访问；丢弃草稿不破坏其他引用

- **检查方式**：后端 pytest + e2e API 级（`media-privacy-discard`）。
- **命令 / 工具**：`pytest tests/work_drafts tests/media -k "public or anonymous or discard" -q`；e2e 场景 `media-privacy-discard`。
- **通过标准**：
  - 工作草稿保留的媒体（未公开引用）匿名 `GET /api/v1/media/{id}/original|w320.webp` → 404；
  - 草稿关系**不登记**公开引用检查器（不改变既有公开范围）；
  - DELETE 草稿 → 204；`work_draft_media` 行删除；media 文件/记录保留（管理端详情仍 200）；其他公开引用不受影响；
  - 同一媒体被公开动态引用时匿名可读；撤回该公开引用后匿名重新 404（多来源规则不回归，与 A10 联动）。
- **当前状态**：未验证。

#### A10 · 动态撤回/重发、相册移除、多来源引用规则无回归

- **检查方式**：后端整树回归 + 既有业务流脚本 + 旧管理端 UI 流程 e2e。
- **命令 / 工具**：
  - `bash tools/verify-backend-isolated.sh 55436`（`tests/moments`、`tests/gallery`、`tests/media` 必须全绿）；
  - `cd apps/api && uv run python ../../tools/acceptance/verify-ins-media-loop.py` 等 4 个业务流脚本（按 verify-all 段 6 的方式，使用 55432 共享测试库，只读/自建测试数据）；
  - `E2E_ADMIN_USER=owner E2E_ADMIN_PASSWORD=e2e-password-123 python3 tools/e2e-ins-album-links-ui.py http://127.0.0.1:3130`（旧 `/admin/moments`、`/admin/albums` 流程仍可用）；
  - 对比基线：基线后端 952 用例（见 `P5-baseline-evidence.md`），本次不得出现「原有通过项变失败」。
- **通过标准**：上述全部通过；既有公开接口响应结构/语义不变（`tests/test_openapi_contract.py` 通过）；旧管理页没有被新路由破坏（`/admin/moments`、`/admin/moments/[id]`、`/admin/journal` 仍可用）。
- **当前状态**：未验证。

#### A11 · 媒体/相册分页正常；选中对象不在当前页不误判失效

- **检查方式**：前端 vitest（分页/列表外已选）+ 浏览器 e2e（选择器翻页后已选保留）。
- **命令 / 工具**：`npx vitest run features/media-picker`；e2e 场景 `media-picker-pagination`。
- **通过标准**：
  - `GET /api/v1/admin/media` 分页 `{items,next_cursor}` 正常；cursor 翻页不重复/不丢；
  - 选择器翻到下一页后，已选对象仍显示已选、确认后顺序与 alt 不丢；
  - 已选对象不在当前页时用详情接口确认存在（不是靠当前页数据），404 才算失效；
  - 相册列表分页（既有 `AlbumLinksEditor` cursor 全量分页 + 列表外详情补取）不回归。
- **当前状态**：未验证。

#### A12 · 追番/游戏更新失败不显示虚假成功

- **检查方式**：前端 vitest（`quick-update.test.tsx`）+ 浏览器 e2e（拦截写请求失败）。
- **命令 / 工具**：`npx vitest run features/leisure`；e2e 场景 `leisure-quick`。
- **通过标准**：
  - 明确「提交更新」按钮（非输入即改）；提交中禁用（双击只发一次请求）；
  - 拦截 PATCH 返回 500/断网时：`[data-leisure-quick-error]` 出现、输入保留、`[data-leisure-quick-success]` 不出现；
  - 成功后显示真实结果（版本/新值），API GET 能读到新值；
  - 总集数未知 → `data-leisure-quick-ratio="none"`，快捷区无「N%」；
  - 快捷更新不改 `completed_on`/`all_achievements`（互不推断，API 校验）。
- **当前状态**：未验证。

## 4. B 类验收项（设备与质量，B1–B5）

### 4.1 汇总表

| # | 验收项 | 检查方式 | owner | 当前状态 |
|---|---|---|---|---|
| B1 | 桌面键盘操作；320px / 390px 小屏布局 | 浏览器多视口脚本 + 既有视口审计回归 | C3/C4 → C5 | 未验证 |
| B2 | 真实触控、软键盘、中文输入法 | **无真机**：只做 WebKit 引擎 + 视口证据 | — | 未验证（外部阻塞） |
| B3 | 相关前后端测试、类型检查、lint、构建 | 命令门（verify-all --fast/--e2e + 前端静态门 + 隔离构建） | 全体/C0 | 未验证 |
| B4 | 隔离库迁移/旧数据保留/回退 | 隔离集群迁移 round-trip + 行数断言 + 截图/SQL 输出 | C1 → C5 | 未验证 |
| B5 | 端到端写测试用独立数据 | 隔离栈 55434/8130/3130 + 测试数据标记 + 共享库只读抽查 | C5 | 未验证 |

### 4.2 逐条检查

#### B1 · 桌面键盘 + 320/390 小屏布局

- **检查方式**：浏览器 e2e 多视口（Chromium 320×720 / 390×844；桌面 1440×900 键盘操作）+ 既有 `tools/acceptance/verify-viewports.py` 回归。
- **命令 / 工具**：e2e 场景 `mobile-viewports`；`python3 tools/acceptance/verify-viewports.py http://127.0.0.1:3130`；桌面键盘：Tab 焦点顺序、Enter 提交、Escape 关闭选择器（在 e2e/人工里记录）。
- **通过标准**：
  - 创作台/INS/手记编辑器在 320/390 下无横向溢出（`documentElement.scrollWidth <= innerWidth`）；
  - ≤620px 编辑器为固定全视口单列（`position:fixed; inset:0; 100dvh`），保存/发布/返回在可视区内且触控目标 ≥44×44px（DOM 量测，不是目测）；
  - 桌面键盘可完成「输入 → 保存 → 发布」主线（Tab 可达、焦点可见、Enter 不误提交）；
  - 既有视口审计 11 项不回归。
- **当前状态**：未验证。

#### B2 · 真实触控/软键盘/中文输入法（**只能未验证**）

- **检查方式**：无真机。只做**部分证据**：WebKit 引擎（`E2E_ENGINE=webkit python3 tools/e2e-p5-workspace.py` + `python3 tools/e2e-webkit-mobile-smoke.py`）。
- **通过标准**（部分证据）：WebKit 下编辑器可打开/输入/保存，布局与 Chromium 视口一致；**明确标注「WebKit ≠ 真机」**。
- **当前状态**：**未验证（外部阻塞：无设备）**。最终报告单列：真实触控精度、软键盘弹出后光标/按钮可见性、中文输入法组合过程、真机 iOS Safari/Android Chrome 行为，均为未验证；模拟视口不能作为通过证据。

#### B3 · 前后端测试、类型检查、lint、构建

- **检查方式**：命令门（在 Lead 宣布集成完成后执行；并行期只跑 --fast 基线）。
- **命令 / 工具**：
  - `bash tools/verify-all.sh --fast`（并行期基线，见 `P5-baseline-evidence.md`）
  - 集成后：前端 `npm run typecheck && npm run lint && npm run test -- --run`；后端 `bash tools/verify-backend-isolated.sh 55436`；隔离构建 `bash tools/verify-isolated.sh 3120`
  - `npm run build`：**只由 C0/合并点执行**（会覆盖共享 `.next`）；如 C5 需要构建证据，用 `e2e-stack.sh up` 的隔离构建产物
  - 漂移检查（只读）：见 §5.2
- **通过标准**：各段 PASS，退出码 0；记录真实通过/失败数（前端/后端）；构建成功且无新增 warning 阻断；`gen:api` 无漂移。
- **当前状态**：未验证（仅并行期 --fast 基线通过，不等价于集成后整树）。

#### B4 · 隔离库验证迁移/旧数据保留/回退

- **检查方式**：隔离集群 55434 内独立库 round-trip + 行数断言（禁止碰 55432）。
- **命令 / 工具**（在 `e2e-stack.sh up` 之后；库名示例）：
  ```sh
  PG_BIN=/opt/homebrew/opt/postgresql@18/bin
  $PG_BIN/createdb -h 127.0.0.1 -p 55434 -U pl pl_mig
  $PG_BIN/pg_dump -h 127.0.0.1 -p 55434 -U pl pl_e2e | $PG_BIN/psql -h 127.0.0.1 -p 55434 -U pl -d pl_mig -q
  # baseline：记录 moments/journal_entries/media/gallery_sources/admin_users 行数 → /tmp/p5-migration-baseline.txt
  cd apps/api
  DATABASE_URL=postgresql+psycopg://pl@127.0.0.1:55434/pl_mig SECRET_KEY=... uv run alembic downgrade b7c3e9a1d2f4   # P5 迁移之前
  # 断言：旧表行数不变；work_drafts/work_draft_media 不存在
  DATABASE_URL=... uv run alembic upgrade head
  # 断言：旧表行数仍不变；work_drafts/work_draft_media 存在且为空
  ```
- **通过标准**：upgrade（空库）→ 成功；downgrade → upgrade round-trip 成功；旧表行数前后一致（无数据丢失/公开范围/相册来源变化）；`tests/test_migration_sync.py` 通过；证据（SQL 输出/截图）落 `.dsh/screenshots/p5-migration/` 或日志。
- **当前状态**：未验证。

#### B5 · 端到端写测试使用独立数据

- **检查方式**：隔离栈起停 + 数据来源核对 + 共享库只读抽查。
- **命令 / 工具**：
  - `bash tools/e2e-stack.sh up` → 所有写型 e2e 打 `http://127.0.0.1:3130`；
  - 只读抽查共享库：`$PG_BIN/psql -h 127.0.0.1 -p 55432 -U pl -d pl_test -tAc "select count(*) ..."`（只读）；
  - 测试数据命名带 `p5-e2e-<stamp>` 前缀，便于识别；
- **通过标准**：本次 e2e 的写请求只发往 3130/8130；共享 55432 无新增 P5 测试数据（抽查前后行数一致或人工确认）；隔离栈 `down` 后残留进程/端口已清理；8000/8100/3100/55432 仍在运行。
- **当前状态**：未验证。

## 5. 证据与报告

### 5.1 证据命名约定

| 证据 | 路径 |
|---|---|
| e2e 截图 | `.dsh/screenshots/p5-workspace/<场景>-<序号>-<名称>.png`（自动） |
| 移动/WebKit 截图 | 同上 + 场景 `mobile-viewports` / `webkit-smoke` |
| 迁移与库断言 | `/tmp/p5-migration-*.log` 摘要写入报告；关键 SQL 输出可截图 `.dsh/screenshots/p5-migration/` |
| 命令日志 | `/tmp/p5-<阶段>-*.log`（**不要**复用 `/tmp/vf-*.log`：并行时会被其他 worker 覆盖） |
| 验收报告 | `docs/acceptance/P5-acceptance-report.md`（C5b 产出，A1–A12/B1–B5 逐条状态 + 未验证单列 + 声明句） |

### 5.2 契约/生成文件漂移检查（只读，不写 C1 的文件）

```sh
# 1) Backend 契约漂移：在内存里生成 OpenAPI，与已入库文件比较（不落盘）
cd /Users/学习/blog/Blogs/apps/api && uv run python - <<'PY'
import pathlib, sys
sys.path.insert(0, "scripts")
from export_openapi import serialized_schema
expected = pathlib.Path("../../contracts/openapi.json").read_text(encoding="utf-8")
print("OPENAPI-OK" if serialized_schema() == expected else "OPENAPI-DRIFT")
PY

# 2) 前端生成类型漂移：把生成脚本复制到 /tmp 运行后 diff（不写 apps/web）
rm -rf /tmp/p5-gencheck && mkdir -p /tmp/p5-gencheck/scripts /tmp/p5-gencheck/lib/api/generated /tmp/contracts
cp apps/web/scripts/gen-api-types.mjs /tmp/p5-gencheck/scripts/
ln -s /Users/学习/blog/Blogs/apps/web/node_modules /tmp/p5-gencheck/node_modules
cp contracts/openapi.json /tmp/contracts/openapi.json
(cd /tmp/p5-gencheck && node scripts/gen-api-types.mjs >/dev/null) && \
  diff -q /tmp/p5-gencheck/lib/api/generated/schema.ts apps/web/lib/api/generated/schema.ts \
  && echo GEN-OK || echo GEN-DRIFT
```

通过标准：两项均为 OK/无差异。漂移 → 失败，消息给 C1/C0（生成文件属 C1 写作用域，C5 不改）。

### 5.3 最终报告必须回答

1. A1–A12 / B1–B5 逐条：通过 / 失败 / 未验证（+ 证据命令、截图路径、真实通过失败数）；
2. **未验证项单独成节**（真机触控/软键盘/中文输入法/移动 Safari 必然在此）；
3. 失败项的归属（C1/C2/C3/C4）与复跑命令；
4. 环境事实：HEAD、隔离栈 up/down、共享服务未被影响；
5. 声明句：**本次完成的是第一批「站主日常创作体验」；文章编辑器与完整媒体管理属于后续阶段，不计入本次完成声明。**

## 6. 只读落差检查：待澄清 / 选择器缺口（C5a 发现，已消息 Lead）

> 这些不是「失败」，是**当前契约不足以保证可测**的点。C5 不改源码与契约，等 C0/owner 定稿后按最终实现固化选择器。

| # | 问题 | 影响 | 建议 | C5a 末状态（23:50） |
|---|---|---|---|---|
| G1 | **新内容草稿刷新恢复的 key 语义不明**：契约 §4.2-3 的本机 key 用「`targetId ?? 入口时间戳`」，每次打开新内容是新 id；刷新后 `/admin/moments/new` 没有 targetId，如何找回本机副本？（设计书 §3.2 要求刷新后恢复已保存文字与图片关系） | A7「刷新恢复」在 e2e 中无法判定按哪条路径断言 | C2 已实现 `useWorkDraft({ entryId })` 扩展（入口 id 由页面固化后传入，刷新可复用）；需 ① 契约 §4.2 的 options 补 `entryId`；② C3/C4 编辑器把新内容入口 id 固化到 sessionStorage/URL 并传入 | **部分解决**：e2e 已按「服务端草稿路径」断言，同标签页直恢复记为 info |
| G2 | **编辑输入控件缺 data-* 选择器**：契约 §9.5 只给了动作/阻塞/成功等，没有正文/标题/日期/可见性字段 | e2e 只能靠 `[data-editor] textarea` 等结构选择器，C3/C4 不同实现会互相打爆 | 增加：`data-editor-field="text|title|content|date|mood|location"`、`data-editor-visibility="private|public|draft|published"` | **待落地**（C3/C4 编辑器尚未接线） |
| G3 | **冲突提示按钮缺 data-***：`ConflictNotice` 的「另存为新草稿」「放弃本机修改，载入最新版本」没有稳定选择器 | A6 冲突恢复动作无法稳定自动化 | 契约 §9.5 补实际属性名 | **已解决**：C2 实现为 `data-workspace-conflict` / `data-workspace-conflict-reload` / `data-workspace-conflict-save-as-new`；e2e 已适配（建议 C0 补进契约） |
| G4 | **上传文件输入框缺 data-***：`data-media-picker-upload` 是按钮还是 input 未定义；`set_input_files` 需要真实 `input[type=file]` | A3/A7 上传路径依赖结构选择器 | 明确落在 `<input type=file>` 上 | **已解决**：C3 的 `data-media-picker-upload` 就在 `<input type=file multiple>` 上；e2e 已适配 |
| G5 | **相册收录/新建相册选择器未进契约**：旧实现有 `[data-album-picker]`（P4 e2e 在用），新编辑器需保持同一约定 | A3 相册往返 e2e 易断 | 在契约 §9.5 补：`data-album-links`、`data-album-new`（或声明复用既有 `data-album-picker`/「新建相册」按钮文案） | **待落地**（C3 编辑器） |
| G6 | **手记「保存」与「公开」的按钮可区分性**：`data-editor-save` / `data-editor-publish` / `data-editor-submit-action` 三者语义需明确（提交动作 save/publish/update） | A4/A5 判定「保存 ≠ 公开」依赖按钮语义 | 契约补一句：`data-editor-submit-action` 的值 = 本次将执行的 action（`save|publish|update`） | **待落地**（C3/C4） |
| G7 | **媒体列表分页参数**：契约 §3.4 只写 `cursor=&limit=&status=&q=`，未写默认/最大 limit（旧接口曾因 limit>30 被 422） | A11 断言分页行为时不知道合法边界 | §3.4 注明默认/最大 limit（或声明复用现有全局 MAX_LIMIT=30） | **待 C1 交付后核对** |
| G8 | **「媒体 ID 不再输入」在契约里没有可断言 UI 约定**：A4 的检查依赖「不存在媒体 ID 输入框」 | e2e 用文本断言较脆 | C4 交付说明里确认新编辑页无媒体 ID 输入；e2e 用 `[data-editor-field=images]` 结构断言替代文本断言 | **待落地**（C4） |
| G9 | **`/admin/journal/new?date=` 的 date 与 returnTo 同时存在时的参数拼接**：契约 §9.5 说「若 returnTo 已有查询串则作为独立参数」，未说明 `date` 与 `returnTo` 的先后/编码细节 | A2 日历入口断言需知道预期 URL | 契约补一个示例 URL | **待落地**（C4） |
| G10 | **`data-owner-entry` 在手机宿主内入口的可见性**：前台手机 App 内的入口若在浮层内，`page.locator` 可见性判定与桌面不同 | A2 手机上下文断言 | C3/C4 交付说明标注入口在桌面/手机宿主中的位置；e2e 先关闭 `#boot` 再判定 | **待落地**（C3/C4） |

> 以上由 C5a 在 23:40–23:50 的只读检查发现并已消息 Lead（含已解决项的实际属性名）。契约修订由 C0 负责，C5 不改契约/源码；e2e 脚本已按「当前实现 + 契约」双回退写选择器。

## 7. 风险与并行期约束

1. **并行 worker 会改树**：C1–C4 落文件期间 `verify-all --fast` 通过只代表当时快照；最终验收必须等 Lead 宣布集成完成、工作树稳定后重跑（并把 HEAD/时间写进报告）。
2. **共享 `/tmp/vf-*.log` 会被其他 worker 覆盖**（本会话实测：23:42 有另一路 verify 在写）→ C5 自己的日志一律用 `/tmp/p5-*`。
3. **登录限流 5/min**：e2e 脚本每次运行只 1 次登录；重复调试时等待或复用会话，避免 429 误判。
4. **构建/环境**：`npm run build` 会覆盖共享 `.next`，只在合并点执行；e2e 用 `e2e-stack.sh up` 的隔离构建。
5. **隔离栈 up 会重建数据库**：迁移测试要在 `up` 之后、`down` 之前做；不要在 e2e 跑一半时重建。
6. **真实设备缺失**是外部阻塞，不允许用「WebKit 通过」替代「真机通过」。
