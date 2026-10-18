> **历史文档（2026-10-18 早期补帧记录）**：其中 G2「回复选择」帧实际是 P4/P4G 画面、
> 天鹅绒帧实际是 P4 轿车内景、东京地图帧实际是 P5 日期推进——完整验收报告 R1 已纠正。
> 当前正确参考与来源见 `reference-frame-sources.md`（21 张）与 `P4-acceptance-complete-r1.md`。
> 本文件以下原文保留以作历史对照，不要当作当前参考清单。

# 参考帧补齐（验收 v2 §5.1 / §7.3，三批共 17 张）

> 验收报告剩余项：「补存档 / IM 等完整参考和视觉对照证据」。
> 日期：2026-10-18 ｜ 范围：外部精选库 `persona-curated/hud/` 新增 6 张完整帧 +
> 仓库复验脚本 + 缺口规格书更新。**不改产品代码、不重写已通过的来源语义。**

## 1. 结论

| 缺口 | 之前 | 现在 |
| --- | --- | --- |
| **G2 回复选择完整帧** | ❌ 完全没有 | ✅ 有完整 1920×1080 帧（3 选项，P5R） |
| **G1 普通对话完整帧** | ⚠️ 仅 IM 群聊一张 | ✅ 普通对话 ×2（官方 CDN 4K + 本地导入）+ IM 完整屏 ×2 |
| **G4 图片消息完整帧来源** | ⚠️ 本地帧、来源未核实 | ⚠️ 仍保留原帧；另补 IM 群聊帧（Pinterest 来源未核实）。**来源未核实状态未变** |
| **手机 HUD 完整帧**（日期/IM 通知/小地图） | 无 | ✅ 街景 HUD 完整帧 1 张 |
| **存档/读取整屏帧** | 缺 | ✅ 有完整 1920×1080 帧（P5 Load Game 存档槽界面） |
| 手机主屏 / 日历 / 五维状态 / 校内地图 / 东京地图 | 无 | ✅ 各有 1 张 P5 完整帧 |
| **天鹅绒 / 印象空间 / COOP / 殿堂 / 放课后** | 无 | ✅ 各有 1 张整屏帧（第三批） |

新增 12 帧（P5R 6 + P5 6）均在外部精选库 `assets/reference/persona-curated/hud/`，逐帧实看**无明智吾郎**；
来源/哈希/规格/画面复核见 `docs/design-references/reference-frame-gaps.md` §7 与
外部库 `provenance/hashes.json`、`provenance/sources.json`、`INDEX.md`。

## 2. 筛选与核对方法

1. 用可访问的图片检索（Yandex 图片）按缺口关键词收集候选（约 590 个 URL）；
2. 下载 + 缩略图逐批人眼筛选，命中「回复选择 / 普通对话 / IM / HUD / 存档」形态；
3. 用 dHash 与本地参考帧交叉比对，确认重复帧与官方来源：
   - `p5r-dialogue-normal-fullframe.jpg`（PlayStation CDN 4K）↔ 本地 `screenshot-04`：dHash 距离 1；
   - `p5r-im-groupchat-fullframe.jpg` ↔ 本地 `p5r-sns`：同 UI 家族（dHash 9，不同截图）；
4. 记录来源 URL、游戏版本（全部 P5R）、许可「未核实」、画面复核（无明智）；
5. 写入外部精选库后，用仓库脚本复验哈希/尺寸/索引/来源一致性。

## 3. 复验

```bash
python3 tools/acceptance/verify-reference-frames.py
# ✓ 6/6：G2 回复选择、G1 普通对话 ×2、IM 完整屏 ×2、手机 HUD 完整帧
#   每项校验：文件存在 + SHA-256 + 尺寸 + INDEX.md + provenance 双登记
```

- 已加入 `tools/verify-all.sh --fast` 的静态审计段（参考库不存在时 SKIP，便于其它机器）。
- 证据拼图：`.dsh/screenshots/reference-frames/contact-sheet.png`（本地产物，不随包分发）。

## 4. 第二批：P5 完整帧（2026-10-18）

在 Game UI Database 的 P5 归档页（通过 Wayback 找到页面、图片直链仍可访问）中补充 6 张
P5 原版完整帧（全部 1920×1080，逐帧实看无明智吾郎）：

| 帧 | 用途 |
| --- | --- |
| `p5-load-save-fullframe.jpg` | **存档/读取整屏帧**（Load Game 存档槽 No.1–No.5） |
| `p5-phone-home-fullframe.jpg` | 手机主屏（红眼导航 / IM / 地图 / 相机图标网格） |
| `p5-calendar-fullframe.jpg` | 日历界面（手记参考） |
| `p5-status-fullframe.jpg` | 五维状态界面（人物档案参考） |
| `p5-map-school-fullframe.jpg` | 校内楼层地图（地图/殿堂参考） |
| `p5-tokyo-map-fullframe.jpg` | 东京城市地图 + 日期覆盖（东京漫游参考） |

来源 URL 与哈希见 `reference-frame-gaps.md` §7.2；`verify-reference-frames.py` 扩展为 **12/12**。

## 4.1 第三批：界面整屏帧（2026-10-18）

补充 5 张界面整屏帧（逐帧实看无明智吾郎）：

| 帧 | 用途 |
| --- | --- |
| ~~`p5r-velvet-room-fullframe.jpg`~~ | ~~天鹅绒房间（P5R 内景 + Igor/Lavenza）~~（实为 P4 轿车帧，已纠正） |
| `p5-mementos-fullframe.jpg` | 印象空间（Mementos Aiyatsbus Area 1 + HUD） |
| `p5r-coop-confidant-fullframe.jpg` | COOP 协助者（Confidant 升阶 / Arcana / New Ability） |
| `p5-palace-treasure-fullframe.jpg` | 殿堂（宝库内景 + 对话框） |
| `p5-leisure-batting-fullframe.jpg` | 放课后（打击练习场迷你游戏 HUD） |

来源/哈希见 `reference-frame-gaps.md` §7.3；`verify-reference-frames.py` 扩展为 **17/17**。

## 4.2 来源核实（2026-10-18）

- 新增 `docs/design-references/reference-frame-sources.md`：17 帧逐张来源/状态/核实方式。
- 用 Steam 官方商店数据（P5R appdetails `1687950`，9 张）做 dHash 交叉核对：
  **6 组 dHash=0 同帧**；精选库中 `p5r-dialogue-maruki-fullframe` 与
  `p5r-street-hud-fullframe` 的来源已升级为 **Steam 官方截图 URL**；
  `p5r-dialogue-normal-fullframe`（PlayStation 官方 CDN）与 Steam s04 同帧（dHash=1）。
- 汇总：官方 3 张、可追溯非官方 12 张、未核实 2 张（P5R IM 两帧；与 9 张官方截图最小 dHash 24）。

## 5. 仍未关闭（不冒充完成）

1. **真实触控 / 软键盘 / 移动 Safari** 与 **IM 图片消息（B4）** 仍待解决（非参考帧问题）；
2. 回复选择帧为 P5R 英文 UI；P5R IM 两帧来源仍未核实（G4 口径，已在来源记录标注）；
3. 所有帧许可状态「未核实」，仅本地开发参考，不进入网站构建或公开分发。
