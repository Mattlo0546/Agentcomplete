"""Reproduce local production retrieval on public fixtures without database or API calls.

Run from backend/: PYTHONPATH=. .venv/bin/python scripts/probe_production_semantics.py
Requires the separately installed, pinned local model. One phase executes 49 distinct,
uncached queries using the configured routing order. Set SEMANTIC_FIRST_ENABLED=true
to compare semantic-first nomination with the default lexical-then-semantic route.
This measures candidate recall, not the quality of the subsequent Gemini review or output.
"""

import argparse
import asyncio
import hashlib
import json
import math
import statistics
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from unittest.mock import patch

from app.config import get_settings
from app.llm import gemini, local_embeddings
from app.pipeline import catalog, retrieve, semantic
from app.pipeline.generate import build_contents
from app.schemas.enhance import utf16_len
from app.settings_store import AppSettings
from scripts.probe_semantic_routes import CASES, ROOT, Case, fixture_rows, titles


def timing(values: list[float]) -> dict[str, float]:
    ordered = sorted(values)
    return {
        "min_ms": round(ordered[0], 2),
        "median_ms": round(statistics.median(ordered), 2),
        "p95_ms": round(ordered[math.ceil(len(ordered) * 0.95) - 1], 2),
        "max_ms": round(ordered[-1], 2),
    }


