"""媒体服务：上传落盘、授权读取、孤儿识别（05 §4 / §8）。

关键顺序（05 §4 明确「文件系统与数据库不是同一事务」）：
  1. 校验与处理图片（CPU 操作放进有界线程池）——失败时**什么都没写**。
  2. 先写原图、再写各变体；任一步失败 → 删除本次已写对象后抛错，不留半截对象。
  3. 文件全部落位后，才插入 `ready` 记录并提交。
     提交失败 → 异常向上抛（客户端拿不到「上传成功」），已落位的文件成为
     **可识别的孤儿对象**，由 `list_orphan_objects` 报给清理任务。
     不把「数据库回滚」描述成能自动回滚文件，也不静默删掉可能被引用的文件。

授权（05 §8）：原图永远只给站主；匿名读变体要同时满足 ready + 未删除 + 至少一个公开引用。
任何不满足的情况统一 404 —— 不区分「不存在」与「无权」，避免用状态码探测 UUID。
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import UploadFile
from sqlalchemy import select, tuple_
from sqlalchemy.orm import Session

from app.core.db import utcnow
from app.core.errors import (
    CODE_NOT_FOUND,
    CODE_PAYLOAD_TOO_LARGE,
    CODE_SERVICE_UNAVAILABLE,
    ApiError,
)
from app.core.pagination import (
    DEFAULT_LIMIT,
    MAX_LIMIT,
    decode_cursor,
    encode_cursor,
    filter_fingerprint,
)
from app.modules.media import public_refs, storage
from app.modules.media.models import STATUS_FAILED, STATUS_PROCESSING, STATUS_READY, Media
from app.modules.media.pipeline import ImageLimits, process_image
from app.modules.media.storage import ORIGINAL_VARIANT

logger = logging.getLogger(__name__)

READ_CHUNK_BYTES = 64 * 1024

# 超过这个时间的失败 / 未完成对象进入清理报告（05 §8）。
DEFAULT_ORPHAN_AGE = timedelta(days=7)


def not_found() -> ApiError:
    """媒体不可读的统一错误。不泄漏「存在但无权」与「不存在」的区别。"""
    return ApiError(CODE_NOT_FOUND, "媒体不存在或不可访问", status_code=404)


def _storage_unavailable(exc: BaseException) -> ApiError:
    logger.error("媒体存储写入失败：%s", type(exc).__name__)
    return ApiError(CODE_SERVICE_UNAVAILABLE, "媒体存储暂时不可用，请稍后重试", status_code=503)


async def read_upload_within_limit(upload: UploadFile, *, max_bytes: int) -> bytes:
    """分块读取上传内容并强制单文件上限（网关上限之外的独立校验，05 §8）。"""
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await upload.read(READ_CHUNK_BYTES)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise ApiError(
                CODE_PAYLOAD_TOO_LARGE,
                "文件过大，单张图片上限为 8 MiB",
                status_code=413,
                fields={"file": ["文件过大"]},
            )
        chunks.append(chunk)
    return b"".join(chunks)


async def process_upload(data: bytes, limits: ImageLimits, *, max_concurrency: int):
    """有界并发地处理图片（不阻塞事件循环）。"""
    from app.core.concurrency import run_bounded

    return await run_bounded(process_image, data, limits, max_concurrency=max_concurrency)


async def create_media(
    session: Session,
    *,
    root: Path,
    owner_id: uuid.UUID,
    data: bytes,
    limits: ImageLimits,
    max_concurrency: int,
) -> Media:
    """完整上传流程。成功返回已提交的 ready 记录。"""
    processed = await process_upload(data, limits, max_concurrency=max_concurrency)

    media_id = uuid.uuid4()
    original_key = storage.original_object_key(media_id, processed.mime_type)
    variant_payload: dict[str, dict[str, object]] = {}
    written: list[str] = []

    try:
        storage.write_object(root, original_key, processed.data)
        written.append(original_key)
        for artifact in processed.variants:
            key = storage.variant_object_key(media_id, artifact.name)
            storage.write_object(root, key, artifact.data)
            written.append(key)
            variant_payload[artifact.name] = {
                "key": key,
                "mime_type": artifact.mime_type,
                "width": artifact.width,
                "height": artifact.height,
                "bytes": len(artifact.data),
            }
    except OSError as exc:
        storage.cleanup_objects(root, written)
        raise _storage_unavailable(exc) from exc

    media = Media(
        id=media_id,
        owner_id=owner_id,
        storage_key=original_key,
        mime_type=processed.mime_type,
        bytes=len(processed.data),
        width=processed.width,
        height=processed.height,
        sha256=processed.sha256,
        variants=variant_payload,
        status=STATUS_READY,
    )
    session.add(media)
    # 提交失败时文件保留在磁盘上，由孤儿报告识别（见模块 docstring）。
    session.commit()
    return media


async def ingest_file(
    session: Session,
    *,
    root: Path,
    owner_id: uuid.UUID,
    source: Path,
    limits: ImageLimits,
    max_concurrency: int,
) -> Media:
    """把仓库里已有的图片登记进媒体存储（旧文章封面导入用）。

    以原图 sha256 去重：重复导入同一张封面不会产生第二份对象。
    """
    data = source.read_bytes()
    processed = await process_upload(data, limits, max_concurrency=max_concurrency)
    existing = session.execute(
        select(Media).where(Media.sha256 == processed.sha256, Media.deleted_at.is_(None))
    ).scalars().first()
    if existing is not None:
        return existing
    return await create_media(
        session,
        root=root,
        owner_id=owner_id,
        data=data,
        limits=limits,
        max_concurrency=max_concurrency,
    )


def get_media(session: Session, media_id: uuid.UUID) -> Media | None:
    return session.get(Media, media_id)


# --- 管理侧媒体列表 / 详情（P5 共享图片选择器，契约 §3.4）------------------


def clamp_limit(limit: int | None) -> int:
    if limit is None:
        return DEFAULT_LIMIT
    return max(1, min(int(limit), MAX_LIMIT))


def list_admin_media(
    session: Session,
    *,
    owner_id: uuid.UUID,
    status: str | None = None,
    cursor: str | None = None,
    limit: int | None = None,
) -> tuple[list[Media], str | None]:
    """站主媒体分页：`(created_at DESC, id DESC)` + 不透明游标（契约 §3.4）。

    只返回**未删除**的本人媒体；`status` 可选过滤（processing / ready / failed）。
    排序键带 id 兜底，同一时间戳的多行分页不漏不重；游标里带筛选指纹。
    """
    size = clamp_limit(limit)
    fingerprint = filter_fingerprint({"scope": "admin-media", "status": status})

    conditions = [Media.owner_id == owner_id, Media.deleted_at.is_(None)]
    if status is not None:
        conditions.append(Media.status == status)

    statement = select(Media).where(*conditions)
    if cursor:
        sort_value, entity_id = decode_cursor(cursor, fingerprint=fingerprint)
        statement = statement.where(
            tuple_(Media.created_at, Media.id) < tuple_(sort_value, entity_id)
        )
    statement = statement.order_by(Media.created_at.desc(), Media.id.desc()).limit(size + 1)
    rows = list(session.execute(statement).scalars().all())

    next_cursor: str | None = None
    if len(rows) > size:
        rows = rows[:size]
        last = rows[-1]
        next_cursor = encode_cursor(
            sort_value=last.created_at, entity_id=last.id, fingerprint=fingerprint
        )
    return rows, next_cursor


def get_admin_media(
    session: Session, media_id: uuid.UUID, *, owner_id: uuid.UUID
) -> Media:
    """站主媒体详情：只允许看自己的、未删除的媒体，否则统一 404。"""
    media = session.get(Media, media_id)
    if media is None or media.deleted_at is not None or media.owner_id != owner_id:
        raise not_found()
    return media


@dataclass(frozen=True)
class VariantObject:
    key: str
    mime_type: str
    width: int
    height: int
    bytes: int


def resolve_variant(media: Media, variant_name: str) -> VariantObject | None:
    """把变体名解析成对象。未知变体名返回 None（调用方给 404）。"""
    if variant_name == ORIGINAL_VARIANT:
        return VariantObject(
            key=media.storage_key,
            mime_type=media.mime_type,
            width=media.width,
            height=media.height,
            bytes=media.bytes,
        )
    if variant_name not in storage.VARIANT_FILENAMES:
        return None
    entry = (media.variants or {}).get(variant_name)
    if not isinstance(entry, dict) or not entry.get("key"):
        return None
    return VariantObject(
        key=str(entry["key"]),
        mime_type=str(entry.get("mime_type", "image/webp")),
        width=int(entry.get("width", 0)),
        height=int(entry.get("height", 0)),
        bytes=int(entry.get("bytes", 0)),
    )


def ensure_anonymous_readable(session: Session, media: Media | None, variant_name: str) -> Media:
    """匿名读取闸门：原图、未 ready、已删除、无公开引用，全部 404。"""
    if media is None or media.deleted_at is not None or media.status != STATUS_READY:
        raise not_found()
    if variant_name == ORIGINAL_VARIANT:
        # 原始文件永远只允许站主访问，即使它关联的内容已经公开（05 §8）。
        raise not_found()
    if not public_refs.is_publicly_referenced(session, media.id):
        raise not_found()
    return media


def read_object_bytes(root: Path, key: str) -> bytes:
    """读对象内容。数据库里有记录但文件缺失时按不可读处理，不返回空文件。"""
    try:
        path = storage.object_path(root, key)
    except storage.StorageKeyError:
        raise not_found() from None
    try:
        return path.read_bytes()
    except OSError:
        logger.error("媒体对象缺失或不可读：%s", key)
        raise not_found() from None


def soft_delete_media(session: Session, media: Media) -> None:
    """软删除。不物理删除文件：可能还有别的公开引用与保留期（05 §4）。"""
    if media.deleted_at is None:
        media.deleted_at = utcnow()
        session.commit()


@dataclass
class OrphanReport:
    """清理报告的输入。只给对象键与记录 id，不给绝对路径。"""

    unreferenced_keys: list[str] = field(default_factory=list)
    stale_record_ids: list[str] = field(default_factory=list)

    @property
    def is_empty(self) -> bool:
        return not self.unreferenced_keys and not self.stale_record_ids


def list_orphan_objects(
    session: Session,
    root: Path,
    *,
    older_than: timedelta = DEFAULT_ORPHAN_AGE,
    now: datetime | None = None,
) -> OrphanReport:
    """识别可清理对象：磁盘上无记录引用的文件 + 超过保留期仍未 ready 的记录。

    实际删除前必须再检查引用与备份保留策略（05 §8），因此这里只报告。
    """
    referenced: set[str] = set()
    for media in session.execute(select(Media)).scalars():
        referenced.update(media.object_keys())

    stored = set(storage.iter_stored_keys(root))
    stale_records: list[str] = []
    moment = now or utcnow()
    threshold = moment - older_than
    for media in session.execute(
        select(Media).where(Media.status.in_((STATUS_PROCESSING, STATUS_FAILED)))
    ).scalars():
        created_at = media.created_at
        if created_at is not None and created_at <= threshold:
            stale_records.append(str(media.id))

    return OrphanReport(
        unreferenced_keys=sorted(stored - referenced),
        stale_record_ids=sorted(stale_records),
    )
