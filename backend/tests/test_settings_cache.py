import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest

from app import settings_store as store


@pytest.fixture(scope="session", autouse=True)
def database():
    """These cache/concurrency tests do not require a live database."""


@pytest.fixture
def settings_db(monkeypatch):
    row = {"trigger_delay_ms": 200, "max_options": 4}
    calls = []

    class Connection:
        async def execute(self, sql, params=None):
            calls.append(sql)
            await asyncio.sleep(0)
            if params:
                row.update(params)
            return self

        async def fetchone(self):
            return dict(row)

    @asynccontextmanager
    async def connection():
        yield Connection()

    monkeypatch.setattr(store, "connection", connection)
    monkeypatch.setattr(store, "_cached", None)
    monkeypatch.setattr(store, "_expires_at", 0)
    monkeypatch.setattr(store, "_lock", asyncio.Lock())
    monkeypatch.setattr(store, "get_settings", lambda: SimpleNamespace(retention_days=30))
    return row, calls


async def test_concurrent_reads_share_refresh_and_return_copies(settings_db):
    _, calls = settings_db
    results = await asyncio.gather(*(store.load_settings() for _ in range(10)))
    assert len(calls) == 1
    results[0].trigger_delay_ms = 999
    assert (await store.load_settings()).trigger_delay_ms == 200


async def test_update_replaces_cache_immediately_without_second_query(settings_db):
    _, calls = settings_db
    await store.load_settings()
    updated = await store.update_settings(store.AppSettingsUpdate(trigger_delay_ms=700))
    assert updated.trigger_delay_ms == 700
    assert (await store.load_settings()).trigger_delay_ms == 700
    assert len(calls) == 2
    assert "RETURNING" in calls[-1]


async def test_expiry_observes_changes_from_other_processes(settings_db, monkeypatch):
    row, calls = settings_db
    await store.load_settings()
    row["trigger_delay_ms"] = 900
    monkeypatch.setattr(store, "_expires_at", 0)
    assert (await store.load_settings()).trigger_delay_ms == 900
    assert len(calls) == 2


async def test_read_refresh_cannot_race_saved_preference(settings_db):
    _, calls = settings_db
    await asyncio.gather(store.load_settings(), store.update_settings(store.AppSettingsUpdate(max_options=2)))
    assert (await store.load_settings()).max_options == 2
    assert len(calls) == 2
