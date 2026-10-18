# P5 · C3 交付：INS 选图优先编辑 + 共享图片选择器 + 前台 INS 站主入口

> 任务：task-3（P5 第一批 · 站主日常创作体验）
> 负责人：C3（INS 与共享图片选择器 owner）
> 日期：2026-10-18/19
> 契约：`docs/agent-deliveries/P5-C0-integration-contract.md`（§4.3 / §4.4 / §4.6 / §9.4 / §9.5）
> 设计书：`docs/handoff/2026-10-18-p5-creator-workspace-design.md`（§2.2 / §2.3 / §3.4 / §五）
> 状态：**实现完成，本域单测/typecheck/lint 全绿；真实浏览器与真机验证未做（见 §7 未验证项）**
>
> 最终声明：本次完成的是第一批「站主日常创作体验」；文章编辑器与完整媒体管理属于后续阶段，
> 不计入本次完成声明。

## 1. 交付范围（实际完成）

### A. 共享图片选择器 `apps/web/features/media-picker/**`（新建）

| 能力 | 实现 |
|---|---|
| 上传新图 | `POST /api/v1/admin/media`（multipart，`file` 字段），**`X-CSRF-Token` 请求头**；兼容表单字段；只有服务端确认 `status:"ready"` 才进入已选，客户端缩略图不算成功 |
| 分页浏览 | `GET /api/v1/admin/media?cursor=&limit=`，`data-media-picker-next` 加载更多；按 media ID 去重；**已选图片不在当前页时按 ID 补取详情**（`GET /admin/media/{id}`），只有 404 才标「已不可用」，不误判失效 |
| 缩略图/尺寸/状态 | `MediaThumb`（w320→w640→w1280 变体优先，失败降级占位）；尺寸 `宽×高` 与上传状态（ready / 处理中 / 失败）统一呈现 |
| 选择/排序/移除/逐图 alt | 已选区顺序 = 数组顺序（`data-media-picker-picked`），上移/下移/移除、`data-media-picker-alt` 逐图替代文本（1–200 字提示，草稿期允许空） |
| 公开引用提示 | `publicly_referenced === true` 时显示「该图片已在其他位置公开：用于私密手记不会撤回其他公开引用」（网格 + 已选区，`data-media-picker-warning`），仍可选择 |
| 超 9 张禁用 | 未选中项 `disabled` + 明确提示「已选满 9 张」；上传/选择都不会突破上限 |
| 失败保留已选 | 上传失败显示真实原因（413/415/422 映射），本地预览保留为「本地预览 · 尚未上传」，已选一张不丢 |
| 关闭不丢已选 | 取消 / Escape / 关闭按钮只调 `onClose`，**只有「确定」才 `onConfirm` 回写**；每次打开从调用方 `selected` 重新初始化 |
| HEIC 明确提示 | 按 MIME + 扩展名识别 HEIC/HEIF，提示「暂不支持…也不会自动转换，请先导出为 JPEG/PNG/WebP」，**不发上传请求**；其他不支持格式同样提示 |
| 触控 44px | CSS 内所有按钮/输入/文件选择 ≥44px（`media-picker.css`），≤620px 全屏单列、sticky 底部操作区 |
| 数据属性 | 契约 §9.5 全部稳定输出：`data-media-picker`、`-open`（编辑器按钮）、`-item`、`-upload`（在 `input[type=file]` 上）、`-confirm`、`-cancel`、`-alt`、`-warning`、`-next`；另加 `-picked`、`-error`、`-retry`、`-max`、`-close` 等辅助钩子 |
| 共享上传函数 | `uploadMedia(file, csrfToken, {signal, includeFormCsrf})` 从 `@/features/media-picker` 导出，C4 可直接复用；`MediaAdminOut`/`PickedImage`/常量/错误翻译一并导出 |

兼容性：**没有删除或替换** `features/ins/admin/media-uploader.tsx`（旧 `/admin/moments` 工作台继续用它），旧测试 11/11 保持绿。

### B. INS 独立编辑页 `/admin/moments/new`、`/admin/moments/[id]/edit`

- 页面容器 `features/ins/editor/moment-editor-page.tsx`（client）：
  - `useOwnerSession` 仅 `owner` 渲染编辑器；匿名只给带 `returnTo` 的登录入口；非 UUID 明确提示且不发请求；
  - `readReturnTo` 读取并校验来源地址（只允许站内白名单），编辑成功/返回都用它；
  - `useEntryId()` 把稳定入口 id 传给 `useWorkDraft`（刷新后本机恢复副本可复用）；「再发一条」生成新 entry 并写回 URL；
  - 编辑已有内容先 `fetchAdminMoment` 读正式内容作为种子（服务端工作草稿存在时由 hook 回填）。
