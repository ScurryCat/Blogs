# T04 · 交付单（异世界导航与专题殿堂）

```text
任务：T04 / 异世界导航与专题殿堂（专题、三关键词定位、搜索、分类印象空间、本机足迹）
状态：implemented_waiting_integration —— 代码、测试与真实浏览器验收全部跑通；
      模型 / 路由 / 迁移 / manifest 由 T00 集成（见 §8），故本单只主张「模块可用」，
      不主张「已接线可用」。
基线：main @ f1738a1（T00 派发 T03/T04 的提交）＋ 工作区里 T03 的在途改动
      开始时 `git status --short` 只有一条不属于本包的 M（T02 的 verify.py）；
      本轮未提交、未推送、未建分支 / worktree、未启动任何子 agent
外部影响：未调用任何模型或付费服务；未部署；未写共享测试库 `pl_test`
          （验证只用自建 `pl_test_t04` 与本地 dev 库 `pl_test_t04_dev`）
```

## 1. 本轮范围

**已完成**

| 组 | 内容 |
| --- | --- |
| 后端模型 | `palaces` / `palace_aliases` / `palace_posts`（唯一 slug、字段枚举 CHECK、同专题文章唯一 + 顺序唯一、公开列表部分索引） |
| 后端公开 API | `GET /nav/palaces`、`GET /nav/palaces/{slug}`、`POST /nav/resolve`、`GET /nav/search` |
| 后端管理 API | `/admin/nav/palaces` 的列表 / 详情 / 新建 / 更新 / 发布 / 撤回 / 软删除（站主 + CSRF + `If-Match`） |
| 匹配 | NFKC + trim + 大小写折叠 + 空白折叠；标准值 ∪ 别名；三字段求交集 → `found` / `ambiguous` / `not_found`；多候选确定性排序 |
| 搜索 | 标题完全匹配 → 标题 / 别名 → 标签 → 摘要四档排名，同档 `published_at DESC, id DESC`，`kind` 最终区分；多词全部命中；`%` / `_` 转义；不透明游标带筛选指纹 |
| 印象空间 | 复用 `GET /posts?category=`（没有新端点），前端只做分类说明与空态 |
| 首个专题 | 「怪盗据点工程」（`phantom-base`）用**已有 4 篇公开文章**组成，命令可复现、幂等、不杜撰 |
| 前端 | `features/metanav/`：同一 `MetanavView` 供手机内置应用与独立页；认知定位表单、搜索、印象空间、专题阅读页、本机足迹（上限 30、可清除、存储不可用降级） |
| 管理前端 | `/admin/palaces`（列表 + 新建 + 发布 / 撤回 / 软删除）与 `/admin/palaces/[id]`（编辑 + 有序文章 + 别名 + 预览 + 412 保留输入） |
| 本机足迹 | `localStorage`，与手机宿主同一套键（`pl-app:metanav:v1:*`），手机与独立页共享 |
| 验证工具 | `features/metanav/tools/verify-metanav.py`（Playwright，35 项，含撤回后真 404） |

**未完成 / 不在本包**：问题记录 CRUD（T09）、技能卡（T09）、作品集（T06）、公开访客请求板（未在任何包内，属后续评审）；手机桌面上的**可见入口**要等 T00 把 manifest 写进 `features/phone/registry.ts`（§8.4）。

## 2. 文件

**新增（本包独占）**

```text
apps/api/app/modules/nav/
  __init__.py  models.py  schemas.py  service.py  router.py
  ratelimit.py      公开读取的进程内限流（429 + Retry-After）
  wiring.py         集成声明（无共享注册表贡献）+ 跨模块只读门面
  seed.py           首个专题的幂等初始化命令（default dry-run）
  dev_app.py        本地验证入口：生产 app + 补挂 nav（T00 登记路由后即可删）
apps/api/tests/nav/
  __init__.py  conftest.py  helpers.py
  test_public_nav.py  test_resolve.py  test_search.py
  test_admin_nav.py   test_nav_boundaries.py
apps/web/features/metanav/
  types.ts  api.ts  failure.ts  footprint.ts  footprint-react.ts  inflight.ts
  paths.ts  host.ts  mugen.ts
  metanav-view.tsx  palaces-screen.tsx  resolve-screen.tsx  search-screen.tsx
  mugen-screen.tsx  palace-card.tsx  palace-reading.tsx  palace-reading-loader.tsx
  palace-entry-link.tsx  standalone.tsx  phone-app.tsx  metanav.module.css
  admin/{alias-lines.ts,session.tsx,palace-admin-list.tsx,palace-admin-editor.tsx}
  tools/verify-metanav.py
  *.test.ts(x)（6 个文件 / 46 个用例）
apps/web/app/apps/metanav/page.tsx
apps/web/app/apps/metanav/palaces/[slug]/page.tsx
apps/web/app/admin/palaces/page.tsx
apps/web/app/admin/palaces/[id]/page.tsx
```

