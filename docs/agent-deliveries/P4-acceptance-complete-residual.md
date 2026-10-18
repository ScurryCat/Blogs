# 完整验收 §5 / §6 返工记录（证据有效性与遗留项）

> 对象：`docs/acceptance/2026-10-18-complete-acceptance.md` §5、§6。
> 日期：2026-10-18。R1/R2/R3 分别见 `P4-acceptance-complete-r1.md`、`P4-acceptance-complete-r2r3.md`。

## 1. §5 浏览器证据有效性

### 1.1 WebKit 冒烟断言增强（`tools/e2e-webkit-mobile-smoke.py`）

| 旧断言 | 问题 | 新断言 |
| --- | --- | --- |
| 点按应用磁贴后 `.pw-appview` **或** `.pw-app-page` 任一存在即通过 | 磁贴完全无响应也可能通过 | 读取目标磁贴名称 → 点按 → 断言 `.pw-appview` + `.pw-appbody` 出现、桌面 `.pw-apps` 消失、`.pw-appname` 包含目标应用名 |
| `?phone=ins` + `.ins-feed-wrap` 记为「IM」 | 实际测的是 INS 动态 feed | 打开 `?phone=ins&screen=messages` → 断言 IM 角色列表；点按角色 → 断言 `.msg-list` + **≥2 个回复选项**；另检查 composer |
| 24 项 | — | **28 项**（两种视口各 14 项），**28/28 通过** |

仍明确标注：**WebKit 不是真机**；软键盘/中文输入法/真实触控/真机 Safari 未验证。

### 1.2 图片消息 e2e 假通过

已在 R2/R3 返工中重写：`tools/e2e-im-image-card.py` 同时断言「灯箱关闭」与「会话仍在」，
手机宿主 + 独立页 **60 项断言全过**；旧脚本 8/8 只查 DOM 消失的问题已消除。

## 2. §6 遗留项处理

### 6.1 手机图标（部分达成，仍缺原作图标）

- **已移除 AI 位图默认回退**：`AppTile` 图标顺序改为
  ① 已审核原版图片（ins / metanav，`data-app-icon="original"`）
  ② 自绘 SVG（`data-app-icon="adapted"`，新增 velvet / mementos 两枚）
  ③ 旧字形 / 文字首字（仅异常数据兜底）；
- 不再引用 `assets/legacy/img/app/<id>.png` 作为桌面图标回退；
- 测试：`registry.test.ts` 要求每个登记应用都有自绘 SVG；phone-host 测试断言所有磁贴只能是 original/adapted，
  且不存在 `img[...][data-app-icon="adapted"]` 的 AI 位图。
- **仍未达成**：剩余 8 枚图标是站点自绘适配，不是原作图标；完整验收要求的「全部图标原作定稿」
  需站主提供/授权原作图标素材。

### 6.2 相册列表 1,200 上限

- 加载逻辑保留 40 页 × 30 条上限，但达到上限且仍有 `next_cursor` 时显示明确提示：
  「相册列表已达本页加载上限（40 页 × 30 条 = 1200 个），仍有更多相册未加载……保存不受列表截断影响」；
- 新增测试：模拟持续 `next_cursor`，断言 `[data-album-links-truncated]` 提示出现且文案含 1200。

### 6.3 详情 pending / 失败时的标题

- 相册标题不再一律显示「（相册不可用）」：
  - 404 → 「（相册已不可用）」；
  - 非 404 读取失败 → 「（相册状态读取失败）」；
  - 列表读取失败 → 「（相册列表读取失败）」；
  - 补取未完成 → 「（正在读取相册…）」。
- 新增测试断言 500 时标题为「相册状态读取失败」且不含「（相册不可用）」。

### 6.4 历史报告与最新状态混杂

- `HANDOFF.md` 的「最后一次完整结果」块从 924/924、942/0 更新为 **936/936、952/0**；
- `P4-acceptance-v2-fixes.md`、`P4-reference-frames-round3.md`、`acceptance-v2-response.md` 已加
  「历史文档」顶部标注；
- 当前单一摘要仍以 `HANDOFF.md` 顶部横幅 + `P4-final-state.md` + 本系列 `P4-acceptance-complete-*.md` 为准。

### 6.5 精选库入口摘要数量

- 外部精选库 `README.md` 的「完整帧补充」段已重写为 **21 张完整帧（含 R1 纠正）**；
- `INDEX.md` 顶部说明同步为 21 张并列出 G2 仍未补齐；
- 来源/许可口径保持「未核实」，未把可追溯图片说成官方授权。

### 6.6 IM 图片消息阶段边界

- Phase 1（剧本图片卡）已完成；
- **Phase 2（AI 选图）/ Phase 3（访客引用相册公开照片）未做**，文档与包横幅均如此标注；
- 本报告未把后续阶段扩为必做功能。

## 3. 验证

- 前端单测：`936 passed`（含相册编辑器 13 项、phone 图标相关断言）；
- `bash tools/verify-all.sh --e2e --mobile` → **7/7 段全绿**（见当轮日志；前端 936 / 后端 952 /
  T02 52/52 / 多视口 11 / 业务流 4/4 / 端到端 12 项）；
- `PLAYWRIGHT_BROWSERS_PATH=.dsh/ms-playwright python3 tools/e2e-webkit-mobile-smoke.py` → **28/28**；
- `python3 tools/e2e-im-image-card.py` → **60/60**（R2/R3 轮次）。

## 4. 仍未关闭

1. **G2**：P5/P5R IM 回复选择完整帧仍缺（见 R1 记录）；
2. **全部手机图标原作定稿**：剩余 8 枚为自绘适配；
3. **真机验证**：无设备；
4. 完整验收要求里的「整屏逐像素还原」仍是下一阶段（当前为视觉语言级）。
