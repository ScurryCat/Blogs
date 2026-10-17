# B4 决策提案：IM 图片消息（product decision required）

> 来源：交接包 `docs/handoff-package-2026-10-17.zip` 的 HANDOFF §六 **B4「IM 图片消息」**：
> 「消息模型只有 `text` + `cards`，要支持图片消息需要产品决策（扩消息 API/DB 还是用卡片带预览）」。
> 本文件把决策所需的事实、方案与代价摆齐，**不改代码**；选定方案后再实现。
> 日期：2026-10-17 · 分支 `main` · 状态：**待决策**

---

## 1. 现状（已核对代码，不是推测）

| 层 | 事实 | 位置 |
| --- | --- | --- |
| 消息表 | `messages.text` **NOT NULL**；`messages.cards` 是 JSONB 数组（`jsonb_typeof = 'array'` 约束）；**没有** attachment / media 列 | `apps/api/app/modules/messaging/models.py` |
| 卡片 | `cards` 存的是「服务端验证过的公开内容引用」，kind 目前有 `post` / `moment` / `recent_posts` / `recent_moments` / `path`；未知 kind 静默丢弃 | `messaging/content.py::resolve_refs` |
| 卡片 DTO | `CardOut = { kind, id, title, summary, url }`（`url` 由服务端生成） | `messaging/schemas.py` |
| 媒体 | 变体固定 `original / w320.webp / w640.webp / w1280.webp`；**每次读取都重新校验公开引用**；原图永远只给站主；未 ready / 无公开引用 404 | `media/router.py`、`media/public_refs.py` |
| 相册授权 | `gallery` 域注册了「公开相册照片 = 公开引用」检查器；多个域的引用取「或」 | `gallery/public_refs.py` |
| AI 内容 | AI 回复经 `content_mod.extract_cards` 只保留**候选白名单**里的引用；模型给的原始 URL 不入库 | `messaging/service.py`、`messaging/content.py` |
| 前端 | `Message = { text, cards: Card[] }`；卡片渲染为站内链接卡 | `apps/web/features/messaging/types.ts` |

结论：**「图片消息」不需要改表也能做**，但需要选定「图片以什么语义存在」（卡片引用 vs 消息附件 vs 不做）。

## 2. 三个方案

### 方案 A（推荐）：扩展 `cards`，新增图片卡引用

- 新增 card kind：`image`（展示单张图）或 `album_photo`（相册照片，带相册名）。
- 卡片载荷：`{ kind, id: media_id, title, summary, url: /api/v1/media/<id>/w640.webp, width, height, alt }`。
  `url` 仍由服务端生成；**不接受前端/模型给任意 URL**。
- 解析时校验：媒体 `status=ready`、变体存在、`media_is_publicly_referenced` 为真；
  不满足 → 静默丢弃该卡（与现有「解析不到就丢弃、不产生空链接」一致），前端只收到文字。
- 前端：`MessageCards` 增加图片卡分支 → 白框拍立得图 + 说明；点击打开灯箱
  （复用 `features/gallery/lightbox.tsx` 或抽一个轻量共享版）。
- **零数据库迁移**（`cards` 已是 JSONB + 数组约束）；只改 DTO/解析/渲染/测试。
- AI 侧（可分阶段）：让模型在**服务端给的候选图列表**里选 id（与现有 `ContentRef`
  候选机制一致），模型永远不接触真实 URL；Phase 1 先只允许**剧本**消息带图。
- 代价：`CardOut` 需加可空几何/alt 字段（向后兼容）；图片卡与内容卡渲染分支增加；
  撤回语义要写清（媒体失去全部公开引用 → 404 → 卡片按「不可用」降级）。

### 方案 B：`messages.attachment_media_id` 首列（一等公民）

- 迁移加列 + FK（`ON DELETE SET NULL`）+ 校验（ready/public ref）。
- 语义更直接（一条消息最多一张图），但影响面大：剧本/AI/客户端三条写入路径、
  序列化与幂等键、撤回/删除、测试面（消息接口契约变化）、`text NOT NULL` 需要放宽或允许空串。
- 适合「图片是消息主体」的产品方向；代价约是方案 A 的 2–3 倍，且需要一次迁移评审。

### 方案 C：产品决定「不做图片消息」

- 保持文字 + 内容卡（现状）；IM 视觉还原继续只覆盖文字/选项。
- 好处：零风险；代价：P5R SNS 参考帧里的「照片消息」视觉永远缺失，相关还原只能标未完成。

## 3. 风险清单（选 A 或 B 都要处理）

| 风险 | 处理建议 |
| --- | --- |
| 版权/隐私 | 首版**不做访客上传**；图片只能来自站主已上传媒体，且必须有公开引用（相册/作品/动态） |
| AI 生成任意图片 | 模型只能从服务端候选 id 里选；前端只渲染服务端 `url`；保留 `extract_cards` 白名单测试 |
| 撤回后「坏图」 | 媒体读取本身逐请求校验公开引用（已实现）；前端 `onError` 降级为文字说明 |
| 性能 | 消息流用 `w320/w640` 变体 + `loading="lazy"`；不直接出原图 |
| 无障碍 | 图片必须有 `alt`（后端已保证公开媒体 alt；图片卡缺 alt 时用说明/标题兜底） |
| 灯箱叠层 | 复用 gallery 灯箱（本轮刚修过 StrictMode 打不开与 z-index 被 HUD 盖住的问题，见 `P3-gallery-visual-result.md`） |

## 4. 推荐决策与实施顺序

**建议选 A**，并分阶段：

1. **Phase 1（最小可用）**：剧本消息支持图片卡（`image` kind），站主在管理端/剧本里引用已有媒体；
   前端白框照片渲染 + 灯箱；保留「未授权/撤回 → 文字降级」。
2. **Phase 2（可选）**：AI 自由聊天支持从候选图里选图；需要单独预算与白名单评审。
3. **Phase 3（可选）**：访客引用相册公开照片（仍不接收上传）。

粗略工作量（A / Phase 1）：后端解析 + DTO + 校验 ~0.5 天；前端卡片/灯箱 ~0.5–1 天；
测试（后端 5–8、前端 4–6、e2e 1 条）~0.5 天；种子与文档 ~0.25 天 —— 约 **2 天含评审**。

可机械断言的验收口径：

- 渲染：图片卡出现白框照片、`alt` 非空、`width/height` 来自媒体；
- 安全：未授权媒体 id 的卡片**不渲染**（只显示文字），前端不会请求任意 URL；
- 撤回：把图从所有公开引用里撤回后，消息仍在、图降级为文字说明、匿名读图 404；
- 交互：点击打开灯箱、Escape 关闭、焦点归还（复用既有灯箱测试口径）；
- 无新增 body 锁/音频/历史记录副作用。

## 5. 决策请求

请产品确认：**A / B / C 选哪个**；若选 A：Phase 2（AI 选图）是否本轮就要，
还是先只做 Phase 1（剧本图片消息）。未确认前，本轮及后续不实现 B4，视觉还原里
「图片消息」继续标**未完成**（不伪造参考帧里没有的数据结构）。
