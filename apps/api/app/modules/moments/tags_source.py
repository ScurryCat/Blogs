"""动态域对公开标签列表的贡献（`GET /tags`）。

注册后，当前公开动态使用到的标签 id 进入 `tags/service.public_tag_ids` 的并集，
因此「只被草稿动态使用」的标签不会出现在公开标签列表里（05 §6：不泄漏仅草稿使用的标签）。

不注册时不会报错，只是动态的标签进不了公开标签列表 —— 默认是「不贡献」而不是「默认通过」。

关于注销：`tags/service.py` 属 T01，它只提供 `reset_public_tag_sources()`（整体清空），
没有按名字注销。因此这里**不**提供 `unregister()` —— 写一个偷偷 pop 私有字典的函数比
不提供更糟。测试用 `reset()` 并重新登记需要的来源（见 `tests/moments/conftest.py`）。
"""

from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.modules.moments import service
from app.modules.tags import service as tags_service

SOURCE_NAME = "moments"


def moment_public_tag_ids(session: Session) -> set[uuid.UUID]:
    return service.public_tag_ids(session)


def register() -> None:
    tags_service.register_public_tag_source(SOURCE_NAME, moment_public_tag_ids)
