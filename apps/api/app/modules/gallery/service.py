"""相册 / 照片服务（07 §5、05 §4 / §6 / §7、05 §11）。

事务边界（与 moments / projects 同形）：一次写操作里的**标量字段、照片顺序、说明与
version 在同一个事务里提交**；发布门槛校验与状态改变也同事务完成。

公开条件（写在 SQL 里，而不是浏览器里；第三轮任务书 §4.6）：

    album: status = 'published' AND deleted_at IS NULL AND published_at <= now()
    media: status = 'ready' AND deleted_at IS NULL
    source: 存在独立来源
            OR 存在指向「当前相册 + 当前媒体」且动态当前公开未删除的动态来源

这三段条件由 `gallery.sources.public_source_exists` 统一提供，相册列表 / 详情 / 封面 /
数量 / 照片墙 / 分页 / 年份筛选 / 媒体权限检查共用，不在别处复制一份。

**同一张图被多处引用**（07 §5、05 §11、验收 2 / 3）：

  - `album_media.media_id` 指向**已有** media，相册不复制文件、不重复上传；
  - 同一张图可以同时出现在动态、相册、作品里：每处的关系行独立保存 `position`、
    `caption`、`alt`、`taken_on`，所以「说明可按使用场景分别填写」成立，而文件只有一套；
  - 匿名能否读这张图由 `media.public_refs` 把各域取「或」决定：撤回**一处**只移除那处
    引用，全部撤回后匿名才 404；原图永远只给站主（T01 的 `ensure_anonymous_readable`）。

**两套排序，各自语义清楚**（不要混用，否则「照片墙」会变成随机顺序）：

  1. 相册内 / 指定相册的照片墙：按**手工顺序** `album_media.position`；
  2. 跨相册的照片墙（默认）：**先按 `media_id` 去重**（任务书 §4.1：同一张图只出现一次），
     主要归属为 `(albums.position ASC, albums.id ASC)` 最前的公开有效相册；再按拍摄日期
     （`taken_on` 可空，空值最后）→ 入库时间倒序 → 主归属相册 position → 相册内 position
     → media_id 稳定排序。
  游标版本分别是 1 / 3，筛选指纹包含 scope，因此两种游标互换会得到 400 而不是错页。

**N3 迁移影响**：新增 `album_media_sources`（1 张表 + 3 个索引）并把迁移前已存在的
`album_media` 行全部回填为独立来源；不修改任何既有表结构。
"""

from __future__ import annotations

import base64
import binascii
import json
import uuid
from collections.abc import Iterable, Sequence
from datetime import date, datetime, timezone

from sqlalchemy import (
    Date,
    Select,
    cast,
    delete,
    desc,
    extract,
    func,
    insert,
    literal,
    select,
    tuple_,
)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.db import utcnow
from app.core.errors import CODE_CONFLICT, CODE_NOT_FOUND, CODE_VALIDATION_FAILED, ApiError
from app.core.pagination import (
    DEFAULT_LIMIT,
    MAX_LIMIT,
    decode_cursor,
    encode_cursor,
    filter_fingerprint,
)
from app.core.preconditions import require_version
from app.modules.gallery import sources
from app.modules.gallery.models import (
    ALBUM_KINDS,
    KIND_LABELS,
    MAX_MEDIA_PER_ALBUM,
    STATUS_DRAFT,
    STATUS_PUBLISHED,
    Album,
    album_media,
)
from app.modules.gallery.schemas import (
    PHOTOS_MAX_LIMIT,
    AlbumPhotoIn,
    PhotoAdminOut,
    PhotoOut,
    PhotoSourceOut,
    album_admin_out,
    album_detail_out,
    album_summary_out,
    photo_admin_payload,
    photo_payload,
)
from app.modules.media.models import STATUS_READY, Media

# --- 游标 -------------------------------------------------------------------

ALBUM_CURSOR_VERSION = 1
# 跨相册照片墙的排序键是**五元组** `(taken_on 序号, 入库时间, 相册顺序, 照片顺序, media_id)`，
# core 的两元组游标表达不了；这里自带一个同形游标（与 T04 的 nav 搜索同样的做法）。
#
# 版本 3（第三轮 N3）：全局照片墙改为**按 media_id 去重**（同一张图只出现一次，主要归属
# 排序最前的公开有效相册）。排序语义变了，旧游标必须明确报错而不是错页。
PHOTO_CURSOR_VERSION = 3

# 排序键的版本号：换排序规则时递增，旧游标会明确报错而不是错页。
PHOTO_SORT_GLOBAL = 1
PHOTO_SORT_ALBUM = 2

SCOPE_GLOBAL = "global"
SCOPE_ALBUM = "album"
SCOPES = (SCOPE_GLOBAL, SCOPE_ALBUM)


def not_found(message: str = "相册不存在或不可访问") -> ApiError:
    """公开读不到与站主读不到管理资源统一用它 —— 不区分「不存在」与「无权」。"""
    return ApiError(CODE_NOT_FOUND, message, status_code=404)


def conflict(message: str, fields: dict | None = None) -> ApiError:
    """业务冲突：slug 占用、照片未 ready、发布门槛不满足（05 §9 的 409）。"""
    return ApiError(CODE_CONFLICT, message, status_code=409, fields=fields)


def _bad_cursor(message: str = "游标无效，请从第一页重新开始") -> ApiError:
    return ApiError(CODE_VALIDATION_FAILED, message, status_code=400, fields={"cursor": [message]})


def _unprocessable(message: str, field: str) -> ApiError:
    return ApiError(
        CODE_VALIDATION_FAILED, message, status_code=422, fields={field: [message]}
    )


# --- 查询基础 -------------------------------------------------------------


def clamp_limit(limit: int | None) -> int:
    if limit is None:
        return DEFAULT_LIMIT
    return max(1, min(int(limit), MAX_LIMIT))


