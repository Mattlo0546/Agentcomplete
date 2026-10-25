"""Local OpenAI provider for the repository's unchanged structured pipeline.

This is a process-local provider substitution, not a second generation pipeline.
The caller's Pydantic schemas, review arrays, prompt instructions and downstream
validation remain authoritative. Existing Gemini embeddings are left unchanged
because Tiger's stored tag vectors must be queried with their original model.
"""
from __future__ import annotations

import asyncio
from copy import deepcopy
from contextvars import ContextVar
import json
import re
import time
from typing import Any, Callable, TypeVar

import httpx

from pydantic import BaseModel, ValidationError

from app.errors import UpstreamError
from app.pipeline.validate import MAX_GHOST_UNITS

ModelT = TypeVar('ModelT', bound=BaseModel)

# Set only by the local composition wrapper around the actual generation step.
# Task-local metadata comes from validated candidates/modes, never prompt parsing.
review_candidate_count: ContextVar[int | None] = ContextVar('review_candidate_count', default=None)
allowed_response_types: ContextVar[tuple[str, ...] | None] = ContextVar('allowed_response_types', default=None)


def strict_json_schema(schema: type[BaseModel], *, operation: str | None = None) -> dict[str, Any]:
    """Adapt Pydantic's object defaults to OpenAI's strict object contract.

    Field types, references, enums, bounds, nullable alternatives and array shapes
    are retained. A field with a default becomes required in the wire schema;
    Pydantic still validates the actual model instance after the response arrives.
    """
    document = deepcopy(schema.model_json_schema())

    def visit(node: Any) -> None:
        if isinstance(node, list):
            for value in node:
                visit(value)
        elif isinstance(node, dict):
            node.pop('default', None)
            if node.get('type') == 'object' or 'properties' in node:
                properties = node.get('properties', {})
                if not isinstance(properties, dict):
                    raise ValueError('Object schema properties must be explicit.')
                if isinstance(node.get('additionalProperties'), dict):
                    raise ValueError('Dynamic object fields need an explicit pipeline schema.')
                node['required'] = list(properties)
                node['additionalProperties'] = False
            for value in node.values():
                visit(value)

    visit(document)
    if operation == 'enhance.generate':
        # Express the unchanged core limit in the provider response format.
        # JSON Schema counts characters; the original validator still checks
        # the stricter UTF-16 unit count after the model returns its response.
        text = document.get('properties', {}).get('text')
        if isinstance(text, dict) and text.get('type') == 'string':
            text['maxLength'] = min(text.get('maxLength', MAX_GHOST_UNITS), MAX_GHOST_UNITS)
        properties = document.get('properties', {})
        count = review_candidate_count.get()
        if count is not None:
            if type(count) is not int or count < 0:
                raise ValueError('Review candidate count must be a non-negative integer.')
            for name in ('keep', 'scores'):
                field = properties.get(name)
                if isinstance(field, dict) and field.get('type') == 'array':
                    field['minItems'] = field['maxItems'] = count
        allowed = allowed_response_types.get()
        field = properties.get('type')
        if allowed is not None and isinstance(field, dict) and isinstance(field.get('enum'), list):
            values = [value for value in field['enum'] if value in allowed]
            if not values:
                raise ValueError('Response types must overlap the original pipeline schema.')
            field['enum'] = values
    return document


