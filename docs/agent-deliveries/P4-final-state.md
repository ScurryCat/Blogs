# P4 最终状态一页纸（交接速览 · 更新至验收 v2 返工轮）

> 一页纸回答：「现在做到哪、怎么验、还差什么、下一步找谁」。
> 日期：2026-10-17 ｜ 分支 `main` ｜ 详细内容见同名目录下各交付单。
> v2 交接包：`docs/handoff-package-2026-10-17-v2.zip`（文件数以包内 `MANIFEST.txt` 为准）

> **对独立验收报告 v2 的逐项回应**：`docs/agent-deliveries/acceptance-v2-response.md`
> （F1/F2/F3、§3 证据、§5 剩余项、§6 文档校正、§7 返工清单的当前状态与证据命令）。

## 1. 现在做到哪

- **功能/回归**：`tools/verify-all.sh --e2e` **7/7 段全绿**（静态审计、前端 933 单测、
  后端 952/0、T02 52/52、多视口 11、业务流 4/4、端到端 12 项：桌面 6 + 移动 6）。
- **B1 视觉还原（本会话增量）**：参考帧审计完成；**9 个界面**完成元件级视觉还原 v1
  （IM / 手记日历 / COOP / 放课后 / 我的殿堂 / 生活图库 / 异世界导航 / 天鹅绒 / 印象空间），
  主站 13 路由巡检；整屏级还原仍缺参考帧（见 §3）。
- **首页刷新（站主验证反馈，2026-10-17 晚）**：
  - **底部迷你播放器整条移除**，音乐保留自动播放/跨路由连续，控制只在手机 NOW PLAYING 卡；
  - **Hero 左侧栏目看不清**已修：还原当前项黑字、中文深红；短屏压缩标题/菜单，
    1024×768 / 1280×720 / 1440×900 / 1728×1080 下 5 项**全部在首屏**且不与主角图重叠；
  - **9 个界面演示内容**已写入本地分享库（殿堂 6 / 图库 3 相册 / 天鹅绒 9 技能 / 导航 4 专题 /
    COOP 5 / 放课后 6 / 手记 8 / 印象空间 11 / IM 剧本加长），一条命令可重灌/清理/备份；
    **手机 deep link** 13 类目标 + screen/item 参数已逐个验证；
  - **首页**：原本布局（A/B/C/D 变体已撤回）；「怪盗手记」红底已去除（通用 `.cn` 收窄为
    `.sec-h .cn`）；Hero 按视口高度自适应，**打开即完整显示人物卡 + 左侧 5 个选择栏**
    （1024×768 ~ 1920×1080 实测全部首屏内）；当前项字体颜色修复保留。
- **缺陷修复**：11 类真实缺陷（IM 手机内无样式、HUD 遮挡三批、三套浅色主题、灯箱
  StrictMode/z-index、重复页签、桌面裂图、应用未登记、手机宿主三张样式表缺失、
  悬空 aria-controls 等）。
- **可及性收尾**：减少动效 9 模块；触控目标 ≥44px；WCAG 对比度 35→4（余 4 项为
  品牌红面板黑字，需设计决策）；焦点可见性 13 页 0 缺失；结构可及性 15 页 0 硬问题；
  失败态 15/15 页如实显示。
- **B4 IM 图片消息（Phase 1 已实现，2026-10-18 站主拍板方案 A）**：剧本图片卡
  （`image` / `album_photo`）+ 白框拍立得 + 灯箱 + 撤回/失效降级；后端 9 项、前端 4 项、
  浏览器 e2e 8/8。Phase 2 AI 选图 / Phase 3 访客引用相册仍未做（可选）。
