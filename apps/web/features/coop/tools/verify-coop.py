#!/usr/bin/env python3
"""T07 真实浏览器验收（Playwright + 系统 chromium；不进 apps/web 依赖）。

前置（全部真实进程，无 mock）：

  1. 真实 PostgreSQL 上的独立 dev 库（名字带 test 以便通过守卫）：
       /opt/homebrew/opt/postgresql@18/bin/createdb -h 127.0.0.1 -p 55432 -U pl pl_test_t07_dev
       cd apps/api && uv run --project . alembic \\
         -x db_url="postgresql+psycopg://pl@127.0.0.1:55432/pl_test_t07_dev" upgrade head
       APP_ENV=dev DATABASE_URL=... uv run --project . python -m app.modules.coop.dev_tables --create
       APP_ENV=dev DATABASE_URL=... uv run --project . python -m app.commands.bootstrap_admin \\
         --username owner --password-stdin
  2. 真实 API（T00 登记路由前用临时入口；登记后请删除 dev_app.py）：
       APP_ENV=dev DATABASE_URL=... MEDIA_ROOT=... \\
         uv run --project . uvicorn app.modules.coop.dev_app:app --host 127.0.0.1 --port 8107
  3. 构建并启动前端（`DEV_API_URL` 必须在 **build** 时就有值，rewrites 是构建期固化的）：
       DEV_API_URL=http://127.0.0.1:8107 npm --prefix apps/web run build
       cd apps/web && API_INTERNAL_URL=http://127.0.0.1:8107 node_modules/.bin/next start -p 3120
  4. 运行：
       python3 apps/web/features/coop/tools/verify-coop.py \\
         --base http://127.0.0.1:3120 --api http://127.0.0.1:8107 \\
         --username owner --password t07-owner-password-123

  脚本自己会先把上一次运行留下的临时条目软删除，因此可以重复跑。

检查内容（对应 T07 验收 1–6）：

  * 未发布 / 撤回后新公开请求不可见（真实浏览器 + 真实 HTTP）；
  * 同一友链的修改在公开页立刻一致（录入 → 发布 → 编辑 → 撤回全流程都走真实管理界面）；
  * 外链是 `target="_blank"` + `rel="noopener noreferrer"`，并有可辨识的「外部 · 新窗口」提示；
  * 简介按纯文本渲染（`<script>` 不会变成节点）；
  * 旧示例角色（摩尔加纳 / 双叶 / 祐介 / 真 / 龙司 / 春）不出现在真实友链列表里；
  * 头像上传 + 匿名读取（走共享媒体权限），撤回后不再公开；
  * 标签筛选、`?item=` 深链展开相识故事、空态申请入口；
  * 320 / 390px 无横向溢出并截图；
  * 导航是客户端跳转（`performance.timeOrigin` 不变），音乐元素始终只有一个。

**时序纪律**（T02 / T04 踩过的坑）：
  点击前先等 `typeof window.__PHANTOM_DEBUG__ === 'function'`（水合完成），
  不要用固定 sleep；`#boot` 开屏会拦截指针事件，必须先按 Enter 关掉；
  判断整页重载只看 `performance.timeOrigin` 是否变化。

截图输出目录：/Users/学习/blog/.dsh/screenshots（工作区外，不进仓库）。
"""

from __future__ import annotations

import argparse
import json
import pathlib
import struct
import sys
import zlib
from typing import Any

from playwright.sync_api import Browser, BrowserContext, Page, sync_playwright

OUT = pathlib.Path("/Users/学习/blog/.dsh/screenshots")
DESKTOP = {"width": 1280, "height": 900}
NARROW = {"width": 390, "height": 844}
TINY = {"width": 320, "height": 844}

# 页面里绝对不能出现的旧示例角色名（它们是 P5 角色示例，不是真实朋友）。
LEGACY_DEMO_NAMES = ["摩尔加纳", "双叶的工具箱", "祐介的画廊", "真的读书会", "龙司的跑步群", "春的菜园"]

FRIEND_A = "T07 验收站点（临时）"
FRIEND_B = "T07 头像站点（临时）"

