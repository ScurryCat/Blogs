# P5 · C2 交付：创作台首页 + 工作草稿自动保存/本机恢复/冲突基础 + 管理外壳与登录返回

> 任务：共享任务 `task-2`（C2 前端基础层）
> 契约：`docs/agent-deliveries/P5-C0-integration-contract.md`（§4.1 / §4.2 / §4.7 / §9.4 / §9.5；含 2026-10-18 新增的
> 「入口 id entryId」「data-* 补充」「继续编辑跳转」三条）
> 设计书：`docs/handoff/2026-10-18-p5-creator-workspace-design.md`（§2.1 / §2.2 / §2.6 / §3.1 / §3.2 / §五）
> 日期：2026-10-18 ｜ 状态：**代码落盘 + 单测/类型/ESLint 自测通过**；浏览器与真机证据由 C5 在集成阶段补

本交付只覆盖**前端共享基础层**：C3（INS/图片选择器）与 C4（手记/放课后）通过本层导出的
`types.ts / api.ts / session.ts / use-work-draft.ts / use-entry-id.ts / sync-status.tsx /
conflict-notice.tsx / editor-shell.tsx / return-context.ts` 接线。INS/手记编辑页本身、媒体选择器、
放课后快捷更新由 C3/C4 交付，不在本交付声明内。

---

## 一、实际修改/新增文件清单

### 修改（3 个）

| 文件 | 改动 |
|---|---|
| `apps/web/lib/api/client.ts` | `ApiRequestOptions` 增加 `headers?: Record<string, string>`（同名头可覆盖内部默认头）；写请求统一带 `X-CSRF-Token` 头（契约 §9.2，规避 body csrf 的 4096 字节上限） |
| `apps/web/app/admin/layout.tsx` | 导航补「创作台 / 动态 / 手记 / 放课后 / 相册 / 更多管理 / 回到站点」；引入 `features/workspace/workspace.css`（仅管理端）；说明文案补充「自动保存只写工作草稿」 |
| `apps/web/app/admin/login/page.tsx` | 支持 `?returnTo=`（`safeInternalPath` 白名单校验；合法 `router.replace(returnTo)`；参数非法回 `/admin`；**没有该参数时保持旧行为**，不破坏既有用例）；主动退出登录 `clearAllWorkDraftLocalCopies()` + 探针缓存失效；登录成功探针缓存失效 |
| `apps/web/app/globals.css` | 仅新增管理外壳用的一小段 `.admin-nav` 样式（flex 换行 + hover 红色），不影响公开页 |

### 新增（`features/workspace/`，C2 唯一 owner）

