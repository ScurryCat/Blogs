"""N3 · 动态收录（album_links）与相册来源的跨域生命周期（任务书 §4.3–§4.7 / §8.2）。

本文件的用例**全部走真实管理端点**（Origin + CSRF + `If-Match`），并在需要媒体访问
权限的用例里显式登记图库 / 动态两个公开引用检查器 —— 默认拒绝的注册表不会被绕过。

覆盖任务书 §8.2 生命周期矩阵中与后端有关的部分：

  - 草稿动态＋公开相册（仅动态来源）→ 不公开；管理端可看配置；
  - 公开动态＋草稿相册 → 图库不公开、不自动发布相册；
  - 动态与相册都公开 → 图片出现；重复提交无重复关系；
  - 不传 album_links → 原选择保留，但动态换图时失效来源被清理；
  - 传空数组 → 只清空此动态的收录选择，其他来源不受影响；
  - 唯一动态来源撤回 / 删除 → 图库停止展示、不删媒体、最后公开引用失效时媒体权限撤销；
  - 还有独立或其他公开动态来源 → 图片仍可展示；
  - 重新发布 → 只恢复仍保留的配置，明确移除的不复活；
  - 相册侧单图删除 / 整组更新移除 → 同步清理动态收录配置，重发不加回；
  - 非法媒体 / 相册、旧版本并发、事务失败 → 清楚报错，无半完成。
"""

from __future__ import annotations

import uuid
from contextlib import contextmanager
from datetime import datetime, timezone

import pytest
from sqlalchemy import func, select

from app.modules.gallery.models import Album, album_media, album_media_sources
from tests.core.t01_db import assert_error
from tests.projects.helpers import (
    admin_client,
    anonymous_client,
    make_media,
    unique_slug,
    write_headers,
)

UTC = timezone.utc

ALBUMS_PATH = "/api/v1/gallery/albums"
PHOTOS_PATH = "/api/v1/gallery/photos"
ADMIN_ALBUMS_PATH = "/api/v1/admin/albums"
ADMIN_MOMENTS_PATH = "/api/v1/admin/moments"
MEDIA_PATH = "/api/v1/media"


# --- 夹具与辅助 -------------------------------------------------------------


def _admin_routers():
    from app.modules.gallery.router import router as gallery_router
    from app.modules.moments.router import router as moments_router

    return (("gallery", gallery_router), ("moments", moments_router))


def _public_routers():
    from app.modules.media.router import router as media_router

    return (*_admin_routers(), ("media", media_router))


@contextmanager
def media_domains_registered():
    """登记图库与动态两个媒体公开引用检查器；用例结束恢复「默认拒绝」。

    幂等：同一个用例里可以嵌套使用（已登记就不再重复登记，也不会提前撤销）。
    """
    from app.modules.gallery import wiring as gallery_wiring
    from app.modules.media import public_refs as media_public_refs
    from app.modules.moments import wiring as moments_wiring
    from app.modules.tags import service as tags_service

    registered_gallery = False
    registered_moments = False
    if "gallery" not in media_public_refs.registered():
        gallery_wiring.register()
        registered_gallery = True
    if "moments" not in media_public_refs.registered():
        moments_wiring.register()
        registered_moments = True
    try:
        yield
    finally:
        if registered_gallery:
            gallery_wiring.unregister()
        if registered_moments:
            # `moments_wiring.unregister()` 只注销媒体检查器；标签来源由 T01 的
            # 整体 reset 负责（见 moments/tags_source.py 的说明），这里显式清空，
            # 使嵌套使用本上下文时状态可回到「默认不贡献」。
            moments_wiring.unregister()
            tags_service.reset_public_tag_sources()


def _create_album(client, csrf, *, photos=None, **extra):
    body: dict[str, object] = {
        "slug": unique_slug("n3-album"),
        "title": "N3 测试相册",
        "kind": "photo",
        **extra,
    }
    if photos is not None:
        body["photos"] = photos
    response = client.post(ADMIN_ALBUMS_PATH, json=body, headers=write_headers(csrf))
    assert response.status_code == 201, response.text
    return response.json()


def _publish_album(client, csrf, album):
    response = client.post(
        f"{ADMIN_ALBUMS_PATH}/{album['id']}/publish",
        headers=write_headers(csrf, album["version"]),
    )
    assert response.status_code == 200, response.text
    return response.json()


def _unpublish_album(client, csrf, album):
    response = client.post(
        f"{ADMIN_ALBUMS_PATH}/{album['id']}/unpublish",
        headers=write_headers(csrf, album["version"]),
    )
    assert response.status_code == 200, response.text
    return response.json()


def _create_moment(client, csrf, *, images, album_links=None, text="N3 动态"):
    body: dict[str, object] = {"text": text, "images": images}
    if album_links is not None:
        body["album_links"] = album_links
    response = client.post(ADMIN_MOMENTS_PATH, json=body, headers=write_headers(csrf))
    assert response.status_code == 201, response.text
    return response.json()


def _publish_moment(client, csrf, moment):
    response = client.post(
        f"{ADMIN_MOMENTS_PATH}/{moment['id']}/publish",
        headers=write_headers(csrf, moment["version"]),
    )
    assert response.status_code == 200, response.text
    return response.json()


