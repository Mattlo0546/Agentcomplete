"""Snowflake table layout for flattened outcome events (derived features only, D1)."""

from typing import Any

MISSING_FLAGS = ("output_format", "scope", "language", "success_criteria", "context")

# (column, snowflake type, extractor over the postgres row)
COLUMNS: tuple[tuple[str, str], ...] = (
    ("REQUEST_ID", "VARCHAR"),
    ("EVENT", "VARCHAR"),
    ("EVENT_TIME", "TIMESTAMP_TZ"),
    ("TIME_TO_ACTION_MS", "NUMBER"),
    ("TASK_TYPE", "VARCHAR"),
    ("N_MISSING_CONSTRAINTS", "NUMBER"),
    *((f"MISSING_{flag.upper()}", "BOOLEAN") for flag in MISSING_FLAGS),
    ("PROMPT_UNITS", "NUMBER"),
    ("PROMPT_BUCKET", "VARCHAR"),
    ("N_TAGS", "NUMBER"),
    ("N_CANDIDATES", "NUMBER"),
    ("N_KEPT", "NUMBER"),
    ("TOP_SCORE", "FLOAT"),
    ("MEAN_KEPT_SCORE", "FLOAT"),
    ("TOP_TAG_SIMILARITY", "FLOAT"),
    ("GENERAL", "BOOLEAN"),
    ("SUGGESTION_TYPE", "VARCHAR"),
    ("N_OPTIONS", "NUMBER"),
    ("N_EDITS", "NUMBER"),
    ("LATENCY_MS", "NUMBER"),
)
# Everything the classifier may learn from: no identifiers, no time, no post-hoc timing.
FEATURE_COLUMNS = tuple(name for name, _ in COLUMNS[4:])
COLUMN_NAMES = tuple(name for name, _ in COLUMNS)

_SCALARS = (
    "task_type", "n_missing_constraints", "prompt_units", "prompt_bucket", "n_tags", "n_candidates",
    "n_kept", "top_score", "mean_kept_score", "top_tag_similarity", "general", "suggestion_type",
    "n_options", "n_edits", "latency_ms",
)  # fmt: skip


def flatten(row: dict[str, Any]) -> tuple[Any, ...]:
    """Map an `outcome_event` row to the Snowflake column order."""
    features: dict[str, Any] = row["features"] or {}
    missing = set(features.get("missing_constraints") or [])
    values: dict[str, Any] = {
        "REQUEST_ID": row["request_id"],
        "EVENT": row["event"],
        "EVENT_TIME": row["time"],
        "TIME_TO_ACTION_MS": row["time_to_action_ms"],
        **{f"MISSING_{flag.upper()}": flag in missing for flag in MISSING_FLAGS},
        **{key.upper(): features.get(key) for key in _SCALARS},
    }
    return tuple(values[name] for name in COLUMN_NAMES)


def create_table_sql(table: str) -> str:
    return f"CREATE TABLE IF NOT EXISTS {table} ({', '.join(f'{n} {t}' for n, t in COLUMNS)})"
