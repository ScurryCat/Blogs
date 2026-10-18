"""工作草稿 CRUD 与草稿期校验（契约 §3.2 / §3.3 / §9.3.5）。

覆盖：创建 / 恢复（复用）、列表分页与 content_type 过滤、详情 ETag、
PATCH 的 428/412、未知字段 422、data 浅合并、images 省略 / 整组替换、
草稿允许空 alt / 0 张图、媒体必须属于站主且 ready、丢弃语义、匿名 401、越权 404。
"""

from __future__ import annotations

import uuid

from sqlalchemy import func, select

from app.modules.media.models import Media
from app.modules.work_drafts.models import WorkDraft, work_draft_media
from tests.core.t01_db import assert_error, error_code
from tests.work_drafts.helpers import (
    DEFAULT_PASSWORD,
    WORK_DRAFTS_PATH,
    admin_client,
    commit_draft,
    create_draft,
    discard_draft,
    make_media,
    make_moment,
    patch_draft,
)


def _assert_ok(response, expected_status: int = 200):
    assert response.status_code == expected_status, response.text
    return response.json()


# --- 创建 / 复用 ------------------------------------------------------------


def test_create_new_moment_draft_201_with_etag(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        response = client.post(
            WORK_DRAFTS_PATH,
            json={
                "content_type": "moment",
                "data": {"text": "草稿正文", "tags": ["标签A"]},
            },
            headers={"Origin": "http://testserver", "X-CSRF-Token": csrf},
        )
        assert response.status_code == 201, response.text
        payload = response.json()
        assert payload["reused"] is False
        draft = payload["draft"]
        assert draft["id"]
        assert draft["content_type"] == "moment"
        assert draft["target_id"] is None
        assert draft["target_version"] is None
        assert draft["draft_version"] == 1
        assert draft["status"] == "active"
        assert draft["data"] == {"text": "草稿正文", "tags": ["标签A"]}
        assert draft["images"] == []
        assert draft["summary"] == "草稿正文"
        assert response.headers["ETag"] == '"1"'
        assert response.headers["Cache-Control"] == "private, no-store"


def test_create_for_existing_target_reuses_active_draft(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        moment = make_moment(c1_session, owner, text="正式内容", status="published")
        first = create_draft(
            client, csrf, content_type="moment", target_id=str(moment.id)
        )
        assert first.status_code == 201, first.text
        draft_id = first.json()["draft"]["id"]
        assert first.json()["draft"]["target_version"] == moment.version

        # 再次打开：复用同一份 active 草稿，不覆盖已有内容。
        second = create_draft(
            client,
            csrf,
            content_type="moment",
            target_id=str(moment.id),
            data={"text": "不该覆盖"},
        )
        assert second.status_code == 200, second.text
        assert second.json()["reused"] is True
        assert second.json()["draft"]["id"] == draft_id
        assert second.json()["draft"]["data"] == {}
        assert second.json()["draft"]["summary"] == "空白动态"

        count = c1_session.execute(
            select(func.count())
            .select_from(WorkDraft)
            .where(WorkDraft.target_id == moment.id)
        ).scalar_one()
        assert count == 1, "同一站主编辑同一已有内容必须复用一份有效草稿"


def test_new_content_can_have_multiple_drafts(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        first = create_draft(client, csrf, content_type="moment")
        second = create_draft(client, csrf, content_type="moment")
        assert first.status_code == 201 and second.status_code == 201
        assert first.json()["draft"]["id"] != second.json()["draft"]["id"]


def test_create_for_missing_or_foreign_target_404(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        missing = create_draft(
            client, csrf, content_type="moment", target_id=str(uuid.uuid4())
        )
        assert missing.status_code == 404, missing.text
        assert error_code(missing) == "NOT_FOUND"


def test_client_cannot_set_server_fields_422(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        for field, value in (
            ("target_version", 3),
            ("status", "committed"),
            ("draft_version", 9),
            ("commit_key", str(uuid.uuid4())),
        ):
            response = client.post(
                WORK_DRAFTS_PATH,
                json={"content_type": "moment", field: value},
                headers={"Origin": "http://testserver", "X-CSRF-Token": csrf},
            )
            assert response.status_code == 422, (field, response.text)
            assert error_code(response) == "UNPROCESSABLE"


# --- 列表 -------------------------------------------------------------------


def test_list_active_drafts_pagination_and_filter(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        moment_ids = []
        for index in range(3):
            response = create_draft(
                client, csrf, content_type="moment", data={"text": f"动态草稿 {index}"}
            )
            assert response.status_code == 201
            moment_ids.append(response.json()["draft"]["id"])
        journal = create_draft(
            client,
            csrf,
            content_type="journal",
            data={"entry_date": "2026-10-18", "title": "手记草稿"},
        )
        assert journal.status_code == 201

        first_page = client.get(
            WORK_DRAFTS_PATH, params={"limit": 2}, cookies=client.cookies
        )
        assert first_page.status_code == 200, first_page.text
        payload = first_page.json()
        assert len(payload["items"]) == 2
        assert payload["next_cursor"]
        # updated_at 倒序：最后创建的排最前
        assert payload["items"][0]["id"] == journal.json()["draft"]["id"]

        second_page = client.get(
            WORK_DRAFTS_PATH,
            params={"limit": 2, "cursor": payload["next_cursor"]},
            cookies=client.cookies,
        )
        assert second_page.status_code == 200, second_page.text
        items = second_page.json()["items"]
        assert len(items) == 2
        assert second_page.json()["next_cursor"] is None
        seen = {item["id"] for item in payload["items"]} | {item["id"] for item in items}
        assert seen == set(moment_ids) | {journal.json()["draft"]["id"]}

        filtered = client.get(
            WORK_DRAFTS_PATH, params={"content_type": "journal"}, cookies=client.cookies
        )
        assert filtered.status_code == 200, filtered.text
        assert [item["content_type"] for item in filtered.json()["items"]] == ["journal"]

        invalid = client.get(
            WORK_DRAFTS_PATH, params={"content_type": "article"}, cookies=client.cookies
        )
        assert invalid.status_code == 422, invalid.text
        assert error_code(invalid) == "UNPROCESSABLE"


def test_list_excludes_discarded_and_committed(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        discarded = create_draft(client, csrf, content_type="moment", data={"text": "丢弃"})
        commit_target = create_draft(
            client, csrf, content_type="moment", data={"text": "提交"}
        )
        keep = create_draft(client, csrf, content_type="moment", data={"text": "保留"})

        discard_draft(client, csrf, discarded.json()["draft"]["id"])
        commit_draft(
            client,
            csrf,
            commit_target.json()["draft"]["id"],
            draft_version=1,
            action="save",
        )

        listed = client.get(WORK_DRAFTS_PATH, cookies=client.cookies)
        ids = {item["id"] for item in listed.json()["items"]}
        assert ids == {keep.json()["draft"]["id"]}


def test_other_owner_cannot_see_drafts(c1_settings, c1_session):
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
        listed = client_two.get(WORK_DRAFTS_PATH, cookies=client_two.cookies)
        assert listed.status_code == 200
        assert listed.json()["items"] == []
        detail = client_two.get(f"{WORK_DRAFTS_PATH}/{draft_id}", cookies=client_two.cookies)
        assert detail.status_code == 404, detail.text
        assert error_code(detail) == "NOT_FOUND"


# --- 详情 -------------------------------------------------------------------


def test_get_detail_returns_etag_and_404_for_unknown(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        created = create_draft(client, csrf, content_type="journal", data={"title": "手记"})
        draft_id = created.json()["draft"]["id"]

        detail = client.get(f"{WORK_DRAFTS_PATH}/{draft_id}", cookies=client.cookies)
        assert detail.status_code == 200, detail.text
        assert detail.headers["ETag"] == '"1"'
        assert detail.json()["id"] == draft_id

        missing = client.get(f"{WORK_DRAFTS_PATH}/{uuid.uuid4()}", cookies=client.cookies)
        assert missing.status_code == 404
        not_uuid = client.get(f"{WORK_DRAFTS_PATH}/not-a-uuid", cookies=client.cookies)
        assert not_uuid.status_code == 404


# --- PATCH ------------------------------------------------------------------


def test_patch_requires_if_match_428(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        draft = create_draft(client, csrf, content_type="moment")
        draft_id = draft.json()["draft"]["id"]
        response = client.patch(
            f"{WORK_DRAFTS_PATH}/{draft_id}",
            json={"data": {"text": "新内容"}},
            headers={"Origin": "http://testserver", "X-CSRF-Token": csrf},
        )
        assert response.status_code == 428, response.text
        assert error_code(response) == "PRECONDITION_REQUIRED"


def test_patch_version_conflict_412_leaves_draft_unchanged(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        draft = create_draft(
            client, csrf, content_type="moment", data={"text": "第一版"}
        )
        draft_id = draft.json()["draft"]["id"]
        ok = patch_draft(
            client, csrf, draft_id, draft_version=1, data={"text": "第二版"}
        )
        assert ok.status_code == 200, ok.text
        assert ok.json()["draft_version"] == 2
        assert ok.headers["ETag"] == '"2"'

        stale = patch_draft(
            client, csrf, draft_id, draft_version=1, data={"text": "旧客户端覆盖"}
        )
        assert stale.status_code == 412, stale.text
        assert error_code(stale) == "VERSION_CONFLICT"

        detail = client.get(f"{WORK_DRAFTS_PATH}/{draft_id}", cookies=client.cookies)
        assert detail.json()["data"]["text"] == "第二版"
        assert detail.json()["draft_version"] == 2


def test_patch_data_merge_and_unknown_keys_422(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        draft = create_draft(
            client,
            csrf,
            content_type="moment",
            data={"text": "原文", "tags": ["甲"]},
        )
        draft_id = draft.json()["draft"]["id"]

        # data 只合并出现的键：tags 保留，text 更新。
        merged = patch_draft(client, csrf, draft_id, draft_version=1, data={"text": "新文"})
        assert merged.status_code == 200, merged.text
        assert merged.json()["data"] == {"text": "新文", "tags": ["甲"]}

        unknown = patch_draft(
            client, csrf, draft_id, draft_version=2, data={"unknown_key": 1}
        )
        assert unknown.status_code == 422, unknown.text
        assert "data.unknown_key" in unknown.json()["error"]["fields"]

        # 请求体未知字段也拒绝
        body_unknown = client.patch(
            f"{WORK_DRAFTS_PATH}/{draft_id}",
            json={"summay": "拼写错误", "data": {"text": "x"}},
            headers={"Origin": "http://testserver", "X-CSRF-Token": csrf},
        )
        assert body_unknown.status_code == 422, body_unknown.text


def test_patch_images_replace_and_omit_semantics(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        media_a = make_media(c1_session, owner)
        media_b = make_media(c1_session, owner)
        draft = create_draft(
            client,
            csrf,
            content_type="moment",
            images=[
                {"media_id": str(media_a.id), "alt": ""},
                {"media_id": str(media_b.id), "alt": "第二张"},
            ],
        )
        assert draft.status_code == 201, draft.text
        draft_id = draft.json()["draft"]["id"]
        assert [image["position"] for image in draft.json()["draft"]["images"]] == [0, 1]
        assert draft.json()["draft"]["images"][0]["alt"] == ""

        # 省略 images：只改文字，不动图片关系
        text_only = patch_draft(client, csrf, draft_id, draft_version=1, data={"text": "改字"})
        assert text_only.status_code == 200, text_only.text
        assert len(text_only.json()["images"]) == 2

        # 给出数组（含 []）= 整组替换
        replaced = patch_draft(
            client,
            csrf,
            draft_id,
            draft_version=2,
            images=[{"media_id": str(media_b.id), "alt": "唯一一张"}],
        )
        assert replaced.status_code == 200, replaced.text
        assert [image["media_id"] for image in replaced.json()["images"]] == [str(media_b.id)]

        cleared = patch_draft(client, csrf, draft_id, draft_version=3, images=[])
        assert cleared.status_code == 200, cleared.text
        assert cleared.json()["images"] == []
        remaining = c1_session.execute(
            select(func.count())
            .select_from(work_draft_media)
            .where(work_draft_media.c.draft_id == uuid.UUID(draft_id))
        ).scalar_one()
        assert remaining == 0


def test_patch_rejects_foreign_or_unready_media_422(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        from tests.work_drafts.helpers import make_admin as _make_admin  # noqa: F401

        other_owner = _make_admin(c1_session, username="media-other-owner")
        foreign = make_media(c1_session, other_owner)
        unready = make_media(c1_session, owner, status="processing")
        draft = create_draft(client, csrf, content_type="moment")
        draft_id = draft.json()["draft"]["id"]

        foreign_response = patch_draft(
            client,
            csrf,
            draft_id,
            draft_version=1,
            images=[{"media_id": str(foreign.id), "alt": "别人的图"}],
        )
        assert foreign_response.status_code == 422, foreign_response.text
        assert "images" in foreign_response.json()["error"]["fields"]

        unready_response = patch_draft(
            client,
            csrf,
            draft_id,
            draft_version=1,
            images=[{"media_id": str(unready.id), "alt": "没处理完"}],
        )
        assert unready_response.status_code == 422, unready_response.text


def test_patch_after_commit_or_discard_conflict_409(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        committed = create_draft(client, csrf, content_type="moment", data={"text": "提交"})
        commit_draft(
            client,
            csrf,
            committed.json()["draft"]["id"],
            draft_version=1,
            action="save",
        )
        patch_committed = patch_draft(
            client,
            csrf,
            committed.json()["draft"]["id"],
            draft_version=1,
            data={"text": "x"},
        )
        assert patch_committed.status_code == 409, patch_committed.text
        assert error_code(patch_committed) == "CONFLICT"

        discarded = create_draft(client, csrf, content_type="moment")
        discard_draft(client, csrf, discarded.json()["draft"]["id"])
        patch_discarded = patch_draft(
            client, csrf, discarded.json()["draft"]["id"], draft_version=1, data={"text": "x"}
        )
        assert patch_discarded.status_code == 409, patch_discarded.text


# --- 丢弃 -------------------------------------------------------------------


def test_discard_removes_relations_keeps_media_and_is_single_shot(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        media = make_media(c1_session, owner)
        draft = create_draft(
            client, csrf, content_type="moment", images=[{"media_id": str(media.id), "alt": ""}]
        )
        draft_id = draft.json()["draft"]["id"]

        response = discard_draft(client, csrf, draft_id)
        assert response.status_code == 204, response.text

        row = c1_session.get(WorkDraft, uuid.UUID(draft_id))
        assert row is not None, "丢弃保留草稿行便于审计"
        assert row.status == "discarded"
        relations = c1_session.execute(
            select(func.count())
            .select_from(work_draft_media)
            .where(work_draft_media.c.draft_id == row.id)
        ).scalar_one()
        assert relations == 0, "丢弃只解除媒体保留关系"
        assert c1_session.get(Media, media.id) is not None, "丢弃不删除媒体行 / 文件"

        again = discard_draft(client, csrf, draft_id)
        assert again.status_code == 409, again.text
        detail = client.get(f"{WORK_DRAFTS_PATH}/{draft_id}", cookies=client.cookies)
        assert detail.status_code == 200
        assert detail.json()["status"] == "discarded"


# --- 匿名 / 越权 ------------------------------------------------------------


def test_anonymous_access_is_401(c1_public_client):
    assert c1_public_client.get(WORK_DRAFTS_PATH).status_code == 401
    assert c1_public_client.get(f"{WORK_DRAFTS_PATH}/{uuid.uuid4()}").status_code == 401
    assert (
        c1_public_client.patch(
            f"{WORK_DRAFTS_PATH}/{uuid.uuid4()}", json={"data": {"text": "x"}}
        ).status_code
        == 401
    )
    assert (
        c1_public_client.post(
            f"{WORK_DRAFTS_PATH}/{uuid.uuid4()}/commit",
            json={"action": "save", "commit_key": str(uuid.uuid4())},
        ).status_code
        == 401
    )
    assert c1_public_client.delete(f"{WORK_DRAFTS_PATH}/{uuid.uuid4()}").status_code == 401


def test_error_envelope_has_request_id(c1_settings, c1_session):
    with admin_client(c1_settings, c1_session) as (client, owner, csrf):
        response = client.patch(
            f"{WORK_DRAFTS_PATH}/{uuid.uuid4()}",
            json={"data": {"text": "x"}},
            headers={"Origin": "http://testserver", "X-CSRF-Token": csrf, "If-Match": '"1"'},
        )
        payload = assert_error(response, status=404, code="NOT_FOUND")
        assert payload["request_id"]
