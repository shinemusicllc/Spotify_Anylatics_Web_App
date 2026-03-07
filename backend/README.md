# SpotiCheck Backend

## Local run

Requirements:
- Python 3.12+
- PostgreSQL 15+

```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium
copy .env.example .env
uvicorn app.main:app --reload --port 8010
```

API docs: `http://localhost:8010/docs`

## Railway deploy (Playwright + PostgreSQL)

This repo includes a root `Dockerfile` for Railway, with Chromium dependencies for Playwright.

Recommended setup:
1. Create a new Railway project from this GitHub repo.
2. Add a PostgreSQL service in Railway.
3. In backend service variables, set:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - `DEBUG=false`
   - `AUTO_INIT_DB=true`
   - `SERVE_FRONTEND=true`
   - `FRONTEND_DIR=../frontend`
   - `PLAYWRIGHT_ENABLE_FALLBACK=true`
4. Deploy.

Health check endpoint: `/api/health`

Notes:
- `pgAdmin 4` is not required on Railway.
- You can still use local pgAdmin to connect to Railway PostgreSQL if needed.
