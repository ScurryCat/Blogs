# 05 · 数据模型、API 与安全边界

日期：2026-10-16

状态：待评审草案；是这组设计中字段与接口的共同契约。

入口：[设计总览](2026-10-16-next-phase-design.md)

## 1. 原则与阶段

FastAPI 是业务与权限的唯一权威入口，Next.js 不直接访问 PostgreSQL。基础版一位站主，访客对公开内容匿名只读，不创建访客账号体系。后续角色消息允许匿名访客写入自己的会话，不授予公共发帖或站主管理权限。

按里程碑创建实际需要的表，而不是一次生成所有未来应用的数据结构。文章读服务与既有封面媒体导入先落地，包含媒体只读接口和受控初始化的站主身份；随后是管理员会话、图片上传和 INS，再增加导航专题。留言与真实投票的后端化另行评审。

## 2. 共同约定

| 项目 | 约定 |
| --- | --- |
| API 前缀 | `/api/v1`，内外网都保留这个前缀 |
| JSON 命名 | `snake_case`，前端生成类型也遵守，不手写另一套字段映射 |
| 业务 ID | UUID；slug 用于公开文章 / 专题 URL，保持稳定且唯一 |
| 时间 | 数据库 `timestamptz`，响应为 UTC ISO 8601；界面按展示时区格式化 |
| 文本长度 | 按 Unicode 码点计数，服务端最终校验；前端与之对齐 |
| 状态 | 文章、动态、殿堂：`draft` / `published` + 可空 `deleted_at` |
| 公开条件 | published、未软删除、发布时间不在未来；殿堂还必须有公开文章 |
| 修改版本 | 整数 `version`，每次成功修改递增 |
| 分页 | 不透明游标，稳定排序，默认 12、最大 30；搜索默认 20、最大 30 |
| 错误 | 使用 HTTP 状态与结构化错误，不用 200 包装失败 |
| 数据来源 | PostgreSQL 中的内容为权威；localStorage 只存偏好与本机记录 |

UUID 不等于访问控制。public 查询必须先加公开条件，再排序、分页和返回；不能先查全部，再在浏览器过滤草稿。

## 3. 关系模型

```text
admin_users ──< sessions
     │
     ├──< moments ──< moment_media >── media
     │        └──< moment_tags >── tags
     └──< audit_events

posts ──< post_tags >── tags
  │
  ├── cover_media_id ──► media
  └──< palace_posts >── palaces ──< palace_aliases
```

### 文章与标签

- `posts`：`id`、唯一 `slug`、`title`、`excerpt`、`content_md`、`category`、`cover_media_id`、`display_date`、`status`、`published_at`、`created_at`、`updated_at`、`deleted_at`、`version`。
- `tags`：`id`、唯一规范化 `slug`、展示 `name`。
- `post_tags`：`post_id`、`tag_id`，组合唯一。

`display_date` 保留旧文章只有日期的展示语义；旧日期转换为迁移约定时区的发布时间，并记录转换规则，不能悄悄改成导入当天。`content_md` 是正文来源，不把渲染 HTML 当唯一存档。

文章原封面可在导入时作为媒体登记并迁入媒体存储；图标、纹理等已审核站点装饰继续作为版本化静态资源。二者不要混用成可直接访问草稿的公共上传目录。

### INS

- `moments`：`id`、`author_id`、`text`、`status`、`published_at`、`created_at`、`updated_at`、`deleted_at`、`version`。
- `moment_media`：`moment_id`、`media_id`、`position`、`alt`；同一动态的媒体 ID 与 position 分别唯一。
- `moment_tags`：`moment_id`、`tag_id`，组合唯一。

草稿可暂时没有图片，替代文本也可在发布前补齐；发布时必须有 1–9 张 ready 图片。最多 8 个标签等跨行约束由服务端在事务中验证。已有外键、唯一键和数据库 CHECK 能表达的约束仍要落在数据库，不能只靠管理表单。

### 媒体

