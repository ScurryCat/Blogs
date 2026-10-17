# P4 首页刷新 + 演示内容 + 移除底部音乐栏（用户验证反馈 4 项）

> **2026-10-17 晚·站主追加指令**：**首页布局还原为原本的样子**，只保留「主角头像左侧栏目
> 字体看不清」这一处修复；A/B/C/D 变体与 `?home` 切换**已撤回**（相关代码已删除）。
> 底部播放栏移除、演示内容与手机 deep link **保持不变**。
>
> 来源：站主在本地验证当前版本时提出的 4 条反馈（2026-10-17 晚）。
> 本交付单记录：每条反馈的根因、改动、验证证据、以及后续替换/回滚方式。
> 分支 `main`（未 push 前会先跑完验收）。

---

## 1. R1：移除底部音乐播放栏

**决定**（已与站主确认）：整条移除；**保留自动播放与跨路由连续**；桌面端不再新增控制 UI，
音乐控制改为**只在手机内**（PHONE → NOW PLAYING 卡）。

改动：
| 文件 | 改动 |
| --- | --- |
| `features/runtime/site-runtime.tsx` | 删除 `MiniPlayer` import 与渲染 |
| `features/runtime/audio/mini-player.tsx` | **删除**（组件不再是产品的一部分） |
| `tests/runtime/mini-player.test.tsx` | **删除**（随组件一起移除） |
| `app/globals.css` | 删除 §13 全部 `.mini*` 样式 + §14（`--mini-h` 与 poll launcher 避让）；poll launcher 回归旧站 `bottom: 20px` |
| `features/phone/phone-host.tsx` | 打开手机时的 inert 选择器去掉 `[data-mini-player]` |
| `tools/acceptance/verify-viewports.py` | 移除「迷你栏可见」口径，改为断言 `底部播放栏已移除` 并计入失败项 |

不变式：唯一 `<audio data-pl-music>` 仍由 `AudioProvider` 常驻，跨路由连续测试（T02）不受影响；
音乐偏好（`pl-music`）沿用旧规则 —— 用户关过就保持静音。

## 2. R2：首页主角头像左侧的栏目「看不清」（只改字体颜色，布局还原）

**根因**：此前做对比度修正时，把 `.pm.on`（当前项）的文字改成了纸白色，并给 `::before` 加了深红底；
但当前项的可见背景是**红/纸/黑混合拼贴**，纸白字压在纸色拼贴上几乎看不见（实测 computed color = 纸白）。

**修复（仅字体，不动布局）**：
- `app/globals.css`：删掉 `.pm.on{color:paper}` 与 `.pm.on::before{red-deep}` 两条覆盖，
  当前项文字回到旧设计的黑字；中文标签改用深红（纸底 ≈7.5:1）。
- 首页 Hero 的高度、字号、间距、区块顺序**全部还原为原本的样式**（不压缩、不改顺序）。
- 原先为「首屏适配」新增的 `app/home-refresh.css` 与三套变体样式**已删除**。

验证（`tools/verify-home-refresh.py`，真实浏览器）：1440×900 / 1280×720 / 320×720 / 390×844
下当前项英文为黑字（`rgb(10,10,11)`）、中文为深红（`rgb(159,12,18)`），无横向溢出；
页面无 `data-home-variant` 标记（确认是原本布局）。

## 3. R3：9 个视觉还原界面的演示内容 + 手机 deep link

**做法**：写一条可重放、可清理、可备份的演示数据流水线；内容为**自然呈现**（不加「演示」标记，
按站主要求），清单在本交付单里，后续一次性替换。

### 3.1 演示管理员（不动 owner）
- 新建独立管理员 **`demo-seeder`**（本地分享库 `pl_test`；密码见本轮交付回复，不写入仓库）；
- `owner` 密码保持不变；种子脚本通过 `SEED_ADMIN_USERNAME=demo-seeder` 使用它。

### 3.2 一条命令灌内容：`tools/seed-demo-content.py`
```sh
# 首次（建演示管理员 + 灌内容）
SEED_ADMIN_PASSWORD='<≥12位>' python3 tools/seed-demo-content.py --create-admin
# 日常刷新
SEED_ADMIN_PASSWORD='...' python3 tools/seed-demo-content.py
# 整体替换前备份 / 回滚
python3 tools/seed-demo-content.py --backup
python3 tools/seed-demo-content.py --restore /tmp/pl-demo-backup-<ts>.sql
# 删除本脚本创建的演示条目
SEED_ADMIN_PASSWORD='...' python3 tools/seed-demo-content.py --clean
```
内部顺序：`import_legacy`（真实文章，专题发布的前提）→ `e2e-seed-previews.py`（放课后/COOP/作品/相册，
已扩量）→ `e2e-seed-journal.py --demo`（8 篇主题化手记）→ `e2e-seed-palaces.py`（4 座专题）→
`skills.seed`（技能全书 + 印象空间，代码内真实内容）。

