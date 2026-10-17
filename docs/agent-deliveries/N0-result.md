# N0 交付（阶段一）：实时基线、共享契约与文件所有权

> 任务书：`/Users/v/Documents/ChatGPT/Blog开发/docs/superpowers/plans/2026-10-17-p5-content-v3-agent-handoff.md`（第三轮 · P5 内容架构 v3）
> 项目：`/Users/学习/blog/Blogs` · 分支 `main` · 接手 HEAD `e70ad1f`（本轮未做任何 Git 历史改写）
> 状态：**阶段一（基线 + 共享契约）已完成；本文件在最终集成时补全第 6 / 7 / 8 节的实际证据。**

## 1. 实际基线（2026-10-17 交接时现场读取）

```text
分支            main（ahead origin/main 6，不推送、不部署）
HEAD            e70ad1f feat(phone): 应用内恢复手持斜屏（去掉直立矩形，任务书 §2.1）
工作区          dirty（见下表，属第二轮进行中的工作，全部保留）
迁移 head       528a38f23614（T09 skills & exploration，单一 head，34 张表）
本机 PostgreSQL 18.6 @ 127.0.0.1:55432（用户 pl，trust）
Node 26.8.1 / npm 11.19.0 / Python 3.13 + uv 0.9.18 / ffmpeg 6.x
```

接手时的未提交修改（**N0 只追加必要行，不回退**）：

| 文件 | 归属 | 处理方式 |
| --- | --- | --- |
| `apps/web/app/globals.css` | 第二轮迷你播放器 | 保留；本轮除 N5 的过场样式追加外不再改动 |
| `apps/web/features/phone/phone-host.tsx` | 第二轮迷你播放器 inert | **保留原有 `[data-mini-player]` 行**，本轮未回退 |
| `apps/web/features/runtime/site-runtime.tsx` | 第二轮迷你播放器挂载 | 保留 |
| `apps/web/features/runtime/audio/mini-player.tsx`（未跟踪） | 第二轮 | 保留，纳入本轮构建 |
| `apps/web/tests/runtime/mini-player.test.tsx`（未跟踪） | 第二轮 | 保留 |

第二轮任务书中未完成项（P1-part2 报告 §5：原版图标、卡片精修、桌面迷你播放器视觉、
多视口复验）继续由本轮后续阶段顺带核对，不因本轮新增而回退。

### 1.1 基线测试（改动前实测）

| 命令 | 目录 | 结果 |
| --- | --- | --- |
| `npm run test -- --run` | `apps/web` | **70 files / 719 tests passed**，exit 0 |
| `TEST_DATABASE_URL=postgresql+psycopg://pl@127.0.0.1:55432/pl_test uv run pytest` | `apps/api` | **911 passed**，exit 0（真实 PostgreSQL，无 skip） |
| `npm run typecheck` | `apps/web` | exit 0 |
| `npm run lint` | `apps/web` | exit 0 |

### 1.2 隔离测试库（本轮专用，不与历史任务共用）

| 库 | 用途 |
| --- | --- |
| `pl_test_n3` | N3 图库来源模型 / 迁移升回退验证 |
| `pl_test_n7` | N7 集成回归与迁移证据复验 |
| `pl_test`（既有） | 日常 `pytest` 基线；N0 只读使用 |

禁止把共享开发库 URL 当测试 URL；禁止 SQLite 冒充 PostgreSQL。

## 2. 本阶段已实现的需求（共享契约，代码已落地）

任务书 §6.2、§7.1 N0/N5「导航意图、手机提交完成信号、统一效果及行为测试」中的
**契约与决策部分**由 N0 统一落地（实际媒体与接线由 N5 接着做）：

