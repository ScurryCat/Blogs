# N6 交付：不含明智吾郎的活动素材库（盘点、图标替换、三份清单与引用检查）

> 第三轮 P5 内容架构 v3 · 任务书
> `/Users/v/Documents/ChatGPT/Blog开发/docs/superpowers/plans/2026-10-17-p5-content-v3-agent-handoff.md`
> §5 / §7.1 N6 / §7.4 / §8.3 / §9。
> 项目：`/Users/学习/blog/Blogs`（分支 `main`；**N6 未做任何 Git commit / push / deploy**）
> 交付日期：2026-10-17 · 状态：**网站资源与引用清理已完成并实测；外部精选库 `persona-curated/`
> 未落地（工作区外权限，按 Lead 裁决走仓库内清单替代方案，见 §8）**。

## 1. 实际基线、分支、接手时已有修改及保护方式

- 接手时现场：分支 `main`，`git log -1` = `a7475a4 feat(messaging): 会话详情菜单…`（ahead origin/main）；
  工作区有第二轮与第三轮其他任务的大量未提交修改（`app/globals.css`、`features/phone/**`、
  `features/runtime/**`、`features/gallery/**`、`features/journal/**`、`apps/api/**` 等）。
- 保护方式：**只改本任务写入范围内的文件**；`features/runtime/**`、`features/phone/**`、
  `features/gallery/**`、`app/globals.css`、`package.json`、第二轮 dirty 文件一律未触碰。
  运行最终命令时仓库 HEAD 已由其他任务推进到 `1b61127`（其他任务提交，**不是 N6 的提交**）；
  N6 的全部改动仍在工作区未提交，便于集成负责人统一审阅/提交。
- 任务书路径纠偏（已在清单中记录）：任务书 §5.3 写的 `apps/web/assets/img/icon/crow.webp`
  **不存在**；T02 迁移工具的实际迁移源是**仓库根 `assets/`**，产物侧是
  `apps/web/public/assets/legacy/`。本轮按实际路径处理，两侧同步。
- 运行 `npm run build` 前用 `pgrep -fl "next build"` 确认无并发构建（执行时无输出 = 无并发）；
  N5 需要浏览器验证时我未与其并发构建。

## 2. 已实现的需求与逐文件修改清单

### 2.1 需求完成情况（任务书 §5.4 六步）

| 步骤 | 状态 | 证据 |
| --- | --- | --- |
| 1. 盘点活动资源、公开目录、构建输入及引用关系（精确路径+哈希） | ✅ | 允许清单 `docs/design-references/persona-assets-allowlist.md` + 逐文件 `persona-assets-manifest.csv`（171 行）+ §7 下载证据 |
| 2. 复核画面、提取可保留素材、建立允许清单 | ✅ | 全量 contact sheet 实看（`.dsh/n6-review/sheet-*.png`）；允许清单 §1–§4；多人图/合图逐项结论见排除清单 §3 |
| 3. 校验新库文件、索引、缩略图与来源记录 | ✅（仓库内部分） | 替换/适配资源哈希校验（`verify-no-akechi-assets.py` 第 5 项）；外部新库未落地见 §8 |
| 4. 替换网站引用和生成输入，验证实际下载文件 | ✅ | 2 个 manifest 引用替换；`migrate.mjs` 防再生守卫；HTTP + 浏览器实际下载 117 个 `/assets` 文件全部无明智 |
| 5. 从活动库移除旧资源（可恢复归档），原始采集包保持离线 | ✅（仓库内 3 项） | 移除/恢复清单；归档 `.dsh/archived-assets/`；外部旧库与原始采集包未动（§8） |
| 6. 再构建并检查，确认旧资源不会重新生成/复制进公开目录 | ✅ | 构建后复验脚本 PASS（2552 个产物文件扫描）；`migrate.mjs --assets-only` 实测（含「模拟回滚源」场景） |

### 2.2 逐文件修改清单

**删除（工作区，未提交；原字节已归档）**

| 文件 | 说明 |
| --- | --- |
| `assets/img/icon/crow.webp` | 明智吾郎头像（仓库根迁移源） |
| `apps/web/public/assets/legacy/img/icon/crow.webp` | 同上，公开目录副本 |
| `assets/img/band-halftone.jpg` | Joker+黑面具明智双人插画（站内无引用） |
| `apps/web/public/assets/legacy/img/band-halftone.jpg` | 同上，公开目录副本 |

