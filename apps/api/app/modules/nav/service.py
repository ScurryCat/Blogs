"""异世界导航服务：公开列表 / 详情、确定性关键词匹配、普通搜索、站主维护（04、05 §6/§7）。

三条硬规则：

1. **公开条件先于一切**（05 §2 末）：草稿、软删除、未到发布时间、没有公开文章的专题
   在 SQL 层就被排除，不先查全部再在浏览器过滤。
2. **匹配是确定性的**（04 §6）：字段 trim + Unicode NFKC + 大小写折叠，标准值与别名
   同规则；三字段求交集，返回 `found` / `ambiguous` / `not_found`，**没有任何模型推断**。
   多候选按 `(published_at DESC, id DESC)` 明确排序，不依赖一条 SQL 的偶然返回顺序。
3. **服务故障不是 `not_found`**：数据库异常由 core 的错误处理器变成 503，
   这里的函数不会把异常吞成空结果。

搜索的排序规则（04 §6「排名规则在 API 中统一」）：
    标题完全匹配(0) → 标题 / 别名命中(1) → 标签命中(2) → 摘要命中(3)，
    同档按 `published_at DESC, id DESC`，最后用 `kind` 区分，保证全序、分页稳定。
"""

from __future__ import annotations

import base64
import binascii
import json
import unicodedata
import uuid
from datetime import datetime, timezone
from typing import Iterable, Mapping, Sequence

from sqlalchemy import (
    DateTime,
    and_,
    Integer,
    String,
    Uuid,
    case,
    delete,
    exists,
    func,
    literal,
    or_,
    select,
    text as sql_text,
    tuple_,
    union_all,
)
from sqlalchemy.orm import Session

from app.core.db import utcnow
from app.core.errors import (
    CODE_CONFLICT,
    CODE_NOT_FOUND,
    CODE_UNPROCESSABLE,
    CODE_VALIDATION_FAILED,
    ApiError,
)
from app.core.pagination import (
    DEFAULT_LIMIT,
    MAX_LIMIT,
    decode_cursor,
    encode_cursor,
    filter_fingerprint,
)
from app.core.text import normalize_for_match, normalize_tag_slug
from app.modules.nav import schemas
from app.modules.nav.models import (
    FIELD_COGNITION,
    FIELD_LOCATION,
    FIELD_NAME,
    PALACE_FIELDS,
    STATUS_DRAFT,
    STATUS_PUBLISHED,
    Palace,
    PalaceAlias,
    PalacePost,
)
from app.modules.posts import service as posts_service
from app.modules.posts.models import Post
from app.modules.tags.models import Tag, post_tags

SEARCH_DEFAULT_LIMIT = 20
SEARCH_MAX_LIMIT = 30
SEARCH_CURSOR_VERSION = 1
SEARCH_KINDS = ("post", "palace")


# --- 规范化 -----------------------------------------------------------------


def normalize_keyword(value: str) -> str:
    """关键词 / 别名的规范值：NFKC + trim + 大小写折叠 + 空白折叠（core.text 共用规则）。"""
    return normalize_for_match(value or "")


def _sql_normalize(column):
    """SQL 侧的同一个规范化：NFKC + 大小写折叠的近似（PostgreSQL 的 `lower`）。

    为什么 SQL 侧不直接用 Python：过滤与排序必须发生在数据库里，否则分页会漏项。
    别名列存的是 Python `casefold` 的规范值（精确比较），正文列用 `lower(normalize(…))`；
    两者只在 `ß`/`ﬀ` 这类 casefold 展开字符上不同（已记录在交付单）。
    """
    return func.lower(func.normalize(func.coalesce(column, ""), sql_text("NFKC")))


def _nfkc_lower(value: str) -> str:
    """SQL 侧比较用的形态：NFKC + trim + 空白折叠 + lower。"""
    return " ".join(unicodedata.normalize("NFKC", value or "").strip().lower().split())


def _like_pattern(value: str) -> str:
    """把用户输入变成 LIKE 模式，`%` / `_` / `\\` 全部转义（05 §6 末）。"""
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _like(column, value: str):
    return column.like(_like_pattern(value), escape="\\")


# --- 错误 -------------------------------------------------------------------


def not_found(message: str = "专题不存在或不可访问") -> ApiError:
    """不存在、草稿、已删除、没有公开文章统一同形（05 §6）。"""
    return ApiError(CODE_NOT_FOUND, message, status_code=404)


def _unprocessable(message: str, field: str) -> ApiError:
    return ApiError(CODE_UNPROCESSABLE, message, status_code=422, fields={field: [message]})


def _bad_cursor(message: str) -> ApiError:
    return ApiError(CODE_VALIDATION_FAILED, message, status_code=400, fields={"cursor": [message]})


# --- 公开条件 ---------------------------------------------------------------


