# P0 阶段一交付报告：素材与视觉基线 + 斜屏命中修复方向

> 任务书：`2026-10-17-p5-phone-ui-v2-agent-brief.md`（P0 = 素材与视觉基线，阶段一）
> 执行日期：2026-10-17 · 项目 `/Users/学习/blog/Blogs` · 起点 `de008df`（工作区干净，与远端一致）
> 执行方式：本报告为集成负责人直接完成阶段一（未分发子 agent）。

## 1. 完成范围

| 任务书条目 | 结果 |
| --- | --- |
| 阶段一 · 核对项目、工作区和现有行为，保存改前截图 | ✅ 现场核对（分支/提交/工作区/远端一致）；10 张改前截图 |
| 阶段一 · 建立原版参考清单和图标映射，记录尚缺参考帧 | ✅ 清单与映射表见 `docs/design-references/icon-mapping.md`；缺口已列 |
| 阶段一 · 固定中文正文、英文标题及共享操作反馈规范 | ✅ 见 `docs/design-references/typography-and-feedback.md` |
| 阶段一 · 用实际控件复现斜屏命中问题，验证修复方向 | ✅ 已复现并钉死根因，**修复方向已验证**（见第 3 节） |
| §2.3 图标映射表字段（ID/名称/用途/原图路径/版本/来源/裁切/前端路径/原版或适配/许可） | ✅ 表已建；**sprite 身份核对未做**（模型无图像输入，见第 6 节） |

## 2. 修改文件

**新增（未提交前）**：

| 文件 | 内容 |
| --- | --- |
| `docs/design-references/icon-mapping.md` | 图标映射表 + 参考帧清单 + 提取说明 |
| `docs/design-references/typography-and-feedback.md` | 字体与共享操作反馈规范 |
| `docs/agent-deliveries/P0-result.md` | 本报告 |
| `.dsh/p0-analysis/`（**不入库**，本地分析产物） | 119 个提取 sprite + 3 份坐标 JSON |
| `.dsh/p0-before/`（**不入库**） | 10 张改前截图 |

**未修改任何前端源码**：本轮只做基线，不动 `features/` 与样式。共享文件变更请求见第 7 节。

## 3. 斜屏命中问题：复现 + 根因 + 修复方向（本报告核心）

### 3.1 测量方法（保证结论干净）

- 本地静态服务不支持 Range（历史遗留），「点击后 seek 是否到位」会被 seek 重置污染 → **弃用**。
- 改用两个与 Range 无关的判据：
  1. `elementFromPoint` 在控件盒内 8%/25%/50%/75%/92% 五点的**命中身份**；
  2. 真实鼠标在条两端按下时，控件**是否收到 pointerdown**（capture 监听）。
- 视口 1440×900（对应 `--z=.88` 档）。

### 3.2 结果（全部实测）

| 变体 | 进度条命中 | 音量条命中 | 两端按下投递 |
| --- | --- | --- | --- |
| 现状（`.pw` zoom + `.pw-screen` matrix3d） | **1/5 ✗** | 2/5 ✗ | ✗/✗ |
| A 去 zoom，保留 matrix3d | 1/5 ✗ | 3/5 ✗ | ✗/✗ |
| B 保留 zoom，屏幕 transform:none（压平） | 5/5 ✓ | 5/5 ✓ | ✓/✓ |
| C 去 zoom + 压平 | 5/5 ✓ | 5/5 ✓ | ✓/✓ |
| D 去 zoom 改 `.pw` scale，保留 matrix3d | 1/5 ✗ | 3/5 ✗ | ✗/✗ |
| E 同上 + matrix3d 去透视项（纯仿射） | 1/5 ✗ | 1/5 ✗ | ✗/✗ |
| F zoom:1 + 2D `matrix()` | 1/5 ✗ | 1/5 ✗ | ✗/✗ |
| G zoom:1 + 2D **函数**（`rotate() skewY() scale() translate()`） | 5/5 ✓ | 5/5 ✓ | ✓/✓ |
| H 保留 zoom + 2D `matrix()` | 1/5 ✗ | 1/5 ✗ | ✗/✗ |
| I 去 zoom 改 `.pw` scale + 2D matrix | 1/5 ✗ | 1/5 ✗ | ✗/✗ |
| J zoom + 精确函数分解 | 2/5 ✗ | 2/5 ✗ | — |

### 3.3 结论（按证据强度排序）

1. **`matrix3d` / `matrix()` 的序列化写法必然破坏命中** —— 连去掉透视项的纯仿射 `matrix3d`（E）
   与 2D `matrix()`（F/H/I）都坏 ✗。这是 Chrome 命中路径对「矩阵形式变换」的缺陷，不是数值问题。
