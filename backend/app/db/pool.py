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
        _pool = AsyncConnectionPool(
            get_settings().database_url,
            min_size=1,
            max_size=10,
            open=False,
            configure=_configure,
            kwargs={"row_factory": dict_row, "autocommit": True},
        )
        await _pool.open(wait=True, timeout=30)
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
