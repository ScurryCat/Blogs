# T07 · COOP 友链通讯录（交付单）

任务：T07 / COOP 友链通讯录
状态：**implemented_waiting_integration** —— 模块、管理端、共享入口与测试全部完成；
模型 / 路由 / 迁移 / 契约 / 手机登记按分工留给集成负责人（见 §8）。
基线：`23e07d8`（`main`）。开始时工作区已有 T03（`modules/moments`、`features/ins`）与
T05（`modules/{journal,leisure}`、`features/{journal,leisure,leblanc}`、`app/apps/*`）的
未提交文件；本包**没有修改任何别人的文件**，也没有提交 / 推送 / 建分支。
本轮时间：2026-10-16 19:47–20:15（Asia/Shanghai）。

---

## 1. 范围：做了什么、没做什么

**已完成**

1. 后端模块 `app/modules/coop/`：`friend_links` / `friend_link_tags` 模型、公开查询、
   站主维护（排序 / 发布 / 撤回 / 软删除）、外链地址安全规则、媒体公开引用检查（头像）。
2. 真实 PostgreSQL 上的模块测试 `apps/api/tests/coop/`：**84 passed**（自建 `pl_test_t07` 并自行 drop）。
3. 前端 `features/coop/`：公开视图（标签筛选、卡片、详情展开、空态 / 失败态、申请入口）、
   独立页宿主、手机内置应用模块 + 10 字段 manifest、关于页只读段、INS 资料区入口。
4. 管理端 `app/admin/friends` + `features/coop/admin/`：新建 / 编辑 / 排序 / 发布 / 撤回 /
   软删除 / 头像上传（走 T01 的共享媒体端点）/ 412 保留输入。
5. 前端测试 **75 passed**（本包），全量前端 **379 passed**；旧站 **53 passed** 零回归。
6. 真实浏览器验收（Playwright + 系统 chromium）：**31/31 通过**，截图 5 张（见 §5.4）。

**刻意没做**（验收第 5 / 6 条、07 §4）

- 没有访问次数 / 点击数统计，没有好感度或 RANK 等级，没有进度条；
- 没有在线状态、最后活跃、朋友的新动态、外链 RSS 抓取；
- 没有匿名「申请友链」写接口：申请入口指向**已有**的留言板 `/guestbook` 与关于页联络方式；
- 没有把真实友链做成可聊天的联系人（角色消息是 T08 的另一个数据域）。

**未完成（等集成）**：模型注册、路由登记、Alembic 迁移、OpenAPI / 前端类型生成、
手机 manifest 写入 `features/phone/registry.ts`、`/about` 第 02 区与 INS 资料区的实际接线。

---

## 2. 来源核对清单：`assets/js/site.js` 的旧 coop 配置

必须先说结论：**旧站的 `profile.coop` 是示例数据，不是真实朋友，不导入。**

| 来源 | 实际内容 | 判定 | 处置 |
| --- | --- | --- | --- |
| `assets/js/site.js:107-114` `profile.coop` 六条 | 名字是 P5 角色（摩尔加纳 / 双叶的工具箱 / 祐介的画廊 / 真的读书会 / 龙司的跑步群 / 春的菜园），`url` 全部是 `https://github.com/` 占位，`rank` 1–10，`icon` 指向 `assets/img/icon/*.webp` | **示例 / 角色装饰**，不是真实友链 | **不迁移**。它们属于「角色联系人」，与 08 角色消息是同一类同人内容；真实友链表初始为空，由站主逐条录入 |
| `assets/js/site.js:17-21` `social` | GitHub `@ScurryCat` 是真实地址；Mail / X 仍是 `you@example.com` / `@yourname` 占位；RSS 指向站内 | 混合（1 真实 + 2 占位） | 只作为**申请入口**指向现有页面（`/about`、`/guestbook`），不导入 `friend_links`；占位联系方式是否替换由站主决定 |
| `assets/js/about.js:47-52` 第 02 区 | 把上面六条渲染成「友链」卡片，带 `RANK UP ↑` 与 `pips(rank,10)`、`sr-only "COOP 等级 n / 10"` | **把示例说成真实朋友**，且带等级进度 | 集成时用 `CoopLinksSection` 替换或并列（见 §8.7）；旧快照在替换前仍会显示这些占位卡 |
| `assets/css/about.css:49-50` `.coop` 样式 | 旧站卡片样式 | 只读基线 | 不修改；新组件用 `features/coop/coop.module.css`（规则 6：迁移样式表不加新样式） |
| 旧站其余位置 | `grep -rn coop assets/ *.html tests/` 只命中上面这些 | — | 无其他遗漏 |

