#!/usr/bin/env python3
"""验收 v2 · 管理端 INS 收录全流程（真实浏览器 UI 证据）。

对应独立验收报告 §5.4 / §7.4 的缺口：「管理端 INS 收录表单端到端流程证据不足」。
本脚本在**真实浏览器**里走完整流程，不做接口直调：

  登录 → 新建相册（草稿）→ 新建动态草稿 → 上传图片 + 填替代文本
  → 刷新相册列表 → 选择刚建的相册 → 添加并勾选图片 → 保存草稿 → 发布
  → 公开 INS 页面能看到新动态

同时验证：
  - 相册列表 GET 使用后端允许的 limit（`MAX_LIMIT=30`，用 50 会 422）；
  - 新建相册的 CSRF token 从 JSON body 提交也能通过（不再 422/500）；
  - 收录关系保存后发布不被 409/422 拒绝。

用法：
    python3 tools/e2e-ins-album-links-ui.py [BASE]
环境变量（可选）：
    E2E_ADMIN_USER / E2E_ADMIN_PASSWORD（默认 demo-seeder / 本地演示密码）
    E2E_SHOTS_DIR（截图目录，默认 .dsh/screenshots/ins-admin）
退出码：0 = 全流程通过；1 = 失败。前置：本机 3100（生产构建）+ 8100 API + 演示数据。
"""

from __future__ import annotations

import os
import pathlib
import re
import sys
import time

from playwright.sync_api import sync_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3100").rstrip("/")
USER = os.environ.get("E2E_ADMIN_USER", "demo-seeder")
PASSWORD = os.environ.get("E2E_ADMIN_PASSWORD", "demo-seeder-password-123")
SHOTS = pathlib.Path(os.environ.get("E2E_SHOTS_DIR", ".dsh/screenshots/ins-admin"))
IMAGE = pathlib.Path("/tmp/ins-flow.png")

PASS: list[str] = []
FAIL: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    (PASS if ok else FAIL).append(label)
    print(f"  {'✓' if ok else '✗'} {label}" + (f" — {detail}" if detail and not ok else ""))


def main() -> int:
    SHOTS.mkdir(parents=True, exist_ok=True)
    stamp = int(time.time())
    slug = f"ui-accept-{stamp}"
    title = f"UI 验收相册 {stamp}"
    text = f"UI 验收动态 {stamp}：收录到相册并发布"

    # 上传用的小图（800×600 PNG）；固定内容，避免依赖外部资源。
    if not IMAGE.exists():
        try:
            from PIL import Image, ImageDraw

            im = Image.new("RGB", (800, 600), (200, 40, 40))
            ImageDraw.Draw(im).text((40, 40), "INS album-links UI flow", fill=(255, 255, 255))
            im.save(IMAGE)
        except Exception as error:  # noqa: BLE001
            print(f"✗ 无法生成上传测试图：{error}")
            return 1

    print(f"== 管理端 INS 收录全流程（真实浏览器）：{BASE} ==")
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            context = browser.new_context(viewport={"width": 1440, "height": 1000})
            page = context.new_page()
            page.goto(BASE + "/admin/login", wait_until="load", timeout=60000)
            page.wait_for_timeout(1500)
            if page.locator("#boot").count():
                page.keyboard.press("Enter")
                page.wait_for_timeout(1200)

            page.fill("input[name=username]", USER)
            page.fill("input[name=password]", PASSWORD)
            page.click("button[type=submit]")
            page.wait_for_timeout(2500)
            check("站主登录", "已登录" in page.content())
            page.screenshot(path=str(SHOTS / "01-login.png"))

            # 1) 新建相册（草稿）
            page.goto(BASE + "/admin/albums", wait_until="load", timeout=60000)
            page.wait_for_timeout(2200)
            check("相册列表可加载（limit=30）", "提交的内容不合法" not in page.inner_text("body"))
            page.get_by_role("button", name="新建相册").click()
            page.wait_for_timeout(400)
            page.fill("#album-slug", slug)
            page.fill("#album-title", title)
            page.get_by_role("button", name="保存草稿").click()
            page.wait_for_timeout(2500)
            check("新建相册草稿", "已保存草稿" in page.inner_text("body"))
            page.screenshot(path=str(SHOTS / "02-album-created.png"))

            # 2) 新建动态草稿 + 上传图片 + 替代文本
            page.goto(BASE + "/admin/moments", wait_until="load", timeout=60000)
            page.wait_for_timeout(2000)
            page.get_by_role("button", name="新建草稿").click()
            page.wait_for_timeout(2500)
            page.set_input_files(".ins-admin-upload input[type=file]", str(IMAGE))
            page.wait_for_timeout(4000)
            check("图片上传 ready", "已上传" in page.inner_text("body"))
            page.locator(".ins-admin-image input[type=text]").first.fill("UI 验收上传图")
            page.locator(".ins-admin-field textarea").first.fill(text)
            page.wait_for_timeout(400)
            page.screenshot(path=str(SHOTS / "03-moment-draft.png"))

            # 3) 收录到刚建的相册（刷新列表 → 选择 → 添加 → 勾选图片）
            page.get_by_role("button", name=re.compile("刷新相册列表")).click()
            page.wait_for_timeout(2500)
            options = page.evaluate(
                "() => [...document.querySelectorAll('[data-album-picker] option')].map((o) => ({ v: o.value, t: o.textContent }))"
            )
            target = next((item for item in options if item["t"] and title in item["t"]), None)
            check("新相册出现在收录下拉", target is not None, str(options[:5]))
            if target is None:
                raise RuntimeError("新相册不可选")
            page.locator("[data-album-picker]").select_option(value=target["v"])
            page.wait_for_timeout(250)
            page.get_by_role("button", name="添加相册").click()
            page.wait_for_timeout(700)
            page.locator(".ins-admin-album-media input[type=checkbox]").first.check()
            page.wait_for_timeout(400)
            check("勾选收录图片", "已选 1 张" in page.inner_text("body"))
            page.screenshot(path=str(SHOTS / "04-album-link.png"))

            # 4) 保存草稿 → 发布
            page.get_by_role("button", name=re.compile("保存草稿")).click()
            page.wait_for_timeout(2500)
            check("保存草稿（含收录关系）", "已保存" in page.inner_text("body"))
            page.get_by_role("button", name="发布", exact=True).click()
            page.wait_for_timeout(3000)
            check("发布成功", "已发布" in page.inner_text("body"))
            page.screenshot(path=str(SHOTS / "05-published.png"))

            # 5) 公开页可见
            page.goto(BASE + "/apps/ins", wait_until="load", timeout=60000)
            page.wait_for_timeout(3500)
            check("公开 INS 页面包含新动态", text in page.inner_text("body"))
            page.screenshot(path=str(SHOTS / "06-public-ins.png"))

            browser.close()
    except Exception as error:  # noqa: BLE001
        FAIL.append(f"浏览器流程异常：{error}")
        print(f"  ✗ 浏览器流程异常：{error}")

    print("\n== 结果 ==")
    print(f"  通过 {len(PASS)} 项；失败 {len(FAIL)} 项；截图：{SHOTS}")
    for item in FAIL:
        print(f"  ✗ {item}")
    return 0 if not FAIL else 1


if __name__ == "__main__":
    sys.exit(main())
