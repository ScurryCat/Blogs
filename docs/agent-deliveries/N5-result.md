# N5 交付：殿堂「异世界短过场」——1.5 秒 VP9+alpha 短版、共享协调接线、跳过与失败兜底

> 任务书：`/Users/v/Documents/ChatGPT/Blog开发/docs/superpowers/plans/2026-10-17-p5-content-v3-agent-handoff.md`（第三轮 · P5 内容架构 v3）§6 / §7.1 N5 / §7.4 / §8.4 / §9
> 项目：`/Users/学习/blog/Blogs` · 分支 `main` · 未做任何 `git commit / push / deploy`
> 状态：**代码、媒体、单元测试、真实浏览器证据已完成；外部限制见第 8 节。**

## 1. 任务编号、实际基线、分支、接手时已有修改及保护方式

- 任务：**N5 殿堂异世界短过场**（共享任务 `task-6`，revision 2，owner `n5-showcase`）。
- 接手时仓库：分支 `main`，HEAD `a7475a4`（工作区 dirty，N0 的共享契约改动尚未提交）。
  **收尾时观察到外部并发会话已继续提交**（11:0x 前后 HEAD 变为 `1b61127 docs: P3 部分交付报告…`，属另一会话的第二轮收尾）。按 Lead 协调指令，本任务全程**不执行任何 git 写操作**、不 commit / push / rebase，也不改动对方文件。
- 接手时已存在且**原样保护**的相关修改：
  - N0/Lead 已落地并冻结的共享契约：`features/phone/types.ts`、`features/runtime/navigation/coordinator.tsx`（含 Lead 补的 `skip()` / 查询串提交完成信号）、`features/phone/phone-provider.tsx`、`features/runtime/navigation/showcase-boundary.ts`、`link-guard.ts`、`site-link.tsx`——**N5 只读使用，未改一行**。
  - 第二轮 dirty 文件 `app/globals.css`（迷你播放器样式）、`features/phone/phone-host.tsx`、`features/runtime/site-runtime.tsx`、`mini-player.tsx`——保留；`globals.css` 只在**文件末尾追加**第 16 节 `.isekai` 规则（+35 行），不改既有规则。
  - N1 正在改写的导航 / 地图 / 首页文件（验证时已可见五栏目、地图单一目的地配置）。
- 本轮另有**外部并发会话**在同一仓库提交第二轮（P0–P3），可能同时运行 build / 改 `globals.css` / 起 dev 服务。浏览器证据采集期间（10:45–10:52）已确认：仓库文件行为没有抖动；`globals.css` 的 `.isekai` 规则在最终检查时仍在（`grep -n isekai app/globals.css` 12 处命中）。

## 2. 已实现的需求与逐文件修改清单

### 2.1 需求对照（任务书 §6.1 / §6.2 / §6.3）

| 要求 | 落地 |
| --- | --- |
| 1–2 秒短版，默认约 1.5 秒 | 1280×720 / 30fps / **1.500000s** / 45 帧 / VP9+yuva420p / **无音频**；`IsekaiEffect.wait=1500`，协调器仍夹取到 1000–2000ms 区间 |
| 静音、不暂停或重建背景音乐 | 编码 `-an`；`<video muted playsinline>`；全程不触碰 AudioService。浏览器实测音乐元素同一实例、`paused` 前后一致、`audio` 元素数量不变 |
| 素材未就绪 / 加载 / 播放失败 → 斜切兜底继续进入，不黑屏 | `isekaiReady()` 不成立时协调器只走 `wipe`；一次导航只播一套主效果。浏览器证据 D1–D3（拦截媒体请求） |
| 一次导航只播一套主效果 | 意图分支只返回 `["isekai","wipe"]`；实测 `onAdds=1, crowdAdds=0, jkAdds=0`；连点 3 次仍只播 1 次 |
| 主动进入殿堂才播；内部切换 / 回列表 / 展开不重播 | N0 边界判定 + 浏览器证据 H1（页面在殿堂内点「作品」、手机内再开殿堂应用均不重播） |
| 图库旧地址不误判 | 浏览器证据 N1：`/showcase/photos?album=life` 落到 `/gallery?album=life` 且不播殿堂过场；N0 契约测试覆盖 `/showcase/photos` 非边界 |
| 跳过可用 | 播放中出现 `跳过 / SKIP` 按钮（实测 111×44px、`aria-label="跳过殿堂过场"`），点击 / Escape 调 `navigation.skip()` 立即提交：实测点击后 **42ms** 进入 `/showcase`；Escape **16ms** |
| 减少动态效果直接进入 | 浏览器证据 J1：commit **31ms**，不预热、不播短版（`state=reduced-motion`） |
| 刷新 / 直接地址 / 历史前进后退不自动重播 | 浏览器证据 I1 / I2 |
| 其他地图仍人群、其他普通入口仍 Joker；不串播 | 浏览器证据 F1（`kind=crowd`）、K1（`kind=joker`） |
| 媒体开销受控 | 只新增并只下载 1 个 242,439 B 短版；浏览器网络实测仅 `/assets/clip/isekai-showcase.webm`（206 Range），无长候选 / 参考库下载 |

