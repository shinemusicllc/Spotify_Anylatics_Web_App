"""
SpotiCheck Backend — FastAPI Application Entry Point.

Serves API endpoints and optionally static frontend files.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import init_db
from app.api.router import router as api_router

# ── Logging ──
logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("spoticheck")


# ── Lifespan ──
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup/shutdown events."""
    logger.info("Starting SpotiCheck API...")

    # Create DB tables (dev — use Alembic in production)
    if settings.DEBUG:
        await init_db()
        logger.info("Database tables created (dev mode)")

    yield

    logger.info("Shutting down SpotiCheck API...")


# ── App ──
app = FastAPI(
    title="SpotiCheck API",
    description="Spotify link monitoring and analytics backend",
    version="0.1.0",
    lifespan=lifespan,
)

# ── CORS ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        settings.FRONTEND_URL,
        "http://localhost:8080",
        "http://localhost:3000",
        "http://127.0.0.1:8080",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routes ──
app.include_router(api_router)

# ── Serve frontend static files (optional — for single-service deployment) ──
# Uncomment below to serve frontend from the same service:
# app.mount("/", StaticFiles(directory="../frontend", html=True), name="frontend")
