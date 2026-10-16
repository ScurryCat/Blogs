# T09 · 交付单（天鹅绒房间技能全书与印象空间问题记录）

```text
任务：T09 / 天鹅绒房间技能全书与印象空间问题记录（技能证据、合体筛选、站主问题日志）
状态：implemented_waiting_integration —— 代码、123 个后端用例、96 个前端用例（12 个文件）、生产构建
      与 54 项真实浏览器验收全部跑通；模型 / 路由 / 迁移 / OpenAPI / 前端类型 / 手机 manifest 由 T00
      完成（见 §7），因此本单只主张「模块可用 + 浏览器已联调」，不主张「已接线可用」。
基线：main @ 0f73cfd（本轮开始时可读到的 HEAD 是 b3ce884；运行期间集成负责人推进到 0f73cfd
      「docs: 记录客户端取数路径的系统性审计」，本包没有提交、没有推送、没有建分支 / worktree、
      没有启动任何子 agent）。工作区里 T10 的在途未跟踪目录（`deploy/`、`.github/`、`docs/operations/`、
      `tests/e2e/`、`docs/agent-deliveries/T10-result.md`）本包一个都没碰。
      本包**没有修改任何被 T00/T01/T02/T03/T04/T05/T06/T07/T08/T10 拥有的文件**。
外部影响：未调用任何模型或付费服务；未部署；未写共享测试库 `pl_test`（自己的用例跑在
          `pl_test_t09_<pid>`，联调跑在 `pl_test_t09_dev`，两个名字都命中 T00 的库名守卫）。
```

## 1. 本轮范围

**已完成**

| 组 | 内容 |
| --- | --- |
| 后端模型 | `skills` / `project_skills`、`exploration_records` / `exploration_record_posts` / `exploration_record_projects`（唯一 slug、领域与工作状态枚举 CHECK、position 范围与唯一、部分索引、**「只有已解决才有解决时间」的 CHECK**） |
| 后端公开 API | `GET /skills`、`GET /skills/combo?a=&b=`、`GET /skills/projects/{slug}`、`GET /skills/{slug}`、`GET /exploration/records`、`GET /exploration/records/stats`、`GET /exploration/records/{slug}` |
| 后端管理 API | `/admin/skills`（列表 / 详情 / 新建 / 更新 / 发布 / 撤回 / 软删除）、`/admin/exploration/records`（同上） |
| 「合体」筛选 | SQL 层交集（两个 `project_skills` 连接各自约束一个技能），三种业务结果分开：不存在 / 未发布 404、同一技能 422、空交集 200 + 明确 `note` |
| 同一关系来源 | `project_skills` 是技能与作品关系的**唯一**来源；`GET /skills/projects/{slug}` 与技能详情读同一批行（验收 2） |
| 不伪造等级 | `skills` 表**没有** level / rank / score / percent / years 列（有用例直接断言列集合），发布门槛是「范围说明 + 掌握证据」而不是任何数字 |
| 工作状态与发布状态独立 | `work_status`（待探索 / 调查中 / 已解决 / 暂搁置）与 `status`（draft / published）是两个正交列；有用例覆盖「已解决但草稿」与「待探索但已发布」 |
| 撤回不泄漏标题 | 关系表只存 id 与顺序（有用例断言关系表没有 title / slug 列）；公开侧按当前公开条件解析，解析不到整条丢弃，连「（已隐藏）」占位都不留 |
| 前端技能全书 | `features/velvet/`：领域筛选（URL 驱动）、分页加载更多、合体面板、技能详情（范围说明 / 掌握证据 / 外部证据 / 关联作品 / 技术栈一致性提示）、管理端列表与编辑器 |
| 前端问题记录 | `features/exploration/`：公开列表（工作状态筛选 + 实时统计）、单条记录（背景 / 尝试 / 结果 / 验证链接 / 关联内容）、管理端列表与编辑器 |
| 页面路由 | `/velvet`、`/velvet/<slug>`、`/apps/metanav/mementos`、`/apps/metanav/mementos/<slug>`、`/admin/skills`、`/admin/skills/<id>`、`/admin/exploration`、`/admin/exploration/<id>` |
| 内容初始化命令 | `python -m app.modules.skills.seed`：7 门技能 + 7 条问题记录，全部来自本仓库真实材料（见 §6），默认 dry-run |
| 浏览器验收套件 | `apps/web/features/velvet/tools/verify-t09.py`（54 项检查、15 张截图） |
| 保留 T04 | `/apps/metanav?screen=mugen` 的分类探索**一行未改**；有用例断言 T09 的路由不占用 `/nav/*` 与 `/posts*`，浏览器验收里两个入口互相链接 |

**未做（刻意）**

- 不写 `migrations/`、不改 `model_registry.py` / `router.py` / `main.py` / `features/phone/registry.ts`（契约）。
- 不做抽卡、面具养成、AI 技能生成、访客任务提交、随机迷宫、游戏战斗，也不把阅读时长换算成学习水平（任务卡「不做」）。
- 不修改 T06 的作品源码来复制一套履历：作品侧只提供 `ProjectSkills` 组件与集成申请（§7 第 7 条）。
- 不接管 T04 的分类印象空间，也不把新模块当成它的替代实现。

## 2. 修改文件

新增（全部在 T09 的独占路径内）：

