"""模型注册表。

契约（SHARED-CONTRACTS §2）：`app/model_registry.py` 由 T00 拥有，集中导入全部模型，
**拒绝目录扫描自动执行插件** —— 导入哪些模块必须在这份清单里看得见，不能靠遍历文件系统。

各模块把自己的 models 模块路径加进 MODEL_MODULES（通过交付单申请，由 T00 写入），
新增模型后由 T00 在集成时串行生成 Alembic 迁移，保证单一 head。
"""

from __future__ import annotations

import importlib
from typing import Iterable, TypeVar

from app.core.db import Base

# 显式清单：顺序固定，便于复现。按依赖顺序排列（auth 的站主/会话被其余域引用）。
# T01 于 2026-10-16 声明模型冻结；新增模块需经集成负责人写入这里。
MODEL_MODULES: tuple[str, ...] = (
    "app.modules.auth.models",
    "app.modules.media.models",
    "app.modules.tags.models",
    "app.modules.posts.models",
)

_ModelT = TypeVar("_ModelT", bound=type)


class DuplicateModelError(RuntimeError):
    """同一个表名被两个模型占用，或模块被重复登记。"""


def imported_model_modules() -> tuple[str, ...]:
    """返回当前清单。测试用它断言清单非空时确实被导入过。"""
    return MODEL_MODULES


def import_all_models(modules: Iterable[str] | None = None) -> list[str]:
    """按清单导入模型模块，触发 Base.metadata 注册。返回实际导入成功的模块名。"""
    names = tuple(MODEL_MODULES if modules is None else modules)
    loaded: list[str] = []
    for name in names:
        importlib.import_module(name)
        loaded.append(name)
    assert_no_table_conflicts()
    return loaded


def assert_no_table_conflicts(registry=None) -> None:
    """同一表名只能被一个模型声明；跨模块撞表要在启动时就炸，而不是等迁移生成。

    `registry` 参数供测试注入临时注册表；生产路径始终检查 Base.registry。
    """
    target = Base.registry if registry is None else registry
    seen: dict[str, str] = {}
    for mapper in target.mappers:
        cls = mapper.class_
        table = mapper.local_table
        if table is None:
            continue
        owner = f"{cls.__module__}.{cls.__qualname__}"
        previous = seen.get(table.name)
        if previous is not None and previous != owner:
            raise DuplicateModelError(
                f"表 {table.name!r} 同时被 {previous} 与 {owner} 声明"
            )
        seen[table.name] = owner


def registered_tables() -> tuple[str, ...]:
    """当前已注册的表名（已排序），供健康检查之外的诊断与测试使用。"""
    return tuple(sorted(Base.metadata.tables))


def register_model(model: _ModelT) -> _ModelT:
    """显式登记一个模型类。

    正常路径是模块导入时由 SQLAlchemy 自动注册；这个函数供模块在**运行时**登记
    （例如测试夹具构造临时模型），并对重复表名立即报错。
    """
    import_all_models()  # 保持清单与注册表一致，避免只登记了一半
    assert_no_table_conflicts()
    return model