**修改（原位替换 / 引用替换 / 工具与文档）**

| 文件 | 变更 |
| --- | --- |
| `assets/img/cover/platinum.jpg` | 明智立绘 → 天鹅绒房间空景（裁切适配 640×896，非 AI 重绘）；新哈希 `394c37ce…` |
| `apps/web/public/assets/legacy/img/cover/platinum.jpg` | 同上（公开侧） |
| `apps/web/features/coop/phone-manifest.tsx` | `COOP_PHONE_ICON`：`/assets/legacy/img/icon/crow.webp` → `/assets/legacy/img/app/coop.png`；说明注释更新 |
| `apps/web/features/exploration/phone-manifest.ts` | `icon`：`…/icon/crow.webp` → `/assets/legacy/img/icon/mementos.webp`；说明注释更新 |
| `apps/web/tools/legacy-migration/migrate.mjs` | 新增 `EXCLUDED_IMG` 防再生守卫 + `--assets-only` 模式（只跑资源复制、不重写数据 JSON/CSS） |
| `tools/acceptance/verify-ins-media-loop.py` | 测试上传文件名 `crow.webp` → `verify-sample.png`、alt「一只乌鸦」→「验证图片」（该文件本是程序生成的纯色 PNG，仅避免审计误导） |
| `tools/p0-contact-sheets.py` | 文件头补充素材安全说明：来源合图可能含明智、裁片未审核、不得接入 |
| `docs/design-references/icon-mapping.md` | coop/mementos 图标映射更新；合图安全提示；存档参考与缺口；§5/§6 第三轮变更与无明智说明 |

**新增**

| 文件 | 说明 |
| --- | --- |
| `apps/web/public/assets/legacy/img/icon/mementos.webp` | 由 `app/metanav.png` PNG→无损 WebP 的适配图标；哈希 `d0de74b6…` |
| `docs/design-references/persona-assets-allowlist.md` | 允许清单（含替换/适配资源、过场短版媒体、外部参考复核条目） |
| `docs/design-references/persona-assets-excluded.md` | 排除审计清单（仅文字元数据）：仓库内 3 项 + 外部 24 个明智文件 + 合图/视频/书籍/未审核项 |
| `docs/design-references/persona-assets-removed.md` | 移除/恢复清单（原路径/归档路径/哈希/恢复命令，含迁移守卫实测证据） |
| `docs/design-references/persona-curated-plan.md` | 外部精选库 `persona-curated/` 方案、目标结构、首批候选、未落地原因与执行步骤 |
| `docs/design-references/persona-assets-manifest.csv` | 171 行逐文件允许清单（路径/用途/来源/版本/处理/复核/许可/哈希） |
| `tools/acceptance/verify-no-akechi-assets.py` | 仓库级复验：公开目录/构建输入/构建产物/引用/crowd 完整性（7 项，退出码） |
| `tools/acceptance/verify-no-akechi-downloads.py` | 浏览器实际下载复验：真实访问 7 个页面收集 `/assets/**` 下载并逐一校验；截图与 JSON 证据 |
| `docs/agent-deliveries/N6-result.md` | 本报告 |

> 未改动：`features/runtime/**`、`features/phone/**`、`features/gallery/**`、`app/globals.css`、
> `package.json`、第二轮 dirty 文件；**未删除任何文章中对角色的文字提及**（实测
> `posts.json` 中 `p5r-platinum` 仍保留 3 处「明智」文字，页面正常渲染）。

## 3. 新增 / 修改的接口、字段、路由、导航意图或数据库迁移

- **数据库迁移：无。后端接口：无。路由：无。导航契约：无改动**（不属 N6 范围；未碰
  `features/runtime/navigation/**` 共享热点）。
- 前端数据变化仅限两处 `PhoneAppManifest.icon` 的**值**（字段形状与 10 字段契约不变）：
  `coop` → `app/coop.png`；`mementos` → `icon/mementos.webp`。
- 工具链新增：`migrate.mjs --assets-only` 开关；两个只读验收脚本（不进入构建/不新增运行依赖）。

## 4. 与其他 agent 的依赖与共享文件集成情况

