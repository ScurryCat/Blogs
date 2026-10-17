# P4 补充交付：交接包 v2 的独立 QA（完整性 / 引用 / 数字一致性）

> 目的：v2 交接包（`docs/handoff-package-2026-10-17-v2.zip`）是要交给下一个接手者的自包含产物。
> 本轮把「另一个 agent 拿到包」的场景预演一遍：**完整性、文档引用、命令可执行性、状态数字**
> 逐项核对，并修正文档里的过期数字。
> 日期：2026-10-17 · 分支 `main` · **未 push**

---

## 1. 完整性校验（全部通过）

| 检查 | 结果 |
| --- | --- |
| 解压到仓库外临时目录 | ✓ 正常解压（`/tmp/pkg-qa/handoff`） |
| `shasum -a 256 -c SHA256SUMS` | ✓ **全部 OK**（含 HANDOFF.md 自身的哈希） |
| MANIFEST 列出的路径 | ✓ 全部在包内；无遗漏、无多余 |
| HANDOFF v2 横幅 | ✓ 存在（`PACKAGE-V2` 标记），第一版原文完整保留 |
| `python3 tools/package-handoff.py --check` | ✓ 通过（包内 HEAD 与当前仓库是祖先关系，允许落后 1–2 个提交） |
| 包体量 | 93 个文件 / 约 578 KiB（未压缩约 1.27 MiB） |

## 2. 文档引用 QA

方法：解析包内全部 markdown 的 `` `路径` `` 与 `[文本](链接)`，对「看起来像仓库路径」的引用
做存在性检查（排除通配符/占位符/外部 URL/代码标识符）。

- **本会话新增的 16 份文档 + HANDOFF v2**：未发现指向不存在路径的引用
  （硬问题 = 0；`app/<id>.png`、`docs/agent-deliveries/P2-*` 这类是占位/通配写法，非失效链接）。
- **历史文档**（T0x/Nx 系列）里有若干指向**已移动/更名**工具路径的引用，例如：
  `tools/browser-verification/verify.py`（现在位于 `apps/web/tools/browser-verification/`）、
  `tools/legacy-migration/migrate.mjs`（迁移已由 `apps/api/app/commands/import_legacy` 取代）、
  `tools/verify-metanav.py`（从未进入本包）。
  这些是**打包前的历史交付单原文**，属于记录性质；不影响接手指南（HANDOFF v2 用的命令全部有效），
  故不改写历史文档，仅在此记录。
- 命令可执行性：HANDOFF v2 §二 的三条 `tools/verify-all.sh …` 命令、包内其它
  `bash tools/…` / `python3 tools/…` 命令全部指向**包内或仓库里存在**的脚本；
  只有历史文档 N7 提到两个已不在仓库的 `verify-round3*.py`（记录性质）。

## 3. 数字一致性（发现并修正 2 处过期数字）

| 文档 | 原写法 | 实际 | 处理 |
| --- | --- | --- | --- |
| `P4-handoff-package-v2.md` | 「19 个工具文件」 | 27 个（含 `acceptance/` 子目录） | 已更正 |
| `P4-handoff-package-v2.md` / `HANDOFF-ADDENDUM` | 「本会话新增 15 份」「共 12 份」 | 16 份（本会话新增） / P2×1+P3×8+P4×6=15 份 + Addendum 自身 | 已更正 |

其他数字核对（当前状态）：

- 交付单 54 份、设计参考 9 份、包内文件 93 个；
- 前端 **929** tests、后端 **942** passed / 0 failed、T02 **52/52**、多视口 **11** 项、
  业务流 **4/4**、端到端 **12** 项（桌面 6 + 移动 6）——与 HANDOFF v2/Addendum 描述一致；
- 手机桌面第 2 页 6 磁贴（4 站点链接 + velvet + mementos）——与文档一致。

## 4. 结论

v2 包可以放心交给下一个接手者：**完整性、引用、命令、数字**四项均通过；
发现的 2 处过期数字已在本轮修正并重新打包。历史文档中的少量失效工具路径属记录性质，
已在交接说明层面覆盖（HANDOFF v2 的复验命令全部有效）。

## 5. 复验方式

```sh
cd /path/to/Blogs
python3 tools/package-handoff.py --check      # 包完整性/HEAD 关系
# 解压后
shasum -a 256 -c SHA256SUMS                   # 逐文件哈希
```