| 文件 | 用途 |
|---|---|
| `types.ts` | 契约 §4.2 的共享类型：`ContentType` / `DraftAction` / `PickedImage` / `WorkDraft` / `CommitResult` / `SyncState`；另含 `WorkDraftLocalCopy`、入参类型。`MediaAdminOut` 取自 `lib/api/generated/schema`（生成类型） |
| `api.ts` | work-drafts 六接口（create/list/get/update/commit/discard）；snake_case wire；写请求 `X-CSRF-Token`；PATCH/commit 带 `If-Match: "<draft_version>"`；图片数组顺序即 `position`；body 不再依赖 `csrf_token` |
| `session.ts` | `useOwnerSession()`：`GET /auth/owner-status`（模块级缓存 + 在途去重）；**只有确认 authenticated===true 才再读一次 `GET /auth/session` 拿 CSRF**；匿名零预登录会话；形状不对 → `failed`；`resetOwnerSessionCache()` / `refreshOwnerSession()` / `getOwnerCsrfToken()` / `OwnerSessionExpiredError` |
| `use-work-draft.ts` | 自动保存引擎（见 §二行为）；本机恢复副本 key：`pl.workdraft.v1.<ownerId>.<contentType>.<targetId\|new>.<targetId ?? entryId>`；`clearAllWorkDraftLocalCopies()`；`workDraftLocalCopyKey()` |
| `use-entry-id.ts` | 契约 §9.4 新增：`ENTRY_PARAM`、`useEntryId()`（首帧 `null` → 读/生成 `?entry=<uuid>` 并 `router.replace`，保留其他查询参数）、`createEntryId()`、`withEntryId()`、`isEntryId()` |
| `sync-status.tsx` | `SyncStatus`：安静状态行，`data-sync-state`；只有 synced 才显示「可在另一设备继续编辑」文案（由 hook 给） |
| `conflict-notice.tsx` | `ConflictNotice`：`data-workspace-conflict` / `data-workspace-conflict-reload` / `data-workspace-conflict-save-as-new` |
| `editor-shell.tsx` | `EditorShell`：桌面在 `.admin-shell` 内；`≤620px` 固定全视口层（CSS 100dvh + safe-area + `useOverlay` 锁滚动），sticky 头部放返回/状态/操作；`data-editor`（传 `contentType` 时）/ `data-editor-return` / `data-editor-shell` / `data-editor-compact` |
| `return-context.ts` | `safeInternalPath`（白名单 `/`、`/apps/ins`、`/apps/journal`、`/apps/leisure`、`/apps/leblanc` 及子路径；拒绝 `//`、反斜杠、控制字符、异源/非白名单）、`withReturnTo`、`readReturnTo`、`stripPhoneContext` |
| `workspace.css` | `ws-` 前缀；P5 黑白红/粗边框/硬阴影/反白；输入区无 skew/rotate；≤620px 编辑器固定全视口 + safe-area + 44px 触控；reduced-motion 关闭脉冲 |
| `workspace-home.tsx` | 创作台首页客户端视图（`/admin` 四项任务；见 §三） |
| `test-support.ts` | 测试用 fetch 替身（仅测试；`*.test.*` 才会被 vitest 收集） |

### 新增（路由与测试）

| 文件 | 说明 |
|---|---|
| `apps/web/app/admin/page.tsx` | `/admin` 服务端包装：`metadata = { robots: noindex }` + `<WorkspaceHome />` |
| `features/workspace/return-context.test.ts` | returnTo 白名单/编码/phone 参数（12 用例） |
| `features/workspace/api.test.ts` | 六接口 wire 契约 + CSRF/If-Match（8 用例） |
| `features/workspace/session.test.tsx` | 探针缓存/去重/匿名不建会话/形状不对 failed（6 用例） |
| `features/workspace/use-entry-id.test.tsx` | entry 参数读取/生成/保留 returnTo+date/SSR 首帧 null（8 用例） |
| `features/workspace/use-work-draft.test.tsx` | 自动保存全行为（13 用例） |
| `features/workspace/workspace-home.test.tsx` | 首页空态/真实数据/失败态/returnTo/匿名（6 用例） |
| `features/workspace/editor-shell.test.tsx` | data-* / 返回 / 紧凑层锁滚动（4 用例） |
| `features/workspace/login-return.test.tsx` | 登录页 returnTo 与退出清本机副本（5 用例） |

**未改动**：C1/C3/C4 的写作用域（`apps/api`、`features/ins|journal|leisure|media-picker`、`app/admin/moments|journal|leisure` 等）、
`tools/`、`contracts/openapi.json`、他人未提交文件。未 `git commit`、未 `npm run build`（避免覆盖共享 `.next`）。

---

## 二、接口与关键行为说明

### 2.1 工作草稿接口（`features/workspace/api.ts`，C3/C4 直接 import）

```ts
createWorkDraft(csrf, { contentType, targetId?, data?, images? }, signal?)
  → Promise<{ draft: WorkDraft; reused: boolean }>        // POST /admin/work-drafts
listWorkDrafts({ contentType?, cursor?, limit? }, signal?) → Promise<Page<WorkDraft>>
getWorkDraft(id, signal?)                                  → Promise<WorkDraft>
updateWorkDraft(csrf, id, draftVersion, { data?, images? }, signal?) → Promise<WorkDraft>
commitWorkDraft(csrf, id, draftVersion, { action, expectedTargetVersion, commitKey }, signal?) → Promise<CommitResult>
discardWorkDraft(csrf, id, signal?) → Promise<void>
```

