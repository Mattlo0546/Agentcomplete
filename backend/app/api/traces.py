from fastapi import APIRouter

from app.errors import NotFoundError
from app.pipeline.trace import Trace, load_trace

router = APIRouter()


@router.get("/traces/{request_id}", response_model=Trace)
async def get_trace(request_id: str) -> Trace:
    trace = await load_trace(request_id)
    if trace is None:
        raise NotFoundError("trace_not_found", "No trace for this request id")
    return trace
