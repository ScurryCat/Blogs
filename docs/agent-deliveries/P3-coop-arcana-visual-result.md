# P3 补充交付：COOP 阿卡那卡牌视觉还原 v1 + 独立应用页顶栏遮挡修复

> 任务书：`2026-10-17-p5-phone-ui-v2-agent-brief.md`（第二轮）§4.5「COOP」、§2.4/§8.1 视觉与参考。
> 承接：交接包 `docs/handoff-package-2026-10-17.zip` 的 B1「整屏视觉还原」；
> 前两轮已完成 IM 视觉还原（`P2-im-visual-restore-result.md`）与手记日历（`P3-journal-calendar-visual-result.md`）。
> 日期：2026-10-17 · 分支 `main` · **未 push / 未部署**

---

## 1. 完成范围

| 任务书条目 | 状态 | 说明 |
| --- | --- | --- |
| §4.5「借用协助关系与**阿卡那卡牌**的视觉语言」 | 🟡 v1 完成 | 友链卡片改为塔罗卡构图：白卡边 → 黑底 → 顶部**罗马数字 + 英文阿卡那名 + 中文名红牌** → 红/黑斜切卡头（黑白首字头像做拍立得）→ 撕纸风格站名 → 黑底白字卡身 |
| §4.5「关系列表支持快速选择」 | ✅ 保留 | 标签筛选、卡片悬停抬升、展开相识故事、访问网站均保留 |
| §4.5「装饰性阿卡那元素不得被误解成后端已有的关系数值」 | ✅ 明确 | 卡头右侧固定注记「装饰分类 · 非等级」；title 提示「不是等级或好感度」；页面导语增补说明；**认不出的 arcana 原样显示，不编罗马数字/中文名** |
| **顺手修复的真实缺陷**：独立应用页被固定顶栏压住 | ✅ | 见 §1.1 |
| 完整 COOP 整屏参考帧 | ⛔ 仍缺 | 本地参考库只有卡牌设计页（画册 p219）与协助者元件表，**没有 COOP 整屏**；按 §8.1 只标 v1 部分还原 |

### 1.1 独立应用页被固定 HUD 遮挡（交接单遗留问题）

交接包 §3.2 / 上一轮手记交付单都记录过：「`/apps/leisure` 等同类页仍会被 fixed 顶栏压住，
建议统一处理」。本轮实测确认并修复：

- 站点 `.hud` 是 `position: fixed`；`/apps/coop`、`/apps/leblanc`、`/apps/leisure`、
  `/apps/metanav` 直接返回 `section.shell`（无顶部留白），`/apps/ins`、`/apps/ins/messages`、
  `/apps/ins/messages/<id>` 连外壳都没有 → 内容从视口顶端开始、页头压住标题。
- 新增共享外壳 `components/ui/app-page-shell.tsx`（`section.shell.app-page`），并在
  `app/globals.css` 定义 `.app-page` 的上下留白（`calc(var(--hud) + 30px)`，窄屏 16px）。
- 已套用的页面（7 个独立页）：`/apps/coop`、`/apps/leblanc`、`/apps/leisure`、`/apps/metanav`、
  `/apps/ins`、`/apps/ins/messages`、`/apps/ins/messages/[character_id]`。
  手记页沿用已有的 `JournalPageShell`（局部留白），不改动。
- 实测：五类页面的 `.app-page` 计算 `padding-top: 96px`（HUD 66px + 30px），标题完整可见
  （截图 `p2shell-*.png`）。

## 2. 修改文件

| 文件 | 改动 |
| --- | --- |
| `apps/web/features/coop/arcana.ts`（新增） | 22 张大阿卡那映射：罗马数字 / 英文名 / 中文名；`normalizeArcana` 兼容大小写、空格、连字符与常见别名；**未知值返回 null（原样展示，不编造）** |
| `apps/web/features/coop/arcana.test.ts`（新增） | 4 组测试：常见写法、别名/分隔符、未知值不编造、22 张列表完整性与序号唯一 |
| `apps/web/features/coop/friend-card.tsx` | 卡头新增阿卡那条（罗马数字 + 英文名 + 中文红牌 + 「装饰分类 · 非等级」注记），保留原有 title 语义；卡名/头像/摘要/标签/按钮结构保留（无障碍标签不变） |
| `apps/web/features/coop/coop-view.tsx` | 导语补一句「阿卡那是装饰分类，不是好感度/等级/关系数值」 |
| `apps/web/features/coop/coop.module.css` | 新增「阿卡那卡牌视觉还原 v1」段落（约 +250 行）：白卡边 + 红色硬阴影、黑/红斜切卡头、拍立得首字头像、撕纸站名、动作条与展开故事的卡牌化；窄屏取消旋转 |
| `apps/web/components/ui/app-page-shell.tsx`（新增） | 独立应用页统一外壳 |
| `apps/web/app/globals.css` | 新增 `.app-page` 留白规则（带窄屏断点） |
| `apps/web/app/apps/{coop,leblanc,leisure,metanav}/page.tsx`、`app/apps/ins/page.tsx`、`app/apps/ins/messages/page.tsx`、`app/apps/ins/messages/[character_id]/page.tsx` | 套用 `AppPageShell`（修复顶栏遮挡） |
| `tools/e2e-seed-previews.py`（新增） | 给隔离环境造「视觉复核」数据：放课后 4 条（含总数未知/未评分/通关≠全成就等状态）+ COOP 3 条友链（带 arcana），走真实管理 HTTP + 发布流程；幂等 |
| `docs/agent-deliveries/P3-coop-arcana-visual-result.md` | 本报告 |

