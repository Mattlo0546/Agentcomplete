---
kind: skill
title: Python retry with exponential backoff and jitter
---
# Python retry with exponential backoff and jitter

Use when calling a network service, API or database that can fail transiently (timeouts, 429, 502/503/504, connection resets).

## Rules
- Retry only errors that are transient and safe to repeat. Never retry 400/401/403/404/422, validation errors or programming bugs.
- Only retry non-idempotent operations (POST that creates something, payments) if the call carries an idempotency key.
- Use exponential backoff with full jitter: `sleep = random.uniform(0, min(cap, base * 2**attempt))`. Jitter prevents synchronized retry storms.
- Bound everything: max attempts (3-5), per-attempt timeout, and a total deadline. Unbounded retries turn an outage into a pile-up.
- Honour `Retry-After` on 429/503 when present; it overrides your computed delay.
- Log each retry with attempt number, delay and exception type, but never the payload or credentials.
- Re-raise the last exception (or wrap it with `raise ... from exc`) when attempts are exhausted so callers see the real cause.

## Async example
```python
import asyncio, random
import httpx

RETRYABLE = {429, 500, 502, 503, 504}

async def get_with_retry(client: httpx.AsyncClient, url: str, attempts: int = 4) -> httpx.Response:
    for attempt in range(attempts):
        try:
            resp = await client.get(url, timeout=5.0)
            if resp.status_code not in RETRYABLE:
                return resp
            delay = float(resp.headers.get("Retry-After", 0)) or None
        except (httpx.TimeoutException, httpx.TransportError):
            delay = None
        if attempt == attempts - 1:
            break
        await asyncio.sleep(delay if delay is not None else random.uniform(0, min(8.0, 0.25 * 2**attempt)))
    raise RuntimeError(f"GET {url} failed after {attempts} attempts")
```

## Libraries
`tenacity` provides `@retry(stop=stop_after_attempt(4), wait=wait_random_exponential(max=8), retry=retry_if_exception_type(...), reraise=True)`. Prefer it over hand-rolled loops when you need several policies.

## Testing
Inject the sleep function or patch `asyncio.sleep`, and assert the number of attempts, that non-retryable errors are raised immediately, and that the final exception propagates.
