# Deploy Delta Rules

- Keep deployment config in `deploy/` focused on runtime orchestration; do not bake secrets into tracked files.
- Prefer `docker compose` inputs (`.env`, `docker-compose.vps.yml`, `Caddyfile`) over one-off shell state on the server.
- Keep operational shell scripts in `deploy/scripts/` and systemd units in `deploy/systemd/`.
- Reverse proxy must forward the single FastAPI service that already serves the frontend; do not introduce a second frontend runtime unless requirements change.
- Database changes for VPS rollout must preserve the existing PostgreSQL schema and avoid changing API/auth contracts.