- 全部走 `lib/api/client.ts`（同源 `/api/v1`、`no-store`、读重试一次、写不重试）；
- `X-CSRF-Token` 头统一加（契约 §9.2）；body 里**不再**出现 `csrf_token`；
- PATCH / commit 的 `If-Match` 为 `"<draft_version>"`；commit body 字段 `action` / `expected_target_version` / `commit_key`。

### 2.2 `useOwnerSession()`（`session.ts`）

```ts
{ status: "loading" | "anonymous" | "owner" | "failed"; session: SessionStatus | null }
```

- 探针 `GET /api/v1/auth/owner-status`（无副作用、不建预登录会话）；模块级缓存 + 在途去重；
- **确认 `authenticated === true` 之后**才读一次 `GET /auth/session` 拿完整会话（`csrf_token` 供编辑器写请求）；
  **匿名分支绝不调用 `/auth/session`**（不给访客建 10 分钟预登录会话）；
- 响应缺 `authenticated` 布尔值 → `failed`；**只有 `owner` 才渲染站主入口**；
- 失败态不缓存（只读探针，重新挂载会重试）；`resetOwnerSessionCache()` 供 401/登录/退出使用。

### 2.3 `useWorkDraft(options)`（`use-work-draft.ts`）

```ts
options: {
  contentType: "moment" | "journal";
  targetId: string | null;
  enabled: boolean;
  ownerId: string | null;
  initialData: Record<string, unknown>;
  initialImages: PickedImage[];
  entryId: string;                // 必填（契约 §9.4 更新）：页面用 useEntryId() 取
  debounceMs?: number;            // 默认 1000
  maxWaitMs?: number;             // 默认 5000
  returnTo?: string | null;
  csrfToken?: string;             // 可选：页面已有会话时直接给；否则 hook 自取（模块缓存优先）
  draftId?: string | null;        // 可选：恢复指定草稿（「继续编辑」直接打开某份无 target 草稿时）
}
returns: {
  draft, state, syncMessage, recoveryNotice,
  update({ data?, images? }), saveNow(), discard(), resolveConflict("reload-latest" | "save-as-new"),
  lastSyncedAt,
  // 契约之外的新增可选能力：
  localCopy, adoptLocalCopy(), discardLocalCopy(), authExpired,
}
```

逐条行为（对应设计书 §3.2 / 契约 §9.4，均有单测）：

1. **防抖/上限**：停止输入约 1s 保存；持续输入最长约 5s 必提交一次（单测用默认值验证）。
2. **串行 + 旧响应**：同一草稿一次只发一个保存请求；本地单调 `seq` + 服务端 `draft_version` 双重防乱序；
   响应回来时若 `seq` 已前进，只更新版本元数据、内容保持用户最新一轮，并继续保存（旧响应不覆盖新输入）。
3. **首建时机**：已有 `targetId` → 挂载即 `POST` 复用/创建（跨设备前提）；新内容第一次真实 `update()`（输入/选图）才创建，
   避免空的「继续编辑」条目；`saveNow()` 在有内容时也会主动创建（例如离开去新建相册前）。
4. **本机恢复副本**：key 见上；每次输入立即写 `{data, images, draftId, draftVersion, savedAt, returnTo}`；
   刷新后与服务器草稿比较 `savedAt`/`updated_at`：本机更新 → 采用本机内容并提示（`recoveryNotice`），不静默覆盖服务器；
   服务器更新 → 采用服务器并提示。**未登录不读不写**；`clearAllWorkDraftLocalCopies()` 只清 `pl.workdraft.v1.` 前缀。
5. **状态机**：`idle → local-only → saving → synced/failed`；`conflict` 时暂停自动保存并渲染 `ConflictNotice`；
   **只有 `synced` 的文案是「已同步 · 可在另一设备继续编辑」**（`SYNCED_MESSAGE`）。
6. **412**：暂停自动保存、保留本机输入；`resolveConflict("reload-latest")` 读最新服务端草稿替换本机；
   `resolveConflict("save-as-new")` 用本机内容新建草稿（不带 target）且原草稿不覆盖。
7. **401**：停止自动保存、`authExpired=true`、提示「登录已失效，本机输入已保留」（页面去登录链接带 returnTo），
   并让站主探针缓存失效；本机副本保留。
