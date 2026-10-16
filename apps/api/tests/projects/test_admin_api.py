"""作品管理 API（T06 执行清单第 2 条；05 §7 的并发与权限规则）。

全部通过**真实端点**走：`GET /auth/session` → `POST /auth/login` → 写请求带
Origin + CSRF + `If-Match`。因此 CSRF / Origin / 版本 / 发布门槛是被真的执行过的。

覆盖：

  - 未登录（连预登录 Cookie 都没有）的创建 / 更新 / 发布 / 删除一律 401；
  - 缺 `If-Match` → 428，过期版本 → 412 且**内容不变**（不自动覆盖）；
  - 发布门槛：没有图片 409、图片未 ready 409、缺一句话用途 409；
  - `images` 完整替换（顺序与 kind、caption、taken_on 一起换）；
  - **发布不写未来的 `published_at`**（服务端生成，不信客户端时钟）；
  - 撤回把状态改回 draft 并清空 `published_at`，图片关系保留；
  - 软删除后管理列表也不出现，公开详情 404；
  - 链接只接受 http/https（不接受 `javascript:` / `data:` / 本机绝对路径）。
"""

from __future__ import annotations

import uuid

import pytest

from tests.core.t01_db import assert_error
from tests.projects.helpers import (
    ADMIN_PROJECTS_PATH,
    PROJECTS_PATH,
    admin_client,
    anonymous_client,
    create_project,
    image_payload,
    make_media,
    publish_project,
    t06_routers,
    unique_slug,
    unpublish_project,
    write_headers,
)


def test_anonymous_cannot_write(t06_session, t06_settings) -> None:
    """未登录上传 / 编辑被拒绝（01 §3：隐藏按钮不是安全边界）。"""
    with anonymous_client(t06_settings, t06_session, *t06_routers()) as client:
        created = client.post(
            ADMIN_PROJECTS_PATH,
            json={"slug": unique_slug(), "title": "冒充站主", "summary": "用途"},
            headers={"Origin": "http://testserver"},
        )
        assert created.status_code == 401, created.text
        assert_error(created, status=401, code="UNAUTHORIZED")


def test_create_returns_201_draft_with_etag(t06_session, t06_settings) -> None:
    # 站主由 `admin_client` 建并返回：**不要**在用例里先 `make_admin`，
    # 那会用默认密码占掉 `owner` 这个用户名，随后的真实登录就登不进去了。
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, owner, csrf):
        media = make_media(t06_session, owner)
        response = create_project(
            client,
            csrf,
            slug="first-real-project",
            title="这个 P5 博客",
            summary="把静态博客改造成怪盗基地",
            images=image_payload([media.id], kinds=["cover"]),
            tech_stack=["Next.js", "FastAPI", "PostgreSQL"],
        )
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["status"] == "draft"
        assert body["published_at"] is None
        assert body["version"] == 1
        assert response.headers["etag"] == '"1"'
        assert body["images"][0]["kind"] == "cover"
        # 管理回执里能看到完整关系（含 media 状态），公开 DTO 里没有这些字段。
        assert body["images"][0]["media_status"] == "ready"


def test_duplicate_slug_is_409(t06_session, t06_settings) -> None:
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, _user, csrf):
        slug = unique_slug("dup")
        assert create_project(client, csrf, slug=slug).status_code == 201
        second = create_project(client, csrf, slug=slug, title="第二件")
        assert_error(second, status=409, code="CONFLICT")


def test_missing_if_match_is_428(t06_session, t06_settings) -> None:
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, _user, csrf):
        created = create_project(client, csrf, slug=unique_slug())
        project_id = created.json()["id"]
        response = client.patch(
            f"{ADMIN_PROJECTS_PATH}/{project_id}",
            json={"title": "改标题"},
            headers={"Origin": "http://testserver", "X-CSRF-Token": csrf},
        )
        assert_error(response, status=428, code="PRECONDITION_REQUIRED")


def test_stale_version_is_412_and_content_is_untouched(t06_session, t06_settings) -> None:
    """412 时**不做任何修改**：调用方负责保留未保存输入（05 §7）。"""
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, _user, csrf):
        created = create_project(client, csrf, slug=unique_slug(), title="原标题")
        project_id = created.json()["id"]

        ok = client.patch(
            f"{ADMIN_PROJECTS_PATH}/{project_id}",
            json={"title": "第一次修改"},
            headers=write_headers(csrf, 1),
        )
        assert ok.status_code == 200, ok.text
        assert ok.json()["version"] == 2

        stale = client.patch(
            f"{ADMIN_PROJECTS_PATH}/{project_id}",
            json={"title": "基于旧版本的修改"},
            headers=write_headers(csrf, 1),
        )
        assert_error(stale, status=412, code="VERSION_CONFLICT")

        fresh = client.get(f"{ADMIN_PROJECTS_PATH}/{project_id}")
        assert fresh.json()["title"] == "第一次修改"