保留 / 迁移清单（给集成负责人的一句话版本）：

- **迁移**：无（示例数据一条都不迁）。
- **保留**：`assets/js/site.js` 与 `about.js` 原样保留（基线只读），由 T00 决定何时把
  `/about` 第 02 区换成真实友链段；在替换完成前，旧示例卡片仍会被描述成「友链」。
- **新增**：真实友链只从 `friend_links` 表读取；示例角色不进这张表（验收第 3 条）。

---

## 3. 文件

### 3.1 后端（新增，全部在本包独占目录内）

```text
apps/api/app/modules/coop/__init__.py
apps/api/app/modules/coop/models.py        friend_links / friend_link_tags（无 rank / 无计数 / 无在线状态）
apps/api/app/modules/coop/urls.py          外链地址 http(s) 规范化与拒绝规则
apps/api/app/modules/coop/cursors.py       (position, id) 的手动排序游标（同形游标 + 筛选指纹）
apps/api/app/modules/coop/schemas.py       公开 / 管理 DTO
apps/api/app/modules/coop/service.py       公开查询、管理写入、媒体公开引用判断
apps/api/app/modules/coop/router.py        /coop/* 公开 + /admin/friends/* 管理
apps/api/app/modules/coop/wiring.py        媒体公开引用检查的登记入口
apps/api/app/modules/coop/dev_app.py       临时开发入口（只为浏览器验收；**集成后删除**）
apps/api/app/modules/coop/dev_tables.py    临时建表工具（集成迁移落地后**删除**）
apps/api/tests/coop/{__init__,conftest,helpers}.py
apps/api/tests/coop/test_url_safety.py         20 例（纯函数，不需要数据库）
apps/api/tests/coop/test_public_links.py       14 例（公开列表 / 筛选 / 游标 / 详情 / 撤回）
apps/api/tests/coop/test_admin_friends.py      20 例（鉴权 / CSRF / If-Match / 排序 / 发布撤回删除）
apps/api/tests/coop/test_media_references.py    8 例（头像走共享媒体权限的真实读取）
apps/api/tests/coop/test_boundaries.py         14 例（不做什么：无统计、无匿名申请、纯文本、DB 约束）
```

### 3.2 前端（新增）

```text
apps/web/app/apps/coop/page.tsx                    独立页 /apps/coop（服务端外壳 + Suspense）
apps/web/app/admin/friends/page.tsx                管理页 /admin/friends
apps/web/features/coop/types.ts
apps/web/features/coop/urls.ts                     外链安全兜底（isSafeExternalUrl / externalLinkAttributes）
apps/web/features/coop/paths.ts                    /apps/coop 与 tag/item 查询参数
apps/web/features/coop/api.ts                      同源 API 客户端 + 头像上传（复用 /admin/media）
apps/web/features/coop/inflight.ts                 未完成请求登记（dispose 用）
apps/web/features/coop/use-links.ts                列表 / 标签 / 详情读取（可取消、派生加载态）
apps/web/features/coop/friend-avatar.tsx           头像与首字兜底
apps/web/features/coop/friend-card.tsx             卡片（纯文本、外链安全、详情展开）
apps/web/features/coop/coop-view.tsx               主视图（筛选 / 三态 / 申请入口）
apps/web/features/coop/standalone.tsx              独立页宿主（URL 状态 + 导航协调器）
apps/web/features/coop/phone-app.tsx               手机内置应用模块（default + screens + dispose）
apps/web/features/coop/phone-manifest.tsx          10 字段 manifest（交 T00 登记）
apps/web/features/coop/coop-entry.tsx              INS 资料区入口（InsProfileSlots.coop 用）
apps/web/features/coop/coop-links-section.tsx      关于页只读段
apps/web/features/coop/admin/form.ts               草稿 ↔ 载荷、标签解析、排序计划（纯函数）
apps/web/features/coop/admin/friends-admin.tsx     管理界面
apps/web/features/coop/coop.module.css             本包样式（不往迁移样式表加）
apps/web/features/coop/{urls,api,admin}.test.ts
apps/web/features/coop/{friend-card,coop-view,standalone,phone-app,composition}.test.tsx
apps/web/features/coop/test-support.ts
apps/web/features/coop/tools/verify-coop.py        真实浏览器验收脚本（不进 package.json）
```

**没有修改任何别人的文件。** 需要别人配合的改动全部写在 §8 集成申请里。

**新增依赖：无。** 后端只用既有依赖（SQLAlchemy / FastAPI / pydantic / T01 的媒体与鉴权）；
前端不新增 npm 依赖（浏览器验收用系统 Python 3.13 的 playwright，未写进 `apps/web/package.json`）。

