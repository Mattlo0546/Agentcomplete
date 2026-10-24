import re

_SECRET_PATTERNS = [
    re.compile(r"AIza[0-9A-Za-z_-]{20,}"),
    re.compile(r"AQ\.[0-9A-Za-z_.-]{20,}"),
    re.compile(r"(?i)(api[_-]?key|password|token|secret)=([^&\s]+)"),
    re.compile(r"postgres(?:ql)?://[^\s]+"),
]


def sanitize_error(exc: BaseException | str, limit: int = 300) -> str:
    """Error text safe to log: class name + message with secrets and connection strings removed."""
    text = exc if isinstance(exc, str) else f"{type(exc).__name__}: {exc}"
    for pattern in _SECRET_PATTERNS:
        text = pattern.sub("<redacted>", text)
    return text[:limit]
