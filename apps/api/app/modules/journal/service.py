"""手记服务（07 §3 / §8、05 §4 / §6 / §7 / §11）。

事务边界（05 §4）：一次更新里的正文、日期、图片关系与 version 在**同一个事务**里提交，
发布 / 撤回 / 可见性切换也一样。任何校验失败都在 `commit()` 之前抛出，因此不会留下
「状态改了但图片没换」的半成品。

公开条件（写在 SQL 里，不在浏览器里过滤）：

    status = 'published' AND visibility = 'public' AND deleted_at IS NULL
    AND entry_date <= <明确展示时区的今天>

「今天」用 `models.display_today()` 按显式展示时区计算，**不是**服务器本地时区：
服务器时区怎么设都不应该让「今天的日记」提前或推迟一天出现（验收 2）。

切为 `private` 后新请求立即生效（验收 1）：公开条件每次查询都重新求值，
没有任何缓存、没有物化视图、也没有「发布快照」，所以不存在需要失效的中间状态。
"""

from __future__ import annotations

import uuid
from collections import OrderedDict
from datetime import date, datetime, time, timezone

from sqlalchemy import Select, delete, func, insert, select, tuple_
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
from app.modules.journal.models import (
    DISPLAY_TIMEZONE_NAME,
    STATUS_DRAFT,
    STATUS_PUBLISHED,
    VISIBILITY_PRIVATE,
    VISIBILITY_PUBLIC,
    JournalEntry,
    display_today,
    journal_entry_media,
)
from app.modules.media.models import STATUS_READY, Media
from app.modules.posts.models import Post
from app.modules.posts import service as posts_service
from app.modules.journal import schemas


def not_found(message: str = "这篇手记不存在或不可访问") -> ApiError:
    """公开读不到与管理端读不到统一用它 —— 不区分「不存在」与「无权」（05 §6）。"""
    return ApiError(CODE_NOT_FOUND, message, status_code=404)


def conflict(message: str, fields: dict | None = None) -> ApiError:
    """业务冲突：图片未 ready、发布门槛不满足（05 §9 的 409）。"""
    return ApiError(CODE_CONFLICT, message, status_code=409, fields=fields)


def clamp_limit(limit: int | None) -> int:
    if limit is None:
        return DEFAULT_LIMIT
    return max(1, min(int(limit), MAX_LIMIT))


# --- 公开条件 ---------------------------------------------------------------


def public_conditions(*, today: date | None = None) -> list:
    reference = today or display_today()
    return [
        JournalEntry.status == STATUS_PUBLISHED,
        JournalEntry.visibility == VISIBILITY_PUBLIC,
        JournalEntry.deleted_at.is_(None),
        JournalEntry.entry_date <= reference,
    ]


def _filter_fingerprint(*, year: int | None, month: int | None) -> str:
    return filter_fingerprint({"year": year, "month": month})


def _sort_key(entry_date: date) -> datetime:
    """日期 → 无歧义的排序时刻（当天 UTC 00:00）。

    游标只承载「排到哪一行」，不承载本地时区语义：`entry_date` 是日历日期，
    用当天 00:00 UTC 作为排序值与它一一对应，与展示时区无关。
    """
    return datetime.combine(entry_date, time.min, tzinfo=timezone.utc)


def _date_from_sort_key(value: datetime) -> date:
    return value.astimezone(timezone.utc).date()


# --- 公开读取 ---------------------------------------------------------------


