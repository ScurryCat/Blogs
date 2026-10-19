# P5 返工复验证据索引（2026-10-19）

本目录保存 **2026-10-19 返工复验** 的可提交证据摘要；完整日志与截图体积较大，保存在
工作区 `/Users/学习/blog/rework-evidence/` 与 `/Users/学习/blog/.dsh/screenshots/p5-rework/`
（不进入 git）。

- 返工基线：`9917890f001ac055280c48c31d50671821e7c929`
- 修复提交：`afafdf8`（R1+R2）、`8b826c9`（R3）、`7a19eb2`（R2 已丢弃/已提交草稿校验）
- 最终状态：**返工 e2e 124/0 pass、继续轮补证 8 场景 208/0/1、P5 全量 e2e 219/0、六项回归 6/6 exit 0、后端全树隔离 1025/0；D1 已修复并完成隔离 Compose 验证（28/28，提交 d8c22ae）**；真机未验证
- 复验报告：`../P5-rework-verification-2026-10-19.md`
- 返工任务书/独立验收：`/Users/v/Documents/ChatGPT/Blog开发/docs/handoff/2026-10-19-p5-rework/`

| 文件 | 内容 |
|---|---|
| `baseline-work-draft-check.json` | 返工前原样运行随包 Hook 检查：R1/R2 均复现，0/2 pass，exit 1 |
| `after-work-draft-check.json` | 修复后原样运行（未改脚本）：2/2 pass，exit 0，source_head=`7a19eb2` |
| `baseline-e2e-p5-rework.json` | 改前隔离 Chromium e2e（真实浏览器故障注入/跨设备/手机入口）：52 pass / 50 fail |
| `after-e2e-p5-rework.json` | 改后同一脚本：**124 pass / 0 fail，exit 0**（r1-ins 14、r1-journal 15、r2-moment 26、r2-journal 23、r3-phone 44）；BUILD_ID `x46VxuFXLS83Km5gubNnP`，HEAD `7a19eb2` |
| `after-e2e-summary.txt` / `e2e-final-summary.md` | 改后 e2e 场景明细、构建来源、回归与未验证项摘要 |
| `after-regression-summary.json` | 改后同构建回归：`e2e-p5-workspace.py` 219/0、六项脚本全部 exit 0、旧管理端收录 9/0 |
| `port-check-after-down.txt` | 隔离栈 down 前后共享端口 PID 核对（共享服务未受影响） |
| `after-e2e-p5-rework-extra.json` / `after-e2e-extra-summary.txt` | **继续轮补证**：8 场景 208 pass / 0 fail / 1 skip（r1-guards 40、r2-save-as-new 16、r3-extra 28+1 skip；原 5 场景无回归） |
| `TASK4-COVERAGE.md` | 继续轮「§8 未验证项 → 真实浏览器证据」逐项映射与仍不可测原因 |
| `port-check-task4-{before,after}-down.txt` | 继续轮隔离栈 down 前后共享端口 PID 核对 |
| `after-backend-isolated-summary.txt` | 继续轮后端全树在隔离集群 55450 实跑：1025 通过 / 0 失败，exit 0（集群已清理） |
| `baseline-frontend-vitest-summary.txt` | 改前全量单测：110 文件 / 1123 用例通过 |
| `after-frontend-vitest-summary.txt` | 改后全量单测：113 文件 / 1182 用例通过；含 1 次既有 timing flake 说明 |
| `isolated-build-summary.txt` | 隔离副本生产构建：exit 0，37/37 静态页，BUILD_ID `saPw1tf0nfpULa2_uuztT` |
| `shared-env-check.txt` | 共享 8000/8100/3100/55432 端点与 PID 未被本轮回工触碰（与隔离 55434/8130/3130 对照） |
| `d1-healthcheck-mismatch.txt` | **历史**：D1 修复前的错配证据（`compose.prod.yaml` 检查 `"ok"` vs `health.py` 返回 `"ready"`）；2026-10-19 已修复 |
| `d1-compose-verify.json` / `d1-compose-verify.log` | **D1 修复后真实隔离 Compose 验证**：`docker compose up` 全栈 + 28/28 断言（依赖链、healthy、网关 readiness、旧契约对照、停 db 故障恢复、非 root、清理） |
| `d1-static-check.log` / `d1-ci-workflow-check.log` | `check-prod-config.py` 60/60（含 A2 健康契约与依赖链断言）、CI workflow 检查 30/30 |
| `d1-summary.txt` / `d1-runtime-facts.txt` / `d1-*-image-build.log` / `d1-rendered-compose.yaml` / `d1-code-diff.patch` | D1 摘要、Docker/镜像事实、API/Web 生产镜像构建日志、渲染后编排、修复 diff |

## 复跑命令（摘要）

```sh
cd /Users/学习/blog/Blogs/apps/web
npx tsc --noEmit --incremental false        # exit 0
npm run lint                                 # exit 0
npx vitest run                               # 113 files / 1182 tests, exit 0

node /Users/v/Documents/ChatGPT/Blog开发/docs/handoff/2026-10-19-p5-rework/scripts/check-work-draft-contract.cjs \
  /Users/学习/blog/Blogs                     # 2/2 pass, exit 0

# 真实浏览器（隔离栈 55434/8130/3130，先起栈；不要用共享 3100/8100/55432）
bash /Users/学习/blog/Blogs/tools/e2e-stack.sh up
python3 /Users/学习/blog/Blogs/tools/e2e-p5-rework.py http://127.0.0.1:3130 \
  --json /Users/学习/blog/rework-evidence/after/e2e-p5-rework.json
bash /Users/学习/blog/Blogs/tools/e2e-stack.sh down
```

> 说明：`baseline-e2e-p5-rework.json` 的 build 是 `uzuVcJcrRD8VZLXC34j0j`（源码经逐文件核对
> 等于基线 `9917890`）；`after-e2e-p5-rework.json` 记录修复后新 BUILD_ID 与 HEAD。
> 真机触控/软键盘/中文输入法未验证；D1 未修。详见复验报告 §7/§8。
