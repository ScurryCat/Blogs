#!/usr/bin/env python3
"""P5 站主创作台 · 浏览器端到端验收（**骨架 + 场景函数写全**，集成后启用）。

对应设计书 §五 与集成契约 §6（验收映射）的 A1–A12 / B1–B2。
脚本风格沿用 `tools/e2e-ins-album-links-ui.py` / `tools/e2e-webkit-mobile-smoke.py`：
PASS/FAIL 计数、check()、sync_playwright、no_proxy、BASE 参数、E2E_VIEWPORT、截图目录。

用法：
    # 骨架模式（默认，不启动浏览器、不产生任何断言；退出码 0）
    python3 tools/e2e-p5-workspace.py

    # 集成完成后真正跑断言（隔离栈 3130）
    bash tools/e2e-stack.sh up
    P5_E2E_READY=1 python3 tools/e2e-p5-workspace.py http://127.0.0.1:3130
    bash tools/e2e-stack.sh down

    # 只跑部分场景
    P5_E2E_READY=1 P5_E2E_SCENARIOS=workspace-home,journal-private-public \
        python3 tools/e2e-p5-workspace.py

    # WebKit 引擎冒烟（≠真机；B2 只能给部分证据）
    E2E_ENGINE=webkit P5_E2E_READY=1 python3 tools/e2e-p5-workspace.py

环境变量：
    P5_E2E_READY          "1" 才真正跑断言；否则打印场景/选择器清单后 exit 0（骨架模式）
    E2E_ADMIN_USER        默认 owner（隔离栈）
    E2E_ADMIN_PASSWORD    默认 e2e-password-123（e2e-stack.sh 创建）
    E2E_SHOTS_DIR         截图目录，默认 .dsh/screenshots/p5-workspace
    E2E_VIEWPORT          主流程视口，默认 1440x1000（例：390x844）
    E2E_ENGINE            chromium（默认）/ webkit
    E2E_HEADLESS          默认 true；"0" 显示窗口（调试）
    P5_E2E_SCENARIOS      逗号分隔场景 id，只跑这些
    P5_E2E_FULL           "1" 时启用耗时断言（如选择器 9 张上限、双设备双写）

前置（C5b）：
    - 隔离栈：tools/e2e-stack.sh up（集群 55434 / API 8130 / 前端 3130；**每次 up 重建库**）
    - 站主：owner / e2e-password-123；登录限流 5 次/分钟 → 本脚本**每次运行只登录 1 次**，
      其余场景复用 cookie（第二设备场景复制 cookie，不再登录）
    - **不要**对共享 3100/8100/55432 跑本脚本（写型测试只打隔离栈）
    - 系统代理坑：脚本内已 no_proxy；如仍 502，检查 no_proxy 是否被父进程覆盖

退出码：0 = 全部断言通过（或骨架模式）；1 = 有失败。
"""

from __future__ import annotations

import json
import os
import pathlib
import struct
import sys
import time
import uuid
import zlib
from contextlib import contextmanager
from typing import Any, Callable, Iterable, Iterator

# ── 环境（必须在 import playwright 之前处理浏览器路径）─────────────────────
REPO = pathlib.Path(__file__).resolve().parents[1]
BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3130").rstrip("/")
API = BASE + "/api/v1"

os.environ.setdefault("no_proxy", "127.0.0.1,localhost,::1")
os.environ.setdefault("NO_PROXY", os.environ["no_proxy"])

READY = os.environ.get("P5_E2E_READY", "").strip() == "1"
ENGINE = os.environ.get("E2E_ENGINE", "chromium").strip().lower()
HEADLESS = os.environ.get("E2E_HEADLESS", "1").strip() != "0"
USER = os.environ.get("E2E_ADMIN_USER", "owner")
PASSWORD = os.environ.get("E2E_ADMIN_PASSWORD", "e2e-password-123")
SHOTS = pathlib.Path(os.environ.get("E2E_SHOTS_DIR", ".dsh/screenshots/p5-workspace"))
FULL = os.environ.get("P5_E2E_FULL", "").strip() == "1"
SUMMARY_PATH = pathlib.Path(os.environ.get("P5_E2E_SUMMARY", "/tmp/p5-e2e-summary.json"))
ONLY = [s.strip() for s in os.environ.get("P5_E2E_SCENARIOS", "").split(",") if s.strip()]

if ENGINE == "webkit":
    os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(REPO / ".dsh" / "ms-playwright"))


def parse_viewport(value: str) -> tuple[int, int]:
    match = value.lower().replace("×", "x").split("x")
    if len(match) == 2 and all(part.strip().isdigit() for part in match):
        return int(match[0]), int(match[1])
    return 1440, 1000


MAIN_VIEWPORT = parse_viewport(os.environ.get("E2E_VIEWPORT", "1440x1000"))
STAMP = time.strftime("%Y%m%d-%H%M%S")
PNG_PATH = pathlib.Path(f"/tmp/p5-e2e-{os.getpid()}.png")

# ── 计数器 ─────────────────────────────────────────────────────────────────
PASS: list[str] = []
FAIL: list[str] = []
SKIP: list[str] = []
INFO: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> bool:
    (PASS if ok else FAIL).append(label)
    print(f"  {'✓' if ok else '✗'} {label}" + (f" — {detail}" if detail and not ok else ""))
    return ok


def skip(label: str, reason: str) -> None:
    SKIP.append(f"{label}（{reason}）")
    print(f"  ⋯ SKIP {label} — {reason}")


def info(label: str, value: Any = "") -> None:
    text = f"{label} — {value}" if value != "" else label
    INFO.append(text)
    print(f"  · info: {text}")


# ── 小工具 ─────────────────────────────────────────────────────────────────


def unique(prefix: str) -> str:
    return f"p5-e2e-{prefix}-{STAMP}-{uuid.uuid4().hex[:6]}"


def write_test_png(path: pathlib.Path, width: int = 800, height: int = 600) -> pathlib.Path:
    """用标准库生成一张 800×600 纯色 PNG（不依赖 PIL / 外部资源）。"""

    def chunk(tag: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + tag
            + payload
            + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
        )

    row = b"\x00" + bytes((200, 40, 40)) * width
    raw = row * height
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)  # 8bit RGB
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 6))
        + chunk(b"IEND", b"")
    )
    return path


def safe_json(response: Any) -> Any:
    try:
        return response.json()
    except Exception:  # noqa: BLE001
        return None


def wait_for(page: Any, predicate: Callable[[], bool], timeout_ms: int = 15000, interval_ms: int = 300) -> bool:
    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        try:
            if predicate():
                return True
        except Exception:  # noqa: BLE001
            pass
        page.wait_for_timeout(interval_ms)
    return False


def find(page: Any, *selectors: str) -> Any:
    """返回第一个存在的 locator（不保证可见）；都没有则 None。"""
    for selector in selectors:
        try:
            locator = page.locator(selector)
            if locator.count() > 0:
                return locator.first
        except Exception:  # noqa: BLE001
            continue
    return None


def visible(page: Any, *selectors: str) -> bool:
    locator = find(page, *selectors)
    try:
        return bool(locator and locator.is_visible())
    except Exception:  # noqa: BLE001
        return False


def click_first(page: Any, *selectors: str) -> bool:
    locator = find(page, *selectors)
    if locator is None:
        return False
    try:
        locator.click()
        return True
    except Exception:  # noqa: BLE001
        return False


def shot(page: Any, name: str) -> str:
    SHOTS.mkdir(parents=True, exist_ok=True)
    path = SHOTS / f"{STAMP}-{name}.png"
    try:
        page.screenshot(path=str(path))
    except Exception as error:  # noqa: BLE001
        info(f"截图失败 {name}", str(error)[:120])
        return ""
    return str(path)


def boot(page: Any, wait_ms: int = 1500) -> None:
    """关闭过场闸门/公告（既有 e2e 脚本的统一做法）。"""
    page.wait_for_timeout(wait_ms)
    try:
        if page.locator("#boot").count():
            page.keyboard.press("Enter")
            page.wait_for_timeout(1200)
    except Exception:  # noqa: BLE001
        pass
    for selector in (".poll-close", "[data-close-announcement]"):
        try:
            locator = page.locator(selector).first
            if locator.count():
                locator.click(timeout=1200)
                page.wait_for_timeout(150)
        except Exception:  # noqa: BLE001
            pass


@contextmanager
def open_page(
    browser: Any,
    cookies: list[dict] | None = None,
    viewport: tuple[int, int] | None = None,
    mobile: bool = False,
) -> Iterator[tuple[Any, Any]]:
    width, height = viewport or MAIN_VIEWPORT
    context = browser.new_context(
        viewport={"width": width, "height": height},
        locale="zh-CN",
        device_scale_factor=1,
        is_mobile=mobile,
        has_touch=mobile,
    )
    if cookies:
        try:
            context.add_cookies(cookies)
        except Exception:  # noqa: BLE001
            pass
    page = context.new_page()
    page.set_default_timeout(15000)
    try:
        yield context, page
    finally:
        try:
            context.close()
        except Exception:  # noqa: BLE001
            pass


def current_url_has(page: Any, fragment: str) -> bool:
    try:
        return fragment in page.url
    except Exception:  # noqa: BLE001
        return False


# ── 同步状态 / 编辑器 ──────────────────────────────────────────────────────


def sync_state(page: Any) -> str | None:
    locator = find(page, "[data-sync-state]")
    if locator is None:
        return None
    try:
        return locator.get_attribute("data-sync-state")
    except Exception:  # noqa: BLE001
        return None


def wait_sync(page: Any, states: Iterable[str] = ("synced",), timeout_ms: int = 25000) -> bool:
    wanted = set(states)
    return wait_for(page, lambda: sync_state(page) in wanted, timeout_ms)


def wait_editor_success(page: Any, timeout_ms: int = 15000) -> bool:
    return wait_for(page, lambda: visible(page, "[data-editor-success]"), timeout_ms)


def wait_editor_blockers(page: Any, timeout_ms: int = 8000) -> bool:
    return wait_for(page, lambda: visible(page, "[data-editor-blockers]"), timeout_ms)