def _public_post_conditions(now: datetime) -> list:
    return posts_service.public_conditions(now)


def has_public_post_clause(now: datetime | None = None):
    """相关存在性：当前至少一篇公开文章。作为公开条件的**唯一**依据（不缓存计数）。"""
    moment = now or utcnow()
    return (
        select(literal(1))
        .select_from(PalacePost)
        .join(Post, Post.id == PalacePost.post_id)
        .where(PalacePost.palace_id == Palace.id, *_public_post_conditions(moment))
        .exists()
    )


def public_palace_conditions(now: datetime | None = None) -> list:
    moment = now or utcnow()
    return [
        Palace.status == STATUS_PUBLISHED,
        Palace.deleted_at.is_(None),
        Palace.published_at.is_not(None),
        Palace.published_at <= moment,
        has_public_post_clause(moment),
    ]


# --- 公开读取 ---------------------------------------------------------------


def clamp_limit(limit: int | None) -> int:
    if limit is None:
        return DEFAULT_LIMIT
    return max(1, min(int(limit), MAX_LIMIT))


def clamp_search_limit(limit: int | None) -> int:
    if limit is None:
        return SEARCH_DEFAULT_LIMIT
    return max(1, min(int(limit), SEARCH_MAX_LIMIT))


def public_post_counts(
    session: Session, palace_ids: Sequence[uuid.UUID], *, now: datetime | None = None
) -> dict[uuid.UUID, int]:
    """实时统计每个专题的公开文章数（不落库、不当权限条件）。"""
    wanted = list(palace_ids)
    if not wanted:
        return {}
    moment = now or utcnow()
    rows = session.execute(
        select(PalacePost.palace_id, func.count())
        .join(Post, Post.id == PalacePost.post_id)
        .where(PalacePost.palace_id.in_(wanted), *_public_post_conditions(moment))
        .group_by(PalacePost.palace_id)
    ).all()
    return {palace_id: int(count) for palace_id, count in rows}


def list_public_palaces(
    session: Session,
    *,
    cursor: str | None = None,
    limit: int | None = None,
    now: datetime | None = None,
) -> tuple[list[Palace], str | None]:
    """可进入的专题列表，按 `(published_at DESC, id DESC)` + 不透明游标分页。"""
    bounded = clamp_limit(limit)
    fingerprint = filter_fingerprint({})
    statement = select(Palace).where(*public_palace_conditions(now))
    if cursor:
        sort_value, entity_id = decode_cursor(cursor, fingerprint=fingerprint)
        statement = statement.where(
            tuple_(Palace.published_at, Palace.id) < tuple_(sort_value, entity_id)
        )
    statement = statement.order_by(Palace.published_at.desc(), Palace.id.desc()).limit(bounded + 1)
    rows = list(session.execute(statement).scalars().all())
    next_cursor = None
    if len(rows) > bounded:
        rows = rows[:bounded]
        last = rows[-1]
        next_cursor = encode_cursor(
            sort_value=last.published_at, entity_id=last.id, fingerprint=fingerprint
        )
    return rows, next_cursor


def get_public_palace(
    session: Session, slug: str, *, now: datetime | None = None
) -> Palace | None:
    if not slug or len(slug) > 200:
        return None
    return (
        session.execute(
            select(Palace).where(Palace.slug == slug, *public_palace_conditions(now))
        )
        .scalars()
        .first()
    )


def public_posts_for_palace(
    session: Session, palace_id: uuid.UUID, *, now: datetime | None = None
) -> list[Post]:
    """专题里的公开文章，按站主维护的 `position` 升序；被撤回的文章自动消失。"""
    moment = now or utcnow()
    return list(
        session.execute(
            select(Post)
            .join(PalacePost, PalacePost.post_id == Post.id)
            .where(PalacePost.palace_id == palace_id, *_public_post_conditions(moment))
            .order_by(PalacePost.position.asc())
        )
        .scalars()
        .all()
    )


def public_palace_counts(
    session: Session, palaces: Sequence[Palace], *, now: datetime | None = None
) -> dict[uuid.UUID, int]:
    return public_post_counts(session, [palace.id for palace in palaces], now=now)


def _ordered(palaces: Iterable[Palace]) -> list[Palace]:
    """确定性排序：新发布的在前；同时间戳按 id 降序。"""
    return sorted(
        palaces,
        key=lambda palace: (palace.published_at or datetime.min.replace(tzinfo=timezone.utc), palace.id),
        reverse=True,
    )


# --- 认知定位（三关键词匹配） -----------------------------------------------


