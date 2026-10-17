# P4 补充交付：交接包 v2（打包后更新版）生成与校验

> 目的：第一版交接包（`docs/handoff-package-2026-10-17.zip`，HEAD `6320861`）打包后，
> 本会话又完成了 13 轮工作（视觉还原 v1、缺陷修复、验收复跑、文档增量）。
> 接手者应该拿到**当前状态**的自包含包，而不是在旧包基础上翻 git 历史。
> 因此新增可复现的打包脚本并生成 **v2 交接包**。
> 日期：2026-10-17 · 分支 `main` · 包内 HEAD `63ba62f` · **未 push**

---

## 1. 交付物

| 文件 | 说明 |
| --- | --- |
| `tools/package-handoff.py`（新增） | 可复现打包脚本：收集文档与工具白名单 → 生成 HANDOFF（v2 横幅 + 原文）+ MANIFEST + SHA256SUMS → 写 zip；`--check` 只校验现有包 |
| `docs/handoff-package-2026-10-17-v2.zip`（新增） | **v2 交接包**：文件数/文档数以包内 `MANIFEST.txt` 为准（每次构建打印）／包内 HEAD 为打包时提交（`--check` 按祖先关系校验） |
| `docs/agent-deliveries/HANDOFF-ADDENDUM-2026-10-17.md` | 补充说明（已随包分发），增加「与 v2 包一体」引用 |
| `docs/agent-deliveries/P4-handoff-package-v2.md` | 本报告 |

**第一版包 `docs/handoff-package-2026-10-17.zip` 原样保留**，便于对照与追溯。

## 2. 包内容（与 v1 同口径，内容更新）

```
handoff/
├── HANDOFF.md               # v2 更新横幅（指向 ADDENDUM + 说明 B1 仍不可判定）+ 第一版原文
├── MANIFEST.txt             # 文件清单 + 打包时间/HEAD/内容说明
├── SHA256SUMS               # 逐文件 sha256（含 HANDOFF.md）
├── docs/agent-deliveries/   # 全部交付单（含本会话新增的 P2/P3/P4/HANDOFF-ADDENDUM 系列）
├── docs/design-references/  # 9 份设计参考文档（含 reference-frame-gaps、allowlist、图标映射等）
└── tools/                   # 验收/端到端/种子/p0 分析/pg-local/对比度审计（白名单见 package-handoff.py）
```

- **新增进包的工具**：`tools/e2e-seed-previews.py`（视觉复核种子）、
  更新过的 `tools/e2e-ins-conversation.py`（点击前 scrollIntoView）、
  `tools/package-handoff.py` 本身不在包内（打包工具属仓库侧）。
- **未包含（有意）**：源代码（在仓库里）、`.dsh/` 下截图与分析产物（工作区外、未入库）、任何凭据。
  与第一版包的口径一致。

## 3. 校验证据

| 检查 | 结果 |
| --- | --- |
| `python3 tools/package-handoff.py` 自检 | ✓ 91 个文件；包内 HEAD 是当前 HEAD 的祖先（允许落后） |
| `python3 tools/package-handoff.py --check` | ✓ 必需文件齐全、MANIFEST 路径全部存在、包内 HEAD 与当前仓库是**祖先关系**（打包提交不可能与包同提交完成，允许落后）、HANDOFF 含 v2 横幅 |
| 解压后逐文件校验 | `shasum -a 256 -c SHA256SUMS` **全部 OK** |
| 文档完整性 | 仓库 `docs/agent-deliveries` 与 `docs/design-references` 全部 md 均随包分发（`--check` 校验 MANIFEST 路径齐全） |
| HANDOFF | v2 横幅存在（原文完整保留） |
| 大小 | 约 578 KiB（未压缩约 1.27 MiB） |

## 4. 复现 / 刷新方式

```sh
python3 tools/package-handoff.py           # 重新生成 v2 包（文档变化后重跑即可）
python3 tools/package-handoff.py --check   # 只校验现有包与仓库是否一致
```

脚本会记录**打包时的 HEAD**；文档再变后重跑即可得到同路径的新包（内容随 HEAD 更新）。

## 5. 与视觉还原线的关系

v2 包把 13 轮成果一次性交到接手者手里：`HANDOFF-ADDENDUM-2026-10-17.md` 明确写了
**B1 从「不可判定」变为「参考帧审计完成 + 9 界面元件级 v1；整屏还原仍不可判定」**，
以及 8 类缺陷修复、状态数字（929 单测、手机桌面第 2 页 6 磁贴、`--e2e`/`--e2e --mobile` 全绿）、
新增工具与隔离环境坑。接手者按包内 HANDOFF §二 的命令即可复验。

## 6. 未完成项（不变）

1. 整屏视觉还原（G2/G3/整屏帧缺失，未伪造）。
2. B4 IM 图片消息（提案在 P4-im-image-messages-proposal.md，待产品决策）。
3. P4 原版应用图标（本地无素材）。
4. 真机验证（触控/软键盘/移动 Safari）。
