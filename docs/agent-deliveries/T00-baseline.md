# T00 · 基线报告（前置准备阶段）

任务：T00 基线与集成
状态：**prep_complete / scaffolding_not_started** —— 基线、文档、环境已固化；`apps/`、`contracts/`、`deploy/` 工程骨架**尚未建立**。
日期：2026-10-16，Asia/Shanghai
执行范围：交接包 [README](../superpowers/plans/2026-10-16-agent-handoff/README.md) §2 / §4 与 [T00](../superpowers/plans/2026-10-16-agent-handoff/tasks/T00-foundation.md) 执行清单第 1–4 项。

本轮没有调用任何外部服务，没有提交、推送、创建分支或部署，没有启动子 agent。

## 1. 仓库基线

```text
仓库：/Users/学习/blog/Blogs
远端：git@github.com:ScurryCat/Blogs.git（SSH；交接包源副本用 HTTPS）
分支：main（与 origin/main 同步）
HEAD：9d9bfe77aded4db27d4c7958b728f0634a35fcae
     2026-10-16 13:55:15 +0800  Merge pull request #1 from ScurryCat/codex/phantom-poll
提交总数：20；首次提交 81a9d4d 2026-10-15 feat: Phantom Log —— P5 风格个人博客初次提交
```

**与交接包 §2 的差异（交接书写于合并之前，需按本表为准）：**

| 交接包 §2 | 本仓库实况 |
| --- | --- |
| 分支 `codex/phantom-poll`，HEAD `1cb2124` | 已在 `main`，HEAD `9d9bfe7`（PR #1 已合并） |
| 5 个问卷文件为未提交状态 | 其中 `poll.css` / `poll.js` / `tests/poll-browser.*` 的**已提交版本**已在 main；**未经提交的精修版本仍只存在于源工作副本**（见 §3） |
| 需从远端 HEAD 之外取 9 份设计 | 已全部落库，见 §4 |

`.gitignore` 已排除：`assets/clip/`（官方过场影像）、`version.json`（部署标记）、`.superpowers/`、`__pycache__/`、`.DS_Store`。`assets/clip/` 当前不存在。

`version.json` 为过期部署标记（记录 `9e40ddc`、`dirty: true`、2026-10-15T18:13），与当前 HEAD 不一致；该文件不入库，属预期现象。

## 2. 测试基线

```bash
node --test tests/*.test.cjs
```

```text
tests 53 | suites 0 | pass 53 | fail 0 | cancelled 0 | skipped 0 | todo 0
duration_ms 239.17
```

与交接包记录的「53 通过」**完全一致**，无需核对数量偏差。旧测试未做任何修改。

覆盖范围：`crowd.test.cjs`、`map-transition.test.cjs`、`poll-model.test.cjs`（浏览器侧另有 `*-browser.html` + `*-browser.js` 各两套，本轮未跑视觉/浏览器验收）。

## 3. 未提交问卷改动：归档与风险（本次最重要的发现）

交接包 §2 列为「需保全的既有未提交文件」的 5 个文件，**其精修内容不在任何远端分支上**，仅存在于源工作副本 `/Users/v/Documents/ChatGPT/Blog开发/Blogs`（分支 `codex/phantom-poll`，HEAD `1cb2124`，比本仓库 main 少一次合并）。已核对：本仓库对应文件与 `1cb2124` 版本逐字节相同，即合并**没有**带入这批改动。

| 文件 | 本仓库（= `1cb2124`） | 未提交精修版 | 差异 |
| --- | --- | --- | --- |
| `assets/css/poll.css` | 8654 B | 9764 B | 主体改动，131 行 |
| `assets/js/poll.js` | 12147 B | 12504 B | 百分比整数/小数分列渲染，11 行 |
| `docs/superpowers/specs/2026-10-15-phantom-poll-design.md` | 7735 B | 8457 B | 追加用户后续反馈（完整问卷构图、透明度、斜四边形票数框） |
| `tests/poll-browser.html` | 839 B | 841 B | 6 行 |
| `tests/poll-browser.js` | 5437 B | 7017 B | 17 行新增 |

