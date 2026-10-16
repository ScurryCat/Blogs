# T02 · 交付单（旧站迁移、持久外壳与手机宿主）

```text
任务：T02 / 旧站迁移、持久外壳与手机宿主（前端）
状态：implemented_waiting_integration
      —— 六个主页面、持久外壳、导航过场、手机宿主、问卷迁移都已实现并有真实测试；
      真实浏览器验收（Playwright + 系统 chromium）44 项全过、21 张截图；
      未完成 / 未验证项见 §5，必须集成方动作见 §6。
基线：main @ 819c64d（开始时工作区干净；本轮未提交、未推送、未建分支）
      开发中发现 T01（apps/api、features/auth、app/admin/login）、T03（features/ins、app/admin/moments）、
      T04（features/metanav）在并行改动，均未触碰；交付时树里存在 T04 的构建错误（见 §5）。
外部影响：只调用了本机 Open-Meteo（天气页，与旧站同源同接口）；未部署、未推送、未接付费服务。
```

## 1. 本轮范围

**已完成**

| 组 | 内容 |
| --- | --- |
| 根外壳 | `app/layout.tsx`（Server Component）+ `SiteRuntime`（客户端，**包裹服务端 children**）：唯一 `<audio>`、NavigationCoordinator、TransitionLayer（人群 / Joker 帷幕 / 斜切兜底）、PhoneProvider、OverlayManager、Toast、开屏、锚点落地、调试探针 |
| 六个主页面 | `/`、`/posts/[slug]`、`/map`、`/about`、`/weather`、`/guestbook`；非法 slug → **真 404**；`app/not-found.tsx` |
| 样式迁移 | 旧站 10 个样式表逐字节复制到 `styles/legacy/`（**唯一改动**：`url(../img|fonts/…)` → `/assets/legacy/…`），由根布局按旧站顺序引入；全站美术方向未改 |
| 内容迁移 | 8 篇文章（slug / 正文原样）、25 个地图地点、站点 / 问卷 / 留言 / 关于配置、天气精灵图逻辑、曲目清单 |
| Markdown | 旧站 `md.js` 重写为**节点树 + React 渲染**（不再有 `dangerouslySetInnerHTML`）：对话、`!!!`、表格、代码块、图片、引用、列表；快照与恶意 HTML 测试 |
| 问卷 | `poll-model.js` → TS、`poll.js` → React，类名与结构不变；半透明底板 / 斜四边形票数框 / 整数小数分列全部保留；`base 73:927` 仍是设定值，界面标注「本地展示 · 非全站统计」 |
| 手机宿主 | 注册表消费者（T00 的 `registry.ts` 未改）、懒加载、直立应用面板、URL 三参数状态、直接链接关闭规则、Escape 分层、背景 inert、音效开关（从「一个 App」并为控件） |
| 资源 | `public/assets/legacy/`：img 155 + fonts 6 + sfx 1（音频**不复制**，见 §6） |
| 其他 | `app/admin/layout.tsx`（管理外壳，登录视图归 T01）、`app/healthz/route.ts`（不依赖 DB）、`lib/api/posts.ts`（T01 契约的真实 DTO 映射 + 降级策略） |
| 验证工具 | `tools/legacy-migration/migrate.mjs`（可复现、幂等）、`tools/browser-verification/verify.py`（真实浏览器验收） |

**未完成 / 不在本包**

INS、聊天、新日记等业务（T03–T09）；生产部署与网关（T10）；旧站 `poll-demo.html` 未迁移（组件演示页，按 01 §5 不必成为公开路由）。

## 2. 文件

**修改（2 个，都是本包独占）**

```text
apps/web/app/layout.tsx      占位 → 真实根布局（SiteRuntime 包住服务端 children）
apps/web/app/page.tsx        占位 → 真实首页
```

**新增（本包独占目录；`features/auth/`、`app/admin/login/` 是 T01 的文件，不计入）**

