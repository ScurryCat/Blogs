# T06 · 交付单（我的殿堂：作品与记忆画廊）

```text
任务：T06 / 我的殿堂：作品与记忆画廊（作品展厅、相册 / 照片墙、INS 相册页签契约）
状态：implemented_waiting_integration —— 代码、143 个后端用例、99 个前端用例（7 个文件）、生产构建与
      47 项真实浏览器验收全部跑通；模型 / 路由 / 迁移 / OpenAPI / INS 页签接线由 T00 完成
      （见 §8），故本单只主张「模块可用」，不主张「已接线可用」。
基线：开始时 main @ 47c3d9a（T00 派发 T03/T04 的提交）＋工作区里 T05 / T07 的在途未跟踪目录
      （`apps/api/app/modules/{journal,leisure,coop}` 等，本包一个都没碰）。
      运行期间 T00 又推进到 f49b8fc（T08 已集成：`features/messaging/`、`app/apps/ins/messages/`、
      `app/admin/...` 等）。本包**没有**修改任何被 T00/T01/T02/T03/T04/T05/T07/T08 拥有的文件。
      本轮未提交、未推送、未建分支 / worktree、未启动任何子 agent。
外部影响：未调用任何模型或付费服务；未部署；未写共享测试库 `pl_test`；
          浏览器验收只用自己的 dev 库 `pl_test_t06_dev`（名字带 test，受 T00 的库名守卫约束）。
```

## 1. 本轮范围

**已完成**

| 组 | 内容 |
| --- | --- |
| 后端模型 | `projects` / `project_media`、`albums` / `album_media`（唯一 slug、字段枚举 CHECK、同内容 position 唯一与范围、部分索引、`palace_id` 外键 `ON DELETE SET NULL`） |
| 后端公开 API | `GET /projects`、`GET /projects/{slug}`、`GET /gallery/albums`、`GET /gallery/albums/{slug}`、`GET /gallery/photos`、`GET /gallery/photos/years` |
| 后端管理 API | `/admin/projects`（列表 / 详情 / 新建 / 更新 / 发布 / 撤回 / 软删除）、`/admin/albums`（同上 + `DELETE .../photos/{media_id}` **单处撤回**） |
| 站点链接 | 链接字段在 schema 层只接受 `http` / `https`（`javascript:` / `data:` / `file:` / 本机路径一律 422） |
| 媒体公开引用 | `projects/wiring.py`、`gallery/wiring.py` 各自注册一个检查器（**两个独立开关**，可单独回滚） |
| 第一件真实作品 | 「这个 P5 博客」（`p5-blog`）：真实仓库地址、真实技术栈、可复现的成果，效果图用仓库里已有的旧站封面素材经 T01 的**真实媒体服务**导入；**没有**任何奖项或编造数字 |
| 前端作品展厅 | `features/showcase/`：卡片 / 列表双视图、维护状态筛选、详情四节（职责 / 问题 / 取舍 / 成果）+ 技术栈 + 图集 + 「攻略记录」 |
| 前端记忆画廊 | `features/gallery/`：相册卡、自然比例瀑布图格、灯箱（← → Home End Esc + 焦点归还）、相册 / 类型 / 年份筛选、按相册分组、加载更多、图片失败态 |
| INS 组合 | `ins-tab.tsx`（贡献工厂 + `useGalleryTabContribution`）、`ins-gallery-view.tsx`（紧凑视图）、`ins-tab-availability.ts`、`ins-integration.tsx`（与 T08 的 `InsAppWithMessages` **可叠加**的客户端组合壳）、`gallery-tab-loader.tsx` |
| 手机登记预备 | `features/showcase/phone-app.tsx`（`default` + `screens` + `dispose`）、`phone-view.tsx`、`inflight.ts`、`phone-manifest.ts`（10 字段，`icon` 是仓库里真实存在的 `fox.webp`） |
| 初始化命令 | `python -m app.modules.projects.seed`（幂等、默认 dry-run；真实素材 + 真实媒体服务） |
| 验证工具 | `features/gallery/tools/verify-showcase.py`（Playwright，47 项，含真实管理 HTTP 夹具与一图多引用场景） |

**未完成 / 不在本包**：3D 漫游、AI 自动修图、角色自动点评、技能合体（明确不做，技能关系属
T09）；`projects ↔ skills` 关系表（T09）；相册标签（07 §8 未定义，需先改契约）。

## 2. 文件

**新增（本包独占）**

```text
apps/api/app/modules/projects/
  __init__.py  models.py  schemas.py  service.py  router.py  public_refs.py  wiring.py  seed.py
apps/api/app/modules/gallery/
  __init__.py  models.py  schemas.py  service.py  router.py  public_refs.py  wiring.py
apps/api/app/t06_dev_app.py                   本地验证入口（**请在登记后删除**，见 §8.5）
apps/api/tests/support/t06_db.py              T06 专用临时库夹具（projects / gallery 共用）
apps/api/tests/support/t06_shared.py          共享测试辅助（建站主 / 媒体 / 作品 / 相册 / 走真实 HTTP）
apps/api/tests/projects/{__init__,conftest,helpers}.py
apps/api/tests/projects/test_models.py  test_public_api.py  test_admin_api.py  test_media_visibility.py
apps/api/tests/gallery/{__init__,conftest,helpers}.py
apps/api/tests/gallery/test_models.py  test_public_api.py  test_admin_api.py
apps/web/features/showcase/
  types.ts  paths.ts  api.ts  server-api.ts  palace-options.ts  showcase.css
  project-card.tsx  project-gallery.tsx  project-reading.tsx
  admin/{session.ts,project-workspace.tsx}
  inflight.ts  phone-view.tsx  phone-app.tsx  phone-manifest.ts
  paths.test.ts  test-support.ts  project-gallery.test.tsx
apps/web/features/gallery/
  types.ts  paths.ts  api.ts  server-api.ts  failure.ts  gallery.css
  photo-tile.tsx  lightbox.tsx  album-card.tsx  gallery-view.tsx
  ins-gallery-view.tsx  ins-tab.tsx  ins-tab-availability.ts  gallery-tab-loader.tsx
  ins-integration.tsx
  admin/{session.ts,album-workspace.tsx}
  test-support.ts  paths.test.ts  photo-tile.test.tsx  gallery-view.test.tsx
  ins-tab.test.tsx  server-api.test.ts
  tools/verify-showcase.py
apps/web/app/showcase/page.tsx
apps/web/app/showcase/photos/page.tsx
apps/web/app/showcase/projects/[slug]/page.tsx
apps/web/app/admin/projects/page.tsx
apps/web/app/admin/projects/[id]/page.tsx
apps/web/app/admin/albums/page.tsx
apps/web/app/admin/albums/[id]/page.tsx
```

