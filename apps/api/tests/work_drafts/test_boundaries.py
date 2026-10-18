"""边界与隐私：越权 404、草稿图片不授予匿名访问、丢弃不影响正式内容 / 其他引用。

设计书 §3.1 / §3.4 的硬约束：
  - 工作草稿不是公开内容类型，公开列表 / 搜索 / 图库 / 访客接口都读不到；
  - 草稿对媒体的保留关系**不能**授予匿名访问权限；
  - 丢弃草稿只解除关系，不删除媒体文件，也不影响正式内容与其他媒体引用。
"""

from __future__ import annotations

import uuid

from sqlalchemy import func, select

from app.modules.media import public_refs as media_public_refs
from app.modules.media.models import Media
from app.modules.moments.models import Moment, moment_media
from app.modules.work_drafts.models import work_draft_media
from tests.core.t01_db import error_code
from tests.media.helpers import make_media_row
from tests.work_drafts.helpers import (
    WORK_DRAFTS_PATH,
    admin_client,
    attach_moment_images,
    commit_draft,
    create_draft,
    discard_draft,
    make_media,
    make_moment,
    patch_draft,
)

VARIANT = "w320.webp"


def _media_with_file(c1_session, owner, c1_settings) -> Media:
    """插一条媒体行并把对象真的写到磁盘（这样匿名请求会走到公开引用检查）。"""
    return make_media_row(
        c1_session, owner_id=owner.id, root=c1_settings.media_root_path
    )


def test_draft_media_relation_does_not_grant_anonymous_access(
    c1_settings, c1_session, c1_public_client
):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        draft_media = _media_with_file(c1_session, owner, c1_settings)
        public_media = _media_with_file(c1_session, owner, c1_settings)
        # 模拟「另一处公开引用」：只有 public_media 被公开，草稿图没有。
        media_public_refs.register(
            "c1-test-public", lambda session, media_id: media_id == public_media.id
        )

        draft = create_draft(
            client,
            csrf,
            content_type="moment",
            images=[{"media_id": str(draft_media.id), "alt": "草稿图"}],
        )
        assert draft.status_code == 201, draft.text

        # 用未登录客户端请求媒体：optional_admin 拿不到会话，才走匿名公开引用检查。
        anonymous = c1_public_client.get(f"/api/v1/media/{draft_media.id}/{VARIANT}")
        assert anonymous.status_code == 404, "草稿对媒体的保留关系不能授予匿名访问"
        control = c1_public_client.get(f"/api/v1/media/{public_media.id}/{VARIANT}")
        assert control.status_code == 200, "对照：有公开引用的媒体匿名可读（证明链路生效）"

        # 丢弃后同样不可匿名读（草稿关系本来就不贡献公开资格）。
        assert discard_draft(client, csrf, draft.json()["draft"]["id"]).status_code == 204
        still_404 = c1_public_client.get(f"/api/v1/media/{draft_media.id}/{VARIANT}")
        assert still_404.status_code == 404


def test_discard_does_not_touch_formal_content_or_other_media(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        formal_media = make_media(c1_session, owner)
        draft_media = make_media(c1_session, owner)
        target = make_moment(c1_session, owner, text="正式正文", status="published")
        attach_moment_images(c1_session, target, [(formal_media.id, 0, "正式图")])
        version_before = target.version

        draft = create_draft(
            client,
            csrf,
            content_type="moment",
            target_id=str(target.id),
            data={"text": "草稿里的新正文"},
            images=[{"media_id": str(draft_media.id), "alt": "草稿图"}],
        )
        draft_id = uuid.UUID(draft.json()["draft"]["id"])
        assert discard_draft(client, csrf, str(draft_id)).status_code == 204

        c1_session.refresh(target)
        assert target.text == "正式正文"
        assert target.version == version_before
        assert target.status == "published"
        formal_refs = c1_session.execute(
            select(moment_media.c.media_id).where(moment_media.c.moment_id == target.id)
        ).scalars().all()
        assert formal_refs == [formal_media.id], "丢弃草稿不得影响正式内容的媒体关系"
        assert c1_session.get(Media, formal_media.id) is not None
        assert c1_session.get(Media, draft_media.id) is not None, "丢弃不删除媒体行 / 文件"
        assert (
            c1_session.execute(
                select(func.count())
                .select_from(work_draft_media)
                .where(work_draft_media.c.draft_id == draft_id)
            ).scalar_one()
            == 0
        )


def test_other_owner_cannot_patch_commit_or_discard_draft(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session, username="owner-one") as (
        client_one,
        owner_one,
        csrf_one,
    ):
        draft = create_draft(client_one, csrf_one, content_type="moment")
        draft_id = draft.json()["draft"]["id"]

    with admin_client(c1_settings, c1_session, username="owner-two") as (
        client_two,
        owner_two,
        csrf_two,
    ):
        patch = patch_draft(
            client_two, csrf_two, draft_id, draft_version=1, data={"text": "越权改"}
        )
        assert patch.status_code == 404, patch.text
        assert error_code(patch) == "NOT_FOUND"

        commit = commit_draft(
            client_two, csrf_two, draft_id, draft_version=1, action="save"
        )
        assert commit.status_code == 404, commit.text

        discard = discard_draft(client_two, csrf_two, draft_id)
        assert discard.status_code == 404, discard.text

    # 原站主的草稿仍然 active 且内容未变
    with admin_client(c1_settings, c1_session, username="owner-one") as (
        client_one,
        owner_one,
        csrf_one,
    ):
        detail = client_one.get(f"{WORK_DRAFTS_PATH}/{draft_id}", cookies=client_one.cookies)
        assert detail.status_code == 200
        assert detail.json()["status"] == "active"


def test_create_draft_for_other_owners_moment_404(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session, username="owner-one") as (
        client_one,
        owner_one,
        csrf_one,
    ):
        moment = make_moment(c1_session, owner_one, text="一号的动态", status="draft")

    with admin_client(c1_settings, c1_session, username="owner-two") as (
        client_two,
        owner_two,
        csrf_two,
    ):
        response = create_draft(
            client_two, csrf_two, content_type="moment", target_id=str(moment.id)
        )
        assert response.status_code == 404, response.text


def test_work_drafts_have_no_public_endpoint(c1_client):
    # 草稿不是公开内容类型：公开侧不存在列表 / 详情路径。
    assert c1_client.get("/api/v1/work-drafts").status_code == 404
    assert c1_client.get(f"/api/v1/work-drafts/{uuid.uuid4()}").status_code == 404