def list_public_entries(
    session: Session,
    *,
    year: int | None = None,
    month: int | None = None,
    cursor: str | None = None,
    limit: int | None = None,
    today: date | None = None,
) -> tuple[list[JournalEntry], str | None]:
    """公开列表：`(entry_date DESC, id DESC)`，不透明游标带年份 / 月份筛选指纹。"""
    size = clamp_limit(limit)
    fingerprint = _filter_fingerprint(year=year, month=month)

    conditions = public_conditions(today=today)
    if year is not None:
        conditions.append(func.extract("year", JournalEntry.entry_date) == year)
    if month is not None:
        conditions.append(func.extract("month", JournalEntry.entry_date) == month)

    statement: Select = select(JournalEntry).where(*conditions)
    if cursor:
        sort_value, entity_id = decode_cursor(cursor, fingerprint=fingerprint)
        cursor_date = _date_from_sort_key(sort_value)
        # 同一日期多条时用 id 继续收敛，保证「不漏不重」。
        statement = statement.where(
            tuple_(JournalEntry.entry_date, JournalEntry.id) < tuple_(cursor_date, entity_id)
        )
    statement = statement.order_by(JournalEntry.entry_date.desc(), JournalEntry.id.desc())
    rows = list(session.execute(statement.limit(size + 1)).scalars())

    next_cursor: str | None = None
    if len(rows) > size:
        rows = rows[:size]
        last = rows[-1]
        next_cursor = encode_cursor(
            sort_value=_sort_key(last.entry_date), entity_id=last.id, fingerprint=fingerprint
        )
    return rows, next_cursor


def get_public_entry(session: Session, entry_id: uuid.UUID, *, today: date | None = None) -> JournalEntry | None:
    statement = select(JournalEntry).where(JournalEntry.id == entry_id, *public_conditions(today=today))
    return session.execute(statement).scalar_one_or_none()


def public_calendar(
    session: Session,
    *,
    year: int | None = None,
    month: int | None = None,
    today: date | None = None,
) -> schemas.JournalCalendarOut:
    """公开日历：只聚合**真正公开**的记录（验收 1 / 2）。

    实现要点：
      - 计数在 SQL 里做，条件与公开列表**完全同一份** `public_conditions()`，
        因此不会出现「列表看不到、日历却有计数」这种两套条件的偏差；
      - 空月份不返回，空日期不返回 —— 没有「欠写」提醒，也没有隐藏记录的暗示；
      - `total_entries` 是**当前筛选范围内**的公开条数，与 `days` 求和一致。
    """
    reference = today or display_today()
    conditions = public_conditions(today=today)
    if year is not None:
        conditions.append(func.extract("year", JournalEntry.entry_date) == year)
    if month is not None:
        conditions.append(func.extract("month", JournalEntry.entry_date) == month)

    month_expr = func.to_char(JournalEntry.entry_date, "YYYY-MM")
    rows = session.execute(
        select(month_expr, JournalEntry.entry_date, func.count())
        .where(*conditions)
        .group_by(month_expr, JournalEntry.entry_date)
        .order_by(month_expr.desc(), JournalEntry.entry_date.asc())
    ).all()

    months: "OrderedDict[str, dict[str, int]]" = OrderedDict()
    total = 0
    for month_key, entry_date, count in rows:
        bucket = months.setdefault(str(month_key), {})
        bucket[entry_date.isoformat()] = int(count)
        total += int(count)

    return schemas.JournalCalendarOut(
        months=[
            schemas.JournalCalendarMonthOut(month=key, days=days) for key, days in months.items()
        ],
        total_entries=total,
        timezone=DISPLAY_TIMEZONE_NAME,
        today=reference,
    )


# --- 图片与长文引用 ---------------------------------------------------------


def images_for_entries(
    session: Session, entry_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[tuple[object, Media]]]:
    """批量取有序图片关系（只含 ready 且未删除的媒体）。

    未 ready 或已删除的媒体**不出现在公开响应里**（05 §8）：公开页面不应该
    渲染一个必然 404 的图片地址。管理端会看到它并收到提示。
    """
    if not entry_ids:
        return {}
    rows = session.execute(
        select(journal_entry_media.c.entry_id, journal_entry_media.c.media_id,
               journal_entry_media.c.position, journal_entry_media.c.alt)
        .where(journal_entry_media.c.entry_id.in_(entry_ids))
        .order_by(journal_entry_media.c.entry_id, journal_entry_media.c.position)
    ).all()
    wanted = [row.media_id for row in rows]
    media_by_id = posts_service.ready_covers(session, wanted)

    grouped: dict[uuid.UUID, list[tuple[object, Media]]] = {}
    for row in rows:
        media = media_by_id.get(row.media_id)
        if media is None:
            continue
        grouped.setdefault(row.entry_id, []).append((row, media))
    return grouped