def clamp_photo_limit(limit: int | None) -> int:
    """照片墙的 limit 上限比普通列表宽（60），但仍受 PHOTOS_MAX_LIMIT 保护。"""
    if limit is None:
        return 24
    return max(1, min(int(limit), 60, PHOTOS_MAX_LIMIT))


def public_conditions(now: datetime | None = None) -> list:
    moment = now or utcnow()
    return [
        Album.status == STATUS_PUBLISHED,
        Album.deleted_at.is_(None),
        Album.published_at.is_not(None),
        Album.published_at <= moment,
    ]


def public_album_fingerprint(kind: str | None) -> str:
    return filter_fingerprint({"scope": "albums", "kind": kind})


def list_public_albums(
    session: Session,
    *,
    kind: str | None = None,
    cursor: str | None = None,
    limit: int | None = None,
    now: datetime | None = None,
) -> tuple[list[Album], str | None]:
    """公开相册列表：`(published_at DESC, id DESC)` + 不透明游标。

    排序用发布时间而不是手工 position：游客视角「最近更新的相册在前」比站主维护的
    position 更有意义；相册内部的照片顺序才用 position（见模块 docstring）。
    """
    bounded = clamp_limit(limit)
    fingerprint = public_album_fingerprint(kind)

    statement: Select = select(Album).where(*public_conditions(now))
    if kind:
        statement = statement.where(Album.kind == kind)
    if cursor:
        sort_value, entity_id = decode_cursor(cursor, fingerprint=fingerprint)
        statement = statement.where(
            tuple_(Album.published_at, Album.id) < tuple_(sort_value, entity_id)
        )
    statement = statement.order_by(Album.published_at.desc(), Album.id.desc()).limit(bounded + 1)
    rows = list(session.execute(statement).scalars().all())

    next_cursor: str | None = None
    if len(rows) > bounded:
        rows = rows[:bounded]
        last = rows[-1]
        next_cursor = encode_cursor(
            sort_value=last.published_at, entity_id=last.id, fingerprint=fingerprint
        )
    return rows, next_cursor


def get_public_album(session: Session, slug: str, *, now: datetime | None = None) -> Album | None:
    """按 slug 取公开相册。草稿 / 已撤回 / 已删除 / 未到发布时间都返回 None（统一 404）。"""
    return (
        session.execute(select(Album).where(Album.slug == slug, *public_conditions(now)))
        .scalars()
        .first()
    )


def get_admin_album(session: Session, album_id: uuid.UUID) -> Album | None:
    """管理读取：任何状态都能取到，但已软删除的不再返回。"""
    return (
        session.execute(select(Album).where(Album.id == album_id, Album.deleted_at.is_(None)))
        .scalars()
        .first()
    )


def get_album_by_slug(session: Session, slug: str) -> Album | None:
    return session.execute(select(Album).where(Album.slug == slug)).scalars().first()


def list_admin_albums(
    session: Session,
    *,
    status: str | None = None,
    kind: str | None = None,
    cursor: str | None = None,
    limit: int | None = None,
) -> tuple[list[Album], str | None]:
    """管理列表：草稿与已发布都在，按 `(position ASC, id ASC)` 排序（站主维护顺序）。"""
    bounded = clamp_limit(limit)
    fingerprint = filter_fingerprint({"scope": "admin-albums", "status": status, "kind": kind})

    statement: Select = select(Album).where(Album.deleted_at.is_(None))
    if status:
        statement = statement.where(Album.status == status)
    if kind:
        statement = statement.where(Album.kind == kind)
    if cursor:
        position, entity_id = decode_position_cursor(cursor, fingerprint=fingerprint)
        statement = statement.where(
            tuple_(Album.position, Album.id) > tuple_(position, entity_id)
        )
    statement = statement.order_by(Album.position.asc(), Album.id.asc()).limit(bounded + 1)
    rows = list(session.execute(statement).scalars().all())

    next_cursor: str | None = None
    if len(rows) > bounded:
        rows = rows[:bounded]
        last = rows[-1]
        next_cursor = encode_position_cursor(
            position=int(last.position), entity_id=last.id, fingerprint=fingerprint
        )
    return rows, next_cursor


# --- 顺序游标（position 为主键的列表）--------------------------------------


def encode_position_cursor(*, position: int, entity_id: uuid.UUID, fingerprint: str) -> str:
    """按手工顺序分页用的游标：排序键是 `(position, id)`，不是时间。

    `album_media.position` 与 `albums.position` 都可能有相同取值，因此必须带上 id
    作为第二排序键，否则「相邻两条同 position」会在翻页时漏项。
    """
    payload = {
        "v": ALBUM_CURSOR_VERSION,
        "p": int(position),
        "i": str(entity_id),
        "f": fingerprint,
    }
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def decode_position_cursor(cursor: str, *, fingerprint: str) -> tuple[int, uuid.UUID]:
    candidate = (cursor or "").strip()
    if not candidate or len(candidate) > 512:
        raise _bad_cursor()
    padding = "=" * (-len(candidate) % 4)
    try:
        payload = json.loads(base64.urlsafe_b64decode(candidate + padding))
    except (binascii.Error, ValueError, UnicodeDecodeError):
        raise _bad_cursor() from None
    if not isinstance(payload, dict) or payload.get("v") != ALBUM_CURSOR_VERSION:
        raise _bad_cursor()
    if payload.get("f") != fingerprint:
        raise ApiError(
            CODE_VALIDATION_FAILED,
            "游标与当前筛选条件不一致，请从第一页重新开始",
            status_code=400,
            fields={"cursor": ["游标与当前筛选条件不一致，请从第一页重新开始"]},
        )
    try:
        position = int(payload["p"])
        entity_id = uuid.UUID(str(payload["i"]))
    except (KeyError, ValueError, TypeError):
        raise _bad_cursor() from None
    if position < 0:
        raise _bad_cursor()
    return position, entity_id


# --- 照片墙游标 -------------------------------------------------------------