### 2.2 逐文件清单（N5 写入范围）

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `apps/web/features/runtime/navigation/transition-layer.tsx` | 修改（+119/−8） | 用真实驱动替换 N0 的 5 个「未就绪」桩；新增 `.isekai` 容器与容器外可访问「跳过 / SKIP」按钮；Escape 跳过；短版空闲预热 + 首次交互补预热；debug 探针增加 `isekai{created,ready,playing,state}` |
| `apps/web/features/runtime/effects/isekai.ts` | 新增（约 250 行） | `IsekaiEffect` 状态机：懒加载、首帧画布读回验证 alpha、红底衬降级、`play/stop/destroy/wait`；`frameHasAlpha` 纯函数 |
| `apps/web/public/assets/clip/isekai-showcase.webm` | 新增（二进制，242,439 B） | 1.5 秒短版；SHA-256 见第 5 节 |
| `apps/web/app/globals.css` | 末尾追加（+35 行，第 16 节） | `.isekai`（z-index 901、主题红底衬、0.06s 入 / 0.14s 出）、`.isekai video`、`.isekai-skip`（≥44px、focus-visible）、reduced-motion 隐藏 |
| `apps/web/tests/runtime/isekai-effect.test.ts` | 新增（12 例） | 状态机：预热幂等 / alpha 通过 / alpha 被忽略 / 加载失败 / play-stop-destroy / 播放被拒红闪降级 / 减动效 / 省流量；`frameHasAlpha` 纯函数 |
| `apps/web/tests/runtime/isekai-transition.test.tsx` | 新增（7 例） | 真实 `TransitionLayer` + `NavigationProvider` 接线：就绪时 1.5s 提交、只播一套、跳过点击 / Escape、连点、内部不重播、未就绪斜切兜底 |
| `docs/agent-deliveries/N5-result.md` | 新增 | 本报告 |

未改：`coordinator.tsx` / `types.ts` / `phone-provider.tsx` / `showcase-boundary.ts` / `site-runtime.tsx` / `phone-host.tsx` / `package.json` / 锁文件。无新增依赖。

## 3. 新增 / 修改的接口、字段、路由、导航意图或数据库迁移

- **接口 / 字段**：不新增公开契约。消费 N0/Lead 已冻结的 `NavigationIntent="enter-showcase"`、`NavigationRequest.intent?`、`TransitionDriver` 的 5 个 isekai 槽位、`NavigationCoordinator.skip()`。内部导出（测试 / 调试用）：`ISEKAI_MEDIA_SRC`、`ISEKAI_WAIT_MS=1500`、`IsekaiWarmState`、`frameHasAlpha()`、`IsekaiEffect`。
- **路由**：无新增。
- **导航意图**：无新增；`/showcase/**`（除 `/showcase/photos`）边界内不产生新意图。
- **数据库 / 迁移**：无。
- **样式**：`globals.css` 第 16 节 `.isekai*`（只追加）。

## 4. 与其他任务的依赖和共享文件集成

