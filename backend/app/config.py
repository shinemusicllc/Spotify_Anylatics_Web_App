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
    SPOTIFY_HTTP_TIMEOUT_SECONDS: float = 8.0

    # Spotify auth (legacy placeholders)
    SPOTIFY_EMAIL: str = ""
    SPOTIFY_PASSWORD: str = ""

    # Crawl Settings
    CRAWL_DELAY_SECONDS: float = 0.2
    MAX_RETRIES: int = 2
    CRAWL_TASK_MAX_CONCURRENCY: int = 8
    RATE_LIMIT_PER_MINUTE: int = 60
    PLAYLIST_PAGE_SIZE: int = 100
    PLAYLIST_MAX_TRACKS: int = 2000
    PLAYWRIGHT_ENABLE_FALLBACK: bool = False
    PLAYWRIGHT_INLINE_FALLBACK: bool = False
    PLAYWRIGHT_FAST_FAIL_ERRORS: bool = False
    # Keep this off by default: if True, track flow always re-checks visible playcount via Playwright.
    PLAYWRIGHT_COMPARE_VISIBLE_PLAYCOUNT: bool = False
    PLAYWRIGHT_TIMEOUT_MS: int = 45000
    PLAYWRIGHT_WAIT_MS: int = 2500
    PLAYWRIGHT_MAX_CONCURRENCY: int = 3
    PLAYWRIGHT_RETRIES: int = 1
    PLAYWRIGHT_HYDRATE_TIMEOUT_MS: int = 9000
    PLAYWRIGHT_ALBUM_MAX_TRACKS: int = 80

    # CORS
    FRONTEND_URL: str = "http://localhost:8080"
    SERVE_FRONTEND: bool = True
    FRONTEND_DIR: str = "../frontend"

    # App
    SECRET_KEY: str = "change-me-in-production"
    DEBUG: bool = False
    AUTO_INIT_DB: bool = True

    # JWT / Auth
    JWT_SECRET_KEY: str = "change-me-in-production-jwt"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRY_HOURS: int = 24


settings = Settings()
