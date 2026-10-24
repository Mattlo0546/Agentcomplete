from datetime import UTC, datetime, timedelta
from typing import Any

from pydantic import BaseModel

from app.analytics.state import Classifier, load_status
from app.config import get_settings
from app.db.pool import connection

_SQL = {
    "suggestions": "SELECT count(*) AS n FROM enhance_trace WHERE result_type <> 'none' AND created_at >= %(since)s",
    "outcomes": """
        SELECT count(*) FILTER (WHERE event = 'shown') AS shown,
               count(*) FILTER (WHERE event = 'accepted') AS accepted,
               count(*) FILTER (WHERE event IN ('declined', 'dismissed')) AS declined
        FROM outcome_event WHERE time >= %(since)s""",
    "latency": """
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50 FROM api_call_log
        WHERE path = '/v1/enhance' AND status = 200 AND time >= %(since)s""",
    "entries": """
        SELECT (SELECT count(*) FROM api_call_log WHERE time >= %(since)s)
             + (SELECT count(*) FROM ai_call_log WHERE time >= %(since)s) AS n""",
    "bytes": """
        SELECT coalesce(hypertable_size('api_call_log'), 0) + coalesce(hypertable_size('ai_call_log'), 0)
             + coalesce(hypertable_size('enhance_trace'), 0) AS n""",
}


class ClassifierSummary(BaseModel):
    auc: float
    trained_at: datetime


class Stats(BaseModel):
    suggestions: int
    accepted_pct: float
    declined_pct: float
    p50_latency_ms: int
    classifier: ClassifierSummary | None
    log_entries: int
    log_bytes: int


def _pct(part: int, whole: int) -> float:
    return round(100 * part / whole, 1) if whole else 0.0


async def load_stats() -> Stats:
    params: dict[str, Any] = {"since": datetime.now(UTC) - timedelta(days=get_settings().retention_days)}
    async with connection() as conn:
        one = {k: await (await conn.execute(sql, params)).fetchone() for k, sql in _SQL.items()}  # type: ignore[arg-type]
    outcomes, p50 = one["outcomes"] or {}, (one["latency"] or {}).get("p50")
    classifier: Classifier | None = (await load_status()).classifier
    return Stats(
        suggestions=one["suggestions"]["n"],  # type: ignore[index]
        accepted_pct=_pct(outcomes["accepted"], outcomes["shown"]),
        declined_pct=_pct(outcomes["declined"], outcomes["shown"]),
        p50_latency_ms=round(p50) if p50 is not None else 0,
        classifier=ClassifierSummary(auc=classifier.auc, trained_at=classifier.trained_at) if classifier else None,
        log_entries=one["entries"]["n"],  # type: ignore[index]
        log_bytes=int(one["bytes"]["n"]),  # type: ignore[index]
    )
