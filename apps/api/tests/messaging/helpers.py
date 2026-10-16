"""T08 测试的共享工具：测试 app、可提交的会话、两个「浏览器」、剧情导航。

关键点：这里**不 mock 会话服务与剧情引擎**。被替换的只有两样东西：
  - `get_session`：换成一个**每个请求一个新 session 且会真的提交**的工厂
    （事务回滚式的夹具测不到唯一约束、部分索引与跨连接可见性）；
  - `messaging_settings_dep`：让每个用例能精确控制限额、超时与故障注入。

`fetch` 层面没有任何替身：HTTP → 路由 → 服务 → 真实 PostgreSQL 全部走真实代码。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterator

from fastapi import APIRouter
from fastapi.testclient import TestClient
from sqlalchemy.engine import Engine

from app.core.config import Settings
from app.core.deps import get_session, get_settings_dep
from app.modules.messaging.config import MessagingSettings, messaging_settings_dep
from app.modules.messaging.router import router as messaging_router
from tests.support.module_app import build_module_app

# 浏览器同源形态：TestClient 的 Host 是 `testserver`，因此 Origin 与它一致才通过校验。
ORIGIN = "http://testserver"

SESSION_PATH = "/api/v1/messaging/session"
CHARACTERS_PATH = "/api/v1/messaging/characters"
CONVERSATIONS_PATH = "/api/v1/messaging/conversations"
STATUS_PATH = "/api/v1/messaging/status"


@dataclass
class Visitor:
    """一个「浏览器」：独立 Cookie jar + 独立的 CSRF token。"""

    client: TestClient
    csrf_token: str
    visitor_id: str

    def url(self, path: str) -> str:
        return path


def build_client(
    core_settings: Settings,
    msg_settings: MessagingSettings,
    engine: Engine,
    *routers: tuple[str, APIRouter],
) -> TestClient:
    """只挂 messaging（可选地再挂别的域）的测试 app，session 每个请求新建且**会提交**。"""
    from app.core.db import create_session_factory

    app = build_module_app(core_settings, *routers)
    factory = create_session_factory(engine)

    def _session_override() -> Iterator[Any]:
        session = factory()
        try:
            yield session
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    app.dependency_overrides[get_session] = _session_override
    app.dependency_overrides[get_settings_dep] = lambda: core_settings
    app.dependency_overrides[messaging_settings_dep] = lambda: msg_settings
    return TestClient(app, raise_server_exceptions=False, base_url="http://testserver")


def open_visitor(client: TestClient) -> Visitor:
    """建立访客会话（真实 POST /session），返回带 CSRF token 的访客句柄。"""
    response = client.post(SESSION_PATH, headers={"Origin": ORIGIN}, json={})
    assert response.status_code == 200, response.text
    payload = response.json()
    return Visitor(
        client=client,
        csrf_token=payload["csrf_token"],
        visitor_id=payload["visitor"]["id"],
    )


def write_headers(visitor: Visitor | None = None) -> dict[str, str]:
    """写请求的默认头。**故意不带** `X-CSRF-Token`：token 走 JSON body，
    与共享客户端（没有 headers 选项）的实际形态一致。"""
    del visitor
    return {"Origin": ORIGIN}


def post(
    client: TestClient,
    path: str,
    payload: dict[str, Any] | None = None,
    *,
    csrf_token: str | None = None,
    headers: dict[str, str] | None = None,
) -> Any:
    body = dict(payload or {})
    if csrf_token is not None:
        body["csrf_token"] = csrf_token
    return client.post(path, json=body, headers={"Origin": ORIGIN, **(headers or {})})


def delete(
    client: TestClient,
    path: str,
    *,
    csrf_token: str | None = None,
    headers: dict[str, str] | None = None,
) -> Any:
    body = {"csrf_token": csrf_token} if csrf_token is not None else None
    return client.request(
        "DELETE", path, json=body, headers={"Origin": ORIGIN, **(headers or {})}
    )


# --- 剧情导航 --------------------------------------------------------------


def create_conversation(visitor: Visitor, character_id: str = "futaba") -> dict:
    response = post(
        visitor.client,
        CONVERSATIONS_PATH,
        {"character_id": character_id},
        csrf_token=visitor.csrf_token,
    )
    assert response.status_code == 200, response.text
    return response.json()


def choose(visitor: Visitor, view: dict, choice_id: str, *, client_message_id: str) -> Any:
    state = view["conversation"]
    return post(
        visitor.client,
        f"{CONVERSATIONS_PATH}/{state['id']}/choice",
        {
            "choice_id": choice_id,
            "node_id": state["node_id"],
            "node_version": state["node_version"],
            "client_message_id": client_message_id,
        },
        csrf_token=visitor.csrf_token,
    )


def send(
    visitor: Visitor,
    view: dict,
    text: str,
    *,
    client_request_id: str,
) -> Any:
    state = view["conversation"]
    return post(
        visitor.client,
        f"{CONVERSATIONS_PATH}/{state['id']}/messages",
        {"text": text, "client_request_id": client_request_id},
        csrf_token=visitor.csrf_token,
    )


def resume(visitor: Visitor, view: dict) -> Any:
    state = view["conversation"]
    return post(
        visitor.client,
        f"{CONVERSATIONS_PATH}/{state['id']}/resume",
        {"node_version": state["node_version"]},
        csrf_token=visitor.csrf_token,
    )


def restart(visitor: Visitor, view: dict) -> Any:
    state = view["conversation"]
    return post(
        visitor.client,
        f"{CONVERSATIONS_PATH}/{state['id']}/restart",
        {"node_version": state["node_version"]},
        csrf_token=visitor.csrf_token,
    )


def texts(view: dict) -> list[str]:
    return [message["text"] for message in view["messages"]]


def origins(view: dict) -> list[str]:
    return [message["origin"] for message in view["messages"]]


__all__ = [
    "CHARACTERS_PATH",
    "CONVERSATIONS_PATH",
    "ORIGIN",
    "SESSION_PATH",
    "STATUS_PATH",
    "Visitor",
    "build_client",
    "choose",
    "create_conversation",
    "delete",
    "open_visitor",
    "origins",
    "post",
    "restart",
    "resume",
    "send",
    "texts",
    "write_headers",
]