def editor_text(page: Any) -> str:
    """读取编辑器正文（data-* 优先，其次 textarea 结构选择器）。"""
    for selector in (
        '[data-editor-field="content"]',
        '[data-editor-field="text"]',
        "[data-editor] textarea",
        "textarea",
    ):
        locator = find(page, selector)
        if locator is not None:
            try:
                return locator.input_value() or ""
            except Exception:  # noqa: BLE001
                continue
    return ""


def fill_editor(page: Any, value: str, *selectors: str) -> bool:
    locator = find(page, *selectors)
    if locator is None:
        return False
    try:
        locator.fill(value)
        return True
    except Exception:  # noqa: BLE001
        return False


# ── 媒体选择器 ─────────────────────────────────────────────────────────────


def open_media_picker(page: Any) -> bool:
    return click_first(
        page,
        "[data-media-picker-open]",
        'button:has-text("选择图片")',
        'button:has-text("添加图片")',
    )


def media_picker_visible(page: Any) -> bool:
    return visible(page, "[data-media-picker]") or visible(page, "[role=dialog][data-media-picker]")


def upload_in_picker(page: Any, image_path: pathlib.Path) -> bool:
    locator = find(
        page,
        "input[data-media-picker-upload]",
        "[data-media-picker] input[type=file]",
        "[data-media-picker-file]",
    )
    if locator is None:
        return False
    try:
        locator.set_input_files(str(image_path))
        return True
    except Exception:  # noqa: BLE001
        return False


def confirm_media_picker(page: Any) -> bool:
    return click_first(page, "[data-media-picker-confirm]", 'button:has-text("确定")', 'button:has-text("完成")')


# ── API（复用浏览器上下文 cookie / CSRF）───────────────────────────────────


class Api:
    """在已登录的浏览器上下文里直连 API（等同第二设备）：

    - cookie 与页面共享（`page.context.request`）；
    - 写请求**必须**带 `X-CSRF-Token`（契约 §9.2：长正文不能依赖 body csrf_token）；
    - `fail_on_status_code=False`：412/409/422 是断言对象，不是异常。
    """

    def __init__(self, page: Any) -> None:
        self.page = page
        self._csrf: str | None = None

    def csrf(self) -> str:
        if self._csrf is None:
            response = self.page.context.request.get(API + "/auth/session", timeout=20000)
            payload = safe_json(response) or {}
            self._csrf = str(payload.get("csrf_token") or "")
        return self._csrf or ""

    def fetch(
        self,
        method: str,
        path: str,
        body: Any = None,
        headers: dict[str, str] | None = None,
        multipart: dict[str, Any] | None = None,
    ) -> Any:
        merged: dict[str, str] = {"Accept": "application/json"}
        if headers:
            merged.update(headers)
        if method != "GET":
            token = self.csrf()
            if token:
                merged["X-CSRF-Token"] = token
        url = path if path.startswith("http") else API + path
        return self.page.context.request.fetch(
            url,
            method=method,
            headers=merged,
            data=body,
            multipart=multipart,
            timeout=30000,
            fail_on_status_code=False,
        )

    def get(self, path: str) -> Any:
        return self.fetch("GET", path)

    def post(self, path: str, body: Any = None, headers: dict[str, str] | None = None) -> Any:
        return self.fetch("POST", path, body=body, headers=headers)

    def patch(self, path: str, body: Any = None, headers: dict[str, str] | None = None) -> Any:
        return self.fetch("PATCH", path, body=body, headers=headers)

    def delete(self, path: str, headers: dict[str, str] | None = None) -> Any:
        return self.fetch("DELETE", path, headers=headers)

    def upload_media(self, image_path: pathlib.Path) -> dict[str, Any] | None:
        data = image_path.read_bytes()
        response = self.fetch(
            "POST",
            "/admin/media",
            multipart={"file": {"name": image_path.name, "mimeType": "image/png", "buffer": data}},
        )
        if response.status != 201:
            info("上传媒体失败", f"HTTP {response.status}")
            return None
        payload = safe_json(response)
        return payload if isinstance(payload, dict) else None

    # 工作草稿便捷封装（契约 §3.3）
    def create_draft(
        self,
        content_type: str,
        target_id: str | None = None,
        data: dict[str, Any] | None = None,
        images: list[dict[str, Any]] | None = None,
    ) -> Any:
        body: dict[str, Any] = {"content_type": content_type}
        if target_id is not None:
            body["target_id"] = target_id
        if data is not None:
            body["data"] = data
        if images is not None:
            body["images"] = images
        return self.post("/admin/work-drafts", body)

    def list_drafts(self, content_type: str | None = None) -> list[dict[str, Any]]:
        path = "/admin/work-drafts?limit=20"
        if content_type:
            path += f"&content_type={content_type}"
        response = self.get(path)
        payload = safe_json(response) or {}
        items = payload.get("items")
        return items if isinstance(items, list) else []

    def get_draft(self, draft_id: str) -> Any:
        return self.get(f"/admin/work-drafts/{draft_id}")

    def patch_draft(
        self,
        draft_id: str,
        patch: dict[str, Any],
        draft_version: int,
    ) -> Any:
        return self.patch(
            f"/admin/work-drafts/{draft_id}",
            patch,
            headers={"If-Match": f'"{int(draft_version)}"'},
        )

    def commit_draft(
        self,
        draft_id: str,
        action: str,
        draft_version: int,
        expected_target_version: int | None,
        commit_key: str,
    ) -> Any:
        return self.post(
            f"/admin/work-drafts/{draft_id}/commit",
            {
                "action": action,
                "expected_target_version": expected_target_version,
                "commit_key": commit_key,
            },
            headers={"If-Match": f'"{int(draft_version)}"'},
        )


# ── 场景注册 ───────────────────────────────────────────────────────────────

SCENARIOS: list[dict[str, Any]] = []


def scenario(scenario_id: str, title: str, owner: str, engines: tuple[str, ...] = ("chromium",)) -> Callable[[Callable[..., None]], Callable[..., None]]:
    def register(fn: Callable[..., None]) -> Callable[..., None]:
        SCENARIOS.append(
            {"id": scenario_id, "title": title, "owner": owner, "fn": fn, "engines": engines}
        )
        return fn

    return register


# ═══════════════════════════════════════════════════════════════════════════
# 场景实现（选择器以契约 §9.5 + C2/C3/C4 实际交付为准；结构选择器只作回退）
# ═══════════════════════════════════════════════════════════════════════════


def editor_status(page: Any) -> str | None:
    locator = find(page, "[data-editor-status]")
    try:
        return locator.get_attribute("data-editor-status") if locator else None
    except Exception:  # noqa: BLE001
        return None


def editor_visibility(page: Any) -> str | None:
    locator = find(page, "[data-editor-visibility]")
    try:
        return locator.get_attribute("data-editor-visibility") if locator else None
    except Exception:  # noqa: BLE001
        return None


def wait_editor_ready(page: Any, content_type: str, timeout_ms: int = 20000) -> bool:
    return wait_for(page, lambda: visible(page, f'[data-editor="{content_type}"]'), timeout_ms)


def picker_flow(page: Any, image_path: pathlib.Path, alt: str, select_index: int = 0) -> bool:
    """打开选择器 → 上传 → 选中第 N 张 → 填替代文本 → 确认。返回是否完成。"""
    if not open_media_picker(page):
        return False
    if not wait_for(page, lambda: media_picker_visible(page), 8000):
        return False
    if not upload_in_picker(page, image_path):
        return False
    if not wait_for(page, lambda: page.locator("[data-media-picker-item]").count() > select_index, 25000):
        return False
    try:
        page.locator("[data-media-picker-item]").nth(select_index).click()
    except Exception:  # noqa: BLE001
        return False
    alt_input = find(page, "[data-media-picker-alt]")
    if alt_input is not None:
        try:
            alt_input.fill(alt)
        except Exception:  # noqa: BLE001
            pass
    return confirm_media_picker(page) and wait_for(page, lambda: not media_picker_visible(page), 8000)


def picker_selected_count(page: Any) -> int:
    return page.locator("[data-media-picker-picked]").count()


def find_draft(api: Api, content_type: str, target_id: str | None = None) -> dict[str, Any] | None:
    for item in api.list_drafts(content_type):
        if target_id is None or str(item.get("target_id") or "") == target_id:
            return item
    return None


def api_publish_moment(api: Api, text: str) -> dict[str, Any] | None:
    """用独立测试数据发布一条动态（上传图 → 建草稿 → commit publish）。"""
    media = api.upload_media(PNG_PATH)
    if not media:
        return None
    draft = safe_json(
        api.create_draft(
            "moment",
            data={"text": text, "tags": [], "album_links": []},
            images=[{"media_id": media["id"], "alt": "p5 e2e 测试图"}],
        )
    ) or {}
    if not draft.get("id"):
        return None
    commit = api.commit_draft(str(draft["id"]), "publish", int(draft["draft_version"] or 1), None, str(uuid.uuid4()))
    payload = safe_json(commit) or {}
    return payload if commit.status == 200 else None


def public_moments(anon_ctx: Any) -> list[dict[str, Any]]:
    response = anon_ctx.request.get(API + "/moments?limit=30", timeout=20000, fail_on_status_code=False)
    payload = safe_json(response) or {}
    items = payload.get("items")
    return items if isinstance(items, list) else []


def public_journal_items(anon_ctx: Any) -> list[dict[str, Any]]:
    response = anon_ctx.request.get(API + "/journal/entries?limit=30", timeout=20000, fail_on_status_code=False)
    payload = safe_json(response) or {}
    items = payload.get("items")
    return items if isinstance(items, list) else []


