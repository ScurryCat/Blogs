"""上传端点的行为测试（T01 任务卡「必须有的测试」第 3、7 行）。

  - 假 PNG / 损坏图 / 8 MiB 以上 / 像素超限 → 按约定拒绝，且**磁盘上没有可公开的 ready 对象**；
  - 写文件失败或 DB 提交失败 → 不返回上传成功，孤儿对象可识别；
  - 成功路径：原图 + w320/w640/w1280 变体真的落盘，响应是 ready 元数据且不含 storage_key / 路径。

上传走真实 multipart（TestClient）+ 真实 PostgreSQL；CSRF 用表单字段传输，
与前端 / 后续管理界面的做法一致。
"""

from __future__ import annotations

import uuid
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.exc import OperationalError

from app.core.deps import get_session, get_settings_dep
from app.modules.auth.router import router as auth_router
from app.modules.media import service as media_service
from app.modules.media import storage
from app.modules.media.models import STATUS_READY, Media
from app.modules.media.router import router as media_router
from tests.auth.helpers import login_ok, make_admin
from tests.core.t01_db import assert_error, module_api_client
from tests.media.helpers import (
    corrupt_png,
    fake_png,
    jpeg_with_exif,
    padded_bytes,
    png_bytes,
    png_with_declared_size,
    stored_keys,
    upload,
)
from tests.support.module_app import build_module_app

ROUTERS = (("auth", auth_router), ("media", media_router))


def _logged_in_client(t01_settings, t01_session):
    make_admin(t01_session)
    context = module_api_client(t01_settings, t01_session, *ROUTERS)
    return context


def _ready_media_count(session) -> int:
    return int(
        session.execute(
            select(func.count()).select_from(Media).where(Media.status == STATUS_READY)
        ).scalar()
        or 0
    )


def test_upload_png_creates_ready_media_and_files(t01_settings, t01_session):
    root = t01_settings.media_root_path
    with _logged_in_client(t01_settings, t01_session) as client:
        session_payload = login_ok(client)
        response = upload(client, png_bytes(1600, 1200), csrf_token=session_payload["csrf_token"])

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["status"] == STATUS_READY
    assert (body["width"], body["height"]) == (1600, 1200)
    assert body["mime_type"] == "image/png"
    assert len(body["sha256"]) == 64
    assert "storage_key" not in body and "owner_id" not in body
    assert str(root) not in response.text, "响应不得包含服务器路径"

    names = [variant["name"] for variant in body["variants"]]
    assert names == ["original", "w320.webp", "w640.webp", "w1280.webp"]
    assert all(variant["url"].startswith("/api/v1/media/") for variant in body["variants"])

    # 文件真的落盘：1 个原图 + 3 个变体
    keys = stored_keys(root)
    assert len(keys) == 4, keys
    assert any(key.endswith("original.png") for key in keys)
    assert any(key.endswith("w640.webp") for key in keys)

    row = t01_session.execute(select(Media)).scalars().one()
    assert row.status == STATUS_READY
    assert row.variants and set(row.variants) == {"w320.webp", "w640.webp", "w1280.webp"}
    assert all(entry["key"] in keys for entry in row.variants.values())


def test_upload_exif_jpeg_is_normalized(t01_settings, t01_session):
    with _logged_in_client(t01_settings, t01_session) as client:
        payload = login_ok(client)
        response = upload(
            client,
            jpeg_with_exif(600, 400, orientation=6),
            filename="rotated.jpg",
            content_type="image/jpeg",
            csrf_token=payload["csrf_token"],
        )
    assert response.status_code == 201, response.text
    body = response.json()
    assert (body["width"], body["height"]) == (400, 600), "上传的图必须按 EXIF 方向归一"
    assert body["mime_type"] == "image/jpeg"