**未改动**（所有权红线，逐条核对过 `git status`）：`app/{main,router,model_registry}.py`、
`app/core/**`、`app/commands/**`、`app/modules/{auth,media,tags,posts,nav,moments,journal,leisure,coop}/**`、
`migrations/**`、两个锁文件、`apps/web` 的全部根配置、`features/{runtime,phone,legacy,ins,metanav,messaging,journal,leisure,leblanc,coop}/**`、
`components/ui/`、`lib/api/**`、`app/{layout,globals.css,page,about,map,weather,guestbook,posts,healthz,admin/layout.tsx,admin/moments,admin/palaces,admin/login,apps}/**`、
`public/`、`styles/`、`tests/**`、`tools/`、`contracts/`、`deploy/`。

唯一「看起来像越界」的是 `apps/api/tests/support/t06_{db,shared}.py`：它们在 T00 的
`tests/support/` 目录下。选择理由与风险已单列在 §9.7（可选的自愿修正：
T00 可把它们移进 `tests/projects/`，两个 conftest 的导入路径改一行即可）。

## 3. 模型清单与迁移意图（交 T00 生成迁移）

| 表 | 列 | 数据库级约束 |
| --- | --- | --- |
| `projects` | id、唯一 slug、title、summary、role、problem、tradeoffs、outcomes、tech_stack(JSONB)、links(JSONB)、maintenance、`palace_id`→palaces(**SET NULL**)、status、published_at、created_at、updated_at、deleted_at、version | `ck_projects_status_valid`、`ck_projects_version_positive`、`ck_projects_maintenance_valid`(active/maintained/paused/archived)、`ix_projects_public_listing`（部分索引：`status='published' AND deleted_at IS NULL`，键 `published_at,id`）、`ix_projects_palace_id` |
| `project_media` | 复合主键 (project_id→projects CASCADE, media_id→media RESTRICT)、position、kind、alt、caption、taken_on(可空) | `ck_project_media_position_range`(0–19)、`ck_project_media_kind_valid`(cover/detail/evidence)、`ck_project_media_alt_length`(1–200)、`ck_project_media_caption_length`(≤500)、`uq_project_media_project_id_position`、`ix_project_media_media_id` |
| `albums` | id、唯一 slug、title、description、kind、position、status、published_at、created_at、updated_at、deleted_at、version | `ck_albums_status_valid`、`ck_albums_kind_valid`(photo/screenshot/other)、`ck_albums_version_positive`、`ck_albums_position_non_negative`、`ix_albums_public_listing`（同上形状）、`ix_albums_kind_position` |
| `album_media` | 复合主键 (album_id→albums CASCADE, media_id→media RESTRICT)、position、alt、caption、taken_on(可空) | `ck_album_media_position_range`(0–199)、`ck_album_media_alt_length`、`ck_album_media_caption_length`、`uq_album_media_album_id_position`、`ix_album_media_media_id`、`ix_album_media_taken_on` |

**迁移影响**：四张新表 + 11 个索引，**不修改任何既有表**，没有数据回填。
`projects.palace_id` 指向 `palaces`，因此迁移顺序必须在 T04 的 nav 之后
（`MODEL_MODULES` 里把 `app.modules.projects.models` / `app.modules.gallery.models` 放在最后）。

**回退限制**：`downgrade` 会连带删掉作品与相册（内容），不是纯 schema 回退 ——
生产环境请先备份。

**交叉证据**：`tests/projects/t06_db.py` 先跑 `alembic upgrade head`，再用一张独立
MetaData（FK 目标表用替身）补齐缺失的表；`t06_schema_report()["created_by_fallback"]`
如实报告补了哪些表。迁移落地后该列表为空，届时表结构不对会让用例因缺列 / 缺约束而失败，
不会被夹具悄悄修好。

## 4. 契约增量

### 4.1 路由（T00 登记；模块内部组合 `/projects`、`/admin/projects`、`/gallery`、`/admin/albums`）

