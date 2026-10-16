# T00 · 集成收口报告

对应交接包：`PHANTOM-LOG-agent-handoff-2026-10-16`
基线：`9d9bfe7`（交接包所在提交） → 当前：`866e627`（工作区干净）
本报告写于集成期的收口阶段；所有数字都在**当前干净树**上现场复核过，复核命令随附。

---

## 1. 状态判定

按 ACCEPTANCE §3 的五个状态词（「代码就绪」「已集成」「已预览验证」「可生产发布」「已部署」）：

| 状态 | 是否达到 | 依据 |
| --- | --- | --- |
| 代码就绪 | ✅ | 11 个包全部交付 |
| **已集成** | ✅ | T00–T10 全部 `integrated_verified`；单头迁移、契约与类型已生成 |
| **已预览验证** | ✅ | 真实 PostgreSQL + 真实浏览器 + 真实反向代理；见 §3 |
| **可生产发布（就绪报告）** | ✅ **但附两条未完成前置** | 见 §5 |
| 已部署 | ❌ | **未部署到任何生产环境，也未获得部署授权** |

**结论：停在「可生产发布（就绪报告）」。** 容器未验证、域名与 TLS 未配置 —— 这两条不补齐，
不得对外宣称已上线。

## 2. 交付了什么

11 个包全部集成（顺序 T00 → T01/T02 → T03/T04/T05/T07 → T06/T08 → T09 → T10）：

| 来源 | 内容 | 手机入口 |
| --- | --- | --- |
| T00 | 地基：仓库布局、契约、迁移体系、CI 守卫、错误信封、readiness | — |
| T01 | 站主登录、文章只读、标签、媒体与权限变体、速率限制 | — |
| T02 | 旧站迁移外壳、地图/关于/天气/留言板、持久音乐、过场、手机宿主 | — |
| T03 | INS 图文（草稿/发布/撤回/收藏/分享） | `ins` |
| T04 | 异世界导航（专题/关键词匹配/搜索/本地足迹） | `metanav` |
| T05 | 手记、放课后、勒布朗近况 | `journal` / `leisure` |
| T06 | 我的殿堂（作品/相册/照片墙/灯箱） | `showcase` |
| T07 | COOP 友链通讯录与管理 | `coop` |
| T08 | 原版 IM 与剧情/混合角色消息（**默认本地模拟**） | INS 内「消息」页签 |
| T09 | 天鹅绒技能全书与印象空间问题记录 | 从档案 / 异世界导航进入 |
| T10 | 容器生产化、CI、备份恢复、运维文档、发布清单 | — |

**规模**（`git rev-list --count 9d9bfe7..HEAD` = **134 个提交**）：

| 维度 | 值 | 复核命令 |
| --- | --- | --- |
| 契约路径 | **85 条** | `python3 -c "import json;print(len(json.load(open('contracts/openapi.json'))['paths']))"` |
| 数据库表 | **34 张**，9 个迁移文件，**单一 head `528a38f23614`** | `cd apps/api && uv run alembic heads` |
| 后端测试域 | 14 个目录 | `ls -d apps/api/tests/*/` |
| 前端测试文件 | 70 个 | `find apps/web -name '*.test.ts*'` |
| 手机应用 | 6 个（+4 个 site-link 入口） | `apps/web/features/phone/registry.ts` |
| 验收工具 | 5 个 | `ls tools/acceptance/` |

## 3. 证据（全部在当前树上现场跑过）

| 验证面 | 结果 | 命令 |
| --- | --- | --- |
| 后端整树（串行） | **911 passed / 0 failed** | `uv run --project apps/api pytest apps/api/tests` |
| 前端 | **713 passed / 69 文件** | `npm --prefix apps/web run test -- --run` |
| 前端类型 / lint / 构建 | **0 / 0 / 0** | `run typecheck｜lint｜build` |
| 旧站零回归 | **53 passed** | `node --test tests/*.test.cjs` |
| T02 浏览器套件 | **48 / 48** | `python3 apps/web/tools/browser-verification/verify.py` |
| T10 备份恢复演练 | **34 / 34** | `python3 tests/e2e/integration/verify-backup-restore.py` |
| T10 健康演练 | **11 / 11** | `python3 tests/e2e/integration/verify-health-drills.py` |
| T10 反代同源写 | **34 / 34** | `python3 tests/e2e/integration/verify-proxy-same-origin.py` |
| 验收工具 ×5 | 全部通过 | `ls tools/acceptance/` |

**验收矩阵**（ACCEPTANCE §2，15 行）：**13 行完整验证**、**1 行部分验证**、0 缺失。
部分验证的那一行是「日记 private 或 draft 不泄漏」—— 标题/正文/图片/日历计数已验
（`public_conditions()` 一处定义、四重条件，被公开端点与媒体公开引用共用），但
**「搜索」路径尚未接线**（所以那条不是因为过滤生效，而是因为功能没接）、**「AI」路径未接通**。
这两项是**依赖缺口，不是代码缺陷**，按未验收处理。

**五个验收工具**覆盖集成期实际踩到的五类问题：

| 工具 | 覆盖 |
| --- | --- |
| `verify-ins-media-loop.py` | 发布图文闭环 + 派生变体匿名可读、原图仅管理用途 |
| `verify-media-multiref.py` | 同图多引用：撤回一处不失效、全部撤回才 404 |
| `verify-album-moment-retract.py` | 动态撤回但照片仍在公开相册（验收矩阵第 6 行） |
| `verify-restore-revokes-sessions.py` | 恢复备份**会让已撤销会话复活**，因此恢复流程必须撤销会话 |
| `verify-client-paths.py` | 桌面 19 页 + 手机 10 应用的全部 `/api/v1` 响应码 |

