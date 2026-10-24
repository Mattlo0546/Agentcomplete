import json
from collections.abc import AsyncIterator
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, Response
from sse_starlette import EventSourceResponse

from app.db.pool import connection
from app.errors import NotFoundError
from app.knowledge import ingest, repository
from app.knowledge.models import (
    Kind,
    Knowledge,
    KnowledgeCreate,
    KnowledgeDetail,
    KnowledgeList,
    KnowledgePatch,
)

router = APIRouter(tags=["knowledge"])


@router.get("/knowledge")
async def list_knowledge(
    q: str | None = None,
    kind: Kind | None = None,
    tags: str | None = None,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> KnowledgeList:
    wanted = [t.strip().lower() for t in (tags or "").split(",") if t.strip()]
    async with connection() as conn:
        rows, total = await repository.list_items(
            conn, q=q.strip() if q else None, kind=kind, tags=wanted, offset=offset, limit=limit
        )
    return KnowledgeList(items=[Knowledge(**r) for r in rows], total=total)


@router.post("/knowledge")
async def create_knowledge(data: KnowledgeCreate) -> EventSourceResponse:
    async def events() -> AsyncIterator[dict[str, str]]:
        async for name, payload in ingest.ingest(data):
            yield {"event": name, "data": json.dumps(payload)}

    return EventSourceResponse(events())


@router.get("/knowledge/{knowledge_id}")
async def get_knowledge(knowledge_id: UUID) -> KnowledgeDetail:
    async with connection() as conn:
        row = await repository.get_detail(conn, knowledge_id)
    if row is None:
        raise NotFoundError("not_found", "Knowledge not found")
    return KnowledgeDetail(**row)


@router.patch("/knowledge/{knowledge_id}")
async def patch_knowledge(knowledge_id: UUID, data: KnowledgePatch) -> KnowledgeDetail:
    return await ingest.patch(knowledge_id, data)


@router.delete("/knowledge/{knowledge_id}", status_code=204)
async def delete_knowledge(knowledge_id: UUID) -> Response:
    async with connection() as conn:
        if not await repository.delete(conn, knowledge_id):
            raise NotFoundError("not_found", "Knowledge not found")
    return Response(status_code=204)
