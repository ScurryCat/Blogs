# P2 补充交付：IM 原版黑白头像（替换彩色立绘 + 灰度滤镜）

> 任务书：`2026-10-17-p5-phone-ui-v2-agent-brief.md`（第二轮 · P5 怪盗手机 UI v2）
> 对应条目：**§4.2 IM 视觉**（「角色列表使用原版黑白头像，替换目前对彩色立绘施加灰度滤镜的方式」）、
> §2.3/§8.1 图标映射与可追溯记录、§5 素材边界。
> 项目：`/Users/学习/blog/Blogs` · 分支 `main` · **未 git commit / push / deploy（由集成负责人统一提交）**
> 执行环境：本执行模型**具备图像输入能力**（可读图核对），因此补上了 P6 报告中「无图像输入 → 视觉/身份核对阻塞」中的素材身份核对这一条。**整屏视觉还原仍未完成**（见 §6）。

---

## 1. 完成范围

| 任务书要求 | 状态 | 说明 |
| --- | --- | --- |
| §4.2 角色列表使用**原版黑白头像** | ✅（IM 现有 2 个角色全部完成） | 双叶、摩尔加纳改为 P5 游戏 SNS/IM 黑白头像 sprite |
| §4.2 **替换「彩色立绘 + grayscale 滤镜」** 的方式 | ✅ | 移除 `.msg-avatar img` 的 `filter: grayscale(1) contrast(1.45) brightness(1.02)` |
| §8.1 图标映射可追溯（用途/原图/版本/来源/裁切/路径/原版或适配/许可） | ✅ | 记录写入 `docs/design-references/icon-mapping.md` §4.4 + `avatar-verification-checklist.md` §5 |
| §5 素材边界：只接入明确选定资源、不把参考库打进构建 | ✅ | 只复制 2 个 sprite 到仓库静态目录；参考库仍离线 |
| 排除明智吾郎（第三轮 §5.2 红线） | ✅ | 接入的两个 sprite 均非明智；`verify-no-akechi-assets.py` 仍 PASS |
| IM 整屏布局视觉还原（G1/G2 参考帧） | ❌ 未完成 | 仍缺普通文字/回复选择完整参考帧，见 §6 |

## 2. 修改文件

**新增**

| 文件 | 作用 |
| --- | --- |
| `assets/img/avatar/futaba.png`（117×117，4,713 B） | 迁移源（旧站 `assets/img/**` → `public/assets/legacy/img/**` 的复制来源） |
| `assets/img/avatar/mona.png`（93×93，3,957 B） | 同上 |
| `apps/web/public/assets/legacy/img/avatar/futaba.png` / `mona.png` | 站点公开目录实际下发文件 |
| `apps/web/features/messaging/avatar-assets.test.ts` | 3 例：文件存在 / 正方形 PNG / 体积上限；角色卡路径不得回退彩色立绘 |
| `docs/agent-deliveries/P2-original-avatars-result.md` | 本报告 |

**修改**

| 文件 | 改动 |
| --- | --- |
| `apps/api/app/modules/messaging/characters.py` | `PORTRAIT_FUTABA` / `PORTRAIT_MONA` → `/assets/legacy/img/avatar/*.png`；`avatar_alt` 改为「原版黑白头像（P5 游戏 SNS 头像，本站静态资源）」；补素材来源与处理注释。**API 契约、DB 模型、角色卡字段均未变** |
| `apps/api/tests/messaging/test_stories.py` | 头像路径断言改为 `avatar/` 前缀 + 不得回退 `portrait/`（保留「不得依赖仓库外参考库」断言） |
| `apps/web/features/messaging/messaging.css` | 删除头像图片的灰度/对比度滤镜（临时手段），注释说明改为原版黑白 sprite 直接呈现 |
| `apps/web/features/messaging/conversation-screen.tsx` | 缺省头像回退路径同步到 `avatar/` 目录 |
| `apps/web/features/messaging/messaging-css.test.ts` | 新增 1 例：头像规则不得再出现 `filter:` / `grayscale(`（防回归） |
| `docs/design-references/icon-mapping.md` | §2 表格行更新 + 新增 §4.4「IM 黑白头像：已核对并接入」 |
| `docs/design-references/avatar-verification-checklist.md` | 回填 #20 身份/许可、补 §5 首批核对结果（含双叶 #13 漏选说明与识别方法） |

