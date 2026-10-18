# 完整验收返工 · R1（参考帧游戏/用途错标与纠正）

> 对象：`docs/acceptance/2026-10-18-complete-acceptance.md` 的 **R1（P1）**。
> 日期：2026-10-18 ｜ 状态：**错标已纠正、正确帧已补入；G2「IM 回复选择」仍缺（明示缺口）**。

## 1. 报告指出的三处错标（已逐张实看确认）

| 原登记路径 | 实际画面 | 游戏/用途判定 | 原错误用途 |
| --- | --- | --- | --- |
| `hud/p5r-dialogue-choice-fullframe.jpg` | Fox 事件 3 选项（Ask for healing / Pat its head / Don't do anything），黄色 HUD、01/26 THU | **P4/P4G**；来源 URL 本身含 `Persona-402132021` | 被当作 P5R G2 回复选择 |
| `hud/p5r-velvet-room-fullframe.jpg` | 蓝色轿车天鹅绒房间，Igor 与 **Margaret**（银发） | **P4**（P4 系列天鹅绒房间） | 被当作 P5R 牢房/Lavenza/电梯 |
| `hud/p5-tokyo-map-fullframe.jpg` | 8–13 日星期标签叠加城市背景 | **P5 日期推进/城市背景** | 被当作 P5 东京地点选择地图 |

## 2. 已执行的纠正（外部精选库 + 仓库）

### 外部精选库 `persona-curated/`

- 重命名（保留内容与哈希）：
  - `p5r-dialogue-choice-fullframe.jpg` → `p4-dialogue-choice-fullframe.jpg`
  - `p5r-velvet-room-fullframe.jpg` → `p4-velvet-room-fullframe.jpg`
  - `p5-tokyo-map-fullframe.jpg` → `p5-date-progress-city-fullframe.jpg`
- 新增正确帧（均 1920×1080、逐帧实看无明智）：
  - `p5r-velvet-room-fullframe.jpg`：P5R 蓝色天鹅绒牢房 + Lavenza（Game UI Database，`Persona-5-Royal03112021-110116-38024.jpg`）
  - `p5-tokyo-map-fullframe.jpg`：P5R 红底东京地点选择地图（Sketchfab 模型预览图，可追溯非官方）
  - `p5r-im-inbox-fullframe.jpg`：P5R IM 收件列表（Game UI Database，`Persona-5-Royal03112021-110210-20416.jpg`）
  - `p5r-im-conversation-fullframe.jpg`：P5R IM 会话（Wccftech `Persona-5-Royal-IM-Conversation.jpg`）
- 更新 `provenance/sources.json`、`provenance/hashes.json`（`game_version` / `purpose` / `source_page` / `visual_review` 语义字段）、
  `INDEX.md`、`README.md`；保留 `.bak-r1-*` 备份。
- 精选库完整帧现为 **21 张**（旧 17 张中 3 张改为 P4/P5 辅助参考 + 4 张正确 P5R 帧）。

### 仓库

- `tools/acceptance/verify-reference-frames.py`：期望表改为 21 张，逐帧注明游戏/用途（P4/P5 辅助帧与 P5R 主参考区分）；复验 **21/21 通过**。
- `tools/capture-visual-comparison.py`：IM 会话对照改用 `p5r-im-conversation-fullframe`，地图/天鹅绒改用纠正版。
- 文档：`reference-frame-sources.md`、`reference-frame-gaps.md`、`P4-velvet-visual-refinement.md`、
  `P4-visual-comparison-evidence.md`（第 5/10/11 行）、`HANDOFF.md`、`HANDOFF-ADDENDUM`、包横幅同步；
  历史文档 `P4-reference-frames-round3.md`、`acceptance-v2-response.md` 已加「历史状态」标注。

## 3. 受影响设计复核

- **天鹅绒**：此前设计依据被误写成 P4 轿车/Igor/Lavenza；实际页面是蓝黑冷色 + 白色登记板，
  不依赖 P4 具体构图。已把参考改为正确的 P5R 牢房帧，交付记录与 CSS 注释中的错误人物/场景描述已改；
  仍标「部分还原」（3D 牢房场景/角色未复刻）。
- **东京地图**：站点自绘东京地图（红底 + 车站图标 + 右侧档案卡）与正确 P5R 地点选择地图并排后，
  结构语言一致；无需改产品代码，视觉对照已用新参考重采集（`comparison-2.png`）。
- **IM**：站点 IM 设计使用的是 P5R IM 群聊/图片消息帧，未依赖被错标的 P4 选项帧；
  对照表第 5 行已改为「P4 辅助参考 / G2 缺口未关闭」。

## 4. 仍未关闭：G2（P5/P5R IM 回复选择）

已尝试：Steam 官方截图 9 张（无菜单）、PlayStation CDN、Game UI Database 已知 P5R 直链、
Wccftech/GUD 的 P5R IM 图片、Bing/Yandex 图片检索（多语种）——只找到 IM **收件列表**与**会话**
（含 `Reply` 提示），未找到回复选项列表的完整帧。

因此**不拿 P4 帧或应用截图冒充 G2**；G2 在 `reference-frame-gaps.md` 中保持「未关闭」。
如需关闭，需站主提供可追溯的 P5/P5R IM 回复选择截图，或允许从游戏内截取。

## 5. 验证

- `python3 tools/acceptance/verify-reference-frames.py` → **21/21**（含 P4/P5 辅助帧身份/哈希/索引/来源登记）；
- 视觉对照重采集：`.dsh/screenshots/visual-comparison/comparison-2.png`（新东京地图与天鹅绒参考）；
- 完整回归在本轮后续统一跑（R2/R3 已单测与 e2e 验证，见 `P4-acceptance-complete-r2r3.md`）。

## 6. 剩余 R1/验收项

1. G2 正确参考帧仍缺（需外部来源）；
2. 其余 §6 遗留（手机图标定稿、相册 1,200 上限提示、详情 pending 文案、历史状态标注范围、WebKit 断言）；
3. 真机验证仍缺设备。
