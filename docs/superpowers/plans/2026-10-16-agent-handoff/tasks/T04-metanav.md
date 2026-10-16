# T04 · 异世界导航与专题殿堂

开始条件：T01 + T02 已集成。可与 T03 / T05 / T07 并行。

必读：[共享契约](../SHARED-CONTRACTS.md)、[验收](../ACCEPTANCE.md)、[04 导航完整设计](../../../specs/2026-10-16-metaverse-navigator-design.md)、[05 数据 API](../../../specs/2026-10-16-data-api-design.md)、[07 §6](../../../specs/2026-10-16-world-features-design.md)。

## 文件与范围

- `apps/api/app/modules/nav/{models,schemas,router,service}.py`、`apps/api/tests/nav/`。
- `apps/web/features/metanav/` 及包内测试。
- `apps/web/app/apps/metanav/page.tsx`、`apps/web/app/apps/metanav/palaces/[slug]/page.tsx`；`apps/web/app/admin/palaces/page.tsx`、`apps/web/app/admin/palaces/[id]/page.tsx`。
- `docs/agent-deliveries/T04-result.md`。

包含公开专题、三关键词定位、普通搜索、分类印象空间、专题管理和本机访问足迹。不包含问题记录 CRUD、技能卡、作品集或公开访客请求板。

## 执行清单

- [ ] 按 05 实现 palaces / palace_posts / aliases；同一专题文章与位置唯一，发布需至少一篇公开文章，公共查询过滤被撤回的关系。
- [ ] 为 NFKC、trim、大小写、别名重叠建立确定性匹配测试；三字段求交集，返回 found / ambiguous / not_found，禁止模型猜测。
- [ ] 实现搜索：只查公开文章 / 专题，按既定字段、排序和游标规则；SQL 输入转义，多个候选明确选择，API 故障不是 not_found。
- [ ] 实现专题管理与有序文章选择、关键词 / 别名、预览、发布 / 撤回和并发编辑冲突。
- [ ] 实现已发现殿堂、关键词引导、专题阅读与分类印象空间；普通中文说明和直接进入入口始终存在，不要求猜暗号。
- [ ] 首个专题使用已有公开文章组成“怪盗据点工程”；如果导入数据不足，保留草稿并报告，不能杜撰文章或履历。
- [ ] 只在明确点击进入殿堂时发送 metaverse-entry。动画由共享协调器执行，不独立创建全屏遮罩或使用地图人群。
- [ ] 本机足迹上限 30，可清除，重新访问再次读取公开状态。为 T09 问题记录提供组合入口，未接入不显示空功能。

## 验收用例

1. 不熟悉 P5 的访客可直接从列表进入文章，不被谜题阻拦。
2. 标准值 / 别名 / 全角输入 / 多匹配均返回正确结果；未找到与服务故障有不同反馈。
3. 全部关联文章撤回后，专题列表、详情、匹配、搜索及足迹访问均不可读。
4. 公开专题不泄漏草稿文章标题与标签；跨页游标切换筛选会校验指纹。
5. 打开 App、输入和匹配结果不触发全屏动画；明确进入、历史返回、直接 URL 各自正确。
6. 手机与独立页刷新 / 分享 / 返回一致；存储不可用不阻止导航。

用 PostgreSQL 测试发布与匹配，前端测试状态与导航来源，浏览器验证真实专题。交付接线和迁移说明，不改根配置 / 全站动画实现。

派发：你负责 T04，以真实文章建立可使用的专题导航。遵守原作意象和确定性匹配，不增加战斗、现实人物扭曲评价或公开接单系统。
