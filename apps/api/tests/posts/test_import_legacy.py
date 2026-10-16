"""旧站 posts.js 导入测试（06 §8、T01 任务卡「必须有的测试」第 8 行）。

断言：
  - 真的是仓库里那份 posts.js（不是测试自造的样例）：8 篇、slug / 日期 / 分类 / 标签 / 正文。
  - **dry-run 不写数据库**，先看差异。
  - 重复导入幂等：不复制 slug、不改旧日期、Markdown 原文逐字节保留。
  - 已存在文章的发布时间不会被改成「导入当天」。
  - 封面导入为媒体引用，并按 sha256 去重。
  - 源条目缺 slug / 日期不合法 → 作为 issue 报告并跳过，不静默丢数据、不整体崩溃。
  - CLI 的 dry-run / apply 行为与退出码。

注意：`import_posts(dry_run=False)` 会**自己提交**（它是迁移命令，不是请求），
所以这些用例结束时会清理自己导入的行，避免污染临时库里其他用例的断言。
"""

from __future__ import annotations

import json
from datetime import date, datetime, timezone
from pathlib import Path

import pytest
from sqlalchemy import delete, func, select

from app.commands import import_legacy
from app.core.config import get_settings
from app.modules.media.models import Media
from app.modules.posts.models import STATUS_PUBLISHED, Post
from app.modules.tags.models import Tag, post_tags
from tests.auth.helpers import make_admin

REPO_ROOT = Path(__file__).resolve().parents[4]  # …/Blogs
SOURCE = REPO_ROOT / "assets" / "js" / "posts.js"
LEGACY_SLUGS = (
    "phantom-blog-launch",
    "css-p5-menu",
    "tokyo-ten-days",
    "desk-setup-2026",
    "p5r-platinum",
    "snow-country-notes",
    "a11y-checklist",
    "assets-and-credits",
)


@pytest.fixture(autouse=True)
def cleanup_legacy_rows(t01_session):
    """CLI / service 会提交数据，事务回滚夹具管不到，所以要显式清理。"""
    yield
    t01_session.execute(delete(post_tags).where(post_tags.c.post_id.in_(
        select(Post.id).where(Post.slug.in_(LEGACY_SLUGS))
    )))
    t01_session.execute(delete(Post).where(Post.slug.in_(LEGACY_SLUGS)))
    t01_session.execute(delete(Tag).where(Tag.name.like("t01-import-%")))
    t01_session.commit()


def test_parses_the_real_legacy_source():
    assert SOURCE.is_file(), f"缺少旧站数据源：{SOURCE}"
    posts, issues = import_legacy.load_legacy_posts(SOURCE)
    assert issues == []
    assert len(posts) == 8
    by_slug = {post.slug: post for post in posts}
    assert set(by_slug) == set(LEGACY_SLUGS)

    launch = by_slug["phantom-blog-launch"]
    assert launch.title == "我把博客改造成了怪盗的基地"
    assert launch.display_date == date(2026, 10, 13)
    assert launch.category == "LOG"
    assert launch.tags == ("随笔", "设计")
    assert launch.cover_path == "assets/img/cover/launch.jpg"
    # Markdown 原文保留：对话语法、提示框、代码块都在
    assert "> **摩尔加纳**：" in launch.content
    assert "!!! **给想抄的人**" in launch.content
    assert "```css" in launch.content

    # 日期范围（最早 / 最新）与源文件一致
    assert min(post.display_date for post in posts) == date(2026, 1, 20)
    assert max(post.display_date for post in posts) == date(2026, 10, 13)


def test_display_date_conversion_uses_documented_timezone():
    """旧日期 → UTC+8 当天 00:00 的发布时间，不是导入当天、也不是 UTC 当天。"""
    converted = import_legacy.legacy_published_at(date(2026, 10, 13))
    assert converted.utcoffset().total_seconds() == 8 * 3600
    assert converted.astimezone(timezone.utc) == datetime(2026, 10, 12, 16, 0, tzinfo=timezone.utc)


