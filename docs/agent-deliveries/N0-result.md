# N0 交付：实时基线、共享契约、文件所有权与最终集成（第三轮 P5 内容架构 v3）

> 任务书：`/Users/v/Documents/ChatGPT/Blog开发/docs/superpowers/plans/2026-10-17-p5-content-v3-agent-handoff.md`（第三轮 · P5 内容架构 v3）
> 项目：`/Users/学习/blog/Blogs` · 分支 `main` · 接手 HEAD `e70ad1f`（本轮未做任何 Git 历史改写）
> 状态：**阶段一（基线 + 共享契约）与最终集成（批次 C）已完成。** 本文件是第三轮集成负责人的
> 统一交付报告：第 1–5 节为基线与共享契约，第 6–8 节为验收证据与未完成项，
> **第 9 节为最终集成记录**（各任务交付索引、整合顺序、组合态验证、与并行第二轮会话的合并说明）。

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

共享契约本身不涉及素材（N6 负责）。最终集成阶段补做的外部精选库落地见 §9.4；
网站公开目录 / 构建输入 / 构建产物 / 浏览器实际下载均无明智素材（N6 两个脚本 PASS）。

## 6. 改前 / 改后截图

共享契约本身无可视变化。各功能任务的改前/改后截图与浏览器证据：

| 任务 | 证据位置（工作区外，不入库） | 说明 |
| --- | --- | --- |
| N1 导航与地图 | `.dsh/screenshots/n1-before-*` / `n1-after-*` | 五栏目、地图（含选中上野）、/posts 与归档、390/320px |
| N2 手记 | `.dsh/screenshots/n2-before-*` / `n2-after-*` | 存档列表/日历/键盘焦点/正文/返回恢复、390px、手机面板 |
| N4 图库 | `.dsh/n4-before/`、`.dsh/n4-after/`（33/33）、`.dsh/n4-after-real/`（6/6）、`.dsh/n4b-after/`（11/11） | 三视图、旧地址 308、殿堂拆分、INS 收录分区 |
| N5 过场 | `.dsh/screenshots/`（14 张 + `n5-topnav-transition.webm` 录屏） | 四类入口、跳过、兜底、320/390 |
| N6 素材 | `.dsh/screenshots/n6-*.png`（11 张）+ `n6-download-evidence.json` | 公开目录/实际下载复核 |
| N7 验收 | `.dsh/screenshots/n7-*`（36+ 张） | §8 场景浏览器证据主套件 |

## 7. 测试命令和实际结果（最终集成态）

| 命令 | 目录 | 结果（2026-10-17 最终集成实测） |
| --- | --- | --- |
| `npm run test -- --run` | `apps/web` | **88 files / 919 tests passed**，exit 0 |
| `npm run typecheck` | `apps/web` | exit 0 |
| `npm run lint` | `apps/web` | exit 0（0 error / 0 warning） |
| `npm run build` | `apps/web` | exit 0（含 `/posts`、`/gallery`、`/showcase/photos` 等 34 静态页） |
| `uv run pytest`（隔离 PG 55440，`TEST_DATABASE_URL=…/pl_test_n7`） | `apps/api` | **942 passed, 0 failed, 0 skipped**，exit 0 |
| `alembic heads` | `apps/api` | 单一 head `b7c3e9a1d2f4` |
| `verify-round3.py`（真实 Chromium + fresh build + 真实 API） | `apps/web/tools/browser-verification` | **118/118 PASS**（36 截图，335.6s） |
| `verify-round3-supplement.py` | 同上 | **11/11 PASS** |
| 图库收录生命周期管理端 E2E（真实 HTTP + 隔离 PG） | `.dsh/n7/` | **34/34 PASS**（含纯动态来源 vs 独立来源、409/412/428、幂等） |
| 迁移升/降/再升（scratch 库，用后 drop） | `.dsh/n7/` | **15/15 PASS** |
| `verify-no-akechi-assets.py` / `verify-no-akechi-downloads.py` | `tools/acceptance` | PASS 7/7；浏览器实际下载 117 个 `/assets` 无明智 |
| N3 `verify-album-moment-retract.py` | `tools/acceptance` | exit 0，33/33 断言 |

> 详细命令、执行目录、退出码与失败/跳过统计见 `N7-result.md` §7；功能 / 视觉 / 真机 / 迁移 / 资源
> 分别判定，测试通过不自动等于视觉与真机通过。

