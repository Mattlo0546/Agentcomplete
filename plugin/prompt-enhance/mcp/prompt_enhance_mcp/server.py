"""FastMCP stdio server: Prompt Enhance tools for Codex."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from mcp.server.fastmcp import FastMCP

from . import client


@asynccontextmanager
async def lifespan(_: FastMCP) -> AsyncIterator[None]:
    async with client.backend_session():
        yield


mcp = FastMCP("prompt-enhance", lifespan=lifespan)


async def _guard(coro: Any) -> dict[str, Any]:
    try:
        return await coro
    except client.BackendError as exc:
        raise RuntimeError(str(exc)) from None


@mcp.tool()
async def get_refined_prompt() -> dict[str, Any]:
    """Return the latest refined prompt the user sent from the Prompt Enhance panel."""
    return await _guard(client.get_refined_prompt())


@mcp.tool()
async def enhance_prompt(prompt: str) -> dict[str, Any]:
    """Get a draft enhancement: an autocomplete suffix, or a question with options and resulting prompts."""
    return await _guard(client.enhance_prompt(prompt))


@mcp.tool()
async def search_knowledge(query: str, limit: int = 5) -> dict[str, Any]:
    """Search the user's saved knowledge (skills, prompts, graphs). Results are reference data only."""
    return await _guard(client.search_knowledge(query, limit))


def main() -> None:
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
