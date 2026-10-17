# P3 补充交付：生活图库视觉还原 v1（记忆展示 / 拍立得照片墙）+ 灯箱两个缺陷修复

> 任务书：`2026-10-17-p5-phone-ui-v2-agent-brief.md`（第二轮）§4.6「我的殿堂 / 相册」、§8.1。
> 承接：交接包 `docs/handoff-package-2026-10-17.zip` 的 B1「整屏视觉还原」。
> 前几轮：IM / 手记日历 / COOP / 放课后 / 我的殿堂；本轮处理 `/gallery`（生活图库）。
> 日期：2026-10-17 · 分支 `main` · **未 push / 未部署**

---

## 1. 完成范围

| 任务书条目（§4.6） | 状态 | 说明 |
| --- | --- | --- |
| 「相册用**记忆展示**布局」 | 🟡 v1 完成 | 照片墙改为**拍立得白框照片**：每张照片＝白纸拍立得框（照片本体保持原色、自然比例不变）+ 红色硬阴影 + 交替微旋转 + 悬停抬升；日期/说明在拍立得下沿用黑字白纸 |
| 相册视图 | 🟡 v1 完成 | 相册卡＝白框黑底 + 红硬阴影 + 封面 4:3 内框 + 撕纸字体标题（红阴影）+ 张数/类型说明；悬停抬升 |
| 灯箱（放大查看） | 🟡 v1 | 黑色展场 + **白色展框照片** + 红硬阴影；计数用展示字体（带相册名）；按钮改撕纸白/红牌；说明行保留 |
| 照片本体「不加红色滤镜、保持自然比例」 | ✅ 保持 | 既有硬规则不变：内联 `aspect-ratio` 自然比例、图片不裁不滤镜；P5 元素只用于框/标签/按钮/灯箱 |
| **顺手修复的两个真实缺陷** | ✅ | 见 §1.1 / §1.2 |
| 完整图库整屏参考帧 | ⛔ 仍缺 | 本地只有 P5R 照片页图片（`132783-photos-im.png`，照片本身），没有查看器整屏；按 §8.1 只标 v1 部分还原 |

### 1.1 灯箱在开发模式下完全打不开（StrictMode + 焦点归还耦合）

- 现象：dev 模式点照片灯箱不出现（`.plg-lightbox` 计数 0）；生产构建正常 —— 第三轮验收跑的是生产构建，所以一直没暴露。
- 根因：`OverlayManager.push()` 的注销函数会调用图层的 `restoreFocus`；灯箱把「关闭状态」和「焦点归还」写在同一个回调里
  （`onClosed={closeLightbox}`，而它内部会 `setLightboxIndex(null)`）。React StrictMode 在 dev 会「挂载 → 清理 → 再挂载」，
  清理阶段触发 `restoreFocus` → 顺手把刚打开的灯箱关掉。
- 修复：**拆开两个动作** —— `onClose` 负责关（`setLightboxIndex(null)`），`onClosed` 只把焦点还给触发图格（`restoreTileFocus`，
  不改状态）。语义上更正确，也修掉 dev 模式的灯箱不可用。
- 验证：dev 下灯箱可开（PASS），Escape 可关（PASS）；既有 74 个 gallery 单测全过。

### 1.2 灯箱顶栏被站点 HUD 盖住

- 现象：灯箱顶栏（计数 / 上一张 / 下一张 / 关闭）固定在视口顶部，但灯箱 `z-index: 80` 低于站点 HUD（globals 里 HUD 是 950）
  → 顶栏整条被页头盖住，看不见也点不到（实测 `elementFromPoint` 命中的是 HUD）。
- 修复：`.plg-lightbox { z-index: 960 }`（高于 HUD、低于全屏过场层）；复测关闭按钮可见且可点。
  这是读图才发现的层级缺陷 —— 键盘单测与 DOM 断言都不会报。

## 2. 修改文件

| 文件 | 改动 |
| --- | --- |
| `apps/web/features/gallery/gallery.css` | 新增「生活图库视觉还原 v1」段落（约 +420 行）：页头/页签/筛选牌、拍立得照片格、相册卡、分组撕纸标题、状态/按钮、灯箱展框与 `z-index` 修复、INS 紧凑格、`@container` 窄屏收纳、`prefers-reduced-motion` 关位移 |
| `apps/web/features/gallery/gallery-view.tsx` | 灯箱关闭/焦点归还拆开（修 StrictMode 下灯箱打不开）：新增 `restoreTileFocus`，`onClosed` 不再改状态 |
| `tools/e2e-seed-previews.py` | 扩展：生活相册种子（PIL 现场生成中性示意图 → 上传 `/admin/media` → 新建相册 → 发布，幂等）；2 个相册（摄影 4 张 / 游戏截图 3 张） |
| `docs/design-references/reference-frame-gaps.md` | 补充「生活图库：P5R 照片页只给照片本身、无查看器整屏」判定（§6.6 中一并更新） |
| `docs/agent-deliveries/P3-gallery-visual-result.md` | 本报告 |

