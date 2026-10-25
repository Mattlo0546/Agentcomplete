from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from pgvector.psycopg import register_vector_async
from psycopg import AsyncConnection
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from app.config import get_settings

_pool: AsyncConnectionPool | None = None


async def _configure(conn: AsyncConnection) -> None:
    await register_vector_async(conn)


async def open_pool() -> AsyncConnectionPool:
    global _pool
    if _pool is None:
        database_url = get_settings().database_url
        # A fresh database has no vector type until migration 001 runs, but
        # pool configuration registers that type before migrations can borrow a
        # connection. Bootstrap the extension using a plain connection first.
        async with await AsyncConnection.connect(database_url, autocommit=True) as bootstrap:
            await bootstrap.execute("CREATE EXTENSION IF NOT EXISTS vector")
        candidate = AsyncConnectionPool(
            database_url,
            min_size=1,
            max_size=10,
            open=False,
            configure=_configure,
            kwargs={"row_factory": dict_row, "autocommit": True},
        )
        try:
            await candidate.open(wait=True, timeout=30)
        except Exception:
            await candidate.close()
            raise
        _pool = candidate
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def get_pool() -> AsyncConnectionPool:
    if _pool is None:
        raise RuntimeError("database pool is not open")
    return _pool


@asynccontextmanager
async def connection() -> AsyncIterator[AsyncConnection[dict[str, Any]]]:
    """Borrow an autocommit connection whose rows are dicts. Use `conn.transaction()` for multi-statement writes."""
    async with get_pool().connection() as conn:
        yield conn  # type: ignore[misc]