| 方法与路径 | 权限 | 说明 |
| --- | --- | --- |
| `GET /api/v1/projects` | 公开 | `maintenance`、`tech`、`cursor`、`limit`（默认 12 / 最大 30）→ `{items, next_cursor}` |
| `GET /api/v1/projects/{slug}` | 公开 | 完整作品 + 有序公开图片 + 公开专题链接；草稿 / 撤回 / 删除 / 未到发布时间 / 不存在统一 404 |
| `GET /api/v1/gallery/albums` | 公开 | `kind`、`cursor`、`limit` → `{items, next_cursor}`；按 `published_at DESC` |
| `GET /api/v1/gallery/albums/{slug}` | 公开 | 相册详情 + 有序公开照片 |
| `GET /api/v1/gallery/photos` | 公开 | `scope=global\|album`、`album`、`kind`、`year`、`month`、`cursor`、`limit`（默认 24 / 最大 60）→ `{items, next_cursor, total}` |
| `GET /api/v1/gallery/photos/years` | 公开 | 照片墙可用的年份（只统计有 `taken_on` 的照片） |
| `GET /api/v1/admin/projects`、`/{id}` | 站主 | 管理列表 / 详情（含草稿），详情带 `ETag` |
| `POST /api/v1/admin/projects` | 站主 + CSRF | 201；**总是草稿** |
| `PATCH /api/v1/admin/projects/{id}` | 站主 + CSRF + `If-Match` | 只改出现过的字段；`images` / `links` / `tech_stack` 传入即**完整替换**；`slug` 不可改（带 slug → 422） |
| `POST .../{id}/publish` / `.../unpublish`、`DELETE .../{id}` | 站主 + CSRF + `If-Match` | 发布门槛：≥1 张 ready 图片 + 一句话用途非空，否则 409；撤回清空 `published_at` 但**保留图片关系**；删除是软删除 204 |
| `GET /api/v1/admin/albums`、`/{id}` | 站主 | 管理列表（按 `position ASC`）/ 详情（含未 ready 的照片与 `media_status`） |
| `POST /api/v1/admin/albums` | 站主 + CSRF | 201；新建总是草稿；**不给 `position` 时按同类型最大值 +1** |
| `PATCH /api/v1/admin/albums/{id}` | 站主 + CSRF + `If-Match` | `photos` 传入即完整替换 |
| `POST .../{id}/publish` / `.../unpublish`、`DELETE .../{id}` | 站主 + CSRF + `If-Match` | 发布门槛：≥1 张 ready 照片 |
| `DELETE /api/v1/admin/albums/{id}/photos/{media_id}` | 站主 + CSRF + `If-Match` | **单处撤回**：只删这一处关系行（204），媒体行与文件不动 |

### 4.2 本模块定义、05 未规定的细节（请登记为约定）

1. **两套排序语义，刻意分开**：
   `scope=global`（默认，跨相册）按 `taken_on DESC NULLS LAST → media.created_at DESC →
   album.position ASC → album_media.position ASC → media_id ASC`；
   `scope=album` 按 `album.position ASC → album_media.position ASC → media_id ASC`。
   只给 `album` 不给 `scope` 是「按相册筛选」，排序仍是全局的 —— 这一点在真实浏览器验收里
   抓过一次误用（见 §5.5）。
2. **照片墙游标是五元组**：`{v:2, t:排序版本, a:主键序号, s:入库时间, ap:相册顺序, pp:照片顺序,
   i:media_id, f:筛选指纹}`。`a` 是排序主键的整数投影（全局 → `taken_on` 的 ordinal，空值 -1；
   相册 → `album.position`），因此两种 scope 共用一个编解码器而语义不混。
3. **相册列表游标是 `(position, id)`**：手工顺序可能与时间无关，core 的两元组时间游标表达不了，
   因此 gallery 自带一个同形游标（`{v:1, p, i, f}`）。格式 / 版本 / 指纹不符一律 400。
4. **公开地址用 slug，管理地址用 UUID**：公开 URL 稳定优先；`slug` 创建后不可改（带 slug 的
   PATCH 是 422 字段错误）。
5. **`published_at` 只在首次发布时写入**；撤回只改 `status` 并清空 `published_at`，
   重新发布不会保留历史发布时间。
6. **图片用途（作品）**：`cover` / `detail` / `evidence`；封面 = `kind=cover` 里 position 最小的，
   没有 cover 时退回 position 最小的图（`cover_of()`）。
7. **`taken_on` 可空且绝不回填**：没有拍摄时间的照片在界面显示「未填写日期」，也不参与年份筛选。
   `alt` 必填（1–200 码点，纯空白拒绝）。
8. **作品「攻略记录」在读取时解析**：`palace` 字段由 `nav.public_palace_options()`（T04 的只读门面）
   实时匹配，专题不公开时返回 `null` —— **不把专题标题快照进 projects 表**，因此不存在「撤回后
   残留标题」的可能。
9. **`media_reference_summary()`（projects/service）**：逐个调用 `media.public_refs` 里已注册的
   检查器，返回 `{域名: bool}`，供管理端提示「这张图还有别处公开引用」（07 §5 末段要求
   「管理端必须明确提示」）。注册表为空时返回空字典。
10. **`openapi.json` 与前端生成类型**：本包 17 条路径必须由 T00 在接线后重新生成
    （`tests/test_openapi_contract.py` 会因此失败一次，属预期）。

### 4.3 环境变量

**无新增。** 没有任何 `PROJECTS_*` / `GALLERY_*` 配置项。

## 5. 验证（全部实际执行）

前置：

```sh
export npm_config_cache=/Users/学习/blog/.dsh/npm-cache
export UV_CACHE_DIR=/Users/学习/blog/.dsh/uv-cache
export TEST_DATABASE_URL="postgresql+psycopg://pl@127.0.0.1:55432/pl_test"
```

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `uv run --project apps/api pytest apps/api/tests/projects apps/api/tests/gallery` | 0 | **143 passed**（连跑 3 次结果一致）；自建 `pl_test_t06_<pid>` 与 `<pid>_second`，结束自动 drop |
| `uv run --project apps/api pytest apps/api/tests/{core,auth,posts,media,tags}` | 0 | **122 passed** —— T00/T01 既有后端零回归 |
| `node --test tests/*.test.cjs` | 0 | **53 passed / 0 failed** —— 旧站零回归 |
| `npm --prefix apps/web run typecheck` | 0 | tsc 无输出 |
| `npm --prefix apps/web run lint` | 0 | 0 error / 0 warning（全仓库） |
| `npm --prefix apps/web run test -- --run` | 0 | **609 passed / 57 files**；其中本包 `features/{gallery,showcase}/**` **99 passed / 7 files**（`npx vitest run features/gallery features/showcase` 的输出） |
| `DEV_API_URL=http://127.0.0.1:8103 npm --prefix apps/web run build` | 0 | 路由表含 `ƒ /showcase`、`ƒ /showcase/photos`、`ƒ /showcase/projects/[slug]`、`○ /admin/projects`、`ƒ /admin/projects/[id]`、`○ /admin/albums`、`ƒ /admin/albums/[id]` |
| `python3 apps/web/features/gallery/tools/verify-showcase.py` | 0 | **47 passed / 0 failed**，10 张截图（真实 chromium，无 mock；连跑 3 次结果一致） |
| `python -m app.modules.projects.seed --json`（dry-run） | 0 | 报告两张真实封面素材都在、`would_create_project: true` |
| `python -m app.modules.projects.seed --apply --publish --palace-slug phantom-base --json`（第二次） | 0 | `created: false` —— **幂等，不覆盖站主改动** |