**没有新增依赖、没有改路由、没有改数据库迁移。**

## 3. 素材与参考

| 角色 | sprite | 原图（参考库，离线） | 版本/来源 | bbox | 处理 | 落盘哈希 |
| --- | --- | --- | --- | --- | --- | --- |
| 双叶 | #13（`p5-profile-pics-13-148_9-88x118.png`，87×117） | `persona5-spriters/p5/hud/92141-profile-pictures.png` | P5 / PS3 / [Spriters Resource #92141](https://www.spriters-resource.com/playstation_3/persona5/asset/92141/) | `148,9,87,117` | 透明画布居中补正方形 → 117×117；未缩放/未裁切/未调色/未 AI 重绘 | `1f0fc13cef36d2bc…`（完整值见本地 `.dsh/avatar-inspect/avatar-manifest.json`） |
| 摩尔加纳 | #20（`p5-profile-pics-20-273_275-92x94.png`，91×93） | 同上 | 同上 | `273,275,91,93` | 同上 → 93×93 | `f2e1e1747c2cddc9…` |

**识别依据（不是按名字/「看起来像」猜）**

1. 先确认这套 sprite **就是游戏内 IM/SNS 头像**：本地参考帧
   `persona-dist/media/image/P5R/p5r-sns--4aa5330b1fe6.jpg` 的聊天参与者头像与 sprite 表内
   `#35`（龙司咧嘴笑）同源；同一批头像也出现在 P5R IM 元件表 `132782-im-assets-cn-jp`。
2. 双叶：圆框大眼镜 + 头戴式耳机 + 长发 = 双叶标志性组合；P5R IM 元件表 #10/#11 为同一头像。
3. 摩尔加纳：全部联系人头像中只有 #20 是猫头（尖耳 + 咧嘴獠牙），摩尔加纳是 IM 唯一非人类
   角色；P5R IM 元件表 #17 同图；**旁证**：本地参考库 P5X SNS 图标（`snsicon02/57`）里
   摩尔加纳的头像同为「黑色猫头 + 尖耳 + 咧嘴獠牙」母题（P5X 仅旁证，未接入站点）。
4. 许可：两者均**不是明智吾郎**，满足第三轮 §5.2 排除红线；许可状态仍记「未核实」
   （参考库原文件许可表述不等于已获公开使用授权）。
5. **剩余不确定性（如实说明）**：识别基于「同源界面参考帧 + 元件表重复 + 角色特征」三重证据，
   没有官方素材站的逐格命名可对照；`avatar-verification-checklist.md` §5 建议后续人工
   再确认一次（若要撤回：把两个 `PORTRAIT_*` 常量改回 `/assets/legacy/img/portrait/`，
   并恢复 CSS 滤镜即可，见 §6 回退步骤）。

**未采用的素材**：P5R 132782 IM 元件表的其余头像、P5 头像表其余 48 个 sprite 仍「未核对、
不接入」；合图（92093/132781/132783 等）保持不进入允许清单（与第三轮 N6 结论一致）。

## 4. 视觉证据

工作区外：`/Users/学习/blog/.dsh/screenshots/`

| 文件 | 内容 | 视口 |
| --- | --- | --- |
| `p2-avatar-before-after.png` | 改前（旧彩色立绘 + 灰度滤镜，按 git HEAD 旧 CSS 静态复现）vs 改后（原版黑白 sprite）52px/140px 对照 | 1150 宽 |
| `p2-avatar-list-after.png` | 真实应用：`/apps/ins/messages` 角色列表（双叶 / 摩尔加纳，两张新头像） | 1280×900 |
| `p2-avatar-conversation-futaba-after.png` | 真实应用：`/apps/ins/messages/futaba` 会话页头像（含消息气泡头像） | 1280×900 |
| `p2-avatar-phone-messages-after.png` | 真实应用：手机壳内 INS →「消息」页签，手持斜屏内两个角色头像 | 1440×900（`--z` 默认档） |

- 浏览器实际渲染检查（Playwright 断言，`.dsh/avatar-inspect/browser-report.json`，
  **11/11 PASS**）：头像 `naturalWidth` 117/93（真实加载）、`getComputedStyle(...).filter === "none"`、
  `src` 指向 `/assets/legacy/img/avatar/`、手机内 `.pw` `transform !== none`（仍为斜屏）、
  无页面 JS 错误。
