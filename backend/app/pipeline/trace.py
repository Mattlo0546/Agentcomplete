"""enhance_trace persistence (no prompt text, decision D1)."""

import asyncio
import logging
from datetime import UTC, datetime
from typing import Any, Literal
from uuid import UUID

from psycopg.types.json import Jsonb
from pydantic import BaseModel

from app.db.pool import connection

log = logging.getLogger(__name__)
_pending: set[asyncio.Task[None]] = set()
_pending_rows: dict[str, dict[str, Any]] = {}


class TraceTag(BaseModel):
    name: str
    similarity: float


class TraceKnowledge(BaseModel):
    id: str
    kind: Literal["skill", "prompt", "graph"]
    title: str
    score: float
    kept: bool


class TraceStep(BaseModel):
    step: Literal["tags", "retrieve", "judge", "generate"]
    model: str
    latency_ms: int
    status: Literal["ok", "error", "skipped"]
    detail: str


class Trace(BaseModel):
    request_id: str
    created_at: datetime
    prompt_revision: int
    result_type: Literal["autocomplete", "multiple_choice", "none"]
    general: bool
    tags: list[TraceTag]
    knowledge: list[TraceKnowledge]
    steps: list[TraceStep]


async def save_trace(
    *,
    request_id: str,
    prompt_revision: int,
    result_type: str,
    general: bool,
    tags: list[TraceTag],
    knowledge: list[TraceKnowledge],
    steps: list[TraceStep],
    features: dict[str, Any],
    used_knowledge: list[UUID] | None = None,
) -> None:
    """Make the trace available immediately, then persist metadata outside the response's critical path."""
    await wait_for_capacity()
    row = {
        "request_id": request_id,
        "created_at": datetime.now(UTC),
        "prompt_revision": prompt_revision,
        "result_type": result_type,
        "general": general,
        "tags": [t.model_dump() for t in tags],
        "knowledge": [k.model_dump() for k in knowledge],
        "steps": [s.model_dump() for s in steps],
        "features": features,
    }
    _pending_rows[request_id] = row
    task = asyncio.create_task(_persist(row, used_knowledge or []))
    _pending.add(task)
    task.add_done_callback(_pending.discard)


async def wait_for_capacity() -> None:
    """Allow callers to wait for backpressure before their final source-freshness check."""
    while len(_pending) >= 256:
        await asyncio.wait(_pending, return_when=asyncio.FIRST_COMPLETED)


async def flush() -> None:
    """Drain trace/use-count writes before shutdown, test assertions, or analytical reads."""
    while _pending:
        await asyncio.gather(*list(_pending))


async def _persist(row: dict[str, Any], used_knowledge: list[UUID]) -> None:
    try:
        await _write(row, used_knowledge)
    except Exception:
        log.exception("failed to persist enhancement trace")
    finally:
        if _pending_rows.get(row["request_id"]) is row:
            _pending_rows.pop(row["request_id"], None)


async def _write(row: dict[str, Any], used_knowledge: list[UUID]) -> None:
    async with connection() as conn:
        await conn.execute(
            "INSERT INTO enhance_trace (request_id, prompt_revision, result_type, general, tags, knowledge, steps,"
            " features) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
            (
                row["request_id"],
                row["prompt_revision"],
                row["result_type"],
                row["general"],
                Jsonb(row["tags"]),
                Jsonb(row["knowledge"]),
                Jsonb(row["steps"]),
                Jsonb(row["features"]),
            ),
        )
        if used_knowledge:
            await conn.execute("UPDATE knowledge SET use_count = use_count + 1 WHERE id = ANY(%s)", (used_knowledge,))


_LATEST = (
    "SELECT request_id, created_at, prompt_revision, result_type, general, tags, knowledge, steps, features"
    " FROM enhance_trace WHERE request_id = %s ORDER BY created_at DESC LIMIT 1"
)


async def latest_trace_row(request_id: str) -> dict[str, Any] | None:
    if row := _pending_rows.get(request_id):
        return row
    async with connection() as conn:
        return await (await conn.execute(_LATEST, (request_id,))).fetchone()


async def load_trace(request_id: str) -> Trace | None:
    row = await latest_trace_row(request_id)
    return Trace.model_validate(row) if row else None