| 需求 | 落点 |
| --- | --- |
| 导航 `intent` 可选字段（不替换来源） | `features/phone/types.ts`：`NavigationIntent = "enter-showcase"`；`NavigationRequest.intent?` |
| 效果优先级：减少动效 → 直接提交；明确进入殿堂 → 异世界短版；其余 → 来源规则 | `features/runtime/navigation/coordinator.tsx`：`effectPlan(source, driver, intent?)` |
| 一次导航只播一套主效果（意图优先时不串播人群/Joker） | 同上：意图分支只返回 `["isekai","wipe"]` |
| 短版 1–2 秒、默认 1.5 秒 | 同上：`ISEKAI_WAIT_MS=1500`、`ISEKAI_MIN_MS=1000`、`ISEKAI_MAX_MS=2000`，`waitForEffect` 夹取 |
| 短版未就绪 / 失败 → 斜切兜底继续进入 | 同上：`hasIsekai()+isekaiReady()` 不满足时只走 `wipe` |
| 手机目标提交完成信号（pathname 不变也能结束过场） | 同上：`NavigationCoordinator.commitPhoneTarget(state)`；`PhoneProvider` 在手机状态落定时上报 |
| 可用的跳过操作（任务书 §6.3/§8.4） | `NavigationCoordinator.skip()`：立即提交本次目标地址，视觉在完成信号后统一收起；无进行中导航时 no-op |
| 只改查询串的提交也能收尾（如 `/posts?view=archive`） | 同上：push 后按令牌做有限次地址核对（20×100ms），不依赖 `usePathname` 变化；仍受 15 秒看门狗兜底 |
| `openApp` 同样经过共享过场协调器 | `features/phone/phone-provider.tsx`：`pushState(..., { intent })` 走 `navigation.navigate`，历史深度在状态提交后才记 |
| 主动跨入殿堂边界的判定（不是「监听到 /showcase 就播放」） | 新增 `features/runtime/navigation/showcase-boundary.ts`：`isShowcasePath` / `isInsideShowcase` / `showcaseEntryIntent` |
| 旧照片深链 `/showcase/photos` 不算殿堂边界 | 同上：`SHOWCASE_LEGACY_PREFIXES` |
| `palaces` 等既有内容路径不因名字自动归为作品集 | 同上 + 契约测试 |
| 顶部导航 / 外部入口可显式声明意图 | `features/runtime/navigation/link-guard.ts`（`navigationRequestFromClick` 增加可选 `intent`）、`site-link.tsx`（`SiteLinkProps.intent`） |

### 2.1 关键设计决定（供 N1/N4/N5 统一使用）

1. **意图是「增强」不是「来源替换」**：`source` 原语义与所有既有来源规则完全不变；
   `intent` 只在效果选择时提高优先级，不改 href、不改历史、不改子页面高亮。
2. **调用方显式声明 + 边界自动兜底**：`navigate()` 在 `request.intent` 缺省时调用
   `showcaseEntryIntent()` 从「目标路径 + 当前是否在殿堂内部」推导。这样顶部导航、地图、
   手机图标、首页卡片、作品详情等外部入口即使漏标也会得到一致的殿堂短过场；
   已经在殿堂内部（页面在 `/showcase/**`，或手机停在 `showcase` 应用）则**不产生意图**，
   因此切换作品、回列表、展开同一内容不会重播。
3. **手机完成信号只认「期望目标」**：`pendingRef.phone` 记录本次导航期望的
   `{phone, screen, item}`，`commitPhoneTarget()` 只在完全一致时结束过场；
   晚到的错误回调不能误清进行中的任务。页面路由导航仍由 `usePathname()` 变化结束。
4. **`TransitionDriver` 增加异世界短版槽位**：`hasIsekai / isekaiReady / playIsekai /
   stopIsekai / isekaiWait`。N0 在 `transition-layer.tsx` 只落地「未就绪」的安全契约实现
   （回退斜切，永不黑屏）；**真实媒体与播放由 N5 在该文件内替换实现**，双方不重复做「最终版」。

## 3. 新增 / 修改的接口、字段、路由、迁移