def _alias_map(session: Session, palace_ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, list[PalaceAlias]]:
    wanted = list(palace_ids)
    if not wanted:
        return {}
    grouped: dict[uuid.UUID, list[PalaceAlias]] = {}
    rows = session.execute(
        select(PalaceAlias).where(PalaceAlias.palace_id.in_(wanted))
    ).scalars()
    for alias in rows:
        grouped.setdefault(alias.palace_id, []).append(alias)
    return grouped


def field_values(palace: Palace, aliases: Sequence[PalaceAlias]) -> dict[str, set[str]]:
    """每个字段的规范值集合 = 标准值 ∪ 别名（同一套规范化规则）。"""
    values: dict[str, set[str]] = {field: set() for field in PALACE_FIELDS}
    for field in PALACE_FIELDS:
        standard = normalize_keyword(getattr(palace, field) or "")
        if standard:
            values[field].add(standard)
    for alias in aliases:
        if alias.field in values and alias.normalized_value:
            values[alias.field].add(alias.normalized_value)
    return values


def resolve_palaces(
    session: Session,
    *,
    name: str,
    location: str,
    cognition: str,
    now: datetime | None = None,
) -> tuple[str, list[Palace]]:
    """三字段求交集。返回 (status, matches)，matches 已确定性排序。

    只在**已发布且有公开文章**的专题集合里匹配（04 §6 第 3 条）。
    匹配在 Python 侧完成：PostgreSQL 的 `lower(normalize(...))` 与 Python 的 `casefold`
    在极端字符上不等价，而匹配结果必须是可复现的；专题数量是站主手动维护的规模，
    因此这里取「公开专题全量 + 内存集合运算」，并用 `normalize_for_match` 唯一一份规则。
    专题数量增长到需要索引时，再给标准值加规范列与索引（已在交付单记为后续项）。
    """
    moment = now or utcnow()
    palaces = list(
        session.execute(select(Palace).where(*public_palace_conditions(moment))).scalars().all()
    )
    if not palaces:
        return "not_found", []

    aliases = _alias_map(session, [palace.id for palace in palaces])
    wanted = {
        FIELD_NAME: normalize_keyword(name),
        FIELD_LOCATION: normalize_keyword(location),
        FIELD_COGNITION: normalize_keyword(cognition),
    }

    matched_ids: set[uuid.UUID] | None = None
    for field, needle in wanted.items():
        if not needle:
            # 提交后为空的字段不参与匹配（HTTP 层已拒绝纯空白，这里是防御）。
            return "not_found", []
        hits = {
            palace.id
            for palace in palaces
            if needle in field_values(palace, aliases.get(palace.id, [])).get(field, set())
        }
        matched_ids = hits if matched_ids is None else (matched_ids & hits)

    found = [palace for palace in _ordered(palaces) if palace.id in (matched_ids or set())]
    if not found:
        return "not_found", []
    if len(found) == 1:
        return "found", found
    return "ambiguous", found


def resolve_out(session: Session, *, name: str, location: str, cognition: str,
                now: datetime | None = None) -> schemas.ResolveOut:
    status, matches = resolve_palaces(session, name=name, location=location, cognition=cognition, now=now)
    counts = public_post_counts(session, [palace.id for palace in matches], now=now)
    return schemas.ResolveOut(
        status=status,
        matches=[schemas.palace_summary_out(palace, post_count=counts.get(palace.id, 0)) for palace in matches],
    )


# --- 普通搜索 ---------------------------------------------------------------


def _tag_condition_for_posts(word_sql: str, word_slug: str):
    """文章标签命中：标签 slug 或展示名（两者都按同一套规范化比较）。"""
    return exists(
        select(literal(1))
        .select_from(post_tags)
        .join(Tag, Tag.id == post_tags.c.tag_id)
        .where(
            post_tags.c.post_id == Post.id,
            or_(Tag.slug == word_slug, _like(Tag.slug, word_slug), _like(_sql_normalize(Tag.name), word_sql)),
        )
    )


def _palace_tag_exists(word_slug: str, word_sql: str, *, now: datetime):
    """殿堂的标签 = 其**公开**关联文章的标签并集（草稿文章的标签不算，05 §6）。"""
    return exists(
        select(literal(1))
        .select_from(PalacePost)
        .join(Post, Post.id == PalacePost.post_id)
        .join(post_tags, post_tags.c.post_id == Post.id)
        .join(Tag, Tag.id == post_tags.c.tag_id)
        .where(
            PalacePost.palace_id == Palace.id,
            *_public_post_conditions(now),
            or_(Tag.slug == word_slug, _like(Tag.slug, word_slug), _like(_sql_normalize(Tag.name), word_sql)),
        )
    )


def _palace_alias_exists(word_cf: str):
    return exists(
        select(literal(1))
        .select_from(PalaceAlias)
        .where(
            PalaceAlias.palace_id == Palace.id,
            or_(PalaceAlias.normalized_value == word_cf, _like(PalaceAlias.normalized_value, word_cf)),
        )
    )


