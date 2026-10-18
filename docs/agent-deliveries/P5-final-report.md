# P5 · 最终交付报告（第一批：站主日常创作体验）

> 日期：2026-10-18 → 2026-10-19 ｜ 分支 `main` ｜ 集成负责人：C0（Lead）
> 设计书：`docs/handoff/2026-10-18-p5-creator-workspace-design.md`
> 集成契约：`docs/agent-deliveries/P5-C0-integration-contract.md`
> 验收报告：`docs/acceptance/P5-acceptance-report.md`（C5，逐条证据）
>
> **最终声明：本次完成的是第一批「站主日常创作体验」；文章编辑器与完整媒体管理
> 属于后续阶段（第二/三批），不计入本次完成声明。**

## 1. 一句话结论

第一批全部实现并验收通过：创作台首页、INS 选图优先编辑、手记私密/公开分离编辑、
可跨设备的工作草稿（自动保存 / 本机恢复 / 版本冲突显式处理）、共享图片选择器、
追番与游戏快捷更新、前台站主快捷入口与来源上下文恢复。
**A1–A12 全部通过；B1/B3/B4/B5 通过；B2 真机项未验证（无设备，如实单列）。**

## 2. 提交与代码状态

| 提交 | 内容 |
|---|---|
| `3b0914e` | `feat(creator-workspace): P5 第一批站主创作台`——后端 work_drafts/media/auth + 前端全部页面与应用 + 文档 |
| `9644737` | `fix(creator-workspace): 验收期修复（构建 Suspense / 412 冲突恢复刷新 / modal 层级）+ P5 验收报告` |

工作树干净（除上一轮视觉 worker 的交接包产物已由其自行提交 e0b81c8）。
未执行 `git push`（项目约定：只本地提交，不自动推送）。

## 3. 实际改动清单

### 3.1 后端（apps/api）

| 路径 | 说明 |
|---|---|
| `app/modules/work_drafts/`（新） | 工作草稿模型/DTO/service/router：六接口、If-Match 草稿版本、双版本提交、事务提交、幂等回放、丢弃语义 |
| `app/modules/moments/service.py` | 抽出 `_assert_publishable`；新增 `write_moment_pending`（不 commit 的外层事务路径） |
| `app/modules/journal/service.py` | 新增 `write_entry_pending`（同上；保存≠公开语义） |
| `app/modules/media/{router,schemas,service}.py` | `GET /admin/media`（分页 + `publicly_referenced`）、`GET /admin/media/{id}` |
| `app/modules/auth/{router,schemas}.py` | `GET /auth/owner-status`（只读探针，不建预登录会话、不写库） |
| `app/router.py` / `app/model_registry.py` | 登记新模块与新模型（C0 完成） |
| `migrations/versions/20261018_2342_747d6fd473d9_*.py` | 唯一新迁移：`work_drafts` + `work_draft_media` + 索引/部分唯一索引；单 head |
| `tests/work_drafts/`（新）、`tests/media/test_admin_media_api.py`、`tests/auth/test_owner_status.py`、`tests/test_module_registration.py`、`tests/gallery/test_migration_sources.py` | 新增 73 用例 + 迁移 head 动态断言（新增迁移的必然连带修改，语义不变） |
| `contracts/openapi.json` | 85 → 90 路径重新导出 |

### 3.2 前端（apps/web）

| 路径 | 说明 |
|---|---|
| `features/workspace/`（新） | useWorkDraft（防抖/上限/串行/旧响应丢弃/本机恢复/冲突/401/断网）、useEntryId、useOwnerSession、SyncStatus、ConflictNotice、EditorShell（≤620px 全屏单列）、return-context、workspace.css、创作台首页 |
| `features/media-picker/`（新） | 共享图片选择器：上传/分页浏览/排序/alt/公开引用提示/9 张上限/失败保留/`data-media-picker-*` |
| `features/ins/` | `editor/`（moment-editor 选图优先、draft-data、页面容器）、`owner-entry`、feed/detail 接线、album-links-editor 可选回调、ins.css |
| `features/journal/` | `editor/`（Markdown 预览、私密→公开分离、工作副本更新）、`owner-entry`、列表/正文接线、CSS |
| `features/leisure/` | `/admin/leisure` 快捷更新（追番/游戏）、`owner-entry`、return-to-bar |
| `features/leblanc/` | 总览三个站主入口 |
| `app/admin/` | `page.tsx`（创作台首页，新）、layout 导航、login returnTo；moments/new、moments/[id]/edit、journal/new、journal/[id]/edit、leisure 快捷区 |
| `lib/api/client.ts` | `headers` 选项（X-CSRF-Token 头；长正文不再受 JSON body 4096 字节 CSRF 限制） |
| `lib/api/generated/schema.ts` | `npm run gen:api` 生成（无漂移） |

