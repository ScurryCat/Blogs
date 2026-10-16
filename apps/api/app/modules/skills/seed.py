"""T09 的内容初始化命令：技能全书与印象空间问题记录。

**为什么是一个命令而不是迁移**：技能与问题记录是**内容**，不是 schema。
内容初始化必须可复现、幂等，并且**不杜撰事实**（07 §6、T09 任务卡）：

  - 技能条目全部来自**这个仓库里真实存在的东西**：Next.js App Router 前端、
    FastAPI / SQLAlchemy / PostgreSQL 后端、Alembic 单一 head 迁移链、
    真实浏览器验收（Playwright）、媒体处理（Pillow）、ACM 训练与题解。
  - 每条技能都写**范围说明**与**掌握证据**，并关联到**已经存在**的作品
    （默认 `p5-blog`，T06 的第一件真实作品）。关联只写关系，不复制作品的正文。
  - **没有等级、没有熟练度、没有完成度**：本命令不会生成任何这类数字，
    命令本身也没有可以填这类数字的参数。
  - 问题记录来自**真实的开发事故**（并行 agent 误删共享测试集群、
    Next build 期环境变量、hydration 前点击导致整页跳转），
    工作状态如实标注「已解决」并写出实际结果；解决时间由 service 写入。
  - 只关联**仓库里真实存在**的文章 slug；找不到就如实跳过并报告，
    不编一个标题塞进去。

用法（默认 dry-run，写库要显式 `--apply`，与 T01 / T04 / T06 同一约定）：

```sh
# 1) 真正文章（可选；没有文章也不影响技能本身）
uv run --project apps/api python -m app.commands.import_legacy --apply --no-covers --repo-root ../..
# 2) 看这一步会做什么（不写库）
uv run --project apps/api python -m app.modules.skills.seed
# 3) 真正创建草稿，或直接创建并发布
uv run --project apps/api python -m app.modules.skills.seed --apply --publish
# 4) 关联作品（默认 p5-blog；作品不存在就跳过并如实报告）
uv run --project apps/api python -m app.modules.skills.seed --apply --publish --project-slug p5-blog
# 5) 只初始化问题记录（或只初始化技能）
uv run --project apps/api python -m app.modules.skills.seed --apply --publish --only exploration
```

集成前临时选项：`--create-tables` 用 `Base.metadata.create_all` 补齐 T09 的五张表
（T00 生成迁移后不需要，也**不是**迁移替代品；生产路径永远是 alembic）。
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from typing import Sequence

from sqlalchemy import select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import create_db_engine, create_session_factory, session_scope
from app.modules.exploration import service as exploration_service
from app.modules.exploration.models import (
    STATUS_PUBLISHED as RECORD_PUBLISHED,
)
from app.modules.exploration.models import (
    ExplorationRecord,
)
from app.modules.posts.models import Post
from app.modules.projects.models import Project
from app.modules.skills import service as skills_service
from app.modules.skills.models import (
    STATUS_PUBLISHED as SKILL_PUBLISHED,
)
from app.modules.skills.models import (
    Skill,
)

DEFAULT_PROJECT_SLUG = "p5-blog"


@dataclass(frozen=True)
class SkillSpec:
    slug: str
    name: str
    domain: str
    scope: str
    evidence: str
    position: int
    links: tuple[dict[str, str], ...] = ()


@dataclass(frozen=True)
class RecordSpec:
    slug: str
    title: str
    background: str
    attempts: str
    outcome: str
    work_status: str
    evidence_links: tuple[dict[str, str], ...] = ()
    post_slugs: tuple[str, ...] = ()
    project_slugs: tuple[str, ...] = field(default=())


# --- 技能：全部来自这个仓库里真实存在的东西 ---------------------------------

SKILLS: tuple[SkillSpec, ...] = (
    SkillSpec(
        slug="react-next-app-router",
        name="React 与 Next.js App Router",
        domain="frontend",
        scope=(
            "能用 App Router 组织一个多领域站点：服务端组件负责首屏读取，"
            "客户端组件只承载交互；路由、布局、metadata 与动态渲染标记（force-dynamic）"
            "按内容是否需要实时公开状态来选择。范围到「把页面写对、把状态放对位置」，"
            "不包含自研框架或编译器层面改造。"
        ),
        evidence=(
            "这个博客的前端（apps/web）就是用它写的：15 个功能域各自独占目录，"
            "手机宿主与独立页渲染同一个功能视图；"
            "「use client 缺失时 tsc 不报错但 next build 失败」这类问题是在真实构建里发现的，"
            "并写进了交付记录。"
        ),
        position=10,
    ),
    SkillSpec(
        slug="fastapi-service-design",
        name="FastAPI 服务与接口设计",
        domain="backend",
        scope=(
            "能把一个领域拆成 models / schemas / service / router 四层："
            "公开 DTO 与管理 DTO 在类型层面分开，写操作统一走权限 + CSRF + If-Match，"
            "错误信封、分页游标、发布门槛这些横切关注点收在共享核心层，"
            "而不是每个模块各写一份。"
        ),
        evidence=(
            "本仓库的 API 有 12 个领域模块，公开 / 管理端点各自成型；"
            "统一错误信封与游标分页是被多个模块复用的真实实现，"
            "不是文档里的设想。"
        ),
        position=20,
    ),
    SkillSpec(
        slug="sqlalchemy-postgresql",
        name="SQLAlchemy 与 PostgreSQL 建模",
        domain="data",
        scope=(
            "能用 SQLAlchemy 2.x 的声明式模型表达业务约束，并把「数据库能表达的约束"
            "落在数据库」：唯一键、复合主键、CHECK、部分索引；"
            "跨行 / 语义约束（发布门槛、解决时间联动）留给 service 在同一个事务里校验。"
        ),
        evidence=(
            "本仓库的模型里有大量真实约束（状态枚举 CHECK、顺序唯一、"
            "「只有已解决才有解决时间」的联动约束），并且有直接绕过 ORM 写非法值的测试"
            "证明这些约束真的在库里生效。"
        ),
        position=30,
    ),
    SkillSpec(
        slug="alembic-migrations",
        name="Alembic 迁移与单一 head",
        domain="tooling",
        scope=(
            "能维护一条线性迁移链：模型与迁移必须同步（有自动化守卫）、"
            "只允许一个 head、升级在空库与前一版本库上都能跑通；"
            "模块不自己写迁移，由集成负责人串行生成。"
        ),
        evidence=(
            "本仓库有一条 8 个 revision 的线性迁移链，"
            "并有「模型与迁移是否一致」「期望的表是否都存在」两条守卫测试"
            "（在集成新模块前会真实地失败，这是设计行为）。"
        ),
        position=40,
    ),
    SkillSpec(
        slug="browser-verification-playwright",
        name="浏览器验收与自动化验证",
        domain="tooling",
        scope=(
            "能用真实浏览器验证「人真的能完成这件事」：等待水合完成再点击、"
            "用 performance.timeOrigin 判断是否整页重载、在 320 / 390px 下量横向溢出、"
            "用键盘走完核心路径。范围到「写出可复现的验收脚本」，不含性能基准测试。"
        ),
        evidence=(
            "本仓库有多个 Playwright 验收套件（手机导航、作品与相册、T09 的技能与问题记录），"
            "脚本里的三个时序坑（水合前点击、开屏拦截指针事件、整页重载判定）都是"
            "真实踩到后写进去的。"
        ),
        position=50,
    ),
    SkillSpec(
        slug="media-processing-pillow",
        name="图片处理与媒体变体",
        domain="backend",
        scope=(
            "能用 Pillow 做解码、方向校正、去元信息与多尺寸变体生成，"
            "并把「公开引用」做成默认拒绝的注册表：一张图只有在某个公开内容引用它时才可匿名读取；"
            "原图始终只给站主。"
        ),
        evidence=(
            "本仓库的媒体服务会在上传时真实解码并生成变体，"
            "公开引用检查由各内容域分别登记（posts / moments / coop / journal / leisure / "
            "projects / gallery），撤回一处不影响其它公开引用 —— 这些都有测试。"
        ),
        position=60,
    ),
    SkillSpec(
        slug="acm-algorithms",
        name="算法与数据结构（ACM 训练）",
        domain="algorithm",
        scope=(
            "能独立完成常见数据结构与基础图论实现（并查集、最短路、二分、"
            "滑动窗口、树形 DP 的入门题型），并习惯用反例和随机对拍验证猜想。"
            "范围是训练与题解层面，不是竞赛获奖或论文级研究。"
        ),
        evidence=(
            "ACM 训练与题解记录；一条真实的收获是「先构造反例再改代码」这个习惯，"
            "它同样用在了这个博客的接口与前端调试上（见印象空间里的问题记录）。"
        ),
        position=70,
    ),
)


# --- 问题记录：全部来自真实的开发事故 ---------------------------------------

RECORDS: tuple[RecordSpec, ...] = (
    RecordSpec(
        slug="shared-test-cluster-was-deleted",
        title="并行开发时共享的本地测试集群被清理脚本删掉了",
        background=(
            "多个任务包在同一个工作区里并行开发，本地 PostgreSQL 集群（端口 55432）"
            "是共享资源。一次「清理临时目录」的操作把它连数据目录一起删了，"
            "所有正在跑的测试立刻失败，报错是「database does not exist」，"
            "看起来像测试代码坏了。"
        ),
        attempts=(
            "先确认不是连接串写错：直接连集群、列出数据库，发现集群本身不见了。"
            "再回看清理动作，发现它按名字匹配删了一批临时目录，"
            "而集群的数据目录正好也在那一批里。"
        ),
        outcome=(
            "把集群的生命周期收进一个脚本（status / start / stop / init），"
            "明确「不要自己 initdb、不要 stop、不要删除数据目录」；"
            "并把「清理脚本要精确到自己的路径、删除前先 echo 出绝对路径核对」写进协作约定。"
        ),
        work_status="resolved",
        evidence_links=(
            {
                "kind": "proof",
                "label": "管理脚本 tools/pg-local.sh",
                "url": "https://github.com/ScurryCat/Blogs",
            },
        ),
    ),
    RecordSpec(
        slug="animation-pointer-events",
        title="为什么某个动画结束后页面点不动了",
        background=(
            "进入异世界的认知过场结束后，页面看起来已经恢复，但所有链接都点不动，"
            "像是被一层看不见的东西挡住了。刷新之后一切正常。"
        ),
        attempts=(
            "先怀疑动画本身没结束，加日志后发现动画确实结束了。"
            "再检查遮罩的卸载时机：遮罩元素的移除晚于指针事件的恢复，"
            "中间那一帧里遮罩仍在 DOM 上，于是点击全部落在遮罩上。"
        ),
        outcome=(
            "把过渡遮罩的卸载与指针事件的恢复放进同一个提交顺序里"
            "（先卸遮罩再恢复指针事件），并在手机宿主里加了「模块退出必须取消读取与监听」"
            "的统一约定，避免同类残留。"
        ),
        work_status="resolved",
        evidence_links=(
            {
                "kind": "proof",
                "label": "导航协调器",
                "url": "https://github.com/ScurryCat/Blogs",
            },
        ),
        project_slugs=(DEFAULT_PROJECT_SLUG,),
    ),
    RecordSpec(
        slug="dev-api-url-at-build-time",
        title="开发期的同源转发必须在构建时就有值",
        background=(
            "前端在开发环境通过 Next 的 rewrites 把 /api/v1 转发到本地 API。"
            "本地联调时页面能打开，但所有接口请求都 404 —— 而 API 本身是活的。"
        ),
        attempts=(
            "先确认 API 端口与路由没问题（直接 curl 通过）。"
            "再看前端产物：rewrites 的配置在 next build 时就被固化了，"
            "运行时再设置环境变量不会生效。"
        ),
        outcome=(
            "把「DEV_API_URL 必须在 next build 时就有值」写成构建约定并记录在交付单里；"
            "同时明确同源转发下 CORS_ORIGINS 必须包含前端端口，否则写请求会被拒。"
        ),
        work_status="resolved",
        post_slugs=("phantom-blog-launch",),
    ),
    RecordSpec(
        slug="hydration-click-full-reload",
        title="水合完成前点击会退化成整页跳转",
        background=(
            "在真实浏览器验收里，偶尔出现「点一下站内链接，页面整页重载」。"
            "手动点击几乎复现不出来，自动化脚本里却很常见。"
        ),
        attempts=(
            "对比成功与失败两次的时序，发现失败都发生在页面刚 load 完、"
            "React 还没水合完的时间窗里：这时点击走的是浏览器默认行为，"
            "而不是导航协调器。"
        ),
        outcome=(
            "验收脚本统一改成「等 window.__PHANTOM_DEBUG__ 可调用（= 水合完成）再点击」；"
            "判断是否整页重载改用 performance.timeOrigin 是否变化，"
            "而不是注入标记（注入本身会扰动时序）。"
        ),
        work_status="resolved",
        evidence_links=(
            {
                "kind": "docs",
                "label": "浏览器验收脚本写法",
                "url": "https://github.com/ScurryCat/Blogs",
            },
        ),
    ),
    RecordSpec(
        slug="chinese-pagination-order",
        title="中文排序下的分页会不会漏项",
        background=(
            "技能全书的展示顺序允许重复（站主想并列两门技能时可以都填 10），"
            "而通用的游标分页只按「一个时间戳 + 一个 ID」排序。"
            "顺序键重复时，翻页可能漏掉或重复。"
        ),
        attempts=(
            "先按通用游标实现，写了一个「两门技能 position 相同」的用例，"
            "用例里第二页真的漏掉了其中一条。"
        ),
        outcome=(
            "改用三元组排序键 (position, name, id) 并让游标承载同一组键，"
            "同时保留「换筛选后旧游标必须 400」的语义。"
        ),
        work_status="resolved",
        project_slugs=(DEFAULT_PROJECT_SLUG,),
    ),
    RecordSpec(
        slug="hidden-title-leak-on-withdraw",
        title="撤回关联内容后，标题不该留在别处",
        background=(
            "问题记录与技能都可以关联文章和作品。"
            "如果把被关联的文章撤回，记录页上仍然显示它的标题，"
            "读者就能从别处读到还没发布的标题 —— 这本身就是泄漏。"
        ),
        attempts=(
            "最初的实现把标题快照存进了关系表（读起来快、少一次 join），"
            "写用例时发现：文章撤回后快照还在，页面照常显示。"
        ),
        outcome=(
            "关系表只存 id 与顺序，标题在**读取时**按当前公开条件解析；"
            "解析不到就整条丢弃，连「（已隐藏）」这样的占位都不留 —— "
            "那同样会告诉读者「这里本来有东西」。"
        ),
        work_status="resolved",
        project_slugs=(DEFAULT_PROJECT_SLUG,),
    ),
    RecordSpec(
        slug="pg-trgm-for-chinese-search",
        title="pg_trgm 能不能直接当中文搜索用",
        background=(
            "普通搜索要支持中文词组。直觉是装个 pg_trgm 就拥有中文检索了。"
        ),
        attempts=(
            "查了 pg_trgm 的文档与社区讨论：它提供的是相似匹配与部分文本索引，"
            "对中文并没有分词能力，三元组切分对中文的效果取决于字符组合，"
            "不能等同于语义检索。"
        ),
        outcome=(
            "首版先用参数化条件查询 + 子串匹配，并在文档里明确「这不是完善的中文分词」；"
            "等真实数据量测出瓶颈再考虑索引方案。"
        ),
        work_status="archived",
    ),
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m app.modules.skills.seed",
        description="初始化 T09 的技能全书与印象空间问题记录（默认 dry-run）。",
    )
    parser.add_argument("--apply", action="store_true", help="真正写数据库（默认只报告）")
    parser.add_argument("--publish", action="store_true", help="创建后发布（不发布则留草稿）")
    parser.add_argument(
        "--project-slug",
        default=DEFAULT_PROJECT_SLUG,
        help=f"关联的作品 slug（默认 {DEFAULT_PROJECT_SLUG}）",
    )
    parser.add_argument(
        "--only",
        choices=("all", "skills", "exploration"),
        default="all",
        help="只初始化其中一部分",
    )
    parser.add_argument(
        "--create-tables",
        action="store_true",
        help="集成前临时补齐 T09 的五张表（不是迁移替代品）",
    )
    parser.add_argument("--json", action="store_true", help="以 JSON 输出")
    return parser


# --- 数据准备 ---------------------------------------------------------------


def _existing_skill(session: Session, slug: str) -> Skill | None:
    return session.execute(select(Skill).where(Skill.slug == slug)).scalars().first()


def _existing_record(session: Session, slug: str) -> ExplorationRecord | None:
    return (
        session.execute(select(ExplorationRecord).where(ExplorationRecord.slug == slug))
        .scalars()
        .first()
    )


def _ids_for_slugs(session: Session, model, slugs: Sequence[str]) -> tuple[list, list[str]]:
    """按 slug 取某个模型的 id。返回 `(找到的 id 列表, 没找到的 slug 列表)`。

    刻意接受 `model` 参数而不是写死 `Post`：**真实踩到过**把作品 slug 交给只查 posts 的
    函数，结果是「作品 p5-blog 找不到」被如实报告成 missing —— 报告本身没错，
    但根因是查询查错了表。分开传模型能让这类错误在类型上就难以发生。
    """
    found: list = []
    missing: list[str] = []
    for slug in slugs:
        row = session.execute(select(model).where(model.slug == slug)).scalars().first()
        if row is None:
            missing.append(slug)
            continue
        found.append(row.id)
    return found, missing


def ensure_skills(
    session: Session,
    *,
    project_slug: str,
    publish: bool,
) -> dict[str, object]:
    project = (
        session.execute(select(Project).where(Project.slug == project_slug)).scalars().first()
    )
    project_ids = [project.id] if project is not None else []

    results: list[dict[str, object]] = []
    for spec in SKILLS:
        existing = _existing_skill(session, spec.slug)
        if existing is not None:
            results.append(
                {"slug": spec.slug, "created": False, "status": existing.status, "note": "已存在，未改动"}
            )
            continue
        skill = skills_service.create_skill(
            session,
            slug=spec.slug,
            name=spec.name,
            domain=spec.domain,
            scope=spec.scope,
            evidence=spec.evidence,
            links=list(spec.links),
            position=spec.position,
            projects=[{"project_id": str(pid), "position": index} for index, pid in enumerate(project_ids)],
        )
        if publish:
            # `If-Match` 不是可选的：service 走的是与 HTTP 管理端点**同一条**发布路径，
            # 因此这里必须如实带上刚创建的版本号（用 None 会被正确地拒绝为 428）。
            skill = skills_service.publish_skill(session, skill, if_match=f'"{skill.version}"')
        results.append(
            {
                "slug": skill.slug,
                "created": True,
                "status": skill.status,
                "projects": len(project_ids),
            }
        )
    return {
        "project_slug": project_slug,
        "project_found": project is not None,
        "skills": results,
    }


def ensure_records(
    session: Session,
    *,
    default_project_slug: str,
    publish: bool,
) -> dict[str, object]:
    results: list[dict[str, object]] = []
    for spec in RECORDS:
        existing = _existing_record(session, spec.slug)
        if existing is not None:
            results.append(
                {
                    "slug": spec.slug,
                    "created": False,
                    "status": existing.status,
                    "work_status": existing.work_status,
                    "note": "已存在，未改动",
                }
            )
            continue

        project_slugs = spec.project_slugs or (default_project_slug,)
        post_ids, missing_posts = _ids_for_slugs(session, Post, spec.post_slugs)
        project_ids, missing_projects = _ids_for_slugs(session, Project, project_slugs)

        record = exploration_service.create_record(
            session,
            slug=spec.slug,
            title=spec.title,
            background=spec.background,
            attempts=spec.attempts,
            outcome=spec.outcome,
            evidence_links=list(spec.evidence_links),
            work_status=spec.work_status,
            posts=[{"post_id": str(pid), "position": index} for index, pid in enumerate(post_ids)],
            projects=[
                {"project_id": str(pid), "position": index}
                for index, pid in enumerate(project_ids)
            ],
        )
        if publish:
            record = exploration_service.publish_record(
                session, record, if_match=f'"{record.version}"'
            )
        results.append(
            {
                "slug": record.slug,
                "created": True,
                "status": record.status,
                "work_status": record.work_status,
                "posts": len(post_ids),
                "projects": len(project_ids),
                # 找不到的关联如实报告，**不**编一个标题塞进去。
                "missing_posts": missing_posts,
                "missing_projects": missing_projects,
            }
        )
    return {"records": results}


def ensure_tables(engine: Engine) -> list[str]:
    """集成前临时补齐 T09 自己的五张表（不是迁移替代品）。

    与 T06 的 `--create-tables` 同一个用途：T00 生成迁移之前，技能与问题记录的表
    只存在于 `Base.metadata` 里。这里**只**补 T09 的清单，不做 `create_all` 全量建表
    （那会把别人的表也建出来，破坏共享库的守卫用例）。
    """
    from sqlalchemy import inspect

    from app.modules.exploration import models as exploration_models
    from app.modules.skills import models as skills_models

    names = (
        "skills",
        "project_skills",
        "exploration_records",
        "exploration_record_posts",
        "exploration_record_projects",
    )
    existing = set(inspect(engine).get_table_names())
    to_create = [name for name in names if name not in existing]
    for name in to_create:
        source = (
            skills_models.Base.metadata
            if name in skills_models.Base.metadata.tables
            else exploration_models.Base.metadata
        )
        if name in source.tables:
            source.create_all(engine, tables=[source.tables[name]])
    return to_create


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    settings = get_settings()
    engine = create_db_engine(settings.database_url)

    report: dict[str, object] = {"dry_run": not args.apply, "only": args.only}
    try:
        if args.create_tables and args.apply:
            report["created_tables"] = ensure_tables(engine)

        if args.apply:
            with session_scope(create_session_factory(engine)) as session:
                if args.only in ("all", "skills"):
                    report["skills_report"] = ensure_skills(
                        session, project_slug=args.project_slug, publish=args.publish
                    )
                if args.only in ("all", "exploration"):
                    report["records_report"] = ensure_records(
                        session, default_project_slug=args.project_slug, publish=args.publish
                    )
        else:
            # dry-run：只报告将要做什么，不连库写任何东西。
            report["would_create_skills"] = [spec.slug for spec in SKILLS]
            report["would_create_records"] = [spec.slug for spec in RECORDS]
            report["publish"] = args.publish
    finally:
        engine.dispose()

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2, default=str))
    else:
        for key, value in report.items():
            print(f"{key}: {value}")
    return 0


if __name__ == "__main__":  # pragma: no cover - 命令行入口
    sys.exit(main())
