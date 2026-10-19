#!/usr/bin/env python3
"""P5 返工包 R1/R2/R3 独立浏览器端到端验收（真实 Playwright chromium，隔离栈专用）。

目标：为 2026-10-19 P5 独立验收返工包的三项 P1 提供**真实浏览器**的「改前失败 / 改后通过」
证据，不改应用源码、不碰共享环境：

  R1  保存失败（PATCH 500）时编辑器不得继续 commit 旧草稿、不得显示成功、不得清本机副本；
      解除阻断后重试，正式内容必须等于当前表单（而不是旧服务端内容）。
  R2  仅有工作草稿、尚无正式 target 的新动态/新手记，必须能在**无 localStorage** 的第二
      设备上下文中从创作台「继续编辑」恢复；同类多份不串稿；错误 ID / 跨类型 / 已丢弃草稿
      必须给出明确提示，不静默新建空白内容。
  R3  桌面斜屏手机上 INS 会话必须能找到自由输入入口（`.msg-composer`）、用量提示
      （`.msg-usage`）与「展开查看」（`.pw-expand` → 会话 canonical），并能在
      1440×1000 / 390×844 / 320×700 视口输入发送、控件不互相遮挡。

环境安全（硬约束，不要改）：
  - 只打隔离栈：`bash tools/e2e-stack.sh up|status|down`
    （Postgres 集群 55434 / API 8130 / 前端 3130 / 数据目录 /tmp/pl-e2e-stack）。
  - **绝不**触碰共享 3100 / 8100 / 8000 / 55432，也不要复用共享 .next。
  - 登录限流 5 次/分钟：每次运行只登录 1 次，其余 context 复制 cookie（不复制 localStorage，
    等价「另一台没有本机缓存的设备」）。
  - 写型测试只打隔离栈；本脚本不修改应用源码 / 既有 e2e 脚本 / 配置。

用法：
    bash tools/e2e-stack.sh up
    python3 tools/e2e-p5-rework.py                       # 全部场景
    python3 tools/e2e-p5-rework.py --scenarios r1-ins,r3-phone
    python3 tools/e2e-p5-rework.py --json /path/out.json --phase baseline
    bash tools/e2e-stack.sh down

环境变量：
    E2E_ADMIN_USER / E2E_ADMIN_PASSWORD   默认 owner / e2e-password-123（e2e-stack.sh 创建）
    E2E_SHOTS_DIR                         截图根目录，默认 .dsh/screenshots/p5-rework
    E2E_HEADLESS                          "0" 显示窗口（调试）

退出码：0 = 全部断言通过；1 = 有关键失败（预期基线为 1）；2 = 环境/前置错误（栈没起、登录失败等）。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import re
import struct
import subprocess
import sys
import time
import traceback
import uuid
import zlib
from contextlib import contextmanager
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, urlparse

# 本机系统代理会把 127.0.0.1 也送进代理（Python 3.13 urllib 不读系统 ExceptionsList）：
# 必须在任何 HTTP 之前设置（e2e-stack.sh 里同样的坑）。
os.environ.setdefault("no_proxy", "127.0.0.1,localhost,::1")
os.environ.setdefault("NO_PROXY", os.environ["no_proxy"])

REPO = pathlib.Path(__file__).resolve().parents[1]
DEFAULT_BASE = "http://127.0.0.1:3130"
WORK = pathlib.Path("/tmp/pl-e2e-stack")
DEFAULT_SHOTS_ROOT = pathlib.Path("/Users/学习/blog/.dsh/screenshots/p5-rework")
STAMP = time.strftime("%Y%m%d-%H%M%S")
PNG_RED = pathlib.Path(f"/tmp/p5-rework-red-{os.getpid()}.png")
PNG_BLUE = pathlib.Path(f"/tmp/p5-rework-blue-{os.getpid()}.png")
# 只命中 PATCH /admin/work-drafts/<id>（不含 /commit 的 POST）：route/unroute 必须用同一对象。
WORK_DRAFT_PATCH_ROUTE = re.compile(r"/api/v1/admin/work-drafts/[0-9a-fA-F-]+$")

USER = os.environ.get("E2E_ADMIN_USER", "owner")
PASSWORD = os.environ.get("E2E_ADMIN_PASSWORD", "e2e-password-123")
HEADLESS = os.environ.get("E2E_HEADLESS", "1").strip() != "0"
SCENARIO_ORDER = [
    "r1-ins",
    "r1-journal",
    "r2-moment",
    "r2-journal",
    "r3-phone",
    # task-4 补证场景
    "r1-guards",
    "r2-save-as-new",
    "r3-extra",
]
REQUIRED_VIEWPORTS = ["1440x1000", "390x844", "320x700"]
COVERAGE_ADDED = [
    "R1 412 冲突（真实浏览器）：API 推前草稿版本 → 自动保存 412 → conflict 暂停 + ConflictNotice + 提交按钮 disabled + commit 0 + 输入/本机副本保留（真实服务端 412，不是 route 假造）",
    "R1 401 登录失效（真实浏览器）：注入 PATCH 401 → failed + data-editor-auth-expired + 点保存 commit 0 + 本机副本保留",
    "R1 相册新建 saveNow 调用方（真实浏览器）：PATCH 500 下点「新建相册」→ data-editor-error 真实提示、无 unhandled rejection、页面未崩溃、无虚假成功、新标签页行为记录",
    "R1 提交期间更晚输入（真实浏览器）：延迟 commit 响应在途时继续输入 → 放行成功 → 正式内容=提交快照、更晚输入本机副本未被成功回调清除",
    "R2 另存为新草稿（真实浏览器 UI）：412 冲突 → 点「另存为新草稿」→ 新 draft(target_id=null) → 设备 B 无 localStorage 用 ?draft= 恢复正文与图片顺序；原草稿未被覆盖",
    "R3 草稿保留（真实浏览器）：手机会话输入不发送 → .pw-back 返回列表再进入 / 收起手机重开 / 「展开查看」进 canonical 再返回手机，均按 drafts.ts 的 sessionStorage 约定恢复",
    "R3 发送失败重试（真实浏览器）：拦截 POST /messaging/conversations/<id>/messages 返回 500 → 错误反馈 + 草稿不丢 → 解除拦截重试成功并清空草稿",
    "R3 用量展示（真实浏览器）：.msg-usage 可见且文案符合「今天已用 x / y 次自由聊天 | 自由聊天每天最多 y 次」格式（额度耗尽态仍未覆盖）",
    "R3 音乐继续播放（真实浏览器，资源可用时）：手机桌面播放后进入 INS 会话，audio[data-pl-music] 未暂停且 currentTime 前进、.pw-tab.playing 保持",
]


UNVERIFIED = [
    "真机 / iOS / Android 浏览器、真实触控命中与软键盘遮挡：未验证（本脚本只有桌面 chromium，390/320 只是视口，不是真机）",
    "中文/日文输入法 composition 真机行为：未验证（Composer 的 IME 逻辑只有单测；本脚本不模拟真实输入法）",
    "R2 真实双物理设备并发：跨设备恢复用「第二浏览器上下文（复制 cookie、无 localStorage）」，非两台物理设备",
    "弱网/长时间输入稳定性：只做短时故障注入（PATCH 500/401/412、commit 延迟、发送 500），未做长时弱网",
    "R3 自由聊天额度耗尽/不可发送态的端到端复现：需真实耗尽每日额度（20 次/访客/天），本轮不真实耗尽，只验证 usage 展示与格式",
    "R3 音乐在真机/WebKit 及静音策略下的行为：只验证桌面 chromium 下手机会话内继续播放；真机与自动播放策略差异未验证",
    "R1 412/401/相册/提交期输入只做前端故障注入（真实隔离 API + Playwright route），未做真实网络分区/多物理设备并发",
    "D1 Docker 健康检查错配、生产部署、迁移 round-trip、OpenAPI/gen:api 漂移：本轮不改后端/契约，未重跑（D1 未获授权）",
]


# ═══════════════════════════════════════════════════════════════════════════
# 报告
# ═══════════════════════════════════════════════════════════════════════════


class Reporter:
    def __init__(self) -> None:
        self.checks: list[dict[str, Any]] = []
        self.skips: list[dict[str, Any]] = []
        self.infos: list[dict[str, Any]] = []
        self.screenshots: list[str] = []
        self.scenario_order: list[str] = []
        self.env_error = False
        self._current: str = "global"

    def begin(self, scenario: str) -> None:
        self._current = scenario
        self.scenario_order.append(scenario)

    def check(self, label: str, ok: bool, detail: str = "") -> bool:
        entry = {"scenario": self._current, "label": label, "ok": bool(ok), "detail": str(detail)}
        self.checks.append(entry)
        print(f"  {'✓' if ok else '✗'} {label}" + (f" — {detail}" if detail else ""))
        return bool(ok)

    def skip(self, label: str, reason: str) -> None:
        self.skips.append({"scenario": self._current, "label": label, "reason": reason})
        print(f"  ⋯ SKIP {label} — {reason}")

    def info(self, label: str, value: Any = "") -> None:
        text = f"{label} — {value}" if value != "" else label
        self.infos.append({"scenario": self._current, "text": text})
        print(f"  · info: {text}")

    def scenario_status(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for scenario in self.scenario_order:
            mine = [item for item in self.checks if item["scenario"] == scenario]
            passed = sum(1 for item in mine if item["ok"])
            failed = sum(1 for item in mine if not item["ok"])
            skipped = sum(1 for item in self.skips if item["scenario"] == scenario)
            if failed:
                status = "FAIL"
            elif passed:
                status = "PASS"
            else:
                status = "SKIP"
            out.append(
                {
                    "id": scenario,
                    "status": status,
                    "passed": passed,
                    "failed": failed,
                    "skipped": skipped,
                }
            )
        return out


REPORT = Reporter()


# ═══════════════════════════════════════════════════════════════════════════
# 通用小工具（风格沿用 tools/e2e-p5-workspace.py / tools/e2e-im-draft.py）
# ═══════════════════════════════════════════════════════════════════════════


def unique(prefix: str) -> str:
    return f"p5rw-{prefix}-{STAMP}-{uuid.uuid4().hex[:8]}"


def write_test_png(path: pathlib.Path, rgb: tuple[int, int, int], width: int = 640, height: int = 480) -> pathlib.Path:
    """标准库生成纯色 PNG（不依赖 PIL / 外部资源）。"""

    def chunk(tag: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + tag
            + payload
            + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
        )

    row = b"\x00" + bytes(rgb) * width
    raw = row * height
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)  # 8bit RGB
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 6))
        + chunk(b"IEND", b"")
    )
    return path


def parse_viewport(value: str) -> tuple[int, int]:
    parts = value.lower().replace("×", "x").split("x")
    if len(parts) == 2 and all(part.strip().isdigit() for part in parts):
        return int(parts[0]), int(parts[1])
    return 1440, 1000


def wait_for(page: Any, predicate: Callable[[], bool], timeout_ms: int = 15000, interval_ms: int = 250) -> bool:
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
    """点击第一个可见匹配元素；被浮层拦截时退回 DOM click。"""
    target = None
    for selector in selectors:
        try:
            candidates = page.locator(selector)
            for index in range(candidates.count()):
                candidate = candidates.nth(index)
                if candidate.is_visible():
                    target = candidate
                    break
            if target is not None:
                break
        except Exception:  # noqa: BLE001
            continue
    if target is None:
        return False
    try:
        target.click(timeout=4000)
        return True
    except Exception:  # noqa: BLE001
        try:
            target.evaluate("el => el.click()")
            return True
        except Exception:  # noqa: BLE001
            return False


def dismiss_floating_poll(page: Any) -> None:
    """站内浮动投票卡 z-index 高于选择器，会拦住点击；这是用户级关闭动作。"""
    try:
        closers = page.locator(".poll-close")
        for index in range(closers.count()):
            closer = closers.nth(index)
            if closer.is_visible():
                closer.click(timeout=2000)
                page.wait_for_timeout(150)
    except Exception:  # noqa: BLE001
        pass


def boot(page: Any, wait_ms: int = 1500) -> None:
    """跳过站点开场 / 关闭浮层（既有 e2e 脚本的统一做法）。"""
    page.wait_for_timeout(wait_ms)
    try:
        if page.locator("#boot").count():
            page.keyboard.press("Enter")
            try:
                page.wait_for_selector("#boot", state="detached", timeout=8000)
            except Exception:  # noqa: BLE001
                pass
            page.wait_for_timeout(400)
    except Exception:  # noqa: BLE001
        pass
    dismiss_floating_poll(page)


def shot(page: Any, scenario: str, name: str) -> str:
    SHOTS.mkdir(parents=True, exist_ok=True)
    path = SHOTS / f"{scenario}--{name}.png"
    try:
        page.screenshot(path=str(path))
        REPORT.screenshots.append(str(path))
    except Exception as error:  # noqa: BLE001
        REPORT.info("截图失败", f"{name}: {error}")
        return ""
    return str(path)


@contextmanager
def open_page(
    browser: Any,
    cookies: list[dict] | None = None,
    viewport: tuple[int, int] | None = None,
) -> Iterator[tuple[Any, Any]]:
    width, height = viewport or (1440, 1000)
    context = browser.new_context(
        viewport={"width": width, "height": height},
        locale="zh-CN",
        device_scale_factor=1,
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


def safe_json(response: Any) -> Any:
    try:
        return response.json()
    except Exception:  # noqa: BLE001
        return None


def url_query(page: Any) -> dict[str, list[str]]:
    try:
        return parse_qs(urlparse(page.url).query)
    except Exception:  # noqa: BLE001
        return {}


def query_one(page: Any, key: str) -> str | None:
    values = url_query(page).get(key) or []
    return values[0] if values else None


# ── 编辑器稳定钩子（契约 §9.5）────────────────────────────────────────────


def sync_state(page: Any) -> str | None:
    locator = find(page, "[data-sync-state]")
    try:
        return locator.get_attribute("data-sync-state") if locator else None
    except Exception:  # noqa: BLE001
        return None


def wait_sync(page: Any, states: tuple[str, ...] = ("synced",), timeout_ms: int = 25000) -> bool:
    wanted = set(states)
    return wait_for(page, lambda: sync_state(page) in wanted, timeout_ms)


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


def wait_editor_ready(page: Any, content_type: str, timeout_ms: int = 25000) -> bool:
    return wait_for(page, lambda: visible(page, f'[data-editor="{content_type}"]'), timeout_ms)


def editor_text(page: Any) -> str:
    for selector in (
        '[data-editor-field="text"]',
        '[data-editor-field="content"]',
        '[data-editor="moment"] textarea',
        "[data-editor] textarea",
    ):
        locator = find(page, selector)
        if locator is not None:
            try:
                return locator.input_value() or ""
            except Exception:  # noqa: BLE001
                continue
    return ""


def wait_editor_fields(page: Any, timeout_ms: int = 20000) -> bool:
    return wait_for(
        page,
        lambda: page.locator('[data-editor-field="title"]').count() > 0
        or page.locator('[data-editor-field="text"]').count() > 0
        or page.locator('[data-editor-field="content"]').count() > 0,
        timeout_ms,
    )


def fill_editor(page: Any, value: str, *selectors: str) -> bool:
    locator = find(page, *selectors)
    if locator is None:
        return False
    try:
        locator.fill(value)
        return True
    except Exception:  # noqa: BLE001
        return False


def editor_image_ids(page: Any) -> list[str]:
    try:
        return page.locator("[data-editor-image]").evaluate_all(
            "els => els.map(el => el.getAttribute('data-editor-image') || '')"
        )
    except Exception:  # noqa: BLE001
        return []


def moment_thumb_alts(page: Any) -> list[str]:
    try:
        return page.locator(".ins-editor-thumb-alt").all_inner_texts()
    except Exception:  # noqa: BLE001
        return []


def journal_image_ids(page: Any) -> list[str]:
    try:
        return page.locator("[data-journal-image]").evaluate_all(
            "els => els.map(el => el.getAttribute('data-journal-image') || '')"
        )
    except Exception:  # noqa: BLE001
        return []


def journal_images_text(page: Any) -> str:
    locator = find(page, "[data-journal-images]")
    try:
        return locator.inner_text() if locator else ""
    except Exception:  # noqa: BLE001
        return ""


def local_copies(page: Any) -> list[tuple[str, str]]:
    """读取本机恢复副本（localStorage key = pl.workdraft.v1.*）。"""
    try:
        return page.evaluate(
            """() => {
              const out = [];
              for (let i = 0; i < localStorage.length; i += 1) {
                const key = localStorage.key(i);
                if (key && key.startsWith('pl.workdraft.v1.')) {
                  out.push([key, localStorage.getItem(key) || '']);
                }
              }
              return out;
            }"""
        )
    except Exception:  # noqa: BLE001
        return []


def local_copy_contains(page: Any, marker: str) -> bool:
    return any(marker in value for _, value in local_copies(page))


# ═══════════════════════════════════════════════════════════════════════════
# API（在已登录的浏览器 context 里直连，等同第二设备 / 种子数据工具）
# ═══════════════════════════════════════════════════════════════════════════


class Api:
    """复用页面 cookie 与 CSRF；写请求手动补 Origin（服务端 core/csrf.py::verify_origin）。"""

    def __init__(self, page: Any) -> None:
        self.page = page
        self._csrf: str | None = None

    def csrf(self) -> str:
        if self._csrf is None:
            try:
                response = self.page.context.request.get(API + "/auth/session", timeout=20000)
                payload = safe_json(response) or {}
                self._csrf = str(payload.get("csrf_token") or "")
            except Exception:  # noqa: BLE001
                self._csrf = ""
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
            merged.setdefault("Origin", BASE)
            merged.setdefault("Referer", BASE + "/")
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
        response = self.fetch(
            "POST",
            "/admin/media",
            multipart={"file": {"name": image_path.name, "mimeType": "image/png", "buffer": image_path.read_bytes()}},
        )
        if response.status != 201:
            REPORT.info("上传媒体失败", f"HTTP {response.status}")
            return None
        payload = safe_json(response)
        return payload if isinstance(payload, dict) else None

    def list_drafts(self, content_type: str | None = None) -> list[dict[str, Any]]:
        path = "/admin/work-drafts?limit=30"  # 服务端 MAX_LIMIT=30（>30 会 422）
        if content_type:
            path += f"&content_type={content_type}"
        response = self.get(path)
        payload = safe_json(response) or {}
        items = payload.get("items")
        return [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []

    def get_draft(self, draft_id: str) -> dict[str, Any]:
        return safe_json(self.get(f"/admin/work-drafts/{draft_id}")) or {}

    def create_draft(
        self,
        content_type: str,
        target_id: str | None = None,
        data: dict[str, Any] | None = None,
        images: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"content_type": content_type}
        if target_id is not None:
            body["target_id"] = target_id
        if data is not None:
            body["data"] = data
        if images is not None:
            body["images"] = images
        response = self.post("/admin/work-drafts", body)
        payload = safe_json(response) or {}
        return payload if isinstance(payload, dict) else {}

    def patch_draft(self, draft_id: str, patch: dict[str, Any], draft_version: int) -> Any:
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


API = DEFAULT_BASE + "/api/v1"
BASE = DEFAULT_BASE
SHOTS = DEFAULT_SHOTS_ROOT


def api_admin_moment(api: Api, moment_id: str) -> dict[str, Any]:
    return safe_json(api.get(f"/admin/moments/{moment_id}")) or {}


def api_admin_journal(api: Api, entry_id: str) -> dict[str, Any]:
    return safe_json(api.get(f"/admin/journal/entries/{entry_id}")) or {}


def find_new_draft(
    api: Api, content_type: str, marker: str, timeout_ms: int = 25000
) -> dict[str, Any] | None:
    """在服务端工作草稿列表里找「还没有正式 target」且内容包含 marker 的那份。"""
    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        for item in api.list_drafts(content_type):
            if item.get("target_id"):
                continue
            blob = json.dumps(item.get("data") or {}, ensure_ascii=False) + str(item.get("summary") or "")
            if marker in blob:
                return item
        time.sleep(0.6)
    return None


def find_existing_draft(api: Api, content_type: str, target_id: str) -> dict[str, Any] | None:
    for item in api.list_drafts(content_type):
        if str(item.get("target_id") or "") == target_id:
            return item
    return None


def api_publish_moment(api: Api, text: str) -> dict[str, Any] | None:
    """上传 1 张图 → 建动态工作草稿 → commit publish，返回 commit 回执（含 target_id）。"""
    media = api.upload_media(PNG_RED)
    if not media:
        return None
    envelope = api.create_draft(
        "moment",
        data={"text": text, "tags": [], "album_links": []},
        images=[{"media_id": media["id"], "alt": "p5rw 故障注入锚点图"}],
    )
    draft = envelope.get("draft") or {}
    if not draft.get("id"):
        REPORT.info("创建锚点动态草稿失败", str(envelope)[:200])
        return None
    response = api.commit_draft(
        str(draft["id"]),
        "publish",
        int(draft["draft_version"] or 1),
        None,
        str(uuid.uuid4()),
    )
    payload = safe_json(response) or {}
    return payload if response.status == 200 else None


def api_create_published_album(api: Api, media_id: str, title: str) -> dict[str, Any] | None:
    """用 API 建一本已公开相册（用于 R2「相册收录」恢复断言）。"""
    slug = "p5rw-" + uuid.uuid4().hex[:10]
    created = safe_json(
        api.post(
            "/admin/albums",
            {
                "slug": slug,
                "title": title,
                "description": "p5rw e2e 相册",
                "kind": "photo",
                "photos": [{"media_id": media_id, "position": 0, "alt": "p5rw 相册照片"}],
            },
        )
    ) or {}
    album_id = created.get("id")
    if not album_id:
        REPORT.info("创建测试相册失败", str(created)[:200])
        return None
    version = int(created.get("version") or 1)
    response = api.post(f"/admin/albums/{album_id}/publish", None, headers={"If-Match": f'"{version}"'})
    if response.status != 200:
        REPORT.info("发布测试相册失败", f"HTTP {response.status}")
        return None
    return {"id": str(album_id), "slug": slug, "title": title}


# ── 媒体选择器（共享组件；R2 图片/顺序/alt 用）─────────────────────────────


def open_media_picker(page: Any) -> bool:
    return click_first(page, "[data-media-picker-open]")


def media_picker_visible(page: Any) -> bool:
    return visible(page, "[data-media-picker]")


def picker_picked_count(page: Any) -> int:
    return page.locator("[data-media-picker-picked]").count()


def pick_images(page: Any, images: list[pathlib.Path], alts: list[str]) -> bool:
    """打开共享选择器 → 上传 N 张 → 逐图填替代文本 → 确认。"""
    dismiss_floating_poll(page)
    if not open_media_picker(page):
        return False
    if not wait_for(page, lambda: media_picker_visible(page), 10000):
        return False
    uploader = find(page, "input[data-media-picker-upload]", "[data-media-picker] input[type=file]")
    if uploader is None:
        return False
    for index, image_path in enumerate(images):
        try:
            uploader.set_input_files(str(image_path))
        except Exception as error:  # noqa: BLE001
            REPORT.info("上传图片失败", str(error)[:160])
            return False
        expected = index + 1
        if not wait_for(page, lambda: picker_picked_count(page) >= expected, 25000):
            return False
        page.wait_for_timeout(250)
    alt_inputs = page.locator("[data-media-picker-alt]")
    for index in range(min(alt_inputs.count(), len(alts))):
        try:
            alt_inputs.nth(index).fill(alts[index])
        except Exception:  # noqa: BLE001
            pass
    if not click_first(page, "[data-media-picker-confirm]"):
        return False
    return wait_for(page, lambda: not media_picker_visible(page), 10000)


# ═══════════════════════════════════════════════════════════════════════════
# 登录（全程只登录 1 次，避免 5 次/分钟限流）
# ═══════════════════════════════════════════════════════════════════════════


def login_once(browser: Any) -> list[dict] | None:
    with open_page(browser) as (context, page):
        page.goto(BASE + "/admin/login?returnTo=%2Fadmin", wait_until="load", timeout=60000)
        boot(page)
        user_field = page.locator("input[name=username]")
        pass_field = page.locator("input[name=password]")
        if not user_field.count():
            REPORT.check("环境：/admin/login 登录表单存在", False, page.locator("body").inner_text()[:200])
            return None
        user_field.fill(USER)
        pass_field.fill(PASSWORD)
        page.click("button[type=submit]")
        ok = wait_for(
            page,
            lambda: "/admin/login" not in page.url or "已登录" in page.inner_text("body"),
            15000,
        )
        REPORT.check("环境：站主单次登录成功（cookie 供全部场景复用）", ok, page.url)
        if not ok:
            return None
        wait_for(page, lambda: "/admin" in page.url, 10000)
        cookies = context.cookies()
        # 用同一 context 的 request 复核一次 owner 会话，避免拿匿名 cookie 跑全套。
        response = context.request.get(API + "/auth/session", timeout=20000)
        payload = safe_json(response) or {}
        authenticated = bool(payload.get("authenticated") or payload.get("role") == "owner")
        REPORT.check("环境：登录后 /auth/session 为站主会话", authenticated, json.dumps(payload, ensure_ascii=False)[:200])
        if not authenticated:
            return None
        return cookies


# ═══════════════════════════════════════════════════════════════════════════
# R1 · 保存失败不得继续 commit 旧草稿
# ═══════════════════════════════════════════════════════════════════════════


def r1_common_assertions(
    page: Any,
    api: Api,
    kind: str,
    official_before: str,
    latest_text: str,
    patch_requests: list[str],
    commit_requests: list[str],
) -> None:
    """阻断 PATCH 后点保存/更新的共同断言（R1 关闭条件）。"""
    REPORT.check(f"故障注入确实命中了 PATCH（{kind}）", len(patch_requests) >= 1, f"PATCH 次数={len(patch_requests)}")
    REPORT.check(
        f"PATCH 失败后点保存，commit 请求次数为 0（{kind}）",
        len(commit_requests) == 0,
        f"commit 次数={len(commit_requests)}，URL={commit_requests[:3]}",
    )
    REPORT.check(
        f"PATCH 失败后没有显示成功提示（{kind}）",
        not visible(page, "[data-editor-success]"),
        f"data-editor-success={'可见' if visible(page, '[data-editor-success]') else '不可见'}",
    )
    REPORT.check(
        f"最新输入仍保留在编辑器（{kind}）",
        latest_text in editor_text(page),
        f"编辑器正文={editor_text(page)[:80]!r}",
    )
    REPORT.check(
        f"本机恢复副本包含最新输入、未被清除（{kind}）",
        local_copy_contains(page, latest_text),
        f"localStorage keys={[key for key, _ in local_copies(page)]}",
    )
    if kind == "moment":
        official_after = str(api_admin_moment(api, CURRENT_MOMENT_ID).get("text") or "")
    else:
        official_after = str(api_admin_journal(api, CURRENT_JOURNAL_ID).get("content_md") or "")
    REPORT.check(
        f"正式内容未被旧草稿覆盖（PATCH 失败期间）（{kind}）",
        official_after == official_before,
        f"正式内容={official_after[:80]!r}，期望={official_before[:80]!r}",
    )


CURRENT_MOMENT_ID = ""
CURRENT_JOURNAL_ID = ""


def scenario_r1_ins(browser: Any, cookies: list[dict]) -> None:
    global CURRENT_MOMENT_ID
    scenario = "r1-ins"
    REPORT.begin(scenario)
    print(f"\n── [{scenario}] R1-INS：阻断 PATCH 后「更新正式内容」不得 commit 旧草稿")

    with open_page(browser, cookies=cookies) as (context, page):
        api = Api(page)
        published = api_publish_moment(api, unique("r1-ins-anchor"))
        if not published or not published.get("target_id"):
            REPORT.check("准备：发布一条已有动态（产生已有 target）", False, str(published)[:200])
            return
        moment_id = str(published["target_id"])
        CURRENT_MOMENT_ID = moment_id
        REPORT.check("准备：发布一条已有动态（产生已有 target）", True, moment_id)

        page.goto(BASE + f"/admin/moments/{moment_id}/edit", wait_until="load", timeout=60000)
        boot(page)
        if not wait_editor_ready(page, "moment"):
            REPORT.check("已发布动态编辑页可用（data-editor=moment）", False, page.url)
            return
        REPORT.check("已发布动态编辑页可用（data-editor=moment）", True)
        wait_editor_fields(page)

        # 先写入一版并同步 → 服务端已有该 target 的工作草稿
        stale_text = unique("r1-ins-stale")
        if not fill_editor(page, stale_text, '[data-editor-field="text"]', "[data-editor] textarea"):
            REPORT.check("编辑器可写入旧版本文字", False)
            return
        synced_before = wait_sync(page, ("synced",), 25000)
        REPORT.check("准备：旧版本内容已同步到工作草稿", synced_before, f"sync_state={sync_state(page)}")
        draft = find_existing_draft(api, "moment", moment_id)
        REPORT.check("准备：服务端存在该 target 的工作草稿", draft is not None)
        official_before = str(api_admin_moment(api, moment_id).get("text") or "")

        # 故障注入：只阻断 PATCH /admin/work-drafts/<id>（commit 仍是 POST，放行）
        patch_requests: list[str] = []
        commit_requests: list[str] = []

        def handle_work_draft(route: Any, request: Any) -> None:
            if request.method == "PATCH":
                patch_requests.append(request.url)
                route.fulfill(
                    status=500,
                    content_type="application/json",
                    body=json.dumps(
                        {
                            "error": {"code": "E2E_INJECTED", "message": "p5rw 故障注入：保存失败"},
                            "request_id": "p5rw-e2e",
                        },
                        ensure_ascii=False,
                    ),
                )
            else:
                route.continue_()

        def on_request(request: Any) -> None:
            if request.method == "POST" and "/api/v1/admin/work-drafts/" in request.url and request.url.endswith("/commit"):
                commit_requests.append(request.url)

        page.route(WORK_DRAFT_PATCH_ROUTE, handle_work_draft)
        page.on("request", on_request)

        latest_text = unique("r1-ins-latest")
        fill_editor(page, latest_text, '[data-editor-field="text"]', "[data-editor] textarea")
        clicked = click_first(page, "[data-editor-update]", "[data-editor-save]")
        if not clicked:
            REPORT.check("点「更新正式内容」（已发布动态）", False, "找不到 data-editor-update/save")
            return
        page.wait_for_timeout(4500)

        r1_common_assertions(
            page, api, "moment", official_before, latest_text, patch_requests, commit_requests
        )
        shot(page, scenario, "blocked-save")

        # 解除阻断 → 重试；正式内容必须等于最新输入（不是旧服务端内容）
        page.unroute(WORK_DRAFT_PATCH_ROUTE)
        before_retry_commits = len(commit_requests)
        retried = click_first(page, "[data-editor-update]", "[data-editor-save]")
        REPORT.check("解除阻断后可以重试「更新正式内容」", retried)
        success = wait_for(page, lambda: visible(page, "[data-editor-success]"), 20000) if retried else False
        REPORT.check("解除阻断后重试 commit 成功（data-editor-success）", success)
        REPORT.check(
            "重试时确实发出了 commit 请求",
            len(commit_requests) > before_retry_commits,
            f"commit 次数 {before_retry_commits}→{len(commit_requests)}",
        )
        updated = wait_for(
            page,
            lambda: latest_text in str(api_admin_moment(api, moment_id).get("text") or ""),
            15000,
        )
        official_after = str(api_admin_moment(api, moment_id).get("text") or "")
        REPORT.check(
            "重试后正式内容等于最新输入（不是旧服务端内容）",
            updated,
            f"正式内容={official_after[:100]!r}",
        )
        shot(page, scenario, "recovered")


def scenario_r1_journal(browser: Any, cookies: list[dict]) -> None:
    global CURRENT_JOURNAL_ID
    scenario = "r1-journal"
    REPORT.begin(scenario)
    print(f"\n── [{scenario}] R1-手记：阻断 PATCH 后「保存」不得 commit 旧草稿")

    title = unique("r1-journal-title")
    official_content = unique("r1-journal-official")
    stale_content = unique("r1-journal-stale")
    latest_content = unique("r1-journal-latest")

    with open_page(browser, cookies=cookies) as (context, page):
        api = Api(page)
        page.goto(BASE + "/admin/journal/new?returnTo=%2Fadmin%2Fjournal", wait_until="load", timeout=60000)
        boot(page)
        if not wait_editor_ready(page, "journal"):
            REPORT.check("准备：新手记编辑页可用（data-editor=journal）", False, page.url)
            return
        wait_editor_fields(page)
        fill_editor(page, title, '[data-editor-field="title"]')
        fill_editor(page, official_content, '[data-editor-field="content"]')
        if not wait_sync(page, ("synced",), 25000):
            REPORT.check("准备：新手记工作草稿已同步", False, f"sync_state={sync_state(page)}")
            return
        REPORT.check("准备：新手记工作草稿已同步", True)
        clicked = click_first(page, "[data-editor-save]")
        ok = clicked and wait_for(page, lambda: visible(page, "[data-editor-success]"), 20000)
        REPORT.check("准备：保存正式手记草稿成功", ok)
        if not ok:
            return
        items = (safe_json(api.get("/admin/journal/entries?limit=20")) or {}).get("items") or []
        mine = [item for item in items if str(item.get("title") or "") == title]
        if not mine:
            REPORT.check("准备：管理端能查到刚保存的手记", False, str(items)[:200])
            return
        entry_id = str(mine[0]["id"])
        CURRENT_JOURNAL_ID = entry_id
        REPORT.check("准备：管理端能查到刚保存的手记", True, entry_id)

        # 进入已有手记编辑页 → 同步一版 stale 内容
        page.goto(BASE + f"/admin/journal/{entry_id}/edit", wait_until="load", timeout=60000)
        boot(page)
        if not wait_editor_ready(page, "journal"):
            REPORT.check("已有手记编辑页可用", False, page.url)
            return
        REPORT.check("已有手记编辑页可用", True)
        wait_editor_fields(page)
        fill_editor(page, stale_content, '[data-editor-field="content"]')
        REPORT.check(
            "准备：旧版本内容已同步到工作草稿",
            wait_sync(page, ("synced",), 25000),
            f"sync_state={sync_state(page)}",
        )
        official_before = str(api_admin_journal(api, entry_id).get("content_md") or "")

        patch_requests: list[str] = []
        commit_requests: list[str] = []

        def handle_work_draft(route: Any, request: Any) -> None:
            if request.method == "PATCH":
                patch_requests.append(request.url)
                route.fulfill(
                    status=500,
                    content_type="application/json",
                    body=json.dumps(
                        {"error": {"code": "E2E_INJECTED", "message": "p5rw 故障注入"}, "request_id": "p5rw"},
                        ensure_ascii=False,
                    ),
                )
            else:
                route.continue_()

        def on_request(request: Any) -> None:
            if request.method == "POST" and "/api/v1/admin/work-drafts/" in request.url and request.url.endswith("/commit"):
                commit_requests.append(request.url)

        page.route(WORK_DRAFT_PATCH_ROUTE, handle_work_draft)
        page.on("request", on_request)

        fill_editor(page, latest_content, '[data-editor-field="content"]')
        clicked = click_first(page, "[data-editor-save]")
        if not clicked:
            REPORT.check("点「保存」按钮", False, "找不到 data-editor-save")
            return
        page.wait_for_timeout(4500)
        r1_common_assertions(
            page, api, "journal", official_before, latest_content, patch_requests, commit_requests
        )
        shot(page, scenario, "blocked-save")

        page.unroute(WORK_DRAFT_PATCH_ROUTE)
        before_retry_commits = len(commit_requests)
        retried = click_first(page, "[data-editor-save]")
        REPORT.check("解除阻断后可以重试保存", retried)
        success = wait_for(page, lambda: visible(page, "[data-editor-success]"), 20000) if retried else False
        REPORT.check("解除阻断后重试保存成功（data-editor-success）", success)
        REPORT.check(
            "重试时确实发出了 commit 请求",
            len(commit_requests) > before_retry_commits,
            f"commit 次数 {before_retry_commits}→{len(commit_requests)}",
        )
        updated = wait_for(
            page,
            lambda: latest_content in str(api_admin_journal(api, entry_id).get("content_md") or ""),
            15000,
        )
        official_after = str(api_admin_journal(api, entry_id).get("content_md") or "")
        REPORT.check(
            "重试后正式内容等于最新输入（不是旧服务端内容）",
            updated,
            f"正式内容={official_after[:100]!r}",
        )
        shot(page, scenario, "recovered")


# ═══════════════════════════════════════════════════════════════════════════
# R2 · 新草稿跨设备恢复
# ═══════════════════════════════════════════════════════════════════════════


def row_for_draft(page: Any, draft_id: str) -> Any:
    return page.locator(f'[data-workspace-draft-open="{draft_id}"]')


def open_row_and_wait_editor(page: Any, draft_id: str, content_type: str) -> bool:
    row = row_for_draft(page, draft_id)
    if row.count() == 0:
        return False
    try:
        row.first.click(timeout=6000)
    except Exception:  # noqa: BLE001
        try:
            row.first.evaluate("el => el.click()")
        except Exception:  # noqa: BLE001
            return False
    return wait_editor_ready(page, content_type, 25000)


def scenario_r2_moment(browser: Any, cookies: list[dict]) -> None:
    scenario = "r2-moment"
    REPORT.begin(scenario)
    print(f"\n── [{scenario}] R2-新动态：A 只自动保存，B 无本机缓存跨设备恢复（含不串稿）")

    text1 = unique("r2-moment-one")
    text2 = unique("r2-moment-two")
    alt1 = unique("r2-alt-one")
    alt2 = unique("r2-alt-two")
    album_title = unique("r2-album")

    draft1: dict[str, Any] | None = None
    draft2: dict[str, Any] | None = None
    album: dict[str, Any] | None = None

    # ── 设备 A：新建动态 1（文字 + 2 图 + alt，只自动保存）───────────────
    with open_page(browser, cookies=cookies) as (context_a, page_a):
        api = Api(page_a)
        page_a.goto(BASE + "/admin/moments/new?returnTo=%2Fadmin", wait_until="load", timeout=60000)
        boot(page_a)
        if not wait_editor_ready(page_a, "moment"):
            REPORT.check("设备 A：新动态编辑页可用", False, page_a.url)
            return
        REPORT.check("设备 A：新动态编辑页可用", True)
        wait_editor_fields(page_a)
        fill_editor(page_a, text1, '[data-editor-field="text"]', "[data-editor] textarea")

        # 先经 API 建一本已公开相册（收录选择恢复用；建不起来就 SKIP 该子项）
        uploaded = api.upload_media(PNG_BLUE)
        if uploaded and uploaded.get("id"):
            album = api_create_published_album(api, str(uploaded["id"]), album_title)
            REPORT.check("准备：API 创建并公开测试相册（收录选择断言用）", album is not None)
        if album is None:
            REPORT.skip("相册收录选择恢复", "隔离栈媒体/相册接口不可用")

        picked = pick_images(page_a, [PNG_RED, PNG_BLUE], [alt1, alt2])
        REPORT.check("设备 A：上传并选中 2 张图（含替代文本）", picked)
        REPORT.check(
            "设备 A：自动保存到达 synced",
            wait_sync(page_a, ("synced",), 30000),
            f"sync_state={sync_state(page_a)}",
        )
        body = page_a.inner_text("body")
        REPORT.check(
            "设备 A：synced 文案说明可跨设备继续（「另一设备」）",
            "另一设备" in body,
            body[:120],
        )

        draft1 = find_new_draft(api, "moment", text1)
        REPORT.check("服务端出现无 target 的新动态工作草稿", draft1 is not None)
        if draft1 is None:
            return
        draft1_id = str(draft1["id"])
        server_image_ids = [str(item.get("media_id")) for item in (draft1.get("images") or [])]
        server_alts = [str(item.get("alt") or "") for item in (draft1.get("images") or [])]
        REPORT.check(
            "服务端草稿图片顺序 = 编辑器顺序（顺序即发布顺序）",
            editor_image_ids(page_a) == server_image_ids,
            f"{editor_image_ids(page_a)} vs {server_image_ids}",
        )
        REPORT.check(
            "服务端草稿保留替代文本",
            alt1 in server_alts and alt2 in server_alts,
            str(server_alts),
        )
        shot(page_a, scenario, "device-a-draft1")

        # 相册收录选择（可选）
        if album is not None:
            added = add_album_link(page_a, album)
            REPORT.check("设备 A：动态草稿可添加「同时收录到相册」选择", added)
            if added:
                wait_sync(page_a, ("synced",), 25000)
                current = find_new_draft(api, "moment", text1) or draft1
                links = (current.get("data") or {}).get("album_links") or []
                linked = any(
                    str(link.get("album_id") or "") == album["id"] for link in links if isinstance(link, dict)
                )
                REPORT.check(
                    "设备 A：服务端草稿 data.album_links 反映收录选择",
                    linked,
                    str(links)[:160],
                )
                draft1 = current
                server_image_ids = [str(item.get("media_id")) for item in (draft1.get("images") or [])]

        # ── 设备 A：新建同类动态 2（用于「点哪份恢复哪份」不串稿）─────────
        page_a.goto(BASE + "/admin/moments/new?returnTo=%2Fadmin", wait_until="load", timeout=60000)
        boot(page_a)
        wait_editor_ready(page_a, "moment")
        wait_editor_fields(page_a)
        fill_editor(page_a, text2, '[data-editor-field="text"]', "[data-editor] textarea")
        REPORT.check(
            "设备 A：第二份新动态草稿已同步",
            wait_sync(page_a, ("synced",), 30000),
            f"sync_state={sync_state(page_a)}",
        )
        draft2 = find_new_draft(api, "moment", text2)
        REPORT.check("服务端出现第二份无 target 新动态草稿", draft2 is not None)

    if draft1 is None or draft2 is None:
        return
    draft1_id = str(draft1["id"])
    draft2_id = str(draft2["id"])

    # ── 设备 B：仅 cookie（无 localStorage）从创作台继续编辑 ─────────────
    with open_page(browser, cookies=cookies) as (context_b, page_b):
        REPORT.check(
            "设备 B：新 context 本机缓存为空（localStorage 无本机副本）",
            len(local_copies(page_b)) == 0,
            str([key for key, _ in local_copies(page_b)]),
        )
        page_b.goto(BASE + "/admin", wait_until="load", timeout=60000)
        boot(page_b)
        row = row_for_draft(page_b, draft1_id)
        wait_for(page_b, lambda: (row_for_draft(page_b, draft1_id).count() > 0), 20000)
        REPORT.check("设备 B：创作台「继续编辑」列出该新草稿", row_for_draft(page_b, draft1_id).count() == 1)
        if row_for_draft(page_b, draft1_id).count() == 0:
            return
        href = row_for_draft(page_b, draft1_id).get_attribute("href") or ""
        REPORT.check(
            "「继续编辑」链接唯一标识所选工作草稿（href 带 draft=<id>）",
            f"draft={draft1_id}" in href,
            f"href={href}",
        )
        opened = open_row_and_wait_editor(page_b, draft1_id, "moment")
        REPORT.check("设备 B：点该草稿进入编辑器", opened, page_b.url)
        if not opened:
            return
        REPORT.check(
            "设备 B：URL 带所选草稿 ID（?draft=）",
            query_one(page_b, "draft") == draft1_id,
            f"url={page_b.url}",
        )
        restored = wait_for(page_b, lambda: text1 in editor_text(page_b), 20000)
        REPORT.check(
            "设备 B：恢复设备 A 的正文（无本机缓存）",
            restored,
            f"编辑器正文={editor_text(page_b)[:80]!r}",
        )
        restored_images = wait_for(
            page_b,
            lambda: editor_image_ids(page_b) == server_image_ids and len(server_image_ids) == 2,
            20000,
        )
        REPORT.check(
            "设备 B：恢复图片数量与顺序",
            restored_images,
            f"{editor_image_ids(page_b)} vs {server_image_ids}",
        )
        alts = moment_thumb_alts(page_b)
        REPORT.check(
            "设备 B：恢复图片替代文本",
            any(alt1 in item for item in alts) and any(alt2 in item for item in alts),
            str(alts),
        )
        if album is not None:
            album_restored = wait_for(
                page_b,
                lambda: page_b.locator(f'[data-album-link="{album["slug"]}"]').count() >= 1,
                12000,
            )
            REPORT.check(
                "设备 B：恢复「同时收录到相册」选择",
                album_restored,
                f"links={page_b.locator('[data-album-link]').count()}",
            )
        shot(page_b, scenario, "device-b-draft1")

        # 无缓存刷新同一 URL → 仍恢复（不依赖设备 A 的 localStorage）
        page_b.reload(wait_until="load", timeout=60000)
        boot(page_b)
        wait_editor_ready(page_b, "moment")
        refreshed = wait_for(page_b, lambda: text1 in editor_text(page_b), 20000)
        REPORT.check("设备 B：刷新指定草稿 URL 后仍恢复内容（无本机缓存）", refreshed, page_b.url)
        REPORT.check(
            "设备 B：刷新后 URL 仍带草稿 ID",
            query_one(page_b, "draft") == draft1_id,
            page_b.url,
        )

        # 不串稿：点第二份恢复第二份
        page_b.goto(BASE + "/admin", wait_until="load", timeout=60000)
        boot(page_b)
        wait_for(page_b, lambda: row_for_draft(page_b, draft2_id).count() > 0, 20000)
        opened2 = open_row_and_wait_editor(page_b, draft2_id, "moment")
        REPORT.check("设备 B：打开第二份新草稿", opened2)
        restored2 = opened2 and wait_for(page_b, lambda: text2 in editor_text(page_b), 20000)
        REPORT.check(
            "同类两份草稿不串稿：点第二份恢复第二份",
            restored2 and text1 not in editor_text(page_b),
            f"正文={editor_text(page_b)[:80]!r}",
        )
        shot(page_b, scenario, "device-b-draft2")
        # 再点回第一份
        page_b.goto(BASE + "/admin", wait_until="load", timeout=60000)
        boot(page_b)
        wait_for(page_b, lambda: row_for_draft(page_b, draft1_id).count() > 0, 20000)
        opened1 = open_row_and_wait_editor(page_b, draft1_id, "moment")
        restored1 = opened1 and wait_for(page_b, lambda: text1 in editor_text(page_b), 20000)
        REPORT.check(
            "同类两份草稿不串稿：点第一份恢复第一份",
            restored1 and text2 not in editor_text(page_b),
            f"正文={editor_text(page_b)[:80]!r}",
        )


def add_album_link(page: Any, album: dict[str, Any]) -> bool:
    """在动态编辑器的「同时收录到相册」里选中相册并勾一张图。"""
    try:
        container = page.locator("[data-album-links-editor]")
        if container.count() == 0:
            return False
        refresh = page.locator('button:has-text("刷新相册列表")')
        if refresh.count():
            refresh.first.click(timeout=4000)
            page.wait_for_timeout(800)
        loaded = wait_for(page, lambda: page.locator("[data-album-picker] option").count() > 1, 15000)
        if not loaded:
            return False
        select = find(page, "[data-album-picker]")
        if select is None:
            return False
        select.select_option(value=album["id"])
        page.wait_for_timeout(300)
        add = page.locator('button:has-text("添加相册")')
        if not add.count():
            return False
        add.first.click(timeout=4000)
        added = wait_for(page, lambda: page.locator(f'[data-album-link="{album["slug"]}"]').count() > 0, 8000)
        if not added:
            return False
        checkbox = page.locator(
            f'[data-album-link="{album["slug"]}"] .ins-admin-album-media input[type=checkbox]'
        )
        if checkbox.count():
            try:
                checkbox.first.check(timeout=4000)
            except Exception:  # noqa: BLE001
                checkbox.first.evaluate("el => el.click()")
        return True
    except Exception as error:  # noqa: BLE001
        REPORT.info("添加相册选择异常", str(error)[:160])
        return False


def scenario_r2_journal(browser: Any, cookies: list[dict]) -> None:
    scenario = "r2-journal"
    REPORT.begin(scenario)
    print(f"\n── [{scenario}] R2-新手记：跨设备恢复日期/标题/正文/图片/默认私密 + 错误 ID/类型/已丢弃")

    journal_date = "2026-10-02"
    title = unique("r2-journal-title")
    content = unique("r2-journal-body")
    alt = unique("r2-journal-alt")
    marker = unique("r2-journal-draft-marker")

    draft: dict[str, Any] | None = None
    server_image_ids: list[str] = []

    # ── 设备 A：新手记只自动保存 ─────────────────────────────────────
    with open_page(browser, cookies=cookies) as (context_a, page_a):
        api = Api(page_a)
        page_a.goto(BASE + "/admin/journal/new?returnTo=%2Fadmin", wait_until="load", timeout=60000)
        boot(page_a)
        if not wait_editor_ready(page_a, "journal"):
            REPORT.check("设备 A：新手记编辑页可用", False, page_a.url)
            return
        wait_editor_fields(page_a)
        wait_for(page_a, lambda: editor_visibility(page_a) is not None, 15000)
        REPORT.check("设备 A：新手记默认状态 draft / 私密", editor_status(page_a) == "draft" and editor_visibility(page_a) == "private")
        fill_editor(page_a, journal_date, '[data-editor-field="date"]')
        fill_editor(page_a, title, '[data-editor-field="title"]')
        fill_editor(page_a, content, '[data-editor-field="content"]')
        REPORT.check(
            "设备 A：新手记已上传 1 张图（含替代文本）",
            pick_images(page_a, [PNG_RED], [alt]),
        )
        REPORT.check(
            "设备 A：自动保存到达 synced",
            wait_sync(page_a, ("synced",), 30000),
            f"sync_state={sync_state(page_a)}",
        )
        draft = find_new_draft(api, "journal", title)
        REPORT.check("服务端出现无 target 的新手记工作草稿", draft is not None)
        if draft is None:
            return
        draft_id = str(draft["id"])
        server_image_ids = [str(item.get("media_id")) for item in (draft.get("images") or [])]
        REPORT.check("服务端手记草稿保留日期字段", str((draft.get("data") or {}).get("entry_date") or "").startswith(journal_date))
        shot(page_a, scenario, "device-a-draft")

    if draft is None:
        return
    draft_id = str(draft["id"])

    # ── 设备 B：仅 cookie，从创作台恢复新手记 ─────────────────────────
    with open_page(browser, cookies=cookies) as (context_b, page_b):
        REPORT.check(
            "设备 B：新 context 本机缓存为空",
            len(local_copies(page_b)) == 0,
            str([key for key, _ in local_copies(page_b)]),
        )
        page_b.goto(BASE + "/admin", wait_until="load", timeout=60000)
        boot(page_b)
        wait_for(page_b, lambda: row_for_draft(page_b, draft_id).count() > 0, 20000)
        REPORT.check("设备 B：创作台列出该新手记草稿", row_for_draft(page_b, draft_id).count() == 1)
        if row_for_draft(page_b, draft_id).count() == 0:
            return
        href = row_for_draft(page_b, draft_id).get_attribute("href") or ""
        REPORT.check(
            "新手记「继续编辑」链接带 draft=<id>",
            f"draft={draft_id}" in href,
            f"href={href}",
        )
        opened = open_row_and_wait_editor(page_b, draft_id, "journal")
        REPORT.check("设备 B：点该手记草稿进入编辑器", opened, page_b.url)
        if not opened:
            return
        REPORT.check(
            "设备 B：URL 带所选手记草稿 ID（?draft=）",
            query_one(page_b, "draft") == draft_id,
            page_b.url,
        )
        wait_for(page_b, lambda: editor_visibility(page_b) is not None, 15000)
        REPORT.check(
            "设备 B：恢复标题",
            wait_for(page_b, lambda: (find(page_b, '[data-editor-field="title"]').input_value() if find(page_b, '[data-editor-field="title"]') else "") == title, 20000),
            str(page_b.evaluate("() => { const el = document.querySelector('[data-editor-field=title]'); return el ? el.value : null; }")),
        )
        content_value = page_b.evaluate("() => { const el = document.querySelector('[data-editor-field=content]'); return el ? el.value : null; }")
        REPORT.check("设备 B：恢复正文", content_value == content, str(content_value)[:80])
        date_value = page_b.evaluate("() => { const el = document.querySelector('[data-editor-field=date]'); return el ? el.value : null; }")
        REPORT.check("设备 B：恢复手记日期", str(date_value or "").startswith(journal_date), str(date_value))
        REPORT.check(
            "设备 B：恢复图片数量与顺序",
            wait_for(page_b, lambda: journal_image_ids(page_b) == server_image_ids and len(server_image_ids) >= 1, 20000),
            f"{journal_image_ids(page_b)} vs {server_image_ids}",
        )
        REPORT.check("设备 B：恢复图片替代文本", alt in journal_images_text(page_b), journal_images_text(page_b)[:120])
        REPORT.check(
            "设备 B：恢复默认私密（不因普通恢复变公开）",
            editor_visibility(page_b) == "private",
            str(editor_visibility(page_b)),
        )
        shot(page_b, scenario, "device-b-draft")

        page_b.reload(wait_until="load", timeout=60000)
        boot(page_b)
        wait_editor_ready(page_b, "journal")
        refreshed_title = wait_for(
            page_b,
            lambda: (find(page_b, '[data-editor-field="title"]').input_value() if find(page_b, '[data-editor-field="title"]') else "") == title,
            20000,
        )
        REPORT.check("设备 B：无缓存刷新指定草稿 URL 后仍恢复标题", refreshed_title, page_b.url)

        # ── 错误 ID / 类型不匹配 / 已丢弃 ────────────────────────────
        journal_api = Api(page_b)

        # 1) 跨类型：拿一份 moment 草稿 id 打新手记 URL
        moment_marker = unique("r2-cross-moment")
        cross = journal_api.create_draft(
            "moment",
            data={"text": moment_marker, "tags": [], "album_links": []},
        )
        cross_draft = cross.get("draft") or {}
        if cross_draft.get("id"):
            page_b.goto(BASE + f"/admin/journal/new?draft={cross_draft['id']}", wait_until="load", timeout=60000)
            boot(page_b)
            page_b.wait_for_timeout(4000)
            error_text, body_text = page_error_text(page_b)
            REPORT.check(
                "跨内容类型草稿 ID 给出准确错误提示（不静默空白新建）",
                looks_like_draft_error(error_text, body_text),
                f"提示={error_text[:160]!r}",
            )
            REPORT.check(
                "跨类型错误时不把另一类型内容加载进手记编辑器",
                moment_marker not in editor_text(page_b)
                and moment_marker not in page_b.inner_text("body")[:4000],
                "未泄露 moment 草稿正文",
            )
        else:
            REPORT.skip("跨内容类型草稿 ID 错误提示", "无法创建 moment 草稿用于交叉验证")

        # 2) 不存在的草稿 UUID
        missing_id = str(uuid.uuid4())
        page_b.goto(BASE + f"/admin/journal/new?draft={missing_id}", wait_until="load", timeout=60000)
        boot(page_b)
        page_b.wait_for_timeout(3500)
        error_text, body_text = page_error_text(page_b)
        REPORT.check(
            "不存在的草稿 ID 给出准确错误提示（不静默空白新建）",
            looks_like_draft_error(error_text, body_text),
            f"提示={error_text[:160]!r}",
        )

        # 3) 已丢弃的工作草稿
        discarded = journal_api.create_draft(
            "journal",
            data={"entry_date": journal_date, "title": marker, "content_md": marker, "mood": "", "location": ""},
        )
        discarded_draft = discarded.get("draft") or {}
        if discarded_draft.get("id"):
            response = journal_api.delete(f"/admin/work-drafts/{discarded_draft['id']}")
            REPORT.check("准备：丢弃测试用工作草稿（204）", response.status == 204, f"HTTP {response.status}")
            page_b.goto(BASE + f"/admin/journal/new?draft={discarded_draft['id']}", wait_until="load", timeout=60000)
            boot(page_b)
            page_b.wait_for_timeout(4000)
            error_text, body_text = page_error_text(page_b)
            REPORT.check(
                "已丢弃草稿给出准确错误提示（不静默空白新建）",
                looks_like_draft_error(error_text, body_text),
                f"提示={error_text[:160]!r}",
            )
            REPORT.check(
                "已丢弃草稿不会把旧正文当新内容加载",
                marker not in editor_text(page_b),
                f"正文={editor_text(page_b)[:80]!r}",
            )
        else:
            REPORT.skip("已丢弃草稿错误提示", "无法创建测试用工作草稿")


ERROR_KEYWORDS = [
    "不存在",
    "已丢弃",
    "类型不匹配",
    "类型不",
    "不匹配",
    "无法恢复",
    "无法打开",
    "打不开",
    "找不到",
    "无效的草稿",
    "草稿无效",
    "没有这份",
    "读取失败",
    "无法读取",
    "不能恢复",
    "无权",
    "不合法",
    "不可用",
    "已删除",
    "已被删除",
    "过期",
    "丢失",
    "无法继续",
    "无法载入",
    "载入失败",
    "无法找到",
    "内容类型",
]


def page_error_text(page: Any) -> tuple[str, str]:
    """收集页面上的错误/状态文案（role=alert / data-editor-error / role=status / 正文）。"""
    chunks: list[str] = []
    for selector in (
        "[role=alert]",
        "[data-editor-error]",
        "[data-load-error]",
        "[data-editor-blockers]",
        "[role=status]",
        ".ins-state",
        ".msg-state",
    ):
        try:
            locator = page.locator(selector)
            for index in range(min(locator.count(), 6)):
                item = locator.nth(index)
                try:
                    if item.is_visible():
                        text = item.inner_text().strip()
                        if text:
                            chunks.append(text)
                except Exception:  # noqa: BLE001
                    continue
        except Exception:  # noqa: BLE001
            continue
    try:
        body = page.inner_text("body")
    except Exception:  # noqa: BLE001
        body = ""
    return " | ".join(chunks), body


def looks_like_draft_error(error_text: str, body_text: str) -> bool:
    combined = f"{error_text} {body_text}"
    if any(keyword in combined for keyword in ERROR_KEYWORDS):
        return True
    # 「草稿 ... 打开/恢复/读取」这类组合也算明确提示（避免只靠固定词表）。
    return bool(re.search(r"草稿[^。；\n]{0,24}(打开|恢复|读取|加载)", combined))


# ═══════════════════════════════════════════════════════════════════════════
# R3 · 手机内自由聊天入口
# ═══════════════════════════════════════════════════════════════════════════


LAYOUT_JS = """() => {
  const pick = (selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return {
      x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      bottom: rect.bottom, right: rect.right,
      display: style.display, visibility: style.visibility, opacity: style.opacity,
      inViewport: rect.top >= -2 && rect.left >= -2 &&
        rect.bottom <= window.innerHeight + 2 && rect.right <= window.innerWidth + 2 &&
        rect.width > 0 && rect.height > 0,
    };
  };
  const rects = {
    composer: pick('.msg-composer'),
    usage: pick('.msg-usage'),
    hints: pick('.msg-op-hints'),
    choices: pick('.msg-choices'),
    say: pick('.msg-btn-say'),
    send: pick('.msg-btn-send'),
    input: pick('.msg-composer textarea'),
    expand: pick('.pw-expand'),
  };
  const overlap = (a, b) => Boolean(a && b && a.width > 0 && b.width > 0 &&
    !(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y));
  // 只比较互不包含的操作区（textarea/send 位于 composer 内部，父子重叠是正常布局）。
  const pairs = [
    ['composer', 'usage'], ['composer', 'hints'], ['composer', 'choices'],
    ['send', 'usage'], ['send', 'hints'], ['send', 'choices'],
    ['choices', 'usage'], ['choices', 'hints'], ['usage', 'hints'],
  ];
  const overlapping = pairs.filter(([a, b]) => overlap(rects[a], rects[b]));
  return { rects, overlapping, innerWidth: window.innerWidth, innerHeight: window.innerHeight };
}"""


OCCLUSION_JS = """(selectors) => {
  const results = {};
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (!el) { results[selector] = { ok: false, reason: 'missing' }; continue; }
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      results[selector] = { ok: false, reason: 'zero-size' };
      continue;
    }
    const cx = Math.min(Math.max(rect.left + rect.width / 2, 0), window.innerWidth - 1);
    const cy = Math.min(Math.max(rect.top + rect.height / 2, 0), window.innerHeight - 1);
    const hit = document.elementFromPoint(cx, cy);
    const inside = Boolean(hit && (hit === el || el.contains(hit)));
    results[selector] = {
      ok: inside,
      point: [Math.round(cx), Math.round(cy)],
      hit: hit ? (String(hit.className || '').slice(0, 80) || hit.tagName) : null,
    };
  }
  return results;
}"""


def occlusion_report(page: Any, selectors: list[str]) -> dict[str, Any]:
    """中心点命中测试：该控件中心是否真的能点到自己（而非被别的层盖住）。"""
    try:
        return page.evaluate(OCCLUSION_JS, selectors)
    except Exception:  # noqa: BLE001
        return {}


def layout_report(page: Any) -> dict[str, Any]:
    try:
        return page.evaluate(LAYOUT_JS)
    except Exception:  # noqa: BLE001
        return {}


def phone_open(browser: Any, cookies: list[dict], viewport: tuple[int, int]) -> Iterator[tuple[Any, Any]]:
    return open_page(browser, cookies=cookies, viewport=viewport)


def detect_character(page: Any) -> str | None:
    item = query_one(page, "item")
    if item:
        return item
    try:
        for role in page.locator(".msg-role").all():
            label = role.get_attribute("aria-label") or ""
            match = re.search(r"打开与(.+?)的会话", label)
            if match:
                name = match.group(1)
                mapping = {"双叶": "futaba", "futaba": "futaba", "莫甘娜": "morgana", "morgana": "morgana"}
                return mapping.get(name, name)
    except Exception:  # noqa: BLE001
        pass
    return None


def r3_desktop(browser: Any, cookies: list[dict]) -> str | None:
    """桌面 1440×1000：launcher → INS → 消息 → 角色会话；返回角色 id。"""
    scenario = "r3-phone"
    character: str | None = None
    with open_page(browser, cookies=cookies, viewport=(1440, 1000)) as (context, page):
        page.goto(BASE + "/", wait_until="load", timeout=60000)
        boot(page, 2500)
        launcher = page.locator(".pw-tab")
        REPORT.check("桌面：手机 launcher（.pw-tab）可见", launcher.count() > 0 and launcher.first.is_visible())
        clicked = click_first(page, ".pw-tab")
        REPORT.check("桌面：点击手机 launcher 打开手机宿主", clicked and wait_for(page, lambda: visible(page, "[data-phone-host]"), 15000))
        shot(page, scenario, "desktop-phone-home")

        opened_app = click_first(page, '[data-app-id="ins"]')
        visible_app = opened_app and wait_for(
            page, lambda: visible(page, '.pw-appview[data-phone-app="ins"]'), 20000
        )
        REPORT.check("桌面：从手机桌面进入 INS 应用", visible_app, page.url)

        # INS 页签「消息」
        msg_tab = page.locator('.ins-tab:has-text("消息")')
        if not msg_tab.count():
            msg_tab = page.locator('[role=tab]:has-text("消息")')
        tab_found = msg_tab.count() > 0
        tab_clicked = click_first(page, '.ins-tab:has-text("消息")', '[role=tab]:has-text("消息")')
        role_ready = tab_clicked and wait_for(page, lambda: page.locator(".msg-role").count() > 0, 25000)
        REPORT.check("桌面：INS 内有「消息」入口且可到达角色列表", tab_found and role_ready, f"tabs={tab_found}")

        role_opened = role_ready and click_first(page, ".msg-role")
        conversation_ready = role_opened and wait_for(
            page, lambda: query_one(page, "screen") == "conversation", 20000
        )
        REPORT.check("桌面：点角色后进入手机内会话（screen=conversation）", conversation_ready, page.url)
        character = detect_character(page)
        REPORT.check("桌面：会话 URL 带角色 ID（item=<character>）", bool(character), page.url)

        if conversation_ready:
            wait_for(page, lambda: page.locator(".msg-app").count() > 0, 20000)
            page.wait_for_timeout(2500)  # 等会话数据与限制元数据
            composer_visible = visible(page, ".msg-composer")
            REPORT.check("桌面手机内：自由聊天输入区 .msg-composer 可见", composer_visible)
            usage_initial = visible(page, ".msg-usage")
            expand = find(page, ".pw-expand")
            expand_visible = bool(expand and expand.is_visible())
            expand_href = expand.get_attribute("href") if expand else ""
            expected_href = f"/apps/ins/messages/{character}" if character else None
            REPORT.check(
                "桌面手机内：「展开查看」入口 .pw-expand 可见",
                expand_visible,
                f"href={expand_href}",
            )
            REPORT.check(
                "桌面手机内：「展开查看」href 指向当前会话 canonical",
                bool(expected_href) and expand_href == expected_href,
                f"href={expand_href}，期望={expected_href}",
            )
            shot(page, scenario, "desktop-story-state")

            say = page.locator(".msg-btn-say")
            say_visible = say.count() > 0 and say.first.is_visible()
            REPORT.check("桌面手机内：「自己说一句」入口可见", say_visible)
            if say_visible:
                say.first.click()
                page.wait_for_timeout(800)
            textarea = find(page, ".msg-composer textarea")
            textarea_visible = bool(textarea and textarea.is_visible())
            REPORT.check("桌面手机内：点「自己说一句」后 textarea 可见", textarea_visible)
            if textarea_visible:
                occlusion = occlusion_report(page, [".msg-composer textarea", ".msg-btn-send"])
                REPORT.check(
                    "桌面手机内：输入框/发送按钮中心点未被遮挡（elementFromPoint 命中自身）",
                    all((occlusion.get(sel) or {}).get("ok") for sel in (".msg-composer textarea", ".msg-btn-send")),
                    json.dumps(occlusion, ensure_ascii=False)[:220],
                )
                sent_text = unique("r3-desktop")
                textarea.fill(sent_text)
                send = find(page, ".msg-btn-send")
                send_visible = bool(send and send.is_visible())
                REPORT.check("桌面手机内：发送按钮可见", send_visible)
                if send_visible:
                    send.click()
                    page.wait_for_timeout(3500)
                    list_text = ""
                    try:
                        list_text = page.locator(".msg-list").inner_text()
                    except Exception:  # noqa: BLE001
                        pass
                    notice_text = ""
                    notice = find(page, '[data-testid="msg-notice"]')
                    try:
                        notice_text = notice.inner_text() if notice else ""
                    except Exception:  # noqa: BLE001
                        notice_text = ""
                    outgoing = page.locator(".msg-row-out")
                    sent_ok = sent_text in list_text or outgoing.count() > 0
                    REPORT.check(
                        "桌面手机内：发送后消息进入会话列表（或明确失败反馈）",
                        sent_ok or bool(notice_text),
                        f"outgoing={outgoing.count()}，notice={notice_text[:80]!r}",
                    )
                    if sent_ok:
                        REPORT.check(
                            "桌面手机内：发送后输入框清空（不重复发送）",
                            (find(page, ".msg-composer textarea").input_value() if find(page, ".msg-composer textarea") else "") == "",
                        )
                    shot(page, scenario, "desktop-free-input")
            else:
                # 基线（composer display:none / textarea 不可见）也要留下可读证据
                shot(page, scenario, "desktop-no-input")
            usage_visible = usage_initial or visible(page, ".msg-usage")
            REPORT.check(
                "桌面手机内：自由聊天用量提示 .msg-usage 可见（初始或展开后）",
                usage_visible,
                f"初始={usage_initial}，当前={visible(page, '.msg-usage')}",
            )

            # 「展开查看」：点击后进入 canonical 会话（独立页仍有 Composer）
            if expand_visible and expected_href:
                try:
                    expand.click(timeout=5000)
                    navigated = wait_for(
                        page,
                        lambda: "/apps/ins/messages/" in page.url,
                        20000,
                    )
                    REPORT.check("桌面手机内：点「展开查看」进入 canonical 会话页", navigated, page.url)
                    if navigated:
                        REPORT.check(
                            "展开后 canonical 会话页仍有自由输入区",
                            wait_for(page, lambda: visible(page, ".msg-composer"), 20000),
                        )
                        shot(page, scenario, "desktop-expanded")
                except Exception as error:  # noqa: BLE001
                    REPORT.check("桌面手机内：点「展开查看」进入 canonical 会话页", False, str(error)[:160])
    return character


def r3_small_viewport(browser: Any, cookies: list[dict], character: str, viewport: str) -> None:
    scenario = "r3-phone"
    width, height = parse_viewport(viewport)
    label = viewport.replace("x", "×")
    with open_page(browser, cookies=cookies, viewport=(width, height)) as (context, page):
        page.goto(
            BASE + f"/?phone=ins&screen=conversation&item={character}",
            wait_until="load",
            timeout=60000,
        )
        boot(page, 2500)
        ready = wait_for(page, lambda: page.locator(".msg-app").count() > 0, 25000)
        REPORT.check(f"{label}：手机内会话可打开", ready, page.url)
        if not ready:
            shot(page, scenario, f"small-{viewport}-failed")
            return
        page.wait_for_timeout(2000)
        composer_visible = visible(page, ".msg-composer")
        REPORT.check(f"{label}：自由聊天输入区 .msg-composer 可见", composer_visible)
        usage_initial = visible(page, ".msg-usage")
        shot(page, scenario, f"small-{viewport}-story")

        say = page.locator(".msg-btn-say")
        say_visible = say.count() > 0 and say.first.is_visible()
        REPORT.check(f"{label}：折叠态「自己说一句」入口默认可见可点", say_visible)
        if say_visible:
            say.first.click()
            page.wait_for_timeout(700)
        textarea = find(page, ".msg-composer textarea")
        textarea_visible = bool(textarea and textarea.is_visible())
        REPORT.check(f"{label}：点「自己说一句」后 textarea 可见", textarea_visible)
        usage_visible = usage_initial or visible(page, ".msg-usage")
        REPORT.check(
            f"{label}：用量提示 .msg-usage 可见（初始或展开后）",
            usage_visible,
            f"初始={usage_initial}，当前={visible(page, '.msg-usage')}",
        )
        if textarea_visible:
            typed = unique(f"r3-{viewport}")
            textarea.click()
            textarea.type(typed, delay=10)
            REPORT.check(
                f"{label}：输入框可点击并接收输入",
                typed in (textarea.input_value() or ""),
            )
            send = find(page, ".msg-btn-send")
            send_visible = bool(send and send.is_visible())
            REPORT.check(f"{label}：发送按钮可见可点", send_visible)
            occlusion = occlusion_report(
                page, [".msg-composer textarea", ".msg-btn-send", ".msg-usage"]
            )
            REPORT.check(
                f"{label}：输入框/发送按钮/用量提示中心点未被遮挡（elementFromPoint 命中自身）",
                all(
                    (occlusion.get(sel) or {}).get("ok")
                    for sel in (".msg-composer textarea", ".msg-btn-send", ".msg-usage")
                ),
                json.dumps(occlusion, ensure_ascii=False)[:240],
            )
            layout = layout_report(page)
            rects = layout.get("rects") or {}
            composer_rect = rects.get("composer") or {}
            REPORT.check(
                f"{label}：输入区完整落在视口内（不被裁切）",
                bool(composer_rect.get("inViewport")),
                f"composer={composer_rect}",
            )
            send_rect = rects.get("send") or {}
            REPORT.check(
                f"{label}：发送按钮完整落在视口内",
                bool(send_rect.get("inViewport")),
                f"send={send_rect}",
            )
            usage_rect = rects.get("usage") or {}
            hints_rect = rects.get("hints") or {}
            REPORT.check(
                f"{label}：输入区不被用量提示/底部操作提示遮挡",
                not any(pair in (("composer", "usage"), ("composer", "hints"), ("send", "usage"), ("send", "hints"))
                        for pair in layout.get("overlapping") or []),
                f"overlapping={layout.get('overlapping')}，usage={usage_rect.get('y')}，hints={hints_rect.get('y')}",
            )
            REPORT.check(
                f"{label}：控件不互相遮挡（composer/usage/hints/choices 两两不相交）",
                not layout.get("overlapping"),
                str(layout.get("overlapping")),
            )
            shot(page, scenario, f"small-{viewport}-free-input")
            try:
                send.click()
                page.wait_for_timeout(3000)
                list_text = page.locator(".msg-list").inner_text()
                notice = find(page, '[data-testid="msg-notice"]')
                notice_text = notice.inner_text() if notice else ""
                REPORT.check(
                    f"{label}：发送后消息进入会话列表（或明确失败反馈）",
                    typed in list_text or bool(notice_text),
                    f"notice={notice_text[:80]!r}",
                )
                shot(page, scenario, f"small-{viewport}-sent")
            except Exception as error:  # noqa: BLE001
                REPORT.check(f"{label}：发送后消息进入会话列表（或明确失败反馈）", False, str(error)[:160])
        else:
            # 基线（composer display:none）也要留下可读的布局证据
            shot(page, scenario, f"small-{viewport}-no-input")


def scenario_r3_phone(browser: Any, cookies: list[dict]) -> None:
    REPORT.begin("r3-phone")
    print("\n── [r3-phone] R3：桌面斜屏手机 + 390/320 视口自由聊天入口")
    character = r3_desktop(browser, cookies)
    if not character:
        REPORT.skip("390/320 小屏视口检查", "桌面导航失败，无法确定角色 ID")
        return
    REPORT.info("角色 ID", character)
    for viewport in ("390x844", "320x700"):
        r3_small_viewport(browser, cookies, character, viewport)


# ═══════════════════════════════════════════════════════════════════════════
# task-4 补证场景：R1 guards / R2 save-as-new / R3 extra
# 目标：把《P5 返工复验报告》§8 的「R1 412/401/相册/提交期输入」「R2 另存为新草稿」
#       「R3 草稿保留/发送失败重试/限额展示/音乐继续播放」从单测覆盖补成真实浏览器证据。
# ═══════════════════════════════════════════════════════════════════════════

UNHANDLED_INIT_SCRIPT = """
window.__p5rwUnhandled = [];
window.addEventListener('unhandledrejection', function (event) {
  try {
    var reason = event.reason;
    window.__p5rwUnhandled.push(String((reason && (reason.message || reason)) || 'unknown'));
  } catch (error) {
    window.__p5rwUnhandled.push('unknown');
  }
});
"""
COMMIT_ROUTE = re.compile(r"/api/v1/admin/work-drafts/[0-9a-fA-F-]+/commit$")
MESSAGES_POST_ROUTE = re.compile(r"/api/v1/messaging/conversations/[0-9a-fA-F-]+/messages$")


def unhandled_errors(page: Any) -> list[str]:
    try:
        return page.evaluate("() => (window.__p5rwUnhandled || []).slice()")
    except Exception:  # noqa: BLE001
        return []


def wait_new_draft(api: Api, content_type: str, marker: str, timeout_ms: int = 25000) -> dict[str, Any] | None:
    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        draft = find_new_draft(api, content_type, marker)
        if draft is not None:
            return draft
        time.sleep(0.7)
    return None


def editor_error_text(page: Any) -> str:
    locator = find(page, "[data-editor-error]")
    try:
        return (locator.inner_text() or "").strip() if locator else ""
    except Exception:  # noqa: BLE001
        return ""


def text_of(page: Any, selector: str) -> str:
    locator = find(page, selector)
    try:
        return (locator.inner_text() or "").strip() if locator else ""
    except Exception:  # noqa: BLE001
        return ""


@contextmanager
def prepared_moment_editor(
    browser: Any, cookies: list[dict], prefix: str, viewport: tuple[int, int] | None = None
) -> Iterator[dict[str, Any] | None]:
    """准备「已发布动态 + 已有 target 工作草稿 + 编辑器 synced」的 R1 前置现场。"""
    with open_page(browser, cookies=cookies, viewport=viewport) as (context, page):
        api = Api(page)
        published = api_publish_moment(api, unique(prefix + "-anchor"))
        if not published or not published.get("target_id"):
            REPORT.info("准备失败", f"{prefix}: 无法发布锚点动态")
            yield None
            return
        moment_id = str(published["target_id"])
        page.goto(BASE + f"/admin/moments/{moment_id}/edit", wait_until="load", timeout=60000)
        boot(page)
        if not (wait_editor_ready(page, "moment") and wait_editor_fields(page)):
            REPORT.info("准备失败", f"{prefix}: 编辑页未就绪 {page.url}")
            yield None
            return
        seed_text = unique(prefix + "-seed")
        fill_editor(page, seed_text, '[data-editor-field="text"]', "[data-editor] textarea")
        if not wait_sync(page, ("synced",), 25000):
            REPORT.info("准备失败", f"{prefix}: 种子内容未同步 {sync_state(page)}")
            yield None
            return
        draft = find_existing_draft(api, "moment", moment_id)
        if draft is None:
            REPORT.info("准备失败", f"{prefix}: 未找到 target 工作草稿")
            yield None
            return
        yield {
            "page": page,
            "api": api,
            "moment_id": moment_id,
            "draft": draft,
            "seed_text": seed_text,
        }


# ── R1 guards：412 冲突 ────────────────────────────────────────────────────


def r1_guard_412(browser: Any, cookies: list[dict]) -> None:
    scenario = "r1-guards"
    with prepared_moment_editor(browser, cookies, "guard412") as prep:
        if prep is None:
            REPORT.check("412：准备已发布动态 + 工作草稿", False)
            return
        REPORT.check("412：准备已发布动态 + 工作草稿", True)
        page, api = prep["page"], prep["api"]
        moment_id = prep["moment_id"]
        draft = prep["draft"]
        draft_id = str(draft["id"])
        version = int(draft.get("draft_version") or 1)

        other_text = unique("guard412-other")
        response = api.patch_draft(draft_id, {"data": {"text": other_text}}, version)
        REPORT.check(
            "412：API 把工作草稿版本推前（模拟另一设备已保存）",
            response.status == 200,
            f"HTTP {response.status}",
        )
        if response.status != 200:
            return

        commit_requests: list[str] = []
        patch_412: list[str] = []

        def on_request(request: Any) -> None:
            if request.method == "POST" and "/api/v1/admin/work-drafts/" in request.url and request.url.endswith("/commit"):
                commit_requests.append(request.url)

        def on_response(response: Any) -> None:
            try:
                if response.request.method == "PATCH" and response.status == 412:
                    patch_412.append(response.url)
            except Exception:  # noqa: BLE001
                pass

        page.on("request", on_request)
        page.on("response", on_response)

        conflict_text = unique("guard412-local")
        fill_editor(page, conflict_text, '[data-editor-field="text"]', "[data-editor] textarea")
        conflicted = wait_for(page, lambda: sync_state(page) == "conflict", 30000)
        REPORT.check("412：自动保存收到 412 后进入 conflict 并暂停", conflicted, f"sync_state={sync_state(page)}")
        REPORT.check("412：确实发生了 412 响应", len(patch_412) >= 1, f"412 次数={len(patch_412)}")
        REPORT.check("412：ConflictNotice 出现", wait_for(page, lambda: visible(page, "[data-workspace-conflict]"), 10000))
        REPORT.check("412：本机最新输入保留", conflict_text in editor_text(page), editor_text(page)[:60])
        REPORT.check(
            "412：本机恢复副本保留最新输入",
            local_copy_contains(page, conflict_text),
            f"keys={[key for key, _ in local_copies(page)]}",
        )
        save_button = find(page, "[data-editor-save]")
        REPORT.check(
            "412：提交按钮进入禁用（冲突时禁止提交）",
            bool(save_button and save_button.is_disabled()),
        )
        if save_button is not None:
            try:
                save_button.evaluate("el => el.click()")
            except Exception:  # noqa: BLE001
                pass
        page.wait_for_timeout(2000)
        REPORT.check("412：点保存不产生 commit 请求（0 次）", len(commit_requests) == 0, f"commit={len(commit_requests)}")
        REPORT.check("412：无虚假成功提示", not visible(page, "[data-editor-success]"))
        shot(page, scenario, "guard-412-conflict")


# ── R1 guards：401 登录失效 ────────────────────────────────────────────────


def r1_guard_401(browser: Any, cookies: list[dict]) -> None:
    """401：模拟真实会话失效（PATCH 401 + 页面会话接口 401），验证不旁路提交且本机输入保留。

    说明：只让 PATCH 返回 401 时，页面会用仍然有效的 /auth/owner-status 重新确认会话并
    重挂编辑器（本机副本恢复为 local-only），这是「会话其实没失效」的模拟失真。真实的
    会话失效会连 owner-status 一起 401 —— 所以这里同时把页面会话接口注入 401，复现真实
    的「需要站主登录」页面状态；断言以**页面级登录提示**为准（data-editor-auth-expired
    只是编辑器内瞬时提示，页面随后会被登录引导替换）。
    """
    scenario = "r1-guards"
    with prepared_moment_editor(browser, cookies, "guard401") as prep:
        if prep is None:
            REPORT.check("401：准备已发布动态 + 工作草稿", False)
            return
        REPORT.check("401：准备已发布动态 + 工作草稿", True)
        page, api = prep["page"], prep["api"]

        unauthorized: list[tuple[str, str]] = []
        commit_requests: list[str] = []

        def fail_401(route: Any, request: Any) -> None:
            unauthorized.append((request.method, request.url))
            route.fulfill(
                status=401,
                content_type="application/json",
                body=json.dumps(
                    {"error": {"code": "UNAUTHORIZED", "message": "p5rw 注入：会话已失效"}, "request_id": "p5rw"},
                    ensure_ascii=False,
                ),
            )

        def on_request(request: Any) -> None:
            if request.method == "POST" and "/api/v1/admin/work-drafts/" in request.url and request.url.endswith("/commit"):
                commit_requests.append(request.url)

        page.route(WORK_DRAFT_PATCH_ROUTE, fail_401)
        page.route(re.compile(r".*/api/v1/auth/owner-status$"), fail_401)
        page.route(re.compile(r".*/api/v1/auth/session$"), fail_401)
        page.on("request", on_request)

        fail_text = unique("guard401-local")
        fill_editor(page, fail_text, '[data-editor-field="text"]', "[data-editor] textarea")

        def auth_expired_ui() -> bool:
            if visible(page, "[data-editor-auth-expired]"):
                return True
            body = ""
            try:
                body = page.inner_text("body")
            except Exception:  # noqa: BLE001
                return False
            return ("需要站主登录" in body) or ("登录已失效" in body) or ("重新登录" in body)

        expired_ui = wait_for(page, auth_expired_ui, 30000)
        REPORT.check("401：保存被拒后页面给出「需要站主登录 / 登录已失效」类提示", expired_ui)
        REPORT.check(
            "401：保存路径确实收到注入的 401",
            any(method == "PATCH" for method, _ in unauthorized),
            f"401 请求={[(m, u.split('/api/v1')[-1]) for m, u in unauthorized[:5]]}",
        )
        body_text = page.inner_text("body")
        auth_prompt = ""
        for marker in ("需要站主登录", "登录已失效", "重新登录", "无法确认站主身份"):
            if marker in body_text:
                auth_prompt = marker
                break
        REPORT.check("401：提示文案准确（不是静默失败）", bool(auth_prompt), auth_prompt or body_text[:120])
        REPORT.check(
            "401：会话失效后编辑器不可继续提交（编辑器被登录引导替换或 auth-expired 可见）",
            (not visible(page, '[data-editor="moment"]')) or visible(page, "[data-editor-auth-expired]"),
            f"editor={page.locator('[data-editor="moment"]').count()}",
        )
        REPORT.check("401：点保存不产生 commit 请求（0 次）", len(commit_requests) == 0, f"commit={len(commit_requests)}")
        REPORT.check("401：无虚假成功提示", not visible(page, "[data-editor-success]"))
        REPORT.check(
            "401：本机恢复副本保留最新输入（未因登录失效被清）",
            local_copy_contains(page, fail_text),
            str([key for key, _ in local_copies(page)]),
        )
        shot(page, scenario, "guard-401-auth-expired")


# ── R1 guards：相册新建 saveNow 调用方 ────────────────────────────────────


def r1_guard_album_caller(browser: Any, cookies: list[dict]) -> None:
    scenario = "r1-guards"
    with open_page(browser, cookies=cookies) as (context, page):
        page.add_init_script(UNHANDLED_INIT_SCRIPT)
        page.goto(BASE + "/admin/moments/new?returnTo=%2Fadmin", wait_until="load", timeout=60000)
        boot(page)
        if not (wait_editor_ready(page, "moment") and wait_editor_fields(page)):
            REPORT.check("相册调用方：新动态编辑页可用", False, page.url)
            return
        REPORT.check("相册调用方：新动态编辑页可用", True)
        base_text = unique("guardalbum")
        fill_editor(page, base_text, '[data-editor-field="text"]', "[data-editor] textarea")
        REPORT.check("相册调用方：准备选中 1 张图（相册区才出现）", pick_images(page, [PNG_RED], ["guardalbum-alt"]))
        REPORT.check("相册调用方：准备内容 synced", wait_sync(page, ("synced",), 30000), f"sync_state={sync_state(page)}")
        api = Api(page)
        draft = find_new_draft(api, "moment", base_text)
        REPORT.check("相册调用方：服务端已有该新草稿", draft is not None)

        patch_fail_count: list[str] = []
        block = {"on": False}

        def handle_patch(route: Any, request: Any) -> None:
            if block["on"]:
                patch_fail_count.append(request.url)
                route.fulfill(
                    status=500,
                    content_type="application/json",
                    body=json.dumps(
                        {"error": {"code": "E2E_INJECTED", "message": "p5rw 注入：保存失败"}, "request_id": "p5rw"},
                        ensure_ascii=False,
                    ),
                )
            else:
                route.continue_()

        page.route(WORK_DRAFT_PATCH_ROUTE, handle_patch)
        block["on"] = True
        extra_text = base_text + "-相册前未保存修改"
        fill_editor(page, extra_text, '[data-editor-field="text"]', "[data-editor] textarea")
        wait_for(page, lambda: sync_state(page) == "failed", 25000)

        popup = None
        clicked = False
        try:
            with page.expect_popup(timeout=12000) as popup_info:
                clicked = click_first(page, "[data-album-admin-link]", 'button:has-text("新建相册")')
            popup = popup_info.value
        except Exception as error:  # noqa: BLE001
            REPORT.info("相册调用方：新标签页未捕获", str(error)[:120])
            if not clicked:
                clicked = click_first(page, "[data-album-admin-link]", 'button:has-text("新建相册")')

        error_visible = wait_for(page, lambda: visible(page, "[data-editor-error]"), 15000)
        error_text = editor_error_text(page)
        REPORT.check("相册调用方：点「新建相册」触发 saveNow 失败后有真实错误提示", error_visible, error_text[:160])
        REPORT.check(
            "相册调用方：错误提示与保存失败对应（非虚假成功）",
            bool(error_text) and not visible(page, "[data-editor-success]"),
            error_text[:160],
        )
        REPORT.check(
            "相册调用方：saveNow 确实重发了 PATCH（失败路径被调用）",
            len(patch_fail_count) >= 2,
            f"PATCH 失败次数={len(patch_fail_count)}",
        )
        REPORT.check(
            "相册调用方：无未处理 Promise rejection",
            len(unhandled_errors(page)) == 0,
            str(unhandled_errors(page)),
        )
        REPORT.check(
            "相册调用方：页面未崩溃且输入保留",
            visible(page, '[data-editor="moment"]') and extra_text in editor_text(page),
            editor_text(page)[:80],
        )
        popup_url = ""
        if popup is not None:
            popup_url = popup.url or ""
            REPORT.check(
                "相册调用方：新标签页打开相册管理页（按实际记录）",
                "/admin/albums" in popup_url,
                popup_url,
            )
            try:
                popup.close()
            except Exception:  # noqa: BLE001
                pass
        else:
            REPORT.skip("相册调用方：新标签页打开相册管理页", "headless 下未捕获 popup（行为已记录，不影响 saveNow 失败断言）")
        shot(page, scenario, "guard-album-caller")


# ── R1 guards：提交期间更晚输入不被清 ─────────────────────────────────────


def r1_guard_late_input(browser: Any, cookies: list[dict]) -> None:
    scenario = "r1-guards"
    with prepared_moment_editor(browser, cookies, "guardlate") as prep:
        if prep is None:
            REPORT.check("提交期输入：准备已发布动态 + 工作草稿", False)
            return
        REPORT.check("提交期输入：准备已发布动态 + 工作草稿", True)
        page, api = prep["page"], prep["api"]
        moment_id = prep["moment_id"]

        commit_text = unique("guardlate-commit")
        fill_editor(page, commit_text, '[data-editor-field="text"]', "[data-editor] textarea")
        REPORT.check("提交期输入：提交前内容已 synced", wait_sync(page, ("synced",), 25000))

        held_commits: list[Any] = []
        commit_requests: list[str] = []
        patch_block = {"on": False}
        patch_fail: list[str] = []

        def hold_commit(route: Any, request: Any) -> None:
            commit_requests.append(request.url)
            held_commits.append(route)

        def handle_patch(route: Any, request: Any) -> None:
            if patch_block["on"]:
                patch_fail.append(request.url)
                route.fulfill(
                    status=500,
                    content_type="application/json",
                    body=json.dumps(
                        {"error": {"code": "E2E_INJECTED", "message": "p5rw 注入：更晚输入的保存被阻断"}, "request_id": "p5rw"},
                        ensure_ascii=False,
                    ),
                )
            else:
                route.continue_()

        page.route(COMMIT_ROUTE, hold_commit)
        page.route(WORK_DRAFT_PATCH_ROUTE, handle_patch)

        clicked = click_first(page, "[data-editor-update]", "[data-editor-save]")
        REPORT.check("提交期输入：点击「更新正式内容」", clicked)
        commit_inflight = wait_for(page, lambda: len(held_commits) >= 1, 25000)
        REPORT.check("提交期输入：commit 请求已发出并被延迟（在途）", commit_inflight, f"held={len(held_commits)}")
        if not commit_inflight:
            return

        # commit 在途：阻止更晚输入触发的自动保存 PATCH（避免版本推进干扰 commit 语义）
        patch_block["on"] = True
        later_text = unique("guardlate-later")
        textarea = find(page, '[data-editor-field="text"]')
        editable = bool(textarea and textarea.is_visible() and not textarea.is_disabled())
        REPORT.check("提交期输入：commit 在途时正文仍可输入（busy 未禁用输入）", editable)
        if editable:
            textarea.click()
            page.keyboard.press("End")
            page.keyboard.type(later_text, delay=15)
        typed = bool(textarea and later_text in (textarea.input_value() or ""))
        REPORT.check("提交期输入：更晚输入已进入编辑器", typed)
        REPORT.check(
            "提交期输入：更晚输入已写入 localStorage 本机副本",
            typed and wait_for(page, lambda: local_copy_contains(page, later_text), 8000),
            str([key for key, _ in local_copies(page)]),
        )

        # 放行 commit（route.fetch 把挂起的请求真正发给服务端）
        released = False
        try:
            response = held_commits[0].fetch()
            held_commits[0].fulfill(response=response)
            released = True
        except Exception as error:  # noqa: BLE001
            REPORT.info("提交期输入：放行 commit 失败", str(error)[:200])
        REPORT.check("提交期输入：放行延迟的 commit 响应", released)
        success = wait_for(page, lambda: visible(page, "[data-editor-success]"), 25000)
        REPORT.check("提交期输入：延迟响应放行后提交成功", success)
        official = str(api_admin_moment(api, moment_id).get("text") or "")
        REPORT.check(
            "提交期输入：正式内容 = 提交快照文字（不含更晚输入）",
            success and commit_text in official and later_text not in official,
            official[:100],
        )
        REPORT.check(
            "提交期输入：更晚输入的本机副本未被成功回调清除",
            local_copy_contains(page, later_text),
            str([key for key, _ in local_copies(page)]),
        )
        REPORT.check("提交期输入：commit 请求恰好 1 次", len(commit_requests) == 1, f"commit={len(commit_requests)}")
        shot(page, scenario, "guard-late-input")


def scenario_r1_guards(browser: Any, cookies: list[dict]) -> None:
    REPORT.begin("r1-guards")
    print("\n── [r1-guards] R1 补证：412 冲突 / 401 登录失效 / 相册 saveNow 调用方 / 提交期间更晚输入")
    r1_guard_412(browser, cookies)
    r1_guard_401(browser, cookies)
    r1_guard_album_caller(browser, cookies)
    r1_guard_late_input(browser, cookies)


# ── R2 save-as-new：另存为新草稿跨设备恢复 ────────────────────────────────


def scenario_r2_save_as_new(browser: Any, cookies: list[dict]) -> None:
    scenario = "r2-save-as-new"
    REPORT.begin(scenario)
    print("\n── [r2-save-as-new] R2 补证：UI 触发 412 →「另存为新草稿」→ 无 localStorage 设备恢复")

    new_text = unique("saveas-local")
    new_draft: dict[str, Any] | None = None
    original_draft_id = ""
    original_target_text = ""
    target_images: list[str] = []

    with prepared_moment_editor(browser, cookies, "saveas") as prep:
        if prep is None:
            REPORT.check("另存为新草稿：准备已发布动态 + 工作草稿", False)
            return
        REPORT.check("另存为新草稿：准备已发布动态 + 工作草稿", True)
        page, api = prep["page"], prep["api"]
        draft = prep["draft"]
        original_draft_id = str(draft["id"])
        version = int(draft.get("draft_version") or 1)
        target_images = [str(item.get("media_id")) for item in (draft.get("images") or [])]

        original_target_text = unique("saveas-other")
        response = api.patch_draft(original_draft_id, {"data": {"text": original_target_text}}, version)
        REPORT.check("另存为新草稿：API 推前原草稿版本（触发 412）", response.status == 200, f"HTTP {response.status}")
        if response.status != 200:
            return

        fill_editor(page, new_text, '[data-editor-field="text"]', "[data-editor] textarea")
        conflicted = wait_for(page, lambda: sync_state(page) == "conflict" and visible(page, "[data-workspace-conflict]"), 30000)
        REPORT.check("另存为新草稿：页面进入 conflict 并出现 ConflictNotice", conflicted, f"sync_state={sync_state(page)}")
        if not conflicted:
            return
        REPORT.check(
            "另存为新草稿：本机最新输入在冲突时保留",
            new_text in editor_text(page),
            editor_text(page)[:80],
        )
        clicked = click_first(page, "[data-workspace-conflict-save-as-new]")
        REPORT.check("另存为新草稿：点击「另存为新草稿」", clicked)
        if not clicked:
            return
        new_draft = wait_new_draft(api, "moment", new_text, 30000)
        REPORT.check("另存为新草稿：服务端出现新的无 target 工作草稿", new_draft is not None)
        if new_draft is None:
            return
        REPORT.check("另存为新草稿：新草稿 target_id 为空", new_draft.get("target_id") is None, str(new_draft.get("target_id")))
        REPORT.check(
            "另存为新草稿：页面提示「已另存为新的工作草稿」",
            "另存" in page.inner_text("body")[:6000],
        )
        last_original = {"status": 0, "text": ""}

        def original_still_intact() -> bool:
            response = api.get(f"/admin/work-drafts/{original_draft_id}")
            payload = safe_json(response) or {}
            last_original["status"] = response.status
            last_original["text"] = str((payload.get("data") or {}).get("text") or "")
            return last_original["text"] == original_target_text

        original_intact = wait_for(page, original_still_intact, 10000)
        REPORT.check(
            "另存为新草稿：原 target 草稿内容未被覆盖",
            original_intact,
            f"HTTP {last_original['status']} text={last_original['text'][:80]!r}",
        )
        shot(page, scenario, "save-as-new-created")

    if new_draft is None:
        return
    new_draft_id = str(new_draft["id"])
    server_images = [str(item.get("media_id")) for item in (new_draft.get("images") or [])]
    REPORT.info("另存产物 draft id", new_draft_id)

    # 设备 B：仅 cookie、无 localStorage，从创作台恢复「另存产物」
    with open_page(browser, cookies=cookies) as (context_b, page_b):
        REPORT.check("设备 B：新 context 本机缓存为空", len(local_copies(page_b)) == 0, str([key for key, _ in local_copies(page_b)]))
        page_b.goto(BASE + "/admin", wait_until="load", timeout=60000)
        boot(page_b)
        row = row_for_draft(page_b, new_draft_id)
        wait_for(page_b, lambda: row_for_draft(page_b, new_draft_id).count() > 0, 25000)
        REPORT.check("设备 B：创作台列出「另存为新草稿」产物", row_for_draft(page_b, new_draft_id).count() == 1)
        if row_for_draft(page_b, new_draft_id).count() == 0:
            return
        href = row_for_draft(page_b, new_draft_id).get_attribute("href") or ""
        REPORT.check("设备 B：该草稿行 href 带 draft=<id>", f"draft={new_draft_id}" in href, f"href={href}")
        row_for_draft(page_b, new_draft_id).first.click()
        opened = wait_editor_ready(page_b, "moment", 25000)
        REPORT.check("设备 B：点该草稿进入编辑器（非空白新建）", opened, page_b.url)
        if not opened:
            return
        REPORT.check("设备 B：URL 带所选草稿 ID（?draft=）", query_one(page_b, "draft") == new_draft_id, page_b.url)
        restored = wait_for(page_b, lambda: new_text in editor_text(page_b), 25000)
        REPORT.check("设备 B：恢复另存草稿的正文", restored, editor_text(page_b)[:80])
        REPORT.check(
            "设备 B：恢复另存草稿的图片（顺序）",
            editor_image_ids(page_b) == server_images,
            f"{editor_image_ids(page_b)} vs {server_images}",
        )
        shot(page_b, scenario, "device-b-save-as-new-restored")


# ── R3 extra：草稿保留 / 发送失败重试 / 限额展示 / 音乐继续播放 ───────────


def audio_is_playing(page: Any) -> bool:
    try:
        return bool(
            page.evaluate(
                "() => { const el = document.querySelector('audio[data-pl-music]'); return el ? (!el.paused && !el.ended) : false; }"
            )
        )
    except Exception:  # noqa: BLE001
        return False


def audio_current_time(page: Any) -> float:
    try:
        return float(
            page.evaluate("() => { const el = document.querySelector('audio[data-pl-music]'); return el ? el.currentTime : -1; }")
        )
    except Exception:  # noqa: BLE001
        return -1.0


def tab_playing(page: Any) -> bool:
    try:
        locator = page.locator(".pw-tab")
        return locator.count() > 0 and "playing" in (locator.first.get_attribute("class") or "")
    except Exception:  # noqa: BLE001
        return False


def session_draft(page: Any, character: str) -> str:
    try:
        return page.evaluate("(key) => sessionStorage.getItem(key) || ''", f"msg.draft.v1:{character}") or ""
    except Exception:  # noqa: BLE001
        return ""


def composer_value(page: Any) -> str:
    textarea = find(page, ".msg-composer textarea")
    try:
        return textarea.input_value() if textarea else ""
    except Exception:  # noqa: BLE001
        return ""


def expand_composer(page: Any) -> bool:
    if visible(page, ".msg-composer textarea"):
        return True
    clicked = click_first(page, ".msg-btn-say", 'button:has-text("自己说一句")')
    return clicked and wait_for(page, lambda: visible(page, ".msg-composer textarea"), 8000)


def open_character_in_phone(page: Any, character: str) -> bool:
    """在手机消息列表里点开指定角色（点错则返回列表再试）。"""
    if not wait_for(page, lambda: page.locator(".msg-role").count() > 0, 20000):
        return False
    total = page.locator(".msg-role").count()
    for index in range(min(total, 6)):
        role = page.locator(".msg-role").nth(index)
        try:
            role.click(timeout=5000)
        except Exception:  # noqa: BLE001
            continue
        if wait_for(page, lambda: query_one(page, "item") == character, 15000):
            return True
        click_first(page, ".pw-back")
        wait_for(page, lambda: page.locator(".msg-role").count() > 0, 15000)
    return False


def phone_open_ins_messages(page: Any, character: str | None = None) -> bool:
    """手机内：INS 应用 → 消息 → 指定角色会话（默认第一个）。"""
    if not visible(page, '[data-phone-app="ins"]'):
        if not click_first(page, '[data-app-id="ins"]'):
            return False
        if not wait_for(page, lambda: visible(page, '.pw-appview[data-phone-app="ins"]'), 20000):
            return False
    if not page.locator(".msg-role").count():
        click_first(page, '.ins-tab:has-text("消息")', '[role=tab]:has-text("消息")')
        if not wait_for(page, lambda: page.locator(".msg-role").count() > 0, 25000):
            return False
    if character is None:
        return click_first(page, ".msg-role")
    return open_character_in_phone(page, character)


def scenario_r3_extra(browser: Any, cookies: list[dict]) -> None:
    scenario = "r3-extra"
    REPORT.begin(scenario)
    print("\n── [r3-extra] R3 补证：草稿保留 / 发送失败重试 / 限额展示 / 音乐继续播放")

    character: str | None = None
    music_ok = False

    with open_page(browser, cookies=cookies, viewport=(1440, 1000)) as (context, page):
        page.goto(BASE + "/", wait_until="load", timeout=60000)
        boot(page, 2500)
        if not (click_first(page, ".pw-tab") and wait_for(page, lambda: visible(page, "[data-phone-host]"), 15000)):
            REPORT.check("R3-extra：手机宿主可打开", False)
            return
        REPORT.check("R3-extra：手机宿主可打开", True)

        # ── 音乐：手机桌面播放 ───────────────────────────────────────────
        music_state = ""
        music_card = find(page, "[data-music-state]")
        if music_card is not None:
            music_state = music_card.get_attribute("data-music-state") or ""
        REPORT.info("音乐卡片状态", music_state)
        if music_state == "ready":
            if not audio_is_playing(page):
                play_button = page.locator(".pw-btn.play")
                if play_button.count():
                    try:
                        play_button.first.click(timeout=5000)
                    except Exception as error:  # noqa: BLE001
                        REPORT.info("音乐：点击播放异常", str(error)[:120])
            music_ok = wait_for(page, lambda: audio_is_playing(page), 12000)
            REPORT.check("音乐：手机桌面可开始播放（audio[data-pl-music] 未暂停）", music_ok)
            if music_ok:
                t0 = audio_current_time(page)
                page.wait_for_timeout(1500)
                t1 = audio_current_time(page)
                REPORT.check("音乐：播放进度在前进", t1 - t0 > 0.3, f"{t0:.2f} -> {t1:.2f}")
                REPORT.check("音乐：.pw-tab 显示 playing 状态", tab_playing(page))
        else:
            REPORT.skip("音乐：手机桌面播放", f"music_state={music_state!r}（隔离栈下音频资源不可用）")

        # ── 进入 INS → 消息 → 角色会话 ───────────────────────────────────
        entered = phone_open_ins_messages(page)
        REPORT.check("R3-extra：手机内可达消息角色列表", entered)
        if not entered:
            return
        if not wait_for(page, lambda: query_one(page, "screen") == "conversation", 20000):
            REPORT.check("R3-extra：进入角色会话", False, page.url)
            return
        character = query_one(page, "item")
        REPORT.check("R3-extra：进入角色会话", bool(character), page.url)
        if not character:
            return
        wait_for(page, lambda: page.locator(".msg-app").count() > 0, 20000)
        page.wait_for_timeout(2500)
        REPORT.check("R3-extra：自由输入区可用", expand_composer(page))
        if not visible(page, ".msg-composer textarea"):
            REPORT.check("R3-extra：展开输入框", False)
            return
        REPORT.check("R3-extra：展开输入框", True)

        # ── 草稿保留：输入不发送 ─────────────────────────────────────────
        draft_a = unique("r3x-draft")
        composer = find(page, ".msg-composer textarea")
        composer.fill(draft_a)
        page.wait_for_timeout(800)
        REPORT.check(
            "草稿保留：输入写入 sessionStorage（drafts.ts 约定）",
            draft_a in session_draft(page, character),
            f"key=msg.draft.v1:{character}",
        )
        if music_ok:
            now_playing = audio_is_playing(page)
            t_before = audio_current_time(page)
            page.wait_for_timeout(1200)
            t_after = audio_current_time(page)
            REPORT.check(
                "音乐：进入手机会话后仍在播放且进度前进",
                now_playing and t_after > t_before,
                f"{t_before:.2f} -> {t_after:.2f}",
            )
        else:
            REPORT.skip("音乐：进入手机会话后仍在播放", "音频资源不可用")
        shot(page, scenario, "phone-draft-typed")

        # 返回（手机 back）→ 实际落点如实记录 → 再从 UI 进入消息列表并重新进入同一角色
        back_clicked = click_first(page, ".pw-back", 'button[aria-label="返回"]')
        app_back = back_clicked and wait_for(
            page, lambda: visible(page, '.pw-appview[data-phone-app="ins"]'), 20000
        )
        back_url = page.url
        messages_tab = page.locator('.ins-tab:has-text("消息")')
        if app_back and messages_tab.count():
            try:
                messages_tab.first.click(timeout=5000)
            except Exception:  # noqa: BLE001
                click_first(page, '.ins-tab:has-text("消息")', '[role=tab]:has-text("消息")')
        list_back = app_back and wait_for(page, lambda: page.locator(".msg-role").count() > 0, 20000)
        REPORT.info(
            "草稿保留：.pw-back 实际落点",
            f"URL={back_url}（消息页签是 INS 应用内状态，history 返回后回到动态页签；再次点「消息」可回到列表）",
        )
        REPORT.check("草稿保留：.pw-back 返回手机 INS 应用并可从 UI 再进消息列表", list_back, back_url)
        reopened = list_back and open_character_in_phone(page, character)
        REPORT.check("草稿保留：返回列表后重新进入同一角色", reopened)
        if reopened:
            wait_for(page, lambda: page.locator(".msg-app").count() > 0, 20000)
            page.wait_for_timeout(1500)
            expand_composer(page)
            restored = composer_value(page)
            REPORT.check("草稿保留：返回/重新进入后输入框恢复草稿", restored == draft_a, repr(restored[:80]))

        # 收起手机 → 重新打开 → 再进同一角色
        close_clicked = click_first(page, ".pw-close", 'button[aria-label="收起手机"]')
        page.wait_for_timeout(700)
        reopen_phone = bool(close_clicked and click_first(page, ".pw-tab") and wait_for(page, lambda: visible(page, "[data-phone-host]"), 15000))
        REPORT.check("草稿保留：收起手机后可重新打开手机", reopen_phone)
        desktop_restored_ok = False
        if reopen_phone:
            if phone_open_ins_messages(page, character):
                wait_for(page, lambda: page.locator(".msg-app").count() > 0, 20000)
                page.wait_for_timeout(1500)
                expand_composer(page)
                desktop_restored_ok = composer_value(page) == draft_a
        REPORT.check("草稿保留：切回桌面再进入手机同一角色后仍保留", desktop_restored_ok, repr(composer_value(page)[:80]))

        # 展开查看 → canonical（同标签 sessionStorage）
        expanded = False
        expand = find(page, ".pw-expand")
        if expand is not None and expand.is_visible():
            try:
                expand.click(timeout=5000)
                expanded = wait_for(page, lambda: "/apps/ins/messages/" in page.url, 20000)
            except Exception as error:  # noqa: BLE001
                REPORT.info("展开查看点击异常", str(error)[:120])
        REPORT.check("草稿保留：点击「展开查看」进入 canonical 会话", expanded, page.url)
        if expanded:
            wait_for(page, lambda: page.locator(".msg-app").count() > 0, 20000)
            page.wait_for_timeout(1500)
            expand_composer(page)
            canonical_value = composer_value(page)
            REPORT.check(
                "草稿保留：canonical 页面读到同一 sessionStorage 草稿",
                canonical_value == draft_a,
                repr(canonical_value[:80]),
            )
            page.goto(BASE + f"/?phone=ins&screen=conversation&item={character}", wait_until="load", timeout=60000)
            boot(page, 2000)
            wait_for(page, lambda: page.locator(".msg-app").count() > 0, 20000)
            page.wait_for_timeout(1500)
            expand_composer(page)
            returned_value = composer_value(page)
            REPORT.check(
                "草稿保留：展开后返回手机内仍保留草稿",
                returned_value == draft_a,
                repr(returned_value[:80]),
            )

        # ── 发送失败重试 ─────────────────────────────────────────────────
        expand_composer(page)
        if not visible(page, ".msg-composer textarea"):
            REPORT.check("发送失败重试：输入框可见", False)
            return
        send_text = unique("r3x-send")
        composer = find(page, ".msg-composer textarea")
        composer.fill(send_text)
        injected: list[str] = []

        def fail_send(route: Any, request: Any) -> None:
            injected.append(request.url)
            route.fulfill(
                status=500,
                content_type="application/json",
                body=json.dumps(
                    {"error": {"code": "E2E_INJECTED", "message": "p5rw 注入：发送失败"}, "request_id": "p5rw"},
                    ensure_ascii=False,
                ),
            )

        page.route(MESSAGES_POST_ROUTE, fail_send)
        send_button = find(page, ".msg-btn-send")
        sent_clicked = False
        if send_button is not None:
            try:
                send_button.click(timeout=5000)
                sent_clicked = True
            except Exception as error:  # noqa: BLE001
                REPORT.info("发送按钮点击异常", str(error)[:120])
        REPORT.check("发送失败：点击发送（被注入 500）", sent_clicked)
        notice_visible = wait_for(page, lambda: visible(page, '[data-testid="msg-notice"]'), 15000)
        REPORT.check(
            "发送失败：出现明确错误反馈",
            notice_visible,
            text_of(page, '[data-testid="msg-notice"]')[:160],
        )
        REPORT.check("发送失败：确实命中注入的发送请求", len(injected) >= 1, str(injected[:2]))
        after_fail_value = composer_value(page)
        REPORT.check("发送失败：输入草稿不丢", send_text in after_fail_value, repr(after_fail_value[:80]))
        REPORT.check(
            "发送失败：sessionStorage 草稿仍在（可重试）",
            send_text in session_draft(page, character),
        )
        shot(page, scenario, "phone-send-failed")
        page.unroute(MESSAGES_POST_ROUTE)
        retry_button = find(page, ".msg-btn-send")
        if retry_button is not None:
            try:
                retry_button.click(timeout=5000)
            except Exception as error:  # noqa: BLE001
                REPORT.info("重试发送点击异常", str(error)[:120])
        sent_ok = wait_for(page, lambda: send_text in page.locator(".msg-list").inner_text(), 25000)
        REPORT.check("发送失败重试：解除拦截后再次发送成功", sent_ok)
        if sent_ok:
            REPORT.check("发送成功后：输入框清空", composer_value(page) == "", repr(composer_value(page)[:40]))
            REPORT.check("发送成功后：sessionStorage 草稿被清除", session_draft(page, character) == "")
        shot(page, scenario, "phone-send-retried")

        # ── 限额 / usage 展示 ────────────────────────────────────────────
        usage_text = text_of(page, ".msg-usage")
        usage_visible = visible(page, ".msg-usage")
        usage_pattern = re.search(r"(今天已用\s*\d+\s*/\s*\d+\s*次自由聊天|自由聊天每天最多\s*\d+\s*次)", usage_text)
        REPORT.check("限额：.msg-usage 可见", usage_visible)
        REPORT.check("限额：usage 文案符合约定格式（已用/上限或每日上限）", bool(usage_pattern), usage_text[:160])
        REPORT.info("限额：usage 实际文案", usage_text[:200] or "（空）")
        REPORT.skip("限额耗尽/不可发送态的端到端复现", "需真实耗尽每日额度（20 次/访客/天），本次不真实耗尽；只验证展示与格式")
        shot(page, scenario, "phone-usage")


SCENARIO_FUNCS_EXTRA: dict[str, Callable[[Any, list[dict]], None]] = {
    "r1-guards": scenario_r1_guards,
    "r2-save-as-new": scenario_r2_save_as_new,
    "r3-extra": scenario_r3_extra,
}


SCENARIO_FUNCS: dict[str, Callable[[Any, list[dict]], None]] = {
    "r1-ins": scenario_r1_ins,
    "r1-journal": scenario_r1_journal,
    "r2-moment": scenario_r2_moment,
    "r2-journal": scenario_r2_journal,
    "r3-phone": scenario_r3_phone,
}
SCENARIO_FUNCS.update(SCENARIO_FUNCS_EXTRA)


# ═══════════════════════════════════════════════════════════════════════════
# 环境信息 / 输出
# ═══════════════════════════════════════════════════════════════════════════


def run_command(*args: str) -> str:
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=20, check=False)
        return (result.stdout or result.stderr or "").strip()
    except Exception:  # noqa: BLE001
        return ""


def build_tree_diff() -> list[str]:
    """隔离构建副本 apps/web/features、apps/web/app 与当前工作树的差异（空=一致）。"""
    pairs = [
        (REPO / "apps/web/features", WORK / "web/apps/web/features"),
        (REPO / "apps/web/app", WORK / "web/apps/web/app"),
    ]
    differences: list[str] = []
    for left, right in pairs:
        if not right.exists():
            differences.append(f"构建副本缺少目录：{right}")
            continue
        text = run_command("diff", "-rq", str(left), str(right))
        if text:
            differences.extend(text.splitlines()[:8])
    return differences


def build_provenance() -> dict[str, Any]:
    """构建隔离副本 vs 当前工作树 / HEAD：证明基线构建来自哪个源码状态。

    e2e-stack.sh 的构建是「某一时刻 rsync 的源码副本」；之后工作树里的修复不会进入
    已构建产物，直到再次 `e2e-stack.sh up` 触发重建。这里对比副本与 HEAD 文件内容，
    给基线与改后证据都留下可核对的口径。
    """
    stack_root = WORK / "web"
    status = run_command("git", "-C", str(REPO), "status", "--porcelain")
    dirty_files: list[str] = []
    untracked_files: list[str] = []
    for line in status.splitlines():
        code = line[:2]
        path = line[3:].strip()
        if not path.startswith("apps/web/"):
            continue
        if code.strip() == "??":
            untracked_files.append(path)
        else:
            dirty_files.append(path)
    details: list[dict[str, Any]] = []
    for rel in dirty_files[:40]:
        stack_file = stack_root / rel
        matches_head: bool | None = None
        in_build = stack_file.exists()
        if in_build:
            try:
                stack_text = stack_file.read_text(encoding="utf-8")
                head_text = run_command("git", "-C", str(REPO), "show", f"HEAD:{rel}")
                matches_head = stack_text == (head_text + "\n") or stack_text.rstrip("\n") == head_text.rstrip("\n")
            except Exception:  # noqa: BLE001
                matches_head = None
        details.append({"file": rel, "present_in_build": in_build, "build_copy_matches_head": matches_head})
    return {
        "modified_web_files": dirty_files,
        "untracked_web_files": untracked_files,
        "build_copy_checks": details,
        "build_has_only_head_web_sources": all(
            item.get("build_copy_matches_head") for item in details if item.get("present_in_build")
        )
        if details
        else True,
    }


def source_info() -> dict[str, Any]:
    head = run_command("git", "-C", str(REPO), "rev-parse", "HEAD")
    status = run_command("git", "-C", str(REPO), "status", "--porcelain")
    build_id_path = WORK / "web" / "apps" / "web" / ".next" / "BUILD_ID"
    build_id = ""
    build_mtime = None
    if build_id_path.exists():
        build_id = build_id_path.read_text(encoding="utf-8").strip()
        build_mtime = time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(build_id_path.stat().st_mtime))
    newer = ""
    if build_id_path.exists():
        newer = run_command(
            "bash",
            "-c",
            f'find "{REPO}/apps/web/features" "{REPO}/apps/web/app" -newer "{build_id_path}" -type f 2>/dev/null | head -1',
        )
    provenance = build_provenance()
    only_head = provenance.get("build_has_only_head_web_sources")
    tree_diff = build_tree_diff()
    build_note = (
        f"隔离构建 BUILD_ID={build_id}（{build_mtime}）；构建副本 vs 当前工作树/HEAD 核对："
        + (
            "apps/web/features、apps/web/app 与工作树逐文件一致 → 该构建包含当前源码"
            if not tree_diff
            else "存在与工作树不同的 web 源码，见 build_tree_diff"
        )
        + ("" if only_head else "；注意：运行开始时工作树存在未提交 web 修改，详见 build_provenance")
    )
    return {
        "repo": str(REPO),
        "head": head,
        "dirty": bool(status),
        "dirty_files": status.splitlines()[:20],
        "isolated_workdir": str(WORK),
        "build_id": build_id,
        "build_time": build_mtime,
        "source_newer_than_build": bool(newer),
        "source_newer_example": newer,
        "build_provenance": provenance,
        "build_tree_matches_worktree": not tree_diff,
        "build_tree_diff": tree_diff[:10],
        "build_note": build_note,
    }


def stack_status() -> dict[str, Any]:
    output = run_command("bash", str(REPO / "tools" / "e2e-stack.sh"), "status")
    return {"command": "tools/e2e-stack.sh status", "output": output}


def write_output(payload: dict[str, Any], json_path: pathlib.Path | None) -> None:
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    if json_path is not None:
        json_path.parent.mkdir(parents=True, exist_ok=True)
        json_path.write_text(text, encoding="utf-8")
        print(f"\nJSON 摘要已写入：{json_path}")
    else:
        print("\n===JSON===")
        print(text)


# ═══════════════════════════════════════════════════════════════════════════
# main
# ═══════════════════════════════════════════════════════════════════════════


def reachable(url: str) -> bool:
    import urllib.request

    try:
        with urllib.request.urlopen(url, timeout=6) as response:  # noqa: S310 - 本机隔离栈
            return 200 <= response.status < 500
    except Exception:  # noqa: BLE001
        return False


def main() -> int:
    global BASE, API, SHOTS

    parser = argparse.ArgumentParser(description="P5 返工包 R1/R2/R3 隔离浏览器端到端验收")
    parser.add_argument("base", nargs="?", default=os.environ.get("E2E_P5_BASE", DEFAULT_BASE))
    parser.add_argument("--scenarios", default="", help="逗号分隔场景 id：" + ",".join(SCENARIO_ORDER))
    parser.add_argument("--json", default="", help="JSON 结果输出路径")
    parser.add_argument("--shots-dir", default="", help="截图目录（默认 .dsh/screenshots/p5-rework/<phase>）")
    parser.add_argument("--phase", default="manual", help="baseline / after / manual（截图子目录）")
    args = parser.parse_args()

    BASE = args.base.rstrip("/")
    API = BASE + "/api/v1"
    shots_root = pathlib.Path(args.shots_dir) if args.shots_dir else DEFAULT_SHOTS_ROOT
    SHOTS = shots_root / args.phase
    json_path = pathlib.Path(args.json) if args.json else None

    selected = [item.strip() for item in args.scenarios.split(",") if item.strip()] or list(SCENARIO_ORDER)
    unknown = [item for item in selected if item not in SCENARIO_FUNCS]
    if unknown:
        print(f"✗ 未知场景：{unknown}（可选：{SCENARIO_ORDER}）")
        return 2

    started = time.time()
    print(f"== P5 返工包 e2e：{BASE}（engine=chromium，phase={args.phase}）==")
    print(f"   场景 {len(selected)} 个：{', '.join(selected)}")
    print(f"   截图目录 {SHOTS}")

    src = source_info()
    print(
        f"   源码 HEAD={src['head'][:12]} dirty={src['dirty']} "
        f"build_id={src['build_id']} build_time={src['build_time']} "
        f"源码比构建新={src['source_newer_than_build']}"
    )

    if not reachable(BASE + "/"):
        print(f"✗ 前端 {BASE} 不可达：先 `bash tools/e2e-stack.sh up`（隔离栈 3130）")
        REPORT.env_error = True
        payload = {
            "tool": "tools/e2e-p5-rework.py",
            "phase": args.phase,
            "base": BASE,
            "api": API,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "environment_error": True,
            "error": f"前端不可达：{BASE}",
            "source": src,
            "summary": {"pass": 0, "fail": 0, "skip": 0, "environment_error": True},
            "checks": [],
            "skips": [],
            "screenshots": [],
        }
        write_output(payload, json_path)
        return 2

    from playwright.sync_api import sync_playwright

    browser_version = ""
    exit_code = 0
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=HEADLESS)
        browser_version = browser.version
        print(f"   chromium {browser_version}（headless={HEADLESS}）")
        try:
            cookies = login_once(browser)
            if cookies is None:
                REPORT.env_error = True
                exit_code = 2
                print("✗ 站主登录失败：确认隔离栈 owner/e2e-password-123，或稍后重试（登录限流 5 次/分钟）")
            else:
                for scenario in selected:
                    try:
                        SCENARIO_FUNCS[scenario](browser, cookies)
                    except Exception as error:  # noqa: BLE001
                        REPORT.begin(scenario)
                        REPORT.check(
                            "场景异常（脚本或页面非预期）",
                            False,
                            f"{type(error).__name__}: {error}",
                        )
                        traceback.print_exc()
        finally:
            try:
                browser.close()
            except Exception:  # noqa: BLE001
                pass

    elapsed = time.time() - started
    scenario_status = REPORT.scenario_status()
    passed = sum(1 for item in REPORT.checks if item["ok"])
    failed = sum(1 for item in REPORT.checks if not item["ok"])
    skipped = len(REPORT.skips)
    if failed:
        exit_code = 1
    if REPORT.env_error:
        exit_code = 2

    # 未选场景明确标为未执行（不伪装成通过）
    for scenario in SCENARIO_ORDER:
        if scenario not in selected:
            scenario_status.append(
                {"id": scenario, "status": "NOT_RUN", "passed": 0, "failed": 0, "skipped": 0}
            )

    payload = {
        "tool": "tools/e2e-p5-rework.py",
        "script_sha256": hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),
        "phase": args.phase,
        "base": BASE,
        "api": API,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "duration_seconds": round(elapsed),
        "environment_error": REPORT.env_error,
        "source": src,
        "stack": {
            **stack_status(),
            "ports": {"web": 3130, "api": 8130, "postgres": 55434},
            "workdir": str(WORK),
        },
        "browser": {
            "engine": "chromium",
            "version": browser_version,
            "headless": HEADLESS,
            "viewports": REQUIRED_VIEWPORTS,
        },
        "scenarios": scenario_status,
        "summary": {
            "pass": passed,
            "fail": failed,
            "skip": skipped,
            "environment_error": REPORT.env_error,
            "exit_code": exit_code,
        },
        "checks": REPORT.checks,
        "skips": REPORT.skips,
        "info": REPORT.infos,
        "screenshots": REPORT.screenshots,
        "coverage_added": COVERAGE_ADDED,
        "unverified": UNVERIFIED,
    }
    write_output(payload, json_path)

    print("\n== 结果 ==")
    for item in scenario_status:
        print(f"  [{item['status']:7}] {item['id']:12} pass={item['passed']} fail={item['failed']} skip={item['skipped']}")
    print(f"  通过 {passed} 项；失败 {failed} 项；跳过 {skipped} 项；耗时 {elapsed:.0f}s")
    for item in REPORT.checks:
        if not item["ok"]:
            print(f"  ✗ [{item['scenario']}] {item['label']} — {item['detail']}")
    for item in REPORT.skips:
        print(f"  ⋯ [{item['scenario']}] {item['label']} — {item['reason']}")
    print(f"  截图：{SHOTS}")
    print(f"  退出码：{exit_code}")
    return exit_code


if __name__ == "__main__":
    if not PNG_RED.exists():
        write_test_png(PNG_RED, (206, 60, 60))
    if not PNG_BLUE.exists():
        write_test_png(PNG_BLUE, (40, 90, 200))
    raise SystemExit(main())