def _unpublish_moment(client, csrf, moment):
    response = client.post(
        f"{ADMIN_MOMENTS_PATH}/{moment['id']}/unpublish",
        headers=write_headers(csrf, moment["version"]),
    )
    assert response.status_code == 200, response.text
    return response.json()


def _patch_moment(client, csrf, moment, version=None, **body):
    if version is None:
        current = client.get(f"{ADMIN_MOMENTS_PATH}/{moment['id']}").json()
        version = current["version"]
    return client.patch(
        f"{ADMIN_MOMENTS_PATH}/{moment['id']}",
        json=body,
        headers=write_headers(csrf, version),
    )


def _image_payload(media_ids, *, alt_prefix="图"):
    return [
        {"media_id": str(media_id), "position": index, "alt": f"{alt_prefix}{index + 1}"}
        for index, media_id in enumerate(media_ids)
    ]


def _links(album_id, media_ids):
    return [{"album_id": str(album_id), "media_ids": [str(media_id) for media_id in media_ids]}]


def _album_link_ids(body: dict) -> list[str]:
    return [str(media_id) for link in body["album_links"] for media_id in link["media_ids"]]


def _source_row_count(session, album_id, media_id) -> int:
    return int(
        session.execute(
            select(func.count())
            .select_from(album_media_sources)
            .where(
                album_media_sources.c.album_id == album_id,
                album_media_sources.c.media_id == media_id,
            )
        ).scalars().one()
    )


def _album_media_row_count(session, album_id, media_id) -> int:
    return int(
        session.execute(
            select(func.count())
            .select_from(album_media)
            .where(
                album_media.c.album_id == album_id,
                album_media.c.media_id == media_id,
            )
        ).scalars().one()
    )


def _admin_album(client, album_id) -> dict:
    response = client.get(f"{ADMIN_ALBUMS_PATH}/{album_id}")
    assert response.status_code == 200, response.text
    return response.json()


# --- 草稿 / 公开组合 --------------------------------------------------------


def test_draft_moment_with_published_album_is_not_public_but_config_visible(
    t06_session, t06_settings
) -> None:
    """任务书 §8.2：草稿动态＋公开相册，仅动态来源 → 不公开；管理端可看配置。

    同时验证「配置存在 ≠ 公开资格」：动态还是草稿时，相册已经公开，照片也不出现。
    """
    with admin_client(
        t06_settings, t06_session, *_admin_routers()
    ) as (client, owner, csrf):
        media = make_media(t06_session, owner, root=t06_settings.media_root_path)
        album = _create_album(client, csrf)
        moment = _create_moment(
            client,
            csrf,
            images=_image_payload([media.id]),
            album_links=_links(album["id"], [media.id]),
        )

        # 管理端：相册回执能看到这张图，并标明它来自哪条动态。
        album_detail = _admin_album(client, album["id"])
        assert [photo["media_id"] for photo in album_detail["photos"]] == [str(media.id)]
        assert album_detail["photos"][0]["sources"] == [
            {"kind": "moment", "moment_id": moment["id"]}
        ]
        # 收录实际改变了相册内容 → 相册版本 +1（旧相册表单会 412）。
        assert album_detail["version"] == album["version"] + 1

        published = _publish_album(client, csrf, album_detail)
        assert published["status"] == "published"

        # 相册公开、动态草稿 → 公开相册存在但一张照片都不展示。
        with anonymous_client(t06_settings, t06_session, *_public_routers()) as anon:
            detail = anon.get(f"{ALBUMS_PATH}/{album['slug']}")
            assert detail.status_code == 200, detail.text
            assert detail.json()["photos"] == []
            assert detail.json()["photo_count"] == 0
            assert detail.json()["cover"] is None
            assert anon.get(PHOTOS_PATH).json()["total"] == 0
            assert anon.get(f"{PHOTOS_PATH}/years").json() == []
            # 动态没公开，也不构成媒体公开引用。
            assert anon.get(f"{MEDIA_PATH}/{media.id}/w320.webp").status_code == 404

        # 动态管理端仍能看到配置（草稿也要能继续编辑）。
        assert _album_link_ids(
            client.get(f"{ADMIN_MOMENTS_PATH}/{moment['id']}").json()
        ) == [str(media.id)]


def test_published_moment_with_draft_album_does_not_publish_album(
    t06_session, t06_settings
) -> None:
    """任务书 §8.2：公开动态＋草稿相册 → 图库不公开；不自动发布相册。

    但媒体的全站权限仍尊重**其他合法公开引用**：这张图出现在一条公开动态里，
    因此匿名读变体仍应 200（图库不公开 ≠ 误封动态的公开图片，任务书 §4.6 末段）。
    """
    with admin_client(
        t06_settings, t06_session, *_admin_routers()
    ) as (client, owner, csrf):
        media = make_media(t06_session, owner, root=t06_settings.media_root_path)
        album = _create_album(client, csrf)
        moment = _create_moment(
            client,
            csrf,
            images=_image_payload([media.id]),
            album_links=_links(album["id"], [media.id]),
        )
        with media_domains_registered():
            _publish_moment(client, csrf, moment)
        album_detail = _admin_album(client, album["id"])
        assert album_detail["status"] == "draft", "动态发布不能自动发布相册"
        # 相册自己的来源在相册草稿时不贡献图库资格，但动态本身是合法公开引用。
        with anonymous_client(t06_settings, t06_session, *_public_routers()) as anon:
            assert anon.get(f"{ALBUMS_PATH}/{album['slug']}").status_code == 404
            assert anon.get(PHOTOS_PATH).json()["total"] == 0
        with media_domains_registered():
            with anonymous_client(t06_settings, t06_session, *_public_routers()) as anon:
                assert (
                    anon.get(f"{MEDIA_PATH}/{media.id}/w320.webp").status_code == 200
                ), "公开动态是合法的全站公开引用，不能被图库的相册条件误封"


