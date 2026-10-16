"""PHANTOM LOG 后端应用包。

目录所有权（SHARED-CONTRACTS §2）：
  - `app/main.py`、`app/router.py`、`app/model_registry.py`、`migrations/`：T00 拥有。
  - `app/core/`、`app/modules/*`：T00 建初始骨架后交 T01，之后按模块独占目录演进。
"""

__all__ = ["__version__"]

__version__ = "0.0.0"