def public_images_out(
    session: Session, entry_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[schemas.JournalImageOut]]:
    grouped = images_for_entries(session, entry_ids)
    return {
        entry_id: [schemas.image_out(row, media) for row, media in items]
        for entry_id, items in grouped.items()
    }


def post_ref_out(session: Session, post_id: uuid.UUID | None) -> schemas.JournalPostRefOut | None:
    """公开详情里的可选长文引用。

    只返回**公开且未删除**的文章：草稿 / 已撤回文章的标题、slug 都不出现在公开
    响应里（05 §7「管理员访问公共端点也不能多拿草稿」同理适用于关联资源）。
    管理端另有 `admin_post_ref_out`，它可以看到草稿关系。
    """
    if post_id is None:
        return None
    statement = select(Post).where(
        Post.id == post_id, Post.status == STATUS_PUBLISHED, Post.deleted_at.is_(None)
    )
    post = session.execute(statement).scalar_one_or_none()
    if post is None:
        return None
    return schemas.JournalPostRefOut(
        id=post.id, slug=post.slug, title=post.title, status=post.status, public=True
    )


def admin_post_ref_out(
    session: Session, post_id: uuid.UUID | None
) -> schemas.JournalPostRefOut | None:
    """管理端的长文引用：含草稿 / 已撤回文章，并标明它当前是否公开。"""
    if post_id is None:
        return None
    post = session.get(Post, post_id)
    if post is None or post.deleted_at is not None:
        return None
    return schemas.JournalPostRefOut(
        id=post.id,
        slug=post.slug,
        title=post.title,
        status=post.status,
        public=post.status == STATUS_PUBLISHED,
    )


def summary_list_out(session: Session, entries: list[JournalEntry]) -> list[schemas.JournalEntrySummaryOut]:
    images = public_images_out(session, [entry.id for entry in entries])
    return [schemas.entry_summary_out(entry, images=images.get(entry.id, [])) for entry in entries]


def detail_out(session: Session, entry: JournalEntry) -> schemas.JournalEntryDetailOut:
    images = public_images_out(session, [entry.id]).get(entry.id, [])
    return schemas.entry_detail_out(
        entry, images=images, post=post_ref_out(session, entry.post_id)
    )


# --- 管理读取 ---------------------------------------------------------------


def list_admin_entries(
    session: Session,
    *,
    status: str | None = None,
    visibility: str | None = None,
    cursor: str | None = None,
    limit: int | None = None,
) -> tuple[list[JournalEntry], str | None]:
    """管理列表：含草稿与私密记录；**已软删除的不在其中**（它们有独立的回收语义）。"""
    size = clamp_limit(limit)
    fingerprint = filter_fingerprint({"status": status, "visibility": visibility})

    conditions = [JournalEntry.deleted_at.is_(None)]
    if status is not None:
        conditions.append(JournalEntry.status == status)
    if visibility is not None:
        conditions.append(JournalEntry.visibility == visibility)

    statement: Select = select(JournalEntry).where(*conditions)
    if cursor:
        sort_value, entity_id = decode_cursor(cursor, fingerprint=fingerprint)
        cursor_date = _date_from_sort_key(sort_value)
        statement = statement.where(
            tuple_(JournalEntry.entry_date, JournalEntry.id) < tuple_(cursor_date, entity_id)
        )
    statement = statement.order_by(JournalEntry.entry_date.desc(), JournalEntry.id.desc())
    rows = list(session.execute(statement.limit(size + 1)).scalars())

    next_cursor: str | None = None
    if len(rows) > size:
        rows = rows[:size]
        last = rows[-1]
        next_cursor = encode_cursor(
            sort_value=_sort_key(last.entry_date), entity_id=last.id, fingerprint=fingerprint
        )
    return rows, next_cursor


def get_admin_entry(session: Session, entry_id: uuid.UUID) -> JournalEntry | None:
    statement = select(JournalEntry).where(
        JournalEntry.id == entry_id, JournalEntry.deleted_at.is_(None)
    )
    return session.execute(statement).scalar_one_or_none()