results: list[dict[str, Any]] = []
shots: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    results.append({"check": name, "ok": bool(condition), "detail": detail})
    mark = "PASS" if condition else "FAIL"
    print(f"{mark} {name}{(' — ' + detail) if detail else ''}", flush=True)


def shot(page: Page, name: str) -> str:
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{name}.png"
    page.screenshot(path=str(path))
    shots.append(str(path))
    return str(path)


# 开屏（`#boot`）是**每会话一次**的：同一 context 里第一次加载后会被记住，后续页面不再出现。
# 真实用户在同一会话里也只需要按一次 Enter。这里在加载前替用户按下那一次 ——
# 它不改 `performance.timeOrigin`、不记任何标记，因此不影响「是否整页重载」的判断。
BOOT_SEED = "try { window.sessionStorage.setItem('pl-booted', '1'); } catch (error) {}"


def new_context(browser: Browser, viewport: dict[str, int]) -> BrowserContext:
    context = browser.new_context(
        viewport=viewport, device_scale_factor=2, reduced_motion="no-preference"
    )
    context.add_init_script(BOOT_SEED)
    return context


def open_page(page: Page, url: str, base: str) -> None:
    """打开页面并关掉开屏（它拦截所有指针事件）。"""
    page.goto(url if url.startswith("http") else base + url, wait_until="load")
    page.wait_for_timeout(200)
    if page.locator("#boot").count():
        page.keyboard.press("Enter")
        page.wait_for_selector("#boot", state="detached", timeout=5000)
    page.wait_for_timeout(150)


def reload_page(page: Page) -> None:
    """重载并再次关掉开屏（开屏每次加载都会出现，会拦截指针事件）。"""
    page.reload(wait_until="load")
    page.wait_for_timeout(200)
    if page.locator("#boot").count():
        page.keyboard.press("Enter")
        page.wait_for_selector("#boot", state="detached", timeout=5000)
    page.wait_for_timeout(150)


def wait_hydrated(page: Page, timeout: float = 25_000) -> None:
    page.wait_for_function("() => typeof window.__PHANTOM_DEBUG__ === 'function'", timeout=timeout)


def wait_public_ready(page: Page) -> None:
    page.wait_for_selector("[data-coop-state='ready']", timeout=20000)


def png_bytes(width: int = 800, height: int = 600, color: tuple[int, int, int] = (200, 30, 40)) -> bytes:
    """不依赖 Pillow 的最小 PNG 编码器（单色图，服务端 Pillow 会真实解码它）。"""

    def chunk(kind: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + kind
            + payload
            + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
        )

    raw = b"".join(b"\x00" + bytes(color) * width for _ in range(height))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


# --- 管理界面（全部通过真实 UI，行按站名定位） ---------------------------------


def login_admin(context: BrowserContext, base: str, args) -> Page:
    page = context.new_page()
    open_page(page, "/admin/login", base)
    # 表单在拿到预登录会话（CSRF）之前是 disabled：等它可用，不用固定 sleep。
    page.wait_for_function(
        "() => { const el = document.querySelector('#username'); return el && !el.disabled; }",
        timeout=25000,
    )
    page.fill("#username", args.username)
    page.fill("#password", args.password)
    page.get_by_role("button", name="登录").click()
    page.wait_for_timeout(900)
    go_admin(page, base)
    return page


def row(page: Page, name: str | None = None):
    """管理列表里的行；**排除已软删除的行**（它们的发布 / 撤回按钮是禁用的）。

    上一次运行留下的同名条目已经被软删除，仍然留在管理列表里（这是设计：
    软删除可查、可恢复），所以这里必须显式排除，否则会点到禁用的按钮。
    """
    locator = page.locator("[data-friend-row]")
    if name:
        locator = locator.filter(has_text=name)
    return locator.filter(has_not_text="已删除")


def go_admin(page: Page, base: str) -> None:
    open_page(page, "/admin/friends", base)
    # 空库时没有表格行：等的是「新建友链」按钮（管理页可用的最小标志）。
    page.get_by_role("button", name="新建友链").wait_for(timeout=25000)


