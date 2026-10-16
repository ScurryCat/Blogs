"""公开标签路由（05 §6：`GET /tags`）。

返回**有公开内容**的标签；仅草稿使用的标签不出现。
响应无缓存（01 §6：首版公开动态数据不共享缓存）。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.core.deps import get_session
from app.core.http import no_store
from app.modules.tags import service
from app.modules.tags.schemas import TagPublicOut, tag_public_out

router = APIRouter(prefix="/tags", tags=["tags"])


@router.get("", response_model=list[TagPublicOut], summary="公开标签列表")
def list_tags(
    response: Response,
    session: Session = Depends(get_session),
) -> list[TagPublicOut]:
    no_store(response)
    return [tag_public_out(tag) for tag in service.list_public_tags(session)]
