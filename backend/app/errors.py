from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from psycopg import Error as DatabaseError

from app.observability.sanitize import sanitize_error


class AppError(Exception):
    status_code = 400

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class NotFoundError(AppError):
    status_code = 404


class ConflictError(AppError):
    status_code = 409


class UpstreamError(AppError):
    """A model or external service failed; surfaced as 502 (never as `type: "none"`)."""

    status_code = 502


def error_body(code: str, message: str) -> dict[str, dict[str, str]]:
    return {"error": {"code": code, "message": message}}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(request: Request, exc: AppError) -> JSONResponse:
        request.state.error_summary = f"{exc.code}: {exc.message}"
        return JSONResponse(error_body(exc.code, exc.message), status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        fields = ", ".join(".".join(str(p) for p in e["loc"][1:]) or "body" for e in exc.errors())
        request.state.error_summary = f"invalid_request: {fields}"
        return JSONResponse(error_body("invalid_request", f"Invalid fields: {fields}"), status_code=422)

    @app.exception_handler(DatabaseError)
    async def _database(request: Request, exc: DatabaseError) -> JSONResponse:
        request.state.error_summary = sanitize_error(exc)
        return JSONResponse(error_body("database_error", "Database unavailable"), status_code=503)