合计 `5 files changed, 113 insertions(+), 59 deletions(-)`。

**已采取的保护措施**（归档在仓库之外，不污染站点工作树）：

```text
/Users/学习/blog/.dsh/baseline/2026-10-16-poll-uncommitted/
├── MANIFEST.md          来源、分支、HEAD、sha256、恢复步骤
├── uncommitted.patch    完整 diff（git apply 可复原）
└── files/               5 个文件的逐字节副本（路径与仓库根一致）
```

5 个文件 sha256 已与源副本逐一校验通过。恢复命令：

```bash
git apply .dsh/baseline/2026-10-16-poll-uncommitted/uncommitted.patch
# 或
cp -R .dsh/baseline/2026-10-16-poll-uncommitted/files/. Blogs/
```

### 3.1 「是否已推送到 GitHub」的核查结论

用户提出「记得推送到 GitHub 了」，据此做了穷尽核查，结论是：**问卷功能推送过，但这批精修从未推送。**

已在 GitHub 上的问卷工作：`f152517` `11640ca`（设计）、`e7546de` → `035f069` → `58483d3`（HUD 实现）、`1f6eeb1`（验证记录），以及 PR #1 合并 `9d9bfe7`。

精修未推送的四条独立证据：

| 检查 | 结果 |
| --- | --- |
| `git ls-remote` 远端分支 | 仅 `codex/phantom-poll` @ `1cb2124`、`main` @ `9d9bfe7`、`refs/pull/1/head` @ `1cb2124`，均已完整拉取 |
| 全历史 pickaxe（`-S`）搜精修独有标记 `--poll-backdrop` / `poll-q-cut` / `poll-rate-size` / `poll-fraction` / `84% 不透明度` | **0 个提交命中** |
| 精修文件 git blob 是否在对象库 | 4 个文件的 blob **均不存在** → 这些字节在任何时间点都没被提交过（既非回退也非旧版） |
| 源副本 reflog / `git fsck` | reflog 无「提交后 reset」痕迹，无 dangling 对象 |

时间线佐证：最后一次问卷提交 `58483d3` 为 10-15 21:57，而工作树精修的文件时间戳为 10-15 22:36–22:46（之后 40 分钟），其后所有提交（10-16 起）只涉及地图过场与人群。最直接的证据是承载精修的源工作副本自身，至今仍将这 5 个文件显示为 ` M`（已修改未提交）——未提交的改动不可能被推送。

未能排除的可能：精修曾被推送到**另一个仓库**或一个后来删除的分支。GitHub API 枚举账号仓库时触发 403 限流，未完成。

### 3.2 处置结果（按用户选择：应用到工作区，不提交）

```text
git apply --exclude='docs/*' uncommitted.patch
```

4 个代码文件已应用到工作区，与归档精修版**逐字节一致**；spec 文档在 §4 落库时已是精修版，无需重复套用。

核对结果：`node --check assets/js/poll.js` 通过；`node --test tests/*.test.cjs` 仍为 **53 通过 / 0 失败**；`poll.js` 新增的 `.poll-whole` / `.poll-fraction` / `.poll-result-label` 与 CSS 对应（`.poll-whole` 有意不单独设规则，继承 `.poll-number` 的字号，`.poll-fraction` 缩至 `.72em`）。

回退方式（未提交，随时可退）：

```bash
git checkout -- assets/css/poll.css assets/js/poll.js tests/poll-browser.html tests/poll-browser.js
```

> **部署提示**：全部 7 个生产页面引用 `assets/css/poll.css` 与 `assets/js/poll.js` 时都**不带版本参数**（仅测试页用 `?lifecycle=N`），这是本项目既有约定而非本次引入。但这意味着本次改动上线后，命中旧缓存的访客可能拿到「新 JS + 旧 CSS」的组合（`.poll-fraction` 无样式，小数部分不会缩小），需等缓存过期。本地预览因文件 mtime 变化不受影响。