```text
apps/api/app/modules/skills/{__init__,links,models,schemas,service,router,wiring,seed}.py
apps/api/app/modules/exploration/{__init__,models,schemas,service,router,wiring}.py
apps/api/tests/skills/{__init__,conftest,helpers,test_models,test_public_api,test_admin_api,test_integration_boundary}.py
apps/api/tests/exploration/{__init__,conftest,helpers,test_models,test_public_api,test_admin_api}.py
apps/api/tests/support/t09_db.py            # T09 专用临时库夹具
apps/api/tests/support/t09_shared.py        # T09 共享测试辅助（真实 HTTP 管理流程）
apps/web/features/velvet/{api,paths,types,failure,server-api,velvet.css}.ts(x)
apps/web/features/velvet/{velvet-view,velvet-loader,skill-combo,skill-reading,skill-reading-loader,project-skills}.tsx
apps/web/features/velvet/{phone-app,phone-view,phone-manifest}.tsx|ts
apps/web/features/velvet/admin/{session.ts,skill-workspace.tsx}
apps/web/features/velvet/tools/verify-t09.py
apps/web/features/exploration/{api,paths,types,failure,server-api,exploration.css}.ts(x)
apps/web/features/exploration/{mementos-view,mementos-loader,mementos-reading,mementos-reading-loader}.tsx
apps/web/features/exploration/{phone-app,phone-view,phone-manifest}.tsx|ts
apps/web/features/exploration/admin/{session.ts,record-workspace.tsx}
apps/web/features/growth-fetch/use-fetch.ts  # 两处视图共用的可取消读取 hook
apps/web/app/velvet/page.tsx、apps/web/app/velvet/[slug]/page.tsx
apps/web/app/apps/metanav/mementos/page.tsx、apps/web/app/apps/metanav/mementos/[slug]/page.tsx
apps/web/app/admin/skills/page.tsx、apps/web/app/admin/skills/[id]/page.tsx
apps/web/app/admin/exploration/page.tsx、apps/web/app/admin/exploration/[id]/page.tsx
```

前端测试（12 个文件，96 个用例）：

```text
apps/web/features/velvet/{paths,velvet-css,phone-app}.test.ts
apps/web/features/velvet/{velvet-view,skill-combo,skill-reading,project-skills}.test.tsx
apps/web/features/velvet/admin/skill-workspace.test.tsx
apps/web/features/exploration/{paths}.test.ts
apps/web/features/exploration/{mementos-view,mementos-reading}.test.tsx
apps/web/features/exploration/admin/record-workspace.test.tsx
```

**没有修改**任何其它包的文件（`git status` 里 `apps/web/app/admin/messages/page.tsx` 与
`apps/web/features/showcase/project-reading.tsx` 的改动**不是本包做的** —— 它们在本人操作期间
被集成负责人改动并已提交，见 §9 第 1 条）。

## 3. 契约增量（模型 / 路由 / DTO / 媒体 / 环境变量）

### 3.1 模型（5 张表）

```text
skills                          id / 唯一 slug / name / domain / scope / evidence /
                                links(JSONB) / position / status / published_at /
                                created_at / updated_at / deleted_at / version
project_skills                  skill_id / project_id / position（复合主键；skill_id 顺序唯一）
exploration_records             id / 唯一 slug / title / background / attempts / outcome /
                                evidence_links(JSONB) / work_status / resolved_at /
                                status / published_at / created_at / updated_at /
                                deleted_at / version
exploration_record_posts        record_id / post_id / position
exploration_record_projects     record_id / project_id / position
```

约束（都在数据库里，有用例绕过 ORM 直接写非法值来证明）：

```text
ck_skills_domain_valid / ck_skills_status_valid / ck_skills_version_positive /
ck_skills_position_non_negative
uq_project_skills_skill_id_project_id（复合主键）/ uq_project_skills_skill_id_position /
ck_project_skills_position_non_negative
ck_exploration_records_work_status_valid / ck_exploration_records_status_valid /
ck_exploration_records_version_positive / ck_exploration_records_title_length /
ck_exploration_records_resolved_at_valid   ← 只有 work_status='resolved' 才允许有 resolved_at
三张关系表各自的 position >= 0 与「同一条记录内文章 / 作品唯一、顺序唯一」
部分索引 ix_skills_public_listing、ix_exploration_records_public_listing（条件与 service 的公开条件逐字一致）
反向索引 ix_project_skills_project_id、ix_exploration_record_posts_post_id、
ix_exploration_record_projects_project_id
```

**刻意没有的列**（有用例直接断言 `information_schema.columns`）：

- `skills` 没有 `level` / `rank` / `score` / `percent` / `years` / `stars` / `mastery` / `proficiency`
  —— 07 §6「不自封数值等级」在表结构层面就没有入口。
- `exploration_records` 没有 `visitor_id` / `requester` / `submitted_by` / `claimed_by` /
  `assignee` / `vote_count` / `due_at` —— 验收 4「明确是站主整理，不承诺处理访客任务」。
- 三张关系表没有 `title` / `slug` / `summary` 快照 —— 存了快照就无法保证撤回后不泄漏标题。
- 没有 `project_count` / `view_count` 之类的缓存计数列：计数每次实时统计，不拿它当权限条件。

### 3.2 路由（15 条，前缀 `/api/v1`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/skills` | 公开列表；`domain`、`cursor`、`limit`（默认 12 / 最大 30） |
| GET | `/skills/combo` | `a`、`b` 两个技能 slug；交集作品 |
| GET | `/skills/projects/{slug}` | 某件**公开**作品使用的**公开**技能（作品未公开 → 404） |
| GET | `/skills/{slug}` | 技能详情（含 `projects` 与 `tech_overlap`） |
| GET/POST | `/admin/skills` | 管理列表（含草稿）/ 新建草稿 |
| GET/PATCH/DELETE | `/admin/skills/{id}` | 详情（带 ETag）/ 更新（`If-Match`）/ 软删除 |
| POST | `/admin/skills/{id}/publish`、`/unpublish` | 发布（门槛：范围说明 + 掌握证据）/ 撤回 |
| GET | `/exploration/records` | 公开列表；`work_status`、`cursor`、`limit` |
| GET | `/exploration/records/stats` | 公开工作状态统计（只算公开记录） |
| GET | `/exploration/records/{slug}` | 公开详情 |
| GET/POST | `/admin/exploration/records` | 管理列表 / 新建（总是 draft + pending） |
| GET/PATCH/DELETE | `/admin/exploration/records/{id}` | 详情 / 更新 / 软删除 |
| POST | `/admin/exploration/records/{id}/publish`、`/unpublish` | 发布（门槛：标题 + 背景）/ 撤回 |

