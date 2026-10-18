# P5 · C4 手记独立编辑 + 放课后快捷更新 + 前台站主入口（交付说明）

> 任务：`task-4`（共享任务板）｜负责人：C4 ｜代理：`c4-journal-leisure`
> 日期：2026-10-18 ｜仓库：`/Users/学习/blog/Blogs`（前端 workdir `apps/web`）
> 契约：`docs/agent-deliveries/P5-C0-integration-contract.md` §4.5 / §4.6 / §9.4 / §9.5 / §9.6
> 设计书：`docs/handoff/2026-10-18-p5-creator-workspace-design.md` §2.2 / §2.4 / §2.5 / §五
>
> **完成范围声明**：本次交付的是第一批「站主日常创作体验」中的手记与放课后侧；
> 文章编辑器、完整媒体管理属于后续阶段，不计入本次完成声明。

---

## 一、实际修改/新增文件清单

### 新增（全部在 C4 写作用域内）

| 路径 | 作用 |
| --- | --- |
| `apps/web/app/admin/journal/new/page.tsx` | `/admin/journal/new`（`?date=` / `?returnTo=` / `?entry=`，Suspense + noindex） |
| `apps/web/app/admin/journal/[id]/edit/page.tsx` | `/admin/journal/{id}/edit` 手记独立编辑页 |
| `apps/web/features/journal/editor/model.ts` | 编辑页纯逻辑：日期默认/`?date=`、表单↔草稿 data、校验、提交动作语义、成功/失败文案 |
| `apps/web/features/journal/editor/model.test.ts` | 纯逻辑单测（20 条） |
| `apps/web/features/journal/editor/journal-editor.tsx` | 编辑器主体：主区域日期/标题/正文(Markdown+预览)；次要区域心情/地点/图片/关联文章；保存/公开/更新正式内容 |
| `apps/web/features/journal/editor/journal-editor.test.tsx` | 编辑器组件单测（18 条） |
| `apps/web/features/journal/editor/editor-loaders.tsx` | 两个页面的装载器：站主会话、站点时区今天、已有手记、图片媒体详情、公开文章选项 |
| `apps/web/features/journal/editor/editor-loaders.test.tsx` | 页面级单测（7 条：默认日期/`?date=`/returnTo/entryId/匿名） |
| `apps/web/features/journal/owner-entry.tsx` | 前台站主入口通用件：`useOwnerSession` 条件渲染、`returnTo`、点击去 phone 参数 |
| `apps/web/features/journal/owner-entry.test.tsx` | 入口单测（9 条：匿名不渲染、returnTo 编码、日期参数、点击收浮层；按真实 `window.location` 驱动，不 mock useSearchParams） |
| `apps/web/features/leisure/admin/quick-update.tsx` | `/admin/leisure` 快捷更新区（追番/游戏；明确提交/防重/失败保留/无百分比/通关≠全成就） |
| `apps/web/features/leisure/admin/quick-update.test.tsx` | 快捷更新单测（12 条） |
| `apps/web/features/leisure/admin/return-to-bar.tsx` | 放课后管理页「返回来源」（`returnTo` 校验 + `router.replace`） |
| `apps/web/features/leisure/owner-entry.tsx` | 放课后前台两个站主入口（快速更新进度 / 进入完整编辑） |
| `apps/web/features/leblanc/owner-entry.tsx` | 勒布朗三个站主入口（发布动态 / 写手记 / 更新进度） |

### 修改