- `media`：`id`、`owner_id`、`storage_key`、真实 `mime_type`、`bytes`、`width`、`height`、`sha256`、`variants`、`status`、`created_at`、`deleted_at`。
- `status`：`processing` / `ready` / `failed`；变体元数据 `variants` 可用 JSONB，包含固定变体名、宽高与对象键。
- `storage_key` 由服务端生成，不使用用户文件名拼接路径；API 不返回服务器绝对路径。

只将变体元数据等形状可变的小数据放 JSONB。文章正文、发布状态、顺序、外键和权限条件不藏在大 JSON 文档里。

### 异世界导航

- `palaces`：`id`、唯一 `slug`、`title`、`summary`、`name`、`location`、`cognition`、`status`、`published_at`、`created_at`、`updated_at`、`deleted_at`、`version`。
- `palace_aliases`：`palace_id`、`field`、`value`、`normalized_value`；field 为 name / location / cognition，同一专题同字段规范值唯一。
- `palace_posts`：`palace_id`、`post_id`、`position`；文章与顺序分别在同一专题内唯一。

标准关键词也参加规范化匹配。多个专题别名重叠时返回多候选，不依赖一条 SQL 的偶然返回顺序。公开殿堂存在性通过当前公开文章关系判断，不缓存一份可能过期的“已公开文章数”作为权限条件。

### 管理与会话

- `admin_users`：`id`、唯一 `username`、`password_hash`、`disabled`、`created_at`。
- `sessions`：`id`、唯一 `token_hash`、可空 `user_id`、`csrf_secret`、`created_at`、`last_seen_at`、`expires_at`、`revoked_at`。
- `audit_events`：`id`、`actor_id`、`action`、`entity_type`、`entity_id`、`request_id`、`at`、最小变更元数据。
- `auth_rate_limits`：登录限流桶的散列 key、窗口、计数与过期时间；只用于短期安全限制，不保存输入密码或查询正文。

预登录会话的 `user_id` 为 null，不能用于站主权限。审计只保存必要管理事件，不保存密码、Cookie、搜索正文或完整上传文件。

## 4. 索引与事务

首批索引：

- posts：唯一 slug；公开列表 `(published_at DESC, id DESC)`，按实际分类查询加组合索引。
- moments：公开列表 `(published_at DESC, id DESC)`；标签关联索引。
- palaces：唯一 slug；关系表外键与顺序唯一约束；别名 `(field, normalized_value)`。
- sessions：token_hash 唯一索引、过期时间索引。

实际实现应按公开条件选择合适的部分索引，并用查询计划验证；不凭“可能搜索很多”给所有文本建 GIN 索引。

一次动态更新中的文字、图片顺序、标签及 version 在同一个数据库事务里提交；发布验证和状态改变也同事务完成。专题的文章顺序与关键词同理。

文件系统与数据库不是同一事务。媒体先暂存和处理，文件完整落位后才将记录置为 ready；崩溃留下的未关联对象由检查任务识别，不将“数据库回滚”描述成能自动回滚文件。删除不立即物理清除共享媒体，必须检查引用和保留期。

## 5. 身份认证与 CSRF

首版推荐服务端会话，而不是给个人博客引入访问令牌、刷新令牌、OAuth 提供方三套机制。

1. 管理员通过部署期 CLI 初始化，无默认账号密码、无公开注册 / 建站接口；重置也走受控运维流程。
2. 密码使用 Argon2id 等适合密码的哈希方案，禁止明文或普通 SHA 哈希。
3. `GET /auth/session` 在管理页面需要时建立 10 分钟预登录会话，并返回 CSRF token；普通浏览不创建会话。
4. `POST /auth/login` 校验 CSRF 与 Origin，认证成功轮换会话标识和 CSRF token，避免会话固定。
5. 生产 Cookie 为 `__Host-pl_session`，`HttpOnly`、`Secure`、`SameSite=Lax`、`Path=/`，不设置 Domain；库中只保存随机会话凭证的 hash。
6. 建议会话最长 8 小时、空闲 30 分钟失效；注销或禁用账号使其立即不可用。
7. 所有状态变更请求，包括登录、注销、发布、编辑、上传，必须带 CSRF token 并通过同源 Origin 校验。SameSite 是附加防护，不替代 CSRF。
8. 管理接口返回 `Cache-Control: private, no-store`；会话 / CSRF 不放 localStorage，不打印在日志中。