- **交接验收 v2 返工（2026-10-17 晚，见 `P4-acceptance-v2-fixes.md`）**：
  - **F1 已修复**：统一素材入口迁移为默认只进 `persona-curated/`，旧库降级「离线档案」；
    `verify-reference-entry.py` 11 项通过。
  - **F2 关键缺口已落地**：桌面实际渲染分支接入 2 枚已审核原版图标
    （metanav 经典红眼 / ins 原版消息标识），其余 8 个 App 明确标为「适配设计」；
    来源/证据/哈希见 `original-app-icons.md`。
  - **F3 已修复**：INS 收录相册改 cursor 全量分页 + 列表外已选相册详情补取（404 才算删除），
    补 3 个回归用例。
  - **管理端 INS 收录 UI 真实浏览器流程已补齐**（`tools/e2e-ins-album-links-ui.py` 9/9）：
    登录→建相册草稿→建动态→上传→收录→保存→发布→公开页可见；期间修复管理列表 limit>30 的 422、
    画廊写接口 CSRF body 字段的 422/500 两个真实阻断缺陷（后端回归 +1）。
  - **参考帧补齐（2026-10-18，验收 §5.1/§7.3）**：外部精选库新增 **21 张完整帧**——
    P5R 6（G2 回复选择、G1 普通对话 ×2、IM 完整屏 ×2、手机 HUD）+
    P5 6（**存档/读取**、手机主屏、日历、五维状态、校内地图、东京地图）+
    5（天鹅绒房间、印象空间、COOP 协助者、殿堂宝物、放课后打击练习场）；
    来源/哈希/画面复核见 `reference-frame-gaps.md` §7 与 `P4-reference-frames-round3.md`；
    `verify-reference-frames.py` **22/22** 通过；来源核实见 `reference-frame-sources.md`
    （官方 3 张：PlayStation CDN 1 + Steam 官方截图 2；可追溯非官方 12；未核实 2）。
    整屏参考帧已补齐并完成 R1 纠正；G2 已由站主提供，剩余为真实设备与部分界面逐像素差距。
  - **IM 整屏视觉修形（2026-10-18，站主指令 IM 优先，已两轮）**：会话列表/会话页改为
    纸白宽消息条 + 白纸黑框拍立得头像 + 放大 IM wordmark + 底部红点操作提示 +
    4:3 大图片卡（白框+外黑框）；黑字/白字对比度与语义不变，messaging 测试 71/71；
    剩余差距见 `P4-im-visual-refinement.md`（仍标部分还原，非逐像素）。
  - **手记整屏视觉修形第一轮（2026-10-18）**：存档列表大字号 SAVE DATA + 纸白/深红存档槽 +
    预览面板红黑层次；日历黑底大字网格、周日红/周六青、记录日红数字+下划线、TODAY 贴纸；
    手记测试 55/55；剩余差距见 `P4-journal-visual-refinement.md`（仍部分还原）。
  - **协助者 COOP 整屏视觉修形第一轮（2026-10-18）**：纸白卡面 + 红黑斜切插画区 +
    拍立得头像 + 黑色姓名条 + 深红大序号；COOP 测试 79/79；仍标部分还原
    （`P4-coop-visual-refinement.md`；不伪造 RANK/好感度）。
  - **我的殿堂 Showcase 整屏视觉修形第一轮（2026-10-18）**：暗红/黑斜切宝库墙 + 金色宝箱辉光 +
    金色 TREASURE 贴牌 + 纸白宝物卡（黑厚框/硬阴影/EXHIBIT 编号）+ 金色页签；Showcase 测试 50/50；
    仍标部分还原（`P4-showcase-visual-refinement.md`；不做 3D 漫游、不伪造成绩）。
  - **天鹅绒房间 Velvet 整屏视觉修形第一轮（2026-10-18）**：深蓝丝绒条纹 + 冷光 + 金/冰饰线 +
    白色登记板技能卡（钢印编号/冰蓝左沿）+ REGISTRY 金贴牌；Velvet 测试 59/59；
    仍标部分还原（`P4-velvet-visual-refinement.md`；CSS 色块替代 3D 房间）。
  - **印象空间 Mementos 整屏视觉修形第一轮（2026-10-18）**：黑暗隧道冷光 + 黄黑警示条 +
    荧光绿档案箱/号牌 + AWARENESS AREA 贴牌 + 线路牌状态徽标；Exploration 测试 39/39；
    仍标部分还原（`P4-mementos-visual-refinement.md`；CSS 色块替代 3D 隧道）。
  - **放课后 Leisure 整屏视觉修形第一轮（2026-10-18）**：黑暗击球笼 + 黄灯管排 + 笼网斜纹 +
    BATTING CAGE 贴牌 + 黄色霓虹记分板卡片；Leisure 测试 27/27；仍标部分还原
    （`P4-leisure-visual-refinement.md`；CSS 色块替代 3D 场景）。
  - **手机主屏/关于/东京地图修形第一轮（2026-10-18）**：手机状态栏与磁贴、五维白纸状态卡 +
    黑底状态面板、东京地图裱框与档案卡；`P4-legacy-visual-refinement.md`。
  - **整屏视觉修形第一轮汇总（2026-10-18）**：10 个界面 / 9 轮完成（对照表 13 个可映射界面
    全部完成，1 个对象不适用），索引见 `P4-visual-refinement-summary.md`；下一阶段为逐像素第二轮。
  - **管理端 INS 隔离全流程（2026-10-18）**：草稿保留 + 新标签建相册 + 图库展示 + 撤回联动，
    隔离栈 19/19（`P4-acceptance-complete-admin-flow.md`）。
  - **完整验收 R1 返工（2026-10-18）**：纠正 3 张错标参考帧（P4/P5 辅助参考）并补正确 P5R
    天鹅绒/东京地点选择/IM 帧；`verify-reference-frames.py` 22/22；**G2 已由站主提供**。
  - **完整验收 §6 返工（2026-10-18）**：AI 位图桌面图标默认回退已移除（2 原版 + 8 自绘适配）；
    相册 1200 上限提示 + pending 中性标题；WebKit 断言增强 28/28；历史文档标注。
  - **完整验收 R2/R3 返工（2026-10-18）**：IM 图片灯箱接入 OverlayManager（Escape 不再退出
    App）、Portal 到 body、灯箱失败降级；e2e 手机宿主+独立页 60 项断言全过
    （`P4-acceptance-complete-r2r3.md`）；R1 参考帧游戏归属待处理。
  - **视觉对照证据（2026-10-18）**：`tools/capture-visual-comparison.py` 把 21 张参考帧与
    站点 11 个界面并排对照；结论见 `P4-visual-comparison-evidence.md`
    （13 项语言级部分对照 / 2 项未实现（图片消息、楼层图）/ 2 项无对应整屏；
    **整屏逐像素还原仍未通过**）。
  - **完整验收仍不通过**：整屏逐像素视觉对照（部分）、真机验证未收口；参考帧与桌面图标已按站主授权补齐。
