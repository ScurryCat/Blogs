# P5 返工复验报告（R1 / R2 / R3 / D1 / 真机）

> 日期：2026-10-19（Asia/Shanghai）｜ 分支 `main`（只本地提交、未推送）
> 返工依据：独立验收返工包 `p5-rework-package-2026-10-19.zip` 中的 `REWORK-SPEC.md`、`CHECKLIST.md`、`ACCEPTANCE-REPORT.md`
> 验收基线：`9917890f001ac055280c48c31d50671821e7c929`（干净工作树）
> 修复提交：`afafdf8`（R1 + R2）、`8b826c9`（R3）、`7a19eb2`（R2 补充：恢复时拒绝已丢弃/已提交草稿）；文档与证据见本提交
> 结论：**R1 / R2 / R3 已修复，并按「改前失败 → 改后通过」的真实证据复验；D1 未修（单列上线遗留）；真机项仍未验证。**

---

## 0. 汇总状态

| 项 | 状态 | 关键证据 |
|---|---|---|
| **R1** 保存失败不得提交旧草稿 | ✅ 已修复并复验 | 随包 Hook 检查 0/2→2/2；真浏览器故障注入：改前 commit=1、虚假成功、正式内容被旧草稿覆盖、本机副本被清；改后 commit=0、无成功提示、输入与本机副本保留；解除阻断重试后正式内容=最新输入 |
| **R2** 新建草稿跨设备恢复 | ✅ 已修复并复验 | 创作台链接改前 `/new`（无 draft）→ 改后 `?draft=<id>`；无 localStorage 的第二上下文完整恢复文字/图片顺序/alt/相册收录；404/403/已丢弃/已提交/类型不匹配有准确错误且不静默新建 |
| **R3** 手机内自由聊天入口 | ✅ 已修复并复验（桌面/窄视口） | 改前 `.msg-composer`/`.msg-usage`/`.pw-expand` 在手机 ins 内全部不可见、expand href=`/apps/ins`；改后三者可见可点、expand href 保留会话（`/apps/ins/messages/<role>`），1440/390/320 截图与断言通过 |
| **D1** Docker 健康检查错配 | ⚠️ 未修（单列上线遗留，未获授权） | `deploy/compose.prod.yaml` 检查 `status == "ok"`，API 就绪返回 `"ready"`；本轮未改部署配置、未部署 |
| **真机** 触控/软键盘/中文输入法 | ❌ 未验证（无设备） | 只有 Chromium headless + 视口证据；不以桌面/WebKit 代替真机 |
| 集成回归 | ✅ 通过 | tsc 0 / lint 0 / 全量单测 113 文件·1182 用例；隔离生产构建 exit 0（37/37 静态页）；返工 e2e **124/0**；P5 全量 e2e **219/0**；六项回归 6/6 exit 0（见 §5） |

> **不能声称的内容**：不能声称「A1–A12 全部通过」「真机通过」「D1 已修复」。手机内自由聊天只在桌面浏览器与 1440/390/320 视口下验证；真实软键盘/输入法/触控未验证。

---

## 1. 基线、提交与修改范围

- 返工基线：`9917890f001ac055280c48c31d50671821e7c929`（`main`，工作树干净）。
- 修复提交（本地，未 push）：
  - `afafdf8` `fix(p5-rework): R1 保存失败不得提交旧草稿 + R2 新建草稿跨设备恢复`
  - `8b826c9` `fix(p5-rework): R3 恢复手机内自由聊天与展开查看入口`
  - `7a19eb2` `fix(p5-rework): R2 恢复时拒绝已丢弃/已提交的工作草稿`（复验中发现的 R2 残余缺陷，详见 §3.4）
- 未改后端/契约/部署：`git diff --stat 9917890..HEAD -- apps/api contracts deploy` 为空；因此后端全树不在本轮重复执行，采用 2026-10-19 独立验收在**同一后端源码**上的结果（1025 通过 / 0 失败，隔离集群 55449），范围说明见 §5.4。
- 修改文件（按 R 项）：
  - R1/R2：`apps/web/features/workspace/use-work-draft.ts`、`draft-url.ts`（新增）、`workspace-home.tsx`；`features/ins/editor/moment-editor.tsx`、`moment-editor-page.tsx`；`features/journal/editor/journal-editor.tsx`、`editor-loaders.tsx`；对应单测/组件测试（含新增 `journal-editor-work-draft.test.tsx`）。
  - R3：`apps/web/app/globals.css`（仅 `[data-phone-app="ins"]` 段）、`features/messaging/composer.tsx`、`conversation-view.tsx`、`features/phone/phone-host.tsx`、`features/phone/expand-target.ts`（新增）；新增/更新 `messaging-phone-css.test.ts`、`expand-target.test.ts`、`views.test.tsx`、`phone-host.test.tsx`。
  - 证据工具：`tools/e2e-p5-rework.py`（新增）。

