"""真实的 readiness 检查（06 §1 / §3，T01 任务卡第 8 条）。

`/api/v1/health/live` 只说明进程活着；本模块提供 `/api/v1/health/ready`，
检查三件事，任何一项不通过就返回 **503 且不返回 ready**：

  1. `database`：能否建立连接并执行一次最简查询。
  2. `schema`：`alembic_version` 是否存在、是否只有一个 head，以及运行时模型声明的表
     是否都已落库（缺表 = 迁移没跑完）。**不比较具体 revision 号** ——
     写死版本号会在每次迁移后变成假告警，而「表在不在」才是部署失败的真实信号。
  3. `media_storage`：媒体目录是否存在、是否真的可写（实际写一个探针文件再删除，
     而不是只看权限位 —— 磁盘满 / 只读挂载都会在这里暴露）。

安全边界：响应只给状态词与检查名，**不含路径、连接串、库名、表名、异常文本**；
细节进服务端日志。未就绪时状态码是 503，绝不「返回 200 + ok 但其实是坏的」。
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from fastapi import APIRouter, Response
from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.core.config import Settings, get_settings
from app.core.db import Base
from app.core.deps import get_engine

logger = logging.getLogger(__name__)

READY_PATH = "/health/ready"

CHECK_DATABASE = "database"
CHECK_SCHEMA = "schema"
CHECK_MEDIA_STORAGE = "media_storage"

STATUS_OK = "ok"
STATUS_UNAVAILABLE = "unavailable"
STATUS_NOT_MIGRATED = "not_migrated"
STATUS_MISSING = "missing"
STATUS_NOT_WRITABLE = "not_writable"

CHECK_ORDER = (CHECK_DATABASE, CHECK_SCHEMA, CHECK_MEDIA_STORAGE)


def _utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def check_database(engine: Engine) -> str:
    """最简查询。连不上 / 查询失败都算 unavailable，不把异常文本带进响应。"""
    try:
        with engine.connect() as connection:
            connection.execute(text("select 1"))
        return STATUS_OK
    except Exception as exc:
        logger.warning("readiness: 数据库不可用 (%s)", type(exc).__name__)
        return STATUS_UNAVAILABLE


def check_schema(engine: Engine, *, expected_tables: tuple[str, ...] | None = None) -> str:
    """单一 head + 期望的表都存在。任何一步失败都返回 not_migrated。"""
    tables = tuple(sorted(Base.metadata.tables)) if expected_tables is None else expected_tables
    try:
        with engine.connect() as connection:
            revisions = connection.execute(text("select version_num from alembic_version")).scalars().all()
            if len(revisions) != 1:
                # 0 行 = 没迁移；多行 = 平行 head（SHARED-CONTRACTS §5 禁止）。
                logger.warning("readiness: alembic_version 行数异常 (%d)", len(revisions))
                return STATUS_NOT_MIGRATED

            existing = set(
                connection.execute(
                    text("select table_name from information_schema.tables where table_schema = current_schema()")
                ).scalars()
            )
    except Exception as exc:
        logger.warning("readiness: schema 检查失败 (%s)", type(exc).__name__)
        return STATUS_NOT_MIGRATED

    missing = [name for name in tables if name not in existing]
    if missing:
        # 只记录数量，不把表名放进响应。
        logger.warning("readiness: 缺少 %d 张表，迁移未完成", len(missing))
        return STATUS_NOT_MIGRATED
    return STATUS_OK


def check_media_storage(root: Path) -> str:
    """存在 + 是目录 + 真的能写。探针文件用完即删，不留垃圾。"""
    try:
        if not root.exists():
            return STATUS_MISSING
        if not root.is_dir():
            return STATUS_NOT_WRITABLE
    except OSError:
        return STATUS_MISSING

    probe = root / f".ready-probe-{uuid.uuid4().hex}"
    try:
        probe.write_bytes(b"ok")
    except OSError as exc:
        logger.warning("readiness: 媒体目录不可写 (%s)", type(exc).__name__)
        return STATUS_NOT_WRITABLE
    finally:
        try:
            probe.unlink(missing_ok=True)
        except OSError:  # pragma: no cover - 删除失败不影响判定
            logger.warning("readiness: 探针文件删除失败")
    return STATUS_OK


def readiness_report(
    settings: Settings,
    *,
    engine: Engine | None = None,
    media_root: Path | None = None,
) -> tuple[dict[str, object], bool]:
    """返回 (响应体, 是否就绪)。engine / media_root 可注入，便于测试故障分支。"""
    engine = engine if engine is not None else get_engine()
    root = media_root if media_root is not None else settings.media_root_path

    checks = {
        CHECK_DATABASE: check_database(engine),
        CHECK_SCHEMA: check_schema(engine),
        CHECK_MEDIA_STORAGE: check_media_storage(root),
    }
    ready = all(value == STATUS_OK for value in checks.values())
    body: dict[str, object] = {
        "status": "ready" if ready else "not_ready",
        "service": "phantom-log-api",
        "version": settings.app_version,
        "checks": checks,
        "checked_at": _utc_iso(),
    }
    return body, ready


def readiness_router(
    *,
    settings_provider: Callable[[], Settings] = get_settings,
    engine_provider: Callable[[], Engine] = get_engine,
    media_root_provider: Callable[[Settings], Path] | None = None,
) -> APIRouter:
    """就绪 router。默认走真实配置与真实引擎；测试注入坏引擎 / 不存在的目录。"""
    router = APIRouter(prefix="/health", tags=["meta"])

    @router.get(
        "/ready",
        summary="服务就绪状态（DB / schema / 媒体目录）",
        responses={503: {"description": "未就绪，响应体给出未通过的检查项"}},
    )
    def health_ready(response: Response) -> dict[str, object]:
        settings = settings_provider()
        root = media_root_provider(settings) if media_root_provider else None
        body, ready = readiness_report(settings, engine=engine_provider(), media_root=root)
        response.headers["Cache-Control"] = "no-store"
        if not ready:
            response.status_code = 503
        return body

    return router


router = readiness_router()
