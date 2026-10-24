from fastapi import APIRouter

from app.activity.stats import Stats, load_stats

router = APIRouter()


@router.get("/stats")
async def stats() -> Stats:
    return await load_stats()