**未改动**（所有权红线，逐条核对过）：`app/{main,router,model_registry}.py`、`app/core/**`、`app/modules/{auth,media,tags,posts}/**`、`app/commands/**`、`migrations/**`、两个锁文件、`apps/web` 的全部根配置（`package.json` / `tsconfig` / `next.config.ts` / `eslint` / `vitest`）、`features/phone/registry.ts`、`lib/api/generated/`、`contracts/`、`deploy/`、`app/{layout,globals.css,page,about,map,weather,guestbook,posts,healthz}`、`features/{runtime,phone(除 registry),legacy}`、`components/ui/`、`lib/api/`（除 generated）、`public/`、`styles/`、`tests/*`、`tools/`，以及 T03 的 `modules/moments`、`features/ins`、`app/apps/ins`、`app/admin/moments`。
唯一「看起来像越界」的两处都不是：`features/metanav/tools/verify-metanav.py` 在本包目录内；只**读**了 T02 的 `tests/helpers/*` 与 `LocalStateService`。

## 3. 模型清单与迁移意图（交 T00 生成迁移）

| 表 | 列 | 数据库级约束 |
| --- | --- | --- |
| `palaces` | id、唯一 slug、title、summary、name、location、cognition、status、published_at、created_at、updated_at、deleted_at、version | `ck_palaces_status_valid`（draft/published）、`ck_palaces_version_positive`、`ix_palaces_public_listing`（部分索引：`status='published' AND deleted_at IS NULL`，键 `published_at, id`） |
| `palace_aliases` | id、palace_id→palaces(CASCADE)、field、value、normalized_value | `ck_palace_aliases_field_valid`（name/location/cognition）、`uq_palace_aliases_palace_id_field_normalized_value`、`ix_palace_aliases_field_value`（field, normalized_value） |
| `palace_posts` | id、palace_id→palaces(CASCADE)、post_id→posts(CASCADE)、position | `uq_palace_posts_palace_id_post_id`、`uq_palace_posts_palace_id_position`、`ck_palace_posts_position_non_negative` |

**迁移影响**：三张新表 + 4 个索引，不修改任何既有表；没有数据回填。`palace_posts.post_id` 指向 `posts`，因此迁移顺序必须在 T01 的 posts 之后（`MODEL_MODULES` 里 `app.modules.nav.models` 放最后）。
**回退限制**：`upgrade` 之外的回退会连带删掉专题与关系（内容），不是纯 schema 回退 —— 生产环境请先备份。
**交叉证据**：`tests/nav/conftest.py` 先跑 `alembic upgrade head`、再 `create_all` 补齐缺失表；T00 生成迁移后，用例会在**真实迁移建出的表**上跑（表结构不对就会因为缺列 / 缺约束而失败，不会被夹具悄悄修好）。

## 4. 契约增量

### 4.1 路由（前缀由 T00 登记，模块内部自己组合两条前缀，与 media 相同）

