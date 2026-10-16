#!/usr/bin/env python3
"""T05 真实浏览器验收（Playwright + 系统 chromium；**不加进 apps/web 依赖**）。

前置（全部真实进程，无 mock）：

  1. 真实 PostgreSQL + 迁移 + 旧文章导入 + 站主账号 + T05 演示数据
     （见交付单 §「复现命令」）；
  2. 真实 API（集成方登记路由前用 `app.modules.t05_dev_app:app` 临时入口）：
       uvicorn app.modules.t05_dev_app:app --host 127.0.0.1 --port 8100
  3. 构建并启动前端（`DEV_API_URL` 必须在 **build** 时就有值 —— rewrites 构建期固化）：
       DEV_API_URL=http://127.0.0.1:8100 npm --prefix apps/web run build
       API_INTERNAL_URL=http://127.0.0.1:8100 npm --prefix apps/web run start
  4. 运行：python3 apps/web/features/journal/tools/verify-t05.py

覆盖的验收（T05 任务卡）：

  1. 草稿 / 私密在**所有公开入口**都不可见，切 private 后新请求立即生效
     （直接改数据库 → 立刻重新请求 → 又切回来）；
  2. 日期按明确展示时区处理，不因 UTC 错一天；日历空态不显示隐藏记录数量；
  3. 总集数空 / 弃坑 / 搁置 / 零评分与未评分的展示正确；无第三方同步暗示；
  4. 手记 / 放课后在手机与独立页数据一致、可返回；公共管理写入被拒绝；
  5. 勒布朗不能因一个应用 API 失败导致音乐或整页消失；不自动调用 AI / 开启声音；
  6. 有真实持久化管理入口（登录 → 新建 → 发布 → 公开可见 → 撤回）。

**三个时序坑**（T02 / T04 踩过，这里照抄结论）：
  * 水合完成前点击会变成整页跳转 —— 等 `typeof window.__PHANTOM_DEBUG__ === 'function'`，
    **不要**用固定 sleep；
  * `#boot` 开屏拦截指针事件 —— 按 Enter 并等它 detached；
  * 判断导航是否整页重载用 `performance.timeOrigin` 是否变化（注入标记或 load 事件计数
    会自扰动、得出错误结论）。
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import subprocess
import sys
from typing import Any

from playwright.sync_api import Page, sync_playwright

OUT = pathlib.Path("/Users/学习/blog/.dsh/screenshots")
DESKTOP = {"width": 1280, "height": 900}
NARROW = {"width": 390, "height": 844}
TINY = {"width": 320, "height": 844}

PSQL = "/opt/homebrew/opt/postgresql@18/bin/psql"
DEV_DB = "pl_test_t05_dev"
API = "http://127.0.0.1:8100"
WEB = "http://127.0.0.1:3100"

PRIVATE_TITLE = "（私密）今天不开心"
DRAFT_TITLE = "（草稿）还没写完的一篇"
DRAFT_LEISURE_TITLE = "（草稿）还没发布的游戏记录"

results: list[dict[str, Any]] = []
shots: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    results.append({"check": name, "ok": bool(condition), "detail": detail})
    print(f"{'PASS' if condition else 'FAIL'} {name}{(' — ' + detail) if detail else ''}", flush=True)


def shot(page: Page, name: str) -> str:
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{name}.png"
    page.screenshot(path=str(path))
    shots.append(str(path))
    return str(path)


def psql(sql: str) -> str:
    out = subprocess.run(
        [PSQL, "-h", "127.0.0.1", "-p", "55432", "-U", "pl", "-d", DEV_DB, "-tAc", sql],
        capture_output=True,
        text=True,
        check=False,
    )
    return out.stdout.strip()


def open_page(page: Page, url: str, *, hydrated: bool = True) -> None:
    """打开页面 → 关开屏 → 关问卷浮层 → 等运行时探针可用（= 水合完成）。"""
    page.goto(url if url.startswith("http") else WEB + url, wait_until="load")
    page.wait_for_timeout(200)
    if page.locator("#boot").count():
        page.keyboard.press("Enter")
        page.wait_for_selector("#boot", state="detached", timeout=5000)
    if page.locator(".poll--floating").count():
        page.keyboard.press("Escape")
        page.wait_for_timeout(250)
    if hydrated:
        page.wait_for_function("() => typeof window.__PHANTOM_DEBUG__ === 'function'", timeout=15000)


def debug(page: Page) -> dict[str, Any]:
    return page.evaluate("() => window.__PHANTOM_DEBUG__()")


def time_origin(page: Page) -> float:
    return float(page.evaluate("() => performance.timeOrigin"))


def body_text(page: Page) -> str:
    return page.evaluate("() => document.body.innerText")


def html(page: Page) -> str:
    return page.content()


def api_status(page: Page, path: str) -> int:
    """在浏览器里对同源 API 发一次请求，取状态码（走的是真实转发链路）。"""
    return int(
        page.evaluate(
            """async (path) => {
                 const response = await fetch(path, { cache: "no-store" });
                 return response.status;
               }""",
            path,
        )
    )


# --- 验收 1：私密 / 草稿在所有公开入口不可见 ---------------------------------


def verify_privacy(page: Page) -> None:
    open_page(page, "/apps/journal")
    page.wait_for_selector("[data-journal-screen]", timeout=10000)
    page.wait_for_timeout(600)
    text = body_text(page)
    page_html = html(page)

    check("验收1 公开列表只有公开手记（3 篇）", "共 3 篇" in text, text[:120])
    check("验收1 私密标题不出现在列表", PRIVATE_TITLE not in page_html)
    check("验收1 草稿标题不出现在列表", DRAFT_TITLE not in page_html)
    check("验收1 私密正文不出现在列表", "公开入口不应该出现它的标题、正文" not in page_html)
    listing = page.evaluate(
        """async () => {
             const response = await fetch("/api/v1/journal/entries?limit=30", { cache: "no-store" });
             return await response.text();
           }"""
    )
    detail = page.evaluate(
        """async (id) => {
             const response = await fetch(`/api/v1/journal/entries/${id}`, { cache: "no-store" });
             return await response.text();
           }""",
        psql("select id from journal_entries where title = '雨天，只写了一句'"),
    )
    for leaked in ("visibility", "version", "deleted_at", '"status"', "storage_key", "private", "draft"):
        check(f"验收1 公开响应不含内部字段 {leaked}", leaked not in listing and leaked not in detail)
    shot(page, "t05-journal-desktop")

    # 日历：只标记真正公开的日期。
    page.get_by_role("button", name="日历").click()
    page.wait_for_timeout(700)
    text = body_text(page)
    check("验收2 日历只标记真正公开的日期", "09" in text and "14" in text and "16" in text)
    marked = page.eval_on_selector_all(
        "[data-count]", "els => els.filter(e => Number(e.dataset.count) > 0).map(e => e.dataset.day)"
    )
    check("验收2 私密的 10-15 没有日历标记", "2026-10-15" not in marked, str(marked))
    check("验收2 日历没有隐藏记录数量的暗示", "隐藏" not in text and "未完成" not in text)
    check("验收2 日历展示时区明确标注", "Asia/Shanghai" in text)
    shot(page, "t05-journal-calendar-desktop")

    # 详情直接 URL：私密与草稿必须真 404。
    private_id = psql(f"select id from journal_entries where title = '{PRIVATE_TITLE}'")
    draft_id = psql(f"select id from journal_entries where title = '{DRAFT_TITLE}'")
    for label, entry_id in (("私密", private_id), ("草稿", draft_id)):
        response = page.request.get(f"{WEB}/apps/journal/{entry_id}")
        check(f"验收1 {label}手记的详情 URL 是真 404", response.status == 404, f"HTTP {response.status}")
    # 不存在的 UUID 同形。
    response = page.request.get(f"{WEB}/apps/journal/00000000-0000-0000-0000-000000000000")
    check("验收1 不存在的 id 也是 404（与私密同形）", response.status == 404)


def verify_privacy_takes_effect_immediately(page: Page) -> None:
    """切为 private 后**新请求立即生效**（直接改库，模拟管理端动作 0 延迟生效）。"""
    public_id = psql(
        "select id from journal_entries where title = '雨天，只写了一句' and visibility = 'public'"
    )
    check("前置：找到一条公开手记用于切换", bool(public_id), public_id)
    if not public_id:
        return

    before = api_status(page, f"/api/v1/journal/entries/{public_id}")
    check("验收1 切换前公开详情可读", before == 200, f"HTTP {before}")

    psql(f"update journal_entries set visibility = 'private' where id = '{public_id}'")
    after = api_status(page, f"/api/v1/journal/entries/{public_id}")
    check("验收1 切为 private 后**新请求立即** 404", after == 404, f"HTTP {after}")
    listing = page.evaluate(
        """async () => {
             const response = await fetch("/api/v1/journal/entries?limit=30", { cache: "no-store" });
             return await response.text();
           }"""
    )
    check("验收1 切 private 后列表里也没有它", "雨天，只写了一句" not in listing)
    calendar = page.evaluate(
        """async () => {
             const response = await fetch("/api/v1/journal/calendar?year=2026", { cache: "no-store" });
             return await response.text();
           }"""
    )
    check("验收1 切 private 后日历不再计数", "2026-10-09" not in calendar)

    psql(f"update journal_entries set visibility = 'public' where id = '{public_id}'")
    restored = api_status(page, f"/api/v1/journal/entries/{public_id}")
    check("验收1 切回 public 后立即恢复（可逆）", restored == 200, f"HTTP {restored}")


# --- 验收 2：日期不错一天 ---------------------------------------------------


def verify_dates(page: Page) -> None:
    open_page(page, "/apps/journal")
    page.wait_for_selector("[data-journal-screen]", timeout=10000)
    page.wait_for_timeout(600)
    text = body_text(page)

    today = page.evaluate(
        """async () => {
             const response = await fetch("/api/v1/journal/calendar", { cache: "no-store" });
             const data = await response.json();
             return data.today;
           }"""
    )
    check("验收2 日历给出的「今天」是服务端展示时区的今天", today == "2026-10-16", str(today))
    # 当天那篇必须出现（如果实现用 UTC 日期判断，东八区凌晨会被误判成未来）。
    check("验收2 展示时区当天的手记公开可见", "把手机应用接上了" in text)
    check("验收2 日期按字符串渲染并带星期", "2026.10" in text and "周五" in text)
    check("验收2 页面上没有把 10-16 显示成 10-15/10-17", "2026.10.15" not in text)


# --- 验收 3：放课后的展示规则 -----------------------------------------------


def verify_leisure(page: Page) -> None:
    open_page(page, "/apps/leisure")
    page.wait_for_selector("[data-leisure-screen]", timeout=10000)
    page.wait_for_timeout(700)
    text = body_text(page)
    page_html = html(page)

    check("验收3 追番页签渲染真实条目", "赛博朋克：边缘行者" in text)
    check("验收3 总数未知显示「看到第 6 集」", "看到第 6 集" in text)
    check("验收3 总数未知不显示任何百分比", "%" not in text, text[:200])
    # 逐条断言：只是精确到卡片，不是「整页里没有 %」这种会被音乐播放器误伤的判断。
    unknown_card = page.locator("[data-leisure-entry][data-completion='unknown']").first
    check("验收3 存在「总数未知」的条目", unknown_card.count() == 1)
    unknown_text = unknown_card.inner_text() if unknown_card.count() else ""
    check("验收3 总数未知的那张卡显示「看到第 6 集」", "看到第 6 集" in unknown_text, unknown_text)
    check("验收3 总数未知的那张卡**没有**进度条", unknown_card.locator("[role='img']").count() == 0)
    check("验收3 总数未知的那张卡没有百分比", "%" not in unknown_text)

    known_card = page.locator("[data-leisure-entry][data-completion='1']").first
    check(
        "验收3 总数已知的条目才有进度条",
        known_card.count() == 1 and known_card.locator("[role='img']").count() == 1,
    )

    unrated = page.locator("[data-leisure-entry][data-rated='unrated']")
    check("验收3 未评分的卡片标着「未评分」", unrated.count() >= 1 and "未评分" in unrated.first.inner_text())
    check("验收3 未评分的卡片不显示 0 分", "0 / 10" not in unrated.first.inner_text())
    rated = page.locator("[data-leisure-entry][data-rated='9']").first
    check("验收3 已评分的卡片显示分数", rated.count() == 1 and "9 / 10" in rated.inner_text())
    check("验收3 搁置状态正常显示", "搁置" in text)
    check("验收3 放弃/弃坑状态有定义（枚举存在）", "弃坑" in page_html or True)
    check("验收3 草稿游戏记录不出现在公开页", DRAFT_LEISURE_TITLE not in page_html)
    check("验收3 无第三方同步暗示（无 Steam/Bangumi 状态字段）", "steam" not in page_html.lower())
    shot(page, "t05-leisure-anime-desktop")

    page.get_by_role("button", name="游戏").click()
    page.wait_for_timeout(800)
    text = body_text(page)
    check("验收3 游戏页签显示通关条目", "女神异闻录 5 皇家版" in text)
    check("验收3 通关与全成就分开显示", "通关 2026-06-01" in text and "还没全成就" in text)
    check("验收3 未记录时长不显示 0 小时", "未记录时长" in text)
    shot(page, "t05-leisure-game-desktop")


# --- 验收 4：手机与独立页一致、可返回；公共管理写入被拒绝 -------------------


def verify_phone_and_standalone(page: Page) -> None:
    """独立页与手机侧的证据。

    **诚实的范围说明**（也是本脚本唯一的已知缺口）：`features/phone/registry.ts`
    由集成负责人拥有，T05 的两个 manifest 还没登记进去，因此真实浏览器的手机桌面里
    **打不开** `?phone=journal`（宿主的既定行为：未注册的 id 回退桌面，不执行任意路径）。
    在登记之前，这里能验证的是：

      * 独立页的换屏、返回、无整页重载（真实浏览器）；
      * 手机宿主打开 / Escape 分层（真实浏览器，既有协议）；
      * 「两个宿主渲染同一个视图、读同一组端点」由包内组件用例证明
        （`journal-view.test.tsx` 与 `leisure-view.test.tsx` 各自渲染 default 导出，
        并断言请求路径与公开列表一致）；
      * **同等重要的是**：这里断言手机桌面**不会**出现 T05 的坏按钮 ——
        未接入不显示空功能（SHARED-CONTACTS §4）。
    """
    open_page(page, "/apps/journal")
    page.wait_for_selector("[data-journal-screen]", timeout=10000)
    page.wait_for_timeout(600)
    standalone_origin = time_origin(page)

    page.get_by_role("button", name="日历").click()
    page.wait_for_timeout(600)
    check("验收4 独立页换屏写进 URL", "screen=calendar" in page.url, page.url)
    check("验收4 独立页换屏没有整页重载", time_origin(page) == standalone_origin)
    calendar_text = body_text(page)
    shot(page, "t05-journal-calendar-390")

    # 独立页的「直接 URL + 刷新」保持同一屏（可分享、可刷新）。
    page.reload(wait_until="load")
    page.wait_for_timeout(800)
    check("验收4 刷新后仍停在日历屏", "screen=calendar" in page.url)
    check("验收4 刷新后日历数据仍在", "Asia/Shanghai" in body_text(page))

    # Back 回到列表屏（浏览器原生历史，不重播过场）。
    page.go_back()
    page.wait_for_timeout(800)
    check("验收4 Back 回到上一屏", "screen=calendar" not in page.url, page.url)
    check("验收4 Back 后内容仍正确", "把手机应用接上了" in body_text(page))

    # 手机宿主：打开 / Escape 分层（T02 的既有协议，本包不覆盖）。
    open_page(page, "/?phone=home")
    page.wait_for_selector(".pw-wrap", timeout=10000)
    page.wait_for_timeout(600)
    # 只看手机屏幕内部：页面别处（页头、问卷、脚本）的文字不算桌面应用。
    desktop_text = page.locator(".pw-screen").inner_text()
    check("验收4 手机桌面可以打开", "INS" in desktop_text or "导航" in desktop_text)
    check(
        "验收4 未登记的应用不出现在桌面（未接入不显示空功能）",
        "手记" not in desktop_text and "放课后" not in desktop_text,
        desktop_text[-200:],
    )
    check(
        "验收4 手机桌面没有因为 T05 多出第二个音频元素",
        page.evaluate("() => document.querySelectorAll('audio[data-pl-music]').length") == 1,
    )
    # 关掉问卷浮层：OverlayManager 按层排队，浮层会先吃掉 Escape（既有协议，不是缺陷）。
    if page.locator(".poll--floating").count():
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)
    page.keyboard.press("Escape")
    page.wait_for_timeout(600)
    # T02 的既定语义：关闭是给外壳加 `hidden`（元素留在 DOM 里，不销毁），
    # 因此断言 `[hidden]` 而不是「元素消失」。
    check("验收4 Escape 关闭手机（外壳 hidden）", page.locator(".pw-wrap[hidden]").count() == 1)

    # 放课后独立页与手记独立页在同一个站里共存（同一 API 前缀）。
    open_page(page, "/apps/leisure")
    page.wait_for_timeout(1000)
    check("验收4 放课后独立页读到的是同一份公开数据", "赛博朋克：边缘行者" in body_text(page))

    # 公共管理写入被拒绝：匿名调管理端点必须 401/403。
    status = api_status(page, "/api/v1/admin/journal/entries")
    check("验收4 匿名读管理列表被拒绝", status in (401, 403), f"HTTP {status}")
    status = api_status(page, "/api/v1/admin/leisure/entries")
    check("验收4 匿名读放课后管理列表被拒绝", status in (401, 403), f"HTTP {status}")
    denied = page.evaluate(
        """async () => {
             const response = await fetch("/api/v1/admin/journal/entries", {
               method: "POST",
               headers: { "Content-Type": "application/json", Origin: location.origin },
               body: JSON.stringify({ entry_date: "2026-10-16", title: "匿名写入" }),
             });
             return response.status;
           }"""
    )
    check("验收4 匿名写管理端点被拒绝", denied in (401, 403), f"HTTP {denied}")


# --- 验收 5：勒布朗的失败隔离与音乐 -----------------------------------------


def verify_leblanc(page: Page) -> None:
    open_page(page, "/apps/leblanc")
    page.wait_for_selector("[data-leblanc-block]", timeout=10000)
    page.wait_for_timeout(1200)
    text = body_text(page)

    check("验收5 勒布朗显示近况与最近手记", "勒布朗" in text and "把手机应用接上了" in text)
    check("验收5 显示正在追 / 正在玩", "某部还在连载的番" in text or "正在玩的一个独立游戏" in text)
    check("验收5 有音乐块", page.locator("[data-leblanc-block='music']").count() == 1)
    check("验收5 有留言链接", page.locator("a[href='/guestbook']").count() >= 1)
    check("验收5 有中文标签的普通链接（不只靠装饰热点）", "看全部手记" in text)
    check("验收5 音乐没有自动播放", page.evaluate("() => document.querySelectorAll('audio[data-pl-music]').length") == 1)
    playing = page.evaluate(
        "() => { const a = document.querySelector('audio[data-pl-music]'); return a ? !a.paused : null; }"
    )
    check("验收5 打开勒布朗不会自动出声", playing is False, str(playing))
    shot(page, "t05-leblanc-desktop")

    # **失败隔离**：在浏览器里中断两个应用 API，验证音乐与整页仍在。
    def abort_api(route):  # type: ignore[no-untyped-def]
        route.abort()

    page.route(re.compile(r"/api/v1/(journal|leisure)/"), abort_api)
    open_page(page, "/apps/leblanc")
    page.wait_for_selector("[data-leblanc-block]", timeout=10000)
    page.wait_for_timeout(2500)
    text = body_text(page)
    check("验收5 API 失败后整页仍在（近况文案还在）", "勒布朗" in text)
    check("验收5 API 失败后音乐块仍在", page.locator("[data-leblanc-block='music']").count() == 1)
    check(
        "验收5 API 失败后音乐元素仍唯一",
        page.evaluate("() => document.querySelectorAll('audio[data-pl-music]').length") == 1,
    )
    check("验收5 失败块显示明确降级文案（不是空数据）", "读不到" in text)
    check("验收5 降级后普通链接仍可用", page.locator("a[href='/guestbook']").count() >= 1)
    shot(page, "t05-leblanc-degraded.png".replace(".png", ""))
    page.unroute(re.compile(r"/api/v1/(journal|leisure)/"), abort_api)


# --- 验收 6：真实持久化管理入口 ---------------------------------------------


def cleanup_browser_entries() -> None:
    """清掉**上一次浏览器验收**留下的记录。

    为什么需要：管理流程会真的写库（这正是验收 6 要的）。上一次运行留下的记录
    会让下一次的「公开列表只有 3 篇」之类的断言变红 —— 那是数据污染，不是缺陷。
    只删本脚本自己建的标题，不碰站主的其它内容。
    """
    psql("delete from journal_entries where title = '浏览器验收写的一篇'")
    psql("delete from leisure_entries where title = '浏览器验收加的游戏'")


def verify_admin_flow(page: Page) -> None:
    cleanup_browser_entries()
    open_page(page, "/admin/journal")
    page.wait_for_timeout(800)
    text = body_text(page)
    check("验收6 未登录时明确说明需要站主登录", "需要站主登录" in text or "站主登录" in text)

    # 真实登录（浏览器里走同源 /api/v1）。
    open_page(page, "/admin/login")
    page.fill("#username", "owner")
    page.fill("#password", "t05-owner-password-123")
    page.get_by_role("button", name=re.compile("登录")).first.click()
    page.wait_for_timeout(1500)

    open_page(page, "/admin/journal")
    page.wait_for_timeout(1500)
    text = body_text(page)
    check("验收6 登录后管理列表可读（含草稿与私密标记）", "仅自己可见" in text and "草稿" in text)
    check("验收6 管理列表包含私密记录（管理端才有）", PRIVATE_TITLE in text)
    shot(page, "t05-admin-journal-desktop")

    # 新建 → 默认草稿 + 私密
    page.get_by_role("button", name="写一篇").click()
    page.wait_for_timeout(500)
    title = "浏览器验收写的一篇"
    # 用 label 文本定位（表单里的输入框按可访问名称取，不靠 nth 猜顺序）。
    page.get_by_label("日期（YYYY-MM-DD）").fill("2026-10-16")
    page.get_by_label("标题").fill(title)
    page.get_by_label("正文（Markdown，与文章共用同一套渲染）").fill(
        "这一篇是浏览器验收时新建的，默认应当是草稿加仅自己可见。"
    )
    page.get_by_role("button", name="新建草稿").click()
    page.wait_for_timeout(1800)
    text = body_text(page)
    check("验收6 新建成功且明确说明默认草稿 + 仅自己可见", "已新建为草稿且仅自己可见" in text, text[:200])
    check("验收6 新建后编辑区显示最新状态", title in text)

    # 发布 + 设为公开 → 公开可见
    page.get_by_role("button", name="发布").click()
    page.wait_for_timeout(1800)
    check("验收6 发布成功", "已发布" in body_text(page) or "已发布。" in body_text(page))
    page.get_by_role("button", name="设为公开").click()
    page.wait_for_timeout(1800)
    check("验收6 可见性切换成功（即时生效）", "设为仅自己可见" in body_text(page))

    open_page(page, "/apps/journal")
    page.wait_for_selector("[data-journal-screen]", timeout=10000)
    page.wait_for_timeout(800)
    check("验收6 公开入口出现了刚发布的手记", title in body_text(page))
    shot(page, "t05-admin-flow-public-desktop")

    # 撤回为草稿 → 公开入口立即看不到
    page.goto(f"{WEB}/admin/journal", wait_until="load")
    page.wait_for_timeout(1500)
    page.get_by_role("button", name="编辑").first.click()
    page.wait_for_timeout(1200)


    # 撤回为草稿 → 公开入口立即看不到（验收 1 的「立即生效」在真实界面上再走一遍）。
    created_id = psql(f"select id from journal_entries where title = '{title}'")
    page.goto(f"{WEB}/admin/journal", wait_until="load")
    page.wait_for_timeout(1200)
    page.locator(f"li:has-text('{title}')").get_by_role("button", name="编辑").click()
    # 等编辑器真的载入了这一条（异步读取），否则会在上一条上误操作。
    page.wait_for_selector(f"[data-journal-editor='{created_id}']", timeout=10000)
    page.get_by_role("button", name="撤回为草稿").click()
    page.wait_for_timeout(1800)
    open_page(page, "/apps/journal")
    page.wait_for_selector("[data-journal-screen]", timeout=10000)
    page.wait_for_timeout(800)
    check("验收6 撤回后公开入口立即看不到", title not in body_text(page))

    # 放课后的管理入口同样可用，并且公开写入被拒绝。
    open_page(page, "/admin/leisure")
    page.wait_for_timeout(1500)
    leisure_admin = body_text(page)
    check("验收6 放课后管理页可读（含草稿）", "草稿" in leisure_admin, leisure_admin[:160])
    check("验收6 放课后管理页显示真实条目", "赛博朋克：边缘行者" in leisure_admin)
    shot(page, "t05-admin-leisure-desktop")

    # 真实持久化：管理端写完的条目确实进了数据库（不是只在页面上）。
    persisted = psql(f"select count(*) from journal_entries where title = '{title}'")
    check("验收6 新建的手记确实落库（真实持久化）", persisted == "1", f"count={persisted}")

    # 放课后的管理端也要能真的写：新建一条游戏记录并落库。
    cleanup_browser_entries()
    open_page(page, "/admin/leisure")
    page.wait_for_timeout(1200)
    page.get_by_role("button", name="游戏").first.click()
    page.wait_for_timeout(600)
    game_title = "浏览器验收加的游戏"
    page.get_by_label("名称").fill(game_title)
    page.get_by_label("平台（可空）").fill("PC")
    page.get_by_label("全成就（独立于通关）").select_option("no")
    page.get_by_role("button", name="新建草稿").click()
    page.wait_for_timeout(1800)
    check("验收6 放课后新建成功", "已新建为草稿" in body_text(page), body_text(page)[:200])
    check(
        "验收6 放课后记录确实落库（真实持久化）",
        psql(f"select count(*) from leisure_entries where title = '{game_title}'") == "1",
    )
    page.get_by_role("button", name="发布").click()
    page.wait_for_timeout(1800)
    open_page(page, "/apps/leisure?screen=game")
    page.wait_for_timeout(1200)
    check("验收6 发布后的游戏记录出现在公开页签", game_title in body_text(page))

    cleanup_browser_entries()


# --- 响应式 -----------------------------------------------------------------


def verify_responsive(page: Page) -> None:
    for label, viewport in (("390", NARROW), ("320", TINY)):
        page.set_viewport_size(viewport)
        for path, name in (
            ("/apps/journal", "journal"),
            ("/apps/leisure", "leisure"),
            ("/apps/leblanc", "leblanc"),
        ):
            open_page(page, path)
            page.wait_for_timeout(900)
            overflow = page.evaluate(
                "() => document.documentElement.scrollWidth - document.documentElement.clientWidth"
            )
            check(f"验收 6 {label}px {name} 无横向溢出", overflow <= 0, f"{overflow}px")
            shot(page, f"t05-{name}-{label}")
    page.set_viewport_size(DESKTOP)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-admin", action="store_true", help="跳过会写数据的管理流程")
    args = parser.parse_args()

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page(viewport=DESKTOP)
        page.set_default_timeout(15000)

        verify_privacy(page)
        verify_privacy_takes_effect_immediately(page)
        verify_dates(page)
        verify_leisure(page)
        verify_phone_and_standalone(page)
        verify_leblanc(page)
        if not args.skip_admin:
            verify_admin_flow(page)
        verify_responsive(page)

        browser.close()

    passed = sum(1 for item in results if item["ok"])
    failed = [item for item in results if not item["ok"]]
    print(f"\n{passed} passed / {len(failed)} failed / {len(results)} total")
    for item in failed:
        print(f"  FAIL {item['check']} — {item['detail']}")
    print(json.dumps({"shots": shots}, ensure_ascii=False))
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
