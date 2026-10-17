# N3 交付：图库同步后端（来源模型、album_links 契约、事务版本、统一公开条件、迁移与测试）

> 任务书：`/Users/v/Documents/ChatGPT/Blog开发/docs/superpowers/plans/2026-10-17-p5-content-v3-agent-handoff.md`（第三轮 · P5 内容架构 v3）§4 / §7.1 N3 / §7.4 / §8.2 / §8.5 / §9
> 项目：`/Users/学习/blog/Blogs` · 分支 `main` · 本轮**未做任何 Git 历史改写、未 commit / push / deploy**
> 状态：**完成（后端契约与实现）**。前端 UI / 浏览器 / 真机证据由 N4 / N7 提供，不在本报告范围。

## 1. 实际基线（2026-10-17 接手时现场读取）

```text
分支            main（之外有第二轮/第三轮并行工作，全部保留、不回退、不覆盖）
接手 HEAD       a7475a4 feat(messaging): 会话详情菜单 …（N0 记录的基线 e70ad1f 之后）
工作区          dirty（第二/三轮并行修改；本任务只改自己的写入范围）
迁移 head       接手时 528a38f23614（T09）；本任务新增 b7c3e9a1d2f4 后仍是**单一 head**
隔离测试库      pl_test_n3 = postgresql+psycopg://pl@127.0.0.1:55432/pl_test_n3（本任务专用）
                TEST_DATABASE_URL 指向它；迁移升/降级只在 pl_test_n3 与临时独立库验证
Python/uv       Python 3.13 + uv 0.9.18；UV_CACHE_DIR=/Users/学习/blog/.dsh/uv-cache
```

接手时基线（N0 报告）：全量 `pytest` 911 passed（真实 PostgreSQL，无 skip）。

任务期间同一仓库还有**另一个独立会话在跑第二轮（P0–P3）验收**（它会并发建库 / 跑全量 /
提交），导致共享固定库名 `pl_test_t01` 的 create/drop 竞态；证据与处理见 §7.2 / §8.1。
本任务没有修改 `tests/core/t01_db.py` 固定库名（共享夹具，由 N0/N7 决定），也没有做任何
Git 操作。

写入范围（本任务实际改动）：

| 范围 | 文件 |
| --- | --- |
| 图库后端 | `apps/api/app/modules/gallery/**`（models / **sources.py 新增** / service / schemas / router / public_refs） |
| 动态后端 | `apps/api/app/modules/moments/**`（schemas / service / router） |
| 迁移 | `apps/api/migrations/versions/20261017_1041_b7c3e9a1d2f4_n3_album_media_sources.py`（新增，单一 head） |
| 测试 | `apps/api/tests/**`（新增 3 个文件 + 更新共享辅助与表清单） |
| 验收脚本 | `tools/acceptance/verify-album-moment-retract.py`（扩展第二段；既有断言原样保留） |
| 契约产物 | `contracts/openapi.json`（由后端 schema 重新生成，非手改） |
| 报告 | `docs/agent-deliveries/N3-result.md` |

未改：`apps/api/app/modules/media/**`（权限收窄通过 gallery 的公开引用检查实现，无需改 media）、
`apps/web/**`、依赖清单 / 锁文件、其他模块业务、第二轮 dirty 前端文件、Git 历史、部署配置。

## 2. 已实现的需求

| 任务书要求 | 实现落点 | 证据 |
| --- | --- | --- |
| §4.3 动态管理接口新增可选 `album_links`，语义严格按表格 | `gallery/sources.py`（校验/写入协调）+ `moments/schemas.py`（DTO/422）+ `moments/service.py` + `moments/router.py` | §3 契约；`test_moment_album_links.py` |
| §4.4 区分「独立收录」与「动态收录」（三元组唯一；配置≠公开资格；多来源；迁移回填独立） | 新表 `album_media_sources`（`gallery/models.py`）+ 迁移 `b7c3e9a1d2f4` | §7.3 迁移证据；`test_migration_sources.py` |
| §4.5 撤回 / 删除 / 重发 / 换图 / 相册单图与整组移除 / 相册撤回的完整生命周期 | `gallery/sources.py` + `gallery/service.py`（相册侧）+ `moments/service.py`（动态侧） | §7.4 §8.2 矩阵覆盖；生命周期用例 |
| §4.6 统一公开条件用于列表/详情/封面/数量/照片墙/分页/年份/媒体权限；媒体全站权限仍尊重其他合法公开引用 | `gallery/sources.public_source_exists`（唯一实现）+ `gallery/service.py` + `gallery/public_refs.py` | 墙/来源用例；媒体权限用例；旧 T06/T03 用例回归通过 |
| §4.7 发布 / 修改收录 / 撤回 / 删除 / 相册移除由后端单事务协调；版本协调；重复请求幂等；失败整单回滚 | 单 `commit` 事务；`bump_album_versions` / `bump_moment_versions`；唯一索引兜底；先校验后写入 | `test_..._atomically` / `_stale_version` / `_idempotent` 用例 |
| §4.1 全局照片墙按 `media_id` 去重（查询/分页/total 一致）；主要归属稳定；年份来自实际可展示图片 | `gallery/service.py`：SQL 窗口函数去重 + 同一指纹游标（版本升到 3） | `test_wall_sources.py` |
| §4.2 草稿可先配置收录、发布后才具备公开资格；不自动发布相册 | 动态创建即写配置；公开资格由动态/相册当前状态在 SQL 里联合判断；发布端点不触碰相册状态 | 生命周期用例 |
| §4.7 / §8.5 迁移在隔离库验证升级/回退/旧数据保留/回填/权限断言 | 迁移脚本 + 自动化迁移测试 + 独立 scratch 库手工证据 | §7.3 |
| §8.2 现有验收脚本断言仍有意义 + 新增「仅动态同步来源」撤回场景 | `tools/acceptance/verify-album-moment-retract.py` 扩展第二段（既有第一段一字未删） | §7.5 实测 33 项全通过 |