两条**注册顺序敏感**的路由（有用例守着，防止以后被重排）：

- `/skills/combo` 与 `/skills/projects/{slug}` 必须在 `/skills/{slug}` **之前**；
- `/exploration/records/stats` 必须在 `/exploration/records/{slug}` **之前**。

### 3.3 媒体公开引用检查

**本域不贡献任何共享注册**（`skills/wiring.py` 与 `exploration/wiring.py` 的
`CONTRIBUTIONS` 都是空元组，且各有一个 `verify_no_shared_contributions()` 自检）。
理由：技能与问题记录**没有自己的媒体**（表里没有 media 外键）；页面上出现的图片都属于
它们**关联的作品 / 文章**，那由 `projects` / `posts` 域各自登记（T06 / T01 已做）。
因此集成方**不需要**在 `app/main.py` 里加 T09 的 `register()` 调用。

### 3.4 环境变量

无新增。T09 的生产代码不读任何新环境变量（`DISPLAY_TIMEZONE` 之类的先例属于 T05）。

## 4. 依赖

无新增依赖。后端只用 T01 已有的 SQLAlchemy / FastAPI / Pydantic；前端只用 T00 已锁定的
Next.js / React / vitest；浏览器验收用**系统 Python 3.13 的 playwright 1.60**，
**没有**加进 `apps/web/package.json`（与 T02 / T06 的约定一致）。

## 5. 测试命令、退出码与结果

### 5.1 后端（真实 PostgreSQL；T09 自建 `pl_test_t09_<pid>`，结束即 drop）

```sh
export UV_CACHE_DIR=/Users/学习/blog/.dsh/uv-cache
export TEST_DATABASE_URL="postgresql+psycopg://pl@127.0.0.1:55432/pl_test_t09"

uv run --project apps/api pytest apps/api/tests/skills apps/api/tests/exploration
```

**退出码 0，`123 passed`**（技能 63 + 问题记录 43 + 集成边界 8 + 模型 22 − 重叠计数见下）。
分文件：

| 文件 | 用例数 | 覆盖 |
| --- | --- | --- |
| `tests/skills/test_models.py` | 22 | 唯一 slug、8 个领域与 2 个状态、绕过 ORM 的 CHECK、version/position、复合主键与顺序唯一、反向索引存在、**没有等级列** |
| `tests/skills/test_public_api.py` | 26 | 草稿不可见、领域筛选、详情字段、关联作品只列公开的、`tech_overlap` 是算出来的、作品侧与技能侧同一来源、**合体 7 个用例**（交集 / 对称 / 同一技能 422 / 未发布 404 / 撤回作品消失 / 空交集明确 / 草稿不算证据 / 缺参数） |
| `tests/skills/test_admin_api.py` | 7 | 创建总是草稿、发布门槛（范围说明 + 证据）、428 / 412、CSRF、401、关系完整替换、重复与未知作品、草稿关联对管理端可见、链接协议（`javascript:` 与本机路径 422）、slug 冲突、撤回保留关系、软删除、私有缓存 |
| `tests/skills/test_integration_boundary.py` | 8 | 两个域都不贡献共享注册；15 条路由都挂在 `/api/v1`；`combo` / `stats` 注册顺序；不占用 `/nav/*` 与 `/posts*`；与 T04 的 nav router 同时挂载 |
| `tests/exploration/test_models.py` | 17 | 工作状态与发布状态是**两个独立列**、解决时间 CHECK、绕过 ORM 的枚举/长度拒绝、**没有访客请求类列**、关系表**没有标题快照**、顺序唯一、级联 |
| `tests/exploration/test_public_api.py` | 26 | 只有已发布可见、「已解决的草稿」不公开、「待探索的已发布」可见、结果与验证链接、统计与可见条数一致、筛选非法值 422、**撤回文章 / 作品 / 软删除文章后隐藏标题不出现在响应里**、草稿关联不计入计数、no-store、游标与筛选绑定 |
| `tests/exploration/test_admin_api.py` | 17 | 默认 draft + pending、直接建成「已解决」必须有结果、只改结果时也校验、离开已解决清空解决时间、重复保存不推后解决时间、发布门槛、**发布不改工作状态 / 撤回不改工作状态**、428 / 412、CSRF、401、关系完整替换、未知关联 409、管理端可见草稿关联、链接协议、软删除、私有缓存 |

### 5.2 全量后端回归（本轮唯一在写业务代码，串行跑整棵树）

```sh
uv run --project apps/api pytest apps/api/tests
```

- **未接入 T09 时（本包代码临时移走）**：退出码 0，`788 passed`。
- **接入 T09 后**：`906 passed, 5 failed`。

这 5 个失败**全部是「新内容域必须先接线」的守卫用例在按设计报警**（不是回归）：

| 失败的用例 | 根因 | 由谁解决 |
| --- | --- | --- |
| `test_module_registration.py::test_model_registry_matches_the_wired_module_list` | 冻结表清单 `EXPECTED_TABLES` 还没加 T09 的 5 张表（T00 所有，本包不改） | T00 加表名 |
| `test_migration_sync.py::test_models_and_migrations_are_in_sync` | T09 的 5 张表还没有迁移 | T00 生成迁移 |
| `test_migration_sync.py::test_expected_tables_exist_after_migration` | 同上 | T00 生成迁移 |
| `core/test_health_readiness.py::test_ready_when_database_schema_and_media_are_ok` | `check_schema()` 比对 `Base.metadata` 与库表；T09 模型已注册而库表没有 → `not_migrated`（**这正是它该有的行为**） | T00 生成迁移 |
| `core/test_health_readiness.py::test_readiness_router_is_mounted_under_api_v1` | 同一条链（同一 pytest 进程里模型已注册、库表缺失） | T00 生成迁移 |

