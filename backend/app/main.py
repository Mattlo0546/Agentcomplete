import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import (
    analytics,
    enhance,
    handoff,
    health,
    knowledge,
    logs,
    outcomes,
    prompt_history,
    settings,
    stats,
    tags,
    traces,
)
from app.config import get_settings
from app.db.migrate import run_migrations
from app.db.pool import close_pool, open_pool
from app.errors import install_error_handlers
from app.observability.middleware import RequestLogMiddleware
from app.observability.writers import flush as flush_logs
from app.pipeline import catalog
from app.pipeline.trace import flush as flush_traces
from app.settings_store import start_settings_refresh, stop_settings_refresh

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    await open_pool()
    applied = await run_migrations()
    if applied:
        logging.getLogger(__name__).info("applied migrations: %s", ", ".join(applied))
    try:
        await start_settings_refresh()
        if get_settings().fast_autocomplete_enabled:
            await catalog.start()
        yield
    finally:
        await catalog.stop()
        await stop_settings_refresh()
        await flush_traces()
        await flush_logs()
        await close_pool()


def create_app() -> FastAPI:
    app = FastAPI(title="Prompt Enhance API", version="1.0.0", lifespan=lifespan)
    app.add_middleware(RequestLogMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=get_settings().cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID"],
    )
    install_error_handlers(app)
    for module in (
        enhance,
        traces,
        outcomes,
        knowledge,
        tags,
        handoff,
        prompt_history,
        logs,
        stats,
        settings,
        health,
        analytics,
    ):
        app.include_router(module.router, prefix="/v1")
    return app


app = create_app()
