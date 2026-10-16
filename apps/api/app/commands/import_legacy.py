"""从旧站 `assets/js/posts.js` 幂等导入文章（06 §8、05 §3）。

用法：

    # 1) 先 dry-run：只输出差异与数量，不写数据库
    uv run --project apps/api python -m app.commands.import_legacy --dry-run

    # 2) 在独立测试库确认后再对目标库执行
    uv run --project apps/api python -m app.commands.import_legacy --apply

规则（06 §8 / 05 §3）：
  - 按 slug **幂等**：重复导入不复制文章；字段有变化才更新，并递增 `version`。
  - 旧日期转换成**迁移约定时区（UTC+8）的发布时间**，不悄悄改成导入当天；
    已存在文章的 `published_at` 永不被覆盖。
  - **不改已存在文章的状态**：撤回过的文章不会被重新导入悄悄重新发布。
  - Markdown 原文（`content`）原样进 `content_md`；旧站 `excerpt` 为空时从正文首段推导。
  - 封面按路径登记为媒体并迁入媒体存储（按 sha256 去重）；封面文件缺失只记问题，不中断导入。
  - 条目缺 slug / 日期不合法 / 正文缺失：作为 issue 报告并跳过，不静默丢数据。

不做的事：不执行迁移（迁移由集成负责人跑）、不写 `posts.js`、不做双写。
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.db import create_db_engine, create_session_factory, database_name_of, session_scope
from app.modules.auth.models import AdminUser
from app.modules.media import service as media_service
from app.modules.media.pipeline import ImageLimits
from app.modules.posts.models import EXCERPT_MAX_LENGTH, STATUS_PUBLISHED, Post
from app.modules.tags import service as tags_service
from app.modules.tags.models import post_tags

# 迁移约定时区：旧文章只有日期，导入时按其**本站展示时区**（Asia/Shanghai, UTC+8）
# 的当天 00:00 作为发布时间，并把这个规则写进交付单。
LEGACY_TIMEZONE = timezone(timedelta(hours=8), name="Asia/Shanghai")

DEFAULT_SOURCE = Path("assets/js/posts.js")
MARKER = "PL_POSTS"
EXCERPT_MAX_CODEPOINTS = 160

EXIT_OK = 0
EXIT_USAGE = 2


class LegacySourceError(ValueError):
    """posts.js 结构不符合预期（不是 JSON 数组 / 没有找到标记）。"""


@dataclass(frozen=True)
class LegacyPost:
    slug: str
    title: str
    display_date: date
    category: str
    content: str
    tags: tuple[str, ...]
    cover_path: str
    excerpt: str


@dataclass(frozen=True)
class LegacyIssue:
    slug: str
    reason: str


@dataclass
class ImportReport:
    dry_run: bool
    created: list[str] = field(default_factory=list)
    updated: list[str] = field(default_factory=list)
    unchanged: list[str] = field(default_factory=list)
    covers_ingested: list[str] = field(default_factory=list)
    issues: list[LegacyIssue] = field(default_factory=list)

    def as_dict(self) -> dict[str, object]:
        return {
            "dry_run": self.dry_run,
            "total": len(self.created) + len(self.updated) + len(self.unchanged) + len(self.issues),
            "created": len(self.created),
            "updated": len(self.updated),
            "unchanged": len(self.unchanged),
            "covers_ingested": len(self.covers_ingested),
            "issues": [{"slug": issue.slug, "reason": issue.reason} for issue in self.issues],
            "slugs": {
                "created": self.created,
                "updated": self.updated,
                "unchanged": self.unchanged,
            },
        }


def extract_array(text: str, *, marker: str = MARKER) -> str:
    """从 JS 源码里取出标记后面的第一个数组字面量（尊重字符串与转义）。"""
    index = text.find(marker)
    if index == -1:
        raise LegacySourceError(f"没有找到 {marker} 标记")
    start = text.find("[", index)
    if start == -1:
        raise LegacySourceError(f"{marker} 后面没有数组")
    depth = 0
    in_string = False
    escaped = False
    for position in range(start, len(text)):
        char = text[position]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "[":
            depth += 1
        elif char == "]":
            depth -= 1
            if depth == 0:
                return text[start : position + 1]
    raise LegacySourceError(f"{marker} 的数组没有闭合")


def derive_excerpt(content: str) -> str:
    """从 Markdown 正文推导摘要：第一个真正的段落，去掉标记与对话行。"""
    for raw_line in (content or "").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith(("#", ">", "```", "|", "!!!", "-", "*", "1.", "2.", "3.")):
            continue
        cleaned = (
            line.replace("**", "")
            .replace("__", "")
            .replace("`", "")
            .replace("*", "")
            .strip()
        )
        if not cleaned:
            continue
        return cleaned[:EXCERPT_MAX_CODEPOINTS]
    return ""


def legacy_published_at(display_date: date) -> datetime:
    """旧日期 → 发布时间（UTC+8 当天 00:00，转成 UTC 存储）。"""
    return datetime(
        display_date.year, display_date.month, display_date.day, tzinfo=LEGACY_TIMEZONE
    )


def parse_legacy_payload(payload: str) -> tuple[list[LegacyPost], list[LegacyIssue]]:
    """把 JSON 数组解析成 LegacyPost；结构问题按条目报告，不整体失败。"""
    data = json.loads(payload)
    if not isinstance(data, list):
        raise LegacySourceError("posts.js 的内容不是数组")

    posts: list[LegacyPost] = []
    issues: list[LegacyIssue] = []
    seen: set[str] = set()
    for entry in data:
        if not isinstance(entry, dict):
            issues.append(LegacyIssue(slug="?", reason="条目不是对象"))
            continue
        slug = str(entry.get("slug") or "").strip()
        if not slug:
            issues.append(LegacyIssue(slug="?", reason="条目缺少 slug"))
            continue
        if slug in seen:
            issues.append(LegacyIssue(slug=slug, reason="源文件里 slug 重复"))
            continue
        seen.add(slug)

        raw_date = str(entry.get("date") or "").strip()
        try:
            display_date = date.fromisoformat(raw_date[:10])
        except ValueError:
            issues.append(LegacyIssue(slug=slug, reason=f"日期不合法：{raw_date!r}"))
            continue

        content = entry.get("content")
        if not isinstance(content, str) or not content.strip():
            issues.append(LegacyIssue(slug=slug, reason="正文为空"))
            continue

        tags = entry.get("tags") or []
        if not isinstance(tags, list):
            issues.append(LegacyIssue(slug=slug, reason="tags 不是数组"))
            continue

        posts.append(
            LegacyPost(
                slug=slug,
                title=str(entry.get("title") or slug).strip(),
                display_date=display_date,
                category=str(entry.get("category") or "").strip(),
                content=content,
                tags=tuple(str(tag) for tag in tags),
                cover_path=str(entry.get("cover") or "").strip(),
                excerpt=str(entry.get("excerpt") or "").strip(),
            )
        )
    return posts, issues


def load_legacy_posts(source: Path) -> tuple[list[LegacyPost], list[LegacyIssue]]:
    text = source.read_text(encoding="utf-8")
    return parse_legacy_payload(extract_array(text))


def _sync_tags(session: Session, post: Post, names: tuple[str, ...]) -> None:
    """把文章的标签关系对齐到给定名字集合（完整替换）。"""
    session.execute(post_tags.delete().where(post_tags.c.post_id == post.id))
    tags = tags_service.get_or_create_tags(session, list(names))
    for tag in tags:
        session.execute(post_tags.insert().values(post_id=post.id, tag_id=tag.id))


def _pick_owner(session: Session, owner_username: str | None) -> AdminUser | None:
    if owner_username:
        return session.execute(
            select(AdminUser).where(AdminUser.username == owner_username)
        ).scalars().first()
    users = list(session.execute(select(AdminUser).order_by(AdminUser.created_at.asc())).scalars())
    return users[0] if len(users) == 1 else None


def import_posts(
    session: Session,
    posts: list[LegacyPost],
    *,
    dry_run: bool,
    repo_root: Path,
    media_root: Path | None = None,
    owner_username: str | None = None,
    limits: ImageLimits | None = None,
    max_concurrency: int = 2,
    issues: list[LegacyIssue] | None = None,
) -> ImportReport:
    """导入（或演练）一批旧文章。`dry_run=True` 时不做任何写入。"""
    report = ImportReport(dry_run=dry_run, issues=list(issues or []))
    owner = None
    if not dry_run and media_root is not None:
        owner = _pick_owner(session, owner_username)
        if owner is None:
            report.issues.append(
                LegacyIssue(slug="*", reason="无法确定封面媒体归属：请用 --owner-username 指定唯一站主")
            )
            media_root = None

    for item in posts:
        existing = session.execute(select(Post).where(Post.slug == item.slug)).scalars().first()
        excerpt = item.excerpt or derive_excerpt(item.content)
        if existing is None:
            if dry_run:
                report.created.append(item.slug)
                continue
            post = Post(
                slug=item.slug,
                title=item.title,
                excerpt=excerpt[:EXCERPT_MAX_LENGTH],
                content_md=item.content,
                category=item.category,
                display_date=item.display_date,
                status=STATUS_PUBLISHED,
                published_at=legacy_published_at(item.display_date),
            )
            session.add(post)
            session.flush()
            _sync_tags(session, post, item.tags)
            report.created.append(item.slug)
            existing = post
        else:
            changed = (
                existing.title != item.title
                or existing.category != item.category
                or existing.content_md != item.content
                or (existing.excerpt or "") != excerpt[:EXCERPT_MAX_LENGTH]
                or existing.display_date != item.display_date
            )
            if not changed:
                report.unchanged.append(item.slug)
            elif dry_run:
                report.updated.append(item.slug)
            else:
                existing.title = item.title
                existing.category = item.category
                existing.content_md = item.content
                existing.excerpt = excerpt[:EXCERPT_MAX_LENGTH]
                # 旧日期是展示语义的一部分：允许修正 display_date，但 published_at 只在创建时确定，
                # 避免「重新导入把发布时间改成今天」。
                existing.display_date = item.display_date
                existing.bump_version()
                _sync_tags(session, existing, item.tags)
                report.updated.append(item.slug)

        if dry_run or media_root is None or existing is None:
            continue
        if not item.cover_path or existing.cover_media_id is not None:
            continue

        cover_file = (repo_root / item.cover_path).resolve()
        if not cover_file.is_file():
            report.issues.append(LegacyIssue(slug=item.slug, reason=f"封面文件不存在：{item.cover_path}"))
            continue
        try:
            media = asyncio.run(
                media_service.ingest_file(
                    session,
                    root=media_root,
                    owner_id=owner.id,
                    source=cover_file,
                    limits=limits or ImageLimits(8 * 1024 * 1024, 40_000_000, 8192),
                    max_concurrency=max_concurrency,
                )
            )
        except Exception as exc:  # 单张封面失败不中断整批导入
            report.issues.append(LegacyIssue(slug=item.slug, reason=f"封面导入失败：{type(exc).__name__}"))
            continue
        existing.cover_media_id = media.id
        report.covers_ingested.append(item.slug)

    if not dry_run:
        session.commit()
    return report


def _default_source(repo_root: Path) -> Path:
    return repo_root / DEFAULT_SOURCE


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m app.commands.import_legacy",
        description="把旧站 posts.js 幂等导入 PostgreSQL（默认 dry-run）",
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="只输出差异，不写数据库（默认）")
    mode.add_argument("--apply", action="store_true", help="真正写入数据库")
    parser.add_argument("--source", type=Path, default=None, help="posts.js 路径（默认仓库内 assets/js/posts.js）")
    parser.add_argument("--repo-root", type=Path, default=Path.cwd(), help="用于解析封面相对路径")
    parser.add_argument("--media-root", type=Path, default=None, help="媒体根目录（不填则不导入封面）")
    parser.add_argument("--owner-username", default=None, help="封面媒体归属的站主用户名")
    parser.add_argument("--no-covers", action="store_true", help="跳过封面导入")
    parser.add_argument("--json", action="store_true", help="以 JSON 输出摘要")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    dry_run = not args.apply
    settings: Settings = get_settings()
    source = args.source or _default_source(args.repo_root)

    if not source.is_file():
        print(f"错误:找不到源文件 {DEFAULT_SOURCE}", file=sys.stderr)
        return EXIT_USAGE

    try:
        posts, issues = load_legacy_posts(source)
    except LegacySourceError as exc:
        print(f"错误:{exc}", file=sys.stderr)
        return EXIT_USAGE

    engine: Engine = create_db_engine(settings.database_url)
    factory = create_session_factory(engine)
    try:
        with session_scope(factory) as session:
            report = import_posts(
                session,
                posts,
                dry_run=dry_run,
                repo_root=args.repo_root,
                media_root=None if (args.no_covers or args.media_root is None) else args.media_root,
                owner_username=args.owner_username,
                limits=ImageLimits(
                    settings.media_max_bytes, settings.media_max_pixels, settings.media_max_side
                ),
                max_concurrency=settings.media_max_concurrency,
                issues=issues,
            )
    finally:
        engine.dispose()

    summary = report.as_dict()
    summary["database"] = database_name_of(settings.database_url)
    summary["source"] = str(DEFAULT_SOURCE if args.source is None else args.source.name)
    if args.json:
        print(json.dumps(summary, ensure_ascii=False))
    else:
        mode_label = "dry-run（未写入）" if report.dry_run else "已应用"
        print(
            f"[{mode_label}] 新建 {len(report.created)} / 更新 {len(report.updated)} / "
            f"未变 {len(report.unchanged)} / 封面 {len(report.covers_ingested)} / 问题 {len(report.issues)}"
        )
        for issue in report.issues:
            print(f"  ! {issue.slug}: {issue.reason}")
    return EXIT_OK


if __name__ == "__main__":  # pragma: no cover - 入口
    raise SystemExit(main())
