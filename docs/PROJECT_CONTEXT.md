# SpotiCheck Analytics — Project Context

## Mục tiêu

Web app cào dữ liệu từ Spotify (internal API) để theo dõi metrics: monthly_listeners, playcount, followers cho Artist, Track, Album, Playlist.

## Stack

- **Frontend**: HTML + Tailwind CDN + Vanilla JS
- **Backend**: Python FastAPI + Playwright + httpx + PostgreSQL
- **ORM**: SQLAlchemy + Alembic
- **Config**: Pydantic Settings
- **Deploy**: Docker + Railway

## Kiến trúc (Phương án A — Hybrid)

- **API + Worker chung 1 service** cho MVP
- **Auth Manager**: Playwright (cold start) → httpx (hot path) → proactive refresh
- **Rate limiter**: configurable delay + exponential backoff

## Workspace

- `D:\Spotify_AnylaticsWeb_App\` — root
- `frontend/` — HTML/CSS/JS
- `backend/` — FastAPI app
- `final3.html` — UI design gốc (reference, không chỉnh)

## Data Types

| Type     | Key Metrics                                 |
| -------- | ------------------------------------------- |
| Artist   | name, followers, monthly_listeners, image   |
| Track    | name, playcount, artists, album, image      |
| Album    | name, track_count, tracks, cover            |
| Playlist | name, followers, owner, track_count, tracks |
