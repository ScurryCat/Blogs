"""放课后管理端：登录、CSRF、If-Match、发布、类型字段守卫（05 §5 / §7，验收 4、6）。

验收 6 要求「娱乐进度有真实持久化管理入口」——这组用例走的就是真实 HTTP
管理端点：新建 → 改进度 → 发布 → 可见。不是硬编码演示卡片。

另外守一条产品边界：**进度更新不自动公开刷 INS**（07 §3、任务卡「不做」）。
这里对模块源码做可执行断言：leisure 的写入路径不导入也不写 moments。
"""

from __future__ import annotations

from pathlib import Path

from sqlalchemy.orm import Session

from app.modules.leisure.models import LeisureEntry
from tests.leisure.helpers import (
    admin_login,
    anime_payload,
    assert_error,
    game_payload,
    make_anime,
    make_public_anime,
)

ORIGIN = "http://testserver"
API_DIR = Path(__file__).resolve().parents[2]


def _create(client, token: str, payload: dict, *, expect: int = 201):
    response = client.post(
        "/api/v1/admin/leisure/entries",
        json={**payload, "csrf_token": token},
        headers={"Origin": ORIGIN},
    )
    assert response.status_code == expect, response.text
    return response


def test_admin_endpoints_require_login(leisure_client, t05_session: Session):
    entry = make_public_anime(t05_session)
    for method, path in (
        ("get", "/api/v1/admin/leisure/entries"),
        ("get", f"/api/v1/admin/leisure/entries/{entry.id}"),
        ("delete", f"/api/v1/admin/leisure/entries/{entry.id}"),
    ):
        assert_error(getattr(leisure_client, method)(path), status=401, code="UNAUTHORIZED")


def test_write_requires_csrf_and_same_origin(leisure_client, t05_session: Session):
    state = admin_login(leisure_client, t05_session, username="owner-leisure-csrf")

    assert_error(
        leisure_client.post(
            "/api/v1/admin/leisure/entries", json=anime_payload(), headers={"Origin": ORIGIN}
        ),
        status=403,
        code="FORBIDDEN",
    )
    assert_error(
        leisure_client.post(
            "/api/v1/admin/leisure/entries",
            json={**anime_payload(), "csrf_token": state["csrf_token"]},
            headers={"Origin": "https://evil.example"},
        ),
        status=403,
        code="FORBIDDEN",
    )
    assert t05_session.query(LeisureEntry).count() == 0