| 依赖 | 情况 |
| --- | --- |
| N0 共享契约 | 冻结件只读使用；N0 的 23 例契约测试（`tests/runtime/showcase-intent.test.tsx`）保持全绿，未修改该文件 |
| Lead 的 `skip()` 扩展 | Lead 在 `coordinator.tsx` 落地后，N5 在 `transition-layer.tsx` 接按钮与 Escape；`skip()` 先 `stopIsekai()` 再立即提交，视觉由协调器统一退场（N5 不自己清层） |
| N1 导航 / 地图 / 首页 | 顶部五栏目「作品」链接、地图上野三入口（`a.loc[data-id="6"]` / `.mp-card a.btn.red` / `ul.mp-list a[data-id="6"]`）、首页精选作品区 / CTA 已在验证时可用；N5 未改 N1 文件 |
| N4 图库旧地址 | `/showcase/photos?album=life` 浏览器实测重定向到 `/gallery?album=life`，不触发殿堂过场 |
| N6 素材复验 | 已把输入候选 + 处理时间段 + 输出 path/SHA-256/ffprobe 发给 N6；N6 独立复验 **PASS**（无明智 / 无人物 / 无文字；不透明像素 31.89%、绿幕残留 0.000000、白色 0），并登记进 `docs/design-references/persona-assets-allowlist.md` §3。若后续改媒体须重发 path+SHA 给 N6 |
| 写入范围冲突 | `apps/web/public/assets/clip/` 为 N5 新建子目录，与 N6 的 `public/assets/**` 重叠但文件互不覆盖；N6 已确认「不会覆盖 / 删除你的新媒体」 |

## 5. 素材来源、游戏版本、哈希与处理范围

### 5.1 输入候选（工作区外，只读；保持原样、未运行关联工程 / 采集脚本）

| 候选 | 事实 | SHA-256 |
| --- | --- | --- |
| `.../persona-dist/ae-projects/7.21更新素材（包含部分对旧素材的重置）/异世界转场.mp4`（**最终采用**） | 1920×1080 h264 60fps，9.050s，22,326,762 B | `5c3e90283899f65f4a0dd1f7111b6a37f0793d6e7801f3a514d306c3843c82b3` |
| `.../persona-dist/media/video/unknown/过场进入异世界--928a1e4d9e3f.mp4`（复核后未采用） | 1280×720 h264 30fps，11.447s，1,089,099 B | `928a1e4d9e3f85de878f89ecb98b122dcc132972ae58da6b716c1f9c569ce885` |

**内容复核（不凭文件名）**：两份候选都做了 ①每 0.25–0.1 秒抽帧全片目检（v1 114 帧@10fps / v2 91 帧@10fps）；②逐帧程序化色相分类（绿幕底 / 红墨 / 黑墨 / 边缘混色，无肤色、白、蓝簇）；③N6 独立复核。结论：纯绿幕 + 红黑墨迹抽象转场，**无明智吾郎、无任何角色、无文字**。

采用 v2（「7.21 重置版」更高码率 1080p60 源、画面更干净）的 **1.25s–2.75s** 区间（1.5 秒，含墨迹由疏到密的「涌入」段），60fps→30fps、1080p→720p。

### 5.2 编码（沿用旧站已验证配方）

旧站出处：`assets/js/core.js:157-164`（同一素材 0.75s 的 `dive.webm` 配方）、容器样式 `styles/legacy/chrome.css:96-106`（`.clip` = VP9+alpha 视频 + 纯红底衬）。旧站产物参考：`/Users/学习/Claude/dist/phantom-log/assets/clip/dive.webm`（120,720 B，SHA-256 `d47596d0013137df3c72375d16c72e8df1233c2773ad3992fce6f953669d2dce`）。

本轮完整命令（输入输出哈希见上下表）：

```bash
ffmpeg -ss 1.25 -t 1.5 \
  -i "7.21更新素材（包含部分对旧素材的重置）/异世界转场.mp4" \
  -vf "chromakey=0x14ff0b:0.20:0.06,despill=type=green,fps=30,scale=1280:720,format=yuva420p" \
  -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 36 -row-mt 1 -an \
  "apps/web/public/assets/clip/isekai-showcase.webm"
```