## 3. 冻结的接口契约（N4 前端可直接依赖）

> 冻结时间：2026-10-17。实施过程中若发现必须变更，会先通知 Lead 与 N4，不在无通知的情况下改语义。
> 所有路径前缀 `/api/v1`。既有路径与既有字段**不替换**；本节只描述新增字段与既有接口的语义变化。

### 3.1 数据语义：显示关系 vs 收录来源（后端内部模型，前端只需理解后果）

| 概念 | 存储 | 语义 |
| --- | --- | --- |
| 相册显示关系 | `album_media(album_id, media_id)` + position / alt / caption / taken_on | **这张图在相册里怎么排、怎么写说明**；继续归相册管理，不被动态收录覆盖 |
| 收录来源 | `album_media_sources(album_id, media_id, moment_id)` | **这张图凭什么有资格公开**：`moment_id = NULL` 是「独立相册收录」；`moment_id` 非空是「动态收录」（三元组唯一） |

规则：

1. 同一「相册 + 媒体」可以同时有 1 条独立来源 + 多条动态来源（不同动态）。
2. **配置存在 ≠ 公开资格**：动态收录配置在草稿 / 撤回状态下仍保留（供重发恢复），但不贡献公开资格。
3. 迁移前已存在的所有相册图片 → 迁移时一律回填为**独立来源**（不按「恰好被动态引用」推断）。
4. 通过相册管理端新加入的图片 = 独立来源；既有图片不会因为再次保存相册表单而被升级为独立来源。
5. 相册侧移除图片（单图删除或整组更新删除）→ 同时删除该「相册 + 媒体」的全部来源与**所有动态侧收录配置**；后续重发不会自动加回。
6. 动态移除某张图片 → 同事务删除该图在该动态下的相册收录配置；其他动态来源与独立来源不受影响。
7. 相册删除（软删除）→ 撤销该相册作为收录目标：删除所有动态指向该相册的收录配置（相关动态 version +1）。相册下的媒体行与文件保留。
8. 相册撤回（unpublish）→ 不改任何来源与配置；公开投影随相册状态自动消失，重新发布后自动恢复。
9. 动态删除（软删除）→ 删除该动态的全部收录配置；因此失去最后一个来源的相册图片显示关系会被清理；其他来源与底层媒体保留。
10. 动态撤回（unpublish）→ 不改配置；只让它的动态来源不再贡献公开资格。重新发布自动恢复。

### 3.2 请求契约：动态管理接口新增可选 `album_links`

适用接口：

- `POST /api/v1/admin/moments`（新建草稿，201）
- `PATCH /api/v1/admin/moments/{moment_id}`（更新；沿用 `If-Match`）

请求体在既有字段之外增加（**只新增，不替换任何既有字段**）：

```ts
type MomentAlbumLink = {
  album_id: string;    // UUID
  media_ids: string[]; // 必须是「本条动态当前的图片」的子集；顺序即前端提交顺序（服务端按动态图片 position 归一）
};

type MomentAlbumLinkPatch = {
  album_links?: MomentAlbumLink[]; // 可选；不传 / 传 null 与「传空数组」语义不同，见下表
};
```

字段级约束（失败 → **422 `UNPROCESSABLE`**，`error.fields.album_links`）：

- `album_links` 里 `album_id` 不能重复；
- 每个 `media_ids` 内重复 ID 会被去重（保留首次出现顺序），不报错；单个数组最多 9 个；
- 请求体仍按各 schema 的 `extra="forbid"` 处理（未知字段 422）。

语义（不可改变，与任务书 §4.3 一致）：

| 输入或操作 | 结果 |
| --- | --- |
| 不传 `album_links`（或显式传 `null`） | 保留原收录配置；但自动清除「已不属于该动态的图片」的配置（同一请求传了 `images` 时按新图片集合判断） |
| 传 `album_links: []` | 清空该动态全部收录选择 |
| 传非空数组 | 以这次完整选择替换该动态的配置；相同三元组不重复入库；未列出的旧配置被删除 |
| 包含不属于当前动态的媒体 | **409 `CONFLICT`**（`fields.album_links`），不悄悄扩大媒体范围 |
| 包含无效 / 已删除 / 未就绪媒体 | **409 `CONFLICT`**（`fields.album_links`） |
| 包含无效 / 已删除 / 无权管理相册 | **409 `CONFLICT`**（`fields.album_links`；单站主场景下「无权管理」等价于相册已删除） |
| 目标相册已满（200 张关系上限） | **409 `CONFLICT`** |
| 版本冲突 / 缺 If-Match | 既有 **412 `VERSION_CONFLICT`** / **428 `PRECONDITION_REQUIRED`**，整单不写入 |
| CSRF / Origin 不合法 | 既有 **403** |