---

## 2. R1 · 保存失败后不得继续提交旧草稿

### 2.1 根因与修复

- 根因：`saveNow()` 保存失败后仍返回旧 `draftRef`，两个编辑器只判非空就 commit；成功路径还会 `discardLocalCopy()` 清掉最新本机输入。
- 修复（`afafdf8`）：
  - `saveNow()` 契约改为「只返回服务端已确认的当前内容快照」：`{ draft, contentVersion }`；保存失败 / 412 / 401 / 暂停 / 未就绪一律抛 `WorkDraftSaveError`（带 `code`），**绝不返回旧草稿**；`null` 仅保留给「干净空编辑器无内容可保存」。
  - 编辑器：commit 前保存失败 → 中止 commit（commit 请求 0 次）、显示真实错误、保留表单/图片/最新本机副本；不再显示成功。
  - `discardLocalCopyIfUnchanged(contentVersion)`：只有内容版本仍等于提交快照时才清本机副本；提交期间的新输入保留。
  - 「新建相册」入口的 fire-and-forget `saveNow()` 补 `.catch`，不产生未处理 rejection，失败如实提示。
- 详细改动与测试清单见提交 `afafdf8`。

### 2.2 改前失败证据（基线 `9917890`）

- **随包 Hook 定向检查**（未改脚本）：`R1-failed-save-must-not-return-stale-draft` **FAIL** —— `rejected=false`、`returnedText="OLD SERVER TEXT"`、`localText="LATEST UNSAVED TEXT"`、`state=failed`；summary 0/2 pass，exit 1。
- **真浏览器故障注入**（Chromium 148，隔离栈；`tools/e2e-p5-rework.py`，场景 r1-ins / r1-journal，PATCH 返回 500、commit 端点保持可用）：
  - INS：commit 请求 **1 次**（要求 0）、出现 `[data-editor-success]`、正式动态内容被旧服务端草稿覆盖、localStorage 最新本机副本被清空；
  - 手记：commit 请求 **1 次**（要求 0）、虚假成功、正式正文被旧内容覆盖。

### 2.3 改后通过证据

- **随包 Hook 定向检查**：`R1-failed-save-must-not-return-stale-draft` **PASS** —— `rejected=true`、`returnedText=null`、`state=failed`、`localText="LATEST UNSAVED TEXT"`；summary **2/2 pass，exit 0**。
- **组件/集成单测**（真实 Hook + 模拟 API）：
  - `use-work-draft.test.tsx`：PATCH 500 → `saveNow` 抛 `failed`、本机副本保留；412/401/断网/未启用分别映射 `conflict/auth/unavailable/not-ready` 且不旁路；失败后重试成功返回与当前表单一致的内容；`discardLocalCopyIfUnchanged` 版本不一致时保留。
  - `moment-editor.test.tsx` / `journal-editor-work-draft.test.tsx`：阻断 PATCH 时点「保存草稿 / 发布 / 更新正式内容」，commit 请求 **0 次**、无成功提示、输入保留；解除阻断后重试 commit 内容等于当前输入；相册入口 saveNow 失败有提示、无 unhandled rejection。
- **真浏览器故障注入（改后）**：r1-ins / r1-journal 场景 **全部断言通过**：阻断期间 commit=0、无成功提示、输入与本机副本保留；解除阻断重试后正式内容=最新输入（不是旧服务端内容）。详见 `rework-evidence/after/e2e-p5-rework.json` 的 r1 场景。

---

## 3. R2 · 新建草稿（无 target）的跨设备恢复

### 3.1 根因与修复