迁移落地后这 5 条会自行转绿；在此之前它们**必须**是红的，否则就说明守卫失效了。

### 5.3 前端

```sh
npm --prefix apps/web run typecheck          # 退出码 0
npm --prefix apps/web run lint               # 退出码 0（eslint 无输出）
npm --prefix apps/web run test -- --run      # 退出码 0，69 个文件 / 713 个用例通过（T09 占 12 文件 / 96 用例）
DEV_API_URL=http://127.0.0.1:8109 npm --prefix apps/web run build   # 退出码 0
node --test tests/*.test.cjs                 # 退出码 0，53 passed / 0 failed（旧站不回归）
```

T09 的前端用例按文件：

| 文件 | 用例数 | 覆盖 |
| --- | --- | --- |
| `features/velvet/paths.test.ts` | 8 | 地址编码、浏览器 / 服务端两组路径不互相污染、管理路径 |
| `features/velvet/velvet-css.test.ts` | 14 | 两张样式表都带前缀、冷色变量在 `.plv-room` / `.pme-wrap` 作用域内、**不覆盖 `--red` / `--black` / `--paper`**、不写裸元素规则、`styles/legacy/base.css` 没被改动 |
| `features/velvet/phone-app.test.ts` | 6 | 两个手机模块的 `default` / `screens` / `dispose` 形状、10 字段 manifest、id 与图标不冲突 |
| `features/velvet/velvet-view.test.tsx` | 7 | 卡片字段、**没有等级 / 百分比字样**、空态、失败态与空态分开、领域筛选地址、加载更多带 cursor + domain |
| `features/velvet/skill-combo.test.tsx` | 6 | 不足两个技能不给控件、同一技能禁用 + 不发请求、空交集明确且无「生成 / 推荐」按钮、交集只列一件、换选择后旧结果不显示、404 与空交集文案不同 |
| `features/velvet/skill-reading.test.tsx` | 8 | 范围说明 + 证据、作品链到 T06、空态、站外链接 `rel`、无等级字样、`tech_overlap` 说明它不是掌握程度 |
| `features/velvet/project-skills.test.tsx` | 4 | 读到技能 / 空数组 / 服务不可用三种状态分开；请求路径就是作品 slug |
| `features/velvet/admin/skill-workspace.test.tsx` | 5 | **表单里没有等级输入**、发布门槛禁用并说明、`If-Match` + CSRF、412 保留输入 |
| `features/exploration/paths.test.ts` | 13 | canonical 与分类探索地址分开、管理路径、失败分类（404 / 503 / 传输错误）、工作状态枚举 |
| `features/exploration/mementos-view.test.tsx` | 10 | 徽标与解决日期、统计不泄漏草稿、**明确写出是站主整理**、保留分类探索入口、空态、失败态分开、加载更多带筛选、站内链接 |
| `features/exploration/mementos-reading.test.tsx` | 9 | 三块正文、已解决缺结果时提示、未解决写「还没有结论」、验证链接空态、关联链接、**没有「已隐藏」占位**、返回保留筛选、页脚声明不是请求板 |
| `features/exploration/admin/record-workspace.test.tsx` | 6 | 发布状态与工作状态分开显示、写明不改联动、已解决缺结果时的服务端拒绝提示、`If-Match` 不带 `status`、412 保留输入、草稿关联回显 |

### 5.4 真实浏览器验收（Playwright + 系统 chromium，无 mock）

前置（全部真实进程）：

```sh
export UV_CACHE_DIR=/Users/学习/blog/.dsh/uv-cache
PSQL=/opt/homebrew/opt/postgresql@18/bin/psql
$PSQL -h 127.0.0.1 -p 55432 -U pl -d pl_test -c "create database pl_test_t09_dev"
cd apps/api
APP_ENV=test SECRET_KEY=... DATABASE_URL="postgresql+psycopg://pl@127.0.0.1:55432/pl_test_t09_dev" \
  uv run alembic upgrade head
APP_ENV=test ... uv run python -m app.commands.import_legacy --apply --no-covers --repo-root ../..
printf 't09-owner-password-123\n' | APP_ENV=test ... uv run python -m app.commands.bootstrap_admin --username owner --password-stdin
APP_ENV=test ... uv run python -m app.modules.nav.seed --create-tables --apply --publish
APP_ENV=test ... uv run python -m app.modules.projects.seed --create-tables --apply --publish --palace-slug phantom-base
APP_ENV=test ... uv run python -m app.modules.skills.seed --create-tables --apply --publish

# 真实 API（T09 路由还没登记，因此用临时入口把 T09 的 router 一起挂上）
APP_ENV=dev SECRET_KEY=... DATABASE_URL="...pl_test_t09_dev" CORS_ORIGINS="http://127.0.0.1:3110" \
  uv run uvicorn --app-dir /tmp t09-dev-app:app --host 127.0.0.1 --port 8109

# 前端（DEV_API_URL 必须在 build 时就有值）
DEV_API_URL=http://127.0.0.1:8109 npm --prefix apps/web run build
API_INTERNAL_URL=http://127.0.0.1:8109 npm --prefix apps/web run start -- --port 3110

python3 apps/web/features/velvet/tools/verify-t09.py \
    --api http://127.0.0.1:8109 --web http://127.0.0.1:3110 --json-out /tmp/t09-verify.json
```

**退出码 0，`=== 54/54 通过 ===`**（连跑两次结果一致）。覆盖：