| 方法与路径 | 权限 | 说明 |
| --- | --- | --- |
| `GET /api/v1/nav/palaces` | 公开 | `cursor`、`limit`（默认 12 / 最大 30）→ `{items, next_cursor}` |
| `GET /api/v1/nav/palaces/{slug}` | 公开 | 标准关键词 + 有序公开文章；草稿 / 已删除 / 无公开文章 / 不存在统一 404 |
| `POST /api/v1/nav/resolve` | 公开（无副作用、不需要 CSRF） | `{name, location, cognition}` → 200 `{status, matches[]}`；每项 1–80 码点，纯空白 422 |
| `GET /api/v1/nav/search` | 公开 | `q`（1–80）、`kind`（post/palace）、`tag`、`cursor`、`limit`（默认 20 / 最大 30） |
| `GET /api/v1/admin/nav/palaces` | 站主 | 管理列表（含草稿、别名冲突提示），`cursor` / `limit` |
| `GET /api/v1/admin/nav/palaces/{id}` | 站主 | 管理详情（含草稿关系 + `public` 标记）+ `ETag: "<version>"` |
| `POST /api/v1/admin/nav/palaces` | 站主 + CSRF | 201；新建总是草稿 |
| `PATCH /api/v1/admin/nav/palaces/{id}` | 站主 + CSRF + `If-Match` | 只改出现过的字段；`aliases` / `post_ids` 传入即**完整替换**；`slug` 不可改（带 slug → 422） |
| `POST .../{id}/publish` / `.../unpublish` | 站主 + CSRF + `If-Match` | 发布要求至少一篇公开文章，否则 409 `CONFLICT` |
| `DELETE .../{id}` | 站主 + CSRF + `If-Match` | 204 软删除，**不删除文章** |

### 4.2 本模块定义的、05 未规定的细节（请登记为约定）

1. **搜索游标是四元组**：排序键为 `(rank, published_at, id, kind)`，core 的两元组游标表达不了，因此 nav 自带一个**同形游标**（base64 JSON：`v/r/s/i/k/f`），指纹复用 `core.pagination.filter_fingerprint`。格式不合法、版本不认识、指纹与当前 `q/kind/tag` 不符一律 400 `VALIDATION_FAILED`。
2. **排名档位**：`0` 标题完全匹配、`1` 标题 / 别名命中、`2` 标签命中、`3` 摘要命中；多词查询取各词档位的**最好**值，但**每个词都必须命中**（否则整条不入选）。`kind` 作为最后一级排序键（`palace` < `post`）。
3. **匹配在 Python 侧完成**：PostgreSQL 的 `lower(normalize(…, NFKC))` 与 Python 的 `casefold` 在 `ß`/`ﬀ` 这类字符上不等价，而定位结果必须可复现，所以 `resolve` 取「公开专题全量 + 内存集合运算」，唯一一份规则是 `core.text.normalize_for_match`。搜索的**过滤与排序在 SQL 里**（`lower(normalize(col, NFKC))` + 转义 LIKE），只在极端字符上与 casefold 有差异（已记录，见 §9.3）。
4. **限流**：`/nav/resolve` 与 `/nav/search` 各 60 次/分钟/IP，**进程内**固定窗口，键是 `sha256(scope:ip)` 截断（不存原始 IP），429 带 `Retry-After`。多进程部署时阈值会按进程数放大（§9.4）。
5. **`published_at` 只在首次发布时写入**，撤回只改 `status`；重新发布不会刷新历史发布时间。
6. **`post_count` / `public_post_count` 是每次查询实时统计**，不是缓存列，也不作为权限条件。
7. **`openapi.json` 与前端生成类型**：nav 的 9 条路径必须由 T00 在接线后重新生成（`tests/test_openapi_contract.py` 会因此失败一次，属预期）。

### 4.3 环境变量

**无新增**。`NAV_*` 一律没引入：限流阈值是模块常量（`app/modules/nav/ratelimit.py`），如需可配置请 T00 加 `Settings` 字段（`app/core/config.py` 归 T01）。

## 5. 验证（全部实际执行）