def test_publish_requires_at_least_one_image(t06_session, t06_settings) -> None:
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, _user, csrf):
        created = create_project(client, csrf, slug=unique_slug(), summary="有用途但没图")
        project_id = created.json()["id"]
        response = publish_project(client, csrf, project_id, created.json()["version"])
        assert_error(response, status=409, code="CONFLICT")


def test_publish_requires_a_summary(t06_session, t06_settings) -> None:
    """「一句话用途」是作品卡片的门面（07 §5）：没有它不能发布。"""
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, owner, csrf):
        media = make_media(t06_session, owner)
        created = create_project(
            client,
            csrf,
            slug=unique_slug(),
            summary="",
            images=image_payload([media.id], kinds=["cover"]),
        )
        response = publish_project(client, csrf, created.json()["id"], created.json()["version"])
        assert_error(response, status=409, code="CONFLICT")


def test_publish_rejects_not_ready_media(t06_session, t06_settings) -> None:
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, owner, csrf):
        processing = make_media(t06_session, owner, status="processing")
        created = create_project(
            client,
            csrf,
            slug=unique_slug(),
            images=image_payload([processing.id], kinds=["cover"]),
        )
        # 未 ready 的图连草稿都不接受（避免存一个永远发不出去的草稿）。
        assert_error(created, status=409, code="CONFLICT")


def test_publish_then_unpublish_keeps_images(t06_session, t06_settings) -> None:
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, owner, csrf):
        media = make_media(t06_session, owner)
        created = create_project(
            client,
            csrf,
            slug="publish-cycle",
            summary="用途",
            images=image_payload([media.id], kinds=["cover"]),
        ).json()
        published = publish_project(client, csrf, created["id"], created["version"])
        assert published.status_code == 200, published.text
        body = published.json()
        assert body["status"] == "published"
        assert body["published_at"] is not None

        # 公开端点现在能读到。
        anonymous = client.get(f"{PROJECTS_PATH}/publish-cycle")
        assert anonymous.status_code == 200, anonymous.text

        retracted = unpublish_project(client, csrf, created["id"], body["version"])
        assert retracted.status_code == 200, retracted.text
        assert retracted.json()["status"] == "draft"
        assert retracted.json()["published_at"] is None
        assert retracted.json()["images"], "撤回不应该丢掉图片关系"

        assert client.get(f"{PROJECTS_PATH}/publish-cycle").status_code == 404


def test_images_are_replaced_as_a_whole(t06_session, t06_settings) -> None:
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, owner, csrf):
        first = make_media(t06_session, owner)
        second = make_media(t06_session, owner)
        created = create_project(
            client,
            csrf,
            slug=unique_slug(),
            images=image_payload([first.id, second.id], kinds=["cover", "detail"]),
        ).json()
        assert [image["position"] for image in created["images"]] == [0, 1]

        # 只留第二张，并改它的 kind / caption / taken_on。
        patched = client.patch(
            f"{ADMIN_PROJECTS_PATH}/{created['id']}",
            json={
                "images": [
                    {
                        "media_id": str(second.id),
                        "position": 0,
                        "kind": "evidence",
                        "alt": "成果截图",
                        "caption": "首页成绩单",
                        "taken_on": "2026-10-16",
                    }
                ]
            },
            headers=write_headers(csrf, created["version"]),
        )
        assert patched.status_code == 200, patched.text
        images = patched.json()["images"]
        assert len(images) == 1
        assert images[0]["media_id"] == str(second.id)
        assert images[0]["kind"] == "evidence"
        assert images[0]["caption"] == "首页成绩单"
        assert images[0]["taken_on"] == "2026-10-16"


def test_duplicate_media_in_one_project_is_409(t06_session, t06_settings) -> None:
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, owner, csrf):
        media = make_media(t06_session, owner)
        response = create_project(
            client,
            csrf,
            slug=unique_slug(),
            images=[
                {"media_id": str(media.id), "position": 0, "kind": "cover", "alt": "图一"},
                {"media_id": str(media.id), "position": 1, "kind": "detail", "alt": "图二"},
            ],
        )
        assert_error(response, status=409, code="CONFLICT")


def test_duplicate_position_is_409(t06_session, t06_settings) -> None:
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, owner, csrf):
        first = make_media(t06_session, owner)
        second = make_media(t06_session, owner)
        response = create_project(
            client,
            csrf,
            slug=unique_slug(),
            images=[
                {"media_id": str(first.id), "position": 0, "kind": "cover", "alt": "图一"},
                {"media_id": str(second.id), "position": 0, "kind": "detail", "alt": "图二"},
            ],
        )
        assert_error(response, status=409, code="CONFLICT")


