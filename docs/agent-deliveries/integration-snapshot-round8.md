# 集成核验快照（第 8 轮）：迁移 / 契约 / 前后端

> 任务书 §9（不得用「整体风格」「测试全过」替代逐项验收）/ §8.5
> 日期：2026-10-17 · **本轮只读核验，不改任何源码**（避免与并行写入冲突）
> 结论：**新增迁移可独立验证通过；后端整树在当前共享环境下无法独立验证（环境缺陷）；
> 前端全绿；契约存在过期（并行写入中途）。**

## 1. 核验结论一览

| 层 | 结果 | 说明 |
| --- | --- | --- |
| 迁移链（全新库） | ✅ **通过** | 10 个迁移全部应用；36 张表；可回滚 |
| 迁移单头 | ✅ | `b7c3e9a1d2f4`（并行新增 N3 album_media_sources） |
| 契约同步 | ❌ **不通过** | `test_openapi_contract` 失败：`contracts/openapi.json` 与代码不一致 |
| 后端整树 | ⚠️ **无法独立验证** | 与并行测试运行撞库名（详见 §4）；一次完整跑的结果是 **仅 1 个失败 = 上面的契约测试** |
| 前端全量 | ✅ **866 / 866** | `npm test -- --run` |
| T02 浏览器套件 / 取数审计 | ⏸ 本轮未跑 | 运行中的 API 仍是旧代码；重启需迁移共享测试库，会干扰并行写入 |

## 2. 迁移核验（隔离库，可复现）

在**独立临时库**上验证（不碰共享测试库）：

```bash
psql -c "CREATE DATABASE pl_snapshot_mig_r8"
SECRET_KEY=<任意> DATABASE_URL=...pl_snapshot_mig_r8 uv run alembic upgrade head
psql -c "DROP DATABASE pl_snapshot_mig_r8"
```

结果：

- `upgrade head`：10 个迁移依次执行，末条为
  `528a38f23614 -> b7c3e9a1d2f4, N3 album_media_sources（收录来源 + 历史相册图片回填独立来源）`；
- `public` 表数 **36**（35 张业务表 + `alembic_version`），新表 `album_media_sources` 存在；
- `downgrade -1` → `upgrade head` 往返成功，**可回滚**；
- `alembic current` = `b7c3e9a1d2f4 (head)`。

**结论**：并行写入新增的迁移本身是可靠的 ✓。

## 3. 契约过期（并行写入中途，需其负责人收口）

`apps/api/tests/test_openapi_contract.py::test_committed_openapi_matches_generated_schema` 失败。
`contracts/openapi.json` 在工作区**有未提交改动**，但当前内容仍与代码生成结果不一致 ——
判断是并行写入正在改 API（album media sources / moments），契约的重生成尚未完成。
**不计为完成**，待其负责人收口后复跑该测试。

## 4. 后端整树无法独立验证（环境缺陷，需协调）

现象：`pytest apps/api/tests` 出现 `database "pl_test_t01" does not exist` 与大批 journal
用例 ERROR —— **不是代码问题**，是并行 worker 同时在跑同一套后端测试，共享库名被对方
建/删导致。当前 Postgres 里同时存在双方创建的测试库：

```
pl_test, pl_test_n3, pl_test_n7, pl_test_t01, pl_test_t07, pl_test_t09, pl_test_t09_dev
```

一次完整跑（撞库前）的结果是 **仅 `test_openapi_contract` 失败**，其余通过；但随后复跑即被撞库污染，
**因此本快照不给「后端全绿」的结论** —— 按任务书 §9，宁可标未验证也不虚报。

**建议**：两个 worker 的后端测试需约定**互不重叠的库名前缀**（或串行运行），
否则共享环境里后端结果永远不可信。

## 5. 未完成项

- 后端整树的可信全量结果（待协调环境）；
- T02 套件与取数审计（需先把共享 API 重启到当前代码，属写操作）；
- P2/P3 的视觉还原（缺参考帧 + 无图像输入）；
- 12 个头像候选的身份核对（对照图已备好，见 `icon-mapping.md` §4）。

## 6. 与并行写入的关系

本轮**未修改任何源码**，只新增本报告；工作区里 85 项未提交改动仍属并行写入，未提交、未还原。