def _word_ranks_posts(words: Sequence[tuple[str, str, str]]):
    """每个词在文章上的档位（NULL = 该词没有命中任何字段 → 整条不入选）。"""
    ranks = []
    for word_sql, word_cf, word_slug in words:
        title = _sql_normalize(Post.title)
        ranks.append(
            func.least(
                case((title == word_sql, 0)),
                case((_like(title, word_sql), 1)),
                case((_tag_condition_for_posts(word_sql, word_slug), 2)),
                case((_like(_sql_normalize(Post.excerpt), word_sql), 3)),
            )
        )
    return ranks


def _word_ranks_palaces(words: Sequence[tuple[str, str, str]], *, now: datetime):
    ranks = []
    for word_sql, word_cf, word_slug in words:
        title = _sql_normalize(Palace.title)
        ranks.append(
            func.least(
                case((title == word_sql, 0)),
                case((_like(title, word_sql), 1)),
                case((_palace_alias_exists(word_cf), 1)),
                case((_palace_tag_exists(word_slug, word_sql, now=now), 2)),
                case((_like(_sql_normalize(Palace.summary), word_sql), 3)),
            )
        )
    return ranks


def _doc_rank(ranks: Sequence):
    """整条文档的档位 = 各词档位的**最好**值（有一个词精确命中标题就排在前面）。

    注意 `LEAST` 会忽略 NULL，所以必须显式要求**每个词都命中**：任何一个词没命中
    （档位为 NULL）时整条为 NULL，由外层 `rank IS NOT NULL` 过滤掉。
    「多个空格分隔词按全部命中处理」（04 §6）。
    """
    if len(ranks) == 1:
        return ranks[0]
    return case((and_(*[rank.is_not(None) for rank in ranks]), func.least(*ranks)))


def search_fingerprint(q: str, kind: str | None, tag: str | None) -> str:
    return filter_fingerprint(
        {
            "q": _nfkc_lower(q),
            "kind": kind or "",
            "tag": normalize_tag_slug(tag) if tag else "",
        }
    )


def encode_search_cursor(
    *, rank: int, published_at: datetime, entity_id: uuid.UUID, kind: str, fingerprint: str
) -> str:
    """搜索游标：排序键是四元组 `(rank, published_at, id, kind)`，因此不能复用两元组游标。

    与 core 的游标同形（版本 + 排序值 + ID + **筛选指纹**）：格式不合法、版本不认识、
    指纹与当前筛选不符一律 400，由客户端从第一页重新开始（05 §6）。
    """
    payload = {
        "v": SEARCH_CURSOR_VERSION,
        "r": int(rank),
        "s": published_at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "i": str(entity_id),
        "k": kind,
        "f": fingerprint,
    }
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def decode_search_cursor(cursor: str, *, fingerprint: str) -> tuple[int, datetime, uuid.UUID, str]:
    candidate = (cursor or "").strip()
    if not candidate or len(candidate) > 512:
        raise _bad_cursor("游标无效，请从第一页重新开始")
    padding = "=" * (-len(candidate) % 4)
    try:
        payload = json.loads(base64.urlsafe_b64decode(candidate + padding))
    except (binascii.Error, ValueError, UnicodeDecodeError):
        raise _bad_cursor("游标无效，请从第一页重新开始") from None
    if not isinstance(payload, dict):
        raise _bad_cursor("游标无效，请从第一页重新开始")
    if payload.get("v") != SEARCH_CURSOR_VERSION:
        raise _bad_cursor("游标版本不受支持，请从第一页重新开始")
    if payload.get("f") != fingerprint:
        raise _bad_cursor("游标与当前筛选条件不一致，请从第一页重新开始")
    kind = payload.get("k")
    if kind not in SEARCH_KINDS:
        raise _bad_cursor("游标无效，请从第一页重新开始")
    try:
        rank = int(payload["r"])
        sort_value = datetime.fromisoformat(str(payload["s"]).replace("Z", "+00:00"))
        entity_id = uuid.UUID(str(payload["i"]))
    except (KeyError, ValueError, TypeError):
        raise _bad_cursor("游标无效，请从第一页重新开始") from None
    if sort_value.tzinfo is None or rank < 0:
        raise _bad_cursor("游标无效，请从第一页重新开始")
    return rank, sort_value.astimezone(timezone.utc), entity_id, str(kind)


def _query_words(q: str) -> list[tuple[str, str, str]]:
    """把查询切成词：每个词给出 (SQL 形态, casefold 形态, 标签 slug 形态)。"""
    words: list[tuple[str, str, str]] = []
    for raw in (q or "").split():
        sql_form = _nfkc_lower(raw)
        if not sql_form:
            continue
        folded = normalize_for_match(raw)
        words.append((sql_form, folded, normalize_tag_slug(raw)))
    return words


