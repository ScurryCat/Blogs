# PHANTOM LOG · 交接文档

| | |
| --- | --- |
| 文档日期 | 2026-10-17 |
| 交接基线 | `9d9bfe7`（= `origin/main`，交接包的起点） |
| **代码状态** | **`db500ae`**（最后一个代码提交；本文档提交在其之上） |
| 工作区 | 干净（0 项未提交） |
| 基线以来提交 | **140 个代码提交**（截至 `db500ae`）+ 本文档等文档提交 |
| **远端状态** | **已推送**：`origin/main = d4b0608`（与本地一致，快进推送，未强推） |

**推送记录**：2026-10-17 从 `9d9bfe7` 快进推送到 `d4b0608`，141 个提交、931 个文件
（`git ls-remote` 核验远端 `refs/heads/main` 与本地 HEAD 一致；基线仍在历史中，**未强推**）。
仓库地址 `git@github.com:ScurryCat/Blogs.git`。

推送前做过的检查：远端无独有提交（快进安全）、跟踪文件里无 `.env`/密钥/证书、
无 >50MB 文件（最大 0.66 MB）、`.dsh/` 本地数据未被跟踪。

---

## 1. 现状判定

按 ACCEPTANCE §3 的五个状态词：

| 状态 | 是否达到 | 依据 |
| --- | --- | --- |
| 代码就绪 | ✅ | 11 个包（T00–T10）全部交付 |
| **已集成** | ✅ | 单头迁移、契约与类型已生成；34 张表 / 85 条路径 |
| **已预览验证** | ✅ | 真实 PostgreSQL + 真实浏览器 + 真实反向代理；见 §4 |
| **可生产发布（就绪报告）** | ✅ **但附两条未完成前置** | 容器未验证、域名与 TLS 未配置；见 §6 |
| 已部署 | ❌ | **未部署到任何环境，也未获得部署授权** |

**一句话**：站点在本地完整可跑、内容与后台闭环都验证过；离「能上线」只差**容器验证**与**域名/TLS**，
另有若干内容侧依赖（真人照片、AI 凭证）需要你提供。

---

## 2. 五分钟跑起来

前置：macOS，已装 Homebrew 的 `postgresql@18`、Node 26、Python 3.13、`uv`、`pnpm`/`npm`。

```bash
cd /Users/学习/blog/Blogs

# 0) 沙箱环境变量（HOME 在工作区外时必须）
export npm_config_cache=/Users/学习/blog/.dsh/npm-cache
export UV_CACHE_DIR=/Users/学习/blog/.dsh/uv-cache
export LC_ALL=C                      # ⚠️ 见下面的坑

# 1) 测试用 PostgreSQL（端口 55432，项目内数据目录）
tools/pg-local.sh start              # init / start / stop / status

# 2) 后端
cd apps/api
export DATABASE_URL="postgresql+psycopg://pl@127.0.0.1:55432/pl_test"
export SECRET_KEY="至少 32 个字符的密钥，不能更短"
export APP_ENV=dev  MEDIA_ROOT=/tmp/pl-local-media
export CORS_ORIGINS="http://127.0.0.1:3100"
uv run alembic upgrade head
uv run python -m app.commands.bootstrap_admin --username owner --password-stdin   # 交互式设密码
uv run uvicorn app.main:app --host 127.0.0.1 --port 8100 &

# 3) 旧站静态预览（音乐走这条路径；**必须支持 Range**，见 §5 问题 1）
cd /Users/学习/blog/Blogs
python3 -m http.server 8000 --bind 127.0.0.1 &

# 4) 前端（⚠️ 三个变量在 **构建期** 就要有值）
cd apps/web
DEV_API_URL=http://127.0.0.1:8100 \
DEV_LEGACY_STATIC_URL=http://127.0.0.1:8000 \
npm run build

DEV_API_URL=http://127.0.0.1:8100 \
DEV_LEGACY_STATIC_URL=http://127.0.0.1:8000 \
API_INTERNAL_URL=http://127.0.0.1:8100 \
npx next start -p 3100 -H 127.0.0.1 &
```

