"""Seed the knowledge base from backend/seed/*.md. Run: `cd backend && uv run python -m app.knowledge.seed`."""

import asyncio
import re
import sys
from pathlib import Path

from app.db.migrate import run_migrations
from app.db.pool import close_pool, connection, open_pool
from app.knowledge import ingest, repository
from app.knowledge.models import KnowledgeCreate

SEED_DIR = Path(__file__).resolve().parents[2] / "seed"
_FRONT = re.compile(r"\A---\n(.*?)\n---\n(.*)\Z", re.DOTALL)


def parse(path: Path) -> KnowledgeCreate:
    match = _FRONT.match(path.read_text(encoding="utf-8"))
    if not match:
        raise ValueError(f"{path.name}: missing front-matter")
    meta = dict(line.split(":", 1) for line in match.group(1).splitlines() if ":" in line)
    return KnowledgeCreate(
        kind=meta["kind"].strip(),  # type: ignore[arg-type]
        title=meta["title"].strip().strip('"'),
        body=match.group(2).strip(),
    )


async def seed() -> tuple[int, int]:
    added = skipped = 0
    for path in sorted(SEED_DIR.glob("*.md")):
        item = parse(path)
        async with connection() as conn:
            if await repository.title_exists(conn, item.title):
                skipped += 1
                print(f"skip   {item.title}")
                continue
        async for name, payload in ingest.ingest(item):
            if name == "error":
                print(f"FAILED {item.title}: {payload['message']}", file=sys.stderr)
            elif name == "done":
                added += 1
                print(f"added  {item.title}  [{', '.join(t['name'] for t in payload['tags'])}]")
    return added, skipped


async def main() -> None:
    await open_pool()
    try:
        await run_migrations()
        added, skipped = await seed()
        async with connection() as conn:
            k = await (await conn.execute("SELECT count(*) AS n FROM knowledge")).fetchone()
            t = await (await conn.execute("SELECT count(*) AS n FROM tag")).fetchone()
        print(f"added={added} skipped={skipped} knowledge_total={k['n']} tags_total={t['n']}")  # type: ignore[index]
    finally:
        await close_pool()


if __name__ == "__main__":
    asyncio.run(main())