## 8. 未完成项、已知限制、恢复 / 回退说明

### 8.1 未完成 / 未验证（如实保留，不用「基本完成」替代）

1. **真机触控 / 软键盘 / 中文输入法 / 桌面缩放 / 移动 Safari 未验证**（无真机设备）。
   移动 Safari 对 VP9+alpha 的解码未知 —— 按 N5 设计会走斜切兜底（不会绿屏/黑屏），
   但 Safari 用户能否看到异世界短版仍未知。
2. **N2 手记「完整游戏存档整屏还原」视觉未通过**：参考库只有元件表、缺整屏参考帧
   （N6 独立确认），只按元件校准布局。功能与交互已通过（真实内容 E2E）。
3. **管理端 INS 收录表单的浏览器 E2E 未做**：契约/事务/公开投影已用真实管理 HTTP 端点 +
   隔离 PostgreSQL 验证 34/34；表单 UI 由 N4b 单测覆盖。
4. **原版参考帧逐像素比对未做**（P5 场景参考缺失）；视觉判定为自洽性 + 截图留存。
5. **§8.1「空列表」浏览器证据缺口**：空态由单测覆盖；种子数据每年都有记录。
6. **§8.4「新标签页不自动重播」**：headless Chromium 不产生可访问新标签页，
   只证明「点击未被拦截、本页不发起 SPA 导航」；真实新标签页需带界面浏览器/真机。
7. **外部精选库执行前**：`persona-curated/` 已在最终集成阶段一次性授权建立（见 §9.4）；
   在此之前 N6 报告的「未落地」已由附录 C 更正。

### 8.2 已知限制

* 迁移 `b7c3e9a1d2f4` 的降级会删除「没有任何独立来源」的相册显示关系；动态收录配置无法从
  旧 schema 无损恢复 —— 生产降级前必须备份（N3/N7 均已声明）。
* 图库照片游标版本 2→3，旧游标会得到 400（有意为之）。
* 异世界短版只提供 VP9+alpha 一种编码；未做 HEVC-alpha 第二格式（未验证的格式不提供）。
* 外部并行第二轮会话在第三轮期间持续提交：验收冻结基线是 `9384f29`；之后仅
  `features/runtime/scroll-memory.ts` 一处产品代码变化（对方任务，标注「修复未完成」），
  第三轮自有权重文件无变化。**上线前应在冻结 commit 上重跑验收**（见 §9.6）。

### 8.3 恢复 / 回退

* 第三轮全部改动为**新增文件 + 增量修改**，无 Git 历史改写、未 push、未部署。
* 按任务拆分回退：`git revert <该任务 commit>`；或按文件清单（各 N*-result.md §2）反向修改。
  共享契约文件（types/coordinator/phone-provider/showcase-boundary）回退会同时失效 N1/N4/N5，
  必须整体回退。
* 数据库迁移：`alembic downgrade 528a38f23614` 会删除 `album_media_sources` 并丢弃动态收录配置
  （先备份；不要在共享库试验）。
* 素材：`assets/img/icon/crow.webp`、`band-halftone.jpg` 原字节在 `.dsh/archived-assets/`，
  恢复命令见 `docs/design-references/persona-assets-removed.md`；`platinum.jpg` 旧字节同处归档。
* 异世界短版：删除 `apps/web/public/assets/clip/isekai-showcase.webm` 即自动降级为斜切兜底
  （无需改代码，`isekaiReady()` 会失败）。
* 外部精选库：删除 `persona-curated/` 整目录即可回退（不影响仓库与旧库）。

---

## 9. 最终集成（批次 C）

### 9.1 交付报告索引与组合态结果

