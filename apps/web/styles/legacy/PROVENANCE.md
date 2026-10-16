# styles/legacy · 旧站样式表的迁移来源

本目录的 9 个样式表由 `apps/web/tools/legacy-migration/migrate.mjs` 从旧站
`assets/css/` 生成（T02，2026-10-16）。**这是静态资源迁移，不是重写**：旧站的
Persona 5 排版、撕纸字、斜切卡片、票数框构图与问卷 HUD 全部按原样保留，
避免迁移过程中「顺手升级」美术方向或改变问卷语义。

## 逐字节约束

除每个文件开头新增的 3 行来源注释外，**唯一的改动**是把相对静态路径改成 Next 的静态根：

| 旧站写法 | 迁移后 | 处数 |
| --- | --- | --- |
| `url(../img/…)` | `url(/assets/legacy/img/…)` | 18 |
| `url(../fonts/…)` | `url(/assets/legacy/fonts/…)` | 3 |
| `url(../sfx/…)` | 无（旧站也没有） | 0 |

原因：旧站 CSS 与 `assets/` 同级；打包后样式表位于 `apps/web/styles/legacy/`，
`../img/` 会解析到不存在的位置。资源本体逐字节复制到
`apps/web/public/assets/legacy/`。

## 文件与原始 sha256

重新运行 `node apps/web/tools/legacy-migration/migrate.mjs` 可复现；脚本每次都会把
原始 sha256 写进文件头注释。核对方式：

```sh
shasum -a 256 apps/web/../../assets/css/*.css   # 旧站（只读参考）
shasum -a 256 assets/css/*.css                  # 与上一条同一批文件
```

## 维护规则

- 旧站 `*.html` / `assets/` 是当前正式站点，**只读**。功能包不「顺便清理」它。
- 要改样式，改 `apps/web/styles/legacy/`，并在交付记录里写明与旧站的差异；
  不要把改动写回旧站（那属于 T00 协调的基线变更）。
- 新增样式（手机宿主直立面板、应用面板、新的组合边界）不要塞进这些文件，
  放 `apps/web/app/globals.css`，保持「迁移文件 = 旧站快照」这条界线可审计。