### 3.3 内容量与演示清单（本地分享库实测）
| 界面 | 数量 | 演示内容（后续替换时按此清单删） |
| --- | --- | --- |
| 我的殿堂 | 6 件 | `phantom-log-next` / `velvet-compendium` / `ins-messaging` / `a11y-audit-toolkit` / `tokyo-roam-weather` + 原有 `p5-blog` |
| 生活图库 | 3 本相册 | 东京夜景 / 游戏截图 / 日常碎片（图用 PIL 现场生成的中性示意图，不冒充摄影作品） |
| 天鹅绒 | 9 门技能 | 新增「可访问性审计（WCAG/键盘/失败态）」「真实浏览器验收与内容种子编排」 |
| 异世界导航 | 4 座专题 | 怪盗据点工程 / 噪音与信号 / 天鹅绒之门 / 第四面墙（引用真实文章） |
| COOP | 5 条友链 | 猫与咖啡 / 深夜编译中 / 像素流浪者 / Next.js 文档 / MDN Web Docs（真实站点） |
| 放课后 | 6 条 | 赛博酒馆的第二夜 / 午夜电台与猫 / 葬送的芙莉莲 / 空洞骑士：丝之歌 / Hi-Fi Rush / Persona 5 Royal |
| 手记 | 8 篇 | 视觉还原第一屏 / 可访问性不是最后一轮 / 系统代理骗了我一次 / 隔离集群的残留进程 / 手机宿主样式表 / 悬空 aria-controls / 首页刷新 / 今天的四轩茶屋 |
| 印象空间 | 11 条 | 新增 4 条真实事故：系统代理劫持本地请求 / 手机宿主三张样式表没加载 / 悬空 aria-controls / 隔离集群残留进程 |
| IM | 2 个角色、剧本加长 | 双叶 12 节点（v1.1.0）、摩尔加纳 10 节点（v1.1.0）；新增首页应用入口、手机深链、音乐控制等话题与内容卡 |

### 3.4 手机 deep link 清单（任意页面可用）
| 目标 | URL |
| --- | --- |
| 手机桌面 | `/?phone=home` |
| IM（INS） | `/?phone=ins`；`&screen=messages` 角色列表；`&screen=conversation&item=futaba` 与会话 |
| 手记 | `/?phone=journal`；`&screen=calendar` 日历 |
| 放课后 | `/?phone=leisure`；`&screen=anime` / `game` |
| COOP | `/?phone=coop` |
| 异世界导航 | `/?phone=metanav`；`&screen=palaces|resolve|search|mugen` |
| 我的殿堂 | `/?phone=showcase`；`&screen=projects|project|photos|album`（photos/album 按设计转发 `/gallery`） |
| 天鹅绒 | `/?phone=velvet`；`&screen=book|skill` |
| 印象空间 | `/?phone=mementos`；`&screen=records|record` |
| 旧站链接 | `/?phone=palace|tokyo|cast|profile` |

无效 `phone` 会安全回退手机桌面（不白屏、不执行任意路径）。
验收脚本：`tools/verify-demo-content.py`（数据层阈值 + 8 个独立界面 + 20 个 deep link 场景）。

## 4. R4：首页排版变体（已按站主指令撤回）

曾实现 A（现状精修）/ B（杂志版）/ C（应用枢纽版）/ D（人物卡片版）四套并存排版，
由 `?home=` 切换。**2026-10-17 晚站主指令：先还原原本首页布局，只修字体**，因此：

- 已删除：`app/home-refresh.css`、`features/legacy/pages/home-variant.ts`、
  `home-app-links.ts`、`home-app-hub.tsx`、对应两个测试；
- `app/page.tsx`、`features/legacy/pages/home-hero.tsx` 已 `git checkout` 回原本版本
  （不再有 `?home` 参数、不再有 CTA/应用网格/变体分支）；
- 如需再做首页排版，按站主指定的方向单独进行（不默认展开多套变体）。

## 5. 验证与改动文件

新增脚本：`tools/seed-demo-content.py`、`tools/verify-home-refresh.py`、`tools/verify-demo-content.py`。
改动文件（最终口径）：`app/globals.css`（`.pm.on` 字体颜色）、
`features/runtime/site-runtime.tsx`（移除迷你播放器）、`features/phone/phone-host.tsx`、
`app/modules/skills/seed.py`、`features/messaging` 后端剧本/角色、种子脚本三个、
`tools/acceptance/verify-viewports.py`、`tools/verify-home-refresh.py`（重写为原本布局回归）。
`app/page.tsx`、`features/legacy/pages/home-hero.tsx` 已还原，`app/home-refresh.css` 与
A/B/C/D 变体文件已删除。

验证结果见本轮交付回复；全量验收：`bash tools/verify-all.sh --e2e`。

## 6. 边界与后续替换

- 演示内容只写本地分享库（`pl_test`）与 `MEDIA_ROOT`，不写生产；owner 密码未动；
- 后续整体替换：`--backup` 备份 → 改内容 → `--restore` 回滚，或 `--clean` 删除演示条目；
- 底部播放栏移除后：桌面没有常驻音乐控制（站主已确认接受，控制手机内完成）；
- 演示数据里的图片均为中性示意图/仓库既有封面，不引入新素材。