前置：`export TEST_DATABASE_URL="postgresql+psycopg://pl@127.0.0.1:55432/pl_test"`（开发期只跑本目录，见 §9.6）。

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `uv run --project apps/api pytest apps/api/tests/nav` | 0 | **59 passed**（连跑 3 次结果一致）；自建 `pl_test_t04` 并自行 drop |
| `uv run --project apps/api pytest apps/api/tests/{core,auth,posts,media,tags}` | 0 | **117 passed** —— T00/T01 既有后端零回归（`pl_test` 只做 `upgrade head`） |
| `node --test tests/*.test.cjs` | 0 | **53 passed / 0 failed** —— 旧站零回归 |
| `npm --prefix apps/web run typecheck` | 0 | tsc 无输出 |
| `npm --prefix apps/web run lint` | 0 | 0 error / 0 warning（全仓库） |
| `npm --prefix apps/web run test -- --run` | 0 | **301 passed / 32 files**（含 T02 新增的 storage 回归 4 例）；其中本包 `features/metanav/**` **46 passed / 6 files** |
| `DEV_API_URL=http://127.0.0.1:8100 npm --prefix apps/web run build` | 0 | 路由表含 `○ /apps/metanav`、`ƒ /apps/metanav/palaces/[slug]`、`○ /admin/palaces`、`ƒ /admin/palaces/[id]` |
| `python3 apps/web/features/metanav/tools/verify-metanav.py` | 0 | **35 passed / 0 failed**，8 张截图（真实 chromium，无 mock）；改回走 `host.state.clear` 之后**又跑了一次**，含「足迹可以清除」全绿 |
| `python3 -m app.modules.nav.seed --json`（dry-run） | 0 | 报告 4 篇真实文章都在、`would_create:false`（已存在） |
| `python3 -m app.modules.nav.seed --apply --publish --json`（第二次） | 0 | `created:false`、`published:false`、`public_post_count:4` —— **幂等，不覆盖站主改动** |

### 5.1 真实 PostgreSQL（不是 SQLite）

`tests/nav/conftest.py` 经共享 helper `tests.core.t01_db.register_temp_database("pl_test_t04")` 登记库名，用共享的 `create_database` / `drop_database`（不再自备第二份实现）；用例在一个事务里跑并回滚，因此互不影响。
约束证据（用例断言的是真实约束行为）：重复文章关系 / 重复 position 触发 `IntegrityError`；别名同字段规范值重复与非法 field 被 CHECK / 唯一键拒绝。

### 5.2 真实服务（uvicorn + 真实 dev 库）

```text
DB      pl_test_t04_dev（本地测试集群 55432；alembic upgrade head + T01 的 import_legacy --apply --no-covers）
API     APP_ENV=dev DATABASE_URL=…pl_test_t04_dev uvicorn app.modules.nav.dev_app:app --port 8100
        GET  /api/v1/nav/palaces                → 200，1 座殿堂 / post_count 4
        GET  /api/v1/nav/palaces/phantom-base   → 200
        POST /api/v1/nav/resolve（全角 + 别名）  → {"status":"found", …}
        GET  /api/v1/nav/search?q=斜切&kind=post → 排名后的文章结果
WEB     DEV_API_URL=http://127.0.0.1:8100 npm run build && API_INTERNAL_URL=http://127.0.0.1:8100 npm run start
        /apps/metanav                            → 200
        /apps/metanav/palaces/phantom-base       → 200（服务端渲染）
        /apps/metanav/palaces/nope-nope          → 404（**真正的 404**）
```

### 5.3 真实浏览器验收（Playwright + 系统 chromium，35/35）

`features/metanav/tools/verify-metanav.py`。**点击前先等 `window.__PHANTOM_DEBUG__` 出现**（水合完成）再等业务状态，否则点到的是原生链接、会变成整页跳转、看起来通过但其实没验到来源协议（T02 踩过的坑，脚本顶部有注释）。

关键证据：

```text
点「进入殿堂」  navigation.source=metaverse-entry, kind=joker, transition={crowd:false, joker:true, wipe:false}
打开应用本身    navigation.source=null
匹配结果出现    navigation.source=null, transition 三项全 false
从匹配结果进入  navigation.source=metaverse-entry
搜索里的文章    navigation.source=phone-link（普通站点跳转，不是认知入口）
直接打开专题    transition 全 false 且 source=null（不重播）
Back 回列表     transition 全 false
撤回全部文章    列表 [data-palace] 0 张；详情 HTTP **404**；恢复后 200
输入不合法      「这一项不能为空」且**没有发出 /nav/resolve 请求**
未找到          200 业务结果 + 保留输入 + 给出建议
服务故障        用 Playwright 在上游中断请求 → 「导航暂时不可用」（与未找到文案不同）
脚印            进入后出现在足迹里；「清除足迹」后清空
320 / 390       /apps/metanav 与专题页 scrollWidth-clientWidth 均为 0px
```