def admin_images_out(
    session: Session, entry: JournalEntry
) -> tuple[list[schemas.JournalAdminImageOut], list[uuid.UUID]]:
    """管理端图片 + 「还有别的公开引用」提示（05 §11）。

    返回值第二项是 `shared_media`：这些图**即使本篇日记不公开**仍然对外可读
    （有别的公开引用）。管理端必须如实说明，不能声称「切私密就撤回了图」。
    """
    from app.modules.media import public_refs as media_public_refs

    rows = session.execute(
        select(journal_entry_media.c.media_id, journal_entry_media.c.position,
               journal_entry_media.c.alt)
        .where(journal_entry_media.c.entry_id == entry.id)
        .order_by(journal_entry_media.c.position)
    ).all()
    media_by_id = {
        media.id: media for media in session.execute(
            select(Media).where(Media.id.in_([row.media_id for row in rows]))
        ).scalars()
    }

    images: list[schemas.JournalAdminImageOut] = []
    shared: list[uuid.UUID] = []
    for row in rows:
        media = media_by_id.get(row.media_id)
        if media is None:
            continue
        still_public = media_public_refs.is_publicly_referenced(session, media.id)
        if still_public:
            shared.append(media.id)
        images.append(
            schemas.JournalAdminImageOut(
                media_id=media.id,
                position=int(row.position),
                alt=row.alt or "",
                width=int(media.width),
                height=int(media.height),
                still_public=still_public,
            )
        )
    return images, shared


def admin_entry_out(session: Session, entry: JournalEntry) -> schemas.JournalAdminOut:
    images, shared = admin_images_out(session, entry)
    return schemas.admin_entry_out(
        entry,
        images=images,
        post=admin_post_ref_out(session, entry.post_id),
        public=entry.is_publicly_visible(),
        shared_media=shared,
    )


# --- 管理写入 ---------------------------------------------------------------


def _clean_images(payload_images) -> list[tuple[uuid.UUID, int, str]]:
    return [
        (image.media_id, int(image.position), (image.alt or "").strip())
        for image in (payload_images or [])
    ]


def _assert_media_usable(session: Session, refs: list[tuple[uuid.UUID, int, str]]) -> None:
    """所有引用的媒体必须存在且 ready（未删除）。否则 409，不写入半成品关系。"""
    if not refs:
        return
    wanted = [media_id for media_id, _position, _alt in refs]
    ready = {
        media.id
        for media in session.execute(
            select(Media).where(
                Media.id.in_(wanted), Media.status == STATUS_READY, Media.deleted_at.is_(None)
            )
        ).scalars()
    }
    missing = [media_id for media_id in wanted if media_id not in ready]
    if missing:
        raise conflict(
            "有图片还没处理完成或已被删除，先修好这些图片再保存。",
            {"images": [f"不可用的图片：{media_id}" for media_id in missing]},
        )


def _replace_images(
    session: Session, entry: JournalEntry, refs: list[tuple[uuid.UUID, int, str]]
) -> None:
    session.execute(delete(journal_entry_media).where(journal_entry_media.c.entry_id == entry.id))
    if refs:
        session.execute(
            insert(journal_entry_media),
            [
                {"entry_id": entry.id, "media_id": media_id, "position": position, "alt": alt}
                for media_id, position, alt in refs
            ],
        )
    session.flush()


def _assert_post_exists(session: Session, post_id: uuid.UUID | None) -> None:
    if post_id is None:
        return
    post = session.get(Post, post_id)
    if post is None or post.deleted_at is not None:
        raise conflict("关联的文章不存在或已删除。", {"post_id": ["文章不存在"]})


def create_entry(
    session: Session,
    *,
    entry_date: date,
    title: str,
    content_md: str,
    mood: str,
    location: str,
    post_id: uuid.UUID | None,
    images,
) -> JournalEntry:
    """新建：**永远**是 draft + private（07 §3）。签名里没有 status / visibility。"""
    refs = _clean_images(images)
    _assert_media_usable(session, refs)
    _assert_post_exists(session, post_id)

    entry = JournalEntry(
        entry_date=entry_date,
        title=title,
        content_md=content_md,
        mood=mood,
        location=location,
        post_id=post_id,
        status=STATUS_DRAFT,
        visibility=VISIBILITY_PRIVATE,
    )
    session.add(entry)
    session.flush()
    _replace_images(session, entry, refs)
    session.commit()
    session.refresh(entry)
    return entry