def _post_branch(words, *, kind: str | None, tag_slug: str | None, now: datetime):
    rank = _doc_rank(_word_ranks_posts(words))
    statement = select(
        literal("post", String).label("kind"),
        Post.id.label("id"),
        Post.slug.label("slug"),
        Post.title.label("title"),
        Post.excerpt.label("excerpt"),
        Post.published_at.label("published_at"),
        rank.label("rank"),
    ).where(*_public_post_conditions(now))
    if tag_slug:
        statement = statement.where(
            exists(
                select(literal(1))
                .select_from(post_tags)
                .join(Tag, Tag.id == post_tags.c.tag_id)
                .where(post_tags.c.post_id == Post.id, Tag.slug == tag_slug)
            )
        )
    return statement


def _palace_branch(words, *, tag_slug: str | None, now: datetime):
    rank = _doc_rank(_word_ranks_palaces(words, now=now))
    statement = select(
        literal("palace", String).label("kind"),
        Palace.id.label("id"),
        Palace.slug.label("slug"),
        Palace.title.label("title"),
        Palace.summary.label("excerpt"),
        Palace.published_at.label("published_at"),
        rank.label("rank"),
    ).where(*public_palace_conditions(now))
    if tag_slug:
        statement = statement.where(
            exists(
                select(literal(1))
                .select_from(PalacePost)
                .join(Post, Post.id == PalacePost.post_id)
                .join(post_tags, post_tags.c.post_id == Post.id)
                .join(Tag, Tag.id == post_tags.c.tag_id)
                .where(
                    PalacePost.palace_id == Palace.id,
                    *_public_post_conditions(now),
                    Tag.slug == tag_slug,
                )
            )
        )
    return statement


def search_public(
    session: Session,
    *,
    q: str,
    kind: str | None = None,
    tag: str | None = None,
    cursor: str | None = None,
    limit: int | None = None,
    now: datetime | None = None,
) -> tuple[list[dict], str | None]:
    """搜索公开文章与公开专题。返回 (条目列表, next_cursor)。"""
    words = _query_words(q)
    if not words:
        raise _unprocessable("搜索词不能只有空白", "q")
    if kind is not None and kind not in SEARCH_KINDS:
        raise _unprocessable("kind 只能是 post 或 palace", "kind")

    moment = now or utcnow()
    bounded = clamp_search_limit(limit)
    tag_slug = normalize_tag_slug(tag) if tag and tag.strip() else None
    fingerprint = search_fingerprint(q, kind, tag)

    branches = []
    if kind in (None, "post"):
        branches.append(_post_branch(words, kind=kind, tag_slug=tag_slug, now=moment))
    if kind in (None, "palace"):
        branches.append(_palace_branch(words, tag_slug=tag_slug, now=moment))

    results = union_all(*branches).subquery("nav_search")
    statement = select(results).where(results.c.rank.is_not(None))
    if cursor:
        rank, sort_value, entity_id, cursor_kind = decode_search_cursor(cursor, fingerprint=fingerprint)
        statement = statement.where(
            tuple_(results.c.rank, results.c.published_at, results.c.id, results.c.kind)
            < tuple_(
                literal(rank, Integer),
                literal(sort_value, DateTime(timezone=True)),
                literal(entity_id, Uuid(as_uuid=True)),
                literal(cursor_kind, String),
            )
        )
    statement = statement.order_by(
        results.c.rank.asc(),
        results.c.published_at.desc(),
        results.c.id.desc(),
        results.c.kind.asc(),
    ).limit(bounded + 1)

    rows = list(session.execute(statement).all())
    next_cursor = None
    if len(rows) > bounded:
        rows = rows[:bounded]
        last = rows[-1]
        next_cursor = encode_search_cursor(
            rank=int(last.rank),
            published_at=last.published_at,
            entity_id=last.id,
            kind=last.kind,
            fingerprint=fingerprint,
        )
    return [dict(row._mapping) for row in rows], next_cursor


def search_item_out(row: Mapping) -> schemas.SearchItemOut:
    kind = str(row["kind"])
    slug = str(row["slug"])
    href = f"/posts/{slug}" if kind == "post" else f"/apps/metanav/palaces/{slug}"
    return schemas.SearchItemOut(
        kind="post" if kind == "post" else "palace",
        id=row["id"],
        slug=slug,
        title=str(row["title"]),
        excerpt=str(row["excerpt"] or ""),
        href=href,
    )


def detail_out(session: Session, palace: Palace, *, now: datetime | None = None) -> schemas.PalaceDetailOut:
    posts = public_posts_for_palace(session, palace.id, now=now)
    tags_map = posts_service.tags_for_posts(session, [post.id for post in posts])
    covers = posts_service.ready_covers(session, [post.cover_media_id for post in posts])
    return schemas.palace_detail_out(
        palace,
        post_count=len(posts),
        posts=posts,
        tags_by_post=tags_map,
        covers_by_post=covers,
    )