| 任务 | 依赖/协作 | 状态 |
| --- | --- | --- |
| N2 手记 | 需要「存档整屏」参考；N6 复核 `persona5-spriters/p5/hud/92140-save-load.png`（SHA-256 `07472377…`）为**元件表、无明智**；完整整屏参考帧**仍缺**（记录在 icon-mapping §3，N2 视觉还原不得标「已通过」） | 已交付可用的参考信息与缺口说明 |
| N5 殿堂过场 | ① N6 独立复核两份候选视频（343/543 帧全片扫描 + 抽帧 + 最可疑帧目检）：纯绿幕+红黑墨迹，**无角色/文字/明智**；② N5 定稿 `apps/web/public/assets/clip/isekai-showcase.webm`（SHA-256 `a716f8e8…`，242,439B，1.5s，1280×720 VP9+alpha，静音，源 `异世界转场.mp4` 1.25–2.75s）N6 只读复验：45 帧 alpha 解码、绿幕残留 0、与输入时间段画面一致、无夹带；已登记允许清单 §3 | 已交付；N5 改稿会重发 path+SHA 并复验 |
| N1/N4/N0 | 未修改共享导航/图库/手机宿主文件；`/gallery`、`/posts/[slug]` 等仅用于只读下载验证 | 无写冲突 |
| N7 验收 | 提供两个可执行复验脚本 + 本报告附录 B 的检查清单；截图证据在 `/Users/学习/blog/.dsh/screenshots/n6-*.png` | 待 N7 复跑 |
| **并行第二轮回合会话（P0–P3 已提交）** | Lead 协调（N6 立即生效）：**严禁运行任何 git 命令**（对方在用 git 提交/amend），只保持工作区文件；对方下一阶段 P4「原版图标」可能触碰图标资源与 `features/*/phone-manifest.tsx`、`registry.ts`。N6 于 2026-10-17 10:51 只读复核：**对方未覆盖/还原任何 N6 改动**——`assets/img/icon/crow.webp`、`band-halftone.jpg`（两侧）仍不存在；`cover/platinum.jpg` 替换版哈希仍为 `394c37ce…`；`mementos.webp`/`coop.png`/N5 媒体哈希不变；manifest、migrate 守卫、三份清单与脚本均在场。若后续发现被还原，N6 将重做最小增量并上报 Lead | 状态正常；如发现明智资源被加回会立即上报（验收红线） |
| Lead | 裁决：外部精选库改走仓库内替代方案；根 assets 按归档方式处理；`platinum.jpg` 原位替换；迁移守卫需实测 | 已全部执行 |

## 5. 素材来源、游戏版本、哈希与处理范围

完整逐文件记录见 `persona-assets-allowlist.md` / `persona-assets-manifest.csv`；排除项见
`persona-assets-excluded.md`。关键点：

| 资源 | 来源 | 游戏版本 | 处理范围 | SHA-256 |
| --- | --- | --- | --- | --- |
| `icon/crow.webp`（**已移除**） | 旧站迁移图标（T02） | P5/P5R（T02 记录未核实） | 整份排除 → 归档 | `2c94638757c68b66…` |
| `cover/platinum.jpg`（**已替换**） | 原：旧站文章封面（P5R 官方插画） | P5R | 整份替换为 `bg-velvet.jpg` 裁切 640×896（非 AI 重绘） | 原 `085e6df9…` → 新 `394c37ce…` |
| `band-halftone.jpg`（**已移除**） | 旧站静态资源 | P5X 改编壁纸（©Perfect World/ATLUS/SEGA） | 整份排除（双人不可分离） | `f6eade8e…` |
| `icon/mementos.webp`（**新增适配**） | 旧站 `app/metanav.png`（`ca581583…`） | 未核实（旧站 P5R 图标） | PNG 128×128 → 无损 WebP，无 AI 重绘 | `d0de74b6…` |
| `clip/isekai-showcase.webm`（N5 交付，N6 登记） | `persona-dist/.../异世界转场.mp4`（`5c3e9028…`） | P5R | `-ss 1.25 -t 1.5` + chromakey/despill/scale/fps + VP9 yuva420p CRF36 `-an`；候选原片离线原样 | `a716f8e8…` |
| crowd 12 张 original | Spriters Resource 92512（provenance.json） | P5/PS3 | **未改动**，哈希 12/12 与 provenance 一致 | 见 `provenance.json` |
| 外部 24 个明智文件 | persona-dist（INDEX/manifest 别名定位） | P5/P5R/P5X | 不进入允许清单；离线保留，哈希见排除清单 §2 | 见排除清单 |

**许可状态**：全部游戏素材维持「未核实」口径（`docs/operations/limitations.md`），
替换用的 `bg-velvet.jpg` 表述为「Atlus 免费配布虚拟背景，个人非商业装饰」，**不宣称已获授权**；
新适配图标由站内既有素材转换，不引入新许可问题。**未使用 AI 重绘代替原版提取。**