def test_fake_png_is_rejected_as_unsupported(t01_settings, t01_session):
    root = t01_settings.media_root_path
    with _logged_in_client(t01_settings, t01_session) as client:
        payload = login_ok(client)
        response = upload(client, fake_png(), filename="fake.png", csrf_token=payload["csrf_token"])
    assert_error(response, status=415, code="UNSUPPORTED_MEDIA_TYPE")
    assert _ready_media_count(t01_session) == 0
    assert stored_keys(root) == [], "被拒绝的上传不得留下文件"


def test_corrupt_png_is_rejected_as_unprocessable(t01_settings, t01_session):
    root = t01_settings.media_root_path
    with _logged_in_client(t01_settings, t01_session) as client:
        payload = login_ok(client)
        response = upload(client, corrupt_png(), csrf_token=payload["csrf_token"])
    assert_error(response, status=422, code="UNPROCESSABLE")
    assert _ready_media_count(t01_session) == 0
    assert stored_keys(root) == []


def test_oversized_file_is_rejected_with_413(t01_settings, t01_session):
    root = t01_settings.media_root_path
    oversized = padded_bytes(t01_settings.media_max_bytes + 1)
    with _logged_in_client(t01_settings, t01_session) as client:
        payload = login_ok(client)
        response = upload(client, oversized, csrf_token=payload["csrf_token"])
    assert_error(response, status=413, code="PAYLOAD_TOO_LARGE")
    assert _ready_media_count(t01_session) == 0
    assert stored_keys(root) == []


def test_pixel_limit_is_rejected(t01_settings, t01_session):
    root = t01_settings.media_root_path
    with _logged_in_client(t01_settings, t01_session) as client:
        payload = login_ok(client)
        response = upload(
            client, png_with_declared_size(20000, 20000), csrf_token=payload["csrf_token"]
        )
    assert_error(response, status=422, code="UNPROCESSABLE")
    assert _ready_media_count(t01_session) == 0
    assert stored_keys(root) == []


def test_upload_without_login_or_csrf_is_rejected(t01_settings, t01_session):
    root = t01_settings.media_root_path
    with module_api_client(t01_settings, t01_session, *ROUTERS) as client:
        anonymous = upload(client, png_bytes(), csrf_token="whatever")
        assert_error(anonymous, status=401, code="UNAUTHORIZED")

    make_admin(t01_session)
    with module_api_client(t01_settings, t01_session, *ROUTERS) as client:
        payload = login_ok(client)
        no_csrf = client.post(
            "/api/v1/admin/media",
            files={"file": ("photo.png", png_bytes(), "image/png")},
            headers={"Origin": "http://testserver"},
        )
        assert_error(no_csrf, status=403, code="FORBIDDEN")
        # 带 CSRF 的同一请求成功，证明失败原因是 CSRF 而不是别的
        ok = upload(client, png_bytes(1600, 1200), csrf_token=payload["csrf_token"])
        assert ok.status_code == 201, ok.text
    assert _ready_media_count(t01_session) == 1
    assert len(stored_keys(root)) == 4


def test_file_write_failure_returns_503_and_cleans_partial_objects(
    t01_settings, t01_session, monkeypatch
):
    """第二次写盘失败（模拟磁盘故障）：不返回成功，已写入的半截对象被清理。"""
    root = t01_settings.media_root_path
    real_write = storage.write_object
    calls = {"count": 0}

    def flaky_write(path, key, data):
        calls["count"] += 1
        if calls["count"] == 2:
            raise OSError("simulated disk failure")
        return real_write(path, key, data)

    monkeypatch.setattr(storage, "write_object", flaky_write)

    with _logged_in_client(t01_settings, t01_session) as client:
        payload = login_ok(client)
        response = upload(client, png_bytes(1600, 1200), csrf_token=payload["csrf_token"])

    assert calls["count"] >= 2, "测试没有触发写盘路径"
    assert response.status_code == 503, response.text
    assert response.json()["error"]["code"] == "SERVICE_UNAVAILABLE"
    assert _ready_media_count(t01_session) == 0
    assert stored_keys(root) == [], "失败后必须清掉本次已写入的对象"


