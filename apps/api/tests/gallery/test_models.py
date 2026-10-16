"""相册模型与数据库约束（T06 执行清单第 3 条）。

断言真实 PostgreSQL 的约束行为：

  - `albums.kind` / `status` / `position` / `version` 的取值域；
  - slug 唯一；
  - 同一相册的 `media_id` 唯一、`position` 唯一、position 范围、alt 长度；
  - `taken_on` **可空**（07 §5「拍摄时间可选」）—— 这条是正向断言：
    没有拍摄时间的照片必须能存进去，而不是被 NOT NULL 逼着编一个日期；
  - 媒体被引用时不可物理删除（RESTRICT）。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.modules.gallery.models import Album, album_media
from tests.projects.helpers import (
    attach_photos,
    make_album,
    make_media,
    unique_slug,
)
from tests.support.t06_shared import make_admin


def test_album_kind_check_constraint(t06_session) -> None:
    album = make_album(t06_session, slug=unique_slug("kind"))
    with pytest.raises(IntegrityError):
        t06_session.execute(
            text("update albums set kind = 'video' where id = :id"), {"id": album.id}
        )


def test_album_status_check_constraint(t06_session) -> None:
    album = make_album(t06_session, slug=unique_slug("status"))
    with pytest.raises(IntegrityError):
        t06_session.execute(
            text("update albums set status = 'archived' where id = :id"), {"id": album.id}
        )


def test_album_position_non_negative(t06_session) -> None:
    album = make_album(t06_session, slug=unique_slug("pos"))
    with pytest.raises(IntegrityError):
        t06_session.execute(
            text("update albums set position = -1 where id = :id"), {"id": album.id}
        )


def test_album_slug_is_unique(t06_session) -> None:
    slug = unique_slug("dupalbum")
    make_album(t06_session, slug=slug)
    with pytest.raises(IntegrityError):
        make_album(t06_session, slug=slug, title="第二个")


def test_same_media_cannot_appear_twice_in_one_album(t06_session) -> None:
    owner = make_admin(t06_session, username="album-owner")
    album = make_album(t06_session, slug=unique_slug("dup"))
    media = make_media(t06_session, owner)
    attach_photos(t06_session, album, [(media.id, 0, "第一次", None)])
    with pytest.raises(IntegrityError):
        attach_photos(t06_session, album, [(media.id, 1, "第二次", None)])


def test_same_position_cannot_appear_twice(t06_session) -> None:
    owner = make_admin(t06_session, username="album-owner2")
    album = make_album(t06_session, slug=unique_slug("duppos"))
    first = make_media(t06_session, owner)
    second = make_media(t06_session, owner)
    attach_photos(t06_session, album, [(first.id, 0, "第一张", None)])
    with pytest.raises(IntegrityError):
        attach_photos(t06_session, album, [(second.id, 0, "同一格", None)])


def test_photo_position_range_check(t06_session) -> None:
    owner = make_admin(t06_session, username="album-owner3")
    album = make_album(t06_session, slug=unique_slug("range"))
    media = make_media(t06_session, owner)
    with pytest.raises(IntegrityError):
        t06_session.execute(
            album_media.insert().values(
                album_id=album.id,
                media_id=media.id,
                position=200,
                alt="越界",
                caption="",
            )
        )


def test_alt_is_required_and_bounded(t06_session) -> None:
    owner = make_admin(t06_session, username="album-owner4")
    album = make_album(t06_session, slug=unique_slug("alt"))
    media = make_media(t06_session, owner)
    with pytest.raises(IntegrityError):
        t06_session.execute(
            album_media.insert().values(
                album_id=album.id, media_id=media.id, position=0, alt="", caption=""
            )
        )


def test_taken_on_is_nullable_and_stored(t06_session) -> None:
    """没有拍摄时间的照片与有拍摄时间的照片都能存（07 §5：拍摄时间可空）。"""
    from datetime import date

    owner = make_admin(t06_session, username="album-owner5")
    album = make_album(t06_session, slug=unique_slug("taken"))
    without = make_media(t06_session, owner)
    with_date = make_media(t06_session, owner)
    attach_photos(
        t06_session,
        album,
        [(without.id, 0, "没有拍摄时间", None), (with_date.id, 1, "有拍摄时间", date(2026, 10, 16))],
    )
    rows = t06_session.execute(
        text(
            "select position, taken_on from album_media where album_id = :id order by position"
        ),
        {"id": album.id},
    ).all()
    assert rows[0][1] is None
    assert rows[1][1] == date(2026, 10, 16)


def test_caption_is_optional(t06_session) -> None:
    owner = make_admin(t06_session, username="album-owner6")
    album = make_album(t06_session, slug=unique_slug("caption"))
    media = make_media(t06_session, owner)
    attach_photos(t06_session, album, [(media.id, 0, "", None)])
    value = t06_session.execute(
        text("select caption from album_media where album_id = :id"), {"id": album.id}
    ).scalars().one()
    assert value == ""


def test_media_reference_is_restricted(t06_session) -> None:
    owner = make_admin(t06_session, username="album-owner7")
    album = make_album(t06_session, slug=unique_slug("restrict"))
    media = make_media(t06_session, owner)
    attach_photos(t06_session, album, [(media.id, 0, "说明", None)])
    with pytest.raises(IntegrityError):
        t06_session.execute(text("delete from media where id = :id"), {"id": media.id})


def test_deleting_album_releases_photo_rows(t06_session) -> None:
    owner = make_admin(t06_session, username="album-owner8")
    album = make_album(t06_session, slug=unique_slug("cascade"))
    media = make_media(t06_session, owner)
    attach_photos(t06_session, album, [(media.id, 0, "说明", None)])
    t06_session.execute(text("delete from albums where id = :id"), {"id": album.id})
    t06_session.flush()
    remaining = t06_session.execute(
        text("select count(*) from album_media where album_id = :id"), {"id": album.id}
    ).scalars().one()
    assert remaining == 0


def test_version_is_positive(t06_session) -> None:
    album = make_album(t06_session, slug=unique_slug("ver"))
    with pytest.raises(IntegrityError):
        t06_session.execute(
            text("update albums set version = 0 where id = :id"), {"id": album.id}
        )


def test_title_length_is_bounded_by_the_column_type(t06_session) -> None:
    """超长标题由列类型拒绝（String(200) → varchar(200)）。

    PostgreSQL 对超长 varchar 报的是 `StringDataRightTruncation`（SQLAlchemy 侧是
    `DataError`，不是 IntegrityError）。这里如实断言真实的异常类型 ——
    写错类型会让「约束真的生效了吗」这个问题失去意义。
    """
    from sqlalchemy.exc import DataError

    album = make_album(t06_session, slug=unique_slug("title"))
    with pytest.raises(DataError):
        t06_session.execute(
            text("update albums set title = :title where id = :id"),
            {"id": album.id, "title": "x" * 201},
        )


def test_kind_labels_are_defined_for_every_kind() -> None:
    from app.modules.gallery.models import ALBUM_KINDS, KIND_LABELS

    assert set(ALBUM_KINDS) == set(KIND_LABELS)
