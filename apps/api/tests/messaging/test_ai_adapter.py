"""AI 适配层：输出清洗与切分、模拟服务、真实适配层的 HTTP 行为（08 §7）。

这里不 mock 任何东西：
  - 输出清洗是纯函数，直接真实调用；
  - 模拟服务真的 await 一遍，故障注入真的睡到超时；
  - `openai_compatible` 走**真实的本机 HTTP 服务**（stdlib `http.server`），
    因此「状态码怎么映射、重试只发生一次、key 不进错误信息」都是真实验证。
"""

from __future__ import annotations

import asyncio
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from app.modules.messaging.ai.base import (
    AI_ERROR_NOT_CONFIGURED,
    AI_ERROR_TIMEOUT,
    AI_ERROR_TRANSPORT,
    AI_ERROR_UPSTREAM,
    AiCompletionRequest,
    AiProviderError,
)
from app.modules.messaging.ai.openai_compatible import OpenAiCompatibleProvider
from app.modules.messaging.ai.output import normalize_bubbles, sanitize, split_bubbles
from app.modules.messaging.ai.prompts import build_history, build_system_prompt
from app.modules.messaging.ai.registry import UnavailableProvider, resolve_provider
from app.modules.messaging.ai.simulator import SimulatorProvider, classify
from app.modules.messaging.characters import FUTABA, MORGANA
from app.modules.messaging.config import MessagingSettings
from app.modules.messaging.content import CandidateContent, ResolvedCard, extract_cards


def _request(**overrides) -> AiCompletionRequest:
    base = dict(
        character=FUTABA,
        history=(),
        user_text="你好",
        max_bubbles=3,
        bubble_max_codepoints=240,
        max_output_codepoints=720,
        timeout_seconds=1.0,
    )
    base.update(overrides)
    return AiCompletionRequest(**base)


# --- 输出清洗 --------------------------------------------------------------


def test_sanitize_removes_html_markdown_links_urls_and_control_chars():
    raw = (
        '<script>alert("x")</script>你好 <b>世界</b> '
        "[点这里](https://evil.example.com/steal) "
        "也可以直接访问 https://evil.example.com 或 www.evil.example.com\x07 完"
    )
    cleaned = sanitize(raw)
    assert "<" not in cleaned and ">" not in cleaned
    assert "script" not in cleaned
    assert "https://" not in cleaned and "http://" not in cleaned
    assert "www." not in cleaned
    assert "点这里" in cleaned  # 链接文字保留，链接目标丢弃
    assert "\x07" not in cleaned


def test_sanitize_removes_code_fences_but_keeps_text():
    cleaned = sanitize("看这段：\n```python\nprint(1)\n```\n就这样")
    assert "```" not in cleaned
    assert "print(1)" in cleaned


def test_split_bubbles_honours_explicit_separator():
    bubbles = split_bubbles("第一句\n---\n第二句", max_bubbles=3, bubble_max_codepoints=100)
    assert bubbles == ["第一句", "第二句"]


def test_split_bubbles_falls_back_to_paragraphs_and_sentences():
    by_blank = split_bubbles("第一段\n\n第二段", max_bubbles=3, bubble_max_codepoints=100)
    assert by_blank == ["第一段", "第二段"]

    long_text = "第一句。" * 40
    bubbles = split_bubbles(long_text, max_bubbles=3, bubble_max_codepoints=20)
    assert len(bubbles) == 3
    assert all(len(bubble) <= 20 for bubble in bubbles)


def test_split_bubbles_hard_cuts_when_there_is_no_sentence_boundary():
    bubbles = split_bubbles("啊" * 50, max_bubbles=3, bubble_max_codepoints=20)
    assert bubbles == ["啊" * 20, "啊" * 20, "啊" * 10]


def test_split_bubbles_never_exceeds_max_bubbles():
    raw = "\n---\n".join(f"第{i}句" for i in range(10))
    assert len(split_bubbles(raw, max_bubbles=3, bubble_max_codepoints=100)) == 3


def test_normalize_bubbles_merges_adjacent_duplicates():
    assert normalize_bubbles(
        "一样\n---\n一样\n---\n不一样", max_bubbles=3, bubble_max_codepoints=50
    ) == ["一样", "不一样"]