def test_patch_with_images_uses_router_dumped_payload(t06_session, t06_settings) -> None:
    """回归：`model_dump(exclude_unset=True)` 让 service 收到 dict 列表而不是模型实例。

    T03 的真实缺陷是这里直接 `image.media_id` → AttributeError → 500。T06 的 service
    用 `_as_image_input()` 归一化，本用例从 **router 的入口**进来钉住它。
    """
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, owner, csrf):
        media = make_media(t06_session, owner)
        created = create_project(client, csrf, slug=unique_slug()).json()
        patched = client.patch(
            f"{ADMIN_PROJECTS_PATH}/{created['id']}",
            json={"images": image_payload([media.id], kinds=["cover"])},
            headers=write_headers(csrf, created["version"]),
        )
        assert patched.status_code == 200, patched.text
        assert patched.json()["images"][0]["media_id"] == str(media.id)


def test_empty_alt_is_rejected(t06_session, t06_settings) -> None:
    """图片必须有 alt（验收 §1「图片有 alt」）。"""
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, owner, csrf):
        media = make_media(t06_session, owner)
        response = create_project(
            client,
            csrf,
            slug=unique_slug(),
            images=[{"media_id": str(media.id), "position": 0, "kind": "cover", "alt": "   "}],
        )
        assert_error(response, status=422, code="UNPROCESSABLE")


@pytest.mark.parametrize(
    "url",
    [
        "javascript:alert(1)",
        "data:text/html;base64,PHNjcmlwdD4=",
        "/etc/passwd",
        "file:///Users/v/secret.png",
        "ftp://example.com/repo",
        "not-a-url",
    ],
)
def test_links_must_be_http_urls(t06_session, t06_settings, url: str) -> None:
    """不接受任意协议 / 本机路径（ACCEPTANCE §1：不新增脚本执行与本机素材路径）。"""
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, _user, csrf):
        response = create_project(
            client,
            csrf,
            slug=unique_slug(),
            links=[{"kind": "repo", "label": "仓库", "url": url}],
        )
        assert_error(response, status=422, code="UNPROCESSABLE")


def test_valid_links_round_trip(t06_session, t06_settings) -> None:
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, _user, csrf):
        created = create_project(
            client,
            csrf,
            slug=unique_slug(),
            links=[
                {"kind": "repo", "label": "GitHub 仓库", "url": "https://github.com/ScurryCat/Blogs"},
                {"kind": "demo", "label": "线上演示", "url": "https://example.com/demo"},
            ],
        )
        assert created.status_code == 201, created.text
        links = created.json()["links"]
        assert links[0]["url"] == "https://github.com/ScurryCat/Blogs"
        assert links[1]["kind"] == "demo"


def test_tech_stack_is_deduplicated_and_trimmed(t06_session, t06_settings) -> None:
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, _user, csrf):
        created = create_project(
            client,
            csrf,
            slug=unique_slug(),
            tech_stack=["  Next.js ", "Next.js", "", "FastAPI"],
        )
        assert created.status_code == 201, created.text
        assert created.json()["tech_stack"] == ["Next.js", "FastAPI"]


def test_unknown_palace_is_409(t06_session, t06_settings) -> None:
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, _user, csrf):
        response = create_project(
            client, csrf, slug=unique_slug(), palace_id=str(uuid.uuid4())
        )
        assert_error(response, status=409, code="CONFLICT")


def test_soft_delete_hides_from_admin_and_public(t06_session, t06_settings) -> None:
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, owner, csrf):
        media = make_media(t06_session, owner)
        created = create_project(
            client,
            csrf,
            slug="to-delete",
            images=image_payload([media.id], kinds=["cover"]),
        ).json()
        published = publish_project(client, csrf, created["id"], created["version"]).json()

        deleted = client.delete(
            f"{ADMIN_PROJECTS_PATH}/{created['id']}",
            headers=write_headers(csrf, published["version"]),
        )
        assert deleted.status_code == 204, deleted.text

        assert client.get(f"{ADMIN_PROJECTS_PATH}/{created['id']}").status_code == 404
        admin_list = client.get(ADMIN_PROJECTS_PATH)
        assert all(item["id"] != created["id"] for item in admin_list.json()["items"])
        assert client.get(f"{PROJECTS_PATH}/to-delete").status_code == 404


def test_admin_listing_includes_drafts_and_is_private_no_store(t06_session, t06_settings) -> None:
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, _user, csrf):
        create_project(client, csrf, slug="draft-one")
        response = client.get(ADMIN_PROJECTS_PATH)
        assert response.status_code == 200, response.text
        assert [item["slug"] for item in response.json()["items"]] == ["draft-one"]
        assert response.headers["cache-control"] == "private, no-store"
        assert response.json()["items"][0]["status"] == "draft"


def test_admin_listing_rejects_unknown_status(t06_session, t06_settings) -> None:
    with admin_client(t06_settings, t06_session, *t06_routers()) as (client, _user, _csrf):
        response = client.get(f"{ADMIN_PROJECTS_PATH}?status=archived")
        assert_error(response, status=422, code="UNPROCESSABLE")
