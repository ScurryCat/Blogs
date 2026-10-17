# 手机内导航一致性审计（§3.3 / §4.x）

> 日期：2026-10-17 · 基于 `1453b19` · 起因：第 38 轮端到端探测发现「IM 点角色会离开手机」
> 结论：这是**一类**问题，不是孤例 —— 本文件把它一次说清，交给决策。

## 一、判定标准

任务书 §3.3 要求「手机视图和独立页面使用同一套内容组件与数据逻辑」，并让手机内的
**返回 / 前进后退** 与既有路由约定一致。由此区分三种跳转：

| 类型 | 手机里应该怎样 | 例子 |
| --- | --- | --- |
| **A. 站点内容**（文章、作品、外部友链） | **离开手机**，走 `phone-link` / `metaverse-entry` 等来源与过场 | 导航里点文章、COOP 点友链 |
| **B. 应用内状态**（同一 App 的列表→详情、筛选、会话） | **留在手机里**，用手机自身的 `screen`/`item` 表达 | 手记列表→正文、INS 标签筛选 |
| **C. 主动"在完整页面打开"** | 可以离开，但**要明确是用户主动要的** | 应用顶部「展开查看 ▸」 |

## 二、审计结果

### ✅ 一致的（按 A / C 处理正确）

| 位置 | 行为 | 判定 |
| --- | --- | --- |
| 导航 → 文章 / 后宫详情以外的内容 | `openContent({destination: postPath(...)})` 离开手机 | A ✓ |
| COOP → 友链 | 外部站点，新窗口/离开 | A ✓ |
| INS / 殿堂 / 天鹅绒 → 「展开查看 ▸」 | 跳到 `/apps/ins`、`/showcase` 等完整页面 | C ✓（用户主动）|
| 放课后 两个页签 | 走 `host.changeScreen`，**不自己改 URL** | B ✓（正确示范）|

### ❌ 不一致的（应用内状态却离开了手机）

| # | App | 入口 | 实际去向 | 手机内是否有对应 screen |
| --- | --- | --- | --- | --- |
| ~~P1~~ | INS | 标签 chip | ~~`/apps/ins?tag=<tag>`~~ → **已改为手机内 `screen=tagged&item=<标签>`** ✅ 第 46 轮完成 | ✅ 有 `tagged` |
| ~~P2~~ | INS | 消息 → 角色 | ~~`/apps/ins/messages/<id>`~~ → **已改为手机内 `screen=conversation`** ✅ 第 49 轮完成 | ✅ 有 `conversation` |
| ~~P3~~ | 手记 | 「读取手记」 | ~~`/apps/journal/<id>`~~ → **已改为手机内 `screen=reading`** ✅ 第 43 轮完成 | ✅ 有 `reading` |
| ~~P4~~ | 导航 | 殿堂详情 | ~~`/apps/metanav/palaces/<slug>`~~ → **已改为手机内 `screen=palace`** ✅ 第 44 轮完成 | ✅ 有 `palace` |

四处都是 **B 类**（同一 App 的列表→详情 / 筛选 / 会话），却走了站点路由 → **手机被关闭**。
其中 P1、P2 已在台账 §6.5 / §6.16 记录，本轮新增 P3、P4。

## 三、统一方案（推荐，不需要改手机 URL 契约）

**关键发现**：手机 URL 已经有 `phone / screen / item` 三个参数（`features/phone/url-state.ts`），
**足以表达这四类状态** —— 不需要扩展 URL 契约，只需让各 App **声明并实现**这些屏幕：

| 不一致 | 建议的屏幕表达 |
| --- | --- |
| P1 标签筛选 | `?phone=ins&screen=tagged&item=<tag>`（`item` 承载筛选值）|
| P2 消息会话 | `?phone=ins&screen=messages&item=<character>` |
| P3 手记正文 | `?phone=journal&screen=reading&item=<entry>` |
| P4 殿堂详情 | `?phone=metanav&screen=palace&item=<slug>` |

需要的最小改动：

1. 各 App 的 `screens` 里加上对应屏幕，并在视图里按 `screen` 分支渲染（**复用现成的组件**：
   手记正文、会话视图、殿堂详情都已存在，只是当前只挂在独立路由上）；
2. 宿主补一个「在手机内打开某屏幕」的入口（现有 `host.changeScreen` 只能换 screen，
   不能带 item）；这是 `PhoneHost` 的一处**小扩展**，不是 URL 契约变更；
3. 上述入口控件从「站内链接」改为「调用宿主」；
4. T02 套件补 4 条断言（点进去后 `.pw-appview` 仍在、URL 的 `screen/item` 正确）。

**收益**：四处 UX 不一致一次解决；且为以后「任何应用内详情」立下统一做法。
**风险**：改动 4 个 App + 宿主 + 测试；需要真实浏览器回归（本会话已有 E2E 能力：见
`tools/e2e-phone-scroll.py` 的隔离栈搭法）。

## 三·补四：P2 已落地（第 49 轮）—— **四处全部完成**

手机里点角色后 URL 变成 `?phone=home`（回退桌面），根因有两层，都在
`features/ins/phone-manifest.tsx`：

