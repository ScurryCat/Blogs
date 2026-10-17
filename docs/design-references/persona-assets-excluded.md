# 活动素材库 · 排除审计清单（仅文字元数据，不嵌入角色图片）

> 第三轮 P5 内容架构 v3 · 任务书 §5.2 / §5.4 · **N6 素材负责人**
> 复核日期：2026-10-17。**本文件只含路径、哈希与文字说明，不包含任何角色图片或缩略图。**
> 排除对象：**明智吾郎（Goro Akechi / 明智吾郎 / あけち / クロウ / Crow / 黑面具 Black Mask）
> 的独立头像、立绘、总攻击、插画、视频等资源**。
> 别名与实际画面均已核对的思路：文件名别名 + 日文/英文/中文别名 + 目录来源记录
> （`persona-dist/INDEX.md`、`manifest.json`、`provenance/**`）+ **实际读图复核**；
> 不只看文件名，也不把「不确定」的东西放进允许清单。
> 配套：允许清单 `persona-assets-allowlist.md` · 移除/恢复清单 `persona-assets-removed.md`。

## 0. 口径

1. **排除 = 不进活动精选库 / 不进网站公开目录 / 不进构建**。原始采集包与旧参考库保持
   离线原样，不删除、不改写（旧库 `persona5-spriters/`、`persona-dist/` 均未移动）。
2. 多人图 / 合图 / 视频 / 书籍：**能可靠分离时才只保留不含明智的部分；不能可靠分离的整份排除**。
   不使用 AI 重绘替代原版提取。
3. 被排除的仓库内文件已**可恢复归档**（见移除清单）；恢复位置不被默认预览 / 构建读取。
4. 本清单中的哈希是「用于验证不得再出现的原文件哈希」，不是可下载索引。

## 1. 仓库内排除（已从公开目录与构建输入移除）

| # | 原路径（仓库根 `assets/` 与产物侧 `apps/web/public/assets/legacy/` 曾各一份） | SHA-256 | 内容复核 | 理由 | 归档位置 |
| --- | --- | --- | --- | --- | --- |
| E1 | `img/icon/crow.webp`（= 公开侧 `img/icon/crow.webp`） | `2c94638757c68b665742067376ce8abeb375b31749311cd7420c400430e9c58e` | 实看：角色 **Crow / 明智吾郎** 独立圆形头像（黑面具/红眼、蓝色描边，160×160） | 明智的独立头像，§5.2 明确排除；曾被 COOP / 印象空间 manifest 引用（已改） | `.dsh/archived-assets/assets/img/icon/crow.webp` |
| E2 | `img/cover/platinum.jpg` | `085e6df989e982f1c92f83ab6606c10fb4b2f2d229fb11eb0b3011c9a8bad2d6` | 实看：**明智吾郎** P5R 官方插画（风衣+黑手套+手帐，赌场背景，640×896） | 画面主体即明智，无法裁出不含他的有效部分 → 整份排除；原位替换为天鹅绒房间空景（新哈希 `394c37ce82717c45f83bd78d09ecad288fb506e42ac2eb0ab19d7fed7d69d142`） | `.dsh/archived-assets/assets/img/cover/platinum.jpg` |
| E3 | `img/band-halftone.jpg` | `f6eade8ed6710a3f6b16317cbda8521b34ca57d1962b81d954c73a49352519db` | 实看：**Joker + 黑面具明智** 双人插画（P5X 改编壁纸，©Perfect World/ATLUS/SEGA，1600×900）；两人叠压，无法可靠分离 | 含明智的双人图且不可分离 → 整份排除；站内 grep **无任何引用**（仍属「未引用但可直接下载的资源」，必须移除） | `.dsh/archived-assets/assets/img/band-halftone.jpg` |

> 说明：E1/E2/E3 的公开侧副本已删除（E2 为原位替换），字节与原文件一致（同哈希），不再单列。
> 备份归档目录 `.dsh/` 被 `.git/info/exclude` 忽略、不参与构建、不被 Next 静态服务读取。

## 2. 外部参考库中的明智吾郎文件（离线保留，不进入允许清单）

路径相对 `/Users/v/Documents/ChatGPT/Blog开发/assets/reference/`；均为**离线参考**，未接入网站。
共 **24 个文件**（含 2 个重复来源的同一哈希），按来源文件名别名
（`akechi` / `goro` / `prince-crow` / `crow-and-robin-hood` / `crow-finishing-touch` /
`gorokasumi`）定位，并按其 `INDEX.md` 标注（立绘/总攻击/插画/转场/截图）归类。