| 路径 | 改动 |
| --- | --- |
| `apps/web/features/journal/journal-view.tsx` | 头部加「写手记」站主入口（日历屏带选中日期）；手记阅读屏无需改 |
| `apps/web/features/journal/entry-reading.tsx` | 正文头部加「编辑当前手记」站主入口 |
| `apps/web/features/journal/admin/journal-workspace.tsx` | 保留现有全部能力，新增「新建手记（独立页）」「继续编辑（独立页）」入口 |
| `apps/web/features/journal/journal.module.css` | 编辑页布局/预览/阻塞原因/入口与 44px 触控样式 |
| `apps/web/features/leisure/leisure-view.tsx` | 头部加放课后站主入口 |
| `apps/web/features/leisure/admin/leisure-workspace.tsx` | 顶部插入「返回来源」+「快捷更新」区（完整编辑表单**未改动**） |
| `apps/web/features/leisure/api.ts` | 写请求统一带 `X-CSRF-Token` 头（契约 §9.2；body 保留 `csrf_token` 兼容旧接口） |
| `apps/web/features/leisure/leisure.module.css` | 快捷更新区与站主入口样式 |
| `apps/web/features/leisure/leisure-view.test.tsx` | 两条「第一个请求」断言改为「列表中包含该请求」——前台新增了无副作用站主探针 `/auth/owner-status`，旧断言的前提不再成立（断言意图不变：仍是「公开列表只带 kind」） |
| `apps/web/features/leblanc/leblanc-view.tsx` | 头部后加勒布朗站主入口（匿名时 0 渲染） |
| `apps/web/features/leblanc/leblanc.module.css` | 站主入口样式 |
| `apps/web/app/admin/leisure/page.tsx` | 包 `<Suspense>`（快捷更新区/返回条用 `useSearchParams` 读 `returnTo`） |

未改动他人的文件；未 `git add` / `commit` / `push`。

---

## 二、关键语义与实现说明

### 2.1 手记：先记录，再决定是否公开（设计书 §2.4）

- **新建默认 draft + private**：编辑器初始状态辅助信息显示「草稿 · 仅自己可见」，
  `data-editor-status="draft"` `data-editor-visibility="private"`。
- **「保存」≠「公开」**：
  - 自动保存只写 `work_drafts`（C2 `useWorkDraft`），**绝不** PATCH/POST 正式手记；
  - 「保存草稿」→ `commitWorkDraft(action:"save")`：新建时创建 draft+private，已有正式草稿时更新它，
    **不改变公开状态**；
  - 「公开这篇」→ `commitWorkDraft(action:"publish")`：独立按钮，先过本地发布门槛
    （与后端一致：标题 + 正文非空，缺项集中在 `data-editor-blockers` 列出，点击不会发请求），
    再走既有发布校验；失败保留输入并显示原因。
- **编辑已公开手记**：打开即建/复用工作草稿；打字只 `PATCH work_drafts`；
  界面明写「自动保存只写工作副本；点『更新正式内容』之前，访客看到的仍是原版本」；
  唯一提交按钮是「更新正式内容」（`commit update`，带打开时的正式版本做乐观并发检查）。
- **提交失败/冲突**：412/422/409/428/401 分别给出可行动文案；输入保留、不显示成功；
  同步冲突（草稿版本 412）用 C2 的 `ConflictNotice`（载入最新 / 另存为新草稿）。
- **本机恢复副本**（契约 §9.4，不静默选择）：`recoveryNotice` 出现时页面顶部渲染
  `data-editor-recovery` 动作块：「采用本机修改」「放弃本机修改」；采用后表单如实切到本机内容。
- **成功后**：显示服务端返回的真实结果（草稿/已公开、版本号、幂等回放说明），输入区进入只读，
  给出「继续编辑（打开新的工作副本）」「查看手记（仅已公开）」「返回来源」；
  同时清理该编辑器的本机恢复副本（内容已提交，下次打开不应被误报成「本机有未同步修改」）。
- **图片**：次要区域的「选择图片 / 编辑图片（顺序 / 替代文本）」打开 C3 `MediaPickerDialog`；
  不再出现「输入媒体 ID」的文本框。编辑已有手记时逐张 `GET /admin/media/{id}` 补取媒体详情
  （≤9 次，单张失败只降级该图为「缩略图暂时取不到」，不误判失效）。
- **关联文章**：下拉来自公开文章列表（`GET /posts?limit=30`）；当前已关联的那篇即使不在
  前 30 条也保留为可选项（不因不在当前页被误判「已失效」）。列表读取失败只降级这一项。
