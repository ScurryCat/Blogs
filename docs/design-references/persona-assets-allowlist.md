# 活动素材库 · 允许清单（不含明智吾郎）

> 第三轮 P5 内容架构 v3 · 任务书 §5 / §8.3 · **N6 素材负责人**
> 仓库：`/Users/学习/blog/Blogs`（基线 `e70ad1f` + 第二轮未提交修改，均保留）
> 复核日期：2026-10-17 · 复核方式：**实际读图**（Image 工具逐张 / contact sheet 拼图），并配合
> SHA-256、目录引用 grep、构建产物与 HTTP 实际下载检查；**不是按文件名推断**。
> 配套文件：排除审计清单 `persona-assets-excluded.md` · 移除/恢复清单
> `persona-assets-removed.md` · 外部精选库方案 `persona-curated-plan.md` ·
> 逐文件哈希表 `persona-assets-manifest.csv` · 复验脚本
> `tools/acceptance/verify-no-akechi-assets.py`。

## 0. 结论摘要

- 网站**公开目录**（`apps/web/public/assets/**`）在本次处理后**不含明智吾郎（Goro Akechi /
  明智吾郎 / あけち / 黑面具）素材**；构建输入（仓库根 `assets/**`）同样已清理。
- 全量公开目录实测：`legacy/**` 171 个文件 + N5 过场短版媒体 1 个（`clip/isekai-showcase.webm`）；
  逐文件哈希见 `persona-assets-manifest.csv`。
- 已移除 / 替换 3 处含明智的图片（详见移除清单）：`icon/crow.webp`、
  `cover/platinum.jpg`（原位替换为安全适配封面）、`band-halftone.jpg`。
- `crowd/**` 人群过场**完整保留**：12 张 original 精灵哈希与
  `crowd/original/provenance.json` 逐一比对 **12/12 一致**；禁止按 `crow` 子串批量删除。
- 外部精选库 `persona-curated/` **已落地**（2026-10-17 12:48 一次性授权建立，9 个已复核资源），
  统一入口已于 2026-10-17 23:35 迁移为「默认只进精选库、旧库按需手动打开」，
  见 `persona-curated-plan.md` §5/§6 与 `../../assets/reference/README.md`。旧参考库保持离线只读、未移动未删除。
- **验收 F2 返工（2026-10-17）**：桌面默认图标改为已审核原版
  `app/original/metanav-original.png`（经典红眼）与 `app/original/ins-original.png`（原版消息标识）；
  其余 App 仍为适配设计。来源/哈希/画面核对见 `original-app-icons.md`，清单见
  `persona-assets-manifest.csv` 的 `app-icon-original` 两行。

## 1. 网站公开目录总览

`apps/web/public/assets/legacy/**`（T02 从旧站 `assets/**` 逐字节迁移；`app/**` 为第二轮新增）：

| 类别 | 数量 | 公开路径前缀 | 复核结论 |
| --- | --- | --- | --- |
| 角色头像图标 | 9 | `/assets/legacy/img/icon/*.webp` | 各为对应 PT 角色（Joker/Fox/Morgana/Noir/Oracle/Panther/Queen/Skull/Violet），无明智 |
| 适配图标 | 1 | `/assets/legacy/img/icon/mementos.webp` | 由 `app/metanav.png` 转格式；红黑星形导航符号，无角色/文字 |
| 手机 app 图标 | 12 | `/assets/legacy/img/app/*.png` | 第二轮 AI 生成的 10 张功能线图标 + 第二轮 P4 补的 2 张格式转换图标（`velvet.png` / `mementos.png`，见 §2.4）；逐张实看，无角色/文字 |
| 角色立绘 | 10 | `/assets/legacy/img/portrait/*.png` | PT 成员 / Joker（其中 `joker.png` 实为 Arsène、`morgana-thief.webp` 实为芳泽霞，见 §2.3 命名问题） |
| 文章封面 | 9 | `/assets/legacy/img/cover/*.jpg` | 8 张为 PT 角色插画；`platinum.jpg` 已替换为天鹅绒房间空景（见 §2.1） |
| 美术 / 背景 / UI | 9 | `hero-joker.webp`、`joker-aoa.png`、`joker-thief.webp`、`morgana-thief.webp`、`logo-p5r.webp`、`bg-leblanc.jpg`、`bg-velvet.jpg`、`phone/frame.webp`、`ui/dialog.png` | 均无明智 |
| 人群过场 | 24 | `/assets/legacy/img/crowd/**`（12 合成帧 + 12 原始精灵 + `provenance.json`） | 白/灰路人剪影；哈希校验 12/12 |
| 地图 | 76 | `/assets/legacy/img/map/**`（25 图像 + 1 底图 + 50 SVG 标签） | 黑白地点图形 / 文字标签；SVG 已 grep 无内嵌图片、无明智别名 |
| 天气 | 13 | `/assets/legacy/img/weather/*` | fan 复刻精灵，无角色 |
| 光标 / 字体 / 音效 | 2 + 6 + 1 | `cursor/*`、`fonts/*`、`sfx/select.mp3` | 非角色素材；字体许可文件随附 |