（键色 `0x14ff0b` = 该素材绿幕实测主色 (20,255,11)；v1 素材键色为 (72,255,0)，故两候选不能共用同一个 `chromakey` 色值。）

### 5.3 输出（最终定稿）

| 项 | 值 |
| --- | --- |
| 路径 | `apps/web/public/assets/clip/isekai-showcase.webm`（站内 URL `/assets/clip/isekai-showcase.webm`） |
| 大小 | **242,439 B** |
| SHA-256 | **`a716f8e835eb9373639648a72a7fba3529ec99ed8bb623d24cf48b868a91ccb7`** |
| ffprobe | webm / 1 条流 / vp9 / 1280×720 / 30 fps / **1.500000s / 45 帧** / yuv420p（alpha 在 WebM BlockAdditional，`libvpx-vp9` 解码时 `alpha_mode=1`）/ **无音频** |
| 处理范围 | 源 1.25s–2.75s；60→30fps；1080p→720p；绿幕→alpha（chromakey+despill） |
| alpha 逐帧复核 | 第 1 帧 88% 全透明 / 12% 墨迹；第 45 帧 42.5% 透明 / 57.5% 墨迹；45 帧「不透明且绿主导」像素占比 **0.00000**（无绿幕残留） |
| 透明通道 | 保留（VP9 alpha）；浏览器不支持 alpha 时由运行时首帧画布回读判定 → 不播放、退回斜切 |
| 原始候选 | 未改动、未移动；不运行关联工程或采集脚本；只把 242KB 短版放进公开目录，不打包参考库 |

### 5.4 运行时素材安全策略

1. 懒加载：空闲预热（`requestIdleCallback` timeout 2000 / 兜底 setTimeout 1600）+ 首次 `pointerdown`/`keydown` 补一次，幂等；省流量 / 2G / 减少动效时不下载。
2. **alpha 实证校验**：`loadeddata` 后把首帧画到 64×36 画布读回像素，透明像素 >50% 才判 `ready`；否则 `alpha-unsupported` → 斜切兜底（避免浏览器忽略 alpha 时出现整屏绿幕）。
3. 播放被拒（罕见）→ 保留不透明红底衬当「红闪」降级，不黑屏、不改导航时机。
4. 容器 `.isekai` 底衬为主题红 `var(--red,#e5191c)`，z-index 901（手机宿主 880 / 人群与 Joker 899 / 斜切 900），覆盖手机外壳。

## 6. 改前 / 改后截图与录屏

证据目录：`/Users/学习/blog/.dsh/screenshots/`（工作区外，不进仓库）。

| 场景 | 文件 |
| --- | --- |
| 改前：N0 桩时期「意图导航只有斜切兜底」（也是素材不可用时的降级形态） | `n5-07-fallback-wipe.png` |
| 顶部「作品」→ 短过场中（桌面 1280×900） | `n5-02-topnav-isekai-mid.png` |
| 顶部「作品」→ 完成后落到 `/showcase` | `n5-03-topnav-after.png` |
| 地图上野「出发」→ 短过场中 | `n5-04-map-ueno-isekai-mid.png` |
| 手机桌面殿堂图标 → 短过场覆盖手机外壳 | `n5-05-phone-isekai-mid.png` |
| 过场结束后仍在手机内（斜屏外壳 + `?phone=showcase`） | `n5-06-phone-after.png`（前态 `n5-05a-phone-open.png`） |
| 其他地图目的地仍人群过场 | `n5-08-other-map-crowd.png` |
| 减少动效：不播短版直接进入 | `n5-09-reduced-motion-after.png` |
| 首页精选作品区外部入口 → 短过场中 | `n5-10-external-home-cta-isekai.png` |
| 390px 移动端短过场中 / 完成后 | `n5-11-mobile-isekai-mid.png` / `n5-12-mobile-after.png` |
| 320px 视口短过场中 | `n5-13-320-isekai-mid.png` |
| 首页（改前页面状态） | `n5-01-home-before.png` |
| **录屏**（顶部作品 → 短过场 → 新页面，7.32s，VP8 1280×720，852,556 B） | `n5-topnav-transition.webm` |

