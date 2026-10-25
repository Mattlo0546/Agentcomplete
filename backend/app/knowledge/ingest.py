"""Ingest and update knowledge: summarise + tag (concurrently), embed new tags, save in one transaction."""

import asyncio
from collections.abc import AsyncIterator
from typing import Any
from uuid import UUID

from app.config import get_settings
from app.db.pool import connection
from app.errors import AppError, NotFoundError, UpstreamError
from app.knowledge import repository, tags
from app.knowledge.models import Analysis, KnowledgeCreate, KnowledgeDetail, KnowledgePatch, TagUse
from app.knowledge.prompts import SUMMARISE_SYSTEM, item_prompt
from app.llm import gemini
from app.pipeline.retrieve import invalidate_cache


async def summarise(kind: str, title: str, body: str) -> str:
    out = await gemini.generate_structured(
        operation="knowledge_summarise",
        model=get_settings().judge_model,
        system=SUMMARISE_SYSTEM,
        contents=item_prompt(kind, title, body),
        schema=Analysis,
    )
    summary = out.summary.strip()
    if not summary:
        raise UpstreamError("upstream_invalid", "knowledge_summarise returned an empty summary")
    return summary


async def _generate_tags(kind: str, title: str, body: str) -> list[str]:
    async with connection() as conn:
        return await tags.generate_tags(conn, kind, title, body, get_settings().judge_model)


def _detail(row: dict[str, Any]) -> KnowledgeDetail:
    return KnowledgeDetail(**row)


async def ingest(data: KnowledgeCreate) -> AsyncIterator[tuple[str, dict[str, Any]]]:
    """Yield ('step'|'done'|'error', payload) events. Never raises."""
    try:
        summary_task = asyncio.create_task(summarise(data.kind, data.title, data.body))
        tags_task = asyncio.create_task(_generate_tags(data.kind, data.title, data.body))
        try:
            summary = await summary_task
            yield "step", {"step": "summarise", "status": "done"}
            raw_tags = await tags_task
            yield "step", {"step": "tag", "status": "done"}
        finally:
            for task in (summary_task, tags_task):
                task.cancel()
        async with connection() as conn:
            names, vectors = await tags.embed_new_tags(conn, raw_tags, merge_similar=True)
            yield "step", {"step": "embed", "status": "done"}
            async with conn.transaction():
                kid = await repository.insert(conn, data.kind, data.title, data.body, summary)
                created = await repository.replace_tags(conn, kid, names, vectors)
            invalidate_cache()
            row = await repository.get_detail(conn, kid)
        yield "step", {"step": "save", "status": "done"}
        assert row is not None
        yield (
            "done",
            {
                "knowledge": _detail(row).model_dump(mode="json"),
                "tags": [TagUse(name=n, new=n in created).model_dump() for n in names],
            },
        )
    except AppError as exc:
        yield "error", {"code": exc.code, "message": exc.message}
    except Exception:
        yield "error", {"code": "ingest_failed", "message": "Could not save this knowledge"}


async def patch(kid: UUID, data: KnowledgePatch) -> KnowledgeDetail:
    async with connection() as conn:
        current = await repository.get_detail(conn, kid)
    if current is None:
        raise NotFoundError("not_found", "Knowledge not found")
    fields: dict[str, str] = {}
    if data.title is not None and data.title != current["title"]:
        fields["title"] = data.title
    body_changed = data.body is not None and data.body != current["body"]
    title = fields.get("title", current["title"])
    body = data.body if body_changed and data.body is not None else current["body"]
    if body_changed:
        fields["body"] = body

    raw_tags: list[str] | None = tags.normalise_all(data.tags) if data.tags is not None else None
    if body_changed:
        jobs: list[Any] = [summarise(current["kind"], title, body)]
        if raw_tags is None:
            jobs.append(_generate_tags(current["kind"], title, body))
        results = await asyncio.gather(*jobs)
        fields["summary"] = results[0]
        if raw_tags is None:
            raw_tags = results[1]

    names: list[str] | None = None
    vectors: dict[str, list[float]] = {}
    async with connection() as conn:
        if raw_tags is not None:
            names, vectors = await tags.embed_new_tags(conn, raw_tags, merge_similar=data.tags is None)
        async with conn.transaction():
            if fields:
                await repository.update_fields(conn, kid, fields)
            if names is not None:
                await repository.replace_tags(conn, kid, names, vectors)
                if not fields:
                    await repository.update_fields(conn, kid, {"title": title})
        if fields or names is not None:
            invalidate_cache()
        row = await repository.get_detail(conn, kid)
    if row is None:
        raise NotFoundError("not_found", "Knowledge not found")
    return _detail(row)