## 6. 改前 / 改后截图

截图目录：`/Users/学习/blog/.dsh/screenshots/`（不入库）。本次素材清理的改前对象是
**含明智的角色素材**，按任务书「排除清单不嵌入角色图片」的要求，**不把改前角色图贴进报告**；
改前状态以原文件哈希 + 归档路径记录（见移除清单）。

| 证据 | 文件 | 说明 |
| --- | --- | --- |
| 手机桌面（改后） | `n6-phone-desktop-desktop.png` | 两页桌面实际渲染；COOP 图标为「两人并肩」配对图标（`app/coop.png`），无明智头像 |
| 手机 COOP 应用（改后） | `n6-phone-coop-desktop.png` | 打开 COOP 后界面；无 crow 图标请求 |
| p5r-platinum 封面（改后，桌面） | `n6-platinum-cover-desktop.png` | 封面图成功解码（`naturalWidth>0`）、视觉可接受：天鹅绒房间空景（页面红色滤镜为站点样式），**无破图** |
| p5r-platinum 全文（改后，390px） | `n6-post-platinum-narrow.png` | 窄屏整页；文章文字中「明智吾郎」等**文字提及保留**（按要求不删文字） |
| 首页 / 地图 / 图库 / 殿堂 / 关于 / 手机 COOP 页 | `n6-{home,map,gallery,showcase,about,coop}-desktop.png` | 浏览器实际访问时逐页截图，同一会话收集下载文件做资源校验 |

画面复核（人工读图）中间产物（`.dsh/n6-review/`）：
`sheet-characters.png`（10 立绘 + 10 角色图标）、`sheet-special.png`（9 封面 + 美术/背景/UI）、
`sheet-appicons.png`（10 应用图标）、`sheet-map.png`（25 地图图形）、`sheet-crowd.png`（人群剪影）、
`sheet-misc.png`（天气/光标/框体）、`ref/*.png`（外部参考表）、`video/*.png`（过场候选抽帧）。

## 7. 测试命令和实际结果

执行目录均为 `/Users/学习/blog/Blogs`（前端命令在 `apps/web`）。**以下为 N6 现场实测**，
失败项如实归因到其他在研任务，不改他人代码来「让检查通过」。

| 命令 | 目录 | 结果 | 归因 |
| --- | --- | --- | --- |
| `npm run test -- --run` | `apps/web` | **82 files / 866 tests 全部通过（exit 0）**；首跑时 N5 在研测试 2 例失败，N5 收口后复跑全绿 | — |
| `npx vitest run features/coop features/velvet features/phone features/legacy features/exploration tests` | `apps/web` | **41 files / 415 tests passed**，exit 0 | N6 改动相关（manifest/图标/迁移引用） |
| `npm run typecheck` | `apps/web` | **exit 0** | — |
| `npm run lint` | `apps/web` | **1 error**：`features/journal/save-screen.tsx:85 react-hooks/set-state-in-effect`（N2 在研文件） | 非 N6 范围；N6 未改该文件 |
| `npm run build` | `apps/web` | **exit 0**（最终复验 BUILD_ID `XZO0M5eJTSghQigFEOZZd`，10:51；含 `/gallery`、`/posts/[slug]` 等新路由） | — |
| `python3 tools/acceptance/verify-no-akechi-assets.py` | 仓库根 | **PASS：7 项全部通过**（exit 0；扫描 2555 个生产产物文件，跳过 377 个 source map） | N6 |
| `python3 tools/acceptance/verify-no-akechi-downloads.py` | 仓库根（服务 3102） | **PASS**：7 个页面、**117 个浏览器实际下载的 `/assets/**` 文件**逐一校验无明智；被移除 2 个 URL **404**；platinum 封面正常；crowd 12/12 哈希一致 | N6 |
| `node apps/web/tools/legacy-migration/migrate.mjs --assets-only` | 仓库根 | 通过；「模拟回滚源」场景后 public 仍无 `icon/crow.webp`、`band-halftone.jpg`；最终公开目录哈希树与操作前**逐字节一致** | N6 防再生证据 |

**分类状态（不互相替代）**