对照说明：短版是**不透明红底 + alpha 红黑墨迹**，与旧站 `.clip`（进文章的 `dive`）同一视觉语言；动效本身 1.5 秒，遮罩实测可见 **1646ms**（出现 52ms、可见 1646ms、跳过 42ms / Escape 16ms、减少动效 31ms）。截图中的左下角「N 1 Issue」是 **Next dev 指示器**，不是站点 UI。

## 7. 测试命令和实际结果

执行目录 `/Users/学习/blog/Blogs/apps/web`，2026-10-17 10:52–10:55（外部并发会话可能同时在跑 build / dev）：

| 命令 | 结果 |
| --- | --- |
| `npm run test -- --run` | **82 files / 866 tests passed**，exit 0（含 N5 新增 19 例；N0 契约 23 例保持全绿） |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `python3 /Users/学习/blog/.dsh/n5-browser-verify.py` | **41/41 浏览器检查 PASS**（真实 Chromium + 共享 dev 服务 `http://localhost:3123`；未跑 build、未起第二个 dev） |

功能 / 视觉 / 真机 / 迁移 / 资源复核分别的状态：

| 维度 | 状态 | 依据 |
| --- | --- | --- |
| 功能（短版、跳过、兜底、两完成信号、不串播、内部不重播、减少动效、其他入口回归） | **通过** | 单元 19 例 + 浏览器 41/41 |
| 视觉（P5 红/黑墨迹、全屏覆盖、跳过按钮 ≥44px） | **通过（桌面 Chromium / 390 / 320 截图与录屏）** | 第 6 节截图；非原版逐帧比对（本任务无原版整屏参考） |
| 真机触控 / iPhone Safari | **未验证** | 无真机与 Safari 自动化；见第 8 节 |
| 迁移 | 不适用 | 无数据库改动 |
| 资源复核（无明智 / 无人物 / 无文字 / 哈希 / 处理范围） | **通过** | N5 全帧扫描 + 人工抽帧 + N6 独立复验 PASS；已登记 allowlist |

浏览器实测关键数字（`/Users/学习/blog/.dsh/n5-media/verify-results.json`）：

- 点击→遮罩出现 **52ms**；遮罩可见 **1646ms**（1–2s 区间内）；视频 `paused=false, muted=true, currentTime>0, readyState=4, 1280×720, duration=1.5`。
- 点击跳过 → **42ms** 进入 `/showcase`；Escape → **16ms**。
- 连点 3 次：`onAdds=1`；一次导航 `crowdAdds=0, jkAdds=0`。
- 背景音乐：同一元素、`paused` 前后一致、audio 元素数 1→1。
- 网络：只有 `/assets/clip/isekai-showcase.webm`（206 Range），无长候选 / 参考库 / 其他视频。

## 8. 未完成项、已知限制、需要的权限或外部条件，以及恢复 / 回退说明

### 8.1 已知限制 / 未完成项

1. **真实 iPhone Safari 未验证**：短版是 WebM VP9+alpha。Chromium/Firefox/Edge 支持；Safari 对 VP9 WebM alpha 的解码情况未实测——若不解码，运行时会判 `alpha-unsupported` 并走**斜切兜底**（不会出现绿幕），符合任务书「播放失败用兜底继续进入」，但 Safari 用户可能看不到异世界短版。本次**未做** HEVC-with-alpha 第二格式（无法在本机验证，不交付未验证路径）。需要真机 + Safari 证据时由 N7 / 用户提供设备。
2. **「外部作品详情入口」的浏览器级复现受环境限制**：dev 环境未配置 `API_INTERNAL_URL`，首页精选作品区是真实空态（任务书要求不造占位数据），站内没有指向 `/showcase/projects/<slug>` 的可见链接。已验证：`coor` 契约测试对 `/showcase/projects/abc` 的自动意图推导（N0 20 例之一）、N5 集成测试对详情目的地的短版播放；N7 在配置 API 后可按 8.3 的步骤复验。
3. **真机触控 / 软键盘 / 中文输入法 / 桌面缩放**：属 §8.4 跨设备条目，本任务只提供桌面 Chromium + 390/320 视口证据；真机判定留给 N7。
4. 浏览器证据复用共享 dev 服务 `localhost:3123`（另一会话已占 `.next/dev` 单实例锁；按 Lead 要求不跑 build、不并行起第二个 dev）。**必须用 `localhost` 而非 `127.0.0.1`**，否则 Next dev 跨源保护会拦 `/_next` 资源导致页面只剩运行时外壳。
5. 截图左下角 Next dev 指示器（`N 1 Issue`）是开发态浮层；issue 计数来自外部并发会话正在改的文件，与本任务无关。
6. 共享工作区并行写入：`globals.css` 可能被外部会调整文件重写，若 `.isekai` 规则丢失需**末尾重新追加**（第 16 节，只追加，不动对方规则）。

