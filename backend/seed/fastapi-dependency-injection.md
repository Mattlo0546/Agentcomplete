---
kind: skill
title: FastAPI dependency injection patterns
---
# FastAPI dependency injection patterns

Use when structuring FastAPI apps: database sessions, auth, settings, and testing.

## Basics
- A dependency is any callable; declare it with `Depends`. Use `Annotated` aliases to keep signatures short:
```python
from typing import Annotated
from fastapi import Depends


async def get_conn() -> AsyncIterator[AsyncConnection]:
    async with pool.connection() as conn:
        yield conn  # code after yield runs on teardown, even on errors


Conn = Annotated[AsyncConnection, Depends(get_conn)]


@router.get("/items/{id}")
async def read_item(id: UUID, conn: Conn) -> Item: ...
```
- Dependencies are resolved per request and cached within it: the same dependency used twice in one request runs once (`use_cache=False` to opt out).
- Sub-dependencies compose: `current_user` depends on `get_token`, which depends on settings.

## Auth
Create `get_current_user` that raises `HTTPException(401)`; require roles with a factory `def require(role: str): async def check(user: CurrentUser): ...; return check`. Apply router-wide with `APIRouter(dependencies=[Depends(...)])`.

## Settings
Provide settings with a cached function (`@lru_cache def get_settings()`) and depend on it instead of importing globals, so tests can override it.

## Testing
Override dependencies instead of monkeypatching: `app.dependency_overrides[get_conn] = fake_conn`, and clear the dict in a fixture teardown. Use `httpx.AsyncClient(transport=ASGITransport(app=app))` for async tests.

## Pitfalls
Do not do heavy work at import time; do not share one connection across requests; avoid `Depends` in plain functions (only works in path operations and other dependencies); prefer `yield` dependencies for resources that need cleanup.