- 编辑器 `features/ins/editor/moment-editor.tsx`：
  - 顺序按设计书：**图片（选图/上传）→ 文字/标签 →（可选）收录到相册 → 预览 → 发布**；未选图也能写文字并保存草稿；
  - 自动保存**只**走 `useWorkDraft`（服务端 `work_drafts`），本文件**不 import** `createMoment`/`updateMoment`/`publishMoment`；
  - 显式动作才调 `commitWorkDraft`：`保存草稿`（新内容/草稿目标 → `save`）、`发布动态`（`publish`）、已发布目标只有 `更新正式内容`（`update`，带 `expected_target_version`）；
  - `commit_key` 固定：同一动作重试复用同一 key（成功或再发一条后清空），连点由 `busy` 防抖；
  - 发布前集中列出全部阻塞原因（`data-editor-blockers`，复用 `validateDraftForPublish` / `validateTagInput` / `validateAlbumLinks`）；失败保留输入、显示 `data-editor-error`，不出现成功页；
  - 提交成功离开编辑状态（`data-editor-success`）：发布成功给「查看动态」（`/apps/ins/{id}`）与「再发一条」；保存草稿给「继续编辑」（→ `/{id}/edit`）；成功后调用 `discardLocalCopy()` 清本机副本（C2 约定，避免下次误报未同步）；
  - 412/428/401/422 有分别的可读文案且强调输入仍在；冲突时 `ConflictNotice`（reload-latest / save-as-new）并禁用提交；
  - 本机恢复副本提示块给「采用本机修改 / 放弃本机载入服务器内容」两个显式动作（契约 §9.4）；
  - 新建相册：`AlbumLinksEditor` 增加**可选** `onCreateAlbum`（不传时保持原链接行为，旧页面零影响）。INS 编辑器传入后：先**发起** `saveNow()`（不 await，保持用户手势避免新标签页被拦截）再 `window.open("/admin/albums", "_blank", "noopener,noreferrer")`；当前页文字/顺序/alt/收录选择都留在内存与工作草稿里，返回后继续；
  - 桌面在 `.admin-shell` 内、≤620px 全屏单列：全部由 C2 `EditorShell` 负责（本页不自己写固定定位）。
- 既有 `/admin/moments` 工作台**保留**：列表页头加「新建动态（独立编辑页）」，每行加「继续编辑（独立页）」，旧工作台的保存/发布/撤回/删除能力不变。

### C. 前台 INS 站主入口

- `features/ins/owner-entry.tsx`：`useOwnerSession` 确认 `owner` 后才渲染 `data-owner-entry="ins-new|ins-edit"`；loading/anonymous/failed 一律不渲染，且匿名不调 `/auth/session`（只打无副作用探针）。
- 列表 `FeedView` 顶部「发布动态」→ `/admin/moments/new?returnTo=<当前路径+查询串>`；详情 `DetailView` 「编辑当前动态」→ `/admin/moments/{id}/edit?returnTo=…`。
- `returnTo` 由 C2 `withReturnTo` 编码，包含来源页、`tag` 筛选与手机 `phone`/`screen`/`item` 上下文；返回时编辑器 `router.replace(returnTo)` 恢复。
- 手机浮层：入口目标地址本身**不含** `phone`/`screen`/`item`，点击后 URL 变化会让 `.pw-wrap` 随路由卸载，编辑器不会被浮层遮挡；完整手机上下文只保存在编码后的 returnTo 里（`data-owner-entry` 已在单测中钉住「目标无 phone 参数 / returnTo 保留手机参数」）。

## 2. 修改/新增文件清单

**新增（`apps/web/features/media-picker/**`）**

- `index.ts`、`types.ts`、`api.ts`、`media-thumb.tsx`、`media-picker-dialog.tsx`、`media-picker.css`
- `types.test.ts`（11）、`media-picker-dialog.test.tsx`（14）

**新增（INS）**

- `features/ins/owner-entry.tsx`、`features/ins/owner-entry.test.tsx`（5）
- `features/ins/editor/draft-data.ts` + `draft-data.test.ts`（13）
- `features/ins/editor/moment-editor.tsx` + `moment-editor.test.tsx`（11）
- `features/ins/editor/moment-editor-page.tsx` + `moment-editor-page.test.tsx`（4）
- `app/admin/moments/new/page.tsx`（服务端 metadata + Suspense + 编辑器）
- `app/admin/moments/[id]/edit/page.tsx`（非 UUID 404 + Suspense + 编辑器）

**修改**

