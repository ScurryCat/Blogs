# 参考帧补齐（验收 v2 §5.1 / §7.3）

> 验收报告剩余项：「补存档 / IM 等完整参考和视觉对照证据」。
> 日期：2026-10-18 ｜ 范围：外部精选库 `persona-curated/hud/` 新增 6 张完整帧 +
> 仓库复验脚本 + 缺口规格书更新。**不改产品代码、不重写已通过的来源语义。**

## 1. 结论

| 缺口 | 之前 | 现在 |
| --- | --- | --- |
| **G2 回复选择完整帧** | ❌ 完全没有 | ✅ 有完整 1920×1080 帧（3 选项，P5R） |
| **G1 普通对话完整帧** | ⚠️ 仅 IM 群聊一张 | ✅ 普通对话 ×2（官方 CDN 4K + 本地导入）+ IM 完整屏 ×2 |
| **G4 图片消息完整帧来源** | ⚠️ 本地帧、来源未核实 | ⚠️ 仍保留原帧；另补 IM 群聊帧（Pinterest 来源未核实）。**来源未核实状态未变** |
| **手机 HUD 完整帧**（日期/IM 通知/小地图） | 无 | ✅ 街景 HUD 完整帧 1 张 |
| **存档/读取整屏帧** | 缺 | ❌ 仍缺（只有 `92140` 元件表） |

新增 6 帧均在外部精选库 `assets/reference/persona-curated/hud/`，逐帧实看**无明智吾郎**；
来源/哈希/规格/画面复核见 `docs/design-references/reference-frame-gaps.md` §7 与
外部库 `provenance/hashes.json`、`provenance/sources.json`、`INDEX.md`。

## 2. 筛选与核对方法

1. 用可访问的图片检索（Yandex 图片）按缺口关键词收集候选（约 590 个 URL）；
2. 下载 + 缩略图逐批人眼筛选，命中「回复选择 / 普通对话 / IM / HUD / 存档」形态；
3. 用 dHash 与本地参考帧交叉比对，确认重复帧与官方来源：
   - `p5r-dialogue-normal-fullframe.jpg`（PlayStation CDN 4K）↔ 本地 `screenshot-04`：dHash 距离 1；
   - `p5r-im-groupchat-fullframe.jpg` ↔ 本地 `p5r-sns`：同 UI 家族（dHash 9，不同截图）；
4. 记录来源 URL、游戏版本（全部 P5R）、许可「未核实」、画面复核（无明智）；
5. 写入外部精选库后，用仓库脚本复验哈希/尺寸/索引/来源一致性。

## 3. 复验

```bash
python3 tools/acceptance/verify-reference-frames.py
# ✓ 6/6：G2 回复选择、G1 普通对话 ×2、IM 完整屏 ×2、手机 HUD 完整帧
#   每项校验：文件存在 + SHA-256 + 尺寸 + INDEX.md + provenance 双登记
```

- 已加入 `tools/verify-all.sh --fast` 的静态审计段（参考库不存在时 SKIP，便于其它机器）。
- 证据拼图：`.dsh/screenshots/reference-frames/contact-sheet.png`（本地产物，不随包分发）。

## 4. 仍未关闭（不冒充完成）

1. **存档/读取整屏帧**：仍只有 P5 `92140` 存档/读取 HUD 元件表；没有整屏帧。
2. 殿堂 / 天鹅绒 / 印象空间 / COOP / 放课后 等界面仍没有整屏参考帧（只有元件表/截图）。
3. 回复选择帧为 P5R 英文 UI；站点若按 P5 原版做逐像素对照，仍需 P5 版或注明版本差异。
4. 真实触控 / 软键盘 / 移动 Safari 与 IM 图片消息（B4）仍待解决。
5. 所有帧许可状态「未核实」，仅本地开发参考，不进入网站构建或公开分发。
