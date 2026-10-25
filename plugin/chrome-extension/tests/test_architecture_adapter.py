"""Exercise the original API/catalog/review pipeline with only external IO faked.

No alternate routing or generation implementation is used here. Snapshot rows
stand in for Tiger reads; OpenAI HTTP responses stand in for network transport.
"""
import json
import os
from pathlib import Path
import re
import sys
import time
from unittest.mock import AsyncMock
from uuid import UUID
from contextlib import asynccontextmanager

os.environ['GEMINI_API_KEY'] = 'offline-adapter-fixture'
os.environ['DATABASE_URL'] = 'postgresql://offline:offline@127.0.0.1:1/offline'
ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(REPO / 'backend'))

import httpx
import pytest
import pytest_asyncio
from fastapi.routing import APIRoute
from app import main, settings_store
from app.api import enhance as enhance_api
from app.llm import gemini
from app.observability import middleware
from app.pipeline import catalog, retrieve, run
from app.settings_store import AppSettings
from backend_adapter import create_local_app, native_request
from openai_provider import OpenAIProvider

pytestmark = pytest.mark.asyncio

TOKEN = 'offline-local-token'


def corpus_row(number, title, body, tags):
    return {'id': UUID(int=number), 'kind': 'skill', 'title': title,
            'summary': title, 'body': body, 'tags': tags}


@pytest_asyncio.fixture
async def architecture(monkeypatch):
    cfg = run.get_settings()
    monkeypatch.setattr(cfg, 'catalog_review_enabled', True)
    monkeypatch.setattr(cfg, 'fast_autocomplete_enabled', True)
    monkeypatch.setattr(settings_store, '_cached', AppSettings(questions_enabled=True))
    monkeypatch.setattr(settings_store, '_expires_at', time.monotonic() + 60)
    monkeypatch.setattr(run, 'load_settings', settings_store.load_settings)
    retrieve.invalidate_cache()
    retrieve._embeddings.clear()
    rows = [
        corpus_row(1, 'HTTP retry exponential backoff', 'Use jitter and idempotency. Keep this final source constraint.', ['retry', 'http-client']),
        corpus_row(2, 'Unrelated responsive React layout', 'Use responsive columns.', ['react', 'layout']),
    ]
    snapshot = catalog.build_snapshot(rows, time.monotonic(), retrieve.cache_generation())
    monkeypatch.setattr(catalog, '_snapshot', snapshot)
    # Background/DB IO boundaries, not pipeline algorithms.
    startup = {}
    for name in ('open_pool', 'close_pool', 'start_settings_refresh', 'stop_settings_refresh', 'flush_traces', 'flush_logs'):
        startup[name] = AsyncMock()
        monkeypatch.setattr(main, name, startup[name])
    monkeypatch.setattr(main, 'run_migrations', AsyncMock(return_value=[]))
    monkeypatch.setattr(catalog, 'start', AsyncMock())
    monkeypatch.setattr(catalog, 'stop', AsyncMock())
    traces = AsyncMock()
    monkeypatch.setattr(run, 'save_trace', traces)
    monkeypatch.setattr(run, 'wait_for_capacity', AsyncMock())
    monkeypatch.setattr(middleware, 'record_api_call', AsyncMock())
    monkeypatch.setattr(OpenAIProvider, '_log', AsyncMock())
    state = {'calls': [], 'bad_reviews': 0, 'invalidate': False, 'snapshot': snapshot,
             'rows': rows, 'traces': traces, 'startup': startup}

    async def request(_self, path, payload=None):
        assert path == 'responses'
        state['calls'].append(payload)
        name = payload['text']['format']['name']
        if name == 'TagExtraction':
            result = {'reuse_knowledge': False, 'tags': ['adapter-transient'],
                      'task_type': 'code_change', 'missing_constraints': [], 'continuation_needed': False}
        else:
            count = len(re.findall(r'<knowledge candidate=', payload['input']))
            result = {'keep': [True] + [False] * (count - 1) if count else [],
                      'scores': [0.9] + [0.0] * (count - 1) if count else [],
                      'completes_partial_word': False, 'text': ' Add jitter and idempotency.'}
            if name == 'ReviewedGeneration':
                result.update(type='autocomplete', options=[])
            if state['bad_reviews']:
                state['bad_reviews'] -= 1
                result['keep'] = []
                result['scores'] = []
            if state['invalidate']:
                retrieve.invalidate_cache()
        return {'status': 'completed', 'output': [{'type': 'message', 'content': [
            {'type': 'output_text', 'text': json.dumps(result)}]}], 'usage': {}}

    monkeypatch.setattr(OpenAIProvider, '_request', request)
    original_embed = gemini.embed
    app = create_local_app('offline-credential', TOKEN, 'gpt-4.1-mini')
    state['app'] = app
    state['original_embed'] = original_embed
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://127.0.0.1') as client:
            state['client'] = client
            yield state
    for name in ('open_pool', 'close_pool', 'start_settings_refresh', 'stop_settings_refresh', 'flush_traces', 'flush_logs'):
        startup[name].assert_awaited_once()
    assert gemini.embed is original_embed


