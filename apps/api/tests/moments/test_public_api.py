"""公开列表 / 详情、分页、标签筛选与可见性（05 §6，03 §9）。

重点：
  - 草稿、已撤回、已软删除、未到发布时间对匿名一律 404（UUID 不等于访问控制）；
  - 站主登录后读公开端点**也不会**多拿到草稿；
  - 同一时间戳的多条动态分页不漏不重；
  - 切换标签后沿用旧游标 → 400（游标里带筛选指纹）；
  - 「另一浏览器」用**独立连接**读同一份已提交数据（不是同一事务里的自读自写）。
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, text

from app.core.db import create_session_factory, utcnow
from app.core.deps import get_session, get_settings_dep
from app.modules.moments.models import (
    STATUS_DRAFT,
    STATUS_PUBLISHED,
    Moment,
    moment_media,
    moment_tags,
)
from app.modules.moments.router import router as moments_router
from app.modules.auth.router import router as auth_router
from tests.auth.helpers import login_ok, make_admin
from tests.core.t01_db import assert_error
from tests.support.module_app import build_module_app
from tests.moments.helpers import (
    MOMENTS_PATH,
    admin_client,
    anonymous_client,
    attach_images,
    create_draft,
    image_payload,
    make_media,
    make_moment,
    publish,
    unique_tag,
)

UTC = timezone.utc
ROUTERS = (("moments", moments_router),)


def _owner(session):
    return make_admin(session, username=f"owner{uuid.uuid4().hex[:8]}")


def test_public_list_is_empty_when_nothing_published(t03_settings, t03_session):
    with anonymous_client(t03_settings, t03_session, *ROUTERS) as client:
        response = client.get(MOMENTS_PATH)
        assert response.status_code == 200, response.text
        assert response.json() == {"items": [], "next_cursor": None}
        assert response.headers["Cache-Control"] == "no-store"


def test_drafts_and_deleted_are_invisible_everywhere(t03_settings, t03_session):
    owner = _owner(t03_session)
    draft = make_moment(t03_session, owner, text="草稿", status=STATUS_DRAFT)
    deleted = make_moment(
        t03_session, owner, text="已删除", status=STATUS_PUBLISHED, deleted_at=utcnow()
    )
    future = make_moment(
        t03_session,
        owner,
        text="未到时间",
        status=STATUS_PUBLISHED,
        published_at=utcnow() + timedelta(days=1),
    )
    published = make_moment(t03_session, owner, text="公开的", status=STATUS_PUBLISHED)

    with anonymous_client(t03_settings, t03_session, *ROUTERS) as client:
        items = client.get(MOMENTS_PATH).json()["items"]
        assert [item["id"] for item in items] == [str(published.id)]
        for hidden in (draft, deleted, future):
            assert_error(client.get(f"{MOMENTS_PATH}/{hidden.id}"), status=404, code="NOT_FOUND")


def test_logged_in_admin_does_not_get_drafts_on_public_endpoint(t03_settings, t03_session):
    """公开端点只用公开 DTO：站主登录也不会顺便拿到草稿（05 §7）。"""
    with admin_client(t03_settings, t03_session, *ROUTERS) as (client, user, _csrf):
        draft = make_moment(t03_session, user, text="只应出现在管理端", status=STATUS_DRAFT)
        listing = client.get(MOMENTS_PATH)
        assert listing.status_code == 200
        assert listing.json()["items"] == []
        assert_error(client.get(f"{MOMENTS_PATH}/{draft.id}"), status=404, code="NOT_FOUND")
        # 管理端点仍能读到它（草稿只在管理侧可见）
        assert client.get(f"/api/v1/admin/moments/{draft.id}").status_code == 200


def test_public_detail_shape_has_no_admin_fields(t03_settings, t03_session):
    owner = _owner(t03_session)
    media = make_media(t03_session, owner)
    moment = make_moment(t03_session, owner, text="公开详情", status=STATUS_PUBLISHED, tags=("校园",))
    attach_images(t03_session, moment, [(media.id, 0, "操场")])

    with anonymous_client(t03_settings, t03_session, *ROUTERS) as client:
        body = client.get(f"{MOMENTS_PATH}/{moment.id}").json()

    assert set(body) == {"id", "text", "tags", "published_at", "images"}
    assert body["text"] == "公开详情"
    assert [tag["name"] for tag in body["tags"]] == ["校园"]
    image = body["images"][0]
    assert set(image) == {"media_id", "position", "alt", "width", "height", "variants"}
    assert image["position"] == 0
    assert image["alt"] == "操场"
    # 公开响应不含内部字段（storage_key / 文件名 / 绝对路径 / 管理字段）
    raw = client.get(f"{MOMENTS_PATH}/{moment.id}").text
    for forbidden in ("storage_key", "sha256", "version", "status", "deleted_at", "owner_id"):
        assert forbidden not in raw


def test_public_detail_malformed_id_is_404_not_422(t03_settings, t03_session):
    with anonymous_client(t03_settings, t03_session, *ROUTERS) as client:
        # 迁移前是 UUID 路径参数会返回 422；这里刻意用 str 再手工解析，统一 404。
        assert_error(client.get(f"{MOMENTS_PATH}/not-a-uuid"), status=404, code="NOT_FOUND")
        assert_error(client.get(f"{MOMENTS_PATH}/{uuid.uuid4()}"), status=404, code="NOT_FOUND")
        # 未来 T08 的静态路由 `/apps/ins/messages` 不会落到这里（那是前端路由）。


def test_images_keep_position_order(t03_settings, t03_session):
    owner = _owner(t03_session)
    media = [make_media(t03_session, owner) for _ in range(3)]
    moment = make_moment(t03_session, owner, text="三张图", status=STATUS_PUBLISHED)
    # 故意乱序插入，读出必须按 position 升序
    attach_images(
        t03_session,
        moment,
        [(media[2].id, 2, "第三"), (media[0].id, 0, "第一"), (media[1].id, 1, "第二")],
    )
    with anonymous_client(t03_settings, t03_session, *ROUTERS) as client:
        images = client.get(f"{MOMENTS_PATH}/{moment.id}").json()["images"]
    assert [image["position"] for image in images] == [0, 1, 2]
    assert [image["alt"] for image in images] == ["第一", "第二", "第三"]
    assert [image["media_id"] for image in images] == [
        str(media[0].id),
        str(media[1].id),
        str(media[2].id),
    ]


def test_images_of_deleted_or_unready_media_are_not_exposed(t03_settings, t03_session):
    """指向不可读对象的 `<img>` 不该出现（媒体软删除 / 未 ready）。"""
    owner = _owner(t03_session)
    good = make_media(t03_session, owner)
    gone = make_media(t03_session, owner)
    not_ready = make_media(t03_session, owner, status="processing")
    moment = make_moment(t03_session, owner, text="混合", status=STATUS_PUBLISHED)
    attach_images(
        t03_session,
        moment,
        [(good.id, 0, "可用"), (gone.id, 1, "已删"), (not_ready.id, 2, "未就绪")],
    )
    gone.deleted_at = utcnow()
    t03_session.flush()

    with anonymous_client(t03_settings, t03_session, *ROUTERS) as client:
        images = client.get(f"{MOMENTS_PATH}/{moment.id}").json()["images"]
    assert [image["alt"] for image in images] == ["可用"]


def test_public_list_ordering_is_newest_first(t03_settings, t03_session):
    owner = _owner(t03_session)
    base = datetime(2026, 10, 1, 12, 0, tzinfo=UTC)
    older = make_moment(
        t03_session, owner, text="旧", status=STATUS_PUBLISHED, published_at=base
    )
    newer = make_moment(
        t03_session,
        owner,
        text="新",
        status=STATUS_PUBLISHED,
        published_at=base + timedelta(hours=1),
    )
    with anonymous_client(t03_settings, t03_session, *ROUTERS) as client:
        items = client.get(MOMENTS_PATH).json()["items"]
    assert [item["id"] for item in items] == [str(newer.id), str(older.id)]


def test_pagination_with_identical_timestamps_has_no_gap_or_duplicate(
    t03_settings, t03_session
):
    """同一时间戳 5 条、limit=2 → 3 页，无重无漏（05 §10.7）。"""
    owner = _owner(t03_session)
    stamp = datetime(2026, 10, 2, 9, 0, tzinfo=UTC)
    created = [
        make_moment(t03_session, owner, text=f"同刻 {index}", status=STATUS_PUBLISHED, published_at=stamp)
        for index in range(5)
    ]
    expected = {str(moment.id) for moment in created}

    seen: list[str] = []
    with anonymous_client(t03_settings, t03_session, *ROUTERS) as client:
        cursor = None
        for _page in range(5):
            query = f"{MOMENTS_PATH}?limit=2" + (f"&cursor={cursor}" if cursor else "")
            payload = client.get(query).json()
            seen.extend(item["id"] for item in payload["items"])
            cursor = payload["next_cursor"]
            if cursor is None:
                break
    assert cursor is None
    assert len(seen) == len(set(seen)) == 5
    assert set(seen) == expected


def test_tag_filter_and_cursor_fingerprint(t03_settings, t03_session):
    """标签筛选可用；切换标签后沿用旧游标 → 400（05 §6）。"""
    owner = _owner(t03_session)
    tag_a = unique_tag("校园")
    tag_b = unique_tag("摄影")
    stamp = datetime(2026, 10, 3, 8, 0, tzinfo=UTC)
    for index in range(3):
        make_moment(
            t03_session,
            owner,
            text=f"{tag_a} {index}",
            status=STATUS_PUBLISHED,
            published_at=stamp + timedelta(minutes=index),
            tags=(tag_a,),
        )
    make_moment(
        t03_session,
        owner,
        text=f"{tag_b} 唯一",
        status=STATUS_PUBLISHED,
        published_at=stamp + timedelta(minutes=10),
        tags=(tag_b,),
    )

    with anonymous_client(t03_settings, t03_session, *ROUTERS) as client:
        page = client.get(f"{MOMENTS_PATH}?tag={tag_a}&limit=2").json()
        assert len(page["items"]) == 2
        assert page["next_cursor"], "同标签还有第 3 条，应当给出游标"
        assert all(tag_a in item["text"] for item in page["items"])

        second = client.get(f"{MOMENTS_PATH}?tag={tag_a}&limit=2&cursor={page['next_cursor']}").json()
        assert len(second["items"]) == 1
        assert second["next_cursor"] is None

        # 换了筛选条件还用旧游标 → 400，让客户端从第一页重新开始
        mismatched = client.get(f"{MOMENTS_PATH}?tag={tag_b}&cursor={page['next_cursor']}")
        assert_error(mismatched, status=400, code="VALIDATION_FAILED")

        # 不带筛选用带标签指纹的游标，同样算不一致
        assert_error(
            client.get(f"{MOMENTS_PATH}?cursor={page['next_cursor']}"),
            status=400,
            code="VALIDATION_FAILED",
        )


def test_invalid_cursor_is_400_not_first_page(t03_settings, t03_session):
    with anonymous_client(t03_settings, t03_session, *ROUTERS) as client:
        assert_error(
            client.get(f"{MOMENTS_PATH}?cursor=not-a-real-cursor"),
            status=400,
            code="VALIDATION_FAILED",
        )


@pytest.mark.parametrize("limit", [0, 31, -1])
def test_limit_out_of_range_is_422(t03_settings, t03_session, limit):
    with anonymous_client(t03_settings, t03_session, *ROUTERS) as client:
        assert_error(
            client.get(f"{MOMENTS_PATH}?limit={limit}"), status=422, code="UNPROCESSABLE"
        )


def test_limit_max_is_30(t03_settings, t03_session):
    with anonymous_client(t03_settings, t03_session, *ROUTERS) as client:
        assert client.get(f"{MOMENTS_PATH}?limit=30").status_code == 200


def test_tag_filter_with_no_match_is_empty_not_error(t03_settings, t03_session):
    """无标签结果必须是空列表（不是失败、也不是假数据）。"""
    with anonymous_client(t03_settings, t03_session, *ROUTERS) as client:
        payload = client.get(f"{MOMENTS_PATH}?tag={unique_tag('不存在')}").json()
    assert payload == {"items": [], "next_cursor": None}


def test_publish_is_visible_from_a_second_connection(t03_settings, t03_engine, t03_second_engine):
    """核心闭环：一个连接发布 → 另一个**独立连接**读到同一条图文（T03 验收用例 1）。

    这里刻意不复用 `t03_session`：它跑在一个最后一定回滚的事务里，而真实的两浏览器
    场景是两个连接都看得到**已提交**的数据。用例自己在两个独立引擎上开连接，
    结束时清理自己写的数据。
    """
    writer_connection = t03_engine.connect()
    reader_connection = t03_second_engine.connect()
    writer_session = create_session_factory(writer_connection)()
    reader_session = create_session_factory(reader_connection)()
    created_moment_ids: list[uuid.UUID] = []
    tag_ids: list[uuid.UUID] = []
    try:
        password = "t03-second-browser-1"
        user = make_admin(
            writer_session, username=f"owner{uuid.uuid4().hex[:8]}", password=password
        )
        media = make_media(writer_session, user)
        tag_name = unique_tag("跨连接")
        writer_session.commit()

        app = build_module_app(
            t03_settings, ("auth", auth_router), ("moments", moments_router)
        )
        app.dependency_overrides[get_session] = lambda: writer_session
        app.dependency_overrides[get_settings_dep] = lambda: t03_settings
        with TestClient(app, raise_server_exceptions=False) as client:
            login_ok(client, username=user.username, password=password)
            csrf = client.get("/api/v1/auth/session").json()["csrf_token"]
            draft = create_draft(
                client,
                csrf,
                text="跨连接可见的图文",
                images=image_payload([media.id], alt_prefix="实拍"),
                tags=[tag_name],
            ).json()
            created_moment_ids.append(uuid.UUID(draft["id"]))
            published = publish(client, csrf, draft["id"], draft["version"])
            assert published.status_code == 200, published.text
            assert published.json()["published_at"] is not None
            # 公开端点（匿名、无会话）在同一进程里也能读到
            anonymous = client.get(f"{MOMENTS_PATH}/{draft['id']}")
            assert anonymous.status_code == 200, anonymous.text

        # 第二个连接：直连库读，验证数据真的**已提交**（不是同一事务里的自读自写）
        reader_session.expire_all()
        row = reader_session.execute(
            text(
                "select m.status, m.published_at is not null, "
                "(select count(*) from moment_media mm where mm.moment_id = m.id) "
                "from moments m where m.id = :id"
            ),
            {"id": str(created_moment_ids[0])},
        ).one()
        assert row[0] == STATUS_PUBLISHED
        assert row[1] is True
        assert row[2] == 1
        positions = reader_session.execute(
            text(
                "select mm.position, mm.alt from moment_media mm "
                "where mm.moment_id = :id order by mm.position"
            ),
            {"id": str(created_moment_ids[0])},
        ).all()
        assert [(item.position, item.alt) for item in positions] == [(0, "实拍1")]
        tag_ids = [
            row.tag_id
            for row in reader_session.execute(
                text(
                    "select mt.tag_id from moment_tags mt where mt.moment_id = :id"
                ),
                {"id": str(created_moment_ids[0])},
            ).all()
        ]
        assert len(tag_ids) == 1
        label = reader_session.execute(
            text("select name from tags where id = :id"), {"id": str(tag_ids[0])}
        ).scalar()
        assert label == tag_name
    finally:
        writer_session.rollback()
        reader_session.rollback()
        cleanup = create_session_factory(writer_connection)()
        for moment_id in created_moment_ids:
            cleanup.execute(delete(moment_media).where(moment_media.c.moment_id == moment_id))
            cleanup.execute(delete(moment_tags).where(moment_tags.c.moment_id == moment_id))
            cleanup.execute(delete(Moment).where(Moment.id == moment_id))
        cleanup.commit()
        cleanup.close()
        writer_session.close()
        reader_session.close()
        writer_connection.close()
        reader_connection.close()
