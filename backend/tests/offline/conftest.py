"""This suite has no credentials, external database, or model dependency.

The optional PostgreSQL test uses only an explicitly configured local test DB.

Run with ``uv run pytest --confcutdir=tests/offline tests/offline`` to bypass the
legacy live-service fixtures in tests/conftest.py.
"""

from collections.abc import AsyncIterator

import pytest


@pytest.fixture(scope="session", autouse=True)
async def database() -> AsyncIterator[None]:
    # Override the live-service fixture when the full suite includes these tests.
    yield