def photos_fingerprint(
    *,
    scope: str,
    album: str | None,
    kind: str | None,
    year: int | None,
    month: int | None,
) -> str:
    return filter_fingerprint(
        {
            "scope": scope,
            "album": album,
            "kind": kind,
            "year": year,
            "month": month,
        }
    )


def encode_photo_cursor(
    *,
    sort_version: int,
    primary: int,
    secondary: datetime,
    album_position: int,
    photo_position: int,
    entity_id: uuid.UUID,
    fingerprint: str,
) -> str:
    """照片墙游标：排序键是五元组，core 的两元组游标表达不了。

    `primary` 是排序主键的整数投影：
      - 全局 scope：`taken_on` 的 ordinal（可空 → 用极小值，排在最后）；
      - 相册 scope：相册的 `position`。
    这样两种 scope 共用一个编解码器，用 `sort_version` 区分语义。
    """
    payload = {
        "v": PHOTO_CURSOR_VERSION,
        "t": int(sort_version),
        "a": int(primary),
        "s": secondary.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "ap": int(album_position),
        "pp": int(photo_position),
        "i": str(entity_id),
        "f": fingerprint,
    }
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


class PhotoCursor:
    __slots__ = (
        "sort_version",
        "primary",
        "secondary",
        "album_position",
        "photo_position",
        "entity_id",
    )

    def __init__(
        self,
        *,
        sort_version: int,
        primary: int,
        secondary: datetime,
        album_position: int,
        photo_position: int,
        entity_id: uuid.UUID,
    ) -> None:
        self.sort_version = sort_version
        self.primary = primary
        self.secondary = secondary
        self.album_position = album_position
        self.photo_position = photo_position
        self.entity_id = entity_id


def decode_photo_cursor(cursor: str, *, fingerprint: str) -> PhotoCursor:
    candidate = (cursor or "").strip()
    if not candidate or len(candidate) > 512:
        raise _bad_cursor()
    padding = "=" * (-len(candidate) % 4)
    try:
        payload = json.loads(base64.urlsafe_b64decode(candidate + padding))
    except (binascii.Error, ValueError, UnicodeDecodeError):
        raise _bad_cursor() from None
    if not isinstance(payload, dict) or payload.get("v") != PHOTO_CURSOR_VERSION:
        raise _bad_cursor()
    if payload.get("f") != fingerprint:
        raise ApiError(
            CODE_VALIDATION_FAILED,
            "游标与当前筛选条件不一致，请从第一页重新开始",
            status_code=400,
            fields={"cursor": ["游标与当前筛选条件不一致，请从第一页重新开始"]},
        )
    try:
        sort_version = int(payload["t"])
        primary = int(payload["a"])
        secondary = datetime.fromisoformat(str(payload["s"]).replace("Z", "+00:00"))
        album_position = int(payload["ap"])
        photo_position = int(payload["pp"])
        entity_id = uuid.UUID(str(payload["i"]))
    except (KeyError, ValueError, TypeError):
        raise _bad_cursor() from None
    if secondary.tzinfo is None or sort_version not in (PHOTO_SORT_GLOBAL, PHOTO_SORT_ALBUM):
        raise _bad_cursor()
    if min(album_position, photo_position) < 0:
        raise _bad_cursor()
    return PhotoCursor(
        sort_version=sort_version,
        primary=primary,
        secondary=secondary.astimezone(timezone.utc),
        album_position=album_position,
        photo_position=photo_position,
        entity_id=entity_id,
    )


# --- 照片读取 -------------------------------------------------------------


PhotoRow = tuple[Album, Media, int, str, str, date | None]


def _public_photo_condition(now: datetime | None = None):
    """统一公开条件的后半句（任务书 §4.6）：当前相册 + 当前媒体存在有效公开来源。

    相册状态 / 媒体 ready 等条件仍由各查询自己带；这里只拼「来源」这一半，
    保证相册列表、相册详情、照片墙、年份筛选、媒体权限检查用的是同一段 SQL。
    """
    return sources.public_source_exists(
        now=now,
        album_id=album_media.c.album_id,
        media_id=album_media.c.media_id,
    )


def _photo_join_statement(
    album_ids: Sequence[uuid.UUID] | None = None, *, now: datetime | None = None
) -> Select:
    statement = (
        select(
            Album,
            Media,
            album_media.c.position,
            album_media.c.alt,
            album_media.c.caption,
            album_media.c.taken_on,
        )
        .join(album_media, album_media.c.album_id == Album.id)
        .join(Media, Media.id == album_media.c.media_id)
        .where(
            Media.deleted_at.is_(None),
            Media.status == STATUS_READY,
            _public_photo_condition(now),
        )
    )
    if album_ids is not None:
        statement = statement.where(Album.id.in_(list(album_ids)))
    return statement


def _photo_rows(session: Session, statement: Select) -> list[PhotoRow]:
    """执行查询并把行归一成 `PhotoRow`（position 一定是 int，文本一定是 str）。"""
    return [
        (album, media, int(position), str(alt), str(caption), taken_on)
        for album, media, position, alt, caption, taken_on in session.execute(statement).all()
    ]


def public_photos_for_albums(
    session: Session, album_ids: Sequence[uuid.UUID], *, now: datetime | None = None
) -> dict[uuid.UUID, list[PhotoOut]]:
    """批量取每个相册的有序**公开可展示**照片（ready + 有有效公开来源）。"""
    if not album_ids:
        return {}
    rows = _photo_rows(
        session,
        _photo_join_statement(album_ids, now=now).order_by(
            album_media.c.album_id.asc(), album_media.c.position.asc()
        ),
    )
    grouped: dict[uuid.UUID, list[PhotoOut]] = {}
    for album, media, position, alt, caption, taken_on in rows:
        grouped.setdefault(album.id, []).append(
            photo_payload(media, position=position, alt=alt, caption=caption, taken_on=taken_on)
        )
    return grouped