async def run() -> dict[str, Any]:
    settings = get_settings()
    descriptor = local_embeddings.descriptor()
    if not settings.direct_semantic_enabled or settings.semantic_embed_backend != "local" or descriptor is None:
        raise RuntimeError("Enable direct local semantics and install the pinned local model before this probe")
    rows = fixture_rows()
    names = titles()
    cases = [
        *CASES,
        *(
            Case(
                f"explicit-{names[row['title']]}", "explicit_title", f"Apply {row['title']} and", (names[row["title"]],)
            )
            for row in rows
        ),
    ]
    assert len(cases) == len({case.prompt for case in cases}) == 49
    defaults = AppSettings.model_validate({})
    semantic.clear()

    async def fixture_refresh(*, force: bool = False) -> catalog.Snapshot:
        # Replace the refresh boundary rather than starting application workers or a DB pool.
        source = catalog.build_snapshot(rows, time.monotonic(), retrieve.cache_generation())
        catalog._snapshot = source
        return source

    async def forbidden_remote(*args: Any, **kwargs: Any) -> None:
        raise AssertionError("This fixture probe must not call a remote embedding provider")

    with (
        patch.object(catalog, "refresh", fixture_refresh),
        patch.object(gemini, "embed_retrieval", forbidden_remote),
    ):
        source = await fixture_refresh()
        start = time.perf_counter()
        cold_published = await semantic.prepare(source)
        cold_ms = (time.perf_counter() - start) * 1000
        fresh_publish_ms = None
        if not cold_published:
            source = await fixture_refresh()
            start = time.perf_counter()
            if not await semantic.prepare(source):
                raise RuntimeError("A fresh fixture snapshot could not publish the completed local index")
            fresh_publish_ms = round((time.perf_counter() - start) * 1000, 2)
        assert semantic._index is not None
        chunks = len(semantic._index.texts)
        print(json.dumps({"cold_prepare_ms": round(cold_ms, 2), "unique_chunks": chunks}), flush=True)
        semantic._queries.clear()
        samples: list[dict[str, Any]] = []
        for case in cases:
            if not semantic._fresh(source):
                source = await fixture_refresh()
                assert await semantic.prepare(source)
            start = time.perf_counter()
            current = await catalog.get_snapshot()
            assert current is not None
            result = None
            route = "lexical"
            if settings.fast_autocomplete_enabled and not settings.semantic_first_enabled:
                result = await catalog.select(case.prompt)
            if result is None:
                result = await semantic.select(case.prompt, current)
                route = "semantic"
            if result is None and settings.fast_autocomplete_enabled and settings.semantic_first_enabled:
                result = await catalog.select(case.prompt)
                route = "lexical"
            if result is None:
                route = "legacy_unavailable"
            elapsed = (time.perf_counter() - start) * 1000
            selected = [] if result is None else [names[candidate.title] for candidate in result.candidates]
            guard = result is not None
            if result is not None:
                originals = {document.candidate.id: document.candidate for document in current.documents}
                contents = build_contents(case.prompt, utf16_len(case.prompt), defaults, None, result.candidates)
                for candidate in result.candidates:
                    original = originals[candidate.id]
                    excerpt = candidate.evidence_excerpt
                    guard &= candidate.body == original.body and original.evidence_excerpt is None
                    if route == "semantic":
                        guard &= (
                            excerpt is not None
                            and excerpt in semantic._document_text(original)
                            and excerpt in contents
                            and len(f"title: {candidate.title} | text: {excerpt}".encode()) <= semantic.MAX_INPUT_BYTES
                        )
            samples.append(
                {
                    "case": case.name,
                    "category": case.category,
                    "route": route,
                    "ms": round(elapsed, 2),
                    "selected": selected,
                    "targets": list(case.targets),
                    "missing_targets": sorted(set(case.targets) - set(selected)),
                    "excluded_selected": sorted(set(case.excluded) & set(selected)),
                    "negative_control": not case.targets,
                    "source_excerpt_guard": bool(guard),
                }
            )
    target_count = sum(len(sample["targets"]) for sample in samples)
    matched = sum(len(sample["targets"]) - len(sample["missing_targets"]) for sample in samples)
    semantic_matched = sum(
        len(sample["targets"]) - len(sample["missing_targets"]) for sample in samples if sample["route"] == "semantic"
    )
    return {
        "at": datetime.now(UTC).isoformat(),
        "scope": "Public seed fixtures only; production local retrieval; no DB, API, or generation calls",
        "measurement": "One phase of 49 distinct uncached queries; startup measured separately; no concurrent load",
        "routing_policy": "semantic_first" if settings.semantic_first_enabled else "lexical_then_semantic",
        "limits": "Candidate recall is not final suggestion quality. Negative controls require the Gemini reviewer; "
        "they are not counted as successful zero-target recalls. Negated candidates may still be nominated.",
        "semantic_sha256": hashlib.sha256(Path(semantic.__file__).read_bytes()).hexdigest(),
        "local_encoder_sha256": hashlib.sha256(Path(local_embeddings.__file__).read_bytes()).hexdigest(),
        "fixture_sha256": hashlib.sha256(json.dumps(rows, sort_keys=True, default=str).encode()).hexdigest(),
        "model": descriptor.model,
        "revision": descriptor.revision,
        "dimensions": descriptor.dimensions,
        "max_prefixed_document_bytes": semantic.MAX_INPUT_BYTES,
        "target_overlap_characters": semantic.OVERLAP_CHARS,
        "documents": len(rows),
        "unique_chunks": chunks,
        "cases": len(cases),
        "cold_prepare_ms": round(cold_ms, 2),
        "cold_snapshot_published": cold_published,
        "fresh_publish_from_cache_ms": fresh_publish_ms,
        "target_count": target_count,
        "direct_semantic_targets_selected": semantic_matched,
        "application_route_targets_selected": matched,
        "semantic_calls": sum(sample["route"] == "semantic" for sample in samples),
        "negative_controls": [sample["case"] for sample in samples if sample["negative_control"]],
        "excluded_cases": [sample["case"] for sample in samples if sample["excluded_selected"]],
        "missing_cases": [sample["case"] for sample in samples if sample["missing_targets"]],
        "source_excerpt_guard_passes": sum(sample["source_excerpt_guard"] for sample in samples),
        "query_latency": timing([sample["ms"] for sample in samples]),
        "original20_latency": timing([sample["ms"] for sample in samples[: len(CASES)]]),
        "explicit29_latency": timing([sample["ms"] for sample in samples[len(CASES) :]]),
        "samples": samples,
    }


async def main(output: Path) -> None:
    try:
        report = await run()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps({key: value for key, value in report.items() if key != "samples"}, indent=2))
    finally:
        await semantic.stop()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "docs/evidence/semantic-production-local-final.json")
    asyncio.run(main(parser.parse_args().output))