实现顺序（保证「无半完成」）：先完整校验 → 再同一事务内改动态、改相册显示关系、改来源 → 最后一次性 `commit`。任何一步失败都不提交（409 / 412 / 422 时数据库保持原样）。

### 3.3 响应契约：管理响应新增字段

**`MomentAdminOut`**（`GET /admin/moments`、`GET /admin/moments/{id}`、以及所有管理写接口的回执）新增：

```ts
type MomentAlbumLinkOut = {
  album_id: string;
  media_ids: string[]; // 按动态图片 position 升序
};

// MomentAdminOut 新增
album_links: MomentAlbumLinkOut[]; // 按相册 (position ASC, id ASC) 排序；草稿 / 撤回状态下也照实返回
```

- `POST /admin/moments` 的 201 回执、`PATCH` / `publish` / `unpublish` 的 200 回执都带 `album_links`；
- `DELETE /admin/moments/{id}` 仍是 204；
- 公开的 `MomentOut` / `MomentListOut` **不新增任何字段**（收录选择只属于管理端）。

**`PhotoAdminOut`**（`GET /admin/albums` 列表与 `GET /admin/albums/{id}` 的 `photos[]`、以及相册写接口回执）新增：

```ts
type PhotoSourceOut = {
  kind: "independent" | "moment";
  moment_id: string | null; // kind=moment 时给出动态 ID；independent 时 null
};

// PhotoAdminOut 新增
sources: PhotoSourceOut[]; // independent 在前，其余按 moment_id 升序；空数组表示「没有任何来源」（异常态，管理端应提示）
```

公开的 `PhotoOut` / `AlbumSummaryOut` / `AlbumDetailOut` / `PhotoItemOut` 形状**不变**，但值语义变化（见 3.5）。

### 3.4 相册管理接口的语义变化（路径 / 请求形状不变）

| 接口 | 变化 |
| --- | --- |
| `POST /admin/albums`（`photos`） | 每个照片关系同时创建**独立来源**（既有响应字段不变） |
| `PATCH /admin/albums/{id}`（传 `photos` 时完整替换） | 保留项：更新 position / alt / caption / taken_on，**来源保持原样**（不会把动态来源升级成独立来源）；新增项：创建独立来源；移除项：删除显示关系 + 该相册该图的全部来源 + 所有动态侧收录配置（相关动态 version +1） |
| `DELETE /admin/albums/{id}/photos/{media_id}` | 同上「移除项」规则；仍返回 204 |
| `POST /admin/albums/{id}/publish` | 门槛不变（至少 1 张 ready 关系）；不自动发布任何东西、不改变来源 |
| `POST /admin/albums/{id}/unpublish` | 不变；来源与配置保留 |
| `DELETE /admin/albums/{id}` | 软删除 + 删除所有动态指向该相册的收录配置（相关动态 version +1）；`album_media` 行 / 媒体 / 文件保留 |

### 3.5 公开接口与媒体权限（形状不变，语义按统一公开条件收窄）

**统一公开条件**（对「当前相册 + 当前媒体」，落在 SQL 里，只有这一处实现）：

```text
相册公开且未删除（status='published' AND deleted_at IS NULL AND published_at <= now()）
AND 媒体可用且未删除（status='ready' AND deleted_at IS NULL）
AND (
    存在独立来源
    OR 存在指向「当前相册 + 当前媒体」、且其动态当前公开未删除的来源
)
```

作用于：相册列表的 `photo_count` / `cover`、相册详情的 `photos`、照片墙（两个 scope）、照片墙 `total` / 分页 / 年份筛选、图库媒体公开权限检查（`GET /media/{id}/{variant}` 的 gallery 域贡献）、管理端「还有别处引用」提示。

- `GET /gallery/albums`、`/gallery/albums/{slug}`、`/gallery/photos`、`/gallery/photos/years`：**响应结构不变**，`Cache-Control: no-store` 不变；
- 公开端看到的 `photo_count` / `cover` / `photos` / `total` / 年份都只统计**实际可展示**的图片：纯动态来源在动态草稿/撤回时立即不可见；动态重新发布后自动恢复；
- 媒体权限：图库是最后一个公开引用时，撤回后匿名读变体立即 404；仍被公开作品/公开动态合法引用时继续可读（`media/public_refs` 的既有「各域取或」不变）。原图始终仅站主。
- **全局照片墙按 `media_id` 去重**（查询 / 分页 / `total` 一致）：
  - 主要归属 = 该媒体所有**公开且来源有效**的相册中 `(albums.position ASC, albums.id ASC)` 最前者；
  - 展示顺序 = `taken_on DESC NULLS LAST` → `media.created_at DESC` → 主要归属相册 `position ASC` → 相册内 `position ASC` → `media_id ASC`（稳定，翻页不抖）；
  - `scope=album`（进入具体相册）保留该相册自己的手工顺序与说明；单相册内 `media_id` 天然唯一，不再去重。