打开 **http://127.0.0.1:3100**，右下角 **PHONE** 是怪盗手机。

### 四个环境变量分别管什么（漏一个就有一半功能不对）

| 变量 | 作用域 | 漏了会怎样 |
| --- | --- | --- |
| `API_INTERNAL_URL` | **仅服务端** | 服务端取数失败，页面明确报「缺少 API_INTERNAL_URL」，且**刻意不回退**到公开地址 |
| `DEV_API_URL` | **构建期**（rewrites 固化） | 浏览器侧 `/api/v1` 404 |
| `DEV_LEGACY_STATIC_URL` | **构建期** | 音乐 `/assets/music/*` 404 |
| `LC_ALL` | shell | `pg-local.sh` 起不来（macOS 上 locale 无效时 Postgres 报 `postmaster became multithreaded during startup`，报错完全看不出是 locale 问题） |

---

## 3. 仓库地图

```
Blogs/
├── apps/api/                    FastAPI + SQLAlchemy + Alembic
│   ├── app/core/                错误信封 / 分页 / 前置条件 / CSRF / 配置 / DB
│   ├── app/modules/             auth media tags posts moments nav coop
│   │                            journal leisure messaging projects gallery
│   │                            skills exploration      ← 15 个域
│   ├── app/commands/            bootstrap_admin / import_legacy / revoke_sessions
│   ├── migrations/versions/     9 个迁移，单头 528a38f23614
│   └── tests/                   14 个域目录 + 5 个守卫类
├── apps/web/                    Next.js 16 App Router
│   ├── app/                     页面（/showcase /velvet /apps/* /admin/*）
│   ├── features/                按域分包；runtime 是站点运行时（音乐/过场/手机宿主）
│   ├── styles/legacy/           旧站样式快照 —— **不要往里加新样式**
│   ├── tools/browser-verification/verify.py   T02 的 48 项浏览器套件
│   └── public/assets/legacy/    旧站迁移来的素材（含手机外壳与图标）
├── deploy/                      Dockerfile / compose / Caddy / 备份恢复脚本
├── docs/
│   ├── agent-deliveries/        14 份交付单 + T00 集成台账与收口报告
│   ├── operations/              运维手册（release / backup-restore / runbook / limitations）
│   └── handoff/                 本文件
├── tools/
│   ├── acceptance/              5 个验收脚本（见 §4）
│   ├── pg-local.sh              本地测试集群
│   └── legacy-static.py         （已还原，不在当前树）
└── tests/*.test.cjs             旧站测试，53 例，不得回归
```

**所有权**：11 个包分别由不同 agent 交付，各自的交付单在 `docs/agent-deliveries/Txx-result.md`，
里面写了「改了什么、验了什么、**没验什么**」。集成期的决策与证据在 `T00-integration-log.md`。

---

## 4. 实测证据（全部在本 HEAD 上重跑过）

| 验证面 | 结果 | 命令 |
| --- | --- | --- |
| 后端整树（串行） | **911 passed / 0 failed** | `uv run --project apps/api pytest apps/api/tests` |
| 前端 | **713 passed / 69 文件** | `npm --prefix apps/web run test -- --run` |
| 前端类型 / lint / 构建 | **0 / 0 / 0** | `run typecheck｜lint｜build` |
| 旧站零回归 | **53 passed / 0 failed** | `node --test tests/*.test.cjs` |
| T02 浏览器套件 | **48 / 48** | `python3 apps/web/tools/browser-verification/verify.py` |
| 客户端取数审计 | 80 次 200 / 2 次预期 401 / **0 失败** | `python3 tools/acceptance/verify-client-paths.py` |
| 验收脚本 ×4 | 连跑两轮共 8 次**全部通过** | 见下 |

**五个验收脚本**（覆盖集成期实际踩到的五类问题）：