- **验证基建**：`audit-contrast.py` / `audit-structure.py` / `audit-failure-states.py` /
  `verify-home-refresh.py` / `verify-demo-content.py` / `seed-demo-content.py` /
  `verify-reference-entry.py` / `verify-reference-frames.py` / `verify-phone-icons.py` /
  `e2e-ins-album-links-ui.py` / `package-handoff.py`；
  验证脚本统一做本地代理绕过。

## 2. 怎么验（三条命令 + 两个专项）

```sh
bash tools/verify-all.sh --fast           # ~1 分钟：静态审计 + typecheck/lint/单测（929）
bash tools/verify-all.sh --e2e            # ~15 分钟：+ 后端 + T02 + 多视口 + 业务流 + 端到端（桌面）
bash tools/verify-all.sh --e2e --mobile   # ~20 分钟：端到端再跑手机全屏 390×844

# 首页刷新（R1/R2/R4）与演示内容/深链（R3）
python3 tools/verify-home-refresh.py http://127.0.0.1:3100
python3 tools/verify-demo-content.py http://127.0.0.1:3100 --api http://127.0.0.1:8100
```

**本地验证站**：`http://127.0.0.1:3100`（`next start`，连共享 dev API 8100）。
前置：8000（旧站静态/音乐）与 8100（dev API）常驻；详见
`P4-verify-proxy-and-env-notes.md`（系统代理、媒体根易失等踩坑）。

