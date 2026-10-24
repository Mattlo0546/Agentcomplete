import asyncio
from typing import Any

from app.analytics.schema import COLUMN_NAMES, create_table_sql, flatten
from app.analytics.snowflake_client import EVENTS_TABLE, run, snowflake_connection
from app.db.pool import connection

_PENDING = (
    "SELECT time, request_id, event, time_to_action_ms, features FROM outcome_event"
    " WHERE exported_at IS NULL ORDER BY time LIMIT 5000"
)
_MARK = (
    "UPDATE outcome_event o SET exported_at = now() FROM"
    " unnest(%s::timestamptz[], %s::text[], %s::text[]) AS k(t, r, e)"
    " WHERE o.exported_at IS NULL AND o.time = k.t AND o.request_id = k.r AND o.event = k.e"
)
_INSERT = f"INSERT INTO {EVENTS_TABLE} ({', '.join(COLUMN_NAMES)}) VALUES ({', '.join(['%s'] * len(COLUMN_NAMES))})"


def _load(rows: list[tuple[Any, ...]]) -> None:
    with snowflake_connection() as conn:
        run(conn, create_table_sql(EVENTS_TABLE))
        if rows:
            cursor = conn.cursor()
            try:
                cursor.executemany(_INSERT, rows)
            finally:
                cursor.close()


async def export_outcomes() -> int:
    """Copy not-yet-exported outcome events to Snowflake, then mark them exported."""
    async with connection() as conn:
        pending = await (await conn.execute(_PENDING)).fetchall()
    await asyncio.to_thread(_load, [flatten(row) for row in pending])
    async with connection() as conn, conn.transaction():
        if pending:
            keys = ([r["time"] for r in pending], [r["request_id"] for r in pending], [r["event"] for r in pending])
            await conn.execute(_MARK, keys)  # type: ignore[arg-type]
        await conn.execute(
            "UPDATE analytics_state SET last_export_at = now(), last_export_count = %s WHERE id = 1", (len(pending),)
        )
    return len(pending)
