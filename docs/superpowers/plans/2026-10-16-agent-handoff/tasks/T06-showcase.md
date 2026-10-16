# T06 · 我的殿堂：作品与记忆画廊

开始条件：T04 已集成（因此 T01 / T02 也已具备）。可与 T08 并行。等待 T04 是为了作品关联真实专题，不各自发明殿堂关系。

必读：[共享契约](../SHARED-CONTRACTS.md)、[验收](../ACCEPTANCE.md)、[07 §5、7、8](../../../specs/2026-10-16-world-features-design.md)、[03 §6、8](../../../specs/2026-10-16-ins-design.md)、[05 §8、11](../../../specs/2026-10-16-data-api-design.md)。

## 文件与路由

- `apps/api/app/modules/projects/`、`apps/api/app/modules/gallery/` 与对应 API 测试。
- `apps/web/features/showcase/`、`apps/web/features/gallery/` 与包内测试。
- `apps/web/app/showcase/page.tsx`、`apps/web/app/showcase/projects/[slug]/page.tsx`、`apps/web/app/showcase/photos/page.tsx`。
- `apps/web/app/admin/projects/`、`apps/web/app/admin/albums/`；`docs/agent-deliveries/T06-result.md`。

契约增量包含 projects、albums / album_media、公开与管理 API、排序 / 分页、媒体引用；T00 登记后实现。作品可有可空 palace 外键，不把 project ID 塞入 palace_posts。

## 执行清单

- [ ] 为项目标题 / slug / 用途 / 职责 / 取舍 / 状态 / 演示与仓库链接 / 可选专题定义契约和发布要求，先测 URL 校验、草稿隐藏与关联专题撤回。
- [ ] 实现作品管理与公开列表 / 详情；第一件使用真实博客资料，缺少成绩材料时不生成奖项或虚构数字。
- [ ] 为相册、图片顺序、说明、拍摄时间可空定义契约；已有 media ID 复用，不重复保存相同上传的图像文件。
- [ ] 实现相册管理、照片墙筛选、自然比例图格与灯箱，照片与游戏截图可按相册分组。图片有 alt 和失败态。
- [ ] 作品详情“攻略记录”只链接当前公开专题；专题撤回不连带删除作品，也不露出隐藏专题标题。
- [ ] 输出供 INS 使用的紧凑 GalleryView 与路由映射，由 T00 注入 INS 页签。独立画廊与 INS 读取同一 albums 数据，不复制图库。
- [ ] 提交 projects / gallery 媒体公开引用检查；与 T03 联调一图多引用、单处撤回、全部撤回。公开图不会因某个私密引用而失效。

## 验收

1. 作品 / 相册有真实管理与发布闭环；公开页不依赖开发 fixture 或仓库外路径。
2. 同一媒体出现在动态 / 相册 / 项目时文件不重复上传，排序与说明可按上下文独立。
3. 一个引用撤回与所有引用撤回的权限结果分别正确，原始文件仍只给管理员。
4. INS 与独立照片墙的相册 / 图片一致，返回后保留位置，不新增 body 锁或音频。
5. 作品页明确“展示成果”，专题页“解释过程”；正常空内容不靠 3D 场景或假统计填充。
6. 390px 手机与桌面截图、灯箱键盘、图片慢加载与损坏均验证。

## 不做

不做 3D 漫游、AI 自动修图、角色自动点评或技能合体；技能关系留给 T09。交付数据契约、模块接线、媒体关系与实际浏览器证据。

派发：你负责 T06，以二维作品展厅和共享画廊交付“我的殿堂”。与 T03 共用媒体，不改它的 INS 壳；把相册页签接线交给 T00。