| 类型 | 变化 |
| --- | --- |
| 前端类型 | `NavigationIntent`；`NavigationRequest.intent?`；`TransitionKind` 增加 `"isekai"`；`TransitionDebug.intent`；`TransitionDriver` 增加 5 个 isekai 方法；`NavigationCoordinator.commitPhoneTarget()` / `skip()`；`SiteLinkProps.intent` |
| 常量 | `ISEKAI_WAIT_MS=1500` / `ISEKAI_MIN_MS=1000` / `ISEKAI_MAX_MS=2000` |
| 路由 | 本阶段**不新增**（`/posts`、`/gallery` 由 N1/N4 交付） |
| 数据库迁移 | 本阶段**无**（N3 负责） |
| 后端接口 | 本阶段**无**（N3 负责） |

## 4. 与其他任务的依赖与共享文件集成

**共享热点（本轮由 N0 统一落地；其他任务不直接改，需要改动先通知 N0）：**

| 文件 | 本阶段处理 | 后续归属 |
| --- | --- | --- |
| `features/phone/types.ts` | 已加 intent | N0（冻结） |
| `features/runtime/navigation/link-guard.ts` / `site-link.tsx` | 已加 intent 透传 | N0（冻结） |
| `features/runtime/navigation/showcase-boundary.ts` | 新增 | N0（冻结） |
| `features/runtime/navigation/coordinator.tsx` | 已加 intent / isekai / 手机完成信号 | N0（冻结，N5 只读使用） |
| `features/phone/phone-provider.tsx` | 已接到场协调器 + 完成信号 | N0（冻结） |
| `features/runtime/navigation/transition-layer.tsx` | 只加安全契约实现 | **移交给 N5** 填真实短版 |
| `apps/web/app/globals.css` | 未改动 | **移交给 N5** 追加过场样式；其他任务一律不改，用自身 CSS |
| `features/phone/phone-host.tsx` / `site-runtime.tsx` | 未改动（保留第二轮 dirty 行） | N0 |
| `apps/web/package.json` / 锁文件 / 依赖 | 不新增依赖 | N0 |

**契约测试**：`apps/web/tests/runtime/showcase-intent.test.tsx`（**23 例**）已覆盖边界判定、
效果优先级、时长夹取、手机完成信号、跳过（立即提交 / 无导航时 no-op）、查询串提交收尾、
取消与连点。N5 在此基础上补「媒体就绪/播放失败」的真实
驱动测试与浏览器证据；N7 在验收阶段复跑。

## 5. 素材

本阶段不涉及素材（N6 负责）。

## 6. 改前 / 改后截图

本阶段为契约改动，无可视变化；截图证据由 N1 / N2 / N5 / N7 在各自交付中提供。

## 7. 测试命令和实际结果

契约改动后实测（2026-10-17）：

| 命令 | 目录 | 结果 |
| --- | --- | --- |
| `npm run test -- --run` | `apps/web` | **71 files / 742 tests passed**（新增 23 例契约测试），exit 0 |
| `npm run typecheck` | `apps/web` | exit 0 |
| `npm run lint` | `apps/web` | exit 0 |
| `uv run pytest`（`TEST_DATABASE_URL=…/pl_test`） | `apps/api` | 未受前端改动影响；N3 起复跑 |

## 8. 未完成项、已知限制、恢复 / 回退说明

* 本文件第 6 / 7 / 8 节将在最终集成（批次 C）补全：全量回归、浏览器证据、真机证据、
  迁移升回退、资源复核结果与未完成项。
* 异世界短版**实际媒体尚未接入**（N5）；当前意图导航落到斜切兜底 —— 这是安全降级，
  不是验收通过。
* 手机宿主 `openApp` 的殿堂意图目前按「手机目标提交」结束；若 N5 的短版时长与手机提交
  顺序在真实浏览器里出现竞态，由 N5 + N7 用浏览器证据修正，不改这里的契约语义。
* 回退方式：本阶段改动集中在上述 6 个前端文件与 1 个新增文件，全部可用
  `git checkout -- <file>`（前提是先把第二轮 dirty 文件单独保存）恢复；无数据库迁移，
  无破坏性副作用。