def photo_refs_for_albums(
    session: Session, album_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[tuple[uuid.UUID, int, str, str, date | None]]]:
    """管理用：**不过滤** media 状态，如实返回已保存的顺序关系。"""
    if not album_ids:
        return {}
    rows = session.execute(
        select(
            album_media.c.album_id,
            album_media.c.media_id,
            album_media.c.position,
            album_media.c.alt,
            album_media.c.caption,
            album_media.c.taken_on,
        )
        .where(album_media.c.album_id.in_(list(album_ids)))
        .order_by(album_media.c.album_id.asc(), album_media.c.position.asc())
    ).all()
    grouped: dict[uuid.UUID, list[tuple[uuid.UUID, int, str, str, date | None]]] = {}
    for album_id, media_id, position, alt, caption, taken_on in rows:
        grouped.setdefault(album_id, []).append(
            (media_id, int(position), str(alt), str(caption), taken_on)
        )
    return grouped


def load_media_rows(session: Session, media_ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, Media]:
    """按 ID 取媒体行（**不过滤** status / deleted_at，供管理预览）。"""
    wanted = list(dict.fromkeys(media_ids))
    if not wanted:
        return {}
    return {
        media.id: media
        for media in session.execute(select(Media).where(Media.id.in_(wanted))).scalars()
    }


def admin_photos_for_albums(
    session: Session, albums: Sequence[Album]
) -> dict[uuid.UUID, list[PhotoAdminOut]]:
    album_ids = [album.id for album in albums]
    refs = photo_refs_for_albums(session, album_ids)
    sources_by_photo = sources.sources_for_album_photos(session, album_ids)
    by_id = {album.id: album for album in albums}
    media_by_id = load_media_rows(
        session, [ref[0] for group in refs.values() for ref in group]
    )
    result: dict[uuid.UUID, list[PhotoAdminOut]] = {}
    for album_id, group in refs.items():
        album = by_id.get(album_id)
        payloads: list[PhotoAdminOut] = []
        for media_id, position, alt, caption, taken_on in group:
            media = media_by_id.get(media_id)
            if media is None:
                # 媒体行被物理删除（理论上被 FK RESTRICT 拦住）：如实跳过并留痕，
                # 而不是伪造一张不存在的图。
                continue
            payloads.append(
                photo_admin_payload(
                    media,
                    position=position,
                    alt=alt,
                    caption=caption,
                    taken_on=taken_on,
                    album=album,
                    sources=[
                        PhotoSourceOut(kind=kind, moment_id=moment_id)
                        for kind, moment_id in sources_by_photo.get(
                            (album_id, media_id), []
                        )
                    ],
                )
            )
        result[album_id] = payloads
    return result


# --- 照片墙（跨相册 / 单相册两个 scope）------------------------------------


_TAKEN_ON_MIN = date.min


def _taken_on_ordinal(value: date | None) -> int:
    """可空拍摄日期 → 可比较的整数。空值排在**最后**（未知日期不该假装最新）。"""
    return -1 if value is None else value.toordinal()


def _taken_on_from_ordinal(value: int) -> date | None:
    if value < 0:
        return None
    try:
        return date.fromordinal(value)
    except ValueError:  # pragma: no cover - 游标被篡改
        return None


def _primary_album_media_subquery(*, now: datetime | None = None, kind: str | None = None):
    """全局照片墙的「主要归属」子查询：每个 media_id 只保留一行。

    「主要归属」= 该媒体所有**公开且来源有效**的相册里 `(albums.position ASC, albums.id ASC)`
    最靠前的那一个（任务书 §4.1「使用排序最前的公开且有效相册作为主要归属；相册排序相同时
    使用稳定的次级排序」）。用窗口函数在 SQL 里先去重，因此查询、分页、总数三者天然一致，
    不是前端拿到一页后临时去重。

    返回的子查询列：`album_id / media_id / photo_position / alt / caption / taken_on`。
    """
    ranked = (
        select(
            album_media.c.album_id.label("album_id"),
            album_media.c.media_id.label("media_id"),
            album_media.c.position.label("photo_position"),
            album_media.c.alt.label("alt"),
            album_media.c.caption.label("caption"),
            album_media.c.taken_on.label("taken_on"),
            func.row_number()
            .over(
                partition_by=album_media.c.media_id,
                order_by=(
                    Album.position.asc(),
                    Album.id.asc(),
                    album_media.c.position.asc(),
                ),
            )
            .label("row_number"),
        )
        .join(Album, Album.id == album_media.c.album_id)
        .join(Media, Media.id == album_media.c.media_id)
        .where(
            *public_conditions(now),
            Media.deleted_at.is_(None),
            Media.status == STATUS_READY,
            _public_photo_condition(now),
        )
    )
    if kind:
        # 类型筛选在「选主要归属」之前生效：筛游戏截图时，一张同时属于摄影相册的图
        # 会把截图相册作为它在这个筛选下的归属，而不是被摄影相册抢走。
        ranked = ranked.where(Album.kind == kind)
    ranked_subquery = ranked.subquery("ranked_album_media")
    return (
        select(ranked_subquery)
        .where(ranked_subquery.c.row_number == 1)
        .subquery("primary_album_media")
    )


def _apply_primary_year_filter(statement: Select, primary, *, year: int | None, month: int | None) -> Select:
    if year is None:
        return statement
    lower, upper = _month_bounds(year, month)
    return statement.where(
        primary.c.taken_on.is_not(None),
        primary.c.taken_on >= lower,
        primary.c.taken_on < upper,
    )


def _count_primary_photos(
    session: Session, primary, *, year: int | None, month: int | None
) -> int:
    """全局照片墙总数 = 去重后（每个 media_id 一行）仍满足年份筛选的媒体数。"""
    statement = _apply_primary_year_filter(
        select(primary.c.media_id), primary, year=year, month=month
    )
    return int(
        session.execute(select(func.count()).select_from(statement.subquery())).scalars().one()
    )


