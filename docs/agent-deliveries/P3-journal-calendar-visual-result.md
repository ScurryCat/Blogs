# P3 补充交付：手记日历视觉还原 v1（日期成为主要视觉锚点）

> 任务书：`2026-10-17-p5-phone-ui-v2-agent-brief.md`（第二轮）§4.3「手记」、§8.1 视觉与参考。
> 触发：交接包 `docs/handoff-package-2026-10-17.zip` 的 HANDOFF §六「B1 整屏视觉还原」；
> 上一轮已完成参考帧审计与 IM 视觉还原（`P2-im-visual-restore-result.md`）。
> 本轮：用**元件表级参考**（`92140-save-load` / `92120-calendar`）把日历改成「日期为主视觉锚点」。
> 日期：2026-10-17 · 分支 `main` · **未 push / 未部署**

---

## 1. 完成范围

| 任务书条目（§4.3） | 状态 | 说明 |
| --- | --- | --- |
| 「以原作日历和手帐为视觉母版，**让日期成为主要视觉锚点**」 | 🟡 v1 完成 | 新增**日期锚点面板**：大号撕纸日号（红阴影）+ 年.月 + 星期白牌 + 当日记录摘要 + 读取入口；窄屏它排在最前 |
| 日历容器「日历与记录列表切换」 | ✅ 保留 | 页签、返回、只看某日、显示全部均保留原行为 |
| 「清楚区分有记录日期、当前选择和无记录日期」 | ✅ 强化 | 有记录＝红号牌；选中＝反白 + 红描边 + 轻微旋转；无记录＝无装饰空网格（验收 2 不破） |
| 原作日历的月/星期/撕纸语言 | 🟡 v1 | 月份标题＝白底黑字撕纸条 + 红色硬阴影；星期头＝白色斜切小字；月面板＝黑底白框硬阴影 |
| **顺手修复的 UI 缺陷** | ✅ | 手机宿主里页签出现**两个「日历」**：因为把 `reading`（详情屏）也当成页签渲染，第三个页签被错误标成「日历」且会切到没有 id 的详情屏。已过滤为只列浏览两屏 |
| 完整日历整屏参考帧 | ⛔ 仍缺 | 本地库只有 HUD 元件表（`92120-calendar-jpn` 等），**没有整屏**；按任务书口径不宣称「整屏还原通过」 |

## 2. 修改文件

| 文件 | 改动 |
| --- | --- |
| `apps/web/features/journal/calendar-panel.tsx` | 新增 `selectedDay` 属性（驱动选中高亮）；选中日 `aria-selected`；移除未被调用的 `onReadEntry`（它把一个「日期字符串」当 entryId 传，属潜在错用） |
| `apps/web/features/journal/journal-view.tsx` | 日历屏新增「日期锚点」面板（锚定选中日，未选中时锚定最近一篇公开手记）；读取入口复用既有 `openEntry` 逻辑；页签过滤为 `list / calendar` 两屏（修重复日历页签） |
| `apps/web/features/journal/journal.module.css` | 新增「日历视觉还原 v1」段落（约 +330 行）：`.calendarLayout` / `.dayHero`（大日号、页码、星期白牌、摘要、CTA）、月面板/月标题/星期头/日期号牌/选中与今天状态；容器查询 900/620 收敛窄屏角度与字号 |
| `docs/design-references/reference-frame-gaps.md` | 补充「手记日历：只有元件表、无整屏帧」的判定（见 §6） |
| `docs/agent-deliveries/P3-journal-calendar-visual-result.md` | 本报告 |

**未改动**：数据请求、权限（公开/私密）、日期语义（`YYYY-MM-DD` 字符串，不经时区换算）、
返回位置/滚动记忆、手机内导航语义、任何后端/数据库。

## 3. 素材与参考

| 参考 | 路径 | 用途 | 说明 |
| --- | --- | --- | --- |
| 存档/读取元件表（P5 / PS3） | `persona5-spriters/p5/hud/92140-save-load.png` | No.1–16 撕纸编号、PLAY TIME 标签、难度条、黑白预览框、×戻る ○選択 提示 | 只证明**零件**语言；此表不含整屏布局 |
| 日历元件表（P5 / PS3） | `persona5-spriters/p5/hud/92120-calendar-jpn.png` | 月火水木金土日、午前/午後/放課後/深夜 撕纸条、天气标签、日英混排 | 同上：零件，不是整屏 |

