"""工作草稿提交（journal）：save ≠ publish、私密/公开、双版本、幂等（契约 §3.3）。

手记的两层语义：
  - 「保存」只写 draft + private，绝不改变公开状态；
  - 「公开」是独立动作（commit publish），走既有发布门槛（标题与正文非空）；
  - 编辑已公开手记走 commit update，访客在明确更新前看到原版本。
"""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import func, select

from app.modules.journal.models import JournalEntry, journal_entry_media
from app.modules.work_drafts.models import WorkDraft
from tests.core.t01_db import error_code
from tests.work_drafts.helpers import (
    WORK_DRAFTS_PATH,
    admin_client,
    commit_draft,
    create_draft,
    discard_draft,
    make_journal_entry,
    make_media,
)


def _count(session, model) -> int:
    return session.execute(select(func.count()).select_from(model)).scalar_one()


def _commit(client, csrf, draft_id, *, version=1, action="save", expected=None, key=None):
    return commit_draft(
        client,
        csrf,
        draft_id,
        draft_version=version,
        action=action,
        expected_target_version=expected,
        commit_key=key,
    )


def test_save_new_journal_is_draft_private(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        draft = create_draft(
            client,
            csrf,
            content_type="journal",
            data={
                "entry_date": "2026-10-18",
                "title": "今天的标题",
                "content_md": "今天的正文",
                "mood": "平静",
                "location": "东京",
            },
        )
        response = _commit(client, csrf, draft.json()["draft"]["id"], action="save")
        assert response.status_code == 200, response.text
        result = response.json()
        assert result["status"] == "draft"
        assert result["visibility"] == "private", "保存不是公开"
        assert result["target_version"] == 1

        entry = c1_session.get(JournalEntry, uuid.UUID(result["target_id"]))
        assert entry.entry_date == date(2026, 10, 18)
        assert entry.title == "今天的标题"
        assert entry.content_md == "今天的正文"
        assert entry.mood == "平静"
        assert entry.location == "东京"
        assert entry.status == "draft"
        assert entry.visibility == "private"
        assert entry.published_at is None


def test_publish_new_journal_is_public(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        draft = create_draft(
            client,
            csrf,
            content_type="journal",
            data={
                "entry_date": "2026-10-17",
                "title": "公开标题",
                "content_md": "公开正文",
            },
        )
        response = _commit(client, csrf, draft.json()["draft"]["id"], action="publish")
        assert response.status_code == 200, response.text
        result = response.json()
        assert result["status"] == "published"
        assert result["visibility"] == "public"
        entry = c1_session.get(JournalEntry, uuid.UUID(result["target_id"]))
        assert entry.status == "published"
        assert entry.visibility == "public"
        assert entry.published_at is not None


def test_publish_journal_requires_title_and_content(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        before = _count(c1_session, JournalEntry)
        draft = create_draft(
            client,
            csrf,
            content_type="journal",
            data={"entry_date": "2026-10-18", "title": "", "content_md": ""},
        )
        response = _commit(client, csrf, draft.json()["draft"]["id"], action="publish")
        assert response.status_code == 422, response.text
        assert error_code(response) == "VALIDATION_FAILED"
        assert _count(c1_session, JournalEntry) == before, "发布校验失败不得创建正式手记"
        stored = c1_session.get(WorkDraft, uuid.UUID(draft.json()["draft"]["id"]))
        assert stored.status == "active"


def test_new_journal_requires_entry_date(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        draft = create_draft(
            client, csrf, content_type="journal", data={"title": "没日期"}
        )
        response = _commit(client, csrf, draft.json()["draft"]["id"], action="save")
        assert response.status_code == 422, response.text
        assert "data.entry_date" in response.json()["error"]["fields"]


def test_publish_journal_with_empty_alt_422(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        media = make_media(c1_session, owner)
        draft = create_draft(
            client,
            csrf,
            content_type="journal",
            data={
                "entry_date": "2026-10-18",
                "title": "带图手记",
                "content_md": "正文",
            },
            images=[{"media_id": str(media.id), "alt": ""}],
        )
        response = _commit(client, csrf, draft.json()["draft"]["id"], action="publish")
        assert response.status_code == 422, response.text
        assert "images" in response.json()["error"]["fields"]
        assert _count(c1_session, journal_entry_media) == 0


def test_update_published_journal_keeps_public_state(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        entry = make_journal_entry(
            c1_session, title="旧标题", content_md="旧正文", status="published", visibility="public"
        )
        original_published_at = entry.published_at
        version_before = entry.version
        draft = create_draft(
            client,
            csrf,
            content_type="journal",
            target_id=str(entry.id),
            # 只改标题：未提供的键保留正式内容原值
            data={"title": "新标题"},
        )
        response = _commit(
            client,
            csrf,
            draft.json()["draft"]["id"],
            action="update",
            expected=version_before,
        )
        assert response.status_code == 200, response.text
        assert response.json()["status"] == "published"
        assert response.json()["visibility"] == "public"
        c1_session.refresh(entry)
        assert entry.title == "新标题"
        assert entry.content_md == "旧正文", "草稿数据里没有的键必须保留正式内容原值"
        assert entry.status == "published"
        assert entry.visibility == "public"
        assert entry.published_at == original_published_at
        assert entry.version == version_before + 1


def test_journal_action_matrix_409(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        published = make_journal_entry(
            c1_session, status="published", visibility="public"
        )
        draft_target = make_journal_entry(c1_session, status="draft")

        draft = create_draft(
            client, csrf, content_type="journal", target_id=str(published.id)
        )
        save_published = _commit(
            client,
            csrf,
            draft.json()["draft"]["id"],
            action="save",
            expected=published.version,
        )
        assert save_published.status_code == 409, save_published.text
        assert "action" in save_published.json()["error"]["fields"]

        draft = create_draft(
            client, csrf, content_type="journal", target_id=str(draft_target.id)
        )
        update_draft = _commit(
            client,
            csrf,
            draft.json()["draft"]["id"],
            action="update",
            expected=draft_target.version,
        )
        assert update_draft.status_code == 409, update_draft.text


def test_journal_expected_target_version_checks(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        entry = make_journal_entry(c1_session, status="published", visibility="public")
        draft = create_draft(
            client, csrf, content_type="journal", target_id=str(entry.id)
        )
        missing = _commit(client, csrf, draft.json()["draft"]["id"], action="update")
        assert missing.status_code == 422, missing.text
        assert "expected_target_version" in missing.json()["error"]["fields"]

        stale = _commit(
            client,
            csrf,
            draft.json()["draft"]["id"],
            action="update",
            expected=entry.version + 5,
        )
        assert stale.status_code == 412, stale.text
        assert error_code(stale) == "VERSION_CONFLICT"
        c1_session.refresh(entry)
        assert entry.version == 1, "412 不得改动正式内容"


def test_journal_idempotent_replay(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        draft = create_draft(
            client,
            csrf,
            content_type="journal",
            data={
                "entry_date": "2026-10-18",
                "title": "幂等",
                "content_md": "正文",
            },
        )
        draft_id = draft.json()["draft"]["id"]
        key = str(uuid.uuid4())
        first = _commit(client, csrf, draft_id, action="publish", key=key)
        assert first.status_code == 200, first.text
        entries_before = _count(c1_session, JournalEntry)

        replay = commit_draft(
            client, csrf, draft_id, draft_version=1, action="publish", commit_key=key
        )
        assert replay.status_code == 200, replay.text
        assert replay.json()["idempotent_replay"] is True
        assert replay.json()["target_id"] == first.json()["target_id"]
        assert _count(c1_session, JournalEntry) == entries_before

        conflict = commit_draft(
            client,
            csrf,
            draft_id,
            draft_version=1,
            action="publish",
            commit_key=str(uuid.uuid4()),
        )
        assert conflict.status_code == 409, conflict.text


def test_journal_invalid_post_reference_rolls_back(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        entry = make_journal_entry(c1_session, title="原文", status="published", visibility="public")
        version_before = entry.version
        draft = create_draft(
            client,
            csrf,
            content_type="journal",
            target_id=str(entry.id),
            data={"post_id": str(uuid.uuid4())},
        )
        response = _commit(
            client,
            csrf,
            draft.json()["draft"]["id"],
            action="update",
            expected=version_before,
        )
        assert response.status_code == 422, response.text
        assert "post_id" in response.json()["error"]["fields"]
        c1_session.refresh(entry)
        assert entry.title == "原文"
        assert entry.version == version_before


def test_discard_journal_draft_does_not_touch_formal_entry(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        entry = make_journal_entry(c1_session, title="正式标题", status="published", visibility="public")
        version_before = entry.version
        draft = create_draft(
            client, csrf, content_type="journal", target_id=str(entry.id),
            data={"title": "草稿标题"},
        )
        response = discard_draft(client, csrf, draft.json()["draft"]["id"])
        assert response.status_code == 204, response.text
        c1_session.refresh(entry)
        assert entry.title == "正式标题"
        assert entry.version == version_before
        assert entry.status == "published"