def test_dry_run_reports_without_writing(t01_session):
    posts, issues = import_legacy.load_legacy_posts(SOURCE)
    report = import_legacy.import_posts(
        t01_session, posts, dry_run=True, repo_root=REPO_ROOT, issues=issues
    )
    assert report.dry_run is True
    assert sorted(report.created) == sorted(LEGACY_SLUGS)
    assert report.updated == [] and report.covers_ingested == []
    count = t01_session.execute(
        select(func.count()).select_from(Post).where(Post.slug.in_(LEGACY_SLUGS))
    ).scalar()
    assert count == 0, "dry-run 绝不能写数据库"


def test_apply_is_idempotent_and_preserves_original_markdown(t01_session):
    posts, issues = import_legacy.load_legacy_posts(SOURCE)
    first = import_legacy.import_posts(
        t01_session, posts, dry_run=False, repo_root=REPO_ROOT, issues=issues
    )
    assert sorted(first.created) == sorted(LEGACY_SLUGS)
    assert first.updated == []

    original = {post.slug: post for post in posts}
    for slug, source_post in original.items():
        row = t01_session.execute(select(Post).where(Post.slug == slug)).scalars().one()
        assert row.content_md == source_post.content, "Markdown 原文必须逐字节保留"
        assert row.status == STATUS_PUBLISHED
        assert row.display_date == source_post.display_date
        assert row.published_at.astimezone(import_legacy.LEGACY_TIMEZONE).date() == source_post.display_date
        assert row.version == 1
        assert row.excerpt, "旧站 excerpt 为空时必须从正文推导摘要"

    # 第二次导入：不复制、不更新
    second = import_legacy.import_posts(
        t01_session, posts, dry_run=False, repo_root=REPO_ROOT, issues=[]
    )
    assert second.created == [] and second.updated == []
    assert sorted(second.unchanged) == sorted(LEGACY_SLUGS)
    count = t01_session.execute(
        select(func.count()).select_from(Post).where(Post.slug.in_(LEGACY_SLUGS))
    ).scalar()
    assert count == 8, "重复导入复制了文章"

    # 发布时间没有被「重新导入」改成今天
    oldest = t01_session.execute(
        select(Post).where(Post.slug == "assets-and-credits")
    ).scalars().one()
    assert oldest.published_at.astimezone(import_legacy.LEGACY_TIMEZONE).date() == date(2026, 1, 20)


def test_reimport_updates_changed_fields_and_bumps_version(t01_session):
    posts, _ = import_legacy.load_legacy_posts(SOURCE)
    import_legacy.import_posts(t01_session, posts, dry_run=False, repo_root=REPO_ROOT)
    row = t01_session.execute(
        select(Post).where(Post.slug == "css-p5-menu")
    ).scalars().one()
    row.title = "被本地改过的标题"
    t01_session.commit()

    text = SOURCE.read_text(encoding="utf-8")
    changed = text.replace("用纯 CSS 复刻 P5 的斜切菜单", "用纯 CSS 复刻 P5 的斜切菜单（修订）")
    modified_posts, _ = import_legacy.parse_legacy_payload(import_legacy.extract_array(changed))
    report = import_legacy.import_posts(
        t01_session, modified_posts, dry_run=False, repo_root=REPO_ROOT
    )
    assert "css-p5-menu" in report.updated
    refreshed = t01_session.execute(
        select(Post).where(Post.slug == "css-p5-menu")
    ).scalars().one()
    assert refreshed.title == "用纯 CSS 复刻 P5 的斜切菜单（修订）"
    assert refreshed.version == 2, "内容变更必须递增 version"


