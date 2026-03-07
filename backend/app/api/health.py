"""Health check endpoint."""

from fastapi import APIRouter

from app.config import settings

router = APIRouter()


@router.get("/health")
async def health():
    """Health check endpoint."""
    return {
        "status": "ok",
        "service": "spoticheck-api",
        "version": "0.1.0",
        "playwright_fallback_enabled": settings.PLAYWRIGHT_ENABLE_FALLBACK,
        "debug": settings.DEBUG,
        "source_marker": "backend-local-20260307-fallback-fix",
    }
