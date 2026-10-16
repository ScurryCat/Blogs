"""管理写接口与发布流程（05 §7，03 §5 / §9.3 / §9.4）。

覆盖：草稿可空 → 发布门槛 → 撤回 → 软删除；字段级校验；
If-Match 的 428 / 412；未登录与跨站被拒；冲突不静默覆盖。
"""

from __future__ import annotations

import uuid

import pytest

from app.core.db import utcnow
from app.modules.moments.models import STATUS_DRAFT, STATUS_PUBLISHED
from app.modules.moments.router import router as moments_router
from tests.core.t01_db import assert_error
from tests.moments.helpers import (
    ADMIN_MOMENTS_PATH,
    MOMENTS_PATH,
    ORIGIN,
    admin_client,
    anonymous_client,
    create_draft,
    image_payload,
    make_media,
    publish,
    unpublish,
    write_headers,
)

ROUTERS = (("moments", moments_router),)


# --- 草稿与发布门槛 --------------------------------------------------------


def test_admin_requires_login(t03_settings, t03_session):
    with anonymous_client(t03_settings, t03_session, *ROUTERS) as client:
        assert_error(client.get(ADMIN_MOMENTS_PATH), status=401, code="UNAUTHORIZED")
        assert_error(
            client.post(ADMIN_MOMENTS_PATH, json={"text": "x"}, headers={"Origin": ORIGIN}),
            status=401,
            code="UNAUTHORIZED",
        )


def test_draft_can_be_empty_then_publish_requires_image(t03_settings, t03_session):
    """草稿可暂时没有图片；发布必须有 1–9 张 ready 图（03 §5）。"""
    with admin_client(t03_settings, t03_session, *ROUTERS) as (client, _user, csrf):
        created = create_draft(client, csrf, text="空草稿")
        assert created.status_code == 201, created.text
        draft = created.json()
        assert draft["status"] == STATUS_DRAFT
        assert draft["images"] == []
        assert draft["published_at"] is None
        assert draft["version"] == 1
        assert created.headers["ETag"] == '"1"'

        # 没有图片时发布 → 409（业务冲突，不是 422：请求本身是合法的）
        blocked = publish(client, csrf, draft["id"], draft["version"])
        assert_error(blocked, status=409, code="CONFLICT")
        assert "图片" in blocked.json()["error"]["message"]

        # 状态没有被改动：还是草稿、版本没涨
        still = client.get(f"{ADMIN_MOMENTS_PATH}/{draft['id']}")
        assert still.json()["status"] == STATUS_DRAFT
        assert still.json()["version"] == 1


def test_publish_with_not_ready_media_is_conflict(t03_settings, t03_session):
    """关联媒体不是 ready 时不能发布（03 §5「发布前必须确认所有关联媒体为 ready」）。"""
    with admin_client(t03_settings, t03_session, *ROUTERS) as (client, user, csrf):
        media = make_media(t03_session, user, status="ready")
        created = create_draft(client, csrf, text="带图", images=image_payload([media.id]))
        assert created.status_code == 201, created.text
        draft = created.json()

        # 把媒体改成 processing（模拟「还没处理完」）
        media.status = "processing"
        t03_session.flush()

        blocked = publish(client, csrf, draft["id"], draft["version"])
        assert_error(blocked, status=409, code="CONFLICT")
        after = client.get(f"{ADMIN_MOMENTS_PATH}/{draft['id']}").json()
        assert after["status"] == STATUS_DRAFT
        # 管理回执如实报告那张图还在关系里（不静默过滤成「没有图」）
        assert len(after["images_admin"]) == 1


