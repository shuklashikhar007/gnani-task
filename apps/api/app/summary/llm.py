"""Client for any OpenAI-compatible Chat Completions API. The only module that talks to the LLM.

Point LLM_BASE_URL at OpenAI, Gemini, Anthropic, Groq, OpenRouter, a local Ollama, etc.
"""

from functools import cache
from urllib.parse import urlparse

import openai

from app.config import settings


class LLMError(Exception):
    """A failed LLM call. `retryable` is True for rate limits, timeouts, connection and server errors."""

    def __init__(self, message: str, retryable: bool):
        super().__init__(message)
        self.message = message
        self.retryable = retryable


def is_configured() -> bool:
    if not settings.llm_model:
        return False
    host = urlparse(settings.llm_base_url).hostname or ""
    # Local servers (e.g. Ollama) don't need a key.
    return bool(settings.llm_api_key) or host in ("localhost", "127.0.0.1", "host.docker.internal")


@cache
def _client() -> openai.OpenAI:
    return openai.OpenAI(
        base_url=settings.llm_base_url,
        api_key=settings.llm_api_key or "not-needed",
        timeout=settings.llm_timeout_seconds,
        max_retries=0,  # the pipeline retries with backoff
    )


def chat(messages: list[dict[str, str]], *, json_mode: bool = False) -> str:
    """Send a chat request and return the reply text."""
    kwargs = {"response_format": {"type": "json_object"}} if json_mode and settings.llm_json_mode else {}
    try:
        res = _client().chat.completions.create(
            model=settings.llm_model, messages=messages, temperature=0.2, **kwargs
        )
    except (openai.RateLimitError, openai.APITimeoutError, openai.APIConnectionError, openai.InternalServerError) as exc:
        raise LLMError(f"{type(exc).__name__}: {exc}", retryable=True) from exc
    except openai.APIStatusError as exc:
        # 400 (bad request / context too long), 401/403 (key), 404 (model), 422…: retrying won't help.
        retryable = exc.status_code >= 500
        raise LLMError(f"{exc.status_code} {type(exc).__name__}: {_short(exc)}", retryable=retryable) from exc
    except openai.OpenAIError as exc:
        raise LLMError(f"{type(exc).__name__}: {exc}", retryable=False) from exc

    if not getattr(res, "choices", None):
        # Not a chat completion at all. Some servers (e.g. AWS Bedrock without /openai/v1 in the URL) answer
        # 200 with their own error body; retrying won't help.
        raise LLMError(
            "The LLM endpoint didn't return a chat completion. Check LLM_BASE_URL: it usually ends in /v1 "
            "(Bedrock: /openai/v1).",
            retryable=False,
        )
    message = res.choices[0].message
    content = message.content if message else None
    if not content:
        raise LLMError("The model returned an empty reply", retryable=True)
    return content


def _short(exc: openai.APIStatusError) -> str:
    body = exc.body if isinstance(exc.body, dict) else {}
    error = body.get("error") if isinstance(body.get("error"), dict) else body
    return str(error.get("message") or exc.message)[:200]
