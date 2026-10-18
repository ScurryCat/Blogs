# P5 · C0 集成契约（站主创作台 · 第一批）

> 状态：**已完成 · 第一批验收通过**（2026-10-19；提交 `3b0914e` + `9644737`）。
> 最终交付报告：`docs/agent-deliveries/P5-final-report.md`；验收证据：`docs/acceptance/P5-acceptance-report.md`。
> 上游设计书：`docs/handoff/2026-10-18-p5-creator-workspace-design.md`（原文亦见 `/Users/v/Documents/ChatGPT/Blog开发/docs/handoff/`）
> 本文是**实现与验收的唯一接口约定**：C1–C5 都按这里写；实现与本文冲突时先改本文，
> 再改代码（不允许各自发明接口）。
> 日期：2026-10-18 ｜ 集成负责人：C0（Lead）

## 0. 范围与最终交付声明

本轮只做设计书**第一批**：

1. 创作台首页（`/admin`，四项实际任务，无假数据）；
2. INS 与手记编辑体验（选图优先 / 先记录再决定公开）；
3. 可靠草稿（本机恢复副本＋服务端工作草稿、自动保存、版本冲突、跨设备恢复）；
4. 共享图片选择器（上传 / 分页浏览 / 排序 / 替代文本 / 公开引用提示）；
5. 追番与游戏快捷更新（明确提交、失败保留输入）；
6. 前台站主快捷入口（登录后才显示；返回时恢复来源页面、筛选与手机 App 上下文）。

**不做**：文章编辑器、完整媒体管理、相册批量整理、内容关联、草稿历史检索（第二/三批）；
生产部署、真实 AI 接入、访客账号、完整离线应用、新游戏化 App；真机验证（无设备，只做
WebKit 引擎 + 390px/320px 视口，并在交付里如实标注「不等于真机」）。

**最终声明必须包含**：本次完成的是第一批「站主日常创作体验」；文章编辑器与完整媒体管理
属于后续阶段，不计入本次完成声明。

## 1. 基线（C0 已核对）

- 仓库：`/Users/学习/blog/Blogs`（工作目录 `/Users/学习/blog` 的 `Blogs/` 子目录），分支 `main`。
- HEAD：`d99732c`（交接包已同步）；工作树**已有他人的未提交修改**（`apps/web/features/messaging/messaging.css`
  + `docs/agent-deliveries/*` + `tools/*` + 未跟踪 `docs/design-references/frames/`）。
  **这些文件不属于本轮，任何人不得覆盖、回滚或提交它们**；C0 在本轮结束时只提交 P5 相关路径。
- 现有系统：Next.js App Router（`apps/web`，端口 3100 开发 / 3120 隔离）+ FastAPI（`apps/api`，
  `/api/v1`，85 路径 / 36 表 / 迁移单一 head）+ PostgreSQL。管理端已有多套手工保存工作台
  （moments / journal / leisure / albums / projects / skills / exploration / palace / friends）。
- `/admin` **当前没有 `page.tsx`**（404），本轮新建；管理外壳 `app/admin/layout.tsx` 目前只有
  「回到站点」。
- 复用件（不要重造）：`app/core/preconditions.py`（ETag/If-Match/428/412）、
  `app/modules/auth/deps.py`（`require_admin` / `require_admin_write`）、
  `app/modules/media/public_refs.py`（`is_publicly_referenced`）、
  `apps/web/lib/api/client.ts`（`apiRequest` / `ApiClientError` / `If-Match` 支持）、
  `features/ins/api.ts`、`features/journal/api.ts`、`features/leisure/api.ts`、
  `features/ins/admin/media-uploader.tsx`、`features/ins/admin/album-links-editor.tsx`。

## 2. 三个架构决策（先读再写）

### 2.1 两层数据：正式内容 vs 工作草稿

设计书 §3.1 的硬约束：**自动保存禁止调用正式内容更新接口**。

```
[本机恢复副本 localStorage] --(节流/顺序)--> [服务端 work_drafts] --(显式提交/事务)--> [正式内容 moments|journal_entries]
```

- 自动保存只写 `work_drafts`，**永远不写** `moments` / `journal_entries`。
- 「保存」「发布」「更新正式内容」由用户在编辑器里**显式点击**，走 commit 接口（事务 + 双版本检查 + 幂等）。
- 手记：`save` ≠ `publish`。公开必须是独立动作；修改已公开手记先工作副本，`update` 才改正式内容。
- 工作草稿不是公开内容类型：公开列表 / 搜索 / 图库 / 访客接口都不得读到。

### 2.2 INS 以选图为起点

`/admin/moments/new` 打开即进入选图/编辑流程：**选择图片 → 输入文字 →（可选）收录相册 →
预览 → 发布**。不需要先创建正式动态。草稿允许暂时没有图片；发布仍走现有 1–9 张 ready 图片
校验。新建相册往返必须保住草稿（正文 / 顺序 / 替代文本 / 收录选择）。

### 2.3 站主入口与返回上下文

- 前台快捷入口**只在确认站主已登录后展示**。**不得直接复用 `GET /auth/session`**：
  它会给匿名访客建立 10 分钟预登录会话（DB 写放大）。C1 新增无副作用探针
  `GET /api/v1/auth/owner-status`，C2 用一次请求 + 模块级缓存（`useOwnerSession`）；
  在确认 `authenticated===true` 之前**什么都不渲染**。隐藏入口不是授权，后端仍校验。
- 入口链接统一带 `returnTo=<内部路径+查询串>`；返回时仅允许站内目标（白名单见 §4.6）。
- 手机 App 上下文通过 `returnTo` 里的完整 URL（含 phone deep-link 的 `phone`/`screen`/`item` 等
  查询参数）保存与恢复，**不改手机宿主文件**。点击入口时若手机浮层正打开，必须先关闭浮层/
  去掉 phone 参数再跳转（否则编辑器被浮层遮挡）；返回时用 returnTo 恢复 phone 三元组。