- 说明：容器是白底 + 黑描边（沿用原 `messaging.css` 规则），透明背景的原版 sprite 落在白底上，
  与游戏里黑白头像的观感一致；非正方形 sprite 已补正方形，`object-fit: cover` 不会裁掉头部。

## 5. 验证结果

| 命令 / 环境 | 结果 |
| --- | --- |
| `cd apps/web && npm run test -- --run` | **89 files / 924 tests passed**，exit 0（较上轮 919 增加 5 例：头像资源 3 + CSS 防回归 1 + 既有调整） |
| `cd apps/web && npm run typecheck` | exit 0，无错误 |
| `cd apps/web && npm run lint` | exit 0，无 error / warning |
| `cd apps/api && TEST_DATABASE_URL=…/pl_test uv run pytest tests/messaging tests/test_openapi_contract.py -o addopts="" -q` | **164 passed**，exit 0（真实 PostgreSQL；`uv run pytest` 直接跑时因仓库 `addopts=-q` 叠加 `-qq` 只打印点号） |
| `node apps/web/tools/legacy-migration/migrate.mjs --assets-only` | `img=155 fonts=6 sfx=1`，**新 `avatar/` 目录被迁移脚本纳入复制**；跑完 `git status` 无额外改动 |
| `python3 tools/acceptance/verify-no-akechi-assets.py` | PASS 7/7（新头像非明智） |
| 真实浏览器（Chromium 1223，Next dev `localhost:3131` + 隔离 API `127.0.0.1:8108`） | 见 §4，11/11 断言通过 |

> 环境说明：本项目 Next dev 在 `127.0.0.1` 下**不完成 hydration**（HMR WebSocket 失败），
> 必须用 `localhost`（与 N5 交付记录的坑一致）。API 需 `CORS_ORIGINS=http://localhost:3131`
> 才能通过访客会话的来源校验；这两条与产品代码无关。

## 6. 未完成项

1. **IM 整屏布局视觉还原未通过**：仍缺普通文字消息 / 回复选择的完整游戏参考帧
   （`reference-frame-gaps.md` G1/G2），本轮只完成「头像素材替换 + 滤镜移除」。
   影响 §4.2 / §8.1「三类完整参考帧」；不可用本报告宣称 IM 视觉还原完成。
2. **身份识别建议人工二次确认**：见 §3 第 5 条；未接入的 48 个 sprite 仍待核对。
3. **真机未验证**：本轮只做桌面 Chromium + 1280/1440 视口；真实触控与移动 Safari 未验证
   （与 P6 报告的设备缺口一致）。
4. **许可未核实**：素材许可状态保持「未核实」，若公开分发需另行确认授权。

## 7. 集成说明

- **无共享接口变更**：`CharacterCard` 字段、`/messaging/characters` 响应结构、DB 模型、
  API 契约均未变；只改了头像资源的路径常量与展示层 CSS。前端契约类型无需重新生成。
- **交叉影响**：其他任何使用 `/assets/legacy/img/portrait/{futaba,mona}.png` 的地方
  不受影响（文件保留未删）；`messaging.css` 的滤镜移除只作用于 IM 头像。
- **与第三轮 N6 的关系**：新增 2 个公开目录资源，均非明智，`verify-no-akechi-assets.py` 仍 PASS；
  第三轮素材清单不需要改动（本资源属第二轮站点装饰素材，不是活动素材库允许清单条目）。
- **回退步骤**（如需）：① `characters.py` 两个 `PORTRAIT_*` 改回 `/assets/legacy/img/portrait/*.png`；
  ② 恢复 `messaging.css` 的 `filter: grayscale(1) contrast(1.45) brightness(1.02)`；
  ③ 删除 `assets/img/avatar/` 与 `public/assets/legacy/img/avatar/` 与 `avatar-assets.test.ts`；
  ④ 还原 `test_stories.py` 断言。旧立绘文件一直保留，回退无素材风险。
- **提交**：本次改动留在工作区，未执行 git 操作；由集成负责人决定是否提交（建议独立 commit，
  便于与其他并行改动分离）。