> 说明：`crowd/original/provenance.json` 是**元数据**（T02 的 crowd 来源与哈希记录），不单独列为素材；
> 因此「允许清单 CSV 171 行 = 170 个公开 legacy 素材（171 个公开 legacy 文件减去 `provenance.json`
> 元数据）+ 1 个过场短版媒体（N5 `clip/isekai-showcase.webm`）」，逐文件哈希见
> `persona-assets-manifest.csv`。

## 2. 本次替换 / 适配的关键资产（逐项记录）

### 2.1 `cover/platinum.jpg`（原为明智立绘，已原位替换）

| 项 | 值 |
| --- | --- |
| 用途 | 文章 `p5r-platinum` 封面（旧站 `assets/js/posts.js` → `features/legacy/data/posts.json` 的 `cover` 字段；路径未改） |
| 公开路径 | `/assets/legacy/img/cover/platinum.jpg` |
| 原文件哈希（已排除，归档） | `085e6df989e982f1c92f83ab6606c10fb4b2f2d229fb11eb0b3011c9a8bad2d6` |
| 排除原因 | 画面为**明智吾郎** P5R 官方插画（风衣+手套+手帐，赌场背景）；画面主体即角色，无法裁出不含他的有效部分 |
| 替换来源 | 本站**既有** `assets/img/bg-velvet.jpg`（Atlus 免费配布虚拟背景，`4a7bda4b6bb36cc1ae320c10f2ec2d883aa5abdb4c8a965ed644ce774b32a836`） |
| 处理方式 | `magick bg-velvet.jpg -resize '640x896^' -gravity center -extent 640x896 -quality 88`（裁切 + 缩放 + JPEG 重编码，**非 AI 重绘**） |
| 新文件哈希 / 大小 | `394c37ce82717c45f83bd78d09ecad288fb506e42ac2eb0ab19d7fed7d69d142` / 95,580 B |
| 画面复核 | 实看：天鹅绒房间空景（蓝地毯/书桌/椅子），无任何角色；与文章主题「从天鹅绒房间到无限迷宫」语义相符，不破图（浏览器截图证据见 `docs/agent-deliveries/N6-result.md` 第 6 节） |
| 许可状态 | 未核实（ATLUS 免费配布「个人非商业装饰」口径，沿用旧站素材版权说明；不宣称已获授权） |
| 恢复方式 | 原字节在 `.dsh/archived-assets/assets/img/cover/platinum.jpg`；见移除清单 §3 |

### 2.2 应用图标替换（crow → 无角色图标）

| 应用 | 旧值（已移除） | 新值 | 处理 | 复核 |
| --- | --- | --- | --- | --- |
| COOP 协助者（`features/coop/phone-manifest.tsx`） | `/assets/legacy/img/icon/crow.webp`（明智头像） | `/assets/legacy/img/app/coop.png`（旧站既有「两人并肩」配对图标，`7422fb937fea92b6698767af3a982b18b3ccab4798e176311d2d27fa4e0290de`） | 不新增素材，直接引用已迁入的 app 图标 | 画面：两个并肩人形线图标，无角色/文字，语义「协助者/友链」 |
| 印象空间（`features/exploration/phone-manifest.ts`） | `/assets/legacy/img/icon/crow.webp` | `/assets/legacy/img/icon/mementos.webp`（哈希 `d0de74b64abec29f19f799eae4001f569503b51f6fc0549ca3d9dbdca0c6cdd6`） | 由旧站既有 `app/metanav.png`（`ca581583242ed2b4190fbd4cad3186463c73c51bf9eea9ea0e1911111cf55104`）PNG→无损 WebP 格式转换，**非 AI 重绘** | 画面：红黑星形导航符号，无角色/文字 |