8. **断网**：保留本机内容、`failed` 状态与可重试（`saveNow()`）；**不自动重发写请求**。
9. **beforeunload**：仅有未同步本机改动时安静提示一次。
10. 自动保存**只写 `work_drafts`**，从不调用正式内容更新接口；正式提交只由页面显式调 `commitWorkDraft`。

### 2.4 `useEntryId()`（`use-entry-id.ts`，契约 §9.4 更新）

- 首帧返回 `null`（服务端渲染/hydration 安全），页面应 `if (!entryId) return <占位>` 再挂编辑器；
- URL 有合法 `?entry=<uuid>` → 直接采用（不重写 URL）；缺失/非法 → `createEntryId()` 生成并
  `router.replace(withEntryId(当前 pathname+search+hash, id))`（不增历史栈）；
- **只设置 `entry`**，`returnTo` / `date` / `phone/screen/item` 全部保留；
- 「再发一条」：`createEntryId()` + `withEntryId()` 写回 URL 后以新 id 重挂编辑器（换本机副本 key，避免串稿），
  换之前先 `await saveNow()`/commit 保护内容。

### 2.5 `EditorShell` / `SyncStatus` / `ConflictNotice` / `return-context`

- `EditorShell({ title, subtitle?, returnTo, children, actions, status?, contentType? })`：桌面在管理外壳内；
  ≤620px 固定全视口（`position:fixed; inset:0; 100dvh; env(safe-area-inset-*)`、`overscroll-behavior:contain`、
  `useOverlay` 锁滚动）+ sticky 头部；返回 `router.replace(safeInternalPath(returnTo) ?? "/admin")`；
  `data-editor`（传 contentType 才有）/ `data-editor-return` / `data-editor-shell` / `data-editor-compact`。
- `SyncStatus({ state, message, lastSyncedAt? })`：`data-sync-state`；idle 且无文案不渲染；安静（`role=status`、aria-live）。
- `ConflictNotice({ onReload, onSaveAsNew, message? })`：`data-workspace-conflict` /
  `data-workspace-conflict-reload` / `data-workspace-conflict-save-as-new`。
- `return-context.ts`：白名单语义见 §一；`withReturnTo` 用 `encodeURIComponent`；`readReturnTo` 返回已校验值或 `null`；
  另提供 `stripPhoneContext(href)`（去掉 phone/screen/item，URL 层兜底）。
- `data-editor-save / data-editor-publish / data-editor-submit-action（本次将执行的 save\|publish\|update）/
  data-editor-blockers / data-editor-error / data-editor-success` **由编辑器页面自己的按钮输出**（C3/C4），
  EditorShell 不代为渲染这些按钮。

### 2.6 `/admin` 首页（`app/admin/page.tsx` + `workspace-home.tsx`）

四项任务，全部真实数据/真实链接，**无假统计、占位动态、虚构通知**：

1. 开始记录：发布动态（`/admin/moments/new`）/ 写手记（`/admin/journal/new`）/ 更新追番、更新游戏（`/admin/leisure`）；
2. 继续编辑：`GET /admin/work-drafts`（仅本人 active）：类型、摘要（空显示「尚未填写内容」）、最近同步时间；
   点击进对应编辑页（moment 无 target → `/admin/moments/new`，有 target → `/admin/moments/{id}/edit`；journal 同理；
   **保留创作台 URL 上的 returnTo**）；失败如实显示原因 + 重试；空态说明「停止输入约 1 秒后自动保存到这里」；
3. 近期内容：管理侧最近动态 + 手记（合并按 `updated_at` 倒序取 6），真实状态标注（已发布/草稿/已公开/已发布（私密）），
   编辑 + 仅公开项给「预览」；单个来源读取失败按来源如实显示；
4. 内容管理：动态/手记/放课后/相册/作品/友链/殿堂/技能/印象空间/消息与成本（全部是已有管理页）。

未登录 → 只给登录入口（`?returnTo=%2Fadmin`，登录后回 `/admin`）；探针失败 → 错误 + 重试；加载中 → 安静提示。