def test_both_public_shows_photo_and_repeat_submission_is_idempotent(
    t06_session, t06_settings
) -> None:
    """任务书 §8.2：动态与相册都公开 → 图片出现；重复提交无重复关系。"""
    with admin_client(
        t06_settings, t06_session, *_admin_routers()
    ) as (client, owner, csrf):
        media = make_media(t06_session, owner, root=t06_settings.media_root_path)
        album = _create_album(client, csrf)
        moment = _create_moment(
            client,
            csrf,
            images=_image_payload([media.id]),
            album_links=_links(album["id"], [media.id]),
        )
        with media_domains_registered():
            _publish_album(client, csrf, _admin_album(client, album["id"]))
            published_moment = _publish_moment(client, csrf, moment)

            # 相同配置再提交一次：不应产生重复来源 / 重复关系。
            album_before = _admin_album(client, album["id"])
            repeated = _patch_moment(
                client,
                csrf,
                published_moment,
                text="重写文字但保持收录",
                album_links=_links(album["id"], [media.id]),
            )
            assert repeated.status_code == 200, repeated.text
            album_after = _admin_album(client, album["id"])
            assert album_after["version"] == album_before["version"], (
                "相同配置重复提交不应 bump 相册版本（否则别的表单会无谓 412）"
            )
            assert _source_row_count(t06_session, album["id"], media.id) == 1
            assert _album_media_row_count(t06_session, album["id"], media.id) == 1

            with anonymous_client(
                t06_settings, t06_session, *_public_routers()
            ) as anon:
                detail = anon.get(f"{ALBUMS_PATH}/{album['slug']}").json()
                assert [photo["media_id"] for photo in detail["photos"]] == [str(media.id)]
                assert detail["photo_count"] == 1
                assert anon.get(PHOTOS_PATH).json()["total"] == 1
                # 媒体公开可读（图库 / 动态任一公开引用成立即可）。
                assert anon.get(f"{MEDIA_PATH}/{media.id}/w320.webp").status_code == 200


# --- §8.2 核心两条：纯动态来源撤回 vs 独立来源仍可见 ------------------------


def test_retract_last_dynamic_source_hides_photo_and_revokes_media(
    t06_session, t06_settings
) -> None:
    """**纯动态来源**撤回：图库停止展示、不删除媒体、最后公开引用失效时媒体权限撤销。"""
    with admin_client(
        t06_settings, t06_session, *_admin_routers()
    ) as (client, owner, csrf):
        media = make_media(t06_session, owner, root=t06_settings.media_root_path)
        album = _create_album(client, csrf)
        moment = _create_moment(
            client,
            csrf,
            images=_image_payload([media.id]),
            album_links=_links(album["id"], [media.id]),
        )
        with media_domains_registered():
            album = _publish_album(client, csrf, _admin_album(client, album["id"]))
            moment = _publish_moment(client, csrf, moment)

            with anonymous_client(
                t06_settings, t06_session, *_public_routers()
            ) as anon:
                assert (
                    anon.get(f"{MEDIA_PATH}/{media.id}/w320.webp").status_code == 200
                ), "动态与相册都公开时媒体可读"
                assert anon.get(PHOTOS_PATH).json()["total"] == 1

            retracted = _unpublish_moment(client, csrf, moment)
            assert retracted["album_links"], "撤回必须保留收录配置供重发恢复"

            with anonymous_client(
                t06_settings, t06_session, *_public_routers()
            ) as anon:
                detail = anon.get(f"{ALBUMS_PATH}/{album['slug']}").json()
                assert detail["photos"] == []
                assert detail["photo_count"] == 0
                assert detail["cover"] is None
                assert anon.get(PHOTOS_PATH).json()["total"] == 0
                assert anon.get(f"{PHOTOS_PATH}/years").json() == []
                # 相册与动态都不再公开引用这媒体 → 匿名变体 404（原图也始终 404）。
                assert (
                    anon.get(f"{MEDIA_PATH}/{media.id}/w320.webp").status_code == 404
                ), "最后公开引用失效后不能继续从媒体变体 URL 读取"
                assert (
                    anon.get(f"{MEDIA_PATH}/{media.id}/original").status_code == 404
                )

            # 重新发布：仍保留的配置自动恢复公开资格。
            moment = _publish_moment(
                client, csrf, client.get(f"{ADMIN_MOMENTS_PATH}/{moment['id']}").json()
            )
            with anonymous_client(
                t06_settings, t06_session, *_public_routers()
            ) as anon:
                assert anon.get(PHOTOS_PATH).json()["total"] == 1
                assert (
                    anon.get(f"{MEDIA_PATH}/{media.id}/w320.webp").status_code == 200
                )

            # 删除动态：取消来源并清理关联记录；媒体行仍在（不删文件/记录）。
            current = client.get(f"{ADMIN_MOMENTS_PATH}/{moment['id']}").json()
            deleted = client.delete(
                f"{ADMIN_MOMENTS_PATH}/{moment['id']}",
                headers=write_headers(csrf, current["version"]),
            )
            assert deleted.status_code == 204, deleted.text
            album_detail = _admin_album(client, album["id"])
            assert album_detail["photos"] == [], "纯动态来源的显示关系应被清理"
        still_there = t06_session.execute(
            select(Album).where(Album.id == uuid.UUID(album["id"]))
        ).scalars().first()
        assert still_there is not None


