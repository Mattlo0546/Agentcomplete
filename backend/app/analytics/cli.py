"""Operator CLI: `uv run python -m app.analytics.cli export|train|status`."""

import asyncio
import sys

from app.analytics.export import export_outcomes
from app.analytics.state import load_status
from app.analytics.train import train_classifier
from app.db.pool import close_pool, open_pool


async def _main(command: str) -> None:
    await open_pool()
    try:
        if command == "export":
            print({"exported": await export_outcomes()})
        elif command == "train":
            print((await train_classifier()).model_dump_json())
        else:
            print((await load_status()).model_dump_json())
    finally:
        await close_pool()


def main() -> None:
    if len(sys.argv) != 2 or sys.argv[1] not in ("export", "train", "status"):
        sys.exit("usage: python -m app.analytics.cli export|train|status")
    asyncio.run(_main(sys.argv[1]))


if __name__ == "__main__":
    main()