| 任务 | 报告 | 关键结果 |
| --- | --- | --- |
| N0 集成负责人 | 本文件 | 基线、共享契约、所有权、最终集成 |
| N1 导航与地图 | `N1-result.md` | 五栏目单一配置 + 内容归属高亮；`/posts` 搜索/分类/归档 + 旧锚点；地图 13 点单一目的地配置、三入口同源、上野 `intent`；N1 自身 83 例测试 |
| N2 手记 | `N2-result.md` | 存档式列表 + 预览 + 读取 + 辅助日历 + 返回恢复；15 例新测试；跨时区日期实测 |
| N3 图库后端 | `N3-result.md` | `album_media_sources` 来源模型 + 迁移 `b7c3e9a1d2f4`（回填独立来源）；`album_links` 契约；统一公开条件；定向 200 / 全量 942 passed，0 skip；验收脚本 33/33 |
| N4 图库前端 | `N4-result.md`（N4a+N4b） | `/gallery` 三视图 + 旧 308 + 旧手机深链（不播殿堂过场）+ 殿堂只留作品；INS「同时收录到相册」+ 草稿保留 + 冲突展示；24 files / 254 tests |
| N5 殿堂过场 | `N5-result.md` | 1.5s VP9+alpha 短版（242,439 B，`a716f8e8…`）；共享协调 + 跳过（点击 42ms / Esc 16ms 提交）+ 兜底；浏览器 41/41（其自测） |
| N6 素材 | `N6-result.md` | 移除 3 处含明智资源（可恢复归档）、图标替换、迁移防再生；三份清单 + 171 行哈希 CSV；两复验脚本 PASS；外部精选库已由 §9.4 补落地 |
| N7 验收 | `N7-result.md` | 冻结 `9384f29`：前端 919 / 后端 942（0 skip）/ 浏览器 118+11 / 生命周期 E2E 34 / 迁移 15 |

**组合态最终实测（2026-10-17 最终集成，HEAD ≈ `a68b2b9` 时复跑）**

| 检查 | 结果 |
| --- | --- |
| `npm run test -- --run` | **88 files / 919 tests passed** |
| `npm run typecheck` / `npm run lint` | 0 / 0 |
| `npm run build` | exit 0（/posts、/gallery、/showcase/photos 等 34 静态页） |
| `verify-no-akechi-assets.py` | PASS 7/7（扫描 2566 个产物文件） |
| `git diff --name-only 9384f29..HEAD -- apps/api` | 空（后端与契约自冻结以来未变，N3/N7 的 942 结论仍适用） |

### 9.2 第三轮提交清单（本地 commit，未 push、未部署）

```text
bfdf79e feat(round3): N0 共享契约 —— 导航意图 / 手机提交完成信号 / 异世界短版优先级
be6c62b feat(round3): N2 手记存档式列表 + 预览 + 读取入口 + 辅助日历
bda6c54 feat(round3): N4a 统一生活图库 /gallery + 旧照片深链 + 殿堂只留作品
2edb34f feat(round3): N5 殿堂异世界短过场（1.5s 短版 + 共享协调 + 跳过/兜底）
7d70f79 feat(round3): N6 无明智活动素材库（图标替换 + 三份清单 + 实际下载复验）
edaf14a feat(round3): N3 图库来源模型 + album_links 契约 + 统一公开条件 + 迁移
094d9a2 feat(round3): N1 五栏目导航 + 独立文章索引 /posts + 地图单一目的地配置
afc51e3 fix(round3): 统一「情报档案」命名（首页菜单 / 404 / 手机情报入口）
e02dec6 feat(round3): N4b INS「同时收录到相册」+ 草稿保留 + 冲突/失败展示
1a04c56 test(round3): N7 验收工具与报告（浏览器 118+11 项、生命周期 E2E、迁移复验）
+ 本报告/精选库文档更新提交
```

### 9.3 与并行第二轮会话（P0–P6）的合并复核

第三轮期间同一仓库有**另一个会话**在持续完成第二轮（手机 UI v2）收尾，共 40+ 提交。
集成负责人逐项复核后的结论：

| 对方改动 | 与第三轮的关系 | 复核结论 |
| --- | --- | --- |
| P1 第三部分：迷你播放器 + 手机内斜屏 | 第二轮 dirty 文件在 N0 接手时已由对方提交（`01d9fe0`） | 未回退；N0 改 phone/pro干系文件时保留其行；前端测试中相关用例全绿 |
| P2：IM 会话详情菜单 | 无关模块 | 无冲突；globals.css 增量与 N5 追加段共存 |
| P3：journal/leisure 图片失败占位 | 与 N2 同文件 | N2 增量编辑保留其 `.thumbFailed` / `.figureFailed` 与 `ReadingFigure`；冲突为零 |
| P0：sprite 提取/头像核对（docs+tools） | 素材参考 | 与 N6 结论互相印证；图标身份核对仍未完成（属第二轮缺口） |
| 第 8/11 轮集成快照 + T02 导航用例适配 | 验证工具 | 对方把 T02 的 `weather` 用例改为 `posts` 以适配第三轮五栏目，**方向一致**；组合态 T02 52/52（对方实测） |
| P6 验收脚本（多视口/静态资源/图标/一键验收） | 验证工具 | 与 N7 套件互补；`verify-round3.py` 独立不依赖 |
| 后续 phone/journal/ins 滚动与草稿修复 | 无关模块 | 未触碰第三轮权重文件；`9384f29..HEAD` 仅 `features/runtime/scroll-memory.ts` 一处产品代码变化 |

