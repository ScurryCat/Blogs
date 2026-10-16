# T01 · 文章、站主认证与共享媒体

开始条件：T00 工程 / 共同契约就绪。可与 T02 并行；两者的真实数据联调由 T00 收口。

必读：[共享契约](../SHARED-CONTRACTS.md)、[验收](../ACCEPTANCE.md)、[01 架构](../../../specs/2026-10-16-stack-architecture-design.md)、[05 数据 API](../../../specs/2026-10-16-data-api-design.md)、[06 部署 §8](../../../specs/2026-10-16-deployment-roadmap-design.md)。

## 独占文件

- `apps/api/app/core/`；`apps/api/app/modules/auth/`、`apps/api/app/modules/posts/`、`apps/api/app/modules/media/`、`apps/api/app/modules/tags/`，每域使用 `models.py`、`schemas.py`、`router.py`、`service.py` 拆分职责。
- `apps/api/app/commands/import_legacy.py`、`bootstrap_admin.py`。
- `apps/api/tests/auth/`、`apps/api/tests/posts/`、`apps/api/tests/media/`、`apps/api/tests/tags/`。
- `apps/web/features/auth/`、`apps/web/app/admin/login/page.tsx` 及本目录测试。
- `docs/agent-deliveries/T01-result.md`。

根 router、模型注册、迁移、锁文件、生成类型与 admin layout 不是本包所有；提交集成清单。

## 执行清单

- [ ] 按 05 定义文章、标签、媒体、站主、会话、审计、登录限流模型与公开 / 管理 DTO。把代码生成和迁移增量交给 T00；不做第二套 JWT / OAuth 体系。
- [ ] 为 posts.js 幂等导入写测试：重复导入不复制 slug，旧日期不变为今天，Markdown 原文保留，封面导入为媒体引用。先 dry-run，再在独立测试库验证。
- [ ] 实现公开文章列表 / 详情、公开标签；private 管理字段不可出现在公共响应，数据库故障不伪装 404。
- [ ] 实现 CLI 初始化站主、预登录 CSRF、登录轮换会话、注销、过期和禁用账号；Cookie / Origin / CSRF / 会话 TTL 遵照 05，不设置默认账号密码。最小登录页使用共享 API 客户端。
- [ ] 实现单图上传与 w320 / w640 / w1280 变体、方向校正、元信息去除、格式 / 文件 / 像素限制、失败清理。媒体 ready 仅在文件落位和元数据成功后返回。
- [ ] 实现媒体授权：原图仅管理员；匿名变体需 ready + 未删除 + 至少一个公开引用。提供显式注册公开引用检查的扩展点，未注册的新域默认拒绝，不写永远 true 的占位判断。
- [ ] 实现乐观锁 / 错误结构 / 事务 / 有界图片处理的共用能力，避免各 App 复制权限逻辑。写入动作默认不盲目重试。
- [ ] 补充 API readiness 对 DB、schema 和媒体的检测，协调 T10 的容器健康接口。无本地文件 / DB 时返回明确未就绪，不泄漏路径。
- [ ] 提交模型、OpenAPI、CLI 用法、媒体引用扩展协议和前端登录接线申请，等待 T00 集成。

## 必须有的测试

| 输入 / 操作 | 断言 |
| --- | --- |
| 已登录站主读取公开 posts / tags | 仍无草稿、私密字段和草稿专用标签 |
| 跨站登录 / 发布请求、旧会话、注销后复用 | 被拒绝；预登录凭证不能赋予管理权限 |
| 假 PNG、损坏图、8 MiB 以上、像素超限 | 按约定拒绝；没有可公开的 ready 对象 |
| EXIF 含方向 / GPS | 派生图方向正确，敏感元信息去除 |
| 变体 URL 猜测、未关联媒体、原图请求 | 匿名不可读；路径穿越不可读 |
| 一张图两处公开引用，撤回其中一处 / 全部 | 前者仍公开，后者新请求拒绝 |
| 写文件失败或 DB 提交失败 | 不返回上传成功，孤儿对象可识别 |
| 重复旧文导入、缺失 slug、DB 断线 | 幂等、404 与服务不可用分别正确 |

运行模块测试必须用真实隔离 PostgreSQL；SQLite 不能替代约束验收。另运行共享命令中的 API 测试与前端登录检查；命令和真实结果写入交付单。

## 不做

不实现 INS / 导航领域，不新增公开注册、文章编辑后台、公共留言或真实投票统计，不改现有静态源内容。未获外部授权不处理生产 DB 或用户照片。

## 派发短提示

你负责 T01，只构建统一后端基础和最小登录页。按上述测试交付可复用的权限、媒体和文章读取能力；模型与迁移由 T00 集成，不接管其他模块。
