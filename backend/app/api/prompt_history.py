"""Explicitly saved prompt snapshots; raw contents never enter telemetry or analytics."""

from datetime import datetime
from typing import Annotated, Self
from uuid import UUID

from fastapi import APIRouter, Query, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.db.pool import connection
from app.errors import NotFoundError
from app.schemas.enhance import MAX_PROMPT_UNITS, utf16_len

router = APIRouter(tags=["prompt history"])

MAX_SUGGESTION_UNITS = 4_000
_COLUMNS = (
    "id, prompt, suggestion_text, prompt || COALESCE(suggestion_text, '') AS saved_text, "
    "title, description, created_at, updated_at"
)


class VersionMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=1_000)

    @field_validator("title")
    @classmethod
    def title_not_blank(cls, value: str | None) -> str | None:
        if value is not None:
            value = value.strip()
            if not value:
                raise ValueError("title must not be blank")
        return value

    @field_validator("description")
    @classmethod
    def description_trimmed(cls, value: str | None) -> str | None:
        return value.strip() or None if value is not None else None


class VersionCreate(VersionMetadata):
    prompt: str = Field(min_length=1)
    suggestion_text: str | None = None

    @field_validator("prompt")
    @classmethod
    def prompt_bounded(cls, value: str) -> str:
        if not value.strip() or utf16_len(value) > MAX_PROMPT_UNITS:
            raise ValueError(f"prompt must be nonblank and at most {MAX_PROMPT_UNITS} UTF-16 units")
        return value

    @field_validator("suggestion_text")
    @classmethod
    def suggestion_bounded(cls, value: str | None) -> str | None:
        if value is not None and utf16_len(value) > MAX_SUGGESTION_UNITS:
            raise ValueError(f"suggestion must be at most {MAX_SUGGESTION_UNITS} UTF-16 units")
        return value or None

    @model_validator(mode="after")
    def saved_text_bounded(self) -> Self:
        if utf16_len(self.prompt + (self.suggestion_text or "")) > MAX_PROMPT_UNITS:
            raise ValueError(f"saved prompt must be at most {MAX_PROMPT_UNITS} UTF-16 units")
        return self


class PromptVersion(BaseModel):
    id: UUID
    prompt: str
    suggestion_text: str | None
    saved_text: str
    title: str | None
    description: str | None
    created_at: datetime
    updated_at: datetime


class PromptVersionList(BaseModel):
    items: list[PromptVersion]
    total: int


@router.post("/prompt-history", status_code=201)
async def create_version(body: VersionCreate) -> PromptVersion:
    async with connection() as conn:
        row = await (
            await conn.execute(
                "INSERT INTO prompt_history (prompt, suggestion_text, title, description) "
                f"VALUES (%s, %s, %s, %s) RETURNING {_COLUMNS}",
                (body.prompt, body.suggestion_text, body.title, body.description),
            )
        ).fetchone()
    assert row is not None
    return PromptVersion(**row)


@router.get("/prompt-history")
async def list_versions(
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> PromptVersionList:
    async with connection() as conn:
        # One statement keeps the total and page consistent during concurrent saves/deletes.
        rows = await (
            await conn.execute(
                f"SELECT {_COLUMNS}, count(*) OVER () AS total FROM prompt_history "
                "ORDER BY created_at DESC, id DESC LIMIT %s OFFSET %s",
                (limit, offset),
            )
        ).fetchall()
        if rows:
            total = rows[0]["total"]
        else:
            count = await (await conn.execute("SELECT count(*) AS total FROM prompt_history")).fetchone()
            assert count is not None
            total = count["total"]
    return PromptVersionList(items=[PromptVersion(**row) for row in rows], total=total)


@router.get("/prompt-history/{version_id}")
async def get_version(version_id: UUID) -> PromptVersion:
    async with connection() as conn:
        row = await (
            await conn.execute(f"SELECT {_COLUMNS} FROM prompt_history WHERE id = %s", (version_id,))
        ).fetchone()
    if row is None:
        raise NotFoundError("not_found", "Prompt version not found")
    return PromptVersion(**row)


@router.patch("/prompt-history/{version_id}")
async def patch_version(version_id: UUID, body: VersionMetadata) -> PromptVersion:
    # A fixed whitelist is essential: clients can edit labels, never the saved prompt snapshot.
    fields = {key: getattr(body, key) for key in ("title", "description") if key in body.model_fields_set}
    if not fields:
        return await get_version(version_id)
    assignments = ", ".join(f"{key} = %s" for key in fields)
    async with connection() as conn:
        row = await (
            await conn.execute(
                f"UPDATE prompt_history SET {assignments}, updated_at = now() WHERE id = %s RETURNING {_COLUMNS}",
                (*fields.values(), version_id),
            )
        ).fetchone()
    if row is None:
        raise NotFoundError("not_found", "Prompt version not found")
    return PromptVersion(**row)


@router.delete("/prompt-history/{version_id}", status_code=204)
async def delete_version(version_id: UUID) -> Response:
    async with connection() as conn:
        cursor = await conn.execute("DELETE FROM prompt_history WHERE id = %s", (version_id,))
    if cursor.rowcount == 0:
        raise NotFoundError("not_found", "Prompt version not found")
    return Response(status_code=204)
