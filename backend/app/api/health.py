"""Health check endpoint."""

from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
async def health():
    """Health check — returns API status."""
    return {"status": "ok", "service": "spoticheck-api", "version": "0.1.0"}
