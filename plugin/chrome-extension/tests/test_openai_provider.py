"""Offline checks for the cancellable local provider and original schemas."""
from __future__ import annotations

import asyncio
from contextlib import contextmanager
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import AsyncMock, patch

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'backend'))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx
from pydantic import BaseModel, Field

from app.errors import UpstreamError
from app.llm import gemini
from app.observability.context import set_request_id
from app.pipeline.complete import ReviewedCompletion, ReviewedGeneration
from app.pipeline.tags import TagExtraction
from app.pipeline.validate import MAX_GHOST_UNITS
from openai_provider import OpenAIProvider, strict_json_schema, review_candidate_count, allowed_response_types


class OptionalShape(BaseModel):
    note: str | None = None
    enabled: bool = False


def output(value, **overrides):
    return {
        'status': 'completed',
        'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': json.dumps(value)}]}],
        'usage': {'input_tokens': 20, 'output_tokens': 12},
        **overrides,
    }


class SchemaTests(unittest.TestCase):
    def test_optional_types_and_defaults_are_not_silently_dropped(self):
        schema = strict_json_schema(OptionalShape)
        self.assertEqual(schema['required'], ['note', 'enabled'])
        self.assertFalse(schema['additionalProperties'])
        self.assertEqual(schema['properties']['note']['anyOf'], [{'type': 'string'}, {'type': 'null'}])
        self.assertNotIn('default', schema['properties']['note'])
        self.assertEqual(OptionalShape.model_json_schema()['properties']['note']['default'], None)

    def test_nested_original_proposal_models_are_strict_and_retain_bounds(self):
        schema = strict_json_schema(ReviewedGeneration)
        self.assertFalse(schema['additionalProperties'])
        self.assertFalse(schema['$defs']['ProposalOption']['additionalProperties'])
        self.assertEqual(schema['$defs']['ProposalOption']['required'], ['label', 'op', 'anchor', 'text'])
        self.assertEqual(schema['properties']['scores']['items']['minimum'], 0)
        self.assertEqual(schema['properties']['scores']['items']['maximum'], 1)


    def test_core_suffix_limit_only_constrains_enhancement_text(self):
        constrained = strict_json_schema(ReviewedCompletion, operation='enhance.generate')
        self.assertEqual(constrained['properties']['text']['maxLength'], MAX_GHOST_UNITS)
        self.assertNotIn('maxLength', ReviewedCompletion.model_json_schema()['properties']['text'])
        self.assertNotIn('maxLength', strict_json_schema(ReviewedCompletion, operation='knowledge.summarise')['properties']['text'])

        class TighterText(BaseModel):
            text: str = Field(max_length=32)

        self.assertEqual(strict_json_schema(TighterText, operation='enhance.generate')['properties']['text']['maxLength'], 32)


    def test_actual_review_count_and_modes_bound_schema_with_context_reset(self):
        original = ReviewedGeneration.model_json_schema()
        count_token = review_candidate_count.set(3)
        mode_token = allowed_response_types.set(('none', 'autocomplete'))
        try:
            constrained = strict_json_schema(ReviewedGeneration, operation='enhance.generate')
            for name in ('keep', 'scores'):
                self.assertEqual(constrained['properties'][name]['minItems'], 3)
                self.assertEqual(constrained['properties'][name]['maxItems'], 3)
            self.assertEqual(constrained['properties']['type']['enum'], ['autocomplete', 'none'])
            other_operation = strict_json_schema(ReviewedGeneration, operation='knowledge.summarise')
            self.assertNotIn('minItems', other_operation['properties']['keep'])
            self.assertIn('multiple_choice', other_operation['properties']['type']['enum'])
        finally:
            allowed_response_types.reset(mode_token)
            review_candidate_count.reset(count_token)
        self.assertEqual(ReviewedGeneration.model_json_schema(), original)
        outside = strict_json_schema(ReviewedGeneration, operation='enhance.generate')
        self.assertNotIn('minItems', outside['properties']['keep'])
        self.assertIn('multiple_choice', outside['properties']['type']['enum'])
        self.assertIsNone(review_candidate_count.get())
        self.assertIsNone(allowed_response_types.get())

    def test_compact_without_candidates_skips_absent_fields(self):
        from app.pipeline.complete import Completion

        token = review_candidate_count.set(0)
        modes = allowed_response_types.set(('none', 'autocomplete'))
        try:
            constrained = strict_json_schema(Completion, operation='enhance.generate')
            self.assertEqual(set(constrained['properties']), {'completes_partial_word', 'text'})
        finally:
            allowed_response_types.reset(modes)
            review_candidate_count.reset(token)


class ProviderTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.provider = OpenAIProvider('test-in-memory-credential', model='gpt-4.1-mini')
        self.log = AsyncMock()
        self.log_patch = patch('app.observability.writers.record_ai_call', new=self.log)
        self.log_patch.start()
        self.addCleanup(self.log_patch.stop)
        set_request_id('qa_provider')

    @contextmanager
    def response(self, value):
        requests = []

        async def handle(request):
            requests.append(request)
            return httpx.Response(200, json=value)

        previous = self.provider._transport
        self.provider._transport = httpx.MockTransport(handle)
        try:
            yield requests
        finally:
            self.provider._transport = previous

    async def generate(self, schema=ReviewedCompletion, **options):
        return await self.provider.generate_structured(
            operation='enhance.generate', model='gemini-upstream-default',
            system='Original repository review and generation instructions.',
            contents='Original candidate bodies and private draft.', schema=schema,
            max_output_tokens=768, **options,
        )

    async def test_exact_review_model_round_trip_and_real_provider_metadata(self):
        value = {'keep': [True, False], 'scores': [0.9, 0.2], 'completes_partial_word': False, 'text': ' with jitter.'}
        with self.response(output(value)) as requests:
            result = await self.generate()
        self.assertIsInstance(result, ReviewedCompletion)
        self.assertEqual(result.keep, [True, False])
        self.assertEqual(result.text, ' with jitter.')
        request = requests[0]
        payload = json.loads(request.content)
        self.assertEqual(str(request.url), 'https://api.openai.com/v1/responses')
        self.assertEqual(payload['model'], 'gpt-4.1-mini')
        self.assertEqual(payload['instructions'], 'Original repository review and generation instructions.')
        self.assertEqual(payload['input'], 'Original candidate bodies and private draft.')
        self.assertEqual(payload['max_output_tokens'], 1024)
        self.assertFalse(payload['store'])
        self.assertTrue(payload['text']['format']['strict'])
        self.assertEqual(payload['text']['format']['schema'], strict_json_schema(ReviewedCompletion, operation='enhance.generate'))
        self.assertEqual(payload['text']['format']['schema']['properties']['text']['maxLength'], MAX_GHOST_UNITS)
        self.assertNotIn('maxLength', ReviewedCompletion.model_json_schema()['properties']['text'])
        logged = self.log.await_args.args
        self.assertEqual(logged[:4], ('qa_provider', 'enhance.generate', 'gpt-4.1-mini', 'ok'))
        self.assertEqual(logged[5:], (20, 12, None))
        self.assertNotIn('private draft', repr(logged))
        self.assertNotIn('test-in-memory-credential', repr(logged))
        self.assertNotIn('test-in-memory-credential', repr(self.provider))

    async def test_original_question_proposal_and_tag_schema_are_supported(self):
        proposal = {'keep': [True], 'scores': [0.8], 'type': 'multiple_choice', 'completes_partial_word': False,
                    'text': 'Which output?', 'options': [
                        {'label': 'A table', 'op': 'append', 'anchor': '', 'text': ' Return a table.'},
                        {'label': 'A list', 'op': 'append', 'anchor': '', 'text': ' Return a list.'}]}
        with self.response(output(proposal)):
            result = await self.generate(schema=ReviewedGeneration)
        self.assertIsInstance(result, ReviewedGeneration)
        self.assertEqual(result.options[0].text, ' Return a table.')
        tags = {'reuse_knowledge': False, 'tags': ['retry'], 'task_type': 'code_change',
                'missing_constraints': [], 'continuation_needed': True}
        with self.response(output(tags)):
            result = await self.generate(schema=TagExtraction)
        self.assertIsInstance(result, TagExtraction)
        self.assertEqual(result.tags, ['retry'])

    async def test_invalid_review_fields_are_sanitized_and_not_repaired(self):
        invalid = {'keep': ['yes'], 'scores': [7], 'completes_partial_word': False,
                   'text': 'private draft test-in-memory-credential'}
        with self.response(output(invalid)):
            with self.assertRaises(UpstreamError) as failure:
                await self.generate()
        self.assertEqual(failure.exception.code, 'upstream_invalid')
        self.assertNotIn('private draft', str(failure.exception))
        self.assertNotIn('test-in-memory-credential', str(failure.exception))
        self.assertEqual(self.log.await_args.args[3], 'error')
        self.assertEqual(self.log.await_args.args[-1], 'invalid structured output')

    async def test_incomplete_response_is_never_accepted(self):
        with self.response(output({}, status='incomplete')):
            with self.assertRaises(UpstreamError) as failure:
                await self.generate()
        self.assertEqual(failure.exception.code, 'upstream_invalid')

    async def test_http_failure_does_not_read_or_echo_sensitive_body(self):
        class UnreadBody(httpx.AsyncByteStream):
            read_calls = 0
            closed = False

            async def __aiter__(self):
                self.read_calls += 1
                yield b'private draft test-in-memory-credential'

            async def aclose(self):
                self.closed = True

        body = UnreadBody()
        self.provider._transport = httpx.MockTransport(lambda request: httpx.Response(429, stream=body))
        with self.assertRaises(UpstreamError) as failure:
            await self.generate()
        self.assertEqual(failure.exception.code, 'upstream_rate_limit')
        self.assertEqual(body.read_calls, 0)
        self.assertTrue(body.closed)
        self.assertNotIn('private', str(failure.exception))
        self.assertEqual(self.log.await_args.args[-1], 'HTTP 429')

    async def test_timeout_keeps_existing_error_contract(self):
        async def timeout(request):
            raise httpx.ReadTimeout('private transport detail', request=request)

        self.provider._transport = httpx.MockTransport(timeout)
        with self.assertRaises(UpstreamError) as failure:
            await self.generate()
        self.assertEqual(failure.exception.code, 'upstream_timeout')
        self.assertNotIn('private', str(failure.exception))
        self.assertEqual(self.log.await_args.args[-1], 'timeout')

    async def test_cancellation_propagates_and_closes_stream_and_client(self):
        started = asyncio.Event()

        class BlockingBody(httpx.AsyncByteStream):
            closed = False
            cancelled = False

            async def __aiter__(self):
                started.set()
                try:
                    await asyncio.Future()
                except asyncio.CancelledError:
                    self.cancelled = True
                    raise
                yield b'never read'

            async def aclose(self):
                self.closed = True

        body = BlockingBody()

        class TrackingTransport(httpx.AsyncBaseTransport):
            closed = False

            async def handle_async_request(self, request):
                return httpx.Response(200, stream=body)

            async def aclose(self):
                self.closed = True

        transport = TrackingTransport()
        self.provider._transport = transport
        task = asyncio.create_task(self.generate())
        await asyncio.wait_for(started.wait(), timeout=1)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertTrue(body.cancelled)
        self.assertTrue(body.closed)
        self.assertTrue(transport.closed)
        self.assertEqual(self.log.await_args.args[-1], 'cancelled')

    async def test_ping_uses_model_lookup_without_generation(self):
        with self.response({'id': 'gpt-4.1-mini'}) as requests:
            self.assertTrue(await self.provider.ping())
        self.assertEqual(requests[0].method, 'GET')
        self.assertEqual(str(requests[0].url), 'https://api.openai.com/v1/models/gpt-4.1-mini')
        self.log.assert_not_awaited()

    async def test_simultaneous_generation_contexts_do_not_share_review_counts(self):
        seen = []

        async def handle(request):
            properties = json.loads(request.content)['text']['format']['schema']['properties']
            count = properties['keep']['minItems']
            seen.append((count, properties['keep']['maxItems']))
            await asyncio.sleep(0)
            return httpx.Response(200, json=output({
                'keep': [True] * count, 'scores': [0.9] * count,
                'completes_partial_word': False, 'text': ' with jitter.',
            }))

        self.provider._transport = httpx.MockTransport(handle)

        async def generate_count(count):
            token = review_candidate_count.set(count)
            modes = allowed_response_types.set(('autocomplete', 'none'))
            try:
                result = await self.generate()
                self.assertEqual(len(result.keep), count)
            finally:
                allowed_response_types.reset(modes)
                review_candidate_count.reset(token)

        await asyncio.gather(generate_count(1), generate_count(3))
        self.assertCountEqual(seen, [(1, 1), (3, 3)])
        self.assertIsNone(review_candidate_count.get())
        self.assertIsNone(allowed_response_types.get())

    async def test_install_and_restore_never_change_embedding_function(self):
        generate, ping, embed = gemini.generate_structured, gemini.ping, gemini.embed
        restore = self.provider.install()
        self.addCleanup(restore)
        self.assertEqual(gemini.generate_structured, self.provider.generate_structured)
        self.assertEqual(gemini.ping, self.provider.ping)
        self.assertIs(gemini.embed, embed)
        restore()
        self.assertIs(gemini.generate_structured, generate)
        self.assertIs(gemini.ping, ping)
        self.assertIs(gemini.embed, embed)


if __name__ == '__main__':
    unittest.main()
