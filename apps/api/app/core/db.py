"""数据库连接、事务边界与模型 Base。

边界（SHARED-CONTRACTS §2 / §5）：
  - Base 与 session 由 T00 拥有；各模块只定义自己的模型与 service。
  - 时间统一 UTC，且必须是 aware datetime；数据库列一律 timestamptz。
  - 测试连接必须显式标记为测试库，误连生产要直接拒绝（见 assert_test_database_url）。
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Iterator

from sqlalchemy import MetaData, create_engine
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

# 约束命名约定：让 Alembic 自动生成的迁移在不同环境得到同样的约束名，
# 否则 rename/drop 会因匿名约束在不同库上产生漂移。
NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_N_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    """所有模型的基类。模块通过 model_registry 显式登记，不做目录扫描。"""

    metadata = MetaData(naming_convention=NAMING_CONVENTION)


def utcnow() -> datetime:
    """当前 UTC 时间（aware）。禁止用 naive datetime 写库。"""
    return datetime.now(timezone.utc)


def as_utc(value: datetime) -> datetime:
    """把 naive datetime 视为 UTC 并补上时区；已带时区的转换为 UTC。"""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


# 测试库名必须命中这些模式之一，否则夹具拒绝连接。
# 目的：任何 test 命令都不可能把生产库当测试库清空。
TEST_DATABASE_PATTERNS = (
    re.compile(r"(^|_)test($|_)"),
    re.compile(r"_test$"),
    re.compile(r"^test_"),
)


def database_name_of(url: str) -> str:
    """从连接 URL 取库名，取不到时返回空串（调用方按不安全处理）。"""
    try:
        return make_url(url).database or ""
    except Exception:
        return ""


def assert_test_database_url(url: str, *, expected_host: str | None = None) -> str:
    """校验这是否是一个可以安全清理的测试库，返回库名。

    拒绝条件（任一命中即抛错，不给「继续执行」的开关）：
      - 库名为空
      - 库名不匹配 TEST_DATABASE_PATTERNS
      - 库名明确像生产库（prod / production / live / main）
    """
    name = database_name_of(url)
    lowered = name.lower()
    if not name:
        raise RuntimeError("测试数据库 URL 缺少库名，拒绝连接")
    if any(word in lowered for word in ("prod", "production", "live", "main")):
        raise RuntimeError(f"测试数据库库名 {name!r} 看起来是生产库，拒绝连接")
    if not any(pattern.search(lowered) for pattern in TEST_DATABASE_PATTERNS):
        raise RuntimeError(
            f"测试数据库库名 {name!r} 未包含 test 标记，拒绝连接；"
            "请使用形如 pl_test 的库名"
        )
    if expected_host is not None:
        host = make_url(url).host or ""
        if host != expected_host:
            raise RuntimeError(f"测试数据库主机 {host!r} 与期望的 {expected_host!r} 不一致，拒绝连接")
    return name


def create_db_engine(url: str, *, echo: bool = False) -> Engine:
    """建引擎。pool_pre_ping 让长时间空闲后的连接自动重建，避免第一次请求必失败。"""
    return create_engine(url, echo=echo, pool_pre_ping=True, future=True)


def create_session_factory(engine: Engine) -> sessionmaker[Session]:
    # expire_on_commit=False：提交后仍可读取已加载属性，避免 service 层在响应组装时触发额外查询。
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, class_=Session)


def session_scope(factory: sessionmaker[Session]) -> Iterator[Session]:
    """事务边界：正常提交，异常回滚。供脚本与测试使用；请求内用 FastAPI 依赖。"""
    session = factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