def list_wall_photos(
    session: Session,
    *,
    scope: str = SCOPE_GLOBAL,
    album_slug: str | None = None,
    kind: str | None = None,
    year: int | None = None,
    month: int | None = None,
    cursor: str | None = None,
    limit: int | None = None,
    now: datetime | None = None,
) -> tuple[list[tuple[Album, PhotoOut]], str | None, int]:
    """照片墙。返回 `(items, next_cursor, total)`。

    **两个 scope 的排序 / 去重语义不同，这是刻意的**：

      - `scope=global`（默认，跨相册）：先按 `media_id` **去重**（同一张图只出现一次，
        主要归属见 `_primary_album_media_subquery`），再按
        `taken_on DESC NULLS LAST` → 入库时间倒序 → 主要归属相册 position →
        相册内 position → media_id 排序。这是「照片墙」的自然阅读顺序。
      - `scope=album`（指定某个相册）：按**手工顺序** `album_media.position`；单相册内
        media_id 天然唯一，不涉及去重，该相册的说明与排序原样保留。

    两次查询都只包含**公开相册 + ready 未删除媒体 + 有效公开来源**；草稿相册、
    只有草稿 / 撤回动态来源的照片不会出现。

    `total` 是当前筛选下的实时总数（与查询同源，分页不会把同一张图数两次）。
    """
    bounded = clamp_photo_limit(limit)
    fingerprint = photos_fingerprint(
        scope=scope, album=album_slug, kind=kind, year=year, month=month
    )

    if scope == SCOPE_ALBUM:
        sort_version = PHOTO_SORT_ALBUM
        base = _photo_join_statement(now=now).where(
            *public_conditions(now), Album.slug == album_slug
        )
        if kind:
            base = base.where(Album.kind == kind)
        if year is not None:
            # `month` 只在给了 `year` 时有意义：单独给 month 会被 router 拒绝（422）。
            lower, upper = _month_bounds(year, month)
            base = base.where(
                album_media.c.taken_on.is_not(None),
                album_media.c.taken_on >= lower,
                album_media.c.taken_on < upper,
            )
        total = _count_wall_photos(session, base)
        statement = base.order_by(
            Album.position.asc(),
            album_media.c.position.asc(),
            Album.id.asc(),
            album_media.c.media_id.asc(),
        )
        if cursor:
            parsed = decode_photo_cursor(cursor, fingerprint=fingerprint)
            if parsed.sort_version != sort_version:
                raise _bad_cursor("游标与当前排序不一致，请从第一页重新开始")
            statement = statement.where(
                tuple_(
                    Album.position,
                    album_media.c.position,
                    Album.id,
                    album_media.c.media_id,
                )
                > tuple_(
                    parsed.album_position,
                    parsed.photo_position,
                    parsed.entity_id,
                    parsed.entity_id,
                )
            )
        rows = _photo_rows(session, statement.limit(bounded + 1))
        next_cursor: str | None = None
        if len(rows) > bounded:
            rows = rows[:bounded]
            last_album, last_media, last_position, _alt, _caption, _last_taken = rows[-1]
            next_cursor = encode_photo_cursor(
                sort_version=sort_version,
                primary=int(last_album.position),
                secondary=last_media.created_at,
                album_position=int(last_album.position),
                photo_position=last_position,
                entity_id=last_media.id,
                fingerprint=fingerprint,
            )
    else:
        sort_version = PHOTO_SORT_GLOBAL
        primary = _primary_album_media_subquery(now=now, kind=kind)
        total = _count_primary_photos(session, primary, year=year, month=month)
        statement = _apply_primary_year_filter(
            select(
                Album,
                Media,
                primary.c.photo_position,
                primary.c.alt,
                primary.c.caption,
                primary.c.taken_on,
            )
            .join(Album, Album.id == primary.c.album_id)
            .join(Media, Media.id == primary.c.media_id),
            primary,
            year=year,
            month=month,
        )
        # 排序键：拍摄日期（空值最后）→ 入库时间 → 主要归属相册 position →
        # 相册内 position → media_id。用 coalesce 把 NULL 统一成 sentinel 日期，
        # 保证 PostgreSQL 侧排序与 Python 侧游标比较规则**完全一致**。
        taken_on_key = _taken_on_sort_key(primary.c.taken_on)
        statement = statement.order_by(
            taken_on_key.desc(),
            Media.created_at.desc(),
            Album.position.asc(),
            primary.c.photo_position.asc(),
            primary.c.media_id.asc(),
        )
        if cursor:
            parsed = decode_photo_cursor(cursor, fingerprint=fingerprint)
            if parsed.sort_version != sort_version:
                raise _bad_cursor("游标与当前排序不一致，请从第一页重新开始")
            statement = statement.where(
                tuple_(
                    taken_on_key,
                    Media.created_at,
                    Album.position,
                    primary.c.photo_position,
                    primary.c.media_id,
                )
                < tuple_(
                    _sentinel_date(parsed.primary),
                    parsed.secondary,
                    parsed.album_position,
                    parsed.photo_position,
                    parsed.entity_id,
                )
            )
        rows = _photo_rows(session, statement.limit(bounded + 1))
        next_cursor = None
        if len(rows) > bounded:
            rows = rows[:bounded]
            last_album, last_media, last_position, _alt, _caption, last_taken = rows[-1]
            next_cursor = encode_photo_cursor(
                sort_version=sort_version,
                primary=_taken_on_ordinal(last_taken),
                secondary=last_media.created_at,
                album_position=int(last_album.position),
                photo_position=last_position,
                entity_id=last_media.id,
                fingerprint=fingerprint,
            )

    items = [
        (
            album,
            photo_payload(media, position=position, alt=alt, caption=caption, taken_on=taken_on),
        )
        for album, media, position, alt, caption, taken_on in rows
    ]
    return items, next_cursor, total


