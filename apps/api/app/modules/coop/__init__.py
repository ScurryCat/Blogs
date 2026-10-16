"""COOP 模块（T07）：友链通讯录。

    models       friend_links / friend_link_tags（无 RANK、无点击量、无在线状态）
    urls         外链地址的 http(s) 规范化与拒绝规则
    schemas      公开 / 管理 DTO
    service      公开查询与管理写入
    router       `/coop/*` 公开 + `/admin/friends/*` 管理
    wiring       媒体公开引用检查的登记入口（头像）

路由与模型由集成负责人登记（SHARED-CONTRACTS §2）：本包不修改
`app/router.py`、`app/model_registry.py`、`app/main.py` 或 `migrations/`。
"""

from __future__ import annotations

__all__: list[str] = []
