# P2 补充交付：IM 视觉还原 v1（按原版 SNS/IM 完整参考帧）

> 任务书：`2026-10-17-p5-phone-ui-v2-agent-brief.md`（第二轮）§4.2「INS 聊天 / IM」、§8.1 视觉与参考。
> 触发：交接包 `Blogs/docs/handoff-package-2026-10-17.zip` 的 HANDOFF §六「B1 整屏视觉还原」：
> 原执行模型**无图像输入能力**，只能标阻塞。本执行环境**具备图像输入能力**，按交接包建议的
> 「让能读图的协作方给出还原意见」路径继续推进：先补参考帧审计，再做可验证的视觉还原。
> 日期：2026-10-17 · 分支 `main` · **未 push / 未部署**（本地提交由集成负责人决定）

---

## 1. 完成范围

| 任务书条目 | 状态 | 说明 |
| --- | --- | --- |
| §4.2 角色列表 / 消息块 / 头像位置 / 回复选择「按原版 IM 重做」 | 🟡 **视觉还原 v1** | 红底 + 黑面板白边 + 白字、IM 字样标识、拍立得头像、倾斜面板、黑底白字选项条 |
| §4.2 至少三类完整参考帧 | ⚠️ 部分 | 找到**唯一完整 IM 屏**（P5R SNS 截图，含文字消息 + 图片消息 + 拍立得头像）；**回复选择整屏仍缺**，故视觉验收仍不可判定（见 §6） |
| §8.1「每个正式图标都有映射记录」 | ✅ 续 | 上一轮已逐个识别 P5R 按钮字形；本轮参考帧分析补进 `reference-frame-gaps.md` §6 |
| **发现并修复真实缺陷**：手机里 IM 完全没有样式 | ✅ | 见 §1.1 |
| 图片消息（§4.2） | ⛔ 仍阻塞 | 消息模型只有 `text`/`cards`，无图片字段（交接包 B4，需产品决策） |

### 1.1 本轮发现的真实缺陷（测试套件没抓到）

用图像复核手机内 IM 时发现：**手机宿主里的 IM 角色列表 / 会话完全没有样式**——
`messaging.css` 只被独立路由页面（`app/apps/ins/messages/*`、`/admin/messages`）import，
手机宿主（`features/messaging/phone-view.tsx` → INS 应用内）从不加载它。实测：

```text
浏览器（手机 INS → 消息）：.msg-role 背景 = rgb(239,239,239)（浏览器默认灰）、transform = none、
.msg-logo 背景透明、`document.styleSheets` 中无 messaging 样式表
```

这正是「只能靠读图发现的缺陷」：jsdom 单测不计算样式，端到端只断言文本/可达性。
**修复**：在根布局 `app/layout.tsx` 统一 import `features/messaging/messaging.css`
（该表由 `messaging-css.test.ts` 断言只含 `.msg-` 命名空间，不会污染全站）。

## 2. 修改文件

| 文件 | 改动 |
| --- | --- |
| `apps/web/features/messaging/messaging.css` | 新增「IM 视觉还原 v1」段落（约 +500 行）：红底点纹主题、IM 字样、黑板白边会话头、拍立得头像、黑白气泡与反白我方消息、黑底选项条、深色输入区、角色列表黑板卡；`@container (max-width:560px)` 收敛手机窄容器下的字号/排列；保留全部 `.msg-` 前缀（隔离性测试通过） |
| `apps/web/app/layout.tsx` | 新增 `import "@/features/messaging/messaging.css"`（修复手机内 IM 无样式；附注释说明原因） |
| `apps/web/features/messaging/conversation-view.tsx` | 会话头新增 `msg-logo`（IM 字样，`aria-hidden`，纯装饰） |
| `apps/web/features/messaging/character-list.tsx` | 角色列表顶部新增 `msg-list-head`（IM 字样 + `Character messages` 注记） |
| `docs/design-references/reference-frame-gaps.md` | 新增 §6：本地参考库全量审计（画册 259 页 / HUD 表 30 张 / 图片 / 视频）+ 唯一完整 IM 帧的逐元素分析 + G1 部分解除、G2/G3 仍缺的判定 |

**未改动**：任何数据/接口/文案/行为逻辑；组件只加了装饰性元素；DOM 类名保持。

## 3. 素材与参考

| 参考 | 路径 | 用途 | 可追溯性 |
| --- | --- | --- | --- |
| **完整 IM 屏**（P5R SNS 画面，1920×1080） | `persona-dist/media/image/P5R/p5r-sns--4aa5330b1fe6.jpg` | 红底/黑板白边/拍立得头像/倾斜面板/底部提示 | 本地参考库；**原始发布 URL 未核实**（沿用 G4 记录） |
| IM 元件表（P5R） | `persona5-spriters/p5r/hud/132782-im-assets-cn-jp.png` | 头像、送信/戻る/決定 等按钮字形 | Spriters Resource 132782（P5R/PS4） |
| 头像表（P5） | `persona5-spriters/p5/hud/92141-profile-pictures.png` | 已接入的双叶/摩尔加纳黑白头像 | Spriters Resource 92141（P5/PS3），见 `icon-mapping.md` §4.4 |

