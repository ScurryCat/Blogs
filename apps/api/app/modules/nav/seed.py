"""首个专题的初始化命令：「怪盗据点工程」（04 §5）。

为什么是一个命令而不是一条迁移：专题是**内容**，不是 schema。内容初始化必须
可复现、幂等、并且**不杜撰**：这里只按 slug 引用**已经导入的真实文章**，
缺任何一篇就整体不写（退出码 2 并列出缺哪些），不创建半个专题、不编造文章。

用法（默认 dry-run，写库要显式 `--apply`，与 T01 的 `import_legacy` 同一约定）：

```sh
# 1) 先导入真实文章（T01 的命令，导入为已发布）
uv run --project apps/api python -m app.commands.import_legacy --apply --no-covers --repo-root .
# 2) 看这一步会做什么（不写库）
uv run --project apps/api python -m app.modules.nav.seed
# 3) 真正创建（草稿），或直接创建并发布
uv run --project apps/api python -m app.modules.nav.seed --apply
uv run --project apps/api python -m app.modules.nav.seed --apply --publish
```

集成前临时选项：`--create-tables` 用 `Base.metadata.create_all` 补齐 nav 三张表
（T00 生成迁移后不需要，也**不是**迁移替代品；生产路径永远是 alembic）。
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from typing import Sequence

from sqlalchemy import select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.core.db import create_db_engine, create_session_factory, session_scope
from app.core.text import normalize_for_match
from app.modules.nav import schemas, service
from app.modules.nav.models import Palace, PalaceAlias, PalacePost
from app.modules.posts.models import Post

DEFAULT_SLUG = "phantom-base"
DEFAULT_TITLE = "怪盗据点工程"
DEFAULT_SUMMARY = "把博客从静态页面改造成怪盗基地的全过程：设计、可访问性与素材来源。"

# 04 §5 给的建议顺序，全部来自现有公开文章（slug 与旧站 posts.js 一致）。
DEFAULT_POST_SLUGS: tuple[str, ...] = (
    "phantom-blog-launch",
    "css-p5-menu",
    "a11y-checklist",
    "assets-and-credits",
)

DEFAULT_KEYWORDS = {"name": "ScurryCat", "location": "个人博客", "cognition": "据点"}

# 04 §5 的别名建议：标准值与别名都按同一套规范化规则参与匹配。
DEFAULT_ALIASES: tuple[tuple[str, str], ...] = (
    ("name", "PHANTOM"),
    ("name", "怪盗手记"),
    ("location", "博客"),
    ("location", "Blog"),
    ("cognition", "基地"),
    ("cognition", "Hideout"),
)

NAV_TABLES = ("palaces", "palace_aliases", "palace_posts")


def ensure_nav_tables(engine: Engine) -> list[str]:
    """集成前的临时手段：补齐缺失的 nav 表，返回补了哪些。

    T00 生成迁移后这个函数就是空操作（表已存在时 `create_all` 不会改动它们）。
    """
    from sqlalchemy import inspect

    from app.core.db import Base
    from app.modules.nav import models as _models  # noqa: F401  导入即注册到 Base.metadata

    existing = set(inspect(engine).get_table_names())
    missing = [name for name in NAV_TABLES if name not in existing]
    if missing:
        Base.metadata.create_all(engine, tables=[Base.metadata.tables[name] for name in missing])
    return missing


def _load_posts(session: Session, slugs: Sequence[str]) -> tuple[list[Post], list[str]]:
    rows = session.execute(select(Post).where(Post.slug.in_(list(slugs)))).scalars().all()
    by_slug = {post.slug: post for post in rows}
    found = [by_slug[slug] for slug in slugs if slug in by_slug]
    missing = [slug for slug in slugs if slug not in by_slug]
    return found, missing


def seed(
    session: Session,
    *,
    slug: str = DEFAULT_SLUG,
    post_slugs: Sequence[str] = DEFAULT_POST_SLUGS,
    publish: bool = False,
    now: datetime | None = None,
) -> dict[str, object]:
    """创建 / 检查首个专题。返回一份可打印的报告（不打印任何密钥）。"""
    posts, missing = _load_posts(session, post_slugs)
    report: dict[str, object] = {
        "slug": slug,
        "post_slugs": list(post_slugs),
        "found_posts": [post.slug for post in posts],
        "missing_posts": missing,
        "status": None,
        "created": False,
        "published": False,
        "public_post_count": 0,
    }
    if missing:
        # 数据不足就整体不写：不创建半个专题，也不杜撰文章（任务卡明确要求）。
        report["status"] = "insufficient_data"
        return report

    palace = session.execute(select(Palace).where(Palace.slug == slug)).scalars().first()
    if palace is None:
        palace = service.create_palace(
            session,
            slug=slug,
            title=DEFAULT_TITLE,
            summary=DEFAULT_SUMMARY,
            keywords=schemas.PalaceKeywordsIn(**DEFAULT_KEYWORDS),
            aliases=[
                (field, value, normalize_for_match(value)) for field, value in DEFAULT_ALIASES
            ],
            post_ids=[post.id for post in posts],
            now=now,
        )
        report["created"] = True
        report["status"] = "created"
    else:
        # 已存在就**不动**：站主可能已经改过关键词与顺序，命令不做「顺便覆盖」。
        report["status"] = "already_exists"

    if publish and palace.status != "published":
        try:
            palace = service.publish_palace(session, palace, now=now)
            report["published"] = True
        except Exception as error:  # ApiError(409)：没有公开文章
            report["publish_error"] = str(error)

    session.refresh(palace)
    report["status"] = "published" if palace.status == "published" else report["status"]
    report["public_post_count"] = service.public_post_counts(session, [palace.id], now=now).get(
        palace.id, 0
    )
    report["palace_id"] = str(palace.id)
    report["palace_status"] = palace.status
    report["aliases"] = [
        {"field": alias.field, "value": alias.value, "normalized_value": alias.normalized_value}
        for alias in session.execute(
            select(PalaceAlias).where(PalaceAlias.palace_id == palace.id)
        ).scalars()
    ]
    report["relations"] = [
        {"post_id": str(row.post_id), "position": row.position}
        for row in session.execute(
            select(PalacePost).where(PalacePost.palace_id == palace.id).order_by(PalacePost.position)
        ).scalars()
    ]
    return report


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="初始化首个专题（怪盗据点工程）；默认 dry-run")
    parser.add_argument("--slug", default=DEFAULT_SLUG)
    parser.add_argument("--post", action="append", dest="posts", default=None,
                        help="覆盖文章 slug（可重复）；默认用 04 §5 的四篇")
    parser.add_argument("--apply", action="store_true", help="真正写数据库（默认只报告）")
    parser.add_argument("--publish", action="store_true", help="创建后发布（需要至少一篇公开文章）")
    parser.add_argument("--create-tables", action="store_true",
                        help="集成前临时补齐 nav 表（不是迁移替代品；本身就会写 DDL）")
    parser.add_argument("--json", action="store_true", help="以 JSON 输出")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    from app.core.config import get_settings

    settings = get_settings()
    engine = create_db_engine(settings.database_url)

    created_tables: list[str] = []
    if args.create_tables:
        # 这个开关本身就是「请写 DDL」，与 --apply（内容写入）分开。
        created_tables = ensure_nav_tables(engine)

    factory = create_session_factory(engine)
    report: dict[str, object] = {}
    try:
        if not args.apply:
            # dry-run 仍然要读库（判断文章在不在），但不写。
            with session_scope(factory) as session:
                posts, missing = _load_posts(session, args.posts or DEFAULT_POST_SLUGS)
                existing = session.execute(
                    select(Palace).where(Palace.slug == args.slug)
                ).scalars().first()
                report = {
                    "dry_run": True,
                    "slug": args.slug,
                    "found_posts": [post.slug for post in posts],
                    "missing_posts": missing,
                    "palace_exists": existing is not None,
                    "palace_status": existing.status if existing is not None else None,
                    "would_create": bool(not missing and existing is None),
                }
        else:
            with session_scope(factory) as session:
                report = seed(
                    session,
                    slug=args.slug,
                    post_slugs=tuple(args.posts or DEFAULT_POST_SLUGS),
                    publish=args.publish,
                )
                report["dry_run"] = False
        report["created_tables"] = created_tables
    finally:
        engine.dispose()

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2, default=str))
    else:
        for key, value in report.items():
            print(f"{key}: {value}")

    if report.get("missing_posts"):
        # 明确区分「数据不足」与「命令用错」：数据不足是退出码 2，调用方可以据此停下。
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