def test_publish_then_public_visible_then_unpublish_hides(t03_settings, t03_session):
    with admin_client(t03_settings, t03_session, *ROUTERS) as (client, user, csrf):
        media_one = make_media(t03_session, user)
        media_two = make_media(t03_session, user)
        created = create_draft(
            client,
            csrf,
            text="发布测试",
            images=image_payload([media_one.id, media_two.id]),
            tags=["校园", "摄影"],
        )
        draft = created.json()

        published = publish(client, csrf, draft["id"], draft["version"])
        assert published.status_code == 200, published.text
        body = published.json()
        assert body["status"] == STATUS_PUBLISHED
        assert body["published_at"] is not None
        assert body["version"] == 2  # 发布也是一次成功修改

        # 公开端点在同一个 app 里可见（公开路由与移动端共用同一份数据）
        public = client.get(f"{MOMENTS_PATH}/{draft['id']}")
        assert public.status_code == 200, public.text
        assert [image["position"] for image in public.json()["images"]] == [0, 1]

        withdrawn = unpublish(client, csrf, draft["id"], body["version"])
        assert withdrawn.status_code == 200, withdrawn.text
        assert withdrawn.json()["status"] == STATUS_DRAFT
        assert withdrawn.json()["published_at"] is None

        # 撤回后公开详情不可见；管理端点仍能读到内容与图片
        assert_error(
            client.get(f"{MOMENTS_PATH}/{draft['id']}"), status=404, code="NOT_FOUND"
        )
        admin_view = client.get(f"{ADMIN_MOMENTS_PATH}/{draft['id']}").json()
        assert len(admin_view["images_admin"]) == 2
        assert admin_view["text"] == "发布测试"


def test_soft_delete_is_204_and_removes_from_both_lists(t03_settings, t03_session):
    with admin_client(t03_settings, t03_session, *ROUTERS) as (client, user, csrf):
        media = make_media(t03_session, user)
        draft = create_draft(client, csrf, text="待删", images=image_payload([media.id])).json()
        published = publish(client, csrf, draft["id"], draft["version"]).json()

        deleted = client.delete(
            f"{ADMIN_MOMENTS_PATH}/{draft['id']}",
            headers=write_headers(csrf, published["version"]),
        )
        assert deleted.status_code == 204, deleted.text
        assert deleted.content == b""

        assert_error(client.get(f"{ADMIN_MOMENTS_PATH}/{draft['id']}"), status=404, code="NOT_FOUND")
        assert_error(client.get(f"{MOMENTS_PATH}/{draft['id']}"), status=404, code="NOT_FOUND")
        listed = client.get(ADMIN_MOMENTS_PATH).json()
        assert all(item["id"] != draft["id"] for item in listed["items"])


# --- 字段级校验 ------------------------------------------------------------


@pytest.mark.parametrize(
    "text,expected_field",
    [
        ("字" * 2001, "text"),
    ],
)
def test_text_over_2000_codepoints_is_422(t03_settings, t03_session, text, expected_field):
    with admin_client(t03_settings, t03_session, *ROUTERS) as (client, _user, csrf):
        response = create_draft(client, csrf, text=text)
        payload = assert_error(response, status=422, code="UNPROCESSABLE")
        assert any(expected_field in key for key in payload["error"]["fields"])


def test_2000_codepoint_text_is_accepted(t03_settings, t03_session):
    with admin_client(t03_settings, t03_session, *ROUTERS) as (client, _user, csrf):
        response = create_draft(client, csrf, text="字" * 2000)
        assert response.status_code == 201, response.text
        assert len(response.json()["text"]) == 2000


def test_image_count_bounds(t03_settings, t03_session):
    with admin_client(t03_settings, t03_session, *ROUTERS) as (client, user, csrf):
        media = [make_media(t03_session, user) for _ in range(10)]
        too_many = create_draft(
            client, csrf, text="十张", images=image_payload([m.id for m in media])
        )
        assert_error(too_many, status=422, code="UNPROCESSABLE")

        nine = create_draft(
            client, csrf, text="九张", images=image_payload([m.id for m in media[:9]])
        )
        assert nine.status_code == 201, nine.text
        assert len(nine.json()["images_admin"]) == 9


