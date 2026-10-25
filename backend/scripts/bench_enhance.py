"""Reproducible metadata-only latency benchmark, with real provider calls.

From backend/: PYTHONPATH=. .venv/bin/python scripts/bench_enhance.py --rounds 2
Use --base-url http://127.0.0.1:8000 to measure HTTP round trips as well.
Round one measures first visits; later rounds repeat exact inputs (cache reuse).
--incremental instead measures three successive prompt extensions per case.
Add --previous-context to send the last successful request ID with each edit.
"""

import argparse
import asyncio
import json
import math
import statistics
import time
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

import httpx

PROMPTS = [
    "Refactor the Stripe webhook handler so failed events are retried with exponential backoff",
    "Write a migration plan for our database.",
    "Add a zero-downtime migration that makes users.email NOT NULL",
    "Write tests for the React login form",
    "Summarise this diff for review",
    "Make the API faster",
    "Add retries to the payment client using exponential backoff and",
    "Write Vitest tests for the login form that check",
    "Create a zero-downtime migration that adds a NOT NULL column by first",
]
INCREMENTAL = [
    (PROMPTS[6], " jitter", " while"),
    (PROMPTS[7], " validation", " and"),
    (PROMPTS[8], " adding", " a"),
]


def summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    times = sorted(row["latency_ms"] for row in rows if row["status"] == 200)
    return {
        "requests": len(rows),
        "errors": sum(row["status"] != 200 for row in rows),
        "results": dict(Counter(row["result_type"] for row in rows)),
        "p50_ms": statistics.median(times) if times else None,
        "p95_ms": times[math.ceil(len(times) * 0.95) - 1] if times else None,
    }


async def sample(
    client: httpx.AsyncClient | None,
    prompt: str,
    case: int,
    revision: int,
    previous_request_id: str | None = None,
) -> dict[str, Any]:
    from app.schemas.enhance import EnhanceRequest, utf16_len

    req = EnhanceRequest(
        request_id=f"req_bench{uuid4().hex[:12]}",
        prompt=prompt,
        prompt_revision=revision,
        cursor=utf16_len(prompt),
        previous_request_id=previous_request_id,
    )
    started = time.perf_counter()
    if client is not None:
        response = await client.post("/v1/enhance", json=req.model_dump())
        elapsed = round((time.perf_counter() - started) * 1000)
        status, body = response.status_code, response.json()
        trace_response = await client.get(f"/v1/traces/{req.request_id}")
        trace = trace_response.json() if trace_response.status_code == 200 else {}
    else:
        from app.errors import AppError
        from app.observability.context import set_request_id
        from app.pipeline.run import run_enhance
        from app.pipeline.trace import latest_trace_row

        set_request_id(req.request_id)
        try:
            body = (await run_enhance(req)).model_dump()
            status = 200
        except AppError as exc:
            body = {"error": {"code": exc.code}}
            status = exc.status_code
        elapsed = round((time.perf_counter() - started) * 1000)
        trace = await latest_trace_row(req.request_id) or {}
    return {
        "case": case,
        "round": revision,
        "request_id": req.request_id,
        "previous_context_sent": previous_request_id is not None,
        "knowledge_reused": any(
            step.get("step") == "retrieve" and "reused previous context" in step.get("detail", "")
            for step in trace.get("steps", [])
        ),
        "latency_ms": elapsed,
        "status": status,
        "result_type": body.get("type", "error"),
        "error_code": body.get("error", {}).get("code"),
        "kept_count": sum(k["kept"] for k in trace.get("knowledge", [])),
        "steps": trace.get("steps", []),
    }


async def benchmark(args: argparse.Namespace, client: httpx.AsyncClient | None) -> dict[str, Any]:
    rows = []
    previous_by_case: dict[int, str] = {}
    if args.incremental:
        cases = [
            (i + 7, revision, "".join(parts[:revision]))
            for i, parts in enumerate(INCREMENTAL)
            for revision in range(1, 4)
        ]
    else:
        selected = set(args.cases or range(1, len(PROMPTS) + 1))
        cases = [(i + 1, r, p) for r in range(1, args.rounds + 1) for i, p in enumerate(PROMPTS) if i + 1 in selected]
    for case, revision, prompt in cases:
        previous_id = previous_by_case.get(case) if args.previous_context else None
        row = await sample(client, prompt, case, revision, previous_id)
        rows.append(row)
        if row["status"] == 200:
            previous_by_case[case] = row["request_id"]
        print(json.dumps(row), flush=True)
    return {
        "measured_at": datetime.now(UTC).isoformat(),
        "transport": "http" if client else "in_process",
        "scenario": "incremental" if args.incremental else "exact_prompt_repeat",
        "previous_context": args.previous_context,
        "summary": summary(rows),
        "by_round": {
            str(r): summary([row for row in rows if row["round"] == r]) for r in sorted({x["round"] for x in rows})
        },
        "samples": rows,
    }


async def main(args: argparse.Namespace) -> None:
    if args.base_url:
        async with httpx.AsyncClient(base_url=args.base_url.rstrip("/"), timeout=45) as client:
            result = await benchmark(args, client)
    else:
        from app.config import get_settings
        from app.db.pool import close_pool, open_pool
        from app.observability.writers import flush as flush_logs
        from app.pipeline import catalog
        from app.pipeline.trace import flush as flush_traces
        from app.settings_store import start_settings_refresh, stop_settings_refresh

        startup_started = time.perf_counter()
        await open_pool()
        try:
            await start_settings_refresh()
            if get_settings().fast_autocomplete_enabled:
                await catalog.start()
            startup_ms = round((time.perf_counter() - startup_started) * 1000)
            result = await benchmark(args, None)
            result["startup_ms"] = startup_ms
        finally:
            await catalog.stop()
            await stop_settings_refresh()
            await flush_traces()
            await flush_logs()
            await close_pool()
    print(json.dumps({"summary": result["summary"], "by_round": result["by_round"]}), flush=True)
    if args.output:
        args.output.write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url")
    parser.add_argument("--rounds", type=int, default=1)
    parser.add_argument("--cases", type=int, nargs="+", choices=range(1, 10))
    parser.add_argument("--incremental", action="store_true")
    parser.add_argument("--previous-context", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.rounds < 1:
        parser.error("--rounds must be positive")
    if args.previous_context and not args.incremental:
        parser.error("--previous-context requires --incremental")
    asyncio.run(main(args))