1. **loader 返回的是 `InsPhoneView`**，而不是 `phone-app` 里的分派根 `InsPhoneRoot` ——
   消息屏永远不会交给 T08 的实现渲染；
2. **screens 只列了 INS 自己的屏幕**（feed/detail/saved/tagged），不含 `messages`/`conversation`，
   宿主因此判定 `screen=conversation` 非法并回退。

修法：loader 改用 `InsPhoneRoot` + 用 `phone-app` 导出的合并 `screens`。
端到端实测（`tools/e2e-ins-conversation.py`）：

```
URL：/?phone=ins&screen=conversation&item=futaba
状态：手机开=True 应用层=True
判定：✓ 会话在手机内，手机未关闭
```

**至此专项审计的 P1–P4 全部完成，且每一项都有真实浏览器端到端证据。**

## 三·补三：P1 已落地（第 46 轮）

INS 的标签筛选在手机内改为换屏 `screen=tagged&item=<标签名>`：`FeedView` 新增可选
`onSelectTag`，手机里渲染成按钮并走宿主换屏（独立页仍渲染站内链接）。
端到端实测（`tools/e2e-ins-tag.py`）：

```
URL：/?phone=ins&screen=tagged&item=<标签>
状态：手机开=True 应用层=True feed=True　标签 chips：['全部']（按钮）
判定：✓ 标签筛选在手机内，手机未关闭
```

**遗留已补（第 48 轮）**：手机里的标签列表原先不显示（`availableTags` 只在独立页由服务端
传入，手机路径没传）。现在 `FeedView` 在未传 `availableTags` 时**从已加载动态的 `tags` 派生**，
手机内也能看到并切换标签。单测覆盖：派生出的标签渲染成按钮、点击走 `onSelectTag`、不跳站内链接。

## 三·补二：P4 已落地（第 44 轮）

导航里的殿堂详情（`palaces-screen` / `palace-card`）在手机内改为换屏 `screen=palace` + `item=slug`，
`PalaceReading` 增加可选 `onBack`（手机内返回走宿主换屏，不再跳 `/apps/metanav`）。
**殿堂阅读的 canonical 页面与 `metaverse-entry` 来源在独立页保持不变。**

测试：导航 46 项全过（含 5 处断言从「发 metaverse-entry」改为「换屏到 palace」）。
**端到端已完成（第 45 轮补上）**：新增殿堂种子（`tools/e2e-seed-palaces.py`，需先导入文章
——发布要求「至少一篇公开文章」），端到端实测：

```
URL：/?phone=metanav&screen=palace&item=velvet-door
状态：手机开=True 应用层=True palace屏=1
判定：✓ 殿堂正文在手机内打开，手机未关闭
```

`tools/e2e-metanav-palace.py` 已接入 `verify-all.sh --e2e`（现在是 4 项端到端）。

## 三·补：P3 已落地（第 43 轮）

`?phone=journal&screen=reading&item=<id>` 现在**留在手机里**渲染正文，不再跳独立路由。
端到端实测（`tools/e2e-journal-reading.py`）：手机开=True、应用层=True、正文=True、返回钮=True。

过程中发现并修掉两个真实问题：
1. `isJournalScreen()` 是**硬编码**判断（只认 `list/calendar`）—— 新增 `reading` 后 URL 对了、
   视图却把它判成非法并回退到列表。**已改为按 `JOURNAL_SCREENS` 集合判断**。
2. `JournalPhoneView` 的 `changeScreen` 适配器**丢掉了 item** —— URL 里没有 `item`，
   正文因此渲染不出来。已改为透传。

## 三·补五：端到端在移动视口（390×844）的实测（第 53 轮）

六项端到端原先都跑在 1440×900。本轮给脚本加了 `E2E_VIEWPORT` 参数（如 `E2E_VIEWPORT=390x844`），
在**手机全屏模式**下复跑，结果：

| 端到端 | 390×844 |
| --- | --- |
| IM 草稿持久化 | ✅ |
| 殿堂正文留在手机内（P4）| ✅ |
| INS 标签筛选留在手机内（P1）| ✅ |
| INS 会话留在手机内（P2）| ✅ |
| 手机滚动位置恢复 | ⚠️ 脚本需适配（移动布局里"读取手记"在列表末尾，需滚动容器内定位）|
| 手记正文留在手机内（P3）| ⚠️ 同上 |

**结论**：手机内**导航类**行为在移动宽度下同样成立（4/4 通过）；另外两项失败是
**E2E 脚本按桌面布局写的交互方式**在移动布局下点不到目标，**不是产品缺陷** ——
移动宽度下的**布局**本身由 `verify-viewports.py`（320/390）覆盖并通过。

## 四、为什么其余三处本轮不动手

- 这会同时改 4 个 App 的**屏幕契约**与宿主的打开方式，属于 §3.3「路由约定」层面的改动；
- 其中 INS / 手记 正在被另一位 worker 的第三轮任务触及；
- 按任务书「不猜测」的要求，这类涉及导航契约的改动应先有决策，再实施。

**建议由 Lead 拍板**：若认可第三节方案，我可以在后续轮次按 P3 → P4 → P1 → P2 的顺序
逐个落地（每步都带浏览器验证），也可以整体一次做完。
