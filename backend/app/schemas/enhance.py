"""Wire schema for POST /v1/enhance (schema_version 1). Positions are UTF-16 code units, ranges are [start, end)."""

from typing import Annotated, Literal

from pydantic import BaseModel, Field

MAX_PROMPT_UNITS = 20_000


class EnhanceRequest(BaseModel):
    request_id: str = Field(min_length=1, max_length=64)
    prompt: str
    prompt_revision: int = Field(ge=0)
    cursor: int = Field(ge=0)
    previous_request_id: str | None = Field(None, min_length=1, max_length=64)


class Edit(BaseModel):
    start: int = Field(ge=0)
    end: int = Field(ge=0)
    text: str


class Option(BaseModel):
    id: str = Field(min_length=1, max_length=40)
    label: str = Field(min_length=1, max_length=120)
    edits: list[Edit] = Field(min_length=1)


class _Base(BaseModel):
    schema_version: Literal[1] = 1
    request_id: str
    prompt_revision: int


class AutocompleteResponse(_Base):
    type: Literal["autocomplete"] = "autocomplete"
    insert_at: int
    text: str


class MultipleChoiceResponse(_Base):
    type: Literal["multiple_choice"] = "multiple_choice"
    question: str
    options: list[Option] = Field(min_length=2)


class NoneResponse(_Base):
    type: Literal["none"] = "none"


EnhanceResponse = Annotated[AutocompleteResponse | MultipleChoiceResponse | NoneResponse, Field(discriminator="type")]


def utf16_len(text: str) -> int:
    """Length in UTF-16 code units (what the browser's String.length reports)."""
    return len(text.encode("utf-16-le")) // 2
