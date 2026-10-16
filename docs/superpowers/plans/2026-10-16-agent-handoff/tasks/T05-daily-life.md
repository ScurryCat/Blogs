# T05 · 手记、追番游戏与勒布朗近况

开始条件：T01 + T02 已集成。内部按“契约 → 手记 → 放课后 → 勒布朗组合”顺序完成；可与 T03 / T04 / T07 并行。

必读：[共享契约](../SHARED-CONTRACTS.md)、[验收](../ACCEPTANCE.md)、[07 §3、7、8](../../../specs/2026-10-16-world-features-design.md)、[05 §11](../../../specs/2026-10-16-data-api-design.md)。

## 文件与接口归属

- `apps/api/app/modules/journal/`、`apps/api/app/modules/leisure/` 与对应 `apps/api/tests/` 子目录。
- `apps/web/features/journal/`、`apps/web/features/leisure/`、`apps/web/features/leblanc/` 与包内测试。
- `apps/web/app/apps/journal/page.tsx`、`apps/web/app/apps/journal/[id]/page.tsx`、`apps/web/app/apps/leisure/page.tsx`。
- `apps/web/app/admin/journal/`、`apps/web/app/admin/leisure/`；`docs/agent-deliveries/T05-result.md`。

先提出 `/journal`、`/journal/{id}`、`/leisure` 及对应管理资源的契约增量；字段、过滤、排序、发布与隐藏规则由 T00 登记后实现。公开路径位于 `/api/v1`，不是另起服务。首页 `apps/web/app/page.tsx` 仍属 T02，勒布朗只交付可组合视图。

## 执行清单

- [ ] 定义 journal_entries 的日期、标题、正文、心情、媒体关系、draft / published 和 private / public；新建默认 draft + private。公开日历仅聚合真正公开记录。
- [ ] 用失败测试先证明私密 / 草稿的列表、详情、日历计数、图片和共享内容摘要都不可读；后台登录仅改变管理端，不污染公共 DTO。
- [ ] 实现日记管理、发布 / 私密切换与存档卡式列表 / 日历 / 正文。日历和列表是同一数据，不造不存在的日记或“欠写”提醒。
- [ ] 定义 leisure_entries 的共同字段及 anime / game 专属进度；追番总集数可空，游戏时长可空且通关不等于全成就。完成契约与模型后实现管理和公开双页签。
- [ ] 实现状态筛选、可空评分、短评、剧透折叠与可选长评 post 引用；未知总数不计算完成率，进度更新不自动公开刷 INS。
- [ ] 实现勒布朗近况组合：一句近况、最新公开日记、当前追番 / 游戏、现有音乐控制、留言链接。用清晰链接辅助装饰热点，小屏纵向阅读。
- [ ] 注册日记 / 封面媒体引用检查，向 T00 交付两个 App manifest 与勒布朗接线单。关联到公开相册的同一图即使日记转私密仍可能公开，要有准确提示。

## 验收

1. 草稿 / 私密日记在所有公开入口都不可见，切为 private 后新请求立即生效。
2. 日期按明确展示时区处理，不因 UTC 转换错一天；日历空态不显示隐藏记录数量。
3. 总集数空、弃坑、搁置、零评分与未评分的展示正确；无第三方同步暗示。
4. 手记 / 放课后在手机和独立页的数据一致、可返回；公共管理写入被拒绝。
5. 勒布朗不能因一个应用 API 失败导致音乐或整页消失；不自动调用 AI / 开启声音。
6. 日记与娱乐进度有真实持久化管理入口，不只交付一组硬编码演示卡片。

## 不做

不做 Steam / Bangumi 同步、真实地理定位、预约发布、朋友可见分组或面对面 AI 剧情。状态更新生成 INS 草稿可留作后续独立连接，不能为此修改 T03。

派发：你负责 T05，做站主能真正维护的生活记录，并输出勒布朗首页组合组件。优先保证日记的私密规则与进度真实性，不把装饰当业务。
