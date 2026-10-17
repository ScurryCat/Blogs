# P4 补充交付：WCAG 文字对比度巡检与修正（可复用工具 + 修复）

> 目的：13 轮视觉还原后，用**真实浏览器**对所有主要页面做一次 WCAG AA 文字对比度巡检；
> 修正能安全修正的项，其余作为设计 token 层面的已知项上报。
> 日期：2026-10-17 · 分支 `main` · **未 push**

---

## 1. 方法：可复用工具 `tools/audit-contrast.py`

用 Playwright + 系统 Chromium 打开 12 条主要页面（桌面 1440），对**每个有直接文本的可见元素**：

- 取 `color` 与逐层祖先 `background-color` 做 alpha 合成，得到实际前景/背景色；
- 按 WCAG 2.1 计算对比度（普通文字 **4.5:1**、大字 **3:1**，大字＝≥24px 或 ≥18.66px 且 ≥700 字重）；
- **排除假阳性**：背景是图片/渐变的元素（无法用纯色判定）、`color: transparent` 的描边字
  （`-webkit-text-stroke` 装饰字）、隐藏/零尺寸元素；
- 输出每页不达标项（比率、色值、字号、类名、文本片段），`--json` 可落盘；
- 退出码 1 = 存在不达标项（可接 CI）。

用法：`python3 tools/audit-contrast.py http://127.0.0.1:3130 --json out.json`

## 2. 巡检结果（修正前）

**35 项不达标，分布在 10 个页面**，归为 4 类：

| 类型 | 例子 | 对比度 |
| --- | --- | --- |
| 品牌红小字压近黑底 | `.kick` / `.pm-c` 当前项 / `.row-cat` / `.no` / `SAVE DATA` | 4.23:1（要求 4.5） |
| 模块红小字压近黑底 | 殿堂/图库 kicker（`#d3122a`）、COOP kicker（`#d81f2a`） | 3.67 / 3.91:1 |
| 纸白字压品牌红块 | 手记「读取手记」、COOP 阿卡那中文牌、`.btn.red`、`.cn` 徽标 | 4.15:1 |
| 黑字压品牌红块 | 首页手机菜单当前项、`.pv-tab` 激活项、`.chip` 激活筛选、`pm.on` | 4.23:1 |

另有 2 项扫描噪声（透明描边字）已在工具中排除。

## 3. 修正内容

**新增亮红 token（只用于小号文字，不动红色块/大标题的品牌红）**：
`app/globals.css` 增加 `--red-ink: #ff4b4f`（对 `#0a0a0b` 约 6.1:1），应用到
`.kick` / `.pw-kick` / `.row-cat` / `.no` / `.sec-h .no` / `.n1-work-tech`（`navigation.css`）/
`.pm.on .pm-c`；模块内更早写死的红字同步：`showcase.css` `.pls-kicker`、`gallery.css`
`.plg-kicker`、`coop.module.css` `.kicker`、`journal.module.css` `.saveKicker`。

**红底纸白/黑字小控件改为深红底**（纸白字 ≈7:1）：
`.btn.red`、`.cn`、`.sec-h .cn`、`.cal-wd.we`、`.chip[aria-pressed="true"]`、
`.pv-tab[aria-pressed="true"]`、`.pm.on`（含 `::before`）、`journal` 的 `.readButton`、
`coop` 的 `.cardArcanaCn`（#a80c14 / --red-deep #9f0c12）。

**视觉原则**：红色块仍是品牌红（#e5191c）；只有「小号文字」和「纸白/黑字压红底」两种
低对比场景换用亮红/深红，页面观感保持 P5 红黑语言（截图核对，见 §5）。

## 4. 结果（修正后）

| | 修正前 | 修正后 |
| --- | --- | --- |
| 不达标总数 | 35 | **4** |
| 涉及页面 | 10 | 2（home / about） |
| 我们的视觉还原界面（showcase/gallery/velvet/metanav/coop/leisure/journal/mementos/leblanc） | 有 | **0** |

剩余 4 项同一类：**黑字压品牌红面板**（首页 CALLING CARD 的 `TO:`/正文/「随笔」标签、
关于页 SEND A CARD 的说明段），对比度 4.23:1，差 0.27。这类不是「改个色值」能无副作用解决的：

- 黑字需要**更亮**的红底，纸白字需要**更深**的红底 —— 两类文字在同一面板上，单一 red token 无法同时达标；
- 折中方案（需要设计拍板）：把这两块面板改成**深红底 + 纸白字**（≈7:1），会改变面板观感；
  或保持现状，作为已记录的品牌折中。

## 5. 验证与证据

| 检查 | 结果 |
| --- | --- |
| `tools/audit-contrast.py` 复跑 | 35 → **4**（均为上述品牌红面板，已记录） |
| 抽查计算色值 | 殿堂 kicker `rgb(255,75,79)`；手记「读取手记」底色 `rgb(159,12,18)` |
| 视觉截图 | `.dsh/screenshots/p9-home-contrast-after.png`、`p9-showcase-after.png`（颜色变化细微，版面与层级未变） |
| 前端单测 / typecheck / lint / build | 见本轮汇总（929 tests / 0 / 0 / exit 0） |
| 完整验收 | `bash tools/verify-all.sh --e2e`（本轮汇总；改动为颜色覆写，不影响交互与几何） |

## 6. 交付物与回退

- `tools/audit-contrast.py`（新增，可复用；`--json` 落盘、CI 可用）；
- `app/globals.css` 15.2 节（`--red-ink` + 低对比覆写）；
- `features/navigation/navigation.css`、`features/{showcase,gallery}/…css`、
  `features/{coop,journal}/…module.css` 的小号红字/红底字色修正。

**回退**：删除 `globals.css` 的「15.2 小号文字对比度修正」块并还原上述模块色值即可；
不影响布局与交互。

## 7. 未完成 / 记录项

1. 首页 CALLING CARD、关于页 SEND A CARD 的「黑字压品牌红面板」4.23:1 —— 需设计 token 决策（§4）。
2. 透明描边装饰字（`row-no` 等）不计入（其填充透明是设计，描边色单独可见）。
3. 其他既有未完成项不变：整屏参考帧（G2/G3）、B4 决策、P4 原版图标、真机验证。
