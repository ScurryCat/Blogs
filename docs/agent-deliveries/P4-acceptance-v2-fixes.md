# 交接包 v2 验收返工记录（F1 / F2 / F3）

> 验收来源：`/Users/v/Documents/ChatGPT/Blog开发/docs/acceptance/2026-10-17-handoff-v2-acceptance.md`
> （独立验收报告：功能阶段通过、完整验收未通过）。
> 日期：2026-10-17 ｜ 工作分支 `main`。
> 本记录只覆盖报告点名的三项代码/素材返工 + 交接数字校正；不重写已通过的来源语义与导航。

## 结论速览

| 项 | 报告结论 | 本轮处理 | 状态 |
| --- | --- | --- | --- |
| **F1**（P1）默认素材入口仍指向旧库 | 未通过 | 统一入口 index/README 改为默认只进 `persona-curated/`；旧库降级为「离线档案（按需手动打开）」并保留入口备份；新增复验脚本 | ✅ 已修复（外部库迁移 + 脚本通过） |
| **F2**（P1）桌面仍默认 AI 位图 / 原版图标未落地 | 未通过 | 接入 2 个已审核原版图标（metanav 经典红眼、ins 原版消息标识）到桌面实际渲染分支；其余 8 个 App 明确标为「适配设计」；补来源/哈希/画面核对/审计 | ✅ 关键缺口已落地（官方原始 sprites 仍不在本地库，见 §F2 边界） |
| **F3**（P2）INS 收录只读第一批 50 个相册 | 未通过 | 相册列表 cursor 全量分页；列表外的已选相册单独补取管理详情；404 才算删除，其它错误如实显示「读取失败」；补 3 个回归测试 | ✅ 已修复 + 回归通过 |
| 交接文档数字/状态校正 | 需校正 | P4-final-state / HANDOFF / curated-plan / allowlist 的数字与状态按当前代码基线更新（前端 933 用例；后端 952；默认入口迁移改为真实完成） | ✅ 已更新 |

## F1 · 统一素材入口迁移

- 目标路径（工作区外）：`/Users/v/Documents/ChatGPT/Blog开发/assets/reference/`
- 改动：
  - `index.html`：默认区只展示 `persona-curated/`（README / INDEX / provenance）；
    `persona-dist`、`persona5-spriters` 收进 `<details>`「离线档案（按需手动打开）」，
    页面不再自动加载旧库缩略图/预览/脚本（无 `<img>/<iframe>/<script>` 引用旧库）。
  - `README.md`：默认入口列表改为精选库；旧库单列「离线档案」。
  - `persona-curated/README.md`：补统一入口迁移记录。
  - 旧入口备份：`index.html.bak-entry-20261017-233514`、`README.md.bak-entry-20261017-233514`；
    旧库本体未移动、未删除。
- 复验：`python3 tools/acceptance/verify-reference-entry.py` → 11 项全过（脚本在参考库不存在时 SKIP，便于其它机器）。

## F2 · 原版图标接入

- 已接入（桌面实际渲染分支，`data-app-icon="original"`）：
  - `metanav` → `/assets/legacy/img/app/original/metanav-original.png`（经典红眼：红眼+星形瞳孔+黑色外刺）
  - `ins` → `/assets/legacy/img/app/original/ins-original.png`（原版消息标识：红色对话框 + IM）
- 证据链：来源 URL / 原版画面证据 / 游戏版本 / 身份核对 / 裁切处理 / SHA-256 全部记录在
  `docs/design-references/original-app-icons.md`；清单行见 `persona-assets-manifest.csv`
  的 `app-icon-original`；图标审计扩展到原版映射（`verify-phone-icons.py`）。
- 边界（不夸大）：
  - 本地参考库仍没有官方原始 sprites；metanav 采用「外部可追溯清理版 + P5 动画原版画面证据」，
    标为「原版视觉清理版」，不宣称官方原始矢量；
  - IM 参考图源 URL 仍未核实（沿用既有 G4 记录）；
  - 其余 8 个 App 仍是**适配设计**（AI 位图/自绘 SVG），逐项标记在 `icon-mapping.md`，不冒充原版。

## F3 · INS 收录相册分页 / 已选补取

- 文件：`apps/web/features/ins/admin/album-links-editor.tsx`
- 行为：
  - `fetchAdminAlbums` 按 `next_cursor` 循环取全量（上限 40 页防死循环），不再只看第一页；
  - 已选但不在列表页的相册 → 单独 `fetchAdminAlbum(id)` 补取详情；只有 **404** 才显示
    「相册已不可用（可能已删除）」，其它错误显示「相册状态读取失败…不代表已删除」，不误导站主删配置；
  - 新增相册搜索框（标题 / slug），列表加载后本地过滤；
  - 「刷新相册列表」清空补取缓存并重新分页读取。
- 回归：`features/ins/album-links-editor.test.tsx` 新增
  「列表分页 + 列表外已选相册详情补取」「详情读取失败非 404 不判删除」两个用例；
  原「已删除相册」用例改为显式详情 404。11/11 通过。

