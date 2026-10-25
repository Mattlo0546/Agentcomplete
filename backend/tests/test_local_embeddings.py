"""Local-only runtime contract: no optional packages, model downloads, provider calls or database needed."""

import asyncio
import hashlib
import json
import logging
import threading
from collections.abc import AsyncIterator
from types import SimpleNamespace

import pytest

from app.llm import local_embeddings as local
from scripts import setup_local_embeddings as setup


@pytest.fixture(scope="session", autouse=True)
async def database() -> AsyncIterator[None]:
    yield


@pytest.fixture(autouse=True)
def reset(monkeypatch):
    monkeypatch.setattr(local, "_lock", asyncio.Lock())
    monkeypatch.setattr(local, "_pending", 0)
    monkeypatch.setattr(local, "_runtime", None)
    monkeypatch.setattr(local, "_jobs", {})
    monkeypatch.setattr(local, "_stopping", False)


def test_descriptor_is_cheap_and_changes_with_artifact_identity(monkeypatch, tmp_path):
    monkeypatch.setattr(local, "get_settings", lambda: SimpleNamespace(local_embedding_model_dir=str(tmp_path)))
    monkeypatch.setattr(local, "_dependencies_available", lambda: True)
    monkeypatch.setattr(local, "ARTIFACTS", {"model": (3, "unused")})
    monkeypatch.setattr(local, "verify_artifact", lambda *args: pytest.fail("preflight must not hash model"))
    assert local.descriptor() is None
    (tmp_path / "model").write_bytes(b"one")
    original = local.descriptor()
    assert original is not None and local.availability()
    replacement = tmp_path / "replacement"
    replacement.write_bytes(b"two")
    replacement.replace(tmp_path / "model")
    assert local.descriptor() != original
    monkeypatch.setattr(local, "_dependencies_available", lambda: False)
    assert not local.availability()


def test_prefixes_normalization_and_token_limit_without_truncation(monkeypatch):
    received = []
    calls = []

    class Tokenizer:
        def encode(self, text):
            received.append(text)
            length = local.MAX_TOKENS + 1 if "overflow" in text else local.MAX_TOKENS
            return SimpleNamespace(ids=[1] * length)

    class Runtime:
        tokenizer = Tokenizer()

        def infer(self, encoding):
            calls.append(len(encoding.ids))
            return [3.0, 4.0, *([0.0] * (local.DIMENSIONS - 2))]

    monkeypatch.setattr(local, "_load_runtime", lambda _: Runtime())
    config = local.Descriptor("unused")
    result = local._encode_sync(config, ("日本語",), "query", ("",), threading.Event())
    assert result[0][:2] == [0.6, 0.8]
    assert received == ["task: search result | query: 日本語"]
    local._encode_sync(config, ("body",), "document", ("Title",), threading.Event())
    assert received[-1] == "title: Title | text: body"
    with pytest.raises(local.InputTooLong):
        local._encode_sync(config, ("overflow",), "query", ("",), threading.Event())
    assert calls == [local.MAX_TOKENS, local.MAX_TOKENS]


@pytest.mark.parametrize("value", [0.0, float("nan"), float("inf")])
def test_invalid_embeddings_are_rejected(value):
    with pytest.raises(local.LocalEmbeddingError):
        local._normalize([value] * local.DIMENSIONS)
    with pytest.raises(local.LocalEmbeddingError):
        local._normalize([1.0] * (local.DIMENSIONS - 1))


async def test_cancellation_does_not_overlap_native_work_or_block_event_loop(monkeypatch):
    started = asyncio.Event()
    release = threading.Event()
    loop = asyncio.get_running_loop()
    calls = []
    monkeypatch.setattr(local, "descriptor", lambda: local.Descriptor("unused"))

    def encode(config, texts, task, titles, cancelled):
        calls.append(texts[0])
        if texts[0] == "first":
            loop.call_soon_threadsafe(started.set)
            assert release.wait(3)
        return [[1.0]]

    monkeypatch.setattr(local, "_encode_sync", encode)
    first = asyncio.create_task(local.embed(["first"], task="query"))
    await asyncio.wait_for(started.wait(), 2)
    second = asyncio.create_task(local.embed(["second"], task="query"))
    first.cancel()
    with pytest.raises(asyncio.CancelledError):
        await first
    await asyncio.sleep(0.01)  # The event loop remains usable while the first native worker is running.
    assert calls == ["first"]
    release.set()
    assert await asyncio.wait_for(second, 2) == [[1.0]]
    assert calls == ["first", "second"] and local._pending == 0


