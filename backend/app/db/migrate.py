from pathlib import Path

from app.db.pool import connection

MIGRATIONS_DIR = Path(__file__).parent / "migrations"


async def run_migrations() -> list[str]:
    """Apply pending `migrations/*.sql` files in name order; returns the names applied."""
    applied: list[str] = []
    async with connection() as conn:
        await conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())"
        )
        done = {r["name"] for r in await (await conn.execute("SELECT name FROM schema_migrations")).fetchall()}
        for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
            if path.name in done:
                continue
            async with conn.transaction():
                await conn.execute(path.read_text())  # type: ignore[arg-type]
                await conn.execute("INSERT INTO schema_migrations (name) VALUES (%s)", (path.name,))
            applied.append(path.name)
    return applied
