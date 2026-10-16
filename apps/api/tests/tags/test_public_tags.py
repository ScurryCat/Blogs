"""公开标签测试（05 §6、T01 任务卡「必须有的测试」第 1 行）。

要点：
  - 只返回**有公开内容**的标签：仅草稿 / 已撤回 / 未来发布的文章用到的标签不出现；
  - 标签来源是注册表：**没有登记任何来源时不返回任何标签**（默认不贡献），
    登记后才参与 —— 与媒体公开引用同一套默认拒绝的思路；
  - 规范化 slug：全角 / 大小写 / 前后空白不会造出重复标签；
  - 重复登记同一来源立即报错（避免静默改变公开可见集合）。
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.core.text import normalize_tag_slug
from app.modules.posts import tags_source
from app.modules.tags import service as tags_service
from app.modules.tags.models import Tag
from app.modules.tags.router import router as tags_router
from tests.core.t01_db import module_api_client
from tests.posts.helpers import make_draft, make_post, unique_category, unique_tag

ROUTERS = (("tags", tags_router),)

UTC = timezone.utc


def test_tags_default_to_empty_without_registered_sources(t01_settings, t01_session):
    """没有登记来源 → 空列表（而不是「把所有标签都列出来」）。"""
    category = unique_category()
    tag = unique_tag("默认")
    make_post(t01_session, category=category, tags=(tag,))
    tags_service.reset_public_tag_sources()

    with module_api_client(t01_settings, t01_session, *ROUTERS) as client:
        response = client.get("/api/v1/tags")
    assert response.status_code == 200
    assert response.json() == []
    assert response.headers["cache-control"] == "no-store"


def test_only_tags_with_public_posts_are_listed(t01_settings, t01_session):
    tags_service.reset_public_tag_sources()
    tags_source.register()

    category = unique_category()
    public_tag = unique_tag("公开")
    draft_tag = unique_tag("草稿")
    retracted_tag = unique_tag("撤回")
    future_tag = unique_tag("未来")
    deleted_tag = unique_tag("删除")

    make_post(t01_session, category=category, tags=(public_tag,))
    make_draft(t01_session, category=category, tags=(draft_tag,))
    make_post(
        t01_session,
        category=category,
        tags=(future_tag,),
        published_at=datetime.now(UTC) + timedelta(days=7),
    )
    retracted = make_post(t01_session, category=category, tags=(retracted_tag,))
    retracted.status = "draft"
    t01_session.commit()
    deleted = make_post(t01_session, category=category, tags=(deleted_tag,))
    deleted.deleted_at = datetime.now(UTC)
    t01_session.commit()

    with module_api_client(t01_settings, t01_session, *ROUTERS) as client:
        payload = client.get("/api/v1/tags").json()

    names = {item["name"] for item in payload}
    assert public_tag in names
    for hidden in (draft_tag, retracted_tag, future_tag, deleted_tag):
        assert hidden not in names, f"非公开内容使用的标签泄漏了：{hidden}"
    assert set(payload[0]) == {"id", "slug", "name"}
    # 排序稳定（按规范化 slug 升序）
    slugs = [item["slug"] for item in payload]
    assert slugs == sorted(slugs)


def test_slug_normalization_merges_equivalent_names(t01_session):
    tags_service.reset_public_tag_sources()
    base = unique_tag("前端")
    created = tags_service.get_or_create_tags(
        t01_session, [base, f"  {base.upper()}  ", base]
    )
    assert len({tag.id for tag in created}) == 1, "等价写法必须落到同一个标签"
    tag = created[0]
    assert tag.slug == normalize_tag_slug(base)
    assert tag.name == base, "展示名保留第一次写入的原始写法"

    again = tags_service.get_or_create_tags(t01_session, [base.lower()])
    assert again[0].id == tag.id


def test_tag_sources_are_merged(t01_settings, t01_session):
    """多个来源取并集：文章域 + 模拟的动态域。"""
    tags_service.reset_public_tag_sources()
    tags_source.register()

    post_tag = unique_tag("文章")
    moment_tag = unique_tag("动态")
    make_post(t01_session, category=unique_category(), tags=(post_tag,))
    extra = tags_service.get_or_create_tags(t01_session, [moment_tag])[0]
    t01_session.flush()

    tags_service.register_public_tag_source("moments", lambda session: {extra.id})
    try:
        with module_api_client(t01_settings, t01_session, *ROUTERS) as client:
            names = {item["name"] for item in client.get("/api/v1/tags").json()}
        assert post_tag in names and moment_tag in names
    finally:
        tags_service.reset_public_tag_sources()
        tags_source.register()


def test_duplicate_source_registration_is_rejected(t01_session):
    tags_service.reset_public_tag_sources()
    tags_source.register()
    with pytest.raises(tags_service.DuplicateTagSourceError):
        tags_source.register()
    with pytest.raises(ValueError):
        tags_service.register_public_tag_source("  ", lambda session: set())


def test_tags_have_no_management_fields(t01_settings, t01_session):
    tags_service.reset_public_tag_sources()
    tags_source.register()
    tag = unique_tag("形状")
    make_post(t01_session, category=unique_category(), tags=(tag,))
    with module_api_client(t01_settings, t01_session, *ROUTERS) as client:
        raw = client.get("/api/v1/tags").text
    for leaked in ("deleted_at", "created_at", "version", "status", "post_count"):
        assert leaked not in raw
    assert t01_session.query(Tag).filter(Tag.slug == normalize_tag_slug(tag)).count() == 1