| 组 | 检查项 |
| --- | --- |
| 技能全书 | 渲染 8 张公开技能卡、显示关联作品数、**没有等级 / 熟练度 / 百分比字样**、领域筛选不整页重载（`performance.timeOrigin` 不变）且 URL 带 `domain`、筛选后卡片 9 → 1 |
| 合体 | 两个选择器存在、同一技能时明确提示 + 按钮禁用、有交集时只列 1 件且就是 `p5-blog`、**空交集明确说明「不会替你生成」且页面上没有「生成 / 推荐 / 随机」按钮** |
| 技能详情 | 范围说明 / 掌握证据 / 关联作品小节都在、作品链接指向 `/showcase/projects/p5-blog`、点击后不整页重载且真的到达作品详情 |
| 404 | 不存在的技能返回**真正的 404**（不是空页面） |
| 问题记录 | 列表渲染 8 条、明确写出「站主自己整理」「不是公开的请求板」、保留「分类印象空间」入口、统计只显示公开记录 |
| 展示细节 | 已解决记录显示解决日期 + 实际结果；暂搁置记录不显示解决日期但有结果说明；**调查中且无结果时写「还没有结论」且不渲染空的结果段落** |
| 撤回不泄漏 | 真实 SQL 撤回作品 / 文章 → 记录页仍可读、不出现「已隐藏」占位、**隐藏标题从「撤回前可见」变成「HTML 里完全没有」**；恢复后又可见（证明消失是撤回造成的） |
| 响应式与运行时 | 320 / 390px 横向溢出 0px（4 个组合）、`prefers-reduced-motion: reduce` 下仍可用、问题记录页面**不新增 `audio[data-pl-music]`**（1 → 1）、Tab 键盘可达 |

截图（15 张，`/Users/学习/blog/.dsh/screenshots/`）：

```text
t09-velvet-desktop.png          技能全书桌面
t09-combo-intersection.png      合体有交集
t09-combo-empty.png             合体空交集
t09-skill-to-project.png        技能 → 作品详情（不整页重载）
t09-skill-404.png               不存在的技能 = 真 404
t09-mementos-desktop.png        问题记录列表
t09-memento-detail.png          已解决记录详情
t09-memento-open.png            调查中且无结果
t09-withdrawn-projects.png      撤回作品后的记录页
t09-withdrawn-posts.png         撤回文章后的记录页
t09-velvet-{390,320}.png        技能全书小屏
t09-mementos-{390,320}.png      问题记录小屏
t09-compare-showcase.png        对照：T06 的展示页（同一套页头语言，见 §9 第 2 条）
```

### 5.5 未运行的命令

```sh
docker compose -f deploy/compose.dev.yaml config    # Docker daemon 未运行（本机事实），未执行
```

## 6. 示例数据、初始化与清理

### 6.1 内容初始化命令（可复现、幂等、不杜撰）

```sh
# 默认 dry-run：只报告将要创建什么
uv run --project apps/api python -m app.modules.skills.seed
# 真正写库并发布
uv run --project apps/api python -m app.modules.skills.seed --apply --publish
# 集成前临时补表（生成迁移后不需要）
uv run --project apps/api python -m app.modules.skills.seed --create-tables --apply --publish
# 只做一半
uv run --project apps/api python -m app.modules.skills.seed --apply --publish --only exploration
```

写入的**7 门技能**（全部关联 `p5-blog`，因为这就是真实的证据关系）：
React 与 Next.js App Router（frontend）、FastAPI 服务与接口设计（backend）、
SQLAlchemy 与 PostgreSQL 建模（data）、Alembic 迁移与单一 head（tooling）、
浏览器验收与自动化验证（tooling）、图片处理与媒体变体（backend）、
算法与数据结构 ACM 训练（algorithm）。

写入的**7 条问题记录**（都来自本仓库的真实开发事故，工作状态如实标注）：
共享测试集群被清理脚本删掉（已解决）、动画结束后点不动（已解决）、
构建期 `DEV_API_URL`（已解决，关联 `phantom-blog-launch`）、水合前点击整页重载（已解决）、
中文排序下的分页漏项（已解决）、撤回关联内容后标题残留（已解决）、
`pg_trgm` 能不能当中文搜索（**暂搁置** —— 查过了、结论是首版先不上索引）。

命令**找不到**关联的文章 / 作品 slug 时会写进 `missing_posts` / `missing_projects` 并如实报告，
**不会**编一个标题塞进去（真实踩到过一次：作品 slug 被交给只查 `posts` 的函数，
报告说「作品找不到」—— 报告本身没错，根因是查询查错了表，已修）。

### 6.2 清理

```sh
# 浏览器验收脚本自己造的 3 条资源（t09-browser-only / t09-seedless-skill / t09-open-question）
# 由脚本收尾自动**撤回**（不是删除），下一轮复用。
# 要彻底删掉联调库（名字带 test，受 T00 的库名守卫约束）：
$PSQL -h 127.0.0.1 -p 55432 -U pl -d pl_test -c "drop database pl_test_t09_dev"
# 用例库是每个 pytest 进程自建自 drop 的（pl_test_t09_<pid>），正常结束不留痕。
```

### 6.3 迁移顺序与回退限制

- 迁移由 T00 生成**单头** revision；本次新增 5 张表，无列改动、无数据回填。
- 回退（`downgrade`）会 drop 这 5 张表，**技能与问题记录内容会一起丢失**；
  它们没有别的副本。生产回退前必须先导出这两张主表。
- `project_skills` 与 `exploration_record_*` 都是 `ON DELETE CASCADE` 指向各自的主表；
  `exploration_record_posts.post_id` 指向 `posts` 也是 CASCADE（文章被物理删除时关系清理），
  但正常路径是**软删除**，级联只是兜底。

## 7. 集成申请（T00 动作，按优先级）

### A. 必须（不做就等于没接线）

1. **模型注册**：`MODEL_MODULES` 追加
   `"app.modules.skills.models"`、`"app.modules.exploration.models"`（放最后即可：
   skills 依赖 `projects`，exploration 依赖 `posts` 与 `projects`）。