- 编辑页在真实手机浏览器里全屏单列（见 §4.8），桌面端在管理外壳内。
- 创作台内部切换使用轻量反馈，不播放全屏过场、不创建第二个音乐播放器。

## 3. 后端契约（C1 实现；C0 已预留模块位）

### 3.1 新模块 `app/modules/work_drafts/`

C0 已完成登记（`router.py` 的 `MODULE_ROUTER_TARGETS`、`model_registry.py` 的 `MODEL_MODULES`）。
C1 在 `app/modules/work_drafts/` 下实现 `models.py / schemas.py / service.py / router.py`，
并新增**一个** Alembic 迁移（`down_revision` = 当前 head）。表结构至少满足设计书 §3.1：

`work_drafts`
- `id uuid pk`
- `owner_id uuid not null → admin_users.id ondelete RESTRICT`
- `content_type varchar(16) not null check in ('moment','journal')`
- `target_id uuid null`（新内容为空；无外键多态，按 content_type 由 service 解析）
- `target_version integer null`（开始编辑时的正式内容版本；新内容为空）
- `data jsonb not null default '{}'`（按 content_type 校验的编辑数据，见 §3.3）
- `status varchar(16) not null default 'active' check in ('active','committed','discarded')`
- `commit_key uuid null`（最近一次提交的幂等键）
- `committed_target_id uuid null`（提交产生的正式内容 ID，幂等回放用）
- `committed_target_version integer null`（幂等回放返回的正式内容版本）
- `created_at / updated_at timestamptz not null`
- 有效草稿唯一性：partial unique index `(owner_id, content_type, target_id) WHERE target_id IS NOT NULL AND status='active'`
  —— 同一站主编辑同一已有内容复用一份有效草稿；新内容允许有多份。
- 幂等键唯一性：partial unique index `(owner_id, commit_key) WHERE commit_key IS NOT NULL`
  —— 跨草稿重复使用同一 key 直接 409，避免错误回放别人的结果。
- 列表索引 `(owner_id, content_type, updated_at DESC, id DESC)`（分页用）。

`work_draft_media`（图片保留关系；不要塞进 jsonb）
- `draft_id uuid → work_drafts.id ondelete CASCADE`
- `media_id uuid → media.id ondelete RESTRICT`
- `position integer not null`（0–8）
- `alt varchar(200) not null default ''`（草稿允许空 alt；发布时按正式规则校验）
- 复合主键 `(draft_id, media_id)`；唯一 `(draft_id, position)`；索引 `media_id`（删除/引用检查反向查）。

迁移要求：可 upgrade/downgrade、不丢旧数据/旧公开范围/相册来源关系；`test_migration_sync` 通过。

### 3.2 接口（全部在 `/api/v1/admin/work-drafts`）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/admin/work-drafts` | admin_write | 创建或恢复工作草稿 |
| GET | `/admin/work-drafts?content_type=&cursor=&limit=` | admin | 列表（仅本人 active；updated_at 倒序；分页 `{items,next_cursor}`） |
| GET | `/admin/work-drafts/{id}` | admin | 详情 |
| PATCH | `/admin/work-drafts/{id}` | admin_write + `If-Match: "<draft_version>"` | 保存工作副本 |
| POST | `/admin/work-drafts/{id}/commit` | admin_write + `If-Match: "<draft_version>"` | 显式提交（事务/双版本/幂等） |
| DELETE | `/admin/work-drafts/{id}` | admin_write | 丢弃工作草稿（204；不动正式内容与媒体文件） |

错误沿用全局格式 `{error:{code,message,fields},request_id}`：401 未登录、404 非本人/不存在、
409 状态冲突、412 VERSION_CONFLICT、428 PRECONDITION_REQUIRED、422 VALIDATION_FAILED（按字段）。

### 3.3 DTO（字段名 snake_case，与现有契约一致）

`WorkDraftOut`
```json
{
  "id": "uuid",
  "content_type": "moment|journal",
  "target_id": "uuid|null",
  "target_version": 1,
  "draft_version": 1,
  "status": "active",
  "summary": "用于列表展示的一行摘要（服务端派生，≤120 字符）",
  "data": { "...": "见下" },
  "images": [
    { "media_id": "uuid", "position": 0, "alt": "", "media": { ...MediaAdminOut } }
  ],
  "created_at": "ISO8601",
  "updated_at": "ISO8601"
}
```
响应带 `ETag: "<draft_version>"`（创建/详情/PATCH 均带）。

`data` 按 content_type：
- `moment`：`{"text": string, "tags": [string], "album_links": [{"album_id": uuid, "media_ids": [uuid]}]}`
- `journal`：`{"entry_date": "YYYY-MM-DD", "title": string, "content_md": string, "mood": string,
  "location": string, "post_id": uuid|null}`

草稿期校验（宽松、只为防坏数据；发布门槛仍由正式规则负责）：长度上限与正式一致（moment text≤2000、
tags≤8 且≤24 码点；journal title≤200 / content≤20000 / mood≤24 / location≤80）、date 合法、
媒体必须属于本站主且 ready 未删除（否则 422）。未提供的 data 键保留旧值；`images` **省略**=不动，
**给出数组**=整组替换（顺序即 position）。未知键 → 422。

`POST /admin/work-drafts` body：`{content_type, target_id?, data?, images?}`。
已有 target 且存在 active 草稿 → **返回既有草稿**（200，`reused:true`）；否则新建（201，`reused:false`）。
target 不存在 / 不属于站主 → 404。`target_version`/`target_id`/`status` 由服务端写，不允许客户端指定。