- 游标版本从 2 升到 3：全局墙排序语义变化，旧游标会得到明确的 400（`VALIDATION_FAILED`），不会静默错页。

### 3.6 事务、版本与幂等

**一次前端动作 = 一个后端事务**：发布、修改收录、撤回、删除、相册移除都在后端同一事务内协调（前端不得用两次独立请求拼接）。

版本矩阵（`If-Match` 语义不变；412 时不写入任何数据）：

| 操作 | 受影响动态 version | 受影响相册 version |
| --- | --- | --- |
| 动态新建 / 更新 / 发布 / 撤回 / 删除 | +1（既有行为） | **仅当**该操作实际改变了相册显示关系或来源时 +1 |
| 动态 `album_links` 实际新增 / 移除收录 | +1 | 相关相册 +1（覆盖旧相册表单） |
| 动态移除某张图片 | +1 | 清理了该相册来源的相册 +1 |
| 动态发布 / 撤回（配置不变） | +1 | 不变（公开投影随状态自动变化） |
| 相册新建 / 更新 / 发布 / 撤回 / 删除 / 移除单图 | 仅当该操作删除了动态收录配置时，相关动态 +1 | +1（既有行为） |
| 相册整组更新移除图片 | 配置被删除的动态 +1 | +1 |
| 相册删除 | 配置被删除的动态 +1 | +1 |

幂等：

- 相同 `album_links` 重复提交（在正确版本上）→ 不产生重复来源 / 重复关系 / 排序冲突（数据库唯一约束兜底）；
- 重复删除同一张相册照片 → 仍 204，不报错、不产生额外行；
- 重试已成功的写请求：版本已经前进，会得到明确的 412（这是**有意的**：要求客户端重新读取版本，而不是静默重复应用）。

### 3.7 错误语义速查

| 场景 | HTTP | `error.code` |
| --- | --- | --- |
| 请求形状错误 / `album_id` 重复 / 超长数组 | 422 | `UNPROCESSABLE` |
| media 不属于该动态 / 媒体无效 / 相册无效或已删除 / 相册满 | 409 | `CONFLICT` |
| 动态 / 相册不存在或已删除 | 404 | `NOT_FOUND` |
| 缺 `If-Match` | 428 | `PRECONDITION_REQUIRED` |
| 版本过期 | 412 | `VERSION_CONFLICT` |
| CSRF / Origin 不合法 | 403 | `FORBIDDEN` |
| 未登录 | 401 | `UNAUTHORIZED` |

错误信封形状不变（`{error:{code,message,fields}, request_id}`）。

## 4. 逐文件修改清单

### 4.1 后端实现

| 文件 | 改动 |
| --- | --- |
| `apps/api/app/modules/gallery/models.py` | 新增 `album_media_sources` 表：`id / album_id / media_id / moment_id(NULL=独立) / created_at`；三元组唯一约束；独立来源的部分唯一索引（`WHERE moment_id IS NULL`）；`(album_id, media_id)` 与 `media_id` 索引；FK：albums CASCADE / moments CASCADE / media RESTRICT。模块 docstring 补「显示关系 vs 收录来源」 |
| `apps/api/app/modules/gallery/sources.py`（**新增**） | 跨域收录来源模块：`public_source_exists`（统一公开条件的唯一实现）、`moment_public_conditions`；读取 `album_links_for_moments` / `sources_for_album_photos` / `moment_media_alts` / `album_media_ids`；写入协调 `validate_moment_album_links` / `replace_moment_album_links` / `clear_moment_album_links` / `prune_moment_album_links` / `ensure_independent_sources` / `detach_album_media` / `clear_moment_links_for_album`；孤儿显示关系清理；版本递增 `bump_album_versions` / `bump_moment_versions`；相册追加照片的位置分配 |
| `apps/api/app/modules/gallery/service.py` | `_public_photo_condition` + `_photo_join_statement` 接入统一公开条件；**全局照片墙重写**（窗口函数 `_primary_album_media_subquery` 按 media_id 去重、`_count_primary_photos` 同源 total、`wall_filter_years` 从去重后图片取年份、游标版本 3）；`public_photos_for_albums` 支持 `now`；`admin_photos_for_albums` 填充 `sources`；`create_album` / `_sync_album_photos`（create/update）写独立来源、移除项清理来源与动态配置；`remove_photo` / `soft_delete_album` 清理来源与动态配置并 bump 动态版本；`public_album_exists_for_media` / `public_media_ids` / `public_albums_for_media` 加来源条件；模块 docstring 更新 |
| `apps/api/app/modules/gallery/schemas.py` | 新增 `PhotoSourceOut`；`PhotoAdminOut.sources`；`photo_admin_payload(sources=...)` |
| `apps/api/app/modules/gallery/router.py` | 仅 docstring：记录公开条件、去重、sources 字段与相册移除语义（路径 / 形状不变） |
| `apps/api/app/modules/gallery/public_refs.py` | docstring：媒体公开引用必须满足来源有效（草稿/撤回动态来源不算） |
| `apps/api/app/modules/moments/schemas.py` | 新增 `MomentAlbumLinkIn` / `MomentAlbumLinkOut` / `MomentAlbumLinksMixin`（`album_id` 重复 → 422）；`MomentCreateIn.album_links`（默认 `[]`）与 `MomentUpdateIn.album_links`（可空）；`MomentAdminOut.album_links`；`moment_admin_out` 组装 |
| `apps/api/app/modules/moments/service.py` | 新增 `_album_link_mappings` / `_prospective_image_alts` / `album_links_for_moments`；`create_moment` 先校验后写入收录；`update_moment` 支持「不传 / [] / 完整替换」三态 + 换图清理 + 版本传播；`soft_delete_moment` 清理收录配置与孤儿显示关系并 bump 相册版本；候选图片 alt 映射 |
| `apps/api/app/modules/moments/router.py` | 创建时透传 `album_links`；管理回执组装 `album_links`；docstring 更新 |