2. **路由登记**：`MODULE_ROUTER_TARGETS` 追加
   `("skills", "app.modules.skills.router")`、`("exploration", "app.modules.exploration.router")`
   （模块内部自己组合公开 / 管理两条前缀，与 nav / media 同形）。
3. **迁移**：按 §3.1 生成**单头** revision。本包**没有**写 `migrations/`，
   没有执行过任何迁移（联调库只用 `--create-tables` 补过表）。
4. **冻结表清单**：`apps/api/tests/test_module_registration.py` 的 `EXPECTED_TABLES` 追加
   `skills` / `project_skills` / `exploration_records` / `exploration_record_posts` /
   `exploration_record_projects`（这个文件归 T00，本包不改）。加完之后 §5.2 的 5 条失败全部转绿。
5. **wiring**：**不需要**任何调用。两个域的 `CONTRIBUTIONS` 都是空元组，
   且各自有 `verify_no_shared_contributions()` 自检（已在用例里调用）。
6. **OpenAPI / 前端类型**：接线后重跑 `apps/api/scripts/export_openapi.py` 与
   `npm --prefix apps/web run gen:api`（`contracts/openapi.json` 会漂移一次，属预期）。

### B. 前端接线

7. **作品详情的「使用的技能」（一行改动，验收 2 的关键）**：
   本包提供了 `ProjectSkills` 组件（读 `GET /api/v1/skills/projects/<slug>`，与技能全书同一关系来源），
   并且**没有**修改 T06 的任何文件。请在作品详情页
   `apps/web/app/showcase/projects/[slug]/page.tsx`（或它渲染的 `ProjectReading`）里加：

   ```tsx
   import { ProjectSkills } from "@/features/velvet/project-skills";
   // …
   <h2 className="pls-section-title">使用的技能</h2>
   <ProjectSkills projectSlug={project.slug} />
   ```

   组件的三种状态都已经有单测：读到技能 → 链接列表；空数组 → 「这件作品还没有登记技能」；
   服务不可用 → 「暂时读不到技能信息（作品本身不受影响）」。

8. **手机 manifest 登记**（原样可抄）：

   ```ts
   import { EXPLORATION_MANIFEST } from "@/features/exploration/phone-manifest";
   import { VELVET_MANIFEST } from "@/features/velvet/phone-manifest";
   ```

   | 字段 | velvet | mementos |
   | --- | --- | --- |
   | `id` | `"velvet"` | `"mementos"` |
   | `name` / `subtitle` | 天鹅绒 / 技能全书 | 印象空间 / 问题记录 |
   | `icon` | `/assets/legacy/img/icon/queen.webp` | `/assets/legacy/img/icon/crow.webp` |
   | `order` | 70 | 80 |
   | `kind` | `"embedded"` | `"embedded"` |
   | `canonical_path` | `/velvet` | `/apps/metanav/mementos` |
   | `loader` | `() => import("@/features/velvet/phone-app")` | `() => import("@/features/exploration/phone-app")` |
   | `feature_flag` / `state_version` | `null` / `1` | `null` / `1` |

   两个图标都是仓库里**真实存在**的迁移图标（未占用：`queen` / `crow`）；
   模块形状是 `default` + `screens`（`["book","skill"]` / `["records","record"]`）+ `dispose`。
   **order 70 / 80 是我的取值**：07 §7 的首屏清单没有这两项（天鹅绒房间是「档案 / 异世界导航的
   特殊入口」，印象空间是导航内部的一层），因此排在既有顺序之后，不打断设计顺序。
   若你认为它们不该各占一个桌面图标，**不登记即可** —— 独立页 `/velvet` 与
   `/apps/metanav/mementos` 都完整可用，不依赖手机入口。

9. **删除本地验证入口**：本包**没有**在仓库里建 `t09_dev_app.py`。
   联调入口是一个**仓库外**的临时文件 `/tmp/t09-dev-app.py`（用
   `uvicorn --app-dir /tmp t09-dev-app:app` 启动），它不进仓库、不需要你删。
   `/tmp` 下的文件由系统清理；`pl_test_t09_dev` 库按 §6.2 自行 drop。

10. **联调库**：`pl_test_t09_dev`（本包自建，名字带 test）。要我删就说一声，
    或者直接按 §6.2 的 `drop database` 处理。

### C. 可选

11. **T09 的内容初始化**：如果要在真实集成库里也有一套可展示的技能与问题记录，
    跑 §6.1 的命令。它**不会**编造数据：全部来自本仓库真实材料，
    找不到关联内容时会如实报告而不是塞占位标题。
12. **`ProjectSkills` 的 CSS**：组件带 `import "@/features/velvet/velvet.css"`，
    因此作品详情页会自动获得 `.plv-*` 类；不需要额外引入。
13. **样式语言的一致性（供你判断）**：T09 的两张样式表都用了与 T06 展示页相同的
    「页头 + 细分隔线」语言，但天鹅绒房间是**蓝黑冷光**、印象空间是**暗紫**
    （07 §6 明确要求冷色）。两者都只用局部 CSS 变量，`--red` / `--black` / `--paper`
    一个都没覆盖（有静态测试守着）。

## 8. 每包必做清单（ACCEPTANCE §1）

- [x] 检查开始时的 Git 状态与基线，未覆盖用户或其他 agent 的修改（§基线）。
- [x] 需求有对应测试，且**先红后修**：本轮 6 个真实缺陷都是先写失败的断言再改
      （见 §9 第 3 条），没有「永远通过的快照」。