### 3.3 文档 / 验收工具

- `docs/agent-deliveries/P5-C0-integration-contract.md`（接口唯一约定）
- `docs/agent-deliveries/P5-C1-backend.md`、`P5-C2-workspace-foundation.md`、
  `P5-C3-ins-picker.md`、`P5-C4-journal-leisure.md`（各任务交付单：修改清单/接口迁移/
  测试命令与真实结果/未完成项）
- `docs/acceptance/P5-acceptance-plan.md`、`P5-baseline-evidence.md`、
  `P5-acceptance-report.md`
- `tools/e2e-p5-workspace.py`（11 场景浏览器 e2e；`P5_E2E_READY=1` 才断言）
- 截图：`.dsh/screenshots/p5-workspace/`（30 张，含 320/390、冲突、发布、选择器）

## 4. 验证证据（全部真实执行）

| 检查 | 命令 | 结果 |
|---|---|---|
| 静态审计 + 前端 typecheck/lint/单测 | `bash tools/verify-all.sh --fast` | PASS，exit 0；1123 用例通过（C5 报告时 1122，C3 又补 1 条冲突恢复用例） |
| 后端整树（隔离集群） | `bash tools/verify-backend-isolated.sh <空闲端口>` | **1025 通过 / 0 失败**（952 基线 + 73 新增），exit 0 |
| 前端生产构建 | `cd apps/web && npm run build` | **exit 0**，37/37 静态页（C0/C4/C5 三方各自确认） |
| OpenAPI 漂移 | `export_openapi.py` 后比对 | **无漂移**（90 路径） |
| 前端生成类型漂移 | `npm run gen:api` 后比对 | **无漂移** |
| 迁移往返 + 旧数据保留 | `alembic upgrade → downgrade → upgrade`（隔离库） | PASS；旧表行数全程不变 |
| P5 浏览器 e2e（隔离栈 55434/8130/3130） | `P5_E2E_READY=1 python3 tools/e2e-p5-workspace.py` | **219 断言通过 / 0 失败**，exit 0（桌面 1440×1000） |
| WebKit 引擎 + 390/320（≠真机） | `E2E_ENGINE=webkit P5_E2E_READY=1 …` | 10/0 通过；既有 P4 WebKit 冒烟 28/0 |
| 既有六项真实浏览器回归 | `tools/e2e-*.py`（滚动/手记/INS 标签/INS 会话/殿堂/IM 草稿） | **6/6 exit 0** |
| 旧管理端 INS 收录全流程（A10） | `tools/e2e-ins-album-links-ui.py` | 9/9 通过 |
| 多视口审计（含 320/390） | `tools/acceptance/verify-viewports.py` | 0 失败 |

验收中**发现并修复后复验**的 3 个真实缺陷（详见验收报告 §5）：
① 构建阻断（静态页 useSearchParams 缺 Suspense）；
② 412 冲突后「载入最新版本」编辑器内容不刷新（moment/journal）；
③ 图片选择器 modal 被浮动投票卡遮挡（z-index 90 < 500）。

## 5. 未验证项（单列，不冒充）

1. **真机触控 / 软键盘 / 中文输入法 / iOS Safari / Android Chrome**：无设备。
   只有 WebKit 引擎 + 320/390 视口证据（10/0、28/0），**不能替代真机**。
2. **真实双物理设备并发**：跨设备恢复与 412 冲突用「第二浏览器上下文 + API 直连」模拟。
3. **弱网长时间输入 / 真机 HEIC 选择**：未做真机验证；HEIC 只验证了明确提示、不承诺转换。
4. **无 target 的新内容草稿跨设备恢复**：依赖本机副本/同一 `?entry=` 入口（C2 交付已注明）；
   A6 用「已有 target 的工作草稿」验证通过，新内容跨设备未验证。
5. **`publicly_referenced` 批量查询**：当前按分页（≤30）逐项调用共享扩展点，未做跨域批量
   接口（契约 §3.4 的 N+1 优化留作后续；分页有界，功能正确）。
6. **同类 UI 风险（未改、已记录）**：`features/gallery/gallery.css` 的 `.plg-lightbox` z-index 80
   仍低于浮动投票卡 500 —— 既有图库功能，不在本批范围，已列给后续批次。