`POST /admin/work-drafts/{id}/commit` body：
```json
{ "action": "save|publish|update", "expected_target_version": 3, "commit_key": "uuid" }
```
允许的动作（服务端强制，不合法 → 409 并说明可行动作）：
- moment：无 target → `save`（建正式草稿）/ `publish`（建并发布）；target 为 draft → `save` / `publish`；
  target 为 published → `update`（明确更新公开内容）/ `publish`（重新发布无意义 → 409）。
- journal：无 target → `save`（建 draft+private）/ `publish`（建并发布+public）；
  target 为 draft → `save` / `publish`；target 为 published → `update`（已公开，必须以「更新正式内容」提交）。
- `save` 只写正式草稿（moment draft / journal draft+private），**不得改变公开状态**。
- `publish` 复用各内容类型既有发布校验（moment 1–9 ready 图；journal 既有发布门槛），失败 → 422 带字段，
  草稿保持 active、正式内容不变。
- 已有 target：`expected_target_version` 必须等于正式内容当前版本（不一致 412）；缺失 → 428/422（字段
  `expected_target_version`）。新内容：必须为 null。
- 事务：正式行 + 媒体关系 + 动态相册收录来源 + 草稿状态在**同一事务**内提交（service 不留内部独立 commit），
  失败整体回滚。
- 幂等：同一 `commit_key` 重复提交同一草稿 → 200 回放上次结果（`idempotent_replay:true`），
  不产生重复内容/重复收录关系；不同 key 且已 committed → 409。commit_key 为必填 uuid。

`CommitResultOut`
```json
{
  "draft_id": "uuid",
  "content_type": "moment|journal",
  "target_id": "uuid",
  "target_version": 4,
  "status": "draft|published",
  "visibility": "private|public|null",
  "action": "save|publish|update",
  "idempotent_replay": false
}
```

`DELETE`：active → discarded（删除 `work_draft_media` 行，保留草稿行便于审计），204；已丢弃/已提交 → 409。
**只解除关系，不删除 media 文件**；不影响正式内容与其他媒体引用。

### 3.4 媒体管理接口（C1 在 `media` 模块补）：

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/admin/media?cursor=&limit=&status=&q=` | admin | 站主媒体分页（created_at 倒序）；`q` 可选按 id 前缀/文件名无关（文件名不入库，可省） |
| GET | `/admin/media/{id}` | admin | 详情（含 `publicly_referenced` 与尺寸/状态） |

列表项 = `MediaAdminOut` + `publicly_referenced: boolean`（用 `public_refs.is_publicly_referenced`，
须批量查询避免 N+1；只读、带公开条件）。公开引用提示文案由前端呈现：
「该图片已在其他位置公开：用于私密手记不会撤回其他公开引用」。
上传仍用现有 `POST /admin/media`（不要改其契约）。

### 3.5 契约同步（C1 负责）

- 新增路由后运行 `uv run --project apps/api python apps/api/scripts/export_openapi.py` 更新
  `contracts/openapi.json`；再在 `apps/web` 运行 `npm run gen:api` 更新
  `apps/web/lib/api/generated/schema.ts`（生成文件，其他人不得手改）。
- 同步更新 README/接口说明（后端模块 docstring 已足够时按现有惯例），并在交付单列出迁移与接口清单。

## 4. 前端契约

### 4.1 路由（新增）

| 路由 | 组件 | owner |
|---|---|---|
| `/admin` | 创作台首页 `WorkspaceHome` | C2 |
| `/admin/moments/new` | INS 独立编辑页（新建） | C3 |
| `/admin/moments/[id]/edit` | INS 独立编辑页（编辑已有） | C3 |
| `/admin/journal/new` | 手记独立编辑页（新建，`?date=YYYY-MM-DD` 可选） | C4 |
| `/admin/journal/[id]/edit` | 手记独立编辑页（编辑已有） | C4 |
| `/admin/leisure`（改造） | 保留现有完整编辑，新增「快捷更新」区 | C4 |

现有 `/admin/moments`、`/admin/moments/[id]`、`/admin/journal` 保持可用（列表页可加「新建/继续编辑」
入口，但不得删掉现有能力）。页面 `metadata` 加 `robots:{index:false,follow:false}`。

### 4.2 共享前端模块 `apps/web/features/workspace/`（C2 唯一 owner）

必须导出（名字即契约，C3/C4 只 import 这些）：

```ts
// types.ts
export type ContentType = "moment" | "journal";
export type DraftAction = "save" | "publish" | "update";
export interface PickedImage { media_id: string; alt: string; position?: number; media?: MediaAdminOut; }
export interface WorkDraft { id: string; content_type: ContentType; target_id: string | null;
  target_version: number | null; draft_version: number; status: "active";
  summary: string; data: Record<string, unknown>; images: PickedImage[]; created_at: string; updated_at: string; }
export interface CommitResult { draft_id: string; content_type: ContentType; target_id: string;
  target_version: number; status: "draft" | "published";
  visibility: "private" | "public" | null; action: DraftAction; idempotent_replay: boolean; }
export type SyncState = "local-only" | "saving" | "synced" | "failed" | "conflict" | "idle";

// api.ts（全部走 lib/api/client.ts，写请求带 CSRF）
export function createWorkDraft(csrf: string, body: {...}, signal?): Promise<{draft: WorkDraft; reused: boolean}>;
export function listWorkDrafts(opts: {contentType?: ContentType; cursor?: string | null; limit?: number}, signal?): Promise<Page<WorkDraft>>;
export function getWorkDraft(id: string, signal?): Promise<WorkDraft>;
export function updateWorkDraft(csrf: string, id: string, draftVersion: number,
  patch: {data?: Record<string, unknown>; images?: PickedImage[]}, signal?): Promise<WorkDraft>;