def select_leisure_entry(page: Any, kind: str, title: str) -> bool:
    """放课后快捷更新：切到指定类型 tab，在下拉里选中测试记录。"""
    tab = find(page, f'[data-leisure-quick-kind="{kind}"]')
    if tab is not None:
        try:
            tab.click()
            page.wait_for_timeout(400)
        except Exception:  # noqa: BLE001
            pass
    select = find(page, f'[data-leisure-quick="{kind}"] select')
    if select is None:
        return False
    options = select.locator("option").evaluate_all(
        "els => els.map(el => ({ value: el.value, text: el.textContent || '' }))"
    )
    target = next((item for item in options if title in (item.get("text") or "")), None)
    if target is None:
        info("快捷更新下拉里找不到测试记录", f"{title} / {[o.get('text') for o in options][:5]}")
        return False
    select.select_option(value=target["value"])
    page.wait_for_timeout(500)
    return True


@scenario("workspace-home", "创作台首页（四任务 / 空态 / 匿名）", "C2 · A1/A2")
def s_workspace_home(browser: Any) -> None:
    with open_page(browser, cookies=SESSION.get("cookies")) as (ctx, page):
        page.goto(BASE + "/admin", wait_until="load", timeout=60000)
        boot(page)
        check("登录后 /admin 是创作台首页（data-workspace-home）", visible(page, "[data-workspace-home]"))
        starts = page.locator("[data-workspace-start]").evaluate_all(
            "els => els.map(el => el.getAttribute('data-workspace-start'))"
        )
        for kind in ("moment", "journal", "anime", "game"):
            check(f"「开始记录」含 {kind}", kind in starts, str(starts))
        check("四项「开始记录」入口数量 ≥4", len(starts) >= 4, str(starts))
        hrefs = page.locator("[data-workspace-start]").evaluate_all("els => els.map(el => el.getAttribute('href'))")
        check("开始记录入口指向独立编辑页/管理页",
              any(h == "/admin/moments/new" for h in hrefs) and any(h == "/admin/journal/new" for h in hrefs),
              str(hrefs))
        body = page.inner_text("body")
        for label in ("开始记录", "继续编辑", "近期内容", "内容管理"):
            check(f"创作台含任务区块「{label}」", label in body)
        check("「继续编辑」空态说明（无假数据）", visible(page, "[data-workspace-drafts-empty]"))
        check("内容管理链接存在", page.locator("[data-workspace-manage-link]").count() >= 1)
        shot(page, "workspace-home")

        clicked = click_first(page, '[data-workspace-start="moment"]')
        if clicked:
            check("创作台「发布动态」进入 /admin/moments/new",
                  wait_for(page, lambda: "/admin/moments/new" in page.url, 10000), page.url)
            shot(page, "workspace-start-moment")

        with open_page(browser) as (anon_ctx, anon_page):
            anon_page.goto(BASE + "/apps/ins", wait_until="load", timeout=60000)
            boot(anon_page)
            check("匿名 INS 页无站主入口", anon_page.locator("[data-owner-entry]").count() == 0)
            anon_page.goto(BASE + "/admin", wait_until="load", timeout=60000)
            boot(anon_page)
            check("匿名访问 /admin 不渲染创作台", anon_page.locator("[data-workspace-home]").count() == 0)
            response = anon_ctx.request.get(API + "/admin/work-drafts", timeout=20000, fail_on_status_code=False)
            check("匿名 GET /admin/work-drafts → 401/403", response.status in (401, 403), f"HTTP {response.status}")
            response = anon_ctx.request.get(API + "/admin/media?limit=12", timeout=20000, fail_on_status_code=False)
            check("匿名 GET /admin/media → 401/403", response.status in (401, 403), f"HTTP {response.status}")
            response = anon_ctx.request.get(API + "/auth/owner-status", timeout=20000, fail_on_status_code=False)
            payload = safe_json(response) or {}
            check("匿名 /auth/owner-status 返回 authenticated=false 且 200",
                  response.status == 200 and payload.get("authenticated") is False, f"HTTP {response.status}")


@scenario("ins-editor-autosave", "INS 选图优先 / 自动保存 / 刷新恢复 / 发布 / 公开编辑工作副本", "C3/C1 · A3/A5/A7")
def s_ins_editor_autosave(browser: Any) -> None:
    cookies = SESSION.get("cookies")
    text = unique("ins")
    text_after = text + "-更新后"
    with open_page(browser, cookies=cookies) as (ctx, page):
        page.goto(BASE + "/admin/moments/new?returnTo=%2Fapps%2Fins", wait_until="load", timeout=60000)
        boot(page)
        check("INS 编辑页存在（data-editor=moment）", wait_editor_ready(page, "moment"))
        check("首屏有选图/上传入口（选图优先）", visible(page, "[data-media-picker-open]"))
        shot(page, "ins-editor-empty")

        # B1 桌面键盘：直接键盘输入 + Tab 焦点移动
        field = find(page, '[data-editor-field="text"]', "[data-editor] textarea")
        if field is not None:
            field.click()
            page.keyboard.type("键盘输入")
            check("桌面键盘可向编辑器输入", "键盘输入" in (field.input_value() or ""))
            first_focus = page.evaluate("() => document.activeElement ? document.activeElement.tagName : ''")
            page.keyboard.press("Tab")
            second_focus = page.evaluate("() => document.activeElement ? document.activeElement.tagName : ''")
            check("Tab 键可移动焦点", first_focus != second_focus or second_focus != "", f"{first_focus}->{second_focus}")

        check("编辑器输出 data-sync-state", sync_state(page) is not None)
        wrote = fill_editor(page, text, '[data-editor-field="text"]', "[data-editor] textarea")
        check("未选图即可输入正文", wrote)
        check("停止输入后自动保存到达 synced", wait_sync(page, ("synced",)), f"state={sync_state(page)}")
        check("synced 文案说明可跨设备继续（仅服务端确认后）", "另一设备" in page.inner_text("body"))
        shot(page, "ins-editor-synced")

        # 发布前集中列出阻塞原因
        if visible(page, "[data-editor-publish]"):
            click_first(page, "[data-editor-publish]")
            blocked = wait_editor_blockers(page)
            check("缺图发布前集中列出阻塞原因", blocked)
            if blocked:
                blockers = page.locator("[data-editor-blockers]").first.inner_text()
                check("阻塞原因包含图片相关说明", "图" in blockers, blockers[:120])
        else:
            check("新建动态有发布按钮", False, "未找到 [data-editor-publish]")

        # 选图 → 替代文本 → 确认
        check("选图上传/替代文本/确认完成", picker_flow(page, PNG_PATH, "P5 e2e 替代文本"))
        check("编辑器出现已选图片", page.locator("[data-editor-image]").count() >= 1,
              f"count={page.locator('[data-editor-image]').count()}")
        wait_sync(page, ("synced",), 20000)
        api = Api(page)
        target_draft = find_draft(api, "moment")
        check("服务端出现工作草稿（自动保存只写 work_drafts）", target_draft is not None)
        if target_draft is not None:
            check("草稿数据含刚输入的文字", text in json.dumps(target_draft.get("data") or {}, ensure_ascii=False),
                  str(target_draft.get("data"))[:120])
            check("草稿保留 1 张图片关系", len(target_draft.get("images") or []) == 1,
                  str(target_draft.get("images"))[:120])
        shot(page, "ins-editor-after-picker")

        # 刷新恢复（入口 id 写入 URL ?entry= → 本机副本可恢复）
        check("入口 id 已写入 URL（?entry=）", "entry=" in page.url, page.url)
        page.reload(wait_until="load", timeout=60000)
        boot(page)
        restored_text = wait_for(page, lambda: text in editor_text(page), 20000)
        check("刷新后恢复已保存文字（entryId + 本机副本）", restored_text, editor_text(page)[:80])
        check("刷新后恢复已上传图片关系", page.locator("[data-editor-image]").count() >= 1)
        if visible(page, "[data-editor-recovery]"):
            info("刷新后本机恢复提示", "出现 data-editor-recovery")
            click_first(page, "[data-editor-recovery-adopt]")
        wait_sync(page, ("synced",), 25000)
        check("恢复后重新同步到服务端", sync_state(page) == "synced", str(sync_state(page)))
        shot(page, "ins-editor-restored")

        # 发布
        click_first(page, "[data-editor-publish]")
        check("INS 发布成功（data-editor-success）", wait_editor_success(page))
        check("发布后 data-editor-status=published", editor_status(page) == "published", str(editor_status(page)))
        check("发布成功提供「查看动态」", visible(page, "[data-editor-view]") or "查看动态" in page.inner_text("body"))
        check("发布成功提供「再发一条」", visible(page, "[data-editor-again]"))
        shot(page, "ins-editor-published")

        #「再发一条」换 entryId 重挂
        old_url = page.url
        if click_first(page, "[data-editor-again]"):
            reopened = wait_for(page, lambda: "/admin/moments/new" in page.url and page.url != old_url, 10000)
            check("「再发一条」打开新的编辑会话", reopened, page.url)
            check("「再发一条」后编辑器为空", editor_text(page) == "", editor_text(page)[:40])
        else:
            check("「再发一条」按钮可点击", False)

    # 匿名可见 + 编辑已发布动态（自动保存隔离）
    with open_page(browser) as (anon_ctx, anon_page):
        items = public_moments(anon_ctx)
        mine = [item for item in items if isinstance(item, dict) and text in str(item.get("text") or "")]
        check("发布后匿名公开列表可见新动态", len(mine) == 1, f"matches={len(mine)}")
        if not mine:
            return
        moment_id = str(mine[0].get("id"))
        before_text = str(mine[0].get("text") or "")
        with open_page(browser, cookies=cookies) as (ctx2, page2):
            page2.goto(BASE + f"/admin/moments/{moment_id}/edit", wait_until="load", timeout=60000)
            boot(page2)
            check("已发布动态可进入独立编辑页", wait_editor_ready(page2, "moment"))
            check("已发布动态编辑页 status=published", editor_status(page2) == "published", str(editor_status(page2)))
            check("已发布动态没有「发布」按钮（只能更新）", not visible(page2, "[data-editor-publish]"))
            fill_editor(page2, text_after, '[data-editor-field="text"]', "[data-editor] textarea")
            wait_sync(page2, ("synced",), 25000)
            response = anon_ctx.request.get(API + f"/moments/{moment_id}", timeout=20000, fail_on_status_code=False)
            during = safe_json(response) or {}
            check("自动保存后匿名仍看到原内容（工作副本隔离）",
                  str(during.get("text") or "").startswith(before_text[:30]), str(during.get("text") or "")[:60])
            clicked = click_first(page2, "[data-editor-save]")  # 已发布：save 按钮 = update 动作
            check("明确「更新正式内容」提交成功", clicked and wait_editor_success(page2))
            updated = wait_for(
                page2,
                lambda: text_after
                in str((safe_json(anon_ctx.request.get(API + f"/moments/{moment_id}", timeout=20000)) or {}).get("text") or ""),
                15000,
            )
            check("明确提交后匿名读到新内容", updated)
            shot(page2, "ins-published-edited")


