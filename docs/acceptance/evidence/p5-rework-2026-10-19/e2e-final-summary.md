# P5 返工包 R1/R2/R3 · 独立浏览器端到端复验摘要

日期：2026-10-19（Asia/Shanghai）· 环境：仓库自带隔离栈（前端 3130 / API 8130 / Postgres 55434 / 数据 /tmp/pl-e2e-stack）
引擎：Playwright chromium 148.0.7778.96（headless）· 视口：1440x1000（桌面斜屏手机）、390x844、320x700
真机 / WebKit：**未验证**（本摘要只代表桌面 chromium + 隔离栈）

## 结论

| 项 | 改前（基线 9917890） | 改后（HEAD 7a19eb2） |
|---|---|---|
| R1 保存失败不得提交旧草稿 | FAIL（r1-ins 5/14、r1-journal 9/15；commit 次数 1，虚假成功，正式内容被旧草稿覆盖，本机副本被清） | **PASS** r1-ins 14/14、r1-journal 15/15 |
| R2 新草稿跨设备恢复 | FAIL（r2-moment 16/26、r2-journal 12/23；行链接无 `?draft=`，B 设备全空白，错误 ID/类型静默空白） | **PASS** r2-moment 26/26、r2-journal 23/23 |
| R3 手机内自由聊天入口 | FAIL（r3-phone 8/22；`.msg-composer`/`.msg-usage`/`.pw-expand` display:none，href 仍 /apps/ins） | **PASS** r3-phone 44/44 |
| 合计 | 52 pass / 50 fail / 0 skip，exit 1（预期） | **124 pass / 0 fail / 0 skip，exit 0** |

修复提交：`afafdf8`（R1+R2）、`8b826c9`（R3）、`7a19eb2`（R2 恢复时拒绝已丢弃/已提交草稿）。

## 构建来源（关键口径）

- 改前：`BUILD_ID=uzuVcJcrRD8VZLXC34j0j`，构建时间 2026-10-19 05:32；`/tmp/pl-e2e-stack/web` 的 apps/web 源码与 `HEAD 9917890` 逐文件一致（运行前对当时已修改的 14 个 web 文件逐一比对 build 副本 vs `git show 9917890:`：全部一致）→ 改前证据确为基线代码。
- 改后：`down → up` 全新 initdb + 隔离生产构建，`BUILD_ID=x46VxuFXLS83Km5gubNnP`，构建时间 08:59；构建副本与 `HEAD 7a19eb2` 逐文件一致（features/app 全目录 diff 为空，use-work-draft.ts/types.ts spot check 一致）→ 改后证据包含全部修复。

## 场景明细（改后）

- r1-ins 14/14：阻断 PATCH(`/admin/work-drafts/<id>`)→点「更新正式内容」：commit 请求 0 次、无 `data-editor-success`、正文保留、`pl.workdraft.v1.*` 本机副本含最新文字、正式内容未被旧草稿覆盖；解除阻断重试 → commit 成功且 `GET /admin/moments/<id>` 正文=最新输入。
- r1-journal 15/15：同上（数据为已有正式手记的「保存」路径）。
- r2-moment 26/26：设备 A 只自动保存（2 图 + alt + 相册收录）；设备 B 全新 context 仅 cookie（localStorage 空），行链接 `href=/admin/moments/new?draft=<id>`，恢复正文/图片顺序/alt/相册收录，`?draft=` 刷新仍恢复，两份同类草稿点哪份恢复哪份（不串稿），无类型错配/空白新建。
- r2-journal 23/23：日期 2026-10-02 / 标题 / 正文 / 图片 / 默认 private 跨设备恢复 + 刷新；跨类型、不存在 UUID、已丢弃草稿均显示准确错误提示、不加载内容、不静默空白新建。
- r3-phone 44/44：桌面 1440x1000 从 `.pw-tab`→INS→消息→futaba 会话；`.msg-composer` 可见、折叠态「自己说一句」→展开 textarea→输入→发送成功并清空；`.msg-usage` 可见；`.pw-expand` 可见且 `href=/apps/ins/messages/futaba`，点击进入 canonical 且仍有输入区；390x844/320x700 同流程 + `elementFromPoint` 命中测试（输入框/发送/usage 中心点均命中自身）+ 控件完整在视口内 + composer/usage/hints/choices 两两不相交；截图含剧情态与自由输入态。

## 额外回归（同 after 构建，全新 DB 上按顺序执行）