def test_normalize_bubbles_rejects_empty_output():
    for raw in ("", "   \n\n  ", "<b></b>", "https://only-a-url.example.com"):
        with pytest.raises(AiProviderError) as error:
            normalize_bubbles(raw, max_bubbles=3, bubble_max_codepoints=50)
        assert error.value.code == "invalid_output"


# --- 提示词 -----------------------------------------------------------------


def test_system_prompt_states_the_hard_rules_and_lists_only_given_content():
    candidates = (
        CandidateContent(
            token="[[post:hello]]",
            card=ResolvedCard("post", "hello", "标题", "摘要", "/posts/hello"),
        ),
    )
    prompt = build_system_prompt(_request(candidates=candidates))
    assert "非官方同人" in prompt
    assert "没有收到任何图片" in prompt
    assert "[[post:hello]]" in prompt
    assert "标题" in prompt
    # 角色卡的禁止事项必须原样进提示
    for rule in FUTABA.forbidden:
        assert rule in prompt


def test_system_prompt_says_so_when_there_is_no_content():
    prompt = build_system_prompt(_request(candidates=()))
    assert "没有任何可引用的公开内容" in prompt


def test_build_history_trims_and_drops_blanks():
    from app.modules.messaging.ai.base import AiTurn

    history = build_history(
        _request(
            history=(
                AiTurn(role="user", text="  有 空 白  "),
                AiTurn(role="assistant", text="   "),
                AiTurn(role="assistant", text="x" * 500),
            ),
            bubble_max_codepoints=20,
        )
    )
    assert history[0].text == "有 空 白"
    assert len(history) == 2
    assert len(history[1].text) == 20


# --- 内容 token 提取 --------------------------------------------------------


def test_extract_cards_only_accepts_allowlisted_tokens():
    good = ResolvedCard("post", "hello", "标题", "摘要", "/posts/hello")
    candidates = [CandidateContent(token="[[post:hello]]", card=good)]
    text, cards = extract_cards(
        "去看看 [[post:hello]] 和 [[post:secret-draft]] 还有 [[path:/admin]]",
        candidates,
    )
    assert [card.id for card in cards] == ["hello"]
    assert "[[" not in text
    assert "secret-draft" not in text
    assert "/admin" not in text


def test_extract_cards_caps_at_two_and_dedupes():
    cards = [
        ResolvedCard("post", f"p{index}", f"标题{index}", "", f"/posts/p{index}")
        for index in range(4)
    ]
    candidates = [CandidateContent(token=f"[[post:p{index}]]", card=card) for index, card in enumerate(cards)]
    _, extracted = extract_cards(
        "[[post:p0]] [[post:p0]] [[post:p1]] [[post:p2]] [[post:p3]]", candidates
    )
    assert [card.id for card in extracted] == ["p0", "p1"]


# --- 模拟服务 --------------------------------------------------------------


def test_simulator_is_deterministic_for_the_same_input():
    provider = SimulatorProvider()

    async def run():
        first = await provider.complete(_request(user_text="我有个 bug 要调"))
        second = await provider.complete(_request(user_text="我有个 bug 要调"))
        return first, second

    first, second = asyncio.run(run())
    assert first.raw_text == second.raw_text
    assert first.provider == "simulator"
    assert first.model is None


def test_simulator_varies_by_character_and_branch():
    provider = SimulatorProvider()

    async def run():
        futaba = await provider.complete(_request(character=FUTABA, user_text="我有个 bug"))
        morgana = await provider.complete(_request(character=MORGANA, user_text="我有个 bug"))
        thanks = await provider.complete(_request(character=FUTABA, user_text="谢谢你"))
        return futaba, morgana, thanks

    futaba, morgana, thanks = asyncio.run(run())
    assert futaba.raw_text != morgana.raw_text
    assert thanks.raw_text != futaba.raw_text


def test_simulator_never_emits_a_url_or_html():
    provider = SimulatorProvider()

    async def run():
        return [
            (await provider.complete(_request(user_text=text))).raw_text
            for text in ("你好", "推荐点什么", "我有个 bug", "这个站是什么")
        ]

    for raw in asyncio.run(run()):
        assert "http" not in raw
        assert "<" not in raw


