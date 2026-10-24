"""Shared fixtures. Tests run against the real Tiger Data service and Gemini (see .env)."""

from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

from app.db.migrate import run_migrations
from app.db.pool import close_pool, open_pool
from app.main import app


@pytest.fixture(scope="session", autouse=True)
async def database() -> AsyncIterator[None]:
    await open_pool()
    await run_migrations()
    yield
    await close_pool()


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