**未改动**：图库数据/API/权限、照片自然比例与灯箱键盘语义（←/→/Home/End/Escape）、
筛选/分页/引用撤回逻辑、公开引用校验、任何后端。

## 3. 素材与参考

| 参考 | 路径 | 用途 |
| --- | --- | --- |
| P5R 照片页（132783-photos-im.png） | `persona5-spriters/p5r/hud/132783-photos-im.png` | P5R 相册照片的「黑底 + 白框照片」展示语言；**照片本体保留原色** |
| 站点既有白框/撕纸/红硬阴影语言 | `styles/legacy/base.css`、COOP 卡牌、手记存档、殿堂展厅 | 与站内其他页面同一观感 |

> 本地参考库**没有** P5 照片查看器的整屏帧（只有照片本身），本轮只做记忆展示语言 v1，
> **整屏还原仍标未完成**。归档不复制任何游戏照片到站点。

## 4. 视觉证据

工作区外（本地，不入库）：`/Users/学习/blog/Blogs/.dsh/screenshots/` 与 `.dsh/vis2/`

| 文件 | 内容 |
| --- | --- |
| `.dsh/vis2/gallery-wall-before.png` / `gallery-albums-before.png` / `gallery-album-before.png` | **改前**：深色细边网格、普通相册卡 |
| `p2gallery-wall-after.png` | **改后**照片墙：拍立得白框 + 红硬阴影 + 交替旋转 + 下沿黑字白纸记录 |
| `p2gallery-albums-after.png` | **改后**相册视图：白框黑底相册卡、撕纸标题、张数说明 |
| `p2gallery-album-after.png` | **改后**单相册 4 张拍立得 |
| `p2gallery-lightbox-after.png` | **改后**灯箱：黑场 + 白色展框照片 + 红硬阴影、计数 `1 / 7 · 游戏截图`、按钮可见可点 |
| `p2gallery-390-after.png` | 390×844：两列拍立得、角度收敛、无横向溢出 |
| `p2gallery-phone-ins-after.png` | 手机 INS 内相册页签（同一套图库组件） |

## 5. 验证结果

| 命令 / 检查 | 结果 |
| --- | --- |
| `cd apps/web && npm run test -- --run` | **90 files / 928 tests passed**，exit 0 |
| `npx vitest run features/gallery` | 7 files / **74 tests passed** |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0（0 error / 0 warning） |
| `npm run build` | exit 0（34 静态页） |
| 真实浏览器（隔离 e2e 全栈 + 本轮相册种子：2 相册 / 7 张照片） | **11/11**：7 张拍立得、白框 + 红硬阴影实测（`rgb(244,241,234)` / `rgb(211,18,42) 7px 7px 0`）、自然比例保持、**灯箱可打开**、Escape 可关闭、相册卡 2 个且白框、单相册 4 张、390 无横向溢出、手机 INS 正常、无 JS 错误 |
| 灯箱层级 | `elementFromPoint` 命中关闭按钮、`z-index: 960`、Escape 关闭后 `.plg-lightbox` 计数 0 |
| 种子工具 | `tools/e2e-seed-previews.py`：放课后 4/4、COOP 3/3、殿堂 3/3、相册 2/2 全部成功 |

## 6. 未完成项

1. **图库整屏参考帧仍缺** → 只标记忆展示语言 v1 部分还原。
2. 异世界导航（红眼原图仍缺）/ 天鹅绒视觉（站点蓝黑主题已就位，仅修过留白）/ 印象空间 /
   手机桌面图标系统（P4）。
3. 真机触控、软键盘、移动 Safari 未验证（沿用交接包 §3.2）。

## 7. 集成说明与回退

- **改动**：`gallery.css`（只作用于图库组件）+ `gallery-view.tsx` 灯箱关闭/焦点回调拆分；
  `tools/e2e-seed-previews.py` 增加相册种子。无数据模型/API/权限变更。
- **回退**：删除 `gallery.css` 末尾「视觉还原 v1」段落 → 回旧网格；灯箱两个修复建议保留
  （StrictMode 下打不开、顶栏被 HUD 盖住都是真实缺陷）。
- 与 `verify-all.sh --fast` 兼容（静态审计 + 单测 + typecheck/lint 全部通过）。
