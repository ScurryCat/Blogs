# P4 补充交付：验证环境修复（系统代理 / 常驻服务 / 媒体根）+ 全量复验

> 背景：第 19 轮交付后做全量复验时，T02、多视口、业务流同时失败。排查结论：**不是代码问题**，
> 而是三类本机验证环境问题叠加。本轮把它们逐一修复并固化成脚本级防护，再跑一遍全量验收。
> 日期：2026-10-17 · 分支 `main` · **未 push**

---

## 1. 问题一：系统代理导致 Python 验收脚本"连不上本地 API"（最能骗人的一类）

**现象**：业务流 4 个脚本失败，`/auth/session` 返回 **502**；直接 `curl 127.0.0.1:8100` 却是 200。

**根因**：本机开了系统 HTTP 代理（Clash：`127.0.0.1:7890`，ExceptionsList 里虽有 `127.*`）。
Python 3.13 在 macOS 上用 `_scproxy` 读系统代理，但 `urllib.request.proxy_bypass('127.0.0.1')`
实测返回 **False** —— 本机地址也被送进代理。代理对本地端口回 502/超时，于是验收脚本全部"失败"。
（`curl` 不读 macOS 系统代理，所以出现「curl 正常、Python 502」的诡异对比。）

**修复**（脚本级、不依赖操作者 shell）：
`tools/verify-all.sh`、`tools/e2e-stack.sh`、`tools/verify-isolated.sh` 统一加：

```bash
export no_proxy="127.0.0.1,localhost,::1${no_proxy:+,$no_proxy}"
export NO_PROXY="$no_proxy"
```

验证：`no_proxy=127.0.0.1,localhost` 下 urllib 请求本地 API 从超时变为 **200**；
业务流 4/4 **PASS**。

## 2. 问题二：验证所需的两个常驻本地服务被误杀

`verify-all.sh` 的 T02 / 多视口 / 业务流依赖两个**常驻**服务（见 `docs/handoff/HANDOVER.md`）：

| 端口 | 服务 | 作用 |
| --- | --- | --- |
| 8000 | 旧站静态预览（仓库根 `python3 -m http.server 8000`） | T02 取旧站页面做几何对比、播放器音乐 |
| 8100 | dev API（uvicorn，共享集群 55432 的 `pl_test`） | 隔离站取数、业务流、播放器音频状态 |

清理实验进程时被误杀，导致：
- T02：`ERR_CONNECTION_REFUSED 127.0.0.1:8000/index.html`；
- 隔离站 `/api/v1` 全 500；
- 多视口：「滑杆命中不全」11 项 —— 因为 API 挂了 → 音乐不可用 →
  播放器 `pw-empty`（`pointer-events:none`）→ 命中测试全 False（**纯假失败**）。

**处理**：按 HANDOVER 文档用 `nohup` 重启两服务后：T02 **52/52 PASS**、多视口 **11 项 PASS**。
> 这两个服务是**验证前置**，不属于被测代码；任何"清理端口"操作都不应包含 8000/8100。

## 3. 问题三：dev 媒体根被 /tmp 清理 → 1 个媒体变体 404

T02 取数审计报 `404 /api/v1/media/<id>/w320.webp`。DB 里 media 记录完好，但
`MEDIA_ROOT=/tmp/pl-local-media` 被系统清空（0B）。已按记录中的 storage_key 重建
`original.jpg` 与 `w320.webp`（中性占位图，不冒充原素材），T02 恢复 PASS。
> 记录：dev 媒体根在 `/tmp` 下是易失的；长期验收前若见媒体 404，先检查该目录。

## 4. 修复后的全量复验（代码状态 96b6f99 + 本轮脚本修复）

| 段 | 结果 |
| --- | --- |
| 1 静态审计（图标/路由/资源/明智） | PASS |
| 2 前端 typecheck / lint / 单测 | PASS（**931 tests**） |
| 3 后端整树 | PASS（**942 / 0**） |
| 4 T02 + 取数审计 | PASS（**52 / 52**） |
| 5 多视口 × 缩放档 | PASS（**11 项**） |
| 6 业务流 ×4（媒体闭环/多引用/相册撤回/恢复撤销） | PASS（**4/4**） |
| 7 真实浏览器端到端 ×6 | PASS（**6/6**） |

**结论：7/7 段全绿**，与第 18 轮一致；本轮无代码/样式改动，仅验证环境与脚本健壮性修复。

## 5. 修改文件

- `tools/verify-all.sh`、`tools/e2e-stack.sh`、`tools/verify-isolated.sh`：`no_proxy/NO_PROXY` 防护；
- 本报告。

## 6. 给后续接手者的清单（踩坑速查）

1. 跑 `verify-all.sh --e2e` 前确认 **8000 / 8100 两个常驻服务在**；不在就按 HANDOVER 重启（nohup）；
2. 本机若开系统代理：不要只信 `curl`，`python urllib` 可能被代理劫持；脚本已加 `no_proxy`；
3. T02 报媒体 404：先看 `/tmp/pl-local-media` 是否被清空（dev 媒体根是易失的）；
4. 「多视口 11 项滑杆失败」先查 8100 是否在 —— 那是 API 挂掉的连锁假失败，不是滑杆样式坏了。