| 脚本 | 结果 | exit |
|---|---|---|
| `P5_E2E_READY=1 tools/e2e-p5-workspace.py` | 219 pass / 0 fail | 0 |
| `tools/e2e-phone-scroll.py` | 滚动位置已恢复 | 0 |
| `tools/e2e-journal-reading.py` | 正文在手机内打开，手机未关闭 | 0 |
| `tools/e2e-ins-tag.py` | 标签筛选在手机内，手机未关闭 | 0 |
| `tools/e2e-ins-conversation.py` | 会话在手机内，手机未关闭 | 0 |
| `tools/e2e-metanav-palace.py` | 殿堂正文在手机内打开，手机未关闭 | 0 |
| `tools/e2e-im-draft.py` | 草稿仍在 | 0 |
| `tools/e2e-ins-album-links-ui.py` | 9 pass / 0 fail | 0 |

说明：e2e-p5-workspace 在 08:56 旧构建上曾出现 217/2（workspace 空态断言 + picker 选择口径），经查是本返工 e2e 先跑留下的工作草稿/媒体库数据污染；media-picker 在 9917890..HEAD 未改动，**非本返工引入**。全新 DB 上 219/219。

## 复验中额外发现并已修复的缺陷（R2）

after 首轮（8b826c9）发现：已丢弃的工作草稿经 `?draft=` 恢复时被当作有效草稿加载（GET 对任何状态返回 200，前端 `use-work-draft.ts` requestedDraftId 分支缺 `status === "active"` 校验），违反 R2 要求「已丢弃…显示准确状态」。
→ 已由 lead 修复提交 `7a19eb2`，本轮 7a19eb2 构建复验：显示「这份工作草稿已被丢弃，不能继续编辑…」、不加载内容、不静默空白新建，r2-journal 23/23 通过。
复现证据：`after/repro-discarded-draft.log`、`after/repro-discarded-draft-loaded.png`。

## 未验证 / 风险

- 真机 iOS/Android、真实软键盘与中文输入法 composition（合成中不误发送）：未验证。
- R3 音乐继续播放、输入草稿在 App 内切换/返回/展开后的保留、发送失败重试与限额耗尽提示：仅部分覆盖。
- R1 的 412/401/暂停状态旁路、相册新建 `saveNow` 调用方、提交期间更晚输入不被清：未覆盖（本轮只做 PATCH 500 故障注入）。
- R2「另存为新草稿」生成的草稿跨设备恢复：未覆盖。
- `e2e-stack.sh` 已知坑（非产品缺陷）：对运行中的栈直接重复 `up` 会无条件 `pg-local.sh init`（rm -rf PGDATA），旧 postgres 进程挂在已删数据目录上 → 必须 `down → up`。本轮 after 首次踩到，已按 down→up 恢复并记录。

## 环境安全

- 只使用隔离栈 3130/8130/55434，未使用共享 3100/8100/8000/55432，未复用共享 .next；结束已 `e2e-stack.sh down`。
- down 前后共享端口 PID 完全一致（postgres 14164 / Python 8100=18631 / Python 8000=19294 / node 3100=50666），隔离端口 3130/8130/55434 已无监听。
- 未修改应用源码 / 既有 e2e 脚本 / 配置；新增仅 `Blogs/tools/e2e-p5-rework.py`（sha256=284e7f43… 与 after JSON 内一致）与本证据目录。

## 文件索引

- 改前 JSON/日志/截图：`rework-evidence/baseline/e2e-p5-rework.json|.log`、`.dsh/screenshots/p5-rework/baseline/`
- 改后 JSON/日志/截图：`rework-evidence/after/e2e-p5-rework.json|.log`、`.dsh/screenshots/p5-rework/after/`
- 回归日志：`rework-evidence/after/regression-*.log`、`regression-summary.json`
- 构建日志：`after/build-up.log`（首次踩坑）、`after/build-up-7a19eb2.log`（最终构建）
- 端口核对：`after/port-check-before-down.txt`、`port-check-after-down.txt`、`stack-down.log`

## 脚本版本口径

- baseline JSON 的 `script_sha256=463ba119…`（该次运行后仅追加 13 个「草稿错误提示」中文关键词与遮挡检测容错，未删除/放宽任何断言；baseline 的 r2-journal 错误提示 3 条在旧脚本下同为 FAIL）。
- after JSON 的 `script_sha256=284e7f4387dcb5bd22a99eddc271fef9096b357b3a9b9a5224a306666165cd13`（= 当前 `tools/e2e-p5-rework.py`）。
- 当前 `tools/e2e-p5-rework.py` 仅由本次验收新增，未修改任何应用源码 / 既有 e2e 脚本 / 配置。
