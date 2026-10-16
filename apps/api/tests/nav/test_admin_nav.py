"""站主维护：新建 / 更新 / 有序文章 / 别名 / 预览 / 发布撤回 / 并发冲突（05 §7）。

对应验收用例 4（不泄漏草稿、游标与指纹）与任务卡的「并发编辑冲突」「有序文章选择」。
管理端点一律要求：站主会话 + 同源 Origin + CSRF + `If-Match`。
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.nav.models import Palace, PalaceAlias, PalacePost
from tests.nav.helpers import (
    admin_login,
    create_payload,
    assert_error,
    make_palace,
    make_published_palace,
    unique_keyword,
    unique_slug,
)
from tests.posts.helpers import make_draft, make_post

UTC = timezone.utc

ADMIN_KEYS = {
    "id",
    "slug",
    "title",
    "summary",
    "keywords",
    "status",
    "published_at",
    "created_at",
    "updated_at",
    "deleted_at",
    "version",
    "aliases",
    "posts",
    "conflicts",
    "public_post_count",
}


def test_admin_endpoints_require_owner_session(public_client, t04_session: Session):
    """未登录：列表 / 详情 / 写操作全部 401（不泄漏是否存在）。"""
    post = make_post(t04_session)
    palace = make_published_palace(t04_session, posts=(post,))
    assert_error(public_client.get("/api/v1/admin/nav/palaces"), status=401, code="UNAUTHORIZED")
    assert_error(
        public_client.get(f"/api/v1/admin/nav/palaces/{palace.id}"), status=401, code="UNAUTHORIZED"
    )
    assert_error(
        public_client.post("/api/v1/admin/nav/palaces", json=create_payload()),
        status=401,
        code="UNAUTHORIZED",
    )
    assert_error(
        public_client.delete(f"/api/v1/admin/nav/palaces/{palace.id}"),
        status=401,
        code="UNAUTHORIZED",
    )


def test_write_requires_csrf_and_same_origin(nav_client, t04_session: Session):
    """登录但缺 CSRF / 跨站 Origin → 403；预登录会话不算站主。"""
    admin_login(nav_client, t04_session)

    no_csrf = nav_client.post(
        "/api/v1/admin/nav/palaces", json=create_payload(), headers={"Origin": "http://testserver"}
    )
    assert_error(no_csrf, status=403, code="FORBIDDEN")

    cross_site = nav_client.post(
        "/api/v1/admin/nav/palaces",
        json=create_payload(),
        headers={"Origin": "https://evil.example", "X-CSRF-Token": "whatever"},
    )
    assert_error(cross_site, status=403, code="FORBIDDEN")


def test_prelogin_session_is_not_owner(nav_client, t04_session: Session):
    """预登录会话（user_id 为空）+ 正确 CSRF 仍然不能写（05 §5.3）。"""
    prelogin = nav_client.get("/api/v1/auth/session").json()
    assert prelogin["authenticated"] is False
    response = nav_client.post(
        "/api/v1/admin/nav/palaces",
        json={**create_payload(), "csrf_token": prelogin["csrf_token"]},
        headers={"Origin": "http://testserver"},
    )
    assert_error(response, status=401, code="UNAUTHORIZED")


def test_create_update_publish_flow(nav_client, t04_session: Session):
    """新建 → 更新 → 发布：版本递增、ETag 一致、公开可见性跟着变。"""
    session_info = admin_login(nav_client, t04_session)
    csrf = session_info["csrf_token"]
    headers = {"Origin": "http://testserver", "X-CSRF-Token": csrf}
    post = make_post(t04_session, title="第一章", slug=unique_slug("post"))
    t04_session.commit()

    created = nav_client.post(
        "/api/v1/admin/nav/palaces",
        json={**create_payload(), "post_ids": [str(post.id)]},
        headers=headers,
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert set(body) == ADMIN_KEYS
    assert body["status"] == "draft"
    assert body["version"] == 1
    assert body["published_at"] is None
    assert created.headers["ETag"] == '"1"'
    palace_id = body["id"]

    # 公开端点看不到草稿；管理端点能看到（预览）。
    assert nav_client.get(f"/api/v1/nav/palaces/{body['slug']}").status_code == 404
    detail = nav_client.get(f"/api/v1/admin/nav/palaces/{palace_id}")
    assert detail.status_code == 200
    assert detail.headers["ETag"] == '"1"'
    assert detail.json()["posts"][0]["post_id"] == str(post.id)
    assert detail.json()["public_post_count"] == 1

    # 改成草稿状态时发布 → 409（至少一篇公开文章）。
    empty = nav_client.post(
        "/api/v1/admin/nav/palaces",
        json=create_payload(),
        headers=headers,
    ).json()
    conflict = nav_client.post(
        f"/api/v1/admin/nav/palaces/{empty['id']}/publish",
        json={"csrf_token": csrf},
        headers={**headers, "If-Match": '"1"'},
    )
    assert_error(conflict, status=409, code="CONFLICT")

    updated = nav_client.patch(
        f"/api/v1/admin/nav/palaces/{palace_id}",
        json={"title": "怪盗据点工程 · 改", "csrf_token": csrf},
        headers={**headers, "If-Match": '"1"'},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["version"] == 2
    assert updated.headers["ETag"] == '"2"'

    published = nav_client.post(
        f"/api/v1/admin/nav/palaces/{palace_id}/publish",
        json={"csrf_token": csrf},
        headers={**headers, "If-Match": '"2"'},
    )
    assert published.status_code == 200, published.text
    payload = published.json()
    assert payload["status"] == "published"
    assert payload["published_at"] is not None
    assert payload["version"] == 3

    public = nav_client.get(f"/api/v1/nav/palaces/{body['slug']}")
    assert public.status_code == 200
    assert public.json()["title"] == "怪盗据点工程 · 改"
    assert [item["slug"] for item in public.json()["posts"]] == [post.slug]


def test_if_match_missing_is_428_and_stale_is_412(nav_client, t04_session: Session):
    """缺 If-Match → 428；版本过期 → 412，且**不写入任何改动**（05 §7）。"""
    session_info = admin_login(nav_client, t04_session)
    csrf = session_info["csrf_token"]
    post = make_post(t04_session)
    t04_session.commit()
    palace = nav_client.post(
        "/api/v1/admin/nav/palaces",
        json={**create_payload(), "post_ids": [str(post.id)]},
        headers={"Origin": "http://testserver", "X-CSRF-Token": csrf},
    ).json()

    missing = nav_client.patch(
        f"/api/v1/admin/nav/palaces/{palace['id']}",
        json={"title": "不该生效", "csrf_token": csrf},
        headers={"Origin": "http://testserver", "X-CSRF-Token": csrf},
    )
    assert_error(missing, status=428, code="PRECONDITION_REQUIRED")

    stale = nav_client.patch(
        f"/api/v1/admin/nav/palaces/{palace['id']}",
        json={"title": "也不该生效", "csrf_token": csrf},
        headers={"Origin": "http://testserver", "X-CSRF-Token": csrf, "If-Match": '"99"'},
    )
    assert_error(stale, status=412, code="VERSION_CONFLICT")

    publish_missing = nav_client.post(
        f"/api/v1/admin/nav/palaces/{palace['id']}/publish",
        json={"csrf_token": csrf},
        headers={"Origin": "http://testserver", "X-CSRF-Token": csrf},
    )
    assert_error(publish_missing, status=428, code="PRECONDITION_REQUIRED")

    current = nav_client.get(f"/api/v1/admin/nav/palaces/{palace['id']}").json()
    assert current["title"] == "怪盗据点工程"
    assert current["version"] == 1
    assert current["status"] == "draft"


def test_two_editors_do_not_overwrite_each_other(nav_client, t04_session: Session):
    """并发编辑：第二个人拿旧版本提交得到 412，界面的输入不会被服务端覆盖。"""
    session_info = admin_login(nav_client, t04_session)
    csrf = session_info["csrf_token"]
    headers = {"Origin": "http://testserver", "X-CSRF-Token": csrf}
    post = make_post(t04_session)
    t04_session.commit()
    palace = nav_client.post(
        "/api/v1/admin/nav/palaces", json=create_payload(), headers=headers
    ).json()

    first = nav_client.patch(
        f"/api/v1/admin/nav/palaces/{palace['id']}",
        json={"summary": "第一个人写的", "csrf_token": csrf},
        headers={**headers, "If-Match": '"1"'},
    )
    assert first.status_code == 200
    second = nav_client.patch(
        f"/api/v1/admin/nav/palaces/{palace['id']}",
        json={"summary": "第二个人写的", "csrf_token": csrf},
        headers={**headers, "If-Match": '"1"'},
    )
    assert_error(second, status=412, code="VERSION_CONFLICT")
    assert nav_client.get(f"/api/v1/admin/nav/palaces/{palace['id']}").json()["summary"] == "第一个人写的"


def test_relation_order_is_preserved_and_fully_replaced(nav_client, t04_session: Session):
    """`post_ids` 完整替换并保留顺序；公开详情的顺序与之一致（04 §4A「有序章节」）。"""
    session_info = admin_login(nav_client, t04_session)
    csrf = session_info["csrf_token"]
    headers = {"Origin": "http://testserver", "X-CSRF-Token": csrf}
    posts = [make_post(t04_session, title=f"章节 {index}", slug=unique_slug("post")) for index in range(3)]
    t04_session.commit()

    created = nav_client.post(
        "/api/v1/admin/nav/palaces",
        json={**create_payload(), "post_ids": [str(posts[2].id), str(posts[0].id)]},
        headers=headers,
    ).json()
    assert [item["post_id"] for item in created["posts"]] == [str(posts[2].id), str(posts[0].id)]

    replaced = nav_client.patch(
        f"/api/v1/admin/nav/palaces/{created['id']}",
        json={"post_ids": [str(posts[0].id), str(posts[1].id), str(posts[2].id)], "csrf_token": csrf},
        headers={**headers, "If-Match": '"1"'},
    )
    assert replaced.status_code == 200, replaced.text
    assert [item["post_id"] for item in replaced.json()["posts"]] == [
        str(posts[0].id),
        str(posts[1].id),
        str(posts[2].id),
    ]
    assert [item["position"] for item in replaced.json()["posts"]] == [0, 1, 2]

    nav_client.post(
        f"/api/v1/admin/nav/palaces/{created['id']}/publish",
        json={"csrf_token": csrf},
        headers={**headers, "If-Match": '"2"'},
    )
    public = nav_client.get(f"/api/v1/nav/palaces/{created['slug']}").json()
    assert [item["slug"] for item in public["posts"]] == [posts[0].slug, posts[1].slug, posts[2].slug]

    # 完整替换为空同样生效（之后不能发布）。
    emptied = nav_client.patch(
        f"/api/v1/admin/nav/palaces/{created['id']}",
        json={"post_ids": [], "csrf_token": csrf},
        headers={**headers, "If-Match": '"3"'},
    )
    assert emptied.json()["posts"] == []
    assert nav_client.get(f"/api/v1/nav/palaces/{created['slug']}").status_code == 404


def test_validation_errors_are_field_level_422(nav_client, t04_session: Session):
    session_info = admin_login(nav_client, t04_session)
    csrf = session_info["csrf_token"]
    headers = {"Origin": "http://testserver", "X-CSRF-Token": csrf}
    post = make_post(t04_session)
    t04_session.commit()

    cases = [
        (create_payload(slug="Not A Slug"), "slug"),
        (create_payload(slug="中文-slug"), "slug"),
        (create_payload(title="   "), "title"),
        (create_payload(keywords={"name": "  ", "location": "L", "cognition": "C"}), "keywords"),
        (create_payload(keywords={"name": "x" * 81, "location": "L", "cognition": "C"}), "keywords"),
        (
            create_payload(
                aliases=[
                    {"field": "name", "value": "重复"},
                    {"field": "name", "value": " 重复 "},
                ]
            ),
            "aliases",
        ),
        (create_payload(aliases=[{"field": "place", "value": "X"}]), "aliases"),
        (create_payload(aliases=[{"field": "name", "value": "  "}]), "aliases"),
        (create_payload(post_ids=[str(post.id), str(post.id)]), "post_ids"),
        (create_payload(post_ids=[str(uuid.uuid4())]), "post_ids"),
    ]
    for payload, field in cases:
        response = nav_client.post(
            "/api/v1/admin/nav/palaces", json={**payload, "csrf_token": csrf}, headers=headers
        )
        body = assert_error(response, status=422, code="UNPROCESSABLE")
        # 字段错误用点号路径表示（例如 aliases.0.field），这里只要求命中同一个前缀。
        keys = body["error"]["fields"]
        assert any(key == field or key.startswith(f"{field}.") for key in keys), (field, body)

    created = nav_client.post(
        "/api/v1/admin/nav/palaces", json={**create_payload(), "csrf_token": csrf}, headers=headers
    ).json()
    null_field = nav_client.patch(
        f"/api/v1/admin/nav/palaces/{created['id']}",
        json={"summary": None, "csrf_token": csrf},
        headers={**headers, "If-Match": '"1"'},
    )
    assert_error(null_field, status=422, code="UNPROCESSABLE")


def test_duplicate_slug_is_409(nav_client, t04_session: Session):
    session_info = admin_login(nav_client, t04_session)
    csrf = session_info["csrf_token"]
    headers = {"Origin": "http://testserver", "X-CSRF-Token": csrf}
    payload = create_payload()
    assert nav_client.post("/api/v1/admin/nav/palaces", json={**payload, "csrf_token": csrf}, headers=headers).status_code == 201
    duplicate = nav_client.post(
        "/api/v1/admin/nav/palaces", json={**payload, "csrf_token": csrf}, headers=headers
    )
    body = assert_error(duplicate, status=409, code="CONFLICT")
    assert "slug" in body["error"]["fields"]


def test_soft_delete_removes_from_public_but_keeps_posts(nav_client, t04_session: Session):
    """软删除不影响文章本身（05 §7），公开列表 / 详情 / 搜索 / 定位立刻不可读。"""
    session_info = admin_login(nav_client, t04_session)
    csrf = session_info["csrf_token"]
    headers = {"Origin": "http://testserver", "X-CSRF-Token": csrf}
    post = make_post(t04_session, title="不该被删掉的文章", slug=unique_slug("post"))
    t04_session.commit()
    palace = nav_client.post(
        "/api/v1/admin/nav/palaces",
        json={**create_payload(post_ids=[str(post.id)]), "csrf_token": csrf},
        headers=headers,
    ).json()
    nav_client.post(
        f"/api/v1/admin/nav/palaces/{palace['id']}/publish",
        json={"csrf_token": csrf},
        headers={**headers, "If-Match": '"1"'},
    )
    assert nav_client.get(f"/api/v1/nav/palaces/{palace['slug']}").status_code == 200

    deleted = nav_client.request(
        "DELETE",
        f"/api/v1/admin/nav/palaces/{palace['id']}",
        json={"csrf_token": csrf},
        headers={**headers, "If-Match": '"2"'},
    )
    assert deleted.status_code == 204, deleted.text
    assert deleted.text == ""

    assert nav_client.get(f"/api/v1/nav/palaces/{palace['slug']}").status_code == 404
    assert nav_client.get("/api/v1/nav/palaces").json()["items"] == []
    assert nav_client.get("/api/v1/nav/search", params={"q": "不该被删掉的文章"}).json()["items"]
    admin_view = nav_client.get(f"/api/v1/admin/nav/palaces/{palace['id']}").json()
    assert admin_view["deleted_at"] is not None
    # 文章与关系都还在（关系随专题软删除保留，重新发布即可恢复）。
    assert t04_session.execute(
        select(func.count()).select_from(PalacePost).where(PalacePost.palace_id == uuid.UUID(palace["id"]))
    ).scalar_one() == 1


def test_unpublish_hides_but_keeps_history(nav_client, t04_session: Session):
    session_info = admin_login(nav_client, t04_session)
    csrf = session_info["csrf_token"]
    headers = {"Origin": "http://testserver", "X-CSRF-Token": csrf}
    post = make_post(t04_session)
    t04_session.commit()
    palace = nav_client.post(
        "/api/v1/admin/nav/palaces",
        json={**create_payload(post_ids=[str(post.id)]), "csrf_token": csrf},
        headers=headers,
    ).json()
    published = nav_client.post(
        f"/api/v1/admin/nav/palaces/{palace['id']}/publish",
        json={"csrf_token": csrf},
        headers={**headers, "If-Match": '"1"'},
    ).json()
    assert published["published_at"] is not None

    unpublished = nav_client.post(
        f"/api/v1/admin/nav/palaces/{palace['id']}/unpublish",
        json={"csrf_token": csrf},
        headers={**headers, "If-Match": '"2"'},
    )
    assert unpublished.status_code == 200
    assert unpublished.json()["status"] == "draft"
    # 历史发布时间保留（用于界面显示与重新发布），公开条件只看 status。
    assert unpublished.json()["published_at"] == published["published_at"]
    assert nav_client.get(f"/api/v1/nav/palaces/{palace['slug']}").status_code == 404

    republished = nav_client.post(
        f"/api/v1/admin/nav/palaces/{palace['id']}/publish",
        json={"csrf_token": csrf},
        headers={**headers, "If-Match": '"3"'},
    )
    assert republished.status_code == 200
    assert republished.json()["status"] == "published"


def test_admin_preview_shows_draft_relations_and_conflict_warnings(nav_client, t04_session: Session):
    """预览：管理详情含草稿关系与 public 标记；关键词重叠给出**提示**而不是静默放行。"""
    session_info = admin_login(nav_client, t04_session)
    csrf = session_info["csrf_token"]
    headers = {"Origin": "http://testserver", "X-CSRF-Token": csrf}
    public_post = make_post(t04_session, title="公开章节")
    draft_post = make_draft(t04_session, title="草稿章节")
    t04_session.commit()
    shared = unique_keyword("重叠别名")
    existing = make_published_palace(
        t04_session, posts=(public_post,), name="Existing", aliases=(("name", shared),)
    )
    t04_session.commit()

    created = nav_client.post(
        "/api/v1/admin/nav/palaces",
        json={
            # location / cognition 故意与既有专题不同：只让 name 上的别名重叠。
            **create_payload(
                post_ids=[str(public_post.id), str(draft_post.id)],
                keywords={"name": "Newcomer", "location": "别处", "cognition": "工房"},
            ),
            "aliases": [{"field": "name", "value": shared}],
            "csrf_token": csrf,
        },
        headers=headers,
    ).json()

    posts = {item["post_id"]: item for item in created["posts"]}
    assert posts[str(draft_post.id)]["status"] == "draft"
    assert posts[str(draft_post.id)]["public"] is False
    assert posts[str(public_post.id)]["public"] is True
    assert created["public_post_count"] == 1

    conflicts = created["conflicts"]
    assert len(conflicts) == 1
    assert conflicts[0]["field"] == "name"
    assert conflicts[0]["value"] == shared
    assert [item["slug"] for item in conflicts[0]["palaces"]] == [existing.slug]

    # 重叠不会阻止发布（04 §8：允许返回多候选，只要求提示站主）。
    published = nav_client.post(
        f"/api/v1/admin/nav/palaces/{created['id']}/publish",
        json={"csrf_token": csrf},
        headers={**headers, "If-Match": '"1"'},
    )
    assert published.status_code == 200
    assert published.json()["conflicts"]


def test_no_op_update_keeps_version(nav_client, t04_session: Session):
    """只带 CSRF 的 PATCH 不改任何东西，也不递增版本（避免假冲突）。"""
    session_info = admin_login(nav_client, t04_session)
    csrf = session_info["csrf_token"]
    headers = {"Origin": "http://testserver", "X-CSRF-Token": csrf}
    created = nav_client.post(
        "/api/v1/admin/nav/palaces", json={**create_payload(), "csrf_token": csrf}, headers=headers
    ).json()
    response = nav_client.patch(
        f"/api/v1/admin/nav/palaces/{created['id']}",
        json={"csrf_token": csrf},
        headers={**headers, "If-Match": '"1"'},
    )
    assert response.status_code == 200
    assert response.json()["version"] == 1


def test_admin_list_paginates_and_includes_drafts(nav_client, t04_session: Session):
    session_info = admin_login(nav_client, t04_session)
    csrf = session_info["csrf_token"]
    headers = {"Origin": "http://testserver", "X-CSRF-Token": csrf}
    post = make_post(t04_session)
    t04_session.commit()
    # 先造历史专题，再造 3 个草稿：管理列表按 created_at DESC，草稿因此排在最前。
    make_published_palace(t04_session, posts=(post,), title="历史专题")
    t04_session.commit()
    palaces = [
        nav_client.post(
            "/api/v1/admin/nav/palaces", json={**create_payload(), "csrf_token": csrf}, headers=headers
        ).json()
        for _ in range(3)
    ]

    page = nav_client.get("/api/v1/admin/nav/palaces", params={"limit": 2}).json()
    assert len(page["items"]) == 2
    assert page["next_cursor"]
    second = nav_client.get(
        "/api/v1/admin/nav/palaces", params={"limit": 2, "cursor": page["next_cursor"]}
    ).json()
    ids = {item["id"] for item in page["items"]} | {item["id"] for item in second["items"]}
    assert {palace["id"] for palace in palaces} <= ids
    assert all(item["status"] == "draft" for item in page["items"])

    assert_error(
        nav_client.get("/api/v1/admin/nav/palaces", params={"cursor": "nope"}),
        status=400,
        code="VALIDATION_FAILED",
    )


def test_alias_rows_are_replaced_not_duplicated(nav_client, t04_session: Session):
    """`aliases` 完整替换：数据库里的行数与内容都跟着变，不堆叠旧别名。"""
    session_info = admin_login(nav_client, t04_session)
    csrf = session_info["csrf_token"]
    headers = {"Origin": "http://testserver", "X-CSRF-Token": csrf}
    created = nav_client.post(
        "/api/v1/admin/nav/palaces", json={**create_payload(), "csrf_token": csrf}, headers=headers
    ).json()
    palace_id = uuid.UUID(created["id"])

    def stored() -> list[tuple[str, str]]:
        rows = t04_session.execute(
            select(PalaceAlias.field, PalaceAlias.normalized_value).where(
                PalaceAlias.palace_id == palace_id
            )
        ).all()
        return sorted((field, value) for field, value in rows)

    assert stored() == [("cognition", "hideout"), ("name", "phantom")]

    replaced = nav_client.patch(
        f"/api/v1/admin/nav/palaces/{created['id']}",
        json={"aliases": [{"field": "location", "value": " Blog "}], "csrf_token": csrf},
        headers={**headers, "If-Match": '"1"'},
    )
    assert replaced.status_code == 200, replaced.text
    assert stored() == [("location", "blog")]
    assert replaced.json()["aliases"] == [
        {"field": "location", "value": "Blog", "normalized_value": "blog"}
    ]
