"""工作草稿提交（moment）：事务、双版本、幂等、动作矩阵、相册来源（契约 §3.3 / §9.3）。

核心断言：
  - save 只写正式草稿（不改变公开状态）；publish 走正式发布校验；
  - 提交失败整体回滚：草稿保持 active、正式内容不变；
  - 幂等回放优先于 If-Match；不同 key / 跨草稿同 key → 409；
  - 正式行 + 媒体关系 + 相册来源 + 草稿状态在同一事务内提交。
"""

from __future__ import annotations

import uuid

from sqlalchemy import func, select

from app.modules.gallery.models import Album, album_media, album_media_sources
from app.modules.media.models import Media
from app.modules.moments.models import Moment, moment_media, moment_tags
from app.modules.work_drafts.models import WorkDraft
from tests.core.t01_db import error_code
from tests.work_drafts.helpers import (
    WORK_DRAFTS_PATH,
    admin_client,
    commit_draft,
    create_draft,
    discard_draft,
    make_album,
    make_media,
    make_moment,
    patch_draft,
)


def _count(session, model) -> int:
    return session.execute(select(func.count()).select_from(model)).scalar_one()


def _commit_and_expect(client, csrf, draft_id: str, *, version: int, action: str,
                       expected: int | None = None, key: str | None = None):
    response = commit_draft(
        client,
        csrf,
        draft_id,
        draft_version=version,
        action=action,
        expected_target_version=expected,
        commit_key=key,
    )
    return response


# --- 新建内容 ---------------------------------------------------------------