**截图（绝对路径）**：`/Users/学习/blog/.dsh/screenshots/`
`t04-metanav-desktop.png`、`t04-metanav-390.png`、`t04-metanav-320.png`、`t04-palace-desktop.png`、`t04-palace-390.png`、`t04-palace-320.png`、`t04-resolve-found.png`、`t04-search-desktop.png`。

### 5.4 首个专题「怪盗据点工程」（真实内容，非杜撰）

```text
slug        phantom-base
标题 / 简介 怪盗据点工程 / 把博客从静态页面改造成怪盗基地的全过程：设计、可访问性与素材来源。
关键词      ScurryCat / 个人博客 / 据点
别名        PHANTOM、怪盗手记 / 博客、Blog / 基地、Hideout
文章（顺序）phantom-blog-launch → css-p5-menu → a11y-checklist → assets-and-credits
           （4 篇全部是旧站导入的**真实已发布文章**；来源 assets/js/posts.js）
```

复现：`python -m app.commands.import_legacy --apply --no-covers` → `python -m app.modules.nav.seed --apply --publish`。
**数据不足时的行为**：任一 slug 缺失 → 整体不写、退出码 2 并列出缺哪些；绝不创建半个专题或补写文章。本机导入 8 篇，四篇都在，因此直接创建并发布成功（dry-run 与 apply 的输出都记在 §5 表里）。

### 5.5 真实缺陷（都是本轮抓到并修掉的，附回归方式）

1. **进入殿堂不记足迹**：`recordVisit` 只在「重访」路径调用，浏览器验收发现进入后足迹是空的。现在所有明确进入（卡片、匹配结果、其他殿堂链接）都先记一次；存储不可用只提示、不阻止进入。
2. **「清除足迹」静默失效**：宿主 `LocalStateService.clear()` 只删**该实例写过的**键，换页后新实例的 `written` 为空 → 点清除后条目仍在（浏览器验收抓到）。已把这个跨包发现报给 T00；**T00 于 `5f6f0ab` 修好共享实现**（`collectKeys` = 本实例写过的 ∪ 存储里同前缀的键，并补 `tests/runtime/storage.test.ts` 4 例，且证明过「还原旧逻辑 → 3 例失败」）。我随后**删掉了自己的临时兜底**（不再直接扫 `localStorage`，手机与独立页都只经注入的状态适配器），并重跑真实浏览器验收：**35/35 仍然全过，含「足迹可以清除」**。
3. **独立页加载器把 404 说成「服务不可用」**：`useLoader` 给的 `state.failure` 已经是分类结果，我又 `classifyFailure` 了一次，`not_found` 被降级成 `unavailable`。已修 + 补 3 个用例（`palace-reading-loader.test.tsx`）。
4. **Server Component 导入 Hook 模块导致构建失败**：`palace-reading.tsx`（服务端）导入 `host.ts`（含 `useEffect`）→ Turbopack 直接报错。已把纯部分拆到 `paths.ts`（无 React 导入），`host.ts` 只留 `useLoader` 并再导出纯符号。
5. **`useSearchParams()` 缺 Suspense 边界**：`/apps/metanav` 预渲染直接失败。已按 T02 的做法在页面里包 `<Suspense>`（静态外壳 + 客户端交互）。
6. **React Compiler 规则**：`react-hooks/set-state-in-effect`（effect 里同步 setState）与 `refs`（渲染期写 ref）在本包触发。已改为「派生加载态 + `requestKey` 配对」、「渲染期按 (id, version) 调整编辑状态」、`useSyncExternalStore` 订阅足迹 —— 现在本包 lint 0 error / 0 warning。

## 6. 任务卡「验收用例」逐条对照