> 手机桌面实际图标样式为 `ICON_STYLE="raster"`（`app/<id>.png`）；角色头像文件仅作 manifest
> 回退值与数据记录。两处引用替换后，浏览器不再请求 `icon/crow.webp`（见 N6-result 第 7 节下载证据）。

### 2.4 手机桌面新增应用图标（2026-10-17，第二轮 P4 登记补齐）

登记「天鹅绒房间 / 印象空间」到手机桌面后，桌面 `ICON_STYLE="raster"` 会请求
`app/<id>.png`；两个新应用没有位图会 404（裂图）。补两张**格式转换**（非 AI 重绘）：
源文件都是本清单已允许的迁移素材，只做 WebP→PNG 无损容器转换，尺寸不变。

| 公开路径 | 源文件 | 处理 | SHA-256（前 16 位） |
| --- | --- | --- | --- |
| `app/velvet.png`（160×160 RGBA） | `icon/queen.webp`（Queen 角色头像图标） | WebP→PNG，Pillow 无损重编码，**非 AI 重绘** | `e0f5ad6f4a7bed58…` |
| `app/mementos.png`（128×128 RGBA） | `icon/mementos.webp`（红黑星形导航符号） | WebP→PNG，Pillow 无损重编码，**非 AI 重绘** | `4cf676ebeabcbe53…` |

> 用途仅限桌面 34×34 应用图标；`features/phone/registry.test.ts` 新增回归断言：
> 每个登记应用必须有 `app/<id>.png` 或自绘 SVG，避免下次登记再出现裂图。

### 2.3 命名与画面不一致的已知记录（不影响清理结论，未改名）

| 公开路径 | 实际画面 | 处理 |
| --- | --- | --- |
| `portrait/joker.png` | **Arsène**（Joker 的 Persona），非 Joker 本人 | 站内无引用；仅记录，不改名以免无谓 churn |
| `morgana-thief.webp` | **芳泽霞（Violet）** 盗贼服立绘 | 站内无引用；仅记录 |
| `icon/mementos.webp` | 名称是新增适配名（非旧站文件名） | 已在 icon-mapping 登记 |

## 3. 过场短版媒体登记（N5 交付，N6 复验）

| 项 | 值 |
| --- | --- |
| 公开路径 | `/assets/clip/isekai-showcase.webm` |
| 文件哈希 / 大小 | `a716f8e835eb9373639648a72a7fba3529ec99ed8bb623d24cf48b868a91ccb7` / 242,439 B |
| ffprobe | container=webm；codec=vp9；1280×720；30 fps；1.500000 s；45 帧；yuv420p + alpha（WebM BlockAdditional）；**无音频流（静音）** |
| 输入候选 | `persona-dist/ae-projects/7.21更新素材（包含部分对旧素材的重置）/异世界转场.mp4`，1920×1080 h264 60fps 9.050s，SHA-256 `5c3e90283899f65f4a0dd1f7111b6a37f0793d6e7801f3a514d306c3843c82b3`（另一候选 `过场进入异世界--928a1e4d9e3f.mp4` 已复核但未采用为输出源） |
| 处理时间段 | **源 1.25 s – 2.75 s**（`-ss 1.25 -t 1.5`），60fps→30fps，1920×1080→1280×720 |
| 处理方式 | `chromakey=0x14ff0b:0.20:0.06,despill=type=green,fps=30,scale=1280:720,format=yuva420p` → `libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 36 -an`（沿用旧站 core.js 配方；细节见 N5-result） |
| N6 复验（独立） | 45 帧 libvpx 解码 RGBA：不透明像素占比 31.89%，**绿幕残留 0、白色 0**；逐帧拼图（10fps 抽 30 帧）与输入 1.25–2.75s 画面一致；合成到白底目检：纯红/黑墨迹抽象形状，**无角色、无文字、无明智** |
| 许可状态 | 未核实（ATLUS 版权素材的二次处理；仅个人非商业使用，沿用站点口径） |
| 候选离线原件 | 保持离线原样，未移动/未运行关联工程；排除清单中另有 24 个含明智的参考图与未审核视频（见排除清单） |

