"""Read-only live SQL checks of complete-body and oversized-corpus transfer boundaries."""

import time

import pytest

from app.db.pool import connection
from app.pipeline import catalog, retrieve

pytestmark = pytest.mark.live


@pytest.mark.parametrize("bound", [100, catalog.MAX_SOURCE_CHARS])
async def test_catalog_query_preserves_tail_or_rejects_entire_corpus(bound):
    synthetic = """FROM (SELECT gen_random_uuid() AS id, 'skill'::text AS kind,
        'Long synthetic source'::text AS title, 'Synthetic summary'::text AS summary,
        repeat('x', 9000) || 'TAIL_EVIDENCE' AS body) knowledge ORDER BY id"""
    sql = catalog._SQL.replace("FROM knowledge ORDER BY id", synthetic)
    assert sql != catalog._SQL
    async with connection() as conn:
        rows = await (await conn.execute(sql, {"chars": bound, "limit": 257})).fetchall()
    assert len(rows) == 1
    snapshot = catalog.build_snapshot(rows, time.monotonic(), retrieve.cache_generation())
    if bound == 100:
        assert rows[0]["body"] == ""
        assert rows[0]["source_oversized"] is True
        assert snapshot.oversized and not snapshot.documents
    else:
        assert rows[0]["body"].endswith("TAIL_EVIDENCE")
        assert len(rows[0]["body"]) > 8000
        assert not snapshot.oversized
        assert snapshot.documents[0].candidate.body == rows[0]["body"]