> 构建在 `apps/web` 的一份 **APFS clone**（`cp -Rc`，临时目录 `/tmp/t06-runtime/web`）里执行：
> 工作区里的 `apps/web/.next` 是共享构建产物，运行期间它的所有者（T03/T08 的联调）在
> 3100 上跑着服务 —— 直接重建会动到别人的产物。核对方式：clone 与工作区的
> `apps/web/**` 字节一致（`cp -Rc` 之后 `diff -r` 无差异），构建输入因此完全相同。

### 5.1 真实 PostgreSQL（不是 SQLite）

`tests/support/t06_db.py` 用 T00 的 `register_temp_database("pl_test_t06_<pid>")` 逐包登记库名，
复用共享的 `create_database` / `drop_database`；用例在一个事务里跑并回滚。约束证据断言的是
**真实行为**：状态 / 维护状态 / 品种枚举被 CHECK 拒绝、重复 media 与重复 position 触发
`IntegrityError`、超长标题触发 `DataError`（varchar(200) 的真实行为，不是 IntegrityError ——
第一版写错了异常类型）、`ON DELETE SET NULL` 与 RESTRICT 从 `information_schema` 断言。

### 5.2 真实服务（uvicorn + 真实 dev 库）

```text
DB      pl_test_t06_dev（本地测试集群 55432；alembic upgrade head + bootstrap_admin
        + import_legacy --apply --no-covers + nav.seed + projects.seed）
API     APP_ENV=dev DATABASE_URL=…pl_test_t06_dev MEDIA_ROOT=/Users/学习/blog/.dsh/t06-media \
        uvicorn app.t06_dev_app:app --port 8103
        GET  /api/v1/projects                      → 200，1 件作品（p5-blog，2 张真实图）
        GET  /api/v1/projects/p5-blog              → 200，palace=怪盗据点工程，2 张图，1 条真实仓库链接
        GET  /api/v1/media/<id>/w320.webp（匿名）  → 200
        GET  /api/v1/media/<id>/original（匿名）   → 404（原图永远只给站主）
WEB     DEV_API_URL=http://127.0.0.1:8103 npm run build && API_INTERNAL_URL=… npm run start -- -p 3103
        /showcase                                 → 200
        /showcase/photos                          → 200
        /showcase/projects/p5-blog                → 200（服务端渲染，正文含四节与技术栈）
        /showcase/projects/nope-nope              → 404（**真正的 404**）
        /admin/projects、/admin/albums            → 200（未登录时显示明确的登录提示）
```

### 5.3 真实浏览器验收（Playwright + 系统 chromium，47/47）

`features/gallery/tools/verify-showcase.py`。三个时序坑都按 T00 的做法处理：
点击前等 `window.__PHANTOM_DEBUG__`（不用固定 sleep）、`#boot` 先关掉、整页重载用
`performance.timeOrigin` 是否变化判断（**实测采样**：`1792155246401.6 → 1792155246401.6`，
即客户端导航、没有整页重载）。

夹具全部走**真实管理 HTTP**（登录 → CSRF 头 → `If-Match`）与 T01 的真实媒体服务，
用仓库里已有的 `assets/legacy/img/cover/launch.jpg` 现上传；**不直接写表**、不写仓库文件。

关键证据（摘）：

```text
作品卡            标题 / 一句话用途 / 技术栈都在；没有「星 / 人使用 / 下载 / 获奖」字样
点卡片进详情      timeOrigin 未变 → 客户端导航，不是整页重载
详情四节          个人职责 / 解决的问题 / 关键取舍 / 可验证成果 都在
攻略记录          指向 phantom-base（metaverse-entry）
专题撤回后        作品仍可读；无攻略记录入口；页面里**没有**「怪盗据点工程」字样；
                  给出「还没有公开的攻略记录（专题未发布或已撤回时不会显示标题）」
恢复专题后        入口回来
照片墙            3 个图格；每张都有 alt 与真实 width/height；没有拍摄时间的写「未填写日期」
按相册筛选        3 格 → 1 格（修复 scope 语义之前这里恒为 3 格，见 §5.5）
灯箱              Escape 关闭且焦点回到原图格；→/← 切换；End 跳到 3/3
一图多引用        同一张 media 同时在两个相册里；从截图相册 DELETE 后
                  「被撤的那一处 1 → 0」「另一个相册里那张仍在」「匿名读图仍 200」
所有引用撤回      作品 + 相册都撤回后匿名读图 404；只恢复一处就够（又变 200）
图片损坏          src 换成不存在的变体后出现失败态占位，日期文字仍在
不新增音频        灯箱打开时 <audio> 数量 ≤ 1（站点音乐单例）
320 / 390px       /showcase、/showcase/photos、作品详情的 scrollWidth-clientWidth 均为 0px
```

**截图（绝对路径）**：`/Users/学习/blog/.dsh/screenshots/`
`t06-showcase-desktop.png`、`t06-project-desktop.png`、`t06-project-palace-retracted.png`、
`t06-photos-desktop.png`、`t06-lightbox-desktop.png`、`t06-photo-broken.png`、
`t06-390-photos.png`、`t06-390-project.png`、`t06-320-photos.png`、`t06-320-project.png`。

### 5.4 第一件真实作品（真实资料，非杜撰）