def summary_list_out(
    session: Session, palaces: Sequence[Palace], *, now: datetime | None = None
) -> list[schemas.PalaceSummaryOut]:
    counts = public_post_counts(session, [palace.id for palace in palaces], now=now)
    return [schemas.palace_summary_out(palace, post_count=counts.get(palace.id, 0)) for palace in palaces]


# --- 跨模块只读入口（T06 / T09 复用） ---------------------------------------


def related_public_palaces_for_post(
    session: Session, post_id: uuid.UUID, *, now: datetime | None = None
) -> list[Palace]:
    """某篇公开文章所属的公开专题（作品详情、问题记录等可据此给出「进入殿堂」入口）。"""
    moment = now or utcnow()
    return _ordered(
        session.execute(
            select(Palace)
            .join(PalacePost, PalacePost.palace_id == Palace.id)
            .where(PalacePost.post_id == post_id, *public_palace_conditions(moment))
        )
        .scalars()
        .all()
    )


def public_palace_by_slug(session: Session, slug: str, *, now: datetime | None = None) -> Palace | None:
    return get_public_palace(session, slug, now=now)


def public_palace_options(session: Session, *, now: datetime | None = None) -> list[Palace]:
    """给其他模块的「关联专题」选择器用的公开专题清单（按标题排序，便于展示）。"""
    moment = now or utcnow()
    return sorted(
        session.execute(select(Palace).where(*public_palace_conditions(moment))).scalars().all(),
        key=lambda palace: palace.title,
    )


# --- 管理侧 -----------------------------------------------------------------


def admin_slug_taken(session: Session, slug: str, *, exclude_id: uuid.UUID | None = None) -> bool:
    statement = select(Palace.id).where(Palace.slug == slug)
    if exclude_id is not None:
        statement = statement.where(Palace.id != exclude_id)
    return session.execute(statement).first() is not None


def get_admin_palace(session: Session, palace_id: uuid.UUID) -> Palace | None:
    """管理读取包含草稿 / 已删除（预览用），与公开端点完全分离（05 §7）。"""
    return session.execute(select(Palace).where(Palace.id == palace_id)).scalars().first()


def list_admin_palaces(
    session: Session, *, cursor: str | None = None, limit: int | None = None
) -> tuple[list[Palace], str | None]:
    bounded = clamp_limit(limit)
    fingerprint = filter_fingerprint({})
    statement = select(Palace)
    if cursor:
        sort_value, entity_id = decode_cursor(cursor, fingerprint=fingerprint)
        statement = statement.where(
            tuple_(Palace.created_at, Palace.id) < tuple_(sort_value, entity_id)
        )
    statement = statement.order_by(Palace.created_at.desc(), Palace.id.desc()).limit(bounded + 1)
    rows = list(session.execute(statement).scalars().all())
    next_cursor = None
    if len(rows) > bounded:
        rows = rows[:bounded]
        last = rows[-1]
        next_cursor = encode_cursor(
            sort_value=last.created_at, entity_id=last.id, fingerprint=fingerprint
        )
    return rows, next_cursor


def normalize_alias_payload(aliases: Iterable[schemas.PalaceAliasIn]) -> list[tuple[str, str, str]]:
    """校验并规范化别名列表 → [(field, value, normalized_value)]。

    同一字段内规范值重复 → 422（数据库唯一约束会拒绝，早点给出字段级错误更好）。
    """
    seen: set[tuple[str, str]] = set()
    normalized: list[tuple[str, str, str]] = []
    for alias in aliases:
        value = alias.value.strip()
        key = (alias.field, normalize_keyword(value))
        if not key[1]:
            raise _unprocessable("别名不能只有空白", "aliases")
        if key in seen:
            raise _unprocessable(f"同一字段的别名重复：{value}", "aliases")
        seen.add(key)
        normalized.append((alias.field, value, key[1]))
    return normalized


def normalize_post_ids(post_ids: Iterable[uuid.UUID]) -> list[uuid.UUID]:
    ordered = list(post_ids)
    if len(set(ordered)) != len(ordered):
        raise _unprocessable("同一篇文章不能在一座殿堂里出现两次", "post_ids")
    return ordered


def missing_post_ids(session: Session, post_ids: Sequence[uuid.UUID]) -> list[uuid.UUID]:
    """返回不存在的文章 ID。关系里出现不存在的文章一律 422，不静默丢掉。"""
    if not post_ids:
        return []
    found = set(
        session.execute(select(Post.id).where(Post.id.in_(list(post_ids)))).scalars().all()
    )
    return [post_id for post_id in post_ids if post_id not in found]


