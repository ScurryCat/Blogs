"""IM 图片消息 · 内容卡片解析（B4 方案 A · Phase 1）。

证明「图片卡」不是前端/模型给的 URL：
  - 直接 `image` 卡：媒体必须 ready + 有公开引用 + 有 w640 变体，否则静默丢弃；
  - `album_photo` 卡：必须是**公开相册**里的公开照片（复用 gallery 公开投影），否则丢弃；
  - 卡片的 `url` 永远由服务端生成（w640 变体，不是原图），并带 width/height/alt。
"""

from __future__ import annotations

import uuid
from datetime import timedelta

from sqlalchemy import insert

from app.core.db import utcnow
from app.modules.media import public_refs as media_public_refs
from app.modules.media.models import Media
from app.modules.messaging import content
from app.modules.messaging.stories.schema import ContentRef


def _owner(session):
    from app.modules.auth.models import AdminUser

    row = AdminUser(username=f"t08-img-{uuid.uuid4().hex[:8]}", password_hash="not-a-real-hash")
    session.add(row)
    session.flush()
    return row


def _media(session, *, ready: bool = True, with_w640: bool = True, deleted: bool = False) -> Media:
    row = Media(
        owner_id=_owner(session).id,
        storage_key=f"test/{uuid.uuid4().hex}.png",
        mime_type="image/png",
        bytes=10,
        width=800,
        height=600,
        sha256="a" * 64,
        status="ready" if ready else "processing",
        deleted_at=utcnow() if deleted else None,
        variants={
            "w640.webp": {
                "key": f"test/{uuid.uuid4().hex}.webp",
                "mime_type": "image/webp",
                "width": 640,
                "height": 480,
                "bytes": 5,
            }
        }
        if with_w640
        else {},
    )
    session.add(row)
    session.flush()
    return row


def _public_checker(public_ids):
    def checker(session, media_id):  # noqa: ANN001
        return media_id in public_ids

    media_public_refs.register("t08-image-test", checker)


def test_image_card_resolves_public_ready_media(t08_session) -> None:
    media = _media(t08_session)
    _public_checker({media.id})
    try:
        cards = content.resolve_refs(
            t08_session, (ContentRef(kind="image", id=str(media.id), label="一张测试照片"),)
        )
    finally:
        media_public_refs.unregister("t08-image-test")

    assert len(cards) == 1
    card = cards[0]
    assert card.kind == "image"
    assert card.id == str(media.id)
    assert card.url == f"/api/v1/media/{media.id}/w640.webp"
    assert (card.width, card.height) == (640, 480)
    assert card.alt == "一张测试照片"
    payload = card.as_payload()
    assert payload["kind"] == "image" and payload["width"] == 640 and payload["height"] == 480


def test_image_card_dropped_when_not_public(t08_session) -> None:
    media = _media(t08_session)
    _public_checker(set())  # 无公开引用
    try:
        cards = content.resolve_refs(
            t08_session, (ContentRef(kind="image", id=str(media.id), label="不该出现"),)
        )
    finally:
        media_public_refs.unregister("t08-image-test")
    assert cards == []


def test_image_card_dropped_when_media_not_ready_or_deleted(t08_session) -> None:
    not_ready = _media(t08_session, ready=False)
    deleted = _media(t08_session, deleted=True)
    _public_checker({not_ready.id, deleted.id})
    try:
        cards = content.resolve_refs(
            t08_session,
            (
                ContentRef(kind="image", id=str(not_ready.id), label="未 ready"),
                ContentRef(kind="image", id=str(deleted.id), label="已删除"),
            ),
        )
    finally:
        media_public_refs.unregister("t08-image-test")
    assert cards == []


def test_image_card_dropped_without_w640_variant(t08_session) -> None:
    media = _media(t08_session, with_w640=False)
    _public_checker({media.id})
    try:
        cards = content.resolve_refs(
            t08_session, (ContentRef(kind="image", id=str(media.id), label="没有变体"),)
        )
    finally:
        media_public_refs.unregister("t08-image-test")
    assert cards == []


def test_image_card_bad_uuid_is_dropped(t08_session) -> None:
    cards = content.resolve_refs(
        t08_session, (ContentRef(kind="image", id="not-a-uuid", label="坏 id"),)
    )
    assert cards == []


def _album_with_photo(session, *, slug: str, published: bool = True, photo_media: Media):
    from app.modules.gallery.models import Album, album_media
    from app.modules.gallery import sources as gallery_sources

    album = Album(
        slug=slug,
        title=f"测试相册 {slug}",
        kind="photo",
        position=0,
        status="published" if published else "draft",
        published_at=utcnow() - timedelta(hours=1) if published else None,
    )
    session.add(album)
    session.flush()
    session.execute(
        insert(album_media),
        [
            {
                "album_id": album.id,
                "media_id": photo_media.id,
                "position": 0,
                "alt": "相册里的照片",
                "caption": "东京夜景",
                "taken_on": None,
            }
        ],
    )
    if published:
        gallery_sources.ensure_independent_sources(
            session, album_id=album.id, media_ids=[photo_media.id]
        )
    session.flush()
    return album


def test_album_photo_card_resolves_public_album_photo(t08_session) -> None:
    media = _media(t08_session)
    album = _album_with_photo(t08_session, slug="tokyo-nights-test", photo_media=media)
    cards = content.resolve_refs(
        t08_session, (ContentRef(kind="album_photo", id=f"{album.slug}:0", label="舞台侧拍"),)
    )
    assert len(cards) == 1
    card = cards[0]
    assert card.kind == "album_photo"
    assert card.id == "tokyo-nights-test:0"
    assert card.url == f"/api/v1/media/{media.id}/w640.webp"
    assert (card.width, card.height) == (640, 480)
    assert card.alt == "相册里的照片"
    assert card.title == "舞台侧拍"
    assert card.summary == "东京夜景"


def test_album_photo_card_dropped_for_draft_album(t08_session) -> None:
    media = _media(t08_session)
    album = _album_with_photo(t08_session, slug="draft-album-test", published=False, photo_media=media)
    cards = content.resolve_refs(
        t08_session, (ContentRef(kind="album_photo", id=album.slug, label="草稿相册"),)
    )
    assert cards == []


def test_album_photo_card_dropped_for_out_of_range_index(t08_session) -> None:
    media = _media(t08_session)
    album = _album_with_photo(t08_session, slug="range-album-test", photo_media=media)
    cards = content.resolve_refs(
        t08_session, (ContentRef(kind="album_photo", id=f"{album.slug}:9", label="越界"),)
    )
    assert cards == []


def test_image_cards_count_towards_max_cards_per_message(t08_session) -> None:
    media_a = _media(t08_session)
    media_b = _media(t08_session)
    _public_checker({media_a.id, media_b.id})
    try:
        cards = content.resolve_refs(
            t08_session,
            (
                ContentRef(kind="image", id=str(media_a.id), label="第一张"),
                ContentRef(kind="image", id=str(media_b.id), label="第二张"),
            ),
        )
    finally:
        media_public_refs.unregister("t08-image-test")
    assert [card.kind for card in cards] == ["image", "image"]