@scenario("draft-recovery-conflict", "跨设备恢复 + 412 冲突不静默覆盖", "C2/C1 · A6")
def s_draft_recovery_conflict(browser: Any) -> None:
    cookies = SESSION.get("cookies")
    text_a = unique("devA")
    text_b = unique("devB")
    text_a2 = text_a + "-冲突输入"
    with open_page(browser, cookies=cookies) as (ctx, page):
        api = Api(page)
        published = api_publish_moment(api, unique("anchor"))
        check("准备：发布一条锚点动态（用于产生已有 target 的工作草稿）", bool(published))
        if not published:
            return
        moment_id = str(published.get("target_id"))

    with open_page(browser, cookies=cookies) as (ctx_a, page_a):
        page_a.goto(BASE + f"/admin/moments/{moment_id}/edit", wait_until="load", timeout=60000)
        boot(page_a)
        check("设备 A 打开已发布动态编辑页", wait_editor_ready(page_a, "moment"))
        fill_editor(page_a, text_a, '[data-editor-field="text"]', "[data-editor] textarea")
        check("设备 A 自动保存 synced", wait_sync(page_a, ("synced",), 25000), str(sync_state(page_a)))
        api_a = Api(page_a)
        draft = find_draft(api_a, "moment", moment_id)
        check("已有 target 的工作草稿被创建/复用", draft is not None)
        if draft is None:
            return
        draft_id = str(draft.get("id"))
        version = int(draft.get("draft_version") or 1)

        # 设备 B：复制 cookie（不二次登录），跨设备打开同一工作草稿
        with open_page(browser, cookies=ctx_a.cookies()) as (ctx_b, page_b):
            page_b.goto(BASE + "/admin", wait_until="load", timeout=60000)
            boot(page_b)
            rows = page_b.locator("[data-workspace-draft-row]")
            check("设备 B 创作台「继续编辑」可见同一草稿", rows.count() >= 1, f"rows={rows.count()}")
            target_row = None
            for index in range(rows.count()):
                row = rows.nth(index)
                href = row.get_attribute("href") or ""
                if f"/{moment_id}/edit" in href:
                    target_row = row
                    break
            if target_row is None and rows.count():
                target_row = rows.first
            if target_row is not None:
                target_row.click()
            restored = wait_for(page_b, lambda: text_a in editor_text(page_b), 20000)
            check("设备 B 恢复设备 A 已同步的草稿文字（跨设备）", restored, editor_text(page_b)[:80])
            shot(page_b, "conflict-device-b")

            api_b = Api(page_b)
            response = api_b.patch_draft(draft_id, {"data": {"text": text_b}}, version)
            check("设备 B 保存工作副本成功（版本前进）", response.status == 200, f"HTTP {response.status}")
            if response.status != 200:
                return
            version = int((safe_json(response) or {}).get("draft_version") or version)

        # 设备 A 仍持旧版本 → 自动保存 412 → conflict，不静默覆盖
        fill_editor(page_a, text_a2, '[data-editor-field="text"]', "[data-editor] textarea")
        conflicted = wait_for(page_a, lambda: sync_state(page_a) == "conflict", 30000)
        check("设备 A 收到 412 后进入 conflict 状态（暂停自动保存）", conflicted, str(sync_state(page_a)))
        check("冲突提示 ConflictNotice 出现", visible(page_a, "[data-workspace-conflict]"))
        shot(page_a, "conflict-notice")
        response = api_a.get_draft(draft_id)
        server_text = str(((safe_json(response) or {}).get("data") or {}).get("text") or "")
        check("服务端草稿未被旧版本静默覆盖", server_text == text_b, server_text[:80])
        check("本地未保存输入仍保留", text_a2 in editor_text(page_a), editor_text(page_a)[:80])

        clicked = click_first(page_a, "[data-workspace-conflict-reload]")
        if clicked:
            reloaded = wait_for(page_a, lambda: text_b in editor_text(page_a), 20000)
            check("「载入最新版本」用服务端内容替换本地", reloaded, editor_text(page_a)[:80])
        else:
            check("ConflictNotice 提供「载入最新版本」动作", False, "未找到 [data-workspace-conflict-reload]")
        check("ConflictNotice 提供「另存为新草稿」动作", visible(page_a, "[data-workspace-conflict-save-as-new]"))

    # API 级：旧 draft_version 保存必须 412（不静默覆盖）
    with open_page(browser, cookies=cookies) as (ctx, page):
        api = Api(page)
        response = api.patch_draft(draft_id, {"data": {"text": "stale-write"}}, version - 1 if version > 1 else version)
        check("API：旧 draft_version 保存 → 412", response.status == 412, f"HTTP {response.status}")
        response = api.get_draft(draft_id)
        check("412 后服务端内容仍是设备 B 的版本",
              str(((safe_json(response) or {}).get("data") or {}).get("text") or "") == text_b)


@scenario("journal-private-public", "手记默认私密 / 保存≠公开 / 公开编辑工作副本", "C4/C1 · A4/A5")
def s_journal_private_public(browser: Any) -> None:
    cookies = SESSION.get("cookies")
    title = unique("journal")
    content = unique("journal-body")
    content_after = content + "-工作副本修改"
    entry_id: str | None = None
    with open_page(browser, cookies=cookies) as (ctx, page):
        page.goto(BASE + "/admin/journal/new?returnTo=%2Fapps%2Fjournal", wait_until="load", timeout=60000)
        boot(page)
        check("手记编辑页存在（data-editor=journal）", wait_editor_ready(page, "journal"))
        wait_for(page, lambda: editor_visibility(page) is not None, 15000)
        check("新手记默认 visibility=private", editor_visibility(page) == "private", str(editor_visibility(page)))
        check("新手记默认 status=draft", editor_status(page) == "draft", str(editor_status(page)))
        check("日期字段默认有值（站点时区）",
              bool((find(page, '[data-editor-field="date"]').input_value() if find(page, '[data-editor-field="date"]') else "")))
        check("图片入口是共享选择器（不再输入媒体 ID）",
              visible(page, "[data-media-picker-open]") and "媒体 ID" not in page.inner_text("body"))
        fill_editor(page, title, '[data-editor-field="title"]', '[data-editor] input[name="title"]')
        fill_editor(page, content, '[data-editor-field="content"]', "[data-editor] textarea")
        check("手记有明确的「保存」动作", visible(page, "[data-editor-save]"))
        click_first(page, "[data-editor-save]")
        check("手记保存成功反馈", wait_editor_success(page))
        shot(page, "journal-saved")

        api = Api(page)
        admin = safe_json(api.get("/admin/journal/entries?limit=20")) or {}
        items = admin.get("items") or []
        mine = [item for item in items if isinstance(item, dict) and str(item.get("title") or "") == title]
        check("保存后管理端出现手记", len(mine) == 1, f"matches={len(mine)}")
        if mine:
            entry_id = str(mine[0].get("id"))
            detail = safe_json(api.get(f"/admin/journal/entries/{entry_id}")) or {}
            check("保存后状态仍是 draft", detail.get("status") == "draft", str(detail.get("status")))
            check("保存后可见性仍是 private", detail.get("visibility") == "private", str(detail.get("visibility")))
        with open_page(browser) as (anon_ctx, anon_page):
            public_titles = [str(item.get("title") or "") for item in public_journal_items(anon_ctx) if isinstance(item, dict)]
            check("普通保存不会出现在公开手记列表（保存≠公开）", title not in public_titles)

        if not entry_id:
            return
        # 独立「公开」动作：进入正式草稿的独立编辑页
        page.goto(BASE + f"/admin/journal/{entry_id}/edit", wait_until="load", timeout=60000)
        boot(page)
        check("已有手记可进入独立编辑页", wait_editor_ready(page, "journal"))
        wait_for(page, lambda: editor_visibility(page) is not None, 15000)
        check("正式草稿仍 private", editor_visibility(page) == "private", str(editor_visibility(page)))
        check("手记有独立的「公开」动作", visible(page, "[data-editor-publish]"))
        click_first(page, "[data-editor-publish]")
        check("手记公开成功反馈", wait_editor_success(page))
        check("公开后 status=published", editor_status(page) == "published", str(editor_status(page)))
        detail = safe_json(api.get(f"/admin/journal/entries/{entry_id}")) or {}
        check("公开后服务端 visibility=public", detail.get("visibility") == "public", str(detail.get("visibility")))
        with open_page(browser) as (anon_ctx, anon_page):
            visible_public = wait_for(
                page,
                lambda: title
                in [str(item.get("title") or "") for item in public_journal_items(anon_ctx) if isinstance(item, dict)],
                15000,
            )
            check("公开后匿名公开列表可见", visible_public)
        shot(page, "journal-published")

        # 编辑已公开手记：工作副本不改变匿名视图，明确 update 才更新
        page.goto(BASE + f"/admin/journal/{entry_id}/edit", wait_until="load", timeout=60000)
        boot(page)
        wait_for(page, lambda: editor_visibility(page) is not None, 15000)
        check("已公开手记编辑页 visibility=public", editor_visibility(page) == "public", str(editor_visibility(page)))
        before_detail = safe_json(api.get(f"/journal/entries/{entry_id}")) or {}
        before_content = str(before_detail.get("content_md") or "")
        fill_editor(page, content_after, '[data-editor-field="content"]', "[data-editor] textarea")
        wait_sync(page, ("synced",), 25000)
        during = safe_json(api.get(f"/journal/entries/{entry_id}")) or {}
        check("自动保存不改变匿名视图（访客仍看原版本）", str(during.get("content_md") or "") == before_content,
              str(during.get("content_md") or "")[:60])
        check("已公开手记只能「更新正式内容」（无 publish 按钮）", not visible(page, "[data-editor-publish]"))
        clicked = click_first(page, "[data-editor-update]")
        check("「更新正式内容」提交成功", clicked and wait_editor_success(page))
        updated = wait_for(
            page,
            lambda: content_after
            in str((safe_json(api.get(f"/journal/entries/{entry_id}")) or {}).get("content_md") or ""),
            15000,
        )
        check("明确提交后匿名读到新正文", updated)
        shot(page, "journal-published-edited")