## 4. 交接文档落库

ZIP 按交接包要求解压到仓库根、保持 `docs/` 路径。落库 26 份交接文档后 `docs/` 为 **28 个文件**（其中 2 份 plan 为仓库原有），与 ZIP 内容逐字节一致（`diff -rq` 无差异）；连同本报告共 29 个。

```text
docs/superpowers/plans/2026-10-15-phantom-poll.md                     （原有）
docs/superpowers/plans/2026-10-16-map-travel-transition.md             （原有）
docs/superpowers/plans/2026-10-16-agent-handoff/                       新增 15 个
├── README.md  SHARED-CONTRACTS.md  ACCEPTANCE.md  tasks.json
└── tasks/T00-foundation.md … T10-release.md（11 份任务卡）
docs/superpowers/specs/2026-10-15-phantom-poll-design.md               ★ 被 ZIP 新版覆盖
docs/superpowers/specs/2026-10-16-map-travel-transition-design.md      （相同，未变）
docs/superpowers/specs/2026-10-16-{next-phase,stack-architecture,phone-app-platform,
     ins,metaverse-navigator,data-api,deployment-roadmap,world-features,
     character-messaging}-design.md                                    新增 9 份
docs/agent-deliveries/T00-baseline.md                                  本报告
```

ZIP 是源工作副本 `docs/` 的忠实快照：唯一差别是它有意不含已在仓库中的 2 份 plan 文件。

`git status` 现状（**未提交**，等你的指示）：**5 个修改**（4 个问卷代码文件按 §3.2 应用，1 个被 ZIP 新版覆盖的 poll spec）+ 12 个未跟踪路径（含本目录 `docs/agent-deliveries/`）。

## 5. 旧站资产清单（T00 执行清单第 3 项）

| 类别 | 内容 |
| --- | --- |
| 路由（7） | `index.html`（首页，非 `home.html`）、`post.html`、`map.html`、`guestbook.html`、`about.html`、`weather.html`、`poll-demo.html`；无 `blog.html` / `archive.html` 等（工作区根目录的那套是另一份旧的独立副本，不属本仓库） |
| 文章 | 8 篇，数据源 `assets/js/posts.js`（`window.PL_POSTS`），正文为自带 Markdown：`phantom-blog-launch`、`css-p5-menu`、`tokyo-ten-days`、`desk-setup-2026`、`p5r-platinum`、`snow-country-notes`、`a11y-checklist`、`assets-and-credits` |
| 地图 | `assets/js/map-data.js` `window.PL_MAP` 共 **25 个地点**（viewBox 0 0 1500 1000，几何取自 Persona5Startpage，MIT）；「点哪里去哪」在 `assets/js/site.js` 的 `map` |
| 站点 / 问卷配置 | `assets/js/site.js`：`poll`（`phantom-thieves-belief` / 怪盗ch / main=yes / base 73:927）、`guestbook`（`store: 'local'`，Supabase 端点与 key 为空）、`arcana` 7 分类、`speakers`、`weather`（东京 35.6764/139.65）、`map`、`about` |
| 媒体 | `assets/img` 155 个文件（`cover` / `crowd` / `cursor` / `icon` / `map` / `phone` / `portrait` / `ui` / `weather`）；`assets/sfx/select.mp3`；`assets/music` 3 首 mp3（约 15.7 MB） |
| 字体 | `assets/fonts/`：`AlimamaShuHeiTi-Bold.woff2`、`Persona5FanRansom.ttf`、`earwig-factory.ttf`（P5Earwig）、`p5hatty.ttf`（P5Hatty）；附表 `AlimamaShuHeiTi-LICENSE.md`、`p5hatty-LICENSE.md`。CSS 中另有 Anton / Noto Serif SC / ZCOOL QingKe HuangYou 作候选，**未内嵌字体文件**，依赖系统或外链 |
| Markdown 扩展 | `assets/js/md.js`：`##`/`###`、段落、强调、行内代码、链接、`-`/`1.` 列表、围栏代码块、表格、`---`、`![说明](图 "图注")`、`> **名字**：台词`（渲染成 P5 对话框，说话人须在 `S.speakers` 中）、`!!! 提示框` |
| JS 模块（25） | `boot/core/pjax/md/posts/site/home/map/map-data/post/phone/crowd/curtain/curtain-data/fx/heatmap/heatmap-data/music/weather/guestbook/guestbook-store/poll/poll-model/poll-demo/about` |
| 工具脚本 | `tools/curtain/`（gen.py + shape.py）、`tools/deploy/`（install-hook.sh + version.py）、`tools/github-heatmap/fetch.py`、`tools/portrait-crop/extract.py`（均为裸 Python，无依赖清单） |
| 依赖清单 | **不存在**：无 `package.json`、`pyproject.toml`、`requirements.txt`、锁文件。当前为「零框架、零构建」静态站 |

