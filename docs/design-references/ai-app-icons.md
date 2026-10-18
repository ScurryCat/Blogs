# 手机桌面 AI 同风格图标（站主授权，2026-10-18）

> 背景：完整验收 §6.1 要求「全部图标定稿」。原版 P5/P5R 手机桌面只有 IM / 地图 /
> 天气 / 相机等少数 App；本站的手记、放课后、协助者、我的殿堂、天鹅绒房间、印象空间、
> 情报档案、档案等是站点自适配入口，不存在可直接引用的原作图标。
> 站主 2026-10-18 明确授权：「若游戏中不存在的 app，允许通过 ai 绘图绘制相同风格的 app 图标。」

## 1. 产物

- 位置：`apps/web/public/assets/legacy/img/app/ai/<id>.png`（256×256 PNG，随仓库分发）
- 渲染：`features/phone/ai-app-icons.ts`；桌面 `data-app-icon="ai-adapted"` 明确标记；
  已审核原版图标仍优先（ins / metanav → `data-app-icon="original"`）。
- 生成：火山方舟 Seedream（`ark_generate_image`，2026-10-18）。统一提示词：
  「Persona 5 style app icon, square 1:1, flat bold graphic design, black/paper-white
  with red accent, thick black outline, halftone texture, centered symbol, no text」，
  每个 App 替换中心符号（笔记本/手柄/两个人/画框/面具/地铁隧道/档案夹/ID 卡/地图/天气）。

| App | 文件 | 字节 | SHA-256 |
| --- | --- | --- | --- |
| `journal` | `app/ai/journal.png` | 75206 | `34411fa247e95130e7497ebdc9250b78cf087a7a6c4c83215ef0d538768d8637` |
| `leisure` | `app/ai/leisure.png` | 49646 | `5d783b146d97b51a531c58a20f879be28ae2ecd844083c725da4cdd438a0142e` |
| `coop` | `app/ai/coop.png` | 69974 | `14af0957721ca2b50e4a7bb220256eeb7949bb0193dd93da14e742e91f7247b6` |
| `showcase` | `app/ai/showcase.png` | 96834 | `75a385aa9a8d6e8f6ab4f346da1679a0f90223d0d759efc0c4d6d1150888a065` |
| `velvet` | `app/ai/velvet.png` | 50848 | `c9061f35ca15dc5dc872d28c4c629367ee116095c73012f432998e89d41d2651` |
| `mementos` | `app/ai/mementos.png` | 85317 | `972984f048989eba2db5a0174a9ebc9596f06d30b89fb5ea4d914b10747e51b7` |
| `palace` | `app/ai/palace.png` | 53337 | `8b8cc91f58357cafbddd5cd8330b5fa7741bc39e7d2cd7bd249aea0889c88773` |
| `profile` | `app/ai/profile.png` | 42826 | `7a30325c9b8f6ee9e3e5c8080056ccf56349aab5880115d62f6a75a0c602e6ac` |
| `tokyo` | `app/ai/tokyo.png` | 60485 | `6d4a23c0e63aefc68a381f4dbced117848279670b195ad419cb9a03b2e58a296` |
| `cast` | `app/ai/cast.png` | 81359 | `07c03bbe3c52dc5eef952e574879b451c98f2d08b3df4d3b0d751bbbe2057f6b` |

## 2. 边界（不冒充原作）

- 这些是 **AI 生成的同风格适配图标**，不是 Atlus 原作素材，不声称逐像素还原；
- 已审核原版图标（ins / metanav）仍为独立来源 PNG，见 `original-app-icons.md`；
- `tokyo` / `cast` 在游戏中有对应概念（地图/天气），但本站入口是站点自适配页面
  （`/map`、`/weather`），且没有可用的干净原作图标，暂按站主授权绘制同风格图标；
  如后续拿到原作图标，可直接替换 `AI_APP_ICONS` 中两个路径而不改组件；
- 旧 AI 位图（`assets/legacy/img/app/<id>.png`）不再作为桌面默认回退；
- 生成记录仅用于本地开发交接，图标版权/许可按站点既有素材口径处理。