data-*：`data-workspace-home`、`data-workspace-start="moment|journal|anime|game"`、
`data-workspace-draft-row`、`data-workspace-draft-open`、`data-workspace-recent-row`、`data-workspace-manage-link`，
另加 `data-workspace-login-required`、`data-workspace-drafts-error/empty`、`data-workspace-recent-error/empty`、
`data-workspace-session-error` 便于失败态断言。

---

## 三、测试命令与真实结果

环境（照契约 §9.8）：`export no_proxy=127.0.0.1,localhost,::1 NO_PROXY=...`；工作目录 `apps/web`。

```sh
# 1) C2 自己的域（workspace 全部单测）
npx vitest run features/workspace
#    → Test Files 8 passed (8)；Tests 62 passed (62)；0 failed

# 2) 既有登录页回归 + workspace（确认改 login 页没有破坏原有 7 个用例）
npx vitest run features/workspace app/admin/login/page.test.tsx
#    → Test Files 9 passed (9)；Tests 69 passed (69)；0 failed

# 3) 共享 API 客户端 / 认证模块回归（headers 选项改动）
npx vitest run lib/api/client.test.ts features/auth features/workspace/use-entry-id.test.tsx
#    → Test Files 4 passed (4)；Tests 42 passed (42)；0 failed

# 4) 我改到的文件 ESLint（0 error / 0 warning）
npx eslint lib/api/client.ts features/workspace app/admin/page.tsx app/admin/layout.tsx app/admin/login/page.tsx
#    → 无输出（0 problems）

# 5) 类型检查（整树；并行期受他人半成品影响）
npx tsc --noEmit
#    → 本次运行唯一报错在 C3 正在写的 features/ins/editor/moment-editor.test.tsx（TS2698），
#      与 C2 文件无关；C2 的 features/workspace、lib/api/client.ts、app/admin/** 无类型错误。
```

关键用例（与验收映射）：

| 用例 | 结果 |
|---|---|
| 默认 1s 防抖：600ms 不发请求 / 1.2s 恰好 1 次 | 通过 |
| 持续输入（每 300ms）：约 4.8s 无请求、5.4s 内恰好 1 次（5s 上限） | 通过 |
| 串行队列：在途期间输入 2 次只发 1 个 PATCH（maxConcurrent=1） | 通过 |
| 旧响应不覆盖新输入：旧响应只更新版本，界面/本地副本保持最新内容，随后携带最新内容再保存 | 通过 |
| 本机副本 owner 隔离 / 未登录不读不写 / 刷新恢复（内容+图片关系） | 通过 |
| `clearAllWorkDraftLocalCopies` 只清 `pl.workdraft.v1.`，保留其他 key | 通过 |
| 412 → 暂停（继续输入也不发请求）；reload-latest 载入服务器最新并恢复同步；save-as-new 新建草稿不覆盖原草稿 | 通过 |
| 401 → failed + authExpired + 文案「登录已失效」+ 本机内容保留 + 之后不再自动写 | 通过 |
| 断网 → failed 保留本机；`saveNow()` 重试成功 | 通过 |
| 新内容懒创建（挂载不发请求）；`saveNow` 主动创建；`discard` DELETE + 清本机副本 | 通过 |
| entryId：URL 已有不重写 / 缺失生成并 replace / 非法覆盖 / **保留 returnTo+date** / SSR 首帧 null | 通过 |
| returnTo 白名单：`//`、`https://`、`javascript:`、反斜杠、控制字符、`/admin`、`/posts/**`、`/apps/metanav`、`/apps/ins-evil` 全拒绝；合法路径保留查询串 | 通过 |
| 登录页：合法 returnTo → `router.replace(returnTo)`；非法 → `/admin`；无参数不跳转（旧行为）；注销清本机副本 | 通过 |
| 首页：匿名只给登录入口（无管理侧读请求、无 /auth/session）；空态四条文案；真实草稿/近期内容渲染 + 编辑/预览链接；draft 读取失败如实报错；探针失败报错 | 通过 |
| EditorShell：data-editor/return 钩子；非法 returnTo → `/admin`；≤620px 紧凑层 + OverlayManager 锁滚动 | 通过 |