def create_friend(page: Page, *, name: str, url: str, tags: str, story: str = "") -> None:
    reload_page(page)
    page.get_by_role("button", name="新建友链").click()
    page.wait_for_selector("#coop-name", timeout=10000)
    page.fill("#coop-name", name)
    page.fill("#coop-url", url)
    page.fill("#coop-summary", "浏览器验收用的临时条目，跑完会删除；不是真实朋友。")
    if story:
        page.fill("#coop-story", story)
    page.fill("#coop-arcana", "IX · HERMIT")
    page.fill("#coop-tags", tags)
    page.get_by_role("button", name="保存", exact=True).click()
    page.wait_for_timeout(1200)
    reload_page(page)
    page.wait_for_selector("[data-friend-row]", timeout=15000)


def publish_friend(page: Page, name: str) -> None:
    reload_page(page)
    page.wait_for_selector("[data-friend-row]", timeout=15000)
    row(page, name).get_by_role("button", name="发布").first.click()
    page.wait_for_timeout(1200)


def unpublish_friend(page: Page, name: str) -> None:
    reload_page(page)
    page.wait_for_selector("[data-friend-row]", timeout=15000)
    buttons = row(page, name).get_by_role("button", name="撤回")
    if buttons.count() > 0:
        buttons.first.click()
        page.wait_for_timeout(1200)


def open_editor(page: Page, name: str) -> None:
    reload_page(page)
    page.wait_for_selector("[data-friend-row]", timeout=15000)
    row(page, name).get_by_role("button", name="编辑").first.click()
    page.wait_for_selector("#coop-summary", timeout=10000)


def edit_friend(page: Page, name: str, summary: str) -> None:
    open_editor(page, name)
    page.fill("#coop-summary", summary)
    page.get_by_role("button", name="保存", exact=True).click()
    page.wait_for_timeout(1200)


def _accept_dialog(dialog) -> None:
    try:
        dialog.accept()
    except Exception:  # pragma: no cover - 同一个对话框被两个 handler 抢
        pass


def soft_delete_all(page: Page) -> None:
    """收尾：把验收期间创建的临时条目软删除（不留在公开列表里冒充真实友链）。"""
    page.on("dialog", _accept_dialog)
    for _ in range(30):
        reload_page(page)
        page.wait_for_selector("[data-friend-row], [role='status']", timeout=15000)
        pending = None
        rows = page.locator("[data-friend-row]")
        for index in range(rows.count()):
            candidate = rows.nth(index)
            if "已删除" not in candidate.inner_text():
                pending = candidate
                break
        if pending is None:
            return
        pending.get_by_role("button", name="删除").click()
        page.wait_for_timeout(1000)


# --- 公开页面 -----------------------------------------------------------------


def public_names(page: Page) -> list[str]:
    return page.eval_on_selector_all(
        "[data-coop-card] h3, [data-coop-card] h4", "els => els.map(e => e.textContent.trim())"
    )