export function commitWorkDraft(csrf: string, id: string, draftVersion: number,
  body: {action: DraftAction; expectedTargetVersion: number | null; commitKey: string}, signal?): Promise<CommitResult>;
export function discardWorkDraft(csrf: string, id: string, signal?): Promise<void>;

// use-work-draft.ts —— 自动保存引擎（C3/C4 在编辑器里唯一入口）
export function useWorkDraft(options: {
  contentType: ContentType;
  targetId: string | null;
  enabled: boolean;                 // 会话就绪后才启用
  ownerId: string | null;
  initialData: Record<string, unknown>;
  initialImages: PickedImage[];
  debounceMs?: number;              // 默认 1000
  maxWaitMs?: number;               // 默认 5000
  returnTo?: string | null;
}): {
  draft: WorkDraft | null;
  state: SyncState;
  syncMessage: string;              // 面向用户的中文状态文案（安静提示用）
  recoveryNotice: string | null;    // 本机恢复副本被采用时的说明
  update(next: {data?: Record<string, unknown>; images?: PickedImage[]}): void;
  saveNow(): Promise<WorkDraft | null>;
  discard(): Promise<void>;
  resolveConflict(choice: "reload-latest" | "save-as-new"): Promise<void>;
  lastSyncedAt: string | null;
};

// sync-status.tsx
export function SyncStatus(props: {state: SyncState; message: string; lastSyncedAt?: string | null}): ReactNode;

// conflict-notice.tsx
export function ConflictNotice(props: {onReload: () => void; onSaveAsNew: () => void; message?: string}): ReactNode;

// return-context.ts
export function withReturnTo(href: string, returnTo: string): string;
export function readReturnTo(searchParams: URLSearchParams): string | null;  // 已校验
export function safeInternalPath(value: string | null | undefined): string | null;

// editor-shell.tsx
export function EditorShell(props: {title: string; subtitle?: string; returnTo: string | null;
  children: ReactNode; actions: ReactNode; status?: ReactNode}): ReactNode;

// session.ts
export function useOwnerSession(): { status: "loading"|"anonymous"|"owner"|"failed"; session: SessionStatus | null };
```

`useWorkDraft` 行为要求（设计书 §3.2，C2 的单测必须逐条覆盖）：
1. 停止输入约 1s 自动保存；持续输入最长约 5s 提交一次；同一草稿保存请求**串行**，旧响应不得覆盖新输入
   （用服务端 `draft_version` + 本地单调序号双重防乱序）。
2. 首次保存前先 `POST /admin/work-drafts` 建草稿（已有 target 复用）；之后 `PATCH` 带 If-Match。
3. 本机恢复副本：仅登录站主可写/读，key = `pl.workdraft.v1.<ownerId>.<contentType>.<targetId|new>.<targetId ?? 入口时间戳>`
   ——新内容每次打开编辑器生成新的入口 id，避免串稿；存 `{data, images, draftId, draftVersion, savedAt, returnTo}`；
   刷新后恢复文字与已上传图片关系；**未登录不读取、不展示**；主动退出登录清除全部 `pl.workdraft.v1.` 前缀。
4. 状态：`local-only`（仅本机）/ `saving` / `synced`（服务端确认后才可说「可在另一设备继续编辑」）/ `failed` / `conflict`。
5. 412：**暂停自动保存**，保留本地输入，提供「另存为新草稿」「放弃本机修改，载入最新版本」；
   `reload-latest` 用最新服务端草稿替换本地；`save-as-new` 用本地内容新建草稿（原草稿不覆盖）。
6. 网络失败：保留本机内容，`failed` 状态与重试；恢复后先读版本，不直接覆盖服务端。
7. 丢弃草稿后清本机副本；自动保存**不得**改变正式内容与公开状态。

### 4.3 共享图片选择器 `apps/web/features/media-picker/`（C3 唯一 owner）

导出给 C4 使用（名字即契约）：
```ts
export interface MediaPickerItem { media_id: string; alt: string; position?: number; media: MediaAdminOut; }
export function MediaPickerDialog(props: {
  open: boolean; csrfToken: string; selected: PickedImage[];
  onConfirm(next: PickedImage[]): void; onClose(): void;
  max?: number;                 // 默认 9
  allowUpload?: boolean;        // 默认 true
}): ReactNode;
// 缩略图 URL / 尺寸 / 上传状态 / 公开引用提示统一由选择器内部呈现
export function MediaThumb(props: {media: MediaAdminOut; size?: "sm"|"md"}): ReactNode;
```
要求：上传新图（POST /admin/media，multipart，CSRF）、分页浏览（GET /admin/media，cursor）、
缩略图/尺寸/上传状态、选择/排序/移除/逐图替代文本（顺序=数组顺序）、
`publicly_referenced` 时提示「该图片已在其他位置公开」、超 9 张禁用选择、失败保留已选、
关闭不丢当前已选（确认才回写）。HEIC 等不支持格式明确提示，不承诺自动转换。触控目标 ≥44px。

### 4.4 INS 编辑页（C3）

- 首屏以选图/上传为主动作；未选图也能写文字与保存草稿；发布按钮在缺图/校验失败时**集中列出阻塞原因**。
- 多图选择、排序、移除、逐图替代文本；草稿保存走 `useWorkDraft`（绝不调用正式更新接口）。
- 「收录到相册」复用 `AlbumLinksEditor` 语义（可留到选中图片之后）；新建相册流程离开前先 `saveNow()`，
  返回后恢复文字/顺序/alt/收录选择（用本机恢复副本 + 工作草稿；不允许先建正式动态）。
- 发布：显式按钮 → 本地发布校验（复用 `validateDraftForPublish` 与 `validateAlbumLinks`）→ commit(`publish`)；
  成功提供「查看动态」与「再发一条」；失败保留输入，不显示虚假成功。连点/重试：`commit_key` 固定到该次提交，
  重试复用同一 key。
- 预览：发布前可看文字/图片顺序/收录摘要（不必整站渲染）。
- 手机（真实浏览器）全屏单列；桌面在管理外壳内，不塞进斜屏手机。

### 4.5 手记编辑页 + 放课后快捷更新（C4）

手记：
- 主区域：日期（默认站点时区今天；从日历进入用 `?date=`）、标题、正文（Markdown＋预览）；
  次要区域：心情/地点/图片（共享选择器，不再输媒体 ID）/关联文章。
- 新默认 draft+private；「保存」≠「公开」；公开是独立明确动作（commit publish），走既有发布校验。
- 编辑已公开手记：打开即建/复用工作草稿；明确「更新正式内容」前访客看到原版本（commit update）。
- 访客阅读系统不改。

放课后（`/admin/leisure`）：
- 追番快捷更新：集数、状态、短评；游戏：状态、游玩时长记录、短评；名称/封面等完整信息仍回现有完整编辑。
- 用户明确确认提交（不采用输入即改公开记录）；失败保留输入、不显示成功；总集数未知不生成百分比；
  「通关」与「全成就」不互相推断。用现有 leisure 写接口（If-Match 版本）+ 双击防重。

### 4.6 前台快捷入口（按模块归属）

| 页面 | 入口（仅 owner 登录后） | owner |
|---|---|---|
| INS 列表 | 发布动态 → `/admin/moments/new?returnTo=…` | C3 |
| INS 详情 | 编辑当前动态 → `/admin/moments/{id}/edit?returnTo=…` | C3 |
| 手记列表/日历 | 写手记 → `/admin/journal/new?returnTo=…`（日历选中日期 → 再带 `date=`） | C4 |
| 手记正文 | 编辑当前手记 → `/admin/journal/{id}/edit?returnTo=…` | C4 |
| 放课后 | 快速更新进度（弹层/内联）+ 进入完整编辑 | C4 |
| 勒布朗生活总览 | 选择发布动态 / 写手记 / 更新进度 | C4（页面在 `features/leblanc`） |

`returnTo` 规则（`safeInternalPath`）：仅接受以单个 `/` 开头、不以 `//` 开头、无协议/主机的站内路径，
编码放 query；返回按钮与编辑成功后「返回来源」都用它；无 returnTo 或非法 → 回 `/admin`。
入口必须放在现有页面的可访问位置，不破坏访客布局/测试；仅客户端条件渲染（不得让公开页变成需登录）。

