# P3 补充交付：我的殿堂视觉还原 v1（二维展厅）+ 三个顶层页面顶栏遮挡修复

> 任务书：`2026-10-17-p5-phone-ui-v2-agent-brief.md`（第二轮）§4.6「我的殿堂 / 相册」、§8.1。
> 承接：交接包 `docs/handoff-package-2026-10-17.zip` 的 B1「整屏视觉还原」。
> 前四轮已完成：IM / 手记日历 / COOP / 放课后；本轮处理 `/showcase`（我的殿堂）。
> 日期：2026-10-17 · 分支 `main` · **未 push / 未部署**

---

## 1. 完成范围

| 任务书条目（§4.6） | 状态 | 说明 |
| --- | --- | --- |
| 「把工作室、项目整理成**展厅**；参考 P5 的展览、收藏式选择界面」 | 🟡 v1 完成 | 作品列表改为**二维展厅**：每件作品＝白框黑底展框 + 红硬阴影 + 交替微旋转 + 悬停抬升；封面全宽铺满；卡左上角 **EXHIBIT 01..0N 展签**（CSS counter，编号只是列表顺序，不是评分/成绩） |
| 「首页和殿堂页都要能理解你做过什么」 | ✅ 强化 | 标题/一句话用途/技术栈/维护状态的层级明确：标题用 P5 展示字体 + 红阴影，技术栈＝白框小牌，维护状态在卡底红分隔线下 |
| 列表视图（快速扫一遍） | ✅ 强化 | 由默认表格改为**展厅目录**：黑底白框 + 红色硬阴影，表头红字，行悬停反白，标题用展示字体 + 红下划线 |
| 详情页（分节说明） | ✅ v1 | 主图＝白色展框 + 红硬阴影；四个分节（职责/问题/取舍/成果）改为黑底白框说明牌，节标题＝红底撕纸牌 |
| **顺手修复的缺陷**：三个顶层页面被固定 HUD 压住 | ✅ | 见 §1.1 |
| 完整殿堂整屏参考帧 | ⛔ 仍缺 | 本地参考库只有画册 p219 卡牌页与站点既有撕纸语言；按 §8.1 只标 v1 部分还原 |

### 1.1 `/showcase`、`/velvet`、`/gallery` 被固定顶栏压住

上一轮修 `/apps/*` 独立页时已用共享 `AppPageShell` 处理了 7 个应用页；本轮扫描全部顶层路由
发现还有 3 个页面是裸 `section.shell`（无顶部留白）：`/showcase`（含作品详情页两个分支）、
`/velvet`（含客户端加载分支）、`/gallery`（相册/照片墙两个分支）。内容从视口顶端开始、
标题被 `.hud` 压住（改前截图 `.dsh/vis2/showcase-cards-before.png` 可见）。
本轮统一换成 `AppPageShell`：`.app-page` 计算 `padding-top: 96px`（HUD 66 + 30），
标题完整可见。至此**所有公开顶层页面**都有正确的顶部留白。

## 2. 修改文件

| 文件 | 改动 |
| --- | --- |
| `apps/web/features/showcase/showcase.css` | 新增「殿堂视觉还原 v1」段落（约 +380 行）：展厅网格/展框/展签/封面/技术栈牌/卡底状态、展厅目录表格、状态面板、按钮、详情说明牌、相册图框、`@container` 窄屏收纳 |
| `apps/web/app/showcase/page.tsx` | 换成 `AppPageShell`（修复顶栏遮挡） |
| `apps/web/app/showcase/projects/[slug]/page.tsx` | 两个渲染分支都换成 `AppPageShell` |
| `apps/web/app/velvet/page.tsx` | 两个渲染分支换成 `AppPageShell` |
| `apps/web/app/gallery/page.tsx` | 两个渲染分支换成 `AppPageShell` |
| `tools/e2e-seed-previews.py` | 扩展：殿堂作品种子（先 multipart 上传**仓库里已有**封面图到 `/admin/media`，再新建/发布作品）；新增 3 件示例作品数据 |
| `docs/design-references/reference-frame-gaps.md` | 补充「我的殿堂：只有卡牌/展陈语言参考、无整屏帧」判定（§6.6） |
| `docs/agent-deliveries/P3-showcase-visual-result.md` | 本报告 |

**未改动**：作品数据/API/发布门槛（仍要求至少 1 张 ready 图片 + 一句话用途）、
维护状态语义、列表/卡片视图切换与分页逻辑、详情页数据、任何后端。

## 3. 素材与参考