def test_alt_text_is_required_and_bounded(t03_settings, t03_session):
    with admin_client(t03_settings, t03_session, *ROUTERS) as (client, user, csrf):
        media = make_media(t03_session, user)
        empty_alt = create_draft(
            client,
            csrf,
            text="缺 alt",
            images=[{"media_id": str(media.id), "position": 0, "alt": ""}],
        )
        assert_error(empty_alt, status=422, code="UNPROCESSABLE")

        long_alt = create_draft(
            client,
            csrf,
            text="alt 太长",
            images=[{"media_id": str(media.id), "position": 0, "alt": "字" * 201}],
        )
        assert_error(long_alt, status=422, code="UNPROCESSABLE")

        ok = create_draft(
            client,
            csrf,
            text="alt 合法",
            images=[{"media_id": str(media.id), "position": 0, "alt": "字" * 200}],
        )
        assert ok.status_code == 201, ok.text


def test_positions_must_start_at_zero_and_be_contiguous(t03_settings, t03_session):
    with admin_client(t03_settings, t03_session, *ROUTERS) as (client, user, csrf):
        media = [make_media(t03_session, user) for _ in range(3)]
        # 从 1 开始：不是「位置唯一」就够了，必须从 0 起且连续
        broken = create_draft(
            client,
            csrf,
            text="断号",
            images=[
                {"media_id": str(media[0].id), "position": 1, "alt": "图一"},
                {"media_id": str(media[1].id), "position": 2, "alt": "图二"},
            ],
        )
        assert_error(broken, status=422, code="UNPROCESSABLE")

        duplicate = create_draft(
            client,
            csrf,
            text="重复位置",
            images=[
                {"media_id": str(media[0].id), "position": 0, "alt": "图一"},
                {"media_id": str(media[1].id), "position": 0, "alt": "图二"},
            ],
        )
        assert_error(duplicate, status=422, code="UNPROCESSABLE")


def test_tag_rules(t03_settings, t03_session):
    """最多 8 个标签（去空白、去重）；单标签 1–24 码点。"""
    with admin_client(t03_settings, t03_session, *ROUTERS) as (client, _user, csrf):
        too_many = create_draft(client, csrf, text="9 标签", tags=[f"标签{i}" for i in range(9)])
        assert_error(too_many, status=422, code="UNPROCESSABLE")

        too_long = create_draft(client, csrf, text="长标签", tags=["字" * 25])
        assert_error(too_long, status=422, code="UNPROCESSABLE")

        # 重复与空标签被清理掉，不是错误
        cleaned = create_draft(
            client, csrf, text="去重", tags=[" 校园 ", "校园", "", "   ", "摄影"]
        )
        assert cleaned.status_code == 201, cleaned.text
        names = sorted(tag["name"] for tag in cleaned.json()["tags"])
        assert names == ["摄影", "校园"]


def test_unknown_or_deleted_media_is_conflict(t03_settings, t03_session):
    with admin_client(t03_settings, t03_session, *ROUTERS) as (client, user, csrf):
        missing = create_draft(
            client, csrf, text="不存在的图", images=image_payload([uuid.uuid4()])
        )
        assert_error(missing, status=409, code="CONFLICT")

        media = make_media(t03_session, user)
        media.deleted_at = utcnow()
        t03_session.flush()
        deleted = create_draft(client, csrf, text="已删图", images=image_payload([media.id]))
        assert_error(deleted, status=409, code="CONFLICT")


def test_same_media_twice_in_one_moment_is_conflict(t03_settings, t03_session):
    with admin_client(t03_settings, t03_session, *ROUTERS) as (client, user, csrf):
        media = make_media(t03_session, user)
        response = create_draft(
            client,
            csrf,
            text="同图两次",
            images=[
                {"media_id": str(media.id), "position": 0, "alt": "一"},
                {"media_id": str(media.id), "position": 1, "alt": "二"},
            ],
        )
        assert_error(response, status=409, code="CONFLICT")