| # | 相对路径 | 字节 | SHA-256 | 类型 |
| --- | --- | --- | --- | --- |
| X1 | `persona-dist/media/image/P5/p5-prince-crow--1bbe6ab90ae7.png` | 2,196,334 | `1bbe6ab90ae775c384f81e62173906ec42d19b1704943fc4b44db4098dc7f9b3` | 明智立绘（Prince/Crow） |
| X2 | `persona-dist/media/image/P5R/akechi-p5r-concept--9dbc8ca06cdd.jpg` | 623,445 | `9dbc8ca06cddad9ca238b28bc9c7381b5691d848a75a5350d3e0e19e9991609a` | P5R 概念设定 |
| X3 | `persona-dist/media/image/P5R/p5r-akechi--2b1ea56a15c4.png` | 9,318,508 | `2b1ea56a15c4e0d500965c8ff3d7dc5a7a43773503626515615067b2add10189` | 立绘/插画 |
| X4 | `persona-dist/media/image/P5R/p5r-conceptart-akechi1--339a36e2b2f4.png` | 900,565 | `339a36e2b2f4de55c70a6847df6d362f3da2054e76d8d1934163685d2981d165` | 概念设定 |
| X5 | `persona-dist/media/image/P5R/p5r-conceptart-akechi2--608e8fc0aa6b.png` | 975,403 | `608e8fc0aa6be456cf96f4f643f60187cfb3f30799e00226af1fd4038ce4761b` | 概念设定 |
| X6 | `persona-dist/media/image/P5R/p5r-goro-akechi-phantom-thief--1702dd023340.png` | 3,258,610 | `1702dd023340928696965837421e610584779d6131b6dce8ba1031552789bcbc` | 怪盗服立绘 |
| X7 | `persona-dist/media/image/P5R/p5r-gorokasumijoker--3307367899d6.jpg` | 277,949 | `3307367899d67c5af55d527765b32ffd763aaf334ea971e685603004b7e30c33` | 明智×霞×Joker 三人插画（不可分离） |
| X8 | `persona-dist/media/image/P5R/p5r-showtime-jokerakechi--8ce8751b0ccf.png` | 671,155 | `8ce8751b0ccf68f563fc5cae3a1ac5c45c3e5383d93d7c848e44c290db54dd7d` | Joker×明智 合体技转场 |
| X9 | `persona-dist/media/image/unknown/akechi-all-out--d8c1366a38e3.png` | 1,770,318 | `d8c1366a38e3f2d959358c3ad173db8becece518919924d80753dc9ef31b9231` | 总攻击 |
| X10 | `persona-dist/media/image/unknown/akechi-and-protag-wrong-ending--4c20a8245d19.png` | 5,869,398 | `4c20a8245d192467e6f035e6ad7b5fe1aeab99791f964ae5419e813ca441fd21` | 插画（明智与主角，不可分离） |
| X11 | `persona-dist/media/image/unknown/akechi-and-ren--5582897d0a3b.png` | 1,615,068 | `5582897d0a3b9b75d9d0b8c9019b208b4eb3e0fe6dff8dac6aabcbf27a31392f` | 插画（双人，不可分离） |
| X12 | `persona-dist/media/image/unknown/akechi-black-mask-all-out-attack--f2a46a9c8406.png` | 3,289,604 | `f2a46a9c84068c39e5027322b465fd7499ea24562968fda7d37073a3cd1f992d` | 黑面具总攻击 |
| X13 | `persona-dist/media/image/unknown/akechi-cut-in-third--c7badfe1dac9.png` | 2,064,089 | `c7badfe1dac9cf066b903cc4ea2b4b4bdaba86fbe15e54ac0dbb5055b277cc18` | cut-in 插画 |
| X14 | `persona-dist/media/image/unknown/akechi-finishingtouch--06c08e00638f.png` | 4,687,857 | `06c08e00638fdd1ce35a4bd5aed20ad20858fcdc17ed1f0ea751afb8b3ccbf09` | 总攻击 |
| X15 | `persona-dist/media/image/unknown/akechi-persona--991b905fcb9d.png` | 481,143 | `991b905fcb9d23a2499f2571b1c3f056484ff9f6fae9cc3ffc517f5824c433bc` | 立绘（Persona 相关） |
| X16 | `persona-dist/media/image/unknown/akechi-school--cee4074d3327.png` | 123,159 | `cee4074d3327379b85a7ce6b3efb0e8b237ca28faa36713f753b4b2b1bdb2557` | 校服立绘 |
| X17 | `persona-dist/media/image/unknown/akechi-thief--4d925d95e35b.png` | 145,558 | `4d925d95e35bb23f4ff9815d4fbfb5bbd85df4f5883db3c6a7178c93ea07ff6b` | 怪盗服立绘 |
| X18 | `persona-dist/media/image/unknown/crow-and-robin-hood--3f423234627e.jpg` | 377,550 | `3f423234627e2aff3cd7a9ec8719ae9b5049ecba58af8e31d26758b2a2adf352` | 明智（Crow）与 Robin Hood 插画 |
| X19 | `persona-dist/media/image/unknown/crow-finishing-touch--92c52c7f1335.gif` | 6,462,537 | `92c52c7f1335ed3099355d170d0bbbed273176d4ec57450d935fac879c0c0f63` | 总攻击 GIF（动画） |
| X20 | `persona-dist/media/image/unknown/goro-akechi-showtime--ad72caa6df16.png` | 1,517,048 | `ad72caa6df161753b3f18e80d51284d3faebc7a4dbbf316e25795bab3338dad6` | 合体技 |
| X21 | `persona-dist/media/image/unknown/goro-akechi-theme--039940ba8858.png` | 635,354 | `039940ba885845479d523e608705c81026a80d4059ed67a36ed6e5fba593588d` | 主题插画 |
| X22 | `persona-dist/media/image/unknown/kv_akechi--918959fdb0fa.jpg` | 407,036 | `918959fdb0fa106750e77d0b9a3534deeb9f434c2f49b4416dc35db5a142c58e` | 动画 Key Visual |
| X23 | `persona-dist/projects/p5-blog/assets/img/cover-akechi.jpg` | 407,036 | `918959fdb0fa106750e77d0b9a3534deeb9f434c2f49b4416dc35db5a142c58e` | 同 X22（重复来源） |
| X24 | `persona-dist/projects/p5-ui/src/assets/images/portraits/akechi.png` | 83,160 | `5fe9393818970c168ada2aa8b0cf1cc763fe8239d3d77f22894a7dd7ce85aab5` | 头像 |