| 用例 | 证据 |
| --- | --- |
| 1 不熟悉 P5 也能从列表直接进文章 | 浏览器：「列表 → 进入殿堂 → 章节 → `/posts/phantom-blog-launch`」两次操作内到达；列表页有普通中文说明（“不熟悉 Persona 也没关系”） |
| 2 标准值 / 别名 / 全角 / 多匹配都正确；未找到 ≠ 服务故障 | 后端：`test_resolve.py`（9 例，含 `ＳｃｕｒｒｙＣａｔ`、`  ScurryCat  `、别名重叠 → ambiguous 且顺序可复现、跨殿堂交集 → not_found、空白 / 超长 → 422）；浏览器：全角 + 别名混合 → found，409/含 404 之外故障 → 「导航暂时不可用」 |
| 3 关联文章全部撤回后各处不可读 | 后端：`test_public_nav.py::test_retracting_every_post_hides_the_palace_everywhere`、`test_search.py::test_retracted_content_disappears_from_search`、`test_resolve.py::test_retracted_palace_stops_matching`；浏览器：SQL 真的把 4 篇改成 draft → 列表 0 张卡、详情 **404** → 恢复后 200 |
| 4 不泄漏草稿标题 / 标签；跨页游标校验指纹 | 后端：`test_detail_hides_draft_posts_and_their_tags`（断言响应文本里没有草稿标题与草稿标签）、`test_logged_in_owner_still_gets_public_view_only`、`test_cursor_is_bound_to_the_current_filters`（换 q/kind/tag → 400）、列表游标与搜索游标互换 → 400 |
| 5 打开 / 输入 / 匹配不播全屏动画；明确进入、历史返回、直接 URL 各自正确 | 浏览器 6 条采样（§5.3）；单测：`metanav-view.test.tsx` 断言「打开应用不调用 openContent」「匹配后不自动跳转」「只有点进入才发送 metaverse-entry」，以及协调器侧 `navigation.source==="metaverse-entry" && kind!=="crowd"` |
| 6 手机与独立页一致；存储不可用不阻止导航 | 同一 `MetanavView` 两个宿主（`phone-app.tsx` / `standalone.tsx`），足迹共用 `pl-app:metanav:v1:*`；`footprint.test.ts` 覆盖 `persisted:false` 仍可读回、`metanav-view.test.tsx` 覆盖「存储不可用仍能进入殿堂」 |

## 7. 每包必做清单（ACCEPTANCE §1）

- 需求都有对应测试：先写会失败的断言（本轮 6 个契约缺陷都是先红了再修，见 §5.5）；没有「永远通过的快照」。
- 类型检查 / 模块测试 / 数据库约束 / 构建都有真实命令与退出码（§5）；未运行项单列（§9）。
- 新公开内容在列表、详情、搜索、分享、图片路径都验证权限：nav **没有自己的媒体**，不注册媒体公开引用检查（`wiring.verify_no_shared_contributions()` 是执行性断言）；列表 / 详情 / 搜索 / 定位四条读取路径都验证了草稿与撤回不可见；分享路径 = canonical URL（浏览器验证直接 URL + 刷新 + Back）。
- 320 / 390px、键盘、关闭、焦点、减少动态效果、失败状态：320 / 390 无横向溢出并截图；表单是原生 `label/input` + `datalist`，键盘可用；`prefers-reduced-motion` 下协调器直接导航（T02 的既有规则，本包不覆盖）；失败态有「重新读取 / 重试」。
- 只有真实行为才显示计数与提示：`post_count` 来自实时统计；足迹只显示真的访问过的；没有假按钮（未接入的 T09 问题记录**不显示任何入口**，见 §8.6）。
- 模块退出取消读取与监听：`useLoader` 卸载即 abort；认知定位的请求登记进 `inflight.ts`，卸载与 `dispose()` 都会取消（`phone-app.test.tsx` 用「永不 resolve 的请求 + 断言 signal.aborted」验证）；`useSyncExternalStore` 卸载即退订；晚到的响应被 `isAbort()` 拦住，不写回状态。
- 不新增生产密钥 / 绝对本机素材路径 / 任意 HTML 执行 / 未授权外部调用 ✓。

## 8. 集成申请（T00 动作）

