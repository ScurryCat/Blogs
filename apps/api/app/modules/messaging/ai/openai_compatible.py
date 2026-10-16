"""OpenAI 兼容端点的真实适配层（**默认不启用**）。

任务卡明确：模型供应商、凭证、日预算尚未指定；不得擅自采购、搜索用户密钥或启用
收费调用。因此：

  - 本文件在仓库里是**候选实现**，默认「配置不全就拒绝启动」，
    既不会自己去读环境里别的密钥，也没有任何默认端点；
  - 真正接哪个供应商、花多少钱，由协调者配置 `MESSAGING_AI_*` 后验收；
  - `wiring.py` 只登记 provider 解析函数，不发任何网络请求。

为什么用标准库 `urllib.request` 而不是 `httpx`：`httpx` 目前只是 `apps/api` 的
dev 依赖（给 FastAPI 的 TestClient 用）。生产代码依赖 dev 依赖会让
`uv sync --no-dev` 的部署直接崩掉。阻塞调用放在 anyio 工作线程里并有硬超时，
语义与异步客户端一致；若 T00 愿意把 `httpx` 提升为运行时依赖，替换 `_post_json`
即可，其余代码不动。

安全：
  - API key 只出现在 `Authorization` 头里，**不**进日志、不进异常 message、
    不进任何响应；
  - 上游返回的任何 HTML / URL 都会在 `output.py` 被清洗；
  - 超时是硬超时（`urlopen(timeout=)`），重试只发生在 `RETRYABLE_CODES` 上。
"""

from __future__ import annotations

import asyncio
import json
import urllib.error
import urllib.request

import anyio.to_thread

from app.modules.messaging.ai.base import (
    AI_ERROR_NOT_CONFIGURED,
    AI_ERROR_TIMEOUT,
    AI_ERROR_TRANSPORT,
    AI_ERROR_UPSTREAM,
    AiCompletionRequest,
    AiCompletionResult,
    AiProviderError,
)
from app.modules.messaging.ai.prompts import build_history, build_system_prompt

PROVIDER_NAME = "openai_compatible"

# 上游返回体只用来取模型文本；超过这个长度就没必要再读（防上游返回巨大错误页）。
MAX_RESPONSE_BYTES = 256 * 1024

# 输出上限：按码点估算成 token 上限，宁可少也不要让上游长篇大论（08 §7）。
CODEPOINTS_PER_TOKEN_ESTIMATE = 2


