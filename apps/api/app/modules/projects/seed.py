"""T06 的内容初始化命令：第一件真实作品 + （可选）真实相册。

**为什么是一个命令而不是迁移**：作品与相册是**内容**，不是 schema。内容初始化必须
可复现、幂等、并且**不杜撰事实**：

  - 第一件作品用**仓库里真实存在**的资料：这个 P5 博客本身（旧站 → Next.js / FastAPI /
    PostgreSQL 的迁移）、真实仓库地址（旧站配置里的 GitHub）、真实技术栈、以及可复现的
    成果（`node --test tests/*.test.cjs` 的 53 项通过、新站的真实测试数量）。命令**不会**
    生成奖项、星数、用户数或任何编造的统计数字。
  - 效果图用仓库里**已有**的旧站封面素材（`apps/web/public/assets/legacy/img/cover/*.jpg`，
    T02 从 `assets/img/cover/` 迁移而来），经 T01 的**真实媒体服务**处理成变体后入库 ——
    因此它是真的经过鉴权、解码、去元信息、生成变体的媒体记录，而不是伪造的 URL。
  - 相册**只在**用 `--photo-dir` 指向真实照片目录时才创建；没有真实照片就什么都不建，
    并如实报告「没有可用的真实照片」。**绝不**把游戏素材当成摄影作品，也不放置占位图。

用法（默认 dry-run，写库要显式 `--apply`，与 T01 / T04 同一约定）：

```sh
# 1) 真实文章（T04 已用这条命令导入；没有文章也不影响作品本身）
uv run --project apps/api python -m app.commands.import_legacy --apply --no-covers --repo-root ../..
# 2) 看这一步会做什么（不写库）
uv run --project apps/api python -m app.modules.projects.seed
# 3) 真正创建草稿，或直接创建并发布
uv run --project apps/api python -m app.modules.projects.seed --apply --publish
# 4) 关联 T04 的专题（可选；专题不存在就跳过并如实报告）
uv run --project apps/api python -m app.modules.projects.seed --apply --publish --palace-slug phantom-base
# 5) 有**真实照片**时才有相册
uv run --project apps/api python -m app.modules.projects.seed --apply --publish \
       --photo-dir /path/to/real/photos --album-slug tokyo-2026 --album-title "东京 2026"
```

集成前临时选项：`--create-tables` 用 `Base.metadata.create_all` 补齐 T06 的四张表
（T00 生成迁移后不需要，也**不是**迁移替代品；生产路径永远是 alembic）。
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import uuid
from pathlib import Path
from typing import Sequence

from sqlalchemy import select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import create_db_engine, create_session_factory, session_scope
from app.modules.gallery.models import Album
from app.modules.projects.models import Project

# --- 第一件作品：这个 P5 博客（全部来自仓库里的真实资料）--------------------

BLOG_SLUG = "p5-blog"
BLOG_TITLE = "这个 P5 博客"

BLOG_SUMMARY = (
    "把纯静态的 Persona 5 风格博客改造成 Next.js + FastAPI + PostgreSQL 的可发布站点："
    "长文、图文动态、专题殿堂、作品与照片墙共用一套媒体与权限。"
)

BLOG_ROLE = (
    "个人项目：从旧站（HTML / CSS / 原生 JS + window.PL 自制 PJAX）出发，"
    "独立完成前端迁移、后端模块划分、数据库模型与媒体管线、以及真实浏览器验收。"
)

BLOG_PROBLEM = (
    "旧站是纯静态页面：文章写死在 assets/js/posts.js 里，发布需要手改代码；"
    "没有草稿 / 撤回 / 版本控制，图片没有权限概念，撤下一张图只能删文件；"
    "音乐与过场效果散落在每个页面里，换页就断。"
)

BLOG_TRADEOFFS = (
    "1) 先做同源 API 与单一站主，不引入 Redis、Celery、微服务或向量库 —— "
    "个人站点的瓶颈是内容维护，不是并发。\n"
    "2) 图片只存一套文件 + 多个变体，同一张图可以被动态、相册、作品同时引用；"
    "撤回一处引用不等于删文件（否则管理的直觉与访客看到的结果会对不上）。\n"
    "3) 公开数据首版全部 no-store，不做 CDN 长缓存 —— 先保证「撤回后立刻不可读」。\n"
    "4) 保留旧站与它的测试作为对照基线，不在迁移中途改写旧实现。"
)

BLOG_OUTCOMES = (
    "旧站基线：node --test tests/*.test.cjs 53 项通过，0 失败（迁移期间保持通过，作为回归闸门）。\n"
    "新站从零建立了真实 PostgreSQL 迁移链、统一错误信封与不透明游标分页；"
    "动态、专题、作品与相册各自有独立模块与真实数据库约束。\n"
    "本机验证方式全部可复现：uv run pytest、npm run typecheck / lint / test / build、"
    "以及 Playwright 真实浏览器脚本 —— 命令与通过数量写在 docs/agent-deliveries/ 的交付单里。"
)

BLOG_TECH = (
    "Next.js",
    "React",
    "TypeScript",
    "FastAPI",
    "SQLAlchemy",
    "Alembic",
    "PostgreSQL",
    "Pillow",
    "Playwright",
)

BLOG_LINKS = (
    {"kind": "repo", "label": "GitHub：ScurryCat/Blogs", "url": "https://github.com/ScurryCat/Blogs"},
)

# 效果图：仓库里真实存在的旧站封面素材（T02 已迁移到 apps/web/public/assets/legacy/）。
# 顺序即图片顺序：position 0 是**作品封面**（`kind=cover`），其余是详情附图。
# 用 `desk.jpg` 做封面（书桌 / 工作区）而不是 `launch.jpg`（人物海报）：它更能说明
# 「这是一个自己搭起来的站点」，也不至于让作品页看起来像一张角色壁纸。
BLOG_COVER_CANDIDATES = (
    "apps/web/public/assets/legacy/img/cover/desk.jpg",
    "apps/web/public/assets/legacy/img/cover/css-menu.jpg",
)

BLOG_COVER_ALT = "旧站素材：工作区与页面"
BLOG_COVER_CAPTION = "作品封面：这个博客使用的旧站素材（书桌 / 工作区）"

T06_TABLES = ("projects", "project_media", "albums", "album_media")

# 真实照片目录里接受的后缀（与 T01 媒体服务的输入类型一致）。
PHOTO_SUFFIXES = (".jpg", ".jpeg", ".png", ".webp")


def ensure_t06_tables(engine: Engine) -> list[str]:
    """集成前的临时手段：补齐缺失的 T06 表，返回补了哪些。

    T00 生成迁移后这个函数就是空操作（表已存在时 `create_all` 不会改动它们）。

    为什么用一张**独立**的 MetaData 而不是 `Base.metadata`：T06 的表引用
    `admin_users` / `media` / `palaces`，而 `palaces` 属 T04。如果本机还没跑过
    `alembic upgrade head`，直接在 `Base.metadata` 上 `create_all` 会因为
    「找不到 palaces 表」而报 `NoReferencedTableError`（本机实测）。
    替身只在内存里参与编译 DDL，不会创建、也不会改动任何真实表。
    """
    from sqlalchemy import Column, MetaData, Table, Uuid, inspect

    # 把 T06 的模型挂进 Base.metadata 还不够：`--create-tables` 需要 FK 目标表
    # （admin_users / media / palaces）也**已被导入**，否则编译 DDL 时会
    # `NoReferencedTableError`（本机实测，逐个补导入才暴露下一个）。
    # 因此这里显式导入全部已登记的模型模块 —— 与生产启动路径做的事情一致。
    from app import model_registry
    from app.core.db import NAMING_CONVENTION

    model_registry.import_all_models()
    from app.modules.gallery import models as _gallery_models  # noqa: F401
    from app.modules.projects import models as _project_models  # noqa: F401

    existing = set(inspect(engine).get_table_names())
    missing = [name for name in T06_TABLES if name not in existing]
    if not missing:
        return []

    from app.core.db import Base

    local = MetaData(naming_convention=NAMING_CONVENTION)
    # FK 目标表：**已存在**的就从 Base.metadata 复制一份声明（这样外键能解析到
    # 真正的列），不存在的才用 `id` 替身。替身与复制品都只在内存里参与编译 DDL。
    for name in ("admin_users", "media", "palaces"):
        if name in existing:
            if name in Base.metadata.tables:
                Base.metadata.tables[name].to_metadata(local)
            continue
        Table(name, local, Column("id", Uuid(as_uuid=True), primary_key=True))
    for name in missing:
        Base.metadata.tables[name].to_metadata(local)
    local.create_all(engine, tables=[local.tables[name] for name in missing])
    return missing


def repo_root_default() -> Path:
    """默认仓库根：本文件在 apps/api/app/modules/projects/seed.py。"""
    return Path(__file__).resolve().parents[5]


def find_cover_files(repo_root: Path) -> list[Path]:
    """按候选顺序找出**存在**的封面素材；一个都没有就返回空列表。"""
    return [path for path in (repo_root / name for name in BLOG_COVER_CANDIDATES) if path.is_file()]


def list_photo_files(photo_dir: Path) -> list[Path]:
    """真实照片目录里可用的图片文件（排序保证可复现；不含子目录）。"""
    if not photo_dir.is_dir():
        return []
    return sorted(
        path
        for path in photo_dir.iterdir()
        if path.is_file() and path.suffix.lower() in PHOTO_SUFFIXES
    )


async def _import_media(session: Session, *, root: Path, owner_id: uuid.UUID, data: bytes):
    """走 T01 的**真实**媒体服务导入一张图（解码 / 去元信息 / 生成变体 / 落盘）。

    刻意不直接 INSERT 一条 media 行：那样会得到一个「有记录但没有可用变体」的假媒体，
    公开页面会显示坏图 —— 这正是 T01 交付单里警告过的做法。
    """
    from app.modules.media import service as media_service
    from app.modules.media.pipeline import ImageLimits
    from app.modules.media.router import limits_from_settings

    settings = get_settings()
    limits: ImageLimits = limits_from_settings(settings)
    return await media_service.create_media(
        session,
        root=root,
        owner_id=owner_id,
        data=data,
        limits=limits,
        max_concurrency=settings.media_max_concurrency,
    )


def _site_owner_id(session: Session) -> uuid.UUID | None:
    from app.modules.auth.models import AdminUser

    user = session.execute(select(AdminUser).order_by(AdminUser.created_at.asc())).scalars().first()
    return user.id if user is not None else None


async def seed(
    session: Session,
    *,
    repo_root: Path,
    owner_id: uuid.UUID,
    publish: bool,
    palace_slug: str | None,
    photo_dir: Path | None,
    album_slug: str,
    album_title: str,
    album_kind: str,
) -> dict[str, object]:
    """幂等初始化：作品已存在就只报告，不覆盖站主的改动。"""
    from app.modules.projects import service as projects_service

    media_root = get_settings().media_root_path
    report: dict[str, object] = {"project": {}, "album": {}, "media": [], "warnings": []}

    existing = session.execute(select(Project).where(Project.slug == BLOG_SLUG)).scalars().first()
    if existing is not None:
        report["project"] = {
            "slug": BLOG_SLUG,
            "created": False,
            "status": existing.status,
            "note": "已存在同名作品，未做任何修改（幂等，不覆盖站主改动）",
        }
    else:
        cover_files = find_cover_files(repo_root)
        images: list[dict] = []
        for index, path in enumerate(cover_files):
            media = await _import_media(
                session, root=media_root, owner_id=owner_id, data=path.read_bytes()
            )
            report["media"].append({"path": str(path), "media_id": str(media.id), "variant": "cover" if index == 0 else "detail"})
            images.append(
                {
                    "media_id": media.id,
                    "position": index,
                    "kind": "cover" if index == 0 else "detail",
                    "alt": f"{BLOG_COVER_ALT}（{path.name}）",
                    "caption": BLOG_COVER_CAPTION if index == 0 else f"旧站素材：{path.name}",
                    "taken_on": None,
                }
            )
        if not cover_files:
            report["warnings"].append(
                "仓库里找不到任何旧站封面素材 —— 作品会在没有效果图的情况下创建，"
                "并且**不能发布**（发布门槛要求至少一张 ready 图片）。"
            )

        palace_id = None
        if palace_slug:
            from app.modules.nav.models import Palace

            palace = session.execute(
                select(Palace).where(Palace.slug == palace_slug)
            ).scalars().first()
            if palace is None:
                report["warnings"].append(
                    f"专题 {palace_slug!r} 不存在 —— 跳过关联（不编造专题）"
                )
            else:
                palace_id = palace.id

        project = projects_service.create_project(
            session,
            slug=BLOG_SLUG,
            title=BLOG_TITLE,
            summary=BLOG_SUMMARY,
            role=BLOG_ROLE,
            problem=BLOG_PROBLEM,
            tradeoffs=BLOG_TRADEOFFS,
            outcomes=BLOG_OUTCOMES,
            tech_stack=list(BLOG_TECH),
            links=list(BLOG_LINKS),
            maintenance="maintained",
            palace_id=palace_id,
            images=images,
        )
        if publish:
            # 发布走的是与 HTTP 管理端点**同一条**服务路径，因此必须给 `If-Match`：
            # 新建后的版本是 1（05 §7 的乐观锁对所有发布动作一视同仁，
            # 命令行不是绕过它的后门）。
            projects_service.publish_project(session, project, if_match=f'"{project.version}"')
        report["project"] = {
            "slug": project.slug,
            "created": True,
            "status": project.status,
            "version": project.version,
            "images": len(images),
        }

    # --- 相册：只有给了真实照片目录才创建 ---------------------------------
    if photo_dir is None:
        report["album"] = {
            "created": False,
            "note": "没有传入 --photo-dir：不创建相册。仓库里没有真实的摄影素材，"
            "本命令不会用游戏素材或占位图冒充照片。",
        }
        return report

    photo_files = list_photo_files(photo_dir)
    if not photo_files:
        report["album"] = {
            "created": False,
            "note": f"{photo_dir} 里没有可用的图片文件（{'/'.join(PHOTO_SUFFIXES)}）",
        }
        report["warnings"].append("给了 --photo-dir 但目录里没有图片 —— 不创建空相册")
        return report

    existing_album = session.execute(
        select(Album).where(Album.slug == album_slug)
    ).scalars().first()
    if existing_album is not None:
        report["album"] = {
            "slug": album_slug,
            "created": False,
            "status": existing_album.status,
            "note": "已存在同名相册，未做任何修改（幂等）",
        }
        return report

    from app.modules.gallery import service as gallery_service

    photos: list[dict] = []
    for index, path in enumerate(photo_files):
        media = await _import_media(
            session, root=media_root, owner_id=owner_id, data=path.read_bytes()
        )
        report["media"].append({"path": str(path), "media_id": str(media.id), "variant": "photo"})
        photos.append(
            {
                "media_id": media.id,
                "position": index,
                # 替代文本用**文件名**：它是真实信息，不是编出来的描述。
                "alt": f"照片：{path.name}",
                "caption": "",
                # 不编造拍摄时间：EXIF 已在上传时被清除，这里留空。
                "taken_on": None,
            }
        )
    album = gallery_service.create_album(
        session,
        slug=album_slug,
        title=album_title,
        description="由 seed 命令从本机真实照片目录导入。",
        kind=album_kind,
        photos=photos,
    )
    if publish:
        gallery_service.publish_album(session, album, if_match=f'"{album.version}"')
    report["album"] = {
        "slug": album.slug,
        "created": True,
        "status": album.status,
        "version": album.version,
        "photos": len(photos),
    }
    return report


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="初始化第一件真实作品（这个 P5 博客）；默认 dry-run"
    )
    parser.add_argument("--repo-root", default=None, help="仓库根（默认自动推断）")
    parser.add_argument("--apply", action="store_true", help="真正写数据库（默认只报告）")
    parser.add_argument("--publish", action="store_true", help="创建后发布（需要至少一张 ready 图片）")
    parser.add_argument("--palace-slug", default=None, help="可选：关联 T04 的专题 slug")
    parser.add_argument("--photo-dir", default=None, help="可选：真实照片目录（有才会建相册）")
    parser.add_argument("--album-slug", default="memory-gallery")
    parser.add_argument("--album-title", default="记忆画廊")
    parser.add_argument("--album-kind", default="photo", choices=("photo", "screenshot", "other"))
    parser.add_argument(
        "--create-tables",
        action="store_true",
        help="集成前临时补齐 T06 四张表（不是迁移替代品；本身就会写 DDL）",
    )
    parser.add_argument("--json", action="store_true", help="以 JSON 输出")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    repo_root = Path(args.repo_root).resolve() if args.repo_root else repo_root_default()
    photo_dir = Path(args.photo_dir).expanduser().resolve() if args.photo_dir else None

    settings = get_settings()
    engine = create_db_engine(settings.database_url)

    created_tables: list[str] = []
    if args.create_tables:
        created_tables = ensure_t06_tables(engine)

    factory = create_session_factory(engine)
    report: dict[str, object] = {}
    exit_code = 0
    try:
        if not args.apply:
            with session_scope(factory) as session:
                cover_files = find_cover_files(repo_root)
                existing = session.execute(
                    select(Project).where(Project.slug == BLOG_SLUG)
                ).scalars().first()
                owner = _site_owner_id(session)
                report = {
                    "dry_run": True,
                    "project_exists": existing is not None,
                    "project_status": existing.status if existing is not None else None,
                    "cover_files": [str(path) for path in cover_files],
                    "site_owner": str(owner) if owner else None,
                    "photo_dir": str(photo_dir) if photo_dir else None,
                    "photo_files": [str(path) for path in list_photo_files(photo_dir)]
                    if photo_dir
                    else [],
                    "would_create_project": existing is None,
                }
                if owner is None:
                    report["warnings"] = [
                        "数据库里没有站主账号 —— 媒体记录需要 owner_id，"
                        "请先建站主（见 T01 的交付单）或使用 --create-tables 之外的初始化流程。"
                    ]
                    exit_code = 2
        else:
            with session_scope(factory) as session:
                owner = _site_owner_id(session)
                if owner is None:
                    report = {
                        "error": "数据库里没有站主账号，无法导入媒体（media.owner_id 非空）",
                    }
                    exit_code = 2
                else:
                    report = asyncio.run(
                        seed(
                            session,
                            repo_root=repo_root,
                            owner_id=owner,
                            publish=args.publish,
                            palace_slug=args.palace_slug,
                            photo_dir=photo_dir,
                            album_slug=args.album_slug,
                            album_title=args.album_title,
                            album_kind=args.album_kind,
                        )
                    )
                    report["dry_run"] = False
        report["created_tables"] = created_tables
        report["repo_root"] = str(repo_root)
    finally:
        engine.dispose()

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2, default=str))
    else:
        for key, value in report.items():
            print(f"{key}: {value}")
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