```text
slug        p5-blog
标题        这个 P5 博客
一句话用途  把纯静态的 Persona 5 风格博客改造成 Next.js + FastAPI + PostgreSQL 的可发布站点
职责        个人项目：从旧站（HTML / CSS / 原生 JS + window.PL 自制 PJAX）出发，独立完成
            前端迁移、后端模块划分、数据库模型与媒体管线、以及真实浏览器验收
技术栈      Next.js / React / TypeScript / FastAPI / SQLAlchemy / Alembic / PostgreSQL /
            Pillow / Playwright（全部是仓库里真实使用的依赖）
链接        https://github.com/ScurryCat/Blogs（来自旧站 assets/js/site.js 的 GitHub 配置）
效果图      desk.jpg（封面）+ css-menu.jpg（详情图）—— 都是 T02 已迁移进仓库的旧站素材，
            经 T01 的媒体服务解码 / 去元信息 / 生成变体后入库
关联专题    phantom-base（怪盗据点工程，T04 已发布的真实专题）
```

**没有**的部分（如实说明）：「可验证成果」写的是旧站 `node --test tests/*.test.cjs` 53 项通过
与「新站建立了真实迁移链与模块」这些**可复现的事实**，没有奖项、星数、用户数、下载量或排名。
作品也没有「比赛获奖」「上线访问量」之类的字段可以填 —— `projects` 表里根本没有这些列。

复现：`bootstrap_admin` → `import_legacy --apply --no-covers` → `nav.seed --apply --publish`
→ `projects.seed --apply --publish --palace-slug phantom-base`（见 §11）。

### 5.5 真实缺陷（都是本轮抓到并修掉的，附回归方式）

1. **`serverApiRequest` 自带 `/api/v1`，我给的却是完整路径** → 服务端请求变成
   `/api/v1/api/v1/projects/...`，页面表现为**作品详情 404**（API 日志里才看得出来）。
   影响面：作品列表 / 详情、相册列表 / 详情 / 照片墙 / 年份、相册页签可用性探测。
   修法：`paths.ts` 同时提供「相对路径」（服务端）与「浏览器同源路径」两组常量，
   并加 `features/gallery/server-api.test.ts` 钉住「服务端那组不带 `/api/v1`」。
2. **`AlbumCreateIn.position` 的默认值 0 被 `model_dump()` 当成显式输入** → 每本新相册都落在
   position 0（管理列表顺序全乱）。修法：`create_album` 用 `exclude_unset=True`，
   并在 `test_admin_api.py` 里钉住「不传就自增 / 传了就用传的」两个分支。
3. **相册筛选链接只带了 `album`**，服务端按 `scope=global` 处理 → 「点相册」看起来没生效
   （浏览器验收：3 格而不是 1 格）。修法：`galleryHref()` 生成 `scope=album&album=…`，
   页面按 URL 里的 `scope` 取数，并补了 `albumScope` 语义与三个用例。
4. **作品卡封面用了 `aspect-ratio: 16/10` + `object-fit: cover`** → 仓库里的真实素材是
   640×900 的竖构图，被拉成一个空荡的高框，卡片文字被推到首屏之外（截图抓到）。
   修法：自然比例 + `max-height`，网格列宽也加了上限。
5. **`tt06_dev_app` 只挂了 projects / gallery 两个 router**（`create_app(module_routers=...)`
   是测试接线，会跳过生产登记表）→ `/api/v1/media/...` 根本没有路由，匿名读图永远 404，
   一度看起来像「公开引用检查没登记」。修法：把 auth / media / moments / nav / posts / tags
   一并列出来，并在文件里写清原因。
6. **`ensure_t06_tables()` 直接在 `Base.metadata` 上 `create_all`** → 本机未跑全量迁移时
   `NoReferencedTableError`（FK 目标 `palaces` / `media` 未被导入）。修法：改用独立 MetaData +
   `model_registry.import_all_models()`，与测试夹具同形。
7. **`seed` 的发布没有 `If-Match`** → 命令行被 05 §7 的乐观锁挡下（428）。
   修法：用新建后的 `version` 组成 `If-Match` —— 命令行不是绕过并发控制的旁路。
8. **React Compiler 的 `react-hooks/set-state-in-effect`**：在 effect 里同步 setState
   会在 lint 阶段直接失败（本仓库开着该规则）。修法：把「服务端给的第一页」改成**派生基线**
   （`useMemo` + 按 filterKey 失效的追加缓冲），并在确实需要 setState 的异步路径上先 `await`。
9. **嵌套 `<button>`**：图格失败态里放了「重新加载」按钮，而外层（可点击打开灯箱）已经是
   button → React 报无效 HTML 与水合风险。修法：失败态只给文字提示，重试由「再点一次」承担，
   并加用例断言 `button button` 数量为 0。
10. **验证脚本自身的夹具缺陷（两次）**：一次把「作品那一处引用」错用成也存在于另一个相册的图
    （于是「全部撤回后 404」永远失败）；一次在收尾时把相册全撤回，导致下一轮拿到一张已经没有
    公开引用的旧图。两次都表现为「权限逻辑像是错的」。修法：共享图先挂到**作品**上（长期存在），
    相册在收尾时**保持公开**，脚本从数据库当前的真实引用里解析 media id。

## 6. 任务卡「执行清单 / 验收」逐条对照