---

## 4. 契约增量（供 T00 登记）

### 4.1 模型

| 表 | 列 | 约束 / 索引 |
| --- | --- | --- |
| `friend_links` | `id`(UUID pk) `name`(≤80) `url`(≤2048) `summary`(≤500) `story`(≤4000, 可空) `arcana`(≤60, 可空) `avatar_media_id`(UUID → `media.id` **ON DELETE SET NULL**, 可空) `position`(int) `status`(draft/published) `published_at` `created_at` `updated_at` `deleted_at` `version` | CHECK `status in ('draft','published')`、`version >= 1`、`position between 0 and 100000`、`length(url) <= 2048`、**`url ~* '^https?://'`**、`url = btrim(url)`、`length(btrim(name)) > 0`；部分索引 `ix_friend_links_public_listing (position, id) WHERE status='published' AND deleted_at IS NULL` |
| `friend_link_tags` | `id`(UUID pk) `friend_link_id`(→ `friend_links.id` ON DELETE CASCADE) `name`(≤40) `normalized`(≤40) | UNIQUE `(friend_link_id, normalized)`；索引 `ix_friend_link_tags_normalized (normalized)`；CHECK `length(btrim(normalized)) > 0` |

**没有的列（有意）**：`rank` / `level` / `affection` / `visits` / `clicks` / `online` /
`last_seen` / `latest_post` / `feed_url` / `contact_id` / `slug`。`test_boundaries.py` 用
「DTO 键集合 + 模型列集合」两个方向钉住这一点。

迁移影响：两张新表、一个外键指向既有 `media.id`、无数据回填、不改任何既有表。
**回退限制**：`down` 会删掉这两张表（友链数据丢失）；媒体对象不受影响（`SET NULL` 只在删媒体行时生效）。

### 4.2 路由

| 方法与路径 | 权限 | 说明 |
| --- | --- | --- |
| `GET /api/v1/coop/links` | 公开 | `tag`、`cursor`、`limit`（默认 12 / 最大 30）→ `{items, next_cursor}`；`no-store` |
| `GET /api/v1/coop/links/{id}` | 公开 | 含 `story`；草稿 / 已删除 / 不存在统一 404 |
| `GET /api/v1/coop/tags` | 公开 | `{items:[{name, normalized}]}`，只来自已发布友链，**无计数** |
| `GET /api/v1/admin/friends` | 站主 | 管理列表（含草稿与已删除），`cursor`/`limit`；`private, no-store` |
| `GET /api/v1/admin/friends/{id}` | 站主 | 管理详情 + `ETag: "<version>"` |
| `POST /api/v1/admin/friends` | 站主 + CSRF | 201；新建**总是草稿** |
| `PATCH /api/v1/admin/friends/{id}` | 站主 + CSRF + `If-Match` | 只改出现过的字段；`tags` 传入即**完整替换** |
| `POST /api/v1/admin/friends/{id}/publish` / `unpublish` | 站主 + CSRF + `If-Match` | 发布前复检地址 |
| `DELETE /api/v1/admin/friends/{id}` | 站主 + CSRF + `If-Match` | 204 软删除；**不删除媒体对象** |

权限继承：`require_admin` / `require_admin_write`（Origin + CSRF）、
`private_no_store`、`core.preconditions`（缺 428 / 冲突 412 / 通配 `*` 400）、
统一错误信封——全部复用 T01 的共用件，没有另写一份。

### 4.3 本模块定义的、05 未规定的细节（请登记为约定）

1. **手动排序游标**：公开列表与列表都按站主排序 `(position ASC, id ASC)`。core 的两元组游标
   只表达 `(published_at, id)`，因此这里自带**同形游标**（base64 JSON：`v/p/i/f`），
   指纹复用 `core.pagination.filter_fingerprint`；格式非法 / 版本不认识 / 与当前 `tag` 不符一律
   400 `VALIDATION_FAILED`。
2. **公开条件**：`status='published'` + `deleted_at IS NULL` + `published_at IS NOT NULL AND <= now`
   + `url ~* '^https?://'`。`published_at` 只在首次发布时写入，撤回不刷新历史值。
3. **地址规则**（`coop/urls.py`）：只接受 `http`/`https`；缺 scheme（含 `//host`）、内嵌凭据、
   单标签内网名 / `localhost`、控制字符与内部空白、超长一律拒绝（写 422、发布前复检 409）。
   入库前规范化：scheme 与小写主机名固定，path / query / fragment 原样保留。