### 4.2 迁移

| 文件 | 改动 |
| --- | --- |
| `apps/api/migrations/versions/20261017_1041_b7c3e9a1d2f4_n3_album_media_sources.py`（**新增**） | `upgrade`：建表 + 3 索引 + **把迁移前所有 `album_media` 行回填为独立来源**（`NOT EXISTS` 幂等）；`downgrade`：先删除「没有任何独立来源」的显示关系（避免旧 schema 把撤回来源当独立来源公开），再删表。单一 head：`528a38f23614 → b7c3e9a1d2f4` |

### 4.3 契约产物

| 文件 | 改动 |
| --- | --- |
| `contracts/openapi.json` | 由 `apps/api/scripts/export_openapi.py` 重新生成（**非手改**）：+118 / -2 行，只含本次新增的 `MomentAlbumLinkIn/Out`、`MomentAdminOut.album_links`、`PhotoSourceOut`、`PhotoAdminOut.sources`、`MomentCreateIn/UpdateIn.album_links`，无其他模块漂移 |

### 4.4 测试与验收

| 文件 | 改动 |
| --- | --- |
| `apps/api/tests/support/t06_shared.py` | `attach_photos` 默认同时插入独立来源（对应「相册管理端加入 / 迁移回填」）；保留 `independent=False` 供「无来源关系」场景 |
| `apps/api/tests/test_module_registration.py` | 冻结表清单加入 `album_media_sources` |
| `apps/api/tests/gallery/test_models.py` | +3 个来源表约束用例（独立来源唯一、三元组唯一、媒体 RESTRICT、删除级联） |
| `apps/api/tests/gallery/test_moment_album_links.py`（**新增，19 例**） | 跨域生命周期：草稿/公开组合、§8.2 两条核心、不传/[]/完整替换、重发恢复、多动态来源、相册侧单图与整组移除、相册删除、非法媒体/相册、412、422、幂等、相册撤回重发、保存相册表单不升级来源 |
| `apps/api/tests/gallery/test_wall_sources.py`（**新增，7 例**） | 全局墙去重 / 分页 total 一致 / 主要归属跳过无来源相册 / 相册撤回后归属回退 / kind 筛选归属 / 年份来自可展示图片 / 图库媒体权限 |
| `apps/api/tests/gallery/test_migration_sources.py`（**新增，1 例**） | 独立临时库：升级到 N3 前 → 造历史数据 → 升级 head 断言回填 → 制造纯动态来源 → 降级断言安全清理 → 再升级断言幂等与限制 |
| `tools/acceptance/verify-album-moment-retract.py` | docstring 补第二段；既有第一段断言**原样保留**；新增「仅动态同步来源：撤回→隐藏/媒体 404→重发恢复→相册侧移除→重发不加回」一整套断言（共 33 项） |
| `docs/agent-deliveries/N3-result.md` | 本报告 |

### 4.5 明确未改

- `apps/api/app/modules/media/**`：未改。媒体权限收窄通过 gallery 的公开引用检查（`gallery/public_refs.py` → `service.public_album_exists_for_media`）实现；`media/public_refs` 的「各域取或」与默认拒绝语义不变。
- `apps/web/**`、依赖 / 锁文件、其他模块业务、第二轮 dirty 文件、Git 历史。

## 5. 与其他 agent 的依赖和共享文件集成