- 根因：创作台 `draftHref()` 对无 target 草稿只生成 `/admin/.../new`，不带草稿身份；两个编辑器未把草稿 ID 传给 Hook；Hook 在 `targetId` 为空时提前返回，位于其后的 `draftId` 读取分支永远不可达。
- 修复（`afafdf8`）：
  - 创作台：`target_id === null` 的草稿 → `/admin/moments/new?draft=<uuid>` / `/admin/journal/new?draft=<uuid>`（保留 `returnTo`）；已有 target 路径不变；「另存为新草稿」产物自动适用。
  - 页面/装载器：解析并透传 `?draft=`；非 UUID 显示「草稿编号不合法」准确状态（不发请求、不渲染空白编辑器）。
  - Hook：先 `GET /admin/work-drafts/{id}` 恢复（无 target 不再提前返回），校验 `content_type` 与 `target_id`；404/403/类型不匹配/target 不匹配 → `state=failed` + `resumeError` + 暂停保存（**不自动新建、不加载另一份草稿**）；成功则应用 `data`/`images`（顺序与 alt）并 `synced`；本机副本更新与在途输入保护沿用原逻辑。
  - 编辑器：恢复失败渲染可见 `role=alert` 错误块 +「新建空白内容」入口（去掉 `draft`/换新 `entry`），并禁止提交；`?draft=` 变化会重挂编辑器，避免串稿。
- 说明：`?draft=` 只表示服务端草稿身份；`?entry=` 仍是本机副本入口 id、`returnTo` 仍是来源上下文，三者不互相替代。

### 3.2 改前失败证据（基线 `9917890`）

- 随包 Hook 定向检查 `R2-new-draft-resume` **FAIL**：显式提供 `draftId` + 空 localStorage 时 `getCalls=0`、`state=idle`、`draft=null`。
- 真浏览器（第二上下文只复制 cookie、**无 localStorage**）：
  - 创作台草稿行 href=`/admin/moments/new`（无 `?draft=`）；
  - 点击后 URL 无草稿身份，正文/图片顺序/alt/相册收录选择全部丢失；
  - 刷新同一 URL 不恢复；两份同类新草稿均打开空白页（无法区分）；
  - 新手记：日期回落为「今天」而非草稿日期，标题/正文/图片丢失；
  - 跨类型、不存在、已丢弃的草稿 ID 均**静默显示空白新建**（没有准确错误）。

### 3.3 改后通过证据

- 随包 Hook 定向检查 `R2-new-draft-resume` **PASS**：`getCalls=1`、`state=synced`、`draft.id=draft-1`、正文=`SERVER DRAFT`（无本机缓存）。
- Hook 单测：GET 1 次恢复 data/images（顺序/alt/收录）且不发 POST 新建；同类型两份草稿点击哪份恢复哪份；刷新（本机副本较新）保留本机输入；恢复在途输入不被旧响应覆盖；404/403/类型/target 不匹配 → `failed` + `resumeError`、后续输入不再发写请求；**已丢弃 / 已提交（status≠active）→ `failed` + 准确错误、不加载草稿内容**；「另存为新草稿」生成的草稿可用 draftId 恢复。
- 页面/编辑器测试：创作台新草稿链接含 `?draft=` 且保留 returnTo；页面透传/非法参数状态；编辑器首帧恢复与 resumeError 可见块；非 UUID 不触发编辑器数据请求。
- 真浏览器（改后）：无 localStorage 的第二上下文从创作台点击 → URL 带 `?draft=` → 文字、图片顺序、alt、相册收录选择完整恢复；刷新仍恢复；两份同类草稿各自恢复不串稿；新手记日期/标题/正文/图片恢复且默认私密；错误 ID/跨类型显示准确错误而不是静默空白。详见 `rework-evidence/after/e2e-p5-rework.json` 的 r2 场景。

### 3.4 复验中发现的 R2 残余缺陷与修复（`7a19eb2`）

- 现象（真浏览器复验发现）：已**丢弃**的工作草稿经 `?draft=` 恢复时被当作有效草稿加载，无错误提示。
- 根因：后端 `GET /admin/work-drafts/{id}` 对 `active / committed / discarded` 任何状态都返回 200（契约如此，供审计/详情查看），前端恢复分支只校验 `content_type`/`target_id`，漏了 `status`。
- 修复（`7a19eb2`）：恢复前校验 `status === "active"`；`discarded` 显示「已被丢弃」、`committed` 显示「已经提交为正式内容」，并暂停/禁止提交，不自动新建、不加载其内容；`types.ts` 补齐真实状态枚举。
- 证据：Hook 单测新增 discarded/committed 用例（`state=failed`、准确文案、无写请求、`saveNow` 抛 `unavailable`）；真浏览器 r2-journal 场景重新运行后 discarded 用例通过（见 §5.5 最终数字）。

