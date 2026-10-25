"""Opt-in production SQL/migration check against the task-owned local PostgreSQL DB.

Set PROMPT_HISTORY_TEST_DATABASE_URL to the loopback prompt_history_test database.
The default offline suite skips this test. A unique temporary schema is removed
after the check; no model call or external service is used.
"""

import os
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import psycopg
import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo

from app.api import prompt_history
from app.db import migrate, pool
from app.errors import install_error_handlers

TEST_DATABASE_URL = os.environ.get("PROMPT_HISTORY_TEST_DATABASE_URL")


@pytest.mark.skipif(not TEST_DATABASE_URL, reason="opt-in task-owned local PostgreSQL test")
async def test_history_production_sql_and_migration(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    assert TEST_DATABASE_URL is not None
    destination = conninfo_to_dict(TEST_DATABASE_URL)
    # Never let an accidentally inherited URL turn this into an external DB test.
    assert destination.get("host") in {"127.0.0.1", "localhost", "::1"}
    assert destination.get("dbname") == "prompt_history_test"
    schema = f"history_qa_{uuid4().hex}"

    async with await psycopg.AsyncConnection.connect(TEST_DATABASE_URL, autocommit=True) as bootstrap:
        await bootstrap.execute("CREATE EXTENSION IF NOT EXISTS vector")
        await bootstrap.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
        try:
            local_url = make_conninfo(TEST_DATABASE_URL, options=f"-c search_path={schema},public")
            monkeypatch.setattr(pool, "get_settings", lambda: SimpleNamespace(database_url=local_url))
            # This image has pgvector but no TimescaleDB used by legacy migration 001.
            # Exercise the real migration runner on the new history migration alone.
            migration = migrate.MIGRATIONS_DIR / "002_prompt_history.sql"
            (tmp_path / migration.name).write_text(migration.read_text())
            monkeypatch.setattr(migrate, "MIGRATIONS_DIR", tmp_path)
            await pool.open_pool()
            assert await migrate.run_migrations() == [migration.name]
            assert await migrate.run_migrations() == []

            app = FastAPI()
            install_error_handlers(app)
            app.include_router(prompt_history.router, prefix="/v1")
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                draft = "Review O'Reilly's migration 😀 日本語; DROP TABLE prompt_history;"
                suffix = " Verify rollback safety."
                response = await client.post(
                    "/v1/prompt-history",
                    json={
                        "prompt": draft,
                        "suggestion_text": suffix,
                        "title": "  Migration review  ",
                        "description": "  Before accepting the suggestion  ",
                    },
                )
                assert response.status_code == 201
                first = response.json()
                assert first["saved_text"] == draft + suffix
                assert first["prompt"] == draft and first["suggestion_text"] == suffix
                assert first["title"] == "Migration review"
                assert first["description"] == "Before accepting the suggestion"
                assert first["created_at"] == first["updated_at"]

                second_response = await client.post("/v1/prompt-history", json={"prompt": "Second snapshot 😀"})
                assert second_response.status_code == 201
                second = second_response.json()
                assert second["saved_text"] == "Second snapshot 😀"
                assert second["suggestion_text"] is None
                assert (await client.get("/v1/prompt-history?limit=1")).json() == {"items": [second], "total": 2}
                assert (await client.get("/v1/prompt-history?limit=1&offset=1")).json() == {
                    "items": [first],
                    "total": 2,
                }
                assert (await client.get("/v1/prompt-history?offset=20")).json() == {"items": [], "total": 2}

                path = f"/v1/prompt-history/{first['id']}"
                patched_response = await client.patch(path, json={"title": "Reviewed", "description": None})
                assert patched_response.status_code == 200
                patched = patched_response.json()
                assert patched["saved_text"] == draft + suffix
                assert patched["created_at"] == first["created_at"]
                assert patched["updated_at"] > first["updated_at"]
                assert patched["title"] == "Reviewed" and patched["description"] is None
                assert (await client.get(path)).json() == patched
                assert (await client.patch(path, json={"prompt": "Overwrite"})).status_code == 422

                # Assert UUID tie-breaking against real PostgreSQL ordering.
                async with pool.connection() as connection:
                    await connection.execute("UPDATE prompt_history SET created_at = %s", (first["created_at"],))
                    indexes = await (
                        await connection.execute(
                            "SELECT indexdef FROM pg_indexes WHERE schemaname = %s AND tablename = 'prompt_history'",
                            (schema,),
                        )
                    ).fetchall()
                assert any("created_at DESC, id DESC" in index["indexdef"] for index in indexes)
                tied = (await client.get("/v1/prompt-history")).json()
                assert [item["id"] for item in tied["items"]] == sorted([first["id"], second["id"]], reverse=True)

                assert (await client.delete(path)).status_code == 204
                assert (await client.get(path)).status_code == 404
                assert (await client.delete(path)).status_code == 404
                assert (await client.delete(f"/v1/prompt-history/{second['id']}")).status_code == 204
                assert (await client.get("/v1/prompt-history")).json() == {"items": [], "total": 0}
        finally:
            await pool.close_pool()
            await bootstrap.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))
