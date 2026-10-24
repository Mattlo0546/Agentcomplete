import asyncio
from datetime import UTC, datetime
from typing import Any

from app.analytics.schema import FEATURE_COLUMNS
from app.analytics.snowflake_client import EVENTS_TABLE, MODEL_NAME, TRAINING_VIEW, run, snowflake_connection
from app.analytics.state import Classifier
from app.db.pool import connection
from app.errors import ConflictError, UpstreamError

MIN_ROWS = 20

# One labelled row per request: its latest decisive event. Accepted = true; declined/dismissed/superseded = false.
_VIEW_SQL = f"""
CREATE OR REPLACE VIEW {TRAINING_VIEW} AS
SELECT {", ".join(FEATURE_COLUMNS)}, (LOWER(EVENT) = 'accepted') AS LABEL
FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY REQUEST_ID ORDER BY EVENT_TIME DESC) AS RN
    FROM {EVENTS_TABLE}
    WHERE LOWER(EVENT) IN ('accepted', 'declined', 'dismissed', 'superseded')
)
WHERE RN = 1
"""
_TRAIN_SQL = f"""
CREATE OR REPLACE SNOWFLAKE.ML.CLASSIFICATION {MODEL_NAME}(
    INPUT_DATA => SYSTEM$REFERENCE('VIEW', '{TRAINING_VIEW}'),
    TARGET_COLNAME => 'LABEL',
    CONFIG_OBJECT => {{'ON_ERROR': 'SKIP'}}
)
"""


def _train() -> tuple[float, int]:
    with snowflake_connection() as conn:
        run(conn, _VIEW_SQL)
        rows, positives = run(conn, f"SELECT COUNT(*), COUNT_IF(LABEL) FROM {TRAINING_VIEW}")[0]
        if rows < MIN_ROWS or positives in (0, rows):
            raise ConflictError("insufficient_data", f"Need at least {MIN_ROWS} labelled requests with both outcomes")
        run(conn, _TRAIN_SQL)
        metrics = run(conn, f"CALL {MODEL_NAME}!SHOW_GLOBAL_EVALUATION_METRICS()")
    # rows: (dataset, class, metric, value, error)
    auc = next((m[3] for m in metrics if m[1] == "macro" and str(m[2]).lower() == "auc"), None)
    if auc is None:
        raise UpstreamError("snowflake_no_metrics", "Snowflake returned no AUC metric")
    return float(auc), int(rows)


async def train_classifier() -> Classifier:
    auc, rows = await asyncio.to_thread(_train)
    trained_at = datetime.now(UTC)
    params: dict[str, Any] = {"auc": auc, "rows": rows, "at": trained_at}
    async with connection() as conn:
        await conn.execute(
            "UPDATE analytics_state SET classifier_auc = %(auc)s, classifier_rows = %(rows)s,"
            " classifier_trained_at = %(at)s WHERE id = 1",
            params,
        )
    return Classifier(auc=auc, rows=rows, trained_at=trained_at)
