# SpotiCheck Analytics - Decisions Log

| Decision | Reason | Impact | Date |
| --- | --- | --- | --- |
| Choose FastAPI + Playwright + httpx | This stack fits Spotify internal API crawling and fallback browser automation. | High | 2026-03-06 |
| Skip Redis for MVP | Background tasks are enough for the current scope and keep deployment simpler. | Medium | 2026-03-06 |
| Use hybrid auth flow | Playwright for cold auth and httpx for hot-path requests reduces runtime overhead. | High | 2026-03-06 |
| Preserve the original UI layout | User requirement was to keep the familiar layout and only add features carefully. | Medium | 2026-03-06 |
| Split `final3.html` into frontend files | Separation of concerns is required for maintainability and API wiring. | Medium | 2026-03-06 |
| Use Shine main as UI source of truth | The user wants the local app to match the deployed web UI before adding new fixes. | High | 2026-03-16 |
| Build track and album display titles from full `artist_names` | Older rows may still contain a stale single-artist prefix; UI and export must show the full credited list when raw artist data exists. | Medium | 2026-03-16 |
| Deduplicate tracked links per user, not globally | The same Spotify link must be trackable by different users, but each user should own at most one row for that link. | High | 2026-03-16 |
| Default admin list scope to admin-owned links | Admin mode should not silently aggregate every user's rows under `All Links`; cross-user inspection must be explicit via the user filter. | High | 2026-03-16 |
| Derive album artist titles from full raw artist lists with track fallback | Some album payloads or legacy rows only expose the complete credited artist list inside track data; display/export must still show all artists. | High | 2026-03-16 |
| Admin filter should list only real users | Representing the admin's own scope as a fake option is confusing; the selected user should always be an actual account. | Medium | 2026-03-16 |
| Default dashboard item loading to unbounded results | The previous `100` row default made users think they could not add more links even though crawl creation still worked. | High | 2026-03-17 |
| Show admin group labels without owner-name prefixes | Admin users asked to remove repeated owner labels from group names in the sidebar while keeping group ownership logic intact internally. | Medium | 2026-03-17 |
| Use an app-local move clipboard for row relocation | The existing clipboard flow already exports text; link move/cut/paste needs separate state so keyboard shortcuts can target groups or list positions without overwriting OS clipboard content. | Medium | 2026-03-17 |
| Highlight All Links search results with per-group accent colors | When searching globally, users need to identify the owning group at a glance; matching the sidebar card glow and row edge color provides that context without adding extra columns. | Medium | 2026-03-17 |
| Throttle crawl workers and batch job polling for large add operations | Large add batches were exhausting the SQLAlchemy connection pool because hundreds of crawl tasks and per-job poll requests hit the DB at once. | High | 2026-03-17 |
| Derive group highlight accents from full group-name hashes instead of a fixed palette | The eight-color palette caused collisions where different groups such as `Follow > 5` and `312` rendered with the same search highlight color. | Medium | 2026-03-18 |
| Standardize VPS deployment on Docker Compose + Caddy + PostgreSQL | The Railway-specific runtime was becoming cost-inefficient, and the repo already had a production Dockerfile that can serve the frontend and backend together. | High | 2026-03-19 |
| Automate VPS operations with `spoticheck` wrapper + daily PostgreSQL backups | The user wants simple repeatable operations on the VPS without memorizing long Docker commands, and the migrated data now needs routine backups. | High | 2026-03-19 |
| Reuse the existing VPS Caddy to front multiple apps and require unique Compose project names per repo | The Spotify stack already owns public ports `80/443`; additional apps should sit behind the same reverse proxy and must not share Docker Compose's default project name `deploy`, or services can overwrite each other. | High | 2026-03-19 |
| Rotate admin login via `spoticheck set-admin` against PostgreSQL instead of env vars | Bootstrap env vars no longer own persisted auth after migration, so admin credential changes must update the `users` row with the app's bcrypt hash flow. | High | 2026-03-19 |
