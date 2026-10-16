"""放课后服务（07 §3 / §8、05 §4 / §6 / §7）。

事务边界（05 §4）：一次更新里的所有字段与 `version` 在同一事务提交。

公开条件（写在 SQL 里）：`status = 'published' AND deleted_at IS NULL`。
放课后**没有 private 概念**（07 §3）：草稿就是没整理好的条目，撤回不删数据。

三处一致性由 `rules.py` 一份规则保证，不在服务里重写：

  - 「追番不接受游戏字段，反之亦然」：DTO 给出字段级 422，数据库 CHECK 兜底；
  - 「总集数未知不算完成率」：`schemas` 直接调用 `rules.completion_ratio`；
  - 「通关 ≠ 全成就」：两个字段各自读写，服务里没有任何互相推导。

**进度更新不会自动发公开动态**（07 §3 / 任务卡「不做」）：本模块不引用
`moments`，也不在更新路径上写任何其它内容域的数据。要生成 INS 草稿属于后续
独立连接，必须显式设计，不能靠副作用。
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import Select, func, select, tuple_
from sqlalchemy.orm import Session

from app.core.db import utcnow
from app.core.errors import CODE_CONFLICT, CODE_NOT_FOUND, ApiError
from app.core.pagination import (
    DEFAULT_LIMIT,
    MAX_LIMIT,
    decode_cursor,
    encode_cursor,
    filter_fingerprint,
)
from app.core.preconditions import require_version
from app.modules.leisure import rules, schemas
from app.modules.leisure.models import (
    KIND_ANIME,
    KIND_GAME,
    STATUS_DRAFT,
    STATUS_PUBLISHED,
    LeisureEntry,
)
from app.modules.media.models import Media
from app.modules.media.schemas import media_public_out
from app.modules.posts import service as posts_service
from app.modules.posts.models import Post


def not_found(message: str = "这条记录不存在或不可访问") -> ApiError:
    return ApiError(CODE_NOT_FOUND, message, status_code=404)


def conflict(message: str, fields: dict | None = None) -> ApiError:
    return ApiError(CODE_CONFLICT, message, status_code=409, fields=fields)


def validation_error(message: str, fields: dict | None = None) -> ApiError:
    return ApiError("VALIDATION_FAILED", message, status_code=422, fields=fields)


def clamp_limit(limit: int | None) -> int:
    if limit is None:
        return DEFAULT_LIMIT
    return max(1, min(int(limit), MAX_LIMIT))


# --- 公开条件 ---------------------------------------------------------------


def public_conditions() -> list:
    return [LeisureEntry.status == STATUS_PUBLISHED, LeisureEntry.deleted_at.is_(None)]


def _filter_fingerprint(*, kind: str | None, progress: str | None) -> str:
    return filter_fingerprint({"kind": kind, "progress": progress})


# --- 公开读取 ---------------------------------------------------------------


def list_public_entries(
    session: Session,
    *,
    kind: str | None = None,
    progress: str | None = None,
    cursor: str | None = None,
    limit: int | None = None,
) -> tuple[list[LeisureEntry], str | None]:
    """公开列表：按 `(updated_at DESC, id DESC)` 排序，游标带类型 / 进度筛选指纹。

    排序用 `updated_at` 而不是创建时间：追番进度更新后应该回到列表前面，
    这与「最近在看什么」的语义一致。
    """
    size = clamp_limit(limit)
    fingerprint = _filter_fingerprint(kind=kind, progress=progress)

    conditions = public_conditions()
    if kind is not None:
        conditions.append(LeisureEntry.kind == kind)
    if progress is not None:
        conditions.append(LeisureEntry.progress == progress)

    statement: Select = select(LeisureEntry).where(*conditions)
    if cursor:
        sort_value, entity_id = decode_cursor(cursor, fingerprint=fingerprint)
        statement = statement.where(
            tuple_(LeisureEntry.updated_at, LeisureEntry.id) < tuple_(sort_value, entity_id)
        )
    statement = statement.order_by(LeisureEntry.updated_at.desc(), LeisureEntry.id.desc())
    rows = list(session.execute(statement.limit(size + 1)).scalars())

    next_cursor: str | None = None
    if len(rows) > size:
        rows = rows[:size]
        last = rows[-1]
        next_cursor = encode_cursor(
            sort_value=last.updated_at, entity_id=last.id, fingerprint=fingerprint
        )
    return rows, next_cursor


def get_public_entry(session: Session, entry_id: uuid.UUID) -> LeisureEntry | None:
    statement = select(LeisureEntry).where(LeisureEntry.id == entry_id, *public_conditions())
    return session.execute(statement).scalar_one_or_none()


# --- 封面与长评引用 ---------------------------------------------------------


def covers_out(session: Session, entries: list[LeisureEntry]) -> dict[uuid.UUID, dict[str, Any]]:
    """封面：只给公开可用的变体（ready + 未删除），未 ready 的封面不出现在公开响应里。"""
    media_ids = [entry.cover_media_id for entry in entries if entry.cover_media_id]
    ready = posts_service.ready_covers(session, media_ids)
    result: dict[uuid.UUID, dict[str, Any]] = {}
    for media in ready.values():
        public = media_public_out(media)
        result[media.id] = {
            "id": public.id,
            "width": public.width,
            "height": public.height,
            "variants": [variant.model_dump() for variant in public.variants],
        }
    return result


def public_review_refs(
    session: Session, entries: list[LeisureEntry]
) -> dict[uuid.UUID, schemas.ReviewRefOut]:
    """公开长评引用：**只给公开文章**。草稿长评不泄漏标题（05 §7）。"""
    wanted = sorted({entry.review_post_id for entry in entries if entry.review_post_id})
    if not wanted:
        return {}
    rows = session.execute(
        select(Post).where(
            Post.id.in_(wanted),
            Post.status == STATUS_PUBLISHED,
            Post.deleted_at.is_(None),
        )
    ).scalars()
    return {
        post.id: schemas.ReviewRefOut(id=post.id, slug=post.slug, title=post.title) for post in rows
    }


def admin_review_refs(
    session: Session, entries: list[LeisureEntry]
) -> dict[uuid.UUID, schemas.ReviewRefOut]:
    """管理端长评引用：含草稿 / 已撤回的文章，便于站主知道自己关联了什么。"""
    wanted = sorted({entry.review_post_id for entry in entries if entry.review_post_id})
    if not wanted:
        return {}
    rows = session.execute(
        select(Post).where(Post.id.in_(wanted), Post.deleted_at.is_(None))
    ).scalars()
    return {
        post.id: schemas.ReviewRefOut(id=post.id, slug=post.slug, title=post.title) for post in rows
    }


def entries_out(session: Session, entries: list[LeisureEntry]) -> list[schemas.LeisureEntryOut]:
    covers = covers_out(session, entries)
    reviews = public_review_refs(session, entries)
    return [
        schemas.entry_out(
            entry,
            cover=covers.get(entry.cover_media_id) if entry.cover_media_id else None,
            review=reviews.get(entry.review_post_id) if entry.review_post_id else None,
        )
        for entry in entries
    ]


def entry_out(session: Session, entry: LeisureEntry) -> schemas.LeisureEntryOut:
    return entries_out(session, [entry])[0]


# --- 管理读取 ---------------------------------------------------------------


def list_admin_entries(
    session: Session,
    *,
    kind: str | None = None,
    status: str | None = None,
    cursor: str | None = None,
    limit: int | None = None,
) -> tuple[list[LeisureEntry], str | None]:
    size = clamp_limit(limit)
    fingerprint = filter_fingerprint({"kind": kind, "status": status})

    conditions = [LeisureEntry.deleted_at.is_(None)]
    if kind is not None:
        conditions.append(LeisureEntry.kind == kind)
    if status is not None:
        conditions.append(LeisureEntry.status == status)

    statement: Select = select(LeisureEntry).where(*conditions)
    if cursor:
        sort_value, entity_id = decode_cursor(cursor, fingerprint=fingerprint)
        statement = statement.where(
            tuple_(LeisureEntry.updated_at, LeisureEntry.id) < tuple_(sort_value, entity_id)
        )
    statement = statement.order_by(LeisureEntry.updated_at.desc(), LeisureEntry.id.desc())
    rows = list(session.execute(statement.limit(size + 1)).scalars())

    next_cursor: str | None = None
    if len(rows) > size:
        rows = rows[:size]
        last = rows[-1]
        next_cursor = encode_cursor(
            sort_value=last.updated_at, entity_id=last.id, fingerprint=fingerprint
        )
    return rows, next_cursor


def get_admin_entry(session: Session, entry_id: uuid.UUID) -> LeisureEntry | None:
    statement = select(LeisureEntry).where(
        LeisureEntry.id == entry_id, LeisureEntry.deleted_at.is_(None)
    )
    return session.execute(statement).scalar_one_or_none()


def admin_entries_out(
    session: Session, entries: list[LeisureEntry]
) -> list[schemas.LeisureAdminOut]:
    covers = covers_out(session, entries)
    reviews = admin_review_refs(session, entries)
    return [
        schemas.admin_entry_out(
            entry,
            cover=covers.get(entry.cover_media_id) if entry.cover_media_id else None,
            review=reviews.get(entry.review_post_id) if entry.review_post_id else None,
        )
        for entry in entries
    ]


def admin_entry_out(session: Session, entry: LeisureEntry) -> schemas.LeisureAdminOut:
    return admin_entries_out(session, [entry])[0]


# --- 一致性校验（合并 PATCH 之后的整体状态）--------------------------------

# 合并之后要一起检查的字段：只改一个字段也可能让整体不一致
# （例如只把 total_episodes 调小，而 episodes_watched 没动）。
_ANIME_FIELDS = ("season", "total_episodes", "episodes_watched", "last_watched_on", "airing")
_GAME_FIELDS = ("platform", "playtime_minutes", "started_on", "completed_on", "all_achievements")


def _entry_values(entry: LeisureEntry) -> dict[str, object]:
    return {
        "season": entry.season,
        "total_episodes": entry.total_episodes,
        "episodes_watched": entry.episodes_watched,
        "last_watched_on": entry.last_watched_on,
        "airing": entry.airing,
        "platform": entry.platform,
        "playtime_minutes": entry.playtime_minutes,
        "started_on": entry.started_on,
        "completed_on": entry.completed_on,
        "all_achievements": entry.all_achievements,
    }


def _assert_entry_consistent(entry: LeisureEntry) -> None:
    """合并后的整体校验：字段归属、进度取值、集数关系。"""
    offending = rules.cross_kind_fields(entry.kind, _entry_values(entry))
    if offending:
        labels = rules.cross_kind_labels(entry.kind, offending)
        raise validation_error(
            f"{'追番' if entry.kind == KIND_ANIME else '游戏'}记录不接受这些字段："
            f"{'、'.join(labels)}",
            {name: ["这一项不属于本类型"] for name in offending},
        )
    if entry.progress not in rules.allowed_progress(entry.kind):
        raise validation_error(
            f"进度取值不合法：{entry.progress}", {"progress": ["取值不允许"]}
        )
    if rules.episodes_conflict(entry.episodes_watched, entry.total_episodes):
        raise validation_error(
            "已看集数不能超过总集数（总集数不确定时请先留空）",
            {"episodes_watched": ["不能超过总集数"]},
        )


def _assert_cover_usable(session: Session, media_id: uuid.UUID | None) -> None:
    if media_id is None:
        return
    media = session.get(Media, media_id)
    # `Media.is_ready` 是**属性**（`status == ready and deleted_at is None`），不是方法。
    if media is None or not media.is_ready:
        raise conflict("封面图片还没处理完成或已被删除。", {"cover_media_id": ["不可用的图片"]})


def _assert_review_post(session: Session, post_id: uuid.UUID | None) -> None:
    if post_id is None:
        return
    post = session.get(Post, post_id)
    if post is None or post.deleted_at is not None:
        raise conflict("关联的长评文章不存在或已删除。", {"review_post_id": ["文章不存在"]})


# --- 管理写入 ---------------------------------------------------------------


def create_entry(
    session: Session,
    *,
    kind: str,
    title: str,
    progress: str | None,
    rating: int | None,
    notes: str,
    notes_have_spoilers: bool,
    cover_media_id: uuid.UUID | None,
    review_post_id: uuid.UUID | None,
    extras: dict[str, object],
) -> LeisureEntry:
    """新建：**总是草稿**（`status` 不在签名里，发布是独立动作）。"""
    _assert_cover_usable(session, cover_media_id)
    _assert_review_post(session, review_post_id)

    entry = LeisureEntry(
        kind=kind,
        title=title.strip(),
        progress=progress or rules.default_progress(kind),
        rating=rating,
        notes=notes,
        notes_have_spoilers=notes_have_spoilers,
        cover_media_id=cover_media_id,
        review_post_id=review_post_id,
        status=STATUS_DRAFT,
    )
    for name, value in extras.items():
        if name in _ANIME_FIELDS or name in _GAME_FIELDS:
            setattr(entry, name, value)
    _assert_entry_consistent(entry)
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry


def update_entry(session: Session, entry: LeisureEntry, *, changes: dict[str, object]) -> LeisureEntry:
    """PATCH：只改出现过的字段，然后对**合并后的整体**再做一次一致性校验。"""
    if "cover_media_id" in changes:
        _assert_cover_usable(session, changes["cover_media_id"])  # type: ignore[arg-type]
    if "review_post_id" in changes:
        _assert_review_post(session, changes["review_post_id"])  # type: ignore[arg-type]

    for name, value in changes.items():
        if name == "title" and isinstance(value, str):
            value = value.strip()
        setattr(entry, name, value)

    _assert_entry_consistent(entry)
    entry.bump_version()
    session.commit()
    session.refresh(entry)
    return entry


def publish_entry(session: Session, entry: LeisureEntry) -> LeisureEntry:
    """发布。`published_at` 只在首次发布时写入；重新发布不刷新历史时间。"""
    if not (entry.title or "").strip():
        raise conflict("发布前请先写名称。", {"title": ["名称不能为空"]})
    entry.status = STATUS_PUBLISHED
    if entry.published_at is None:
        entry.published_at = utcnow()
    entry.bump_version()
    session.commit()
    session.refresh(entry)
    return entry


def unpublish_entry(session: Session, entry: LeisureEntry) -> LeisureEntry:
    """撤回：只改状态，保留封面与长评关系。"""
    entry.status = STATUS_DRAFT
    entry.bump_version()
    session.commit()
    session.refresh(entry)
    return entry


def soft_delete_entry(session: Session, entry: LeisureEntry) -> None:
    entry.deleted_at = utcnow()
    entry.bump_version()
    session.commit()


# --- 与其它内容域的只读关系（勒布朗近况 / 首页组合用）-----------------------


def public_entries_by_kind(session: Session, kind: str, *, limit: int = 1) -> list[LeisureEntry]:
    """按类型取最近的公开条目，供勒布朗近况与其它组合视图读取（只读，不分页）。"""
    if kind not in (KIND_ANIME, KIND_GAME):
        return []
    statement = (
        select(LeisureEntry)
        .where(*public_conditions(), LeisureEntry.kind == kind)
        .order_by(LeisureEntry.updated_at.desc(), LeisureEntry.id.desc())
        .limit(max(1, min(int(limit), MAX_LIMIT)))
    )
    return list(session.execute(statement).scalars())


def count_public_entries(session: Session) -> dict[str, int]:
    """公开条数（按类型），供组合视图显示真实计数。**不是权限条件，只是统计。**"""
    rows = session.execute(
        select(LeisureEntry.kind, func.count())
        .where(*public_conditions())
        .group_by(LeisureEntry.kind)
    ).all()
    counts = {KIND_ANIME: 0, KIND_GAME: 0}
    for kind, count in rows:
        counts[str(kind)] = int(count)
    return counts


__all__ = [
    "admin_entries_out",
    "admin_entry_out",
    "admin_review_refs",
    "clamp_limit",
    "conflict",
    "count_public_entries",
    "covers_out",
    "create_entry",
    "entries_out",
    "entry_out",
    "get_admin_entry",
    "get_public_entry",
    "list_admin_entries",
    "list_public_entries",
    "not_found",
    "public_conditions",
    "public_entries_by_kind",
    "public_review_refs",
    "publish_entry",
    "soft_delete_entry",
    "unpublish_entry",
    "update_entry",
    "validation_error",
]