### 4.7 创作台首页（C2）

`/admin`：四项任务区块——① 开始记录（发布动态/写手记/更新追番/游戏）；② 继续编辑（工作草稿列表：
类型、摘要/标题、最近同步时间；空则说明从哪开始）；③ 近期内容（最近保存/发布，编辑+预览）；
④ 内容管理（链到相册/作品/友链等已有管理页）。**不使用假统计、占位动态、虚构通知**；
未登录给登录入口；所有取数失败如实显示。管理外壳导航补「创作台」等链接（C2 唯一 owner）。

### 4.8 视觉与可访问性

延续 P5 黑白红、剪贴标题、粗边框、选中反色；正文输入区平直稳定（无透视/倾斜）；中文正文无衬线；
保存反馈安静（不弹窗/不播提示音）；手机触控目标 ≥44px；软键盘弹出后光标与关键操作可见可达；
数据库 ID/版本号不占主界面（可放在二次入口/辅助文本）。

## 5. 文件所有权（写作用域，避免并发冲突）

| owner | 可写路径 |
|---|---|
| **C0（Lead）** | `docs/agent-deliveries/P5-*.md`、`docs/handoff/*`、`contracts/openapi.json`（合并时核对）、`app/router.py`、`app/model_registry.py`、最终集成提交 |
| **C1** | `apps/api/**`（含新模块、迁移、测试）、`apps/api/scripts/**`；生成 `contracts/openapi.json` 与 `apps/web/lib/api/generated/schema.ts`（生成文件） |
| **C2** | `apps/web/features/workspace/**`、`apps/web/app/admin/page.tsx`、`apps/web/app/admin/layout.tsx`、`apps/web/features/auth/**`（仅 logout 清本机副本需要的改动）、`apps/web/app/globals.css`（仅新外壳所需的少量样式） |
| **C3** | `apps/web/features/media-picker/**`、`apps/web/features/ins/**`、`apps/web/app/admin/moments/**`、`apps/web/app/apps/ins/**` |
| **C4** | `apps/web/features/journal/**`、`apps/web/app/admin/journal/**`、`apps/web/app/apps/journal/**`、`apps/web/features/leisure/**`、`apps/web/app/admin/leisure/**`、`apps/web/app/apps/leisure/**`、`apps/web/features/leblanc/**` |
| **C5** | `tools/**`（新增验证脚本）、`docs/acceptance/**`（证据与验收报告）；对源码只读 |

跨域需要改别人文件时：先给 C0 发消息说明，C0 协调或由对方改；**不要直接写别人的文件**。

## 6. 验收映射（设计书 §五 → 检查）

