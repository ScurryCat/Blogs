# 手机应用图标映射表（P0 · 素材与视觉基线）

> 对应《P5 怪盗手机 · 第二轮 UI 开发任务书》§2.3 / §5。本表是**开发文档**，不进入访客界面。
>
> 维护责任：P0 素材负责人。P2 补 IM 参考后交 P0 合并。
> **第三轮（2026-10-17）N6 补充**：应用图标映射与「无明智吾郎」素材清理已更新（见 §2、
> §3、§5、§6）；三份素材清单见 `persona-assets-allowlist.md` / `persona-assets-excluded.md` /
> `persona-assets-removed.md`，外部精选库方案见 `persona-curated-plan.md`。
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
| `ins` | 动态 | 图文动态主入口 | 原版消息标识（IM） | **已接入**：`apps/web/public/assets/legacy/img/app/original/ins-original.png`（清理版 512×512） | P5R / PS4 / CN-JP | IM 界面参考 + 清理版来源见 `original-app-icons.md` §2.2 | 裁内容→居中 512×512 黑底方图（非 AI 重绘） | `/assets/legacy/img/app/original/ins-original.png`（桌面默认渲染） | **原版（清理版）** | **未核实** |
| `im`（ins 内） | 消息 | 站内消息入口 | 原版消息标识（与 INS 区分含义） | 共用 `original/ins-original.png` | P5R / PS4 | 见 `original-app-icons.md` §2.2 | 同上 | `/assets/legacy/img/app/original/ins-original.png` | **原版（清理版）** | 未核实 |
| `journal` | 手记 | 日记/日历 | 原作日历界面 | `persona5-spriters/p5/hud/92120-calendar-jpn.png`（**未提取**，3592×4103） | P5 / PS3 / JPN | [Spriters Resource 92120](https://www.spriters-resource.com/playstation_3/persona5/asset/92120/) | 待提取 | 待定 | 组合/适配 | 未核实 |
| `leisure` | 放课后 | 追番与游戏 | 无直接对应原版 App | 视觉参考：`p5/hud/92711-minigames-jpn.png`、`92712-shops.png`（**未提取**） | P5 / PS3 | [92171](https://www.spriters-resource.com/playstation_3/persona5/asset/92711/)、[92712](https://www.spriters-resource.com/playstation_3/persona5/asset/92712/) | 借用书籍/游戏选择界面构图 | 待定 | **适配设计** | 未核实 |
| `coop` | 协助者 | 友链通讯录 | 旧站既有「两人并肩」配对图标（非游戏内独立素材） | 站内 `apps/web/public/assets/legacy/img/app/coop.png`（旧站迁移，128×128） | 未核实（旧站图标） | 旧站 `assets/img/app/`（T02 迁入） | **已替换**：原 `icon/crow.webp`（角色 Crow/明智吾郎头像，已移除）→ 现用 `app/coop.png`；画面实看为两人形线图标，无角色/文字 | `apps/web/public/assets/legacy/img/app/coop.png`（manifest 回退值；桌面 raster 也用它） | **适配**（旧站既有） | **未核实** |
| `mementos` | 印象空间 | 问题记录（异世界导航内层） | 旧站既有导航星形图标（非游戏内独立素材） | 站内 `apps/web/public/assets/legacy/img/icon/mementos.webp`（由 `app/metanav.png` 转格式） | 未核实（原图 P5R 图标） | 旧站 `assets/img/app/metanav.png`（T02 迁入） | **N6 适配**：PNG 128×128 RGBA → 无损 WebP，非 AI 重绘；原图哈希 `ca581583…`，产物 `d0de74b6…` | `/assets/legacy/img/icon/mementos.webp` | **适配** | **未核实** |
| `metanav` | 异世界导航 | 关键词导航 | **经典红眼图标（红眼、星形瞳孔、黑色外刺）** | **已接入**：`apps/web/public/assets/legacy/img/app/original/metanav-original.png`（清理版 512×512；原版画面证据=P5 动画截图） | P5（非 P5R/P5X 变体） | 来源与证据见 `original-app-icons.md` §2.1 | 1024×1024 → 512×512 PNG（非 AI 重绘） | `/assets/legacy/img/app/original/metanav-original.png`（桌面默认渲染） | **原版（清理版）** | 未核实 |
| `showcase` | 我的殿堂 | 作品与相册 | 无直接对应原版 App | 视觉参考：`p5r/hud/132783-photos-im.png`（IM 照片集，3846×2053） | P5R / PS4 | [Spriters Resource 132783](https://www.spriters-resource.com/playstation_4/persona5royal/asset/132783/) | 展览/收藏语汇，**适配** | 待定 | 适配设计 | 未核实 |
| `palace` | 情报 | 专题索引 | 无直接对应原版 App | 待选参考 | — | — | 卷宗语汇，适配 | 待定 | 适配设计 | 未核实 |
| `tokyo` | 地图 | 东京地图 | 原作地图 | `persona5-spriters/p5/miscellaneous/92510-maps.zip`（**已解包** `rmap_*.png`） | P5 / PS3 | [Spriters Resource 92510](https://www.spriters-resource.com/playstation_3/persona5/asset/92510/) | 地图针为适配符号 | 待定 | 组合/适配 | 未核实 |
| `cast` | 天气 | 天气预报 | 原作天气预报界面 | `persona-dist/projects/Persona5-Weather-Forecast/dist/images/`（**fan 复刻**，sprites 齐全） | fan 复刻（非游戏内） | 本地 | 借用 weather-card/数值 sprites | 待定 | **适配设计** | 未核实 |
| `profile` | 档案 | 个人档案 | 无直接对应原版 App | 待选参考 | — | — | 证件/档案语汇，适配 | 待定 | 适配设计 | 未核实 |

### 2.1 原版图标接入（验收 F2 返工 · 2026-10-17）

`metanav`（经典红眼）与 `ins/im`（原版消息标识）已接入桌面**实际渲染分支**：
`features/phone/app-original-icons.ts` 映射 → `phone-desktop.tsx` 优先渲染
`<img data-app-icon="original">`；其余 10 个站点自适配 App 使用**站主授权的 AI 同风格图标**（`data-app-icon="ai-adapted"`，见 `ai-app-icons.md`），
旧 AI 位图不再作为桌面默认回退；
逐项标记不冒充原版。来源、版本、画面核对、哈希、裁切与「原版/适配」分界见
`docs/design-references/original-app-icons.md`。

共享元件（不属于某个应用，但给全部界面用）：

> ⚠️ **第三轮素材安全提示（2026-10-17，N6）**：下表三张都是**合图**，含全体协助者 / IM 头像 /
> 元件，**没有逐元素确认身份**；其中 92141 头像表与 132782 IM 元件表**可能含明智吾郎头像**，
> 按任务书 §5.2「不确定的不进允许清单」处理：**整份不进入活动素材库允许清单**，
> 已提取的 `.dsh/p0-analysis/` 裁片同样未审核、不接入网站。核对完成后才能回填身份并入库。

| 元件 | 原图路径 | 版本 | 提取状态 |
| --- | --- | --- | --- |
| **手柄按钮字形**（L1/L2/R1/R2/L3/R3/OPTIONS/十字键/□○×△） | `persona5-spriters/p5r/hud/134224-buttons-icons.png` | P5R / PS4 | ✅ 19 个已提取并**逐个识别**（见 §4.5）；**不是**「返回/确认/筛选」UI 图标（早期猜测已更正） |
| IM 黑白头像 | `persona5-spriters/p5/hud/92141-profile-pictures.png` | P5 / PS3 | ✅ 50 个已提取（`p5-profile-pics-report.json`）；**已核对并接入 2 个（Futaba / Morgana，见 §4.4）**；其余 48 个仍未逐元素核对，**不进允许清单** |
| IM 聊天元件 | `persona5-spriters/p5r/hud/132782-im-assets-cn-jp.png` | P5R / PS4 | ✅ 82 个已提取；**合图含头像元件，未逐元素确认 → 不进允许清单** |

## 3. 参考帧清单（IM 为主）与缺口

| 参考 | 位置 | 状态 |
| --- | --- | --- |
| 图片消息完整帧 | `persona-dist/media/image/P5R/p5r-sns--4aa5330b1fe6.jpg` | ✅ 有（目录标 P5R；**原始发布 URL 未核实**） |
| 存档 / 读取 HUD 元件表（N2 参考） | `persona5-spriters/p5/hud/92140-save-load.png`（SHA-256 `07472377…`；N6 实测无明智） | ✅ 有（**只是元件表**：No.1–16、PLAY TIME、Lv、难度、SHOP 等；不能单独证明整屏布局已还原） |
| **完整「游戏存档」整屏参考帧** | — | ✗ **仍缺**（N2 若需要只能按元件表自行布局；视觉还原不得标为「已通过」） |
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

### 4.2 程序化属性分析（不依赖视觉，已入库 `tools/p0-analyze-sprites.py`）

对每个 sprite 统计**饱和度 / 亮度 / 长宽比 / 不透明占比 / 与 P5 红的色距**，结果在
`.dsh/p0-analysis/analysis-<前缀>.json`。这不是「认图」，而是把候选集缩小：

| 表 | sprite | 近黑白（sat<0.12） | 近正方 | 说明 |
| --- | --- | --- | --- | --- |
| P5 头像表 | 50 | **43** | 20 | 证实这批是**原版黑白美术**，不是彩色图 |
| P5R IM 元件 | 82 | 76 | 33 | IM 元件本就是黑白系 |
| P5 协助者（阿卡那） | 124 | 123 | 23 | 线稿为主 |
| P5 日历 | 147 | 130 | 39 | |
| P5 迷你游戏 | 102 | 82 | 29 | 4 个红色主导 |
| P5 商店 | 39 | 37 | 9 | |
| P5R 按钮 | 19 | 15 | 9 | |

**头像候选集已收窄到 12 个**（近黑白 ∩ 近正方 ∩ 非满幅，且边长 91–124px）：
序号 **3, 4, 5, 12, 19, 20, 24, 25, 27, 31, 35, 36**。
另有 8 个同条件但只有 18–49px 的小元件（序号 6,7,8,11,46,47,48,49），是符号而非头像。
→ 核对工作量从「50 个里认」变成「**12 个对应 12 位角色**」，仍**不得猜测**，核对后回填。

### 4.3 身份核对流程（缺口 + 现成入口）

提取只证明「有这些元件与坐标」，**每个 sprite 是哪个图标尚未核对**。本轮执行模型无图像输入，
因此生成了**带序号的对照图**降低复核成本：

1. 打开 `.dsh/p0-analysis/contact-<前缀>.png`（每格左上角的数字 = 报告 JSON 的 `index`）；
2. 对照原版界面确认「这个序号是什么」；
3. 回填本文件第 2 节表格的「处理方式」列，并注明游戏版本与语言；
4. **未回填身份的 sprite 不得接入前端**。

> 对照图与切图是本地分析产物（`.dsh/`，不入库），脚本入库保证可复现。

## 5. 现状与结论

1. **现网图标**：手机桌面实际使用 `features/phone/phone-desktop.tsx` 的
   `ICON_STYLE = "raster"` → `/assets/legacy/img/app/<id>.png`（第二轮 AI 生成的功能线图标，
   已审核入库）；`manifest.icon` 仅作回退值。自绘 SVG 版（`features/phone/app-icons.tsx`）保留可切换。
2. 原版素材路径与版本已按上表分开记录；**异世界导航红眼图标是当前最大缺口**。
3. 所有游戏素材许可**未核实**，沿用 `docs/operations/limitations.md` 的登记口径，接入前不回填「已核实」。
4. **第三轮变更（2026-10-17）**：COOP / 印象空间原先引用的 `crow.webp`（明智吾郎头像）已移除，
   分别改为 `app/coop.png` 与 `icon/mementos.webp`；文章封面 `cover/platinum.jpg` 的明智立绘已原位
   替换为天鹅绒房间空景；无引用的 `band-halftone.jpg`（Joker+黑面具明智）已移除。公开目录现状与
   复验方式见 §6 与三份素材清单。

## 6. 素材安全：不含明智吾郎（第三轮 §5，N6）

- **已移除/替换**（原字节归档于 `.dsh/archived-assets/`，见移除清单）：
  `icon/crow.webp`、`band-halftone.jpg`；`cover/platinum.jpg`（原位替换）。
- **公开目录复核结论**：`apps/web/public/assets/**` 与构建输入仓库根 `assets/**` 均无明智；
  逐文件哈希与画面复核记录见 `persona-assets-allowlist.md` 与 `persona-assets-manifest.csv`。
- **人群过场保护**：`crowd/**` 12 张 original 精灵哈希与 `provenance.json` 12/12 一致，
  禁止按 `crow` 子串批量删除；迁移工具只排除点名文件（`migrate.mjs` 的 `EXCLUDED_IMG`）。
- **合图/未审核资源**：见共享元件提示、`persona-assets-excluded.md` §3（含明智的合图整份不进
  允许清单）、§4（未逐帧核完的视频一律「未审核」）。
- **复验命令**：`python3 tools/acceptance/verify-no-akechi-assets.py`（期望退出码 0）。

### 4.4 IM 黑白头像：已核对并接入（第二轮 §4.2，2026-10-17）

任务书 §4.2 要求「角色列表使用原版黑白头像，替换目前对彩色立绘施加灰度滤镜的方式」。
本轮（有图像能力的环境）完成两个角色的识别、处理与接入：

| 应用/角色 | 角色 ID | 原图（sprite 表序号） | 库内 bbox（x,y,w,h） | 游戏版本 | 来源 | 前端路径 | 状态 | 许可 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| IM · 双叶 | `futaba` | `92141-profile-pictures` #13 | `148,9,87,117` | P5 / PS3 | [Spriters Resource 92141](https://www.spriters-resource.com/playstation_3/persona5/asset/92141/) | `/assets/legacy/img/avatar/futaba.png` | **原版**（透明画布补正方形） | 未核实（本地参考，仅个人站装饰） |
| IM · 摩尔加纳 | `morgana` | `92141-profile-pictures` #20 | `273,275,91,93` | P5 / PS3 | 同上 | `/assets/legacy/img/avatar/mona.png` | **原版**（透明画布补正方形） | 未核实 |

**识别依据（不是「看起来像」的猜测）**

1. **这批 sprite 就是游戏内 IM/SNS 头像**：本地参考帧
   `persona-dist/media/image/P5R/p5r-sns--4aa5330b1fe6.jpg`（P5R SNS 界面截图）里，聊天参与者的
   头像与 sprite 表的 `#35`（龙司，咧嘴笑）逐像素同源；同一套头像同时出现在 P5R IM 元件表
   `132782-im-assets-cn-jp`（`#10/#11` = 戴圆眼镜 + 耳机的双叶，`#17` = 猫头）。
2. **双叶**：圆框大眼镜 + 头戴式耳机 + 长发，是双叶唯一的标志性组合（P5 日常造型）；
   P5 表 #13 与 P5R IM 元件表 #10/#11 为同一头像。
3. **摩尔加纳**：全部联系人头像中只有 `#20` 是猫头（尖耳 + 咧嘴獠牙）；摩尔加纳是 IM 里唯一的
   非人类角色，且猫头同时出现在 P5R IM 元件表（#17）。**旁证**：本地参考库的 P5X SNS 图标
   （`persona-dist/media/image/P5X/snsicon02/57`）里摩尔加纳的 SNS 头像同样是
   「黑色猫头 + 尖耳 + 咧嘴獠牙」这一母题（P5X 仅作旁证，不作为站点素材）。
   两个角色的头像都满足「排除明智」的许可核对。
4. **排除核对**：第三轮 §5.2 排除明智吾郎（Goro Akechi / クロウ / Crow）；本次接入的两个
   sprite 均非明智，`tools/acceptance/verify-no-akechi-assets.py` 仍为 PASS。
   **其余 48 个 sprite（含可能含明智的合图元素）保持「未审核、不接入」**。

**处理方式（可复现）**

```text
源：.dsh/p0-analysis/p5-profile-pics-13-148_9-88x118.png（双叶，87×117）
     .dsh/p0-analysis/p5-profile-pics-20-273_275-92x94.png（摩尔加纳，91×93）
处理：透明画布居中补齐为正方形（双叶 117×117，摩尔加纳 93×93）；
      未缩放、未裁切、未调色、未加滤镜、未 AI 重绘。
落盘：assets/img/avatar/{futaba,mona}.png（迁移源）
      apps/web/public/assets/legacy/img/avatar/{futaba,mona}.png（公开目录）
哈希：futaba `1f0fc13cef36d2bc…`（4,713 B）/ mona `f2e1e1747c2cddc9…`（3,957 B）
      （完整值见 `.dsh/avatar-inspect/avatar-manifest.json`，本地分析产物不入库）
```

**代码变更**

- `apps/api/app/modules/messaging/characters.py`：`PORTRAIT_FUTABA/PORTRAIT_MONA` 指向新路径，
  `avatar_alt` 改为「原版黑白头像」；**API 契约、DB 模型、角色卡字段均未变**。
- `apps/web/features/messaging/messaging.css`：移除 `.msg-avatar img` 的
  `filter: grayscale(1) contrast(1.45) brightness(1.02)`（临时手段，按清单要求删除）。
- `apps/web/features/messaging/conversation-screen.tsx`：缺省头像回退路径同步到新目录。
- 测试：`features/messaging/avatar-assets.test.ts`（文件存在 / 正方形 PNG / 体积、角色卡路径）、
  `features/messaging/messaging-css.test.ts`（头像规则不得再有滤镜）、
  `apps/api/tests/messaging/test_stories.py`（头像路径前缀 + 不得回退彩色立绘）。

**仍未完成（不得标记为已还原）**

- 其余角色（若将来新增）仍无核对过的头像；目前 IM 只有这两个角色，所以当前 UI 已全部替换。
- 原版**黑白头像**已接入，但 IM 的**整屏布局还原**仍缺普通文字消息 / 回复选择的完整参考帧
  （见 `reference-frame-gaps.md` G1/G2），不能据此宣称 IM 视觉还原通过。
- 许可状态仍为「未核实」；若站点要公开分发这些素材，需要另行确认授权。

### 4.5 P5R 手柄按钮字形表（19 个，已逐个识别，2026-10-17）

原图：`persona5-spriters/p5r/hud/134224-buttons-icons.png`（461×150，P5R / PS4）。
提取：`tools/p0-extract-sheets.py` → `.dsh/p0-analysis/p5r-buttons-*.png`（bbox 见
`p5r-buttons-report.json`），对照图 `contact-p5r-buttons.png`。
**这一张不是「返回/确认/筛选」UI 图标，而是 PlayStation 手柄按键字形**（早期映射表的猜测错误，此处更正）。

| # | 含义 | 尺寸 | 备注 |
| --- | --- | --- | --- |
| 0 | L1 | 62×39 | 肩键 |
| 1 | L2 | 62×39 | 扳机 |
| 2 | R2 | 62×39 | 扳机 |
| 3 | R1 | 61×38 | 肩键 |
| 4 | R3 | 62×45 | 右摇杆按下（带向下箭头） |
| 5 | L（左摇杆） | 59×42 | 摇杆图形 + L |
| 6 | L3 | 62×45 | 左摇杆按下（带向下箭头） |
| 7 | R（右摇杆） | 58×43 | 摇杆图形 + R |
| 8 | 触摸板按下 | 57×40 | PS4 触摸板 + 向下箭头 |
| 9 | OPTIONS | 54×44 | OPTIONS 文字按钮 |
| 10–14 | 十字键（5 个方向/状态变体） | 48×45 | 10–13 带方向箭头（左/右/上/下），14 为无箭头中性态；按 bbox 顺序排列，箭头朝向以原图为准 |
| 15 | □（方块） | 41×41 | 粉/品红 |
| 16 | ○（圆圈） | 41×41 | 红 |
| 17 | ×（叉） | 41×41 | 蓝 |
| 18 | △（三角） | 41×41 | 青 |

**用途判断**：这些是手柄提示字形，适合「按键提示」（如「○ 决定 / × 返回」），
不适合当作网站 UI 的功能图标（返回、确认、筛选应使用网站自己的符号或从其他元件表取）。
**许可**：未核实；本地参考用途。是否接入由视觉决策决定，本表只负责身份可追溯。
