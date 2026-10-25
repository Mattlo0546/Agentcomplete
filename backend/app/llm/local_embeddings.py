"""Optional, pinned local Google embeddings. Never downloads models or sends input over the network."""

import asyncio
import hashlib
import importlib.util
import logging
import math
import threading
import time
from contextvars import ContextVar
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from app.config import get_settings
from app.observability.context import get_request_id

log = logging.getLogger(__name__)
MODEL = "onnx-community/embeddinggemma-2-ONNX"
REVISION = "daa72c51243991dfcaf9f9137d2c573d8f7790c0"
DIMENSIONS = 768
MAX_TOKENS = 8192
MAX_PENDING = 4
# Relative path: (size, SHA256). Only these three files are needed for text inference.
ARTIFACTS = {
    "tokenizer.json": (32170510, "4d777ef5bdc1aa36227abdfb77c3e49e7b9c892d16e1b6bda41c393504828be4"),
    "onnx/model_quantized.onnx": (495165, "d06edd601f851c633a2519304cbeb8dc6170d7ceb61b436625c17fb9b6e74953"),
    "onnx/model_quantized.onnx_data": (313724928, "278a7ff1248c3618e4bd11a607fc54f7bdc7778854230f3956d3f86bd9db4f3b"),
}


class LocalEmbeddingError(RuntimeError):
    """The optional local encoder cannot produce a verified vector."""


class LocalEmbeddingBusy(LocalEmbeddingError):
    """The bounded local inference queue is full."""


class InputTooLong(LocalEmbeddingError):
    """Input exceeds the model context; callers must route or chunk it explicitly."""


@dataclass(frozen=True)
class Descriptor:
    model_dir: str
    model: str = MODEL
    revision: str = REVISION
    dimensions: int = DIMENSIONS
    preprocessing: str = "search-prefix-v1"
    artifact_identity: tuple[tuple[str, int, int, int], ...] = ()


@lru_cache(maxsize=1)
def _dependencies_available() -> bool:
    # A process restart is required after installing the optional runtime.
    return all(importlib.util.find_spec(name) is not None for name in ("numpy", "onnxruntime", "tokenizers"))


def descriptor() -> Descriptor | None:
    """Cheap preflight; heavyweight imports, file hashes and session loading happen in the worker."""
    directory = getattr(get_settings(), "local_embedding_model_dir", None)
    if not directory or not _dependencies_available():
        return None
    try:
        path = Path(directory).expanduser().resolve()
        identities = []
        for name, (size, _) in ARTIFACTS.items():
            info = (path / name).stat()
            if info.st_size != size:
                return None
            identities.append((name, info.st_size, info.st_mtime_ns, info.st_ino))
    except (OSError, RuntimeError):
        return None
    return Descriptor(str(path), artifact_identity=tuple(identities))


def availability() -> bool:
    return descriptor() is not None


def verify_artifact(path: Path, expected_size: int, expected_hash: str) -> None:
    if path.stat().st_size != expected_size:
        raise LocalEmbeddingError("local embedding artifact size mismatch")
    with path.open("rb") as source:
        actual = hashlib.file_digest(source, "sha256").hexdigest()
    if actual != expected_hash:
        raise LocalEmbeddingError("local embedding artifact checksum mismatch")


@dataclass
class _Runtime:
    config: Descriptor
    tokenizer: Any
    session: Any
    numpy: Any

    def infer(self, encoding: Any) -> list[float]:
        np = self.numpy
        inputs = {
            "input_ids": np.asarray([encoding.ids], dtype=np.int64),
            "attention_mask": np.asarray([encoding.attention_mask], dtype=np.int64),
            **{
                name: np.empty((0, 512), dtype=np.float32)
                for name in ("image_features", "video_features", "audio_features")
            },
        }
        output = self.session.run(["sentence_embedding"], inputs)[0]
        if output.shape != (1, DIMENSIONS):
            raise LocalEmbeddingError("local embedding output shape mismatch")
        return [float(value) for value in output[0]]


_runtime: _Runtime | None = None
_lock = asyncio.Lock()
_pending = 0
_jobs: dict[asyncio.Task[list[list[float]]], threading.Event] = {}
_stopping = False


@dataclass
class _Timings:
    queue_ms: float = 0.0
    dispatched_at: float = 0.0
    dispatch_ms: float = 0.0
    runtime_ms: float = 0.0
    tokenize_ms: float = 0.0
    inference_ms: float = 0.0
    tokens: int = 0
    worker: int = 0


# asyncio.to_thread copies the job context. This keeps diagnostics local to one
# job without changing the encoder's return contract or retaining input text.
_timings: ContextVar[_Timings | None] = ContextVar("local_embedding_timings", default=None)


def _load_runtime(config: Descriptor) -> _Runtime:
    global _runtime
    if _runtime is not None and _runtime.config == config:
        return _runtime
    directory = Path(config.model_dir)
    for name, (size, checksum) in ARTIFACTS.items():
        verify_artifact(directory / name, size, checksum)
    # Imports and native session creation can block, so this function is only called in to_thread.
    import numpy as np
    import onnxruntime as ort
    from tokenizers import Tokenizer

    ort.disable_telemetry_events()
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(
        str(directory / "onnx/model_quantized.onnx"), options, providers=["CPUExecutionProvider"]
    )
    tokenizer = Tokenizer.from_file(str(directory / "tokenizer.json"))
    tokenizer.no_truncation()
    tokenizer.no_padding()
    _runtime = _Runtime(config, tokenizer, session, np)
    return _runtime


