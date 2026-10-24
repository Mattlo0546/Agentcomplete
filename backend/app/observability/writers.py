"""Metadata-only log writers (decision D1: no prompts, knowledge bodies or model responses)."""

import logging

from app.db.pool import connection

log = logging.getLogger(__name__)


async def record_api_call(
    request_id: str, method: str, path: str, status: int, latency_ms: int, error: str | None
) -> None:
    try:
        async with connection() as conn:
            await conn.execute(
                "INSERT INTO api_call_log (request_id, method, path, status, latency_ms, error)"
                " VALUES (%s, %s, %s, %s, %s, %s)",
                (request_id, method, path, status, latency_ms, error),
            )
    except Exception:  # logging must never break a request
        log.exception("failed to record api call")


async def record_ai_call(
    request_id: str,
    operation: str,
    model: str,
    status: str,
    latency_ms: int,
    input_tokens: int | None,
    output_tokens: int | None,
    error: str | None,
) -> None:
    try:
        async with connection() as conn:
            await conn.execute(
                "INSERT INTO ai_call_log (request_id, operation, model, status, latency_ms,"
                " input_tokens, output_tokens, error) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                (request_id, operation, model, status, latency_ms, input_tokens, output_tokens, error),
            )
    except Exception:
        log.exception("failed to record ai call")