def _sentinel_date(ordinal: int) -> date:
    """游标里的拍摄日期序号 → 可比日期。`-1` 代表「没有拍摄日期」。"""
    if ordinal < 0:
        return date.min
    return date.fromordinal(ordinal) if ordinal <= date.max.toordinal() else date.max


def _taken_on_sort_key(column=None):
    """`coalesce(taken_on, DATE '0001-01-01')`：与 `_sentinel_date` 的规则一致。"""
    target = album_media.c.taken_on if column is None else column
    return func.coalesce(target, cast(literal("0001-01-01"), Date))


def _month_bounds(year: int, month: int | None) -> tuple[date, date]:
    if month is None:
        return date(year, 1, 1), date(year + 1, 1, 1)
    if month == 12:
        return date(year, 12, 1), date(year + 1, 1, 1)
    return date(year, month, 1), date(year, month + 1, 1)


def _count_wall_photos(session: Session, statement: Select) -> int:
    inner = statement.with_only_columns(
        album_media.c.album_id, album_media.c.media_id
    ).order_by(None)
    return int(
        session.execute(select(func.count()).select_from(inner.subquery())).scalars().one()
    )


def wall_filter_years(session: Session, *, now: datetime | None = None) -> list[int]:
    """照片墙可用的年份（只统计**实际可展示**、且有拍摄日期的照片）。

    用与全局照片墙相同的主要归属去重：年份选项必须来自实际能看到的图片，
    不能因为某张图在第二个相册里重复出现就多出一个点了筛不出东西的年份。
    """
    primary = _primary_album_media_subquery(now=now)
    statement = (
        select(extract("year", primary.c.taken_on).label("y"))
        .select_from(primary)
        .where(primary.c.taken_on.is_not(None))
        .distinct()
        .order_by(desc("y"))
    )
    return [int(row) for row in session.execute(statement).scalars()]


# --- 公开组合输出 -----------------------------------------------------------


def public_album_summaries(
    session: Session, albums: Sequence[Album], *, now: datetime | None = None
):
    photos = public_photos_for_albums(session, [album.id for album in albums], now=now)
    return [
        album_summary_out(album, photos=photos.get(album.id, [])) for album in albums
    ]


def public_album_detail(session: Session, album: Album, *, now: datetime | None = None):
    photos = public_photos_for_albums(session, [album.id], now=now).get(album.id, [])
    return album_detail_out(album, photos=photos)


def admin_album_list_out(session: Session, albums: Sequence[Album]):
    photos = admin_photos_for_albums(session, albums)
    return [album_admin_out(album, photos=photos.get(album.id, [])) for album in albums]


def admin_album_out(session: Session, album: Album):
    photos = admin_photos_for_albums(session, [album]).get(album.id, [])
    return album_admin_out(album, photos=photos)


# --- 写入校验 -------------------------------------------------------------


def _as_photo_input(photo: AlbumPhotoIn | dict) -> AlbumPhotoIn:
    """接受 `AlbumPhotoIn` 或它的 `model_dump()` 结果。

    为什么需要它（T03 的真实缺陷）：router 用 `payload.model_dump(exclude_unset=True)`
    取「只改了哪些字段」，于是 `photos` 到 service 时是 **dict 列表**而不是模型实例，
    直接访问 `.media_id` 会变成 500（AttributeError）。这里统一归一化，
    回归用例从 router 的入口进。
    """
    if isinstance(photo, AlbumPhotoIn):
        return photo
    return AlbumPhotoIn.model_validate(photo)


def _normalize_photos(
    session: Session, photos: Iterable[AlbumPhotoIn | dict]
) -> list[AlbumPhotoIn]:
    normalized = [_as_photo_input(photo) for photo in photos]
    if len(normalized) > MAX_MEDIA_PER_ALBUM:
        raise conflict(
            f"最多 {MAX_MEDIA_PER_ALBUM} 张照片",
            {"photos": [f"最多 {MAX_MEDIA_PER_ALBUM} 张"]},
        )
    media_ids = [photo.media_id for photo in normalized]
    if len(set(media_ids)) != len(media_ids):
        raise conflict("同一张图片不能在一个相册里重复出现", {"photos": ["media_id 重复"]})
    positions = [photo.position for photo in normalized]
    if len(set(positions)) != len(positions):
        raise conflict("照片顺序不能重复", {"photos": ["position 重复"]})
    if not media_ids:
        return normalized
    found = load_media_rows(session, media_ids)
    for photo in normalized:
        media = found.get(photo.media_id)
        if media is None or media.deleted_at is not None:
            raise conflict("引用的图片不存在或已删除", {"photos": [f"{photo.media_id} 不可用"]})
        if media.status != STATUS_READY:
            raise conflict("引用的图片尚未处理完成", {"photos": [f"{photo.media_id} 未就绪"]})
    return normalized


def _replace_photos(session: Session, album: Album, photos: Sequence[AlbumPhotoIn]) -> None:
    session.execute(delete(album_media).where(album_media.c.album_id == album.id))
    session.flush()
    for photo in sorted(photos, key=lambda item: item.position):
        session.execute(
            insert(album_media).values(
                album_id=album.id,
                media_id=photo.media_id,
                position=photo.position,
                alt=photo.alt.strip(),
                caption=photo.caption.strip() if photo.caption else "",
                taken_on=photo.taken_on,
            )
        )