| # | 验收项 | owner | 检查方式 |
|---|---|---|---|
| A1 | 访客看不到管理入口；直接请求管理接口无法越权 | C1/C2/C3/C4/C5 | 后端 401 测试 + 浏览器匿名检查 + 入口条件渲染测试 |
| A2 | 从前台进入编辑再返回，来源页/筛选/手机上下文正确恢复 | C3/C4/C5 | 浏览器 e2e：INS/手记/放课后/勒布朗 各一条 |
| A3 | INS 多图上传/排序/替代文本/相册收录；新建相册往返不丢草稿 | C3/C5 | 前端单测 + 浏览器 e2e |
| A4 | 手记无需媒体 ID；普通保存不会意外公开 | C4/C1 | 前端单测 + 后端提交语义测试 |
| A5 | 编辑公开内容时自动保存不改匿名视图；明确提交才更新 | C1/C2/C3/C4 | 后端测试 + e2e（保存前后匿名 GET 对比） |
| A6 | 跨设备恢复已同步草稿；版本冲突不静默覆盖 | C1/C2/C5 | 后端 412 测试 + 前端乱序/冲突单测 + e2e 两个浏览器上下文（或用 API 直连模拟第二设备） |
| A7 | 断网/刷新/登录失效/上传失败有准确反馈与恢复 | C2/C3/C4/C5 | 前端单测（mock 网络失败）+ e2e 断网 CDP |
| A8 | 重复提交不生成重复内容/收录关系；失败不产生半完成关系 | C1/C5 | 后端幂等+回滚测试 |
| A9 | 私密草稿图片不能匿名访问；丢弃草稿不破坏其他引用 | C1/C5 | 后端测试（匿名 GET media 404）+ e2e |
| A10 | 动态撤回/重发/相册移除/多来源引用无回归 | C1/C5 | 现有后端回归 + `/admin/moments` 现有流程 e2e |
| A11 | 媒体/相册分页正常；选中对象不在当前页不误判失效 | C3/C5 | 前端分页单测 + e2e |
| A12 | 追番/游戏更新失败不显示虚假成功 | C4 | 前端单测 + e2e |
| B1 | 桌面键盘 + 320/390 小屏布局 | C3/C4/C5 | 浏览器多视口脚本（320/390） |
| B2 | 真机触控/软键盘/中文输入法 | — | **无设备：只做 WebKit+视口，如实标未验证** |
| B3 | 前后端测试、类型检查、lint、构建 | 全体/C0 | `tools/verify-all.sh --fast` + `npm run build` |
| B4 | 隔离库验证迁移/旧数据保留/回退 | C1/C5 | 新迁移 upgrade→downgrade→upgrade + 旧数据保留断言 |
| B5 | 端到端写测试用独立数据 | C5 | 隔离栈 55434/8130/3130 + 测试内容，不写共享库 |

## 7. 验证命令与环境（C5 维护）

```sh
# 本机常驻：8000 旧静态站、8100 dev API、3100 next start 验证站、55432 dev PG（勿杀）
bash tools/verify-all.sh --fast            # 静态审计 + typecheck/lint/单测（~1-2 分钟）
bash tools/verify-all.sh --e2e             # 后端全树 + T02 + 多视口 + 端到端
bash tools/verify-all.sh --e2e --mobile    # + 手机全屏 390×844

# 后端单点
cd apps/api && uv run pytest tests/ -x -q
# 前端单点（只跑自己的，不整树）
cd apps/web && npx vitest run features/workspace features/ins features/journal features/leisure features/media-picker
# 类型/构建（合并前 C0 跑整树）
cd apps/web && npm run typecheck && npm run lint && npm run build
```

- 写型 e2e 用隔离栈：`bash tools/e2e-stack.sh up`（55434/8130/3130，每次 up 重建数据库）；
  **不得**在共享库/共享测试库做破坏性试验；测试内容不污染站主真实内容。
- 系统代理坑：脚本统一 no_proxy（新脚本照抄现有 `tools/*.py` 的 `_no_proxy()`）。
- 任何失败如实记录；不得用「部分还原」「模拟通过」替代真实结果。

## 8. 协作与交付规则

1. 先读本文 + 设计书 + `docs/agent-deliveries/HANDOFF.md`；有冲突立即发消息给 C0。
2. 不 `git commit`、不 `git push`、不覆盖他人未提交修改；C0 统一提交。
3. 每完成一个可验收步骤就更新共享任务板状态；交付说明写到各自结果文件的**独立路径**
   （C1 `docs/agent-deliveries/P5-C1-backend.md`，C2 `P5-C2-*.md`，C3 `P5-C3-*.md`，C4 `P5-C4-*.md`，C5 `P5-C5-acceptance.md`）。
4. 每个任务交付必须包含：实际修改清单、接口与迁移说明、关键流程截图（浏览器脚本产物放 `.dsh/screenshots/p5-*`）、
   测试命令与结果、**未验证设备与未完成事项**单列。
5. 自测范围：改到哪测到哪；把失败与已知风险在消息里说清楚，不许静默跳过。
6. 合并顺序：C1+C2 落地 → C3+C4 接入 → C5 集中验收 → C0 全量验证与最终提交。

---

## 9. 补充决策（recon 完成后定稿，与上文同等效力）

### 9.1 新增鉴权探针（C1）

`GET /api/v1/auth/owner-status`（auth 模块，读会话但**不创建预登录会话、不写字**）：

```json
{ "authenticated": true, "user": { "id": "uuid", "username": "owner" } }
```

未登录返回 `{"authenticated": false, "user": null}`（200）。响应 `private, no-store`。
C2 的 `useOwnerSession` 用它；**不得**在访客页面调用 `GET /auth/session`（会给每个访客建 DB 行）。

### 9.2 自动保存的 CSRF 方式（C1/C2）

`core/csrf.py` 只在 JSON body ≤ 4096 字节时读 body 里的 `csrf_token`；长手记正文会超限。
因此：

- C2 给 `lib/api/client.ts` 的 `ApiRequestOptions` 增加 `headers?: Record<string, string>`，
  写请求统一带 `X-CSRF-Token` 请求头（body 里可继续保留 csrf_token 兼容旧接口，但**不依赖**它）。