class OpenAiCompatibleProvider:
    """把对话发到 `{base_url}/chat/completions`，取 `choices[0].message.content`。"""

    name = PROVIDER_NAME

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        max_attempts: int = 2,
        retry_backoff_seconds: float = 0.25,
        proxy_url: str = "",
        extra_headers: dict[str, str] | None = None,
    ) -> None:
        base = (base_url or "").strip().rstrip("/")
        key = (api_key or "").strip()
        name = (model or "").strip()
        missing = [
            label
            for label, value in (
                ("MESSAGING_AI_BASE_URL", base),
                ("MESSAGING_AI_API_KEY", key),
                ("MESSAGING_AI_MODEL", name),
            )
            if not value
        ]
        if missing:
            # 抛的是配置错误而不是网络错误：不会被当成「上游抖动」去重试。
            raise AiProviderError(
                AI_ERROR_NOT_CONFIGURED,
                f"真实模型未配置完整：缺少 {', '.join(missing)}",
            )
        if not base.startswith(("https://", "http://")):
            raise AiProviderError(
                AI_ERROR_NOT_CONFIGURED,
                "MESSAGING_AI_BASE_URL 必须是 http(s) 地址",
            )
        self.base_url = base
        # 私有字段：不提供任何 getter，避免它被顺手写进日志或响应。
        self._api_key = key
        self.model = name
        self.max_attempts = max(1, min(int(max_attempts), 3))
        self.retry_backoff_seconds = max(0.0, float(retry_backoff_seconds))
        self.proxy_url = (proxy_url or "").strip()
        self._extra_headers = dict(extra_headers or {})
        self._opener: urllib.request.OpenerDirector | None = None

    def _build_opener(self) -> urllib.request.OpenerDirector:
        """**不读系统代理设置**，只用显式配置的代理（默认无代理）。

        这是踩过的坑：macOS 上 `urllib` 会去读系统代理自动配置
        （`getproxies()` → `_scproxy`），对本机 127.0.0.1 的请求也会被拖住甚至返回 502
        （T03 交付单 §5.3 末尾记录过同一现象，当时被迫改用 `http.client`）。
        服务端到模型端点的调用不该被开发机的系统设置影响，因此这里显式关闭：
        需要代理的部署通过 `MESSAGING_AI_PROXY_URL` 指定。
        """
        handler = (
            urllib.request.ProxyHandler({"http": self.proxy_url, "https": self.proxy_url})
            if self.proxy_url
            else urllib.request.ProxyHandler({})
        )
        return urllib.request.build_opener(handler)

    # --- 请求体 -----------------------------------------------------------

    def build_payload(self, request: AiCompletionRequest) -> dict[str, object]:
        messages: list[dict[str, str]] = [
            {"role": "system", "content": build_system_prompt(request)}
        ]
        for turn in build_history(request):
            messages.append({"role": turn.role, "content": turn.text})
        messages.append({"role": "user", "content": request.user_text})
        max_tokens = max(32, request.max_output_codepoints // CODEPOINTS_PER_TOKEN_ESTIMATE)
        return {
            "model": self.model,
            "messages": messages,
            "max_tokens": min(max_tokens, 1024),
            "temperature": 0.8,
            "stream": False,
        }

    # --- 调用 -------------------------------------------------------------

    async def complete(self, request: AiCompletionRequest) -> AiCompletionResult:
        payload = self.build_payload(request)
        last_error: AiProviderError | None = None

        for attempt in range(1, self.max_attempts + 1):
            try:
                raw = await asyncio.wait_for(
                    self._post_json(payload, timeout=request.timeout_seconds),
                    timeout=request.timeout_seconds,
                )
            except asyncio.TimeoutError:
                # 超时不重试：再来一次只会让访客多等一倍，成本也翻倍（08 §7）。
                raise AiProviderError(
                    AI_ERROR_TIMEOUT,
                    "模型响应超时",
                    detail=f"timeout={request.timeout_seconds}s attempt={attempt}",
                ) from None
            except AiProviderError as error:
                last_error = error
                if not error.retryable or attempt >= self.max_attempts:
                    raise
                await asyncio.sleep(self.retry_backoff_seconds * attempt)
                continue

            text = self._extract_text(raw)
            return AiCompletionResult(
                raw_text=text,
                provider=self.name,
                model=self.model,
                attempts=attempt,
            )

        assert last_error is not None  # pragma: no cover - 循环必然 raise 或 return
        raise last_error

    async def _post_json(self, payload: dict[str, object], *, timeout: float) -> bytes:
        """在工作线程里发一次阻塞请求。异常在这里归一成 `AiProviderError`。"""
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        url = f"{self.base_url}/chat/completions"
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": f"Bearer {self._api_key}",
            **self._extra_headers,
        }
        if self._opener is None:
            self._opener = self._build_opener()
        opener = self._opener
        return await anyio.to_thread.run_sync(
            lambda: _urlopen_json(opener, url, body, headers, timeout)
        )

    @staticmethod
    def _extract_text(raw: bytes) -> str:
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise AiProviderError(
                AI_ERROR_UPSTREAM, "上游返回了无法解析的响应", detail=str(error)
            ) from None
        try:
            content = payload["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError):
            raise AiProviderError(
                AI_ERROR_UPSTREAM,
                "上游响应里没有可用的文本",
                detail=f"keys={sorted(payload)[:8] if isinstance(payload, dict) else type(payload)}",
            ) from None
        if not isinstance(content, str):
            raise AiProviderError(AI_ERROR_UPSTREAM, "上游返回的文本类型不正确")
        return content


def _urlopen_json(
    opener: urllib.request.OpenerDirector,
    url: str,
    body: bytes,
    headers: dict[str, str],
    timeout: float,
) -> bytes:
    """标准库的一次 POST。`detail` 里**不含**请求体、也不含 API key。"""
    request = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with opener.open(request, timeout=timeout) as response:  # noqa: S310 - 地址来自服务端配置
            return response.read(MAX_RESPONSE_BYTES)
    except urllib.error.HTTPError as error:
        # 4xx 里只有 408 / 429 值得重试；其余是配置或请求本身的问题。
        retryable = error.code in (408, 429) or error.code >= 500
        raise AiProviderError(
            AI_ERROR_UPSTREAM if retryable else AI_ERROR_NOT_CONFIGURED,
            f"上游返回 HTTP {error.code}",
            detail=f"status={error.code}",
        ) from None
    except urllib.error.URLError as error:
        reason = str(getattr(error, "reason", error))
        if "timed out" in reason.lower():
            raise AiProviderError(AI_ERROR_TIMEOUT, "连接上游超时", detail=reason) from None
        raise AiProviderError(AI_ERROR_TRANSPORT, "无法连接上游服务", detail=reason) from None
    except TimeoutError:
        raise AiProviderError(AI_ERROR_TIMEOUT, "连接上游超时") from None


__all__ = ["PROVIDER_NAME", "OpenAiCompatibleProvider"]
