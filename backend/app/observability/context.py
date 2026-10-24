import secrets
from contextvars import ContextVar

_request_id: ContextVar[str] = ContextVar("request_id", default="")


def new_request_id() -> str:
    return f"req_{secrets.token_hex(6)}"


def set_request_id(value: str) -> None:
    _request_id.set(value)


def get_request_id() -> str:
    return _request_id.get() or "req_background"