### 8.2 恢复 / 回退

- 媒体：删除 `apps/web/public/assets/clip/isekai-showcase.webm` 即回到「素材不可用」路径，协调器自动走斜切兜底（不会再退化成黑屏）。原始候选在参考库中保持原样、未移动。
- 代码：`effects/isekai.ts`、两个测试文件为新增，删除即不参与；`transition-layer.tsx` 为集中改动，把 5 个 isekai 槽位恢复为 N0 桩（`hasIsekai/isekaiReady:false`）即可回到改前行为；`globals.css` 只删末尾第 16 节即可，不影响其他任务样式。
- 契约（`coordinator.tsx` / `types.ts`）由 N0 / Lead 拥有，N5 未改，回退本任务不需要动契约。

### 8.3 给 N7 的四类入口验证方式（可复用）

脚本：`python3 /Users/学习/blog/.dsh/n5-browser-verify.py`（前置：`cd apps/web && npx next dev`，用 **`http://localhost:<port>`**；脚本内 `BASE` 改成实际端口）。也可手动：

1. **顶部作品**：打开 `/` → 等 `__PHANTOM_DEBUG__().isekai.ready===true`（或按一次 Shift 触发预热）→ 点 `.hud-nav a[data-k="showcase"]` → 断言 `.isekai.on` 出现、`.isekai video` 正在播放（`paused=false`、`duration≈1.5`、`muted=true`）、约 1.5s 后 URL 变 `/showcase` 且遮罩消失；期间 `.crowd.on` / `.jk.on` 从未出现。
2. **地图三入口**：打开 `/map` → hover `a.loc[data-id="6"]`（先 `page.mouse.move(8,8)` 再 hover，否则鼠标已停在图标上不会触发 `mouseenter`）→ 核对 `.mp-card a.btn.red` 的 href 为 `/showcase` → 分别点 ①`a.loc[data-id="6"]` ②`.mp-card a.btn.red` ③`ul.mp-list a[data-id="6"]`：都应 `kind=isekai`、`onAdds=1`、`crowdAdds=0`。
3. **手机桌面殿堂图标**：桌面视口打开 `/` → 点 `.pw-tab` → 等 `.pw-wrap.on` → 点 `.pw-app[data-app-id="showcase"]` → `.isekai.on` 出现（覆盖手机外壳）；结束后 `.pw-wrap.on` 仍在、URL 含 `?phone=showcase`、`.isekai` 收起、音乐元素同一实例且 `paused` 不变。
4. **外部作品详情入口**：配置 `API_INTERNAL_URL` 后打开 `/`，点精选作品卡片（`.n1-work-a[data-project]`，href=`/showcase/projects/<slug>`）→ 应播一次短过场；若仍无数据，用 N0 契约测试 + N5 集成测试作为该入口的等价证据（`showcaseEntryIntent("/showcase/projects/abc", {pathname:"/posts"}) === "enter-showcase"`）。

其他要点（同一脚本已覆盖）：刷新 / 直接地址 / 前进后退不重播；殿堂内部再点「作品」与手机内再开殿堂应用不重播；旧照片深链 `/showcase/photos?album=life` 落 `/gallery` 且不播过场；减少动效时 31ms 直达；拦截 `**/assets/clip/isekai-showcase.webm` 时走斜切兜底；390 / 320 视口短版与跳过按钮可用。
