# SpotiCheck Analytics - Project Context

## Muc tieu

Web app crawl du lieu tu Spotify (internal API) de theo doi metrics: `monthly_listeners`, `playcount`, `followers` cho Artist, Track, Album, Playlist.

## Stack

- **Frontend**: HTML + Tailwind CDN + Vanilla JS
- **Backend**: Python FastAPI + Playwright + httpx + PostgreSQL
- **ORM**: SQLAlchemy + Alembic
- **Config**: Pydantic Settings
- **Current Deploy**: Docker Compose + Caddy + PostgreSQL tren VPS `82.197.71.6`
- **Shared Reverse Proxy**: Caddy trong stack nay co the route them internal app khac tren cung VPS khi duoc khai bao host rieng
- **Legacy Deploy**: Railway app + Railway PostgreSQL, da duoc dung lam nguon migrate du lieu vao ngay `2026-03-19`

## Kien truc

- **API + Worker chung 1 service** cho MVP
- **Auth Manager**: Playwright (cold start) -> httpx (hot path) -> proactive refresh
- **Rate limiter**: configurable delay + exponential backoff
- **Frontend serving**: FastAPI mount static frontend tai `/` trong single-service runtime

## Workspace

- `D:\Spotify_AnylaticsWeb_App\` - root
- `frontend/` - HTML/CSS/JS
- `backend/` - FastAPI app
- `deploy/` - VPS runtime config, helper scripts, backup timer units
- `final3.html` - UI design goc (reference, khong chinh)

## Van hanh auth tren VPS

- Tai runtime hien tai, user/password dang duoc luu trong PostgreSQL `users`, khong con xoay qua env.
- Wrapper `spoticheck set-admin` duoc dung de doi `admin username/password` truc tiep trong DB bang chinh hash flow cua app.

## Data Types

| Type     | Key Metrics                                 |
| -------- | ------------------------------------------- |
| Artist   | name, followers, monthly_listeners, image   |
| Track    | name, playcount, artists, album, image      |
| Album    | name, track_count, tracks, cover            |
| Playlist | name, followers, owner, track_count, tracks |