```text
apps/web/app/{about,guestbook,map,weather}/page.tsx、posts/[slug]/page.tsx
apps/web/app/{globals.css,not-found.tsx,admin/layout.tsx,healthz/route.ts}
apps/web/components/ui/{site-header,site-footer,header-calendar}.tsx
apps/web/features/runtime/
  site-runtime.tsx  storage.ts  overlay-manager.tsx  toast.tsx
  audio/audio-service.tsx
  navigation/{coordinator,transition-layer,site-link}.tsx  navigation/link-guard.ts
  effects/{crowd.ts,joker-curtain.ts,curtain-data.json}
  {boot-screen,legacy-fx,legacy-hash}.tsx
apps/web/features/legacy/
  {config,posts,map,routes,assets,music}.ts  data/{site,posts,map,music}.json
  markdown/{inline.ts,blocks.ts,view.tsx,index.ts}
  poll/{model.ts,poll.tsx}  text/{ransom,calendar,ticker}.tsx
  guestbook/store.ts  weather/model.ts
  pages/{home-hero,home-index,home-static,post-progress,map-view,weather-view,guestbook-view}.tsx
apps/web/features/phone/
  {phone-provider,phone-host,phone-desktop,phone-music-card,phone-app-view}.tsx
  {url-state.ts,phone-state-service.ts,legacy-apps.ts}
apps/web/lib/api/posts.ts
apps/web/styles/legacy/*.css（10 个）+ PROVENANCE.md
apps/web/public/assets/legacy/**（img / fonts / sfx，162 个文件）
apps/web/tests/{helpers,legacy,phone,runtime}/**（11 个测试文件，112 个用例）
apps/web/tools/legacy-migration/migrate.mjs
apps/web/tools/browser-verification/verify.py
```

未改动（所有权红线）：`apps/api/**`、根目录旧站（`*.html` / `assets/` / `tests/*.cjs`）、`apps/web/{package.json,package-lock.json,tsconfig.json,next.config.ts,eslint.config.mjs,vitest.config.mts}`、`features/phone/registry.ts`、`lib/api/generated/`、`contracts/`、`deploy/`。T00 已做所有权预审并确认零越界。

## 3. 契约与增量（供集成登记）

- **路由**：`/`、`/map`、`/about`、`/weather`、`/guestbook`、`/posts/<slug>`（8 个 SSG 路径）、`/healthz`（`force-dynamic`，200 JSON，不碰 DB 与 API）、`/admin`（外壳）。
- **`/healthz` 语义**：只表示 Next 进程存活，**不冒充就绪**（响应体里写明 scope=web-liveness）；真实就绪归 T01/T10。
- **手机 manifest**：`features/phone/legacy-apps.ts` 里 4 个 `site-link`（`palace` / `tokyo` / `cast` / `profile`），只登记**已迁移且真的能打开**的页面。内置应用仍由 T00 的 `registry.ts` 决定（当前为空）；宿主无按应用分支，新增应用只改注册表。
- **导航来源**：`top-nav`→Joker、`map-travel`→人群（图标 / 出发 / 列表三处同一来源）、`phone-internal`→不遮全站、`phone-link`→Joker、`metaverse-entry`→**缺素材时正常降级且不使用人群**。历史前进后退 / 刷新 / 新标签页不重播。
- **环境变量**：新增 `PHANTOM_POSTS_SOURCE`（`api` 时才读 FastAPI；默认走迁移基线）。未新增任何公开变量。
- **数据降级策略**：`readPublishedPosts/readPublishedPost` 在 API 打开但读取失败时返回 `degraded: true` + 原因，页面顶部显示「数据未更新：…」，**不把服务错误伪装成「没有文章」**（01 §6）。
- **`lib/api/posts.ts` 的映射**：按 `contracts/openapi.json` 的 `PostListOut` / `PostSummaryOut` / `PostDetailOut` 实现，`coverUrl` 优先 `w1280` → `w640` → `original`；有单测（node 环境 + 桩 fetch）。**默认未开启**，原因见 §5。

## 4. 验证（全部实际执行，2026-10-16）

```text
npm --prefix apps/web run typecheck   → exit 0（tsc 无输出）
npm --prefix apps/web run lint        → exit 0（0 error / 0 warning）
npm --prefix apps/web run test -- --run→ exit 0；16 files / 162 tests passed
                                        （其中本包 tests/ 11 files / 112 tests）
npm --prefix apps/web run build       → exit 0；15 条路由（6 个主页面 + 8 篇 SSG + healthz）
node --test tests/*.test.cjs          → exit 0；53 passed / 0 failed（旧站零回归）
python3 apps/web/tools/browser-verification/verify.py → exit 0；44 checks passed / 0 failed
node apps/web/tools/legacy-migration/migrate.mjs      → exit 0（幂等，可重复运行）
```

### 4.1 真实浏览器验收（Playwright + 系统 chromium，见 `tools/browser-verification/verify.py`）

不是 jsdom：真的开浏览器、真的点、真的量几何。**问卷是与旧站逐项对照**（同一份配置、同一套 CSS）：