def _sync_album_photos(
    session: Session, album: Album, photos: Sequence[AlbumPhotoIn]
) -> set[uuid.UUID]:
    """完整替换相册显示关系，并同步收录来源（任务书 §4.5 / §4.7）。

    语义刻意分成三种（不能一律「先删后加」，否则会破坏来源表达）：

      - 移除项：删显示关系 + 该「相册 + 媒体」的全部来源 + 所有动态侧收录配置
        （返回配置被删的动态 id，调用方据此 bump 版本 → 旧动态表单拿不到静默加回的机会）；
      - 保留项：只更新 position / alt / caption / taken_on，**来源保持原样** ——
        不会把「动态收录」的图在相册表单保存时升格成独立来源；
      - 新增项：补独立来源（相册管理端显式加入的图片）。

    显示关系仍然整组重写（与既有实现一致），因为 position 是完整替换语义、且
    `album_media` 没有其他外键依赖；来源表不依赖 `album_media`，所以重写不丢来源。
    """
    previous_ids = sources.album_media_ids(session, album.id)
    new_ids = [photo.media_id for photo in photos]
    removed_ids = previous_ids - set(new_ids)
    added_ids = [media_id for media_id in new_ids if media_id not in previous_ids]

    affected_moments = sources.detach_album_media(
        session, album_id=album.id, media_ids=sorted(removed_ids)
    )
    _replace_photos(session, album, photos)
    if added_ids:
        sources.ensure_independent_sources(
            session, album_id=album.id, media_ids=added_ids
        )
    return affected_moments


def _check_slug_available(
    session: Session, slug: str, *, exclude_id: uuid.UUID | None = None
) -> None:
    statement = select(Album.id).where(Album.slug == slug)
    if exclude_id is not None:
        statement = statement.where(Album.id != exclude_id)
    if session.execute(statement).first() is not None:
        raise conflict("这个 slug 已被占用", {"slug": ["已存在同 slug 的相册"]})


def next_album_position(session: Session, *, kind: str) -> int:
    """新建相册时的默认 position：同类型里最大的 +1（站主不用手填也不会撞车）。"""
    current = session.execute(
        select(func.max(Album.position)).where(Album.kind == kind)
    ).scalars().one()
    return 0 if current is None else int(current) + 1


def _commit(session: Session, *entities: object) -> None:
    """提交。`entities` 里的对象在提交后 `refresh()` 一次。

    为什么需要 refresh：`albums.position` 的默认值在 Python 侧算（`next_album_position`
    的 `max(position)+1`），`expire_on_commit=True` 会让响应序列化时再查一次库 ——
    在事务夹具里拿到的是别的事务看不到的中间状态，于是管理回执会给出**过期的 position**。
    显式 refresh 让回执与库里的行一致。
    """
    try:
        session.commit()
    except IntegrityError as exc:  # pragma: no cover - 正常情况下由上面的校验拦住
        session.rollback()
        raise conflict("数据约束冲突，请检查 slug 与照片顺序", {"body": [type(exc).__name__]}) from None
    for entity in entities:
        try:
            session.refresh(entity)
        except Exception:  # pragma: no cover - 刷新失败不应该改变「已经提交成功」这个事实
            pass


# --- 管理写入 -------------------------------------------------------------


def create_album(
    session: Session,
    *,
    slug: str,
    title: str,
    description: str = "",
    kind: str = "photo",
    position: int | None = None,
    photos: Sequence[AlbumPhotoIn | dict] | None = None,
) -> Album:
    """新建**草稿**（与 moments / nav / projects 一致）。"""
    normalized_slug = slug.strip()
    _check_slug_available(session, normalized_slug)
    if kind not in ALBUM_KINDS:
        raise conflict("相册类型不合法", {"kind": [f"只能是 {' / '.join(ALBUM_KINDS)}"]})
    photo_list = _normalize_photos(session, photos or [])

    album = Album(
        slug=normalized_slug,
        title=title.strip(),
        description=description.strip(),
        kind=kind,
        position=next_album_position(session, kind=kind) if position is None else int(position),
        status=STATUS_DRAFT,
        published_at=None,
    )
    session.add(album)
    session.flush()
    if photo_list:
        _replace_photos(session, album, photo_list)
        sources.ensure_independent_sources(
            session, album_id=album.id, media_ids=[photo.media_id for photo in photo_list]
        )
    _commit(session, album)
    return album


def update_album(
    session: Session, album: Album, *, patch: dict, if_match: str | None
) -> Album:
    """按 `If-Match` 更新。传入 `photos` 时**完整替换**有序关系（05 §7）。

    传 `photos` 时还会同步收录来源与**受影响的动态版本**（任务书 §4.5 / §4.7）：
    相册侧移除的图片会同时清掉动态侧收录配置，因此相关动态 version +1 ——
    另一个浏览器里开着的旧动态表单再保存会得到 412，而不能无提示地把图片加回来。
    """
    require_version(album.version, if_match)

    photos = patch.get("photos")
    normalized_photos = None if photos is None else _normalize_photos(session, photos)
    if patch.get("kind") is not None and patch["kind"] not in ALBUM_KINDS:
        raise conflict("相册类型不合法", {"kind": [f"只能是 {' / '.join(ALBUM_KINDS)}"]})

    if "title" in patch and patch["title"] is not None:
        album.title = str(patch["title"]).strip()
    if "description" in patch and patch["description"] is not None:
        album.description = str(patch["description"]).strip()
    if "kind" in patch and patch["kind"] is not None:
        album.kind = patch["kind"]
    if "position" in patch and patch["position"] is not None:
        album.position = int(patch["position"])

    affected_moments: set[uuid.UUID] = set()
    if normalized_photos is not None:
        affected_moments = _sync_album_photos(session, album, normalized_photos)

    album.bump_version()
    sources.bump_moment_versions(session, affected_moments)
    _commit(session)
    return album


def publish_album(session: Session, album: Album, *, if_match: str | None) -> Album:
    """发布门槛：至少一张 ready 照片。

    「记忆画廊」里没有照片的相册没有意义（验收 5「正常空内容不靠假统计填充」），
    因此这里拒绝发布空相册，而不是发一个空页面出去。
    """
    require_version(album.version, if_match)

    refs = photo_refs_for_albums(session, [album.id]).get(album.id, [])
    if not refs:
        raise conflict("发布前至少需要一张照片", {"photos": ["至少 1 张照片"]})
    media_by_id = load_media_rows(session, [ref[0] for ref in refs])
    unready = [
        str(media_id)
        for media_id, _position, _alt, _caption, _taken in refs
        if (media := media_by_id.get(media_id)) is None
        or media.status != STATUS_READY
        or media.deleted_at is not None
    ]
    if unready:
        raise conflict("有照片尚未处理完成，不能发布", {"photos": unready})

    album.status = STATUS_PUBLISHED
    album.published_at = utcnow()
    album.bump_version()
    _commit(session)
    return album


