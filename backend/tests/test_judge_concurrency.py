"""The optional per-candidate judge must fan out; the active path fuses review with generation."""

import asyncio
from uuid import uuid4

import pytest

from app.pipeline import judge as judging
from app.pipeline.retrieve import Candidate


@pytest.fixture(scope="session", autouse=True)
def database():
    """No service access is needed to test scheduling."""


async def test_all_candidates_start_before_any_verdict_finishes(monkeypatch):
    candidates = [Candidate(uuid4(), "prompt", f"item-{i}", "summary", "body", 0.9) for i in range(5)]
    started = set()
    all_started = asyncio.Event()
    release = asyncio.Event()

    async def judge_one(prompt, candidate):
        started.add(candidate.id)
        if len(started) == len(candidates):
            all_started.set()
        await release.wait()
        return judging.Verdict(keep=True, score=0.9, reason="directly useful")

    monkeypatch.setattr(judging, "_judge_one", judge_one)
    task = asyncio.create_task(judging.judge("draft", candidates))
    try:
        # A serial implementation cannot reach all_started until the first call is released.
        await asyncio.wait_for(all_started.wait(), timeout=1)
        assert not task.done()
    finally:
        release.set()
        results, failures = await task
    assert failures == 0 and all(result.kept for result in results)
    assert [result.candidate.id for result in results] == [candidate.id for candidate in candidates]


async def test_one_timed_out_filter_does_not_drop_other_verdicts(monkeypatch):
    candidates = [Candidate(uuid4(), "prompt", f"item-{i}", "summary", "body", 0.9) for i in range(3)]

    async def judge_one(prompt, candidate):
        if candidate.id == candidates[1].id:
            raise TimeoutError
        await asyncio.sleep(0)
        return judging.Verdict(keep=True, score=0.9, reason="directly useful")

    monkeypatch.setattr(judging, "_judge_one", judge_one)
    results, failures = await judging.judge("draft", candidates)
    assert failures == 1
    assert [result.kept for result in results] == [True, False, True]
