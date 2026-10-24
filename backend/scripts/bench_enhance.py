"""Latency/quality bench for the enhance pipeline. Model overrides come from env (TAG_MODEL, JUDGE_MODEL, ...).

Usage: uv run python scripts/bench_enhance.py
"""

import asyncio
import json
import time

from app.db.pool import close_pool, connection, open_pool
from app.pipeline.run import run_enhance
from app.schemas.enhance import EnhanceRequest, utf16_len

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


async def main() -> None:
    await open_pool()
    for i, prompt in enumerate(PROMPTS):
        rid = f"req_bench{int(time.time() * 1000) % 10**8:08d}{i}"
        started = time.perf_counter()
        response = await run_enhance(
            EnhanceRequest(request_id=rid, prompt=prompt, prompt_revision=1, cursor=utf16_len(prompt))
        )
        total = int((time.perf_counter() - started) * 1000)
        async with connection() as conn:
            row = await (
                await conn.execute("SELECT steps, knowledge FROM enhance_trace WHERE request_id = %s", (rid,))
            ).fetchone()
        steps = " ".join(f"{s['step']}={s['latency_ms']}" for s in (row or {}).get("steps", []))
        kept = [k["title"][:28] for k in (row or {}).get("knowledge", []) if k["kept"]]
        body = response.model_dump()
        detail = body.get("text") or body.get("question") or ""
        print(f"{total:5d}ms {body['type']:15s} {steps} kept={kept}\n        {json.dumps(detail)[:150]}")
    await close_pool()


asyncio.run(main())
