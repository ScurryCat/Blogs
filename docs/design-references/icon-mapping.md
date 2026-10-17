# 手机应用图标映射表（P0 · 素材与视觉基线）

> 对应《P5 怪盗手机 · 第二轮 UI 开发任务书》§2.3 / §5。本表是**开发文档**，不进入访客界面。
>
> 维护责任：P0 素材负责人。P2 补 IM 参考后交 P0 合并。
>
> 记录规则：游戏版本（P5/P5R/P5X…）**分别记录**，不用相近名称代替版本核对；
> 组合或补画的标「适配设计」；许可一律按「未核实」处理，不写推测结论。

## 1. 素材参考库位置

- 本地参考库根：`/Users/v/Documents/ChatGPT/Blog开发/assets/reference/`
- 提取产物（裁切坐标与切图）：`/Users/学习/blog/Blogs/.dsh/p0-analysis/`
  - `p5r-buttons-report.json`（19 个按钮/图标）
  - `p5r-im-assets-report.json`（82 个 IM 元件）
  - `p5-profile-pics-report.json`（50 个头像元件）
- **只复制选定资源，源库不变**。裁切坐标以各 `*-report.json` 的 `bbox` 为准。

## 2. 图标映射表

| 应用 ID | 显示名称 | 用途 | 原版对应 | 原图路径（参考库内） | 游戏版本 | 来源页面 | 处理方式 | 前端使用路径（预计） | 原版/适配 | 许可核实 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `ins` | 动态 | 图文动态主入口 | 原版 SNS 消息标识 | `persona5-spriters/p5r/hud/132782-im-assets-cn-jp.png`（已提取 82 个元件） | P5R / PS4 / CN-JP | [Spriters Resource 132782](https://www.spriters-resource.com/playstation_4/persona5royal/asset/132782/) | 候选元件见 `p5r-im-assets-report.json` | `apps/web/public/assets/img/app/ins.png`（待定） | 原版 | **未核实** |
| `im`（ins 内） | 消息 | 站内消息入口 | 原版消息标识（与 INS 区分含义） | 同上表 | P5R / PS4 | 同上 | 同上 | 同上 | 原版 | 未核实 |
| `journal` | 手记 | 日记/日历 | 原作日历界面 | `persona5-spriters/p5/hud/92120-calendar-jpn.png`（**未提取**，3592×4103） | P5 / PS3 / JPN | [Spriters Resource 92120](https://www.spriters-resource.com/playstation_3/persona5/asset/92120/) | 待提取 | 待定 | 组合/适配 | 未核实 |
| `leisure` | 放课后 | 追番与游戏 | 无直接对应原版 App | 视觉参考：`p5/hud/92711-minigames-jpn.png`、`92712-shops.png`（**未提取**） | P5 / PS3 | [92171](https://www.spriters-resource.com/playstation_3/persona5/asset/92711/)、[92712](https://www.spriters-resource.com/playstation_3/persona5/asset/92712/) | 借用书籍/游戏选择界面构图 | 待定 | **适配设计** | 未核实 |
| `coop` | 协助者 | 友链 | 原作协助/阿卡那图标 | `persona5-spriters/p5/hud/92093-confidant-icons.png`（**未提取**，3592×6730） | P5 / PS3 | [Spriters Resource 92093](https://www.spriters-resource.com/playstation_3/persona5/asset/92093/) | 待提取 | 待定 | 原版 | 未核实 |
| `metanav` | 异世界导航 | 关键词导航 | **经典红眼图标（红眼、星形瞳孔、黑色外刺）** | **本地库未确认独立原图 ✗** | 待定位 | [Megaten Wiki](https://megatenwiki.com/wiki/Metaverse_Navigator) | 需继续定位可追溯原图 | 待定 | 原版（**缺素材**） | 未核实 |
| `showcase` | 我的殿堂 | 作品与相册 | 无直接对应原版 App | 视觉参考：`p5r/hud/132783-photos-im.png`（IM 照片集，3846×2053） | P5R / PS4 | [Spriters Resource 132783](https://www.spriters-resource.com/playstation_4/persona5royal/asset/132783/) | 展览/收藏语汇，**适配** | 待定 | 适配设计 | 未核实 |
| `palace` | 情报 | 专题索引 | 无直接对应原版 App | 待选参考 | — | — | 卷宗语汇，适配 | 待定 | 适配设计 | 未核实 |
| `tokyo` | 地图 | 东京地图 | 原作地图 | `persona5-spriters/p5/miscellaneous/92510-maps.zip`（**已解包** `rmap_*.png`） | P5 / PS3 | [Spriters Resource 92510](https://www.spriters-resource.com/playstation_3/persona5/asset/92510/) | 地图针为适配符号 | 待定 | 组合/适配 | 未核实 |
| `cast` | 天气 | 天气预报 | 原作天气预报界面 | `persona-dist/projects/Persona5-Weather-Forecast/dist/images/`（**fan 复刻**，sprites 齐全） | fan 复刻（非游戏内） | 本地 | 借用 weather-card/数值 sprites | 待定 | **适配设计** | 未核实 |
| `profile` | 档案 | 个人档案 | 无直接对应原版 App | 待选参考 | — | — | 证件/档案语汇，适配 | 待定 | 适配设计 | 未核实 |

共享元件（不属于某个应用，但给全部界面用）：

| 元件 | 原图路径 | 版本 | 提取状态 |
| --- | --- | --- | --- |
| 按钮/开关/图标（返回、确认、筛选） | `persona5-spriters/p5r/hud/134224-buttons-icons.png` | P5R / PS4 | ✅ 19 个已提取（`p5r-buttons-report.json`） |
| IM 黑白头像 | `persona5-spriters/p5/hud/92141-profile-pictures.png` | P5 / PS3 | ✅ 50 个已提取（`p5-profile-pics-report.json`） |
| IM 聊天元件 | `persona5-spriters/p5r/hud/132782-im-assets-cn-jp.png` | P5R / PS4 | ✅ 82 个已提取 |

## 3. 参考帧清单（IM 为主）与缺口

| 参考 | 位置 | 状态 |
| --- | --- | --- |
| 图片消息完整帧 | `persona-dist/media/image/P5R/p5r-sns--4aa5330b1fe6.jpg` | ✅ 有（目录标 P5R；**原始发布 URL 未核实**） |
| **普通文字消息完整帧** | — | ✗ **缺**（P0 需补齐；来自视频的记视频链接与时间点） |
| **回复选择完整帧** | — | ✗ **缺** |
| 群聊画面 | — | 仅作视觉参考（本轮**不增加群聊业务**） |
| 元件表 | `132782-im-assets-cn-jp.png` 等 | ✅ 有（**不能单独证明整屏布局已还原**） |
| 经典异世界导航图标 | — | ✗ **缺**（本地库未确认独立原图） |
| P5 官方设定集 | `persona-dist/reference-books/p5-assets 5/official/design-works/`（PDF + 200dpi 页扫） | ✅ 有（视觉语言总参考） |

## 4. 提取说明（可复现）

脚本（提交在仓库里，只读参考库、只写 `.dsh/p0-analysis/`）：

```bash
python3 tools/p0-extract-sheets.py     # 大表连通域提取（scipy.ndimage.label）
python3 tools/p0-contact-sheets.py     # 排成带编号的对照图，供人工/图像模型核对
# 早期三张表用同法提取（脚本内 SHEETS 可加）：
#   p5r-buttons(19) / p5-profile-pics(50) / p5r-im-assets(82)
```

### 4.1 提取结果总表

| 表 | 原图尺寸 | sprite 数 | 对照图 |
| --- | --- | --- | --- |
| P5R 按钮/图标 `134224-buttons-icons` | 461×150 | **19** | `contact-p5r-buttons.png` |
| P5 头像表 `92141-profile-pictures` | 1024×512 | **50** | `contact-p5-profile-pics.png` |
| P5R IM 元件 `132782-im-assets-cn-jp` | 2560×768 | **82** | `contact-p5r-im-assets.png` |
| P5 协助者/阿卡那 `92093-confidant-icons` | 3592×6730 | **124** | `contact-p5-confidant.png` |
| P5 日历 `92120-calendar-jpn` | 3592×4103 | **147** | `contact-p5-calendar.png` |
| P5 迷你游戏 `92711-minigames-jpn` | 1064×3448 | **102** | `contact-p5-minigames.png` |
| P5 商店 `92712-shops` | 532×1576 | **39** | `contact-p5-shops.png` |
| P5R IM 照片集 `132783-photos-im` | 3846×2053 | **1（整张连通）** ✗ | — |

- 合计 **563** 个 sprite，逐个带 `bbox` 坐标（`<前缀>-report.json`）。
- **`132783-photos-im` 无法用连通域切分**：照片是满幅拼贴、彼此相接，整张只连通成 1 块。
  若要按照片切分，需要手工框选或按网格裁切 —— 记录为限制，不假装已切好。

### 4.2 身份核对流程（缺口 + 现成入口）

提取只证明「有这些元件与坐标」，**每个 sprite 是哪个图标尚未核对**。本轮执行模型无图像输入，
因此生成了**带序号的对照图**降低复核成本：

1. 打开 `.dsh/p0-analysis/contact-<前缀>.png`（每格左上角的数字 = 报告 JSON 的 `index`）；
2. 对照原版界面确认「这个序号是什么」；
3. 回填本文件第 2 节表格的「处理方式」列，并注明游戏版本与语言；
4. **未回填身份的 sprite 不得接入前端**。

> 对照图与切图是本地分析产物（`.dsh/`，不入库），脚本入库保证可复现。

## 5. 现状与结论

1. **现网两版图标（AI 位图 + 自绘 SVG）都不作为本轮定稿**（任务书 §2.3），但保留至新图标可用，
   前端切换点：`features/phone/phone-desktop.tsx` 的 `ICON_STYLE` 与 `features/phone/app-icons.tsx`。
2. 原版素材路径与版本已按上表分开记录；**异世界导航红眼图标是当前最大缺口**。
3. 所有游戏素材许可**未核实**，沿用 `docs/operations/limitations.md` 的登记口径，接入前不回填「已核实」。
