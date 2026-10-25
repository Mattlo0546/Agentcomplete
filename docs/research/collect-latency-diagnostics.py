"""Read-only Tiger diagnostics; saves metadata, never prompt text or credentials.

Run from the repository root with backend/.venv/bin/python.
This script does not invoke models, apply migrations, or change app settings.
"""

import json
import random
import statistics
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

import psycopg
from app.config import get_settings
from app.pipeline.retrieve import _RETRIEVE_SQL
from psycopg.rows import dict_row


def compact_plan(node):
    keys = (
        "Node Type",
        "Relation Name",
        "Index Name",
        "Actual Startup Time",
        "Actual Total Time",
        "Actual Rows",
        "Actual Loops",
        "Shared Hit Blocks",
        "Shared Read Blocks",
    )
    out = {k: node[k] for k in keys if k in node}
    if "Plans" in node:
        out["Plans"] = [compact_plan(child) for child in node["Plans"]]
    return out


def main():
    settings = get_settings()
    report = {
        "measured_at": datetime.now(UTC).isoformat(),
        "scope": "Read-only live database probes; existing historical AI call metadata; no new model calls",
        "models": {
            k: getattr(settings, k)
            for k in (
                "tag_model",
                "generate_model",
                "autocomplete_model",
                "embed_model",
                "embed_dims",
            )
        },
    }
    started = time.perf_counter()
    with psycopg.connect(
        settings.database_url,
        connect_timeout=5,
        autocommit=True,
        row_factory=dict_row,
        options="-c default_transaction_read_only=on -c statement_timeout=5000",
    ) as conn:
        report["connection_establishment_ms"] = round(
            (time.perf_counter() - started) * 1000, 2
        )
        report["counts"] = conn.execute(
            "SELECT (SELECT count(*) FROM tag) AS tags, (SELECT count(*) FROM knowledge) AS knowledge"
        ).fetchone()
        report["settings"] = conn.execute(
            "SELECT trigger_delay_ms, autocomplete_enabled, questions_enabled FROM app_settings WHERE id=1"
        ).fetchone()
        rtts = []
        for _ in range(8):
            started = time.perf_counter()
            conn.execute("SELECT 1").fetchone()
            rtts.append(round((time.perf_counter() - started) * 1000, 2))
        report["warm_select_1_ms"] = rtts
        report["warm_select_1_median_ms"] = statistics.median(rtts)
        vectors = [
            row["vector"]
            for row in conn.execute(
                "SELECT embedding::text AS vector FROM tag ORDER BY id LIMIT 4"
            ).fetchall()
        ]
        params = {
            "vectors": vectors,
            "neighbours": 8,
            "threshold": 0.88,
            "limit": 5,
            "body": 8000,
        }
        plans = []
        for _ in range(3):
            started = time.perf_counter()
            full = conn.execute(
                "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + _RETRIEVE_SQL, params
            ).fetchone()
            elapsed = round((time.perf_counter() - started) * 1000, 2)
            plan = full["QUERY PLAN"][0]
            plans.append(
                {
                    "client_elapsed_ms": elapsed,
                    "planning_ms": plan["Planning Time"],
                    "execution_ms": plan["Execution Time"],
                    "plan": compact_plan(plan["Plan"]),
                }
            )
        report["retrieval_explain"] = {
            "fixture": "Four existing stored tag vectors; current SQL shape; not arbitrary new-query recall evaluation",
            "plans": plans,
        }
        # Keep the original control after the application adopts typed vectors.
        legacy_sql = _RETRIEVE_SQL.replace(
            "%(vectors)s::vector[]", "%(vectors)s::text[]"
        ).replace("embedding <=> q.v", "embedding <=> q.v::vector")
        variants = {
            "legacy_text_array": legacy_sql,
            "typed_vector_array": _RETRIEVE_SQL,
            "materialized_vectors": legacy_sql.replace(
                "WITH hits AS (",
                "WITH query_vectors AS MATERIALIZED (SELECT i, v::vector AS v "
                "FROM unnest(%(vectors)s::text[]) WITH ORDINALITY AS src(v,i)), hits AS (",
            )
            .replace(
                "unnest(%(vectors)s::text[]) WITH ORDINALITY AS q(v, i)",
                "query_vectors q",
            )
            .replace("q.v::vector", "q.v"),
        }
        order = list(variants) * 4
        random.Random(42).shuffle(order)
        ablations = []
        reference = conn.execute(_RETRIEVE_SQL, params).fetchone()
        for name in order:
            sql = variants[name]
            started = time.perf_counter()
            full = conn.execute(
                "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + sql, params
            ).fetchone()
            elapsed = round((time.perf_counter() - started) * 1000, 2)
            plan = full["QUERY PLAN"][0]
            result = conn.execute(sql, params).fetchone()

            # Compare keyed candidates to avoid treating unspecified equal-score ordering as semantic change.
            def normalized(row):
                return {
                    "tag_similarity": row["tag_similarity"],
                    "candidates": sorted(
                        row["candidates"], key=lambda item: item["id"]
                    ),
                }

            ablations.append(
                {
                    "variant": name,
                    "client_explain_ms": elapsed,
                    "planning_ms": plan["Planning Time"],
                    "execution_ms": plan["Execution Time"],
                    "same_result_on_fixture": normalized(result)
                    == normalized(reference),
                    "plan": compact_plan(plan["Plan"]),
                }
            )
        report["sql_shape_ablation"] = {
            "description": "Randomized order, four observations per SQL shape; same four stored vectors; read-only",
            "samples": ablations,
        }
        report["recent_ai_metadata"] = conn.execute("""
            SELECT model, operation, status, count(*) AS n,
              round(avg(latency_ms), 2) AS mean_ms,
              percentile_cont(.5) WITHIN GROUP (ORDER BY latency_ms) AS median_ms,
              round(avg(input_tokens), 2) AS mean_input_tokens,
              round(avg(output_tokens), 2) AS mean_output_tokens
            FROM (SELECT * FROM ai_call_log ORDER BY time DESC LIMIT 300) recent
            GROUP BY model, operation, status ORDER BY operation, status
        """).fetchall()
        matched = {}
        for name in (
            "latency-optimized.json",
            "latency-incremental.json",
            "latency-edits-linked.json",
        ):
            source = json.loads((ROOT / "docs/evidence" / name).read_text())
            ids = [row["request_id"] for row in source["samples"]]
            matched[name] = conn.execute(
                """
                SELECT request_id, operation, model, status, latency_ms, input_tokens, output_tokens
                FROM ai_call_log WHERE request_id = ANY(%s) ORDER BY time
            """,
                (ids,),
            ).fetchall()
        report["matched_historical_calls"] = matched
    path = ROOT / "docs/evidence/latency-audit-diagnostics.json"
    path.write_text(json.dumps(report, indent=2, default=float) + "\n")
    print(
        json.dumps(
            {
                "output": str(path),
                "counts": report["counts"],
                "warm_select_1_median_ms": report["warm_select_1_median_ms"],
                "retrieval_execution_ms": [p["execution_ms"] for p in plans],
                "retrieval_client_ms": [p["client_elapsed_ms"] for p in plans],
                "matched_call_counts": {k: len(v) for k, v in matched.items()},
                "sql_ablation_medians": {
                    name: statistics.median(
                        row["execution_ms"]
                        for row in ablations
                        if row["variant"] == name
                    )
                    for name in variants
                },
                "all_sql_fixture_results_equal": all(
                    row["same_result_on_fixture"] for row in ablations
                ),
            }
        )
    )


if __name__ == "__main__":
    main()