```text
底板透明度          new=0.84  legacy=0.84
问卷底板几何        new={w:504, h:257.7, top:620.3, left:756}  legacy=同值（偏差 0.0px）
票数框几何          new={w:290.6, h:56, top:729, left:804}     legacy=同值
Q 装饰几何          new={w:92.3, h:117.8, top:652.1}           legacy=同值
问题文本几何        new={w:377.3, h:57.3, top:685.7}           legacy=同值
Q 与票数框叠合      new=-15.1  legacy=-15.1
整数/小数分列字号   whole 76 / fraction 54.72  ←→ 76 / 54.72
390px：票数框 36.0 / Q 相对位置 -8.9 / 小数字号 37.44  ←→ 同值
投票 → 07.4%（本机一票叠加）· 按钮禁用 · 已选标记 · 「非全站统计」原文保留
关闭 → opacity 0 + inert → DOM 移除 → 启动器复现 → 重开仍是已投票状态
```

其余浏览器结论：

```text
地图图标 / 右侧出发 / 下方列表 → {"crowd":true,"joker":false}（三处都过）
顶部导航（在地图页上）        → {"joker":true,"crowd":false} + 到达 /weather
prefers-reduced-motion: reduce → {"crowd":false,"joker":false}（直接导航）
打开手机 → ?phone=home、aria-modal、背景 inert、桌面 4 个真实入口
Escape 关闭 + 焦点回到 .pw-tab + 移除 inert
连续开关手机 20 次：audio 1→1、music 1→1、.pw-wrap 1→1（不累增）
直接链接 /map?phone=home 收起 → 仍在 /map，phone 参数被清掉
跨客户端路由：音乐元素是同一份实例、播放状态延续
```

**客户端导航（音乐连续的前提）**：

```text
顶部导航 / → /about            same_doc=True
地图地点图标 /map → /          same_doc=True
地图地点列表 /map → /posts/…   same_doc=True
手机站点链接入口 / → /about    same_doc=True
```

**截图（21 张，绝对路径）**：`/Users/学习/blog/.dsh/screenshots/`
`t02-poll-desktop.png`、`t02-poll-390.png`、`t02-phone-desktop.png`、
`t02-{home,map,post,about,guestbook,weather}-{desktop,390,320}.png`
（320 / 390 用 viewport 320×844 / 390×844、device_scale_factor=2。）

### 4.2 开发中抓到并修掉的真实缺陷（都有回归测试或浏览器证据）

1. **点击拦截挂在冒泡阶段 → 不少跳转退化成整页重载（严重，最后才抓到）**：`SiteLink` 原来用 React 的 `onClick`（冒泡到 body 才跑）。Next 16 在 document 上也有自己的点击处理，两者抢时序时会出现「RSC 请求已经发出、`window` 冒泡处 `defaultPrevented` 已是 true，文档却仍然整页重载」——表现为音乐被打断、过场收尾失效，而且**只在部分目标路径上复现**（`/`→`/about`、`/map`→`/posts/*` 重载；`/about`→`/map`、`/map`→`/weather` 正常），很难从单点现象看出规律。改成**捕获阶段**拦截（`onClickCapture` + `stopPropagation`）后四类入口全部是同文档导航，并已加进浏览器回归清单。
2. **providers 没包住 children（严重）**：首版把 SiteRuntime 放在布局末尾，页头 / 正文 / 地图里的链接拿不到导航协调器，全部**整页跳转**——过场与「不重建音频」都不成立。真实浏览器量 `performance.timeOrigin` 才发现。已改为 `SiteRuntime` 包住服务端 children，现在导航是 `?_rsc=` 的客户端跳转。
3. **问卷 `.poll-q` 的 `translate` 被构建吞掉**：Next 16（Turbopack / Lightning CSS）会把同一规则里的 `translate` 与 `transform` 合并并**丢掉 translate**（实测 `.x{translate:0 -36px;transform:rotate(-8deg)}` → `.x{transform:rotate(-8deg)}`）。迁移后 Q 比旧站低 20px、不再压住票数框。已在 `globals.css` 用等价 `transform` 按 621px 断点还原（≤620px 旧站自己用 `translate:-12px`，不能叠加）；扫过 10 个样式表只有这一处命中。T00 已独立复核并纳入给 T05/T06/T09 的检查方法。
4. **Markdown 独立图片失配**：块级 figure 正则漏了 `\)`，导致 `![图](url "图注")` 退化成段落里的行内图片。快照测试抓到。
5. **自动播放淡入的时钟混用**：`performance.now()` 与 rAF 时间戳不同源时首帧算出负进度，`audio.volume = 负数` 触发 `IndexSizeError`。改成以 rAF 时间戳为基准并把进度 / 音量夹紧到合法区间。
6. **音乐取不到与「没有曲子」混为一谈**：原实现把 404 也显示成「还没有曲子」。现拆成 `empty` / `unavailable` 两种状态（`data-music-state`），文案指向真实原因；并改用旧站同一路径 `/assets/music/`（仓库只有一份音频）。
7. **`crowd.state` 诊断缺口**：reduce 下调用方短路导致状态停在 `not-warmed`，与「压根没跑」无法区分。已把 reduce 判定收进 `warm()`、省流量由 `markSkipped` 登记，现在 reduce 下是 `state:"reduced-motion"`（浏览器实测）。
8. **`host.openApp("home")` 是空操作**：`home` 不是应用 id，被注册表正确地拒绝，导致「回到桌面」按钮与 Escape 上一层失效。新增宿主内部 `goHome()`。