1. **模型注册**：`MODEL_MODULES` 追加 `"app.modules.nav.models"`（放最后，依赖 posts）。
2. **路由登记**：`MODULE_ROUTER_TARGETS` 追加 `("nav", "app.modules.nav.router")`；前缀自动加 `/api/v1`，nav 的 `router` 是空前缀容器，内部组合 `/nav` 与 `/admin/nav/palaces`（与 media 相同做法）。登记后请删除 `app/modules/nav/dev_app.py`（它只是「路由还没登记」时的本地验证入口）。
3. **迁移**：按 §3 生成单头 revision；我**没有**写 `migrations/`，也没有执行过任何迁移（只在自建 dev 库上用 `alembic upgrade head` + T01 的表，nav 表用 `--create-tables` 临时补齐）。
4. **Wiring**：**不需要**为 nav 在 `main.py` 里做任何登记 —— nav 不贡献媒体公开引用、也不贡献公开标签来源（专题标签由关联公开文章派生），`nav/wiring.py: verify_no_shared_contributions()` 是可执行断言。跨模块只要**读**：`service.related_public_palaces_for_post()` / `public_palace_by_slug()` / `public_palace_options()` 供 T06（作品关联专题）与 T09（问题记录）使用。
5. **OpenAPI / 前端类型**：接线后重跑 `export_openapi.py` 与 `npm run gen:api`（`contracts/openapi.json` 会漂移一次，属预期）。
6. **手机 manifest 登记**（原样可抄，字段与 §4 表一致）：

   ```ts
   {
     id: "metanav",
     name: "导航",
     subtitle: "异世界导航",
     icon: "/assets/legacy/img/icon/oracle.webp",   // 仓库内真实资源（迁移资源，已审核）
     order: 20,                                      // 与 T03 协调：ins 在前、metanav 其次
     kind: "embedded",
     canonical_path: "/apps/metanav",
     loader: () => import("@/features/metanav/phone-app"),
     feature_flag: null,
     state_version: 1,                               // 与 footprint 的存储键版本一致
   }
   ```

   `phone-app.tsx` 的模块形状：`default` = `MetanavPhoneView(PhoneViewProps)`、`screens = ["palaces","resolve","search","mugen"]`、`dispose()` = `abortAll()`。
   `icon` 说明：`oracle.webp` 是仓库里已有的迁移图标资源（T02 的 `public/assets/legacy/img/icon/`，人物图标集）；选它是因为「导航担当」这一角色气质最贴近导航应用，且**不新增任何未经许可的素材**。若你要换，任何 `/assets/legacy/img/icon/*.webp` 都行。
7. **组合入口（T09）**：本包**不显示**任何「问题记录」入口（未接入不显示空功能）。T09 交付后由 T00 在 `metanav-view.tsx` 的专题阅读页插槽接入；后端可用 `related_public_palaces_for_post()` 反查。

## 9. 未验证项及原因（不得当作已通过）

1. **Docker / Compose 内的启动**：本机 Docker daemon 未运行（T00 已知），所有验证都是本机进程（uvicorn + next start + 真实 PostgreSQL 18）。
2. **手机宿主里的完整交互**：`registry.ts` 由 T00 拥有，nav 还没登记进桌面，因此**没有**在真实浏览器的手机面板里走完 metanav 流程。手机侧证据是组件级：`phone-app.test.tsx`（模块形状、`dispose()` 取消请求、`openContent` 的来源）+ `metanav-view.test.tsx`（`changeScreen` = phone-internal 语义）。登记后需要补一次真机面板验证（属 T10/集成）。
3. **搜索 SQL 与 Python 在极端字符上的差异**：SQL 用 `lower(normalize(col, NFKC))`、别名列用 Python `casefold`。ASCII / 中文 / 全角 / 大小写在我覆盖的用例里一致；`ß`、`ﬀ` 这类 casefold 展开字符在**标题 / 摘要 / 标签**上可能与别名行为不同（别名精确走 casefold 值）。需要的话给标准值加规范列 + 索引再统一。
4. **限流的多进程语义**：进程内计数，多 worker / 多容器时实际阈值 × 进程数；严格全局限流需要网关或共享计数（T10 决定）。
5. **管理前端只在桌面视口验证**：`/admin/palaces` 与编辑页没有做 320/390 的几何断言（只做了「不横向溢出」的目视；后台本身按桌面使用）。管理端点的行为由 20 个后端用例覆盖。
6. **全量后端套件不归我跑**：按 T00 的并发规则，开发期只跑 `apps/api/tests/nav`；T00/T01 的 5 个目录另跑一次（117 passed），**整棵树由集成负责人串行运行**（含 T03 的 `tests/moments`）。
7. **`published_at` 的时区形态**：本机响应是 `+08:00`（数据库会话时区），与 T01 的 `posts` 完全一致；05 §2 写的是「响应为 UTC ISO 8601」。这是既有的全局约定问题（同一个 instant，只是偏移量），不属 nav 单独修的范围 —— 请 T00 决定是否给 API 连接统一设 `timezone=UTC`。
8. **A11y 细节**：表单有 `label` / `aria-invalid` / `aria-describedby` / `aria-live`，但没有跑 axe 之类的自动审计；键盘路径在浏览器里验证了 Tab 与 Enter 提交。