---

## 4. R3 · 恢复手机内自由聊天与「展开查看」

### 4.1 根因与修复

- 根因：手机宿主 ins 段的 CSS 为贴近参考帧直接隐藏 `.msg-composer`、`.msg-usage`、`.msg-choices-hint`、`.pw-expand`；「展开查看」目标也只有 `manifest.canonical_path`（INS 会丢角色/会话）。
- 修复（`8b826c9`，详见提交）：
  - `globals.css` 仅改 `[data-phone-app="ins"]` 段：恢复输入区/用量/选择提示/展开按钮可见；会话视图整屏 flex（消息列表占满剩余高度，底部依次为操作提示/剧情选择/「自己说一句」/用量），输入区不被遮挡；补 `env(safe-area-inset-bottom)` 与 `scroll-margin` 兜底（真机行为未验证）。
  - 「展开查看」恢复为黑底白框红影 44×44 按钮；`features/phone/expand-target.ts` 计算目标：INS `screen=conversation` → `/apps/ins/messages/<role>`，`screen=messages` → `/apps/ins/messages`，其余 canonical；点击仍走 `host.openSiteContent({ source: "phone-link" })`。
  - `Composer`：中文/日文输入法组合期间（`isComposing` 或 keyCode 229）不把 Ctrl/Cmd+Enter 当发送；单独 Enter 仍换行。
  - 保留 IM 视觉（黑底白边消息、头像叠压、回复选择、手机外壳、wordmark）、AI/模拟标识、限额、发送失败与重试反馈。

### 4.2 改前失败证据（基线 `9917890`）

- Chromium 1440×1000 桌面斜屏手机、390×844、320×700：`.msg-composer`、`.msg-usage`、`.pw-expand` 均不可见；`.pw-expand` href=`/apps/ins`（丢失会话）；窄视口同样找不到输入入口。（手机内导航本身正常：launcher→INS→消息→角色会话可达。）

### 4.3 改后通过证据

- jsdom/静态回归：`views.test.tsx` 手机内渲染「自己说一句」折叠条/用量/选择提示，展开后可输入并发送、限额/失败提示保留、IME 组合 Ctrl+Enter 不发送；`messaging-phone-css.test.ts` 断言 ins 段不再 `display:none` 上述控件、列表 flex 占满、底部控件非 fixed/absolute、safe-area/scroll-margin 存在、规则仍限定命名空间；`expand-target.test.ts` 7 组目标计算（会话/列表/canonical/非法 item/特殊字符/归一化/跨应用）；`phone-host.test.tsx` INS 会话 `.pw-expand` href 与点击走 `phone-link`。
- Chromium（改后）：1440/390/320 三视口下输入入口可见、可展开输入并发送；用量可见；展开按钮可见且 href 保留当前会话（`/apps/ins/messages/<role>`），点击落到对应 canonical 会话页；剧情选择态与自由输入态截图见 `rework-evidence/after` 与 `.dsh/screenshots/p5-rework/after/`。详见 `rework-evidence/after/e2e-p5-rework.json` 的 r3 场景。

---

## 5. 集成回归与证据

### 5.1 前端静态检查与单测

| 检查 | 命令 | 改前（基线） | 改后 |
|---|---|---|---|
| 类型检查 | `cd apps/web && npx tsc --noEmit --incremental false` | exit 0 | **exit 0** |
| lint | `npm run lint` | exit 0 | **exit 0** |
| 全量单测 | `npx vitest run` | 110 文件 / 1123 用例通过 | **113 文件 / 1182 用例通过，exit 0** |

> 说明：改后全量单测最终跑为 113 文件 / 1182 用例全过（exit 0）；中途一次运行（R2 status 修复前）时 `tests/runtime/showcase-intent.test.tsx`（既有导航 timing 用例，与本次改动无 import 关系）出现 1 次时序 flake；单文件重跑 23/23 通过，全量复跑 113/1181 全过。记录在此避免把偶发当成稳定结果。

### 5.2 随包 Hook 检查（未修改脚本）

`node …/scripts/check-work-draft-contract.cjs /Users/学习/blog/Blogs`

- 改前：summary `{passed:0, failed:2}`，exit 1（R1/R2 均复现）。
- 改后：summary `{passed:2, failed:0}`，exit **0**；JSON 见 `docs/acceptance/evidence/p5-rework-2026-10-19/`。