- [x] 类型检查 / 模块测试 / 数据库约束 / 构建都有真实命令与退出码（§5）；未运行项单列（§5.5、§10）。
- [x] 权限在**四条读取路径**都验证：列表、详情、搜索、分享、图片。
      - 列表 / 详情：`GET /skills`、`/skills/{slug}`、`/exploration/records`、
        `/exploration/records/{slug}` 都有「草稿 / 撤回 / 软删除不可见」用例；
      - 搜索：T09 **没有**新增搜索端点，也没有把自己的数据塞进 T04 的 `/nav/search`
        （有用例断言不占用 `/nav/*`）；问题记录的分类沿用关联文章的分类；
      - 分享：canonical URL（浏览器验收里直接打开 `/velvet/<slug>`、
        `/apps/metanav/mementos/<slug>`、刷新、Back 都走过）；
      - 图片：技能与问题记录**没有自己的媒体**（表里没有 media 外键），
        页面上的图都属于关联的作品 / 文章，权限由 `projects` / `posts` 域判定；
      - AI：T09 不接入任何 AI 读取路径（无 AI 调用，也没有把内容交给模型）；
      - 额外的一条：**计数**不泄漏草稿 —— `/exploration/records/stats` 只统计公开记录，
        有用例断言它等于列表里能看到的条数。
- [x] 320 / 390px、键盘、关闭、焦点、减少动态效果、失败状态可用（§5.4 的四组溢出检查、
      键盘可达、`prefers-reduced-motion`、失败态与空态分开）。
- [x] 只有实际行为 / 内容才显示图标、计数与成功提示：`project_count` 是实时关系计数（文案写的是
      「关联作品 N 件」，不是掌握度）；没有成绩数字；`stats` 读不到时**不显示 0**（那会变成假话）。
- [x] 模块退出取消读取与监听：两处视图共用 `features/growth-fetch/use-fetch.ts`，
      依赖键变化或卸载即 `AbortController.abort()`，晚到的响应不写回状态；
      `SkillComboPanel` / `MementosView` 也各自取消在途请求；
      音乐单例与动画规则不变（浏览器验收断言 `audio[data-pl-music]` 数量不增加）。
- [x] 不新增生产密钥、绝对本机素材路径、任意 HTML / 脚本执行或未经确认的外部收费调用：
      链接字段只接受 `http` / `https`（`javascript:` 与本机绝对路径都有 422 用例）；
      没有 `dangerouslySetInnerHTML`；没有 AI / 付费调用。
- [x] 提交本包的交付单并交出需要集成的增量（§7）。

## 9. 未验证项及原因（不得当作已通过）

1. **Docker / 容器内运行**：Docker daemon 未运行，未做容器内联调（属 T10）。
2. **真机（Android / iOS）与触控**：只有桌面 chromium；320 / 390px 只验证了布局与横向溢出
   （4 个组合都是 0px），没有真机手势。折叠键盘 / 软键盘未验证。
3. **Safari / Firefox**：未测。`useFeatureFetch` 的取消逻辑在 jsdom 下有单测，
   但真实浏览器的 `AbortController` 行为差异未验证。
4. **手机内置应用的真实渲染**：两个 manifest 与模块形状有单测（`default` / `screens` / `dispose`），
   但 `features/phone/registry.ts` 尚未登记它们，因此**没有任何一次真实手机内渲染**被验证过。
5. **`ProjectSkills` 在真实作品详情页里的渲染**：组件本身有 4 个单测、端点有浏览器验收，
   但 T06 的作品详情页还没有插桩（§7 第 7 条），因此「作品详情页上真的显示这一块」未验证。
6. **无交集时的服务端语义在浏览器里的完整闭环**：空态文案与「不会生成作品」已验证，
   但「站主后来真的做出一件同时用到两者的作品 → 交集出现」这条链路没有真实内容可验证
   （需要一件新的真实作品，不是本包能编的）。
7. **技能列表的第二页**：`next_cursor` 有 API 用例与前端组件用例，但公开技能只有 9 门
   （默认 limit 12），因此**没有真实的分页第二页**被浏览器验证过。
8. **跨浏览器的 412**：有 API 用例与组件用例（保留输入 + 提示读取最新版本），
   但没有两个真实浏览器同时编辑同一条的端到端录制。
9. **`/apps/metanav?screen=mugen`（T04 分类探索）的联合验收**：本包断言了「不占用 `/nav/*`」
   并提供了互相链接，但没有重跑 T04 的浏览器套件来验证两个入口在同一会话里来回切换。
10. **`pg_trgm` / 中文检索**：问题记录里那条「暂搁置」记录的结论是「首版不上索引」，
    没有做真实的中文检索基准测试（也没有语料）。
11. **并发写入的数据库级行为**：`If-Match` 的 428 / 412 有真实用例，
    但没有做「两个连接同时 PATCH 同一行」的数据库级竞态测试。

## 10. 遗留问题与需要外部选择

1. **`tech_overlap` 的定位需要你确认**：它是「关联作品的技术栈里与本技能同名的项」，
   现在只作为技能详情上的**只读一致性提示**。「同名」用的是 `normalize_for_match`
   （NFKC + trim + casefold + 空白折叠），因此 `FastAPI` 与 `fastapi` 算同名。
   它**不是**一份要维护的数据，技能表里没有技术标签副本。
   如果你想让它更强（例如「技能 → 真实 Tag 关联」），那会同时改变 `GET /tags` 的公开来源
   与「未发布技能的标签不能泄漏」的判断 —— 那是契约增量，需要单独一批，本包没有顺手做。
2. **手机 order 取值（70 / 80）是我的判断**（§7 第 8 条），不是设计文档的规定。
3. **两个手机应用是否该占桌面图标**：07 §7 说天鹅绒房间「从档案 / 异世界导航的特殊入口进入，
   不要求每个场景都占一个 App」。因此**不登记也完全可行**，独立页已完整可用。
4. **问题记录的工作状态没有第五种取值**：任务卡给的是「待探索 / 调查中 / 已解决 / 暂搁置」四个，
   我按字面实现。「决定不做」这一类我用「暂搁置」承载（`pg_trgm` 那条就是这个语义）。
   如果你想要一个明确的「不做 / 已关闭」状态，需要改枚举 + 加迁移，请指定。