async def test_queue_is_bounded_and_cancelled_queued_job_does_not_compute(monkeypatch):
    started = asyncio.Event()
    release = threading.Event()
    loop = asyncio.get_running_loop()
    calls = []
    monkeypatch.setattr(local, "MAX_PENDING", 2)
    monkeypatch.setattr(local, "descriptor", lambda: local.Descriptor("unused"))

    def encode(config, texts, task, titles, cancelled):
        calls.append(texts[0])
        loop.call_soon_threadsafe(started.set)
        assert release.wait(3)
        return [[1.0]]

    monkeypatch.setattr(local, "_encode_sync", encode)
    first = asyncio.create_task(local.embed(["first"], task="query"))
    await asyncio.wait_for(started.wait(), 2)
    queued = asyncio.create_task(local.embed(["queued"], task="query"))
    await asyncio.sleep(0)
    with pytest.raises(local.LocalEmbeddingBusy):
        await local.embed(["overflow"], task="query")
    queued.cancel()
    with pytest.raises(asyncio.CancelledError):
        await queued
    release.set()
    await asyncio.wait_for(first, 2)
    await asyncio.sleep(0)
    assert calls == ["first"] and local._pending == 0


async def test_stop_waits_for_native_work_and_skips_queued_jobs(monkeypatch):
    started = asyncio.Event()
    release = threading.Event()
    loop = asyncio.get_running_loop()
    calls = []
    monkeypatch.setattr(local, "descriptor", lambda: local.Descriptor("unused"))

    def encode(config, texts, task, titles, cancelled):
        calls.append(texts[0])
        loop.call_soon_threadsafe(started.set)
        assert release.wait(3)
        return [[1.0]]

    monkeypatch.setattr(local, "_encode_sync", encode)
    first = asyncio.create_task(local.embed(["first"], task="query"))
    await asyncio.wait_for(started.wait(), 2)
    queued = asyncio.create_task(local.embed(["queued"], task="query"))
    await asyncio.sleep(0)
    shutdown = asyncio.create_task(local.stop())
    await asyncio.sleep(0)
    assert not shutdown.done()
    with pytest.raises(local.LocalEmbeddingError, match="stopping"):
        await local.embed(["late"], task="query")
    release.set()
    await asyncio.wait_for(shutdown, 2)
    await first
    with pytest.raises(asyncio.CancelledError):
        await queued
    assert calls == ["first"] and local._pending == 0 and not local._jobs


def test_setup_verifies_hash_before_publishing_and_writes_manifest(monkeypatch, tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    (source / "model").write_bytes(b"good")
    expected = hashlib.sha256(b"good").hexdigest()
    monkeypatch.setattr(setup, "ARTIFACTS", {"model": (4, expected)})
    destination = tmp_path / "destination"
    setup.install(destination, source)
    assert (destination / "model").read_bytes() == b"good"
    assert json.loads((destination / "manifest.json").read_text())["artifacts"]["model"]["sha256"] == expected
    (source / "model").write_bytes(b"evil")
    (destination / "model").unlink()
    with pytest.raises(local.LocalEmbeddingError, match="checksum"):
        setup.install(destination, source)
    assert not (destination / "model").exists()
    assert not list(destination.glob(".download-*"))


async def test_unavailable_runtime_and_invalid_call_shape(monkeypatch):
    monkeypatch.setattr(local, "descriptor", lambda: None)
    with pytest.raises(local.LocalEmbeddingError, match="unavailable"):
        await local.embed(["query"], task="query")
    with pytest.raises(ValueError, match="titles"):
        await local.embed(["query"], task="query", titles=["title"])
    assert await local.embed([], task="query") == []


async def test_query_phase_timings_do_not_log_input_or_change_vectors(monkeypatch, caplog):
    class Tokenizer:
        def encode(self, text):
            return SimpleNamespace(ids=[1, 2, 3])

    class Runtime:
        tokenizer = Tokenizer()

        def infer(self, encoding):
            return [3.0, 4.0, *([0.0] * (local.DIMENSIONS - 2))]

    monkeypatch.setattr(local, "descriptor", lambda: local.Descriptor("unused"))
    monkeypatch.setattr(local, "_load_runtime", lambda _: Runtime())
    monkeypatch.setattr(local, "get_request_id", lambda: "synthetic-request")
    with caplog.at_level(logging.INFO, logger=local.__name__):
        result = await local.embed(["private query must never be logged"], task="query", operation="test.query")
    assert result[0][:2] == [0.6, 0.8]
    assert "private query" not in caplog.text
    assert "request_id=synthetic-request operation=test.query task=query status=ok" in caplog.text
    for field in ("queue_ms", "dispatch_ms", "runtime_ms", "tokenize_ms", "inference_ms", "total_ms"):
        assert f"{field}=" in caplog.text
    assert "tokens=3" in caplog.text
    assert local._timings.get() is None
