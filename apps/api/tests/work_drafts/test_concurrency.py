"""并发与原子版本检查（契约 §9.3.1 / §9.3.6）。

必须证明（用**独立连接**并发，而不是先后调用）：

  1. 两个并发 PATCH 只有一个成功，后到者 412（`SELECT … FOR UPDATE` + If-Match）；
  2. 两个并发「创建或恢复」同一已有内容的草稿 → 只有一份 active 草稿；
  3. 同一 `commit_key` 的并发重试只产生一条正式内容，另一个回放；
  4. 同一草稿不同 `commit_key` 的并发提交，一个成功、另一个 409。
"""

from __future__ import annotations

import threading
import uuid

from sqlalchemy import func, select

from app.core.errors import ApiError
from app.modules.media.models import Media
from app.modules.moments.models import Moment, moment_media
from app.modules.work_drafts import service
from app.modules.work_drafts.models import STATUS_ACTIVE, WorkDraft
from tests.work_drafts.helpers import make_admin, make_media, make_moment


def _run_in_threads(functions: dict) -> dict:
    """在独立线程 / 独立 Session 里并发执行；返回 `{name: ("ok", value)|(status, exc)}`。"""
    results: dict = {}
    lock = threading.Lock()
    barrier = threading.Barrier(len(functions))

    def runner(name, function):
        barrier.wait()
        try:
            value = function()
            with lock:
                results[name] = ("ok", value)
        except ApiError as exc:
            with lock:
                results[name] = (exc.status_code, exc)
        except Exception as exc:  # pragma: no cover - 失败时方便定位
            with lock:
                results[name] = ("error", exc)

    threads = [
        threading.Thread(target=runner, args=(name, function))
        for name, function in functions.items()
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)
    assert all(not thread.is_alive() for thread in threads), "并发用例线程超时"
    return results


def _codes(results: dict) -> list:
    """把 ("ok", value) / (status, exc) 归一成 HTTP 状态码便于断言。"""
    return sorted(200 if result[0] == "ok" else result[0] for result in results.values())


def _setup_owner_and_draft(c1_session, c1_session_factory, *, owner_name: str = "owner"):
    """建站主 + 需要的数据并提交（并发线程会从独立连接读取）。"""
    owner = make_admin(c1_session, username=owner_name)
    media = make_media(c1_session, owner)
    c1_session.commit()
    draft, _reused = service.create_draft(
        c1_session,
        owner_id=owner.id,
        content_type="moment",
        target_id=None,
        data={"text": "初始草稿"},
        images=[{"media_id": media.id, "alt": "配图"}],
    )
    c1_session.commit()
    return owner, media, draft


# --- 1. 并发 PATCH：只有一个成功 -------------------------------------------


def test_concurrent_patch_only_one_succeeds(c1_session, c1_session_factory):
    owner, _media, draft = _setup_owner_and_draft(c1_session, c1_session_factory)
    draft_id = draft.id

    def make_patch(text: str):
        def run():
            session = c1_session_factory()
            try:
                return service.patch_draft(
                    session,
                    owner_id=owner.id,
                    draft_id=draft_id,
                    data={"text": text},
                    images=None,
                    if_match='"1"',
                )
            finally:
                session.close()

        return run

    results = _run_in_threads({"a": make_patch("并发 A"), "b": make_patch("并发 B")})
    assert _codes(results) == [200, 412], results

    session = c1_session_factory()
    try:
        stored = session.get(WorkDraft, draft_id)
        assert stored.draft_version == 2, "只允许一个 PATCH 成功，版本只 +1"
        assert stored.data["text"] in ("并发 A", "并发 B")
        reported = [result[1].data["text"] for result in results.values() if result[0] == "ok"]
        assert reported == [stored.data["text"]]
    finally:
        session.close()


# --- 2. 并发创建 / 恢复：只有一份 active 草稿 ------------------------------


def test_concurrent_create_for_same_target_reuses_one_draft(
    c1_session, c1_session_factory
):
    owner = make_admin(c1_session, username="owner")
    target = make_moment(c1_session, owner, text="已有内容", status="draft")
    c1_session.commit()

    def make_create():
        def run():
            session = c1_session_factory()
            try:
                return service.create_draft(
                    session,
                    owner_id=owner.id,
                    content_type="moment",
                    target_id=target.id,
                    data=None,
                    images=None,
                )
            finally:
                session.close()

        return run

    results = _run_in_threads({"a": make_create(), "b": make_create()})
    assert all(result[0] == "ok" for result in results.values()), results
    draft_ids = {result[1][0].id for result in results.values()}
    assert len(draft_ids) == 1, "并发创建同一已有内容的草稿必须复用同一份"

    session = c1_session_factory()
    try:
        count = session.execute(
            select(func.count())
            .select_from(WorkDraft)
            .where(
                WorkDraft.target_id == target.id,
                WorkDraft.status == STATUS_ACTIVE,
            )
        ).scalar_one()
        assert count == 1
    finally:
        session.close()


# --- 3. 同 commit_key 并发：只产生一条正式内容 -----------------------------


def test_concurrent_commit_same_key_creates_content_once(
    c1_session, c1_session_factory
):
    owner, _media, draft = _setup_owner_and_draft(c1_session, c1_session_factory)
    draft_id = draft.id
    commit_key = uuid.uuid4()

    def make_commit():
        def run():
            session = c1_session_factory()
            try:
                return service.commit_draft(
                    session,
                    owner_id=owner.id,
                    draft_id=draft_id,
                    action="publish",
                    expected_target_version=None,
                    commit_key=commit_key,
                    if_match='"1"',
                )
            finally:
                session.close()

        return run

    results = _run_in_threads({"a": make_commit(), "b": make_commit()})
    assert all(result[0] == "ok" for result in results.values()), results
    payloads = [result[1] for result in results.values()]
    assert len({payload.target_id for payload in payloads}) == 1
    assert sorted(payload.idempotent_replay for payload in payloads) == [False, True], (
        "一个真正提交，另一个必须是幂等回放"
    )

    session = c1_session_factory()
    try:
        assert session.execute(select(func.count()).select_from(Moment)).scalar_one() == 1
        assert (
            session.execute(select(func.count()).select_from(moment_media)).scalar_one()
            == 1
        )
        assert (
            session.execute(
                select(func.count())
                .select_from(WorkDraft)
                .where(WorkDraft.status == "committed")
            ).scalar_one()
            == 1
        )
    finally:
        session.close()


# --- 4. 不同 commit_key 并发：一个成功、另一个 409 --------------------------


def test_concurrent_commit_different_keys_one_wins(c1_session, c1_session_factory):
    owner, _media, draft = _setup_owner_and_draft(c1_session, c1_session_factory)
    draft_id = draft.id

    def make_commit(key: uuid.UUID):
        def run():
            session = c1_session_factory()
            try:
                return service.commit_draft(
                    session,
                    owner_id=owner.id,
                    draft_id=draft_id,
                    action="publish",
                    expected_target_version=None,
                    commit_key=key,
                    if_match='"1"',
                )
            finally:
                session.close()

        return run

    results = _run_in_threads(
        {"a": make_commit(uuid.uuid4()), "b": make_commit(uuid.uuid4())}
    )
    assert _codes(results) == [200, 409], results

    session = c1_session_factory()
    try:
        assert session.execute(select(func.count()).select_from(Moment)).scalar_one() == 1
        stored = session.get(WorkDraft, draft_id)
        assert stored.status == "committed"
    finally:
        session.close()