def test_cover_import_creates_media_reference_and_dedupes(t01_session, t01_settings):
    owner = make_admin(t01_session, username="import-owner")
    posts, _ = import_legacy.load_legacy_posts(SOURCE)
    report = import_legacy.import_posts(
        t01_session,
        posts,
        dry_run=False,
        repo_root=REPO_ROOT,
        media_root=t01_settings.media_root_path,
        owner_username=owner.username,
    )
    assert sorted(report.covers_ingested) == sorted(LEGACY_SLUGS)
    assert report.issues == []

    rows = list(
        t01_session.execute(select(Post).where(Post.slug.in_(LEGACY_SLUGS))).scalars()
    )
    assert all(row.cover_media_id is not None for row in rows)
    media_count = t01_session.execute(select(func.count()).select_from(Media)).scalar()
    assert media_count == len(LEGACY_SLUGS)

    # 封面文件真的写进了媒体目录，且是 ready
    media = t01_session.execute(select(Media).limit(1)).scalars().one()
    assert media.status == "ready"
    assert (t01_settings.media_root_path / media.storage_key).is_file()
    assert media.variants, "封面必须生成固定变体"

    # 再次导入：不重复登记媒体
    import_legacy.import_posts(
        t01_session,
        posts,
        dry_run=False,
        repo_root=REPO_ROOT,
        media_root=t01_settings.media_root_path,
        owner_username=owner.username,
    )
    assert t01_session.execute(select(func.count()).select_from(Media)).scalar() == len(LEGACY_SLUGS)


def test_entry_without_slug_and_bad_date_are_reported_not_imported(t01_session):
    payload = json.dumps(
        [
            {"title": "没有 slug", "date": "2026-01-01", "content": "正文"},
            {"slug": "bad-date-post", "title": "坏日期", "date": "not-a-date", "content": "正文"},
            {"slug": "empty-content", "title": "空正文", "date": "2026-01-01", "content": "  "},
            {"slug": "fine-post", "title": "正常", "date": "2026-01-02", "content": "正文"},
        ],
        ensure_ascii=False,
    )
    posts, issues = import_legacy.parse_legacy_payload(payload)
    assert [post.slug for post in posts] == ["fine-post"]
    reasons = {issue.slug: issue.reason for issue in issues}
    assert "缺少 slug" in reasons["?"]
    assert "日期不合法" in reasons["bad-date-post"]
    assert "正文为空" in reasons["empty-content"]

    report = import_legacy.import_posts(
        t01_session, posts, dry_run=False, repo_root=REPO_ROOT, issues=issues
    )
    assert report.created == ["fine-post"]
    assert len(report.issues) == 3
    assert t01_session.execute(
        select(func.count()).select_from(Post).where(Post.slug == "bad-date-post")
    ).scalar() == 0
    t01_session.execute(delete(Post).where(Post.slug == "fine-post"))
    t01_session.commit()


def test_source_without_marker_raises_clear_error():
    with pytest.raises(import_legacy.LegacySourceError):
        import_legacy.extract_array("const somethingElse = [];")
    with pytest.raises(import_legacy.LegacySourceError):
        import_legacy.extract_array("window.PL_POSTS = [1, 2")


def test_cli_dry_run_then_apply(t01_database_url, t01_session, monkeypatch, capsys):
    monkeypatch.setenv("DATABASE_URL", t01_database_url)
    monkeypatch.setenv("APP_ENV", "test")
    get_settings.cache_clear()

    try:
        dry_code = import_legacy.main(["--dry-run", "--json", "--repo-root", str(REPO_ROOT)])
        dry_out = capsys.readouterr().out
        assert dry_code == 0, dry_out
        dry_summary = json.loads(dry_out)
        assert dry_summary["dry_run"] is True
        assert dry_summary["created"] == 8
        assert t01_session.execute(
            select(func.count()).select_from(Post).where(Post.slug.in_(LEGACY_SLUGS))
        ).scalar() == 0

        apply_code = import_legacy.main(["--apply", "--json", "--repo-root", str(REPO_ROOT)])
        apply_out = capsys.readouterr().out
        assert apply_code == 0, apply_out
        apply_summary = json.loads(apply_out)
        assert apply_summary["dry_run"] is False
        assert apply_summary["created"] == 8
        assert apply_summary["database"] == "pl_test_t01"

        again_code = import_legacy.main(["--apply", "--json", "--repo-root", str(REPO_ROOT)])
        again_summary = json.loads(capsys.readouterr().out)
        assert again_code == 0
        assert again_summary["created"] == 0 and again_summary["unchanged"] == 8

        missing = import_legacy.main(["--dry-run", "--source", str(REPO_ROOT / "nope.js")])
        assert missing == import_legacy.EXIT_USAGE
        assert "找不到源文件" in capsys.readouterr().err
    finally:
        get_settings.cache_clear()