`POST /nav/resolve` 是无副作用的公开读取，不使用管理会话也不修改足迹；只接受 JSON 并实施输入校验和限流，不套用“公开读取需要登录”的规则。

生产浏览器访问同源 API，不需要开放跨域来源。若本地临时分端口，必须明确允许可信开发 Origin，不能将带凭据请求配成 `*`。本地 HTTP 使用单独开发 Cookie 名和非 Secure 配置，必须仅限开发环境，不能原样上线。

## 6. 公开 API

下表省略共同前缀 `/api/v1`。

| 方法与路径 | 参数 / 结果 | 权限与行为 |
| --- | --- | --- |
| `GET /posts` | category、tag、cursor、limit | 公开文章摘要列表；印象空间复用 |
| `GET /posts/{slug}` | 文章正文与公开元信息 | 草稿 / 删除 / 不存在统一 404 |
| `GET /tags` | 有公开文章或动态的标签 | 不泄漏仅草稿使用的标签 |
| `GET /moments` | tag、cursor、limit | 公开动态列表 |
| `GET /moments/{id}` | 完整动态与有序图片 | 不返回管理字段 |
| `GET /media/{id}/{variant}` | 如 `w640.webp`，固定变体枚举 | 每次检查公开引用或站主权限 |
| `GET /nav/palaces` | cursor、limit | 当前可进入的专题列表 |
| `GET /nav/palaces/{slug}` | 标准关键词、文章顺序 | 只包含公开文章；无公开文章时 404 |
| `POST /nav/resolve` | name、location、cognition | 返回 found / ambiguous / not_found；不写入数据 |
| `GET /nav/search` | q、kind、tag、cursor、limit | kind 为 post / palace，省略表示两者 |

普通搜索每个词按标题、别名、标签和摘要匹配，同分按 `published_at DESC, id DESC` 稳定排序，再加 kind 作为最终区分。殿堂的标签由其关联公开文章的标签并集派生，不混入草稿文章标签。所有 SQL 条件参数化，`LIKE` 的 `%` / `_` 按普通输入转义，不让输入意外变成通配查询。

导航关键词每项 1–80 码点，搜索 q 为 1–80；NFKC + trim + 不区分大小写。读取游标前验证格式、排序字段、过滤条件指纹；无效或与当前筛选不符返回 400，切换筛选由客户端重新从第一页开始。

列表统一结构：

```json
{
  "items": [],
  "next_cursor": null
}
```

详情直接返回对象，不套多层 data。动态示意结构，UUID 与时间均由服务端生成：

```text
id, text, tags[], published_at
images[]: media_id, position, alt, width, height,
          variants[]: name, width, height, url
```

公开响应不包含 storage_key、原始文件名、管理员会话、草稿 version 或内部路径。列表图片只加载当前需要的版本，不因响应有多个 URL 就全部下载。

认知定位返回：`status` 与 `matches[]`，分别是一个、多个或空专题摘要。`not_found` 是正常 200 业务结果；API 故障是 5xx，不能混为一谈。搜索结果含 `kind`、`id`、`slug`、`title`、`excerpt`、服务端生成的本站 `href`，不返回任意第三方重定向地址。

## 7. 管理 API

所有 `/admin/*` 强制站主权限。创建返回 201，成功更新返回更新后的对象，软删除 / 注销成功返回 204。