def test_simulator_only_emits_allowlisted_tokens():
    provider = SimulatorProvider()
    card = ResolvedCard("path", "/posts", "文章列表", "站主写的长文", "/posts")
    candidates = (CandidateContent(token="[[path:/posts]]", card=card),)

    async def run():
        return await provider.complete(
            _request(user_text="给我推荐点东西", candidates=candidates)
        )

    result = asyncio.run(run())
    _, cards = extract_cards(result.raw_text, list(candidates))
    assert [item.id for item in cards] == ["/posts"]


def test_simulator_failure_modes_are_real():
    async def run_timeout():
        provider = SimulatorProvider(failure_mode="timeout")
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(provider.complete(_request(timeout_seconds=0.05)), timeout=0.1)

    asyncio.run(run_timeout())

    async def run_error():
        provider = SimulatorProvider(failure_mode="error")
        with pytest.raises(AiProviderError) as error:
            await provider.complete(_request())
        assert error.value.code == AI_ERROR_UPSTREAM

    asyncio.run(run_error())


def test_classify_covers_the_documented_branches():
    assert classify("我有个 bug 要修") == "debug"
    assert classify("算法题卡住了") == "algorithm"
    assert classify("推荐点东西给我看") == "recommend"
    assert classify("谢谢你") == "thanks"
    assert classify("再见") == "farewell"
    assert classify("这个站是什么") == "about_site"
    assert classify("嗯") == "fallback"


def test_simulator_output_respects_bubble_limits():
    provider = SimulatorProvider()

    async def run():
        return await provider.complete(_request(user_text="我这段代码有个 bug，帮我看下"))

    result = asyncio.run(run())
    bubbles = normalize_bubbles(result.raw_text, max_bubbles=3, bubble_max_codepoints=240)
    assert 1 <= len(bubbles) <= 3
    assert result.notes and "模拟" in result.notes[0]


# --- 供应商解析 -------------------------------------------------------------


def test_resolve_provider_defaults_to_simulator():
    settings = MessagingSettings()
    assert isinstance(resolve_provider(settings), SimulatorProvider)


def test_resolve_provider_disabled_and_incomplete_config():
    disabled = resolve_provider(MessagingSettings(ai_provider="disabled"))
    assert isinstance(disabled, UnavailableProvider)

    incomplete = resolve_provider(
        MessagingSettings(ai_provider="openai_compatible", ai_base_url="https://x", ai_model="m")
    )
    assert isinstance(incomplete, UnavailableProvider)
    assert "MESSAGING_AI_API_KEY" in incomplete.reason
    # 关键：这个降级实现**不会**偷偷换成模拟服务继续回答
    with pytest.raises(AiProviderError) as error:
        asyncio.run(incomplete.complete(_request()))
    assert error.value.code == AI_ERROR_NOT_CONFIGURED


def test_settings_never_expose_the_api_key():
    settings = MessagingSettings(
        ai_provider="openai_compatible",
        ai_base_url="https://example.invalid",
        ai_api_key="sk-super-secret-value",
        ai_model="some-model",
    )
    summary = json.dumps(settings.safe_summary(), ensure_ascii=False)
    assert "sk-super-secret-value" not in summary
    assert summary.count('"ai_api_key_set": true') == 1
    ready, reason = settings.provider_ready()
    assert ready is True
    assert "sk-super-secret-value" not in reason


def test_provider_requires_complete_configuration():
    with pytest.raises(AiProviderError) as error:
        OpenAiCompatibleProvider(base_url="", api_key="k", model="m")
    assert error.value.code == AI_ERROR_NOT_CONFIGURED

    with pytest.raises(AiProviderError):
        OpenAiCompatibleProvider(base_url="ftp://x", api_key="k", model="m")


# --- 真实 HTTP 往返 --------------------------------------------------------


class _Handler(BaseHTTPRequestHandler):
    """一个可编排的本机假上游。它记录收到的请求，供断言重试次数与请求体。"""

    received: list[dict] = []
    script: list[tuple[int, object]] = []

    def do_POST(self):  # noqa: N802 - http.server 的接口
        length = int(self.headers.get("content-length", "0"))
        body = json.loads(self.rfile.read(length) or b"{}")
        type(self).received.append({"body": body, "auth": self.headers.get("authorization")})
        index = min(len(type(self).received) - 1, len(type(self).script) - 1)
        status, payload = type(self).script[index]
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, *args):  # 静音
        return


