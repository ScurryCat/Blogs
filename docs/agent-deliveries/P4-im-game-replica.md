# 游戏内 IM 聊天界面复刻（2026-10-19）

> 目标：按 P5R 游戏内 IM/SNS 参考帧复刻聊天界面（不是「视觉语言接近」）。
> 参考帧：`hud/p5r-im-conversation-fullframe.jpg`（会话）、`hud/p5r-im-inbox-fullframe.jpg`（收件）、
> `hud/p5r-im-reply-selection-fullframe.jpg`（G2 回复选择，站主提供）。

## 1. 本轮改动

| 参考帧特征 | 站点实现 |
| --- | --- |
| 手机内只有 IM 自身，没有网页式 App 头 | 手机宿主里隐藏 `pw-appbar` 的 App 名/展开链接；返回键改为浮层黑白红方钮；IM 占满手机屏 |
| 头部只有大 wordmark，没有角色信息横条 | 手机宿主隐藏 `msg-thread-id`；IM wordmark 32–38px、纸白底+红侧条+红硬阴影，左上；详情缩为小方钮 |
| 黑底白边消息条、白字、轻微倾角 | 气泡 4px 白边、黑底白字、正文 700 粗体；每条按序号 -1.6°/-0.2°/0.3° 微倾 |
| 头像白框拍立得、叠压消息条左缘 | 头像 44px、彩色相纸底、负边距叠压气泡；白纸黑内框 |
| 气泡右下白色小标记 | `.msg-bubble-wrap::after` 白色小斜条（参考帧的白边缺口/标记语言） |
| 白色箭头回复选项、首条红字 | G2 后已实现：白底黑边箭头条、右对齐、首条红字、悬停反色 |
| 收件列表的 IM wordmark | 列表头补回 IM wordmark 并放大；返回键不再遮挡 |
| 底部 Scroll/Close 提示 | 保留 `SCROLL 滚动 / BACK 返回` 行，对应游戏底部操作提示 |

## 1.5 第二轮（2026-10-19）

- 收件列表补**真实状态/日期斜标签**：状态用真实会话状态（新会话/暂停/对话中/已结束），
  日期用 `last_message_at` 格式化为 `M/D 周X`（Asia/Shanghai），对应参考帧的 HOLD/NEW + 3/19 Su；
  不显示游戏里的 HOLD/NEW 字样（站点无该语义，不伪造）；
- 行加斜切 `clip-path`，标签做白底黑字/红底白字斜块；
- 消息正文 700 粗体、白边 4px、每条按序号轻微不同倾角、右下白色小标记；
- 手机宿主内 IM 全屏、头部扁平化、列表头 IM wordmark 不再被返回键遮挡。

截图：`.dsh/screenshots/im-replica/04-conversation-v3.png`、`07-inbox-date-tag.png`。

## 1.6 第三轮（2026-10-19）

- 手机宿主内隐藏「自己说一句」输入条、自由聊天用量、选择提示文案（参考帧没有输入框）；
  独立页仍保留完整自由聊天；
- 底部操作提示压到手机最底部（白纸底黑字，左「SCROLL 滚动」右「BACK 返回」），
  对应参考帧左下 Scroll / 右下 Close 的位置；
- 消息区改为 flex 占满剩余高度，选项区固定底部；
- 390px 手机视口：详情按钮留出右上关闭钮空间，避免被裁切。

截图：`.dsh/screenshots/im-replica/08-conversation-bottom-hints.png`、
`09-mobile-conversation.png`、`10-mobile-v2.png`。

## 1.7 第四轮（2026-10-19）

按参考帧继续做「减法」：

- 手机宿主内隐藏原版没有的发送人/时间行、列表介绍段、角色 tagline、消息条数 meta、
  “Character messages” 小注；独立页保持完整信息；
- 底部提示改为红底上的白色粗体 + 红点（参考帧 Scroll/Close 语言），去掉白纸条；
- 会话 wordmark 轻微上移/旋转，压住手机屏上缘；
- 收件列表行收紧 padding，只留头像、名称、预览、状态/日期标签。

截图：`.dsh/screenshots/im-replica/11-conversation-clean.png`、`12-inbox-clean.png`。

## 1.8 第五轮（2026-10-19）

- IM wordmark 改回参考帧的**黑底白字 + 红色左条 + 红硬阴影**（此前为纸白底黑字）；
- 底部提示改**圆形描边键**：`(L) 滚动`、`(✕) 返回`，红底白字；
- 头像右缘加白色三角指向消息条，补参考帧的拍立得压边连接；
- 证据：`.dsh/screenshots/im-replica/13-conversation-logo-hints.png`。

## 1.9 第六轮（2026-10-19）：整体对照

- 生成游戏帧 ↔ 站点 IM 的并排对照：`.dsh/screenshots/im-replica/comparison-conversation.png`
  （上：会话；下：收件列表）；
- 回复选项间距收紧、轻微错叠；最终会话截图
  `.dsh/screenshots/im-replica/14-final-conversation.png`；
- WebKit + iPhone 视口复验 **28/28**。

### 对照结论（诚实边界）

已达到的复刻点：手机内全屏 IM、黑底白字红条 wordmark、黑底白边粗体消息条 + 头像压边、
白色箭头回复选项、白色小标记、收件列表状态/日期斜标签、底部圆形 L/✕ 操作键。

仍不同：参考帧是整台倾斜手机 + 手部 + 街道场景；站点是固定桌面手机壳；
参考内容是多条群聊/多日收件，站点是两条开场 + 选项；游戏无自由输入框，站点独立页保留。
因此本文件记录的是「界面语言与构图复刻」，不是与游戏画面逐像素等比。

## 2. 证据

- 截图：`.dsh/screenshots/im-replica/`
  - `04-conversation-v3.png`：手机宿主内 IM 会话（全屏、wordmark、黑底白边粗体、白箭头选项）
  - `05-inbox-v2.png`：收件列表（IM wordmark + 黑底白边角色条）
- 参考帧：外部精选库 `hud/p5r-im-conversation-fullframe.jpg`、`hud/p5r-im-inbox-fullframe.jpg`；
  G2 `hud/p5r-im-reply-selection-fullframe.jpg`（22/22 校验）
- 测试：messaging 7 文件 72 通过；phone 相关 102 通过（CSS 隔离测试仍通过）

## 3. 仍与参考帧不同（未冒充逐像素）

1. 参考帧是**整台倾斜手机**占满游戏画面（含手部/场景）；站点是固定桌面手机壳，不复制场景/手部；
2. 游戏 IM 没有自由输入框；站点保留「自己说一句」自由聊天入口（产品功能，非原版 UI）；
3. 收件列表的日期/状态斜标签（3/19 Su、HOLD/NEW）没有游戏内数据，未伪造；
4. 手机外框、字号与整体比例仍非逐像素等比。

## 4. 复验

```bash
bash tools/verify-all.sh --e2e --mobile      # 7/7 段
PLAYWRIGHT_BROWSERS_PATH=.dsh/ms-playwright python3 tools/e2e-webkit-mobile-smoke.py http://127.0.0.1:3100
python3 tools/e2e-im-image-card.py http://127.0.0.1:3100
```
