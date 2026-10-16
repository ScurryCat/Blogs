"""图文动态服务（05 §3 / §4 / §6 / §7，03 §5）。

事务边界（05 §4）：一次更新中的**文字、图片顺序、标签与 version 在同一个事务里提交**，
发布校验与状态改变也同事务完成。这里的方法是「变更内存中的对象 → 一次 `commit()`」，
中途任何校验失败都在提交之前抛出，因此不会留下「状态改了但图片没换」的半成品。

公开条件（写在 SQL 里，而不是浏览器里）：
    status = 'published' AND deleted_at IS NULL AND published_at <= now()

排序 `(published_at DESC, id DESC)` + 不透明游标：同一时间戳的多条动态分页不漏不重；
游标里带标签筛选指纹，切换标签后继续用旧游标 → 400。

发布门槛（03 §5）：
  - 1–9 张图片；
  - 所有关联媒体必须 `ready`（未删除）—— 否则 409，不是 200；
  - 替代文本 1–200 码点（字段级约束在 schemas，缺图的边界在这里）。
草稿可以暂时没有图片；撤回把 `status` 改回 draft 但**保留**图片与标签关系。
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from datetime import datetime

from sqlalchemy import Select, delete, insert, select, tuple_
from sqlalchemy.exc import IntegrityError
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
from app.core.text import normalize_tag_slug
from app.modules.media.models import STATUS_READY, Media
from app.modules.moments.models import (
    IMAGES_MAX,
    IMAGES_MIN,
    STATUS_DRAFT,
    STATUS_PUBLISHED,
    Moment,
    moment_media,
    moment_tags,
)
from app.modules.moments.schemas import MomentImageIn
from app.modules.tags import service as tags_service
from app.modules.tags.models import Tag


def not_found(message: str = "动态不存在或不可访问") -> ApiError:
    """公开读不到与站主读不到管理资源统一用它 —— 不区分「不存在」与「无权」。"""
    return ApiError(CODE_NOT_FOUND, message, status_code=404)


def conflict(message: str, fields: dict | None = None) -> ApiError:
    """业务冲突：图片未 ready、发布门槛不满足（05 §9 的 409）。"""
    return ApiError(CODE_CONFLICT, message, status_code=409, fields=fields)


# --- 查询基础 -------------------------------------------------------------


def clamp_limit(limit: int | None) -> int:
    if limit is None:
        return DEFAULT_LIMIT
    return max(1, min(int(limit), MAX_LIMIT))


def public_conditions(now: datetime | None = None) -> list:
    moment = now or utcnow()
    return [
        Moment.status == STATUS_PUBLISHED,
        Moment.deleted_at.is_(None),
        Moment.published_at.is_not(None),
        Moment.published_at <= moment,
    ]


def _filter_fingerprint(tag: str | None) -> str:
    return filter_fingerprint({"tag": tag})


def list_public_moments(
    session: Session,
    *,
    tag: str | None = None,
    cursor: str | None = None,
    limit: int | None = None,
    now: datetime | None = None,
) -> tuple[list[Moment], str | None]:
    """公开列表。游标与当前筛选不一致时抛 400（05 §6）。"""
    bounded = clamp_limit(limit)
    fingerprint = _filter_fingerprint(tag)

    statement: Select = select(Moment).where(*public_conditions(now))
    if tag:
        slug = normalize_tag_slug(tag)
        statement = statement.where(
            Moment.id.in_(
                select(moment_tags.c.moment_id)
                .join(Tag, Tag.id == moment_tags.c.tag_id)
                .where(Tag.slug == slug)
            )
        )

    if cursor:
        sort_value, entity_id = decode_cursor(cursor, fingerprint=fingerprint)
        statement = statement.where(
            tuple_(Moment.published_at, Moment.id) < tuple_(sort_value, entity_id)
        )

    statement = statement.order_by(Moment.published_at.desc(), Moment.id.desc()).limit(bounded + 1)
    rows = list(session.execute(statement).scalars().all())

    next_cursor: str | None = None
    if len(rows) > bounded:
        rows = rows[:bounded]
        last = rows[-1]
        next_cursor = encode_cursor(
            sort_value=last.published_at, entity_id=last.id, fingerprint=fingerprint
        )
    return rows, next_cursor


def get_public_moment(session: Session, moment_id: uuid.UUID, *, now: datetime | None = None) -> Moment | None:
    """按 UUID 取公开动态。草稿 / 已撤回 / 已删除 / 未到发布时间都返回 None（统一 404）。"""
    return session.execute(
        select(Moment).where(Moment.id == moment_id, *public_conditions(now))
    ).scalars().first()


def get_moment(session: Session, moment_id: uuid.UUID) -> Moment | None:
    """管理读取：任何状态都能取到，但已软删除的不再返回（管理列表也不显示）。"""
    return session.execute(
        select(Moment).where(Moment.id == moment_id, Moment.deleted_at.is_(None))
    ).scalars().first()


def list_admin_moments(
    session: Session,
    *,
    status: str | None = None,
    cursor: str | None = None,
    limit: int | None = None,
) -> tuple[list[Moment], str | None]:
    """管理列表：草稿与已发布都在，按 `(created_at DESC, id DESC)` 排序。

    管理列表按创建时间排（草稿没有发布时间），与公开列表的排序键不同，
    因此用独立指纹，避免两种游标混用。
    """
    bounded = clamp_limit(limit)
    fingerprint = filter_fingerprint({"scope": "admin", "status": status})

    statement: Select = select(Moment).where(Moment.deleted_at.is_(None))
    if status:
        statement = statement.where(Moment.status == status)
    if cursor:
        sort_value, entity_id = decode_cursor(cursor, fingerprint=fingerprint)
        statement = statement.where(
            tuple_(Moment.created_at, Moment.id) < tuple_(sort_value, entity_id)
        )
    statement = statement.order_by(Moment.created_at.desc(), Moment.id.desc()).limit(bounded + 1)
    rows = list(session.execute(statement).scalars().all())

    next_cursor: str | None = None
    if len(rows) > bounded:
        rows = rows[:bounded]
        last = rows[-1]
        next_cursor = encode_cursor(
            sort_value=last.created_at, entity_id=last.id, fingerprint=fingerprint
        )
    return rows, next_cursor


# --- 关联数据批量读取 ------------------------------------------------------


def tags_for_moments(session: Session, moment_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[Tag]]:
    """批量取标签，避免列表页 N+1 查询。"""
    if not moment_ids:
        return {}
    rows = session.execute(
        select(moment_tags.c.moment_id, Tag)
        .join(Tag, Tag.id == moment_tags.c.tag_id)
        .where(moment_tags.c.moment_id.in_(moment_ids))
        .order_by(Tag.slug.asc())
    ).all()
    grouped: dict[uuid.UUID, list[Tag]] = {}
    for moment_id, tag in rows:
        grouped.setdefault(moment_id, []).append(tag)
    return grouped


def images_for_moments(
    session: Session, moment_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[tuple[Media, int, str]]]:
    """批量取有序图片，返回 `{moment_id: [(media, position, alt)]}`，按 position 升序。

    只返回 `ready` 且未删除的媒体：管理侧若图片已被删除，发布校验会拒绝，
    公开侧也不该出现一个指向不可读对象的 `<img>`。
    """
    if not moment_ids:
        return {}
    rows = session.execute(
        select(
            moment_media.c.moment_id,
            moment_media.c.position,
            moment_media.c.alt,
            Media,
        )
        .join(Media, Media.id == moment_media.c.media_id)
        .where(
            moment_media.c.moment_id.in_(moment_ids),
            Media.deleted_at.is_(None),
            Media.status == STATUS_READY,
        )
        .order_by(moment_media.c.moment_id.asc(), moment_media.c.position.asc())
    ).all()
    grouped: dict[uuid.UUID, list[tuple[Media, int, str]]] = {}
    for moment_id, position, alt, media in rows:
        grouped.setdefault(moment_id, []).append((media, int(position), str(alt)))
    return grouped


def image_refs_for_moments(
    session: Session, moment_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[tuple[uuid.UUID, int, str]]]:
    """管理回执用：不管媒体是否 ready，都如实返回已保存的顺序关系。

    与 `images_for_moments` 的差别是**故意的**：管理表单必须看到「有一张图不 ready」
    并据此给出「不能发布」的提示，而不是被悄悄过滤掉后看起来像少了一张图。
    """
    if not moment_ids:
        return {}
    rows = session.execute(
        select(moment_media.c.moment_id, moment_media.c.media_id, moment_media.c.position, moment_media.c.alt)
        .where(moment_media.c.moment_id.in_(moment_ids))
        .order_by(moment_media.c.moment_id.asc(), moment_media.c.position.asc())
    ).all()
    grouped: dict[uuid.UUID, list[tuple[uuid.UUID, int, str]]] = {}
    for moment_id, media_id, position, alt in rows:
        grouped.setdefault(moment_id, []).append((media_id, int(position), str(alt)))
    return grouped


def load_media_for_preview(
    session: Session, refs: list[tuple[uuid.UUID, int, str]]
) -> list[Media]:
    """按管理关系取媒体行（**不过滤 status / deleted_at**）。

    管理预览要如实显示「这张图还没处理完 / 已被删除」，因为发布校验会因此拒绝；
    悄悄过滤会让表单看起来少一张图，且找不到原因。
    """
    wanted = [media_id for media_id, _position, _alt in refs]
    if not wanted:
        return []
    found = {
        media.id: media
        for media in session.execute(select(Media).where(Media.id.in_(wanted))).scalars()
    }
    return [found[media_id] for media_id in wanted if media_id in found]


# --- 写入校验 -------------------------------------------------------------


def _validate_text(text: str | None) -> str | None:
    """文字按纯文本处理（不接受 HTML，03 §4）；长度由 schema 与 CHECK 双重保证。"""
    if text is None:
        return None
    if len(text) > 2000:
        raise conflict("文字超过 2000 个字符", {"text": ["最多 2000 个字符"]})
    return text


def _as_image_input(image: MomentImageIn | dict) -> MomentImageIn:
    """接受 `MomentImageIn` 或它的 `model_dump()` 结果。

    为什么需要它：router 用 `payload.model_dump(exclude_unset=True)` 取「只改了哪些字段」，
    于是 `images` 到 service 时是 **dict 列表**而不是模型实例。真实浏览器联调时
    `image.media_id` 直接抛 `AttributeError`（变成 500），单测因为直接构造模型而没抓到。
    这里统一归一化，并让回归用例从 router 的入口进（见 tests/moments/test_admin_api.py
    的 `test_patch_with_images_uses_router_dumped_payload`）。
    """
    if isinstance(image, MomentImageIn):
        return image
    return MomentImageIn.model_validate(image)


def _load_ready_media(
    session: Session, images: list[MomentImageIn | dict]
) -> dict[uuid.UUID, Media]:
    """取并校验图片引用：媒体必须存在、ready、未删除；否则 409。"""
    images = [_as_image_input(image) for image in images]
    if len(images) > IMAGES_MAX:
        raise conflict(f"最多 {IMAGES_MAX} 张图片", {"images": [f"最多 {IMAGES_MAX} 张"]})
    wanted = [image.media_id for image in images]
    if len(set(wanted)) != len(wanted):
        raise conflict("同一张图片不能重复出现", {"images": ["media_id 重复"]})
    if not wanted:
        return {}
    found = {
        media.id: media
        for media in session.execute(select(Media).where(Media.id.in_(wanted))).scalars()
    }
    for media_id in wanted:
        media = found.get(media_id)
        if media is None or media.deleted_at is not None:
            raise conflict("引用的图片不存在或已删除", {"images": [f"{media_id} 不可用"]})
        if media.status != STATUS_READY:
            # 03 §5：发布前必须确认所有关联媒体为 ready；这里对草稿也拒绝，
            # 避免保存一个「看起来有图」但永远发不出去的草稿。
            raise conflict("引用的图片尚未处理完成", {"images": [f"{media_id} 未就绪"]})
    return found


def _replace_images(
    session: Session, moment: Moment, images: list[MomentImageIn | dict]
) -> None:
    """完整替换有序图片关系（05 §7）。调用方已完成媒体校验。"""
    normalized = [_as_image_input(image) for image in images]
    session.execute(delete(moment_media).where(moment_media.c.moment_id == moment.id))
    session.flush()
    for image in sorted(normalized, key=lambda item: item.position):
        session.execute(
            insert(moment_media).values(
                moment_id=moment.id,
                media_id=image.media_id,
                position=image.position,
                alt=image.alt.strip(),
            )
        )


def _replace_tags(session: Session, moment: Moment, tags: Iterable[str]) -> None:
    """完整替换标签关系。名称经 NFKC + trim + 去重（由 schema 完成）后取或建。"""
    session.execute(delete(moment_tags).where(moment_tags.c.moment_id == moment.id))
    session.flush()
    for tag in tags_service.get_or_create_tags(session, list(tags)):
        session.execute(insert(moment_tags).values(moment_id=moment.id, tag_id=tag.id))


def _commit(session: Session) -> None:
    """提交并把完整性冲突翻译成可读错误，而不是 500。"""
    try:
        session.commit()
    except IntegrityError as exc:  # pragma: no cover - 正常情况下由上面的校验拦住
        session.rollback()
        raise conflict("数据约束冲突，请检查图片顺序与标签", {"body": [type(exc).__name__]}) from None


# --- 管理写入 -------------------------------------------------------------


def create_moment(
    session: Session,
    *,
    author_id: uuid.UUID,
    text: str = "",
    images: list[MomentImageIn] | None = None,
    tags: list[str] | None = None,
) -> Moment:
    """新建草稿。创建成功返回已经提交的草稿（version=1）。"""
    image_list = list(images or [])
    _load_ready_media(session, image_list)

    moment = Moment(
        author_id=author_id,
        text=_validate_text(text) or "",
        status=STATUS_DRAFT,
        published_at=None,
    )
    session.add(moment)
    session.flush()
    if image_list:
        _replace_images(session, moment, image_list)
    if tags:
        _replace_tags(session, moment, tags)
    _commit(session)
    return moment


def update_moment(
    session: Session,
    moment: Moment,
    *,
    patch: dict,
    if_match: str | None,
) -> Moment:
    """按 `If-Match` 更新文字 / 图片 / 标签。传入 `images` 时完整替换关系。

    冲突（412）时**不做任何修改**：调用方负责保留未保存输入（05 §7）。
    """
    require_version(moment.version, if_match)

    images = patch.get("images")
    if images is not None:
        _load_ready_media(session, images)

    if "text" in patch:
        moment.text = _validate_text(patch["text"]) or ""
    if images is not None:
        _replace_images(session, moment, images)
    if patch.get("tags") is not None:
        _replace_tags(session, moment, patch["tags"])

    moment.bump_version()
    _commit(session)
    return moment


def publish_moment(session: Session, moment: Moment, *, if_match: str | None) -> Moment:
    """发布。发布门槛：1–9 张 ready 图片 —— 不满足则 409，不改状态。"""
    require_version(moment.version, if_match)

    refs = image_refs_for_moments(session, [moment.id]).get(moment.id, [])
    if len(refs) < IMAGES_MIN:
        raise conflict("发布前至少需要一张图片", {"images": ["至少 1 张图片"]})
    if len(refs) > IMAGES_MAX:
        raise conflict(f"发布时最多 {IMAGES_MAX} 张图片", {"images": [f"最多 {IMAGES_MAX} 张"]})

    media_ids = [media_id for media_id, _position, _alt in refs]
    ready = {
        media.id
        for media in session.execute(
            select(Media).where(
                Media.id.in_(media_ids),
                Media.status == STATUS_READY,
                Media.deleted_at.is_(None),
            )
        ).scalars()
    }
    unready = [str(media_id) for media_id in media_ids if media_id not in ready]
    if unready:
        raise conflict("有图片尚未处理完成，不能发布", {"images": unready})

    moment.status = STATUS_PUBLISHED
    # 服务端生成发布时间，不信任客户端时钟（03 §5）。
    moment.published_at = utcnow()
    moment.bump_version()
    _commit(session)
    return moment


def unpublish_moment(session: Session, moment: Moment, *, if_match: str | None) -> Moment:
    """撤回：回到 draft，清空发布时间。保留图片与标签关系，便于改完再发。"""
    require_version(moment.version, if_match)
    moment.status = STATUS_DRAFT
    moment.published_at = None
    moment.bump_version()
    _commit(session)
    return moment


def soft_delete_moment(session: Session, moment: Moment, *, if_match: str | None) -> None:
    """软删除。文件不物理删除（可能还有相册等公开引用），由清理任务按引用与保留期处理。"""
    require_version(moment.version, if_match)
    moment.deleted_at = utcnow()
    moment.status = STATUS_DRAFT
    moment.published_at = None
    moment.bump_version()
    _commit(session)


# --- 内容域贡献（供 public_refs / tags_source 使用）------------------------


def public_moment_exists_for_media(session: Session, media_id: uuid.UUID) -> bool:
    """该媒体是否是某条**当前公开**动态的图片（媒体公开引用检查用，只读）。

    一张图可以有多个公开引用：这里只回答「本域是否成立」，不回答「总数」。
    """
    statement = (
        select(Moment.id)
        .join(moment_media, moment_media.c.moment_id == Moment.id)
        .where(moment_media.c.media_id == media_id, *public_conditions())
        .limit(1)
    )
    return session.execute(statement).scalars().first() is not None


def public_tag_ids(session: Session) -> set[uuid.UUID]:
    """当前公开动态使用到的标签 id 集合（`GET /tags` 的公开来源之一）。

    草稿专用标签不在集合里 —— 这样 `GET /tags` 不会因为一条草稿而泄漏标签。
    """
    rows = session.execute(
        select(moment_tags.c.tag_id)
        .join(Moment, Moment.id == moment_tags.c.moment_id)
        .where(*public_conditions())
        .distinct()
    ).scalars()
    return set(rows)