- **Markdown 预览**：复用 `features/legacy/markdown` 的 `parseContent` + `MarkdownView`
  （React 节点树，无 `dangerouslySetInnerHTML`）。
- **辅助信息**：状态/可见性/正式版本号/站点时区/今天只放次要区域辅助文本，不占主界面。
- **入口 id（契约 §9.4）**：两个页面都调用 C2 `useEntryId()`，把 `?entry=<uuid>` 写回 URL
  （保留 `date`/`returnTo`），并传给 `useWorkDraft({ entryId })`；刷新后本机副本可恢复。
  `/admin/journal/new` 的 URL 约定：`/admin/journal/new?date=YYYY-MM-DD&returnTo=<encoded>&entry=<uuid>`。

### 2.2 C5 e2e 依赖的 data-* 属性（契约 §9.5）

| 属性 | 位置 | 取值 |
| --- | --- | --- |
| `data-editor="journal"` | 编辑器外壳（C2 EditorShell，传 `contentType`） | 固定 `journal` |
| `data-editor-return` | 编辑器返回按钮（C2 提供） | — |
| `data-editor-field` | 主/次要区域表单控件 | `date` / `title` / `content` / `mood` / `location` |
| `data-editor-status` | 辅助状态文本 | `draft` / `published`（新建→draft；save→draft；publish→published；update 保持发布态；成功后取服务端真实结果） |
| `data-editor-visibility` | 辅助状态文本（**仅手记输出**） | `private` / `public`（新建/保存→private；公开成功→public） |
| `data-editor-submit-action` | 保存/公开/更新按钮 | `save` / `publish` / `update`（语义 = 本次执行的 action） |
| `data-editor-blockers` | 发布阻塞原因列表 | 仅当发布可行且缺项时渲染 |
| `data-editor-error` | 提交失败提示 | — |
| `data-editor-success` | 提交成功面板 | — |
| `data-editor-recovery` | 本机恢复副本动作块（不静默选择） | 含「采用本机修改」`data-workdraft-adopt-local` / 「放弃本机修改」`data-workdraft-discard-local` |
| `data-sync-state` | C2 `SyncStatus` | `idle/local-only/saving/synced/failed/conflict` |
| `data-leisure-quick` / `data-leisure-quick-kind` | 放课后快捷更新区 | `anime` / `game` |
| `data-leisure-quick-submit` / `data-leisure-quick-error` / `data-leisure-quick-success` | 快捷更新提交/失败/成功 | — |
| `data-owner-entry` | 前台入口 | `journal-new` / `journal-edit` / `leisure-quick` / `leblanc-start-moment` / `leblanc-start-journal` / `leblanc-start-leisure`；另加 `leisure-edit`（「进入完整编辑」，契约集合之外的新增值） |

### 2.3 放课后快捷更新（设计书 §2.5 / 契约 §9.6）

- 复用现有 `PATCH /admin/leisure/entries/{id}` + `If-Match: "<version>"`，不改后端契约；
  写请求带 `X-CSRF-Token` 头（§9.2）。
- 追番：`episodes_watched` + `progress`（选项来自现有 `PROGRESS_OPTIONS`，与后端
  `ANIME_PROGRESS` 一致）+ `notes`，`airing` 为「不改 / 连载中 / 已完结」三态（默认不改，
  只有明确选择才进 PATCH，避免顺手把未知的 `airing` 写成 false）。
- 游戏：`progress`（与后端 `GAME_PROGRESS` 一致）+ `playtime_minutes`（累计分钟，整值提交）+ `notes`；
  **PATCH body 里没有 `completed_on` / `all_achievements`**：状态选「通关」不会填通关日期，
  全成就也不会由任何字段推断（界面同时显示这两项的当前真实值并注明在完整编辑里改）。
