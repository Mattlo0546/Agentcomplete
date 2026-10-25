import asyncio
import contextlib

from fastapi import APIRouter, HTTPException, Request
from pydantic import model_validator

from app.observability.context import set_request_id
from app.pipeline.run import run_enhance
from app.schemas.enhance import MAX_PROMPT_UNITS, EnhanceRequest, EnhanceResponse, utf16_len

router = APIRouter()


class _ValidatedEnhanceRequest(EnhanceRequest):
    @model_validator(mode="after")
    def _bounds(self) -> "_ValidatedEnhanceRequest":
        units = utf16_len(self.prompt)
        if units > MAX_PROMPT_UNITS:
            raise ValueError(f"prompt exceeds {MAX_PROMPT_UNITS} UTF-16 code units")
        if self.cursor > units:
            raise ValueError("cursor exceeds prompt length")
        return self


@router.post("/enhance", response_model=EnhanceResponse)
async def enhance(body: _ValidatedEnhanceRequest, request: Request) -> EnhanceResponse:
    # The API-call log row and the AI-call logs both group under the client's request id.
    request.state.request_id = body.request_id
    set_request_id(body.request_id)
    pipeline = asyncio.create_task(run_enhance(body))
    disconnected = asyncio.create_task(_wait_for_disconnect(request))
    try:
        done, _ = await asyncio.wait((pipeline, disconnected), return_when=asyncio.FIRST_COMPLETED)
        if pipeline in done:
            return pipeline.result()
        # Superseded browser requests must release provider connections and stop spending quota.
        raise HTTPException(status_code=499, detail="Client disconnected")
    finally:
        for task in (pipeline, disconnected):
            if not task.done():
                task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                # Retrieve failures too, including a disconnect racing an upstream failure.
                await asyncio.gather(task, return_exceptions=True)


async def _wait_for_disconnect(request: Request) -> None:
    # FastAPI has already consumed the validated JSON body. Awaiting receive avoids polling and
    # observes an actual ASGI disconnect instead of cancelling a healthy long-running generation.
    while (await request.receive())["type"] != "http.disconnect":
        pass
