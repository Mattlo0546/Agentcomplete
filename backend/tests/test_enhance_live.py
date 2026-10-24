"""Live POST /v1/enhance tests against real Gemini + Tiger DB, with throwaway seeded knowledge."""

import secrets
from collections.abc import AsyncIterator
from typing import Any

import pytest
from httpx import AsyncClient
from pydantic import TypeAdapter

from app.db.pool import connection
from app.llm import gemini
from app.pipeline.validate import validate_response
from app.schemas.enhance import EnhanceResponse, utf16_len
from app.settings_store import load_settings

pytestmark = pytest.mark.live

_ADAPTER: TypeAdapter[Any] = TypeAdapter(EnhanceResponse)
_SEED = [
    (
        "skill",
        "HTTP retries with exponential backoff",
        "How to add resilient retries to outbound HTTP calls: exponential backoff with jitter, retry budgets, "
        "idempotency and which status codes to retry.",
        "Retry only idempotent requests or requests with an idempotency key.\n\n"
        "Use exponential backoff with full jitter: sleep = random(0, base * 2**attempt), capped at max_delay.\n\n"
        "Retry on 429, 502, 503, 504 and connection errors; never on other 4xx.\n\n"
        "Cap total attempts (e.g. 5) and honour Retry-After headers.",
        ["retry", "exponential-backoff", "http-client"],
    ),
    (
        "prompt",
        "Brand newsletter copy",
        "Example prompt for writing a friendly product newsletter with a subject line and a call to action.",
        "Write a 150-word newsletter announcing the feature, with a subject line and one call to action.",
        ["newsletter", "marketing-copy"],
    ),
]


@pytest.fixture(scope="module")
async def seeded() -> AsyncIterator[dict[str, str]]:
    """Insert knowledge rows + tags with real embeddings; remove them (and tags we created) afterwards."""
    suffix = secrets.token_hex(3)
    ids: dict[str, str] = {}
    created_tags: list[str] = []
    all_tags = sorted({t for *_, tags in _SEED for t in tags})
    vectors = dict(zip(all_tags, await gemini.embed(all_tags), strict=True))
    async with connection() as conn, conn.transaction():
        for kind, title, summary, body, tags in _SEED:
            row = await (
                await conn.execute(
                    "INSERT INTO knowledge (kind, title, body, summary) VALUES (%s, %s, %s, %s) RETURNING id",
                    (kind, f"{title} [test {suffix}]", body, summary),
                )
            ).fetchone()
            assert row is not None
            ids[title] = str(row["id"])
            for tag in tags:
                inserted = await (
                    await conn.execute(
                        "INSERT INTO tag (name, embedding) VALUES (%s, %s::vector) ON CONFLICT (name) DO NOTHING"
                        " RETURNING id",
                        (tag, "[" + ",".join(map(str, vectors[tag])) + "]"),
                    )
                ).fetchone()
                if inserted:
                    created_tags.append(tag)
                await conn.execute(
                    "INSERT INTO knowledge_tag (knowledge_id, tag_id) SELECT %s, id FROM tag WHERE name = %s",
                    (row["id"], tag),
                )
    yield ids
    async with connection() as conn:
        await conn.execute("DELETE FROM knowledge WHERE id = ANY(%s::uuid[])", (list(ids.values()),))
        await conn.execute(
            "DELETE FROM tag t WHERE name = ANY(%s) AND NOT EXISTS (SELECT 1 FROM knowledge_tag kt"
            " WHERE kt.tag_id = t.id)",
            (created_tags,),
        )


def _rid() -> str:
    return f"req_test{secrets.token_hex(5)}"


async def _enhance(client: AsyncClient, prompt: str, cursor: int | None = None) -> Any:
    cursor = utf16_len(prompt) if cursor is None else cursor
    rid = _rid()
    response = await client.post(
        "/v1/enhance", json={"request_id": rid, "prompt": prompt, "prompt_revision": 3, "cursor": cursor}
    )
    assert response.status_code == 200, response.text
    data = _ADAPTER.validate_python(response.json())
    assert data.request_id == rid and data.prompt_revision == 3 and data.schema_version == 1
    validate_response(prompt, cursor, data, await load_settings())
    return data


