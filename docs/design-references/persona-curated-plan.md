# 活动素材库 · 外部精选库（`persona-curated/`）方案与缺口

> 第三轮 P5 内容架构 v3 · 任务书 §5.1 / §5.4 · **N6 素材负责人**
> 复核日期：2026-10-17。
> 结论先行：~~外部新库未落地~~ → **已于 2026-10-17 12:48 由集成负责人一次性授权建立**
>（N6 在 workspace-write 沙箱下未重试写入；最终由 N0 在最终集成阶段以单次审批执行本方案 §4 步骤）。
> 落地记录见 §6；旧库仍离线只读、未移动未删除；网站公开目录 / 构建输入 / 实际下载文件均无明智素材。

## 1. 现状：旧库（离线只读，未移动、未删除）

| 库 | 位置 | 规模 | 本轮处理 |
| --- | --- | --- | --- |
| `persona5-spriters` | `/Users/v/Documents/ChatGPT/Blog开发/assets/reference/persona5-spriters/` | 1,364 文件 / 288 MB | 只读复核；未移动、未删除、未改 |
| `persona-dist` | `/Users/v/Documents/ChatGPT/Blog开发/assets/reference/persona-dist/` | 1,866 文件 / 2.8 GB | 只读复核（含 N5 视频候选抽帧）；未移动、未删除、未改 |
| 原始采集包 | `/Users/学习/Claude/dist/` | 离线来源 | **保持离线原样**，不进入索引/预览/构建 |
| 建议新库 | `/Users/v/Documents/ChatGPT/Blog开发/assets/reference/persona-curated/` | **不存在（未创建）** | 工作区外写入受限，未落地 |

> 任务书 §5.1 要求「旧库转为离线来源后，默认参考入口只展示新库，不继续自动加载旧库的
> 全量缩略图或嵌套预览」。本轮未建立新库，因此**这条迁移尚未完成**；旧库现有
> `README.md` / `index.html` / `catalog.json` 保持原样（没有被改成新库入口）。
> 影响：参考入口仍指向旧库；但**网站公开目录与构建不受影响**（旧库从未被构建读取）。

## 2. 新库目标结构（待一次性建立时执行）

```text
/Users/v/Documents/ChatGPT/Blog开发/assets/reference/persona-curated/
├── README.md                 # 只列「已复核」条目；不含排除项缩略图
├── INDEX.md                  # 允许清单（引用仓库 docs/design-references/persona-assets-allowlist.md）
├── provenance/
│   ├── sources.json          # 每个资源的来源文件/页面、游戏版本、许可状态
│   ├── hashes.json           # 库内路径 → SHA-256、原图哈希、裁切 bbox/视频时间段
│   └── excluded-audit.md     # 纯文字排除审计（不嵌入角色图片）
├── hud/                      # 界面参考帧（存档/读取、日历、IM、地图等）
│   ├── p5-save-load-92140.png
│   ├── p5r-dialogue-portraits-131675.png
│   └── ...
└── media/
    ├── image/                # 已复核无明智的插画/背景（按用途分类）
    └── video/                # 已逐帧复核的过场候选（保持原样，不做「最终版」）
```

**默认参考入口**：新 `README.md` / `INDEX.md` 只列允许清单条目；旧库不删除，但不再作为默认入口
自动加载全量缩略图/嵌套预览（旧库如需保留预览，改为「离线档案：按需手动打开」）。

## 3. 首批进入新库的候选（均已由 N6 实际画面复核，且无明智）

| 候选 | 来源 | 复核结论 | 用途 |
| --- | --- | --- | --- |
| `persona5-spriters/p5/hud/92140-save-load.png`（SHA-256 `07472377…`） | Spriters Resource 92140（P5/PS3） | 存档/读取 HUD 元件表；**无明智** | N2 手记参考 |
| `persona5-spriters/p5/hud/92142-menu-portraits.png`（`11897673…`） | Spriters Resource 92142 | 仅 Joker 剪影；无明智 | 视觉参考 |
| `persona5-spriters/p5r/hud/131675-dialogue-menu-portraits.png`（`ebb6b900…`） | Spriters Resource 131675（P5R） | Joker 表情/眼睛零件；无明智 | 视觉参考 |
| `persona5-spriters/loading-screen-91920.png`（`04b484ad…`） | Spriters Resource 91920 | 载入画面；无明智 | 视觉参考（未采用） |
| `persona5-spriters/network-jpn-92798.png`（`cd14200e…`） | Spriters Resource 92798 | 网络界面；无明智 | 视觉参考 |
| `persona5-spriters/calendar-jpn-92120.png`（`759d2a62…`） | Spriters Resource 92120 | 日历界面；无明智 | 视觉参考 |
| `persona-dist/.../过场进入异世界--928a1e4d9e3f.mp4`（`928a1e4d…`） | persona-dist media/video | 343 帧全片扫描 + 抽帧：纯绿幕墨迹，无角色 | 过场候选（N5 已复核，最终未采用） |
| `persona-dist/ae-projects/.../异世界转场.mp4`（`5c3e9028…`） | persona-dist ae-projects | 543 帧全片扫描 + 抽帧：纯绿幕墨迹，无角色 | N5 短版输入（已产出 `isekai-showcase.webm`） |
| `persona5-spriters/p5/miscellaneous/92512-crowd.zip`（`44f53f91…`） | Spriters Resource 92512 | 路人剪影（仓库已用 12 帧） | 人群转场参考（保护） |

