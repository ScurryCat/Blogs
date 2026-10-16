# T03 · INS 图文发布与阅读

开始条件：T01 + T02 已集成。可与 T04 / T05 / T07 并行。

必读：[共享契约](../SHARED-CONTRACTS.md)、[验收](../ACCEPTANCE.md)、[03 INS](../../../specs/2026-10-16-ins-design.md)、[05 数据 API](../../../specs/2026-10-16-data-api-design.md)、[08 §2 信息结构](../../../specs/2026-10-16-character-messaging-design.md)。

## 目标与文件

完成“站主发布一条图文，另一浏览器能阅读”的完整闭环，包含手机和独立页。负责图文，不实现 AI；本包完成不等于整个 INS 完成。

- 创建 `apps/api/app/modules/moments/{models,schemas,router,service}.py` 与 `apps/api/tests/moments/`。
- 创建 `apps/web/features/ins/` 及包内测试。
- 创建 `apps/web/app/apps/ins/page.tsx`、`apps/web/app/apps/ins/[id]/page.tsx`、`apps/web/app/admin/moments/page.tsx`、`apps/web/app/admin/moments/[id]/page.tsx`。
- 创建 `docs/agent-deliveries/T03-result.md`。

不创建 / 修改 `apps/web/app/apps/ins/messages/`、gallery、media core、phone registry、生成类型和迁移。

## 执行清单

- [ ] 按 05 的既有 moments 契约实现模型、约束和发布服务；先测试草稿可空、发布需 1–9 张 ready 图、2000 码点文本、最多 8 标签、唯一图片顺序与 alt 要求。
- [ ] 实现公开列表 / 详情和完整管理读写 / 发布 / 撤回 / 软删除，媒体 / 标签 / version 在同一事务校验。
- [ ] 实现管理表单：上传使用共享媒体服务，排序、alt、草稿预览、冲突保留输入；不能把客户端缩略预览当作已上传成功。
- [ ] 实现信息流、详情、标签筛选、加载更多、图片预览、本机收藏与分享。收起 / 返回恢复滚动位置；无存储时仍能阅读并明确收藏限制。
- [ ] INS 壳允许通过组合注入相册和消息页签，未启用的页签不显示；头像区可插入 COOP 入口。只输出接口，T00 后续接线，不自行导入尚不存在的 T06 / T08 模块。
- [ ] 按共享宿主注册手机视图，canonical 页面使用同一数据与组件；动态详情 ID 强制 UUID，不能吞掉未来 messages 静态路由。
- [ ] 注册 moments 对媒体的公开引用检查交给 T00，验证撤回后的图文与媒体可见性。

## 验收用例

1. 站主上传、发布后，第二浏览器无需登录看到相同图序与时间；撤回后新公开请求看不到。
2. 旧 If-Match 更新返回 412，未带返回 428；编辑冲突不清空输入。
3. 恶意文本作为文字展示；损坏图片、空列表、无标签结果、断网与已撤回有不同状态。
4. 多页同时间排序稳定，切换标签重置游标，详情返回保留筛选与滚动。
5. 相册尚未实现时，不出现无法打开的“相册”按钮；消息尚未接入时不假装在线。
6. 390px 手机、桌面、键盘关闭预览与 reduced-motion 可用；音乐不被图片预览重建。

执行前端 / API 模块测试、类型检查、构建及两浏览器联调；共享媒体组合测试在 T06 集成后补跑。

## 不做与交付

不做真实点赞、关注、公开评论、真实用户私信、视频或第三方 Instagram。交付模型 / 路由 / manifest / 媒体引用 / 组合接口清单和测试截图。

派发：你负责 T03，完成可发布、可撤回、两设备一致的图文功能，并为相册和角色消息留下明确的组合接口；不要实现另外两个模块。