def replace_aliases(session: Session, palace: Palace, aliases: Sequence[tuple[str, str, str]]) -> None:
    """完整替换别名列表（05 §7「关系列表完整替换」）。"""
    session.execute(delete(PalaceAlias).where(PalaceAlias.palace_id == palace.id))
    session.flush()
    for field, value, normalized in aliases:
        session.add(
            PalaceAlias(palace_id=palace.id, field=field, value=value, normalized_value=normalized)
        )
    session.flush()
    session.expire(palace, ["aliases"])


def replace_posts(session: Session, palace: Palace, post_ids: Sequence[uuid.UUID]) -> None:
    session.execute(delete(PalacePost).where(PalacePost.palace_id == palace.id))
    session.flush()
    for position, post_id in enumerate(post_ids):
        session.add(PalacePost(palace_id=palace.id, post_id=post_id, position=position))
    session.flush()
    session.expire(palace, ["posts"])


def create_palace(
    session: Session,
    *,
    slug: str,
    title: str,
    summary: str,
    keywords: schemas.PalaceKeywordsIn,
    aliases: Sequence[tuple[str, str, str]],
    post_ids: Sequence[uuid.UUID],
    now: datetime | None = None,
) -> Palace:
    moment = now or utcnow()
    clean_slug = slug.strip()
    if admin_slug_taken(session, clean_slug):
        raise ApiError(CODE_CONFLICT, "这个 slug 已经被占用", status_code=409, fields={"slug": ["已存在"]})
    missing = missing_post_ids(session, post_ids)
    if missing:
        raise _unprocessable(f"这些文章不存在：{', '.join(str(item) for item in missing)}", "post_ids")

    palace = Palace(
        slug=clean_slug,
        title=title.strip(),
        summary=(summary or "").strip(),
        name=keywords.name.strip(),
        location=keywords.location.strip(),
        cognition=keywords.cognition.strip(),
        status=STATUS_DRAFT,
        published_at=None,
        created_at=moment,
        updated_at=moment,
        version=1,
    )
    session.add(palace)
    session.flush()
    replace_aliases(session, palace, aliases)
    replace_posts(session, palace, post_ids)
    session.commit()
    session.refresh(palace)
    return palace


def update_palace(
    session: Session,
    palace: Palace,
    *,
    changes: Mapping[str, object],
    now: datetime | None = None,
) -> Palace:
    """按字段更新；`aliases` / `post_ids` 出现时完整替换；版本递增（05 §2 / §7）。"""
    moment = now or utcnow()
    if "title" in changes:
        palace.title = str(changes["title"]).strip()
    if "summary" in changes:
        palace.summary = str(changes["summary"] or "").strip()
    if "keywords" in changes:
        keywords = changes["keywords"]
        assert isinstance(keywords, schemas.PalaceKeywordsIn)
        palace.name = keywords.name.strip()
        palace.location = keywords.location.strip()
        palace.cognition = keywords.cognition.strip()
    if "aliases" in changes:
        aliases = changes["aliases"]
        assert isinstance(aliases, (list, tuple))
        replace_aliases(session, palace, aliases)  # type: ignore[arg-type]
    if "post_ids" in changes:
        post_ids = list(changes["post_ids"])  # type: ignore[arg-type]
        missing = missing_post_ids(session, post_ids)
        if missing:
            raise _unprocessable(
                f"这些文章不存在：{', '.join(str(item) for item in missing)}", "post_ids"
            )
        replace_posts(session, palace, post_ids)
    palace.bump_version()
    palace.updated_at = moment
    session.commit()
    session.refresh(palace)
    return palace


def publish_palace(session: Session, palace: Palace, *, now: datetime | None = None) -> Palace:
    """发布：必须至少有一篇**公开**文章（05 §3 / 04 §8），否则 409。"""
    moment = now or utcnow()
    count = public_post_counts(session, [palace.id], now=moment).get(palace.id, 0)
    if count < 1:
        raise ApiError(
            CODE_CONFLICT,
            "专题至少需要一篇公开文章才能发布",
            status_code=409,
            fields={"posts": ["没有公开文章"]},
        )
    palace.status = STATUS_PUBLISHED
    if palace.published_at is None:
        palace.published_at = moment
    palace.bump_version()
    palace.updated_at = moment
    session.commit()
    session.refresh(palace)
    return palace


def unpublish_palace(session: Session, palace: Palace, *, now: datetime | None = None) -> Palace:
    """撤回：回到草稿。`published_at` 保留历史值，公开条件只看 status。"""
    moment = now or utcnow()
    palace.status = STATUS_DRAFT
    palace.bump_version()
    palace.updated_at = moment
    session.commit()
    session.refresh(palace)
    return palace


