#!/usr/bin/env python3
"""完整验收 §7.4 补充证据：管理端 INS「保留草稿 → 新标签建相册 → 图库展示 → 撤回联动」。

在**隔离栈**（tools/e2e-stack.sh up，3130/8130）上运行，不碰共享数据库：
  1. 新建动态草稿，上传图片 + 替代文本 + 正文（暂不保存）；
  2. 点「新建相册（新标签页）」，在弹出页创建并**发布**相册；
  3. 回到动态页：正文/图片/替代文本仍在（草稿未被新标签流程清空）；
  4. 刷新相册列表 → 选择相册 → 添加并勾选图片 → 保存草稿 → 发布；
  5. 公开 INS 可见；`/gallery?scope=album&album=<slug>` 能看到该图；
  6. 管理端「撤回」动态后：公开 INS 不再出现，图库相册页不再显示该图（公开来源撤回联动）。

用法：
    bash tools/e2e-stack.sh up
    E2E_ADMIN_USER=owner E2E_ADMIN_PASSWORD=e2e-password-123 \
      python3 tools/e2e-ins-draft-album-flow.py http://127.0.0.1:3130
退出码：0 = 全部通过；1 = 失败。
"""

from __future__ import annotations

import os
import pathlib
import re
import sys
import time

from playwright.sync_api import Page, sync_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3130").rstrip("/")
USER = os.environ.get("E2E_ADMIN_USER", "owner")
PASSWORD = os.environ.get("E2E_ADMIN_PASSWORD", "e2e-password-123")
SHOTS = pathlib.Path(os.environ.get("E2E_SHOTS_DIR", ".dsh/screenshots/ins-draft-album"))
IMAGE = pathlib.Path("/tmp/ins-draft-album-flow.png")

PASS: list[str] = []
FAIL: list[str] = []
ALT = "隔离流程上传图"


def check(label: str, ok: bool, detail: str = "") -> None:
    (PASS if ok else FAIL).append(label)
    print(f"  {'✓' if ok else '✗'} {label}" + (f" — {detail}" if detail and not ok else ""))


def shot(page: Page, name: str) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOTS / name), full_page=False)


def login(page: Page) -> None:
    page.goto(BASE + "/admin/login", wait_until="load", timeout=60000)
    page.wait_for_timeout(1500)
    if page.locator("#boot").count():
        page.keyboard.press("Enter")
        page.wait_for_timeout(1200)
    page.fill("input[name=username]", USER)
    page.fill("input[name=password]", PASSWORD)
    page.click("button[type=submit]")
    page.wait_for_timeout(2500)