2. **`zoom` 不是主因，但参与**：zoom + 压平（B）完全正常 ✓，zoom + 函数分解（J）仍坏 ✗ ——
   斜切（skewY）元素**只要有任何变换形式的祖先**（zoom 或 transform）就不可靠。
3. **唯一全绿的组合**：无变换祖先 + 单层 2D **函数**形式变换（G，5/5 + 双端投递 ✓）。
4. 因此修复方向（供 P1 实现）：
   - 去掉 `.pw` 上的 `zoom`；外壳缩放改由**无交互元素的 transform**（框架图等）承担；
   - 屏幕的倾斜从 `matrix3d` 改写为**精确的 2D 函数分解**（已给出，重组误差 2e-16）：
     `rotate(-6.7145deg) skewY(2.6672deg) scale(1.1506, 1.2188) translate(269.4px, 8.6px)`
   - 屏幕的缩放并入同一层变换（`scale(…×z, …×z)`），保证屏幕元素**没有变换祖先**；
   - 滑杆计算沿用线性假设的前提是命中正确 —— 本方向命中正确后无需再写逆映射。
5. **任务书否定的方案确认无效**：压平面板（B/C）虽全绿，但违反 §2.1（不得直立矩形），
   本轮**不采用**，仅作为根因证据。

## 4. 素材与参考

- 参考库根：`/Users/v/Documents/ChatGPT/Blog开发/assets/reference/`（**源库未改动**）。
- 任务书点名的 4 个本地文件**全部存在**（`132782-im-assets-cn-jp.png` 2560×768、
  `92141-profile-pictures.png` 1024×512、`p5r-sns--4aa5330b1fe6.jpg`、`92865-tutorials.png` 6274×2670）。
- 额外发现：`persona-dist/reference-books/p5-assets 5/official/design-works/` 有 **P5 官方设定集**
  （PDF + 200dpi 页扫）；`92093-confidant-icons`、`92120-calendar`、`132783-photos-im`、
  `134224-buttons-icons`、`92510-maps.zip`（已解包）可作为各 App 的母版来源。
- **提取**：按钮表 19 个、IM 元件表 82 个、头像表 50 个 sprite 已切出并记录 `bbox` 坐标
  （`.dsh/p0-analysis/*-report.json`）。方法可复现（RGBA 连通域 + 噪点过滤）。

## 5. 视觉证据

| 截图 | 状态 | 视口 |
| --- | --- | --- |
| `.dsh/p0-before/phone-home.png` | 手机桌面（当前 10 磁贴单页，非本轮要求的两页 6+4） | 1440×900 |
| `phone-desktop-scrolled.png` | 桌面滚动后 | 1440×900 |
| `phone-ins.png` / `phone-im.png` | INS 图文 / 消息 | 1440×900 |
| `phone-journal.png` / `phone-leisure.png` / `phone-coop.png` | 手记 / 放课后 / 协助者 | 1440×900 |
| `phone-showcase.png` / `phone-metanav.png` | 殿堂 / 导航 | 1440×900 |
| `home-desktop.png` | 博客首页（对照） | 1440×900 |

> 截图只能证明对应状态；本轮执行模型**无图像输入**，未做截图内容核对，仅存档供复核。

## 6. 未完成项（如实列明）

| 缺口 | 影响 | 后续行动 |
| --- | --- | --- |
| **提取 sprite 的身份核对**（哪个 sprite 是哪个图标/头像） | 映射表只能给到「有元件 + 坐标」，不能接入前端 | 图像能力复核后回填 `icon-mapping.md` |
| **异世界导航经典红眼图标**本地未确认独立原图 | `metanav` 图标无法按原版落地 | 继续定位 megatenwiki 等可追溯来源 |
| **IM 普通文字帧与回复选择帧缺失** | §8.1 相应状态只能标「参考未补齐」 | 素材负责人补齐；视频来源记链接与时间点 |
| 大表未提取（confidant/calendar/photos-im/minigames/shops） | journal/leisure/coop/showcase 素材待取 | P0 后续轮次按同法提取 |
| 命中修复**方向已验证、未实现** | 滑杆在斜屏上仍不可用（现状 1/5） | P1 按第 3.3 节架构实现并回归 |
| 真机 / 浏览器缩放档验证 | §8.2 | P6 集成阶段 |

## 7. 集成说明

- 本轮**未改任何共享文件**；P1 将修改 `features/phone/`（`phone-host/desktop/music-card` 与样式），
  按第 3.3 节的变换架构实施，改前请先读本报告第 3 节与 `typography-and-feedback.md` §3。
- P2 提取的 IM 参考与 sprite 身份核对结果**先交 P0 合并**进 `icon-mapping.md`。
- 前端图标切换点仍为 `features/phone/phone-desktop.tsx`（`ICON_STYLE`）与 `app-icons.tsx`；
  新图标就绪前保持现状。