- `features/ins/feed-view.tsx`：列表站主入口
- `features/ins/detail-view.tsx`：详情站主入口
- `features/ins/ins.css`：入口、编辑页、独立编辑入口样式（P5 段落）
- `features/ins/admin/album-links-editor.tsx`：**仅新增可选 prop** `onCreateAlbum`（默认行为不变）
- `features/ins/admin/moment-workspace.tsx`：列表头/每行加独立编辑入口（旧能力不变）
- `app/admin/moments/page.tsx`：页头加「新建动态（独立编辑页）」

未改动：`features/ins/admin/media-uploader.tsx`、`features/ins/api.ts`（旧的正式内容 API 原样保留）、`features/workspace/**`（C2 所有）、后端（C1 所有）。

## 3. 契约/接口使用清单

- `POST /api/v1/admin/media`（multipart，`X-CSRF-Token`）；`GET /api/v1/admin/media`、`GET /api/v1/admin/media/{id}`
- `GET /api/v1/auth/owner-status`（经 C2 `useOwnerSession`）
- `POST /api/v1/admin/work-drafts`、`PATCH /admin/work-drafts/{id}`（经 C2 `useWorkDraft`）
- `POST /api/v1/admin/work-drafts/{id}/commit`（本页直接调 C2 `commitWorkDraft`；`If-Match: "<draft_version>"`、`commit_key` 幂等）
- 读取正式内容：`GET /api/v1/admin/moments/{id}`（既有接口，仅编辑页初始化）
- 相册列表/详情：复用既有 `AlbumLinksEditor`（`/admin/albums`、`/admin/albums/{id}`）

**自动保存与正式内容隔离**：本域代码中不存在把 `createMoment`/`updateMoment`/`publishMoment` 接到输入事件的路径；提交只发生在两个显式按钮的点击处理里。

## 4. 数据属性（C5 e2e 依赖）

- 入口：`data-owner-entry="ins-new|ins-edit"`
- 编辑器：`data-editor="moment"`（C2 EditorShell）、`data-editor-return`、`data-editor-save`、`data-editor-publish`、`data-editor-submit-action="save|publish|update"`（= 该按钮本次将执行的 action）、`data-editor-blockers`、`data-editor-error`、`data-editor-success`、`data-editor-status="draft|published"`（moment 不输出 `data-editor-visibility`）、`data-editor-field="text"`（textarea）、`data-editor-media-empty`、`data-editor-image`、`data-editor-tags`、`data-editor-recovery`（+ `-adopt` / `-discard`）、`data-editor-continue` / `-view` / `-again` / `-back-source`、`data-editor-preview` / `-preview-toggle`
- 选择器：`data-media-picker`、`-open`、`-item`、`-upload`、`-confirm`、`-cancel`、`-alt`、`-warning`、`-next`、`-picked`、`-error`、`-retry`
- 相册收录：复用 `AlbumLinksEditor` 既有 `[data-album-picker]`、`[data-album-admin-link]`（文案「新建相册（新标签页）」不变；INS 编辑器里它是 button，行为=先发起 saveNow 再打开新标签页）
- 同步/冲突：`data-sync-state`、`data-workspace-conflict*`（C2 组件）

## 5. 测试命令与真实结果

```sh
cd /Users/学习/blog/Blogs/apps/web
# 1) 本域（选择器 + INS 全部现有/新增）
npx vitest run features/media-picker features/ins
# → Test Files 18 passed (18) ｜ Tests 190 passed (190)

# 2) 相邻域回归（INS 组件被外部框架复用）
npx vitest run features/gallery app/admin/moments features/phone features/runtime   # 97 passed (97)
npx vitest run features/messaging app/apps                                          # 72 passed (72)

# 3) 类型 / lint（只针对本域；全树 tsc 当时也通过）
npx tsc --noEmit 2>&1 | grep -E "features/(ins|media-picker)|app/admin/moments"    # 无输出（0 错误）
npx eslint features/media-picker features/ins app/admin/moments app/apps/ins      # 无输出（0 问题）
```

新增单测覆盖（与本任务验收项对应）：

