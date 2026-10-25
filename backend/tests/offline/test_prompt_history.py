"""History API journeys with an in-memory SQL boundary; never use live services."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from app.api import prompt_history
from app.errors import install_error_handlers


class Cursor:
    def __init__(self, rows: list[dict[str, Any]], rowcount: int | None = None) -> None:
        self.rows = rows
        self.rowcount = len(rows) if rowcount is None else rowcount

    async def fetchone(self) -> dict[str, Any] | None:
        return self.rows[0] if self.rows else None

    async def fetchall(self) -> list[dict[str, Any]]:
        return self.rows


class MemoryConnection:
    def __init__(self) -> None:
        self.rows: dict[UUID, dict[str, Any]] = {}
        self.queries: list[tuple[str, Any]] = []
        self.clock = datetime(2026, 10, 25, tzinfo=UTC)

    def tick(self) -> datetime:
        self.clock += timedelta(seconds=1)
        return self.clock

    @staticmethod
    def view(row: dict[str, Any]) -> dict[str, Any]:
        return {**row, "saved_text": row["prompt"] + (row["suggestion_text"] or "")}

    async def execute(self, query: str, params: Any = ()) -> Cursor:
        self.queries.append((query, params))
        if query.startswith("INSERT INTO prompt_history"):
            now = self.tick()
            row = dict(zip(("prompt", "suggestion_text", "title", "description"), params, strict=True))
            row.update(id=uuid4(), created_at=now, updated_at=now)
            self.rows[row["id"]] = row
            return Cursor([self.view(row)])
        if query.startswith("UPDATE prompt_history"):
            row = self.rows.get(params[-1])
            if row is None:
                return Cursor([])
            fields = query.split(" SET ", 1)[1].split(", updated_at", 1)[0].split(", ")
            for field, value in zip(fields, params[:-1], strict=True):
                key = field.split(" = ", 1)[0]
                assert key in {"title", "description"}
                row[key] = value
            row["updated_at"] = self.tick()
            return Cursor([self.view(row)])
        if query.startswith("DELETE FROM prompt_history"):
            found = self.rows.pop(params[0], None) is not None
            return Cursor([], rowcount=int(found))
        if query == "SELECT count(*) AS total FROM prompt_history":
            return Cursor([{"total": len(self.rows)}])
        if "WHERE id = %s" in query:
            row = self.rows.get(params[0])
            return Cursor([self.view(row)] if row else [])
        if "count(*) OVER ()" in query:
            assert "ORDER BY created_at DESC, id DESC LIMIT %s OFFSET %s" in query
            ordered = sorted(self.rows.values(), key=lambda row: (row["created_at"], row["id"]), reverse=True)
            limit, offset = params
            return Cursor([{**self.view(row), "total": len(ordered)} for row in ordered[offset : offset + limit]])
        raise AssertionError(f"Unexpected SQL operation: {query}")


@pytest.fixture
def store(monkeypatch: pytest.MonkeyPatch) -> MemoryConnection:
    store = MemoryConnection()

    @asynccontextmanager
    async def connection() -> AsyncIterator[MemoryConnection]:
        yield store

    monkeypatch.setattr(prompt_history, "connection", connection)
    return store


@pytest.fixture
async def client(store: MemoryConnection) -> AsyncIterator[AsyncClient]:
    app = FastAPI()
    install_error_handlers(app)
    app.include_router(prompt_history.router, prefix="/v1")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client


async def test_save_unaccepted_suggestion_and_metadata_patch_preserve_snapshot(
    client: AsyncClient, store: MemoryConnection
) -> None:
    draft = "Fix the failing test 😀"
    suggestion = " and verify the regression."
    response = await client.post(
        "/v1/prompt-history",
        json={
            "prompt": draft,
            "suggestion_text": suggestion,
            "title": "  Regression plan  ",
            "description": "  Add tests first  ",
        },
    )
    assert response.status_code == 201
    saved = response.json()
    assert saved["prompt"] == draft
    assert saved["suggestion_text"] == suggestion
    assert saved["saved_text"] == draft + suggestion
    assert saved["title"] == "Regression plan"
    assert saved["description"] == "Add tests first"
    assert saved["created_at"] == saved["updated_at"]
    assert saved["id"]

    patch = await client.patch(f"/v1/prompt-history/{saved['id']}", json={"description": "Revised notes"})
    assert patch.status_code == 200
    updated = patch.json()
    assert updated == {**saved, "description": "Revised notes", "updated_at": updated["updated_at"]}
    assert updated["updated_at"] > saved["updated_at"]
    assert (await client.get(f"/v1/prompt-history/{saved['id']}")).json() == updated

    cleared = await client.patch(f"/v1/prompt-history/{saved['id']}", json={"title": None, "description": "   "})
    assert cleared.json()["title"] is None
    assert cleared.json()["description"] is None
    assert cleared.json()["saved_text"] == draft + suggestion
    # Text stays exclusively in bound parameters, never interpolated into SQL.
    assert all(draft not in sql and suggestion not in sql for sql, _ in store.queries)


async def test_newest_first_pagination_total_and_base_only_snapshot(client: AsyncClient) -> None:
    first = (await client.post("/v1/prompt-history", json={"prompt": "First"})).json()
    second = (await client.post("/v1/prompt-history", json={"prompt": "Second"})).json()
    assert first["saved_text"] == first["prompt"] == "First"
    assert first["suggestion_text"] is None
    assert first["title"] is None
    page = (await client.get("/v1/prompt-history?limit=1")).json()
    assert page == {"items": [second], "total": 2}
    page = (await client.get("/v1/prompt-history?limit=1&offset=1")).json()
    assert page == {"items": [first], "total": 2}
    assert (await client.get("/v1/prompt-history?offset=20")).json() == {"items": [], "total": 2}


async def test_delete_and_missing_version_routes(client: AsyncClient) -> None:
    saved = (await client.post("/v1/prompt-history", json={"prompt": "Delete me"})).json()
    path = f"/v1/prompt-history/{saved['id']}"
    assert (await client.delete(path)).status_code == 204
    assert (await client.get("/v1/prompt-history")).json() == {"items": [], "total": 0}
    for response in (
        await client.get(path),
        await client.patch(path, json={"title": "Gone"}),
        await client.delete(path),
    ):
        assert response.status_code == 404
        assert response.json() == {"error": {"code": "not_found", "message": "Prompt version not found"}}


@pytest.mark.parametrize(
    "body",
    [
        {"prompt": ""},
        {"prompt": " \n "},
        {"prompt": "😀" * 10_001},
        {"prompt": "x", "suggestion_text": "😀" * 2_001},
        {"prompt": "x" * 19_999, "suggestion_text": "😀"},
        {"prompt": "x", "title": " "},
        {"prompt": "x", "title": "x" * 121},
        {"prompt": "x", "description": "x" * 1_001},
        {"prompt": "x", "saved_text": "forged snapshot"},
    ],
)
async def test_invalid_create_never_writes(client: AsyncClient, store: MemoryConnection, body: dict[str, Any]) -> None:
    response = await client.post("/v1/prompt-history", json=body)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"
    assert not store.queries


async def test_snapshot_is_immutable_and_metadata_fields_are_whitelisted(client: AsyncClient) -> None:
    saved = (await client.post("/v1/prompt-history", json={"prompt": "Do not overwrite"})).json()
    path = f"/v1/prompt-history/{saved['id']}"
    assert (await client.patch(path, json={"prompt": "changed"})).status_code == 422
    assert (await client.patch(path, json={"title = NULL; DROP TABLE prompt_history; --": "x"})).status_code == 422
    assert (await client.patch(path, json={})).json() == saved
    assert (await client.get(path)).json() == saved


@pytest.mark.parametrize("query", ["limit=0", "limit=201", "offset=-1", "limit=nope"])
async def test_invalid_pagination(client: AsyncClient, query: str) -> None:
    assert (await client.get(f"/v1/prompt-history?{query}")).status_code == 422


def test_utf16_boundary_and_invalid_surrogates() -> None:
    accepted = prompt_history.VersionCreate(prompt="😀" * 10_000)
    assert len(accepted.prompt) == 10_000
    with pytest.raises(ValidationError):
        prompt_history.VersionCreate(prompt="\ud800")
