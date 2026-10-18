# IM 图片消息（B4 · 方案 A · Phase 1）实现记录

> 站主拍板：**按方案 A 做 IM 图片消息**（2026-10-18）。
> 范围：**Phase 1 最小可用**——剧本消息支持图片卡；前端白框拍立得 + 灯箱；未授权/撤回降级文字。
> Phase 2（AI 自由聊天选图）与 Phase 3（访客引用相册公开照片）**本轮未做**，提案标为可选。

## 1. 实现内容

### 后端（`apps/api/app/modules/messaging`）

| 项 | 实现 |
| --- | --- |
| Card DTO | `CardOut` 增加可空 `width / height / alt`（内容卡不带，向后兼容） |
| `ResolvedCard` | 增加 `width/height/alt`；`as_payload()` 仅在图片卡时写入 |
| 内容解析 | 新增两种 image 卡 kind：`image`（媒体 UUID）/ `album_photo`（`相册slug[:序号]`） |
| `image` 校验 | 媒体存在 + `ready` + 未删除 + **当前有公开引用** + 有 `w640.webp` 变体；否则静默丢弃 |
| `album_photo` 校验 | 复用 gallery 公开投影（已发布 + 已到时间 + 有效公开来源）取照片，再校验 w640 变体 |
| URL 来源 | 一律服务端生成 `/api/v1/media/<id>/w640.webp`（**原图永远不对访客**）；不接受前端/模型 URL |
| 上限 | 图片卡与内容卡共用 `MAX_CARDS_PER_MESSAGE = 2` |
| 剧本 | 摩根加 `map` 节点加 `album_photo: tokyo-nights:0`；双叶 `debug_log` 节点加 `album_photo: screens:0`（剧本版本 1.2.0） |

### 前端（`apps/web/features/messaging`）

- `Card` 类型增加可空 `width/height/alt`；
- `ContentCardList` 对 `image` / `album_photo` 渲染**白框拍立得**（倾斜小纸片 + 说明）；
- `<img>` 用服务端 w640 地址，`alt` 非空（缺省用标题兜底）、`width/height` 来自服务端、`loading="lazy"`；
- 点击打开轻量灯箱（`role=dialog` + `aria-modal`）；Escape 关闭并把焦点还给触发按钮；
- 图片加载失败（撤回/权限变化）→ 降级为「图片暂时不可用」文字，不出现坏图；
- **不是链接**：图片卡不渲染 `SiteLink`，避免把图当站内内容跳转。

### 测试与证据

- 后端 `tests/messaging/test_image_cards.py`：10 项（image 公开/非公开/未 ready/已删除/无变体/坏 UUID；
  album_photo 公开/草稿相册/越界；卡片上限）；
- 前端 `features/messaging/image-card.test.tsx`：4 项（渲染/alt 兜底/灯箱+Escape+焦点/加载失败降级）；
- 浏览器端到端 `tools/e2e-im-image-card.py`：**8/8**（图片卡出现、w640、alt、640×480、HTTP 200、
  开灯箱、灯箱 alt、Escape 关闭）；截图 `.dsh/screenshots/im-image-card/`；
- 契约：`contracts/openapi.json` 重新导出、前端 `lib/api/generated/schema.ts` 重新生成。

## 2. 安全边界（与提案一致）

- 图片只能来自**站主已有媒体**，且必须有**当前公开引用**（相册/作品/动态）；首版**不做访客上传**；
- 模型侧不接入图片候选（Phase 2 才做），模型仍只能回显文字 token；
- 撤回语义：媒体失去全部公开引用 → 匿名读图 404 → 前端 `onError` 降级文字，消息本身不丢；
- 原图永远只给站主；消息流只用 w320/w640 变体。

## 3. 仍未做 / 下一步

1. **Phase 2**：AI 自由聊天从服务端候选图里选图（需单独白名单评审）；
2. **Phase 3**：访客引用相册公开照片（仍不接收上传）；
3. 视觉上与 P5R IM「照片消息」整屏帧的逐像素还原仍属视觉还原任务（见 `P4-visual-comparison-evidence.md`）；
4. 真机验证仍需设备。
