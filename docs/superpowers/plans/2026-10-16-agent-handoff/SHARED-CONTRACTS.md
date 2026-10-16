# 共享契约、目录所有权与集成协议

入口：[交接计划](README.md)。本文件是分工协议，不是已生成的代码接口。

## 1. 固定业务边界

- Next.js 不连接数据库、不复制认证和发布逻辑；浏览器调用同源 `/api/v1`，SSR 使用 server-only `API_INTERNAL_URL`。
- FastAPI 是公开状态、权限、媒体和 AI 调用的权威；PostgreSQL 保存业务数据，媒体文件在受控持久卷。
- 同一内容在手机与 canonical 页面使用同一功能视图和数据。图文、文章、日记、作品、照片、角色消息是不同内容域。
- 访客无公共注册 / 发帖权限；角色输入只写入自己隔离的会话。友链不是聊天联系人，剧情台词不是官方原文。
- 首版不引入 Redis、Celery、微服务、Kubernetes、向量库或真实 Instagram / Steam / Bangumi 同步。

## 2. 目录与唯一修改人

| 路径 / 文件 | 所有者 | 说明 |
| --- | --- | --- |
| `apps/web/package.json`、锁文件、基础配置；`apps/api/pyproject.toml`、Python 锁文件 | T00 | 其他任务提交依赖申请，不并行重写 |
| `apps/api/app/main.py`、`app/router.py`、`app/model_registry.py` | T00 | 集中挂载路由、导入全部模型；拒绝目录扫描自动执行插件 |
| `apps/api/migrations/` | T00 | 单一 Alembic head，按集成顺序生成并审核 |
| `apps/web/lib/api/generated/`、`contracts/openapi.json` | T00 | 从已挂载后端生成，不手改类型 |
| `apps/web/features/phone/registry.ts` | T00 | 应用清单、路由和跨 App 接线 |
| `apps/api/app/core/`、`modules/auth/`、`modules/posts/`、`modules/media/`、`modules/tags/` | T01 | 共享后端服务；初始骨架由 T00 创建后交接 |
| `apps/web/features/auth/`、`app/admin/login/` | T01 | 最小站主登录视图；管理外壳由 T02 负责 |
| `apps/web/app/layout.tsx`、`app/globals.css`、`app/admin/layout.tsx`、`features/runtime/`、`features/phone/`（除 registry）、`features/legacy/`、`components/ui/`、`lib/api/`（除 generated） | T02 | 持久外壳、共享请求层、通用样式、旧页面迁移 |
| 旧页面对应 Next 路由：`app/page.tsx`、`app/posts/`、`app/map/`、`app/about/`、`app/weather/`、`app/guestbook/` | T02 | 旧 URL 兼容配置由 T00 集成 |
| `features/ins/`、`modules/moments/`、INS 动态与管理路由 | T03 | 不修改消息目录 |
| `features/metanav/`、`modules/nav/`、专题与管理路由 | T04 | 后续问题记录通过插槽接入 |
| `features/journal/`、`features/leisure/`、`features/leblanc/`、`modules/journal/`、`modules/leisure/` | T05 | 勒布朗输出组合视图，不直接修改首页 |
| `features/showcase/`、`features/gallery/`、`modules/projects/`、`modules/gallery/` | T06 | 向 INS 输出相册视图，不修改 InsApp |
| `features/coop/`、`modules/coop/` | T07 | 向 INS / 关于页提供共享友链入口 |
| `features/messaging/`、`modules/messaging/`、`app/apps/ins/messages/` | T08 | 剧情、访客会话、AI 适配；不修改 INS 宿主 |
| `features/velvet/`、`features/exploration/`、`modules/skills/`、`modules/exploration/` | T09 | 输出可接入导航的视图 |
| `deploy/`、`.github/workflows/`、`docs/operations/`、`tests/e2e/integration/` | T10 | T00 完成开发 Compose 后显式交接所有权 |
| 原站 HTML、`assets/`、`tests/*.cjs` | 基线保留；由 T00 协调 | 功能包只读，不顺便“清理”旧实现 |

上表中 features 路径都位于 `apps/web/`，modules 路径位于 `apps/api/app/`。包内测试由该包负责；共享测试配置由 T00，跨模块测试由 T10。任务卡指定更细的独占路由，根目录相同不代表可以修改别人的子目录。

同一共享文件需变更时：在交付单写出目标、原因和候选差异，由所有者或 T00 应用。顺序开发也要先完成所有权交接，不能靠“另一个 agent 应该闲了”判断。

## 3. 基础工程在 T00 必须提供的能力

这些是待实现的测试 / 集成入口名；T00 完成前不得声称可运行。

- `apps/api/app/core/config.py`：环境配置；`db.py`：连接 / 事务与模型 Base。
- `apps/api/app/core/errors.py`：统一错误响应；`tests/conftest.py`：隔离 PostgreSQL 与测试依赖覆盖。
- `apps/api/tests/support/module_app.py`：模块测试应用工厂，显式挂入被测模块 router；测试本模块无需编辑生产总路由。
- `apps/web/lib/api/client.ts`：浏览器同源客户端；`server.ts`：仅服务端 API 读取；错误与 AbortSignal 一致处理。
- `apps/web/features/phone/types.ts`：注册表、视图、宿主服务类型；模块只能通过公开类型接入，不直接触碰全局 DOM。
- `docs/agent-deliveries/T00-baseline.md`：真实版本、安装 / 测试命令、基线、端口、路由 / 模型注册方法。