@scenario("leisure-quick", "放课后快捷更新：失败保留输入 / 不伪造成功", "C4 · A12")
def s_leisure_quick(browser: Any) -> None:
    cookies = SESSION.get("cookies")
    anime_title = unique("anime")
    game_title = unique("game")
    with open_page(browser, cookies=cookies) as (ctx, page):
        api = Api(page)
        created = safe_json(
            api.post(
                "/admin/leisure/entries",
                {"kind": "anime", "title": anime_title, "progress": "watching", "episodes_watched": 1, "notes": "p5 e2e seed"},
            )
        ) or {}
        anime_id = created.get("id")
        check("API 创建测试追番记录（独立数据）", bool(anime_id))
        if not anime_id:
            return
        version = int(created.get("version") or 1)
        check("测试追番记录发布", api.post(f"/admin/leisure/entries/{anime_id}/publish", None,
                                          headers={"If-Match": f'"{version}"'}).status == 200)
        pub = safe_json(api.get(f"/leisure/entries/{anime_id}")) or {}
        check("总集数未知 → completion_ratio 为 null（不生成百分比）",
              (pub.get("anime") or {}).get("completion_ratio") is None, str((pub.get("anime") or {}).get("completion_ratio")))

        page.goto(BASE + "/admin/leisure", wait_until="load", timeout=60000)
        boot(page)
        check("放课后管理页含快捷更新区（data-leisure-quick）", page.locator("[data-leisure-quick]").count() >= 1)
        if not select_leisure_entry(page, "anime", anime_title):
            check("快捷更新可选到测试追番记录", False)
            return
        check("快捷更新选中测试追番记录", visible(page, "[data-leisure-quick-current]"))
        ratio = find(page, "[data-leisure-quick-ratio]")
        if ratio is not None:
            check("总集数未知时快捷区 ratio=none", (ratio.get_attribute("data-leisure-quick-ratio") or "") == "none")
        quick = find(page, '[data-leisure-quick="anime"]')
        if quick is not None:
            check("快捷区不生成假的完成百分比", "%" not in quick.inner_text(), quick.inner_text()[:80])

        # 失败路径：拦截写请求 → 500；输入保留、不显示成功
        def fail_write(route: Any, request: Any) -> None:
            if request.method in ("POST", "PATCH", "PUT"):
                route.fulfill(status=500, content_type="application/json",
                              body=json.dumps({"error": {"code": "E2E_INJECTED", "message": "p5 e2e 注入失败"},
                                               "request_id": "e2e"}))
            else:
                route.continue_()

        page.route("**/api/v1/admin/leisure/**", fail_write)
        episodes = find(page, "[data-leisure-quick-episodes]")
        notes = find(page, "[data-leisure-quick-notes]")
        if episodes is not None:
            episodes.fill("3")
        if notes is not None:
            notes.fill("p5 e2e 失败保留")
        submit = find(page, "[data-leisure-quick-submit]")
        if submit is None:
            check("快捷更新有明确提交按钮", False)
            page.unroute("**/api/v1/admin/leisure/**")
            return
        submit.click()
        check("更新失败显示错误（不显示成功）", wait_for(page, lambda: visible(page, "[data-leisure-quick-error]"), 15000))
        check("失败时未出现成功状态", not visible(page, "[data-leisure-quick-success]"))
        if episodes is not None:
            check("失败时保留已填集数", episodes.input_value() == "3", episodes.input_value())
        if notes is not None:
            check("失败时保留已填短评", "失败保留" in notes.input_value(), notes.input_value()[:40])
        shot(page, "leisure-quick-failed")
        page.unroute("**/api/v1/admin/leisure/**")

        # 成功路径
        submit.click()
        check("恢复后重新提交成功（真实成功提示）", wait_for(page, lambda: visible(page, "[data-leisure-quick-success]"), 15000))
        admin_entry = safe_json(api.get(f"/admin/leisure/entries/{anime_id}")) or {}
        anime = admin_entry.get("anime") if isinstance(admin_entry.get("anime"), dict) else {}
        check("服务端确实更新了已看集数", anime.get("episodes_watched") == 3, str(anime.get("episodes_watched")))
        shot(page, "leisure-quick-success")

        # 游戏：状态 + 累计时长；不改「通关 / 全成就」
        game = safe_json(
            api.post("/admin/leisure/entries",
                     {"kind": "game", "title": game_title, "progress": "playing", "platform": "PC",
                      "playtime_minutes": 0, "notes": "p5 e2e game"})
        ) or {}
        game_id = game.get("id")
        if game_id:
            version = int(game.get("version") or 1)
            api.post(f"/admin/leisure/entries/{game_id}/publish", None, headers={"If-Match": f'"{version}"'})
            page.reload(wait_until="load", timeout=60000)
            boot(page)
            if select_leisure_entry(page, "game", game_title):
                playtime = find(page, "[data-leisure-quick-playtime]")
                if playtime is not None:
                    playtime.fill("120")
                submit_game = find(page, "[data-leisure-quick-submit]")
                if submit_game is not None:
                    submit_game.click()
                    check("游戏快捷更新提交成功", wait_for(page, lambda: visible(page, "[data-leisure-quick-success]"), 15000))
                    admin_game = safe_json(api.get(f"/admin/leisure/entries/{game_id}")) or {}
                    details = admin_game.get("game") if isinstance(admin_game.get("game"), dict) else {}
                    check("服务端更新游玩时长", details.get("playtime_minutes") == 120, str(details.get("playtime_minutes")))
                    check("快捷更新不推断「全成就」", details.get("all_achievements") in (None, False), str(details.get("all_achievements")))
                    check("快捷更新不推断「通关日期」", details.get("completed_on") is None, str(details.get("completed_on")))
            else:
                check("快捷更新可选到测试游戏记录", False)


@scenario("offline-auth-failure", "断网 / 上传失败 / 登录失效的准确反馈与恢复", "C2/C3 · A7")
def s_offline_auth_failure(browser: Any) -> None:
    cookies = SESSION.get("cookies")
    text = unique("offline")
    with open_page(browser, cookies=cookies) as (ctx, page):
        page.goto(BASE + "/admin/moments/new", wait_until="load", timeout=60000)
        boot(page)
        if not wait_editor_ready(page, "moment"):
            check("断网场景：编辑器可打开", False)
            return
        fill_editor(page, text, '[data-editor-field="text"]', "[data-editor] textarea")
        check("断网前自动保存 synced", wait_sync(page, ("synced",), 20000), str(sync_state(page)))

        ctx.set_offline(True)
        fill_editor(page, text + " 离线输入", '[data-editor-field="text"]', "[data-editor] textarea")
        check("断网后同步状态 failed（有准确反馈）", wait_for(page, lambda: sync_state(page) == "failed", 25000),
              str(sync_state(page)))
        check("断网保留本机输入", "离线输入" in editor_text(page))
        check("断网不显示虚假成功", not visible(page, "[data-editor-success]"))
        shot(page, "offline-failed")
        ctx.set_offline(False)
        fill_editor(page, text + " 恢复后输入", '[data-editor-field="text"]', "[data-editor] textarea")
        check("恢复网络后重新同步 synced", wait_sync(page, ("synced",), 30000), str(sync_state(page)))

        # 上传失败：伪造非图片文件
        invalid = pathlib.Path("/tmp/p5-e2e-invalid.png")
        invalid.write_bytes(b"not a real png, just bytes for upload failure test")
        if open_media_picker(page):
            wait_for(page, lambda: media_picker_visible(page), 8000)
            upload_in_picker(page, PNG_PATH)  # 先选一张合法的，验证失败不丢已选
            wait_for(page, lambda: page.locator("[data-media-picker-item]").count() >= 1, 25000)
            click_first(page, "[data-media-picker-item]")
            picked_before = picker_selected_count(page)
            upload_in_picker(page, invalid)
            check("上传非法文件显示失败原因", wait_for(page, lambda: visible(page, "[data-media-picker-error]"), 20000))
            check("上传失败保留已选图片", picker_selected_count(page) >= max(1, picked_before),
                  f"before={picked_before}, after={picker_selected_count(page)}")
            click_first(page, "[data-media-picker-cancel]")
            wait_for(page, lambda: not media_picker_visible(page), 8000)
        else:
            check("上传失败场景：选择器可打开", False)

        # 登录失效（401）：清 cookie 后输入 → 停止自动保存并提示
        ctx.clear_cookies()
        fill_editor(page, text + " 登录失效输入", '[data-editor-field="text"]', "[data-editor] textarea")
        expired = wait_for(page, lambda: visible(page, "[data-editor-auth-expired]"), 25000)
        check("登录失效显示「本机输入已保留」提示", expired)
        check("登录失效后本机输入仍保留", "登录失效输入" in editor_text(page))
        shot(page, "auth-expired")


