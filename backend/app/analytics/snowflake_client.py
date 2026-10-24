"""Blocking Snowflake helpers; async callers wrap them in `asyncio.to_thread`."""

from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from typing import Any

import snowflake.connector
from snowflake.connector import SnowflakeConnection

from app.config import get_settings
from app.errors import UpstreamError

DATABASE = "PROMPT_ENHANCE"
SCHEMA = "ANALYTICS"
EVENTS_TABLE = f"{DATABASE}.{SCHEMA}.OUTCOME_EVENTS"
TRAINING_VIEW = f"{DATABASE}.{SCHEMA}.OUTCOME_TRAINING"
MODEL_NAME = f"{DATABASE}.{SCHEMA}.PROMPT_ENHANCE_OUTCOME"


@contextmanager
def snowflake_connection() -> Iterator[SnowflakeConnection]:
    """Connect via ~/.snowflake/config.toml; the OAuth token is cached in the OS keychain."""
    try:
        conn = snowflake.connector.connect(
            connection_name=get_settings().snowflake_connection_name,
            client_store_temporary_credential=True,
            login_timeout=30,
        )
    except Exception as exc:
        raise UpstreamError("snowflake_unavailable", "Snowflake connection failed") from exc
    try:
        yield conn
    finally:
        conn.close()


def run(conn: SnowflakeConnection, sql: str, params: Sequence[Any] | None = None) -> list[tuple[Any, ...]]:
    cursor = conn.cursor()
    try:
        cursor.execute(sql, params)
        return list(cursor.fetchall()) if cursor.description else []
    finally:
        cursor.close()