# --- If-Match / 并发 -------------------------------------------------------


def test_update_without_if_match_is_428(t03_settings, t03_session):
    with admin_client(t03_settings, t03_session, *ROUTERS) as (client, _user, csrf):
        draft = create_draft(client, csrf, text="原文").json()
        response = client.patch(
            f"{ADMIN_MOMENTS_PATH}/{draft['id']}",
            json={"text": "新文"},
            headers={"Origin": ORIGIN, "X-CSRF-Token": csrf},
        )
        assert_error(response, status=428, code="PRECONDITION_REQUIRED")


def test_stale_if_match_is_412_and_does_not_overwrite(t03_settings, t03_session):
    """旧 version 更新返回 412，并且**没有**改到内容（不静默覆盖较新内容）。"""
    with admin_client(t03_settings, t03_session, *ROUTERS) as (client, _user, csrf):
        draft = create_draft(client, csrf, text="第一版").json()
        first_update = client.patch(
            f"{ADMIN_MOMENTS_PATH}/{draft['id']}",
            json={"text": "第二版"},
            headers=write_headers(csrf, draft["version"]),
        )
        assert first_update.status_code == 200, first_update.text
        assert first_update.json()["version"] == 2

        stale = client.patch(
            f"{ADMIN_MOMENTS_PATH}/{draft['id']}",
            json={"text": "用旧版本的覆盖"},
            headers=write_headers(csrf, draft["version"]),
        )
        assert_error(stale, status=412, code="VERSION_CONFLICT")

        current = client.get(f"{ADMIN_MOMENTS_PATH}/{draft['id']}").json()
        assert current["text"] == "第二版"
        assert current["version"] == 2


def test_publish_and_delete_also_require_if_match(t03_settings, t03_session):
    with admin_client(t03_settings, t03_session, *ROUTERS) as (client, user, csrf):
        media = make_media(t03_session, user)
        draft = create_draft(client, csrf, text="x", images=image_payload([media.id])).json()
        assert_error(
            client.post(
                f"{ADMIN_MOMENTS_PATH}/{draft['id']}/publish",
                headers={"Origin": ORIGIN, "X-CSRF-Token": csrf},
            ),
            status=428,
            code="PRECONDITION_REQUIRED",
        )
        assert_error(
            client.delete(
                f"{ADMIN_MOMENTS_PATH}/{draft['id']}",
                headers={"Origin": ORIGIN, "X-CSRF-Token": csrf},
            ),
            status=428,
            code="PRECONDITION_REQUIRED",
        )


def test_wildcard_if_match_is_rejected(t03_settings, t03_session):
    with admin_client(t03_settings, t03_session, *ROUTERS) as (client, _user, csrf):
        draft = create_draft(client, csrf, text="x").json()
        response = client.patch(
            f"{ADMIN_MOMENTS_PATH}/{draft['id']}",
            json={"text": "y"},
            headers={"Origin": ORIGIN, "X-CSRF-Token": csrf, "If-Match": "*"},
        )
        assert_error(response, status=400, code="VALIDATION_FAILED")


# --- CSRF / Origin ---------------------------------------------------------


def test_cross_site_write_is_rejected(t03_settings, t03_session):
    """跨站伪造发布请求：Origin 不是同源 → 403，且不产生任何数据。"""
    with admin_client(t03_settings, t03_session, *ROUTERS) as (client, _user, csrf):
        response = client.post(
            ADMIN_MOMENTS_PATH,
            json={"text": "跨站"},
            headers={"Origin": "https://evil.example", "X-CSRF-Token": csrf},
        )
        assert_error(response, status=403, code="FORBIDDEN")
        listed = client.get(ADMIN_MOMENTS_PATH).json()
        assert listed["items"] == []