**处理决定**：以上 24 项**全部不进入活动精选库允许清单**（原始文件保持离线原样）。
其中 X7/X8/X10/X11/X18/X20 为含明智的多人/合体内容，「不能可靠分离 → 整份排除」；
X9/X13/X14/X19 为总攻击/动画，§5.2 明确排除。

## 3. 含明智的「合图」与非可靠分离资源（整份不进允许清单）

以下在参考库中是**合图/整表**，含全部协助者 / IM 头像 / 多角色，**未逐元素确认身份**，
按「不确定的不进允许清单」处理（即使其中可能含有可单独提取的非明智部分，本次也未提取）：

| 参考路径（`persona5-spriters/` 下） | 说明 |
| --- | --- |
| `p5/hud/92093-confidant-icons.png` | P5 协助者头像/名称牌总表（含全部协助者，含正义/明智）→ 整份不进允许清单；**COOP 图标因此没有从中提取**，改用旧站既有 `app/coop.png` |
| `p5/hud/92141-profile-pictures.png` | P5 IM 黑白头像总表（含全体联系人，无法逐元素确认明智是否在列）→ 整份不进允许清单 |
| `p5/hud/92142-menu-portraits.png` | 已实看为 Joker 单人剪影（可作参考）——但它是「菜单立绘」并非可分离的合图，见允许清单 §4 |
| `p5r/hud/132781-confidant-portraits-cn-jp.png` | P5R 协助者头像/名称牌总表（含全体协助者）→ 整份不进允许清单 |
| `p5r/hud/132782-im-assets-cn-jp.png` | P5R IM 元件总表（含头像元件；其中 `.dsh/p0-analysis` 已提取 83 个裁片）→ 整份未逐元素确认，不进允许清单 |
| `p5r/hud/132783-photos-im.png` | IM 照片集（未逐元素复核）→ 不进允许清单 |
| `p5r/hud/134224-buttons-icons.png` | 按钮/图标表（`.dsh/p0-analysis` 已提取 20 个）→ 未逐元素确认身份，不进允许清单 |
| `p5r/hud/131675-dialogue-menu-portraits.png` | 已实看为 Joker 单人（可作参考，见允许清单 §4） |
| `p5/miscellaneous/92512-crowd.zip`、`crowd/**` | 路人剪影（已在仓库中作为 crowd 过场使用；无角色，保护不动） |