未跑（按任务要求）：`npm run build`（会覆盖共享 `.next`，影响 3100 验证站）、整树 `vitest`、后端测试。
未做浏览器/真机验证（C5/C0 负责）。

---

## 四、未完成事项与未验证项（单列，如实）

1. **真机触控 / 软键盘 / 中文输入法**：无设备，未验证。本层只保证 CSS 规则（44px 触控、`100dvh` + `env(safe-area-inset-*)`、
   输入区无透视）与 jsdom 行为；真实软键盘弹出后 sticky 头部可达性需真机确认。
2. **浏览器真实渲染证据**：C2 未起 dev server / 未跑 next build（避免影响共享验证站），未做 WebKit/390×844 视口截图。
   C5 的 e2e 脚本会覆盖（创作台、自动保存、跨设备、冲突、入口 returnTo、移动全屏）。
3. **与真实后端联调**：C1 的 `/auth/owner-status`、`/admin/work-drafts` 本轮按契约用 fetch-stub 测试；
   真实响应（尤其 create 的 `{draft, reused}` 信封、PATCH 的 `ETag`/`draft_version`、412/428 错误体）尚未在运行中的 API 上验证 ——
   由 C0/C5 集成阶段验证；若与契约有出入我会按契约优先原则跟随 Lead 决定。
4. **「本机有未同步的修改」的两个显式动作**：hook 已暴露 `recoveryNotice`、`localCopy`、`adoptLocalCopy()`、
   `discardLocalCopy()`（契约 §9.4 的「采用本机 / 放弃本机」语义），但**按钮由 C3/C4 的编辑器页面渲染**；
   当前 hook 的默认行为是「较新一方作为初始内容 + 显示 recoveryNotice」（不丢内容、也不静默覆盖服务器）。
   若 C3/C4 不接这两个按钮，UI 上只有恢复提示、没有两选一 —— 已在消息里同步给他们。
5. **`data-editor-submit-action` / `data-editor-save|publish|blockers|error|success` 等按钮级属性**由 C3/C4 页面输出，
   本层不代渲染（EditorShell 只提供 `actions` 插槽）；C2 已按契约 §9.5 语义在消息中与两人对齐。
6. **首页「继续编辑」的跨设备复用**：列表点击按 Lead 新要求跳 `/new` 或 `/{id}/edit`；对**无 target 的新内容草稿**，
   编辑器页面是否复用同一份草稿由 C3/C4 页面决定（C2 的 `useWorkDraft` 提供可选 `draftId` 入参支持恢复指定草稿）。
7. **`WorkspaceHome` 的 returnTo 来源**：从创作台 URL `?returnTo=` 读取并透传给编辑器链接；创作台自身由谁带 returnTo
   （登录回跳等）取决于上游页面流程，本轮只保证不丢。

---

## 五、给 C3/C4 的接线要点（已消息同步）

- `useEntryId()`：`@/features/workspace/use-entry-id`，首帧 null → 拿到再挂编辑器；`entryId` 必填传给 `useWorkDraft`。
- `useOwnerSession()`：`status === "owner"` 才渲染入口；`session.csrf_token` 可用（编辑页可传 `csrfToken`，也可让 hook 自取）。
- 保存≠公开：`saveNow()` 只保工作副本；发布/更新正式内容必须显式 `commitWorkDraft(...)`（先 `saveNow()` 保证草稿最新）。
- 412 → `state === "conflict"` + `<ConflictNotice onReload={() => resolveConflict("reload-latest")} onSaveAsNew={() => resolveConflict("save-as-new")} />`。
- 退出登录调 `clearAllWorkDraftLocalCopies()`（登录页已接）；入口点击前用 `stripPhoneContext`/宿主 API 关手机浮层。
- **显式提交成功后**建议调用一次 `discardLocalCopy()` 清掉该编辑器的本机副本（不删服务端草稿；失败时不要调用），
  避免下次打开同一内容时误报「本机有未同步的修改」。C4 已在手记编辑器接入并单测覆盖（adopt/discard 两动作 + 采用后内容切换）。