## 3. 还差什么

| 缺口 | 卡在哪 | 需要谁 |
| --- | --- | --- |
| **首页排版（可选后续）** | 已还原为原本布局；若要重排，等站主给方向后单独做 | 站主 |
| ~~整屏视觉参考帧~~ | **已收口**：22 张完整帧覆盖 G1/G2/IM/HUD/存档读取/手机主屏/日历/五维/地图/天鹅绒/印象空间/COOP/殿堂/放课后（`P4-reference-frames-round3.md`） | — |
| ~~B4 图片消息 Phase 1~~ | **已实现**（方案 A，见 `P4-im-image-messages-result.md`）；Phase 2 AI 选图 / Phase 3 访客引用相册仍可选 | — |
| ~~P4 应用图标~~ | **按站主授权定稿**：`metanav` / `ins` 原版（`original-app-icons.md`）；其余 10 个站点自适配 App 为 AI 同风格图标（`ai-app-icons.md`） | — |
| ~~管理端收录 UI 真流程~~ | **已补齐**（`e2e-ins-album-links-ui.py` 9/9，浏览器截图） | — |
| **真机验证（部分证据）** | 无设备；已补 **WebKit 引擎 + iPhone 视口 28/28**（`P4-mobile-engine-evidence.md`），**不等于真机**；软键盘/中文输入法/真实触控仍需真机 | 有 iPhone/Android 的人 |
| **品牌红面板黑字对比度** | 4.23:1（AA 需 4.5），需设计折中 | 设计/站主 |

## 4. 下一步建议

1. **首页排版**：已按站主指令还原原本布局（只修字体）；如要重排，请给出具体方向。
2. **替换演示内容**：`python3 tools/seed-demo-content.py --backup` 先备份，
   然后直接改内容 / 或改种子清单；`--clean` 删除本脚本创建条目，`--restore <dump>` 回滚。
3. ~~产品拍板 B4~~ → **已拍板方案 A，Phase 1 已实现**；Phase 2/3 仍未做（可选）。
4. **补参考帧**（G2/G3/整屏）→ 继续整屏级还原与对照验收。
5. **重新打包**：任何文档变更后跑 `python3 tools/package-handoff.py`。

## 5. 不要踩的坑（本会话实测）

- **系统代理会骗人**：本机开代理时，Python 3.13 `urllib` 不采用系统代理 ExceptionsList，
  连 127.0.0.1 也走代理 → 脚本 502/超时，而 `curl` 正常。脚本已统一 `no_proxy`。
- **开发用 localhost 时 CORS 要放行**：API 的 `CORS_ORIGINS` 只列 3100 时，
  在 `localhost:3131` 下直接打开 IM 会话 deep link 会报「来源或 CSRF 校验失败」；
  开发环境把 `http://localhost:3131` 也加进去即可（本轮已加）。
- **8000/8100 是验证前置**：被误杀会造成 T02 失败、多视口「滑杆命中全挂」（假失败）。
- **dev 媒体根在 `/tmp` 下是易失的**：媒体 404 先查 `MEDIA_ROOT` 目录。
- **隔离栈每次 `up` 会重建数据库**：技能/印象空间种子要手动跑
  `app.modules.skills.seed`；清理端口时不要误杀 8000/8100。
- 验收脚本可能因**布局变化**假失败（IM 角色入口被裁剪、应用清单变化等），
  先看脚本假设是否过旧，再怀疑产品回归。
- **演示管理员**：本地库有独立 `demo-seeder`（密码见交付回复，不写入仓库）；
  `owner` 密码未被修改。