@scenario("media-picker-pagination", "共享图片选择器：分页 / 选中不误判失效 / 公开引用提示", "C3/C1 · A11/A3")
def s_media_picker_pagination(browser: Any) -> None:
    cookies = SESSION.get("cookies")
    with open_page(browser, cookies=cookies) as (ctx, page):
        api = Api(page)
        media_ids: list[str] = []
        for _ in range(13):
            media = api.upload_media(PNG_PATH)
            if media:
                media_ids.append(str(media["id"]))
        check("API 上传 13 张测试图片", len(media_ids) == 13, f"uploaded={len(media_ids)}")
        if len(media_ids) < 13:
            return
        # 媒体列表分页：默认 limit 12 / 最大 30 / 31 → 422
        response = api.get("/admin/media?limit=12")
        payload = safe_json(response) or {}
        check("GET /admin/media?limit=12 返回 12 条 + next_cursor",
              response.status == 200 and len(payload.get("items") or []) == 12 and payload.get("next_cursor"),
              f"HTTP {response.status}, items={len(payload.get('items') or [])}")
        response = api.get("/admin/media?limit=31")
        check("GET /admin/media?limit=31 → 422（limit 上限 30）", response.status == 422, f"HTTP {response.status}")
        # 最新一张是公开引用 → 选择器提示「该图片已在其他位置公开」
        reference_media = media_ids[-1]
        draft = safe_json(
            api.create_draft("moment", data={"text": unique("ref"), "tags": [], "album_links": []},
                             images=[{"media_id": reference_media, "alt": "公开引用图"}])
        ) or {}
        if draft.get("id"):
            commit = api.commit_draft(str(draft["id"]), "publish", int(draft.get("draft_version") or 1), None, str(uuid.uuid4()))
            check("测试媒体产生公开引用（用于提示断言）", commit.status == 200, f"HTTP {commit.status}")

        page.goto(BASE + "/admin/moments/new", wait_until="load", timeout=60000)
        boot(page)
        if not open_media_picker(page):
            check("图片选择器可打开", False)
            return
        check("图片选择器可打开", wait_for(page, lambda: media_picker_visible(page), 8000))
        items = page.locator("[data-media-picker-item]")
        check("选择器首页按 12 条分页", items.count() == 12, f"items={items.count()}")
        warning = page.locator("[data-media-picker-warning]")
        check("已公开引用图片显示「该图片已在其他位置公开」", warning.count() >= 1)
        if warning.count():
            check("公开引用提示文案准确", "公开" in warning.first.inner_text(), warning.first.inner_text()[:80])
        # 选中第 1 张 → 翻页 → 已选仍在
        items.first.click()
        page.wait_for_timeout(400)
        picked_before = picker_selected_count(page)
        check("点击媒体可选中", picked_before >= 1, f"picked={picked_before}")
        next_button = find(page, "[data-media-picker-next]")
        if next_button is not None and next_button.is_enabled():
            next_button.click()
            check("「加载更多」追加下一页", wait_for(page, lambda: page.locator("[data-media-picker-item]").count() > 12, 10000),
                  f"items={page.locator('[data-media-picker-item]').count()}")
            picked_after = picker_selected_count(page)
            check("翻页后已选对象仍保留（不在当前页也不误判失效）",
                  picked_after == picked_before and picked_after >= 1, f"before={picked_before}, after={picked_after}")
            check("已选对象不被标成失效/删除", "失效" not in page.inner_text("body"))
            shot(page, "media-picker-next-page")
        else:
            check("选择器提供「加载更多」分页", False)
        if confirm_media_picker(page):
            check("确认后选择写回编辑器", wait_for(page, lambda: not media_picker_visible(page), 8000))
            check("编辑器收到已选图片", page.locator("[data-editor-image]").count() >= 1,
                  f"count={page.locator('[data-editor-image]').count()}")
        shot(page, "media-picker-selected")


@scenario("front-entries-return", "前台 owner 入口 + returnTo 恢复 + 手机上下文", "C3/C4/C2 · A1/A2")
def s_front_entries_return(browser: Any) -> None:
    cookies = SESSION.get("cookies")

    def href_of(page: Any, selector: str) -> str:
        locator = find(page, selector)
        if locator is None:
            return ""
        try:
            return locator.get_attribute("href") or ""
        except Exception:  # noqa: BLE001
            return ""

    with open_page(browser, cookies=cookies) as (ctx, page):
        # 1) INS 列表 → 发布动态 → 返回
        page.goto(BASE + "/apps/ins", wait_until="load", timeout=60000)
        boot(page)
        check("INS 列表有站主「发布动态」入口", visible(page, '[data-owner-entry="ins-new"]'))
        if visible(page, '[data-owner-entry="ins-new"]'):
            href = href_of(page, '[data-owner-entry="ins-new"]')
            check("入口 href 带 returnTo", "returnTo" in href, href[:120])
            click_first(page, '[data-owner-entry="ins-new"]')
            check("入口进入 /admin/moments/new", wait_for(page, lambda: "/admin/moments/new" in page.url, 10000), page.url)
            check("编辑器不被手机浮层遮挡（无可见 .pw-wrap）", not visible(page, ".pw-wrap"))
            shot(page, "front-ins-new-editor")
            click_first(page, "[data-editor-return]")
            check("返回来源 INS 列表", wait_for(page, lambda: "/apps/ins" in page.url and "returnTo" not in page.url, 10000), page.url)

        # 2) INS + phone 上下文：进入编辑先去掉 phone=，返回恢复
        tag = "p5-e2e-tag"
        page.goto(BASE + f"/apps/ins?tag={tag}&phone=ins&screen=feed", wait_until="load", timeout=60000)
        boot(page)
        if visible(page, '[data-owner-entry="ins-new"]'):
            click_first(page, '[data-owner-entry="ins-new"]')
            wait_for(page, lambda: "/admin/moments/new" in page.url, 10000)
            check("从手机浮层进入编辑后 URL 无 phone= 参数", "phone=" not in page.url, page.url)
            check("编辑器不被 .pw-wrap 遮挡", not visible(page, ".pw-wrap"))
            click_first(page, "[data-editor-return]")
            restored = wait_for(
                page, lambda: "/apps/ins" in page.url and "phone=ins" in page.url and f"tag={tag}" in page.url, 12000
            )
            check("返回后恢复来源页 + tag + 手机上下文", restored, page.url)
            check("返回后手机浮层重新出现", wait_for(page, lambda: visible(page, ".pw-wrap"), 6000))
        else:
            check("带 phone 上下文的 INS 页有站主入口", False)

        # 3) 手记（日历 → date 参数 → 返回）
        page.goto(BASE + "/apps/journal?phone=journal&screen=calendar", wait_until="load", timeout=60000)
        boot(page)
        if visible(page, '[data-owner-entry="journal-new"]'):
            click_first(page, '[data-owner-entry="journal-new"]')
            wait_for(page, lambda: "/admin/journal/new" in page.url, 10000)
            check("手记入口进入 /admin/journal/new", "/admin/journal/new" in page.url, page.url)
            check("日历入口 URL 带 date 参数", "date=" in page.url, page.url)
            info("日历入口 URL", page.url)
            click_first(page, "[data-editor-return]")
            check("手记返回恢复来源与手机上下文",
                  wait_for(page, lambda: "/apps/journal" in page.url and "screen=calendar" in page.url, 12000), page.url)
        else:
            check("手记页面有站主「写手记」入口", False)

        # 4) 手记列表页写手记入口
        page.goto(BASE + "/apps/journal", wait_until="load", timeout=60000)
        boot(page)
        check("手记列表有站主「写手记」入口", visible(page, '[data-owner-entry="journal-new"]'))

        # 5) 放课后 / 勒布朗总览
        page.goto(BASE + "/apps/leisure", wait_until="load", timeout=60000)
        boot(page)
        check("放课后页有站主快捷更新入口", visible(page, '[data-owner-entry="leisure-quick"]'))
        page.goto(BASE + "/apps/leblanc", wait_until="load", timeout=60000)
        boot(page)
        leblanc_entries = page.locator("[data-owner-entry]").count()
        check("勒布朗总览有站主入口（发布动态/写手记/更新进度）", leblanc_entries >= 3, f"count={leblanc_entries}")

        # 6) 非法 returnTo → 回 /admin
        page.goto(BASE + "/admin/moments/new?returnTo=https%3A%2F%2Fevil.example%2F", wait_until="load", timeout=60000)
        boot(page)
        click_first(page, "[data-editor-return]")
        wait_for(page, lambda: "/admin/moments/new" not in page.url, 10000)
        check("非法 returnTo 被拒绝（停留在站内）",
              page.url.startswith(BASE) and "evil.example" not in page.url and page.url.rstrip("/").endswith("/admin"),
              page.url)

    # 匿名：前台无站主入口
    with open_page(browser) as (anon_ctx, anon_page):
        for path in ("/apps/ins", "/apps/journal", "/apps/leisure", "/apps/leblanc"):
            anon_page.goto(BASE + path, wait_until="load", timeout=60000)
            boot(anon_page, wait_ms=900)
            check(f"匿名 {path} 无站主入口", anon_page.locator("[data-owner-entry]").count() == 0)


