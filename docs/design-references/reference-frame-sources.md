# 完整参考帧 · 来源与核实记录（2026-10-18）

> 对应验收报告 §5.1 / §7.3「补存档 / IM 等完整参考」，以及 G4「来源未核实」。
> **2026-10-18 R1 纠正**：完整验收报告指出 3 张参考帧游戏/用途标错；本文件已按实际画面重标，并补入正确的 P5R 天鹅绒房间、东京地点选择地图、IM 收件列表/会话帧。
> 精选库位置（工作区外）：`assets/reference/persona-curated/hud/`
> 复验脚本：`python3 tools/acceptance/verify-reference-frames.py`（**22/22** 哈希/尺寸/索引/来源登记）。

## 1. 核实方法

1. **官方交叉核对**：用 Steam 官方商店数据接口取 P5R 官方截图（appdetails `1687950`，9 张），
   对本地/候选帧做 dHash 距离比较；距离 0 = 同帧，可把来源升级为官方商店截图 URL。
2. **PlayStation 官方 CDN**：命中官方图片 CDN 的帧记为官方来源。
3. **Game UI Database**：通过 Wayback 定位 P5/P5R 界面库页面（P5 页 `gameData.php?id=72` 已归档），
   图片直链仍在原站；P5 帧来源记为「Game UI Database 图片直链（可追溯，非官方发布）」。
4. **其它外部直链**：媒体/图站/攻略站图片直链，记为「可追溯图片直链（非官方发布）」。
5. 所有帧均逐帧人眼复核：**无明智吾郎**；许可状态「未核实」（版权归 Atlus，仅本地开发参考）。

## 2. 22 帧来源状态

| 帧 | 游戏 | 来源 | 来源状态 | 核实方式 |
| --- | --- | --- | --- | --- |
| `p4-dialogue-choice-fullframe.jpg` | **P4/P4G** | Game UI Database 图片直链（URL 含 `Persona-4`） | 可追溯（非官方发布） | 来源 URL + 画面复核；**R1 纠正：非 P5R，不用于 G2** |
| `p5r-dialogue-normal-fullframe.jpg` | P5R | PlayStation 官方图片 CDN | **官方** | 与 Steam s04 同帧（dHash=1）交叉核对 |
| `p5r-dialogue-maruki-fullframe.jpg` | P5R | **Steam 官方商店截图 s01** | **官方** | dHash=0 同帧 |
| `p5r-im-groupchat-fullframe.jpg` | P5R | Pinterest 图片直链 | **未核实** | 无官方来源匹配 |
| `p5r-im-photo-fullframe.jpg` | P5R | 本地参考库导入（G4 原帧） | **未核实** | 无 Steam 官方截图匹配（best dHash=24） |
| `p5r-street-hud-fullframe.jpg` | P5R | **Steam 官方商店截图 s07** | **官方** | dHash=0 同帧 |
| `p5-load-save-fullframe.jpg` | P5 | Game UI Database 图片直链 | 可追溯（非官方发布） | Wayback 页面 + 图片直链 |
| `p5-phone-home-fullframe.jpg` | P5 | Game UI Database 图片直链 | 可追溯（非官方发布） | 同上 |
| `p5-calendar-fullframe.jpg` | P5 | Game UI Database 图片直链 | 可追溯（非官方发布） | 同上 |
| `p5-status-fullframe.jpg` | P5 | Game UI Database 图片直链 | 可追溯（非官方发布） | 同上 |
| `p5-map-school-fullframe.jpg` | P5 | Game UI Database 图片直链 | 可追溯（非官方发布） | 同上 |
| `p5-tokyo-map-fullframe.jpg` | **P5R** | Sketchfab 模型预览图（东京地图 UI） | 可追溯（非官方发布） | 来源 URL + 画面复核；**R1 纠正版：地点选择地图** |
| `p5-date-progress-city-fullframe.jpg` | P5 | Game UI Database 图片直链 | 可追溯（非官方发布） | **R1 纠正：日期推进/城市背景，非地点选择** |
| `p5r-velvet-room-fullframe.jpg` | **P5R** | Game UI Database 图片直链 | 可追溯（非官方发布） | 来源 URL + 画面复核；**R1 纠正版：Lavenza 场景** |
| `p4-velvet-room-fullframe.jpg` | **P4** | playground.ru 图片直链 | 可追溯（非官方发布） | **R1 纠正：P4 轿车内景，非 P5R** |
| `p5-mementos-fullframe.jpg` | P5 | blogger 图片直链 | 可追溯（非官方发布） | 来源 URL + 画面复核 |
| `p5r-coop-confidant-fullframe.jpg` | P5R | telegra.ph 图片直链 | 可追溯（非官方发布） | 来源 URL + 画面复核 |
| `p5-palace-treasure-fullframe.jpg` | P5 | YouTube 缩略图直链 | 可追溯（非官方发布） | 来源 URL + 画面复核 |
| `p5-leisure-batting-fullframe.jpg` | P5 | SegmentNext 媒体图片直链 | 可追溯（非官方发布） | 来源 URL + 画面复核 |

新增（R1 补）：`p5r-im-inbox-fullframe.jpg`（P5R IM 收件列表，Game UI Database）、
`p5r-im-conversation-fullframe.jpg`（P5R IM 会话，Wccftech 图片直链）。

**G2 补齐（2026-10-18，站主提供）**：`p5r-im-reply-selection-fullframe.jpg`（2152×1810）
— P5R SNS 红面板 + 黑底白边消息 + 右下白色箭头回复选项（「感觉会被发现」/「加油啊」）。
来源：站主上传的本地截图（未提供公开 URL），逐字节复制、未 AI 重绘；许可「未核实」。

汇总（**22 张完整帧**，其中 3 张为 R1 纠正的 P4/P5 辅助帧、19 张为站点对应参考）：**官方 3 张**（PlayStation CDN 1 + Steam 2）、
可追溯非官方 16 张、未核实 3 张（P5R IM 旧两帧 + G2 站主提供帧）。
**G2「P5/P5R IM 回复选择」已补齐**（站主 2026-10-18 提供）；P4 选项帧仍明确标为非 P5R。

## 3. Steam 官方截图 ↔ 本地帧 dHash 核对

Steam P5R appdetails（`https://store.steampowered.com/api/appdetails?appids=1687950&l=english`）
返回 9 张官方截图；与 `persona-dist/media/image/P5R/screenshot-0*.jpg` 及精选帧比对：
dHash 距离 0（同帧）的有 6 组：s01↔screenshot-01、s03↔screenshot-03、s04↔screenshot-04、
s06↔screenshot-06、s07↔screenshot-07、s08↔screenshot-08。因此其中被精选库采用的
`screenshot-01`（Maruki 对话）与 `screenshot-07`（街景 HUD）已把来源升级为 Steam 官方截图 URL。
P5R IM 帧（`p5r-sns`）与 9 张官方截图均不匹配（最小距离 24），来源保持未核实。

## 4. 仍未核实 / 不宣称

1. **P5R IM 两帧**来源未核实（本地导入 + Pinterest），按 G4 口径保留「未核实」；
2. Game UI Database / 媒体直链属**可追溯但非官方发布**，不等于官方授权素材；
3. 真实设备渲染证据、IM 图片消息协议（B4，需产品拍板）仍不在本文件范围；
4. 所有帧许可「未核实」，仅本地开发参考，不进入网站构建或公开分发。