4. **头像**：`avatar_media_id` 必须指向 ready 且未删除的媒体（否则 422）；媒体被撤回时公开响应
   给 `avatar: null`（前端退回首字），不给一个必然 404 的地址。
5. **标签不进共享 `tags` 表**：`friend_link_tags` 是友链自己的标签，沿用
   `core.text.normalize_for_match` 去重与筛选。因此**不需要**登记公开标签来源，
   `GET /api/v1/tags` 的含义不受本模块影响。
6. **无发布门槛**：发布只改状态（没有「必须关联公开内容」之类的前置条件）；
   但不判断外链可达性——本站不抓取外链站点内容，站点打不开也保留卡片、不自动删除朋友。
7. **没有逐条 slug / 独立 URL**：任务卡字段表里没有 slug；分享用的是
   `/apps/coop?tag=<标签>&item=<uuid>`。将来要稳定的逐条地址，再加 slug + 迁移重定向。
8. **公开列表不限流**：与文章列表同级的普通读取，不做访问计数（`test_boundaries.py` 有 25 次连续读取的用例）。

### 4.4 环境变量

**无新增。** `CORS_ORIGINS` 是既有变量：开发期浏览器在 3120、API 在 8107 时，
它必须包含 `http://127.0.0.1:3120`，否则登录 / 写操作的 Origin 校验会 403（见 §5.4 的复现命令）。

### 4.5 媒体公开引用检查（wiring）

```python
# T00 在 app/main.py 的 register_content_domains() 里加一行：
from app.modules.coop import wiring as coop_wiring
coop_wiring.register()      # 登记 media/public_refs 的 "coop" 检查器
```

语义：**已发布且未删除**的友链的 `avatar_media_id` 构成该媒体的公开引用（草稿 / 已撤回 /
已删除不算；同一张图仍有别的公开引用就仍然公开）。未登记时匿名读头像 404 —— 前端退回首字，
卡片不坏。`coop/wiring.py: verify_contributions()` 是可执行自检（有测试调用）。

### 4.6 手机 manifest（原样可抄；`icon` 已核对存在）

```ts
{
  id: "coop",
  name: "协助者",
  subtitle: "友链通讯录",
  icon: "/assets/legacy/img/icon/crow.webp",   // 仓库内真实资源（T02 迁移的图标集，已审核）
  order: 30,                                    // metanav 是 20；07 §7 首屏顺序由 T00 决定是否重排
  kind: "embedded",
  canonical_path: "/apps/coop",
  loader: () => import("@/features/coop/phone-app"),
  feature_flag: null,
  state_version: 1,
}
```

模块形状：`default` = `CoopPhoneView(PhoneViewProps)`、`screens = ["links"]`、
`dispose()` = `abortAll()`。手机宿主 URL 只有 `phone/screen/item`，因此**标签筛选是应用内状态**
（换屏或关掉手机即重置）；独立页才把 `tag` 写进地址。

---

## 5. 验证（全部实际执行）

### 5.1 后端模块测试（真实 PostgreSQL 18，不是 SQLite）

```bash
export UV_CACHE_DIR=/Users/学习/blog/.dsh/uv-cache
export TEST_DATABASE_URL="postgresql+psycopg://pl@127.0.0.1:55432/pl_test"
uv run --project apps/api pytest apps/api/tests/coop      # 退出码 0
# 84 passed, 1 warning in 2.59s（连跑 3 次结果一致）
```

- 自建 `pl_test_t07`（`register_temp_database("pl_test_t07")`），会话结束自行 drop；
  没有复用 `pl_test` 或别人的临时库。
- 夹具先跑 `alembic upgrade head`，再用 `create_all` 补齐集成尚未生成的 coop 两张表
  （`T07_SCHEMA_REPORT["created_by_fallback"] == ["friend_link_tags","friend_links"]`，
  说明集成迁移还没覆盖 coop —— 属预期）。
- 覆盖点：地址安全 20 例（含 `javascript:` / `data:` / 控制字符变形）、公开可见性与
  游标 14 例、管理写入 20 例（401 / 403 / 428 / 412 / 422 / 204）、
  媒体公开引用 8 例（真实上传 + 真实 `GET /media/{id}/{variant}`）、边界 14 例。

### 5.2 前端（全部实际执行）

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `npm --prefix apps/web run typecheck` | 0 | tsc 无输出 |
| `npm --prefix apps/web run lint` | 0 | 本包 0 error / 0 warning（仅剩 T05 的 `features/journal/journal-view.tsx` 1 个既有 warning） |
| `npm --prefix apps/web run test -- --run features/coop` | 0 | **75 passed / 8 files** |
| `npm --prefix apps/web run test -- --run` | 0 | **379 passed / 40 files**（含 T01–T05 既有用例，无回归） |
| `DEV_API_URL=http://127.0.0.1:8107 npm --prefix apps/web run build` | 0 | 见 §5.3，`/apps/coop` 与 `/admin/friends` 静态产出 |
| `node --test tests/*.test.cjs` | 0 | **53 passed / 0 failed**（旧站零回归） |