### 5.3 隔离生产构建

- 隔离副本 `/tmp/p5-rework-build`（rsync 自 `8b826c9` 的 `apps/web`，未覆盖共享 `.next`）：`npx next build` **exit 0**，`✓ Compiled successfully`，**37/37 静态页**，BUILD_ID `saPw1tf0nfpULa2_uuztT`。
- 隔离全栈构建（e2e 用）：见 §5.5 的 BUILD_ID/构建时间。

### 5.4 后端 / 契约 / 迁移（未修改，复用证据）

- 本轮 `git diff 9917890..HEAD -- apps/api contracts deploy` 为空；未新增迁移、未改 OpenAPI/生成类型。
- 复用 2026-10-19 独立验收结果：隔离集群 55449 后端全树 **1025 通过 / 0 失败**、pytest exit 0（源码与返工基线一致）。
- 未重跑 Docker / 生产部署（D1 未获授权，见 §6）。

### 5.5 隔离浏览器端到端（Chromium headless）

- 工具：`tools/e2e-p5-rework.py`（新增；真实浏览器、写型测试只打隔离栈）。
- 改前（BUILD_ID `uzuVcJcrRD8VZLXC34j0j`，源码经逐文件核对等于 `9917890`）：**52 pass / 50 fail**，exit 1；失败全部归因 R1/R2/R3。
- **改后（BUILD_ID `x46VxuFXLS83Km5gubNnP`，构建时间 2026-10-19 08:59，HEAD `7a19eb2`）：124 pass / 0 fail / 0 skip，exit 0**。
  - 分场景：`r1-ins` 14/14、`r1-journal` 15/15、`r2-moment` 26/26、`r2-journal` 23/23、`r3-phone` 44/44。
  - 改后构建核对：`build_has_only_head_web_sources = true`（构建副本只含 HEAD 的 web 源码）；修复后全新 `down → up` 重建数据库再跑。

**既有回归（改后同一构建、全新隔离库上）**：

| 回归 | 结果 |
|---|---|
| `P5_E2E_READY=1 python3 tools/e2e-p5-workspace.py` | **219 通过 / 0 失败 / 0 跳过**，exit 0（207s） |
| 六项既有浏览器回归（phone-scroll / journal-reading / ins-tag / ins-conversation / metanav-palace / im-draft） | **6/6 exit 0**（各自判定 ✓） |
| 旧管理端 INS 收录全流程 `tools/e2e-ins-album-links-ui.py` | **9 通过 / 0 失败**，exit 0 |
| R2 已丢弃草稿提示（改后新增场景） | PASS：显示「这份工作草稿已被丢弃，不能继续编辑…」，不加载被丢弃内容 |

> 回归口径说明：`e2e-p5-workspace.py` 首次在旧构建（含前序测试数据）上出现过 217/2，经查是前序 e2e 留下的工作草稿/媒体数据导致的空态与选择器口径偏差（这些脚本与 media-picker 本轮未改动，非本返工引入）；在 `7a19eb2` 全新 `down→up` 的干净隔离库上首次运行即 **219/219**。

---

## 6. D1 · Docker 健康检查错配（未修，单列上线遗留）

- 现状（本轮复核仍存在，未修改）：
  - `deploy/compose.prod.yaml` 的 API healthcheck 执行 `sys.exit(0 if body.get("status") == "ok" else 1)`（约 140 行附近）；
  - `apps/api/app/core/health.py` 就绪成功返回 `"status": "ready"`（约 134 行附近）；
  - 网关 `depends_on: api: condition: service_healthy`，因此存在明确编排错配。
- 本轮按任务书**未获得部署修复授权**：未改 compose/健康检查、未部署、未在隔离 Compose 验证。该项保持为上线遗留，不计入 R1–R3 关闭。

---

## 7. 真机项（未验证）

以下均**未验证**，不得用桌面 Chromium / WebKit 引擎 / 窄视口替代：

1. 真实触控命中（44px 实际热区、滑动/长按）；
2. 软键盘弹出后的光标与关键操作可达性（手机内自由聊天输入区）；
3. 中文/日文输入法组合过程（本轮只有 IME 逻辑单测，未真机实测）；
4. 真机 iOS Safari / Android Chrome 渲染与性能。

---

## 8. 未验证项与明确风险

