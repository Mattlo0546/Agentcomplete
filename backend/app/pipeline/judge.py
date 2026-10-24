"""Step 3: per-candidate relevance judging, run concurrently."""

import asyncio
from dataclasses import dataclass

from pydantic import BaseModel

from app.config import get_settings
from app.errors import UpstreamError
from app.llm import gemini
from app.pipeline.prompts import JUDGE_SYSTEM
from app.pipeline.retrieve import Candidate

KEEP_SCORE = 0.5
# Latency budget per judge call; a slower verdict counts as "not kept" rather than holding up the request.
JUDGE_TIMEOUT_S = 2.0
_PROMPT_CHARS = 4000


class Verdict(BaseModel):
    keep: bool
    score: float
    reason: str


@dataclass
class Judged:
    candidate: Candidate
    score: float
    kept: bool


async def _judge_one(prompt: str, candidate: Candidate) -> Verdict:
    contents = (
        f"<draft_prompt>\n{prompt[:_PROMPT_CHARS]}\n</draft_prompt>\n"
        f'<knowledge kind="{candidate.kind}">\nTitle: {candidate.title}\nSummary: {candidate.summary}\n'
        f"Tags: {', '.join(candidate.matched_tags)}\n</knowledge>"
    )
    call = gemini.generate_structured(
        operation="enhance.judge",
        model=get_settings().judge_model,
        system=JUDGE_SYSTEM,
        contents=contents,
        schema=Verdict,
        temperature=0.0,
        thinking_level="minimal",
    )
    return await asyncio.wait_for(call, JUDGE_TIMEOUT_S)


async def judge(prompt: str, candidates: list[Candidate]) -> tuple[list[Judged], int]:
    """Judge all candidates; returns verdicts and the number of failed/timed-out calls.

    Raises UpstreamError only when every call failed and at least one failed with an upstream error.
    """
    results = await asyncio.gather(*(_judge_one(prompt, c) for c in candidates), return_exceptions=True)
    judged: list[Judged] = []
    failures: list[BaseException] = []
    for candidate, result in zip(candidates, results, strict=True):
        if isinstance(result, BaseException):
            failures.append(result)
            judged.append(Judged(candidate, 0.0, False))
            continue
        score = round(min(max(result.score, 0.0), 1.0), 4)
        judged.append(Judged(candidate, score, result.keep and score >= KEEP_SCORE))
    errors = [f for f in failures if not isinstance(f, TimeoutError)]
    if candidates and errors and len(failures) == len(candidates):
        first = errors[0]
        raise first if isinstance(first, UpstreamError) else UpstreamError("upstream_error", "judge failed")
    return judged, len(failures)