def test_missing_or_wrong_csrf_is_rejected(t03_settings, t03_session):
    with admin_client(t03_settings, t03_session, *ROUTERS) as (client, _user, csrf):
        missing = client.post(
            ADMIN_MOMENTS_PATH, json={"text": "无 CSRF"}, headers={"Origin": ORIGIN}
        )
        assert_error(missing, status=403, code="FORBIDDEN")

        wrong = client.post(
            ADMIN_MOMENTS_PATH,
            json={"text": "错 CSRF"},
            headers={"Origin": ORIGIN, "X-CSRF-Token": "not-the-token"},
        )
        assert_error(wrong, status=403, code="FORBIDDEN")


# --- 管理列表与缓存头 ------------------------------------------------------


def test_admin_list_includes_drafts_marked_private_no_store(t03_settings, t03_session):
    with admin_client(t03_settings, t03_session, *ROUTERS) as (client, _user, csrf):
        draft = create_draft(client, csrf, text="草稿在这里").json()
        response = client.get(ADMIN_MOMENTS_PATH)
        assert response.status_code == 200
        assert response.headers["Cache-Control"] == "private, no-store"
        ids = [item["id"] for item in response.json()["items"]]
        assert draft["id"] in ids
        item = next(item for item in response.json()["items"] if item["id"] == draft["id"])
        assert item["status"] == STATUS_DRAFT
        assert item["version"] == 1
        # 管理 DTO 含 version / status，公开 DTO 不含 —— 由 test_public_api 断言另一侧。
        assert set(item) >= {"images_admin", "status", "version", "created_at", "updated_at"}


def test_admin_status_filter_rejects_unknown_value(t03_settings, t03_session):
    with admin_client(t03_settings, t03_session, *ROUTERS) as (client, _user, _csrf):
        assert_error(
            client.get(f"{ADMIN_MOMENTS_PATH}?status=deleted"),
            status=422,
            code="UNPROCESSABLE",
        )


def test_admin_read_of_unknown_or_malformed_id_is_404(t03_settings, t03_session):
    with admin_client(t03_settings, t03_session, *ROUTERS) as (client, _user, _csrf):
        assert_error(client.get(f"{ADMIN_MOMENTS_PATH}/not-a-uuid"), status=404, code="NOT_FOUND")
        assert_error(client.get(f"{ADMIN_MOMENTS_PATH}/{uuid.uuid4()}"), status=404, code="NOT_FOUND")


def test_patch_with_images_uses_router_dumped_payload(t01_settings, t03_session):
    """PATCH 的 images 经过 `model_dump()` 后是 **dict**，service 必须能处理。

    这是真实浏览器联调抓到的缺陷：router 用 `payload.model_dump(exclude_unset=True)`
    取「只改了哪些字段」，于是 service 收到的是 dict 列表；第一版代码直接访问
    `image.media_id` 抛 `AttributeError` → 500。单元测试如果只构造模型实例就抓不到，
    因此这条用例**从 HTTP 入口进**，走的就是用户实际走的那条路径。
    """
    with admin_client(t01_settings, t03_session, *ROUTERS) as (client, user, csrf):
        media = make_media(t03_session, user)
        draft = create_draft(client, csrf, text="先不带图").json()

        response = client.patch(
            f"{ADMIN_MOMENTS_PATH}/{draft['id']}",
            json={
                "text": "补上图",
                "tags": ["校园"],
                "images": [
                    {"media_id": str(media.id), "position": 0, "alt": "操场"},
                ],
            },
            headers=write_headers(csrf, draft["version"]),
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert [image["alt"] for image in body["images"]] == ["操场"]
        assert body["images_admin"] == [
            {"media_id": str(media.id), "position": 0, "alt": "操场"}
        ]
        assert body["version"] == 2

        # 再清空图片：同样是 dict 列表路径（空列表）
        cleared = client.patch(
            f"{ADMIN_MOMENTS_PATH}/{draft['id']}",
            json={"images": []},
            headers=write_headers(csrf, body["version"]),
        )
        assert cleared.status_code == 200, cleared.text
        assert cleared.json()["images"] == []
