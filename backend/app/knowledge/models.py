"""Pydantic models for the knowledge and tag endpoints (see docs/api.md)."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

Kind = Literal["skill", "prompt", "graph"]


class KnowledgeCreate(BaseModel):
    kind: Kind
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=100_000)


class KnowledgePatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    body: str | None = Field(default=None, min_length=1, max_length=100_000)
    tags: list[str] | None = Field(default=None, max_length=12)


class Knowledge(BaseModel):
    id: UUID
    kind: Kind
    title: str
    summary: str
    tags: list[str]
    created_at: datetime
    updated_at: datetime
    use_count: int


class KnowledgeDetail(Knowledge):
    body: str


class KnowledgeList(BaseModel):
    items: list[Knowledge]
    total: int


class TagUse(BaseModel):
    name: str
    new: bool


class TagCount(BaseModel):
    name: str
    knowledge_count: int


class TagList(BaseModel):
    items: list[TagCount]


class Analysis(BaseModel):
    """Structured output of the summarise call."""

    summary: str


class GeneratedTags(BaseModel):
    """Structured output of the tag-generation call."""

    tags: list[str]
