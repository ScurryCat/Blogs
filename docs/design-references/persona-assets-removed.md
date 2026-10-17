# 活动素材库 · 移除 / 恢复清单

> 第三轮 P5 内容架构 v3 · 任务书 §5.4 · **N6 素材负责人**
> 复核日期：2026-10-17。恢复位置**不被默认预览 / 构建读取**（`.dsh/` 已被
> `.git/info/exclude` 忽略、不参与 Next 构建、不被静态服务读取）。
> 相关：允许清单 `persona-assets-allowlist.md` · 排除审计清单 `persona-assets-excluded.md` ·
> 外部精选库方案 `persona-curated-plan.md`。

## 0. 数量与路径约定

| 项 | 数值 |
| --- | --- |
| Git 索引中的 `assets/**` 文件数（操作前） | **200**（`git ls-files assets \| wc -l`） |
| 操作后 Git 索引 | 200（本轮不 `git add`/`git rm`；**不提交**，索引不变属预期） |
| 操作后工作区 `assets/**` 文件数 | **198**（`find assets -type f \| wc -l`；删除 2 个，`cover/platinum.jpg` 原位替换仍计 1 个） |
| 公开目录 `apps/web/public/assets/legacy/**` | 变动前 172 → 变动后 **171**（删除 2：`icon/crow.webp`、`band-halftone.jpg`；新增 1：`icon/mementos.webp`；`cover/platinum.jpg` 原位替换） |
| 归档根 | `<仓库>/.dsh/archived-assets/<原相对路径>`（即 `/Users/学习/blog/Blogs/.dsh/archived-assets/assets/...`） |

> 注：任务书 §5.3 写的是 `apps/web/assets/img/icon/crow.webp`，**实际该目录不存在**；
> T02 迁移工具 `apps/web/tools/legacy-migration/migrate.mjs` 的迁移源是**仓库根 `assets/`**，
> 产物侧是 `apps/web/public/assets/legacy/`。本清单按实际路径记录（修正任务书路径假设）。

## 1. 移除清单（3 项）

| # | 原相对路径（仓库根 `assets/`） | 公开侧对应路径 | 原 SHA-256 | 恢复方式 | 移除理由 |
| --- | --- | --- | --- | --- | --- |
| R1 | `img/icon/crow.webp` | `apps/web/public/assets/legacy/img/icon/crow.webp`（已删除） | `2c94638757c68b665742067376ce8abeb375b31749311cd7420c400430e9c58e` | 归档副本 `<仓库>/.dsh/archived-assets/assets/img/icon/crow.webp`；或 `git checkout HEAD -- assets/img/icon/crow.webp apps/web/public/assets/legacy/img/icon/crow.webp`（会恢复含明智文件，仅在明确授权时） | 明智吾郎独立头像（§5.2 排除）；引用已改为无角色适配图标 |
| R2 | `img/cover/platinum.jpg` | `.../img/cover/platinum.jpg`（已原位替换） | 原版 `085e6df989e982f1c92f83ab6606c10fb4b2f2d229fb11eb0b3011c9a8bad2d6` | 归档副本 `<仓库>/.dsh/archived-assets/assets/img/cover/platinum.jpg`；恢复命令 `cp <归档> assets/img/cover/platinum.jpg && cp <归档> apps/web/public/assets/legacy/img/cover/platinum.jpg`（仅在明确授权时） | 明智立绘，作为文章封面；已替换为天鹅绒房间空景（新哈希 `394c37ce82717c45f83bd78d09ecad288fb506e42ac2eb0ab19d7fed7d69d142`） |
| R3 | `img/band-halftone.jpg` | `.../img/band-halftone.jpg`（已删除） | `f6eade8ed6710a3f6b16317cbda8521b34ca57d1962b81d954c73a49352519db` | 归档副本 `<仓库>/.dsh/archived-assets/assets/img/band-halftone.jpg`；或 `git checkout HEAD -- assets/img/band-halftone.jpg apps/web/public/assets/legacy/img/band-halftone.jpg`（仅在明确授权时） | Joker+黑面具明智双人插画，不可可靠分离；站内无引用但可直接下载，必须移除 |

**归档目录结构（仅这 3 个文件，每份都是原字节）**：

```text
.dsh/archived-assets/
└── assets/
    └── img/
        ├── band-halftone.jpg          # R3 原字节
        ├── cover/
        │   └── platinum.jpg           # R2 原字节（明智立绘）
        └── icon/
            └── crow.webp              # R1 原字节（明智头像）
```

**恢复命令（可复制；执行后必须重新复核并说明授权理由）**：

