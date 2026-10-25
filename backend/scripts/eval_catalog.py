"""Evaluate local candidate recall against the live Tiger corpus, without writes or model calls.

Run from backend/: PYTHONPATH=. .venv/bin/python scripts/eval_catalog.py
Synthetic prompts live in this script; the report stores fixture IDs and retrieval metadata only.
Expected targets are hand-authored checks, not exhaustive relevance judgments or model quality scores.
"""

import argparse
import asyncio
import hashlib
import json
import time
import unicodedata
from collections import Counter
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from unittest.mock import patch

from psycopg import AsyncConnection
from psycopg.rows import dict_row

from app.config import get_settings
from app.pipeline import catalog

ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class Fixture:
    name: str
    category: str
    prompt: str
    targets: tuple[str, ...]
    distractors: tuple[str, ...] = ()
    expect_fallback: bool = False


BASELINES = [
    ("accessible-react-dialog", "Build an accessible React modal dialog with keyboard verification and"),
    ("api-contract-change", "Change an API request and response contract while preserving client compatibility and"),
    ("api-error-handling", "Make HTTP API error responses consistent across status codes and"),
    ("authorization-access-matrix", "Implement authorization from a resource and action matrix and"),
    ("browser-bug-regression", "Reproduce a browser UI bug and add a focused regression test that"),
    ("bug-triage-loop", "Organize a bug triage loop with coding agent steps and"),
    ("choose-tech-stack-from-constraints", "Choose a technology stack from explicit product constraints and"),
    ("docker-multi-stage-builds", "Create Docker multi-stage builds for Python and Node apps using"),
    ("explain-a-diff-for-review", "Explain a git diff for a teammate reviewing the code and"),
    ("fastapi-dependency-injection", "Refactor FastAPI dependency injection patterns using"),
    ("fastapi-postgres-atomic-operation", "Implement one atomic FastAPI PostgreSQL operation using"),
    ("incremental-react-adoption", "Add React incrementally to one existing route or widget and"),
    ("llm-latency-experiment", "Improve an LLM feature by measuring latency and output quality and"),
    ("logging-and-observability", "Add structured logging and observability to the service using"),
    ("nextjs-app-router-data-fetching", "Optimize Next.js App Router data fetching and caching using"),
    ("nextjs-server-client-boundary", "Place a Next.js feature across the server and client component boundary and"),
    ("postgres-session-store", "Build a PostgreSQL-backed web session store using"),
    (
        "postgres-zero-downtime-migrations",
        "Create a zero-downtime PostgreSQL migration adding a NOT NULL column by first",
    ),
    ("python-retry-backoff", "Add Python HTTP client retries with exponential backoff and"),
    ("react-async-response-races", "Prevent stale asynchronous responses in a React search interaction and"),
    ("react-testing-library-patterns", "Write React Testing Library and Vitest login form tests that check"),
    ("refactor-with-tests-first", "Refactor this module without changing behavior, starting with tests and"),
    ("release-notes-from-commits", "Write release notes from git commits and"),
    ("repo-first-vertical-slice", "Build one working feature through the existing repository stack and"),
    ("security-review-checklist", "Perform an application security review using a checklist and"),
    ("sql-query-optimisation", "Optimize a slow PostgreSQL SQL query using EXPLAIN ANALYZE and"),
    ("stripe-webhook-idempotency", "Handle Stripe webhook events idempotently and"),
    ("typescript-strict-migration", "Migrate a codebase to TypeScript strict mode and"),
    ("writing-clear-codex-tasks", "Write a clear Codex coding task with acceptance criteria and"),
]

