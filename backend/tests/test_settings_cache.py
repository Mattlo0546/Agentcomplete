import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest

from app import settings_store as store


@pytest.fixture(scope="session", autouse=True)
def database():
    """These cache/concurrency tests do not require a live database."""


@pytest.fixture
async def settings_db(monkeypatch):
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
    monkeypatch.setattr(store, "_refresh_task", None)
    monkeypatch.setattr(store, "get_settings", lambda: SimpleNamespace(retention_days=30))
    yield row, calls
    await store.stop_settings_refresh()


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


async def test_fresh_read_does_not_wait_for_refresh_and_update_wins(settings_db, monkeypatch):
    _, calls = settings_db
    await store.load_settings()
    entered, release = asyncio.Event(), asyncio.Event()
    original_connection = store.connection

    @asynccontextmanager
    async def blocked_connection():
        async with original_connection() as conn:
            entered.set()
            await release.wait()
            yield conn

    monkeypatch.setattr(store, "connection", blocked_connection)
    refresh = asyncio.create_task(store.refresh_settings())
    try:
        await asyncio.wait_for(entered.wait(), 1)
        assert (await asyncio.wait_for(store.load_settings(), 0.1)).trigger_delay_ms == 200
        assert not refresh.done()
        update = asyncio.create_task(store.update_settings(store.AppSettingsUpdate(trigger_delay_ms=700)))
        await asyncio.sleep(0)
        assert not update.done()
    finally:
        release.set()
        await refresh
    assert (await update).trigger_delay_ms == 700
    assert (await store.load_settings()).trigger_delay_ms == 700
    assert len(calls) == 3


async def test_refresh_failure_does_not_extend_expiry_or_serve_stale(settings_db, monkeypatch):
    await store.load_settings()
    expiry = store._expires_at

    @asynccontextmanager
    async def failed_connection():
        raise RuntimeError("private database error")
        yield  # pragma: no cover

    monkeypatch.setattr(store, "connection", failed_connection)
    with pytest.raises(RuntimeError):
        await store.refresh_settings()
    assert store._expires_at == expiry
    assert (await store.load_settings()).trigger_delay_ms == 200
    monkeypatch.setattr(store.time, "monotonic", lambda: expiry)
    with pytest.raises(RuntimeError):
        await store.load_settings()
    assert store._expires_at == expiry


async def test_background_refresh_warms_then_observes_external_update(settings_db, monkeypatch):
    row, calls = settings_db
    refreshed = asyncio.Event()
    original_refresh = store.refresh_settings

    async def observed_refresh():
        result = await original_refresh()
        if len(calls) > 1:
            refreshed.set()
        return result

    monkeypatch.setattr(store, "refresh_settings", observed_refresh)
    monkeypatch.setattr(store, "_REFRESH_INTERVAL_S", 0.001)
    await store.start_settings_refresh()
    assert len(calls) == 1
    task = store._refresh_task
    await store.start_settings_refresh()
    assert store._refresh_task is task
    assert len(calls) == 1
    row["trigger_delay_ms"] = 900
    await asyncio.wait_for(refreshed.wait(), 1)
    await store.stop_settings_refresh()
    reads = len(calls)
    assert (await store.load_settings()).trigger_delay_ms == 900
    assert len(calls) == reads


async def test_worker_failure_preserves_expiry_and_omits_error_payload(settings_db, monkeypatch, caplog):
    await store.start_settings_refresh()
    expiry = store._expires_at
    attempted = asyncio.Event()

    async def failed_refresh():
        attempted.set()
        raise RuntimeError("private database error")

    monkeypatch.setattr(store, "refresh_settings", failed_refresh)
    monkeypatch.setattr(store, "_REFRESH_INTERVAL_S", 0.001)
    await asyncio.wait_for(attempted.wait(), 1)
    await store.stop_settings_refresh()
    assert store._expires_at == expiry
    assert "settings refresh failed (RuntimeError)" in caplog.text
    assert "private database error" not in caplog.text


async def test_stop_cancels_inflight_refresh_before_returning(settings_db, monkeypatch):
    await store.load_settings()
    entered, exited = asyncio.Event(), asyncio.Event()
    original_connection = store.connection
    await store.start_settings_refresh()
    expiry = store._expires_at

    @asynccontextmanager
    async def blocked_connection():
        async with original_connection() as conn:
            entered.set()
            try:
                await asyncio.Event().wait()
                yield conn
            finally:
                exited.set()

    monkeypatch.setattr(store, "connection", blocked_connection)
    monkeypatch.setattr(store, "_REFRESH_INTERVAL_S", 0.001)
    await asyncio.wait_for(entered.wait(), 1)
    task = store._refresh_task
    await asyncio.wait_for(store.stop_settings_refresh(), 1)
    assert exited.is_set()
    assert task is not None and task.cancelled()
    assert store._refresh_task is None
    assert store._expires_at == expiry
    assert not store._lock.locked()
    await store.stop_settings_refresh()