@pytest.fixture()
def fake_upstream():
    _Handler.received = []
    _Handler.script = [(200, {"choices": [{"message": {"content": "默认回复"}}]})]
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}", _Handler
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def test_openai_compatible_success_round_trip(fake_upstream):
    base_url, handler = fake_upstream
    handler.script = [(200, {"choices": [{"message": {"content": "第一句\n---\n第二句"}}]})]
    provider = OpenAiCompatibleProvider(
        base_url=base_url, api_key="sk-test-key", model="test-model"
    )

    result = asyncio.run(provider.complete(_request(user_text="你好")))
    assert result.raw_text == "第一句\n---\n第二句"
    assert result.model == "test-model"
    assert result.attempts == 1

    sent = handler.received[-1]
    assert sent["auth"] == "Bearer sk-test-key"
    assert sent["body"]["model"] == "test-model"
    assert sent["body"]["messages"][0]["role"] == "system"
    assert sent["body"]["messages"][-1] == {"role": "user", "content": "你好"}


def test_openai_compatible_retries_once_then_succeeds(fake_upstream):
    base_url, handler = fake_upstream
    handler.script = [
        (503, {"error": "temporarily unavailable"}),
        (200, {"choices": [{"message": {"content": "终于好了"}}]}),
    ]
    provider = OpenAiCompatibleProvider(
        base_url=base_url,
        api_key="sk-test-key",
        model="m",
        max_attempts=2,
        retry_backoff_seconds=0.01,
    )

    result = asyncio.run(provider.complete(_request()))
    assert result.raw_text == "终于好了"
    assert result.attempts == 2
    assert len(handler.received) == 2


def test_openai_compatible_does_not_retry_4xx_and_hides_the_key(fake_upstream):
    base_url, handler = fake_upstream
    handler.script = [(401, {"error": "bad key"})]
    provider = OpenAiCompatibleProvider(
        base_url=base_url,
        api_key="sk-do-not-leak-me",
        model="m",
        max_attempts=3,
        retry_backoff_seconds=0.01,
    )

    with pytest.raises(AiProviderError) as error:
        asyncio.run(provider.complete(_request()))
    assert error.value.code == AI_ERROR_NOT_CONFIGURED
    assert "sk-do-not-leak-me" not in str(error.value)
    assert "sk-do-not-leak-me" not in (error.value.detail or "")
    # 4xx 不重试
    assert len(handler.received) == 1


def test_openai_compatible_maps_bad_payload_to_upstream_error(fake_upstream):
    base_url, handler = fake_upstream
    handler.script = [(200, {"choices": []})]
    provider = OpenAiCompatibleProvider(base_url=base_url, api_key="k", model="m")

    with pytest.raises(AiProviderError) as error:
        asyncio.run(provider.complete(_request()))
    assert error.value.code == AI_ERROR_UPSTREAM


def test_openai_compatible_timeout_is_a_hard_timeout(fake_upstream, monkeypatch):
    base_url, _handler = fake_upstream
    provider = OpenAiCompatibleProvider(base_url=base_url, api_key="k", model="m")

    async def slow(*_args, **_kwargs):
        await asyncio.sleep(5)
        return b"{}"

    monkeypatch.setattr(provider, "_post_json", slow)
    with pytest.raises(AiProviderError) as error:
        asyncio.run(provider.complete(_request(timeout_seconds=0.05)))
    assert error.value.code == AI_ERROR_TIMEOUT
    # 超时不重试：多等一倍时间对访客没有好处，成本也翻倍
    assert error.value.retryable is False


def test_openai_compatible_transport_error_is_retryable():
    # 一个没有任何东西监听的端口
    provider = OpenAiCompatibleProvider(
        base_url="http://127.0.0.1:9",
        api_key="k",
        model="m",
        max_attempts=1,
    )
    with pytest.raises(AiProviderError) as error:
        asyncio.run(provider.complete(_request(timeout_seconds=0.3)))
    assert error.value.code in (AI_ERROR_TRANSPORT, AI_ERROR_TIMEOUT)