async def test_end_of_prompt_uses_knowledge(client: AsyncClient, seeded: dict[str, str]) -> None:
    prompt = "Add retry logic with exponential backoff to the HTTP client in our Python payments service so that"
    data = await _enhance(client, prompt)
    assert data.type in ("autocomplete", "multiple_choice")
    if data.type == "autocomplete":
        assert data.insert_at == utf16_len(prompt)
    trace = (await client.get(f"/v1/traces/{data.request_id}")).json()
    retry_id = seeded["HTTP retries with exponential backoff"]
    hits = [k for k in trace["knowledge"] if k["id"] == retry_id]
    assert hits, trace["knowledge"]  # retrieved via tag similarity
    assert seeded["Brand newsletter copy"] not in {k["id"] for k in trace["knowledge"]}
    steps = {s["step"]: s for s in trace["steps"]}
    assert list(steps) == ["tags", "retrieve", "judge", "generate"]
    if steps["judge"]["status"] == "ok":  # a judge call over its latency budget counts as dropped
        assert hits[0]["kept"] and trace["general"] is False
        async with connection() as conn:
            row = await (await conn.execute("SELECT use_count FROM knowledge WHERE id = %s", (retry_id,))).fetchone()
        assert row is not None and row["use_count"] >= 1


async def test_vague_prompt_asks_question(client: AsyncClient) -> None:
    prompt = "Write a function that sorts the data."
    data = await _enhance(client, prompt)
    assert data.type == "multiple_choice", data
    assert 2 <= len(data.options) <= (await load_settings()).max_options


@pytest.mark.parametrize(
    ("prompt", "anchor"),
    [
        ("Refactor the 😀 emoji parser and then write tests for it", "and then"),
        ("Explain 日本語 tokenization in our search pipeline", "in our"),
    ],
)
async def test_cursor_mid_prompt_never_autocompletes(client: AsyncClient, prompt: str, anchor: str) -> None:
    cursor = utf16_len(prompt[: prompt.index(anchor)])
    data = await _enhance(client, prompt, cursor)
    assert data.type != "autocomplete"


async def test_trace_and_outcome_round_trip(client: AsyncClient) -> None:
    data = await _enhance(client, "Summarise the meeting notes")
    trace = await client.get(f"/v1/traces/{data.request_id}")
    assert trace.status_code == 200
    body = trace.json()
    assert body["result_type"] == data.type and body["prompt_revision"] == 3
    assert {"request_id", "created_at", "general", "tags", "knowledge", "steps"} <= body.keys()
    assert "Summarise" not in trace.text  # no prompt text stored
    outcome = {"request_id": data.request_id, "prompt_revision": 3, "event": "shown", "time_to_action_ms": 120}
    assert (await client.post("/v1/outcomes", json=outcome)).status_code == 204
    async with connection() as conn:
        row = await (
            await conn.execute("SELECT event, features FROM outcome_event WHERE request_id = %s", (data.request_id,))
        ).fetchone()
    assert row is not None and row["event"] == "shown"
    assert row["features"]["suggestion_type"] == data.type and row["features"]["prompt_bucket"] == "xs"
    missing = await client.post("/v1/outcomes", json={**outcome, "request_id": "req_nope000000"})
    assert missing.status_code == 404
    assert (await client.get("/v1/traces/req_nope000000")).status_code == 404


async def test_request_bounds(client: AsyncClient) -> None:
    for payload in (
        {"request_id": _rid(), "prompt": "abc", "prompt_revision": 1, "cursor": 4},
        {"request_id": _rid(), "prompt": "😀", "prompt_revision": 1, "cursor": 3},
        {"request_id": _rid(), "prompt": "x" * 20_001, "prompt_revision": 1, "cursor": 0},
    ):
        response = await client.post("/v1/enhance", json=payload)
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "invalid_request"
    data = await _enhance(client, "   ")
    assert data.type == "none"


async def test_api_row_ai_calls_and_trace_share_the_body_request_id(client: AsyncClient) -> None:
    from app.observability.writers import flush

    rid = f"req_join{secrets.token_hex(4)}"
    prompt = "Add structured logging to the checkout service so every request"
    response = await client.post(
        "/v1/enhance", json={"request_id": rid, "prompt": prompt, "prompt_revision": 1, "cursor": len(prompt)}
    )
    assert response.status_code == 200 and response.headers["X-Request-ID"] == rid
    await flush()
    detail = (await client.get(f"/v1/logs/{rid}")).json()
    assert detail["api"]["path"] == "/v1/enhance"
    assert {call["operation"] for call in detail["ai"]} >= {"enhance.tags", "enhance.generate"}
    assert detail["trace"]["request_id"] == rid