## F3 后续：管理端 INS 收录 UI 真实浏览器流程（补验收 §5.4 证据）

复验 F3 时在真实浏览器（3100 生产构建 + 8100 API）走完整流程，暴露出 2 个此前未被自动化覆盖的
**真实 UI 阻断缺陷**，本轮一并修复：

1. **管理列表 limit 超上限**：后端 `MAX_LIMIT = 30`，而 `/admin/albums`、`/admin/projects`、
   AlbumLinksEditor 都请求 `limit: 50` → GET 422，管理页直接报「提交的内容不合法」。
   → 三处改 `limit: 30`；分页仍按 `next_cursor` 继续取。
2. **画廊写接口 CSRF body 字段**：共享前端把 `csrf_token` 放 JSON body（`app/core/csrf.py` 的
   body 通道），但 `AlbumCreateIn/AlbumUpdateIn` 是 `extra="forbid"` 且未声明该字段 → 新建/更新
   相册 422；补上显式字段后 router 又把 `csrf_token` 传给 service → 500。
   → schema 声明 `csrf_token: str | None`（忽略不落库）；router `model_dump(exclude={"csrf_token"})`。
   新增后端回归 `test_create_accepts_csrf_token_in_json_body`（只用 body token，不带 CSRF 头）。
   契约同步：`contracts/openapi.json` 重新导出、`apps/web/lib/api/generated/schema.ts` 重新生成
   （均为新增可选 `csrf_token` 字段的加法变更），OpenAPI 契约测试恢复通过。

**浏览器全流程证据**：新增 `tools/e2e-ins-album-links-ui.py`，实跑 **9/9** 通过：
站主登录 → 新建相册草稿 → 新建动态草稿 → 上传图片 + 替代文本 → 刷新相册列表 →
选择新相册 → 添加并勾选图片 → 保存草稿 → 发布 → 公开 `/apps/ins` 页面可见新动态。
截图：`.dsh/screenshots/ins-admin/01..06-*.png`（本地产物，不随包分发）。

## 交接文档数字与状态校正

- `P4-final-state.md`：前端单测数改为当前实际值（929）；原版图标缺口状态改为「metanav/ins 已接入，
  其余 8 个适配」；新增「独立验收 v2」状态段与剩余缺口。
- `persona-curated-plan.md`：修正「新库不存在 / 入口迁移未完成」旧状态；入口迁移记录为
  2026-10-17 23:35 完成（含备份与复验脚本）。
- `persona-assets-allowlist.md`：修正「外部精选库未落地」旧结论；加入 2 个原版图标与清单行。
- `icon-mapping.md` / `reference-frame-gaps.md`：G3 与 ins/metanav 行同步为「已接入（清理版）」。
- HANDOFF 横幅：保留历史正文，新增单一「当前验收摘要」块（基线、数字、状态、剩余缺口）。

## 回归结果（本次返工后）

- `bash tools/verify-all.sh --e2e --mobile` → **7/7 段全绿**（最近一次跑于 2026-10-18）：
  静态审计（图标/路由/资源/明智资源，含 F1 入口与 F2 图标映射）PASS；前端 typecheck/lint/单测
  **929**；后端 **952**；T02 **52/52**；多视口 11；业务流 4/4；端到端 **12 项**（桌面 6 + 移动 6）。
- F1 专项：`python3 tools/acceptance/verify-reference-entry.py` → 11 项通过。
- F2 专项：`python3 tools/acceptance/verify-phone-icons.py` → 10 个图标存在/在清单/哈希一致，
  且桌面渲染分支引用 `originalAppIcon` + `data-app-icon="original"`。
- F3 专项：`npx vitest run features/ins/album-links-editor.test.tsx` → 11/11 通过。
- 浏览器实测（生产构建 3100，`/?phone=home`）：手机桌面实际请求
  `/assets/legacy/img/app/original/{metanav,ins}-original.png` 均 **HTTP 200**，
  `<img data-app-icon="original">` 自然尺寸 512×512 且 `complete=true`，截图确认渲染可见
  （`.dsh/screenshots/phone-icons/desktop-original-icons.png`；本地产物，不随包分发）。
  其余 8 个 App 的图标带 `data-app-icon="adapted"` 标记，可据此区分原版/适配。

## 仍未关闭（与验收报告 §5 一致，不冒充完成）

1. 完整原版视觉对照（G2 回复选择整帧、多界面整屏帧、游戏存档整屏）仍缺参考帧。
2. 真实触控 / 软键盘 / 中文输入法 / 移动 Safari 未验证。
3. 管理端 INS 收录表单真实浏览器全流程证据（选图→收录→新建相册→返回草稿→发布）仍待补。
4. IM 图片消息仍待产品拍板（B4 提案）。
5. 无明智素材本轮只复跑审计与允许清单哈希，未逐张重审全部公开素材。

在这些缺口收口前，交接状态保持：**功能阶段通过，完整验收未通过**。
