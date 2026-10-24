from datetime import datetime
from typing import Any

from pydantic import BaseModel


class AiLog(BaseModel):
    time: datetime
    request_id: str
    operation: str
    model: str
    status: str
    latency_ms: int
    input_tokens: int | None = None
    output_tokens: int | None = None
    error: str | None = None


class ApiLog(BaseModel):
    time: datetime
    request_id: str
    method: str
    path: str
    status: int
    latency_ms: int
    error: str | None = None
    children: list[AiLog] = []


class Outcome(BaseModel):
    event: str
    time_to_action_ms: int | None


class LogDetail(BaseModel):
    api: ApiLog
    ai: list[AiLog]
    trace: dict[str, Any] | None = None
    outcome: Outcome | None = None