def update_entry(session: Session, entry: JournalEntry, *, changes: dict) -> JournalEntry:
    """PATCH 语义：只改出现过的字段；`images` 传入时完整替换。"""
    if "images" in changes:
        refs = _clean_images(changes["images"])
        _assert_media_usable(session, refs)
        _replace_images(session, entry, refs)
    if "post_id" in changes:
        _assert_post_exists(session, changes["post_id"])
        entry.post_id = changes["post_id"]
    for field in ("entry_date", "title", "content_md", "mood", "location"):
        if field in changes:
            setattr(entry, field, changes[field])
    entry.bump_version()
    session.commit()
    session.refresh(entry)
    return entry


def _publish_requirement(entry: JournalEntry) -> None:
    """发布门槛：必须有标题与正文。

    刻意不要求配图 —— 「今天没什么可写的，但记一句」是日记的正常形态，
    强行要求图片会让站主为了发布而随便传一张图。
    """
    if not (entry.title or "").strip():
        raise conflict("发布前请先写标题。", {"title": ["标题不能为空"]})
    if not (entry.content_md or "").strip():
        raise conflict("发布前请先写正文。", {"content_md": ["正文不能为空"]})


def publish_entry(session: Session, entry: JournalEntry) -> JournalEntry:
    """发布。`published_at` **只在首次发布时写入**；重新发布不刷新历史时间。"""
    _publish_requirement(entry)
    entry.status = STATUS_PUBLISHED
    if entry.published_at is None:
        entry.published_at = utcnow()
    entry.bump_version()
    session.commit()
    session.refresh(entry)
    return entry


def unpublish_entry(session: Session, entry: JournalEntry) -> JournalEntry:
    """撤回：只改状态，**保留**图片与长文关系，也不清空 `published_at`。"""
    entry.status = STATUS_DRAFT
    entry.bump_version()
    session.commit()
    session.refresh(entry)
    return entry


def set_visibility(session: Session, entry: JournalEntry, visibility: str) -> JournalEntry:
    """切 public / private。**立即对新请求生效**：公开条件每次查询重新求值。"""
    if visibility not in (VISIBILITY_PUBLIC, VISIBILITY_PRIVATE):
        raise ApiError("VALIDATION_FAILED", "可见性取值不合法", status_code=422)
    entry.visibility = visibility
    entry.bump_version()
    session.commit()
    session.refresh(entry)
    return entry


def soft_delete_entry(session: Session, entry: JournalEntry) -> None:
    """软删除：保留行与图片关系，公开查询立即看不到（可以人工恢复）。"""
    entry.deleted_at = utcnow()
    entry.bump_version()
    session.commit()


# --- 媒体公开引用检查（供 wiring 使用）--------------------------------------


def public_entry_exists_for_media(session: Session, media_id: uuid.UUID) -> bool:
    """该图片是否被某篇**公开**日记引用（媒体公开引用检查用，只读）。

    只认「published + public + 未删除 + 日期不晚于今天」的日记；
    私密或草稿日记的引用**不会**让图片变成公开。
    """
    statement = (
        select(func.count())
        .select_from(journal_entry_media)
        .join(JournalEntry, JournalEntry.id == journal_entry_media.c.entry_id)
        .where(journal_entry_media.c.media_id == media_id, *public_conditions())
    )
    return bool(session.execute(statement).scalar())


__all__ = [
    "admin_entry_out",
    "admin_images_out",
    "clamp_limit",
    "conflict",
    "create_entry",
    "detail_out",
    "get_admin_entry",
    "get_public_entry",
    "images_for_entries",
    "list_admin_entries",
    "list_public_entries",
    "not_found",
    "admin_post_ref_out",
    "post_ref_out",
    "public_calendar",
    "public_conditions",
    "public_entry_exists_for_media",
    "public_images_out",
    "publish_entry",
    "set_visibility",
    "soft_delete_entry",
    "summary_list_out",
    "unpublish_entry",
    "update_entry",
]