一次真实的并发事故与重试记录（不是我的代码问题，供集成参考）：
20:02 的一次 `next build` 因 **T05 正在编辑的** `features/journal/api.test.ts` 类型错误失败
（`TS2493` / `TS2352`）；同一文件在 `git status` 里是 T05 的未跟踪文件，我**没有**碰它。
几分钟后重跑即退出码 0。两次构建之间还有别人重跑过一次 `npm run build`（BUILD_ID 时间戳变化），
把 `.next` 覆盖成了没有 `DEV_API_URL` 的版本；因此浏览器验收前我重新构建并核对了
`.next/routes-manifest.json` 里确实有 `8107`（rewrites 是构建期固化的）。

### 5.3 生产构建产物

`/apps/coop`（○ 静态）与 `/admin/friends`（○ 静态）都出现在构建输出里；
四条命令都跑过（typecheck / lint / test / build），确认没有「tsc 不报错但 `next build` 失败」
的 `"use client"` 陷阱。

### 5.4 真实浏览器验收（Playwright + 系统 chromium）

```bash
# 1) 独立 dev 库（名字带 test 以便通过守卫）+ 迁移 + coop 两张表 + 站主账号
/opt/homebrew/opt/postgresql@18/bin/createdb -h 127.0.0.1 -p 55432 -U pl pl_test_t07_dev
cd apps/api
uv run --project . alembic -x db_url="postgresql+psycopg://pl@127.0.0.1:55432/pl_test_t07_dev" upgrade head
export APP_ENV=dev DATABASE_URL="postgresql+psycopg://pl@127.0.0.1:55432/pl_test_t07_dev" \
       SECRET_KEY="t07-local-dev-secret-key-0123456789abcdef" MEDIA_ROOT=/Users/学习/blog/.dsh/t07-media
uv run --project . python -m app.modules.coop.dev_tables --create
printf 't07-owner-password-123\nt07-owner-password-123\n' | \
  uv run --project . python -m app.commands.bootstrap_admin --username owner --password-stdin

# 2) 真实 API（临时入口；T00 登记路由后删除 dev_app.py）
CORS_ORIGINS="http://127.0.0.1:3120" uv run --project . \
  uvicorn app.modules.coop.dev_app:app --host 127.0.0.1 --port 8107

# 3) 前端（DEV_API_URL 必须在 build 时就有值）
DEV_API_URL=http://127.0.0.1:8107 npm --prefix apps/web run build
cd apps/web && API_INTERNAL_URL=http://127.0.0.1:8107 node_modules/.bin/next start -p 3120

# 4) 验收
python3 apps/web/features/coop/tools/verify-coop.py \
  --base http://127.0.0.1:3120 --api http://127.0.0.1:8107 \
  --username owner --password t07-owner-password-123     # 退出码 0
```

结果：**31 passed / 0 failed**（连跑两次一致，脚本自己会先清理上一次的临时条目）。
覆盖到的行为（全部在真实浏览器 + 真实 HTTP + 真实 PostgreSQL 上）：

- 空库时是诚实的空态，且给出已有留言板作为申请入口（不伪造示例条目）；
- 通过**真实管理界面**新建 → 仍是草稿、公开列表看不到 → 发布 → 公开页立刻出现同一条记录；
- 卡片里没有旧示例角色、没有旧示例的 `https://github.com/` 占位地址、没有 RANK / 访问量 / 在线状态字样；
- 外链 `target="_blank"` + `rel="noopener noreferrer"` + 可见的「外部 · 新窗口」提示，href 就是录入的地址；
- 简介里写 `<script>alert(1)</script> 与 <b>加粗</b>`，页面上**没有** script / b 节点、原文照显；
- 标签筛选进 URL（`?tag=验收`）且是客户端跳转（`performance.timeOrigin` 不变）；
- `?item=<uuid>` 深链展开卡片并按 id 读取故事（列表不含正文）；
- 头像经**真实文件上传**（共享 `/admin/media`）后能被匿名读取；撤回后不再公开；
- 撤回后公开列表与详情都读不到，回到空态；
- 390 / 320px 横向溢出 0px；管理页可达；
- 音乐元素始终只有 1 个。

截图（工作区外，不进仓库）：

