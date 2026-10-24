"""Knowledge endpoints against the real Tiger DB and Gemini."""

import json
import uuid
from collections.abc import AsyncIterator

import pytest
from httpx import AsyncClient

from app.db.pool import connection

BODY = (
    "When a Python service calls an HTTP API that returns 503 or times out, retry the request with exponential "
    "backoff and random jitter. Cap attempts at four, honour the Retry-After header and never retry 4xx errors."
)


def parse_sse(text: str) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    for block in text.replace("\r\n", "\n").strip().split("\n\n"):
        name, data = "", ""
        for line in block.splitlines():
            if line.startswith("event:"):
                name = line[6:].strip()
            elif line.startswith("data:"):
                data += line[5:].strip()
        if name:
            events.append((name, json.loads(data)))
    return events


async def ingest(client: AsyncClient, title: str, body: str = BODY, kind: str = "skill") -> dict:
    response = await client.post("/v1/knowledge", json={"kind": kind, "title": title, "body": body})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    events = parse_sse(response.text)
    assert events[-1][0] == "done", events
    return {"events": events, **events[-1][1]}


@pytest.fixture(scope="module")
def prefix() -> str:
    return f"test-{uuid.uuid4().hex[:10]}"


@pytest.fixture(autouse=True)
async def cleanup(prefix: str) -> AsyncIterator[None]:
    yield
    async with connection() as conn:
        await conn.execute("DELETE FROM knowledge WHERE title LIKE %s", (f"{prefix}%",))


async def test_ingest_stream_and_storage(client: AsyncClient, prefix: str) -> None:
    result = await ingest(client, f"{prefix} retry")
    steps = [p["step"] for name, p in result["events"] if name == "step"]
    assert steps == ["summarise", "tag", "embed", "save"]
    detail = result["knowledge"]
    assert detail["summary"] and detail["body"] == BODY and detail["kind"] == "skill"
    assert 3 <= len(detail["tags"]) <= 6
    assert sorted(t["name"] for t in result["tags"]) == detail["tags"]
    assert all(t == t.lower() and " " not in t for t in detail["tags"])
    async with connection() as conn:
        rows = await (
            await conn.execute(
                "SELECT t.name, vector_dims(t.embedding) AS dims FROM knowledge_tag kt JOIN tag t ON t.id = kt.tag_id "
                "WHERE kt.knowledge_id = %s",
                (detail["id"],),
            )
        ).fetchall()
    assert {r["name"] for r in rows} == set(detail["tags"]) and all(r["dims"] == 768 for r in rows)


async def test_list_filters_detail_and_tags_endpoint(client: AsyncClient, prefix: str) -> None:
    a = (await ingest(client, f"{prefix} alpha"))["knowledge"]
    b = (await ingest(client, f"{prefix} beta", "Prompt for explaining diffs to reviewers.", "prompt"))["knowledge"]

    listing = (await client.get("/v1/knowledge", params={"q": prefix.upper()})).json()
    assert listing["total"] == 2 and {i["id"] for i in listing["items"]} == {a["id"], b["id"]}
    assert "body" not in listing["items"][0]

    prompts = (await client.get("/v1/knowledge", params={"q": prefix, "kind": "prompt"})).json()
    assert [i["id"] for i in prompts["items"]] == [b["id"]]

    page = (await client.get("/v1/knowledge", params={"q": prefix, "limit": 1, "offset": 1})).json()
    assert page["total"] == 2 and len(page["items"]) == 1

    both = ",".join(a["tags"][:2])
    tagged = (await client.get("/v1/knowledge", params={"q": prefix, "tags": both})).json()
    assert a["id"] in {i["id"] for i in tagged["items"]}
    none = (await client.get("/v1/knowledge", params={"q": prefix, "tags": "zz-no-such-tag"})).json()
    assert none == {"items": [], "total": 0}

    fetched = await client.get(f"/v1/knowledge/{a['id']}")
    assert fetched.status_code == 200 and fetched.json()["body"] == BODY

    tags = (await client.get("/v1/tags", params={"q": a["tags"][0], "limit": 5})).json()["items"]
    counts = {t["name"]: t["knowledge_count"] for t in tags}
    assert counts[a["tags"][0]] >= 1
    assert [t["knowledge_count"] for t in tags] == sorted((t["knowledge_count"] for t in tags), reverse=True)


async def test_detail_404_and_delete(client: AsyncClient, prefix: str) -> None:
    missing = await client.get(f"/v1/knowledge/{uuid.uuid4()}")
    assert missing.status_code == 404 and missing.json()["error"]["code"] == "not_found"
    item = (await ingest(client, f"{prefix} delete"))["knowledge"]
    assert (await client.delete(f"/v1/knowledge/{item['id']}")).status_code == 204
    assert (await client.get(f"/v1/knowledge/{item['id']}")).status_code == 404
    assert (await client.delete(f"/v1/knowledge/{item['id']}")).status_code == 404
    async with connection() as conn:
        links = await (
            await conn.execute("SELECT count(*) AS n FROM knowledge_tag WHERE knowledge_id = %s", (item["id"],))
        ).fetchone()
        kept = await (
            await conn.execute("SELECT count(*) AS n FROM tag WHERE name = ANY(%s)", (item["tags"],))
        ).fetchone()
    assert links["n"] == 0 and kept["n"] == len(item["tags"])


async def test_patch_title_body_and_tags(client: AsyncClient, prefix: str) -> None:
    item = (await ingest(client, f"{prefix} patch"))["knowledge"]

    renamed = (await client.patch(f"/v1/knowledge/{item['id']}", json={"title": f"{prefix} renamed"})).json()
    assert renamed["title"] == f"{prefix} renamed" and renamed["summary"] == item["summary"]
    assert renamed["tags"] == item["tags"]

    new_body = "Use multi-stage Docker builds: compile in a builder stage and copy artifacts into a slim runtime image."
    rebody = (await client.patch(f"/v1/knowledge/{item['id']}", json={"body": new_body})).json()
    assert rebody["body"] == new_body and rebody["summary"] != item["summary"]
    assert "docker" in " ".join(rebody["tags"]) or "docker" in rebody["summary"].lower()

    custom = f"{prefix}-Custom Tag"
    retagged = (
        await client.patch(f"/v1/knowledge/{item['id']}", json={"body": BODY, "tags": [custom, "retry"]})
    ).json()
    assert retagged["tags"] == sorted([f"{prefix}-custom-tag".lower(), "retry"])
    async with connection() as conn:
        await conn.execute("DELETE FROM tag WHERE name = %s", (f"{prefix}-custom-tag",))


async def test_validation_errors(client: AsyncClient) -> None:
    for payload in (
        {"kind": "nope", "title": "x", "body": "y"},
        {"kind": "skill", "title": "", "body": "y"},
        {"kind": "skill", "title": "x" * 201, "body": "y"},
        {"kind": "skill", "title": "x", "body": ""},
        {"kind": "skill", "title": "x"},
    ):
        response = await client.post("/v1/knowledge", json=payload)
        assert response.status_code == 422 and response.json()["error"]["code"] == "invalid_request"
    assert (await client.get("/v1/knowledge", params={"kind": "bogus"})).status_code == 422
