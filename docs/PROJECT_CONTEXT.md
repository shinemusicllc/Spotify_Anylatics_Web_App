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

## Mail Stack Tren VPS

- VPS nay dang duoc chuan bi them stack mail tu host phu `mail.congmail.top`.
- Stack mail chon `docker-mailserver` de tranh tranh chap `80/443` voi Caddy hien co.
- Caddy se giu site `mail.congmail.top` de cap va renew cert Let's Encrypt; mail stack se dung cert do sau khi DNS `mail` da tro dung.
- Helper `mailops use-caddy-cert` copy fullchain cua Caddy vao `docker-data/dms/custom-certs/` de `docker-mailserver` nap cert on dinh cho SMTP/IMAP.
- Truoc khi cutover MX, can doi `PTR/rDNS` cua `82.197.71.6` sang `mail.congmail.top`.
- Mailbox runtime hien tai chi con `contact@congmail.top`, `postmaster@congmail.top`, alias `admin@congmail.top`, va alias `dmarc@congmail.top`.
- Helper `mailops dns-records` duoc dung de in bo DNS cutover live, tranh chep tay DKIM/SPF/DMARC.
- Helper `mailops delete-account` va `mailops delete-alias` duoc dung de don bootstrap cu ma khong can goi truc tiep `setup` trong container.

## Data Types

| Type     | Key Metrics                                 |
| -------- | ------------------------------------------- |
| Artist   | name, followers, monthly_listeners, image   |
| Track    | name, playcount, artists, album, image      |
| Album    | name, track_count, tracks, cover            |
| Playlist | name, followers, owner, track_count, tracks |
