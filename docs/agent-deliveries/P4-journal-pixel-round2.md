# 手记逐像素第二轮（2026-10-19）

> 参考帧：`p5-load-save-fullframe.jpg`（P5 Load 存档界面）、`p5-calendar-fullframe.jpg`（P5 日历）。
> 前置：手记第一轮已完成存档卡/日历的视觉语言；本轮继续按参考帧拉大标题、槽位和日历字号。

## 1. 本轮修改

| 项 | 参考帧 | 修改 |
| --- | --- | --- |
| SAVE DATA 标题 | 参考帧巨型 Load 字样 + 硬阴影 | `clamp(46px, 4.8vw, 64px)`、红深色 6px 硬阴影、整体 skewX(-7deg) + rotate(-1.1deg) |
| 存档槽 | 大号纸白/深红槽位、斜切、黑硬边 | 槽位倾斜 -0.9°/0.8° 交替、左侧红条 8px、硬阴影 7px、编号 22px、日期 38px |
| 选中槽 | 深红主存档条 | 保持深红底/纸白字/8px 黑投影；与参考帧红色主槽一致 |
| 预览面板 | Load 右侧详情 | 加大到 72px 日期、12px 硬阴影、-1deg 倾斜 |
| 日历 | 黑底大字、白/红/青号码 | 月份牌 30px、日期 `clamp(22px, 2.4vw, 32px)`、星期 14px |
| 手机端 | 小屏 | 标题 34px、日期 28px、预览 56px、日历 22px，避免溢出 |

## 2. 证据

- 截图：`.dsh/screenshots/journal-visual-v2/01-save-list.png`、`02-calendar.png`
- 对照：`.dsh/screenshots/visual-comparison/comparison-2.png`（Load / Calendar 两行）
- 测试：journal 8 文件 / **109** 通过
- 全量：`bash tools/verify-all.sh --e2e --mobile` 7/7 段全绿（前端 1123 / 后端 1025 / T02 52/52 / 多视口 11 / 业务流 4/4 / 端到端 12）

## 3. 仍未对齐

1. 参考帧 Load 是整屏游戏画面，槽位为 4 个倾斜大条；本站是 8 条内容列表（数据量不同，不裁内容）；
2. 参考帧的 PLAY TIME / 难度 / 缩略图字段本站无数据，不伪造；
3. 日历参考帧有 Day/Night Job 两栏，本站无对应数据；
4. 整屏逐像素仍不能按参考帧等比计算（游戏画面 1920×1080 vs 站点桌面布局）。