@scenario("publish-idempotency", "提交幂等 / 失败回滚（API 级）", "C1 · A8")
def s_publish_idempotency(browser: Any) -> None:
    with open_page(browser, cookies=SESSION.get("cookies")) as (ctx, page):
        api = Api(page)
        text = unique("idem")
        draft = safe_json(api.create_draft("moment", data={"text": text, "tags": [], "album_links": []})) or {}
        draft_id = str(draft.get("id") or "")
        version = int(draft.get("draft_version") or 1)
        check("API 创建工作草稿", bool(draft_id))
        if not draft_id:
            return
        # 无 ready 图 → 发布校验失败 422，草稿保持 active，正式内容不变
        before = safe_json(api.get("/moments?limit=30")) or {}
        before_count = len(before.get("items") or [])
        bad = api.commit_draft(draft_id, "publish", version, None, str(uuid.uuid4()))
        check("无 ready 图发布 → 422（复用正式发布校验）", bad.status == 422, f"HTTP {bad.status}")
        after = safe_json(api.get("/moments?limit=30")) or {}
        check("发布失败不产生正式内容", len(after.get("items") or []) == before_count)
        refreshed = safe_json(api.get_draft(draft_id)) or {}
        check("发布失败后草稿仍 active", refreshed.get("status") == "active", str(refreshed.get("status")))
        version = int(refreshed.get("draft_version") or version)

        media = api.upload_media(PNG_PATH)
        if not media:
            check("上传发布用图片", False)
            return
        patched = api.patch_draft(draft_id, {"images": [{"media_id": media["id"], "alt": "幂等图"}]}, version)
        check("补图保存工作副本", patched.status == 200, f"HTTP {patched.status}")
        version = int((safe_json(patched) or {}).get("draft_version") or version)
        commit_key = str(uuid.uuid4())
        first = api.commit_draft(draft_id, "publish", version, None, commit_key)
        first_payload = safe_json(first) or {}
        check("首次提交发布成功", first.status == 200 and first_payload.get("status") == "published", f"HTTP {first.status}")
        target_id = str(first_payload.get("target_id") or "")
        check("提交返回正式内容 ID", bool(target_id))

        replay = api.commit_draft(draft_id, "publish", version, None, commit_key)
        replay_payload = safe_json(replay) or {}
        check("同 key 重试 → 200 幂等回放（优先于 If-Match）",
              replay.status == 200 and replay_payload.get("idempotent_replay") is True,
              f"HTTP {replay.status}, replay={replay_payload.get('idempotent_replay')}")
        check("幂等回放返回同一正式内容 ID", str(replay_payload.get("target_id") or "") == target_id)
        other = api.commit_draft(draft_id, "publish", version, None, str(uuid.uuid4()))
        check("不同 key 二次提交 → 409", other.status == 409, f"HTTP {other.status}")
        public = safe_json(api.get("/moments?limit=30")) or {}
        matches = [item for item in public.get("items") or []
                   if isinstance(item, dict) and text in str(item.get("text") or "")]
        check("重复提交没有生成重复动态", len(matches) == 1, f"matches={len(matches)}")


@scenario("media-privacy-discard", "私密草稿图片不可匿名访问 / 丢弃不破坏引用（API 级）", "C1 · A9/A10")
def s_media_privacy_discard(browser: Any) -> None:
    with open_page(browser, cookies=SESSION.get("cookies")) as (ctx, page):
        api = Api(page)
        media = api.upload_media(PNG_PATH)
        check("上传测试媒体", bool(media))
        if not media:
            return
        media_id = media["id"]
        draft = safe_json(
            api.create_draft(
                "journal",
                data={"entry_date": time.strftime("%Y-%m-%d"), "title": unique("private-journal"),
                      "content_md": "p5 e2e 私密草稿图片", "mood": "", "location": "", "post_id": None},
                images=[{"media_id": media_id, "alt": "私密草稿图"}],
            )
        ) or {}
        check("创建保留媒体的手记工作草稿", bool(draft.get("id")))
        if not draft.get("id"):
            return
        with open_page(browser) as (anon_ctx, anon_page):
            for variant in ("original", "w320.webp"):
                anon = anon_ctx.request.get(API + f"/media/{media_id}/{variant}", timeout=20000, fail_on_status_code=False)
                check(f"匿名读取私密草稿图片（{variant}）→ 404", anon.status == 404, f"HTTP {anon.status}")
            anon = anon_ctx.request.get(API + "/admin/work-drafts", timeout=20000, fail_on_status_code=False)
            check("匿名读取工作草稿列表 → 401", anon.status in (401, 403), f"HTTP {anon.status}")
        discarded = api.delete(f"/admin/work-drafts/{draft['id']}")
        check("丢弃工作草稿 → 204", discarded.status == 204, f"HTTP {discarded.status}")
        admin_media = api.get(f"/admin/media/{media_id}")
        check("丢弃草稿后媒体记录仍存在（只解除关系，不删文件）", admin_media.status == 200, f"HTTP {admin_media.status}")
        with open_page(browser) as (anon_ctx, anon_page):
            anon = anon_ctx.request.get(API + f"/media/{media_id}/original", timeout=20000, fail_on_status_code=False)
            check("丢弃后匿名仍不可读（未授予权限）", anon.status == 404, f"HTTP {anon.status}")

        ref_payload = api_publish_moment(api, unique("ref-public"))
        check("复用同一媒体发布公开动态", bool(ref_payload))
        if ref_payload:
            target_id = str(ref_payload.get("target_id") or "")
            target_version = int(ref_payload.get("target_version") or 1)
            with open_page(browser) as (anon_ctx, anon_page):
                anon = anon_ctx.request.get(API + f"/media/{media_id}/original", timeout=20000, fail_on_status_code=False)
                check("公开引用后匿名可读同一媒体", anon.status == 200, f"HTTP {anon.status}")
            if target_id:
                unpublish = api.post(f"/admin/moments/{target_id}/unpublish", None,
                                     headers={"If-Match": f'"{target_version}"'})
                check("撤回公开动态（A10 回归冒烟）", unpublish.status == 200, f"HTTP {unpublish.status}")
                with open_page(browser) as (anon_ctx, anon_page):
                    anon = anon_ctx.request.get(API + f"/media/{media_id}/original", timeout=20000, fail_on_status_code=False)
                    check("撤回后匿名重新不可读（多来源规则不回归）", anon.status == 404, f"HTTP {anon.status}")


@scenario("mobile-viewports", "320/390 小屏布局 + 编辑器全屏单列", "C3/C4 · B1")
def s_mobile_viewports(browser: Any) -> None:
    cookies = SESSION.get("cookies")
    for width, height in ((390, 844), (320, 720)):
        label = f"{width}x{height}"
        with open_page(browser, cookies=cookies, viewport=(width, height), mobile=True) as (ctx, page):
            page.goto(BASE + "/admin", wait_until="load", timeout=60000)
            boot(page)
            overflow = page.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
            check(f"[{label}] 创作台无横向溢出", overflow <= 0, f"overflow={overflow}")
            shot(page, f"mobile-{label}-workspace")

            page.goto(BASE + "/admin/moments/new", wait_until="load", timeout=60000)
            boot(page)
            if not wait_editor_ready(page, "moment", 20000):
                check(f"[{label}] INS 编辑页打开", False)
                continue
            metrics = page.evaluate(
                """() => {
                  const el = document.querySelector('[data-editor="moment"]');
                  const style = el ? getComputedStyle(el) : null;
                  const rect = el ? el.getBoundingClientRect() : null;
                  const actions = [...document.querySelectorAll('[data-editor-save],[data-editor-publish],[data-editor-update],[data-editor-return]')]
                    .map(a => { const r = a.getBoundingClientRect(); return {w: r.width, h: r.height, top: r.top, bottom: r.bottom}; });
                  return {
                    position: style ? style.position : null,
                    width: rect ? rect.width : 0,
                    overflowX: document.documentElement.scrollWidth - window.innerWidth,
                    actions,
                    viewport: {w: window.innerWidth, h: window.innerHeight},
                  };
                }"""
            )
            check(f"[{label}] 编辑器为全视口固定层", metrics["position"] == "fixed", str(metrics["position"]))
            check(f"[{label}] 编辑器宽度贴合视口（单列）", abs(metrics["width"] - metrics["viewport"]["w"]) <= 2,
                  f"{metrics['width']} vs {metrics['viewport']['w']}")
            check(f"[{label}] 编辑器内无横向溢出", metrics["overflowX"] <= 0, f"overflow={metrics['overflowX']}")
            for index, action in enumerate(metrics["actions"]):
                check(f"[{label}] 关键操作 #{index} 触控目标 ≥44px", action["h"] >= 44, f"h={action['h']:.0f}")
                check(f"[{label}] 关键操作 #{index} 在视口内可点",
                      action["top"] >= 0 and action["bottom"] <= metrics["viewport"]["h"],
                      f"top={action['top']:.0f}, bottom={action['bottom']:.0f}")
            shot(page, f"mobile-{label}-editor")

            page.goto(BASE + "/admin/journal/new", wait_until="load", timeout=60000)
            boot(page)
            if wait_editor_ready(page, "journal", 20000):
                journal = page.evaluate(
                    """() => {
                      const el = document.querySelector('[data-editor="journal"]');
                      const style = el ? getComputedStyle(el) : null;
                      return {position: style ? style.position : null,
                              overflowX: document.documentElement.scrollWidth - window.innerWidth};
                    }"""
                )
                check(f"[{label}] 手记编辑器为全视口固定层", journal["position"] == "fixed", str(journal["position"]))
                check(f"[{label}] 手记编辑器无横向溢出", journal["overflowX"] <= 0, f"overflow={journal['overflowX']}")
                shot(page, f"mobile-{label}-journal")
            else:
                check(f"[{label}] 手记编辑页打开", False)


