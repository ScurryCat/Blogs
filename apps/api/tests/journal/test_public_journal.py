"""公开手记：列表、详情、分页、时区与日历细节（验收 2、3、4）。

重点：
  - 日期是**日历日期**，按明确展示时区判断「今天」，不因 UTC 转换错一天（验收 2）；
  - 同一日期多条时游标分页不漏不重；
  - 游标与筛选指纹绑定（换 year / month 复用旧游标 → 400）；
  - 公开字段集固定，不泄漏管理字段。
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.modules.journal.models import (
    DISPLAY_TIMEZONE,
    STATUS_DRAFT,
    STATUS_PUBLISHED,
    VISIBILITY_PRIVATE,
    VISIBILITY_PUBLIC,
    JournalEntry,
    display_today,
)
from tests.journal.helpers import (
    assert_error,
    make_entry,
    make_public_entry,
    unique_title,
)

UTC = timezone.utc

PUBLIC_SUMMARY_KEYS = {
    "id",
    "entry_date",
    "title",
    "excerpt",
    "mood",
    "location",
    "images",
}
PUBLIC_DETAIL_KEYS = PUBLIC_SUMMARY_KEYS | {"content_md", "post"}


def test_display_today_uses_the_declared_timezone():
    """展示时区是显式常量，不是服务器本地时区。

    UTC 的 2026-10-16T16:30Z 在东八区已经是 10-17 的 00:30 —— 这正是
    「按 UTC 格式化错一天」的经典场景。`display_today()` 必须给出 10-17。
    """
    moment = datetime(2026, 10, 16, 16, 30, tzinfo=UTC)
    assert display_today(moment) == date(2026, 10, 17)
    assert moment.astimezone(DISPLAY_TIMEZONE).date() == date(2026, 10, 17)
    # 同一时刻的 UTC 日期是 10-16：如果实现用了 UTC，这里会失败。
    assert moment.date() == date(2026, 10, 16)


def test_entry_dated_today_in_display_timezone_is_visible(public_journal_client, t05_session: Session):
    """展示时区的「今天」当天就可见，不等 UTC 跨天。

    对应上面那个 16:30Z 的场景：如果实现用 UTC 日期判断，东八区凌晨 0:30 写的
    「今天」会被当成未来而隐藏 —— 这是真实会发生的错一天。
    """
    today = display_today()
    entry = make_public_entry(t05_session, entry_date=today, title=unique_title("今天"))
    tomorrow = make_public_entry(
        t05_session, entry_date=today + timedelta(days=1), title=unique_title("明天")
    )

    listing = public_journal_client.get("/api/v1/journal/entries")
    assert listing.status_code == 200, listing.text
    titles = [item["title"] for item in listing.json()["items"]]
    assert entry.title in titles
    assert tomorrow.title not in titles, "展示时区的明天还没到，不应公开"


def test_public_list_is_ordered_by_date_desc(public_journal_client, t05_session: Session):
    dates = [date(2024, 9, 30), date(2024, 10, 2), date(2024, 10, 1)]
    for day in dates:
        make_public_entry(t05_session, entry_date=day, title=unique_title(day.isoformat()))

    response = public_journal_client.get("/api/v1/journal/entries", params={"year": 2024})
    assert response.status_code == 200, response.text
    returned = [item["entry_date"] for item in response.json()["items"]]
    assert returned == ["2024-10-02", "2024-10-01", "2024-09-30"]


def test_public_list_summary_excerpt_does_not_leak_full_content(
    public_journal_client, t05_session: Session
):
    """列表只给第一段摘要，不把整篇 Markdown 顺出来。"""
    secret_tail = "这一行只应该出现在正文页里。"
    make_public_entry(
        t05_session,
        entry_date=date(2013, 10, 4),
        title=unique_title("摘要"),
        content_md=f"第一段摘要。\n\n{secret_tail}",
    )
    response = public_journal_client.get("/api/v1/journal/entries", params={"year": 2013})
    assert response.status_code == 200, response.text
    item = response.json()["items"][0]
    assert set(item) == PUBLIC_SUMMARY_KEYS
    assert item["excerpt"] == "第一段摘要。"
    assert secret_tail not in response.text


def test_public_detail_has_the_fixed_field_set(public_journal_client, t05_session: Session):
    entry = make_public_entry(
        t05_session,
        entry_date=date(2012, 10, 6),
        title=unique_title("详情"),
        content_md="# 标题\n\n正文。",
        mood="平静",
        location="涩谷",
    )
    response = public_journal_client.get(f"/api/v1/journal/entries/{entry.id}")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert set(payload) == PUBLIC_DETAIL_KEYS
    assert payload["content_md"] == "# 标题\n\n正文。"
    assert payload["mood"] == "平静"
    assert payload["location"] == "涩谷"
    assert payload["post"] is None
    for leaked in ("version", "status", "visibility", "deleted_at", "created_at"):
        assert leaked not in payload


def test_pagination_covers_same_date_without_gaps_or_duplicates(
    public_journal_client, t05_session: Session
):
    """同一天多条：limit=2 翻三页，不漏不重。"""
    same_day = date(2019, 8, 8)  # 独占的年份：断言不会被别的用例的日期串味
    created = [make_public_entry(t05_session, entry_date=same_day) for _ in range(5)]
    expected = {entry.id for entry in created}

    seen: list[str] = []
    cursor: str | None = None
    for _ in range(5):
        params = {"year": 2019, "limit": 2}
        if cursor:
            params["cursor"] = cursor
        response = public_journal_client.get("/api/v1/journal/entries", params=params)
        assert response.status_code == 200, response.text
        payload = response.json()
        seen.extend(item["id"] for item in payload["items"])
        cursor = payload["next_cursor"]
        if cursor is None:
            break

    assert cursor is None, "还有下一页时 next_cursor 不应为 null"
    assert len(seen) == len(set(seen)) == 5
    assert set(seen) == {str(entry_id) for entry_id in expected}


def test_cursor_is_bound_to_filters(public_journal_client, t05_session: Session):
    """换筛选（year / month）后继续用旧游标 → 400，不静默当成第一页。"""
    for day in (date(2014, 7, 1), date(2014, 7, 2), date(2014, 7, 3)):
        make_public_entry(t05_session, entry_date=day)

    first = public_journal_client.get(
        "/api/v1/journal/entries", params={"year": 2014, "limit": 1}
    )
    cursor = first.json()["next_cursor"]
    assert cursor

    switched = public_journal_client.get(
        "/api/v1/journal/entries", params={"year": 2014, "month": 6, "limit": 1, "cursor": cursor}
    )
    assert_error(switched, status=400, code="VALIDATION_FAILED")

    broken = public_journal_client.get(
        "/api/v1/journal/entries", params={"year": 2014, "limit": 1, "cursor": "not-a-cursor"}
    )
    assert_error(broken, status=400, code="VALIDATION_FAILED")


def test_calendar_groups_by_month_newest_first(public_journal_client, t05_session: Session):
    make_public_entry(t05_session, entry_date=date(2016, 5, 4))
    make_public_entry(t05_session, entry_date=date(2016, 5, 4))
    make_public_entry(t05_session, entry_date=date(2016, 6, 1))

    response = public_journal_client.get("/api/v1/journal/calendar")
    assert response.status_code == 200, response.text
    months = response.json()["months"]
    assert [month["month"] for month in months] == ["2016-06", "2016-05"]
    assert months[0]["days"] == {"2016-06-01": 1}
    assert months[1]["days"] == {"2016-05-04": 2}
    assert response.json()["total_entries"] == 3


def test_calendar_month_filter(public_journal_client, t05_session: Session):
    """`month` 只返回那一个月，且**不会**把同年其它月份一起带出来。"""
    make_public_entry(t05_session, entry_date=date(2018, 1, 1))
    make_public_entry(t05_session, entry_date=date(2018, 2, 1))

    response = public_journal_client.get(
        "/api/v1/journal/calendar", params={"year": 2018, "month": 2}
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["months"] == [{"month": "2018-02", "days": {"2018-02-01": 1}}]
    assert payload["total_entries"] == 1

    both = public_journal_client.get("/api/v1/journal/calendar", params={"year": 2018})
    assert [month["month"] for month in both.json()["months"]] == ["2018-02", "2018-01"]


def test_calendar_today_matches_display_timezone(public_journal_client):
    response = public_journal_client.get("/api/v1/journal/calendar")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["today"] == display_today().isoformat()
    assert payload["timezone"] == "Asia/Shanghai"


def test_calendar_and_list_come_from_the_same_data(public_journal_client, t05_session: Session):
    """日历计数与列表条数必须一致（同一份公开条件，不造不存在的日记）。"""
    for day in (date(2015, 4, 1), date(2015, 4, 1), date(2015, 4, 2)):
        make_public_entry(t05_session, entry_date=day)
    make_entry(
        t05_session,
        entry_date=date(2015, 4, 3),
        status=STATUS_PUBLISHED,
        visibility=VISIBILITY_PRIVATE,
    )

    listing = public_journal_client.get(
        "/api/v1/journal/entries", params={"year": 2015, "month": 4, "limit": 30}
    ).json()
    calendar = public_journal_client.get(
        "/api/v1/journal/calendar", params={"year": 2015, "month": 4}
    ).json()

    assert len(listing["items"]) == 3
    assert sum(calendar["months"][0]["days"].values()) == 3
    assert "2015-04-03" not in calendar["months"][0]["days"]


def test_list_rejects_out_of_range_filters(public_journal_client):
    assert public_journal_client.get(
        "/api/v1/journal/entries", params={"month": 13}
    ).status_code == 422
    assert public_journal_client.get(
        "/api/v1/journal/entries", params={"limit": 31}
    ).status_code == 422
    assert public_journal_client.get(
        "/api/v1/journal/entries", params={"limit": 0}
    ).status_code == 422


def test_public_endpoints_are_no_store(public_journal_client, t05_session: Session):
    entry = make_public_entry(t05_session, entry_date=date(2011, 10, 10))
    for path in (
        "/api/v1/journal/entries",
        f"/api/v1/journal/entries/{entry.id}",
        "/api/v1/journal/calendar",
    ):
        response = public_journal_client.get(path)
        assert response.status_code == 200, response.text
        assert response.headers["Cache-Control"] == "no-store", path


def test_entry_date_round_trips_as_a_plain_calendar_date(t05_session: Session, t05_settings):
    """服务层不会把 `date` 变成时刻：写进去什么日期，读出来还是那个日期。"""
    from app.modules.journal import service

    entry = make_public_entry(t05_session, entry_date=date(2019, 12, 31))
    read_back = service.get_public_entry(t05_session, entry.id)
    assert read_back is not None
    assert read_back.entry_date == date(2019, 12, 31)
    assert isinstance(read_back.entry_date, date)
    # 数据库里也是 date 而不是 timestamptz。
    from sqlalchemy import text

    column_type = t05_session.execute(
        text(
            "select data_type from information_schema.columns "
            "where table_name = 'journal_entries' and column_name = 'entry_date'"
        )
    ).scalar_one()
    assert column_type == "date", f"entry_date 应该是 date，实际是 {column_type}"


def test_seeded_entry_is_actually_persisted(t05_session: Session):
    """夹具写入的记录确实在数据库里（防止「夹具没生效、测试却通过」）。"""
    entry = make_entry(t05_session, entry_date=date(2010, 1, 1), title=unique_title("持久化"))
    t05_session.expire_all()
    fetched = t05_session.get(JournalEntry, entry.id)
    assert fetched is not None
    assert fetched.title == entry.title
    assert fetched.visibility == VISIBILITY_PRIVATE
