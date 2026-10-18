# 完整交接包验收返工 · R2 / R3（图片灯箱 Escape 与失败降级）

> 对象：`docs/acceptance/2026-10-18-complete-acceptance.md` 的 R2 / R3。
> 日期：2026-10-18 ｜ 状态：**R2 / R3 已修复并复验**；R1（参考帧游戏归属）另行处理。

## 1. R2 · 手机聊天灯箱按 Escape 退出整个 App（P2）

### 根因

- `content-card.tsx` 的图片灯箱只注册 `window.keydown`，未接入共享 `OverlayManager`；
- `OverlayProvider` 在 `document` 上先消费 Escape，并 `stopPropagation()`；灯箱的
  `window` 监听（冒泡更晚）收不到；
- 事件继续到手机层，`phone-host.tsx` 的 `onEscape` 把「应用内 → 桌面」执行成
  `goHome()`，URL 变成 `/?phone=home`，整个聊天 App 被卸载；
- 旧 `e2e-im-image-card.py` 只断言「灯箱 DOM 消失」，App 被卸载也满足，故 8/8 是假通过。

### 修复

1. `ImageCard` 接入 `useOverlay`（每张卡一个 id）：
   - `onEscape` → 关闭灯箱并返回 `true`（消费 Escape，手机层不再收到）；
   - `lockScroll: true`；`restoreFocus` → 触发按钮，且 `focus({ preventScroll: true })`；
2. 灯箱改为 **React Portal 到 `document.body`**：避免手机 `transform` 造成的层叠上下文
   让 `.pw-close` 盖住灯箱/拦截点击（浏览器复验时真实遇到）；
3. 打开后把焦点放到「关闭」按钮；灯箱内保留本地 Escape 兜底
   （`preventDefault + stopPropagation + close`），无宿主时也可用；
4. 关闭按钮 / 背景点击 / Escape 三条路径共用 `close()`，滚动位置不因焦点归还而移动。

### 复验（`tools/e2e-im-image-card.py`，真实浏览器）

- 手机宿主 + 独立聊天页各跑一遍，共 **60 项断言全部通过**；
- 每次打开前取 `.msg-list` 滚动位置，关闭后断言**完全相同**；
- 断言 Escape / 关闭按钮 / 背景点击后：灯箱消失、`.msg-list` 与正文仍在、
  URL 不含 `phone=home`、图片卡仍在、焦点回到触发按钮；
- 手机宿主 URL 保持 `?phone=ins&screen=conversation&item=morgana`；
  独立页保持 `/apps/ins/messages/morgana`；
- 旧脚本的假通过已消除：现在同时检查「灯箱关闭」与「会话仍在」。

截图：`.dsh/screenshots/acceptance-complete-r2r3/01-lightbox-open.png`、
`02-after-escape-still-in-conversation.png`。

## 2. R3 · 灯箱内图片失败缺少降级（P2）

### 根因

缩略图 `<img>` 有 `onError`，灯箱 `<img>` 没有；缩略图成功后失去公开引用/网络断开，
灯箱会留下破图。

### 修复

- 新增 `lightboxFailed` 状态：灯箱图片 `onError` → 显示
  「图片暂时不可用（可能已失去公开引用）。可以关闭后继续浏览。」（`role="status"`），
  不再渲染破图；「关闭」按钮与背景/Escape 均保留；
- 每次打开灯箱重置失败状态；缩略图失败态（`failed`）保持原逻辑；
- 新增前端用例：**缩略图成功 → 灯箱请求失败** 时显示降级、仍可关闭、焦点归还。

## 3. 验证结果

- `features/messaging/image-card.test.tsx`：**5/5**（新增灯箱失败用例）；
  messaging 套件 **72/72**；
- `bash tools/verify-all.sh --e2e --mobile` → **7/7 段全绿**
  （前端 **934** / 后端 952 / T02 52/52 / 多视口 11 / 业务流 4/4 / 端到端 12 项）；
- `python3 tools/e2e-im-image-card.py http://127.0.0.1:3100` → **60 通过 / 0 失败**；
- 浏览器截图见上（Escape 后仍停留在同一会话，图片卡与正文可见）。

## 4. 仍未处理（后续轮次）

- **R1**：三张参考帧被标错游戏/用途（P4 画面标成 P5R、P5 日期推进标成东京地图），
  需重新标注归档、修正来源/索引/脚本标签/受影响视觉结论，并补正确参考；
- 其余 §6 遗留：手机图标定稿、相册 1,200 上限提示、详情 pending 文案、历史状态标注、
  精选库入口摘要数量；
- WebKit 冒烟断言、真机验证等证据有效性项。