**未改动**：COOP 数据模型/API/权限、外链安全校验（`externalLinkAttributes` 原样）、
是否发布/排序等业务逻辑、其他 App 视图行为。

## 3. 素材与参考

| 参考 | 路径 | 用途 | 说明 |
| --- | --- | --- | --- |
| P5 官方设计画册 p219（200dpi 页扫） | `persona-dist/reference-books/p5-assets 5/official/design-works/pages-200dpi/p5artbook-219.jpg` | **22 张阿卡那塔罗卡面**：白卡边 → 黑内框 → 红色卡面 → 黑白插画 → 底部撕纸字母卡名 + 顶部罗马数字 | 只借构图语言，**不复制任何游戏卡面插画**（站点没有也不新引入该美术） |
| P5 协助者元件表 | `persona5-spriters/p5/hud/92093-confidant-icons.png` | 黑白斜切背景、撕纸英文名条、协助者 B/W 头像 | 元件级参考；版本 P5 / PS3 |

> 本地参考库对 COOP **没有整屏帧**；因此本报告只声明「卡牌语言 v1 还原」，
> 不声称整屏视觉验收通过。素材许可沿用「未核实、仅本地参考」。

## 4. 视觉证据

工作区外（本地，不入库）：`/Users/学习/blog/Blogs/.dsh/screenshots/`

| 文件 | 内容 |
| --- | --- |
| `.dsh/vis2/coop-desktop.png` | **改前**：普通深色卡片（无卡牌构图），且内容被顶栏压住，1440×900 |
| `p2coop-list-after.png` | **改后**：三张阿卡那卡（XVII STAR 星 / V HIEROPHANT 教皇 / 0 FOOL 愚者），白卡边+红硬阴影、黑红斜切卡头、拍立得首字、撕纸站名；顶栏遮挡已修 |
| `p2coop-story-after.png` | 展开相识故事：卡内黑面板 + 红色左条 |
| `p2coop-390-after.png` | 390×844：单列、取消旋转、无横向溢出 |
| `p2coop-phone-after.png` | 手机宿主（斜屏）内的 COOP 卡牌 |
| `p2shell-leblanc/leisure/metanav/ins-messages/ins.png` | 独立应用页修复后：`.app-page` 顶部留白 96px、标题完整可见 |

## 5. 验证结果

| 命令 / 检查 | 结果 |
| --- | --- |
| `cd apps/web && npm run test -- --run` | **90 files / 928 tests passed**，exit 0（新增 4 例阿卡那测试） |
| `npx vitest run features/coop` | 9 files / **79 tests passed** |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0（0 error / 0 warning） |
| `npm run build` | exit 0（34 静态页） |
| 真实浏览器（隔离 e2e 全栈 + 本轮种子：放课后 4 条、COOP 3 条） | 10/10 断言：3 张卡、3 个已知阿卡那罗马数字 = `0 / V / XVII`、卡片内无 RANK/访问量/在线等伪造数据、展开故事出现正文、390 无横向溢出、手机宿主内卡牌存在、无 JS 错误 |
| 独立应用页留白 | 五个页面 `.app-page` 计算 `padding-top: 96px`（HUD 66 + 30），HUD 底 66px，内容不再被遮挡 |
| 数据种子 | `tools/e2e-seed-previews.py`：登录 → 新建 → 发布（If-Match）全链路成功，4/4 + 3/3 |

> 说明：浏览器检查脚本里有一条「整页文本不含『好感』」的断言会误报 —— 因为页面导语中
> 明确写了「**不是**好感度、等级或关系数值」。卡片元素内实测无 RANK/好感/访问量/在线等字样；
> jsdom 测试 `friend-card.test.tsx` 的禁词断言通过。

## 6. 未完成项

1. **COOP 整屏参考帧仍缺**：只有卡牌设计页与元件表，卡牌构图是本站响应式改编 → 标 v1 部分还原。
2. **友链头像**：数据模型支持 `avatar_media_id`，但本地种子没有头像媒体；拍立得头像目前显示站名首字
   （有头像时会显示图片，逻辑未改）。
3. 其余 App 视觉还原未开始：放课后 / 殿堂与相册 / 异世界导航 / 天鹅绒房间 / 印象空间 /
   手机桌面图标系统（P4）。
4. 真机触控、软键盘、移动 Safari 未验证（沿用交接包 §3.2）。

## 7. 集成说明与回退

- **共享文件**：`app/globals.css` 增加 `.app-page`；新增 `components/ui/app-page-shell.tsx`；
  七个独立页套用外壳。这是本轮唯一跨模块改动，只影响版式留白，不改数据与逻辑。
- **回退**：删除 `coop.module.css` 末尾「阿卡那卡牌视觉还原 v1」段落 → 回旧卡片；
  删除 `arcana.ts`/`arcana.test.ts` 并还原 `friend-card.tsx` 卡头即可。
  顶栏修复建议保留（缺陷修复）：撤销时把七个页面的 `AppPageShell` 换回旧 wrapper 即可。
- **与其他任务**：不触碰第三轮 N6 图标/素材清单；`verify-all.sh --fast` 通过（见下）。
