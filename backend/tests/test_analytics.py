"""Live Snowflake round trip: export synthetic events, train, assert AUC, then clean both stores."""

import json
import random
import uuid

import pytest
from httpx import AsyncClient

from app.analytics.snowflake_client import EVENTS_TABLE, run, snowflake_connection
from app.db.pool import connection

pytestmark = pytest.mark.live
PREFIX = f"req_zt{uuid.uuid4().hex[:6]}"


def _features(accept: bool, rng: random.Random) -> dict:
    kept = rng.randint(2, 4) if accept else rng.randint(0, 1)
    return {
        "task_type": rng.choice(["code_change", "debugging"] if accept else ["writing", "other", "question"]),
        "missing_constraints": ["scope"] if accept else ["scope", "context", "language"],
        "n_missing_constraints": 1 if accept else 3,
        "prompt_units": rng.randint(80, 300) if accept else rng.randint(5, 60),
        "prompt_bucket": "m" if accept else "xs",
        "n_tags": 5, "n_candidates": 5, "n_kept": kept,
        "top_score": round(rng.uniform(0.8, 0.95) if accept else rng.uniform(0.3, 0.6), 3),
        "mean_kept_score": round(rng.uniform(0.75, 0.9) if accept else rng.uniform(0.2, 0.5), 3),
        "top_tag_similarity": round(rng.uniform(0.85, 0.97) if accept else rng.uniform(0.4, 0.7), 3),
        "general": not accept, "suggestion_type": "autocomplete" if accept else "multiple_choice",
        "n_options": 1 if accept else 3, "n_edits": 1 if accept else 2,
        "latency_ms": rng.randint(900, 1600) if accept else rng.randint(1500, 3000),
    }  # fmt: skip


async def _cleanup() -> None:
    async with connection() as conn:
        await conn.execute("DELETE FROM outcome_event WHERE request_id LIKE %s", (f"{PREFIX}%",))
    with snowflake_connection() as sf:
        run(sf, f"DELETE FROM {EVENTS_TABLE} WHERE REQUEST_ID LIKE %s", (f"{PREFIX}%",))


_STATE_COLUMNS = "last_export_at, last_export_count, classifier_auc, classifier_rows, classifier_trained_at"


async def test_export_and_train(client: AsyncClient) -> None:
    rng = random.Random(7)
    async with connection() as conn:
        saved_state = await (
            await conn.execute(f"SELECT {_STATE_COLUMNS} FROM analytics_state WHERE id = 1")
        ).fetchone()
    try:
        async with connection() as conn:
            for i in range(60):
                accept = i % 2 == 0
                rid = f"{PREFIX}{i:03d}"
                features = json.dumps(_features(accept, rng))
                events = ["shown", "accepted" if accept else rng.choice(["declined", "dismissed"])]
                for event in events:
                    await conn.execute(
                        "INSERT INTO outcome_event (request_id, prompt_revision, event, time_to_action_ms, features)"
                        " VALUES (%s, 1, %s, 1500, %s)",
                        (rid, event, features),
                    )
        exported = (await client.post("/v1/analytics/export")).json()["exported"]
        assert exported >= 120
        with snowflake_connection() as sf:
            count = run(sf, f"SELECT COUNT(*) FROM {EVENTS_TABLE} WHERE REQUEST_ID LIKE %s", (f"{PREFIX}%",))[0][0]
        assert count == 120
        assert (await client.post("/v1/analytics/export")).json()["exported"] < 120

        trained = await client.post("/v1/analytics/train")
        assert trained.status_code == 200, trained.text
        body = trained.json()
        assert body["auc"] > 0.7 and body["rows"] >= 60
        status = (await client.get("/v1/analytics/status")).json()
        assert status["classifier"]["auc"] == body["auc"] and status["last_export_at"]
        assert (await client.get("/v1/stats")).json()["classifier"]["auc"] == body["auc"]
    finally:
        await _cleanup()
        # The synthetic model must not masquerade as the real classifier.
        async with connection() as conn:
            await conn.execute(
                "UPDATE analytics_state SET last_export_at = %(last_export_at)s,"
                " last_export_count = %(last_export_count)s,"
                " classifier_auc = %(classifier_auc)s, classifier_rows = %(classifier_rows)s,"
                " classifier_trained_at = %(classifier_trained_at)s WHERE id = 1",
                saved_state,
            )
