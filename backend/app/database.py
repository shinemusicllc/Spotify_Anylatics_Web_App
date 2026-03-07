"""SQLAlchemy async engine & session factory."""

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

def _normalize_database_url(raw_url: str) -> str:
    """
    Ensure SQLAlchemy async engine uses asyncpg driver.

    Railway/Postgres plugins often expose `postgresql://...` (or `postgres://...`).
    This backend uses SQLAlchemy async engine, so it must be:
    `postgresql+asyncpg://...`
    """
    url = (raw_url or "").strip()
    if not url:
        return url
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    if url.startswith("postgresql+asyncpg://"):
        return url
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


DATABASE_URL = _normalize_database_url(settings.DATABASE_URL)

engine = create_async_engine(
    DATABASE_URL,
    echo=settings.DEBUG,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
)

async_session = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    """Declarative base for all ORM models."""

    pass


async def get_db() -> AsyncSession:
    """FastAPI dependency — yields an async DB session."""
    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def init_db():
    """Create all tables (dev only — use Alembic in production)."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
