# 整屏视觉修形第一轮 · 汇总（2026-10-18）

> 站主指令：按 `P4-visual-comparison-evidence.md` 的对照表开始整屏视觉修形，**IM 优先**。
> 本文件汇总 2026-10-18 完成的 10 个界面 / 9 轮修形（含 IM 两轮），作为阶段交付索引。

## 1. 已完成的整屏语言修形

| 顺序 | 界面 | 参考帧 | 交付记录 | 截图 |
| --- | --- | --- | --- | --- |
| 1 | IM 会话列表 / 会话（两轮） | `p5r-im-groupchat` / `p5r-im-photo` | `P4-im-visual-refinement.md` | `.dsh/screenshots/im-visual/` |
| 2 | 手记存档列表 + 日历 | `p5-load-save` / `p5-calendar` | `P4-journal-visual-refinement.md` | `.dsh/screenshots/journal-visual/` |
| 3 | 协助者 COOP | `p5r-coop-confidant` | `P4-coop-visual-refinement.md` | `.dsh/screenshots/coop-visual/` |
| 4 | 我的殿堂 Showcase | `p5-palace-treasure` | `P4-showcase-visual-refinement.md` | `.dsh/screenshots/showcase-visual/` |
| 5 | 天鹅绒房间 Velvet | `p5r-velvet-room` | `P4-velvet-visual-refinement.md` | `.dsh/screenshots/velvet-visual/` |
| 6 | 印象空间 Mementos | `p5-mementos` | `P4-mementos-visual-refinement.md` | `.dsh/screenshots/mementos-visual/` |
| 7 | 放课后 Leisure | `p5-leisure-batting` | `P4-leisure-visual-refinement.md` | `.dsh/screenshots/leisure-visual/` |
| 8 | 手机主屏 Phone Home | `p5-phone-home` / `p5r-street-hud` | `P4-legacy-visual-refinement.md` | `.dsh/screenshots/phone-about-map-visual/` |
| 9 | 关于 About（五维状态） | `p5-status` | `P4-legacy-visual-refinement.md` | `.dsh/screenshots/phone-about-map-visual/` |
| 10 | 东京地图 Map | `p5-tokyo-map` | `P4-legacy-visual-refinement.md` | `.dsh/screenshots/phone-about-map-visual/` |

另有 IM 图片消息 Phase 1（`P4-im-image-messages-result.md`）与视觉对照证据
（`P4-visual-comparison-evidence.md`，17 帧 ↔ 13 个站点界面）。

## 2. 统一做法

- **只改视觉**：不改数据、接口、交互语义、ARIA/键盘路径；
- **不伪造数据**：没有的字段（RANK/好感度/游玩时长/完成度）不补；
- **CSS 色块替代 3D 场景**：宝库/天鹅绒/隧道/击球笼没有场景素材，用渐变、斜切、
  警示条、霓虹线复刻整体语言，不冒充游戏截图；
- 每轮：单测 → 真实浏览器截图 → 视觉对照重采集 → `verify-all --e2e --mobile` 全绿 → 打包；
- 所有界面均标「**部分还原**」，不声称整屏逐像素验收通过。

## 3. 验证汇总

- 各包前端测试：IM 71、手记 55、COOP 79、Showcase 50、Velvet 59、Exploration 39、Leisure 27；
- 全量回归：前端 **933**、后端 **952**、T02 52/52、多视口 11、业务流 4/4、端到端 12 项；
- 视觉对照：`comparison-{1..3}.png`（17 帧 ↔ 13 界面并排）。

## 4. 仍未覆盖 / 下一步

1. **逐像素第二轮**（IM 优先）：字号、间距、比例、倾斜角按参考帧再对；
2. 各详情页（作品详情/技能详情/问题详情/条目详情）未做整屏修形；
3. 手机紧凑视图未逐屏截图对照；
4. 真实参考帧中 3D 场景/人物不在可复刻范围（无素材、无 3D 计划）；
5. 真机验证仍缺设备（与视觉修形无关的既有验收项）。
