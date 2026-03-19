# VPS Deployment

This folder contains the tracked runtime config for the VPS stack:

- `docker-compose.vps.yml`: app + PostgreSQL + Caddy
- `.env.example`: environment template
- `Caddyfile`: reverse proxy for the public domain
- `scripts/`: operational commands for redeploy, backup, and data migration
- `systemd/`: timer/service units for automated backups

Recommended rollout:

1. Copy `.env.example` to `.env` and fill in real secrets.
2. Run `docker compose -f docker-compose.vps.yml --env-file .env up -d --build`.
3. Verify the app locally on the VPS with:
   - `docker compose -f docker-compose.vps.yml --env-file .env ps`
   - `docker compose -f docker-compose.vps.yml --env-file .env logs -f app`
   - `curl http://127.0.0.1/api/health -H "Host: spotify.jazzrelaxation.com"`
4. Point Cloudflare DNS for `spotify.jazzrelaxation.com` to the VPS and keep the record proxied.
5. Re-check `https://spotify.jazzrelaxation.com/api/health` after DNS cutover.

Operational notes:

- The app still serves the frontend from FastAPI; there is no separate frontend container.
- Persistent business data lives in PostgreSQL (`postgres_data` volume).
- Caddy manages the origin certificate once the public domain resolves to this VPS.
- After installing the helper wrapper, day-to-day commands can use `spoticheck status|logs|backup|redeploy|update|set-admin`.
- `scripts/migrate_from_database_url.sh` expects a real source PostgreSQL URL in `SOURCE_DATABASE_URL`; this is intended for Railway or any other external PostgreSQL source.
- `spoticheck set-admin [--current <old_admin>] [--username <new_admin>] [--password <new_password>]` rotates the persisted admin login in PostgreSQL. If `--current` is omitted, the script auto-selects the only admin account. If `--password` is omitted, the script prompts securely.