```text
/Users/学习/blog/.dsh/screenshots/t07-coop-desktop.png          列表 + 深链展开（标签筛选后）
/Users/学习/blog/.dsh/screenshots/t07-coop-desktop-avatar.png   已发布友链 + 真实头像
/Users/学习/blog/.dsh/screenshots/t07-coop-390.png              390px
/Users/学习/blog/.dsh/screenshots/t07-coop-320.png              320px
/Users/学习/blog/.dsh/screenshots/t07-coop-admin.png            /admin/friends
```

mock / 真实外部服务说明：**没有任何 mock**。唯一的外部依赖是浏览器里的
`https://example.com/...` 链接（只渲染，不请求）；本站不抓取外链站点内容，也不调用任何 AI。

---

## 6. 任务卡验收逐条对照

| 验收 | 证据 |
| --- | --- |
| 1. 同一友链的修改在 COOP 与其他入口一致；撤回后新公开请求不可见 | 只有一个公开读取路径（`GET /coop/links`），`CoopView` / `CoopEntry` / `CoopLinksSection` 都走它（`composition.test.tsx` 断言两处请求同一端点）；浏览器流程里「编辑 → 公开页立刻变」「撤回 → 公开页立刻消失」各一条 |
| 2. `javascript:` / `data:` 不能成为可执行外链；纯文本简介不注入 HTML | 后端 20 例地址规则 + 数据库 CHECK + 发布前复检；前端 `urls.test.ts` 20 例 + `friend-card.test.tsx` 的「不生成 `<a>`」；浏览器里 `<script>` 只作为文本出现 |
| 3. 角色联系人不在真实友链列表，旧示例不被描述成真实朋友 | §2 来源清单；页头免责文案「角色消息里的双叶、摩尔加纳属于同人剧情，不是这里的友链」；浏览器断言卡片层面没有示例角色、没有 github.com 占位地址 |
| 4. 头像缺失 / 失败、无筛选结果、地址不可用都不破坏列表；不自动删朋友 | `test_media_references.py`（缺头像 / 媒体已撤回 / 未 ready 都是 `avatar: null`，卡片仍返回）；`friend-avatar` 的 `onError` 兜底 + 组件测试；筛选空结果与「站主没有友链」是两句不同文案；地址不可用时渲染说明而不是链接；没有自动删除逻辑（只软删除、管理端仍可见） |
| 5. 手机与独立页、键盘与外链点击可用；无共享真实用户私信或假统计 | 独立页 + 手机模块共用 `CoopView`；手机用 `host.navigateScreen`（phone-internal）；筛选 / 展开是真 `<button>`，外链是新窗口 `<a>`；没有会话 / 私信 / 统计表（`test_boundaries.py` 查 `information_schema`） |
| 手机 / 桌面截图 | §5.4 五张 |

---

## 7. ACCEPTANCE §1「每包必做」逐条

- [x] 检查了开始时 Git 状态与基线，未覆盖他人修改（未改任何别人的文件；未提交 / 未分支）。
- [x] 先建立会失败的断言再实现：地址规则、公开可见性、If-Match、媒体引用都先跑出失败
      （见 §9.1 的开发中修复记录），不是「永远通过的快照」。
- [x] 类型检查 / 模块测试 / 数据库约束 / 构建都有真实命令与退出码（§5.1–5.3）；未运行项单列（§10）。
- [x] 新公开内容的权限路径：列表 / 详情 / 标签 / 头像四条都验证了公开条件与撤回（§5.1）。
- [x] 320 / 390px、键盘、减少动态效果：小屏浏览器断言通过；卡片与筛选是真按钮，键位由浏览器默认行为负责；
      `coop.module.css` 里有 `prefers-reduced-motion` 分支；减少动效下的完整流程未单测（§10）。
- [x] 只有实际行为 / 内容才显示图标与计数：没有计数、没有等级、没有在线状态；`has_story` 只反映真实有无。
- [x] 模块退出取消读取与监听：`inflight.ts` + 每个 effect 的 abort，`phone-app.test.tsx` 断言
      `dispose()` 后未完成请求被取消且晚到响应不写回；没有新增音频、没有碰 body / history。
- [x] 未新增生产密钥、绝对本机素材路径、任意 HTML 执行或付费调用（`icon` 用仓库内相对路径）。
- [x] 交付单即本文件。

---

## 8. 集成申请（T00 动作）

1. **模型注册**：`MODEL_MODULES` 追加 `"app.modules.coop.models"`（放在最后，依赖 `media`）。
2. **路由登记**：`MODULE_ROUTER_TARGETS` 追加 `("coop", "app.modules.coop.router")`；
   coop 的 `router` 是空前缀容器，内部组合 `/coop` 与 `/admin/friends`（与 media / nav 同做法）。