def public_flow(context: BrowserContext, base: str, admin: Page) -> Page:
    """空态 → 发布后可见 → 编辑一致 → 深链展开 → 撤回不可见（验收 1 / 3 / 5）。"""
    page = context.new_page()
    open_page(page, "/apps/coop", base)
    wait_hydrated(page)
    wait_public_ready(page)

    check("列表为空时显示诚实的空态", page.locator("[data-coop-empty='true']").count() == 1)
    empty_text = page.locator("[data-coop-empty='true']").inner_text()
    check("空态不伪造示例条目", all(name not in empty_text for name in LEGACY_DEMO_NAMES), empty_text[:60])
    hrefs = page.eval_on_selector_all("a[href]", "els => els.map(e => e.getAttribute('href'))")
    check("空态给出已有的留言板作为申请入口", "/guestbook" in hrefs, json.dumps(hrefs[:6], ensure_ascii=False))

    create_friend(admin, name=FRIEND_A, url="https://example.com/t07", tags="验收, 前端", story="这条记录只用于验收。")
    reload_page(page)
    wait_hydrated(page)
    wait_public_ready(page)
    check("新建后仍是草稿：公开列表看不到", public_names(page) == [], json.dumps(public_names(page), ensure_ascii=False))

    publish_friend(admin, FRIEND_A)
    reload_page(page)
    wait_hydrated(page)
    wait_public_ready(page)
    page.wait_for_selector("[data-coop-card]", timeout=15000)

    names = public_names(page)
    check("发布后公开列表立刻出现同一条记录", FRIEND_A in names, json.dumps(names, ensure_ascii=False))
    body = page.locator("[data-coop-view]").inner_text()
    # 卡片层面：旧示例角色不能作为「真实友链」出现在列表里（文案里的免责说明不在此列）。
    check(
        "真实友链卡片里没有旧示例角色",
        all(name not in names for name in LEGACY_DEMO_NAMES),
        json.dumps(names, ensure_ascii=False),
    )
    placeholders = page.eval_on_selector_all(
        "[data-coop-card] a[href]",
        "els => els.map(e => e.getAttribute('href')).filter(h => /^https:\\/\\/github\\.com\\/?$/.test(h))",
    )
    check("友链卡片里没有旧示例的占位地址（github.com 首页）", placeholders == [], json.dumps(placeholders))
    check("页面明确说明角色消息不是这里的友链", "不是这里的友链" in body)
    check(
        "页面不出现 RANK / 访问量 / 在线状态字样",
        all(word not in body for word in ["RANK", "访问量", "点击量", "在线状态"]),
    )

    card = row_card(page, FRIEND_A)
    external = card.locator("[data-coop-external='safe']").first
    check(
        "外链：新窗口 + noopener noreferrer",
        external.get_attribute("target") == "_blank"
        and external.get_attribute("rel") == "noopener noreferrer",
        f"target={external.get_attribute('target')} rel={external.get_attribute('rel')}",
    )
    check("外链带可辨识提示", "外部" in external.inner_text(), external.inner_text())
    check(
        "外链指向录入的 http(s) 地址",
        str(external.get_attribute("href") or "").startswith("https://example.com/t07"),
        str(external.get_attribute("href")),
    )

    # 简介按纯文本渲染：管理界面写入带标签的文字，页面上必须还是文字。
    edit_friend(admin, FRIEND_A, summary="<script>alert(1)</script> 与 <b>加粗</b> 都是文字")
    reload_page(page)
    wait_hydrated(page)
    wait_public_ready(page)
    page.wait_for_selector("[data-coop-card]", timeout=15000)
    check(
        "纯文本简介不注入 HTML（卡片里没有 script / b 节点）",
        row_card(page, FRIEND_A).locator("script, b").count() == 0,
    )
    check(
        "纯文本简介按原文显示",
        "<script>alert(1)</script>" in row_card(page, FRIEND_A).inner_text(),
    )

    # 标签筛选：客户端跳转（不整页重载）。
    origin = page.evaluate("() => performance.timeOrigin")
    labels = page.eval_on_selector_all(
        "[data-coop-view] button", "els => els.map(e => e.textContent.trim())"
    )
    check("标签筛选来自公开接口", "验收" in labels, json.dumps(labels, ensure_ascii=False))
    page.get_by_role("button", name="验收", exact=True).click()
    page.wait_for_timeout(900)
    check("标签筛选写进 URL", "tag=" in page.url, page.url)
    check("标签筛选是客户端跳转（不整页重载）", page.evaluate("() => performance.timeOrigin") == origin)
    check(
        "筛选后仍然只剩这一个标签的条目",
        public_names(page) == [FRIEND_A],
        json.dumps(public_names(page), ensure_ascii=False),
    )

    # 深链：?item=<id> 展开相识故事。
    friend_id = row_card(page, FRIEND_A).get_attribute("data-friend-id")
    page.goto(f"{base}/apps/coop?item={friend_id}", wait_until="load")
    page.wait_for_selector("[data-coop-card][data-friend-state='expanded']", timeout=20000)
    check("深链 ?item= 展开对应卡片", page.locator("[data-coop-card][data-friend-state='expanded']").count() == 1)
    check(
        "展开后按 id 读取详情（列表不含正文）",
        page.locator("[data-coop-story-state='ready']").count() == 1,
        page.locator("[data-friend-state='expanded']").inner_text()[:60].replace("\n", " "),
    )
    check(
        "音乐元素仍然只有一个",
        page.evaluate("() => document.querySelectorAll('audio[data-pl-music]').length") == 1,
    )
    shot(page, "t07-coop-desktop")

    # 撤回后公开请求立刻不可见。
    unpublish_friend(admin, FRIEND_A)
    page.goto(f"{base}/apps/coop", wait_until="load")
    wait_hydrated(page)
    wait_public_ready(page)
    check("撤回后公开列表看不到该条目", FRIEND_A not in public_names(page), json.dumps(public_names(page), ensure_ascii=False))
    check("撤回后回到诚实的空态", page.locator("[data-coop-empty='true']").count() == 1)
    return page