| 任务卡条目 | 证据 |
| --- | --- |
| 1 定义契约与发布要求；先测 URL 校验、草稿隐藏与关联专题撤回 | `test_public_api.py`：9 个非法 slug 参数化用例（大写 / 中文 / 空格 / 连字符边界 / 下划线 / 点 / 斜杠）、4 种非公开状态（draft / 已撤回 / 已软删除 / 未到发布时间）都 404 且响应里没有草稿文本、三个「专题撤回」用例（撤回 / 软删除 / 无公开文章） |
| 2 实现管理与公开列表 / 详情；第一件用真实博客资料，缺成绩材料不编造 | §5.4；`projects/seed.py` 只写真实资料；`test_admin_api.py` 21 例覆盖 428 / 412 / 发布门槛 / 替换 / 删除 |
| 3 相册、图片顺序、说明、拍摄时间可空的契约；复用已有 media ID | `test_models.py`（gallery）正向断言 `taken_on` 可空、`caption` 可空、`alt` 必填；`test_admin_api.py` 覆盖 `photos` 完整替换与「同一 media 不重复」 |
| 4 相册管理、照片墙筛选、自然比例图格与灯箱、alt 与失败态 | 浏览器验收 12 项（筛选 / 自然比例 / alt / 灯箱键盘 / 相机失败态）+ 组件测试 9 项 |
| 5 「攻略记录」只链接当前公开专题；撤回不连带删除、不露隐藏标题 | 后端 3 例（撤回 / 软删除 / 无公开文章）+ 浏览器 4 项（撤回后作品仍在、无入口、无标题、恢复后回来） |
| 6 输出供 INS 使用的紧凑 GalleryView 与路由映射 | `ins-tab.tsx` / `ins-gallery-view.tsx` / `ins-integration.tsx` / `GALLERY_ROUTES`；16 个用例覆盖 id 不与内置冲突、`isAvailable=false` 完全不渲染、与消息页签（order 40）共存 |
| 7 提交媒体公开引用检查；一图多引用、单处撤回、全部撤回 | `projects/wiring.py` + `gallery/wiring.py`（两个独立开关）；`test_media_visibility.py` 13 例 + 浏览器 8 项 |
| 验收 1 真实管理与发布闭环 | 管理 API 通过真实 HTTP 走完整生命周期；浏览器脚本用真实管理端点建相册、发布、撤回、单处撤回 |
| 验收 2 同一媒体多处引用、排序与说明独立 | `test_caption_can_differ_per_context`（相册说「旅行」、作品说「首页」，media_id 同一个，媒体行只有 1 条） |
| 验收 3 一处 / 全部撤回的权限结果；原图只给管理员 | §5.3 的 8 项 + `test_media_visibility.py` 的未登记 / 单域登记 / 双域登记三段 |
| 验收 4 INS 与独立照片墙一致、返回后保留位置、不新增 body 锁或音频 | 紧凑视图与独立页读同一批端点（用例断言 URL）；「不新增 `<audio>`」「不加 `ov-lock`」两条用例；焦点归还用例 |
| 验收 5 作品展示成果、专题解释过程、空内容不靠 3D 或假统计 | `ProjectReading` 的空字段给明确说明（4 条用例）；卡片断言「没有星 / 人使用 / 下载 / 获奖」 |
| 验收 6 390px / 桌面截图、灯箱键盘、图片慢加载与损坏 | §5.3；图片是 `loading="lazy"` + 真实宽高（无布局跳动），损坏态有专门用例与截图 |

## 7. 每包必做清单（ACCEPTANCE §1）

- 需求都有对应测试：本轮 10 个真实缺陷都是**先红后修**（§5.5），没有「永远通过的快照」。
- 类型检查 / 模块测试 / 数据库约束 / 构建都有真实命令与退出码（§5）；未运行项单列（§9）。
- 新公开内容在列表、详情、分享、图片四条读取路径都验证了权限：列表 / 详情 / 照片墙 / 年份
  四个公开端点都有「草稿 / 撤回 / 删除不可见」的用例；分享路径 = canonical URL
  （浏览器直接打开 + 刷新 + Back 都验证过）；图片路径由 `test_media_visibility.py` 覆盖。
- 320 / 390px、键盘、关闭、焦点、减少动态效果、失败状态：320 / 390 无横向溢出并截图；
  灯箱键盘 5 个键位用例；焦点归还用例；失败态有明确文案与重试；
  `prefers-reduced-motion` 下不新增位移（本包 CSS 只在 `no-preference` 时加过渡）。
- 只有真实行为才显示计数与提示：`photo_count` 与 `total` 都是实时统计；没有成绩数字可显示；
  未接入的能力（T09 的技能）**不显示任何入口**。
- 模块退出取消读取与监听：`GalleryView` / `ProjectGallery` / 手机视图的 effect 都返回
  `abort()`；手机模块的 `dispose()` 取消全部在途请求（有用例）；音乐单例与动画规则不变
  （不创建音频、不播过场、不锁 body）。
- 不新增生产密钥 / 绝对本机素材路径 / 任意 HTML 执行 / 未授权外部调用 ✓（链接只允许 http/https）。
- 提交本包的交付单 ✓。

## 8. 集成申请（T00 动作）

1. **模型注册**：`MODEL_MODULES` 追加
   `"app.modules.projects.models"`、`"app.modules.gallery.models"`（放最后，依赖 palaces / media）。
2. **路由登记**：`MODULE_ROUTER_TARGETS` 追加
   `("projects", "app.modules.projects.router")`、`("gallery", "app.modules.gallery.router")`；
   前缀自动加 `/api/v1`（模块内部组合 `/projects` + `/admin/projects`、`/gallery` + `/admin/albums`）。
3. **迁移**：按 §3 生成**单头** revision。我没有写 `migrations/`，也没有执行过任何迁移
   （只用 `--create-tables` 在自建的 dev 库上补齐过表）。
4. **Wiring（必须，两个独立登记）**：`app/main.py` 的 `register_content_domains()` 里加
   ```python
   from app.modules.projects import wiring as projects_wiring
   from app.modules.gallery import wiring as gallery_wiring
   projects_wiring.register()
   gallery_wiring.register()
   ```
   **不登记 = 匿名读作品 / 相册图片一律 404**（默认拒绝是刻意的安全默认值）。
   两个域分开登记的理由：可以单独回滚一个域的权限（例如相册出问题时先只撤相册）。
