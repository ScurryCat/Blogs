# 交接包补充说明（HANDOFF Addendum）

> 配套文件：`docs/agent-deliveries/HANDOFF.md`（打包时点的交接说明，描述 HEAD `6320861` 的状态）。
> **本文件不替换 HANDOFF.md**，只记录「打包之后、具备图像输入能力的接手者做了哪些改动、
> 哪些结论变了、哪些仍未完成」。整合时请把本文件一并放进交接包，并在 HANDOFF 首段加一行指向它。
> 更新日期：2026-10-17（验收 v2 返工后）｜ 当前基线见 `git log` 与 `P4-acceptance-v2-fixes.md`
> 独立验收报告：`/Users/v/Documents/ChatGPT/Blog开发/docs/acceptance/2026-10-17-handoff-v2-acceptance.md`
> （结论：功能阶段通过、**完整验收仍未通过**；F1/F2/F3 见 `P4-acceptance-v2-fixes.md`）。
> **本文件与 v2 交接包一体**：`docs/handoff-package-2026-10-17-v2.zip` 由
> `python3 tools/package-handoff.py` 重新生成（含本文件、全部交付单与更新后的 tools/）。
> 最近一次完整复验：`bash tools/verify-all.sh --e2e --mobile` → **7/7 段全部通过**
> （前端 929 / 后端 942 / T02 52/52 / 多视口 11 / 业务流 4/4 / 端到端 12 项）。
> 验收 v2 返工后：`bash tools/verify-all.sh --fast` 通过（前端 929），F1/F3 复验脚本通过。

---

## 一、最重要的结论变化：B1 从「不可判定」变为「部分还原 + 仍不可判定」

打包时的 HANDOFF 把 B1（§2.4 / §4.x 视觉 / §8.1 整屏还原）标为 ⛔ **不可判定**，原因是
「缺参考帧 + 执行模型无图像输入能力」。本会话的模型**能读图**，所以按原 HANDOFF 的建议
走了「让能读图的协作方复核并还原」的路径。结果与边界：

- ✅ **参考帧审计完成**：本地离线参考库（P5 官方画册 259 页 200dpi、P5/P5R HUD sprite 表、
  图片/视频目录）逐页/逐张核对，结论写进 `docs/design-references/reference-frame-gaps.md`
  §6：IM 有**唯一一张完整屏**；其余界面**只有元件表，没有整屏帧**；G2（回复选择整屏）确认
  **本地不存在**（没有拿其他变体冒充）。**G3 红眼图标已在验收 v2 返工中以可追溯清理版落地**
  （原版画面证据 = P5 动画截图；见 `original-app-icons.md`，官方原始 sprites 仍不在本地库）。
  **2026-10-18 补帧**：外部精选库新增 6 张完整帧（G2 回复选择、G1 普通对话 ×2、IM 完整屏 ×2、
  手机 HUD），来源/哈希/画面复核见 `P4-reference-frames-round3.md`；仍缺存档/读取整屏帧。
- 🟡 **9 个界面完成「元件/构图语言级视觉还原 v1」**（IM、手记日历、COOP、放课后、我的殿堂、
  生活图库、异世界导航、天鹅绒房间、印象空间）+ 主站页面巡检（13 路由 × 桌面/手机）。
- ⛔ **整屏逐像素还原仍不可判定**：缺 G1 完整对照、G2/G3 原图与各界面整屏帧。
  **不要**把 v1 描述成「整屏视觉验收通过」。
- 交付索引：`P2-im-visual-restore-result.md`、`P3-*.md`（8 份）、`P4-visual-restoration-summary.md`（总览）、
  `P4-main-pages-visual-sweep.md`、`P4-full-e2e-verification.md`。

## 二、打包后修掉的真实缺陷（与视觉相关，均有交付单与复跑证据）

1. **手机内 IM 完全没有样式**：`messaging.css` 只被独立路由 import，手机宿主不加载 → 根布局统一 import。
2. **独立应用页/顶层页/子路由页被 fixed HUD 压住**（三批，共 20+ 渲染分支）→ 统一
   `components/ui/app-page-shell.tsx`，现在 `app/` 下**没有裸 `section.shell`**。
3. **放课后 / 异世界导航 / 勒布朗近况三套样式按浅色主题写死在深色站点上**（灰卡片灰字）→ 全部改深色。
4. **图库灯箱 dev 模式打不开**（StrictMode 清理触发 `restoreFocus`，回调里顺手关灯箱）→ 拆开
   「关闭」与「焦点归还」；**只有 dev 可见，生产构建正常**（前一轮验收跑生产所以没暴露）。
5. **灯箱顶栏被 HUD 盖住**（z-index 80 < 950）→ 960。
6. **手记手机页签重复「日历」**（reading 详情屏被当页签渲染）→ 只列浏览两屏。
7. **手机桌面裂图**（新登记应用没有 `app/<id>.png`）→ 补两张格式转换图标 + 回归测试。
8. **天鹅绒/印象空间从未登记进手机**（manifest 已交付、`PHONE_APPS` 没加）→ 补登记（order 70/80）。
9. **验收 v2 F3**：INS 收录相册只读第一页 50 个 / 列表外已选相册被误判删除 → cursor 全量分页 +
   单独详情补取（仅 404 判删除），补回归用例（`P4-acceptance-v2-fixes.md` §F3）。
10. **验收 v2 F1**：统一素材入口仍指向旧库 → 默认入口迁移到 `persona-curated/`，旧库降级离线档案，
   入口文件备份可回退（外部库改动 + `verify-reference-entry.py`）。
