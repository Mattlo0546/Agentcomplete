"""Local composition root for the unchanged repository backend.

Only transport authentication, per-request native mode and the structured-model
provider are adapted. Routing, knowledge retrieval, review, validation, Tiger
persistence, source freshness, traces and application lifespan are the original
repository implementations. Nothing in backend/ is edited by this module.
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from contextvars import ContextVar
from functools import wraps
from pathlib import Path
import secrets
import sys
from typing import Any

BACKEND_ROOT = Path(__file__).resolve().parents[2] / 'backend'
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from fastapi.responses import JSONResponse
from app import settings_store
from app.config import get_settings
from app.db.pool import connection
from app.main import create_app
from app.pipeline import run as pipeline_run
from openai_provider import OpenAIProvider, review_candidate_count, allowed_response_types

NATIVE_HEADER = b'x-skill-issue-autocomplete-only'
native_request: ContextVar[bool] = ContextVar('skill_issue_native_request', default=False)
_original_generate_step = pipeline_run._generate_step


@wraps(_original_generate_step)
async def generate_with_provider_constraints(req, settings, extraction, candidates, allowed, *, full_bodies=False):
    """Expose existing dynamic invariants to the provider's response formatter."""
    count_token = review_candidate_count.set(len(candidates))
    types_token = allowed_response_types.set(tuple(allowed))
    try:
        return await _original_generate_step(
            req, settings, extraction, candidates, allowed, full_bodies=full_bodies
        )
    finally:
        allowed_response_types.reset(types_token)
        review_candidate_count.reset(count_token)


async def load_pipeline_settings():
    """Use actual persisted settings, copying only the native response-mode flag."""
    settings = await settings_store.load_settings()
    return settings.model_copy(update={'questions_enabled': False}) if native_request.get() else settings


class LocalTransport:
    def __init__(self, app, *, token: str):
        self.app, self._token = app, token

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        headers = dict(scope.get('headers', []))
        expected = ('Bearer ' + self._token).encode()
        if not secrets.compare_digest(headers.get(b'authorization', b''), expected):
            return await JSONResponse({'error': {'code': 'unauthorized', 'message': 'Unauthorized local bridge request.'}}, status_code=401)(scope, receive, send)
        flag = headers.get(NATIVE_HEADER, b'false')
        if flag not in (b'true', b'false'):
            return await JSONResponse({'error': {'code': 'invalid_request', 'message': 'Invalid native response mode.'}}, status_code=422)(scope, receive, send)
        native = flag == b'true' and scope.get('path') == '/v1/enhance'
        context = native_request.set(native)

        async def no_store(message):
            if message['type'] == 'http.response.start':
                message = {**message, 'headers': [*message.get('headers', []), (b'cache-control', b'no-store')]}
            await send(message)

        try:
            await self.app(scope, receive, no_store)
        finally:
            native_request.reset(context)


def create_local_app(api_key: str, token: str, model: str = 'gpt-4.1-mini'):
    if not token:
        raise ValueError('A local transport token is required.')
    api = create_app()
    original_lifespan = api.router.lifespan_context
    provider = OpenAIProvider(api_key, model=model, timeout_seconds=get_settings().llm_timeout_s)
    original_loader = pipeline_run.load_settings
    pipeline_run.load_settings = load_pipeline_settings
    previous_generate_step = pipeline_run._generate_step
    pipeline_run._generate_step = generate_with_provider_constraints
    model_fields = ('tag_model', 'judge_model', 'generate_model', 'autocomplete_model')

    @asynccontextmanager
    async def lifespan(app):
        config = get_settings()
        previous_models = {field: getattr(config, field) for field in model_fields}
        for field in model_fields:
            setattr(config, field, model)
        restore_provider = provider.install()
        try:
            # The original lifespan opens Tiger, migrates/warm settings, starts
            # catalog maintenance and flushes the original metadata writers.
            async with original_lifespan(app):
                yield
        finally:
            restore_provider()
            for field, value in previous_models.items():
                setattr(config, field, value)
            if pipeline_run.load_settings is load_pipeline_settings:
                pipeline_run.load_settings = original_loader
            if pipeline_run._generate_step is generate_with_provider_constraints:
                pipeline_run._generate_step = previous_generate_step

    api.router.lifespan_context = lifespan
    api.add_middleware(LocalTransport, token=token)
    api.state.architecture = 'repository-pipeline'
    api.state.provider = provider

    @api.get('/health', include_in_schema=False)
    async def local_health() -> dict[str, Any]:
        try:
            async with connection() as conn:
                row = await (await conn.execute('SELECT count(*) AS n FROM knowledge')).fetchone()
            return {'ready': True, 'model': model, 'knowledge_items': row['n'],
                    'architecture': 'repository-pipeline', 'storage': 'tiger',
                    'pipeline': 'app.pipeline.run.run_enhance'}
        except Exception:
            return {'ready': False, 'model': model, 'error': 'Repository database unavailable.'}

    return api