def unpublish_album(session: Session, album: Album, *, if_match: str | None) -> Album:
    """撤回：回到 draft，**清空发布时间**。照片关系保留，便于改完再发。"""
    require_version(album.version, if_match)
    album.status = STATUS_DRAFT
    album.published_at = None
    album.bump_version()
    _commit(session)
    return album


def soft_delete_album(session: Session, album: Album, *, if_match: str | None) -> None:
    """软删除。文件不物理删除（可能还有动态 / 作品等公开引用）。

    同时撤销该相册作为**动态收录目标**：删除所有动态指向它的收录配置，并 bump 这些
    动态的版本（旧动态表单会 412，不会把一个已删除的相册静默写回来）。相册下的
    `album_media` 行、独立来源与媒体文件保留（数据不丢，公开投影已随相册删除消失）。
    """
    require_version(album.version, if_match)
    affected_moments = sources.clear_moment_links_for_album(session, album_id=album.id)
    album.deleted_at = utcnow()
    album.status = STATUS_DRAFT
    album.published_at = None
    album.bump_version()
    sources.bump_moment_versions(session, affected_moments)
    _commit(session)


# --- 移除单张照片（**单处撤回**：只移除相册这一处引用）--------------------


def remove_photo(
    session: Session, album: Album, media_id: uuid.UUID, *, if_match: str | None
) -> bool:
    """从相册移除一张照片，返回是否真的删掉了那一行。

    **只删相册这一处关系行**：同一张 media 仍被动态 / 作品 / 另一个相册引用时，
    匿名读图仍然成功（05 §11、验收 3）。文件与其余关系行都不动。

    同时按任务书 §4.5 清理「该相册 + 该图」的全部来源与所有动态收录配置，
    并 bump 受影响动态的版本 —— 后续动态重发不能自动把这张图加回相册。
    移除以 `If-Match` 保护，避免两个浏览器同时改同一个相册时静默丢改动。
    """
    require_version(album.version, if_match)
    removed = media_id in sources.album_media_ids(session, album.id)
    affected_moments = sources.detach_album_media(
        session, album_id=album.id, media_ids=[media_id]
    )
    album.bump_version()
    sources.bump_moment_versions(session, affected_moments)
    _commit(session)
    return removed


# --- 内容域贡献（供 public_refs 使用）--------------------------------------


def public_album_exists_for_media(session: Session, media_id: uuid.UUID) -> bool:
    """该媒体是否属于某个**当前公开且来源有效**的相册（媒体公开引用检查用，只读）。

    注意这里不是「媒体出现在某个公开相册里」就够了：来源必须满足统一公开条件
    （独立来源，或指向该相册该图且动态当前公开的动态来源）。只有草稿 / 撤回动态
    来源的图不构成相册域的公开引用 —— 否则撤回最后一条公开引用后，媒体变体 URL
    仍然可读（任务书 §4.6 末段）。
    """
    statement = (
        select(Album.id)
        .join(album_media, album_media.c.album_id == Album.id)
        .where(
            album_media.c.media_id == media_id,
            *public_conditions(),
            _public_photo_condition(),
        )
        .limit(1)
    )
    return session.execute(statement).scalars().first() is not None


def public_media_ids(session: Session) -> set[uuid.UUID]:
    """当前被公开相册（且来源有效）引用的媒体 id。"""
    rows = session.execute(
        select(album_media.c.media_id)
        .join(Album, Album.id == album_media.c.album_id)
        .where(*public_conditions(), _public_photo_condition())
        .distinct()
    ).scalars()
    return set(rows)


def public_albums_for_media(
    session: Session, media_id: uuid.UUID, *, now: datetime | None = None
) -> list[Album]:
    """这张图当前出现在哪些**公开且来源有效**的相册里（管理端「还有别处引用」提示用）。"""
    return list(
        session.execute(
            select(Album)
            .join(album_media, album_media.c.album_id == Album.id)
            .where(
                album_media.c.media_id == media_id,
                *public_conditions(now),
                _public_photo_condition(now),
            )
            .order_by(Album.position.asc(), Album.id.asc())
        )
        .scalars()
        .all()
    )


__all__ = [
    "ALBUM_CURSOR_VERSION",
    "PHOTO_CURSOR_VERSION",
    "PHOTO_SORT_ALBUM",
    "PHOTO_SORT_GLOBAL",
    "PhotoCursor",
    "PhotoRow",
    "SCOPES",
    "SCOPE_ALBUM",
    "SCOPE_GLOBAL",
    "admin_album_list_out",
    "admin_album_out",
    "admin_photos_for_albums",
    "clamp_limit",
    "clamp_photo_limit",
    "conflict",
    "create_album",
    "decode_photo_cursor",
    "decode_position_cursor",
    "encode_photo_cursor",
    "encode_position_cursor",
    "get_admin_album",
    "get_album_by_slug",
    "get_public_album",
    "list_admin_albums",
    "list_public_albums",
    "list_wall_photos",
    "load_media_rows",
    "next_album_position",
    "not_found",
    "photo_refs_for_albums",
    "photos_fingerprint",
    "public_album_detail",
    "public_album_exists_for_media",
    "public_album_fingerprint",
    "public_album_summaries",
    "public_albums_for_media",
    "public_conditions",
    "public_media_ids",
    "public_photos_for_albums",
    "publish_album",
    "remove_photo",
    "soft_delete_album",
    "unpublish_album",
    "update_album",
    "wall_filter_years",
]