- 只有点「提交更新」才发请求；提交中按钮禁用 + 同 tick 守卫；失败显示原因（412/422/网络）
  且输入原样保留；成功文案只用服务端返回的 `progress_label` / `episodes_label` /
  `playtime_label` / `version`，不伪造。
- 总集数未知：预览只显示「看到第 N 集」，`data-leisure-quick-ratio="none"`，
  正文不出现 `%`（有单测钉住）。
- 现有完整编辑表单完全保留（名称/封面/评分/通关日期/全成就等仍在那里维护）。

### 2.4 前台站主入口（契约 §4.6 / §9.5）

| 页面 | 入口 | 传入 |
| --- | --- | --- |
| `/apps/journal` 列表 | 写手记 | `/admin/journal/new?returnTo=…` |
| `/apps/journal` 日历 | 写手记 | 同上 + `&date=<选中日期>`（独立参数） |
| `/apps/journal/{id}` 正文 | 编辑当前手记 | `/admin/journal/{id}/edit?returnTo=…` |
| `/apps/leisure` | 快速更新进度 / 进入完整编辑 | `/admin/leisure?quick=1&returnTo=…` / `/admin/leisure?returnTo=…` |
| `/apps/leblanc` | 发布动态 / 写手记 / 更新进度 | `/admin/moments/new` / `/admin/journal/new` / `/admin/leisure?quick=1`，都带 `returnTo` |

- **只在 `useOwnerSession()` 返回 `owner` 后渲染**；`loading`/`anonymous`/`failed` 一律 0 渲染，
  匿名访客**不会**触达 `GET /auth/session`（探针 `/auth/owner-status` 由 C2 负责，前端的匿名分支有单测断言）。
- `returnTo` 由 C2 `withReturnTo` 编码、`safeInternalPath` 白名单校验；非法或缺失时不带该参数。
- **入口刻意不用 `useSearchParams()`**（C5 验收 B3 构建阻断的修复）：入口会出现在
  `/`（首页 Leblanc 区块）、`/apps/leblanc`、`/apps/journal`、`/apps/leisure` 等**静态预渲染**
  页面里，而 `useSearchParams()` 在静态页面上必须包 Suspense 边界，否则 `next build` 在
  prerender 阶段报 `useSearchParams() should be wrapped in a suspense boundary`。
  改为 SSR 安全的 `usePathname()` + 挂载后用 `window.location.search` 计算 returnTo
  （首帧无 returnTo、水合后补齐；`popstate`/站内导航时重新计算），从根上避免了给每个静态
  路由加边界的做法；点击时仍以实时地址为准（并先去掉 phone/screen/item）。
- 点击入口时若 URL 含 `phone` 参数，先用 C2 `stripPhoneContext` 去掉 `phone/screen/item`
  再跳转（returnTo 里**保留**手机三元组，返回时恢复）；
  返回时手记编辑器用 `EditorShell` 的 `data-editor-return`（`router.replace(returnTo)`），
  放课后管理页提供「← 返回来源」条（`router.replace(returnTo)`），均不把编辑器留在后退栈里。
- 入口有 `min-height: 44px` 触控尺寸；不影响访客布局（匿名 0 渲染）。

---

## 三、测试命令与真实结果

环境：`export no_proxy=127.0.0.1,localhost,::1 NO_PROXY=127.0.0.1,localhost,::1`，
workdir `/Users/学习/blog/Blogs/apps/web`。

```sh
# C4 全部域（journal + leisure + leblanc）
npx vitest run features/journal features/leisure features/leblanc
# → Test Files 12 passed (12) · Tests 155 passed (155) · 0 failed

# 分文件（真实数字）
features/journal/api.test.ts                    13
features/journal/journal-view.test.tsx          12   （既有，保持绿）
features/journal/save-screen.test.tsx           15   （既有，保持绿）
features/journal/paths.test.ts                  15   （既有，保持绿）
features/journal/owner-entry.test.tsx            9   （新）
features/journal/editor/model.test.ts            20   （新）
features/journal/editor/journal-editor.test.tsx  18   （新）
features/journal/editor/editor-loaders.test.tsx   7   （新）
features/leisure/paths.test.ts                  14   （既有，保持绿）
features/leisure/leisure-view.test.tsx          13   （既有，保持绿；2 条断言按新增探针调整前提）
features/leisure/admin/quick-update.test.tsx    12   （新）
features/leblanc/leblanc-view.test.tsx           7   （既有，保持绿）
```