11. **验收 v2 复验发现的管理端 UI 阻断**：管理列表 limit=50 超后端 MAX_LIMIT=30（422）；
    画廊写接口 CSRF body 字段未声明（422）+ router 把 csrf_token 传给 service（500）。
    → 三处限 30；schema 显式声明 csrf_token 并在 router 排除；后端回归 +1。
12. **管理端 INS 收录全流程浏览器证据**：`tools/e2e-ins-album-links-ui.py` 9/9
    （登录→相册→动态→上传→收录→保存→发布→公开页），截图见 `.dsh/screenshots/ins-admin/`。
13. **参考帧补齐（2026-10-18）**：外部精选库新增 6 张完整帧（G2 回复选择、G1 普通对话 ×2、
    IM 完整屏 ×2、手机 HUD），`verify-reference-frames.py` 6/6；仍缺存档/读取整屏帧。

## 三、状态数字更新（替换 HANDOFF §三 的对应描述）

| 项 | 打包时（HANDOFF） | 现在 |
| --- | --- | --- |
| 手机桌面 | 第一页 6 磁贴 + 第二页 4 磁贴 | 第一页 6 应用；**第二页 4 站点链接 + 天鹅绒/印象空间 = 6 磁贴**（验收脚本已同步） |
| 前端单测 | 924 | **929**（新增电话图标/原版图标/相册分页回归） |
| 后端整树 | 942 / 0 | **943 / 0**（新增画廊 CSRF body 回归） |
| 完整验收 | `--e2e --mobile` PASS（12 项端到端） | **`--e2e` 与 `--e2e --mobile` 均已复跑：7/7 段全绿，端到端 12/12（桌面 6 + 移动 6）**，见 `P4-full-e2e-verification.md` |
| B1 视觉 | ⛔ 不可判定 | 🟡 9 界面 v1 部分还原 + 缺陷修复；整屏仍不可判定 |
| B4 图片消息 | ⛔ 需决策 | 📋 **决策提案已就绪**（`P4-im-image-messages-proposal.md`，推荐方案 A + 分阶段） |
| 管理端收录 UI 流程 | 证据不足 | **✅ 已补齐**：`e2e-ins-album-links-ui.py` 9/9（真实浏览器） |
| 原版应用图标 | 未落地 | **2 枚已接入**（metanav 红眼 / ins 消息标识，`original-app-icons.md`）；其余 8 个适配设计 |
| 默认素材入口 | 仍指向旧库 | **已迁移**：默认只进 `persona-curated/`；旧库「离线档案」（F1） |

## 四、新增工具与验收脚本改动（验收前必读）

- 新增 `tools/e2e-seed-previews.py`：给隔离栈造**视觉复核**数据（放课后 / COOP 友链 / 殿堂作品 / 生活相册），
  走真实管理 HTTP（媒体 multipart 上传 → 新建 → 发布），幂等。用法：
  `python3 tools/e2e-seed-previews.py http://127.0.0.1:8130`（配合 `tools/e2e-stack.sh up`）。
- `tools/e2e-ins-conversation.py`：点击角色入口前先 `scrollIntoView`（IM 有样式后列表变高，
  首个入口可能被手机屏幕裁剪，直接点「元素中心」会点在裁剪父级上 → 假失败）。
- `apps/web/tools/browser-verification/verify.py`：手机桌面第二页清单断言加入 `velvet`/`mementos`。
- 注意：`tools/e2e-stack.sh` 每次 `up` 会重建数据库；技能/印象空间种子需手动跑
  `app.modules.skills.seed --apply --publish`（见各交付单）。
- 隔离验收时若后端 seed 的媒体与 API 的 `MEDIA_ROOT` 不一致，会出现「作品封面 404」的**环境假象**；
  用 `e2e-seed-previews.py` 走 HTTP 上传可避免。

## 五、仍然未完成（保持原状，不要宣称完成）

1. **整屏视觉还原**：G2 回复选择、G1 普通对话、IM 完整屏、手机 HUD 已有完整帧（2026-10-18）；
   G3 红眼图标已落地（清理版）；**仍缺存档/读取整屏帧**、殿堂/天鹅绒/印象空间/COOP/放课后等
   界面整屏帧；未用其他变体冒充。
2. **B4 IM 图片消息**：等产品在 A/B/C 中拍板（提案 §5）。
3. **P4 原版应用图标**：`metanav` / `ins` 已接入已审核原版图标（清理版 + 原版画面证据，
   见 `original-app-icons.md`）；其余 8 个 App 仍是适配设计（AI 位图/自绘 SVG），未冒充原版；
   官方原始 sprites 仍不在本地参考库。
4. **真机**：触控 / 软键盘 / 中文输入法 / 移动 Safari 未验证（无设备）。

## 六、给打包整合者的建议

- 把 `docs/agent-deliveries/P2-*`、`P3-*`、`P4-*`（共 16 份：P2×1 + P3×8 + P4×7）与本文件加入交接包 `docs/agent-deliveries/`。
- HANDOFF 首段的「最后完整结果」建议替换为最近一次 `--e2e`/`--e2e --mobile` 的真实输出；
  状态数字按 §三更新。
- B1 段落的措辞建议改为：「由具备图像输入能力的协作方完成参考帧审计与 9 界面 v1 元件级还原；
  **整屏还原仍不可判定**（缺 G2/G3 与整屏帧）」。
- 新增的缺陷修复（§二）建议单独列进台账，便于独立复核。
