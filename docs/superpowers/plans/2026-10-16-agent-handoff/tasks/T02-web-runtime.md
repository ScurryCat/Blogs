# T02 · 旧站迁移、持久外壳与手机宿主

开始条件：T00 完成。可先用明确标记的契约 fixture 与 T01 并行；正式验收必须接入其真实公开 API。

必读：[共享契约](../SHARED-CONTRACTS.md)、[验收](../ACCEPTANCE.md)、[01 架构](../../../specs/2026-10-16-stack-architecture-design.md)、[02 手机](../../../specs/2026-10-16-phone-app-platform-design.md)、[地图转场约束](../../../specs/2026-10-16-map-travel-transition-design.md)、[问卷设计](../../../specs/2026-10-15-phantom-poll-design.md)。

## 独占文件

- `apps/web/app/layout.tsx`、`apps/web/app/globals.css`、`apps/web/app/admin/layout.tsx`、`apps/web/app/healthz/route.ts`。
- `apps/web/features/runtime/`、`apps/web/features/phone/`（除 registry.ts）、`apps/web/features/legacy/`；`apps/web/components/ui/`；`apps/web/lib/api/`（除 generated）。
- `apps/web/app/page.tsx`、`apps/web/app/posts/[slug]/page.tsx`、`apps/web/app/map/page.tsx`、`apps/web/app/about/page.tsx`、`apps/web/app/weather/page.tsx`、`apps/web/app/guestbook/page.tsx`。
- `apps/web/tests/runtime/`、`apps/web/tests/phone/`、`apps/web/tests/legacy/`；`docs/agent-deliveries/T02-result.md`。

审查后的静态资源复制进入 `apps/web/public/assets/legacy/`；不修改原 `assets/`。共享注册与 next 配置变更提交 T00。

## 执行清单

- [ ] 建立旧页面、问卷、Markdown 扩展与地图交互的行为 / 截图基线；比较当前工作区而非仅 HEAD。
- [ ] 实现服务端 RootLayout 与客户端 SiteRuntime，保留单一 audio、NavigationCoordinator、PhoneProvider 与 OverlayManager；文章正文维持服务端读取。React 重挂载检查下也清理副作用。
- [ ] 用 React 与模块生命周期迁移旧页面，不将旧 PJAX / 动态脚本执行塞入新站。Markdown 对话 / 提示扩展有快照和恶意 HTML 测试。
- [ ] 迁移问卷纯模型与可复用配置，保持当前样式、Q / 支持率框比例及本机存储语义。不得擅自“升级”为全站真实票数。
- [ ] 实现明确导航来源与唯一导航令牌；地图三类入口用人群，顶部 Joker。历史取消、快速连点、缺图、弱网络、减少动态效果和 15 秒看门狗均有测试。router.push 不当作可等待 Promise。
- [ ] 实现手机 registry 类型消费者、懒加载、直立应用面板、独立页共用视图、URL 状态与直接链接关闭规则。仅挂载一个前台应用，不提前显示尚未上线的 App。
- [ ] 实现版本化音乐偏好 / 本机收藏服务与无存储降级；关闭手机与内部换屏不停止音乐，不在模块顶层读 window。
- [ ] 做好可插入勒布朗首页、COOP 入口和应用视图的组合边界；把注册 / 重定向接线申请交 T00。保留旧 post.html 查询及首页锚点。
- [ ] 与 T01 联调公开数据、最小 admin 外壳；错误页与加载态不假装无内容。提供不依赖 DB 的 `/healthz` 给 T10，并另用公开页面请求验证端到端。原本机留言仍明确是本地示例，不偷偷迁成共享留言。

## 验收

- [ ] 六个主页面有可访问路径；旧链接正确迁移，非法 slug 真 404。
- [ ] 自动测试覆盖状态、导航取消与 Markdown；真实浏览器验证地图图标 / 出发 / 列表、顶部、Back / Forward 与缺图。
- [ ] 打开 / 关闭手机、切 App、跨页各重复 20 次，音频元素和监听不累增。
- [ ] 320 / 390px 与桌面截图；内容正文不透视缩小，焦点 / Escape / 背景 inert / safe-area 有效。
- [ ] 旧问卷本机记录保留；未改变题目语义、已有样式和数据真实性。
- [ ] 运行前端类型、单测、构建及原有 53 项对应旧测试；不能用旧测试通过替代新 React 验收。

## 不做

不实现 INS / 聊天 / 新日记业务，不替换全站美术方向，不删除旧站，不改数据发布规则或直接连接数据库。

## 派发短提示

你负责 T02，将当前静态效果迁入可扩展 React 宿主，重点保持地图与顶部动画差异、音乐、问卷和手机返回。只提供其他 App 的承载能力，不包办所有应用。