def test_full_management_flow(leisure_client, t05_session: Session):
    """新建（草稿）→ 改进度 → 发布 → 公开可见（验收 6）。"""
    state = admin_login(leisure_client, t05_session, username="owner-leisure-flow")
    created = _create(
        leisure_client, state["csrf_token"], anime_payload(total_episodes=None, episodes_watched=6)
    )
    body = created.json()
    assert body["status"] == "draft"
    assert body["public"] is False
    assert body["anime"]["episodes_label"] == "看到第 6 集"
    assert body["anime"]["completion_ratio"] is None

    # 进度 +1：只改一个字段，版本递增。
    updated = leisure_client.patch(
        f"/api/v1/admin/leisure/entries/{body['id']}",
        json={"episodes_watched": 7, "csrf_token": state["csrf_token"]},
        headers={"Origin": ORIGIN, "If-Match": created.headers["ETag"]},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["anime"]["episodes_label"] == "看到第 7 集"
    assert updated.json()["version"] == 2

    published = leisure_client.post(
        f"/api/v1/admin/leisure/entries/{body['id']}/publish",
        json={"csrf_token": state["csrf_token"]},
        headers={"Origin": ORIGIN, "If-Match": updated.headers["ETag"]},
    )
    assert published.status_code == 200, published.text
    assert published.json()["status"] == "published"
    assert published.json()["public"] is True
    assert published.json()["published_at"] is not None

    seen = leisure_client.get(f"/api/v1/leisure/entries/{body['id']}")
    assert seen.status_code == 200, seen.text
    assert seen.json()["anime"]["episodes_label"] == "看到第 7 集"

    # 撤回后公开入口立即看不到，但发布历史时间保留。
    unpublished = leisure_client.post(
        f"/api/v1/admin/leisure/entries/{body['id']}/unpublish",
        json={"csrf_token": state["csrf_token"]},
        headers={"Origin": ORIGIN, "If-Match": published.headers["ETag"]},
    )
    assert unpublished.status_code == 200, unpublished.text
    assert unpublished.json()["status"] == "draft"
    assert unpublished.json()["published_at"] is not None
    assert_error(
        leisure_client.get(f"/api/v1/leisure/entries/{body['id']}"), status=404, code="NOT_FOUND"
    )


def test_create_always_makes_a_draft(leisure_client, t05_session: Session):
    state = admin_login(leisure_client, t05_session, username="owner-leisure-draft")
    # 请求体里塞 status 会被拒绝（extra="forbid"），不是被静默忽略。
    _create(
        leisure_client,
        state["csrf_token"],
        {**anime_payload(), "status": "published"},
        expect=422,
    )
    body = _create(leisure_client, state["csrf_token"], game_payload()).json()
    assert body["status"] == "draft"


def test_if_match_required_and_enforced(leisure_client, t05_session: Session):
    state = admin_login(leisure_client, t05_session, username="owner-leisure-ifmatch")
    created = _create(leisure_client, state["csrf_token"], game_payload())
    entry_id = created.json()["id"]

    def patch(headers: dict[str, str]):
        return leisure_client.patch(
            f"/api/v1/admin/leisure/entries/{entry_id}",
            json={"rating": 9, "csrf_token": state["csrf_token"]},
            headers={"Origin": ORIGIN, **headers},
        )

    assert_error(patch({}), status=428, code="PRECONDITION_REQUIRED")
    assert_error(patch({"If-Match": '"7"'}), status=412, code="VERSION_CONFLICT")
    ok = patch({"If-Match": created.headers["ETag"]})
    assert ok.status_code == 200, ok.text
    assert ok.json()["rating"] == 9
    assert_error(patch({"If-Match": created.headers["ETag"]}), status=412, code="VERSION_CONFLICT")


def test_rating_can_be_cleared_back_to_unrated(leisure_client, t05_session: Session):
    """「把评分改回未评分」必须能通过：可空字段传 null 就是清空。"""
    state = admin_login(leisure_client, t05_session, username="owner-leisure-rating")
    created = _create(leisure_client, state["csrf_token"], anime_payload(rating=8))
    assert created.json()["rating"] == 8

    cleared = leisure_client.patch(
        f"/api/v1/admin/leisure/entries/{created.json()['id']}",
        json={"rating": None, "csrf_token": state["csrf_token"]},
        headers={"Origin": ORIGIN, "If-Match": created.headers["ETag"]},
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["rating"] is None


def test_cross_kind_fields_are_rejected_with_field_errors(leisure_client, t05_session: Session):
    state = admin_login(leisure_client, t05_session, username="owner-leisure-kind")
    response = leisure_client.post(
        "/api/v1/admin/leisure/entries",
        json={**anime_payload(), "platform": "PC", "csrf_token": state["csrf_token"]},
        headers={"Origin": ORIGIN},
    )
    assert response.status_code == 422, response.text
    assert t05_session.query(LeisureEntry).count() == 0

    response = leisure_client.post(
        "/api/v1/admin/leisure/entries",
        json={**game_payload(), "total_episodes": 12, "csrf_token": state["csrf_token"]},
        headers={"Origin": ORIGIN},
    )
    assert response.status_code == 422, response.text

    # 进度取值也要与类型匹配。
    response = leisure_client.post(
        "/api/v1/admin/leisure/entries",
        json={**game_payload(), "progress": "finished", "csrf_token": state["csrf_token"]},
        headers={"Origin": ORIGIN},
    )
    assert response.status_code == 422, response.text


def test_patch_cannot_smuggle_cross_kind_fields(leisure_client, t05_session: Session):
    """只改一个字段不能让整体变得不一致（服务层对合并后的结果再校验一次）。"""
    state = admin_login(leisure_client, t05_session, username="owner-leisure-smuggle")
    created = _create(leisure_client, state["csrf_token"], anime_payload())

    response = leisure_client.patch(
        f"/api/v1/admin/leisure/entries/{created.json()['id']}",
        json={"platform": "Switch", "csrf_token": state["csrf_token"]},
        headers={"Origin": ORIGIN, "If-Match": created.headers["ETag"]},
    )
    assert response.status_code == 422, response.text
    assert "platform" in response.json()["error"]["fields"]

    # 版本没变（失败的写入不递增版本）。
    fresh = leisure_client.get(f"/api/v1/admin/leisure/entries/{created.json()['id']}")
    assert fresh.json()["version"] == created.json()["version"]


def test_episodes_cannot_exceed_total_after_patch(leisure_client, t05_session: Session):
    state = admin_login(leisure_client, t05_session, username="owner-leisure-episodes")
    created = _create(
        leisure_client, state["csrf_token"], anime_payload(total_episodes=12, episodes_watched=6)
    )

    response = leisure_client.patch(
        f"/api/v1/admin/leisure/entries/{created.json()['id']}",
        json={"total_episodes": 3, "csrf_token": state["csrf_token"]},
        headers={"Origin": ORIGIN, "If-Match": created.headers["ETag"]},
    )
    assert response.status_code == 422, response.text
    assert "episodes_watched" in response.json()["error"]["fields"]

    # 把总数清空是允许的（总集数不明是合法状态）。
    ok = leisure_client.patch(
        f"/api/v1/admin/leisure/entries/{created.json()['id']}",
        json={"total_episodes": None, "csrf_token": state["csrf_token"]},
        headers={"Origin": ORIGIN, "If-Match": created.headers["ETag"]},
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["anime"]["total_episodes"] is None
    assert ok.json()["anime"]["completion_ratio"] is None


def test_cover_must_be_ready(leisure_client, t05_session: Session, t05_settings):
    from tests.media.helpers import make_media_row

    state = admin_login(leisure_client, t05_session, username="owner-leisure-cover")
    owner_id = _owner_id(t05_session)
    broken = make_media_row(
        t05_session, owner_id=owner_id, root=t05_settings.media_root_path, status="processing"
    )
    response = leisure_client.post(
        "/api/v1/admin/leisure/entries",
        json={**anime_payload(), "cover_media_id": str(broken.id), "csrf_token": state["csrf_token"]},
        headers={"Origin": ORIGIN},
    )
    assert_error(response, status=409, code="CONFLICT")
    assert t05_session.query(LeisureEntry).count() == 0


def test_delete_is_soft(leisure_client, t05_session: Session):
    state = admin_login(leisure_client, t05_session, username="owner-leisure-delete")
    entry = make_public_anime(t05_session, title="要删掉的条目")

    response = leisure_client.delete(
        f"/api/v1/admin/leisure/entries/{entry.id}",
        headers={"Origin": ORIGIN, "X-CSRF-Token": state["csrf_token"], "If-Match": '"1"'},
    )
    assert response.status_code == 204, response.text

    t05_session.expire_all()
    row = t05_session.get(LeisureEntry, entry.id)
    assert row is not None and row.deleted_at is not None
    assert_error(
        leisure_client.get(f"/api/v1/admin/leisure/entries/{entry.id}"), status=404, code="NOT_FOUND"
    )
    assert_error(
        leisure_client.get(f"/api/v1/leisure/entries/{entry.id}"), status=404, code="NOT_FOUND"
    )


def test_admin_list_includes_drafts_and_filters(leisure_client, t05_session: Session):
    state = admin_login(leisure_client, t05_session, username="owner-leisure-list")
    draft = make_anime(t05_session, title="管理列表里的草稿")
    make_public_anime(t05_session, title="管理列表里的公开")

    listing = leisure_client.get("/api/v1/admin/leisure/entries", params={"status": "draft"})
    assert listing.status_code == 200, listing.text
    titles = [item["title"] for item in listing.json()["items"]]
    assert draft.title in titles
    assert "管理列表里的公开" not in titles
    assert state["authenticated"] is True


def test_progress_update_does_not_touch_other_content_domains():
    """**进度更新不自动公开刷 INS**（07 §3、任务卡「不做」）。

    做成对源码的可执行断言而不是「读一遍觉得没问题」：leisure 的任何文件都不导入
    `moments`，因此它在结构上不可能顺手写一条动态。将来要做「生成 INS 草稿」，
    必须显式改这个断言并走独立设计（确认后发布，而不是每次 +1 都刷屏）。

    判定方式：用 `ast` 解析出所有 `import` / 属性访问名，**剥掉文档字符串**，
    因此文件里解释「为什么不做」的文字不会误报。
    """
    import ast

    offenders: list[str] = []
    for path in sorted((API_DIR / "app" / "modules" / "leisure").glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        # 模块 / 类 / 函数的文档字符串整体剥掉：注释与说明文字不算引用。
        for node in ast.walk(tree):
            if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
                body = node.body
                if (
                    body
                    and isinstance(body[0], ast.Expr)
                    and isinstance(body[0].value, ast.Constant)
                    and isinstance(body[0].value.value, str)
                ):
                    node.body = body[1:]
        for node in ast.walk(tree):
            names: list[str] = []
            if isinstance(node, ast.Import):
                names = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom):
                names = [node.module or ""] + [alias.name for alias in node.names]
            elif isinstance(node, ast.Name):
                names = [node.id]
            elif isinstance(node, ast.Attribute):
                names = [node.attr]
            for name in names:
                if "moments" in name:
                    offenders.append(f"{path.name}:{getattr(node, 'lineno', '?')} {name}")
    assert offenders == [], f"leisure 不应导入或引用 moments：{offenders}"


def _owner_id(session: Session):
    from app.modules.auth import service as auth_service
    from tests.auth.helpers import DEFAULT_USERNAME, make_admin

    for username in (DEFAULT_USERNAME, "owner-leisure-cover"):
        user = auth_service.find_user(session, username)
        if user is not None:
            return user.id
    return make_admin(session, username=DEFAULT_USERNAME).id