## 5. 未验证 / 未完成（不得当作通过）

| 项 | 原因 |
| --- | --- |
| **T01 公开 API 的端到端渲染** | 后端进程未启动（8100 无监听）、无已导入数据。`lib/api/posts.ts` 的映射与降级路径有单测，但**没有跑过一次真实 API → 页面**。默认 `PHANTOM_POSTS_SOURCE` 未设置，页面走迁移基线（与旧站同一份内容）。 |
| **`/assets/music/` 的生产可用性** | 开发期由 T00 的 `next.config.ts` 转发打通（音乐实测可播）。生产网关转发属 T10，**本轮没有验证生产路径**。 |
| **音频真实出声** | 无头 chromium 无音频设备：只验证了元素唯一、`play()` 被调用、跨页状态延续、`readyState/duration`（T00 在带转发的副本上量到 `duration=277.9s`）。没有在真实扬声器上听。 |
| **Android / iOS 真机、软键盘、触控** | 本机只有桌面 chromium，无法覆盖真机软键盘遮挡与触控精度。 |
| **热力图（关于页第 04 区块）** | 数据是 `tools/github-heatmap/fetch.py` 的联网产物，本轮**不伪造数据**，该区块不渲染。 |
| **旧站 `clip-dive`（进文章的潜入视频）** | `assets/clip/` 被 `.gitignore` 排除、本地不存在，新站进文章走 Joker 帷幕（旧站在缺素材时本来就退回帷幕），没有迁移视频分支。 |
| **`next start` 之外的部署形态** | 未跑 Docker / 容器 / 反向代理（Docker daemon 未运行）。 |
| **T04 的构建错误挡住再次构建** | 交付前最后一次 `next build` 失败于 `features/metanav/host.ts` 缺少 `"use client"`（T04 的文件，非本包）。因此浏览器套件最后一次全绿是在**该错误出现之前的产物**上跑的（44/0）；本包的 typecheck / lint / vitest 在含 T04 文件的当前树里仍然全绿（`tsc` 报的错全部落在 `features/metanav/`、`features/ins/`、`app/admin/moments/`）。 |
| **320px 下手机面板的完整交互** | 只截了图与量了溢出（T00 独立验证零横向溢出）；没有在 320px 上逐项走完手机应用流程。 |

## 6. 集成申请（需要 T00 / T10 动作）

1. **旧 URL 重定向（属 `next.config.ts`，T00 所有；T00 已实现，本包复核）**：`features/legacy/routes.ts` 的 `legacyHrefToNext` 与 `next.config.ts` 的 `legacyRedirects` 一一对应，并有单测钉住映射表。集成时请确认这组规则随发布一起生效（缺了它 `/post.html?p=…` 会 404）。对应的规则形态：

   ```ts
   async redirects() {
     return [
       { source: "/index.html", destination: "/", permanent: true },
       { source: "/post.html", has: [{ type: "query", key: "p" }], destination: "/posts/:p", permanent: true },
       { source: "/map.html", destination: "/map", permanent: true },
       { source: "/about.html", destination: "/about", permanent: true },
       { source: "/weather.html", destination: "/weather", permanent: true },
       { source: "/guestbook.html", destination: "/guestbook", permanent: true },
     ];
   }
   ```

   `index.html#posts` / `#archive` 的锚点保留：hash 不经过服务器，`LegacyHashLanding` 已在同页恢复滚动（T00 独立验证 `/#posts` 可滚动到位）。**本轮未能再跑一次重定向的 curl 验证**：交付时 `.next` 没有生产构建（T04 的构建错误，见 §5）。
