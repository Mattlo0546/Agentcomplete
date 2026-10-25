"""Step 1: tag extraction + task features with the fast model."""

import json
import re
from hashlib import sha256
from typing import Literal

from pydantic import BaseModel

from app.config import get_settings
from app.llm import gemini
from app.pipeline.cache import TTLCache
from app.pipeline.prompts import TAGS_SYSTEM

TaskType = Literal["code_change", "debugging", "writing", "analysis", "planning", "question", "other"]
Constraint = Literal["output_format", "scope", "language", "success_criteria", "context"]

MAX_TAGS = 6
_PROMPT_CHARS = 6000


class TagExtraction(BaseModel):
    # Gemini emits properties in schema order: compare before committing to retrieval tags.
    reuse_knowledge: bool = False
    tags: list[str]
    task_type: TaskType
    missing_constraints: list[Constraint]
    continuation_needed: bool = False


_cache: TTLCache[tuple[str, str], TagExtraction] = TTLCache(256, 60)


def normalize_tag(raw: str) -> str:
    """Lowercase kebab-case, ≤ 64 chars; '' when nothing usable remains."""
    tag = re.sub(r"[^a-z0-9+#.]+", "-", raw.strip().lower()).strip("-.")
    return tag[:64].rstrip("-")


def visible_comparison(previous_prompt: str, prompt: str) -> bool:
    """Do not approve semantic reuse when a changed middle would be hidden by truncation."""
    previous_middle = previous_prompt[4000:-2000] if len(previous_prompt) > _PROMPT_CHARS else ""
    middle = prompt[4000:-2000] if len(prompt) > _PROMPT_CHARS else ""
    return previous_middle == middle


def _visible_text(prompt: str) -> str:
    return prompt if len(prompt) <= _PROMPT_CHARS else f"{prompt[:4000]}\n[earlier text omitted]\n{prompt[-2000:]}"


async def extract_tags(
    prompt: str,
    *,
    previous_prompt: str | None = None,
    previous_tags: list[str] | None = None,
    full_prompt: bool = False,
) -> TagExtraction:
    model = get_settings().tag_model
    # Preserve the actual end for continuation classification, including long/non-English drafts.
    comparable = previous_prompt is not None and visible_comparison(previous_prompt, prompt)
    # A hidden middle change forces a fresh full-current-draft extraction, with no reuse option.
    text = prompt if full_prompt or (previous_prompt is not None and not comparable) else _visible_text(prompt)
    contents = ""
    if comparable and previous_prompt is not None:
        contents = (
            f"<previous_draft>\n{_visible_text(previous_prompt)}\n</previous_draft>"
            f"\n<previous_tags>{json.dumps(previous_tags or [])}</previous_tags>"
        )
    contents += f"\n<draft_prompt>\n{text}\n</draft_prompt>"
    # Include full drafts in the digest so an omitted-middle edit never hits an older tag result.
    digest = json.dumps([prompt, previous_prompt, previous_tags, full_prompt], ensure_ascii=False)
    key = (model, sha256(digest.encode()).hexdigest())
    cached = _cache.get(key)
    if cached is not None:
        return cached.model_copy(deep=True)
    out = await gemini.generate_structured(
        operation="enhance.tags",
        model=model,
        system=TAGS_SYSTEM,
        contents=contents,
        schema=TagExtraction,
        temperature=0.0,
        thinking_level="minimal",
        max_output_tokens=512,
    )
    tags = list(dict.fromkeys(t for t in map(normalize_tag, out.tags) if t))[:MAX_TAGS]
    result = TagExtraction(
        tags=tags,
        task_type=out.task_type,
        missing_constraints=list(dict.fromkeys(out.missing_constraints)),
        continuation_needed=out.continuation_needed,
        reuse_knowledge=bool(comparable and out.reuse_knowledge),
    )
    _cache.put(key, result)
    return result.model_copy(deep=True)
