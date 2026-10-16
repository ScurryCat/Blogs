"""外链地址的安全规范化（验收第 2 条：`javascript:` / `data:` 等不能成为可执行外链）。

为什么要有独立模块而不是 scattered 的 `startswith("http")`：

  - 友链是**站主手工输入、公开渲染成 `<a href>`** 的字符串。这正是「把不可信输入放进
    可执行位置」的典型场景：`javascript:alert(1)`、`data:text/html,<script>…`、
    `vbscript:`、以及带控制字符的变形（`java\\nscript:`）都必须在这里被拒。
  - 只做前缀检查会漏掉大小写与空白变形（`JavaScript:`、`  javascript:`），也会
    误放 `http://` 后面没有主机名的字符串。
  - 规范化后的字符串才是入库值：同一地址不会因为大小写 / 尾随空白变成两条记录。

约定（05 未规定，由本模块定义并写进交付单）：

  1. 只接受 `http` / `https`；其余 scheme 一律拒绝（不给「以后可能支持 mailto」的模糊空间）。
  2. 缺少 scheme（含 `//example.com` 这种协议相对写法）一律拒绝 —— 相对地址不是友链。
  3. 必须有主机名，且主机名含 `.`（域名）或是 IP 字面量；`localhost` 这类内网名拒绝。
  4. 拒绝内嵌凭据（`http://user:pass@host`）：公开页面不该出现别人的凭据。
  5. 拒绝控制字符与内部空白；长度上限 2048（与数据库列一致）。
  6. 规范化：scheme 与小写主机名固定下来，path / query / fragment 原样保留。

数据库侧还有同形的 CHECK 约束（`url ~* '^https?://'`）：服务被绕过时数据库仍然拦得住。
"""

from __future__ import annotations

import ipaddress
from urllib.parse import urlsplit, urlunsplit

URL_MAX_LENGTH = 2048

ALLOWED_SCHEMES = frozenset({"http", "https"})

# 控制字符（含 \t \n \r）与内部空白：浏览器会忽略一部分，攻击者正是靠它绕过前缀检查。
_FORBIDDEN_CHARS = frozenset(
    [chr(code) for code in range(0x00, 0x21)] + [chr(0x7F), "\u00a0", "\u2028", "\u2029"]
)


class InvalidExternalUrl(ValueError):
    """地址不能作为公开外链使用。message 会进入 422 的字段级错误。"""


def _reject(message: str) -> InvalidExternalUrl:
    return InvalidExternalUrl(message)


def normalize_external_url(raw: str) -> str:
    """校验并规范化一个公开外链地址。非法输入抛 `InvalidExternalUrl`。"""
    if raw is None:
        raise _reject("地址不能为空")
    candidate = raw.strip()
    if not candidate:
        raise _reject("地址不能为空")
    if len(candidate) > URL_MAX_LENGTH:
        raise _reject(f"地址最长 {URL_MAX_LENGTH} 个字符")
    if any(char in _FORBIDDEN_CHARS for char in candidate):
        raise _reject("地址不能包含空白或控制字符")

    parts = urlsplit(candidate)
    scheme = (parts.scheme or "").lower()
    if not scheme:
        # 含 `//evil.com` 与 `example.com`：都不是本站认可的公开外链形态。
        raise _reject("地址必须以 http:// 或 https:// 开头")
    if scheme not in ALLOWED_SCHEMES:
        raise _reject("只接受 http:// 或 https:// 开头的地址")

    host = parts.hostname or ""
    if not host:
        raise _reject("地址缺少主机名")
    if parts.username is not None or parts.password is not None:
        raise _reject("地址不能内嵌用户名或密码")
    if not _host_is_public_name(host):
        raise _reject("主机名必须是域名或 IP 地址")

    try:
        port = parts.port
    except ValueError:
        raise _reject("端口号不合法") from None

    netloc = f"[{host.lower()}]" if ":" in host else host.lower()
    if port is not None:
        netloc = f"{netloc}:{port}"

    normalized = urlunsplit((scheme, netloc, parts.path, parts.query, parts.fragment))
    if len(normalized) > URL_MAX_LENGTH:
        raise _reject(f"地址最长 {URL_MAX_LENGTH} 个字符")
    return normalized


def _host_is_public_name(host: str) -> bool:
    """域名（含至少一个点）或 IP 字面量。`localhost` / 单标签内网名一律拒绝。"""
    if not host:
        return False
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        pass
    if host.lower() == "localhost":
        return False
    return "." in host and not host.startswith(".") and not host.endswith(".")


def is_safe_external_url(value: str) -> bool:
    """只读判断：能规范化成 http(s) 地址即为真。用于读取侧与前端同形的兜底过滤。"""
    try:
        normalize_external_url(value)
    except InvalidExternalUrl:
        return False
    return True


def unsafe_url_reason(value: str) -> str | None:
    """返回拒绝原因；地址合法时返回 None。给字段级错误与发布前复检共用。"""
    try:
        normalize_external_url(value)
    except InvalidExternalUrl as error:
        return str(error)
    return None


__all__ = [
    "ALLOWED_SCHEMES",
    "InvalidExternalUrl",
    "URL_MAX_LENGTH",
    "is_safe_external_url",
    "normalize_external_url",
    "unsafe_url_reason",
]
