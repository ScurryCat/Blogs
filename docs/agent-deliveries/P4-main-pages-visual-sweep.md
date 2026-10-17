# P4 补充交付：主站页面视觉巡检（9 条主路由）+ 勒布朗浅色卡片修复

> 背景：前 10 轮视觉还原集中在**应用界面**（IM/手记/COOP/放课后/殿堂/图库/导航/天鹅绒/印象空间）。
> 本轮对**主站页面**做一次系统巡检（桌面 1440 + 手机 390），确认没有「浅色主题残留 / 水平溢出 /
> JS 错误 / 固定播放器遮挡 / 图片破图」等收尾问题，并修复巡检发现的缺陷。
> 日期：2026-10-17 · 分支 `main` · **未 push / 未部署**

---

## 1. 巡检方法与范围

- 路由：`/`、`/posts`、`/posts/<article>`、`/about`、`/map`、`/guestbook`、`/weather`、
  `/showcase`、`/gallery`、`/velvet`、`/apps/metanav`、`/apps/coop`、`/apps/leisure`（共 13 条，
  桌面/手机两种视口 = 24 组合）。
- 检查项（脚本 `page_health2.py`，结果 24/24 无异常）：
  - `document.scrollWidth - clientWidth`（水平溢出）全部 = 0；
  - `pageerror` 全部为空；
  - 滚到底后 footer 最后一个链接不被固定元素（迷你播放器等）遮挡；
  - 整页截图人工看图（home / about / map / weather / 文章页 / 各类视图）。

## 2. 巡检结论

| 页面 | 结论 |
| --- | --- |
| `/` 首页 | 结构完整：hero（PHANTOM LOG + Joker 立绘）、ticker、CALLING CARD、勒布朗近况、LATEST POSTS、SHOWCASE、ARCHIVE、footer。**发现并修复 1 处缺陷**（见 §3） |
| `/posts` + 文章页 | 列表/正文层级与配图正常，无溢出 |
| `/about` | 人物档案完整（SOCIAL STATS 雷达、CONFIDANTS 卡牌（已用第 3 轮阿卡那卡）、天鹅绒入口、MILESTONES、SEND A CARD 留言） |
| `/map` | P5 东京地图 + 地点信息面板 + 地点索引正常 |
| `/guestbook`、`/weather` | 留言板与天气页完整（天气页为 P5 预报视觉，含 7 日预报） |
| `/showcase`、`/gallery`、`/velvet`、应用页 | 与第 5/6/8 轮交付一致，无回归 |
| 404 | `/leblanc` 无此路由 → 显示 P5 风格「目标已消失」404；站点导航「生活·勒布朗」指向 `/apps/leblanc`（存在），**无死链** |

环境提示（非缺陷）：隔离栈没有音乐文件，迷你播放器与勒布朗「音乐」卡显示
「音频现在取不到」—— 这是 `assets/music` 部署路径问题，交接包 §3.2 已记录。
ARCHIVE 区在种子里只有 2026 年文章，空年份不显示是真实空态。

## 3. 修复的缺陷：勒布朗近况模块整套样式是「浅色主题」

- 位置：`apps/web/features/leblanc/leblanc.module.css`（首页「勒布朗」近况区与 `/apps/leblanc` 共用）。
- 现象：卡片 `rgba(255,255,255,0.72)` 浅灰底 + `#444` 正文 + 黑色系边框 —— 在深色站点上是
  **浅灰卡片 + 灰字**，对比度很低（改前截图 `.dsh/vis2/sweep/home-leblanc.png`）。
- 修复：改成站点一贯语言 —— 黑底卡片 + 2px 纸白边框 + 红色硬阴影、卡片标题＝红底撕纸小牌、
  条目标题用展示字体、红/白按钮、链接行纸白下划线 + 红 hover、降级提示改琥珀色暗底；
  加 `@container` 窄屏收敛。不改任何数据/文案。
- 验证：实测卡片 `background rgb(10,10,11)` / 边框 `rgb(244,241,234)` / 阴影
  `rgb(212,0,0) 5px 5px`；390 无横向溢出；截图见 §4。

## 4. 视觉证据

工作区外（本地，不入库）：`/Users/学习/blog/Blogs/.dsh/vis2/sweep/` 与 `.dsh/screenshots/`

| 文件 | 内容 |
| --- | --- |
| `.dsh/vis2/sweep/{home,about,map,weather,posts,post-article,guestbook,palaces}-full.jpg` | 巡检整页截图（1440） |
| `.dsh/vis2/sweep/home-leblanc.png` | **改前**勒布朗区：浅灰卡片、灰字 |
| `p8-home-leblanc-after.png` | **改后**：黑底白框 + 红硬阴影 + 红票标题 |
| `p8-home-leblanc-390-after.png` | **改后** 390 视口下的同一区块 |

## 5. 验证结果

| 命令 / 检查 | 结果 |
| --- | --- |
| 页面健康检查（13 路由 × 2 视口） | **24/24 无异常**：0 水平溢出、0 JS 错误、footer 不被固定元素遮挡 |
| `cd apps/web && npm run test -- --run` | **90 files / 929 tests passed** |
| `npx vitest run features/leblanc` | 1 file / **7 tests passed** |
| `npm run typecheck` / `npm run lint` / `npm run build` | 0 / 0 / exit 0 |
| 改后实测 | 卡片黑底/纸白边框/红硬阴影；390 无溢出；无 JS 错误 |

## 6. 未完成项

1. **原版素材缺口**：P4 原版应用图标、异世界导航红眼图标（G3）、各界面整屏参考帧（G2 等）——
   本地库确实没有，未伪造（见 `P4-visual-restoration-summary.md` §3）。
2. **B4 IM 图片消息**：待产品决策（提案 `P4-im-image-messages-proposal.md`）。
3. 真机验证（触控/软键盘/移动 Safari）未做。

## 7. 集成说明与回退

- **改动**：只追加 `leblanc.module.css` 的深色修复段落（类名与 DOM 未变）。无数据/API 变更。
- **回退**：删除该段落末尾「深色站点视觉修复」块 → 回到浅灰卡片（不建议）。
- 与 `verify-all.sh --fast` 兼容（静态审计 + 单测 + typecheck/lint 通过）。