| 验收点 | 测试文件 / 用例 |
|---|---|
| 选择器分页 / 翻页后已选不丢 / 按 ID 补取 | `media-picker-dialog.test.tsx`「分页浏览…」「已选图片不在当前列表页…」 |
| 选择顺序 / 上移下移 / 逐图 alt / 移除 | 同上「选择顺序可调整…」「移除已选…」 |
| 超 9 张禁用 / 公开引用提示 / HEIC | 同上「超过上限…」「公开引用提示…」「HEIC…」 |
| 上传 CSRF 头、失败保留已选 | 同上「上传成功…」「上传失败（415）…」 |
| 关闭不丢已选（确认才回写） | 同上「关闭不丢已选：取消不回写…」 |
| 编辑器图像优先 / 未选图保存草稿 | `moment-editor.test.tsx`「首屏以选图为主动作…」 |
| 发布前集中阻塞原因 | 同上「缺图时集中列出阻塞原因…」+ `draft-data.test.ts` |
| 发布失败保留输入 + 固定 commit_key | 同上「发布失败保留输入…重试复用同一个 commit_key」 |
| 发布成功「查看动态 / 再发一条」 | 同上「发布成功提供…」 |
| 新建相册往返不丢草稿（fetch-stub） | 同上「打开相册页前先发起工作草稿保存…」 |
| 编辑已有：工作草稿回填 / 已发布只 update | 同上「工作草稿比正式内容新时回填…」「已发布动态…」 |
| returnTo 生成/校验/手机参数保留 | `moment-editor.test.tsx`「返回按钮用 returnTo…」「非法 returnTo…」；`moment-editor-page.test.tsx`；`owner-entry.test.tsx` |
| 站主入口 owner-only（匿名不调 /auth/session） | `owner-entry.test.tsx` |
| 编辑器 data-* / entryId 稳定入口 | `moment-editor.test.tsx`（属性断言）+ `moment-editor-page.test.tsx`（entry 写回 URL） |

## 6. 与 C1/C2/C4 的接口对齐

- **C2（已定稿）**：使用 `features/workspace/{types,api,session,use-work-draft,use-entry-id,editor-shell,sync-status,conflict-notice,return-context}`；编辑器/hook 全部按现签名接线，未改 C2 文件。提交成功按 C2 约定调用 `discardLocalCopy()`；「再发一条」用 `createEntryId()+withEntryId` 换入口。
- **C1**：只调用契约接口（`/admin/media`、`/admin/work-drafts*`）；`publicly_referenced` 声明为可选，兼容生成类型是否把它并进 `MediaAdminOut`。
- **C4**：`@/features/media-picker` 统一导出 `MediaPickerDialog / MediaThumb / PickedImage / uploadMedia`；dialog 受控、含排序与逐图 alt，C4 编辑器不需要重复实现 alt 编辑。

## 7. 未验证项（单列）

1. **真机触控、软键盘、中文输入法组合过程**：无设备，全部未验证（只有 jsdom 单测 + CSS 尺寸约定）。
2. **真实浏览器 + 真实后端联调**：本域只跑了 fetch-stub；`/admin/moments/new`、`[id]/edit` 的登录 + C1 `work_drafts`/`admin/media` 真接口流程、上传真实图片、发布事务未在浏览器里跑过（由 C5 隔离栈 e2e 覆盖）。
3. **桌面 320/390/620px 视口与 `.pw-wrap` 浮层不遮挡编辑器的 e2e 断言**：未跑浏览器多视口脚本（代码层面由 C2 EditorShell 与入口 URL 设计保证，需 C5 用 `data-owner-entry` / `data-editor` 断言）。
4. **新建相册真实往返**：单测用 `window.open` spy + fetch-stub 验证了「先发起 saveNow、当前页状态不丢」；真实浏览器新标签页 + 相册创建后返回未验证。
5. **跨设备恢复/冲突 UI**：依赖 C2/C1 的实现与单测；编辑器层的 412/冲突展示只用 fetch-stub 覆盖错误路径，真实双设备场景未验证。
6. **登录 returnTo 回跳**：链接已生成，真实登录页回跳未在浏览器验证（C2 负责登录页）。

## 8. 已知取舍

- 「保存草稿」对已发布目标不显示：契约规定已发布动态只能以 `update`（更新正式内容）提交，`save`/`publish` 会被服务端 409；因此已发布编辑页只有「更新正式内容」，没有发布按钮。
- 提交成功（含保存草稿）后离开编辑状态：服务端该工作草稿已 committed，继续 PATCH 会 409；「继续编辑 / 再发一条」都打开新编辑器实例（新工作草稿）。
- 新建内容在「同一 URL 刷新」后靠 `entryId` + 本机副本恢复文字与已上传图片关系；**未上传完成的本地文件刷新后不能恢复**（契约设计书 §3.2 明确「刷新后无法恢复的待上传文件应提示重新选择」，未做额外提示 UI —— 刷新等于编辑器重开，本地预览消失，属于已知行为）。

## 9. 交付后补充

- 全新编辑器且完全没有内容（无文字/标签/图片/收录）时点「保存草稿」：不发请求、不伪造成功，
  明确提示「还没有任何内容：先写点文字或选一张图，再保存草稿」。有文字（未选图）即可保存草稿。
- 最后一次验证（本文件写完后复跑）：`npx vitest run features/media-picker features/ins` → **190/190 通过**；
  `npx tsc --noEmit` 全树 0 错误；`npx eslint features/media-picker features/ins app/admin/moments app/apps/ins` 0 问题。