T00 负责把这些约定落成可编译的最小接口。T01 / T02 再实现业务行为；不能让 T00 顺带写完所有功能。基础接口变更先协调消费者。

## 4. 前端注册与导航

应用注册字段固定为：`id`、`name`、`subtitle`、`icon`、`order`、`kind`（embedded / site-link）、`canonical_path`、受信任构建期 `loader`、`feature_flag`、`state_version`。实际 TypeScript 签名由 T00 与 T02 固化后生成样例供各包使用。

PhoneProvider 的 URL 字段为 `phone` / `screen` / `item`。公开分享链接使用 canonical 路由，不包含聊天正文或身份凭据。返回、关闭、存储、音频和弹层规则以源设计 02 为准。

导航来源固定为语义枚举：`top-nav`、`map-travel`、`phone-internal`、`phone-link`、`metaverse-entry`；历史恢复不发起新的动画请求。动画实现由 T02 持有；模块发送目的地和来源，不能直接调用 Canvas、开第二个 audio、锁 body 或覆写 history。

| 来源 | 结果 |
| --- | --- |
| top-nav | Joker |
| map-travel | 人群；地图图标、出发、地点列表统一 |
| phone-internal | App 内短过渡，不遮盖全站 |
| phone-link | 普通站点跳转，默认 Joker |
| metaverse-entry | 专用认知效果；缺素材时正常降级，不用人群 |
| Back / Forward、刷新、新标签页 | 原生行为，不强制重播 |

INS 后续组合：T03 输出动态视图与可插拔的页签壳；T06 输出相册视图；T08 输出消息视图；T07 输出友链快捷入口。T00 接线，未接入的能力不显示坏按钮。T05 的勒布朗视图同理由 T00 协同 T02 放入首页。

## 5. API、数据库与发布

- 前缀 `/api/v1`；字段 snake_case；UUID 为业务 ID；UTC ISO 8601 时间；按源设计 05 使用公开 / 管理不同 DTO。
- 列表 `{items, next_cursor}`；详情直接对象。错误 `{error: {code, message, fields}, request_id}`，状态码真实。
- 写操作统一权限与 CSRF；更新 / 发布 / 撤回 / 删除要求 If-Match，缺少 428、过期 412。消息发送另用幂等 ID 与剧情节点版本，不能把所有动作粗套 CRUD。
- published + 未删除 + 时间有效为一般公开条件；日记另需 public；专题另需至少一篇公开文章。管理员访问公共端点也不能多拿草稿。
- 首版公开动态数据和权限媒体不共享缓存。原图仅管理用途；公开图片每次校验至少一个公开引用。
- 各模块定义自己的模型 / schema / router / service / tests，不重建独立数据库、用户或媒体存储。
- 各模块的媒体公开引用检查默认不生效，T00 显式注册后才开放；T01 提供安全默认拒绝的扩展点。至少一个真实公开引用才可访问，私密引用不会推翻另一个公开引用。
- 07 / 08 新领域先交付契约增量：字段及约束、URL / 方法、请求 / 响应示例、权限、分页、发布条件、迁移影响、媒体引用和关联撤回规则。T00 登记到 05 或有链接的契约附录后再同时开发前后端。
- 功能 agent 不自己执行生产迁移，不制造平行 Alembic heads。提交模型及迁移说明；T00 生成 / 检查迁移，在空测试库与前一版本测试库上验证。

## 6. 集成交付单

每个包写入自己独占的 `docs/agent-deliveries/Txx-result.md`，其中包含：

1. 基线 commit / 本地状态；已完成与未完成范围。
2. 修改文件；共享文件接线申请；新增依赖与原因。
3. 路由、模型、OpenAPI、手机 manifest、媒体引用检查、环境变量的增量。
4. 测试命令、退出码、结果与截图；mock 与真实外部服务分别标注。
5. 无秘密的示例数据、初始化 / 清理方法、迁移顺序与回退限制。
6. 已知问题和需要的外部选择，禁止填“应该没问题”。

集成负责人依次：审阅变更 → 接线模块 → 生成单头迁移与 OpenAPI → 生成前端类型 → 检查共享媒体权限 → 运行模块与跨模块测试 → 更新任务状态。模块测试通过但尚未接线，只能标记 `implemented_waiting_integration`。

## 7. 命令约定与完成边界

当前唯一已存在的统一自动化命令：

```sh
node --test tests/*.test.cjs
```

T00 应建立以下命令协议（不是声称现在可执行）：

```sh
npm --prefix apps/web ci
npm --prefix apps/web run typecheck
npm --prefix apps/web run lint
npm --prefix apps/web run test -- --run
npm --prefix apps/web run build
uv sync --project apps/api --frozen
uv run --project apps/api pytest apps/api/tests
docker compose -f deploy/compose.dev.yaml config
```

交接默认采用 npm 锁文件与 uv 锁文件，属于工程执行建议，T00 可根据环境统一调整一次并更新此处及交付记录；其他 agent 不再引入第二套包管理器。Node / Python / 数据库版本由 T00 核对官方支持并锁定，不猜测“最新版”。

没有测试数据库 / 浏览器 / Docker 时，报告未运行项；不把静态检查、mock 通过或截图看起来相似当成端到端成功。
