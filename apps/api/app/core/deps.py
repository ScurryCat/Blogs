"""进程级依赖：配置、数据库引擎、会话、媒体目录、图片并发上限。

为什么集中在这里：每个模块各建一个引擎会让连接池数量随模块数增长，而且测试要覆盖
多个地方。这里只做「一个进程一个引擎」，测试通过 `app.dependency_overrides[get_session]`
换成自己的事务会话（见 `apps/api/tests/core/t01_db.py`）。

事务边界：本依赖**不自动提交**。写操作由 service 在自己的事务里显式 `commit()`
（05 §4：一次发布 / 更新里的多行变更必须同事务提交，返回成功即已落库）；
请求异常时这里负责回滚并关闭。
"""

from __future__ import annotations

from collections.abc import Iterator
from functools import lru_cache
from pathlib import Path

from fastapi import Depends
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.concurrency import limiter_for
from app.core.config import Settings, get_settings
from app.core.db import create_db_engine, create_session_factory


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    """按配置建一次引擎（进程级）。测试用 dependency_overrides 覆盖 get_session。"""
    return create_db_engine(get_settings().database_url)


@lru_cache(maxsize=1)
def get_session_factory() -> sessionmaker[Session]:
    """进程级 sessionmaker：引擎已被缓存，工厂没必要每个请求重建。"""
    return create_session_factory(get_engine())


def get_settings_dep() -> Settings:
    """FastAPI 依赖形式读取配置；测试可覆盖为 `Settings(...)`。"""
    return get_settings()


def get_session() -> Iterator[Session]:
    """一个请求一个 Session。异常回滚，正常结束只关闭（提交由 service 决定）。"""
    session = get_session_factory()()
    try:
        yield session
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_media_root(settings: Settings = Depends(get_settings_dep)) -> Path:
    """媒体根目录。只返回路径；**不创建目录** —— 目录不存在时 readiness 必须如实报告未就绪。"""
    return settings.media_root_path


def get_media_limiter(settings: Settings = Depends(get_settings_dep)):
    return limiter_for(settings.media_max_concurrency)