FIXTURES = [Fixture(f"baseline-{name}", "explicit", prompt, (name,)) for name, prompt in BASELINES] + [
    Fixture(
        "stack-react-before",
        "changed_technology",
        "Build a React modal dialog with keyboard navigation and",
        ("accessible-react-dialog",),
    ),
    Fixture(
        "stack-fastapi-after",
        "changed_technology",
        "Implement an atomic FastAPI PostgreSQL update and",
        ("fastapi-postgres-atomic-operation",),
        ("accessible-react-dialog",),
    ),
    Fixture(
        "stack-typescript-before",
        "changed_technology",
        "Migrate this codebase to TypeScript strict mode and",
        ("typescript-strict-migration",),
    ),
    Fixture(
        "stack-python-after",
        "changed_technology",
        "Add Python HTTP client exponential backoff and",
        ("python-retry-backoff",),
        ("typescript-strict-migration",),
    ),
    Fixture(
        "negated-react",
        "negation",
        "Do not add React; implement one atomic FastAPI PostgreSQL update and",
        ("fastapi-postgres-atomic-operation",),
        ("incremental-react-adoption", "accessible-react-dialog"),
    ),
    Fixture(
        "negated-nextjs",
        "negation",
        "Do not migrate to Next.js. Keep FastAPI and PostgreSQL; implement an atomic update and",
        ("fastapi-postgres-atomic-operation",),
        ("nextjs-app-router-data-fetching", "nextjs-server-client-boundary"),
    ),
    Fixture(
        "negated-stripe",
        "negation",
        "Do not change Stripe webhooks; optimize this slow PostgreSQL query with EXPLAIN and",
        ("sql-query-optimisation",),
        ("stripe-webhook-idempotency",),
    ),
    Fixture(
        "negated-refactor",
        "negation",
        "Do not refactor the React UI; write release notes from git commits and",
        ("release-notes-from-commits",),
        ("refactor-with-tests-first",),
    ),
    Fixture(
        "paraphrase-retry",
        "paraphrase",
        "Make the Python outbound client recover after temporary upstream outages and",
        ("python-retry-backoff",),
    ),
    Fixture(
        "paraphrase-retry-generic",
        "paraphrase",
        "Recover gracefully after transient upstream failures",
        ("python-retry-backoff",),
    ),
    Fixture(
        "paraphrase-retry-draft",
        "distractor",
        "Recover gracefully after transient upstream failures in this draft",
        ("python-retry-backoff",),
    ),
    Fixture(
        "paraphrase-react-race",
        "paraphrase",
        "In React search, an older network result must never replace the newest typed result and",
        ("react-async-response-races",),
    ),
    Fixture(
        "paraphrase-migration",
        "paraphrase",
        "Keep PostgreSQL writes online while making a field mandatory and",
        ("postgres-zero-downtime-migrations",),
    ),
    Fixture(
        "paraphrase-atomic",
        "paraphrase",
        "In FastAPI, commit both PostgreSQL writes together or undo both and",
        ("fastapi-postgres-atomic-operation",),
    ),
    Fixture(
        "paraphrase-auth",
        "paraphrase",
        "Decide which signed-in users may perform which operations on each resource and",
        ("authorization-access-matrix",),
    ),
    Fixture(
        "paraphrase-dialog",
        "paraphrase",
        "Keep keyboard focus inside the React modal and return it when the modal closes and",
        ("accessible-react-dialog",),
    ),
    Fixture(
        "paraphrase-webhook",
        "paraphrase",
        "Avoid processing the same delivered Stripe event twice and",
        ("stripe-webhook-idempotency",),
    ),
    Fixture(
        "distractor-retry-api",
        "distractor",
        "In our API service, add Python HTTP client retries with exponential backoff and",
        ("python-retry-backoff",),
    ),
    Fixture(
        "distractor-migration-ui",
        "distractor",
        "The React UI and FastAPI API already work. Add a zero-downtime PostgreSQL NOT NULL migration by first",
        ("postgres-zero-downtime-migrations",),
        ("accessible-react-dialog",),
    ),
    Fixture(
        "distractor-atomic-ui",
        "distractor",
        "The React browser client uses TypeScript; implement an atomic FastAPI PostgreSQL transaction and",
        ("fastapi-postgres-atomic-operation",),
        ("typescript-strict-migration",),
    ),
    Fixture(
        "distractor-race-stack",
        "distractor",
        "The FastAPI PostgreSQL backend is fine; prevent stale async React search responses and",
        ("react-async-response-races",),
        ("fastapi-postgres-atomic-operation",),
    ),
    Fixture("partial-retry", "partial_word", "Add retr", ("python-retry-backoff",)),
    Fixture("partial-typescript", "partial_word", "Migrate to TypeScript stri", ("typescript-strict-migration",)),
    Fixture("partial-sql", "partial_word", "Optimize this PostgreSQL quer", ("sql-query-optimisation",)),
    Fixture("partial-webhook", "partial_word", "Handle Stripe webh", ("stripe-webhook-idempotency",)),
    Fixture(
        "repeated-retry",
        "repeated_words",
        "retry " * 40 + "Python HTTP exponential backoff and",
        ("python-retry-backoff",),
    ),
    Fixture(
        "repeated-distractor",
        "repeated_words",
        "React " * 40 + "Implement atomic FastAPI PostgreSQL writes and",
        ("fastapi-postgres-atomic-operation",),
    ),
    Fixture(
        "repeated-migration",
        "repeated_words",
        "PostgreSQL " * 40 + "zero-downtime NOT NULL migration by first",
        ("postgres-zero-downtime-migrations",),
    ),
    Fixture(
        "multilingual-explicit",
        "multilingual",
        "Añade reintentos con retroceso exponencial al cliente Python y",
        ("python-retry-backoff",),
    ),
    Fixture(
        "multi-intent-retry-logs",
        "multiple_targets",
        "Add Python exponential backoff retries plus structured logging and observability and",
        ("python-retry-backoff", "logging-and-observability"),
    ),
    Fixture(
        "multi-intent-react",
        "multiple_targets",
        "Fix stale async responses in the React login form and add Vitest tests that check",
        ("react-async-response-races", "react-testing-library-patterns"),
    ),
    Fixture("unknown-haiku", "negative_control", "Compose a haiku about autumn moonlight", (), expect_fallback=True),
    Fixture(
        "unknown-genealogy", "negative_control", "Compile a medieval genealogy bibliography", (), expect_fallback=True
    ),
]


