from fastapi import APIRouter
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
async def enhance(body: _ValidatedEnhanceRequest) -> EnhanceResponse:
    set_request_id(body.request_id)  # AI-call logs group under the client's request id
    return await run_enhance(body)