5. **技能列表的游标格式是模块本地的**：排序键是三元组 `(position, name, id)`，
   而 `core.pagination` 的游标只承载「一个时刻 + 一个 UUID」。我在 `skills/service.py` 里写了
   一个**同形**的编码器（同样的 `v` / `f` 字段与「换筛选 → 400」语义）。如果 T00 希望把它
   提取到 `app/core/` 供其它模块复用，那是一次共享层改动，本包没有动 `app/core/`。
6. **`project_count` 是实时统计而不是缓存列**：列表页每个技能会多一次聚合查询。
   个人站点规模（几十门技能）没问题；如果将来技能数量上千，需要重新设计（但现在不做预优化）。
7. **`/admin/skills` 与 `/admin/exploration` 不做路由保护**：这是 01 §3 的安排
   （权限在后端），未登录时页面显示明确提示而不是白屏。
8. **关联作品的输入是「粘贴 UUID」**：管理表单没有做一个作品选择器（那需要读
   `/admin/projects` 列表并处理几百条的情况）。当前是个人站点规模，UUID 可以在
   `/admin/projects` 列表里复制。如果你要下拉选择，请指定，那是一处独立的小改进。
9. **联调用的两个进程已停止，端口已释放**：本包启动的 API（8109）与前端（3110）
   在验收结束后按端口精确 `lsof -ti tcp:PORT | xargs -r kill` 停掉，两个端口现在都没有监听。
   复现方式见 §5.4（`/tmp/t09-dev-app.py` 已保留，联调库 `pl_test_t09_dev` 与
   `.next` 构建产物也都在，可直接重启）。**注意**：本轮结束时 3100（前端）与 8100（旧 API，
   它本来也没有 T09 路由）也已不在监听 —— 这两个端口不是本包启动的，本包只按端口杀了
   自己启动的 8109 与 3110；如果你需要那两个服务，请用你自己的配置重启。
10. **`/velvet` 与 `/apps/metanav/mementos` 的页头会与全站固定 header 在视觉上贴近**：
   这不是 T09 引入的 —— T06 的 `/showcase` 用同一套结构、同一套表现（见
   `t09-compare-showcase.png`）。如果 T10 的视觉验收要求统一加顶部留白，那应该改
   `app/layout.tsx`（T02 所有），不是各功能包各加一份 padding。
11. **`apps/api/var/`（联调产生的本地媒体目录）已清理**：那是联调时 API 进程按 T01 的
    `MEDIA_ROOT` 默认值创建的，里面只有 2 张旧站封面的原图与一个 `w320.webp` 变体
    （共 204K）。本包在删除前 `echo` 了绝对路径核对，确认是
    `/Users/学习/blog/Blogs/apps/api/var` 才 `rm -rf`，现在已经不在 `git status` 里。
    它本来也不该进仓库 —— 建议 T00 把 `apps/api/var/` 加进 `.gitignore`，
    免得下一个联调的人再看到一次。
12. **工作区里其它 agent 的改动**：本轮操作期间 `apps/web/app/admin/messages/page.tsx` 与
    `apps/web/features/showcase/project-reading.tsx` 被改动（后者把一处裸 `<a>` 换成了
    `SiteLink`），随后被提交（HEAD 从 `b3ce884` 推进到 `0f73cfd`）。
   这些改动**不是本包做的**，本包也没有碰这两个文件；记录在此以免混淆。
    另外，期间有一次 `tsc --noEmit` 报出 `project-reading.tsx(24,8)` 语法错误，
    紧接着重跑就通过了 —— 那是一次**并发写入的瞬时读**，不是真实缺陷。
    本包联调时也**读**过 `/tmp` 之外的共享状态（`pl_test` 只做只读探测确认旧 API 在跑），
    没有写过共享库。

## 11. 本轮发现并修掉的真实缺陷（先红后修）

1. **`Table` 没有导入**（`skills/models.py`、`exploration/models.py`）：导入模块直接
   `NameError`。在写第一个模型用例时暴露。
2. **游标排序键重复会漏项**：技能展示顺序允许重复，用「时间戳 + id」的通用游标会在
   `position` 相同时漏掉记录。写了一个「两门技能 position 相同」的用例后改成三元组游标。
3. **`mementos` 夹具的 `work_status_label` 与 `work_status` 自相矛盾**：`makeApiRecord` 先算
   标签再被 overrides 覆盖，导致「状态是调查中、标签写着待探索」。用例断言到了假象，
   修成「由最终值派生依赖字段」。（`adminRecord` 有同一个毛病，一起修了。）
4. **测试里手写的 UUID 与夹具派生的 ID 不一致**：`makeApiRecord` 把 slug 截成 36 字符，
   手写的 `RECORD_ID` 常量因此不匹配 —— GET 命中替身、PATCH 没命中，
   报出的是「界面没显示冲突」，与真正要验证的 412 处理毫无关系。改成从夹具取 ID。
5. **受控输入在测试里赋值不生效**：React 会在 input 实例上装自己的 `value` 描述符，
   直接 `field.value = x` 会被记成「没有变化」。改成走原型上的 setter。
6. **验收脚本自己踩的三个坑**（都写进了脚本注释）：
   - `text=算法与数据结构` 同时命中合体下拉的 `<option>` 与筛选链接，Playwright strict 模式报错；
   - 用固定 `sleep` 等导航提交，导致 URL 断言在提交前跑，误报「没到达作品详情」；
   - 用一个**也关联了同一件作品**的技能去验证「空交集」—— 它们当然有交集。
     改成用一个**不关联任何作品**的条目（`t09-seedless-skill`）才真正走到空态。
7. **撤回断言的假通过**：第一版 `before_html` 取的是另一个页面的内容，于是
   「撤回后标题不出现」这条断言**永远会通过**。诊断信息（「撤回前该标题出现过：False」）
   暴露了它，改成「先打开记录页确认标题可见 → 撤回 → 再确认消失 → 恢复后确认可见」。