| 维度 | 状态 | 依据 |
| --- | --- | --- |
| 功能 | ✅ 通过 | 构建、类型、N6 相关测试、HTTP 下载、manifest 图标文件存在性测试 |
| 视觉 | ✅ 通过（N6 范围内） | 改后截图实看：封面无破图、手机图标正确、公开目录无角色图；**整体站点视觉还原由 N7/N0 判定** |
| 真机 / 触控 | ⏳ **未验证（N6 不涉及新 UI 交互）** | 本次只换图标/封面与资源，无新增触控目标；N7 按 §8.4 执行 |
| 迁移（数据库） | N/A | N6 无数据库迁移 |
| 资源复核 | ✅ 通过（记录完整） | 三份清单 + 画面复核记录 + 哈希；外部新库未落地见 §8 |

## 8. 未完成项、已知限制、需要的权限或外部条件、恢复/回退说明

1. **外部精选库 `persona-curated/` 未落地**（主要缺口）。原因：目标路径
   `/Users/v/Documents/ChatGPT/Blog开发/assets/reference/persona-curated/` 在工作区外，
   当前文件沙箱 `workspace-write`，写入会被拒；按 Lead 裁决改走「仓库内三份清单 + 精选方案 +
   复验脚本」替代方案，**未反复重试写入**。
   - 影响：**默认参考入口仍指向旧库**；旧库仍含未审核的全量缩略图与合图（含含明智素材），
     后续需要一次性的外部目录写入授权来建立 `persona-curated/` 并把默认入口切到新库。
   - **不影响主验收项**：网站公开目录、构建输入、构建产物与浏览器实际下载文件均已无明智。
   - 执行方案与最小权限清单见 `docs/design-references/persona-curated-plan.md` §4。
2. **未逐帧核完的参考视频**：`SHOWTIME.mp4`、`对话框新-有立绘.mp4`、`人物-*`、`好感度-*`、
   `五维增加*` 等一律标「未审核，不进允许清单」（见排除清单 §4）。没有为了让清单好看而放宽。
3. **合图未逐元素确认身份**：`92093-confidant-icons`、`92141-profile-pictures`、
   `132781-confidant-portraits`、`132782-im-assets`、`132783-photos-im`、`134224-buttons-icons`
   等整份不进允许清单；已提取的 `.dsh/p0-analysis/` 154 个裁片同样未审核（排除清单 §3/§6）。
   → 若后续需要从这些合图取素材，必须先逐元素身份核对（可用 `tools/p0-contact-sheets.py` 辅助）。
4. **完整「游戏存档」整屏参考帧仍缺**（N2 依赖）：只有元件表 `92140-save-load.png`。
5. **命名与画面不一致（仅记录未改名）**：`portrait/joker.png` 实为 Arsène；`morgana-thief.webp`
   实为芳泽霞；两者站内无引用。
6. **仓库内替换封面的语义说明**：`cover/platinum.jpg` 保留文章路径、改为天鹅绒房间空景，
   文章文字未改；如后续希望改用其它通用封面，只需替换该文件（路径不变，无需改数据）。
7. **`.dsh/archived-assets/` 归档**：被 `.git/info/exclude` 忽略、不参与构建与静态服务；
   恢复命令见移除清单 §1（恢复含明智文件会重新违反本轮要求，只在明确授权时执行）。
8. **N5 新媒体归属**：`apps/web/public/assets/clip/isekai-showcase.webm` 为 N5 创建（未提交、
   242KB）；N6 只读复验、未覆盖未删除。是否入库/public 下 clip 目录的 Git 策略由 N0 决定
   （根级 `assets/clip/` 仍在 `.gitignore`；`apps/web/public/assets/clip/` 未被忽略）。
9. **回退方式**：N6 改动集中在两个 manifest、三个工具文件、`assets/` 3 个资源与文档；
   资源恢复用移除清单命令；代码回退可 `git checkout -- <file>`（注意保留其他任务对该文件的改动：
   `tools/acceptance/verify-ins-media-loop.py`、`tools/p0-contact-sheets.py` 仅 N6 改过）。
   无数据库迁移、无破坏性副作用。

## 附录 A · 三份清单与配套文件索引

- 允许清单（含逐项来源/处理/复核/许可）：`docs/design-references/persona-assets-allowlist.md`
- 排除审计清单（仅文字元数据，不嵌入角色图片）：`docs/design-references/persona-assets-excluded.md`
- 移除 / 恢复清单（哈希 + 归档 + 恢复命令 + 迁移守卫实测）：`docs/design-references/persona-assets-removed.md`
- 逐文件哈希表：`docs/design-references/persona-assets-manifest.csv`（171 行）
- 外部精选库方案与缺口：`docs/design-references/persona-curated-plan.md`
- 图标映射（已更新）：`docs/design-references/icon-mapping.md`
- 复验脚本：`tools/acceptance/verify-no-akechi-assets.py`、`tools/acceptance/verify-no-akechi-downloads.py`