def test_independent_source_keeps_photo_visible_after_dynamic_retract(
    t06_session, t06_settings
) -> None:
    """**独立来源仍可见**：撤回动态后，独立收录的同一张图继续展示且媒体可读。

    这是既有验收脚本 `verify-album-moment-retract.py` 的核心断言，第三轮继续成立；
    与上一条用例形成对照，证明两类来源行为不同、不是「按 media_id 一刀切隐藏」。
    """
    with admin_client(
        t06_settings, t06_session, *_admin_routers()
    ) as (client, owner, csrf):
        media = make_media(t06_session, owner, root=t06_settings.media_root_path)
        album = _create_album(
            client,
            csrf,
            photos=[
                {
                    "media_id": str(media.id),
                    "position": 0,
                    "alt": "独立收录的照片",
                    "caption": "相册自己的说明",
                    "taken_on": None,
                }
            ],
        )
        moment = _create_moment(
            client,
            csrf,
            images=_image_payload([media.id]),
            album_links=_links(album["id"], [media.id]),
        )
        with media_domains_registered():
            album = _publish_album(client, csrf, _admin_album(client, album["id"]))
            moment = _publish_moment(client, csrf, moment)

            # 同图同相册现在同时有独立来源 + 动态来源。
            album_detail = _admin_album(client, album["id"])
            kinds = {source["kind"] for source in album_detail["photos"][0]["sources"]}
            assert kinds == {"independent", "moment"}

            _unpublish_moment(client, csrf, moment)

            with anonymous_client(
                t06_settings, t06_session, *_public_routers()
            ) as anon:
                detail = anon.get(f"{ALBUMS_PATH}/{album['slug']}").json()
                assert [photo["media_id"] for photo in detail["photos"]] == [str(media.id)]
                assert detail["photo_count"] == 1
                assert anon.get(PHOTOS_PATH).json()["total"] == 1
                assert (
                    anon.get(f"{MEDIA_PATH}/{media.id}/w320.webp").status_code == 200
                ), "独立相册引用仍公开，媒体不能误封"


# --- 不传 / 传空 / 完整替换 -------------------------------------------------


def test_omitting_album_links_keeps_config_but_prunes_removed_images(
    t06_session, t06_settings
) -> None:
    """任务书 §4.3 第一行：不传 album_links → 保留原配置，但清除已不属于该动态的图片。"""
    with admin_client(
        t06_settings, t06_session, *_admin_routers()
    ) as (client, owner, csrf):
        first = make_media(t06_session, owner)
        second = make_media(t06_session, owner)
        album = _create_album(client, csrf)
        moment = _create_moment(
            client,
            csrf,
            images=_image_payload([first.id, second.id]),
            album_links=_links(album["id"], [first.id, second.id]),
        )
        assert len(_admin_album(client, album["id"])["photos"]) == 2

        # 只改文字、不传 album_links：配置与相册照片都保留。
        current = client.get(f"{ADMIN_MOMENTS_PATH}/{moment['id']}").json()
        kept = _patch_moment(client, csrf, moment, text="只改文字")
        assert kept.status_code == 200, kept.text
        assert _album_link_ids(kept.json()) == [str(first.id), str(second.id)]
        assert len(_admin_album(client, album["id"])["photos"]) == 2

        # 换图（只剩第一张）、不传 album_links：第二张的失效来源被清理。
        current = client.get(f"{ADMIN_MOMENTS_PATH}/{moment['id']}").json()
        pruned = _patch_moment(
            client,
            csrf,
            moment,
            images=_image_payload([first.id]),
        )
        assert pruned.status_code == 200, pruned.text
        assert _album_link_ids(pruned.json()) == [str(first.id)]
        album_detail = _admin_album(client, album["id"])
        assert [photo["media_id"] for photo in album_detail["photos"]] == [str(first.id)]
        assert _source_row_count(t06_session, album["id"], second.id) == 0
        assert _album_media_row_count(t06_session, album["id"], second.id) == 0


