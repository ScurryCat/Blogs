# T00 · 集成台账

T00 在骨架交付后持续承担集成负责人（[T00 任务卡](../superpowers/plans/2026-10-16-agent-handoff/tasks/T00-foundation.md)「后续集成职责」）。
这份文件记录每次集成**实际做了什么、验证了什么、还差什么**，避免「模块测试通过」被当成「已集成」。

集成顺序固定（SHARED-CONTRACTS §6）：

```text
审阅变更 → 接线模块（router / models / phone manifest / 组合视图）
        → 生成单头迁移并核对 drop / 数据转换 / 公共可见性
        → 重新生成 OpenAPI 与前端类型
        → 检查共享媒体公开引用
        → 跑模块测试 + 跨模块测试
        → 更新 tasks.json 状态
```

**状态词汇**（不混用）：
`not_started` → `in_progress`（已派发）→ `implemented_waiting_integration`（模块自测通过，尚未接线，**尚未集成**）→ `integrated_verified`（接线完成且跨模块验证通过）→ `completed`。

## 集成记录

| 日期 | 包 | 动作 | 验证 | 提交 |
| --- | --- | --- | --- | --- |
| 2026-10-16 | T00 | 落库交接文档、固化基线、建工程骨架 | 三套测试 53 / 51 / 22 全过；服务实际启动 | `b64b654` `4691be5` |
| 2026-10-16 | T01（依赖部分） | `uv add pillow argon2-cffi python-multipart` | 锁定 12.3.0 / 25.1.0 / 0.0.32；加完依赖后 51 测试仍全过 | `7974d73` |
| 2026-10-16 | T01（部署部分） | compose 与 env.example 增加 `MEDIA_ROOT`、`MEDIA_MAX_CONCURRENCY` | `docker compose config` 渲染通过；`MEDIA_ROOT` 与 `media_data` 挂载点逐字一致 | `7974d73` |
| 2026-10-16 | 基线（旧站） | 浏览器证据自动化：`tools/browser-check/check.py` | 问卷 10/10 + 人群 14/14，退出码 0 | `7974d73` |

## 待办队列

### 等 T01 文件落地后立刻做（现在接线会 `ModuleNotFoundError`，应用与 51 个测试一起红）

- [ ] 写入 `MODEL_MODULES`：`app.modules.auth.models` → `app.modules.media.models` → `app.modules.tags.models` → `app.modules.posts.models`（按依赖顺序）
- [ ] 在 `app/router.py` 登记 5 个 router：`auth→/auth`、`posts→/posts`、`tags→/tags`、`media→""`（内部组合 `/media` 与 `/admin/media`）、`health→/health`
- [ ] 在 `app/main.py` 显式注册媒体公开引用检查：`from app.modules.posts import public_refs as _posts_public_refs; _posts_public_refs.register()`（不注册 = 公开文章封面图对匿名 404，「安全但坏」）
- [ ] 按 `MODEL_MODULES` 生成**单一**新 revision（建表 + 索引 + 唯一 / CHECK），核对 drop、数据转换、公共可见性
- [ ] 迁移链验证：从**空库**升级 + 从上一版测试库升级；确认 `alembic heads` 只有一个
- [ ] 重新生成 `contracts/openapi.json` 与 `apps/web/lib/api/generated/schema.ts`
- [ ] 跑 API 测试 + 跨模块测试；更新 `tasks.json` 状态

### 已提出、待应用

- [ ] `app/core/errors.py` 补 **429 `RATE_LIMITED`** 与 **415 `UNSUPPORTED_MEDIA_TYPE`**，并让 `ApiError` 能携带响应头（05 §9 要求 429 返回 `Retry-After`）。已请 T01 自行补（该文件已交 T01）
- [ ] **游标分页共用件**（05 §6）：`{items, next_cursor}`、`cursor` / `limit`、默认 12 / 最大 30、游标不透明且带过滤条件指纹、无效或不匹配返回 **400**。目前无归属 —— 不做的话 T03 信息流、T04 殿堂、T05 手记会各发明一套游标编码
- [ ] **管理接口与媒体的 `Cache-Control: private, no-store`**（01 §6、05 §7/§8）：应为共享依赖或中间件按路径统一设置。靠各模块自觉加头，漏一个就意味着草稿可能被中间缓存拿去公开
- [ ] `apps/web/lib/api/client.ts` 的 `ApiRequestOptions` 增加 `headers?: Record<string, string>`，让写操作能带 `X-CSRF-Token`（属于 T02 的文件，等 T02 交付后统一加，T03+ 也会用）

### 等 T02 交付后做

- [ ] 审阅 `apps/web` 全量新增目录（含 `styles/`、`tools/` 等未在所有权表中列出的新目录），确认没有越过 `apps/web/app/globals.css` 之类的既定边界
- [ ] 确认问卷迁移后 `tests/poll-browser.html` 的**同一套 10 项断言**仍然通过（`tools/browser-check/check.py --page poll`）
- [ ] 手机接入的 registry 变更走 T00：`features/phone/registry.ts` 归 T00，T02 只提申请
- [ ] 旧站资产复制到 `apps/web/public/assets/legacy/` 后，核对没有把 `assets/clip/`（.gitignore 排除的官方过场影像）或商业音乐带进公开镜像
- [ ] 跑 `npm --prefix apps/web run typecheck|lint|test -- --run|build` 与旧站 `node --test tests/*.test.cjs`

## 已知的集成风险

1. **并行编辑**：T01 与 T02 共用一个工作区，靠目录独占隔离。集成前先 `git status` 确认没有第三方文件混入；我提交时只 `git add` 明确路径（已验证过一次没有夹带）。
2. **锁文件与共享配置**：任何包都不得自行改 `pyproject.toml` / `uv.lock` / `package.json` / `package-lock.json` / `tsconfig.json` / `next.config.ts`。需要就申请，由我一次性应用。
3. **单一 head**：模块不写 `migrations/`。一旦出现平行 head，`alembic heads` 会返回多个，交接计划明令禁止。
4. **迁移不由模块自证**：模块测试里的 `Base.metadata.create_all` 是临时手段，只证明 service 逻辑；真实迁移链的验证在 T00 这里。
