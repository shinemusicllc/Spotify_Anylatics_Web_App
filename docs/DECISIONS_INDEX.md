# SpotiCheck Decisions Index

## Active Decisions

- UI hero images must not stretch low-resolution square Spotify covers into full-width banners. Use a quality-gated hero background and fallback image, with small collage tiles for available covers.
- Frontend remains vanilla HTML/CSS/JS served by FastAPI; do not add a build step for UI-only changes.
- VPS deployment remains Docker Compose under `deploy/` with shared Caddy routing.

## Historical Detail

- Use `docs/DECISIONS.md` only when old rollout or infrastructure rationale is needed.