@scenario("webkit-smoke", "WebKit 引擎移动冒烟（≠真机，B2 部分证据）", "C5 · B1/B2", engines=("webkit",))
def s_webkit_smoke(browser: Any) -> None:
    """WebKit + iPhone 视口：只证明 Safari 内核渲染/输入路径，**不能替代真机**。"""
    viewport = (390, 844)
    cookies: list[dict] = []
    with open_page(browser, viewport=viewport, mobile=True) as (ctx, page):
        page.goto(BASE + "/admin/login?returnTo=%2Fapps%2Fins", wait_until="load", timeout=60000)
        boot(page)
        page.fill("input[name=username]", USER)
        page.fill("input[name=password]", PASSWORD)
        page.click("button[type=submit]")
        ok = wait_for(page, lambda: "/admin/login" not in page.url or "已登录" in page.inner_text("body"), 15000)
        check("[WebKit] 站主登录", ok, page.url)
        if not ok:
            return
        cookies = ctx.cookies()
        page.wait_for_timeout(1500)
        page.goto(BASE + "/admin", wait_until="load", timeout=60000)
        boot(page)
        check("[WebKit] 创作台首页渲染", visible(page, "[data-workspace-home]"))
        shot(page, "webkit-workspace-home")
        page.goto(BASE + "/admin/moments/new", wait_until="load", timeout=60000)
        boot(page)
        check("[WebKit] INS 编辑器打开", wait_editor_ready(page, "moment"))
        overflow = page.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
        check("[WebKit] 编辑器无横向溢出", overflow <= 0, f"overflow={overflow}")
        metrics = page.evaluate(
            """() => {
              const el = document.querySelector('[data-editor="moment"]');
              const style = el ? getComputedStyle(el) : null;
              const actions = [...document.querySelectorAll('[data-editor-save],[data-editor-publish],[data-editor-return]')]
                .map(a => { const r = a.getBoundingClientRect(); return {h: r.height}; });
              return {position: style ? style.position : null, actions};
            }"""
        )
        check("[WebKit] 移动端编辑器为全视口固定层", metrics["position"] == "fixed", str(metrics["position"]))
        check("[WebKit] 触控目标 ≥44px", all(a["h"] >= 44 for a in metrics["actions"]),
              str([a["h"] for a in metrics["actions"]]))
        wrote = fill_editor(page, unique("webkit"), '[data-editor-field="text"]', "[data-editor] textarea")
        check("[WebKit] 编辑器可输入", wrote)
        shot(page, "webkit-editor")
    for width, height in ((390, 844), (320, 720)):
        with open_page(browser, cookies=cookies, viewport=(width, height), mobile=True) as (ctx2, page2):
            page2.goto(BASE + "/admin/moments/new", wait_until="load", timeout=60000)
            boot(page2)
            wait_editor_ready(page2, "moment")
            overflow = page2.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
            check(f"[WebKit {width}x{height}] 编辑器无横向溢出", overflow <= 0, f"overflow={overflow}")
            page2.screenshot(path=str(SHOTS / f"{STAMP}-webkit-{width}x{height}-editor.png"))
    check("WebKit 冒烟完成（≠真机：触控/软键盘/中文输入法仍为未验证）", True)



# ═══════════════════════════════════════════════════════════════════════════
# 选择器契约清单（骨架模式打印；集成后按此核对 data-*）
# ═══════════════════════════════════════════════════════════════════════════

SELECTOR_CONTRACT: dict[str, list[str]] = {
    "前台入口（契约 §9.5 + C3/C4 实际交付）": [
        '[data-owner-entry="ins-new|ins-edit|journal-new|journal-edit|leisure-quick|leisure-edit|leblanc-start-moment|leblanc-start-journal|leblanc-start-leisure"]',
    ],
    "创作台首页（C2）": [
        "[data-workspace-home]",
        '[data-workspace-start="moment|journal|anime|game"]',
        "[data-workspace-draft-row]",
        "[data-workspace-draft-open]",
        "[data-workspace-drafts-empty] / [data-workspace-drafts-error]",
        "[data-workspace-recent-row] / [data-workspace-recent-empty]",
        "[data-workspace-manage-link]",
    ],
    "编辑器（C2 shell + C3/C4 页面）": [
        '[data-editor="moment|journal"]',
        "[data-editor-status]（draft|published）",
        "[data-editor-visibility]（private|public，仅手记）",
        '[data-editor-field="text|title|content|date|mood|location"]',
        "[data-editor-save] / [data-editor-publish] / [data-editor-update]（各带 data-editor-submit-action）",
        "[data-editor-blockers] / [data-editor-error] / [data-editor-success]",
        "[data-editor-return] / [data-editor-recovery] / [data-editor-recovery-adopt] / [data-editor-recovery-discard]",
        "[data-editor-auth-expired] / [data-editor-again] / [data-editor-view] / [data-editor-image]",
    ],
    "同步与冲突（C2）": [
        '[data-sync-state="idle|local-only|saving|synced|failed|conflict"]',
        "[data-workspace-conflict] / [data-workspace-conflict-reload] / [data-workspace-conflict-save-as-new]",
    ],
    "图片选择器（C3）": [
        "[data-media-picker]",
        "[data-media-picker-open]",
        "[data-media-picker-item]（含 data-media-id）",
        "input[data-media-picker-upload]",
        "[data-media-picker-picked] / [data-media-picker-alt] / [data-media-picker-remove] / [data-media-picker-move-up|move-down]",
        "[data-media-picker-warning] / [data-media-picker-error] / [data-media-picker-next] / [data-media-picker-confirm] / [data-media-picker-cancel]",
    ],
    "相册与放课后（C3/C4）": [
        "[data-album-picker] / [data-album-admin-link]",
        '[data-leisure-quick="anime|game"] / [data-leisure-quick-kind="anime|game"]',
        "[data-leisure-quick-current] / [data-leisure-quick-episodes|playtime|progress|notes|airing]",
        "[data-leisure-quick-ratio]（none = 总集数未知，不生成百分比）",
        "[data-leisure-quick-submit] / [data-leisure-quick-error] / [data-leisure-quick-success]",
    ],
}



def print_skeleton_banner() -> None:
    print(f"== P5 站主创作台 e2e（骨架模式，BASE={BASE}）==")
    print("P5_E2E_READY != 1 → 不启动浏览器、不产生断言（集成完成后加 P5_E2E_READY=1 启用）。\n")
    print("场景清单（共 %d 个）：" % len(SCENARIOS))
    for item in SCENARIOS:
        engines = "/".join(item["engines"])
        print(f"  - [{item['id']:<24}] {item['title']}  （{item['owner']}；engine={engines}）")
    print("\ndata-* 选择器契约（契约 §9.5 + 本脚本所需）：")
    for group, selectors in SELECTOR_CONTRACT.items():
        print(f"  {group}")
        for selector in selectors:
            print(f"    {selector}")
    print("\n用法：")
    print("  bash tools/e2e-stack.sh up")
    print("  P5_E2E_READY=1 python3 tools/e2e-p5-workspace.py http://127.0.0.1:3130 [-- 场景过滤用 P5_E2E_SCENARIOS]")
    print("  E2E_ENGINE=webkit P5_E2E_READY=1 python3 tools/e2e-p5-workspace.py")
    print("  bash tools/e2e-stack.sh down")
    print("\n退出码 0（骨架模式，无断言）。")


# ── 主流程 ─────────────────────────────────────────────────────────────────

SESSION: dict[str, Any] = {}


def login_session(browser: Any) -> list[dict] | None:
    """单次登录：同时验证登录页 returnTo；返回 cookie 供全部场景复用（避免 5/min 限流）。"""
    cookies: list[dict] | None = None
    with open_page(browser) as (ctx, page):
        page.goto(BASE + "/admin/login?returnTo=%2Fapps%2Fins", wait_until="load", timeout=60000)
        boot(page)
        check("登录页可访问（/admin/login）", "username" in page.content())
        page.fill("input[name=username]", USER)
        page.fill("input[name=password]", PASSWORD)
        page.click("button[type=submit]")
        ok = wait_for(
            page,
            lambda: "/admin/login" not in page.url or "已登录" in page.inner_text("body"),
            12000,
        )
        check("站主登录成功（每次运行仅 1 次登录，全部场景复用 cookie）", ok, page.url)
        if ok:
            redirected = wait_for(page, lambda: "/apps/ins" in page.url, 6000)
            check("登录页 returnTo 生效（→ /apps/ins）", redirected, page.url)
            shot(page, "00-login")
            cookies = ctx.cookies()
    return cookies


def selected_scenarios() -> list[dict[str, Any]]:
    candidates = [item for item in SCENARIOS if ENGINE in item["engines"]]
    if ONLY:
        candidates = [item for item in candidates if item["id"] in ONLY]
    return candidates


def write_summary() -> None:
    payload = {
        "base": BASE,
        "engine": ENGINE,
        "viewport": f"{MAIN_VIEWPORT[0]}x{MAIN_VIEWPORT[1]}",
        "ready": READY,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "pass": PASS,
        "fail": FAIL,
        "skip": SKIP,
        "info": INFO,
    }
    try:
        SUMMARY_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass


def main() -> int:
    print_skeleton_banner() if not READY else None
    if not READY:
        write_summary()
        return 0

    from playwright.sync_api import sync_playwright

    SHOTS.mkdir(parents=True, exist_ok=True)
    if not PNG_PATH.exists():
        write_test_png(PNG_PATH)

    scenarios = selected_scenarios()
    print(f"== P5 站主创作台 e2e：{BASE}（engine={ENGINE}，viewport={MAIN_VIEWPORT[0]}x{MAIN_VIEWPORT[1]}）==")
    print(f"   场景 {len(scenarios)} 个；截图目录 {SHOTS}")
    if not scenarios:
        print("✗ 没有匹配的场景（检查 E2E_ENGINE / P5_E2E_SCENARIOS）")
        return 1

    started = time.time()
    with sync_playwright() as playwright:
        launcher = getattr(playwright, ENGINE)
        browser = launcher.launch(headless=HEADLESS)
        try:
            if ENGINE == "chromium":
                SESSION["cookies"] = login_session(browser)
                if SESSION["cookies"] is None:
                    print("✗ 站主登录失败，终止（隔离栈是否已 up？账号 owner/e2e-password-123）")
                    write_summary()
                    return 1
            for item in scenarios:
                print(f"\n── 场景 [{item['id']}] {item['title']}（{item['owner']}）")
                try:
                    item["fn"](browser)
                except Exception as error:  # noqa: BLE001
                    FAIL.append(f"[{item['id']}] 场景异常：{type(error).__name__}: {error}")
                    print(f"  ✗ 场景异常：{type(error).__name__}: {error}")
        finally:
            try:
                browser.close()
            except Exception:  # noqa: BLE001
                pass

    elapsed = time.time() - started
    print("\n== 结果 ==")
    print(f"  通过 {len(PASS)} 项；失败 {len(FAIL)} 项；跳过 {len(SKIP)} 项；信息 {len(INFO)} 条；耗时 {elapsed:.0f}s")
    print(f"  截图：{SHOTS}")
    for item in FAIL:
        print(f"  ✗ {item}")
    for item in SKIP:
        print(f"  ⋯ {item}")
    write_summary()
    return 0 if not FAIL else 1


if __name__ == "__main__":
    sys.exit(main())
