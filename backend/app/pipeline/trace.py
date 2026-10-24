"""enhance_trace persistence (no prompt text, decision D1)."""

from datetime import datetime
from typing import Any, Literal

from psycopg.types.json import Jsonb
from pydantic import BaseModel

from app.db.pool import connection


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
) -> None:
    async with connection() as conn:
        await conn.execute(
            "INSERT INTO enhance_trace (request_id, prompt_revision, result_type, general, tags, knowledge, steps,"
            " features) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
            (
                request_id,
                prompt_revision,
                result_type,
                general,
                Jsonb([t.model_dump() for t in tags]),
                Jsonb([k.model_dump() for k in knowledge]),
                Jsonb([s.model_dump() for s in steps]),
                Jsonb(features),
            ),
        )


_LATEST = (
    "SELECT request_id, created_at, prompt_revision, result_type, general, tags, knowledge, steps, features"
    " FROM enhance_trace WHERE request_id = %s ORDER BY created_at DESC LIMIT 1"
)


async def latest_trace_row(request_id: str) -> dict[str, Any] | None:
    async with connection() as conn:
        return await (await conn.execute(_LATEST, (request_id,))).fetchone()


async def load_trace(request_id: str) -> Trace | None:
    row = await latest_trace_row(request_id)
    return Trace.model_validate(row) if row else None