```sh
# 类型检查（只对 C4 文件负责）
npx tsc --noEmit
# → C4 相关文件 0 error（当次全树残留的 error 均来自他人并行中的
#    features/ins/editor/moment-editor.test.tsx，属 C3 域，不在本次交付内）

# ESLint（C4 域）
npx eslint features/journal features/leisure features/leblanc app/admin/journal app/admin/leisure
# → 0 error / 0 warning
```

### `next build`（B3 阻断修复后，2026-10-19 实测）

> 说明：沙箱内 Next 会写用户级配置 `~/Library/Preferences/nextjs-nodejs/config.json`，
> 直接被 workspace 沙箱拒绝（`EPERM`，与代码无关）。因此构建时把 `HOME` 指到临时目录；
> **环境变通，不是代码改动**。

```sh
cd apps/web
export NEXT_TELEMETRY_DISABLED=1
HOME=/tmp/pl-c4-home npm run build
# EXIT=0
# ✓ Running next.config.ts took 89ms
# ✓ Compiled successfully in 7.7s
# Finished TypeScript in 7.8s
# ✓ Generating static pages using 9 workers (37/37) in 1934ms
# 关键静态页均在列：○ / · ○ /apps/leblanc · ○ /apps/journal · ○ /apps/leisure
# BUILD_ID = Q7EU_ameraIM5x5tFSUMH
# 日志中 error/Error/Failed 计数 = 0；无 useSearchParams/prerender 报错
```

修复前（C5 与 Lead 主树复现）首个失败页为 `/apps/leblanc`，Lead 另报 `/`；根因是
owner 入口在静态页面上调用 `useSearchParams()`。修复方式见 §2.4（改为
`usePathname()` + 挂载后读 `window.location.search`），未给任何静态路由新增 Suspense 边界，
也未改首页 `app/page.tsx`。本轮 build 在主工作树 `apps/web` 执行（Lead 授权：集成点已到），
`.next` 已更新；C5 仍会用自己的隔离栈重跑 build/e2e 作为最终证据。

### 单测覆盖的验收点映射

| 验收/要求 | 覆盖用例 |
| --- | --- |
| A4 手记无需媒体 ID；普通保存不会意外公开 | `journal-editor.test.tsx`「初始状态 draft+private」「保存只提交 action=save 且成功文案是仅自己可见」「公开是独立动作」 |
| A5 编辑公开内容时自动保存不改匿名视图；明确提交才更新 | `journal-editor.test.tsx`「打字只写工作副本，不发任何提交请求」「只有更新正式内容按钮，明说访客仍看原版本，提交带正式版本」 |
| 日期默认与 `?date=` | `model.test.ts`（默认/合法/非法/站点时区缺失）+ `editor-loaders.test.tsx`（页面级：今天来自 `GET /journal/calendar`、`?date=` 生效、非法回退） |
| 图片接入共享选择器 | `journal-editor.test.tsx`「通过 MediaPickerDialog 选图 → images 进入工作副本」「不再有媒体 ID 文本框」 |
| 快捷更新成功/失败保留/防重/无百分比/通关≠全成就 | `quick-update.test.tsx` 12 条 |
| 入口条件渲染（匿名不渲染）与 returnTo | `owner-entry.test.tsx`「匿名 0 渲染且不请求 /auth/session」「列表入口带 returnTo（保留手机上下文）」「日历 date=」「点击去掉 phone/screen/item，returnTo 保留」 |
| 冲突不静默覆盖 | `journal-editor.test.tsx`「ConflictNotice → reload-latest / save-as-new」 |

---

## 四、未验证项与已知限制（如实单列）

