#!/usr/bin/env python3
"""端到端：IM 图片消息（B4 Phase 1）在手机宿主 / 独立聊天页的真实交互。

前置：本地 3100 生产构建 + 8100 API + 演示数据（含公开相册 tokyo-nights）。
覆盖（R2/R3 返工后的复验标准）：
  - 灯箱打开后按 Escape：只关灯箱，**不退出 App/会话**，URL/消息/滚动位置保留，焦点回触发按钮；
  - 「关闭」按钮与背景点击：同样只关闭灯箱；
  - 灯箱内图片失败：显示可读降级，不显示破图，仍可关闭；
  - 手机宿主与独立聊天页各测一遍。

用法：python3 tools/e2e-im-image-card.py [BASE]
退出码：0 = 通过；1 = 失败。
"""

from __future__ import annotations

import sys

from playwright.sync_api import Page, sync_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3100").rstrip("/")
CHAT_TEXT = "地图页上能直接出发"
PASS: list[str] = []
FAIL: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    (PASS if ok else FAIL).append(label)
    print(f"  {'✓' if ok else '✗'} {label}" + (f" — {detail}" if detail and not ok else ""))


def boot(page: Page) -> None:
    page.wait_for_timeout(2500)
    if page.locator("#boot").count():
        page.keyboard.press("Enter")
        page.wait_for_timeout(1500)
    try:
        close = page.locator(".poll-close").first
        if close.count():
            close.click(timeout=1200)
            page.wait_for_timeout(250)
    except Exception:  # noqa: BLE001
        pass
    page.wait_for_timeout(2200)


def enter_photo_node(page: Page) -> None:
    # 两种宿主（手机内置 / 独立页）加载时序不同：等选项渲染出来再点，避免固定 sleep 竞态。
    page.wait_for_selector(".msg-choices button", timeout=20000)
    page.locator(".msg-choices button", has_text="这地方是什么").first.click()
    page.wait_for_timeout(3500)


def conversation_visible(page: Page) -> bool:
    return page.locator(".msg-list").count() == 1 and CHAT_TEXT in page.locator(".msg-list").inner_text()


def state(page: Page) -> dict:
    return page.evaluate(
        """() => {
          const list = document.querySelector('.msg-list');
          return {
            url: location.href,
            dialog: !!document.querySelector('[role="dialog"].msg-photo-lightbox'),
            list: !!list,
            listTop: list ? Math.round(list.scrollTop) : -1,
            photo: document.querySelectorAll('.msg-photo').length,
            activeClass: document.activeElement?.className ?? '',
            activeLabel: document.activeElement?.getAttribute('aria-label') ?? '',
            fallback: document.querySelector('.msg-photo-lightbox-fallback')?.textContent?.trim() ?? '',
          };
        }"""
    )


def open_lightbox(page: Page) -> None:
    page.locator(".msg-photo").first.click()
    page.wait_for_timeout(900)


def assert_closed_but_in_conversation(page: Page, label: str, before_top: int) -> None:
    after = state(page)
    check(f"{label}：灯箱已关闭", not after["dialog"], str(after))
    check(f"{label}：仍在会话（.msg-list + 正文可见）", conversation_visible(page), str(after))
    check(f"{label}：URL 未被改成手机桌面", "phone=home" not in after["url"], after["url"])
    check(f"{label}：图片卡仍在", after["photo"] == 1, str(after["photo"]))
    check(f"{label}：滚动位置保留", after["listTop"] == before_top, f"{before_top} -> {after['listTop']}")
    check(
        f"{label}：焦点回到触发按钮",
        "msg-photo" in after["activeClass"] and "查看图片" in after["activeLabel"],
        f"{after['activeClass']} / {after['activeLabel']}",
    )


def run_case(page: Page, name: str, path: str, is_phone: bool) -> None:
    print(f"\n== {name} ==")
    page.goto(BASE + path, wait_until="load", timeout=60000)
    boot(page)
    # 独立页复用同一访客会话：如果已经停在带图片卡的地图节点，不必再点一次。
    if page.locator(".msg-photo").count() == 0:
        enter_photo_node(page)
    page.wait_for_selector(".msg-photo", timeout=20000)
    check("图片卡出现", page.locator(".msg-photo").count() == 1)

    # 每次打开前重新取滚动位置：消息列表的平滑滚动可能还在进行，不能用一个旧值比较。
    # 1) Escape
    top = state(page)["listTop"]
    open_lightbox(page)
    check("点击打开灯箱", state(page)["dialog"])
    check("打开后焦点在关闭按钮", "msg-photo-lightbox-close" in state(page)["activeClass"])
    page.keyboard.press("Escape")
    page.wait_for_timeout(800)
    assert_closed_but_in_conversation(page, "Escape", top)

    # 2) 关闭按钮
    top = state(page)["listTop"]
    open_lightbox(page)
    page.locator(".msg-photo-lightbox-close").click()
    page.wait_for_timeout(700)
    assert_closed_but_in_conversation(page, "关闭按钮", top)

    # 3) 背景点击（点灯箱左上角遮罩）
    top = state(page)["listTop"]
    open_lightbox(page)
    page.locator(".msg-photo-lightbox").click(position={"x": 4, "y": 4})
    page.wait_for_timeout(700)
    assert_closed_but_in_conversation(page, "背景点击", top)

    # 4) 灯箱内图片失败：触发 error 事件，验证降级与关闭仍可用
    top = state(page)["listTop"]
    open_lightbox(page)
    page.evaluate(
        """() => {
          const img = document.querySelector('.msg-photo-lightbox-img');
          if (img) img.dispatchEvent(new Event('error'));
        }"""
    )
    page.wait_for_timeout(500)
    failed = state(page)
    check("灯箱图片失败时显示可读降级", "图片暂时不可用" in failed["fallback"], failed["fallback"])
    check("灯箱失败时不再显示破图", page.locator(".msg-photo-lightbox-img").count() == 0)
    page.keyboard.press("Escape")
    page.wait_for_timeout(700)
    assert_closed_but_in_conversation(page, "失败后 Escape", top)

    if not is_phone:
        check("独立页 URL 保持会话路由", "/apps/ins/messages/morgana" in state(page)["url"], state(page)["url"])


def main() -> int:
    print(f"== IM 图片消息交互端到端（真实浏览器）：{BASE} ==")
    with sync_playwright() as p:
        browser = p.chromium.launch()
        # 减少动态效果：会话列表改用瞬时滚动，避免平滑滚动尚未结束造成的
        # 假「滚动位置变化」（真正要验证的是灯箱开/关是否保留位置）。
        context = browser.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce")
        page = context.new_page()
        media: list[tuple[int, str]] = []
        page.on(
            "response",
            lambda r: media.append((r.status, r.url)) if "/api/v1/media/" in r.url else None,
        )
        run_case(page, "手机宿主（?phone=ins · conversation）", "/?phone=ins&screen=conversation&item=morgana", True)
        check("图片请求 HTTP 200", any(status == 200 and url.endswith("/w640.webp") for status, url in media), str(media[-3:]))
        run_case(page, "独立聊天页（/apps/ins/messages/<角色>）", "/apps/ins/messages/morgana", False)
        context.close()
        browser.close()

    print("\n== 结果 ==")
    print(f"  通过 {len(PASS)} 项；失败 {len(FAIL)} 项")
    for item in FAIL:
        print(f"  ✗ {item}")
    return 0 if not FAIL else 1


if __name__ == "__main__":
    sys.exit(main())
