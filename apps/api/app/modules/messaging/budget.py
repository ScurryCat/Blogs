"""预算与并发限制（08 §7 / 验收用例「请求预算跨重启、并发请求」「AI 超时 / 额度耗尽 / 重试」）。

为什么不能只用内存或 Cookie 计数：
  - 匿名 Cookie 可以被访客随手清掉 —— 清掉就重置额度，等于没有限额；
  - 内存计数在 API 重启后归零，在 uvicorn 多 worker 下每个 worker 一份，
    因此**不能**用来承诺硬预算。

这里的做法：所有计数都在 PostgreSQL 里，用**单条原子 UPDATE** 预留：

```sql
update ai_budget_days
   set reserved_units = reserved_units + :units,
       request_count  = request_count + 1
 where day = :day
   and reserved_units + :units <= :limit
returning reserved_units
```

命中 0 行即「额度不够」。并发请求里只有一个能把计数推过阈值，因此不会超卖。

失败处理（08 §7「失败释放或按真实上游费用结算；已经产生的成本不能假装撤销」）：

  - `release`：**没有真正打到上游**的失败（配置不全 / 被停用）→ 退还预留，
    不计入当天请求数；
  - `settle`：已经打到上游的失败（超时 / 传输错误 / 上游 5xx / 输出不可用）
    → 预留转为已结算，请求数保留。网络异常不能承诺零成本，但必须记录。

`request_count` / `requests` 与 `reserved_units` 的语义差异是刻意的：
前者是「尝试次数」（用于每访客每天 N 次），后者是「费用单位」（用于全站日预算）。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.core.db import utcnow
from app.modules.messaging import models as m
from app.modules.messaging.ai.base import AI_ERROR_NOT_CONFIGURED
from app.modules.messaging.config import MessagingSettings

# 预算拒绝的机器码。它们会变成对外的 `ai.status`（稳定、可断言）。
REASON_VISITOR_LIMIT = "visitor_daily_limit"
REASON_SITE_BUDGET = "site_daily_budget"
REASON_SITE_CONCURRENCY = "site_concurrency"
REASON_CONVERSATION_INFLIGHT = "conversation_inflight"
REASON_IP_RATE_LIMIT = "ip_rate_limit"
REASON_DISABLED = "disabled"

# 只有「根本没打到上游」的失败才退还额度。
REFUNDABLE_CODES = (AI_ERROR_NOT_CONFIGURED,)


def utc_day(now: datetime | None = None) -> date:
    """预算的日期桶一律是 **UTC 日**，与「保留 24 小时」用同一套时间基准。"""
    return (now or utcnow()).date()


@dataclass(frozen=True)
class BudgetRefusal:
    """一次被拒绝的预留。`reason` 是机器码，`message` 是给访客看的原因。"""

    reason: str
    message: str
    retry_after_seconds: int | None = None


@dataclass(frozen=True)
class Reservation:
    """预留成功的结果。`units` 是预留量，用于后续 settle / release。"""

    visitor_session_id: object
    day: date
    units: int


def _ensure_row(session: Session, table: str, day: date, visitor_id=None) -> None:
    """插入当天的计数器行（幂等）。并发下由 ON CONFLICT 保证只有一行。"""
    if table == "ai_budget_days":
        session.execute(
            text(
                "insert into ai_budget_days (day, reserved_units, settled_units, request_count, updated_at) "
                "values (:day, 0, 0, 0, now()) on conflict (day) do nothing"
            ),
            {"day": day},
        )
    else:
        session.execute(
            text(
                "insert into ai_visitor_days "
                "(visitor_session_id, day, requests, reserved_units, settled_units, updated_at) "
                "values (:vid, :day, 0, 0, 0, now()) "
                "on conflict (visitor_session_id, day) do nothing"
            ),
            {"vid": visitor_id, "day": day},
        )


def reserve(
    session: Session,
    *,
    visitor_session_id,
    day: date,
    units: int,
    settings: MessagingSettings,
) -> Reservation | BudgetRefusal:
    """原子预留。返回 `Reservation` 或 `BudgetRefusal`（**不抛异常**，调用方决定降级文案）。

    顺序：先访客额度，再全站预算。任何一步失败都会把已经成功的那一步退回去，
    因此不会出现「访客额度没扣但全站预算被扣」这种对不上账的状态。
    """
    units = max(1, int(units))

    _ensure_row(session, "ai_visitor_days", day, visitor_session_id)
    visitor_ok = session.execute(
        text(
            "update ai_visitor_days "
            "   set requests = requests + 1, "
            "       reserved_units = reserved_units + :units, "
            "       updated_at = now() "
            " where visitor_session_id = :vid and day = :day "
            "   and requests + 1 <= :limit "
            "returning requests"
        ),
        {
            "vid": visitor_session_id,
            "day": day,
            "units": units,
            "limit": settings.visitor_daily_requests,
        },
    ).first()
    if visitor_ok is None:
        return BudgetRefusal(
            REASON_VISITOR_LIMIT,
            f"自由聊天今天已经用过 {settings.visitor_daily_requests} 次，明天再来。",
        )

    _ensure_row(session, "ai_budget_days", day)
    site_ok = session.execute(
        text(
            # 日预算必须把**已结算**的部分也算进去：结算会把 reserved 减回去，
            # 只看 reserved 的话「用一次、结算一次」就等于额度永远用不完 ——
            # 这正是 T08 自测时抓到的错误账本（见交付单 §5）。
            "update ai_budget_days "
            "   set reserved_units = reserved_units + :units, "
            "       request_count = request_count + 1, "
            "       updated_at = now() "
            " where day = :day "
            "   and reserved_units + settled_units + :units <= :limit "
            "returning reserved_units"
        ),
        {"day": day, "units": units, "limit": settings.site_daily_units},
    ).first()
    if site_ok is None:
        _refund_visitor(session, visitor_session_id=visitor_session_id, day=day, units=units)
        return BudgetRefusal(
            REASON_SITE_BUDGET,
            "今天全站的自由聊天额度已经用完，剧情仍然可以继续。",
        )

    return Reservation(visitor_session_id=visitor_session_id, day=day, units=units)


def _refund_visitor(session: Session, *, visitor_session_id, day: date, units: int) -> None:
    session.execute(
        text(
            "update ai_visitor_days "
            "   set requests = greatest(requests - 1, 0), "
            "       reserved_units = greatest(reserved_units - :units, 0) "
            " where visitor_session_id = :vid and day = :day"
        ),
        {"vid": visitor_session_id, "day": day, "units": units},
    )


def settle(session: Session, request_row: m.AiRequest, *, units: int | None = None) -> int:
    """把预留转为已结算（成本已产生）。返回实际结算的单位数。

    `units=None` 表示「按预留量结算」——这是「已经产生的成本不能假装撤销」
    的默认行为。真实供应商接上后可以传入按 token 计算的真实用量。
    """
    reserved = int(request_row.reserved_units)
    settled = reserved if units is None else max(0, int(units))
    session.execute(
        text(
            "update ai_budget_days "
            "   set reserved_units = greatest(reserved_units - :reserved, 0), "
            "       settled_units = settled_units + :settled, "
            "       updated_at = now() "
            " where day = :day"
        ),
        {"reserved": reserved, "settled": settled, "day": request_row.day},
    )
    session.execute(
        text(
            "update ai_visitor_days "
            "   set reserved_units = greatest(reserved_units - :reserved, 0), "
            "       settled_units = settled_units + :settled, "
            "       updated_at = now() "
            " where visitor_session_id = :vid and day = :day"
        ),
        {
            "reserved": reserved,
            "settled": settled,
            "vid": request_row.visitor_session_id,
            "day": request_row.day,
        },
    )
    request_row.settled_units = settled
    return settled


def release(session: Session, request_row: m.AiRequest, *, refund_request_count: bool = True) -> None:
    """退还预留：**没有真正打到上游**的失败走这里（配置不全 / 被停用）。"""
    reserved = int(request_row.reserved_units)
    session.execute(
        text(
            "update ai_budget_days "
            "   set reserved_units = greatest(reserved_units - :reserved, 0), "
            "       request_count = greatest(request_count - :refund, 0), "
            "       updated_at = now() "
            " where day = :day"
        ),
        {
            "reserved": reserved,
            "refund": 1 if refund_request_count else 0,
            "day": request_row.day,
        },
    )
    session.execute(
        text(
            "update ai_visitor_days "
            "   set reserved_units = greatest(reserved_units - :reserved, 0), "
            "       requests = greatest(requests - :refund, 0), "
            "       updated_at = now() "
            " where visitor_session_id = :vid and day = :day"
        ),
        {
            "reserved": reserved,
            "refund": 1 if refund_request_count else 0,
            "vid": request_row.visitor_session_id,
            "day": request_row.day,
        },
    )
    request_row.settled_units = 0


# --- 并发闸门 --------------------------------------------------------------


def inflight_count(session: Session, *, now: datetime | None = None, settings: MessagingSettings) -> int:
    """全站在途 AI 请求数。

    只统计**新鲜**的 `pending` 行：一个进程崩在调用中途时，那一行会永远停在
    `pending`（部分唯一索引也就永远挡住这个会话）。用超时窗口把崩溃残留排除掉，
    这样「单会话一在途」不会被一次崩溃永久锁死。
    """
    horizon = (now or utcnow()) - timedelta(seconds=settings.ai_timeout_seconds + 30)
    return int(
        session.execute(
            select(func.count())
            .select_from(m.AiRequest)
            .where(m.AiRequest.status == m.AI_PENDING, m.AiRequest.created_at > horizon)
        ).scalar_one()
    )


def conversation_has_inflight(session: Session, conversation_id) -> bool:
    return (
        session.execute(
            select(m.AiRequest.id).where(
                m.AiRequest.conversation_id == conversation_id,
                m.AiRequest.status == m.AI_PENDING,
            )
        ).first()
        is not None
    )


def ip_requests_in_window(
    session: Session, *, ip_hash: str | None, now: datetime | None = None
) -> int:
    """同一 IP 摘要最近一分钟的请求数。没有 IP 摘要时返回 0（由调用方决定是否拒绝）。"""
    if not ip_hash:
        return 0
    horizon = (now or utcnow()) - timedelta(minutes=1)
    return int(
        session.execute(
            select(func.count())
            .select_from(m.AiRequest)
            .join(m.VisitorSession, m.VisitorSession.id == m.AiRequest.visitor_session_id)
            .where(m.VisitorSession.ip_hash == ip_hash, m.AiRequest.created_at > horizon)
        ).scalar_one()
    )


# --- 只读用量（管理页与 /status 用；「成本不被静默隐藏」）------------------


@dataclass(frozen=True)
class UsageSnapshot:
    day: date
    site_reserved_units: int
    site_settled_units: int
    site_request_count: int
    site_daily_units: int
    visitor_requests: int | None
    visitor_daily_requests: int
    inflight: int


def usage_snapshot(
    session: Session,
    *,
    day: date,
    settings: MessagingSettings,
    visitor_session_id=None,
    now: datetime | None = None,
) -> UsageSnapshot:
    site = session.get(m.AiBudgetDay, day)
    visitor_requests: int | None = None
    if visitor_session_id is not None:
        row = session.get(m.AiVisitorDay, {"visitor_session_id": visitor_session_id, "day": day})
        visitor_requests = int(row.requests) if row is not None else 0
    return UsageSnapshot(
        day=day,
        site_reserved_units=int(site.reserved_units) if site else 0,
        site_settled_units=int(site.settled_units) if site else 0,
        site_request_count=int(site.request_count) if site else 0,
        site_daily_units=settings.site_daily_units,
        visitor_requests=visitor_requests,
        visitor_daily_requests=settings.visitor_daily_requests,
        inflight=inflight_count(session, now=now, settings=settings),
    )


def stale_pending_horizon(*, now: datetime | None = None, settings: MessagingSettings) -> datetime:
    return (now or utcnow()) - timedelta(seconds=settings.ai_timeout_seconds + 30)


__all__ = [
    "REFUNDABLE_CODES",
    "REASON_CONVERSATION_INFLIGHT",
    "REASON_DISABLED",
    "REASON_IP_RATE_LIMIT",
    "REASON_SITE_BUDGET",
    "REASON_SITE_CONCURRENCY",
    "REASON_VISITOR_LIMIT",
    "BudgetRefusal",
    "Reservation",
    "UsageSnapshot",
    "conversation_has_inflight",
    "inflight_count",
    "ip_requests_in_window",
    "release",
    "reserve",
    "settle",
    "stale_pending_horizon",
    "usage_snapshot",
    "utc_day",
]