def seed_titles() -> dict[str, str]:
    result = {}
    for path in (ROOT / "backend" / "seed").glob("*.md"):
        for line in path.read_text().splitlines():
            if line.startswith("title: "):
                result[line.removeprefix("title: ")] = path.stem
                break
    return result


def score_details(snapshot: catalog.Snapshot, prompt: str, names: dict[Any, str]) -> list[dict[str, Any]]:
    """Explain the current scoring rule using only words from a synthetic fixture, never body excerpts."""
    query = catalog.tokens(prompt)
    words = catalog._WORDS.findall(unicodedata.normalize("NFKC", prompt).casefold())
    if words and not prompt[-1:].isspace() and words[-1] not in snapshot.idf and len(words[-1]) >= 3:
        query.update(word for word in snapshot.idf if word.startswith(words[-1]))
    result = []
    for document in snapshot.documents:
        if not document.metadata_tokens & query:
            continue
        terms = [
            {
                "term": word,
                "metadata_match": word in document.metadata_tokens,
                "field_weight": weight,
                "idf": round(snapshot.idf[word], 6),
                "contribution": round(snapshot.idf[word] * weight / (weight + 1.2), 6),
            }
            for word, weight in sorted(document.weights.items())
            if word in query
        ]
        result.append(
            {
                "candidate": names[document.candidate.id],
                "score": round(
                    sum(
                        snapshot.idf[word] * weight / (weight + 1.2)
                        for word, weight in document.weights.items()
                        if word in query
                    ),
                    6,
                ),
                "metadata_overlap": sorted(document.metadata_tokens & query),
                "terms": terms,
            }
        )
    return sorted(result, key=lambda row: -row["score"])


