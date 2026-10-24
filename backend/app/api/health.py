import time
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

from app.db.pool import connection
from app.llm import gemini

router = APIRouter()


class Health(BaseModel):
    status: Literal["ok", "degraded"]
    latency_ms: int
    db: Literal["ok", "error"]
    gemini: Literal["ok", "error", "unchecked"]


@router.get("/health")
async def health(deep: int = 0) -> Health:
    started = time.perf_counter()
    try:
        async with connection() as conn:
            await conn.execute("SELECT 1")
        db = "ok"
    except Exception:
        db = "error"
    latency_ms = int((time.perf_counter() - started) * 1000)
    llm = ("ok" if await gemini.ping() else "error") if deep else "unchecked"
    return Health(status="ok" if "error" not in (db, llm) else "degraded", latency_ms=latency_ms, db=db, gemini=llm)  # type: ignore[arg-type]