**明确不进入新库**：24 个含明智文件（见排除清单 §2）、含明智的合图（§3）、
未逐帧核完的视频（§4）、书籍 266 文件（§5）、本地未审核提取裁片（§6）。

## 4. 未落地原因与执行方案（需要时由 Lead/用户一次性授权）

- **阻塞点**：目标路径在工作区外；当前 DSH 文件沙箱 `workspace-write`，审批提示被自动拒绝。
  N6 未重试写入（遵循任务书「遇到写入被拒不要重试」）。
- **最小权限**：对 `/Users/v/Documents/ChatGPT/Blog开发/assets/reference/` 目录（或具体新建
  `persona-curated/` 及其 3 个子目录）一次性写入授权；不需要网络权限。
- **执行步骤（授权后约 10 分钟）**：
  1. `mkdir -p persona-curated/{provenance,hud,media/image,media/video}`；
  2. 按 §3 表复制候选（逐字节，记录来源与许可；视频保持原样不重编码）；
  3. 生成 `provenance/hashes.json`（库内路径→SHA-256、原图哈希、裁切/时间段）与
     `provenance/sources.json`（来源 URL/页面、游戏版本、许可状态「未核实」）；
  4. 写 `provenance/excluded-audit.md`（纯文字；引用仓库排除清单的路径与哈希）；
  5. 写 `README.md` / `INDEX.md`（只列允许条目）；
  6. 把旧库 `README.md`/`index.html` 的默认入口改为「离线档案」说明（**不改旧库文件本体，
     只改新库入口**；旧库保持只读）。
- **回退**：新库整个目录删除即可，不影响仓库与旧库；仓库内三份清单仍独立完整。
- **不做**：不把新库并入网站构建、不复制参考书、不移动旧库、不运行采集/AE 工程。

## 5. 与任务书 §5.1 的差异（如实记录）

| 要求 | 本轮状态 | 影响 / 后续 |
| --- | --- | --- |
| 新库 `persona-curated/` 建立、只收录复核资源 | **已完成**（§6，2026-10-17 12:48） | 9 个已复核资源，逐字节复制，哈希 9/9 校验通过 |
| 旧库转离线、默认入口只展示新库 | **已完成**（新库 README 声明旧库为离线档案；旧库本体未改） | 旧库未被构建读取，网站无影响 |
| 网站公开目录/构建/下载无明智 | **已完成**（见允许/排除/移除清单与复验脚本） | 主验收项通过 |
| 资源许可与来源记录 | **已完成**（清单内逐项记录「未核实」口径） | 无 |

## 6. 落地记录（2026-10-17 12:48，集成负责人 N0）

一次性授权执行（脚本存档：`Blogs/.dsh/build-curated-library.py`，可整目录删除回退）：

```text
目标：/Users/v/Documents/ChatGPT/Blog开发/assets/reference/persona-curated/
结构：README.md / INDEX.md / provenance/ / hud/ / media/image/ / media/video/
文件：9 个（37,695,628 字节），逐字节复制、未重编码、未 AI 重绘
校验：provenance/hashes.json 内 9/9 SHA-256 重新计算一致
```

| 库内路径 | 来源 | 画面复核 | 许可 |
| --- | --- | --- | --- |
| `hud/p5-save-load-92140.png` | Spriters Resource #92140 | 存档/读取 HUD 元件表；无明智 | 未核实 |
| `hud/p5-menu-portraits-92142.png` | Spriters Resource #92142 | 仅 Joker 剪影；无明智 | 未核实 |
| `hud/p5r-dialogue-portraits-131675.png` | Spriters Resource #131675 | Joker 表情零件；无明智 | 未核实 |
| `hud/p5-loading-91920.png` | Spriters Resource #91920 | 载入画面；无明智 | 未核实 |
| `hud/p5-network-92798.png` | Spriters Resource #92798 | 网络界面；无明智 | 未核实 |
| `hud/p5-calendar-92120.png` | Spriters Resource #92120 | 日历界面；无明智 | 未核实 |
| `media/image/crowd-92512.zip` | Spriters Resource #92512 | 路人剪影；无明智 | 未核实 |
| `media/video/isekai-enter-928a1e4d9e3f.mp4` | persona-dist media/video | 343 帧全片扫描：纯绿幕墨迹，无角色 | 未核实 |
| `media/video/isekai-transition-original.mp4` | persona-dist ae-projects | 543 帧全片扫描：纯绿幕墨迹，无角色（N5 短版输入） | 未核实 |

`provenance/` 同时复制仓库三份清单（allowlist / excluded-audit / removed / asset-manifest.csv）+
`hashes.json`（库内路径→SHA-256、源文件哈希）+ `sources.json`（来源文件/页面、游戏版本、处理方式、
许可状态）。排除审计为纯文字，不嵌入角色图片。**旧库 `persona5-spriters/`、`persona-dist/` 与原始
采集包未移动、未删除**；新库不进入网站构建、不随仓库公开分发。

> 说明：`persona-curated/` 在仓库工作区外，因此该目录本身不在 Git 中；仓库内可复现的对应物是
> `docs/design-references/persona-assets-*.md|csv` 三份清单 + 本方案 + `.dsh/build-curated-library.py`。