## 4. 外部参考库：已画面复核、可作「参考」的条目

> 说明：这些是**离线参考**，没有被接入网站；「可作参考」不等于进入公开素材允许清单。

| 参考 | 路径（`/Users/v/Documents/ChatGPT/Blog开发/assets/reference/` 下） | SHA-256 | 画面复核结论 | 用途 |
| --- | --- | --- | --- | --- |
| P5 存档/读取 HUD 元件表 | `persona5-spriters/p5/hud/92140-save-load.png` | `07472377be750924f595acd7f8365b07900254df3a67899099a5521818068717` | 实看：No.1–16 存档编号块、PLAY TIME/Lv/难度/SHOP 等 UI 零件；仅 1 个小剪影，**无明智** | N2 手记存档式列表参考（元件来源，非整屏规范） |
| P5 菜单立绘（Joker） | `persona5-spriters/p5/hud/92142-menu-portraits.png` | `11897673a77e05db9f5f24933aba2c0c499e7b740f1cbbe3f8d9d0df7d7f9856` | 实看：仅 Joker 的剪影姿态，无明智 | 视觉参考 |
| P5R 对话菜单立绘（Joker） | `persona5-spriters/p5r/hud/131675-dialogue-menu-portraits.png` | `ebb6b90072d209164d83c7c13180fa6fdc4f2edb3790de3b9d2824c244feb3b7` | 实看：Joker 头像/表情/眼睛零件，无明智 | 视觉参考 |
| P5 人群过场纹理 | `persona5-spriters/p5/miscellaneous/92512-crowd.zip` | `44f53f91e95b26033e72fcb6e6b96c00146538aaccd46e3fee1613af23339858` | 已在仓库内用作 crowd 过场（12 帧）；路人剪影无角色 | 人群转场（保护，不再动） |
| P5 载入画面 | `persona5-spriters/loading-screen-91920.png` | `04b484adb2d3c3c122b6fea5d0da07d2b788355a1268b326838311284fb91f9f` | 实看：载入画面，无明智 | 视觉参考（未采用） |
| P5 网络界面 | `persona5-spriters/network-jpn-92798.png` | `cd14200e7173b84c5eae0ab518a687175d6179c54cecbc51a96a3d94f94a1270` | 实看：网络/商店界面零件，无明智 | 视觉参考 |
| P5 日历 | `persona5-spriters/calendar-jpn-92120.png` | `759d2a6216028d65b627ab97298739e6fe70df79590907e92fd5debbc061327e` | 实看：日历界面，无明智 | 视觉参考 |

**N2 依赖说明**：完整「游戏存档整屏」参考帧仍缺（`92140` 只是元件表，不能单独证明整屏布局）。
`persona5-spriters` 与 `persona-dist/media/image` 中没有可确认的完整存档界面截图 → N2 若需要，
只能按元件表 + 自行布局，视觉还原不得标为「已通过」。候选参考缺口已如实登记。

## 5. crowd 人群过场完整性证据

- 运行时实际使用：`features/runtime/effects/crowd.ts` 的 `SPRITES` 12 项，全部指向
  `/assets/legacy/img/crowd/original/*.png`；12 张文件均存在。
- 哈希校验：与 `crowd/original/provenance.json` 记录的 SHA-256 **12/12 一致**（本次操作未改动）。
- 合成帧 `crowd/crowd0–11.png`（12 张）同样实看为白/灰路人剪影，未改动。
- 排除规则明确保护 `crowd` 子串：`migrate.mjs` 排除表只含 `icon/crow.webp`、`band-halftone.jpg`，
  **不按 `crow` 子串删除**。

## 6. 重新生成此清单

```bash
# 逐文件哈希表（docs/design-references/persona-assets-manifest.csv 由本次盘点生成；
# 若公开目录变化，请重跑 N6 的盘点命令并更新本清单与 CSV）
find apps/web/public/assets -type f -print0 | xargs -0 shasum -a 256 | sort -k2
# 无明智复验（N7 可直接使用）
python3 tools/acceptance/verify-no-akechi-assets.py
```