### 未验证（无设备/无联调环境，不能声称通过）

1. **真实触控、软键盘、中文输入法**：无真机。只做了 jsdom 组件行为与触控尺寸 CSS
   （≥44px）静态约束；**不等于真机验证**。中文输入法组合过程（Markdown 正文与快捷更新短评）
   在真实键盘下的表现未验证。
2. **真实浏览器与真实后端联调**：C4 单测使用 fetch 替身与 C2 `useWorkDraft` 替身；
   尚未在隔离栈（8100/3130）用真实 `owner-status` / `work-drafts` / `leisure PATCH` 跑通整条链路
   —— 该联调按计划由 C5 统一执行。
3. **`next build`**：已在 Lead 授权的集成点执行并通过（见 §三「next build」小节，EXIT=0，
   37/37 静态页、BUILD_ID=Q7EU_ameraIM5x5tFSUMH；沙箱 HOME 变通已注明）；最终隔离栈 build
   仍以 C5 重跑为准。
4. **跨设备恢复、断网自动保存、412 冲突的真实浏览器行为**：由 C2 引擎负责并在其交付中验证，
   C4 只在组件层验证了 UI 反应（`ConflictNotice`、同步状态、失败保留）。
5. **320px / 390px 实际浏览器布局**：只写了 CSS 约束（单列、44px），未跑多视口脚本。
6. **HEIC/上传失败等选择器内部行为**：属 C3 域，C4 只验证「选择器能选图并回写」；
   C3 的交付单负责其余。
7. **关联文章真实数据**：只验证了公开列表读取成功/失败两种降级；未在真实数据上验证跨页保留。

### 已知限制 / 设计取舍

1. **编辑已有手记的图片会逐张补取媒体详情**（≤9 次 `GET /admin/media/{id}`）：
   单张失败降级为「缩略图暂时取不到」但仍保留 `media_id+alt`；未在真实媒体库验证过 404/失效图场景。
2. **提交成功后编辑器进入只读态**（显示结果与下一步链接），不自动跳转：
   所有输入控件与提交/丢弃按钮在提交后禁用，**不会对已 committed 的工作草稿继续 PATCH**
   （服务端会 409）；「继续编辑（打开新的工作副本）」跳转到编辑页且不带 `?entry=` 参数，
   C2 `useEntryId()` 会生成新的入口 id 重挂编辑器。成功时按 C2 建议调用 `discardLocalCopy()`
   清理该编辑器的本机副本（只删 localStorage、不动服务端草稿与正式内容，失败路径不调用）。
3. **`airing` 三态选择**（不改/连载中/已完结）：默认「不改」保证只改集数时不会覆盖未知的连载状态。
4. **日历选中日期**只在「日历屏选中某一天」时带入 `date=`；从列表屏进入不带日期（用站点时区今天）。
5. `PROGRESS_OPTIONS` 是后端 `ANIME_PROGRESS` / `GAME_PROGRESS` 的前端镜像（既有实现，
   单测钉住取值顺序），本轮未新增枚举来源。
6. 新增了契约 §9.5 集合之外的 `data-owner-entry="leisure-edit"`（「进入完整编辑」入口的稳定钩子），
   属**增量**属性，不影响既有 e2e 选择器。
7. **B3 构建阻断修复**：owner 入口不再调用 `useSearchParams()`，改用
   `usePathname()` + 挂载后 `window.location.search`（首帧 href 无 returnTo、水合后补齐），
   这是为了静态预渲染（`/`、`/apps/leblanc`、`/apps/journal`、`/apps/leisure`）不必新增
   Suspense 边界；副作用是首帧 DOM 的入口 href 短暂缺少 returnTo（入口本来也要等站主会话
   确认后才渲染，实际不可见）。
8. `data-editor-status` / `data-editor-visibility` 的精确口径按 C0 2026-10-18 补充消息实现
   （两条属性拆分，手记才输出 visibility），已在 §2.2 写明供 C5 e2e 对齐。