def soft_delete_palace(session: Session, palace: Palace, *, now: datetime | None = None) -> None:
    """软删除专题，**不删除其中的文章**（05 §7）。"""
    moment = now or utcnow()
    palace.deleted_at = moment
    palace.bump_version()
    palace.updated_at = moment
    session.commit()


def keyword_conflicts(
    session: Session, palace: Palace, *, now: datetime | None = None
) -> list[schemas.PalaceConflictOut]:
    """标准值 / 别名与其他专题重叠时的提示（允许发布，但站主必须先看一眼）。

    只比较**未删除**的其他专题（草稿也算：草稿发布后就会真的产生歧义）。
    """
    aliases = _alias_map(session, [palace.id]).get(palace.id, [])
    mine: dict[str, dict[str, str]] = {field: {} for field in PALACE_FIELDS}
    for field in PALACE_FIELDS:
        value = (getattr(palace, field) or "").strip()
        normalized = normalize_keyword(value)
        if normalized:
            mine[field][normalized] = value
    for alias in aliases:
        if alias.field in mine and alias.normalized_value:
            mine[alias.field].setdefault(alias.normalized_value, alias.value)

    wanted = {(field, normalized) for field, values in mine.items() for normalized in values}
    if not wanted:
        return []

    others = list(
        session.execute(
            select(Palace).where(Palace.id != palace.id, Palace.deleted_at.is_(None))
        )
        .scalars()
        .all()
    )
    if not others:
        return []
    other_aliases = _alias_map(session, [other.id for other in others])

    conflicts: list[schemas.PalaceConflictOut] = []
    for field, normalized in sorted(wanted):
        hits: list[Palace] = []
        for other in others:
            values = field_values(other, other_aliases.get(other.id, [])).get(field, set())
            if normalized in values:
                hits.append(other)
        if hits:
            conflicts.append(
                schemas.PalaceConflictOut(
                    field=field,
                    value=mine[field][normalized],
                    normalized_value=normalized,
                    palaces=[
                        schemas.PalaceRefOut(
                            id=other.id, slug=other.slug, title=other.title, status=other.status
                        )
                        for other in _ordered(hits)
                    ],
                )
            )
    return conflicts


def admin_detail_out(
    session: Session, palace: Palace, *, now: datetime | None = None
) -> schemas.PalaceAdminOut:
    moment = now or utcnow()
    relations = list(
        session.execute(
            select(PalacePost, Post)
            .join(Post, Post.id == PalacePost.post_id)
            .where(PalacePost.palace_id == palace.id)
            .order_by(PalacePost.position.asc())
        ).all()
    )
    public_ids = {
        post.id for post in public_posts_for_palace(session, palace.id, now=moment)
    }
    aliases = _alias_map(session, [palace.id]).get(palace.id, [])
    return schemas.PalaceAdminOut(
        id=palace.id,
        slug=palace.slug,
        title=palace.title,
        summary=palace.summary or "",
        keywords=schemas.keywords_out(palace.name, palace.location, palace.cognition),
        status=palace.status,
        published_at=palace.published_at,
        created_at=palace.created_at,
        updated_at=palace.updated_at,
        deleted_at=palace.deleted_at,
        version=int(palace.version),
        aliases=[
            schemas.PalaceAliasOut(
                field=alias.field, value=alias.value, normalized_value=alias.normalized_value
            )
            for alias in sorted(aliases, key=lambda item: (item.field, item.normalized_value))
        ],
        posts=[
            schemas.PalacePostAdminOut(
                post_id=relation.post_id,
                slug=post.slug,
                title=post.title,
                status=post.status,
                position=relation.position,
                deleted=post.deleted_at is not None,
                public=post.id in public_ids,
            )
            for relation, post in relations
        ],
        conflicts=keyword_conflicts(session, palace, now=moment),
        public_post_count=len(public_ids),
    )

__all__ = [
    "admin_detail_out",
    "clamp_limit",
    "clamp_search_limit",
    "create_palace",
    "decode_search_cursor",
    "detail_out",
    "encode_search_cursor",
    "field_values",
    "get_admin_palace",
    "get_public_palace",
    "has_public_post_clause",
    "keyword_conflicts",
    "list_admin_palaces",
    "list_public_palaces",
    "missing_post_ids",
    "normalize_alias_payload",
    "normalize_keyword",
    "normalize_post_ids",
    "not_found",
    "public_palace_conditions",
    "public_palace_by_slug",
    "public_palace_options",
    "public_post_counts",
    "public_posts_for_palace",
    "publish_palace",
    "related_public_palaces_for_post",
    "replace_aliases",
    "replace_posts",
    "resolve_out",
    "resolve_palaces",
    "search_fingerprint",
    "search_item_out",
    "search_public",
    "soft_delete_palace",
    "summary_list_out",
    "unpublish_palace",
    "update_palace",
]