## 4. 集成期发现并修掉的缺陷（每包自测都通过、集成才现形）

这一节是本次集成最值得留下的部分：**下面每一条，相关包的浏览器套件当时都是全绿的**。

| # | 缺陷 | 为什么单包测不到 | 修法 |
| --- | --- | --- | --- |
| 1 | `list_public_tags()` 返回 `(规范值, 展示名)`，与 docstring/router/schema 相反 → API 的 `name`/`normalized` **互换** | 展示名恰等于规范值时互换不可见 → **间歇性失败** | 修正返回顺序（`4941880`） |
| 2 | 手机里**消息功能不可达**：canonical 页接了页签，但手机走的是另一个组件 | 服务端渲染正常，只有手机路径缺入口 | 注入同 id/order 的页签，`onOpen` 接宿主导航（`0888e73`） |
| 3 | `apiRequest` 无条件拼 `base + path`，调用点传了绝对路径 → `/api/v1/api/v1/...` | **服务端渲染正常**，只有客户端交互与手机暴露 | 前缀幂等（`4fba869`） |
| 4 | `fetchProject` 把**页面路径**当 API 路径 → `/api/v1/showcase/projects/...` | 同上 | 改用相对 API 路径（`4f9faec`） |
| 5 | 恢复备份让**已撤销的会话复活**（`revoked_at` 被覆盖回 `NULL`） | 无人验过这条路径 | 发现并补 `revoke_sessions` CLI，T10 接入恢复流程 |
| 6 | 两处裸 `<a>` 站内链接绕过导航协调器 | 实测**不会**整页重载（Next 全局拦截），差别是**过场** | 改用 `SiteLink`（`3529ed0`） |

另有若干**我自己的测量/操作错误**，都已当场纠正并记入台账 —— 包括：假通过的匿名读、
cookie jar 被登出清空导致的假结论、把 T03 的 Origin 诊断更正为「生产形态下不存在」、
静态路径审计正则不可靠改用运行时审计、以及多次「先怀疑自己的测法再下结论」。

## 5. 未验证项与发布限制（**不得当作已通过**）

**两条未完成的前置（阻塞「已部署」）**：

1. **容器构建与容器内启动未验证** —— 本机 Docker daemon 不可用。
   `deploy/` 在本机做了静态审查、`compose config` 校验、`caddy validate`，
   并按 Dockerfile 的 COPY 逐条复刻 runner 布局真实运行了 `node apps/web/server.js`
   （`/` `/about` `/apps/ins` 与 public/static 资源均 200）—— 但**容器本身没有被运行过**。
   **跑通前 `deploy/` 不得宣称容器可用。**
2. **真实域名、TLS 与 `__Host-` Cookie 未验证** —— 无域名、无证书。反向代理形态本身
   已验证（41 项同源写 + 音频 Range）。

**依赖缺口（按未验收处理）**：

- **真实 AI 模型未接通**：无供应商、无凭证、无预算。**没有采购或启用任何收费调用**；
  默认走本地模拟服务，不联网不计费。AI 相关的「超时/额度/重试」只在模拟层验证过。
- **手记/放课后未接进搜索**：所以「私密不进搜索」目前**不是因为过滤生效**，而是该路径不存在。
- **仓库里没有任何真实照片素材**：画廊线上内容为空。seed **拒绝用游戏素材或占位图冒充照片**
  （这是对的做法）；相册相关语义已用测试图验证（验收工具之一）。

**其它未验证**：真机触控与软键盘、Safari / Firefox、音频真实出声、磁盘真塞满演练、
GitHub Actions 实际执行（无远端，`ci.yml` 已如实标注）、多 worker 压测、读屏软件、
T08 的原版 IM 视觉还原本身（只拿到元件素材表、没有完整参考帧，因此只做了结构 + 已确证语汇的原创适配）。

## 6. 交付物位置

| 内容 | 位置 |
| --- | --- |
| 各包交付单（11 份） | `docs/agent-deliveries/T{00..10}-result.md` |
| 集成台账（逐条决策与证据） | `docs/agent-deliveries/T00-integration-log.md` |
| 运维手册 | `docs/operations/{README,release,backup-restore,runbook,limitations}.md` |
| 发布清单（**已重签**） | `docs/operations/release.md` §1 |
| 部署编排 | `deploy/`、`.github/workflows/` |
| 验收工具 | `tools/acceptance/` |
| 浏览器套件 | `apps/web/tools/browser-verification/verify.py` |
| 本地测试集群脚本 | `tools/pg-local.sh` |

## 7. 下一步（按优先级）

1. **有 Docker daemon 后**：构建两个镜像、`compose up`、验容器内 readiness 与非 root，
   把真实输出补进 `T10-result.md` 与 `docs/operations/release.md`。
2. **补齐两条依赖缺口**：接入手记/放课后的搜索路径；落实 AI 供应商、凭证与预算
   （在此之前保持默认模拟）。
3. **域名与 TLS**：配置后验证 HTTPS 下的 `__Host-` Cookie 与网关头转发。
4. **真人素材**：提供真实照片后跑相册相关流程（语义已验，缺的是素材）。
5. 上述完成前，发布状态停在**「可生产发布（就绪报告）」**，不对宣称已上线。