2. **`/assets/music/` 转发（生产）**：新站沿用旧站路径 `/assets/music/<file>`（`features/legacy/music.ts` 的 `MUSIC_BASE`），仓库只有一份音频。开发期已由 T00 转发；**生产网关需要同样转发到仓库根的 `assets/music/`**，否则播放器会显示「音频取不到」。
3. **手机内置应用登记**：T03–T09 的应用按 SHARED-CONTRACTS §4 交给 T00 写入 `registry.ts`，宿主无需改动（`tests/phone/phone-host.test.tsx` 用 `createPhoneRegistry` + 测试 manifest 证明了这条）。本包另外登记了 4 个 `site-link` 入口（`features/phone/legacy-apps.ts`，本包所有）。
4. **浏览器验证依赖（不需要新增依赖）**：`tools/browser-verification/verify.py` 用系统 Python 的 playwright 1.60 + 已下载的 chromium，**没有**、也**不建议**往 `apps/web/package.json` 加 playwright（会引入浏览器下载）。若集成方希望它进 CI，请在 T10 决定运行方式。
5. **`.gitignore`**：`public/assets/legacy/**` 是有意入库的迁移资源（6.9 MB），无需忽略；音频不在此目录下（见第 2 条）。
6. **`app/admin/layout.tsx`**：管理外壳归本包，登录视图归 T01（`app/admin/login/`）。T01 若需改外壳结构，按交付单申请。

## 7. 本包定下的约定（原设计文档未规定，T03 之后请继承）

| 项 | 取值 |
| --- | --- |
| 导航效果决策入口 | `features/runtime/navigation/coordinator.tsx` 的 `effectPlan(source, driver)`（纯函数、可单测）；模块只声明 `source`，不自己播动画 |
| 15 秒看门狗范围 | **所有**导航都挂（旧站只在地图入口挂）：超时 → 清遮罩 → `location.assign` 整页降级 |
| 完成信号 | 目标路由提交（`usePathname()` 变化），**不是** `await router.push()` |
| 手机「回到桌面」 | 宿主内部 `goHome()`；`host.openApp(appId)` 对未注册 id 一律空操作（含字符串 `"home"`） |
| 调试探针 | `window.__PHANTOM_DEBUG__()` → `{navigation, overlays, crowd:{created,ready,playing,state}, joker, transition:{crowd,joker,wipe}, phone, audio, reducedMotion}`；`crowd.state` 区分 `ready / failed / reduced-motion / slow-connection / not-warmed` |
| 音乐元素标记 | `audio[data-pl-music]`，全站唯一；音效池用 `new Audio()` 不挂 DOM，因此不污染该计数 |
| 手机音乐卡片状态 | `data-music-state="empty\|unavailable\|ready"` |
| 数据降级提示 | `degraded && apiEnabled` 时页面顶部 `.data-notice` 显示原因；正常状态不打扰 |
| 迁移样式表 | `styles/legacy/*.css` 是旧站快照，**不要往里加新样式**；新样式进 `app/globals.css`；已知构建坑见 §4.2 第 2 条 |
| 站内链接 | 一律用 `SiteLink`（内部 `onClickCapture`）或地图的 `SvgSiteLink`；**不要在页面里自己写 onClick 拦截** —— 冒泡阶段会与 Next 的全局点击处理抢时序，退化成整页重载（见 §4.2 第 1 条） |
| 旧站资源路径 | 旧配置里的 `assets/…` 一律经 `features/legacy/assets.ts` 的 `asset()` 映射到 `/assets/legacy/…`（音频例外，见 §6.2） |

## 8. 遗留与需要的外部选择

1. **`PHANTOM_POSTS_SOURCE=api` 何时打开**：列表接口只给摘要，`min`（阅读时长）与正文搜索需要 `content_md`（只有详情接口有）。集成时需先定：列表页的阅读时长是接受「按摘要估算」、还是列表页也逐篇取详情（N+1）。本包默认不打开。
2. **`metaverse-entry` 的专用认知过渡素材**：目前按设计降级为斜切兜底（明确不用人群），等 T04 提供素材后再接。
3. **手机桌面把「音效」从 App 改成控件**：按设计 02 §3 执行（不再为一个开关占一个 App），与旧站桌面布局有可见差异；若要恢复旧观感，改 `features/phone/phone-desktop.tsx` 一处即可。
4. **开屏在客户端挂载后才出现**：旧站是同步脚本、几乎无闪烁；新站首帧可能闪一下正文。属水合代价，如介意可改为服务端渲染开屏 + 客户端移除（会牺牲无脚本回退）。
5. **`app/admin/layout.tsx` 不做访问控制**：只是外壳，鉴权在 FastAPI（01 §3）；页面里已写明「隐藏按钮不是安全边界」。