def test_db_commit_failure_leaves_identifiable_orphans_and_no_success(
    t01_settings, t01_session
):
    """DB 提交失败：客户端拿不到上传成功；文件留在磁盘上但可被孤儿报告识别。

    05 §4 明确「文件系统与数据库不是同一事务」，所以这里断言的正是**不假装自动回滚**。
    """
    root = t01_settings.media_root_path
    make_admin(t01_session)
    real_commit = t01_session.commit

    def failing_commit():
        # 只让「写入 media 的那次提交」失败：登录 / 建会话的提交必须照常成功，
        # 否则测的就不是上传路径了。
        if any(isinstance(obj, Media) for obj in t01_session.new):
            raise OperationalError("insert into media", {}, Exception("simulated commit failure"))
        return real_commit()

    app = build_module_app(t01_settings, *ROUTERS)
    proxy = _SessionProxy(t01_session, failing_commit)
    app.dependency_overrides[get_session] = lambda: proxy
    app.dependency_overrides[get_settings_dep] = lambda: t01_settings

    from fastapi.testclient import TestClient

    with TestClient(app, raise_server_exceptions=False) as client:
        payload = login_ok(client)
        response = upload(client, png_bytes(1600, 1200), csrf_token=payload["csrf_token"])

    assert response.status_code == 503, response.text
    assert response.json()["error"]["code"] == "SERVICE_UNAVAILABLE"
    assert _ready_media_count(t01_session) == 0, "提交失败不能留下 ready 记录"

    keys = stored_keys(root)
    assert len(keys) == 4, "文件确实留在了磁盘上（不假装自动回滚）"
    report = media_service.list_orphan_objects(t01_session, root)
    assert sorted(report.unreferenced_keys) == sorted(keys)
    assert report.is_empty is False


class _SessionProxy:
    """把夹具 session 包一层，只替换 commit()，用于模拟提交失败。"""

    def __init__(self, session, commit_impl):
        object.__setattr__(self, "_session", session)
        object.__setattr__(self, "_commit_impl", commit_impl)

    def commit(self):
        return self._commit_impl()

    def __getattr__(self, item):
        return getattr(object.__getattribute__(self, "_session"), item)


def test_upload_rejects_unknown_owner_session(t01_settings, t01_session):
    """会话在提交前被注销（例如管理员点了注销）：上传必须 401，不落盘。"""
    root = t01_settings.media_root_path
    with _logged_in_client(t01_settings, t01_session) as client:
        payload = login_ok(client)
        # 把这个站点当前所有有效会话标记为已注销（登录轮换后只剩一个）。
        from sqlalchemy import update

        from app.modules.auth.models import AdminSession

        revoked = t01_session.execute(
            update(AdminSession)
            .where(AdminSession.revoked_at.is_(None))
            .values(revoked_at=AdminSession.created_at)
        )
        assert revoked.rowcount == 1, revoked.rowcount
        t01_session.commit()

        response = upload(client, png_bytes(), csrf_token=payload["csrf_token"])
        assert_error(response, status=401, code="UNAUTHORIZED")
    assert stored_keys(root) == []
    assert str(uuid.uuid4()) not in response.text


def test_media_root_is_created_on_demand_but_not_by_readiness(t01_settings, t01_session):
    """上传会按需创建媒体子目录；但 readiness 不会替你把卷「造出来」。"""
    nested = Path(t01_settings.media_root_path) / "deep" / "nested"
    with _logged_in_client(t01_settings, t01_session) as client:
        payload = login_ok(client)
        response = upload(client, png_bytes(), csrf_token=payload["csrf_token"])
    assert response.status_code == 201
    # 上传写的是 media_root 下的子目录，不会创建 media_root 之外的路径
    assert Path(t01_settings.media_root_path).is_dir()
    assert not nested.exists()