1. 真机项（§7）：真机 iOS/Android、软键盘遮挡、触控命中、中文输入法 composition 均未验证；390/320 只是视口，不是真机。
2. 真实双物理设备并发：跨设备恢复使用「第二浏览器上下文（复制 cookie、无 localStorage）+ 隔离 API」模拟，非两台物理设备。
3. 弱网长时间输入稳定性：只做短时故障注入与断网/恢复模拟。
4. R1 的 412/401/暂停状态旁路、相册新建 saveNow 调用方、提交期间更晚输入不被清：**单测/组件测试覆盖**，未纳入真浏览器故障注入（e2e 只做 PATCH 500）。
5. R2「另存为新草稿」生成的草稿跨设备恢复：**Hook/组件测试覆盖**，未纳入真浏览器 e2e。
6. R3 草稿在 App 内切换/返回/展开后的保留、发送失败重试、限额耗尽提示：仅部分覆盖（e2e 验证入口/输入/发送/展开 href；草稿保留与限额由组件测试/现有实现覆盖）；音乐继续播放与软键盘遮挡未验证。
7. 本轮未重跑 Docker、生产部署、迁移 round-trip、OpenAPI/gen:api 漂移（后端与契约未改，复用证据）。
8. R3 视觉仍为 IM 风格自适配，不宣称逐像素还原参考帧；手机内自由输入区为功能恢复后的折叠条形态。
9. 同设备从创作台打开新草稿会生成新的 `entry`，创建会话中 <1s 未同步的本机输入以服务端草稿为准；这是本机副本 key 语义，不是跨设备缺陷。
10. 全量单测在中间一次运行出现 1 个与本改动无关的既有 timing 用例偶发 flake；单文件重跑与最终全量复跑均通过（§5.1 已记录）。

---

## 9. 环境安全与清理

- 共享环境（验收全程未动）：8000 旧静态站、8100 dev API、3100 前端、55432 共享 Postgres；会话开始/结束 PID 一致，HTTP 200。
- 写型 e2e/构建只在隔离资源：Postgres 55434 / API 8130 / 前端 3130（`/tmp/pl-e2e-stack`）、隔离构建 `/tmp/p5-rework-build`；未覆盖共享 `.next`、未重建共享库、未停止他人服务。
- 验收结束停止并清理自己创建的隔离栈（3130/8130/55434 已无监听）；隔离库测试数据不进入共享环境。
- 端口核对（栈 down 前后）：共享 postgres 55432 PID=14164、8100 PID=18631、8000 PID=19294、3100 PID=50666 全程一致；隔离端口 55434/8130/3130 均为本轮自建并已停止。记录见证据目录 `port-check-after-down.txt`。
- 未 `git push`；只在本地提交修复与文档。

---

## 10. 证据索引

| 内容 | 路径 |
|---|---|
| 返工任务书/清单/独立验收 | `/Users/v/Documents/ChatGPT/Blog开发/docs/handoff/2026-10-19-p5-rework/`（`REWORK-SPEC.md`、`CHECKLIST.md`、`ACCEPTANCE-REPORT.md`） |
| 随包 Hook 检查（改前/改后 JSON） | `docs/acceptance/evidence/p5-rework-2026-10-19/{baseline,after}-work-draft-check.json` |
| 真浏览器 e2e（改前/改后） | `docs/acceptance/evidence/p5-rework-2026-10-19/{baseline,after}-e2e-p5-rework.json`；完整日志与截图在 `/Users/学习/blog/rework-evidence/`、`/Users/学习/blog/.dsh/screenshots/p5-rework/` |
| e2e 脚本（新增，可复跑） | `tools/e2e-p5-rework.py` |
| e2e 摘要（改后 124/0、回归 219/0、六项 6/6、相册 9/0） | `docs/acceptance/evidence/p5-rework-2026-10-19/after-e2e-summary.txt`、`after-regression-summary.json` |
| 共享端口核对 | `docs/acceptance/evidence/p5-rework-2026-10-19/port-check-after-down.txt`、`shared-env-check.txt` |
| 单测/构建摘要 | `docs/acceptance/evidence/p5-rework-2026-10-19/`（vitest/build/shared-env） |
| 修复提交 | `afafdf8`（R1+R2）、`8b826c9`（R3） |

> 边界：本报告只对上述基线、提交与隔离环境负责；R1/R2/R3 的关闭条件以真实复跑为准，不以「应当可用」代替实测。
