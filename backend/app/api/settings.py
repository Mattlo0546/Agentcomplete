from fastapi import APIRouter

from app.settings_store import AppSettings, AppSettingsUpdate, load_settings, update_settings

router = APIRouter()


@router.get("/settings")
async def get_app_settings() -> AppSettings:
    return await load_settings()


@router.put("/settings")
async def put_app_settings(update: AppSettingsUpdate) -> AppSettings:
    return await update_settings(update)
