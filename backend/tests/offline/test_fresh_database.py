"""Opt-in full startup against a newly created local database, without model calls."""

import os
from uuid import uuid4

import psycopg
import pytest
from httpx import ASGITransport, AsyncClient
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo

DATABASE_URL = os.environ.get("PROMPT_ENHANCE_TEST_DATABASE_URL")


@pytest.mark.skipif(not DATABASE_URL, reason="requires an explicitly configured local installation database")
async def test_full_startup_on_a_fresh_database(monkeypatch: pytest.MonkeyPatch) -> None:
    assert DATABASE_URL is not None
    destination = conninfo_to_dict(DATABASE_URL)
    assert destination.get("host") in {"127.0.0.1", "localhost", "::1"}
    assert destination.get("dbname") == "prompt_enhance"
    database = f"pe_bootstrap_{uuid4().hex}"
    async with await psycopg.AsyncConnection.connect(DATABASE_URL, autocommit=True) as admin:
        await admin.execute(sql.SQL("CREATE DATABASE {} TEMPLATE template0").format(sql.Identifier(database)))
        try:
            monkeypatch.setenv("DATABASE_URL", make_conninfo(DATABASE_URL, dbname=database))
            monkeypatch.setenv("GEMINI_API_KEY", "")
            from app.config import get_settings

            get_settings.cache_clear()
            from app.main import create_app

            app = create_app()
            async with (
                app.router.lifespan_context(app),
                AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
            ):
                assert (await client.get("/v1/health")).json()["db"] == "ok"
                saved = await client.post("/v1/prompt-history", json={"prompt": "Fresh database history"})
                assert saved.status_code == 201
                listed = await client.get("/v1/prompt-history")
                assert listed.json()["items"][0]["saved_text"] == "Fresh database history"
            get_settings.cache_clear()
        finally:
            await admin.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(database)))
