from collections import defaultdict
from datetime import datetime
from typing import Any

from app.activity.models import AiLog, ApiLog, LogDetail, Outcome
from app.db.pool import connection
from app.errors import NotFoundError

_API_STATUS = {"2xx": "status BETWEEN 200 AND 299", "4xx": "status BETWEEN 400 AND 499", "5xx": "status >= 500"}
_AI_STATUS = {"2xx": "status = 'ok'", "4xx": "status = 'error'", "5xx": "status = 'error'"}
_AI_COLUMNS = "time, request_id, operation, model, status, latency_ms, input_tokens, output_tokens, error"
_API_COLUMNS = "time, request_id, method, path, status, latency_ms, error"


def _filters(
    status: str, request_id: str | None, before: datetime | None, statuses: dict[str, str]
) -> tuple[str, dict[str, Any]]:
    clauses, params = [], {}
    if status in statuses:
        clauses.append(statuses[status])
    if request_id:
        clauses.append("strpos(request_id, %(rid)s) > 0")
        params["rid"] = request_id
    if before:
        clauses.append("time < %(before)s")
        params["before"] = before
    return (" WHERE " + " AND ".join(clauses)) if clauses else "", params


async def list_logs(kind: str, status: str, request_id: str | None, before: datetime | None, limit: int) -> list[Any]:
    async with connection() as conn:
        if kind == "ai":
            where, params = _filters(status, request_id, before, _AI_STATUS)
            sql = f"SELECT {_AI_COLUMNS} FROM ai_call_log{where} ORDER BY time DESC LIMIT %(limit)s"
            rows = await (await conn.execute(sql, {**params, "limit": limit})).fetchall()  # type: ignore[arg-type]
            return [AiLog(**row) for row in rows]
        where, params = _filters(status, request_id, before, _API_STATUS)
        sql = f"SELECT {_API_COLUMNS} FROM api_call_log{where} ORDER BY time DESC LIMIT %(limit)s"
        api_rows = await (await conn.execute(sql, {**params, "limit": limit})).fetchall()  # type: ignore[arg-type]
        children: dict[str, list[AiLog]] = defaultdict(list)
        if api_rows:
            ids = list({row["request_id"] for row in api_rows})
            ai_sql = f"SELECT {_AI_COLUMNS} FROM ai_call_log WHERE request_id = ANY(%s) ORDER BY time"
            for row in await (await conn.execute(ai_sql, (ids,))).fetchall():  # type: ignore[arg-type]
                children[row["request_id"]].append(AiLog(**row))
    return [ApiLog(**row, children=children[row["request_id"]]) for row in api_rows]


async def log_detail(request_id: str) -> LogDetail:
    async with connection() as conn:
        api = await (
            await conn.execute(
                f"SELECT {_API_COLUMNS} FROM api_call_log WHERE request_id = %s ORDER BY time DESC LIMIT 1",
                (request_id,),
            )
        ).fetchone()
        if api is None:
            raise NotFoundError("not_found", "Log entry not found")
        ai = await (
            await conn.execute(
                f"SELECT {_AI_COLUMNS} FROM ai_call_log WHERE request_id = %s ORDER BY time", (request_id,)
            )
        ).fetchall()
        trace = await (
            await conn.execute(
                "SELECT request_id, created_at, prompt_revision, result_type, general, tags, knowledge, steps"
                " FROM enhance_trace WHERE request_id = %s ORDER BY created_at DESC LIMIT 1",
                (request_id,),
            )
        ).fetchone()
        outcome = await (
            await conn.execute(
                "SELECT event, time_to_action_ms FROM outcome_event WHERE request_id = %s ORDER BY time DESC LIMIT 1",
                (request_id,),
            )
        ).fetchone()
    ai_logs = [AiLog(**row) for row in ai]
    return LogDetail(
        api=ApiLog(**api, children=ai_logs),
        ai=ai_logs,
        trace={**trace, "created_at": trace["created_at"].isoformat()} if trace else None,
        outcome=Outcome(**outcome) if outcome else None,
    )


async def clear_logs() -> None:
    from app.observability.writers import flush as flush_calls
    from app.pipeline.trace import flush as flush_traces

    await flush_traces()
    await flush_calls()
    async with connection() as conn, conn.transaction():
        for table in ("api_call_log", "ai_call_log", "enhance_trace"):
            await conn.execute(f"DELETE FROM {table}")  # type: ignore[arg-type]