class OpenAIProvider:
    """In-memory credential and bounded transport for existing pipeline calls."""

    def __init__(self, api_key: str, model: str = 'gpt-4.1-mini', *, timeout_seconds: float = 22.0,
                 transport: httpx.AsyncBaseTransport | None = None):
        if not isinstance(api_key, str) or not api_key:
            raise ValueError('An OpenAI credential is required.')
        if not isinstance(model, str) or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,100}', model):
            raise ValueError('An explicit OpenAI model name is required.')
        if not 0 < timeout_seconds <= 120:
            raise ValueError('Provider timeout must be between zero and 120 seconds.')
        self._api_key = api_key
        self.model = model
        self.timeout_seconds = timeout_seconds
        self._transport = transport

    async def _request(self, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        # Both contexts unwind on task cancellation, closing an in-flight stream
        # and its client instead of leaving a worker-thread request running.
        async with httpx.AsyncClient(
            timeout=self.timeout_seconds, follow_redirects=False, transport=self._transport,
        ) as client:
            async with client.stream(
                'POST' if payload is not None else 'GET',
                'https://api.openai.com/v1/' + path,
                headers={'Authorization': f'Bearer {self._api_key}', 'Content-Type': 'application/json'},
                **({'json': payload} if payload is not None else {}),
            ) as response:
                response.raise_for_status()
                # Do not read failed-response bodies: they may echo user input.
                result = json.loads(await response.aread())
        if not isinstance(result, dict):
            raise ValueError('Expected an OpenAI response object.')
        return result

    async def generate_structured(
        self,
        *,
        operation: str,
        model: str,
        system: str,
        contents: str,
        schema: type[ModelT],
        temperature: float = 0.2,
        thinking_level: str | None = None,
        max_output_tokens: int | None = None,
    ) -> ModelT:
        """Match app.llm.gemini.generate_structured while changing only provider.

        ``model`` and ``thinking_level`` are the upstream provider interface; this
        local adapter routes every structured call to its explicitly configured
        OpenAI model. It does not append replacement generation instructions.
        """
        started = time.perf_counter()
        usage: dict[str, Any] = {}
        error: str | None = None
        try:
            payload = {
                'model': self.model,
                'store': False,
                'instructions': system,
                'input': contents,
                # Review arrays and the suggestion share the output budget.
                'max_output_tokens': min(4096, max(1024, max_output_tokens or 2048)),
                'temperature': temperature,
                'text': {'format': {
                    'type': 'json_schema',
                    'name': re.sub(r'[^A-Za-z0-9_-]', '_', schema.__name__)[:64],
                    'strict': True,
                    'schema': strict_json_schema(schema, operation=operation),
                }},
            }
            response = await asyncio.wait_for(
                self._request('responses', payload),
                timeout=self.timeout_seconds + 0.5,
            )
            usage = response.get('usage') if isinstance(response.get('usage'), dict) else {}
            if response.get('status') in {'incomplete', 'failed', 'cancelled'} or response.get('error'):
                raise ValueError('OpenAI did not complete the structured response.')
            output = ''.join(
                content.get('text', '')
                for item in response.get('output', []) if isinstance(item, dict) and item.get('type') == 'message'
                for content in item.get('content', [])
                if isinstance(content, dict) and content.get('type') == 'output_text'
            )
            return schema.model_validate_json(output)
        except asyncio.CancelledError:
            error = 'cancelled'
            raise
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            error = f'HTTP {status}'
            code = 'upstream_rate_limit' if status == 429 else 'upstream_error'
            message = {
                401: 'OpenAI rejected the configured API key.',
                403: 'OpenAI denied access to the configured model.',
                429: 'OpenAI quota or rate limit reached.',
            }.get(status, f'OpenAI returned HTTP {status}.')
            raise UpstreamError(code, message) from None
        except (TimeoutError, httpx.TimeoutException):
            error = 'timeout'
            raise UpstreamError('upstream_timeout', f'{operation} timed out') from None
        except (ValidationError, ValueError, TypeError, KeyError):
            error = 'invalid structured output'
            raise UpstreamError('upstream_invalid', f'{operation} returned invalid output') from None
        except (httpx.RequestError, OSError):
            error = 'network error'
            raise UpstreamError('upstream_error', f'{operation} could not reach OpenAI') from None
        except Exception:
            error = 'provider error'
            raise UpstreamError('upstream_error', f'{operation} failed') from None
        finally:
            await self._log(operation, started, usage, error)

    async def _log(self, operation: str, started: float, usage: dict[str, Any], error: str | None) -> None:
        """Log only existing operation/model/status/usage metadata, never content."""
        try:
            from app.observability.context import get_request_id
            from app.observability.writers import record_ai_call

            def tokens(name: str) -> int | None:
                value = usage.get(name)
                return value if type(value) is int and value >= 0 else None

            await record_ai_call(
                get_request_id(), operation, self.model, 'error' if error else 'ok',
                int((time.perf_counter() - started) * 1000),
                tokens('input_tokens'), tokens('output_tokens'), error,
            )
        except Exception:
            # Observability must not turn a valid response into an API failure.
            pass

    async def ping(self) -> bool:
        """Check configured model access without generating tokens."""
        try:
            response = await asyncio.wait_for(
                self._request('models/' + self.model),
                timeout=self.timeout_seconds + 0.5,
            )
            return response.get('id') == self.model
        except Exception:
            return False

    def install(self) -> Callable[[], None]:
        """Install only structured generation/health hooks in this Python process.

        Returns an undo callback. Crucially, gemini.embed is never reassigned.
        """
        from app.llm import gemini

        previous_generate, previous_ping = gemini.generate_structured, gemini.ping
        generate, ping = self.generate_structured, self.ping
        gemini.generate_structured, gemini.ping = generate, ping

        def restore() -> None:
            if gemini.generate_structured == generate:
                gemini.generate_structured = previous_generate
            if gemini.ping == ping:
                gemini.ping = previous_ping

        return restore