| 方法与路径 | 作用 |
| --- | --- |
| `GET /auth/session` | 读取会话状态与 CSRF token；预登录状态不含站主权限 |
| `POST /auth/login`、`POST /auth/logout` | 登录 / 注销 |
| `POST /admin/media` | multipart 单图上传；返回 ready 媒体元数据 |
| `GET /admin/moments`、`GET /admin/moments/{id}` | 管理列表、读取草稿 / 预览 |
| `POST /admin/moments` | 新建草稿，text / images / tags |
| `PATCH /admin/moments/{id}` | 更新指定字段；传入 images 时完整替换有序关系 |
| `POST /admin/moments/{id}/publish`、`POST /admin/moments/{id}/unpublish` | 发布 / 撤回 |
| `DELETE /admin/moments/{id}` | 软删除 |
| `GET /admin/nav/palaces`、`GET /admin/nav/palaces/{id}` | 管理专题与预览 |
| `POST /admin/nav/palaces`、`PATCH /admin/nav/palaces/{id}` | 新建 / 更新专题；关系列表完整替换 |
| `POST /admin/nav/palaces/{id}/publish`、`POST /admin/nav/palaces/{id}/unpublish` | 发布 / 撤回专题 |
| `DELETE /admin/nav/palaces/{id}` | 软删除专题，不删除其中的文章 |

站主详情响应含 `version` 并返回 ETag，例如 `"3"`。修改、发布、撤回、删除都必须带 `If-Match: "3"`：未提供为 428，版本不一致为 412，避免并行编辑丢失数据。客户端遇到 412 保留未保存输入，提示读取新版并处理冲突，不自动覆盖。

公开响应不因站主登录就顺便返回草稿。预览只用管理接口，避免同一个公共 URL 的身份差异导致缓存泄漏。

文章管理 UI / 写 API 是后续独立功能；初始文章通过受控迁移命令导入。正式切换数据源后不能继续把 posts.js 与数据库同时当作可编辑来源。

## 8. 媒体访问与上传安全

- 上传类型仅 JPEG / PNG / WebP；以真实签名及解码结果判断，不只看扩展名或 Content-Type。
- 单文件 8 MiB，解码像素上限建议 40MP、单边不超过 8192px；网关请求体上限略大于 multipart 单文件限额，API 仍独立校验。
- 解码与压缩使用有界并发，不在事件循环里长时间执行 CPU 阻塞操作；建议首版最多同时处理 2 张，按服务器测量调整。
- 图片方向归一、删除 EXIF 等元信息，生成固定变体；原始文件只允许站主管理访问。
- `/media/{id}/{variant}` 只接受预定义变体名，不接受任意路径；媒体卷不直接以静态目录暴露。原始文件变体永远只允许站主访问，即使它关联的内容已经公开。
- 匿名可见条件：媒体 ready、未删除，且至少关联一个当前公开动态或公开文章封面。未关联上传、草稿附件匿名统一 404。
- 首版图片响应也使用 `private, no-store`，不把撤回权限与 CDN 长缓存混用；后续若开放短缓存，要先接受明确的撤回延迟。
- 返回准确 Content-Type 与 `X-Content-Type-Options: nosniff`；不接受可执行 SVG / HTML 附件。
- 文件写入失败、DB 提交失败、磁盘接近满、进程崩溃均不得返回 ready。超过一周的失败 / 无引用暂存对象可列入清理报告，实际删除前检查引用与备份保留策略。

媒体元数据授权与文件是否存在分别校验；不能因数据库里有记录就返回一个错误文件，也不能因磁盘上有文件就跳过权限。

## 9. 错误、限流与重试