def main() -> int:
    if not IMAGE.exists():
        try:
            from PIL import Image, ImageDraw

            im = Image.new("RGB", (800, 600), (35, 120, 180))
            ImageDraw.Draw(im).text((40, 40), "INS draft album flow", fill=(255, 255, 255))
            im.save(IMAGE)
        except Exception as error:  # noqa: BLE001
            print(f"✗ 无法生成上传图：{error}")
            return 1

    stamp = int(time.time())
    slug = f"draft-flow-{stamp}"
    album_title = f"隔离相册 {stamp}"
    moment_text = f"隔离草稿保留流程 {stamp}"

    print(f"== 管理端 INS 草稿保留 / 图库 / 撤回联动（隔离栈）：{BASE} ==")
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = context.new_page()
        media_responses: list[tuple[int, str]] = []
        page.on(
            "response",
            lambda r: media_responses.append((r.status, r.url)) if "/api/v1/media/" in r.url else None,
        )
        try:
            login(page)
            check("站主登录（隔离 owner）", "已登录" in page.content())

            # 1) 新建动态草稿：正文 + 上传图片 + 替代文本（暂不保存）
            page.goto(BASE + "/admin/moments", wait_until="load", timeout=60000)
            page.wait_for_timeout(2000)
            page.get_by_role("button", name="新建草稿").click()
            page.wait_for_timeout(2500)
            page.set_input_files(".ins-admin-upload input[type=file]", str(IMAGE))
            page.wait_for_timeout(4000)
            page.locator(".ins-admin-image input[type=text]").first.fill(ALT)
            page.locator(".ins-admin-field textarea").first.fill(moment_text)
            page.wait_for_timeout(400)
            check("草稿：图片上传 ready", "已上传" in page.inner_text("body"))
            check(
                "草稿：正文/替代文本已填",
                page.locator(".ins-admin-field textarea").first.input_value() == moment_text
                and page.locator(".ins-admin-image input[type=text]").first.input_value() == ALT,
            )
            shot(page, "01-draft-filled.png")

            # 2) 新标签页建相册并发布（不动当前草稿表单）
            with context.expect_page() as popup_info:
                page.click("[data-album-admin-link]")
            popup = popup_info.value
            popup.wait_for_load_state("load")
            popup.wait_for_timeout(1500)
            # 新标签页也会显示站点开场（#boot）：先按 Enter 跳过，再等管理页渲染。
            if popup.locator("#boot").count():
                popup.keyboard.press("Enter")
                popup.wait_for_timeout(1200)
            try:
                close = popup.locator(".poll-close").first
                if close.count():
                    close.click(timeout=1200)
                    popup.wait_for_timeout(200)
            except Exception:  # noqa: BLE001
                pass
            popup.wait_for_timeout(1800)
            check("新标签打开相册管理页", "/admin/albums" in popup.url, popup.url)
            popup.get_by_role("button", name="新建相册").click()
            popup.wait_for_timeout(400)
            popup.fill("#album-slug", slug)
            popup.fill("#album-title", album_title)
            popup.get_by_role("button", name="保存草稿").click()
            popup.wait_for_timeout(2500)
            check("新标签创建相册草稿", "已保存草稿" in popup.inner_text("body"))
            shot(popup, "02-popup-album-draft.png")
            popup.close()
            page.wait_for_timeout(600)

            # 3) 回到动态页：草稿仍在
            check(
                "回到动态页：正文保留",
                page.locator(".ins-admin-field textarea").first.input_value() == moment_text,
                page.locator(".ins-admin-field textarea").first.input_value()[:60],
            )
            check(
                "回到动态页：替代文本保留",
                page.locator(".ins-admin-image input[type=text]").first.input_value() == ALT,
            )
            check("回到动态页：图片仍 ready", "已上传" in page.inner_text("body"))
            shot(page, "03-back-draft-preserved.png")

            # 4) 刷新相册列表 → 选择 → 添加 → 勾选 → 保存 → 发布
            page.get_by_role("button", name=re.compile("刷新相册列表")).click()
            page.wait_for_timeout(2500)
            options = page.evaluate(
                "() => [...document.querySelectorAll('[data-album-picker] option')].map((o) => ({ v: o.value, t: o.textContent }))"
            )
            target = next((item for item in options if item["t"] and album_title in item["t"]), None)
            check("刷新后可选新相册（此时草稿）", target is not None, str(options[:5]))
            if target is None:
                raise RuntimeError("新相册不可选")
            page.locator("[data-album-picker]").select_option(value=target["v"])
            page.get_by_role("button", name="添加相册").click()
            page.wait_for_timeout(700)
            page.locator(".ins-admin-album-media input[type=checkbox]").first.check()
            page.wait_for_timeout(300)
            page.get_by_role("button", name=re.compile("保存草稿")).click()
            page.wait_for_timeout(2500)
            check("保存草稿（含收录）", "已保存" in page.inner_text("body"))

            # 4b) 相册此时已有收录关系：在新标签页发布相册（公开照片墙需要已发布相册）
            album_page = context.new_page()
            album_page.goto(BASE + "/admin/albums", wait_until="load", timeout=60000)
            album_page.wait_for_timeout(1500)
            if album_page.locator("#boot").count():
                album_page.keyboard.press("Enter")
                album_page.wait_for_timeout(1200)
            album_page.wait_for_timeout(1800)
            row = album_page.locator(f'tr[data-admin-album="{slug}"] a')
            check("相册列表出现新相册", row.count() == 1, album_page.inner_text("body")[:100])
            if row.count():
                row.first.click()
                album_page.wait_for_timeout(2200)
                album_page.get_by_role("button", name="发布", exact=True).click()
                album_page.wait_for_timeout(2500)
                check("相册发布成功", "已发布" in album_page.inner_text("body"), album_page.inner_text("body")[:120])
            else:
                check("相册发布成功", False, "列表行不存在")
            album_page.close()

            # 4c) 发布动态（让动态来源贡献公开资格）
            page.get_by_role("button", name="发布", exact=True).click()
            page.wait_for_timeout(3000)
            check("动态发布成功", "已发布" in page.inner_text("body"))
            shot(page, "04-moment-published.png")

            # 5) 公开 INS + 图库相册页可见
            page.goto(BASE + "/apps/ins", wait_until="load", timeout=60000)
            page.wait_for_timeout(3000)
            check("公开 INS 包含新动态", moment_text in page.inner_text("body"))
            gallery_url = f"{BASE}/gallery?scope=album&album={slug}"
            page.goto(gallery_url, wait_until="load", timeout=60000)
            page.wait_for_timeout(3000)
            body = page.inner_text("body")
            check("图库相册页包含上传图 alt/说明", ALT in body or "隔离相册" in body, body[:120])
            check(
                "图库图片 HTTP 200",
                any(status == 200 and "/api/v1/media/" in url for status, url in media_responses),
                str(media_responses[-3:]),
            )
            shot(page, "05-gallery-visible.png")

            # 6) 撤回动态 → 公开来源撤回联动
            page.goto(BASE + "/admin/moments", wait_until="load", timeout=60000)
            page.wait_for_timeout(2000)
            # 当前列表里找到刚发布的动态（文本唯一），点进编辑
            item = page.locator("button.ins-admin-list-item", has_text=moment_text)
            if item.count():
                item.first.click()
                page.wait_for_timeout(2200)
            unpublish = page.get_by_role("button", name="撤回", exact=True)
            if unpublish.count() and unpublish.is_enabled():
                unpublish.click()
                page.wait_for_timeout(2500)
                check("动态撤回成功", "已撤回" in page.inner_text("body"))
            else:
                check("动态撤回成功", False, "未找到可用的撤回按钮")
            page.goto(BASE + "/apps/ins", wait_until="load", timeout=60000)
            page.wait_for_timeout(2500)
            check("撤回后公开 INS 不再显示该动态", moment_text not in page.inner_text("body"))
            page.goto(gallery_url, wait_until="load", timeout=60000)
            page.wait_for_timeout(2500)
            after_body = page.inner_text("body")
            check("撤回后图库相册页不再显示该图 alt", ALT not in after_body, after_body[:120])
            shot(page, "06-after-withdraw-gallery.png")
        except Exception as error:  # noqa: BLE001
            FAIL.append(f"浏览器流程异常：{error}")
            print(f"  ✗ 浏览器流程异常：{error}")
        finally:
            context.close()
            browser.close()

    print("\n== 结果 ==")
    print(f"  通过 {len(PASS)} 项；失败 {len(FAIL)} 项；截图：{SHOTS}")
    for item in FAIL:
        print(f"  ✗ {item}")
    return 0 if not FAIL else 1


if __name__ == "__main__":
    sys.exit(main())