def test_empty_album_links_clears_only_this_moment(t06_session, t06_settings) -> None:
    """任务书 §4.3 / §8.2：传 [] 清空此动态全部收录选择，其他来源不受影响。"""
    with admin_client(
        t06_settings, t06_session, *_admin_routers()
    ) as (client, owner, csrf):
        media = make_media(t06_session, owner)
        album = _create_album(
            client,
            csrf,
            photos=[{"media_id": str(media.id), "position": 0, "alt": "独立收录"}],
        )
        first_moment = _create_moment(
            client,
            csrf,
            images=_image_payload([media.id]),
            album_links=_links(album["id"], [media.id]),
        )
        second_moment = _create_moment(
            client,
            csrf,
            images=_image_payload([media.id]),
            album_links=_links(album["id"], [media.id]),
        )

        cleared = _patch_moment(client, csrf, first_moment, album_links=[])
        assert cleared.status_code == 200, cleared.text
        assert cleared.json()["album_links"] == []
        # 另一个动态的配置还在：相册回执显示独立 + 第二条动态来源。
        photo = _admin_album(client, album["id"])["photos"][0]
        moments = [source["moment_id"] for source in photo["sources"] if source["kind"] == "moment"]
        assert moments == [second_moment["id"]]

        with media_domains_registered():
            # 清空后独立来源仍在 → 照片继续公开（撤回第一条动态也无关）。
            album = _publish_album(client, csrf, _admin_album(client, album["id"]))
            _publish_moment(
                client,
                csrf,
                client.get(f"{ADMIN_MOMENTS_PATH}/{second_moment['id']}").json(),
            )
            with anonymous_client(
                t06_settings, t06_session, *_public_routers()
            ) as anon:
                assert (
                    anon.get(f"{ALBUMS_PATH}/{album['slug']}").json()["photo_count"] == 1
                )


def test_republish_restores_only_preserved_configuration(
    t06_session, t06_settings
) -> None:
    """任务书 §4.5：重新发布只恢复仍保留的配置；明确移除的图片不复活。"""
    with admin_client(
        t06_settings, t06_session, *_admin_routers()
    ) as (client, owner, csrf):
        first = make_media(t06_session, owner)
        second = make_media(t06_session, owner)
        album = _create_album(client, csrf)
        moment = _create_moment(
            client,
            csrf,
            images=_image_payload([first.id, second.id]),
            album_links=_links(album["id"], [first.id, second.id]),
        )
        album = _publish_album(client, csrf, _admin_album(client, album["id"]))
        moment = _publish_moment(client, csrf, moment)
        moment = _unpublish_moment(client, csrf, moment)

        pruned = _patch_moment(
            client,
            csrf,
            moment,
            images=_image_payload([first.id]),
        )
        assert pruned.status_code == 200, pruned.text
        assert _album_link_ids(pruned.json()) == [str(first.id)]

        with media_domains_registered():
            republished = _publish_moment(client, csrf, pruned.json())
            assert republished["status"] == "published"
            with anonymous_client(
                t06_settings, t06_session, *_public_routers()
            ) as anon:
                detail = anon.get(f"{ALBUMS_PATH}/{album['slug']}").json()
                assert [photo["media_id"] for photo in detail["photos"]] == [str(first.id)]
                assert anon.get(PHOTOS_PATH).json()["total"] == 1


# --- 多个动态来源 -----------------------------------------------------------


def test_multiple_dynamic_sources_survive_until_all_are_retracted(
    t06_session, t06_settings
) -> None:
    """同一「相册 + 媒体」允许多个动态来源；全部撤回后才隐藏。"""
    with admin_client(
        t06_settings, t06_session, *_admin_routers()
    ) as (client, owner, csrf):
        media = make_media(t06_session, owner, root=t06_settings.media_root_path)
        album = _create_album(client, csrf)
        first = _create_moment(
            client,
            csrf,
            images=_image_payload([media.id]),
            album_links=_links(album["id"], [media.id]),
        )
        second = _create_moment(
            client,
            csrf,
            images=_image_payload([media.id]),
            album_links=_links(album["id"], [media.id]),
        )
        with media_domains_registered():
            album = _publish_album(client, csrf, _admin_album(client, album["id"]))
            first = _publish_moment(client, csrf, first)
            second = _publish_moment(client, csrf, second)
            with anonymous_client(
                t06_settings, t06_session, *_public_routers()
            ) as anon:
                assert anon.get(PHOTOS_PATH).json()["total"] == 1

            _unpublish_moment(client, csrf, first)
            with anonymous_client(
                t06_settings, t06_session, *_public_routers()
            ) as anon:
                assert anon.get(PHOTOS_PATH).json()["total"] == 1, "还有第二个动态来源"
                assert (
                    anon.get(f"{MEDIA_PATH}/{media.id}/w320.webp").status_code == 200
                )

            _unpublish_moment(
                client,
                csrf,
                client.get(f"{ADMIN_MOMENTS_PATH}/{second['id']}").json(),
            )
            with anonymous_client(
                t06_settings, t06_session, *_public_routers()
            ) as anon:
                assert anon.get(PHOTOS_PATH).json()["total"] == 0
                assert (
                    anon.get(f"{MEDIA_PATH}/{media.id}/w320.webp").status_code == 404
                )


# --- 相册侧移除：动态配置同步清理，重发不加回 ------------------------------