> 版本均记录为 **P5 / PS3**（与 `icon-mapping.md` 一致）。素材没有接入站点二进制
> （只借用视觉语言），许可状态沿用「未核实、仅本地参考」。

## 4. 视觉证据

工作区外（本地，不入库）：`/Users/学习/blog/Blogs/.dsh/screenshots/`

| 文件 | 内容 |
| --- | --- |
| `.dsh/vis2/journal-calendar.png` | **改前**：日历是一张朴素小网格（日期不是视觉锚点），1440×900 |
| `p2journal-calendar-after.png` | **改后**：左「日期锚点」黑面板（大日号 15 + 2026.09 + 周二 + 最近记录摘要 + 读取手记），右黑底白框月历（有记录日期＝红号牌、今天＝白描边） |
| `p2journal-calendar-selected-after.png` | 点某一天后：锚点日号变为 05、显示「选中日期 · 1 篇公开手记」、该日反白 + 红描边 |
| `p2journal-phone-calendar-after.png` | 手机宿主（斜屏）内：日期锚点在手机上排最前，页签只剩「存档列表 / 日历」两个 |
| `p2journal-calendar-390-after.png` | 390×844：日期锚点在前、月历在后，无横向溢出 |
| `p2journal-list-after.png` | 存档列表（上一轮成果保持，未被本轮改动破坏） |

## 5. 验证结果

| 命令 / 检查 | 结果 |
| --- | --- |
| `cd apps/web && npm run test -- --run` | **89 files / 924 tests passed**，exit 0 |
| `npx vitest run features/journal` | 4 files / **55 tests passed** |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0（0 error / 0 warning；首版 `aria-pressed` 用在 gridcell 上的 warning 已改为 `aria-selected`） |
| `npm run build` | exit 0（34 静态页） |
| 真实浏览器（Next dev + **隔离 e2e 全栈** 3130/8130，种子 15 篇手记） | 10/10 断言通过：锚点存在且锚定最近记录日、点击有记录日期后锚点切换、选中高亮唯一、保留「只看 YYYY-MM-DD」状态文案、390 无横向溢出、手机宿主内锚点存在、无 JS 错误 |
| 数据来源 | `tools/e2e-stack.sh`（隔离集群 55434 + 种子手记），不碰共享库与共享构建 |

## 6. 未完成项（不得宣称整屏视觉验收通过）

1. **完整日历整屏参考帧仍缺**：本轮只拿到 HUD 元件表，按任务书 §8.1「元件表只能证明零件来源，
   不能单独证明整屏布局已还原」，日历视觉只标 **v1 部分还原**。
2. **日期锚点的「手帐」部分**：原作手帐页的完整构图没有参考，摘要/按钮布局是本站响应式改编。
3. 其余 App 视觉还原未开始（交接包 B1 的其余部分）：放课后 / COOP / 殿堂与相册 / 异世界导航 /
   天鹅绒房间与印象空间 / 手机桌面图标系统（P4）。
4. 真机触控、软键盘、移动 Safari 未验证（沿用交接包 §3.2）。

## 7. 集成说明与回退

- **无共享接口变更**：只改手记 feature 内部组件与样式；`calendar-panel` 的 prop 变化只被
  `journal-view.tsx` 使用（已同步）。API/DTO/路由/权限均未变。
- **回退**：删除 `journal.module.css` 末尾「日历视觉还原 v1」段落 → 回到旧朴素网格；
  还原 `journal-view.tsx` 的日历屏 render（日期锚点面板）与 `calendar-panel.tsx` 的
  `selectedDay` 高亮即可；页签过滤那处修复建议保留（属缺陷修复）。
- **与其他任务的关系**：与第三轮 N2 的「存档式手记列表」兼容（同一 `SaveScreen` 未动）；
  与交接包 P6 的验收脚本兼容（`verify-all.sh --fast` 通过，见下）。
