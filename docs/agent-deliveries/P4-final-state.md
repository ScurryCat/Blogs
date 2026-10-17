# P4 最终状态一页纸（交接速览 · 更新至验收 v2 返工轮）

> 一页纸回答：「现在做到哪、怎么验、还差什么、下一步找谁」。
> 日期：2026-10-17 ｜ 分支 `main` ｜ 详细内容见同名目录下各交付单。
> v2 交接包：`docs/handoff-package-2026-10-17-v2.zip`（文件数以包内 `MANIFEST.txt` 为准）

> **对独立验收报告 v2 的逐项回应**：`docs/agent-deliveries/acceptance-v2-response.md`
> （F1/F2/F3、§3 证据、§5 剩余项、§6 文档校正、§7 返工清单的当前状态与证据命令）。

## 1. 现在做到哪

- **功能/回归**：`tools/verify-all.sh --e2e` **7/7 段全绿**（静态审计、前端 929 单测、
  后端 943/0、T02 52/52、多视口 11、业务流 4/4、端到端 12 项：桌面 6 + 移动 6）。
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
- **B4 IM 图片消息**：决策提案就绪（推荐方案 A：扩展 cards 图片卡，零迁移），待产品拍板。
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
  - **参考帧补齐（2026-10-18，验收 §5.1/§7.3）**：外部精选库新增 **17 张完整帧**——
    P5R 6（G2 回复选择、G1 普通对话 ×2、IM 完整屏 ×2、手机 HUD）+
    P5 6（**存档/读取**、手机主屏、日历、五维状态、校内地图、东京地图）+
    5（天鹅绒房间、印象空间、COOP 协助者、殿堂宝物、放课后打击练习场）；
    来源/哈希/画面复核见 `reference-frame-gaps.md` §7 与 `P4-reference-frames-round3.md`；
    `verify-reference-frames.py` **17/17** 通过；来源核实见 `reference-frame-sources.md`
    （官方 3 张：PlayStation CDN 1 + Steam 官方截图 2；可追溯非官方 12；未核实 2）。
    整屏参考帧缺口已收口；剩余为真实设备与 IM 图片消息。
  - **视觉对照证据（2026-10-18）**：`tools/capture-visual-comparison.py` 把 17 张参考帧与
    站点 11 个界面并排对照；结论见 `P4-visual-comparison-evidence.md`
    （13 项语言级部分对照 / 2 项未实现（图片消息、楼层图）/ 2 项无对应整屏；
    **整屏逐像素还原仍未通过**）。
  - **完整验收仍不通过**：整屏视觉对照（部分）、真机、IM 图片消息仍未收口。
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
| ~~整屏视觉参考帧~~ | **已收口**：17 张完整帧覆盖 G1/G2/IM/HUD/存档读取/手机主屏/日历/五维/地图/天鹅绒/印象空间/COOP/殿堂/放课后（`P4-reference-frames-round3.md`） | — |
| **B4 图片消息** | 需产品决策（A/B/C，见 `P4-im-image-messages-proposal.md`） | 产品/站主 |
| **P4 原版应用图标（部分完成）** | `metanav` / `ins` 已接入已审核原版（清理版，来源/证据见 `original-app-icons.md`）；其余 8 个 App 仍为适配设计（AI 位图/自绘 SVG） | 其余 App 的官方素材 |
| ~~管理端收录 UI 真流程~~ | **已补齐**（`e2e-ins-album-links-ui.py` 9/9，浏览器截图） | — |
| **真机验证（部分证据）** | 无设备；已补 **WebKit 引擎 + iPhone 视口 24/24**（`P4-mobile-engine-evidence.md`），**不等于真机**；软键盘/中文输入法/真实触控仍需真机 | 有 iPhone/Android 的人 |
| **品牌红面板黑字对比度** | 4.23:1（AA 需 4.5），需设计折中 | 设计/站主 |

## 4. 下一步建议

1. **首页排版**：已按站主指令还原原本布局（只修字体）；如要重排，请给出具体方向。
2. **替换演示内容**：`python3 tools/seed-demo-content.py --backup` 先备份，
   然后直接改内容 / 或改种子清单；`--clean` 删除本脚本创建条目，`--restore <dump>` 回滚。
3. **产品拍板 B4** → 按提案 Phase 1 实现（剧本图片消息，零迁移）。
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