1. **契约先冻结**：实施前先写本报告 §3 并消息通知 Lead + N4（`MomentAdminOut.album_links`、`PhotoAdminOut.sources`、错误码、三态语义、版本矩阵、公开条件）。实施过程中未变更已冻结语义。
2. **openapi 契约**：`contracts/openapi.json` 用官方脚本重新生成；`test_openapi_contract.py` 通过。前端类型生成 `npm run gen:api` 由 N4 / Lead 执行，本任务**没有**手改前端生成文件。
3. **N4（前端）**：按 §3 接线 `/gallery`、INS 收录选择、错误展示、草稿保留与旧深链；公开字段形状不变，新增字段只在管理 DTO 上。
4. **媒体权限**：与既有「媒体公开引用注册表」集成 —— gallery 与 moments 两个检查器各自成立即公开；本轮只收窄 gallery 域的条件（来源有效），没有改注册机制。
5. **共享测试夹具**：只更新 `tests/support/t06_shared.py`（相册测试辅助）与 `test_module_registration.py` 表清单；未改 `tests/core/t01_db.py` 固定库名（N0/N7 决定）。
6. **并行改动**：同一工作区还有 N1/N2/N4/N5/N6 与另一个独立会话（第二轮验收）在写前端 / 素材 / 文档；本任务只写上述后端与测试文件，未触碰他人文件。`tools/acceptance/` 下 `verify-ins-media-loop.py`、`p0-contact-sheets.py` 的改动来自其他 agent，非本任务。
7. **外部会话并发**：任务期间另一个独立会话对同一仓库跑第二轮验收与全量 pytest，造成固定库名 `pl_test_t01` 竞态（见 §7.2 / §8.1）；本任务未做 Git 操作，未覆盖他人改动。

## 6. 素材

本任务不涉及素材（N6 负责）。验收脚本只在临时媒体目录里现场生成测试 PNG，不引用游戏素材。

## 7. 测试命令和实际结果

所有后端测试使用真实 PostgreSQL；`TEST_DATABASE_URL=postgresql+psycopg://pl@127.0.0.1:55432/pl_test_n3`，
`UV_CACHE_DIR=/Users/学习/blog/.dsh/uv-cache`，执行目录 `apps/api`。**没有任何 skip。**

### 7.1 定向套件（受影响范围）

```bash
cd /Users/学习/blog/Blogs/apps/api
TEST_DATABASE_URL=postgresql+psycopg://pl@127.0.0.1:55432/pl_test_n3 \
UV_CACHE_DIR=/Users/学习/blog/.dsh/uv-cache \
uv run pytest tests/gallery tests/moments tests/media tests/test_migration_sync.py tests/test_openapi_contract.py
```

结果：**200 passed，0 failed，0 skipped，1 warning，exit 0，34.65s**。
测试文件分布：`tests/gallery` 96 例（含新增 19+7+3 例）、`tests/moments` 65 例、
`tests/media` 33 例、迁移同步 2 例、openapi 契约 4 例；1 warning 是第三方
`StarletteDeprecationWarning`，与本次改动无关（项目 `filterwarnings` 只对 `app.*` 生效）。

### 7.2 全量后端回归

```bash
cd /Users/学习/blog/Blogs/apps/api
TEST_DATABASE_URL=postgresql+psycopg://pl@127.0.0.1:55432/pl_test_n3 \
UV_CACHE_DIR=/Users/学习/blog/.dsh/uv-cache \
uv run pytest
```

结果：**942 passed，0 failed，0 skipped，1 warning，exit 0，109.48s（0:01:49）**
（`942 tests collected`；接受时 N0 基线为 911 passed，之后并行轮次的提交与本次新增测试
文件（4 个文件共 30 例）共同构成当前收集数）。

环境说明（重要）：任务期间同一仓库有一个**独立的第二轮（P0–P3）验收会话**在并发跑全量
pytest（`TEST_DATABASE_URL=…/pl_test`）并建库/落库。`apps/api/tests/core/t01_db.py` 使用固定
库名 `pl_test_t01` / `pl_test_t01_empty`（非 per-PID），两个 pytest 进程同时跑时后结束的进程
会 drop 掉前一个进程正在用的库，表现为 auth 套件 24 个 `ERROR … database "pl_test_t01" does
not exist`（**环境竞态，不是代码失败**）。该竞态出现过两次（10:46 / 10:50 左右，均记录了
`pgrep` 里外部 `uv run --project apps/api pytest apps/api/tests` 进程）。在确认外部进程结束后的
**独占窗口**（10:54:34 起）复跑：定向 200 passed、全量 942 passed，均 exit 0，无失败无 skip ——
即全量数字已在干净环境下取得。本任务未改该共享夹具；外部会话竞态也会写入 N7 报告环境说明。

### 7.3 迁移证据（隔离库）

**自动化**：`apps/api/tests/gallery/test_migration_sources.py`（独立临时库
`pl_test_n3_mig_<pid>`，用后即 drop）覆盖：升级到 `528a38f23614` 造历史数据 → 升级
`b7c3e9a1d2f4` 断言历史图片全部回填独立来源 → 制造纯动态来源 → 降级断言该显示关系被删除且
独立数据保留、来源表消失 → 再升级断言回填幂等、动态配置不复活（已记录为降级限制）。

**手工证据**（独立 scratch 库 `pl_test_n3_evidence`，用后 drop，不碰共享库）：

```text
迁移版本：528a38f23614 → b7c3e9a1d2f4（单一 head）
升级前：albums=2, album_media=4, album_media_sources 表不存在
升级后：alembic_version=b7c3e9a1d2f4, albums=2, album_media=4,
        album_media_sources=4（全部 moment_id IS NULL = 独立来源）, 缺来源的相册关系=0
关联抽查：evidence-album-a album_media=2 sources=2；evidence-album-b album_media=2 sources=2
降级前：album_media=5 / sources=5（含 1 条「已撤回动态来源」）
降级后：alembic_version=528a38f23614, 来源表不存在, album_media=4,
        album-a 关系=2（纯动态来源的那条被安全删除）, album-b 关系=2（历史独立数据保留）
再升级：album_media=4, sources_total=4（全部独立）, 动态来源=0（降级丢弃配置，未复活）
```

