from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Query, Response

from app.activity import logs as activity
from app.activity.models import AiLog, ApiLog, LogDetail

router = APIRouter()


@router.get("/logs")
async def list_logs(
    kind: Literal["all", "ai", "api"] = "all",
    status: Literal["any", "2xx", "4xx", "5xx"] = "any",
    request_id: str | None = None,
    before: datetime | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> dict[str, list[ApiLog] | list[AiLog]]:
    return {"items": await activity.list_logs(kind, status, request_id or None, before, limit)}


@router.get("/logs/{request_id}")
async def log_detail(request_id: str) -> LogDetail:
    return await activity.log_detail(request_id)


@router.delete("/logs", status_code=204)
async def clear_logs() -> Response:
    await activity.clear_logs()
    return Response(status_code=204)
