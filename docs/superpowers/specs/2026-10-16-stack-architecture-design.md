# 01 · 技术选型与总体架构

日期：2026-10-16

状态：待评审草案

入口：[设计总览](2026-10-16-next-phase-design.md)

## 1. 选型判断

这套栈适合“个人博客逐步发展成有内容管理和内置应用的作品”。对于仅发布 Markdown 的博客，它明显更重；对于图文动态、媒体上传、专题配置和后续 Python 功能，前后端分工有实际价值。

| 方案 | 优点 | 成本与限制 | 本项目建议 |
| --- | --- | --- | --- |
| Next.js + FastAPI + PostgreSQL | React 组件复用，Python 业务扩展，共享数据与清晰 API | Node / Python 两套依赖、两个服务、接口协调 | 作为目标方案，按阶段落地 |
| Next.js + PostgreSQL，业务也在 Next.js | 少一个服务，个人维护更简单 | 后续 Python 功能需另接服务 | 若重点只是博客与相册，这是更省事的备选 |
| 保留静态站，增加少量 API | 迁移成本低，现有效果最容易保留 | 手机应用体系、管理后台仍需逐步补齐 | 用于过渡和回退，不作为长期双路由方案 |

Next.js 已基于 React，不需要再建一个独立 React SPA。选择 App Router + TypeScript；FastAPI 负责业务 API，PostgreSQL 保存权威数据。后端建议使用 SQLAlchemy + Alembic 管理关系和迁移，依赖版本在实现时验证并锁定，不在设计中承诺某个“永远最新”的版本。

## 2. 目标拓扑

```text
浏览器
  │ HTTPS，同一站点域名
  ▼
gateway：反向代理 / TLS / 请求体限制
  ├─ /api/v1/* ──────────────► api：FastAPI
  └─ 其余路径 ──────────────► web：Next.js
                                  │ 内网只读 API 请求
                                  └─────────────────► api
                                                       ├─► db：PostgreSQL
                                                       └─► media_data：持久媒体目录
```

这是模块化单体后端配一个前端，不是按每个手机 App 分拆微服务。INS、导航和文章共享认证、媒体及标签，但各自拥有明确的领域模块。

只有网关对公网开放。Next.js 不直接连接数据库，也不拥有第二套发布、上传或权限业务。浏览器访问相对地址 `/api/v1`；Next.js 服务端使用仅服务端可见的 `API_INTERNAL_URL` 访问 API。

API 路由本身包含 `/api/v1` 前缀，网关原样转发，避免代理剥离前缀与 `root_path` 配置混用。

## 3. 职责与数据所有权

| 层 | 拥有 | 不负责 |
| --- | --- | --- |
| Next.js 服务端组件 | 文章首屏、公开页面渲染、元信息、公开 API 读取 | 直接写数据库、再实现一个认证系统 |
| React 客户端组件 | 手机状态、音乐控制、Canvas、表单、键盘与触控 | 决定发布权限、真实统计、防刷 |
| FastAPI | 验证、认证、权限、发布规则、媒体处理、检索 | 页面布局、全局 DOM、转场播放 |
| PostgreSQL | 文章、动态、媒体元数据、殿堂、会话、审计 | 存储图片二进制或前端组件代码 |
| 媒体卷 | 经过校验的图片及缩略图 | 替代数据库或备份 |
| 浏览器本地存储 | 音量、音效、收藏、最近访问等本机偏好 | 跨设备数据源、身份凭据、公共票数 |

未来后台可见功能仍由 FastAPI 鉴权。隐藏按钮、Next.js 路由保护或手机 manifest 中的 `admin` 标记都不是安全边界。

## 4. 前端边界

根布局保持为 Server Component。只把持久交互区域放进 `SiteRuntime` 客户端组件：

```text
RootLayout（服务端）
├─ 页面 children（文章等服务端内容）
└─ SiteRuntime（客户端，跨普通站内路由保留）
   ├─ AudioService / 音效偏好
   ├─ NavigationCoordinator / TransitionLayer
   ├─ PhoneProvider / PhoneHost
   └─ Toast / OverlayManager
```

不要把整个页面树改成 `use client`。手机、动画、播放器需要浏览器 API；文章正文不需要因此失去服务端渲染。客户端组件也可能参与首屏预渲染，所以模块顶层和初次渲染仍不能直接读取 `window` / localStorage。

音乐只创建一个音频元素。根布局、持久组件不得使用 pathname 作为重建 key；不要在每个页面、每个 App 中分别创建播放器。开发环境也要测试 React 重复挂载检查下的清理逻辑。

Next.js 共享布局可以保留状态，但这不等于跨整页刷新或独立 root layout 仍能连续播放。迁移期从旧 HTML 跳入 Next.js 时可能重载，必须明确记录这个临时边界。

## 5. 路由与原有链接

