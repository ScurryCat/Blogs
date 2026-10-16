"""角色消息模块（T08）。

对外只有三件事需要被别处引用：
  - `router`：由 T00 登记到 `MODULE_ROUTER_TARGETS`；
  - `models`：由 T00 登记到 `MODEL_MODULES`；
  - `stories` / `characters`：版本化的剧本与角色卡（仓库文件，不是数据库表）。

本模块**不碰**站主会话表 `sessions`、不注册媒体公开引用、不注册公开标签来源，
详见 `wiring.py`。
"""

from __future__ import annotations

__all__ = ["models", "router", "service", "stories", "wiring"]