- C3 共享上传函数、C4 手记提交等所有新写请求：**必须**带 `X-CSRF-Token` 头。
- C1 的 work_drafts/media 新接口按 `require_admin_write` 实现（已支持 header）。

### 9.3 原子版本检查与幂等顺序（C1，必须逐条测试）

1. `PATCH /admin/work-drafts/{id}`：事务内 `SELECT ... FOR UPDATE` 锁草稿行，再比对 `If-Match` 的
   `draft_version`；不一致 412 回滚。两个并发 autosave 不得都成功（后到者 412）。
2. `commit`：事务内先锁草稿行；**幂等回放优先于 If-Match 校验**：
   a. 若草稿 `status='committed'` 且 `commit_key` == 请求 key → 直接返回 `CommitResultOut`
      （`idempotent_replay:true`，正式内容版本取 `committed_target_version`），不再校验 If-Match
      —— 网络重试携带旧 If-Match 是常态，不能因此 412。
   b. 若草稿 `status='committed'` 且 key 不同 → 409。
   c. 若 `commit_key` 已被**其他**草稿使用（(owner_id, commit_key) 唯一）→ 409。
   d. 否则校验 If-Match、action、expected_target_version，再在**同一事务**内：锁正式内容行
      （`SELECT ... FOR UPDATE` 或 `UPDATE ... WHERE version=expected` 行数检查）、应用数据、
      同步媒体关系、动态→相册来源（复用 `gallery.sources`，diff 幂等）、发布状态、`bump_version`、
      写草稿 `status/committed_*`，最后一次性 `session.commit()`。
3. 失败：任何校验/写入异常 → `session.rollback()`，草稿保持 active、正式内容不变，返回对应错误。
4. `DELETE`（丢弃）同样先锁草稿行；active→discarded + 删除 `work_draft_media` 行，单事务提交。
5. 草稿 PATCH 的宽松校验：允许 `alt=''`、允许 0 张图、允许 data 缺省；但媒体必须属于站主且 ready
   未删除，长度上限与正式一致；未知 data 键 422；`images` 省略=不动、给出=整组替换。
6. 事件顺序测试：并发两个 PATCH 只有一个成功；同 commit_key 网络重试只产生一条正式内容且回放；
   不同 key 二次提交 409；commit 失败（如发布校验不过/模拟事务异常）后正式内容与相册来源不变。

### 9.4 前端草稿生命周期（C2）

- 编辑器打开：先读正式内容（编辑已有）作为 initial；`useWorkDraft` 仅在**有 target 时**立即
  `POST /admin/work-drafts` 复用/创建（以便跨设备继续），**新内容**在第一次真实输入或选图后才创建
  （避免空的「继续编辑」条目）。
- 本机恢复副本与服务器草稿同时存在时：取 `savedAt` 更新的一方作为初始内容；不一致时显示
  「本机有未同步的修改」与「采用本机 / 放弃本机」两个动作（不静默选择）。
- 自动保存状态机：`local-only`（本机副本已写、服务端未确认）→ `saving` → `synced`/`failed`；
  `conflict` 时**暂停**自动保存，呈现 `ConflictNotice`。`synced` 才允许文案「可在另一设备继续编辑」。
- 轮询/顺序：同一草稿请求串行队列 + 本地单调 `seq`；响应携带的 `draft_version` 小于本地最新
  已发送版本时丢弃响应（旧响应不能覆盖新输入）。网络失败保留本机内容并显示重试，不自动重发写请求。
- 会话失效（401）：停止自动保存，显示「登录已失效，本机输入已保留」+ 去登录链接（带 returnTo）。
- 主动退出登录：`clearAllWorkDraftLocalCopies()`；未登录不读取、不展示任何本机草稿正文。
- 编辑器 `beforeunload`：仅有未同步本机改动时提示（安静、只一次）。
- **入口 id（entryId）**：本机恢复副本的 key 需要一次编辑会话的稳定 id，否则刷新后无法复用。
  C2 提供 `useEntryId()`：读取 URL 的 `?entry=<uuid>`，没有就生成并 `router.replace` 写入
  （不增加历史栈）；`useWorkDraft` 的 options 增加 `entryId: string` 并把它纳入 key。
  C3/C4 的独立编辑页必须使用它；同一 URL 刷新后 entryId 不变 → 本机副本可恢复。

### 9.5 前台入口、手机浮层与返回上下文（C2 提供工具，C3/C4 接线）

- `safeInternalPath` 白名单：`/`、`/apps/ins`、`/apps/ins/...`、`/apps/journal`、`/apps/journal/...`、
  `/apps/leisure`、`/apps/leblanc`（含其查询串）；只允许 `http(s)` 同源、以单个 `/` 开头，
  拒绝 `//`、反斜杠、控制字符；非法 → 回 `/admin`。
- `returnTo` 用 `encodeURIComponent` 放在入口链接里（URL 可能较长，可接受）；C4 的日历入口再追加
  `date=YYYY-MM-DD`（若 returnTo 已有查询串则作为独立参数）。
- 点击入口时：若当前 URL 含 `phone=` 参数，先关闭手机浮层——优先调用可用的导航/浮层 API 或
  `history`/`router` 跳转去掉 phone 参数；必须验证编辑器**不被** `.pw-wrap` 浮层遮挡（e2e 断言）。
- 返回：编辑成功或点「返回」→ `router.replace(returnTo)`（编辑器不留在后退栈）。取消且有站内来源 →
  同样 replace(returnTo)；无 returnTo → `/admin`。
- 登录页支持返回：`/admin/login?returnTo=<safeInternalPath>` 登录成功后 `router.replace(returnTo)`，
  非法回 `/admin`（C2 改 `app/admin/login/page.tsx`）。
