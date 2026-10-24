from fastapi import APIRouter

from app.analytics.export import export_outcomes
from app.analytics.state import AnalyticsStatus, Classifier, load_status
from app.analytics.train import train_classifier

router = APIRouter()


@router.get("/analytics/status")
async def status() -> AnalyticsStatus:
    return await load_status()


@router.post("/analytics/export")
async def export() -> dict[str, int]:
    return {"exported": await export_outcomes()}


@router.post("/analytics/train")
async def train() -> Classifier:
    return await train_classifier()
