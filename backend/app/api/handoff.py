from datetime import datetime
from uuid import UUID

from fastapi import APIRouter
from pydantic import BaseModel, Field, field_validator

from app.db.pool import connection
from app.errors import NotFoundError
from app.schemas.enhance import MAX_PROMPT_UNITS, utf16_len

router = APIRouter()


class HandoffIn(BaseModel):
    prompt: str = Field(min_length=1)

    @field_validator("prompt")
    @classmethod
    def _bounded(cls, value: str) -> str:
        if not value.strip() or utf16_len(value) > MAX_PROMPT_UNITS:
            raise ValueError(f"prompt must be 1..{MAX_PROMPT_UNITS} UTF-16 code units and not blank")
        return value


class HandoffCreated(BaseModel):
    id: UUID
    created_at: datetime


class Handoff(HandoffCreated):
    prompt: str


@router.post("/handoff", response_model=HandoffCreated)
async def create_handoff(body: HandoffIn) -> HandoffCreated:
    async with connection() as conn, conn.transaction():
        row = await (
            await conn.execute("INSERT INTO handoff (prompt) VALUES (%s) RETURNING id, created_at", (body.prompt,))
        ).fetchone()
        assert row is not None
        await conn.execute("DELETE FROM handoff WHERE id <> %s", (row["id"],))
    return HandoffCreated(**row)


@router.get("/handoff/latest", response_model=Handoff)
async def latest_handoff() -> Handoff:
    async with connection() as conn:
        row = await (
            await conn.execute("SELECT id, prompt, created_at FROM handoff ORDER BY created_at DESC LIMIT 1")
        ).fetchone()
    if row is None:
        raise NotFoundError("handoff_not_found", "No refined prompt has been handed off yet")
    return Handoff(**row)