5. **删除本地验证入口**：`apps/api/app/t06_dev_app.py` 在路由登记后**请删除**（它只是
   「路由还没登记」时的本地 uvicorn 入口，不在生产路由清单里，也不改 `app/main.py`）。
6. **OpenAPI / 前端类型**：接线后重跑 `export_openapi.py` 与 `npm run gen:api`
   （`contracts/openapi.json` 会漂移一次，属预期）。
7. **INS 相册页签（一行改动，二选一）**：
   - 推荐（与 T08 已做的接线同形、可叠加）：把 `app/apps/ins/page.tsx` 的
     `InsAppWithMessages` 换成 `InsAppWithGalleryAndMessages`
     （`import { InsAppWithGalleryAndMessages } from "@/features/gallery/ins-integration"`），
     并把服务端读到的相册可用性传进去：`initialGalleryAvailable={albumPage.items.length > 0}`。
     该组件内部把 `MESSAGES_TAB`（T08，order 40）与相册页签（order 35）一起递给 `InsApp`。
   - 或者自己拼：`const gallery = useGalleryTab({ initialAvailable });` →
     `tabContributions={[...(gallery.available ? [galleryTabContribution(true)] : []), MESSAGES_TAB]}`。
   手机侧（`features/ins/phone-view.tsx`，T03/T08 所有）：把
   `useGalleryTabContribution(initialGalleryAvailable)` 的结果并进 `tabContributions` 数组
   （**一行**，我不改这个文件）。
8. **手机 manifest 登记**（原样可抄，字段与 §4.1 的清单一致）：
   ```ts
   {
     id: "showcase",
     name: "殿堂",
     subtitle: "作品与照片",
     icon: "/assets/legacy/img/icon/fox.webp",  // 仓库里真实存在（T02 迁移的旧站图标集）
     order: 30,                                  // 与 T03（ins=10）/ T04（metanav=20）排序一致
     kind: "embedded",
     canonical_path: "/showcase",
     loader: () => import("@/features/showcase/phone-app"),
     feature_flag: null,
     state_version: 1,                           // 本应用不写本机状态，该值只是契约字段
   }
   ```
   `phone-app.tsx` 的模块形状：`default` = `ShowcasePhoneView(PhoneViewProps)`、
   `screens = ["projects","project","photos","album"]`、`dispose()` = `abortAll()`。
   `icon` 说明：`fox.webp` 是仓库里已有的迁移图标（人物图标集），选它是因为「画廊 / 美术」
   的角色气质最贴近展厅；**不新增任何未经许可的素材**。若你要换，任何
   `/assets/legacy/img/icon/*.webp` 都行。
9. **首页 / 档案入口**：07 §7 建议「我的殿堂可从首页、档案和手机中的展厅入口访问」。
   本包**不改**首页与档案页（T02 所有），因此现在只有 canonical 路由与（登记后的）手机图标。
   需要首页入口的话请在 T02 的首页加一个指向 `/showcase` 的链接（或由 T05 的勒布朗视图引用）。
10. **相册与作品的既有数据**：本机的 `pl_test_t06_dev` 里有两个 `t06-` 前缀的**验证用相册**
    （浏览器脚本的夹具，脚本会保持它们公开）。生产/集成库不会自动有它们；
    要删就 `delete from albums where slug like 't06-%'`。

## 9. 未验证项及原因（不得当作已通过）

1. **Docker / 容器内启动**：本机 Docker daemon 未运行，所有验证都是本机进程
   （uvicorn + next start + 真实 PostgreSQL 18）。
2. **手机面板里的真实交互**：`features/phone/registry.ts` 由 T00 拥有，`showcase` 还没登记，
   因此**没有**在真实浏览器的手机面板里走完流程。手机侧证据是组件级与模块级：
   `screens` / `dispose` / `isSlug` 拒绝任意路径 / 清单 10 字段（4 个用例）。
   登记后需要补一次真实面板验证（属集成 / T10）。
3. **相册页签在真实 INS 里的组合**：`ins-integration.tsx` 有组件级用例（与 T08 的消息页签共存、
   order 正确、无相册时不注入），但**没有**在 `/apps/ins` 页面上看到过它 —— 那需要改
   `app/apps/ins/page.tsx`（T03 所有）或由 T00 接线。当前线上 `/apps/ins` 里**没有**相册页签。
4. **多进程 / 多实例下的限流与并发**：本包没有引入限流；作品 / 相册的写路径靠
   `If-Match` 与数据库唯一约束，没有做跨进程压力测试。
5. **真实照片素材**：仓库里**没有**任何真实摄影作品或游戏截图（只有 Persona 5 素材与旧站
   封面）。因此「记忆画廊」的线上内容目前是空的，浏览器验收用的是脚本临时上传的
   **验证用相册**（名字带「验证用」、说明里写明来源）。`projects.seed --photo-dir` 是给站主
   指到真实照片目录用的入口，我**没有**用它 —— 因为没有真实照片可指。这不是缺陷，
   但意味着「照片墙在真实内容下的观感」还没被看过。
6. **`year` / `month` 筛选在真实数据上的表现**：验收里的照片拍摄时间是脚本给的
   （2026-10-16 与空），年份按钮只有 `2026` 一个。多月份 / 跨年的真实表现未验证。
7. **`apps/api/tests/support/t06_{db,shared}.py` 放在 T00 的 `tests/support/` 下**：
   功能上没问题（T00 的目录没有「唯一修改人」限制写成硬规则，`module_app.py` 也在那里），
   但严格说它不属于「我的独占目录」。若 T00 更希望零越界，把这两个文件移进
   `tests/projects/`（`t06_db.py`）并让 `tests/gallery/conftest.py` 与两个 `helpers.py`
   改一行导入即可；我保留了现状以免在集成前制造第二个位置。
8. **管理前端只在桌面视口验证**：`/admin/projects` 与 `/admin/albums` 没有做 320/390 的
   几何断言（后台本身按桌面使用，与 T04 的同类说明一致）。
