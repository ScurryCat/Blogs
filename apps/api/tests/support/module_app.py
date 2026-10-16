"""模块测试应用工厂。

用途（SHARED-CONTRACTS §3）：模块测试**只挂被测模块**的 router，因此测试本模块
无需编辑生产总路由，也不会因为别人的模块坏掉而失败。

它复用 `create_app`，所以错误结构、request_id、前缀 `/api/v1` 与生产完全一致 ——
测试里看到的错误体就是要上线的错误体。
"""

from __future__ import annotations

from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


def build_module_app(settings: Settings, *routers: tuple[str, APIRouter]) -> FastAPI:
    """构造只包含给定模块的 app。

    参数：
        settings: 测试配置（通常来自 conftest 的 test_settings）。
        routers:  (模块名, router) 序列；模块名用于重复登记检测。
    """
    module_routers = dict(routers)
    if len(module_routers) != len(routers):
        raise ValueError("模块名重复，无法构造模块测试 app")
    return create_app(settings=settings, module_routers=module_routers)


def module_client(settings: Settings, *routers: tuple[str, APIRouter]) -> TestClient:
    """模块 app 的测试客户端。保留异常以便定位 500 的真实原因。"""
    return TestClient(build_module_app(settings, *routers), raise_server_exceptions=False)