async def evaluate() -> dict[str, Any]:
    settings = get_settings()
    report: dict[str, Any] = {
        "measured_at": datetime.now(UTC).isoformat(),
        "scope": "Read-only Tiger snapshot; synthetic lexical recall fixtures; no writes or model calls",
        "catalog_source_sha256": hashlib.sha256(Path(catalog.__file__).read_bytes()).hexdigest(),
        "limitations": [
            "Hand-authored expected targets test nomination, not complete relevance or generated-output quality.",
            "Generic retry knowledge is a useful candidate but platform-specific use still requires model review.",
            "Selected distractors are review workload, not proof of incorrect generated advice.",
            "Semantic fallback is observed as routing only; no Gemini or vector fallback was executed.",
            "Unbounded rank diagnostics disable the candidate cap and its ambiguity gate; they are not routed recall.",
            "Challenge fallbacks defer quality assessment to the semantic pipeline; "
            "explicit baseline fallbacks regress the fast path.",
            "Explicit cases closely name seed documents; challenge categories are reported separately.",
        ],
    }
    async with await AsyncConnection.connect(
        settings.database_url,
        autocommit=True,
        row_factory=dict_row,
        connect_timeout=5,
        options="-c default_transaction_read_only=on -c statement_timeout=5000",
    ) as conn:

        @asynccontextmanager
        async def readonly_connection() -> AsyncIterator[Any]:
            yield conn

        with patch.object(catalog, "connection", readonly_connection):
            start = time.perf_counter()
            snapshot = await catalog.refresh(force=True)
            report["snapshot_refresh_ms"] = round((time.perf_counter() - start) * 1000, 3)
            if snapshot is None or snapshot.oversized:
                raise RuntimeError("Expected a valid bounded snapshot for the evaluation")
            titles = seed_titles()
            names = {
                doc.candidate.id: titles.get(doc.candidate.title, f"unmapped-document-{i + 1}")
                for i, doc in enumerate(snapshot.documents)
            }
            present = set(names.values())
            report["corpus"] = {
                "documents": len(snapshot.documents),
                "mapped_seed_documents": sorted(present & set(titles.values())),
                "unmapped_count": sum(name.startswith("unmapped-") for name in present),
                "source_digest_sha256": hashlib.sha256(
                    json.dumps(
                        [
                            [
                                str(doc.candidate.id),
                                doc.candidate.title,
                                doc.candidate.summary,
                                doc.candidate.body,
                                doc.candidate.matched_tags,
                            ]
                            for doc in snapshot.documents
                        ],
                        ensure_ascii=False,
                    ).encode()
                ).hexdigest(),
            }
            report["candidate_limit"] = min(catalog.MAX_LOCAL_CANDIDATES, catalog.MAX_CANDIDATES)
            rows = []
            for fixture in FIXTURES:
                started = time.perf_counter()
                selected = await catalog.select(fixture.prompt)
                elapsed = round((time.perf_counter() - started) * 1000, 3)
                with (
                    patch.object(catalog, "MAX_LOCAL_CANDIDATES", catalog.MAX_DOCUMENTS),
                    patch.object(catalog, "MAX_CANDIDATES", catalog.MAX_DOCUMENTS),
                ):
                    full = await catalog.select(fixture.prompt)
                selected_names = [names[c.id] for c in selected.candidates] if selected is not None else []
                ranked_names = [names[c.id] for c in full.candidates] if full is not None else []
                targets = {
                    target: {
                        "present_in_corpus": target in present,
                        "eligible_rank": ranked_names.index(target) + 1 if target in ranked_names else None,
                        "selected": target in selected_names,
                        "within_five_before_confidence_gate": target in ranked_names[:5],
                        "deferred_to_semantic": selected is None,
                    }
                    for target in fixture.targets
                }
                row = {
                    "fixture": fixture.name,
                    "category": fixture.category,
                    "route": "semantic_fallback" if selected is None else "local",
                    "fallback_reason": ("ambiguous_metadata" if ranked_names else "no_metadata_match")
                    if selected is None
                    else None,
                    "selection_ms": elapsed,
                    "expected_targets": targets,
                    "selected": selected_names,
                    "eligible_candidates": len(ranked_names),
                    "named_distractors_selected": sorted(set(fixture.distractors) & set(selected_names)),
                    "cap_only_misses": [
                        t
                        for t, v in targets.items()
                        if selected is not None and v["eligible_rank"] and not v["selected"]
                    ],
                    "fallback_expected": fixture.expect_fallback,
                }
                if row["cap_only_misses"] or row["fallback_reason"] == "ambiguous_metadata":
                    row["ranking_diagnostics"] = score_details(snapshot, fixture.prompt, names)[:6]
                rows.append(row)
            report["samples"] = rows
            summaries = {}
            for category in ["all", *sorted({f.category for f in FIXTURES})]:
                group = [r for r in rows if category == "all" or r["category"] == category]
                target_rows = [t for r in group for t in r["expected_targets"].values() if t["present_in_corpus"]]
                summaries[category] = {
                    "fixtures": len(group),
                    "routes": dict(Counter(r["route"] for r in group)),
                    "present_expected_targets": len(target_rows),
                    "targets_selected": sum(t["selected"] for t in target_rows),
                    "targets_within_five_before_confidence_gate": sum(
                        t["within_five_before_confidence_gate"] for t in target_rows
                    ),
                    "targets_deferred_to_semantic": sum(t["deferred_to_semantic"] for t in target_rows),
                    "targets_eligible_before_cap": sum(t["eligible_rank"] is not None for t in target_rows),
                    "cap_only_misses": sum(len(r["cap_only_misses"]) for r in group),
                    "expected_fallbacks_not_taken": sum(
                        r["fallback_expected"] and r["route"] != "semantic_fallback" for r in group
                    ),
                    "fast_requests_missing_expected_target": sum(
                        r["route"] == "local"
                        and any(t["present_in_corpus"] and not t["selected"] for t in r["expected_targets"].values())
                        for r in group
                    ),
                    "explicit_baseline_failures": sum(
                        r["category"] == "explicit"
                        and any(t["present_in_corpus"] and not t["selected"] for t in r["expected_targets"].values())
                        for r in group
                    ),
                }
            report["summary"] = summaries
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "docs" / "evidence" / "catalog-recall.json")
    args = parser.parse_args()
    try:
        report = asyncio.run(evaluate())
    except Exception as exc:
        # Provider exceptions can contain a private hostname; retain only the error class.
        raise SystemExit(f"Catalog evaluation failed ({type(exc).__name__}); no report written") from None
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(
        json.dumps(
            {
                "output": str(args.output),
                "corpus_documents": report["corpus"]["documents"],
                "summary": report["summary"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