错误结构：

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "内容已在别处更新，请先读取最新版本。",
    "fields": {}
  },
  "request_id": "opaque-request-id"
}
```

| 状态 | 示例 |
| --- | --- |
| 400 | 无效游标、非法筛选 |
| 401 / 403 | 未登录 / 无权限或 CSRF 校验失败 |
| 404 | 不存在或对公众不可见 |
| 409 | 业务冲突，如图片未 ready 时发布 |
| 412 / 428 | 修改版本过期 / 未带 If-Match |
| 413 / 415 / 422 | 文件太大 / 类型不支持 / 字段或图片解码不合法 |
| 429 | 触发限流，返回 Retry-After |
| 5xx | 服务异常；不给客户端数据库堆栈或路径 |

FastAPI 默认验证错误需要映射到此结构，不能让不同端点随意返回另一种格式。媒体流响应是非 JSON 成功响应，异常仍按规则返回。

起始限流建议：登录每 IP 每分钟 5 次、搜索 / 定位每 IP 每分钟 60 次、上传每站主每分钟 10 次，实际阈值通过测试调整。API 保留必要的短期登录失败限制；安全限流元数据最多保留 24 小时，与访客搜索内容分开，IP 标识最小化处理。不为这个量级默认上 Redis。

读取请求可按退避重试一次；鉴权、验证和版本错误不重试。写入与上传不自动重试，避免断网后的重复创建；界面锁定本次提交并保留草稿，需要时先检查服务端结果再重试。

## 10. 安全与测试门槛

1. 参数化查询，响应模型按公开 / 管理拆分，正文渲染禁用任意 HTML 或执行白名单清洗。
2. 为动态、图片、殿堂、搜索分别测试草稿泄漏，包括已登录浏览公开端点的情况。
3. 上传错误、孤儿文件、DB 回滚和软删除均覆盖；媒体卷故障时不得误报成功。
4. 认证、预登录、会话轮换、CSRF、过期、注销、禁用账号、登录限流均有集成测试。
5. PostgreSQL 集成测试验证真实约束与事务，不仅使用 SQLite 代替后就宣称完成。
6. OpenAPI 生成前端类型，CI 检查已提交类型与当前 API 是否一致。
7. 分页同时间戳、筛选改变、撤回、多匹配关键词、中文及全角输入有回归样例。

## 11. 新增功能的数据契约边界

[07 功能世界设计](2026-10-16-world-features-design.md) 提出日记、追番 / 游戏、友链、作品、相册、技能与问题记录；[08 角色消息](2026-10-16-character-messaging-design.md) 提出匿名会话与混合剧情。这些是增量需求，不代表以上基础表和端点已经支持它们。

各批次实施前，需要把本文件扩展为相应的精确字段、外键、端点和测试契约；不因总览称 05 为共同契约而忽略新增产品需求。约束如下：

- 日记的 public / private 可见性独立于 draft / published；仅已发布 public 内容允许公开查询，私密内容只从管理接口读取。
- 增加相册、日记和作品媒体关系时，同步扩展 `/media` 的公开引用判断与撤回测试。一张图仍有其他公开引用就保持公开，管理端应提示，而不是声称一次撤回收回所有副本。
- 作品可以可选关联专题殿堂；现有 `palace_posts` 保持文章关系，不添加无外键验证的任意资源 ID。
- 真实友链与虚构角色分别建模；角色消息不是公开动态、评论或友链作者的私信。
- 访客会话凭证与管理员 sessions 分离；访问任意 conversation 都校验访客归属，UUID 不能当授权。
- AI 只读取当前允许公开的内容摘要，不能借站主身份获取私密日记、草稿或其他访客会话。
- 幂等消息请求、剧情节点版本、原子预算计数、过期清除与备份排除策略属于角色模块交付条件，不以纯前端状态或提示词代替。

## 参考

- [FastAPI 文件上传](https://fastapi.tiangolo.com/tutorial/request-files/)、[CORS](https://fastapi.tiangolo.com/tutorial/cors/)：框架能力与同源边界。
- [FastAPI 密码哈希示例](https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/)：仅参考密码哈希部分；本站会话方案不采用其中的 JWT 流程。
- [OWASP CSRF 防护](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)、[文件上传](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)：安全设计参考。
- [PostgreSQL JSON 类型](https://www.postgresql.org/docs/current/datatype-json.html)、[pg_trgm](https://www.postgresql.org/docs/current/pgtrgm.html)：元数据与按需检索能力。

查阅日期：2026-10-16。表结构、接口、会话时间与限额均为本站拟议契约，需在实现前评审并落测试。
