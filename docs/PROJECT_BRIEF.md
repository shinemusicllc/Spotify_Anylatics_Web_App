# SpotiCheck Project Brief

## Purpose

SpotiCheck is a FastAPI + static frontend app for tracking public Spotify links, grouping rows, comparing metric deltas, and exporting list data.

## Architecture

- `backend/app/` owns API routes, auth, persistence, Spotify fetchers, fallback scraping, and export formatting.
- `frontend/` is a vanilla HTML/CSS/JS dashboard served by FastAPI; there is no frontend build step.
- `deploy/` owns the VPS Docker/Caddy runtime and should not change frontend or API contracts.
- `docs/UI_SYSTEM.md` is the canonical UI style summary.

## Build And Test

- Backend tests: `cd backend && .\venv\Scripts\python.exe -m pytest -q`
- Frontend syntax: `node --check D:\Spotify_AnylaticsWeb_App\frontend\app.js`
- Frontend contract: `node --test D:\Spotify_AnylaticsWeb_App\frontend\tests\ui_contract.test.mjs`
- Docker reference: `docker build -t spoticheck D:\Spotify_AnylaticsWeb_App`

## Invariants

- Keep API responses backward compatible with the existing frontend contract.
- Preserve the deployed Shine UI structure unless a task explicitly changes it.
- After frontend asset changes, bump cache query params in `frontend/index.html`.
- Treat `final3.html` as a design reference only, not runtime source of truth.