| 脚本 | 覆盖 | 需要什么 |
| --- | --- | --- |
| `verify-ins-media-loop.py` | 发布图文闭环 + 派生变体匿名可读、原图仅管理用途 | 从 `apps/api` 目录跑 |
| `verify-media-multiref.py` | 同图多引用：撤回一处不失效、全部撤回才 404 | 同上 |
| `verify-album-moment-retract.py` | 动态撤回但照片仍在公开相册 | 同上 |
| `verify-restore-revokes-sessions.py` | **恢复备份会让已撤销会话复活**（因此恢复流程必须撤销会话） | 同上 |
| `verify-client-paths.py` | 桌面 19 页 + 手机 10 应用的全部 `/api/v1` 响应码 | **需要三个服务都在跑** |

规模：契约 **85 条路径**、**34 张表**、迁移单头 `528a38f23614`（9 个文件）。

> 后端验收脚本有一次**瞬时失败**（重跑即过）。连跑两轮共 8 次均为通过。
> 怀疑与同时运行的浏览器套件争资源有关，未深究 —— 如再遇到，先单独跑一遍排除干扰。

---

## 5. 已知问题（按优先级）

### 5.1 🔴 音乐进度条拖不动（**未修**，根因已查实）

**现象**：拖动手机里的播放进度条没反应 / 松开后回到原位。

**根因有两个，互相独立**：

1. **本地静态服务不支持 Range**（环境问题）
   `python -m http.server` 对 `Range: bytes=0-99` 回整个文件的 `200`（无 `206` / 无 `Content-Range`）。
   浏览器因此无法跳到音频未缓冲的位置，**seek 之后被重置回 0**。
   **证据**：绕开 React，直接对 `<audio>` 设 `currentTime = 60/140/210` 同样被重置回 ~0.8。
   **生产不受影响** —— Caddy 支持 Range，`tests/e2e/integration/verify-proxy-same-origin.py` 验过 206。

2. **桌面端屏幕的透视矩阵破坏命中测试**（**真 bug**）
   `.pw-screen` 用 `matrix3d` 透视贴到外壳的红色斜面上，而**只要它带 transform，
   子元素命中就会整体错位**（Chrome + 祖先 `zoom` 组合）。
   **证据**：进度条 392px 宽，只有中间 `128–284` 这一段能命中，两端点下去落到外层卡片；
   把 `.pw-screen` 的 transform 压平后命中段变成整条 `4–404`。
   又宽又扁的控件受害最重（进度条 / 音量条），磁贴小所以偏差小、之前没暴露。

**三条修法**（当时试着做过第一条，按你的要求又还原了，补丁在交接包里）：

| 方案 | 做法 | 代价 |
| --- | --- | --- |
| A | 桌面端屏幕改**平直面板**（与应用模式一致） | 牺牲红色屏幕的 3D 倾斜观感，换来整块屏幕可点 |
| B | 保留倾斜，只给进度条/音量条做命中补偿 | 改动更局部，实现更绕 |
| C | 只换本地静态服务（支持 Range） | 纯环境改动、不动界面；但倾斜屏的命中问题**仍在** |

### 5.2 🟡 播放模式（顺序 / 单曲循环 / 随机）—— 已实现并验证，但**不在当前树**

按你的要求还原了。补丁在交接包的 `reverted-work/uncommitted.patch`。
当时的验证结果：单曲循环播完重播同一首、随机换到另一首、顺序进下一首，**三种都实测通过**，
且模式记进版本化本机状态、刷新后保持。

### 5.3 🟡 应用图标有两版并存，**未定稿**

`apps/web/features/phone/phone-desktop.tsx` 顶部有一行开关：

```ts
const ICON_STYLE: "raster" | "svg" = "raster";
```

- `"raster"` —— AI 生成的位图（`public/assets/legacy/img/app/*.png`，10 个 128×128 透明 PNG），
  笔触更厚、有手绘感；
- `"svg"` —— 自绘矢量（`features/phone/app-icons.tsx`），任意缩放都锐利、不新增位图资产。

选定后删掉没选的那版即可（各自删什么写在那个文件头）。

### 5.4 🟡 手记 / 放课后**未接进 nav 搜索**

所以「私密不进搜索」目前**不是因为过滤生效，而是该路径不存在**（T05 如实记录过）。
验收矩阵里那一行因此只算**部分验证**。