9. **`pytest` 全量套件不归我跑**：按 T00 的并发规则，开发期只跑自己的两个目录；T00/T01 的
   5 个目录另跑一次（122 passed）。**整棵树由集成负责人串行运行**。
10. **`timeOrigin` 判据只覆盖作品卡那一次跳转**：照片墙的筛选跳转是整页导航（`SiteLink`
    走 Next 路由，实测仍是客户端导航），但没有逐个断言 —— 只有作品卡那一条断言了
    `timeOrigin` 不变。

## 10. 遗留与需要外部选择

1. **相册标签（主题）没有实现**：07 §8 的 `albums` 行只给了 `kind`（摄影 / 游戏截图 / 其它）。
   要做「主题标签」需要先扩契约（`album_tags` 或复用 T01 的 tags），本包不自行发明。
   作者的「技术标签」同理：现在是 `projects.tech_stack`（JSONB 字符串数组），
   不是 T01 标签表的行，因此**不会**出现在 `GET /tags` 里。
2. **作品的封面只能来自作品自己的图片**：07 §5 没给作品封面单独的媒体字段，
   本包用「`kind=cover` 的第一张」表达。若将来要「封面与图集分开管理」，扩一个
   `projects.cover_media_id` 即可（需要先改契约）。
3. **`slug` 不可改**：公开 URL 稳定优先（与 nav 一致）。要改 slug 需要新建 + 迁移重定向。
4. **照片墙的 `total` 是实时 `count(*)`**：照片多到这个查询变成瓶颈时再加缓存列
   （当前实现刻意不缓存，避免「计数与权限不一致」）。
5. **`scope=global` 的排序把无拍摄日期的照片排在最后**：这是刻意选择（不知道日期不该假装最新）。
   若站主更希望「按上传时间混排」，需要改契约里的排序说明与游标版本。
6. **管理端不提供「这张图一共被几处引用」的实时列表**：只给了
   `media_reference_summary()`（按域给出 bool）。07 §5 只要求「明确提示」，
   更详细的列表（哪几个相册 / 哪件作品）需要跨域查询，属后续增强。
7. **`t06_dev_app.py` 与验证脚本的临时对象**：登记后请删除 `t06_dev_app.py`；
   `pl_test_t06_dev` 库、`/Users/学习/blog/.dsh/t06-media` 媒体目录、
   `/tmp/t06-runtime/`（隔离构建的 APFS clone）可随时删除。

## 11. 复现命令（从零到浏览器证据）

```bash
cd /Users/学习/blog/Blogs
export npm_config_cache=/Users/学习/blog/.dsh/npm-cache
export UV_CACHE_DIR=/Users/学习/blog/.dsh/uv-cache
export TEST_DATABASE_URL="postgresql+psycopg://pl@127.0.0.1:55432/pl_test"

# 1) 后端模块测试（自建 pl_test_t06_<pid>，结束自动 drop）
uv run --project apps/api pytest apps/api/tests/projects apps/api/tests/gallery   # 143 passed

# 2) 前端
npm --prefix apps/web run typecheck && npm --prefix apps/web run lint
npm --prefix apps/web run test -- --run                                            # 609 passed
DEV_API_URL=http://127.0.0.1:8103 npm --prefix apps/web run build                  # 建议在 clone 里跑
node --test tests/*.test.cjs                                                       # 53 passed（旧站）

# 3) 真实数据 + 真实服务（本地 dev 库，名字带 test 以便通过守卫）
/opt/homebrew/opt/postgresql@18/bin/createdb -h 127.0.0.1 -p 55432 -U pl pl_test_t06_dev
cd apps/api
uv run --project . alembic -x db_url="postgresql+psycopg://pl@127.0.0.1:55432/pl_test_t06_dev" upgrade head
export APP_ENV=dev DATABASE_URL="postgresql+psycopg://pl@127.0.0.1:55432/pl_test_t06_dev" \
       SECRET_KEY="t06-local-dev-secret-key-0123456789abcdef" \
       MEDIA_ROOT="/Users/学习/blog/.dsh/t06-media" CORS_ORIGINS="http://127.0.0.1:3103"
echo "t06-owner-password-123" | uv run --project . python -m app.commands.bootstrap_admin \
       --username t06owner --password-stdin
uv run --project . python -m app.commands.import_legacy --apply --no-covers --repo-root ../..
uv run --project . python -m app.modules.nav.seed --create-tables --apply --publish --json
uv run --project . python -m app.modules.projects.seed --create-tables --apply --publish \
       --palace-slug phantom-base --json
uv run --project . uvicorn app.t06_dev_app:app --host 127.0.0.1 --port 8103 &

# 4) 前端（工作区的 apps/web/.next 是共享产物；要隔离就在 clone 里构建）
rm -rf /tmp/t06-runtime/web && cp -Rc /Users/学习/blog/Blogs/apps/web /tmp/t06-runtime/web
cd /tmp/t06-runtime/web && DEV_API_URL=http://127.0.0.1:8103 npm run build
API_INTERNAL_URL=http://127.0.0.1:8103 npx next start -p 3103 &

# 5) 真实浏览器验收（47 项；自带真实管理 HTTP 夹具）
cd /Users/学习/blog/Blogs
python3 apps/web/features/gallery/tools/verify-showcase.py

# 收尾：按端口精确停止自己的服务（**不要**按名字 pkill，会影响其他人）
lsof -ti tcp:8103 | xargs -r kill
lsof -ti tcp:3103 | xargs -r kill
```

清理：`pl_test_t06_<pid>` 由夹具自动 drop；`pl_test_t06_dev`、`/Users/学习/blog/.dsh/t06-media`、
`/tmp/t06-runtime/` 与 `/tmp/t06-*.log` 可随时删除；
`delete from albums where slug like 't06-%'` 可清掉验证用相册。
控制台里不再有任何本包启动的服务（8103 / 3103 已停）。