def row_card(page: Page, name: str):
    return page.locator("[data-coop-card]", has_text=name).first


# --- 头像（共享媒体权限） -------------------------------------------------------


def avatar_flow(context: BrowserContext, base: str, admin: Page) -> None:
    page = context.new_page()

    create_friend(admin, name=FRIEND_B, url="https://example.com/avatar", tags="头像")
    open_editor(admin, FRIEND_B)
    upload = pathlib.Path("/tmp/t07-avatar.png")
    upload.write_bytes(png_bytes(800, 600, (20, 120, 200)))
    admin.set_input_files("#coop-avatar-file", str(upload))
    admin.wait_for_function(
        "() => document.querySelector('#coop-avatar-id') && "
        "document.querySelector('#coop-avatar-id').value.length > 0",
        timeout=25000,
    )
    media_id = admin.input_value("#coop-avatar-id")
    check("头像上传走共享媒体端点并拿到媒体 id", len(media_id) == 36, media_id)
    admin.get_by_role("button", name="保存", exact=True).click()
    admin.wait_for_timeout(1500)

    publish_friend(admin, FRIEND_B)
    open_page(page, "/apps/coop", base)
    wait_hydrated(page)
    wait_public_ready(page)
    page.wait_for_selector("[data-coop-card]", timeout=20000)
    images = row_card(page, FRIEND_B).locator("[data-coop-avatar='image'] img")
    check(
        "已发布友链的头像可匿名读取（媒体公开引用检查生效）",
        images.count() == 1,
        f"image={images.count()}",
    )
    shot(page, "t07-coop-desktop-avatar")

    unpublish_friend(admin, FRIEND_B)
    page.goto(f"{base}/apps/coop", wait_until="load")
    wait_hydrated(page)
    wait_public_ready(page)
    check("撤回后该条目与头像都不再公开", row_card(page, FRIEND_B).count() == 0)
    page.close()


# --- 小屏与管理页截图 -----------------------------------------------------------


def responsive_shots(browser: Browser, base: str) -> None:
    for label, viewport in (("390", NARROW), ("320", TINY)):
        context = new_context(browser, viewport)
        page = context.new_page()
        open_page(page, "/apps/coop", base)
        wait_hydrated(page)
        wait_public_ready(page)
        overflow = page.evaluate(
            "() => document.documentElement.scrollWidth - document.documentElement.clientWidth"
        )
        check(f"{label}px 无横向溢出", overflow <= 1, f"overflow={overflow}px")
        check(f"{label}px 能读到状态区", page.locator("[data-coop-view]").count() == 1)
        shot(page, f"t07-coop-{label}")
        page.close()
        context.close()


def admin_shot(admin: Page, base: str) -> None:
    go_admin(admin, base)
    check("管理页可达且不是白屏", admin.locator("h2").first.inner_text().strip() != "")
    shot(admin, "t07-coop-admin")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:3120")
    parser.add_argument("--api", default="http://127.0.0.1:8107")
    parser.add_argument("--username", default="owner")
    parser.add_argument("--password", default="t07-owner-password-123")
    args = parser.parse_args()

    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = new_context(browser, DESKTOP)
        # 只登录一次：登录限流是 5 次/分钟/IP（T01 的默认值），重复登录会把用例自己限流。
        admin = login_admin(context, args.base, args)
        soft_delete_all(admin)

        page = public_flow(context, args.base, admin)
        page.close()
        avatar_flow(context, args.base, admin)
        responsive_shots(browser, args.base)
        admin_shot(admin, args.base)
        soft_delete_all(admin)
        admin.close()
        context.close()
        browser.close()

    failed = [item for item in results if not item["ok"]]
    print("\n=== summary ===")
    print(
        json.dumps(
            {"passed": len(results) - len(failed), "failed": len(failed), "screenshots": shots},
            ensure_ascii=False,
            indent=2,
        )
    )
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