### 5.5 ⚪ 两处裸 `<a>` 之外的链接规范偏离

还有 **19 个文件**用 `next/link` 的 `<Link>` 而非 `SiteLink`（集中在 `features/ins/*`、
`features/metanav/admin/*`、`app/admin/*`）。实测**不会整页重载**（Next 全局拦截同源锚点），
差别只是**没有过场动画** —— 视觉不一致，非破坏性。

---

## 6. 未验证项与发布限制（**不得当作已通过**）

**两条阻塞「已部署」的前置**：

1. **容器构建与容器内启动未验证** —— 本机 Docker daemon 不可用。
   已做：静态审查、`compose config` 校验、`caddy validate`、按 Dockerfile 的 COPY
   逐条复刻 runner 布局真实运行 `node apps/web/server.js`（页面与静态资源均 200）。
   **未做**：`docker build` / `compose up` / 容器内 readiness / 非 root 运行。
   → **跑通前 `deploy/` 不得宣称容器可用**。
2. **真实域名、TLS 与 `__Host-` Cookie 未验证**（无域名、无证书）。
   反向代理形态本身已验（真实 Chromium 经代理登录、恶意 Origin 403、音频 Range 206）。

**依赖缺口（按未验收处理）**：

- **真实 AI 模型未接通** —— 无供应商 / 凭证 / 预算。**没有采购或启用任何收费调用**；
  默认走本地模拟服务，不联网不计费。
- **仓库里没有任何真实照片素材** —— 画廊线上内容为空。T06 的 seed **拒绝用游戏素材或占位图
  冒充照片**（这是对的做法）；相册相关语义已用测试图验证。
- **真机触控与软键盘、Safari / Firefox、音频真实出声、磁盘真塞满演练、
  GitHub Actions 实际执行（无远端）、多 worker 压测、读屏软件** —— 均未验证。
- **T08 原版 IM 视觉还原本身未验证** —— 只拿到元件素材表、没有完整参考帧，
  因此只做了结构 + 已确证语汇的原创适配。

**另一条已登记的长期限制**：游戏素材（音乐 / 立绘 / 图标）存在**许可缺口**，
详见 `docs/operations/limitations.md`。新增图标走的是 AI 生成与自绘，**没有再扩大这个缺口**。

---

## 7. 待你决定的事项

| # | 事项 | 说明 |
| --- | --- | --- |
| 1 | ~~推不推远端~~ | ✅ **已推送**（`origin/main = d4b0608`）|
| 2 | 图标用哪版 | 位图 / 矢量，一行切换 |
| 3 | 进度条问题修不修、用哪个方案 | 见 §5.1 的三条路 |
| 4 | 播放模式要不要 | 补丁在交接包里 |
| 5 | 域名 / TLS | 有了之后补容器与 HTTPS 验证 |
| 6 | AI 供应商与预算 | 在此之前保持模拟 |
| 7 | 真人照片素材 | 提供后可跑相册全流程 |

---

## 8. 交接包内容

```
PHANTOM-LOG-handoff-2026-10-17/
├── HANDOVER.md                  ← 本文件
├── reverted-work/
│   ├── README.md                这两份补丁是什么、怎么用
│   ├── commit-12164e2.patch     进度条修复（平直面 + Range 静态服务）
│   └── uncommitted.patch        播放模式（服务 + 界面 + 单测）
├── icons/
│   ├── raster/                  10 个切好的透明 PNG（当前生效的版本）
│   ├── sheet-source.jpg         ark_generate_image 的原始出图
│   └── preview-black.png        黑底对照图（检查透明与配色）
└── evidence/
    ├── phone-ark-icons.png      位图图标装进手机后的实拍
    ├── phone-icons.png          矢量图标版实拍
    ├── phone-draw.png           「掏出手机」动画落定后
    └── local-home.png           首页
```

图标资产在仓库里的位置：`apps/web/public/assets/legacy/img/app/`；
矢量版在 `apps/web/features/phone/app-icons.tsx`。
