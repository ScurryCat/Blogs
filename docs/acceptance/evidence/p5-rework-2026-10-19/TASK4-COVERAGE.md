# task-4 补证：§8「未验证/部分覆盖」→ 真实浏览器证据

日期：2026-10-19 12:11（Asia/Shanghai）· HEAD `b6ef358` · 隔离栈（3130/8130/55434）
引擎：Playwright chromium 148.0.7778.96 headless · 视口 1440x1000 / 390x844 / 320x700
构建：`BUILD_ID=x46VxuFXLS83Km5gubNnP`（08:59，来自 7a19eb2 修复源码；本轮 HEAD b6ef358 的 apps/web 与 7a19eb2 逐文件一致，构建副本与工作树 diff 为空）

## 结果

- 8 场景一次完整运行：**208 pass / 0 fail / 1 skip，exit 0**
- 原有 5 场景无回归：r1-ins 14/14、r1-journal 15/15、r2-moment 26/26、r2-journal 23/23、r3-phone 44/44（断言数与 7a19eb2 最终证据完全一致）
- 新增 3 场景：**r1-guards 40/40**、**r2-save-as-new 16/16**、**r3-extra 28/28 + 1 skip**

## §8 项 → 新增证据映射

| 报告 §8 原风险 | 新场景 / 断言 | 结果 |
|---|---|---|
| §8.4 R1 412/401/暂停状态旁路 | `r1-guards` 412：先用 API 推前工作草稿版本（真实服务端 412，不是 route 假造）→ 自动保存进 conflict + ConflictNotice + 提交按钮 disabled + commit **0** + 输入/本机副本保留 | ✅ 转为实测 |
| §8.4 R1 401 | `r1-guards` 401：注入 PATCH 401 + 页面会话接口 401（模拟真实会话失效）→ 页面显示「需要站主登录 / 登录已失效」类准确提示、编辑器不可继续提交、commit **0**、本机副本保留最新输入 | ✅ 转为实测 |
| §8.4 R1 相册新建 `saveNow` 调用方 | `r1-guards` 相册：PATCH 500 下点「新建相册」→ `data-editor-error` 真实提示（p5rw 注入：保存失败）、**无 unhandled rejection**、页面不崩溃、输入保留、无虚假成功；新标签页确实打开 `/admin/albums`（按实际记录） | ✅ 转为实测 |
| §8.4 R1 提交期间更晚输入不被清 | `r1-guards` 延迟 commit：commit 请求在途时继续输入（编辑器未被 busy 禁用）→ 放行成功 → 正式内容=提交快照（不含更晚输入）、更晚输入的 localStorage 本机副本**未被成功回调清除**、commit 恰好 1 次 | ✅ 转为实测 |
| §8.5 R2「另存为新草稿」跨设备恢复 | `r2-save-as-new`：UI 触发 412 → 点「另存为新草稿」→ 新 draft `target_id=null`、原草稿未被覆盖 → 设备 B（新 context 仅 cookie、无 localStorage）从创作台点该行 → `?draft=` → 正文与图片顺序完整恢复 | ✅ 转为实测（UI 路径，非 API 等价物） |
| §8.6 R3 草稿在 App 内切换/返回/展开后保留 | `r3-extra`：手机内输入不发送 → sessionStorage `msg.draft.v1:<character>` → `.pw-back` 返回后从 UI 再进消息列表 / 收起手机重开 / 「展开查看」进 canonical / 展开后回手机，四处均恢复草稿 | ✅ 转为实测（返回落点如实记录：`.pw-back` 回到 INS 动态页签，消息页签是应用内状态，再点「消息」可回列表） |
| §8.6 R3 发送失败重试 | `r3-extra`：拦截 `POST /api/v1/messaging/conversations/<id>/messages` → 500 → 错误反馈可见、草稿不丢、sessionStorage 草稿仍在 → 解除拦截重试成功并清空草稿 | ✅ 转为实测 |
| §8.6 R3 限额提示 | `r3-extra`：`.msg-usage` 可见 + 文案格式断言（实测「今天已用 1 / 20 次自由聊天」） | ⚠️ 部分覆盖：展示与格式已实测；**额度耗尽/不可发送态未真实耗尽**（skip，见下） |
| §8.6 R3 音乐继续播放 | `r3-extra`：手机桌面播放（audio[data-pl-music] 未暂停、进度 1.64→3.15s、`.pw-tab.playing`）→ 进入 INS 会话后仍在播放且进度前进（7.37→8.58s） | ✅ 转为实测（桌面 chromium；真机/自动播放策略差异仍未验证） |

## 仍不可测 / 未验证（及原因）

1. **真机 iOS/Android、真实触控命中、软键盘遮挡**：无真机；390/320 只是视口，不能替代真机。
2. **中文/日文输入法 composition 真机行为**：无真实输入法；只有 IME 逻辑单测。
3. **R2 真实双物理设备并发**：用「第二浏览器上下文复制 cookie、无 localStorage」模拟，非两台物理设备。
4. **R3 限额耗尽/不可发送态**：需真实耗尽每日额度（20 次/访客/天）；本轮不真实耗尽（避免把隔离栈测试数据/限流状态弄脏），只验证 usage 展示与格式（json 中 r3-extra 1 skip）。
5. **弱网/长时间输入稳定性**：只做短时故障注入（PATCH 500/401/412、commit 延迟、发送 500），未做长时弱网。
6. **R3 音乐真机/WebKit 与自动播放策略差异**：只在桌面 chromium 验证；真机静音键/策略未验证。
7. **D1 Docker 健康检查、生产部署、迁移 round-trip、OpenAPI/gen:api 漂移**：本轮不改后端/契约，未重跑；D1 未获授权。

## 证据文件

- JSON：`/Users/学习/blog/rework-evidence/after/e2e-p5-rework-extra.json`（含 8 场景逐条断言、`coverage_added`、`unverified`、build/HEAD 记录）
- 日志：`/Users/学习/blog/rework-evidence/after/e2e-p5-rework-extra.log`
- 截图 29 张：`/Users/学习/blog/.dsh/screenshots/p5-rework/after-extra/`
  （r1-guards 4 张：412/401/相册/提交期输入；r2-save-as-new 2 张：创建/设备 B 恢复；r3-extra 4 张：草稿/发送失败/重试/usage；原有 5 场景 19 张）
- 构建日志：`after/build-up-task4-final.log`
- 脚本：`tools/e2e-p5-rework.py`（新增 3 个独立 scenario id：`r1-guards` / `r2-save-as-new` / `r3-extra`；原 5 场景保持）

## 环境安全

- 只使用隔离栈 3130/8130/55434；未碰共享 3100/8100/8000/55432；down 前后共享端口 PID 一致（node 3100=50666、Python 8100=18631、Python 8000=19294、postgres 55432=14164），隔离端口已无监听。
- 未修改产品源码、既有 e2e 脚本或配置；只扩展 `tools/e2e-p5-rework.py` 与写入 `rework-evidence/`、截图目录。