`pl_test_n3` 当前状态：`alembic_version=b7c3e9a1d2f4`，36 张基础表（35 张业务表 +
`alembic_version`），`album_media_sources` 存在。验证命令（日志已去除凭据）：

```bash
uv run alembic -x db_url=postgresql+psycopg://pl@127.0.0.1:55432/pl_test_n3 upgrade head
uv run alembic heads   # b7c3e9a1d2f4 (head)
```

### 7.4 §8.2 生命周期矩阵覆盖

| 任务书 §8.2 用例 | 覆盖 | 自动化用例 |
| --- | --- | --- |
| 历史相册图片迁移 | 升级后保留图片/排序/说明/公开范围，成为独立来源 | `test_migration_sources.py` + §7.3 手工抽查 |
| 草稿动态＋公开相册，仅动态来源 | 不公开；管理端可看配置 | `test_draft_moment_with_published_album_is_not_public_but_config_visible` |
| 公开动态＋草稿相册 | 图库不公开；不自动发布相册；公开动态仍是合法媒体引用 | `test_published_moment_with_draft_album_does_not_publish_album` |
| 动态与相册都公开 | 图片出现；重复提交无重复关系 | `test_both_public_shows_photo_and_repeat_submission_is_idempotent` |
| 多相册同图 | 全局墙仅一张，主要归属稳定；相册各有自己的排序和说明 | `test_wall_sources.py`（去重 / 分页 / 主要归属 / kind） |
| 不传 `album_links` | 原选择保留；动态换图时失效来源仍被清理 | `test_omitting_album_links_keeps_config_but_prunes_removed_images` |
| 传空数组 | 此动态带来的全部收录选择清除，其他来源不受影响 | `test_empty_album_links_clears_only_this_moment` |
| 唯一动态来源撤回 / 删除 | 图库停止展示，不删除媒体；最后公开引用失效时媒体权限撤销 | `test_retract_last_dynamic_source_hides_photo_and_revokes_media` |
| 还有独立或其他公开动态来源 | 同一相册中的图片仍可展示 | `test_independent_source_keeps_photo_visible_after_dynamic_retract` + `test_multiple_dynamic_sources_survive_until_all_are_retracted` |
| 重新发布 | 只恢复仍保留的配置；明确移除的图片不复活 | `test_republish_restores_only_preserved_configuration` |
| 相册侧单图删除或整组更新移除 | 同步清理对应动态收录配置；重发不加回 | `test_album_single_photo_removal_clears_dynamic_links_and_blocks_readd` + `test_album_whole_photo_list_update_removal_clears_dynamic_links` + 验收脚本 |
| 相册撤回后重发 | 公共投影随相册状态变化，媒体和配置保持正确 | `test_album_unpublish_then_republish_keeps_sources_and_projection` |
| 非法媒体 / 相册、旧版本并发、事务失败 | 清楚报错，无半发布、半收录或覆盖他人更新 | `test_album_links_rejects_media_not_in_moment_atomically` / `_unknown_or_deleted_album` / `_unusable_media_and_stale_version` / `test_duplicate_album_in_album_links_is_422` / `test_repeat_same_patch_is_idempotent_on_sources` |
| 前端去新建相册再返回 | 动态草稿及已选图片保留，不自动发布 | **前端行为**，N4 负责（后端草稿配置保留，见 §8.2 第 2 行） |
| 旧页面和手机照片深链 | 进入生活图库、参数有效、不触发殿堂过场 | **前端路由**，N4 / N7 负责 |

额外断言：保存相册表单**不会**把动态来源升级成独立来源
（`test_resaving_album_form_does_not_upgrade_dynamic_source_to_independent`）——这是
「纯动态来源撤回后隐藏」不被无关操作破坏的关键。

### 7.5 验收脚本（扩展后实测）

```bash
cd /Users/学习/blog/Blogs/apps/api
uv run python ../../tools/acceptance/verify-album-moment-retract.py
```

结果：**exit 0；33 项断言全部 ✓，0 ✗**（脚本自建临时库 `pl_row6` + 媒体目录 + 端口 8131，
结束即 drop/删除，只操作自己的隔离资源）。第一段（原有用例）输出：

```text
✓ 只撤回动态 → 派生变体仍公开可读（相册还在引用）
✓ 仍公开的相册图片可见（照片墙仍含它）
✓ 相册详情仍含它；✓ 原图始终仅管理用途（匿名 404）
```

第二段（本轮新增）输出：