7. **`--e2e` 全量脚本未整体重跑**：`tools/verify-all.sh --e2e` 的隔离站默认端口 3120 在验收期间
   被另一并行 worker 的验证站占用，因此用「verify-fast + 后端整树 + C5 隔离栈全量 e2e + 六项回归
   + 旧 INS 收录 + 多视口」覆盖；六项端到端与多视口均单独通过（上表）。

## 6. 设计取舍与已知接口差异（如实）

1. 草稿期校验宽松、发布门槛严格：草稿允许 0 图/空 alt/部分字段；`publish` 复用各内容类型
   既有发布校验。commit 时正式校验失败统一 **422**（按本批契约；与既有管理接口的 409 风格不同）。
2. 幂等回放优先于 If-Match：网络重试携带旧 If-Match 是常态，先回放再校验版本；
   `(owner_id, commit_key)` 部分唯一索引兜底跨草稿复用（409）。
3. 工作草稿是**独立表**，不把自动保存写进正式内容；正式内容更新只发生在显式 commit
   的单一事务里（复用 `gallery.sources` 的相册来源 diff/幂等逻辑）。
4. 站主探针 `GET /auth/owner-status` 只读、无预登录会话副作用；隐藏入口不是授权，
   管理接口仍由 `require_admin*` 校验。
5. 编辑器不塞进桌面斜屏手机：`/admin/*` 独立页；≤620px 为固定全视口单列层（44px 触控、
   safe-area、Overlay 锁滚动）。
6. 返回上下文用 `returnTo`（站内白名单：`/`、`/apps/ins|journal|leisure|leblanc`）+ `?entry=`
   稳定入口 id；成功/返回用 `router.replace`，不在后退栈留编辑器。

## 7. 怎么复验

```sh
export no_proxy=127.0.0.1,localhost,::1 NO_PROXY=127.0.0.1,localhost,::1 LC_ALL=C
export UV_CACHE_DIR=/Users/学习/blog/Blogs/.dsh/uv-cache npm_config_cache=/Users/学习/blog/Blogs/.dsh/npm-cache
export HOME=/tmp/p5-e2e-home   # 沙箱内规避 Next 写 ~/Library/Preferences 的 EPERM，与代码无关

# 1) 快速层（静态审计 + typecheck/lint/单测）
bash tools/verify-all.sh --fast

# 2) 后端整树（自起自灭的隔离集群，参数用空闲端口）
bash tools/verify-backend-isolated.sh 55438

# 3) 隔离全栈 + P5 e2e（会重建数据库；不要用共享 55432 做破坏性试验）
rm -rf /tmp/pl-e2e-stack/web && bash tools/e2e-stack.sh up
P5_E2E_READY=1 python3 tools/e2e-p5-workspace.py http://127.0.0.1:3130
E2E_ENGINE=webkit P5_E2E_READY=1 python3 tools/e2e-p5-workspace.py http://127.0.0.1:3130
bash tools/e2e-stack.sh down

# 4) 构建与契约漂移
cd apps/web && npm run build
cd ../.. && uv run --project apps/api python apps/api/scripts/export_openapi.py
cd apps/web && npm run gen:api && git diff --exit-code lib/api/generated/schema.ts
```

## 8. 后续阶段（第二批 / 第三批，本轮不做）

- 第二批：桌面文章编辑器、Markdown 预览增强、封面与分类标签、正文插图、文章发布管理。
- 第三批：完整媒体管理（含删除/回收与引用计数）、相册批量整理、内容关联、草稿与历史记录检索。
- 顺带候选：图库 lightbox z-index 与投票卡的层级统一、`publicly_referenced` 跨域批量查询、
  真机触控/软键盘/中文输入法验证（需设备）。

## 9. 交付材料索引

| 材料 | 路径 |
|---|---|
| 设计与验收要求（上游） | `docs/handoff/2026-10-18-p5-creator-workspace-design.md` |
| 集成契约（接口唯一约定） | `docs/agent-deliveries/P5-C0-integration-contract.md` |
| 各任务交付单 | `docs/agent-deliveries/P5-C1-backend.md` … `P5-C4-journal-leisure.md` |
| 验收计划 / 基线 / 验收报告 | `docs/acceptance/P5-acceptance-plan.md`、`P5-baseline-evidence.md`、`P5-acceptance-report.md` |
| 浏览器 e2e 脚本 | `tools/e2e-p5-workspace.py` |
| 关键流程截图 | `.dsh/screenshots/p5-workspace/`（30 张，含 320/390、冲突、发布、选择器、相册往返） |

> 再次声明：本次完成的是第一批「站主日常创作体验」；文章编辑器与完整媒体管理
> 属于后续阶段，不计入本次完成声明。
