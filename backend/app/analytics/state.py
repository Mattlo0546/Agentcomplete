from datetime import datetime
from typing import Any

from pydantic import BaseModel

from app.db.pool import connection


class Classifier(BaseModel):
    auc: float
    trained_at: datetime
    rows: int


class AnalyticsStatus(BaseModel):
    last_export_at: datetime | None
    last_export_count: int | None
    classifier: Classifier | None


async def load_status() -> AnalyticsStatus:
    async with connection() as conn:
        row: dict[str, Any] | None = await (await conn.execute("SELECT * FROM analytics_state WHERE id = 1")).fetchone()
    row = row or {}
    classifier = None
    if row.get("classifier_auc") is not None and row.get("classifier_trained_at"):
        classifier = Classifier(
            auc=row["classifier_auc"], trained_at=row["classifier_trained_at"], rows=row["classifier_rows"] or 0
        )
    return AnalyticsStatus(
        last_export_at=row.get("last_export_at"), last_export_count=row.get("last_export_count"), classifier=classifier
    )