## 附录 B · 给 N7 的可执行检查清单（命令 + 期望输出）

```bash
# ── 0. 前置：构建并启动生产服务（先确认没有别的 next build 在跑）
cd /Users/学习/blog/Blogs/apps/web
pgrep -fl "next build" || echo "OK: 无并发构建"
npm run build                      # 期望 exit 0
npx next start -p 3102 -H 127.0.0.1 &   # 期望日志 "Ready"

# ── 1. 静态资源复验（无需服务）：期望最后一行 PASS、exit 0
cd /Users/学习/blog/Blogs
python3 tools/acceptance/verify-no-akechi-assets.py
#   [PASS] 1) 公开目录/构建输入无含明智原文件哈希
#   [PASS] 2) 点名路径不存在（icon/crow.webp、band-halftone.jpg）
#   [PASS] 3) 公开目录/构建输入无明智别名文件名（crowd 放行）
#   [PASS] 4) 前端运行时不再引用 /assets/legacy/img/icon/crow.webp
#   [PASS] 5) 替换资源存在且哈希正确（mementos / platinum / coop）
#   [PASS] 6) crowd 人群过场完整（12/12 哈希 + 代码引用）
#   [PASS] 7) 生产构建产物无被移除文件名引用（已跳过 .next/dev）
#   PASS: 7 项检查全部通过 —— …

# ── 2. 浏览器实际下载复验：期望 PASS + 证据 JSON
python3 tools/acceptance/verify-no-akechi-downloads.py
#   PASS: 浏览器实际下载 N 个 /assets 文件均无明智素材；被移除 2 个 URL 均 404；
#         platinum 封面正常；crowd 12/12 哈希一致。
#   证据：/Users/学习/blog/.dsh/screenshots/n6-download-evidence.json（problems 应为 []）
#   截图：/Users/学习/blog/.dsh/screenshots/n6-*.png

# ── 3. curl 点检（也可在 N7 的浏览器环境里做）
B=http://127.0.0.1:3102
for p in /assets/legacy/img/icon/crow.webp /assets/legacy/img/band-halftone.jpg; do
  test "$(curl -s -o /dev/null -w '%{http_code}' "$B$p")" = 404 || echo "FAIL $p"
done                                                     # 期望两行都不输出
for p in /assets/legacy/img/icon/mementos.webp /assets/legacy/img/app/coop.png \
         /assets/legacy/img/crowd/original/crowd000_000.pac_0_risultato.png; do
  test "$(curl -s -o /dev/null -w '%{http_code}' "$B$p")" = 200 || echo "FAIL $p"
done                                                     # 期望两行都不输出
curl -s "$B/assets/legacy/img/cover/platinum.jpg" | shasum -a 256
#   期望 394c37ce82717c45f83bd78d09ecad288fb506e42ac2eb0ab19d7fed7d69d142
curl -s "$B/" | grep -c "icon/crow.webp"                 # 期望 0

# ── 4. crowd 过场仍可用（N7 在浏览器里走 /map → 任一地点「出发」）：
#   期望人群剪影过场播放、无报错；或直接点检
grep -c 'crowd/original/' /Users/学习/blog/Blogs/apps/web/features/runtime/effects/crowd.ts   # 期望 ≥12
python3 - <<'PY'
import json,hashlib,pathlib
root=pathlib.Path('/Users/学习/blog/Blogs/apps/web/public/assets/legacy/img/crowd/original')
prov=json.loads((root/'provenance.json').read_text())
bad=[s['file'] for s in prov['sprites'] if hashlib.sha256((root/s['file']).read_bytes()).hexdigest()!=s['sha256']]
print('crowd hash mismatches:', bad)   # 期望 []
PY

# ── 5. 文章文字提及未被误删（允许保留文字）：
grep -c "明智" /Users/学习/blog/Blogs/apps/web/features/legacy/data/posts.json   # 期望 >0（实测 3）
```

> 判定口径：第 1/2 节两个脚本退出码为 0 即「资源复核通过」；截图与浏览器行为仍需 N7 按
> 任务书 §8.4 另行判定，**测试通过不自动等于视觉/真机通过**。