```bash
cd /Users/学习/blog/Blogs
cp .dsh/archived-assets/assets/img/icon/crow.webp        assets/img/icon/crow.webp
cp .dsh/archived-assets/assets/img/icon/crow.webp        apps/web/public/assets/legacy/img/icon/crow.webp
cp .dsh/archived-assets/assets/img/band-halftone.jpg     assets/img/band-halftone.jpg
cp .dsh/archived-assets/assets/img/band-halftone.jpg     apps/web/public/assets/legacy/img/band-halftone.jpg
cp .dsh/archived-assets/assets/img/cover/platinum.jpg    assets/img/cover/platinum.jpg
cp .dsh/archived-assets/assets/img/cover/platinum.jpg    apps/web/public/assets/legacy/img/cover/platinum.jpg
# ⚠️ 恢复含明智文件会重新违反第三轮 §5 验收项 8.3；除非任务范围改变，否则不要执行。
```

> 若将来需要**彻底删除**（不可恢复）：删除上述 3 个归档文件与 Git 历史中的对应 blob 需
> 单独的「改写历史」审批（本轮任务书明确**不改写 Git 历史**，故未做）。
> 删除前先确认 `tools/acceptance/verify-no-akechi-assets.py` 与 `docs/design-references/*`
> 中的哈希记录已不再需要。

## 2. 迁移工具的防再生守卫（可执行证据）

T02 迁移工具 `apps/web/tools/legacy-migration/migrate.mjs` 增加：

```js
// 第三轮 N6：以下图片不得进入公开目录（源已删除/替换；再留一道守卫）
const EXCLUDED_IMG = ["icon/crow.webp", "band-halftone.jpg"];
for (const rel of EXCLUDED_IMG) {
  await rm(path.join(webRoot, "public/assets/legacy/img", rel), { force: true });
}
```

新增 `--assets-only` 模式（只重跑资源复制 + 守卫，**不重写** `features/legacy/data/*.json`
与旧站 CSS，避免覆盖并行开发中的他人数据）。**实测证据（2026-10-17）**：

```bash
# 步骤 1：模拟「有人回滚了旧源」——把归档的 3 个含明智文件放回仓库根 assets/
cp .dsh/archived-assets/assets/img/icon/crow.webp    assets/img/icon/crow.webp
cp .dsh/archived-assets/assets/img/band-halftone.jpg assets/img/band-halftone.jpg
# 步骤 2：重跑迁移（只跑资源部分）
node apps/web/tools/legacy-migration/migrate.mjs --assets-only
#   → assets-only: img=155 fonts=6 sfx=1（未重写数据 JSON / CSS）
# 步骤 3：证明 public 下没有再生
test -e apps/web/public/assets/legacy/img/icon/crow.webp    → 不存在 PASS
test -e apps/web/public/assets/legacy/img/band-halftone.jpg → 不存在 PASS
# 步骤 4：移除模拟回滚的源文件，再跑一次，公开目录哈希树与操作前逐字节一致（PASS）
rm assets/img/icon/crow.webp assets/img/band-halftone.jpg
node apps/web/tools/legacy-migration/migrate.mjs --assets-only
diff <(shasum 公开目录树) <(shasum 公开目录树)   → 无差异 PASS
```

**引用检查结论**（缩略图 / 映射表 / 验收脚本 / 示例）：

- `grep -rn "crow\|band-halftone\|platinum" tools apps/web/tools apps/web/scripts`（排除 `crowd`）→
  仅剩 `migrate.mjs` 的守卫清单本身；无缩略图生成脚本、无素材映射表引用被删文件。
- `tools/acceptance/verify-ins-media-loop.py` 原以文件名 `crow.webp` 上传一张**程序生成的纯色
  PNG**（与明智无关，仅文件名会误导审计）→ 已改为 `verify-sample.png`、ALT 文本改为「验证图片」。
- `tools/p0-contact-sheets.py` 只读本地 `.dsh/p0-analysis` 提取裁片、产物在 `.dsh/`，不入构建；
  其来源合图含全体协助者/IM 头像，已在文件头与排除清单标注「未审核、不进允许清单」。
- `docs/agent-deliveries/T07-result.md`、`T09-result.md` 中历史出现的 `crow.webp` 是**过往交付报告
  的文字记录**，不改写历史报告；当前代码已无该引用。

## 3. 未来新增媒体（N5 过场短版）的移除/恢复约定

`apps/web/public/assets/clip/isekai-showcase.webm`（N5 交付、N6 复验登记）**不在本次移除清单**；
若将来撤下该媒体，按同样格式登记：原路径 → 归档路径（`.dsh/archived-assets/apps/web/public/assets/clip/...`）
→ 哈希 → 理由 → 恢复命令。当前哈希与许可状态见允许清单 §3。