def _normalize(values: list[float]) -> list[float]:
    if len(values) != DIMENSIONS or not all(math.isfinite(value) for value in values):
        raise LocalEmbeddingError("local embedding contains invalid values")
    magnitude = math.sqrt(math.fsum(value * value for value in values))
    if not magnitude or not math.isfinite(magnitude):
        raise LocalEmbeddingError("local embedding has invalid magnitude")
    return [value / magnitude for value in values]


def _encode_sync(
    config: Descriptor,
    texts: tuple[str, ...],
    task: Literal["query", "document"],
    titles: tuple[str, ...],
    cancelled: threading.Event,
) -> list[list[float]]:
    timings = _timings.get()
    started = time.perf_counter()
    if timings is not None:
        timings.dispatch_ms = (started - timings.dispatched_at) * 1000
        timings.worker = threading.get_ident()
    runtime = _load_runtime(config)
    if timings is not None:
        timings.runtime_ms = (time.perf_counter() - started) * 1000
    result = []
    for text, title in zip(texts, titles, strict=True):
        if cancelled.is_set():
            raise asyncio.CancelledError
        prefixed = f"task: search result | query: {text}" if task == "query" else f"title: {title} | text: {text}"
        started = time.perf_counter()
        encoding = runtime.tokenizer.encode(prefixed)
        if timings is not None:
            timings.tokenize_ms += (time.perf_counter() - started) * 1000
            timings.tokens += len(encoding.ids)
        if len(encoding.ids) > MAX_TOKENS:
            raise InputTooLong(f"local embedding input exceeds {MAX_TOKENS} tokens")
        started = time.perf_counter()
        values = runtime.infer(encoding)
        if timings is not None:
            timings.inference_ms += (time.perf_counter() - started) * 1000
        result.append(_normalize(values))
    return result


async def _job(
    config: Descriptor,
    texts: tuple[str, ...],
    task: Literal["query", "document"],
    titles: tuple[str, ...],
    cancelled: threading.Event,
    operation: str,
    submitted_at: float,
) -> list[list[float]]:
    global _pending
    timings = _Timings()
    token = _timings.set(timings)
    status = "error"
    try:
        async with _lock:
            timings.queue_ms = (time.perf_counter() - submitted_at) * 1000
            if cancelled.is_set():
                raise asyncio.CancelledError
            try:
                timings.dispatched_at = time.perf_counter()
                result = await asyncio.to_thread(_encode_sync, config, texts, task, titles, cancelled)
                status = "ok"
                return result
            except LocalEmbeddingError:
                raise
            except Exception as exc:
                # Native exceptions may include input or paths; the public error contains no prompt data.
                raise LocalEmbeddingError("local embedding inference failed") from exc
    except asyncio.CancelledError:
        status = "cancelled"
        raise
    finally:
        _pending -= 1
        _timings.reset(token)
        # Query timings distinguish model startup, native work and queue contention
        # from catalog/database time in the enclosing retrieval trace. No text is logged.
        log.log(
            logging.INFO if task == "query" else logging.DEBUG,
            "local_embedding request_id=%s operation=%s task=%s status=%s batch=%d total_ms=%.3f "
            "queue_ms=%.3f dispatch_ms=%.3f runtime_ms=%.3f tokenize_ms=%.3f inference_ms=%.3f "
            "tokens=%d worker=%d",
            get_request_id(),
            operation,
            task,
            status,
            len(texts),
            (time.perf_counter() - submitted_at) * 1000,
            timings.queue_ms,
            timings.dispatch_ms,
            timings.runtime_ms,
            timings.tokenize_ms,
            timings.inference_ms,
            timings.tokens,
            timings.worker,
        )


def _consume_result(job: asyncio.Task[list[list[float]]]) -> None:
    _jobs.pop(job, None)
    if not job.cancelled():
        job.exception()


async def stop() -> None:
    """Skip queued work and drain the current native call before application shutdown."""
    global _stopping
    _stopping = True
    try:
        jobs = tuple(_jobs)
        for cancelled in _jobs.values():
            cancelled.set()
        if jobs:
            # Never cancel the shielded native work and release its lock while the thread is still active.
            await asyncio.shield(asyncio.gather(*jobs, return_exceptions=True))
    finally:
        _stopping = False


async def embed(
    texts: list[str],
    *,
    task: Literal["query", "document"],
    titles: list[str] | None = None,
    operation: str = "local.embed",
) -> list[list[float]]:
    """Embed full inputs locally. Caller cancellation never overlaps native inference with the next job."""
    global _pending
    if task not in ("query", "document"):
        raise ValueError("task must be query or document")
    if titles is not None and (task != "document" or len(titles) != len(texts)):
        raise ValueError("titles must match document inputs")
    if not texts:
        return []
    if _stopping:
        raise LocalEmbeddingError("local embedding runtime is stopping")
    config = descriptor()
    if config is None:
        raise LocalEmbeddingError("local embedding runtime or model is unavailable")
    if _pending >= MAX_PENDING:
        raise LocalEmbeddingBusy("local embedding queue is full")
    _pending += 1
    cancelled = threading.Event()
    job = asyncio.create_task(
        _job(
            config,
            tuple(texts),
            task,
            tuple(titles or [""] * len(texts)),
            cancelled,
            operation,
            time.perf_counter(),
        )
    )
    _jobs[job] = cancelled
    job.add_done_callback(_consume_result)
    # The shielded job retains the serialization lock until the native call actually finishes.
    # Cancelling the caller marks queued work obsolete and returns promptly, without spawning another native call.
    try:
        return await asyncio.shield(job)
    except asyncio.CancelledError:
        cancelled.set()
        raise