def test_album_single_photo_removal_clears_dynamic_links_and_blocks_readd(
    t06_session, t06_settings
) -> None:
    """任务书 §4.5：相册侧单图删除 → 清理对应动态收录配置；重发不能自动加回。"""
    with admin_client(
        t06_settings, t06_session, *_admin_routers()
    ) as (client, owner, csrf):
        media = make_media(t06_session, owner)
        album = _create_album(client, csrf)
        moment = _create_moment(
            client,
            csrf,
            images=_image_payload([media.id]),
            album_links=_links(album["id"], [media.id]),
        )
        with media_domains_registered():
            # 先把相册 / 动态都发布，再验证「相册侧移除」的清理与防回加。
            album_detail = _publish_album(client, csrf, _admin_album(client, album["id"]))
            moment = _publish_moment(client, csrf, moment)
        moment_version_before = client.get(
            f"{ADMIN_MOMENTS_PATH}/{moment['id']}"
        ).json()["version"]
        album_detail = _admin_album(client, album["id"])
        response = client.delete(
            f"{ADMIN_ALBUMS_PATH}/{album['id']}/photos/{media.id}",
            headers=write_headers(csrf, album_detail["version"]),
        )
        assert response.status_code == 204, response.text

        moment_after = client.get(f"{ADMIN_MOMENTS_PATH}/{moment['id']}").json()
        assert moment_after["album_links"] == [], "相册移除必须清掉动态收录配置"
        assert moment_after["version"] == moment_version_before + 1, (
            "相关动态版本 +1，旧动态表单再保存会 412 而不是无提示加回"
        )
        assert _admin_album(client, album["id"])["photos"] == []

        # 即使动态走完「撤回 → 重新发布」循环，也不会把这张图加回相册。
        with media_domains_registered():
            album_detail = _admin_album(client, album["id"])
            current = client.get(f"{ADMIN_MOMENTS_PATH}/{moment['id']}").json()
            current = _unpublish_moment(client, csrf, current)
            republished = _publish_moment(client, csrf, current)
            assert republished["album_links"] == []
            with anonymous_client(
                t06_settings, t06_session, *_public_routers()
            ) as anon:
                detail = anon.get(f"{ALBUMS_PATH}/{album_detail['slug']}").json()
                assert detail["photos"] == []
                assert detail["photo_count"] == 0


def test_album_whole_photo_list_update_removal_clears_dynamic_links(
    t06_session, t06_settings
) -> None:
    """任务书 §4.5：完整照片列表更新中被移除的项目同样要清理来源；重发不加回。"""
    with admin_client(
        t06_settings, t06_session, *_admin_routers()
    ) as (client, owner, csrf):
        kept = make_media(t06_session, owner)
        removed = make_media(t06_session, owner)
        album = _create_album(client, csrf)
        moment = _create_moment(
            client,
            csrf,
            images=_image_payload([kept.id, removed.id]),
            album_links=_links(album["id"], [kept.id, removed.id]),
        )
        assert len(_admin_album(client, album["id"])["photos"]) == 2

        album_detail = _admin_album(client, album["id"])
        patched = client.patch(
            f"{ADMIN_ALBUMS_PATH}/{album['id']}",
            json={
                "photos": [
                    {
                        "media_id": str(kept.id),
                        "position": 0,
                        "alt": "保留的照片",
                        "caption": "",
                        "taken_on": None,
                    }
                ]
            },
            headers=write_headers(csrf, album_detail["version"]),
        )
        assert patched.status_code == 200, patched.text
        moment_after = client.get(f"{ADMIN_MOMENTS_PATH}/{moment['id']}").json()
        assert _album_link_ids(moment_after) == [str(kept.id)]
        assert _source_row_count(t06_session, album["id"], removed.id) == 0


def test_resaving_album_form_does_not_upgrade_dynamic_source_to_independent(
    t06_session, t06_settings
) -> None:
    """契约 §3.1 规则 4：既有图片不会因为再次保存相册表单而被升级为独立来源。

    否则「仅动态来源撤回后隐藏」会被一次无关的相册保存悄悄破坏。
    """
    with admin_client(
        t06_settings, t06_session, *_admin_routers()
    ) as (client, owner, csrf):
        media = make_media(t06_session, owner)
        album = _create_album(client, csrf)
        moment = _create_moment(
            client,
            csrf,
            images=_image_payload([media.id]),
            album_links=_links(album["id"], [media.id]),
        )
        album_detail = _admin_album(client, album["id"])
        # 相册表单原样保存这张图（只改说明），来源必须保持「仅 moment」。
        patched = client.patch(
            f"{ADMIN_ALBUMS_PATH}/{album['id']}",
            json={
                "photos": [
                    {
                        "media_id": str(media.id),
                        "position": 0,
                        "alt": "相册表单重命名",
                        "caption": "只改说明",
                        "taken_on": None,
                    }
                ]
            },
            headers=write_headers(csrf, album_detail["version"]),
        )
        assert patched.status_code == 200, patched.text
        photo = patched.json()["photos"][0]
        assert photo["caption"] == "只改说明"
        assert [source["kind"] for source in photo["sources"]] == ["moment"], (
            "保存相册表单不能把动态来源升级成独立来源"
        )

        with media_domains_registered():
            _publish_album(client, csrf, _admin_album(client, album["id"]))
            _publish_moment(client, csrf, moment)
            with anonymous_client(
                t06_settings, t06_session, *_public_routers()
            ) as anon:
                assert (
                    anon.get(f"{ALBUMS_PATH}/{album['slug']}").json()["photo_count"] == 1
                )
            current = client.get(f"{ADMIN_MOMENTS_PATH}/{moment['id']}").json()
            _unpublish_moment(client, csrf, current)
            with anonymous_client(
                t06_settings, t06_session, *_public_routers()
            ) as anon:
                assert (
                    anon.get(f"{ALBUMS_PATH}/{album['slug']}").json()["photo_count"] == 0
                ), "唯一来源是动态，撤回后必须隐藏；若被升级成独立来源这里会失败"