- 数据属性（C5 的 e2e 依赖，必须稳定）：
  - 入口：`data-owner-entry="ins-new|ins-edit|journal-new|journal-edit|leisure-quick|leblanc-start-moment|leblanc-start-journal|leblanc-start-leisure"`
  - 创作台：`data-workspace-home`、`data-workspace-start="moment|journal|anime|game"`、
    `data-workspace-draft-row`、`data-workspace-draft-open`、`data-workspace-recent-row`、`data-workspace-manage-link`
  - 编辑器：`data-editor="moment|journal"`、`data-editor-return`、`data-editor-save`、`data-editor-publish`、
    `data-editor-submit-action`（语义：该按钮**本次将执行的 action** = `save|publish|update`）、
    `data-editor-blockers`、`data-editor-error`、`data-editor-success`
  - 编辑器字段：`data-editor-field="text|title|content|date|mood|location"`（输入元素上）
  - 编辑器状态（只读展示真实状态，两个独立维度）：
    `data-editor-status="draft|published"`（所有内容类型；新内容=draft）；
    `data-editor-visibility="private|public"`（**仅手记**；moment 不输出此属性）
    提交成功后必须反映真实结果：save→draft(+private)，publish→published(+public)，update→保持实际状态。
  - 同步：`data-sync-state="idle|local-only|saving|synced|failed|conflict"`；
    冲突：`data-workspace-conflict`、`data-workspace-conflict-reload`、`data-workspace-conflict-save-as-new`
  - 相册收录：复用现有 `[data-album-picker]` 与「新建相册」按钮文案（A3 往返断言依赖）
  - 选择器：`data-media-picker`、`data-media-picker-open`、`data-media-picker-item`、
    `data-media-picker-upload`、`data-media-picker-confirm`、`data-media-picker-cancel`、
    `data-media-picker-alt`、`data-media-picker-warning`、`data-media-picker-next`
  - 放课后：`data-leisure-quick`、`data-leisure-quick-submit`、`data-leisure-quick-error`、
    `data-leisure-quick-success`

### 9.6 放课后快捷更新的字段映射（C4，不改后端契约）

复用现有 `LeisureUpdateIn` 的部分更新 + If-Match：

- 追番：`episodes_watched`（集数）、`progress`（状态，取值必须来自现有 `ANIME_PROGRESS`）、
  `notes`（短评）、可选 `airing`（连载中）；总集数未知时**不得**展示百分比。
- 游戏：`progress`（状态，取值来自 `GAME_PROGRESS`）、`playtime_minutes`（累计分钟，输入后整值提交）、
  `notes`（短评）；`completed_on`（通关）与 `all_achievements`（全成就）保持独立，不互相推断。
- 明确的「提交」按钮 + 提交中禁用（防双击）；失败保留输入并显示原因；成功显示真实新版本号/
  安静的已更新提示，不伪造成功。
- 快捷更新不要求标题等完整字段（现有完整编辑保留名称/封面）。

### 9.7 视觉、移动与选择器稳定性

- 新 UI 统一：`features/workspace/workspace.css`（C2，`ws-` 前缀）+ 各 feature 自己的 CSS/MODULE；
  不使用 inline style（登录页除外）；P5 黑白红/粗边框/反白选中；输入区无 skew/rotate；中文正文无衬线。
- 桌面在 `.admin-shell` 内；`≤620px` 编辑器为固定全视口层（`position:fixed; inset:0`，100dvh，
  `env(safe-area-inset-*)` 上下留白，`overscroll-behavior:contain`，`useOverlay` 锁滚动），
  触控目标 ≥44px；关键操作（保存/发布/返回）在 sticky 头部或底部，软键盘弹出后仍可达。
- 浏览器验证依赖 `data-*` 而不是 CSS 类名；CSS 仍要真实可读、可回退。

### 9.8 会话/环境/命令（全体）

```sh
export UV_CACHE_DIR=/Users/学习/blog/Blogs/.dsh/uv-cache
export no_proxy=127.0.0.1,localhost,::1 NO_PROXY=127.0.0.1,localhost,::1
export npm_config_cache=/Users/学习/blog/Blogs/.dsh/npm-cache
export LC_ALL=C
# 后端（隔离库，别用共享 55432）：
bash tools/verify-backend-isolated.sh 55435
# 只跑自己的域：
cd apps/api && TEST_DATABASE_URL=postgresql+psycopg://pl@127.0.0.1:55435/pl_test \
  DATABASE_URL=$TEST_DATABASE_URL SECRET_KEY=dev-secret-0123456789abcdefghijklmnop \
  uv run pytest tests/work_drafts -x -q
# 前端单点（不跑整树）：
cd apps/web && npx vitest run features/workspace features/media-picker features/ins features/journal features/leisure
```

- 后端新测试放在 `apps/api/tests/work_drafts/`（必要时在 `tests/media/` 补列表接口测试），
  使用 `/tmp/pl-test-db-<pid>` 模式（照抄现有 per-package conftest）避免并发撞库。
- C3/C4 的 jsdom 测试照抄 `tests/helpers/render.tsx` + fetch-stub 风格（`features/*/test-support.ts`）；
  `resetDocument` 只清 localStorage，草稿测试自己清 sessionStorage。
- 并行期不要跑整树 `verify-all` / `next build`（会被别人半成品影响）；C0 在合并点统一跑。

### 9.9 交付清单模板（每人结果文件必须含）

1. 实际修改/新增文件清单（含路径）；
2. 接口/迁移说明（C1）；未实现的点与原因；
3. 关键流程截图（如做浏览器验证）；
4. 测试命令与真实结果（通过数/失败数，不许只写「通过」）；
5. **未验证设备与未完成事项**单列（真机、软键盘、中文输入法必然未验证）。