def payload(id='adapter-request', prompt='Implement safe HTTP retries.'):
    return {'request_id': id, 'prompt': prompt, 'prompt_revision': 3,
            'cursor': len(prompt.encode('utf-16-le')) // 2}


def headers(native=True):
    return {'Authorization': 'Bearer ' + TOKEN,
            'X-Skill-Issue-Autocomplete-Only': 'true' if native else 'false'}


def original_routes(routes, prefix=''):
    """FastAPI versions may retain included routers lazily; inspect those too."""
    for route in routes:
        if isinstance(route, APIRoute):
            yield prefix + route.path, frozenset(route.methods or ()), route.endpoint
        elif hasattr(route, 'original_router'):
            yield from original_routes(route.original_router.routes, prefix + route.include_context.prefix)


async def test_original_api_routes_lifespan_and_embedding_identity(architecture):
    app = architecture['app']
    expected = set(original_routes(main.create_app().routes))
    actual = set(original_routes(app.routes))
    assert expected and expected <= actual
    route = next(endpoint for path, _methods, endpoint in actual if path == '/v1/enhance')
    assert route is enhance_api.enhance
    assert enhance_api.run_enhance is run.run_enhance
    assert app.state.architecture == 'repository-pipeline'
    assert gemini.embed is architecture['original_embed']
    architecture['startup']['open_pool'].assert_awaited_once()


@pytest.mark.parametrize('authorization', [None, 'Bearer wrong-token'])
async def test_local_auth_rejects_before_original_pipeline(architecture, authorization):
    response = await architecture['client'].post('/v1/enhance', json=payload(),
        headers={} if authorization is None else {'Authorization': authorization})
    assert response.status_code == 401
    assert not architecture['calls']
    architecture['traces'].assert_not_awaited()


@pytest.mark.parametrize('complete_catalog,expected_model,expected_candidates', [
    (True, 'tiger-complete-catalog', 2), (False, 'tiger-lexical', 1)])
async def test_real_catalog_selection_review_generation_and_validation(architecture, monkeypatch, complete_catalog, expected_model, expected_candidates):
    monkeypatch.setattr(run.get_settings(), 'catalog_review_enabled', complete_catalog)
    response = await architecture['client'].post('/v1/enhance', json=payload(), headers=headers())
    assert response.status_code == 200, response.text
    assert response.json()['type'] == 'autocomplete'
    assert response.json()['text'] == ' Add jitter and idempotency.'
    assert response.headers['cache-control'] == 'no-store'
    calls = architecture['calls']
    assert len(calls) == 1
    assert calls[0]['input'].count('<knowledge candidate=') == expected_candidates
    assert 'Keep this final source constraint.' in calls[0]['input']
    assert calls[0]['text']['format']['name'] == 'ReviewedCompletion'
    trace = architecture['traces'].call_args.kwargs
    assert next(step.model for step in trace['steps'] if step.step == 'retrieve') == expected_model
    assert len(trace['knowledge']) == expected_candidates
    assert trace['knowledge'][0].kept
    assert trace['used_knowledge'] == [UUID(int=1)]


async def test_native_mode_is_request_scoped_and_keeps_persisted_settings(architecture):
    for native in (True, False):
        response = await architecture['client'].post('/v1/enhance', json=payload(id=f'mode-{native}'), headers=headers(native))
        assert response.status_code == 200
        assert native_request.get() is False
        assert settings_store._cached.questions_enabled is True
    assert [item['text']['format']['name'] for item in architecture['calls']] == ['ReviewedCompletion', 'ReviewedGeneration']
    assert 'multiple_choice' not in architecture['calls'][0]['input'].split('</settings>')[0]
    assert 'multiple_choice' in architecture['calls'][1]['input'].split('</settings>')[0]


async def test_original_semantic_tag_and_pgvector_fallback_is_retained(architecture, monkeypatch):
    cfg = run.get_settings()
    monkeypatch.setattr(cfg, 'catalog_review_enabled', False)
    monkeypatch.setattr(cfg, 'fast_autocomplete_enabled', False)
    embedded = AsyncMock(return_value=[[0.1] * cfg.embed_dims])
    monkeypatch.setattr(gemini, 'embed', embedded)
    sql_calls = []

    class Cursor:
        def __init__(self, value): self.value = value
        async def fetchone(self): return self.value

    class Connection:
        async def execute(self, sql, params=None):
            sql_calls.append((sql, params))
            if 'SELECT EXISTS' in sql:
                return Cursor({'present': True})
            return Cursor({'tag_similarity': {'1': 0.97}, 'candidates': [{
                'id': str(UUID(int=1)), 'kind': 'skill', 'title': 'HTTP retries',
                'summary': 'Transient failures', 'body': 'Use jitter and idempotency.',
                'similarity': 0.97, 'matched_tags': ['adapter-transient']}]})

    @asynccontextmanager
    async def connection():
        yield Connection()

    monkeypatch.setattr(retrieve, 'connection', connection)
    response = await architecture['client'].post('/v1/enhance', json=payload(id='semantic-request'), headers=headers())
    assert response.status_code == 200, response.text
    assert response.json()['type'] == 'autocomplete'
    assert [call['text']['format']['name'] for call in architecture['calls']] == ['TagExtraction', 'ReviewedCompletion']
    embedded.assert_awaited_once_with(['adapter-transient'], operation='enhance.embed')
    assert cfg.embed_model == 'gemini-embedding-001'
    assert any('embedding <=>' in sql for sql, _ in sql_calls)
    trace = architecture['traces'].call_args.kwargs
    assert trace['tags'][0].similarity == 0.97
    assert next(step.model for step in trace['steps'] if step.step == 'retrieve') == cfg.embed_model
    # The fixture intentionally substitutes external embedding IO; restore the
    # function before the fixture's provider-identity teardown assertion.
    monkeypatch.setattr(gemini, 'embed', architecture['original_embed'])


async def test_original_invalid_review_retry_and_source_freshness_rules(architecture):
    architecture['bad_reviews'] = 1
    response = await architecture['client'].post('/v1/enhance', json=payload(id='retry-review'), headers=headers())
    assert response.status_code == 200 and response.json()['type'] == 'autocomplete'
    assert len(architecture['calls']) == 2
    assert 'previous_attempt_rejected' in architecture['calls'][1]['input']
    trace = architecture['traces'].call_args.kwargs
    assert 'retried' in next(step.detail for step in trace['steps'] if step.step == 'generate')
    architecture['invalidate'] = True
    response = await architecture['client'].post('/v1/enhance', json=payload(id='source-changed'), headers=headers())
    assert response.status_code == 200 and response.json()['type'] == 'none'
    trace = architecture['traces'].call_args.kwargs
    assert trace['used_knowledge'] == []
    assert 'knowledge changed or expired' in next(step.detail for step in trace['steps'] if step.step == 'generate')
