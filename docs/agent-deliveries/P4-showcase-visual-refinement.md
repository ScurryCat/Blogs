# 我的殿堂（Showcase）整屏视觉修形 · 第一轮（对照 P5 宝库完整帧）

> 站主指令：按对照表继续整屏视觉修形（IM → 手记 → COOP 后推进殿堂）。
> 参考帧：`persona-curated/hud/p5-palace-treasure-fullframe.jpg`（来源/哈希见 `reference-frame-sources.md`）。
> 日期：2026-10-18。

## 1. 本轮改动

| 项 | 修形 |
| --- | --- |
| 页面容器 | 暗红/黑斜切宝库墙（`linear-gradient` + `skewX` 黑块）+ 顶部金色宝箱辉光（radial gradient）+ 3px 黑框 + 10px 黑硬阴影 |
| 页头 | `MY PALACE` 改大字号 display + 深红硬阴影；「我的殿堂」黑底纸白斜标签；右上金色 `TREASURE` 斜贴牌 |
| 作品卡 | 纸白卡面 + 3px 黑厚框 + 7px 黑硬阴影 + 交替 ±0.6° 倾斜；封面加 4px 黑框；标题黑底纸白斜标签（原有 EXHIBIT 编号保留） |
| 技术栈 | 黑描边小标签，压在纸白卡面上 |
| 页签 | 黑色宝物索引条 + 金色选中页签（黑字） |
| 详情分节 | 黑框纸白面板 + 黑硬阴影，链接深红 |
| 小屏 | ≤480px 去掉斜贴牌/倾斜，降低背景复杂度，单列不溢出 |
| 可达性 | 作品数据、链接、空态/失败态语义不变；不生成奖项/成绩数字；`prefers-reduced-motion` 取消倾斜 |

## 2. 与参考帧的映射边界

参考帧是 3D 宝库场景（红墙、发光宝箱、角色对话气泡）。本站没有宝箱/场景素材，
也不做 3D 漫游（任务书明确二维展厅），因此用**CSS 渐变 + 黑红金配色 + 纸白宝物框**
复刻「宝库展厅」的整体语言，而不是伪造场景截图或游戏 UI 元素。

## 3. 验证

- Showcase 前端测试：**50/50** 通过；
- `bash tools/verify-all.sh --e2e --mobile` → **7/7 段全绿**
  （前端 933 / 后端 952 / T02 52/52 / 多视口 11 / 业务流 4/4 / 端到端 12 项）；
- 视觉对照重采集 `/showcase` 与 `p5-palace-treasure-fullframe` 并排图；
- 截图：`.dsh/screenshots/showcase-visual/01-showcase.png`。

## 4. 剩余差距

1. 参考帧的宝箱/红墙/角色场景是 3D 画面，本站以 CSS 色块替代；
2. 作品详情页只统一了分节框，未做整屏修形；
3. 逐像素（比例/字号/倾斜角）未对；
4. 手机紧凑视图未单独截图对照（单列由既有测试覆盖）。

## 5. 下一轮

按对照表推进 **天鹅绒（velvet，p5r-velvet-room）→ 印象空间（mementos，p5-mementos）→ 放课后（leisure，p5-leisure-batting）**；
之后回头做 IM / 手记 / COOP / 殿堂的逐像素第二轮。
