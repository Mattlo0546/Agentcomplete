from typing import Literal

from fastapi import APIRouter, Response
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from app.db.pool import connection
from app.errors import NotFoundError
from app.pipeline.trace import latest_trace_row

router = APIRouter()


class OutcomeIn(BaseModel):
    request_id: str = Field(min_length=1, max_length=64)
    prompt_revision: int = Field(ge=0)
    event: Literal["shown", "accepted", "declined", "dismissed", "superseded"]
    option_id: str | None = Field(None, max_length=40)
    time_to_action_ms: int | None = Field(None, ge=0)


@router.post("/outcomes", status_code=204)
async def record_outcome(body: OutcomeIn) -> Response:
    trace = await latest_trace_row(body.request_id)
    if trace is None:
        raise NotFoundError("trace_not_found", "No trace for this request id")
    async with connection() as conn:
        await conn.execute(
            "INSERT INTO outcome_event (request_id, prompt_revision, event, option_id, time_to_action_ms, features)"
            " VALUES (%s, %s, %s, %s, %s, %s)",
            (
                body.request_id,
                body.prompt_revision,
                body.event,
                body.option_id,
                body.time_to_action_ms,
                Jsonb(trace["features"]),
            ),
        )
    return Response(status_code=204)
