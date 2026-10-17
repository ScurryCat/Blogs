# P4 首页刷新 + 演示内容 + 移除底部音乐栏（用户验证反馈 4 项）

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

## 2. R2：首页主角头像左侧的栏目「看不清」

**根因（两个叠加）**：
1. 我们此前做对比度修正时把 `.pm.on` 的文字改成了纸白色，并给 `::before` 加了深红底 ——
   但当前项的可见背景是**红/纸/黑混合拼贴**，纸白字压在纸色拼贴上就几乎看不见（实测 computed color = 纸白）；
2. 旧站 Hero 标题是 `clamp(76px, 11.5vw, 172px)`、Hero 固定约 1086px 高：
   1024×768 有 3 项、1280×720 有 4 项、1440×900 有 2 项**被挤出首屏**；
   加上底部播放栏遮挡，观感就是「栏目根本看不清」。

**修复**：
- `app/globals.css`：删掉 `.pm.on{color:paper}` 与 `.pm.on::before{red-deep}`；当前项文字还原黑字，
  仅小号中文标签用深红（纸底 ≈7.5:1）；非当前项中文标签略提亮。
- 新增 `app/home-refresh.css`：Hero 高度改为 `calc(100svh - hud)` 上限、收紧菜单字号/偏移/提示；
  对 **短屏（≤860px 高）** 单独压缩标题（44–104px）、lead 与菜单项 —— 大屏不受影响。
- 验证（`tools/verify-home-refresh.py`，真实浏览器）：

| 视口 | 栏目数 | 首屏外 | 与主角图重叠 | 横向溢出 |
| --- | --- | --- | --- | --- |
| 1024×768 | 5 | 0 | 0 | 0 |
| 1280×720 | 5 | 0 | 0 | 0 |
| 1440×900 | 5 | 0 | 0 | 0 |
| 1728×1080 | 5 | 0 | 0 | 0 |
| 320 / 390 | 5 | （正常滚动） | 0 | 0 |

当前项实测：英文 `rgb(10,10,11)`（黑字）、中文 `rgb(159,12,18)`（深红）。

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

## 4. R4：首页三套排版（待你选择）

默认仍是 **A（现状精修）**；三套并存，用 `?home=` 切换：

| 变体 | URL | 排版 |
| --- | --- | --- |
| A 现状精修 | `/`（或 `/?home=a`） | 保留现有顺序，只修 Hero 可读性/首屏与节奏 |
| B 杂志版 | `/?home=b` | Hero 紧凑（左文右图、菜单两列）+「最新文章 / 精选作品」两栏摘要 |
| C 应用枢纽版 | `/?home=c` | Hero 短版（3 个 CTA）+ 9 个视觉还原应用入口网格 + 两栏摘要 |
| D 精修·人物卡片版 | `/?home=d` | A 的区块顺序不变；主角卡片收小到约 1/3 屏宽、贴右缘、垂直居中，左侧留更多黑场 |

三套都保留：Ticker、CallingCard（`id="latest"`）、LeblancView、最新文章（`id="posts"`）、
精选作品、归档（`id="archive"`），保证旧锚点与数据失败态不变；移动端单列/网格 3→2 列。
截图（1440×900 与 390×844）由 `tools/verify-home-refresh.py` 输出到
`.dsh/screenshots/home-refresh/`（`home-{a,b,c,d}-{desktop,mobile}.png`）。

**待办**：站主选定后，把所选变体设为默认并移除未选的切换参数（下一轮）。

## 5. 验证与改动文件

新增脚本：`tools/seed-demo-content.py`、`tools/verify-home-refresh.py`、`tools/verify-demo-content.py`。
改动文件：`app/page.tsx`、`app/home-refresh.css`（新增）、`app/globals.css`、
`features/runtime/site-runtime.tsx`、`features/legacy/pages/home-hero.tsx`、
`features/legacy/pages/home-index.tsx`（无改动但复用）、`features/legacy/pages/home-variant.ts`（新增）、
`home-app-links.ts`（新增）、`home-app-hub.tsx`（新增）、`features/phone/phone-host.tsx`、
`features/messaging` 后端剧本/角色、`app/modules/skills/seed.py`、种子脚本三个、
`tools/acceptance/verify-viewports.py`、新增测试 `tests/navigation/home-variant.test.ts`、
`tests/navigation/home-app-hub.test.tsx`。

验证结果见本轮交付回复；全量验收：`bash tools/verify-all.sh --e2e`。

## 6. 边界与后续替换

- 演示内容只写本地分享库（`pl_test`）与 `MEDIA_ROOT`，不写生产；owner 密码未动；
- 后续整体替换：`--backup` 备份 → 改内容 → `--restore` 回滚，或 `--clean` 删除演示条目；
- 底部播放栏移除后：桌面没有常驻音乐控制（站主已确认接受，控制手机内完成）；
- 演示数据里的图片均为中性示意图/仓库既有封面，不引入新素材。