# --- 相册删除撤销收录目标 ---------------------------------------------------


def test_deleting_album_clears_moment_links_and_bumps_moment_version(
    t06_session, t06_settings
) -> None:
    with admin_client(
        t06_settings, t06_session, *_admin_routers()
    ) as (client, owner, csrf):
        media = make_media(t06_session, owner)
        album = _create_album(client, csrf)
        moment = _create_moment(
            client,
            csrf,
            images=_image_payload([media.id]),
            album_links=_links(album["id"], [media.id]),
        )
        version_before = client.get(f"{ADMIN_MOMENTS_PATH}/{moment['id']}").json()["version"]
        album_detail = _admin_album(client, album["id"])
        deleted = client.delete(
            f"{ADMIN_ALBUMS_PATH}/{album['id']}",
            headers=write_headers(csrf, album_detail["version"]),
        )
        assert deleted.status_code == 204, deleted.text

        moment_after = client.get(f"{ADMIN_MOMENTS_PATH}/{moment['id']}").json()
        assert moment_after["album_links"] == []
        assert moment_after["version"] == version_before + 1
        assert client.get(f"{ADMIN_ALBUMS_PATH}/{album['id']}").status_code == 404


# --- 错误与事务：整单拒绝，不留半完成 --------------------------------------


def test_album_links_rejects_media_not_in_moment_atomically(
    t06_session, t06_settings
) -> None:
    with admin_client(
        t06_settings, t06_session, *_admin_routers()
    ) as (client, owner, csrf):
        in_moment = make_media(t06_session, owner)
        not_in_moment = make_media(t06_session, owner)
        album = _create_album(client, csrf)
        moment = _create_moment(
            client,
            csrf,
            images=_image_payload([in_moment.id]),
            album_links=_links(album["id"], [in_moment.id]),
        )
        version = client.get(f"{ADMIN_MOMENTS_PATH}/{moment['id']}").json()["version"]

        response = client.patch(
            f"{ADMIN_MOMENTS_PATH}/{moment['id']}",
            json={
                "text": "这段文字不应该被保存",
                "album_links": _links(album["id"], [in_moment.id, not_in_moment.id]),
            },
            headers=write_headers(csrf, version),
        )
        payload = assert_error(response, status=409, code="CONFLICT")
        assert "album_links" in payload["error"]["fields"]

        after = client.get(f"{ADMIN_MOMENTS_PATH}/{moment['id']}").json()
        assert after["version"] == version, "整单失败不能留下半完成（版本也不该前进）"
        assert after["text"] == "N3 动态", "文字修改必须与收录失败一起回滚"
        assert _album_link_ids(after) == [str(in_moment.id)]
        assert _source_row_count(t06_session, album["id"], not_in_moment.id) == 0


def test_album_links_rejects_unknown_or_deleted_album(t06_session, t06_settings) -> None:
    with admin_client(
        t06_settings, t06_session, *_admin_routers()
    ) as (client, owner, csrf):
        media = make_media(t06_session, owner)
        album = _create_album(client, csrf)
        moment = _create_moment(client, csrf, images=_image_payload([media.id]))
        version = client.get(f"{ADMIN_MOMENTS_PATH}/{moment['id']}").json()["version"]

        unknown = client.patch(
            f"{ADMIN_MOMENTS_PATH}/{moment['id']}",
            json={"album_links": _links(uuid.uuid4(), [media.id])},
            headers=write_headers(csrf, version),
        )
        assert_error(unknown, status=409, code="CONFLICT")

        # 删除相册后不能再作为收录目标。
        album_detail = _admin_album(client, album["id"])
        assert (
            client.delete(
                f"{ADMIN_ALBUMS_PATH}/{album['id']}",
                headers=write_headers(csrf, album_detail["version"]),
            ).status_code
            == 204
        )
        deleted = client.patch(
            f"{ADMIN_MOMENTS_PATH}/{moment['id']}",
            json={"album_links": _links(album["id"], [media.id])},
            headers=write_headers(csrf, version),
        )
        assert_error(deleted, status=409, code="CONFLICT")


