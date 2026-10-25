"""Gemini access with structured outputs and per-call metadata logging."""

import asyncio
import time
from functools import lru_cache

from google import genai
from google.genai import types
from pydantic import BaseModel, ValidationError

from app.config import get_settings
from app.errors import UpstreamError
from app.observability.context import get_request_id
from app.observability.sanitize import sanitize_error
from app.observability.writers import record_ai_call


@lru_cache
def _client() -> genai.Client:
    return genai.Client(api_key=get_settings().gemini_api_key)


async def generate_structured[T: BaseModel](
    *,
    operation: str,
    model: str,
    system: str,
    contents: str,
    schema: type[T],
    temperature: float = 0.2,
    thinking_level: str | None = None,
    max_output_tokens: int | None = None,
) -> T:
    """Run one structured-output call and parse it into `schema`. Raises UpstreamError on any failure."""
    settings = get_settings()
    config = types.GenerateContentConfig(
        system_instruction=system,
        response_mime_type="application/json",
        response_schema=schema,
        temperature=temperature,
        max_output_tokens=max_output_tokens,
        thinking_config=types.ThinkingConfig(thinking_level=thinking_level) if thinking_level else None,  # type: ignore[arg-type]
    )
    started = time.perf_counter()
    usage: types.GenerateContentResponseUsageMetadata | None = None
    try:
        response = await asyncio.wait_for(
            _client().aio.models.generate_content(model=model, contents=contents, config=config),
            timeout=settings.llm_timeout_s,
        )
        usage = response.usage_metadata
        parsed = (
            response.parsed if isinstance(response.parsed, schema) else schema.model_validate_json(response.text or "")
        )
    except asyncio.CancelledError:
        await _log(operation, model, started, usage, "cancelled")
        raise
    except TimeoutError as exc:
        await _log(operation, model, started, usage, f"timeout after {settings.llm_timeout_s:.0f}s")
        raise UpstreamError("upstream_timeout", f"{operation} timed out") from exc
    except (ValidationError, ValueError) as exc:
        await _log(operation, model, started, usage, sanitize_error(exc))
        raise UpstreamError("upstream_invalid", f"{operation} returned invalid output") from exc
    except Exception as exc:
        await _log(operation, model, started, usage, sanitize_error(exc))
        raise UpstreamError("upstream_error", f"{operation} failed") from exc
    await _log(operation, model, started, usage, None)
    return parsed


async def embed(texts: list[str], *, operation: str = "embed") -> list[list[float]]:
    """Embed texts with the configured embedding model at the configured dimensionality."""
    settings = get_settings()
    started = time.perf_counter()
    try:
        response = await asyncio.wait_for(
            _client().aio.models.embed_content(
                model=settings.embed_model,
                contents=texts,
                config=types.EmbedContentConfig(
                    output_dimensionality=settings.embed_dims, task_type="SEMANTIC_SIMILARITY"
                ),
            ),
            timeout=settings.llm_timeout_s,
        )
        vectors = [list(e.values or []) for e in response.embeddings or []]
        if len(vectors) != len(texts):
            raise ValueError("embedding count mismatch")
    except asyncio.CancelledError:
        await record_ai_call(
            get_request_id(), operation, settings.embed_model, "error", _ms(started), None, None, "cancelled"
        )
        raise
    except Exception as exc:
        await record_ai_call(
            get_request_id(), operation, settings.embed_model, "error", _ms(started), None, None, sanitize_error(exc)
        )
        code = "upstream_timeout" if isinstance(exc, TimeoutError) else "upstream_error"
        raise UpstreamError(code, f"{operation} failed") from exc
    await record_ai_call(get_request_id(), operation, settings.embed_model, "ok", _ms(started), None, None, None)
    return vectors


async def ping() -> bool:
    try:
        await asyncio.wait_for(_client().aio.models.get(model=get_settings().tag_model), timeout=5)
        return True
    except Exception:
        return False


def _ms(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)


async def _log(
    operation: str,
    model: str,
    started: float,
    usage: types.GenerateContentResponseUsageMetadata | None,
    error: str | None,
) -> None:
    await record_ai_call(
        get_request_id(),
        operation,
        model,
        "error" if error else "ok",
        _ms(started),
        usage.prompt_token_count if usage else None,
        usage.candidates_token_count if usage else None,
        error,
    )
