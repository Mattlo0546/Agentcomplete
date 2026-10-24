from typing import Annotated

from fastapi import APIRouter, Query

from app.db.pool import connection
from app.knowledge import repository
from app.knowledge.models import TagList

router = APIRouter(tags=["tags"])


@router.get("/tags")
async def list_tags(q: str | None = None, limit: Annotated[int, Query(ge=1, le=500)] = 50) -> TagList:
    async with connection() as conn:
        return TagList(items=await repository.list_tags(conn, q.strip() if q else None, limit))
