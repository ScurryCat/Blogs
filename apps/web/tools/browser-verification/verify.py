#!/usr/bin/env python3
"""T02 真实浏览器验收（Playwright + 系统自带 chromium，不往 apps/web 加依赖）。

前置：
  1. 构建并启动新站： cd apps/web && npm run build && npm run start   # http://127.0.0.1:3100
  2. 旧站静态预览仍在 127.0.0.1:8000（**只读对照，不要停**）
  3. 运行： python3 apps/web/tools/browser-verification/verify.py

检查内容（对应 T02 验收里必须用真实浏览器做的部分）：
  * 问卷 HUD：**同一份配置在旧站与新站逐项比对几何**（底板透明度、票数框高度、Q 与框的
    叠合关系、整数 / 小数分列字号），再加投票 / 关闭 / 重开的真实交互；
  * 地图三类入口（地点图标 / 右侧出发 / 下方列表）用人群，顶部导航用 Joker，
    减少动态效果时直接导航；
  * 手机：URL 状态、背景 inert、Escape 关闭与焦点归还、直接链接关闭不离站、
    连续开关 20 次后音乐元素仍然只有一个；
  * 音乐元素跨客户端路由保持同一份（不重建、不停止）；
  * 320 / 390px 与桌面截图。

截图输出目录：/Users/学习/blog/.dsh/screenshots（工作区外，不进仓库）。
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
from typing import Any

from playwright.sync_api import Page, sync_playwright

OUT = pathlib.Path("/Users/学习/blog/.dsh/screenshots")
DESKTOP = {"width": 1280, "height": 900}
NARROW = {"width": 390, "height": 844}
TINY = {"width": 320, "height": 844}

results: list[dict[str, Any]] = []
shots: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    results.append({"check": name, "ok": bool(condition), "detail": detail})
    mark = "PASS" if condition else "FAIL"
    print(f"{mark} {name}{(' — ' + detail) if detail else ''}", flush=True)


def open_page(page: Page, url: str, base: str) -> None:
    """打开页面并关掉旧站同款开屏（它拦截所有指针事件）。"""
    page.goto(url if url.startswith("http") else base + url, wait_until="load")
    page.wait_for_timeout(250)
    if page.locator("#boot").count():
        page.keyboard.press("Enter")
        page.wait_for_selector("#boot", state="detached", timeout=5000)
    page.wait_for_timeout(150)


def dismiss_poll(page: Page) -> None:
    """关掉右下角问卷浮层（它默认会自动弹出），并清掉本机记录。"""
    page.evaluate(
        "() => { try { localStorage.clear(); } catch (e) {} }"
    )
    if page.locator(".poll--floating").count():
        page.keyboard.press("Escape")
        page.wait_for_timeout(350)


def shot(page: Page, name: str) -> str:
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{name}.png"
    page.screenshot(path=str(path))
    shots.append(str(path))
    return str(path)


POLL_METRICS = """() => {
  const root = document.querySelector('.poll--floating');
  const panel = root.querySelector('.poll-panel');
  const bar = root.querySelector('.poll-bar');
  const q = root.querySelector('.poll-q');
  const question = root.querySelector('.poll-question');
  const whole = root.querySelector('.poll-whole');
  const fraction = root.querySelector('.poll-fraction');
  const bg = getComputedStyle(panel, '::before').backgroundColor;
  const parts = bg.match(/[\\d.]+/g);
  const rect = (el) => { const r = el.getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right}; };
  return {
    alpha: parts ? Number(parts[3] ?? 1) : 1,
    panel: rect(panel),
    bar: rect(bar),
    q: rect(q),
    question: rect(question),
    wholeSize: parseFloat(getComputedStyle(whole).fontSize),
    fractionSize: parseFloat(getComputedStyle(fraction).fontSize),
    wholeText: whole.textContent,
    fractionText: fraction.textContent,
    label: root.querySelector('.poll-result-label').textContent,
    note: root.querySelector('.poll-note').textContent,
    percent: root.querySelector('.poll-percent').textContent.replace(/\\s+/g, ''),
  };
}"""


def measure_poll(browser, base: str, legacy: bool) -> dict:
    """在旧站 / 新站打开同一份默认问卷，量同一批几何数据。"""
    page = browser.new_page(viewport=DESKTOP, device_scale_factor=2, reduced_motion="no-preference")
    path = "/index.html" if legacy else "/"
    open_page(page, path, base)
    page.evaluate("() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} }")
    page.reload(wait_until="load")
    page.wait_for_timeout(300)
    if page.locator("#boot").count():
        page.keyboard.press("Enter")
        page.wait_for_selector("#boot", state="detached", timeout=5000)
    page.wait_for_selector(".poll--floating .poll-panel", timeout=8000)
    metrics = page.evaluate(POLL_METRICS)
    page.close()
    return metrics


def close_enough(new: float, old: float, tolerance: float = 2.0) -> bool:
    return abs(new - old) <= tolerance


def poll_geometry(browser, base: str, legacy: str) -> None:
    """问卷 HUD：同一份配置在旧站与新站逐项比对（这是「保持当前样式」最直接的证据）。"""
    new = measure_poll(browser, base, legacy=False)
    old = measure_poll(browser, legacy, legacy=True)

    check(
        "底板透明度与旧站一致（0.75 ≤ alpha < 1）",
        close_enough(new["alpha"], old["alpha"], 0.01) and 0.75 <= new["alpha"] < 1,
        f"new={new['alpha']} legacy={old['alpha']}",
    )
    for key, label in (("panel", "问卷底板"), ("bar", "票数框"), ("q", "Q 装饰"), ("question", "问题文本")):
        ok = all(close_enough(new[key][field], old[key][field]) for field in ("w", "h", "top", "left"))
        check(
            f"{label}几何与旧站一致（≤2px）",
            ok,
            f"new={ {k: round(v, 1) for k, v in new[key].items() if k in ('w', 'h', 'top', 'left')} } "
            f"legacy={ {k: round(v, 1) for k, v in old[key].items() if k in ('w', 'h', 'top', 'left')} }",
        )

    check(
        "Q 与票数框的叠合关系与旧站一致",
        close_enough(new["q"]["bottom"] - new["bar"]["bottom"], old["q"]["bottom"] - old["bar"]["bottom"]),
        f"new={new['q']['bottom'] - new['bar']['bottom']:.1f} legacy={old['q']['bottom'] - old['bar']['bottom']:.1f}",
    )
    check(
        "问题贴近票数框上斜边，间距与旧站一致",
        close_enough(
            new["bar"]["top"] - new["question"]["bottom"],
            old["bar"]["top"] - old["question"]["bottom"],
        ),
        f"new={new['bar']['top'] - new['question']['bottom']:.1f} legacy={old['bar']['top'] - old['question']['bottom']:.1f}",
    )
    check(
        "整数与小数分列的字号与旧站一致（小数更小）",
        close_enough(new["wholeSize"], old["wholeSize"], 0.5)
        and close_enough(new["fractionSize"], old["fractionSize"], 0.5)
        and new["fractionSize"] < new["wholeSize"],
        f"whole {new['wholeSize']} vs {old['wholeSize']} · fraction {new['fractionSize']} vs {old['fractionSize']}",
    )
    check(
        "百分比是分列的真实文本",
        new["wholeText"] == "07" and new["fractionText"] == ".3" and new["percent"] == "07.3%",
        f"{new['wholeText']}{new['fractionText']} / {new['percent']}",
    )
    check("票数框右下角显示主选项标签 YES", new["label"] == "YES", new["label"])
    check("界面明确标注本地展示、非全站统计", "非全站统计" in new["note"], new["note"])

    # --- 真实交互：投票 / 关闭 / 重开 ---
    page = browser.new_page(viewport=DESKTOP, device_scale_factor=2, reduced_motion="no-preference")
    open_page(page, "/", base)
    page.evaluate("() => { try { localStorage.clear(); } catch (e) {} }")
    page.reload(wait_until="load")
    page.wait_for_timeout(300)
    if page.locator("#boot").count():
        page.keyboard.press("Enter")
        page.wait_for_selector("#boot", state="detached", timeout=5000)
    page.wait_for_selector(".poll--floating .poll-panel", timeout=8000)
    shot(page, "t02-poll-desktop")

    page.click(".poll--floating .poll-choice")
    page.wait_for_timeout(150)
    percent = page.inner_text(".poll--floating .poll-percent").replace("\n", "")
    check("投票后百分比 07.4%（只在自己浏览器里叠加一票）", percent == "07.4%", percent)
    disabled = page.evaluate(
        "() => [...document.querySelectorAll('.poll--floating .poll-choice')].every(b => b.disabled)"
    )
    check("投票后两个按钮都禁用", disabled is True)
    selected = page.evaluate(
        "() => document.querySelector('.poll--floating .poll-choice[aria-pressed=\"true\"]')?.textContent"
    )
    check("已选项有明确标记", "YES" in str(selected), str(selected))

    page.evaluate("() => document.querySelector('.poll--floating .poll-close').focus()")
    page.keyboard.press("Escape")
    page.wait_for_timeout(80)
    closing = page.evaluate(
        """() => { const node = document.querySelector('.poll--floating');
                   return node ? {opacity: Number(getComputedStyle(node).opacity), inert: node.inert} : null; }"""
    )
    check(
        "关闭时淡出（opacity < 1）且内容 inert",
        closing is not None and closing["opacity"] < 1 and closing["inert"] is True,
        json.dumps(closing),
    )
    page.wait_for_timeout(400)
    check("关闭后浮层 DOM 被移除", page.locator(".poll--floating").count() == 0)
    check("关闭后启动器重新出现", page.locator(".poll-launcher").is_visible())
    page.click(".poll-launcher")
    page.wait_for_timeout(300)
    reopened = page.inner_text(".poll--floating .poll-percent").replace("\n", "")
    check("重新打开仍是已投票状态（关闭不算投票）", reopened == "07.4%", reopened)
    page.keyboard.press("Escape")
    page.wait_for_timeout(350)
    page.close()


def poll_geometry_small(browser, base: str, legacy: str) -> None:
    """390px：同样与旧站比对（旧站的 620px 分支在这里生效）。"""
    measurements = {}
    for label, target, is_legacy in (("new", base, False), ("legacy", legacy, True)):
        page = browser.new_page(viewport=NARROW, device_scale_factor=2, reduced_motion="no-preference")
        open_page(page, "/index.html" if is_legacy else "/", target)
        page.evaluate("() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} }")
        page.reload(wait_until="load")
        page.wait_for_timeout(300)
        if page.locator("#boot").count():
            page.keyboard.press("Enter")
            page.wait_for_selector("#boot", state="detached", timeout=5000)
        page.wait_for_selector(".poll--floating .poll-panel", timeout=8000)
        measurements[label] = page.evaluate(POLL_METRICS)
        if not is_legacy:
            shot(page, "t02-poll-390")
        page.close()

    check(
        "390px：票数框高度与旧站一致",
        close_enough(measurements["new"]["bar"]["h"], measurements["legacy"]["bar"]["h"]),
        f"new={measurements['new']['bar']['h']:.1f} legacy={measurements['legacy']['bar']['h']:.1f}",
    )
    check(
        "390px：Q 与票数框的相对位置与旧站一致",
        close_enough(
            measurements["new"]["q"]["bottom"] - measurements["new"]["bar"]["bottom"],
            measurements["legacy"]["q"]["bottom"] - measurements["legacy"]["bar"]["bottom"],
        ),
        f"new={measurements['new']['q']['bottom'] - measurements['new']['bar']['bottom']:.1f} "
        f"legacy={measurements['legacy']['q']['bottom'] - measurements['legacy']['bar']['bottom']:.1f}",
    )
    check(
        "390px：整数 / 小数分列字号与旧站一致",
        close_enough(measurements["new"]["fractionSize"], measurements["legacy"]["fractionSize"], 0.5),
        f"new={measurements['new']['fractionSize']} legacy={measurements['legacy']['fractionSize']}",
    )


def map_transitions(browser, base: str) -> None:
    page = browser.new_page(viewport=DESKTOP, device_scale_factor=2, reduced_motion="no-preference")
    open_page(page, "/map", base)
    dismiss_poll(page)

    page.wait_for_function("() => window.__PHANTOM_DEBUG__ && window.__PHANTOM_DEBUG__().crowd.ready === true", timeout=15000)
    check("地图页已预热人群素材", True)

    def click_and_report(selector: str, label: str) -> None:
        open_page(page, "/map", base)
        page.wait_for_function("() => window.__PHANTOM_DEBUG__().crowd.ready === true", timeout=15000)
        page.click(selector)
        page.wait_for_timeout(150)
        state = page.evaluate("() => window.__PHANTOM_DEBUG__()")
        check(
            f"{label} 使用车站人群",
            state["transition"]["crowd"] is True and state["transition"]["joker"] is False,
            json.dumps(state["transition"], ensure_ascii=False),
        )
        page.wait_for_timeout(1500)

    page.wait_for_selector(".mp-svg .loc.on", timeout=20000)
    click_and_report(".mp-svg .loc.on", "地图地点图标")
    click_and_report(".mp-card .btn.red", "右侧「出发」")
    click_and_report(".mp-list a", "下方地点列表")

    # 顶部导航：Joker 帷幕（不能因为在地图页就用人群）
    open_page(page, "/map", base)
    page.wait_for_function("() => window.__PHANTOM_DEBUG__().crowd.ready === true", timeout=15000)
    page.click('.hud-nav a[data-k="weather"]')
    page.wait_for_timeout(200)
    state = page.evaluate("() => window.__PHANTOM_DEBUG__()")
    check(
        "顶部导航使用 Joker 帷幕（不是人群）",
        state["transition"]["joker"] is True and state["transition"]["crowd"] is False,
        json.dumps(state["transition"], ensure_ascii=False),
    )
    page.wait_for_timeout(1500)
    check("顶部导航到达正确目的地", page.url.endswith("/weather"), page.url)
    page.close()

    # 减少动态效果：直接导航，不播人群
    context = browser.new_context(viewport=DESKTOP, reduced_motion="reduce")
    reduce_page = context.new_page()
    open_page(reduce_page, "/map", base)
    # 先等运行时挂上（水合完成）再点，否则点到的是原生链接、会变成整页跳转。
    reduce_page.wait_for_function("() => typeof window.__PHANTOM_DEBUG__ === 'function'", timeout=15000)
    reduce_page.wait_for_function(
        "() => window.__PHANTOM_DEBUG__().crowd.state === 'reduced-motion'", timeout=15000
    )
    check("减少动效下人群是「有意跳过」而不是加载失败", True, "crowd.state=reduced-motion")
    reduce_page.click(".mp-svg .loc.on")
    reduce_page.wait_for_timeout(150)
    transition = reduce_page.evaluate("() => window.__PHANTOM_DEBUG__().transition")
    check(
        "prefers-reduced-motion 下不播人群 / 帷幕",
        transition["crowd"] is False and transition["joker"] is False,
        json.dumps(transition, ensure_ascii=False),
    )
    context.close()


def client_navigation(browser, base: str) -> None:
    """站内跳转必须是客户端导航（同文档），否则整页重载会重建音频、破坏「音乐连续」。

    这一条是回归测试：曾经因为点击拦截挂在冒泡阶段、与 Next 的全局点击处理抢时机，
    整页重载会与 RSC 请求同时发生（`window` 冒泡处 defaultPrevented 已是 true，页面仍重载）。
    """
    cases = [
        ("顶部导航", "/", '.hud-nav a[data-k="about"]', False),
        ("地图地点图标", "/map", ".mp-svg .loc.on", False),
        ("地图地点列表", "/map", ".mp-list li:nth-child(3) a", False),
        ("手机站点链接入口", "/", ".pw-app[data-app-id='palace']", True),
    ]
    for label, start, selector, needs_phone in cases:
        page = browser.new_page(viewport=DESKTOP, reduced_motion="no-preference")
        open_page(page, start, base)
        # 先等内容出现，再等运行时挂上（大页面首次编译 / 首帧较慢时给足时间）。
        page.wait_for_selector(".hud-nav", timeout=20000)
        page.wait_for_function("() => typeof window.__PHANTOM_DEBUG__ === 'function'", timeout=25000)
        if needs_phone:
            # 先打开手机，再点**手机里的站点链接磁贴**。
            #
            # 不要写成「点 .pw-tab 预热、再点 .pw-tab」：面板一旦打开，`.pw-scrim` 就盖住
            # 启动器，第二次点击会被它拦下（Playwright 重试到超时）。旧写法在首帧尚未水合
            # 时第一次点击会被吞掉，于是偶然通过 —— 水合变快之后就会稳定失败。
            page.click(".pw-tab")
            page.wait_for_selector(".pw-wrap.on .pw-app", timeout=10000)
        origin = page.evaluate("() => performance.timeOrigin")
        page.click(selector)
        page.wait_for_timeout(2500)
        same_document = page.evaluate("() => performance.timeOrigin") == origin
        check(f"{label}：客户端导航（不整页重载）", same_document, page.url)
        page.close()


def phone_host(browser, base: str) -> None:
    page = browser.new_page(viewport=DESKTOP, device_scale_factor=2, reduced_motion="no-preference")
    open_page(page, "/", base)
    dismiss_poll(page)

    page.click(".pw-tab")
    page.wait_for_timeout(300)
    check("打开手机后 URL 带 phone=home", "phone=home" in page.url, page.url)
    check("手机是 aria-modal 对话框", page.get_attribute(".pw", "aria-modal") == "true")
    inert = page.evaluate("() => document.getElementById('main').hasAttribute('inert')")
    check("打开手机时背景 inert", inert is True)
    tiles = page.eval_on_selector_all(".pw-app", "els => els.map(e => e.dataset.appId)")
    # 4 个 site-link 入口（T02 迁移）+ metanav（T04 交付、T00 登记的内置应用）。
    # 断言具体清单而非数量：后续包登记时会被强制确认一次，而不是静默改变桌面。
    check(
        "桌面只显示已登记的真实入口",
        tiles == ["ins", "palace", "journal", "tokyo", "cast", "leisure", "coop", "profile", "metanav", "showcase"],
        str(tiles),
    )
    shot(page, "t02-phone-desktop")

    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    check("Escape 关闭手机", page.locator(".pw-wrap[hidden]").count() == 1)
    focused = page.evaluate("() => document.activeElement && document.activeElement.className")
    check("关闭后焦点回到小图标", "pw-tab" in str(focused), str(focused))
    inert_after = page.evaluate("() => document.getElementById('main').hasAttribute('inert')")
    check("关闭后移除背景 inert", inert_after is False)

    # 连续开关 20 次：音乐元素与全局监听不累增
    baseline = page.evaluate(
        """() => ({
            audio: document.querySelectorAll('audio').length,
            music: document.querySelectorAll('audio[data-pl-music]').length,
            wrap: document.querySelectorAll('.pw-wrap').length,
        })"""
    )
    for _ in range(20):
        page.click(".pw-tab")
        page.wait_for_timeout(60)
        page.click(".pw-close")
        page.wait_for_timeout(60)
    after = page.evaluate(
        """() => ({
            audio: document.querySelectorAll('audio').length,
            music: document.querySelectorAll('audio[data-pl-music]').length,
            wrap: document.querySelectorAll('.pw-wrap').length,
        })"""
    )
    check("连续开关 20 次：audio 元素不累增", after == baseline, f"{baseline} -> {after}")
    check("连续开关 20 次：音乐元素仍然只有一个", after["music"] == 1, json.dumps(after))

    # 直接链接（分享链接形态）：Escape 必须能关掉手机，且焦点已在对话框内
    direct = browser.new_page(viewport=DESKTOP, reduced_motion="no-preference")
    open_page(direct, "/about?phone=home", base)
    direct.wait_for_selector(".pw-wrap:not([hidden])", timeout=5000)
    direct.wait_for_timeout(400)
    focused_class = direct.evaluate("() => document.activeElement && document.activeElement.className")
    check("直接链接打开后焦点进入对话框", "pw-close" in str(focused_class), str(focused_class))
    direct.keyboard.press("Escape")
    direct.wait_for_timeout(300)
    check(
        "直接链接打开：Escape 能关掉手机（不被自动弹出的问卷截走）",
        direct.locator(".pw-wrap[hidden]").count() == 1,
    )
    direct.close()

    direct = browser.new_page(viewport=DESKTOP, reduced_motion="no-preference")
    open_page(direct, "/map?phone=home", base)
    direct.click(".pw-close")
    direct.wait_for_timeout(400)
    check("直接链接收起手机后仍在同一路径", direct.url.split("?")[0].endswith("/map"), direct.url)
    check("直接链接收起后清掉 phone 参数", "phone=" not in direct.url, direct.url)
    direct.close()
    page.close()


def music_continuity(browser, base: str) -> None:
    page = browser.new_page(viewport=DESKTOP, reduced_motion="no-preference")
    open_page(page, "/", base)
    dismiss_poll(page)
    page.evaluate("() => { window.__firstAudio = document.querySelector('audio[data-pl-music]'); }")

    page.click(".pw-tab")
    page.wait_for_timeout(300)
    playing_before = page.evaluate(
        """() => { const a = document.querySelector('audio[data-pl-music]'); a.play().catch(() => {}); return true; }"""
    )
    page.wait_for_timeout(600)
    paused_before = page.evaluate("() => document.querySelector('audio[data-pl-music]').paused")
    page.click(".pw-close")
    page.wait_for_timeout(200)
    page.click('.hud-nav a[data-k="about"]')
    page.wait_for_timeout(1800)
    same = page.evaluate(
        """() => window.__firstAudio === document.querySelector('audio[data-pl-music]')"""
    )
    paused_after = page.evaluate("() => document.querySelector('audio[data-pl-music]').paused")
    check("跨客户端路由：音乐元素是同一份（没被重建）", same is True)
    check(
        "跨客户端路由：播放状态延续（关手机 / 换页不停止）",
        (paused_before is False and paused_after is False) or (paused_before is True and paused_after is True),
        f"before={'playing' if paused_before is False else 'paused'} after={'playing' if paused_after is False else 'paused'} (播放本身受无头音频设备限制: play_called={playing_before})",
    )
    page.close()


def responsive_shots(browser, base: str) -> None:
    pages = [
        ("", "t02-home"),
        ("/map", "t02-map"),
        ("/posts/css-p5-menu", "t02-post"),
        ("/about", "t02-about"),
        ("/guestbook", "t02-guestbook"),
        ("/weather", "t02-weather"),
    ]
    for path, name in pages:
        for label, viewport in (("desktop", DESKTOP), ("390", NARROW), ("320", TINY)):
            page = browser.new_page(viewport=viewport, device_scale_factor=2, reduced_motion="no-preference")
            open_page(page, path or "/", base)
            if label != "desktop":
                # 小屏截图时不要浮层遮挡正文
                page.evaluate("() => { try { localStorage.setItem('pl-poll-v2:phantom-thieves-belief', JSON.stringify({seen:true,vote:null})); } catch (e) {} }")
                page.reload(wait_until="load")
                page.wait_for_timeout(200)
                if page.locator("#boot").count():
                    page.keyboard.press("Enter")
                    page.wait_for_selector("#boot", state="detached", timeout=5000)
            page.wait_for_timeout(350)
            shot(page, f"{name}-{label}")
            page.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:3100")
    parser.add_argument("--legacy", default="http://127.0.0.1:8000")
    args = parser.parse_args()

    with sync_playwright() as p:
        browser = p.chromium.launch()
        poll_geometry(browser, args.base, args.legacy)
        poll_geometry_small(browser, args.base, args.legacy)
        map_transitions(browser, args.base)
        client_navigation(browser, args.base)
        phone_host(browser, args.base)
        music_continuity(browser, args.base)
        responsive_shots(browser, args.base)
        browser.close()

    failed = [item for item in results if not item["ok"]]
    print("\n=== summary ===")
    print(json.dumps({"passed": len(results) - len(failed), "failed": len(failed), "screenshots": shots}, ensure_ascii=False, indent=2))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
