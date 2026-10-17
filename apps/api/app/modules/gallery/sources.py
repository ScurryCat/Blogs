"""跨域收录来源：`album_media_sources` 的公开条件、读写协调与版本影响。

为什么单独一个模块：来源同时被两个域写 —— 相册管理（独立收录）与动态管理（动态收录），
而读取侧（公开图库、媒体权限）只需要一份**统一公开条件**。把「写入协调 + 版本影响 +
公开条件」放在非 service 模块里，可以避免 `gallery.service` 与 `moments.service`
互相 import 形成环。

核心语义（第三轮任务书 §4.4–§4.7）：

  - `album_media` = 显示关系（排序 / alt / caption / taken_on），由相册管理维护；
  - `album_media_sources` = 收录来源：
      * `moment_id IS NULL` → 独立相册收录（相册管理端显式加入的图片 / 迁移回填）；
      * `moment_id` 非空 → 动态收录（同一「动态 + 相册 + 媒体」唯一）；
  - **配置存在 ≠ 公开资格**：动态来源只在动态当前公开（published / 未删除 / 已到发布时间）
    时才贡献公开资格；草稿 / 撤回状态下配置保留（供重发恢复）；
  - 同一「相册 + 媒体」可同时有独立来源和多条动态来源；
  - 相册侧移除图片会同时删除该图的**全部来源与所有动态收录配置**（重发不会加回）。

版本协调（任务书 §4.7「避免旧相册表单覆盖新收录，或相册移除后被旧动态表单无提示地加回」）：
本模块只负责「哪些实体被实际改变」，版本递增由调用方在同一事务内用
`bump_album_versions` / `bump_moment_versions` 完成 —— 这样「没有实际变化」的重复请求
不会把别的表单变成 412。
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Iterable, Mapping, Sequence

from sqlalchemy import and_, delete, exists, insert, literal, or_, select, tuple_
from sqlalchemy.orm import Session

from app.core.db import utcnow
from app.core.errors import CODE_CONFLICT, ApiError
from app.modules.gallery.models import (
    MAX_MEDIA_PER_ALBUM,
    Album,
    album_media,
    album_media_sources,
)
from app.modules.media.models import STATUS_READY, Media
from app.modules.moments.models import STATUS_PUBLISHED, Moment, moment_media

SOURCE_KIND_INDEPENDENT = "independent"
SOURCE_KIND_MOMENT = "moment"

# 一条动态最多 9 张图（与 moments.models.IMAGES_MAX 一致）：album_links 里单个
# media_ids 数组超过它一定是无效输入，由 schema 层先拦。
MAX_LINKS_PER_ALBUM = 9


def conflict(message: str, fields: dict | None = None) -> ApiError:
    """业务冲突（409）：非法相册 / 媒体 / 相册容量 / 不属于当前动态。"""
    return ApiError(CODE_CONFLICT, message, status_code=409, fields=fields)


# --- 统一公开条件 -----------------------------------------------------------


def moment_public_conditions(now: datetime | None = None) -> list:
    """动态「当前公开」的 SQL 条件（与 `moments.service.public_conditions` 一致）。"""
    moment_now = now or utcnow()
    return [
        Moment.status == STATUS_PUBLISHED,
        Moment.deleted_at.is_(None),
        Moment.published_at.is_not(None),
        Moment.published_at <= moment_now,
    ]


def public_source_exists(
    *,
    now: datetime | None = None,
    album_id=None,
    media_id=None,
):
    """「当前相册 + 当前媒体」存在有效公开来源 的 SQL 条件（EXISTS 子查询）。

    `album_id` / `media_id` 传外层查询的列（相关子查询）或具体值都可以。
    条件（任务书 §4.6）：

        存在独立来源
        OR 存在指向当前相册 + 媒体、且其动态当前公开未删除的来源

    这是图库公开投影的**唯一**实现：相册列表 / 详情 / 封面 / 数量、照片墙、分页、
    年份筛选、媒体权限检查都从这里拼条件，不各写一份。
    """
    source = album_media_sources
    conditions = [
        or_(
            source.c.moment_id.is_(None),
            and_(*moment_public_conditions(now)),
        )
    ]
    if album_id is not None:
        conditions.append(source.c.album_id == album_id)
    if media_id is not None:
        conditions.append(source.c.media_id == media_id)
    subquery = (
        select(literal(1))
        .select_from(source)
        .outerjoin(Moment, Moment.id == source.c.moment_id)
        .where(*conditions)
    )
    return exists(subquery)


def source_condition_for(album_id, media_id):
    """公开来源条件（不带动态时间参数，供同一条 SQL 内复用）。"""
    return public_source_exists(album_id=album_id, media_id=media_id)


# --- 版本协调 -------------------------------------------------------------


def bump_album_versions(session: Session, album_ids: Iterable[uuid.UUID]) -> None:
    """把实际受影响的相册版本 +1（同一事务内由调用方提交）。"""
    ids = list(dict.fromkeys(album_ids))
    if not ids:
        return
    albums = session.execute(select(Album).where(Album.id.in_(ids))).scalars().all()
    for album in albums:
        album.bump_version()
    session.flush()


def bump_moment_versions(session: Session, moment_ids: Iterable[uuid.UUID]) -> None:
    """把实际受影响的动态版本 +1（相册侧移除 / 删除动态收录配置时使用）。"""
    ids = list(dict.fromkeys(moment_ids))
    if not ids:
        return
    moments = session.execute(select(Moment).where(Moment.id.in_(ids))).scalars().all()
    for moment in moments:
        moment.bump_version()
    session.flush()


# --- 读取辅助 -------------------------------------------------------------


def album_media_ids(session: Session, album_id: uuid.UUID) -> set[uuid.UUID]:
    return set(
        session.execute(
            select(album_media.c.media_id).where(album_media.c.album_id == album_id)
        ).scalars()
    )


def album_media_positions(session: Session, album_id: uuid.UUID) -> set[int]:
    return set(
        session.execute(
            select(album_media.c.position).where(album_media.c.album_id == album_id)
        ).scalars()
    )


def next_album_media_position(session: Session, album_id: uuid.UUID) -> int:
    """给相册追加一张图时的位置：优先接在最后，越界则用最小的空位。

    相册上限 200 张（position 0–199）。动态收录往相册里加图时不能和相册自己的
    `position` 撞车，也不能把已有照片的顺序打乱（说明 / 排序归相册所有）。
    """
    used = album_media_positions(session, album_id)
    if len(used) >= MAX_MEDIA_PER_ALBUM:
        raise conflict("相册照片已达上限", {"album_links": ["相册最多 200 张照片"]})
    candidate = max(used) + 1 if used else 0
    if candidate > MAX_MEDIA_PER_ALBUM - 1:
        candidate = next(
            position for position in range(MAX_MEDIA_PER_ALBUM) if position not in used
        )
    return candidate


def moment_media_alts(session: Session, moment_id: uuid.UUID) -> dict[uuid.UUID, str]:
    """动态当前图片 → alt（动态收录进相册时用动态里的 alt 作为相册 alt）。"""
    rows = session.execute(
        select(moment_media.c.media_id, moment_media.c.alt).where(
            moment_media.c.moment_id == moment_id
        )
    ).all()
    return {media_id: str(alt) for media_id, alt in rows}


def album_links_for_moments(
    session: Session, moment_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[dict]]:
    """管理回执用：`{moment_id: [{album_id, media_ids[]}]}`。

    - 只返回仍存在（未软删除）的相册；
    - 相册按 `(position ASC, id ASC)`；相册内 `media_ids` 按动态图片 position 升序；
    - 草稿 / 撤回状态的动态照样返回（管理端要能看见并继续编辑配置）。
    """
    wanted = list(dict.fromkeys(moment_ids))
    if not wanted:
        return {}
    rows = session.execute(
        select(
            album_media_sources.c.moment_id,
            album_media_sources.c.album_id,
            album_media_sources.c.media_id,
        )
        .join(Album, Album.id == album_media_sources.c.album_id)
        .join(
            moment_media,
            and_(
                moment_media.c.moment_id == album_media_sources.c.moment_id,
                moment_media.c.media_id == album_media_sources.c.media_id,
            ),
        )
        .where(
            album_media_sources.c.moment_id.in_(wanted),
            Album.deleted_at.is_(None),
        )
        .order_by(
            album_media_sources.c.moment_id.asc(),
            Album.position.asc(),
            Album.id.asc(),
            moment_media.c.position.asc(),
        )
    ).all()
    grouped: dict[uuid.UUID, list[dict]] = {}
    for moment_id, album_id, media_id in rows:
        entries = grouped.setdefault(moment_id, [])
        if not entries or entries[-1]["album_id"] != album_id:
            entries.append({"album_id": album_id, "media_ids": []})
        entries[-1]["media_ids"].append(media_id)
    return grouped


def sources_for_album_photos(
    session: Session, album_ids: Sequence[uuid.UUID]
) -> dict[tuple[uuid.UUID, uuid.UUID], list[tuple[str, uuid.UUID | None]]]:
    """管理回执用：`{(album_id, media_id): [("independent"|"moment", moment_id|None)]}`。

    排序：独立来源在前，其余按 moment_id 升序（稳定、可断言）。
    """
    wanted = list(dict.fromkeys(album_ids))
    if not wanted:
        return {}
    rows = session.execute(
        select(
            album_media_sources.c.album_id,
            album_media_sources.c.media_id,
            album_media_sources.c.moment_id,
        )
        .where(album_media_sources.c.album_id.in_(wanted))
        .order_by(
            album_media_sources.c.album_id.asc(),
            album_media_sources.c.media_id.asc(),
            album_media_sources.c.moment_id.asc().nullsfirst(),
        )
    ).all()
    grouped: dict[tuple[uuid.UUID, uuid.UUID], list[tuple[str, uuid.UUID | None]]] = {}
    for album_id, media_id, moment_id in rows:
        kind = SOURCE_KIND_INDEPENDENT if moment_id is None else SOURCE_KIND_MOMENT
        grouped.setdefault((album_id, media_id), []).append((kind, moment_id))
    return grouped


# --- 写入：相册侧（独立收录）------------------------------------------------


def ensure_independent_sources(
    session: Session, *, album_id: uuid.UUID, media_ids: Sequence[uuid.UUID]
) -> set[uuid.UUID]:
    """为「相册管理端新加入的图片」补独立来源；已存在的独立来源不动。

    返回实际新增的相册 id 集合（调用方据此决定是否 bump 版本 —— 幂等调用不会重复加）。
    """
    wanted = list(dict.fromkeys(media_ids))
    if not wanted:
        return set()
    existing = set(
        session.execute(
            select(album_media_sources.c.media_id).where(
                album_media_sources.c.album_id == album_id,
                album_media_sources.c.media_id.in_(wanted),
                album_media_sources.c.moment_id.is_(None),
            )
        ).scalars()
    )
    missing = [media_id for media_id in wanted if media_id not in existing]
    if not missing:
        return set()
    session.execute(
        insert(album_media_sources),
        [
            {"album_id": album_id, "media_id": media_id, "moment_id": None}
            for media_id in missing
        ],
    )
    session.flush()
    return {album_id}


def _delete_orphan_album_media(
    session: Session, pairs: Sequence[tuple[uuid.UUID, uuid.UUID]]
) -> set[uuid.UUID]:
    """删除「没有任何来源」的相册显示关系，返回实际受影响的相册 id。

    什么时候会出现孤儿：动态来源被移除（动态换图 / 撤回配置 / 删除动态）或相册侧移除
    图片之后，某「相册 + 媒体」已没有任何独立来源和动态来源 —— 这时显示关系本身也
    应当消失，否则相册管理里会留下一条永远不公开、也无法解释的幽灵照片。
    """
    if not pairs:
        return set()
    unique_pairs = list(dict.fromkeys(pairs))
    remaining = set(
        session.execute(
            select(album_media_sources.c.album_id, album_media_sources.c.media_id).where(
                tuple_(
                    album_media_sources.c.album_id, album_media_sources.c.media_id
                ).in_(unique_pairs)
            )
        ).all()
    )
    orphans = [pair for pair in unique_pairs if pair not in remaining]
    if not orphans:
        return set()
    session.execute(
        delete(album_media).where(
            tuple_(album_media.c.album_id, album_media.c.media_id).in_(orphans)
        )
    )
    session.flush()
    return {album_id for album_id, _media_id in orphans}


def detach_album_media(
    session: Session, *, album_id: uuid.UUID, media_ids: Sequence[uuid.UUID]
) -> set[uuid.UUID]:
    """相册侧移除图片：删显示关系 + 该「相册 + 媒体」的全部来源 + 所有动态收录配置。

    返回**配置被删除的动态 id 集合**（调用方在同一事务内 bump 这些动态的版本，
    这样旧动态表单再做保存会得到 412，而不是无提示地把图片加回来）。

    「后续重发不能自动加回」由这里保证：动态侧的收录配置与来源被一起删除，
    重新发布只恢复仍保留的配置（任务书 §4.5 / §8.2）。
    """
    wanted = list(dict.fromkeys(media_ids))
    if not wanted:
        return set()
    pairs = [(album_id, media_id) for media_id in wanted]
    affected_moments = set(
        session.execute(
            select(album_media_sources.c.moment_id).where(
                album_media_sources.c.album_id == album_id,
                album_media_sources.c.media_id.in_(wanted),
                album_media_sources.c.moment_id.is_not(None),
            )
        ).scalars()
    )
    session.execute(
        delete(album_media_sources).where(
            album_media_sources.c.album_id == album_id,
            album_media_sources.c.media_id.in_(wanted),
        )
    )
    session.execute(
        delete(album_media).where(
            tuple_(album_media.c.album_id, album_media.c.media_id).in_(pairs)
        )
    )
    session.flush()
    return affected_moments


# --- 写入：动态侧（动态收录）------------------------------------------------


def normalize_album_links(
    links: Sequence[Mapping],
) -> list[tuple[uuid.UUID, list[uuid.UUID]]]:
    """把 schema 校验后的 album_links 归一成 `[(album_id, [media_id…])]`（去重保序）。

    `media_ids` 内的重复 ID 会被静默去重（同一个三元组本来就不能重复入库），
    `album_id` 重复由 schema 层拒绝（同一相册出现两次语义不明确）。
    """
    normalized: list[tuple[uuid.UUID, list[uuid.UUID]]] = []
    for link in links:
        album_id = link["album_id"]
        raw_media_ids = link.get("media_ids") or []
        media_ids: list[uuid.UUID] = []
        for media_id in raw_media_ids:
            if media_id not in media_ids:
                media_ids.append(media_id)
        normalized.append((album_id, media_ids))
    return normalized


def _validate_album_links_targets(
    session: Session,
    *,
    normalized: Sequence[tuple[uuid.UUID, list[uuid.UUID]]],
    image_alts: Mapping[uuid.UUID, str],
) -> None:
    """完整校验（在任何写入之前）：相册存在未删、媒体属于当前动态且可用。"""
    album_ids = list(dict.fromkeys(album_id for album_id, _media_ids in normalized))
    if album_ids:
        found_albums = {
            album.id: album
            for album in session.execute(
                select(Album).where(Album.id.in_(album_ids))
            ).scalars()
        }
    else:
        found_albums = {}
    problems: list[str] = []
    for album_id in album_ids:
        album = found_albums.get(album_id)
        if album is None or album.deleted_at is not None:
            problems.append(f"相册 {album_id} 不存在或已删除")
    linked_media_ids = list(
        dict.fromkeys(
            media_id for _album_id, media_ids in normalized for media_id in media_ids
        )
    )
    for media_id in linked_media_ids:
        if media_id not in image_alts:
            problems.append(f"图片 {media_id} 不属于当前动态")
    if problems:
        raise conflict("收录目标不合法", {"album_links": problems})

    # 媒体必须仍然可用（ready + 未删除）：移动端管理页可能开着很久，
    # 期间媒体可能已被撤回 —— 不允许写进一个永远不能展示的来源。
    if linked_media_ids:
        usable = set(
            session.execute(
                select(Media.id).where(
                    Media.id.in_(linked_media_ids),
                    Media.deleted_at.is_(None),
                    Media.status == STATUS_READY,
                )
            ).scalars()
        )
        unusable = [str(media_id) for media_id in linked_media_ids if media_id not in usable]
        if unusable:
            raise conflict(
                "收录的图片不可用（不存在、已删除或未就绪）",
                {"album_links": unusable},
            )


def _ensure_album_media_rows(
    session: Session,
    *,
    album_id: uuid.UUID,
    media_alts: Mapping[uuid.UUID, str],
) -> bool:
    """确保「相册 + 媒体」有显示关系（没有就追加到相册末尾）。

    已存在的显示关系**不动**：相册的 position / caption / taken_on 归相册管理所有，
    不因为其他动态收录同图而被覆盖（任务书 §4.4 末段）。返回是否有新增行。
    """
    existing = album_media_ids(session, album_id)
    added = False
    for media_id, alt in media_alts.items():
        if media_id in existing:
            continue
        position = next_album_media_position(session, album_id)
        session.execute(
            insert(album_media).values(
                album_id=album_id,
                media_id=media_id,
                position=position,
                alt=(str(alt).strip() or "图片")[:200],
                caption="",
                taken_on=None,
            )
        )
        session.flush()
        existing.add(media_id)
        added = True
    return added


def validate_moment_album_links(
    session: Session,
    *,
    links: Sequence[Mapping],
    image_alts: Mapping[uuid.UUID, str],
) -> list[tuple[uuid.UUID, list[uuid.UUID]]]:
    """归一 + **完整校验**（在任何写入之前调用）。非法 → 409。

    返回归一后的 `[(album_id, [media_id…])]`，供同一事务内后续的
    `replace_moment_album_links` 使用。把校验与写入分成两步，是为了让
    「动态文字 / 图片已改、收录失败」这种请求能在**改动任何持久化状态之前**失败。
    """
    normalized = normalize_album_links(links)
    _validate_album_links_targets(session, normalized=normalized, image_alts=image_alts)
    return normalized


def replace_moment_album_links(
    session: Session,
    *,
    moment: Moment,
    normalized_links: Sequence[tuple[uuid.UUID, list[uuid.UUID]]],
    image_alts: Mapping[uuid.UUID, str],
) -> set[uuid.UUID]:
    """以这次提交的完整选择替换动态的收录配置（任务书 §4.3）。

    调用前必须已用 `validate_moment_album_links` 校验过；这里仍按差集实现：
    - 幂等：相同配置重复提交不产生重复行；
    - 新增来源时补齐相册显示关系；删除来源后清理失去最后一个来源的显示关系；
    - 返回**实际受影响的相册 id 集合**，由调用方在同一事务内 bump 版本。
    """
    desired: set[tuple[uuid.UUID, uuid.UUID]] = set()
    for album_id, media_ids in normalized_links:
        for media_id in media_ids:
            desired.add((album_id, media_id))

    existing = {
        (album_id, media_id)
        for album_id, media_id in session.execute(
            select(
                album_media_sources.c.album_id, album_media_sources.c.media_id
            ).where(album_media_sources.c.moment_id == moment.id)
        ).all()
    }
    to_remove = existing - desired
    to_add = desired - existing
    affected_albums: set[uuid.UUID] = set()

    if to_remove:
        session.execute(
            delete(album_media_sources).where(
                album_media_sources.c.moment_id == moment.id,
                tuple_(
                    album_media_sources.c.album_id, album_media_sources.c.media_id
                ).in_(list(to_remove)),
            )
        )
        session.flush()
        affected_albums |= _delete_orphan_album_media(session, list(to_remove))

    if to_add:
        for album_id, _media_id in to_add:
            alts = {
                media_id: image_alts[media_id]
                for candidate_album, media_id in to_add
                if candidate_album == album_id
            }
            _ensure_album_media_rows(session, album_id=album_id, media_alts=alts)
        session.execute(
            insert(album_media_sources),
            [
                {"album_id": album_id, "media_id": media_id, "moment_id": moment.id}
                for album_id, media_id in to_add
            ],
        )
        session.flush()
        affected_albums |= {album_id for album_id, _media_id in to_add}

    return affected_albums


def clear_moment_album_links(session: Session, *, moment: Moment) -> set[uuid.UUID]:
    """清空一条动态的全部收录配置（`album_links: []` / 删除动态）。

    返回实际受影响的相册 id 集合。
    """
    pairs = [
        (album_id, media_id)
        for album_id, media_id in session.execute(
            select(
                album_media_sources.c.album_id, album_media_sources.c.media_id
            ).where(album_media_sources.c.moment_id == moment.id)
        ).all()
    ]
    if not pairs:
        return set()
    session.execute(
        delete(album_media_sources).where(album_media_sources.c.moment_id == moment.id)
    )
    session.flush()
    return _delete_orphan_album_media(session, pairs)


def prune_moment_album_links(
    session: Session,
    *,
    moment: Moment,
    keep_media_ids: Sequence[uuid.UUID],
) -> set[uuid.UUID]:
    """清理「仍保留但已不再属于本项目动态」的配置（任务书 §4.3 第一行语义）。

    用于更新时**不传** `album_links` 的情况：原选择保留，但已从动态里删掉的图片、
    以及已删除相册的配置必须清掉。返回实际受影响的相册 id 集合。
    """
    keep = set(keep_media_ids)
    rows = session.execute(
        select(
            album_media_sources.c.album_id,
            album_media_sources.c.media_id,
        ).where(album_media_sources.c.moment_id == moment.id)
    ).all()
    keep_album_ids = set(
        session.execute(
            select(Album.id).where(Album.deleted_at.is_(None))
        ).scalars()
    )
    removable = [
        (album_id, media_id)
        for album_id, media_id in rows
        # 已从动态里删掉的图片 / 已删除相册的配置都要清掉：
        # 管理端不应展示一个不存在的收录目标，也不应保留已失效来源。
        if media_id not in keep or album_id not in keep_album_ids
    ]
    if not removable:
        return set()
    session.execute(
        delete(album_media_sources).where(
            album_media_sources.c.moment_id == moment.id,
            tuple_(
                album_media_sources.c.album_id, album_media_sources.c.media_id
            ).in_(removable),
        )
    )
    session.flush()
    return _delete_orphan_album_media(session, removable)


def clear_moment_links_for_album(
    session: Session, *, album_id: uuid.UUID
) -> set[uuid.UUID]:
    """相册删除时撤销它作为收录目标：删除所有动态指向该相册的配置。

    只删动态来源行；独立来源与 `album_media` 显示关系保留（数据不丢，删除是软删除，
    公开投影已随相册删除消失）。返回配置被删除的动态 id 集合。
    """
    affected_moments = set(
        session.execute(
            select(album_media_sources.c.moment_id).where(
                album_media_sources.c.album_id == album_id,
                album_media_sources.c.moment_id.is_not(None),
            )
        ).scalars()
    )
    if not affected_moments:
        return set()
    session.execute(
        delete(album_media_sources).where(
            album_media_sources.c.album_id == album_id,
            album_media_sources.c.moment_id.is_not(None),
        )
    )
    session.flush()
    return affected_moments


__all__ = [
    "MAX_LINKS_PER_ALBUM",
    "SOURCE_KIND_INDEPENDENT",
    "SOURCE_KIND_MOMENT",
    "album_links_for_moments",
    "album_media_ids",
    "album_media_positions",
    "normalize_album_links",
    "bump_album_versions",
    "bump_moment_versions",
    "clear_moment_album_links",
    "clear_moment_links_for_album",
    "conflict",
    "detach_album_media",
    "ensure_independent_sources",
    "moment_media_alts",
    "moment_public_conditions",
    "next_album_media_position",
    "prune_moment_album_links",
    "public_source_exists",
    "replace_moment_album_links",
    "source_condition_for",
    "sources_for_album_photos",
    "validate_moment_album_links",
]
