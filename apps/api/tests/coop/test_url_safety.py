"""外链地址安全规则（验收第 2 条）。

这一组是**纯函数**用例：不需要数据库，因此无论测试库是否配置都会跑。
它们直接钉住「什么地址能成为公开 `<a href>`」这件事，而不是只断言一个正则。
"""

from __future__ import annotations

import pytest

from app.modules.coop.urls import (
    URL_MAX_LENGTH,
    InvalidExternalUrl,
    is_safe_external_url,
    normalize_external_url,
    unsafe_url_reason,
)

# 这些 scheme 都不能变成可执行外链（验收第 2 条点名的就是 javascript / data）。
EXECUTABLE_SCHEMES = [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "  javascript:alert(1)  ",
    "jav\tascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "DATA:text/html;base64,PHNjcmlwdD4=",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "blob:https://example.com/6f1e",
    "about:blank",
    "chrome://settings",
]


@pytest.mark.parametrize("value", EXECUTABLE_SCHEMES)
def test_non_http_scheme_is_rejected(value: str):
    with pytest.raises(InvalidExternalUrl):
        normalize_external_url(value)
    assert is_safe_external_url(value) is False
    assert unsafe_url_reason(value) is not None


@pytest.mark.parametrize(
    "value",
    [
        "//evil.example.com/path",  # 协议相对：不是本站认可的公开外链形态
        "example.com",
        "/relative/path",
        "http://",
        "https:///path",
    ],
)
def test_scheme_is_required(value: str):
    with pytest.raises(InvalidExternalUrl):
        normalize_external_url(value)


@pytest.mark.parametrize(
    "value",
    [
        "http://user:password@example.com/",
        "https://admin@example.com/",
        "http://localhost:3000/",
        "http://intranet/",  # 单标签内网名
        "http://exa mple.com/",
        "http://example.com/" + "a" * URL_MAX_LENGTH,
    ],
)
def test_dangerous_or_unusable_forms_are_rejected(value: str):
    with pytest.raises(InvalidExternalUrl):
        normalize_external_url(value)


def test_internal_whitespace_and_control_chars_are_rejected():
    for value in [
        "http://exa\nmple.com/",
        "http://example.com/\u0000",
        "http://example.com/a\u2028b",
        "http://example.com/a\u00a0b",
    ]:
        with pytest.raises(InvalidExternalUrl):
            normalize_external_url(value)


def test_ip_literal_and_port_are_accepted():
    assert normalize_external_url("http://192.168.1.10:8080/blog") == "http://192.168.1.10:8080/blog"
    assert normalize_external_url("https://[2001:db8::1]:8443/x") == "https://[2001:db8::1]:8443/x"


def test_scheme_and_host_are_normalized_but_path_is_preserved():
    assert (
        normalize_external_url("HTTPS://EXAMPLE.COM/Path/To?q=1&x=%E6%80%AA#top")
        == "https://example.com/Path/To?q=1&x=%E6%80%AA#top"
    )


def test_unicode_hostname_is_preserved_as_idn_ready_text():
    # urlsplit 不做 IDNA 转换：这里保证不把非 ASCII 域名弄丢，也不做静默改写。
    assert normalize_external_url("https://例え.jp/ブログ") == "https://例え.jp/ブログ"


def test_trailing_whitespace_is_trimmed_not_rejected():
    assert normalize_external_url("  https://example.com/  ") == "https://example.com/"


def test_unsafe_url_reason_is_none_for_safe_address():
    assert unsafe_url_reason("https://example.com/") is None