## 4. 视频：未逐帧核完的一律标「未审核，不进允许清单」

参考库 `persona-dist/media/video/`（38 个文件）与 `persona-dist/ae-projects/**` 中：
- **已逐帧/抽帧复核、确认无角色**（仅限 N5 过场用途）：2 个异世界转场候选（见允许清单 §3）。
- **人群转场素材（保护类，不属于排除）**：`行人过场--f98144a18323.mp4`、`行人过场(龙司)--e8657b845ead.mp4`、
  `ae-projects/.../人流转场-白天.mp4`、`人流转场-夜晚.mp4` —— 属地图人群过场参考，**保留、不删除**；
  是否入库由后续任务决定，本轮不改变。
- **未审核、不进允许清单**（可能含明智，也可能不含；未核完就按未审核处理）：
  `ae-projects/.../SHOWTIME.mp4`（合体技合集，风险最高）、`对话框新-有立绘.mp4`、
  `人物-无语.mp4`、`人物-生气.mp4`、`人物-着急.mp4`、`好感度+1/+2/+3.mp4`、`好感星星.mp4`、
  `五维增加*.mp4`、`文字-咕哝.mp4`、`P5对话框种类合集.aep`（工程文件，不运行）、
  `media/video/unknown/` 下其余 10 个视频（`UI3*`、`UI_2*`、`过场joker*`、`过场圆圈(蓝)`、
  `过场斜滑屏`、`过场红色剪开屏幕`、`进入战斗` 等）。
  ⚠️ 这一条很关键：**没有逐帧核过就不写「已复核」**，也不放宽清单让它看起来完整。

## 5. 书籍 / 原始工程（整份不进活动库）

- `persona-dist/reference-books/**`（266 个文件：P5 官方设定集 PDF + 200dpi 页扫）：
  书籍版权内容，**整份不进活动库**，仅作离线视觉语言参考；不复制、不进入网站公开目录。
- `persona-dist/ae-projects/**`（After Effects 工程、自动保存目录等）：
  原始工程**不自动运行、不关联执行、不复制**；仅离线参考。其中 `P5对话框种类合集.aep` 等未审核。
- 原始采集包 `/Users/学习/Claude/dist/`：**离线保留、不动**（不属于本仓库，未删除、未改）。

## 6. 本地历史提取裁片（未入构建，未审核）

`.dsh/p0-analysis/`（第一轮 P0 的提取产物，154 个文件：`p5-profile-pics-*` 51 个、
`p5r-im-assets-*` 83 个、`p5r-buttons-*` 20 个）：
- 来源合图见 §3（含全体协助者/IM 头像），**未逐元素确认身份**；其中可能存在明智的 IM 头像/头像裁片。
- 结论：**未审核，不进允许清单，不接入网站**（该目录本身不在构建输入与公开目录中）。
- 相关工具 `tools/p0-contact-sheets.py` 生成的对照图同样只作本地人工核对，不作为素材库内容。

## 7. 排除后的验证方式（N7 可直接用）

```bash
# 1) 仓库级复验（公开目录/构建输入/构建产物 + 别名 + 已知哈希 + crowd 完整性）
python3 tools/acceptance/verify-no-akechi-assets.py
#    期望：最后一行 "PASS: ..."，退出码 0

# 2) 公开目录里点名道姓的 3 个原文件不得存在
test -e apps/web/public/assets/legacy/img/icon/crow.webp && echo FAIL || echo PASS
test -e apps/web/public/assets/legacy/img/band-halftone.jpg && echo FAIL || echo PASS
shasum -a 256 apps/web/public/assets/legacy/img/cover/platinum.jpg
#    期望：394c37ce82717c45f83bd78d09ecad288fb506e42ac2eb0ab19d7fed7d69d142（替换版）

# 3) 浏览器实际下载（构建后启动服务，见 N6-result 第 7 节命令）
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3102/assets/legacy/img/icon/crow.webp
#    期望：404
```