3. **Wiring**：`app/main.py` 的 `register_content_domains()` 里调用
   `app.modules.coop.wiring.register()`（头像的公开引用；见 §4.5）。
   不登记公开标签来源（§4.3 第 5 条）。
4. **迁移**：按 §4.1 生成单头 revision。我**没有**写 `migrations/`、没有执行任何迁移、
   没有改 `model_registry.py` / `router.py` / `main.py`。生成后请删除
   `app/modules/coop/dev_app.py` 与 `app/modules/coop/dev_tables.py`（它们只是路由未登记 / 迁移未生成时的临时入口）。
5. **OpenAPI / 前端类型**：接线后重跑 `export_openapi.py` 与 `npm run gen:api`
   （`contracts/openapi.json` 会漂移一次，属预期；`tests/test_openapi_contract.py` 会先失败一次）。
6. **手机 manifest 登记**：把 §4.6 的对象加进 `features/phone/registry.ts` 的 `PHONE_APPS`。
   `order` 要不要按 07 §7 的首屏顺序（INS / 手记 / 放课后 / COOP / 异世界导航 / 音乐）重排，由你决定。
7. **`/about` 第 02 区与 INS 资料区接线**（属别人的文件，我没有改）：
   - `/about`：把 `app/about/page.tsx` 里的旧示例卡片区（`A.coop` + `RANK UP` + `pips(rank,10)`）
     换成 `<CoopLinksSection />`（`@/features/coop/coop-links-section`）。
     在替换之前，旧示例仍会被渲染成「友链」——这正是验收第 3 条要消除的状态。
   - INS：T03 已经预留 `InsProfileSlots.coop`（`features/ins/composition.ts:122`），
     接线即 `<InsShell … profile={{ coop: <CoopEntry /> }} />`（手机侧同理传给 `InsApp`）。
     两处都读 `GET /api/v1/coop/links`，因此同一条记录在两处一致。
8. **前端管理端的小重复（可选整理）**：`features/coop/admin/friends-admin.tsx` 复用了
   T04 的 `features/metanav/admin/session.tsx`（`useAdminSession` / `AdminNotice` /
   `describeWriteFailure` / `unauthorisedHint`）——它们是通用的站主会话与错误文案，我没有复制一份，
   也没有修改 T04 的文件。若你希望解除 `coop → metanav` 的这层依赖，建议把该文件提升为
   `features/admin/session.tsx`（属你的接线动作）。

---

## 9. 真实缺陷（本轮抓到并修掉的）

1. **`avatar_media_id` 是字符串时头像静默消失**：直接构造对象（测试 / 脚本）时属性可能是 `str`，
   而 `Media.id.in_({...})` 用字符串比较查不到行 —— 表现是「有头像却渲染成没有」。
   现在 `_avatar_keys()` 统一转成 `uuid.UUID`，并有一条真实上传 + 匿名读取的用例钉住。
2. **管理端缓存头被自己降级**：管理端点先调了 `no_store(response)`，把 router 级的
   `private, no-store` 覆盖成公开缓存策略。改为只依赖 router 级依赖，并加断言
   （`Cache-Control: private, no-store` + `X-Content-Type-Options: nosniff`）。
3. **`dev_tables.py` 缺 FK 目标表**：只导入 coop 模型时 `avatar_media_id → media.id` 解析失败
   （`NoReferencedTableError`）。现在导入 auth/media 模型（只建 coop 两张表）。
4. **`set-state-in-effect` 规则**：最初的读取 hook 在 effect 体内同步 `setState("loading")`，
   ESLint 直接判错。改成 T04 `useLoader` 的派生状态写法（`requestKey` 与结果配对），
   没有加任何 eslint 豁免。
5. **验收脚本的三个时序坑（已按 T02 的经验处理）**：
   （a）开屏 `#boot` 是**每会话一次**，每个 `new_page()` 都是新 context，于是每次加载都会拦截点击 ——
   改为共用 context 并在加载前替用户按下那一次 Enter（不改 `timeOrigin`、不记标记）；
   （b）登录表单在拿到预登录 CSRF 之前是 disabled，不能用固定 sleep，要等 `#username` 可用；
   （c）管理列表里上一次运行的**软删除行**仍在表里且按钮是禁用的，必须按 `has_not_text="已删除"` 过滤。
