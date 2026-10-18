"""工作草稿服务（P5 第一批 · 设计书 §3、契约 §3 / §9.3）。

两层数据（硬约束，契约 §2.1）：

    正式内容（moments / journal_entries）  ←显式提交（本模块 commit，同事务）←
    工作草稿（work_drafts / work_draft_media）  ←自动保存（本模块 PATCH，只写这里）

自动保存的 PATCH **永远不写**正式表；只有 commit 在**一个事务**里完成
「正式行 + 媒体关系 + 动态相册收录来源 + 发布状态 + 草稿 committed_*」。
任何校验 / 写入失败都整体回滚：草稿保持 active、正式内容保持原状。

并发（契约 §9.3）：

  - PATCH / commit / DELETE 都先 `SELECT … FOR UPDATE` 锁草稿行，再比对 `If-Match`。
    两个并发 autosave 中后到者读到新版本 → 412；不会双写。
  - commit 先锁草稿行、再锁正式内容行（更新已有内容时），锁顺序固定避免死锁。
  - commit 的幂等回放**优先于** If-Match：网络重试携带旧 If-Match 是常态，
    同 `commit_key` 的重试返回上次结果而不是 412。
  - 同一站主跨草稿重复使用同一 `commit_key` → 409（部分唯一索引兜底并发）。

错误码按契约 §3.2：401（鉴权）、404（非本人 / 不存在）、409（状态冲突或
草稿期业务冲突）、412 VERSION_CONFLICT、428 PRECONDITION_REQUIRED、
422 VALIDATION_FAILED（字段级）。commit 时正式内容的发布校验失败统一翻成 422。
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

from sqlalchemy import Select, delete, insert, select, tuple_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.db import utcnow
from app.core.errors import (
    CODE_CONFLICT,
    CODE_NOT_FOUND,
    CODE_VALIDATION_FAILED,
    CODE_VERSION_CONFLICT,
    ApiError,
)
from app.core.pagination import (
    DEFAULT_LIMIT,
    MAX_LIMIT,
    decode_cursor,
    encode_cursor,
    filter_fingerprint,
)
from app.core.preconditions import parse_if_match
from app.core.text import codepoint_length
from app.modules.auth import service as auth_service
from app.modules.gallery import sources as gallery_sources
from app.modules.journal import service as journal_service
from app.modules.journal.models import JournalEntry
from app.modules.media.models import STATUS_READY, Media
from app.modules.moments import service as moments_service
from app.modules.moments.models import ALT_MAX_CODEPOINTS as MOMENT_ALT_MAX_CODEPOINTS
from app.modules.moments.models import Moment
from app.modules.moments.schemas import MomentImageIn
from app.modules.work_drafts import schemas
from app.modules.work_drafts.models import (
    CONTENT_TYPE_JOURNAL,
    CONTENT_TYPE_MOMENT,
    STATUS_ACTIVE,
    STATUS_COMMITTED,
    STATUS_DISCARDED,
    WorkDraft,
    work_draft_media,
)

AUDIT_COMMIT = "work_draft.commit"

# 「草稿数据里出现这些键」才覆盖正式内容对应字段；没出现 = 保留原值。
JOURNAL_DATA_FIELDS = ("entry_date", "title", "content_md", "mood", "location", "post_id")
FORMAL_STATUS_DRAFT = "draft"


# --- 错误构造 ---------------------------------------------------------------


def not_found(message: str = "工作草稿不存在") -> ApiError:
    """不存在与不属于当前站主统一 404（不提供 UUID 探测信号）。"""
    return ApiError(CODE_NOT_FOUND, message, status_code=404)


def conflict(message: str, fields: dict | None = None) -> ApiError:
    """状态冲突（409）：已提交 / 已丢弃 / 动作矩阵不允许 / commit_key 被占用。"""
    return ApiError(CODE_CONFLICT, message, status_code=409, fields=fields)


def validation_failed(message: str, fields: dict | None = None) -> ApiError:
    """字段级校验失败（422）。"""
    return ApiError(CODE_VALIDATION_FAILED, message, status_code=422, fields=fields)


def _version_conflict(message: str, fields: dict | None = None) -> ApiError:
    return ApiError(CODE_VERSION_CONFLICT, message, status_code=412, fields=fields)


def clamp_limit(limit: int | None) -> int:
    if limit is None:
        return DEFAULT_LIMIT
    return max(1, min(int(limit), MAX_LIMIT))


# --- 查询基础 ---------------------------------------------------------------


def _load_active_draft(
    session: Session,
    *,
    owner_id: uuid.UUID,
    content_type: str,
    target_id: uuid.UUID,
) -> WorkDraft | None:
    """同一站主编辑同一已有内容时复用的那份 active 草稿。"""
    return (
        session.execute(
            select(WorkDraft).where(
                WorkDraft.owner_id == owner_id,
                WorkDraft.content_type == content_type,
                WorkDraft.target_id == target_id,
                WorkDraft.status == STATUS_ACTIVE,
            )
        )
        .scalars()
        .first()
    )


def get_draft(session: Session, *, owner_id: uuid.UUID, draft_id: uuid.UUID) -> WorkDraft:
    """按 id 取本人草稿（任何状态都返回，供详情 / 审计查看）；不存在或非本人 → 404。"""
    draft = (
        session.execute(
            select(WorkDraft).where(
                WorkDraft.id == draft_id, WorkDraft.owner_id == owner_id
            )
        )
        .scalars()
        .first()
    )
    if draft is None:
        raise not_found()
    return draft


def lock_draft(
    session: Session, *, owner_id: uuid.UUID, draft_id: uuid.UUID
) -> WorkDraft:
    """锁定本人草稿行（`SELECT … FOR UPDATE`），并发写请求在此串行化。"""
    draft = (
        session.execute(
            select(WorkDraft)
            .where(WorkDraft.id == draft_id, WorkDraft.owner_id == owner_id)
            .with_for_update()
        )
        .scalars()
        .first()
    )
    if draft is None:
        raise not_found()
    return draft


def _resolve_target(
    session: Session,
    *,
    owner_id: uuid.UUID,
    content_type: str,
    target_id: uuid.UUID,
):
    """解析要编辑的正式内容；不存在 / 已删除 / 不属于站主 → 404。"""
    if content_type == CONTENT_TYPE_MOMENT:
        target = (
            session.execute(
                select(Moment).where(
                    Moment.id == target_id, Moment.deleted_at.is_(None)
                )
            )
            .scalars()
            .first()
        )
        if target is None or target.author_id != owner_id:
            raise not_found("要编辑的动态不存在或不属于你")
        return target
    # 手记没有 author 列：本站只有一位站主，管理接口其余部分也按同一前提工作。
    entry = (
        session.execute(
            select(JournalEntry).where(
                JournalEntry.id == target_id, JournalEntry.deleted_at.is_(None)
            )
        )
        .scalars()
        .first()
    )
    if entry is None:
        raise not_found("要编辑的手记不存在")
    return entry


def _lock_target(
    session: Session,
    *,
    owner_id: uuid.UUID,
    content_type: str,
    target_id: uuid.UUID,
):
    """锁定正式内容行：commit 的 `expected_target_version` 检查与写入在锁内完成。"""
    if content_type == CONTENT_TYPE_MOMENT:
        target = (
            session.execute(
                select(Moment)
                .where(Moment.id == target_id, Moment.deleted_at.is_(None))
                .with_for_update()
            )
            .scalars()
            .first()
        )
        if target is None or target.author_id != owner_id:
            raise not_found("要编辑的动态不存在或不属于你")
        return target
    entry = (
        session.execute(
            select(JournalEntry)
            .where(JournalEntry.id == target_id, JournalEntry.deleted_at.is_(None))
            .with_for_update()
        )
        .scalars()
        .first()
    )
    if entry is None:
        raise not_found("要编辑的手记不存在")
    return entry


# --- 图片关系批量读取（列表避免 N+1） --------------------------------------


def draft_images(
    session: Session, draft_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[tuple[uuid.UUID, int, str]]]:
    """批量取草稿图片关系，`{draft_id: [(media_id, position, alt)]}`（position 升序）。"""
    if not draft_ids:
        return {}
    rows = session.execute(
        select(
            work_draft_media.c.draft_id,
            work_draft_media.c.media_id,
            work_draft_media.c.position,
            work_draft_media.c.alt,
        )
        .where(work_draft_media.c.draft_id.in_(draft_ids))
        .order_by(work_draft_media.c.draft_id.asc(), work_draft_media.c.position.asc())
    ).all()
    grouped: dict[uuid.UUID, list[tuple[uuid.UUID, int, str]]] = {}
    for draft_id, media_id, position, alt in rows:
        grouped.setdefault(draft_id, []).append((media_id, int(position), str(alt or "")))
    return grouped


def _load_media(session: Session, media_ids: list[uuid.UUID]) -> dict[uuid.UUID, Media]:
    """批量取媒体行（**不过滤状态**）：详情要如实返回已保存的关系。"""
    wanted = list(dict.fromkeys(media_ids))
    if not wanted:
        return {}
    return {
        media.id: media
        for media in session.execute(select(Media).where(Media.id.in_(wanted))).scalars()
    }


def draft_out(session: Session, draft: WorkDraft) -> schemas.WorkDraftOut:
    refs = draft_images(session, [draft.id]).get(draft.id, [])
    media_by_id = _load_media(session, [media_id for media_id, _position, _alt in refs])
    return schemas.work_draft_out(draft, refs=refs, media_by_id=media_by_id)


def drafts_out(session: Session, drafts: list[WorkDraft]) -> list[schemas.WorkDraftOut]:
    refs_by_draft = draft_images(session, [draft.id for draft in drafts])
    all_media_ids = [
        media_id
        for refs in refs_by_draft.values()
        for media_id, _position, _alt in refs
    ]
    media_by_id = _load_media(session, all_media_ids)
    return [
        schemas.work_draft_out(
            draft, refs=refs_by_draft.get(draft.id, []), media_by_id=media_by_id
        )
        for draft in drafts
    ]


# --- 草稿期校验 / 写入 ------------------------------------------------------


def _validate_images_usable(
    session: Session,
    *,
    owner_id: uuid.UUID,
    refs: list[tuple[uuid.UUID, int, str]],
) -> None:
    """草稿期图片校验（422）：媒体必须属于本站主、ready、未删除。"""
    if not refs:
        return
    found = _load_media(session, [media_id for media_id, _position, _alt in refs])
    problems: list[str] = []
    for media_id, _position, _alt in refs:
        media = found.get(media_id)
        if media is None or media.deleted_at is not None or media.status != STATUS_READY:
            problems.append(f"{media_id} 不可用（不存在、已删除或未就绪）")
            continue
        if media.owner_id != owner_id:
            problems.append(f"{media_id} 不属于当前站主")
    if problems:
        raise validation_failed("引用的图片不可用", {"images": problems})


def _replace_draft_media(
    session: Session, *, draft_id: uuid.UUID, refs: list[tuple[uuid.UUID, int, str]]
) -> None:
    """完整替换草稿的图片保留关系（调用方已完成校验）。"""
    session.execute(delete(work_draft_media).where(work_draft_media.c.draft_id == draft_id))
    session.flush()
    if not refs:
        return
    session.execute(
        insert(work_draft_media),
        [
            {
                "draft_id": draft_id,
                "media_id": media_id,
                "position": position,
                "alt": alt,
            }
            for media_id, position, alt in refs
        ],
    )


# --- 创建 / 恢复 ------------------------------------------------------------


def create_draft(
    session: Session,
    *,
    owner_id: uuid.UUID,
    content_type: str,
    target_id: uuid.UUID | None,
    data: dict[str, Any] | None,
    images: list | None,
) -> tuple[WorkDraft, bool]:
    """创建或恢复工作草稿，返回 `(draft, reused)`。

    - 已有 `target_id` 且存在 active 草稿 → 直接返回既有草稿（`reused=True`），
      请求里的 data / images **不覆盖**它（既有草稿里可能已有更新的自动保存内容）；
    - 否则新建（`reused=False`）；新内容 `target_id` 为空，允许多份草稿。
    """
    target_version: int | None = None
    if target_id is not None:
        target = _resolve_target(
            session, owner_id=owner_id, content_type=content_type, target_id=target_id
        )
        target_version = int(target.version)
        existing = _load_active_draft(
            session, owner_id=owner_id, content_type=content_type, target_id=target_id
        )
        if existing is not None:
            return existing, True

    normalized_data = schemas.validate_draft_data(content_type, data)
    refs = schemas.normalize_image_inputs(images)
    _validate_images_usable(session, owner_id=owner_id, refs=refs)

    draft = WorkDraft(
        owner_id=owner_id,
        content_type=content_type,
        target_id=target_id,
        target_version=target_version,
        data=normalized_data,
        status=STATUS_ACTIVE,
        draft_version=1,
    )
    session.add(draft)
    try:
        session.flush()
        if refs:
            _replace_draft_media(session, draft_id=draft.id, refs=refs)
        session.commit()
    except IntegrityError:
        # 并发创建：部分唯一索引（active target 唯一）兜底，回到「复用」分支。
        session.rollback()
        if target_id is not None:
            existing = _load_active_draft(
                session,
                owner_id=owner_id,
                content_type=content_type,
                target_id=target_id,
            )
            if existing is not None:
                return existing, True
        raise conflict("工作草稿创建冲突，请重试") from None
    return draft, False


# --- 列表 -------------------------------------------------------------------


def list_drafts(
    session: Session,
    *,
    owner_id: uuid.UUID,
    content_type: str | None = None,
    cursor: str | None = None,
    limit: int | None = None,
) -> tuple[list[WorkDraft], str | None]:
    """本人 active 草稿列表：`(updated_at DESC, id DESC)` + 不透明游标。

    排序键带 id 兜底，同一时间戳的多行分页不漏不重；游标里带 content_type 指纹，
    切换筛选后继续用旧游标 → 400（由 `decode_cursor` 抛出）。
    """
    bounded = clamp_limit(limit)
    fingerprint = filter_fingerprint(
        {"scope": "work-drafts", "content_type": content_type}
    )
    statement: Select = select(WorkDraft).where(
        WorkDraft.owner_id == owner_id,
        WorkDraft.status == STATUS_ACTIVE,
    )
    if content_type is not None:
        statement = statement.where(WorkDraft.content_type == content_type)
    if cursor:
        sort_value, entity_id = decode_cursor(cursor, fingerprint=fingerprint)
        statement = statement.where(
            tuple_(WorkDraft.updated_at, WorkDraft.id) < tuple_(sort_value, entity_id)
        )
    statement = statement.order_by(
        WorkDraft.updated_at.desc(), WorkDraft.id.desc()
    ).limit(bounded + 1)
    rows = list(session.execute(statement).scalars().all())

    next_cursor: str | None = None
    if len(rows) > bounded:
        rows = rows[:bounded]
        last = rows[-1]
        next_cursor = encode_cursor(
            sort_value=last.updated_at, entity_id=last.id, fingerprint=fingerprint
        )
    return rows, next_cursor


# --- 保存工作副本（PATCH） --------------------------------------------------


def patch_draft(
    session: Session,
    *,
    owner_id: uuid.UUID,
    draft_id: uuid.UUID,
    data: dict[str, Any] | None,
    images: list | None,
    if_match: str | None,
) -> WorkDraft:
    """保存工作副本：锁行 → 校验 If-Match → 校验输入 → 合并 / 替换 → 版本 +1。

    - `data` 只合并显式提供的键（未提供保留旧值）；未知键 422；
    - `images` 省略 = 不动；给出（含 `[]`）= 整组替换，顺序即 position；
    - 草稿期允许空替代文本、允许 0 张图；
    - 版本不符 → 412 且**不做任何修改**（调用方保留未保存输入）。
    """
    draft = lock_draft(session, owner_id=owner_id, draft_id=draft_id)
    if draft.status != STATUS_ACTIVE:
        raise conflict("工作草稿已提交或已丢弃，不能继续保存")

    expected = parse_if_match(if_match)
    if expected != int(draft.draft_version):
        raise _version_conflict(
            "草稿已在别处更新，请先读取最新版本再保存。",
            {
                "draft_version": [
                    f"当前草稿版本为 {int(draft.draft_version)}，提交的是 {expected}"
                ]
            },
        )

    # 所有校验在写库之前完成：任何 422 都不会留下半截修改。
    merged_data: dict[str, Any] | None = None
    if data is not None:
        partial = schemas.validate_draft_data(draft.content_type, data)
        merged = dict(draft.data or {})
        merged.update(partial)
        merged_data = merged
    refs: list[tuple[uuid.UUID, int, str]] | None = None
    if images is not None:
        refs = schemas.normalize_image_inputs(images)
        _validate_images_usable(session, owner_id=owner_id, refs=refs)

    try:
        if merged_data is not None:
            # 赋新 dict 而不是原地改：JSONB 列的变更检测依赖赋值。
            draft.data = merged_data
        if refs is not None:
            _replace_draft_media(session, draft_id=draft.id, refs=refs)
        draft.bump_version()
        session.commit()
    except IntegrityError:
        session.rollback()
        raise conflict("草稿保存冲突，请重试") from None
    except Exception:
        session.rollback()
        raise
    return draft


# --- 丢弃（DELETE） ---------------------------------------------------------


def discard_draft(
    session: Session, *, owner_id: uuid.UUID, draft_id: uuid.UUID
) -> None:
    """丢弃工作草稿：active → discarded，删除媒体保留关系，单事务提交。

    **只解除关系，不删除 media 文件**；不影响正式内容与其他媒体引用
    （草稿的保留关系本来就不登记公开引用，见 `media.public_refs`）。
    """
    draft = lock_draft(session, owner_id=owner_id, draft_id=draft_id)
    if draft.status != STATUS_ACTIVE:
        raise conflict("工作草稿已提交或已丢弃，不能重复丢弃")
    session.execute(delete(work_draft_media).where(work_draft_media.c.draft_id == draft.id))
    draft.status = STATUS_DISCARDED
    draft.updated_at = utcnow()
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise conflict("工作草稿丢弃冲突，请重试") from None


# --- 提交（commit） ---------------------------------------------------------


def _formal_media_refs(
    session: Session,
    *,
    owner_id: uuid.UUID,
    refs: list[tuple[uuid.UUID, int, str]],
) -> list[tuple[uuid.UUID, int, str]]:
    """把草稿图片关系校验成正式内容可用的关系（失败 422）。

    正式规则与草稿的差别只有两点，但都必须拦住：
      - 顺序从 0 开始连续（正式 schemas 的 `assert_contiguous_positions`）；
      - 替代文本 1–200 码点 —— **草稿允许空 alt，正式内容不允许**。
    """
    positions = [int(position) for _media_id, position, _alt in refs]
    if sorted(positions) != list(range(len(positions))):
        raise validation_failed(
            "图片顺序不符合正式内容要求",
            {"images": ["图片顺序必须从 0 开始且连续、不重复"]},
        )
    if not refs:
        return []
    _validate_images_usable(session, owner_id=owner_id, refs=refs)
    normalized: list[tuple[uuid.UUID, int, str]] = []
    problems: list[str] = []
    for media_id, position, alt in refs:
        clean = (alt or "").strip()
        if not clean:
            problems.append(f"第 {int(position) + 1} 张图缺少替代文本")
            continue
        if codepoint_length(clean) > MOMENT_ALT_MAX_CODEPOINTS:
            problems.append(
                f"第 {int(position) + 1} 张图替代文本超过 {MOMENT_ALT_MAX_CODEPOINTS} 个字符"
            )
            continue
        normalized.append((media_id, int(position), clean[:MOMENT_ALT_MAX_CODEPOINTS]))
    if problems:
        raise validation_failed("图片不符合正式内容要求", {"images": problems})
    normalized.sort(key=lambda item: item[1])
    return normalized


def _album_link_mappings(links: list) -> list[dict[str, Any]]:
    """把草稿 JSONB 里的 album_links 还原成 gallery.sources 期望的 UUID 结构。"""
    mappings: list[dict[str, Any]] = []
    for link in links:
        mappings.append(
            {
                "album_id": uuid.UUID(str(link["album_id"])),
                "media_ids": [
                    uuid.UUID(str(media_id)) for media_id in (link.get("media_ids") or [])
                ],
            }
        )
    return mappings


def _apply_moment_commit(
    session: Session,
    *,
    owner_id: uuid.UUID,
    target: Moment | None,
    data: dict[str, Any],
    refs: list[tuple[uuid.UUID, int, str]],
    action: str,
) -> Moment:
    """在调用方事务内写入动态正式内容（不提交）。失败抛 ApiError。"""
    formal_refs = _formal_media_refs(session, owner_id=owner_id, refs=refs)
    images = [
        MomentImageIn(media_id=media_id, position=position, alt=alt)
        for media_id, position, alt in formal_refs
    ]
    # 未在草稿 data 里出现过的键 = 保留正式内容原值（新建时取默认值）。
    if "text" in data:
        text: str | None = str(data.get("text") or "")
    elif target is None:
        text = ""
    else:
        text = None
    tags = data.get("tags") if "tags" in data else None
    album_links = (
        _album_link_mappings(data.get("album_links") or [])
        if "album_links" in data
        else None
    )
    try:
        return moments_service.write_moment_pending(
            session,
            author_id=owner_id,
            moment=target,
            text=text,
            images=images,
            tags=tags,
            album_links=album_links,
            publish=action == "publish",
        )
    except ApiError as exc:
        if exc.status_code == 409:
            # commit 契约：正式内容校验失败统一 422 + 字段（不是 409）。
            raise validation_failed(exc.message, exc.fields) from None
        raise


def _apply_journal_commit(
    session: Session,
    *,
    owner_id: uuid.UUID,
    target: JournalEntry | None,
    data: dict[str, Any],
    refs: list[tuple[uuid.UUID, int, str]],
    action: str,
) -> JournalEntry:
    """在调用方事务内写入手记正式内容（不提交）。失败抛 ApiError。"""
    formal_refs = _formal_media_refs(session, owner_id=owner_id, refs=refs)
    changes: dict[str, Any] = {}
    for field in JOURNAL_DATA_FIELDS:
        if field not in data:
            continue
        value = data[field]
        if field == "entry_date" and value is not None:
            value = date.fromisoformat(str(value))
        if field == "post_id" and value is not None:
            value = uuid.UUID(str(value))
        changes[field] = value
    if target is None and "entry_date" not in changes:
        raise validation_failed(
            "新建手记前需要先选择日期",
            {"data.entry_date": ["新建手记必须提供 entry_date"]},
        )
    try:
        return journal_service.write_entry_pending(
            session,
            entry=target,
            changes=changes,
            images=formal_refs,
            publish=action == "publish",
        )
    except ApiError as exc:
        if exc.status_code == 409:
            raise validation_failed(exc.message, exc.fields) from None
        raise


def _allowed_actions(target) -> set[str]:
    """动作矩阵（契约 §3.3）：新内容 / 正式草稿可 save|publish，已发布只能 update。"""
    if target is None or target.status == FORMAL_STATUS_DRAFT:
        return {"save", "publish"}
    return {"update"}


def _check_expected_target_version(target, expected: int | None) -> None:
    """双版本检查的另一半：`expected_target_version` 必须等于正式内容当前版本。"""
    if target is None:
        if expected is not None:
            raise validation_failed(
                "新建内容不能指定 expected_target_version（应为 null）",
                {"expected_target_version": ["新建内容必须为 null"]},
            )
        return
    if expected is None:
        raise validation_failed(
            "更新已有内容必须提供 expected_target_version",
            {"expected_target_version": ["缺少正式内容版本"]},
        )
    if int(expected) != int(target.version):
        raise _version_conflict(
            "正式内容已在别处更新，请先读取最新版本再提交。",
            {
                "expected_target_version": [
                    f"正式内容当前版本为 {int(target.version)}，提交的是 {int(expected)}"
                ]
            },
        )


def _assert_commit_key_available(
    session: Session,
    *,
    owner_id: uuid.UUID,
    commit_key: uuid.UUID,
    draft_id: uuid.UUID,
) -> None:
    """跨草稿的幂等键唯一性：同一个 key 被别的草稿用过 → 409（不错误回放）。"""
    existing = session.execute(
        select(WorkDraft.id)
        .where(
            WorkDraft.owner_id == owner_id,
            WorkDraft.commit_key == commit_key,
            WorkDraft.id != draft_id,
        )
        .limit(1)
    ).first()
    if existing is not None:
        raise conflict(
            "commit_key 已被其他草稿使用，请使用新的幂等键重试",
            {"commit_key": ["同一 commit_key 不能跨草稿复用"]},
        )


def _replay_result(
    session: Session, *, draft: WorkDraft, action: str
) -> schemas.CommitResultOut:
    """幂等回放：返回上次提交的结果（正式内容版本取 `committed_target_version`）。"""
    target_id = draft.committed_target_id
    if target_id is None:  # pragma: no cover - 正常提交路径一定会写
        raise conflict("该草稿没有可回放的提交结果")
    if draft.content_type == CONTENT_TYPE_MOMENT:
        target = session.get(Moment, target_id)
    else:
        target = session.get(JournalEntry, target_id)
    target_version = int(draft.committed_target_version or 0)
    if target_version < 1:
        target_version = int(getattr(target, "version", 1))
    if target is None:  # pragma: no cover - 正式内容只软删除，行仍在
        raise conflict("上次提交产生的正式内容已不可用")
    return schemas.CommitResultOut(
        draft_id=draft.id,
        content_type=draft.content_type,
        target_id=target_id,
        target_version=target_version,
        status=target.status,
        visibility=(
            str(target.visibility) if draft.content_type == CONTENT_TYPE_JOURNAL else None
        ),
        action=action,
        idempotent_replay=True,
    )


def commit_draft(
    session: Session,
    *,
    owner_id: uuid.UUID,
    draft_id: uuid.UUID,
    action: str,
    expected_target_version: int | None,
    commit_key: uuid.UUID,
    if_match: str | None,
    request_id: str | None = None,
) -> schemas.CommitResultOut:
    """显式提交工作草稿（契约 §3.3 / §9.3 的顺序）。

    1. 锁草稿行；committed + 同 key → 幂等回放（**不校验 If-Match**）；
       committed + 不同 key → 409；discarded → 409；
    2. commit_key 已被其他草稿使用 → 409；
    3. 校验 If-Match（428/412）、动作矩阵（409）、expected_target_version（422/412）；
    4. 锁正式内容行（已有 target 时），在**同一事务**内应用内容 + 媒体关系 +
       相册来源 + 发布状态 + 草稿 committed_*，最后一次性 commit；
    5. 任何失败回滚：草稿保持 active，正式内容不变。
    """
    draft = lock_draft(session, owner_id=owner_id, draft_id=draft_id)

    # --- 1. 幂等优先于 If-Match -------------------------------------------
    if draft.status == STATUS_COMMITTED:
        if draft.commit_key == commit_key:
            result = _replay_result(session, draft=draft, action=action)
            # 回放是只读的；主动结束事务，释放 FOR UPDATE 行锁。
            session.rollback()
            return result
        raise conflict(
            "工作草稿已提交过；重试请复用同一 commit_key",
            {"commit_key": ["与上次提交的 commit_key 不一致"]},
        )
    if draft.status == STATUS_DISCARDED:
        raise conflict("工作草稿已被丢弃，无法提交")

    # --- 2. 跨草稿幂等键唯一性 --------------------------------------------
    _assert_commit_key_available(
        session, owner_id=owner_id, commit_key=commit_key, draft_id=draft.id
    )

    # --- 3. 草稿版本（If-Match） ------------------------------------------
    expected_draft_version = parse_if_match(if_match)
    if expected_draft_version != int(draft.draft_version):
        raise _version_conflict(
            "草稿已在别处更新，请先读取最新版本再提交。",
            {
                "draft_version": [
                    f"当前草稿版本为 {int(draft.draft_version)}，提交的是 {expected_draft_version}"
                ]
            },
        )

    # --- 4. 正式内容目标与双版本检查 --------------------------------------
    target = None
    if draft.target_id is not None:
        target = _lock_target(
            session,
            owner_id=owner_id,
            content_type=draft.content_type,
            target_id=draft.target_id,
        )
    _check_expected_target_version(target, expected_target_version)
    allowed = _allowed_actions(target)
    if action not in allowed:
        raise conflict(
            f"当前状态不能执行 {action}，只允许：{' / '.join(sorted(allowed))}",
            {"action": [f"可执行动作：{' / '.join(sorted(allowed))}"]},
        )

    data = dict(draft.data or {})
    refs = draft_images(session, [draft.id]).get(draft.id, [])

    try:
        if draft.content_type == CONTENT_TYPE_MOMENT:
            result_target = _apply_moment_commit(
                session,
                owner_id=owner_id,
                target=target,
                data=data,
                refs=refs,
                action=action,
            )
        elif draft.content_type == CONTENT_TYPE_JOURNAL:
            result_target = _apply_journal_commit(
                session,
                owner_id=owner_id,
                target=target,
                data=data,
                refs=refs,
                action=action,
            )
        else:  # pragma: no cover - content_type 由数据库 CHECK 约束保证
            raise validation_failed("内容类型不合法", {"content_type": ["未知内容类型"]})

        draft.status = STATUS_COMMITTED
        draft.commit_key = commit_key
        draft.committed_target_id = result_target.id
        draft.committed_target_version = int(result_target.version)
        draft.updated_at = utcnow()
        auth_service.record_audit(
            session,
            action=AUDIT_COMMIT,
            entity_type=f"work_draft:{draft.content_type}",
            entity_id=draft.id,
            actor_id=owner_id,
            request_id=request_id,
            extra={
                "action": action,
                "target_id": str(result_target.id),
                "target_status": result_target.status,
                "target_version": int(result_target.version),
            },
            commit=False,
        )
        session.commit()
    except ApiError:
        session.rollback()
        raise
    except IntegrityError:
        # 并发下另一草稿抢先用掉了同一 commit_key（部分唯一索引）→ 409。
        session.rollback()
        raise conflict(
            "提交冲突：commit_key 已被其他草稿使用，请使用新的幂等键重试",
            {"commit_key": ["同一 commit_key 不能跨草稿复用"]},
        ) from None
    except Exception:
        session.rollback()
        raise

    return schemas.CommitResultOut(
        draft_id=draft.id,
        content_type=draft.content_type,
        target_id=result_target.id,
        target_version=int(result_target.version),
        status=result_target.status,
        visibility=(
            str(result_target.visibility)
            if draft.content_type == CONTENT_TYPE_JOURNAL
            else None
        ),
        action=action,
        idempotent_replay=False,
    )


__all__ = [
    "clamp_limit",
    "commit_draft",
    "create_draft",
    "discard_draft",
    "draft_images",
    "draft_out",
    "drafts_out",
    "get_draft",
    "list_drafts",
    "lock_draft",
    "not_found",
    "patch_draft",
]
