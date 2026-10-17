# P4 首页刷新 + 演示内容 + 移除底部音乐栏（用户验证反馈 4 项）

> **2026-10-17 晚·站主追加指令（最终口径）**：
> 1) 首页布局保持原本样子（A/B/C/D 变体与 `?home` 已撤回）；
> 2) 去掉「PHANTOM LOG」下方「怪盗手记」的**红色背景方块**，其余撕纸贴纸保留；
> 3) 打开首页**不需要滚动**即可完整看到人物卡片 + 左侧 5 个选择栏（常见桌面视口）。
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

## 2. R2：「怪盗手记」红底去除 + Hero 首屏完整显示

### 2.1 红底来源与修复
- 根因：`app/globals.css` 对比度修正里的**通用 `.cn`** 规则（`.cn, .sec-h .cn, .cal-wd.we`）
  把「怪盗手记」（`<span class="cn rn">`）也刷上了深红底（实测 `rgb(168,12,20)`）。
- 修复：收窄为 `.sec-h .cn, .cal-wd.we`；Hero 里的「怪盗手记」背景变透明，撕纸纸色/黑色贴纸保留；
  区块徽标（最新文章/情报档案/五维…）仍是深红底（对比度修复不回退）。
- 当前项文字颜色仍是此前的修复：英文黑字 + 中文深红。

### 2.2 首屏完整显示（人物卡 + 左侧 5 个栏目，不需要滚动）
原布局 `.hero` 自带 `padding-bottom:70px`、`.hero-in` 按 `max(680,100svh)-hud-100` 定高，
1440×900 下 Hero 高 1086、人物卡 bottom 1034、第 4/5 个栏目 bottom 903/973，都需要滚动。

修复（`app/globals.css` 新增 15.4 节，仅 ≥901px 桌面生效）：
- `.hero { min-height:100svh; padding-bottom: clamp(8px,1.2svh,18px) }`；
- `.hero-in { max-height: calc(100svh - hud - 30px - clamp(8px,1.2svh,18px)); align-items:center }`；
- 标题/lead/菜单/提示统一用 `min(·vw, ·svh)` 做高度自适应（矮屏优先按高度收）；
- 人物卡 `img { height: min(740px, calc(100svh - hud - 190px)); object-fit:cover }`
  —— 只缩高度，宽度/相框/旋转/裁切与 `TAKE YOUR HEART` 标注不变形。

实测（生产构建 `next start`，不含 HUD 外的滚动）：

| 视口 | Hero bottom | 人物卡 bottom | 第 5 个栏目 bottom | 结论 |
| --- | --- | --- | --- | --- |
| 1024×768 | 768/768 | 628 | 613 | 全部首屏可见 |
| 1280×720 | 720/720 | 620 | 651 | 全部首屏可见 |
| 1366×768 | 768/768 | 662 | 686 | 全部首屏可见 |
| 1440×900 | 900/900 | 760 | 749 | 全部首屏可见 |
| 1536×864 | 864/864 | 738 | 742 | 全部首屏可见 |
| 1600×900 | 900/900 | 763 | 756 | 全部首屏可见 |
| 1728×1080 | 1080/1080 | 856 | 825 | 全部首屏可见 |
| 1920×1080 | 1080/1080 | 856 | 825 | 全部首屏可见 |

手机（≤900 宽）维持原有上下滚动布局（本次未强行塞进一屏）；所有视口无横向溢出。

> 对比度审计说明：`audit-contrast.py` 会把 `.pm.on` / `.pm-c` 报成低对比度，
> 原因是它看不到 `::before/::after` 纸片背景（把祖先黑底当背景）——实际是黑字/深红字压在纸色贴纸上
> （≈16:1 / ≈7.5:1）。这是工具已知假阳性，不是回归。

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