def test_commit_save_new_creates_formal_draft(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        draft = create_draft(
            client,
            csrf,
            content_type="moment",
            data={"text": "正式草稿正文", "tags": ["测试标签"]},
        )
        draft_id = draft.json()["draft"]["id"]
        response = _commit_and_expect(
            client, csrf, draft_id, version=1, action="save"
        )
        assert response.status_code == 200, response.text
        result = response.json()
        assert result["action"] == "save"
        assert result["status"] == "draft"
        assert result["visibility"] is None, "moment 没有 visibility 字段"
        assert result["idempotent_replay"] is False
        assert result["target_version"] == 1

        moment = c1_session.get(Moment, uuid.UUID(result["target_id"]))
        assert moment is not None
        assert moment.text == "正式草稿正文"
        assert moment.status == "draft"
        assert moment.published_at is None
        assert moment.author_id == owner.id
        tag_names = set(
            c1_session.execute(
                select(moment_tags.c.tag_id).where(moment_tags.c.moment_id == moment.id)
            ).scalars()
        )
        assert tag_names, "标签关系应写入同一事务"

        stored = c1_session.get(WorkDraft, uuid.UUID(draft_id))
        assert stored.status == "committed"
        assert stored.committed_target_id == moment.id
        assert stored.committed_target_version == 1


def test_commit_publish_new_with_images(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        media_a = make_media(c1_session, owner)
        media_b = make_media(c1_session, owner)
        draft = create_draft(
            client,
            csrf,
            content_type="moment",
            data={"text": "要发布的动态"},
            images=[
                {"media_id": str(media_a.id), "alt": "第一张"},
                {"media_id": str(media_b.id), "alt": "第二张"},
            ],
        )
        draft_id = draft.json()["draft"]["id"]
        response = _commit_and_expect(client, csrf, draft_id, version=1, action="publish")
        assert response.status_code == 200, response.text
        result = response.json()
        assert result["status"] == "published"
        assert result["target_version"] == 1

        moment = c1_session.get(Moment, uuid.UUID(result["target_id"]))
        assert moment.status == "published"
        assert moment.published_at is not None
        refs = c1_session.execute(
            select(moment_media.c.media_id, moment_media.c.position, moment_media.c.alt)
            .where(moment_media.c.moment_id == moment.id)
            .order_by(moment_media.c.position)
        ).all()
        assert [(str(row.media_id), row.position, row.alt) for row in refs] == [
            (str(media_a.id), 0, "第一张"),
            (str(media_b.id), 1, "第二张"),
        ]


def test_commit_publish_without_images_422_rolls_back(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        before = _count(c1_session, Moment)
        draft = create_draft(client, csrf, content_type="moment", data={"text": "没图"})
        draft_id = draft.json()["draft"]["id"]
        response = _commit_and_expect(client, csrf, draft_id, version=1, action="publish")
        assert response.status_code == 422, response.text
        assert error_code(response) == "VALIDATION_FAILED"
        assert "images" in response.json()["error"]["fields"]
        assert _count(c1_session, Moment) == before, "发布校验失败不得创建正式内容"

        detail = client.get(f"{WORK_DRAFTS_PATH}/{draft_id}", cookies=client.cookies)
        assert detail.json()["status"] == "active", "失败后草稿必须保持 active"
        assert detail.json()["draft_version"] == 1


def test_commit_with_empty_alt_422_rolls_back(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        media = make_media(c1_session, owner)
        before = _count(c1_session, Moment)
        draft = create_draft(
            client,
            csrf,
            content_type="moment",
            images=[{"media_id": str(media.id), "alt": ""}],
        )
        response = _commit_and_expect(
            client, csrf, draft.json()["draft"]["id"], version=1, action="save"
        )
        assert response.status_code == 422, response.text
        assert "images" in response.json()["error"]["fields"]
        assert _count(c1_session, Moment) == before
        stored = c1_session.get(WorkDraft, uuid.UUID(draft.json()["draft"]["id"]))
        assert stored.status == "active"


# --- 已有 target：动作矩阵 / 双版本 -----------------------------------------


def test_commit_save_existing_draft_and_then_publish_with_new_draft(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        target = make_moment(c1_session, owner, text="旧正文", status="draft")
        draft = create_draft(
            client,
            csrf,
            content_type="moment",
            target_id=str(target.id),
            data={"text": "更新后的正文"},
        )
        draft_id = draft.json()["draft"]["id"]

        saved = _commit_and_expect(
            client, csrf, draft_id, version=1, action="save", expected=1
        )
        assert saved.status_code == 200, saved.text
        assert saved.json()["status"] == "draft"
        assert saved.json()["target_version"] == 2
        moment = c1_session.get(Moment, target.id)
        assert moment.text == "更新后的正文"
        assert moment.status == "draft"
        assert moment.published_at is None

        # 再次打开 = 新的一份 active 草稿（旧草稿已 committed），双版本从 2 开始。
        media = make_media(c1_session, owner)
        reopened = create_draft(
            client,
            csrf,
            content_type="moment",
            target_id=str(target.id),
            images=[{"media_id": str(media.id), "alt": "配图"}],
        )
        assert reopened.status_code == 201, reopened.text
        assert reopened.json()["draft"]["target_version"] == 2

        published = _commit_and_expect(
            client,
            csrf,
            reopened.json()["draft"]["id"],
            version=1,
            action="publish",
            expected=2,
        )
        assert published.status_code == 200, published.text
        assert published.json()["status"] == "published"
        assert published.json()["target_version"] == 3
        assert c1_session.get(Moment, target.id).status == "published"


def test_commit_update_published_content_keeps_public_state(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        target = make_moment(c1_session, owner, text="公开旧文", status="published")
        original_published_at = target.published_at
        version_before = target.version
        new_media = make_media(c1_session, owner)
        draft = create_draft(
            client,
            csrf,
            content_type="moment",
            target_id=str(target.id),
            data={"text": "公开新文"},
            images=[{"media_id": str(new_media.id), "alt": "新图"}],
        )
        response = _commit_and_expect(
            client,
            csrf,
            draft.json()["draft"]["id"],
            version=1,
            action="update",
            expected=version_before,
        )
        assert response.status_code == 200, response.text
        assert response.json()["status"] == "published"
        moment = c1_session.get(Moment, target.id)
        assert moment.text == "公开新文"
        assert moment.status == "published"
        assert moment.published_at == original_published_at, "更新不刷新首次发布时间"
        assert moment.version == version_before + 1
        refs = c1_session.execute(
            select(moment_media.c.media_id).where(moment_media.c.moment_id == moment.id)
        ).scalars().all()
        assert refs == [new_media.id]


def test_action_matrix_409(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        published = make_moment(c1_session, owner, status="published")
        draft_target = make_moment(c1_session, owner, status="draft")

        # 已发布内容：save / publish 都不允许，只能 update
        for action in ("save", "publish"):
            draft = create_draft(
                client, csrf, content_type="moment", target_id=str(published.id)
            )
            response = _commit_and_expect(
                client,
                csrf,
                draft.json()["draft"]["id"],
                version=1,
                action=action,
                expected=published.version,
            )
            assert response.status_code == 409, (action, response.text)
            assert error_code(response) == "CONFLICT"
            assert "action" in response.json()["error"]["fields"]

        # 正式草稿：update 不允许
        draft = create_draft(
            client, csrf, content_type="moment", target_id=str(draft_target.id)
        )
        response = _commit_and_expect(
            client,
            csrf,
            draft.json()["draft"]["id"],
            version=1,
            action="update",
            expected=draft_target.version,
        )
        assert response.status_code == 409, response.text

        # 新内容：update 不允许
        new_draft = create_draft(client, csrf, content_type="moment")
        response = _commit_and_expect(
            client, csrf, new_draft.json()["draft"]["id"], version=1, action="update"
        )
        assert response.status_code == 409, response.text
        assert "save" in str(response.json()["error"]["fields"])


def test_double_version_conflicts_412(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        target = make_moment(c1_session, owner, status="published")
        # 正式内容已经在别处更新（version 变成 3）
        target.version = 3
        c1_session.flush()

        draft = create_draft(
            client, csrf, content_type="moment", target_id=str(target.id)
        )
        stale_target = _commit_and_expect(
            client,
            csrf,
            draft.json()["draft"]["id"],
            version=1,
            action="update",
            expected=2,
        )
        assert stale_target.status_code == 412, stale_target.text
        assert error_code(stale_target) == "VERSION_CONFLICT"
        assert c1_session.get(Moment, target.id).version == 3, "412 不得改动正式内容"

        # 草稿版本不符同样 412（且发生在动作/目标校验之前）
        stale_draft = _commit_and_expect(
            client,
            csrf,
            draft.json()["draft"]["id"],
            version=99,
            action="update",
            expected=3,
        )
        assert stale_draft.status_code == 412, stale_draft.text
        assert error_code(stale_draft) == "VERSION_CONFLICT"


def test_expected_target_version_missing_or_forbidden_422(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        target = make_moment(c1_session, owner, status="draft")
        draft = create_draft(
            client, csrf, content_type="moment", target_id=str(target.id)
        )
        missing = _commit_and_expect(
            client, csrf, draft.json()["draft"]["id"], version=1, action="save"
        )
        assert missing.status_code == 422, missing.text
        assert "expected_target_version" in missing.json()["error"]["fields"]

        new_draft = create_draft(client, csrf, content_type="moment")
        forbidden = _commit_and_expect(
            client,
            csrf,
            new_draft.json()["draft"]["id"],
            version=1,
            action="save",
            expected=1,
        )
        assert forbidden.status_code == 422, forbidden.text
        assert "expected_target_version" in forbidden.json()["error"]["fields"]


def test_commit_without_commit_key_or_if_match(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        draft = create_draft(client, csrf, content_type="moment")
        draft_id = draft.json()["draft"]["id"]

        no_key = client.post(
            f"{WORK_DRAFTS_PATH}/{draft_id}/commit",
            json={"action": "save"},
            headers={"Origin": "http://testserver", "X-CSRF-Token": csrf, "If-Match": '"1"'},
        )
        assert no_key.status_code == 422, no_key.text

        no_if_match = client.post(
            f"{WORK_DRAFTS_PATH}/{draft_id}/commit",
            json={"action": "save", "commit_key": str(uuid.uuid4())},
            headers={"Origin": "http://testserver", "X-CSRF-Token": csrf},
        )
        assert no_if_match.status_code == 428, no_if_match.text
        assert error_code(no_if_match) == "PRECONDITION_REQUIRED"


# --- 幂等 -------------------------------------------------------------------


def test_idempotent_replay_priority_over_if_match(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        media = make_media(c1_session, owner)
        draft = create_draft(
            client,
            csrf,
            content_type="moment",
            data={"text": "幂等发布"},
            images=[{"media_id": str(media.id), "alt": "图"}],
        )
        draft_id = draft.json()["draft"]["id"]
        key = str(uuid.uuid4())

        first = _commit_and_expect(
            client, csrf, draft_id, version=1, action="publish", key=key
        )
        assert first.status_code == 200, first.text
        assert first.json()["idempotent_replay"] is False
        moment_count = _count(c1_session, Moment)
        relation_count = _count(c1_session, moment_media)

        # 网络重试：带旧的 If-Match + 同一 commit_key → 回放而不是 412。
        replay = commit_draft(
            client,
            csrf,
            draft_id,
            draft_version=1,
            action="publish",
            commit_key=key,
        )
        assert replay.status_code == 200, replay.text
        payload = replay.json()
        assert payload["idempotent_replay"] is True
        assert payload["target_id"] == first.json()["target_id"]
        assert payload["target_version"] == first.json()["target_version"]
        assert _count(c1_session, Moment) == moment_count, "重复提交不得生成第二条正式内容"
        assert _count(c1_session, moment_media) == relation_count, "不得重复写媒体关系"

        # 不同 key 二次提交 → 409
        other_key = commit_draft(
            client,
            csrf,
            draft_id,
            draft_version=1,
            action="publish",
            commit_key=str(uuid.uuid4()),
        )
        assert other_key.status_code == 409, other_key.text
        assert error_code(other_key) == "CONFLICT"


def test_commit_key_cannot_be_reused_across_drafts(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        first = create_draft(client, csrf, content_type="moment", data={"text": "一"})
        second = create_draft(client, csrf, content_type="moment", data={"text": "二"})
        shared_key = str(uuid.uuid4())

        ok = _commit_and_expect(
            client, csrf, first.json()["draft"]["id"], version=1, action="save", key=shared_key
        )
        assert ok.status_code == 200, ok.text

        conflict = commit_draft(
            client,
            csrf,
            second.json()["draft"]["id"],
            draft_version=1,
            action="save",
            commit_key=shared_key,
        )
        assert conflict.status_code == 409, conflict.text
        assert "commit_key" in conflict.json()["error"]["fields"]
        stored = c1_session.get(WorkDraft, uuid.UUID(second.json()["draft"]["id"]))
        assert stored.status == "active"


# --- 相册收录来源（复用 gallery.sources） ------------------------------------


def test_commit_publish_syncs_album_sources_idempotently(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        album = make_album(c1_session)
        media = make_media(c1_session, owner)
        album_version_before = album.version
        draft = create_draft(
            client,
            csrf,
            content_type="moment",
            data={
                "text": "带收录的发布",
                "album_links": [{"album_id": str(album.id), "media_ids": [str(media.id)]}],
            },
            images=[{"media_id": str(media.id), "alt": "收录图"}],
        )
        draft_id = draft.json()["draft"]["id"]
        key = str(uuid.uuid4())
        first = _commit_and_expect(
            client, csrf, draft_id, version=1, action="publish", key=key
        )
        assert first.status_code == 200, first.text
        moment_id = uuid.UUID(first.json()["target_id"])

        sources = c1_session.execute(
            select(album_media_sources).where(album_media_sources.c.moment_id == moment_id)
        ).all()
        assert len(sources) == 1
        shows = c1_session.execute(
            select(album_media).where(
                album_media.c.album_id == album.id, album_media.c.media_id == media.id
            )
        ).all()
        assert len(shows) == 1, "收录要同步相册显示关系"
        c1_session.refresh(album)
        assert album.version == album_version_before + 1

        replay = commit_draft(
            client, csrf, draft_id, draft_version=1, action="publish", commit_key=key
        )
        assert replay.status_code == 200, replay.text
        assert replay.json()["idempotent_replay"] is True
        assert (
            c1_session.execute(
                select(func.count())
                .select_from(album_media_sources)
                .where(album_media_sources.c.moment_id == moment_id)
            ).scalar_one()
            == 1
        ), "幂等回放不得重复写入相册来源"


def test_commit_rollback_on_invalid_album_link(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        target = make_moment(c1_session, owner, text="原文", status="published")
        media = make_media(c1_session, owner)
        from tests.work_drafts.helpers import attach_moment_images

        attach_moment_images(c1_session, target, [(media.id, 0, "原图")])
        text_before = target.text
        version_before = target.version

        draft = create_draft(
            client,
            csrf,
            content_type="moment",
            target_id=str(target.id),
            data={
                "text": "不应写入",
                # 不存在的相册：commit 时 gallery.sources 会拒绝 → 整体回滚
                "album_links": [
                    {"album_id": str(uuid.uuid4()), "media_ids": [str(media.id)]}
                ],
            },
        )
        response = _commit_and_expect(
            client,
            csrf,
            draft.json()["draft"]["id"],
            version=1,
            action="update",
            expected=version_before,
        )
        assert response.status_code == 422, response.text
        moment = c1_session.get(Moment, target.id)
        assert moment.text == text_before
        assert moment.version == version_before
        assert (
            c1_session.execute(
                select(func.count()).select_from(album_media_sources)
            ).scalar_one()
            == 0
        )
        stored = c1_session.get(WorkDraft, uuid.UUID(draft.json()["draft"]["id"]))
        assert stored.status == "active"


# --- 事务原子性（模拟提交前异常） -------------------------------------------


def test_commit_rolls_back_on_simulated_transaction_error(
    c1_settings, c1_session, monkeypatch
):
    """在正式内容已写入、草稿状态尚未提交时抛异常：整体回滚。"""
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        media = make_media(c1_session, owner)
        before = _count(c1_session, Moment)
        draft = create_draft(
            client,
            csrf,
            content_type="moment",
            data={"text": "异常提交"},
            images=[{"media_id": str(media.id), "alt": "图"}],
        )
        draft_id = draft.json()["draft"]["id"]

        monkeypatch.setattr(
            "app.modules.work_drafts.service.auth_service.record_audit",
            lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("模拟事务异常")),
        )
        response = _commit_and_expect(
            client, csrf, draft_id, version=1, action="publish"
        )
        assert response.status_code == 500, response.text
        assert _count(c1_session, Moment) == before, "异常必须整体回滚正式内容"
        assert _count(c1_session, moment_media) == 0, "异常必须回滚媒体关系"
        stored = c1_session.get(WorkDraft, uuid.UUID(draft_id))
        assert stored.status == "active"
        assert stored.committed_target_id is None


# --- 草稿状态保护 -----------------------------------------------------------


def test_commit_on_discarded_draft_409(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        draft = create_draft(client, csrf, content_type="moment")
        draft_id = draft.json()["draft"]["id"]
        discard_draft(client, csrf, draft_id)
        response = _commit_and_expect(client, csrf, draft_id, version=1, action="save")
        assert response.status_code == 409, response.text


# --- save 不改变公开状态 ----------------------------------------------------


def test_autosave_does_not_change_published_content(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        target = make_moment(c1_session, owner, text="访客看到的版本", status="published")
        draft = create_draft(
            client,
            csrf,
            content_type="moment",
            target_id=str(target.id),
        )
        patched = patch_draft(
            client, csrf, draft.json()["draft"]["id"], draft_version=1,
            data={"text": "只在草稿里"},
        )
        assert patched.status_code == 200, patched.text
        c1_session.refresh(target)
        assert target.text == "访客看到的版本", "自动保存绝不能写正式内容"
        assert target.status == "published"
