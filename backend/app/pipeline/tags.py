"""Step 1: tag extraction + task features with the fast model."""

import re
from typing import Literal

from pydantic import BaseModel

from app.config import get_settings
from app.llm import gemini
from app.pipeline.prompts import TAGS_SYSTEM

TaskType = Literal["code_change", "debugging", "writing", "analysis", "planning", "question", "other"]
Constraint = Literal["output_format", "scope", "language", "success_criteria", "context"]

MAX_TAGS = 6
_PROMPT_CHARS = 6000


class TagExtraction(BaseModel):
    tags: list[str]
    task_type: TaskType
    missing_constraints: list[Constraint]


def normalize_tag(raw: str) -> str:
    """Lowercase kebab-case, ≤ 64 chars; '' when nothing usable remains."""
    tag = re.sub(r"[^a-z0-9+#.]+", "-", raw.strip().lower()).strip("-.")
    return tag[:64].rstrip("-")


async def extract_tags(prompt: str) -> TagExtraction:
    out = await gemini.generate_structured(
        operation="enhance.tags",
        model=get_settings().tag_model,
        system=TAGS_SYSTEM,
        contents=f"<draft_prompt>\n{prompt[:_PROMPT_CHARS]}\n</draft_prompt>",
        schema=TagExtraction,
        temperature=0.0,
    )
    tags = list(dict.fromkeys(t for t in map(normalize_tag, out.tags) if t))[:MAX_TAGS]
    return TagExtraction(
        tags=tags, task_type=out.task_type, missing_constraints=list(dict.fromkeys(out.missing_constraints))
    )