## 10. 遗留与需要外部选择

1. **管理端文章选择器只列公开文章**：文章管理 UI（含草稿）属后续功能（05 §7 末尾），所以现在只能从 `GET /posts` 的公开列表里挑 UUID；要给草稿文章建立关系需要 T01 补文章管理端点。
2. **`slug` 不可改**：公开 URL 稳定优先（05 §2）。要改 slug 需要新建 + 迁移重定向，属后续决定。
3. **搜索无分页缓存、无 `pg_trgm`**：按 04 §6「少量内容先用参数化条件查询」，测量到瓶颈再加索引。
4. **`resolve` 的候选集是全量公开专题**：个人站点规模（几十座）没问题；上千座时需要给标准值加规范列 + 索引。
5. **专题没有封面 / 图谱**：04 §4A 提到“已发布文章数量”，本包用实时计数；封面与专题预览图未在本期设计内，若需要请先定素材来源与媒体引用规则。
6. **`dev_app.py` 是临时入口**：T00 登记路由后应删除；它不在生产路由清单里，也不改变 `app/main.py`。
7. **跨包发现已闭环**：`LocalStateService.clear()` 换页后失效（§5.5 第 2 条）已由 T00 修好（`5f6f0ab` + 4 例回归测试），本包不再持有兜底代码。

## 11. 复现命令（从零到浏览器证据）

```bash
cd /Users/学习/blog/Blogs
export UV_CACHE_DIR=/Users/学习/blog/.dsh/uv-cache
export npm_config_cache=/Users/学习/blog/.dsh/npm-cache
export TEST_DATABASE_URL="postgresql+psycopg://pl@127.0.0.1:55432/pl_test"

# 1) 后端模块测试（自建 pl_test_t04，结束自动 drop）
uv run --project apps/api pytest apps/api/tests/nav            # 59 passed

# 2) 前端
npm --prefix apps/web run typecheck && npm --prefix apps/web run lint
npm --prefix apps/web run test -- --run                        # 301 passed
DEV_API_URL=http://127.0.0.1:8100 npm --prefix apps/web run build
node --test tests/*.test.cjs                                   # 53 passed（旧站）

# 3) 真实数据 + 真实服务（本地 dev 库，名字带 test 以便通过守卫）
/opt/homebrew/opt/postgresql@18/bin/createdb -h 127.0.0.1 -p 55432 -U pl pl_test_t04_dev
cd apps/api
uv run --project . alembic -x db_url="postgresql+psycopg://pl@127.0.0.1:55432/pl_test_t04_dev" upgrade head
export APP_ENV=dev DATABASE_URL="postgresql+psycopg://pl@127.0.0.1:55432/pl_test_t04_dev" \
       SECRET_KEY="t04-local-dev-secret-key-0123456789abcdef"
uv run --project . python -m app.commands.import_legacy --apply --no-covers --repo-root ../..
uv run --project . python -m app.modules.nav.seed --create-tables --apply --publish --json
uv run --project . uvicorn app.modules.nav.dev_app:app --host 127.0.0.1 --port 8100 &
cd ../web
API_INTERNAL_URL=http://127.0.0.1:8100 npm run start &          # 端口 3100
cd ../..
python3 apps/web/features/metanav/tools/verify-metanav.py       # 35 passed / 0 failed

# 收尾：按端口精确停止自己的服务（不要按名字 pkill，会影响其他人）
lsof -ti tcp:8100 | xargs -r kill
lsof -ti tcp:3100 | xargs -r kill
```

清理：`pl_test_t04` 由夹具自动 drop；`pl_test_t04_dev` 与 `/tmp/t04-*.log` 可随时删除；
控制台里不再有任何本包启动的服务。