**结论**：第三轮与第二轮改动在同一工作树中**共存且互不覆盖**；未发现整文件覆盖、回退或缺口。
对方的 T02/取数审计在组合态通过，与 N7 的 118+11 项独立套件互相印证。

### 9.4 外部精选素材库最终落地

N6 因 `workspace-write` 沙箱无法写入工作区外的目标目录。最终集成阶段由集成负责人以**单次审批**
执行 `Blogs/.dsh/build-curated-library.py`，已建立：

```text
/Users/v/Documents/ChatGPT/Blog开发/assets/reference/persona-curated/
├── README.md / INDEX.md
├── provenance/{hashes.json, sources.json, allowlist.md, excluded-audit.md, removed.md, asset-manifest.csv}
├── hud/（6 个已复核界面参考帧）
└── media/{image/crowd-92512.zip, video/（2 个过场候选原样）}
```

- 9 个文件 / 37,695,628 字节，逐字节复制、未重编码、未 AI 重绘；**9/9 SHA-256 复算一致**。
- 许可状态统一「未核实」；排除审计为纯文字、不嵌入角色图片。
- 旧库 `persona5-spriters/`、`persona-dist/` 与原始采集包**未移动、未删除**；新库不进入网站构建。
- 回退：删除 `persona-curated/` 整目录即可。
- 记录：`docs/design-references/persona-curated-plan.md` §6、`N6-result.md` 附录 C。

### 9.5 按维度判定（不互相替代）

| 维度 | 结论 | 依据 |
| --- | --- | --- |
| 功能 | **通过**（本轮范围） | N7 浏览器 118+11、生命周期 E2E 34、前端 919、后端 942（0 skip） |
| 视觉 | **部分通过 / 有明确未通过项** | 截图证据齐全、自洽性检查通过；N2「完整存档整屏还原」未通过（缺参考帧），未做逐像素比对 |
| 真机 | **未验证** | 无真实触控设备；Safari VP9+alpha 解码未知（有斜切兜底） |
| 迁移 | **通过（隔离库）** | 9/9 迁移、单一 head、回填 3/3、降/再升幂等、权限断言；降级限制已声明 |
| 资源 | **通过** | 公开目录/构建输入/产物/实际下载无明智；crowd 12/12；三份清单齐全；精选库已落地 |

### 9.6 上线前建议（未执行，属后续动作）

1. 在一个**冻结 commit** 上重跑 `.dsh/n7/setup_stack.sh all` + `verify-round3.py` +
   全量 `test`/`pytest`（并行会话仍在提交，本报告结论绑定 `9384f29` 及之后的非第三轮代码变化）。
2. 真机：触控目标 ≥44px、斜屏四角/滑杆两端、软键盘与中文输入法、移动 Safari（含 VP9+alpha）。
3. 补齐 P5 存档整屏参考帧后做一次手记视觉轮。
4. 管理端 INS 收录表单的浏览器 E2E（真实登录 + 新建相册返回草稿）。
5. 部署按 `docs/operations/release.md`：先备份、在隔离库跑迁移、不得在共享库试验降级。

### 9.7 结论

第三轮 N0–N7 全部交付：五栏目导航与内容职责、独立文章索引、地图单一目的地配置、生活图库
与 INS 收录联动（来源级撤回与统一公开条件）、不含明智的活动素材库、以及「我的殿堂」异世界
1.5 秒短过场均已实现，并有可复跑的命令/截图/迁移/浏览器证据。功能、迁移与资源维度通过；
视觉整屏还原、真机与部分浏览器 UI 证据按 §8.1 如实标注为未通过/未验证，不宣称全部验收通过。
