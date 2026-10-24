import time

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from app.observability.context import new_request_id, set_request_id
from app.observability.writers import record_api_call

_REQUEST_ID_HEADER = "X-Request-ID"
_SKIP_PATHS = ("/v1/logs", "/v1/stats", "/v1/health")


class RequestLogMiddleware(BaseHTTPMiddleware):
    """Assigns a request id, echoes it back, and records one api_call_log row per request."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        request_id = request.headers.get(_REQUEST_ID_HEADER) or new_request_id()
        set_request_id(request_id)
        request.state.request_id = request_id
        started = time.perf_counter()
        response = await call_next(request)
        response.headers[_REQUEST_ID_HEADER] = request_id
        path = request.url.path
        if request.method != "OPTIONS" and path.startswith("/v1/") and not path.startswith(_SKIP_PATHS):
            latency_ms = int((time.perf_counter() - started) * 1000)
            error = getattr(request.state, "error_summary", None)
            await record_api_call(request_id, request.method, path, response.status_code, latency_ms, error)
        return response