```text
✓ 动态写入 album_links；✓ 动态收录把图片带进相册（来源=moment）
✓ 相册发布（图片来自动态收录）；✓ 动态发布
✓ 仅动态来源的图片进入照片墙且只出现一次；✓ 公开相册详情含它；✓ 媒体变体匿名可读
✓ 动态撤回；✓ 公开相册详情不再包含仅动态来源的图片；✓ 照片墙不再包含它
✓ 最后公开引用失效 → 媒体变体匿名 404；✓ 撤回保留收录配置供重发恢复
✓ 动态重新发布；✓ 重新发布后图片恢复展示；✓ 媒体变体恢复匿名可读
✓ 相册侧移除该图；✓ 动态收录配置被同步清理；✓ 撤回→重发不得把相册侧移除的图加回
总判定: 全部通过
```

结论：既有脚本「撤回动态但独立相册引用仍可见」的断言**仍然有意义且通过**；新增的
「仅动态同步来源」场景证明两类来源行为不同（不是按 media_id 一刀切隐藏）。

### 7.6 其他检查

| 检查 | 结果 |
| --- | --- |
| `tests/test_openapi_contract.py`（契约漂移） | 4 passed（`contracts/openapi.json` 已重新生成） |
| `tests/test_migration_sync.py`（模型 ↔ 迁移一致 + 单一 head） | 2 passed |
| `uv run alembic heads` | 单一 head `b7c3e9a1d2f4` |
| 旧 T06 / T03 / T01 相关用例回归 | 定向套件内全部通过（无 skip） |

## 8. 未完成项、已知限制、恢复 / 回退说明

### 8.1 环境限制（非功能缺口）

- **共享固定测试库名竞态**：`tests/core/t01_db.py` 的 `pl_test_t01` / `pl_test_t01_empty` 是
  固定名，多个 pytest 进程（本任务 + 独立第二轮验收会话）并发时互相 drop，会造成 auth 套件
  `database "pl_test_t01" does not exist` 的 setup ERROR。本任务定向套件与分块回归通过；
  全量单进程数字见 §7.2 的环境说明，N7 会在独占窗口复跑并把竞态写进 N7 报告。**未改该共享
  夹具**（按 Lead 裁决）。
- 任务期间外部会话在并发 commit / amend Git 历史；本任务**没有做任何 Git 操作**，也没有
  覆盖他人文件；工作区改动以最终 `git status` 为准。
- 浏览器 / 真机 / 视觉证据不属于后端任务：由 N4（图库 UI、INS 收录选择、旧深链）与 N7
  （集成回归、截图、迁移复验）提供。

### 8.2 已知限制（有意设计或明确取舍）

1. **降级会丢失动态收录配置**（任务书 §4.7 允许并在此说明）：`b7c3e9a1d2f4` 的 `downgrade`
   会删除来源表；为保证旧 schema 不会把撤回来源误当独立来源公开，它会先删除**没有独立来源**
   的相册显示关系。因此：降级前必须备份（`pg_dump -Fc`），降级后需重新保存动态收录选择才能
   恢复动态收录；动态收录配置不可从旧 schema 无损恢复。**不会**把所有撤回来源转成独立来源
   来「保数据」。
2. **「无权管理相册」在单站主模型里等价于「相册不存在或已删除」**：本站只有单一站主，
   没有按相册的细粒度权限；因此该错误分支以 409 + `fields.album_links` 明确失败。
3. **相册管理端「完整替换 photos」会整组重写显示关系行**（`album_media`），但来源表不依赖
   显示关系行，因此重写不会丢来源；保留项的 position/alt/caption/taken_on 会被更新，来源保持原样。
4. **相册发布门槛不变**：至少 1 张 ready 的显示关系即可发布；若该相册的图全部来自尚未公开的
   动态来源，公开页会出现「0 张照片的已发布相册」（如实空态，不放假数据；动态公开后自动出现）。
5. **并发控制沿用项目既有乐观锁**（`If-Match` 版本号），没有引入数据库行锁 / 可串行化隔离：
   与本项目其他模块一致；跨实体版本传播保证「旧表单 412 而不是静默覆盖」。
6. **幂等的边界**：相同写请求重试时，若版本已前进会得到 412（显式失败而不是静默重复应用）；
   「相同配置重复提交不产生重复行」由唯一约束 + 差集写入保证。
7. **前端缓存失效**由 N4 负责；服务端所有公开 / 媒体响应均已是 `no-store`，不存在需要额外
   清理的服务端内容缓存。
8. **回退（代码）**：本任务改动集中在 §4 列出的文件。回退方式：
   `git checkout -- <apps/api 下文件>` + 删除新增文件（`sources.py`、迁移、3 个测试文件），
   并把 `contracts/openapi.json` 用 `export_openapi.py` 重新生成回退版本；迁移回退用
   `uv run alembic -x db_url=<隔离测试库> downgrade 528a38f23614`（生产回退前必须备份，限制见上）。
9. **未做**：真实 Instagram 收录、AI、Docker / 部署、其他模块业务 —— 任务书明确排除。

### 8.3 结论

N3 的后端交付物（来源模型、`album_links` 契约、事务与版本协调、统一公开条件、全局墙去重、
迁移与回填、§8.2 生命周期测试、验收脚本扩展）**已完成并通过针对性验证**；前端接线与
浏览器 / 真机 / 最终全量复跑由 N4 / N7 在其验收范围内完成。