def test_album_links_rejects_unusable_media_and_stale_version(
    t06_session, t06_settings
) -> None:
    from app.core.db import utcnow
    from app.modules.media.models import Media

    with admin_client(
        t06_settings, t06_session, *_admin_routers()
    ) as (client, owner, csrf):
        media = make_media(t06_session, owner)
        album = _create_album(client, csrf)
        moment = _create_moment(client, csrf, images=_image_payload([media.id]))
        version = client.get(f"{ADMIN_MOMENTS_PATH}/{moment['id']}").json()["version"]

        # 媒体在表单打开后被软删除：不能写入一个永远不能展示的来源。
        media_row = t06_session.execute(
            select(Media).where(Media.id == media.id)
        ).scalars().one()
        media_row.deleted_at = utcnow()
        t06_session.flush()
        response = client.patch(
            f"{ADMIN_MOMENTS_PATH}/{moment['id']}",
            json={"album_links": _links(album["id"], [media.id])},
            headers=write_headers(csrf, version),
        )
        assert_error(response, status=409, code="CONFLICT")
        media_row.deleted_at = None
        t06_session.flush()

        # 旧版本：412，且不写入任何收录配置。
        bumped = client.patch(
            f"{ADMIN_MOMENTS_PATH}/{moment['id']}",
            json={"text": "先成功改一次文字"},
            headers=write_headers(csrf, version),
        )
        assert bumped.status_code == 200, bumped.text
        stale = client.patch(
            f"{ADMIN_MOMENTS_PATH}/{moment['id']}",
            json={"album_links": _links(album["id"], [media.id])},
            headers=write_headers(csrf, version),
        )
        assert_error(stale, status=412, code="VERSION_CONFLICT")
        assert _admin_album(client, album["id"])["photos"] == []


def test_duplicate_album_in_album_links_is_422(t06_session, t06_settings) -> None:
    with admin_client(
        t06_settings, t06_session, *_admin_routers()
    ) as (client, owner, csrf):
        media = make_media(t06_session, owner)
        album = _create_album(client, csrf)
        moment = _create_moment(client, csrf, images=_image_payload([media.id]))
        version = client.get(f"{ADMIN_MOMENTS_PATH}/{moment['id']}").json()["version"]
        response = client.patch(
            f"{ADMIN_MOMENTS_PATH}/{moment['id']}",
            json={
                "album_links": [
                    *_links(album["id"], [media.id]),
                    *_links(album["id"], [media.id]),
                ]
            },
            headers=write_headers(csrf, version),
        )
        assert_error(response, status=422, code="UNPROCESSABLE")


def test_repeat_same_patch_is_idempotent_on_sources(t06_session, t06_settings) -> None:
    """相同 album_links 重复提交（每次带最新 If-Match）→ 不产生重复来源。"""
    with admin_client(
        t06_settings, t06_session, *_admin_routers()
    ) as (client, owner, csrf):
        media = make_media(t06_session, owner)
        album = _create_album(client, csrf)
        moment = _create_moment(client, csrf, images=_image_payload([media.id]))
        for _ in range(3):
            current = client.get(f"{ADMIN_MOMENTS_PATH}/{moment['id']}").json()
            response = client.patch(
                f"{ADMIN_MOMENTS_PATH}/{moment['id']}",
                json={"album_links": _links(album["id"], [media.id])},
                headers=write_headers(csrf, current["version"]),
            )
            assert response.status_code == 200, response.text
        assert _source_row_count(t06_session, album["id"], media.id) == 1
        assert _album_media_row_count(t06_session, album["id"], media.id) == 1


def test_album_unpublish_then_republish_keeps_sources_and_projection(
    t06_session, t06_settings
) -> None:
    """任务书 §8.2：相册撤回后重发 → 公共投影随相册状态变化，媒体与配置保持正确。"""
    with admin_client(
        t06_settings, t06_session, *_admin_routers()
    ) as (client, owner, csrf):
        media = make_media(t06_session, owner, root=t06_settings.media_root_path)
        album = _create_album(
            client,
            csrf,
            photos=[{"media_id": str(media.id), "position": 0, "alt": "独立收录"}],
        )
        with media_domains_registered():
            published = _publish_album(client, csrf, _admin_album(client, album["id"]))
            with anonymous_client(
                t06_settings, t06_session, *_public_routers()
            ) as anon:
                assert anon.get(PHOTOS_PATH).json()["total"] == 1
                assert (
                    anon.get(f"{MEDIA_PATH}/{media.id}/w320.webp").status_code == 200
                )

            retracted = _unpublish_album(client, csrf, published)
            with anonymous_client(
                t06_settings, t06_session, *_public_routers()
            ) as anon:
                assert anon.get(f"{ALBUMS_PATH}/{album['slug']}").status_code == 404
                assert anon.get(PHOTOS_PATH).json()["total"] == 0
                assert (
                    anon.get(f"{MEDIA_PATH}/{media.id}/w320.webp").status_code == 404
                )
            # 撤回不动照片关系与来源，重发后原样恢复。
            admin_detail = _admin_album(client, album["id"])
            assert [photo["media_id"] for photo in admin_detail["photos"]] == [str(media.id)]
            assert admin_detail["photos"][0]["sources"] == [{"kind": "independent", "moment_id": None}]

            republished = _publish_album(client, csrf, {**retracted, **admin_detail, "status": "draft"})
            assert republished["status"] == "published"
            with anonymous_client(
                t06_settings, t06_session, *_public_routers()
            ) as anon:
                detail = anon.get(f"{ALBUMS_PATH}/{album['slug']}").json()
                assert [photo["media_id"] for photo in detail["photos"]] == [str(media.id)]
                assert (
                    anon.get(f"{MEDIA_PATH}/{media.id}/w320.webp").status_code == 200
                )