> 参考帧只用于**视觉语言还原**（颜色/边框/倾斜/层级），没有复制任何游戏画面到站点；
> 站点仍只用已接入的黑白头像 sprite。许可状态沿用「未核实、仅本地参考」。

## 4. 视觉证据

工作区外：`/Users/学习/blog/.dsh/screenshots/`

| 文件 | 内容 |
| --- | --- |
| `p2im-before-list.png` / `p2im-before-conversation.png` | **改前**（git HEAD 的白底纸面 IM），1280×900 |
| `p2im-list-after.png` | **改后**角色列表：红底点纹、IM 字样、黑板白框卡、拍立得头像、P5Ransom 名字 |
| `p2im-conversation-after.png` | **改后**会话页：含 IM 标识的斜切黑板会话头 + 拍立得头像；黑底白字倾斜气泡；黑底白字选项条 |
| `p2im-conversation-choice-hover.png` | 选项 hover 反白（选中反馈） |
| `p2im-phone-conversation-after.png` / `p2im-phone-list-after.png` | **手机宿主内**（斜屏）IM 列表与会话，1440×900 |
| `p2im-conversation-390-after.png` | 390×844 窄视口（无横向溢出） |

参考对照：`/Users/学习/blog/Blogs/.dsh/artbook/imref/`（从 P5R SNS 帧裁出的 header / 消息区 / 底部提示，
本地分析产物，不入库）。

判定口径：截图只证明对应状态。**不声称逐像素整屏还原**（群聊语境 + 缺回复选择整屏帧）。

## 5. 验证结果

| 命令 / 检查 | 结果 |
| --- | --- |
| `cd apps/web && npm run test -- --run` | **89 files / 924 tests passed**，exit 0 |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | exit 0（0 error / 0 warning） |
| `npm run build` | exit 0（含根布局新增样式 import） |
| `npx vitest run features/messaging` | 6 files / 67 tests passed（含 `messaging-css.test.ts` 的命名空间隔离与「头像无滤镜」断言） |
| 真实浏览器（Next dev `localhost:3131` + 隔离 API `127.0.0.1:8108` + 共享测试库） | 计算样式实测：`.msg-app` 背景 `rgb(169,13,18)`、气泡 `rgb(16,16,20)`/`rgb(244,241,234)`、选项黑底白字、`.msg-logo` 存在；390 视口无横向溢出；手机内仍保持斜屏、会话留在手机内；无页面 JS 错误 |

## 6. 未完成项（不得用本报告宣称视觉验收通过）

1. **回复选择整屏参考帧仍缺（G2）**：本地库已全量审计仍无；选项条视觉是按已知语言做的，
   §4.2 / §8.1 的「回复选择完整帧还原」仍标未完成。
2. **普通文字消息整屏尚不可宣称逐像素还原（G1 部分解除）**：唯一完整帧是群聊语境，
   只有一条文字样例，缺「两条往返 + 时间戳位置」对照。
3. **图片消息未做（B4）**：消息模型无图片字段，需产品决策（扩 API/DB 或改为卡片带预览图）。
4. **底部 Scroll/Next 提示未做**：本站不用手柄字形；如需可改成键盘提示语言，但属于新增设计。
5. **其他 App 的视觉还原未开始**：本次只做 IM；建议顺序见 §7。
6. 真机触控 / 软键盘 / 移动 Safari 未验证（与交接包 §3.2 一致）。

## 7. 给后续接手者的建议（视觉优先级）

1. **手记（§4.3）**：参考 `92140-save-load` 元件表 + 日历元件；先确认「日期为主要视觉锚点」。
2. **我的殿堂 / 相册（§4.6）**：参考 `132783-photos-im`（整图拼贴，未切分）与卡牌语言。
3. **COOP（§4.5）**：阿卡那卡牌（`217/219` 页扫、`92093-confidant-icons`）可作语言参考。
4. **异世界导航（§4.7）**：红眼原图仍缺（G3），先解决素材来源再谈还原。
5. 每个 App 完成前都需要「参考帧 → 还原 → 截图对照」三步；缺帧时保持「未完成」标记。

## 8. 集成说明与回退

- **共享文件变更（需知会）**：`app/layout.tsx` 新增一个全局样式 import（修复手机内 IM 无样式）。
  这是本轮唯一影响全站的改动；因 `messaging.css` 只含 `.msg-` 命名空间且由单测锁定，风险可控。
- **回退步骤**：① 删除 `.msg-app` 之后的「IM 视觉还原 v1」段落（messaging.css 末尾新增块）
  即回到白底样式；② 撤销 layout.tsx 的 import（手机 IM 回到无样式状态 —— 不建议，这是缺陷）；
  ③ 撤销两处 `msg-logo` / `msg-list-head` 装饰元素（可选）。全部改动未触及数据与 API。
- **与交接包的关系**：本报告对应 HANDOFF §六 B1 的「解除方式 2（能读图的协作方）」，并新增
  一条交接包未记录的缺陷（手机内 IM 无样式）与修复。建议整合时把本条补进 P6 台账。
