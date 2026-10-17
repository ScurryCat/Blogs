# 原版手机桌面图标接入记录（验收 F2 返工）

> 触发：`docs/acceptance/2026-10-17-handoff-v2-acceptance.md` F2（P1）——
> 桌面仍默认 AI 位图，经典异世界导航红眼、原版消息标识未落地。
> 日期：2026-10-17。范围：只接入两个**已核对身份/版本/画面**的原版图标；
> 其余 App 继续标注为「适配设计」，不冒充原版。

## 1. 结论

| App | 原版对应 | 实际渲染资源 | 原版 / 适配 | 状态 |
| --- | --- | --- | --- | --- |
| `metanav` 异世界导航 | 经典红眼（红眼 + 星形瞳孔 + 黑色外刺） | `/assets/legacy/img/app/original/metanav-original.png` | **原版图标视觉清理版**（来源可追溯；下方有原版画面证据） | ✅ 已接入桌面默认渲染分支 |
| `ins`（原版消息 / IM） | P5R SNS/IM 消息标识（红色对话框 + IM） | `/assets/legacy/img/app/original/ins-original.png` | **原版图标视觉清理版**（来源可追溯；下方有原版画面证据） | ✅ 已接入桌面默认渲染分支 |
| 其余 8 个 App | 见 `icon-mapping.md` | `app/<id>.png`（第二轮 AI 位图）或自绘 SVG | **适配设计** | 保持，不冒充原版 |

实际渲染分支：`apps/web/features/phone/phone-desktop.tsx` 通过
`apps/web/features/phone/app-original-icons.ts` 的 `originalAppIcon(app.id)` **优先**取原版图标，
渲染 `<img data-app-icon="original">`；没有原版条目的 App 才回退到适配图标（`data-app-icon="adapted"`）。
映射与真实渲染路径由 `tools/acceptance/verify-phone-icons.py` 审计（含 `data-app-icon` 标记检查）。

## 2. 素材来源与证据（可追溯）

### 2.1 `metanav-original.png`（异世界导航红眼）

| 项 | 记录 |
| --- | --- |
| 采用资源（清理版来源） | <https://i.imgur.com/ATId1vbh.jpg>（Yandex 图片检索「Metaverse App Logo - Album on Imgur」；下载于 2026-10-17） |
| 源文件 SHA-256 | `cc3ac1a8d925d6852c142f2e40a7475795cb83e0477b2fc2dd9a7a1c6b61796f` |
| 原版画面证据（同款图标） | <https://images.stopgame.ru/uploads/users/2021/447763/00049.7dvbb8E.png>（P5 动画中手机屏幕上的异世界导航 App 图标） |
| 证据图 SHA-256 | `23dcbe007f65427ab2b5b85a38ee10791fa23857126d4c5e4ae6630503554000` |
| 身份 / 版本核对 | 红眼 + 星形瞳孔 + 黑色外刺，与 P5 动画画面逐项一致；**不是** P5R/P5X 变体（本地库比对：P5 22 张 + P5R 8 张 HUD 表均无该独立图标） |
| 处理 | 原图 1024×1024 JPEG → 512×512 PNG（等比缩放、保留黑色圆角底；未 AI 重绘、未改画面内容） |
| 产物 SHA-256 / 大小 | `549fff0cd0cc744922eb944c345e914536f5a46560c5e9abd501eb0518d88ea0` / 176,623 B |
| 世界性说明（不夸大） | 本地参考库确认没有独立原图；采用「外部可追溯清理版 + P5 动画原版画面证据」。属**原版图标视觉清理版**，不宣称是官方原始矢量文件。 |

### 2.2 `ins-original.png`（原版消息标识）

| 项 | 记录 |
| --- | --- |
| 采用资源（清理版来源） | <https://i.pinimg.com/originals/b7/2e/95/b72e95b962ab735f3b9a20589ddb3905.jpg>（Yandex 图片检索；红底白字 IM 对话框） |
| 源文件 SHA-256 | `2fb9d001caa9ea0cb507413143f8e6a8300b86e86dd564cf9b56b2abf5d4d3c7` |
| 原版画面证据 | `persona-dist/media/image/P5R/p5r-sns--4aa5330b1fe6.jpg`（P5R SNS/IM 界面参考，顶部 IM 标识；本地库内，源 URL 未核实——沿用既有 G4 记录） |
| 证据图 SHA-256 | `4aa5330b1fe601bf40737f584ffc4a5a5d8dfe30526e75614c1076d3c3c3f3bf` |
| 官方素材表交叉核对 | `persona5-spriters/p5r/hud/132782-im-assets-cn-jp.png`（Spriters Resource #132782，P5R）内 **SNS logo** 的独立提取：裁切 `(1212,594)-(1532,758)` → 320×164 PNG，SHA-256 `9dddfb4ec56d6e3397c06df4e6d974e8135e455a686bc1dd95f491b5edfb207b`（源表 SHA-256 `c8510c56…`） |
| 身份 / 版本核对 | P5R（PS4）原版消息标识（IM / SNS）；红色对话框 + 白色“IM”字样，与 P5R SNS 界面参考一致 |
| 处理 | 裁到图标内容 → 居中到 512×512 黑底方图（未 AI 重绘） |
| 产物 SHA-256 / 大小 | `5ca013fc1233e803988bd377678ffd26dc61cad9519886ade5b1250b50f2801f` / 95,035 B |
| 含明智合图的安全处理 | 官方 IM 素材表含角色头像合图（含不在允许清单的角色）；**没有**把整表放进公开目录，也没有靠 CSS 裁剪旧图——只从源表提取**不含角色**的 SNS logo 作为交叉核对；实际渲染图标为独立的对话框图标文件（无人物）。 |

## 3. 清单 / 测试 / 审计同步

- 素材清单 `docs/design-references/persona-assets-manifest.csv` 新增 2 行
  （`app-icon-original`，含来源、版本、处理、画面复核、许可状态）。
- `docs/design-references/icon-mapping.md` 的 `ins` / `im` / `metanav` 行同步为「已接入」。
- 单测 `apps/web/features/phone/app-original-icons.test.ts`：映射范围、文件存在、PNG 魔数、哈希固定值。
- 审计 `tools/acceptance/verify-phone-icons.py`：扫描 `app-original-icons.ts`、检查映射/文件/清单/哈希，
  并断言 `phone-desktop.tsx` 引用 `originalAppIcon` 且带 `data-app-icon="original"`。
- 无明智复验：新增两个图标不含任何角色/明智元素；`verify-no-akechi-assets.py` 重跑通过。

## 4. 未完成 / 不宣称

- 其余 8 个 App 仍是**适配设计**（AI 位图 / 自绘 SVG）；原版素材不在本地库，未冒充。
- `metanav` 的官方原始 sprites 文件仍不在本地库：本记录以「外部可追溯清理版 + P5 动画画面证据」
  落地实际渲染；世界性标记见 §2.1。
- 原版消息标识的 P5R 界面参考图源 URL 仍未核实（与 G4 既有记录一致），本记录不补写推测 URL。