6. **登录 / 写操作的 Origin 校验**：浏览器在 3120、API 在 8107 时，`Origin` 与后端看到的 `Host`
   不一致 → 403。解法是既有变量 `CORS_ORIGINS="http://127.0.0.1:3120"`（core/csrf.py 的显式白名单），
   不是放宽校验。**这也是本项目第一次在真实浏览器里跑通站主登录成功路径**（T01 §8.2 当时没能验证）。

---

## 10. 未验证项及原因（不得当作已通过）

1. **手机面板里的完整交互**：`features/phone/registry.ts` 归 T00，coop 还没登记，
   因此没有在真实浏览器里打开手机 → COOP 的流程。手机侧证据是组件级
   （`phone-app.test.tsx`：模块形状、`screens`、`navigateScreen("links", id)`、`dispose()` 取消请求）
   与「独立页 / 手机共用同一个 `CoopView`」的结构事实。登记后需要补一次面板验证（属集成 / T10）。
2. **`/about` 第 02 区与 INS 资料区的实际渲染**：两处文件归 T02 / T03，我没有改，
   所以「同一记录在两处一致」目前是**结构 + 组件级**证据（两处都请求同一端点、同一 hook、同一卡片），
   不是浏览器证据。接线后应补一次跨入口一致性验证。
3. **320 / 390px 下的手机宿主面板**：小屏验证的是 `/apps/coop` 独立页；手机面板本身未登记（同第 1 条）。
4. **减少动态效果下的完整流程**：`prefers-reduced-motion` 只做了样式层处理（组件没有动画），
   未在浏览器里跑一遍 reduce 模式的完整流程。
5. **整棵后端套件**：按并发规则只跑了 `apps/api/tests/coop`（84 passed），没有跑全树
   （会与其他包的固定库名夹具互相 drop）。集成时请串行跑全量。
6. **多进程 / 多容器语义**：公开列表没做限流（有意），因此不存在阈值放大问题；
   但管理端并发编辑只靠 `If-Match`，没有做压测。
7. **浏览器兼容性**：只用系统 chromium（Playwright 1.60）。Safari / Firefox / 真机 iOS 未测。
8. **A11y 自动审计**：有 `aria-pressed` / `aria-expanded` / `aria-controls` / `role=alert|status` /
   键盘可达的真按钮，但没有跑 axe 之类的自动审计。
9. **`icon` 的视觉合适度**：`crow.webp` 是仓库内真实资源（测试断言文件存在），
   但「用哪个角色图标代表协助者」是审美选择，可能需要你换一个同样存在的资源。

---

## 11. 示例数据、初始化与清理（无秘密）

- 本包**没有**往仓库写入任何示例友链数据。浏览器验收用的「T07 验收站点（临时）」等条目
  是运行时通过真实管理界面创建的，脚本收尾会把它们软删除，我另外把 `pl_test_t07_dev` 里
  8 行临时记录物理删除（现在 `select count(*) from friend_links` = 0）。
- 本地 dev 库：`pl_test_t07_dev`（自建，未删；媒体文件在 `/Users/学习/blog/.dsh/t07-media`）。
  不再需要时可以 `dropdb -h 127.0.0.1 -p 55432 -U pl pl_test_t07_dev` 并删除媒体目录。
- 模块测试库：`pl_test_t07`，由夹具在会话结束时自行 drop。
- 站主账号：`owner` / 口令 `t07-owner-password-123`，**只存在于本地 dev 库**，不是生产凭据；
  生产账号仍走 `python -m app.commands.bootstrap_admin`。

---

## 12. 遗留与需要的外部选择

1. **`/about` 旧示例卡片何时替换**：在 T00 接线之前，旧站快照仍把 6 个角色示例渲染成「友链 + RANK」。
   建议接线时一并删掉那一段（我没有权限改 `app/about/page.tsx`）。
2. **手记 / 放课后等首屏顺序**：COOP 的 `order: 30` 只是「排在导航之后」的占位，
   07 §7 的首屏顺序需要你统一重排一次。
3. **逐条友链的稳定 URL**：现在用 `?item=<uuid>` 分享；若希望 `/apps/coop/<slug>`，
   需要加 slug 列 + 迁移 + 重定向（本期不做）。
4. **标签的展示名归一**：同一规范化标签在不同友链上大小写不同时，筛选器显示**排序最靠前**那条的写法
   （确定性，已测试）。若希望统一成固定写法，需要一个标签字典表。
5. **友链申请流程**：目前只指向留言板 / 联络方式；如果以后要做审核队列，
   那是新的数据域（需要先补契约，不能塞进 `friend_links`）。
6. **管理端媒体选择器**：头像目前靠上传或粘贴媒体 id（T01 尚无管理侧媒体列表）。
   等 T01 补了列表端点，可以把输入框换成选择器。
