"""Application configuration via Pydantic Settings."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Central configuration - reads from .env or environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Database
    DATABASE_URL: str = (
        "postgresql+asyncpg://postgres:password@localhost:5432/spoticheck"
    )

    # Optional Spotify API app credentials (client-credentials flow)
    SPOTIFY_CLIENT_ID: str = ""
    SPOTIFY_CLIENT_SECRET: str = ""
    SPOTIFY_CLIENT_TOKEN: str = ""

    # Spotify auth (legacy placeholders)
    SPOTIFY_EMAIL: str = ""
    SPOTIFY_PASSWORD: str = ""

    # Crawl Settings
    CRAWL_DELAY_SECONDS: float = 0.2
    MAX_RETRIES: int = 2
    RATE_LIMIT_PER_MINUTE: int = 60
    PLAYLIST_PAGE_SIZE: int = 100
    PLAYLIST_MAX_TRACKS: int = 2000

    # CORS
    FRONTEND_URL: str = "http://localhost:8080"

    # App
    SECRET_KEY: str = "change-me-in-production"
    DEBUG: bool = True


settings = Settings()