| 现有入口 | 目标入口 | 兼容规则 |
| --- | --- | --- |
| `index.html` | `/` | 正式切换后定向到首页，保留 hash |
| `index.html#posts` | `/#posts` | 保留文章区锚点，不额外播放动画 |
| `index.html#archive` | `/#archive` | 首版继续支持锚点 |
| `post.html?p=<slug>` | `/posts/<slug>` | 查询参数转换，不丢失 slug |
| `map.html` | `/map` | 保留地点 ID 与目的地映射 |
| `about.html` | `/about` | 保留简介与友链信息 |
| `weather.html` | `/weather` | 保留默认城市与定位选择 |
| `guestbook.html` | `/guestbook` | 清楚区分本地历史与未来公共留言 |
| 手机新应用 | `/apps/ins`、`/apps/metanav` | 独立页可直接访问、刷新和分享 |

当前首页由 `index.html` 与 `assets/js/home.js` 组成，并不存在 `home.html`。`poll-demo.html` 是组件演示页，可保留在开发 / 测试环境，不必变成公开主导航。旧 URL 对有效内容使用永久重定向；无效 slug 返回真正的 404，不统一跳回首页掩盖错误。

导航遵循 [手机应用平台](2026-10-16-phone-app-platform-design.md) 的来源协议。原 PJAX 在旧站独占控制权，Next Router 在新站独占控制权；二者不同时拦截同一个 React 页面。

## 6. 数据获取与缓存的首版策略

先保证发布与撤回可预测，再优化缓存：

- 公开动态、导航、文章 API 及对应动态页面首版使用明确的 `no-store` 策略，不依赖框架的隐式缓存默认值。
- 管理后台的个人数据由浏览器调用鉴权 API 获取，不在首版实现跨服务的 SSR 会话转发。
- 任何认证、草稿、管理接口和认证响应都不得进入共享缓存。
- 图片与其他媒体的访问策略见 [数据与 API](2026-10-16-data-api-design.md)，不把草稿图放进公开目录。
- 构建产生的带内容指纹资源可以长缓存；旧版不带指纹的资源不能直接套用 `immutable`。
- 增加页面缓存之前，必须写出发布、修改、撤回时的失效路径及允许的延迟，再评估跨实例缓存；不为尚不存在的多实例部署提前引入 Redis。

公开阅读遇到后端故障时返回清晰的不可用提示和正确状态，不将服务错误伪装成“没有文章”。手机已有列表可保留在当前会话中，并显示数据未更新。

## 7. 建议目录，仅作为目标结构

```text
apps/
  web/
    app/                   # Next.js 页面与服务端外壳
    components/            # 站点通用视觉组件
    features/phone/        # 宿主、注册表、返回栈
    features/ins/          # 同时供手机和独立页使用
    features/metanav/
    lib/api/               # OpenAPI 类型、请求适配
    public/assets/         # 已审核的旧资源
  api/
    app/core/              # 配置、数据库、认证
    app/modules/           # posts / moments / media / nav
    migrations/
    tests/
deploy/                    # Dockerfile、Compose、网关配置
docs/
```

先用单仓库和普通依赖管理；不要求一开始就搭 Monorepo 编排平台。不要为了统一语言而复制一套 Python 模型到 TypeScript：API 用 OpenAPI 输出契约，前端生成类型，CI 检查漂移。

## 8. 迁移保留项与风险

保留文章 slug、地图地点、P5 排版、问卷可复用配置、手机音乐偏好和无障碍行为。旧的 Canvas 素材与纯绘制算法可复用，DOM 注入与全局事件改成组件所有权并清理。

已遇到过的旧 HTML 缓存混用、过期请求执行脚本、后退残留遮罩，应成为新导航的回归案例。不要迁移旧脚本动态执行方案；新站使用正常模块导入与路由生命周期。

旧 Markdown 的人物对话、`!!!` 提示等扩展必须建立输出快照和安全测试；不要把旧 renderer 的字符串结果不加审查地交给 `dangerouslySetInnerHTML`。正文原文为权威数据，渲染器换代不应丢失内容。

## 9. 架构验收

1. 一个公开域名能同时访问页面与 `/api/v1`，数据库端口不暴露公网。
2. Next.js 不含数据库凭据；浏览器构建物不含 API 私密配置。
3. 跨页面、打开关闭手机、切换应用不会重复创建音频或监听器。
4. 公开请求无法读取草稿，绕过前端直接请求写接口也会被拒绝。
5. 旧文章链接、地图目的地和返回键保持可用。
6. 首版不依赖 Redis、消息队列、第三方社交账号或仓库外的绝对素材路径。

## 参考

- [Next.js Server / Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)：组件边界。
- [Next.js Layouts and Pages](https://nextjs.org/docs/app/getting-started/layouts-and-pages)、[React 状态保留规则](https://react.dev/learn/preserving-and-resetting-state)：持久外壳设计依据。
- [Next.js 自托管](https://nextjs.org/docs/app/guides/self-hosting)：缓存与部署注意事项。
- [FastAPI 代理部署](https://fastapi.tiangolo.com/advanced/behind-a-proxy/)：前缀与可信代理配置。

查阅日期：2026-10-16；上述组件划分、缓存保守策略与目录结构为本项目建议。