运行约定：旧静态预览 `python3 -m http.server 8000`（README §预览）。**新的 `apps/web` / `apps/api` 必须另选端口，不得停止或覆盖旧 8000 预览。**

## 6. 工具链核对

| 工具 | 本机版本 | 状态 |
| --- | --- | --- |
| Node.js | v26.8.1 | 满足 Next.js App Router 与 `node --test` |
| npm | 11.19.0 | 可用 |
| pnpm | 12.10.1 | 可用 |
| Python | 3.13.5 | 满足 FastAPI；3.13 需注意部分扩展轮子 |
| Docker | 29.8.2 | 可用 |
| Docker Compose | v5.5.1 | 可用 |
| psql（客户端） | 18.6 (Homebrew) | 可用；PostgreSQL **服务端**是否已启动未验证 |
| git | 2.39.5 (Apple Git-154) | 可用 |

未验证项：Docker daemon 是否运行、本地 PostgreSQL 实例是否存在、能否拉取镜像（本轮未联网调用）。这些应在 T00 建骨架时一并确认，不在此处冒认已就绪。

## 7. 待你决定 / 上线前须落实

1. **问卷精修是否落到 main**（§3）—— 阻塞「问卷效果」基线复现。
2. 交接包 §1「上线前须落实」：生产域名 / 服务器 / 备份目的地；素材许可；AI 供应商、预算与保留政策。未落实不阻止本地逻辑与模拟服务测试，但不能宣称真实 AI 或生产验收已完成。
3. **素材许可风险**（`.gitignore` 自述）：仓库已入库 3 首 Lyn 演唱、©ATLUS 的商业发行曲，公开仓库等于公开分发；如需撤下须 `filter-repo` / BFG 改写历史。这属 §3 的「素材许可」具体项。
4. 分发范围：是否按交接包建议先发 T00，再并行 T01 / T02。

## 8. 基线阶段之后的进展

本文件记录的是**前置准备阶段**（T00 执行清单第 1–4 项）。工程骨架、共享接口、隔离测试夹具、开发 Compose 与 OpenAPI 契约链路已在其后完成，见 [T00-result.md](T00-result.md)：

- liveness 端点 `/api/v1/health/live` 已实现；`/api/v1/health/ready` **刻意不存在**（不假造就绪）。
- `apps/api`（51 passed，含真实 PostgreSQL）与 `apps/web`（22 passed）测试全绿；旧站 `node --test` 仍 53 passed 零回归。
- 文档未规定的约定（环境变量名、错误 code 清单、request_id 头、测试库标记、开发端口、迁移布局）已由 T00 定下并登记在 T00-result.md §6。

## 9. 复现命令

```bash
cd /Users/学习/blog/Blogs
git log -1 --format='%H %ad %s' --date=iso
git status --short
node --test tests/*.test.cjs
find docs -type f ! -name '.DS_Store' | wc -l        # 28
python3 -m http.server 8000                          # 旧站预览，保持可用
```
