"""Metadata-only log writers (decision D1: no prompts, knowledge bodies or model responses).

Writes are scheduled in the background so logging never adds a database round trip to a request.
"""

import asyncio
import logging
from collections.abc import Coroutine
from datetime import UTC, datetime
from typing import Any

from app.db.pool import connection

log = logging.getLogger(__name__)
_pending: set[asyncio.Task[None]] = set()


async def record_api_call(
    request_id: str, method: str, path: str, status: int, latency_ms: int, error: str | None
) -> None:
    _schedule(
        "INSERT INTO api_call_log (time, request_id, method, path, status, latency_ms, error)"
        " VALUES (%s, %s, %s, %s, %s, %s, %s)",
        (datetime.now(UTC), request_id, method, path, status, latency_ms, error),
    )


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
    _schedule(
        "INSERT INTO ai_call_log (time, request_id, operation, model, status, latency_ms,"
        " input_tokens, output_tokens, error) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (datetime.now(UTC), request_id, operation, model, status, latency_ms, input_tokens, output_tokens, error),
    )


async def flush() -> None:
    """Wait for scheduled writes (used on shutdown and in tests)."""
    while _pending:
        await asyncio.gather(*list(_pending))


def _schedule(sql: str, params: tuple[Any, ...]) -> None:
    task = asyncio.create_task(_write(sql, params))
    _pending.add(task)
    task.add_done_callback(_pending.discard)


def _write(sql: str, params: tuple[Any, ...]) -> Coroutine[Any, Any, None]:
    async def run() -> None:
        try:
            async with connection() as conn:
                await conn.execute(sql, params)  # type: ignore[arg-type]
        except Exception:  # logging must never break a request
            log.exception("failed to write call log")

    return run()