| 参考 | 路径 | 用途 |
| --- | --- | --- |
| P5 官方设计画册 p219（阿卡那卡牌页） | `persona-dist/reference-books/.../p5artbook-219.jpg` | 白卡边 → 黑内框 → 红场 → 卡下撕纸标签的**展陈语言**（不复制卡面插画） |
| 站点既有撕纸/红硬阴影/白框黑底语言 | `styles/legacy/base.css` `.rn`、COOP 卡牌、手记存档 | 保证与站内其他页面同一观感，不是新美术方向 |

> 本地参考库对「我的殿堂」**没有整屏帧**；只做展陈语言 v1 还原，**整屏还原仍标未完成**。

## 4. 视觉证据

工作区外（本地，不入库）：`/Users/学习/blog/Blogs/.dsh/screenshots/` 与 `.dsh/vis2/`

| 文件 | 内容 |
| --- | --- |
| `.dsh/vis2/showcase-cards-before.png` | **改前**：普通卡片 + 图片留黑边 + 标题被顶栏压住 |
| `p2showcase-cards-after.png` / `p2showcase-cards-after2.png` | **改后**：展厅网格（EXHIBIT 01–04 展签、白框、红硬阴影、交替旋转、封面全宽），顶栏遮挡已修 |
| `p2showcase-list-after.png` | **改后**列表视图：展厅目录（黑底白框、红字表头、展示字体标题） |
| `p2showcase-detail-after.png` | **改后**详情页：白色展框主图 + 四个说明牌分节 |
| `p2showcase-390-after.png` | 390×844：单列、角度收敛、无横向溢出 |
| `p2showcase-phone-after.png` | 手机宿主（斜屏）内的展框卡片 |
| `p2shell-velvet-after.png` / `p2shell-gallery-after.png` | `/velvet`、`/gallery` 顶部留白修复后（`.app-page` 96px） |

## 5. 验证结果

| 命令 / 检查 | 结果 |
| --- | --- |
| `cd apps/web && npm run test -- --run` | **90 files / 928 tests passed**，exit 0 |
| `npx vitest run features/showcase` | 3 files / **50 tests passed** |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0（0 error / 0 warning） |
| `npm run build` | exit 0（34 静态页） |
| 真实浏览器（隔离 e2e 全栈 + 本轮种子：4 件作品） | **12/12**：4 张展框、白框黑底、展签内容 `EXHIBIT counter(...)` 生效、showcase 顶部留白 96px、列表视图表格出现、详情页可打开、列表视图 390 无横向溢出、手机宿主内 4 张卡、velvet/gallery 顶部留白 96px、无 JS 错误 |
| 种子工具 | `tools/e2e-seed-previews.py`：放课后 4/4、COOP 3/3、殿堂 3/3 全链路成功（含 multipart 上传 → 新建 → 发布） |

> 种子环境说明：`p5-blog` 这件作品最初由后端 seed 命令直接写库，其媒体文件落在
> `apps/api/var/media` 而隔离栈 API 的 `MEDIA_ROOT` 不同 → 封面在隔离环境 404。
> 已通过管理 API 重新上传封面并 PATCH 作品，截图里 4 张封面都能正常显示；这是**种子环境**的
> 路径差异，不是站点缺陷（真实部署只有一个 MEDIA_ROOT）。

## 6. 未完成项

1. **殿堂整屏参考帧仍缺** → 只标展陈语言 v1 部分还原。
2. **相册/照片墙本身没有做视觉还原**（本轮只修了 `/gallery` 的顶栏遮挡；其 CSS 已是深色主题）。
   P0 已有 `132783-photos-im.png`（P5R 照片查看器元件表）可作下一轮参考。
3. 异世界导航（红眼原图仍缺）/ 天鹅绒视觉（已有蓝黑主题，仅修了留白）/ 印象空间 / 手机桌面图标系统（P4）。
4. 真机触控、软键盘、移动 Safari 未验证（沿用交接包 §3.2）。

## 7. 集成说明与回退

- **改动**：`showcase.css` 只影响作品展厅；页面外壳改用既有 `AppPageShell`（与上轮 7 个应用页同一组件）。
  无数据模型/API/权限变更。
- **回退**：删除 `showcase.css` 末尾「殿堂视觉还原 v1」段落 → 回旧卡片；
  三个页面换回 `section.shell` 即可（顶栏遮挡会回来，不建议）。
- 与 `verify-all.sh --fast` 兼容（静态审计 + 单测 + typecheck/lint 全部通过）。
