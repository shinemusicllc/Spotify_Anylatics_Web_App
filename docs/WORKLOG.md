# SpotiCheck Analytics - Work Log

## 2026-03-06

### Task: Planning and UI review

- Status: done
- Actions:
  - Reviewed `final3.html` as the original design reference.
  - Created the first project memory files.
  - Planned frontend extraction and backend scaffolding.

### Task: Frontend extraction

- Status: done
- Actions:
  - Split `final3.html` into `frontend/index.html`, `frontend/style.css`, and `frontend/app.js`.
  - Added runtime UI behaviors such as dynamic labels, popup window support, Add Link modal, and loading/toast states.

### Task: Backend scaffold

- Status: done
- Actions:
  - Added FastAPI app structure, DB models, routes, Spotify services, Dockerfile, and Python requirements.

## 2026-03-16

### Task: Sync local workspace to Shine baseline and reapply multi-artist titles

- Status: done
- Actions:
  - Created `codex/backup-before-shine-sync-20260316` and stashed the old local workspace before syncing.
  - Checked out `codex/shine-sync-20260316` from `shinemusic/main` at commit `de59c2a` to match the Shine baseline.
  - Reapplied the track/album multi-artist title fix on top of the Shine branch in backend and frontend.
  - Added focused tests for multi-artist title behavior and verified runtime output in the browser.
  - Bootstrapped missing rule files on the Shine branch: root/subfolder `AGENTS.md` plus `docs/CHANGELOG.md`.
- Notes:
  - Shine export helpers intentionally return `headers = []` for some spreadsheet modes, so regression tests now follow that contract.
  - Local app was restarted on port `8010` after the sync so browser checks now use the Shine-based workspace.

### Task: Enforce per-user duplicate link skipping on Add Link

- Status: done
- Actions:
  - Updated crawl endpoints to skip duplicate links when the same `user_id` already tracks the same `item_type + spotify_id`.
  - Kept cross-user tracking valid, so the same Spotify link can still exist for admin, user 1, and user 2 independently.
  - Updated Add Link frontend flow to handle backend duplicate skips without breaking batch job mapping.
  - Added backend and frontend regression tests, then reloaded the local app with a bumped asset version.
- Notes:
  - Duplicate add attempts now return a skip response instead of creating a second item/job for the same user.
  - Legacy admin rows with `user_id = null` are still treated as admin-owned during duplicate checks for the admin account.

### Task: Scope admin All Links to admin-owned rows only

- Status: done
- Actions:
  - Changed admin default list scope from global to self-only by always sending the admin user's own `user_id` when no user filter is selected.
  - Renamed the admin user filter default option from `All Users` to `My Links`.
  - Removed the `Skip duplicate links` checkbox from the Add Link modal because duplicate skipping is now enforced server-side per user.
  - Ran backend tests, frontend contract checks, and browser smoke verification on the local app bundle `v=20260316-68`.
- Notes:
  - Admin can still inspect another user's links by selecting that user explicitly in the dropdown.
  - Existing backend dedupe behavior remains active even though the manual UI toggle was removed.

### Task: Restore full album and track artist titles from raw payloads

- Status: done
- Actions:
  - Added top-level album `artist_names` and `artists` to the normalized Pathfinder album payload.
  - Updated stored item title formatting so albums also use the full artist list and strip stale single-artist prefixes.
  - Added fallback extraction from album track rows so older raw responses without album-level artist arrays still render/export the full artist list.
  - Added regression tests for album track fallback extraction and stale-prefix cleanup.
- Notes:
  - Existing rows should display correctly after reload as long as their raw album tracks contain the full artist list.
  - Newly crawled albums now persist the full album artist list directly in raw responses.

### Task: Simplify admin user filter to real users only

- Status: done
- Actions:
  - Removed the pseudo filter option `My Links` from the admin user dropdown.
  - Defaulted the admin filter selection to the admin account itself so `All Links` always means all links of the selected user.
  - Kept user switching behavior intact for viewing another user's list and groups.
  - Bumped the frontend asset version to `v=20260316-69` and re-ran frontend contract checks.
- Notes:
  - Admin list scope is still self by default, but now represented by selecting the admin user directly instead of a synthetic option.

## 2026-03-17

### Task: Expand admin user management and remove hidden list cap

- Status: done
- Actions:
  - Removed the implicit `100`-item dashboard cap by making the backend item listing endpoint unbounded by default when no `limit` is provided.
  - Extended admin user editing so `PATCH /auth/users/{user_id}` can update `username`, including duplicate checks and internal-email refresh.
  - Updated the admin Users modal to allow editing usernames and to refresh local auth UI when the current admin edits their own account.
  - Removed owner-name prefixes from admin group labels in the sidebar.
  - Added a resizable `Stt` column before `Asset Details` across the header, row render, and stylesheet layout.
  - Added backend/frontend regression coverage and restarted the local app on port `8010`.
- Notes:
  - The user-facing "100 links" problem came from list loading, not from crawl creation limits.
  - Changes were kept local only; nothing was pushed to GitHub.

### Task: Verify move-items endpoint coverage

- Status: done
- Actions:
  - Confirmed the existing `POST /items/move` endpoint, `ItemMoveRequest` schema, and group reply follow the requested contract for both admins and regular users.
  - Added focused pytest coverage that enforces 404 responses when a user tries to move another user's items and validates admin move handling.
  - Ran `backend/tests/test_items_move.py` along with `backend/tests/test_admin_user_updates.py` to ensure the targeted suite passes.
- Notes:
  - Tests now simulate query filtering by returning no rows for unauthorized users before asserting the 404.

### Task: Add link move interactions across keyboard, menu, and drag-drop

- Status: done
- Actions:
  - Added an internal row-move clipboard in `frontend/app.js` so `Ctrl/Cmd+C`, `Ctrl/Cmd+X`, and `Ctrl/Cmd+V` can move one or many selected links into a target group or before a target row.
  - Added Enter-to-submit handling for admin edit/create/reset-password modals and settings save/change-password fields while skipping textareas and custom dropdown controls.
  - Extended the row context menu with a `Move to group` submenu plus a `Move Clipboard` action that uses the live sidebar group list, including `No Group`.
  - Extended row drag/drop so selected rows can still reorder inside the list and can now be dropped onto sidebar groups to change `item.group`.
  - Added `Selected` KPI chips to the hero and footer, updated frontend contract tests, and smoke-checked the authenticated dashboard locally on `http://127.0.0.1:8010`.
- Notes:
  - The existing structured-export clipboard action remains unchanged; the new move clipboard is app-local state and does not touch the OS clipboard.

### Task: Repair local move flow and restore multi-link copy action

- Status: done
- Actions:
  - Verified the running local backend had not been restarted yet, which is why `/api/items/move` was missing from `openapi.json` and drag/group moves returned `Method Not Allowed`.
  - Restarted the local app on port `8010` and confirmed the live server now exposes `POST /api/items/move`.
  - Changed the context-menu action formerly labeled `Move Clipboard` into `Copy Link`, copying one or many selected Spotify URLs as newline-separated plain text.
  - Reassigned `Ctrl/Cmd+C` in `linkchecker` to copy selected Spotify URLs, while keeping `Ctrl/Cmd+X` / `Ctrl/Cmd+V` for cut/paste move behavior.
  - Moved the footer `Selected` stat to the left side of `API Status`, bumped the frontend asset version to `v=20260317-72`, and re-ran frontend/backend checks.
- Notes:
  - A Playwright drag simulation still timed out on synthetic `dragTo`, but the live server route is present and the dashboard reload now shows zero console errors.

### Task: Widen footer Selected spacing

- Status: done
- Actions:
  - Increased the footer `Selected` slot width and switched the value span to `tabular-nums` with a right-aligned minimum width.
  - Bumped the frontend asset version to `v=20260317-73` and reloaded the local app on `http://127.0.0.1:8010`.
  - Re-ran the frontend contract test suite after the markup update.
- Notes:
  - The change is layout-only and specifically protects larger counts like `1000+` from crowding the divider or `API Status`.

### Task: Highlight search results by group color in All Links

- Status: done
- Actions:
  - Added deterministic accent colors per group name and reused them across sidebar group cards and list rows.
  - Updated `renderGroups()` to recalculate sidebar highlight state when searching in `All Links`, including full-card glow on matched groups.
  - Updated `renderRow()` so rows matching a search in `All Links` show a brighter accent edge and card outline based on their owning group.
  - Bumped frontend assets to `v=20260317-74`, added frontend contract coverage, and smoke-checked search mode locally with the `jazz` query.
- Notes:
  - The accent mode only activates while `searchQuery` is non-empty and `All Links` is the active scope, so normal browsing remains visually unchanged.

### Task: Soften search highlight cards into full-card glow

- Status: done
- Actions:
  - Reworked the search-match group card style to remove the hard left stripe and use an even tinted fill with rounded-card glow.
  - Reworked the search-match row style to use the same full-card tint model instead of a vertical accent bar.
  - Bumped frontend assets to `v=20260317-75`, re-ran frontend tests, and smoke-checked the `All Links` search view locally.
- Notes:
  - The update is purely visual; search/group matching logic and accent color assignment stay unchanged.

### Task: Restore rounded left accent line without card borders

- Status: done
- Actions:
  - Restored the left accent line for search-matched group cards and list rows, but inset it inside the card with rounded ends.
  - Removed the border-like highlight treatment so the active search state now relies on inner fill color plus the rounded accent line.
  - Bumped frontend assets to `v=20260317-76`, re-ran frontend tests, and smoke-checked `All Links` search locally.
- Notes:
  - The accent line is now decorative only; the search highlight emphasis comes from fill color rather than card outline.

### Task: Remove outer glow from search highlight cards

- Status: done
- Actions:
  - Removed all outer `box-shadow` glow from search-highlighted group cards and rows.
  - Tightened the left accent line inset to sit closer to the card edge while keeping rounded ends.
  - Bumped frontend assets to `v=20260317-77`, re-ran frontend tests, and verified computed styles locally during `All Links` search.
- Notes:
  - The search highlight now uses only inner fill color plus the inset rounded left line, with no blur spilling outside the card bounds.

### Task: Refine search accent line shape and add STT header divider

- Status: done
- Actions:
  - Adjusted the search-highlight accent stripe for sidebar group cards and list rows into an inset pill with a softer inner edge while keeping all glow clipped inside the card.
  - Added a vertical divider at the left edge of the `Asset Details` header cell so the `STT` column boundary now matches the other header separators.
  - Bumped frontend assets to `v=20260317-79`, re-ran the frontend contract tests, and smoke-checked the local UI search state at `http://127.0.0.1:8010`.
- Notes:
  - The refinement is visual only; search/group matching logic is unchanged.

### Task: Stabilize large batch add flow and add Checked sort controls

- Status: done
- Actions:
  - Confirmed from local `uvicorn-8010.err.log` that large add batches were triggering `sqlalchemy.exc.TimeoutError: QueuePool limit of size 5 overflow 10 reached` during authenticated API requests and crawl job work.
  - Added backend crawl throttling via `CRAWL_TASK_MAX_CONCURRENCY` and a new `POST /api/jobs/batch` endpoint so the frontend can poll many jobs in one request instead of one request per job.
  - Updated the frontend polling flow to batch-fetch pending job states and added a `Checked` sort menu with `Error First`, `Crawling First`, `Active First`, `Newest Check`, and `Oldest Check`.
  - Restarted the local app on port `8010`, re-ran frontend/backend targeted tests, and smoke-checked the new `Checked` sort in the browser.
- Notes:
  - The previous red/offline recovery behavior came from DB pool starvation under combined crawl + poll pressure; the links still appeared later because the backlog eventually drained.

### Task: Reposition Checked sort control inline with header label

- Status: done
- Actions:
  - Moved the `Checked` sort controls to sit immediately after the `Checked` label instead of floating at the far edge of the header cell.
  - Updated the checked-header dropdown menu anchor so the menu opens from the inline control without affecting the rest of the column layout.
  - Bumped frontend assets to `v=20260317-81`, re-ran the frontend contract tests, and verified the served HTML references the new bundle.
- Notes:
  - This change is layout-only; the available `Checked` sort modes and backend behavior are unchanged.

### Task: Clamp Checked sort dropdown inside viewport

- Status: done
- Actions:
  - Tightened the spacing between the `Checked` label and its sort trigger so the control now reads as a single inline header cluster.
  - Added runtime positioning for the `Checked` dropdown so it flips inward near the right viewport edge instead of overflowing out of frame.
  - Bumped frontend assets to `v=20260317-82`, re-ran the frontend contract tests, and verified in the browser that the open menu stays within the viewport bounds.
- Notes:
  - This is a presentational fix only; the Checked filter options and sorting behavior are unchanged.

### Task: Diagnose duplicate highlight colors across groups

- Status: done
- Actions:
  - Verified the local `origin/main` code still uses a fixed `GROUP_ACCENT_PALETTE` with only eight colors to derive search highlight accents.
  - Recomputed the current hash slots for `Follow > 5` and `312` and confirmed both names land on palette slot `4`, which resolves to the same purple RGB value `168,85,247`.
  - Confirmed the row/card highlight styles in `frontend/style.css` consume the same `--group-accent-rgb` CSS variable for both sidebar cards and list rows, so a palette collision makes both groups and their rows look identical.
- Notes:
  - This is expected behavior of the current implementation, not a separate row-mapping bug.

### Task: Remove group highlight color collisions

- Status: done
- Actions:
  - Replaced the fixed eight-color `GROUP_ACCENT_PALETTE` logic in `frontend/app.js` with hash-derived HSL accent generation so each group gets a stable color from its full name rather than a small shared palette.
  - Updated the frontend contract test to assert the new accent-generation helpers exist and that the old palette constant is gone.
  - Bumped frontend assets to `v=20260318-84`, re-ran `node --check` and `node --test`, and confirmed the local app is serving the new bundle.
- Notes:
  - The previously colliding groups `Follow > 5` and `312` now resolve to different RGB accents, so matching rows/cards no longer look like they belong to the same group during `All Links` search.

## 2026-03-19

### Task: Migrate deployment target from Railway to VPS

- Status: done
- Actions:
  - Re-read project memory and existing root/subfolder rules, then extended the root `AGENTS.md` with VPS deployment commands/module boundaries and created `deploy/AGENTS.md` for the new deployment area.
  - Added tracked VPS runtime files under `deploy/`: `.env.example`, `docker-compose.vps.yml`, `Caddyfile`, and `README.md`.
  - Connected to the Ubuntu 24.04 VPS `82.197.71.6`, installed `docker.io` and `docker-compose-v2`, created a non-root `deploy` user with `sudo` + `docker` access, and cloned the GitHub repo to `/opt/spoticheck/app`.
  - Uploaded the new deployment files, generated production secrets directly on the VPS in `/opt/spoticheck/app/deploy/.env`, and started the stack with `docker compose -f docker-compose.vps.yml --env-file .env up -d --build`.
  - Verified the new containers `deploy-db-1`, `deploy-app-1`, and `deploy-caddy-1` are healthy, and confirmed the VPS answers on `http://82.197.71.6` with `Host: spotify.jazzrelaxation.com` before DNS cutover.
  - Re-ran `backend` pytest and the frontend contract checks locally after the deployment config changes.
- Notes:
  - Public DNS for `spotify.jazzrelaxation.com` still points to Railway as of `2026-03-19`, so Caddy cannot complete Let's Encrypt issuance until the Cloudflare record is switched to the VPS.
  - No Railway PostgreSQL credentials were available in the workspace, so this rollout provisions a fresh PostgreSQL volume on the VPS; production data migration remains pending until the source DB can be exported.

### Task: Migrate Railway PostgreSQL data and automate VPS operations

- Status: done
- Actions:
  - Confirmed the local workspace still did not contain real Railway PostgreSQL credentials, then used the Railway `Settings` + `Variables` values provided by the user to reconstruct the public source DB URL with `sslmode=require`.
  - Added tracked helper scripts under `deploy/scripts/` for `backup_postgres`, `migrate_from_database_url`, `redeploy`, `update_app`, and the `spoticheck` wrapper, plus `deploy/systemd/` units for an automated backup timer.
  - Installed the helper wrapper on the VPS as `/usr/local/bin/spoticheck`, created quick shell aliases for the `deploy` user, and enabled `spoticheck-backup.timer`.
  - Ran manual PostgreSQL backups on the VPS, then migrated Railway data into the VPS PostgreSQL by dumping from Railway public TCP access and restoring into the local containerized DB.
  - Adjusted the migration flow for PostgreSQL 17 -> 16 compatibility by using a PostgreSQL 17 dump client and stripping the unsupported `SET transaction_timeout = 0;` line before restore.
  - Verified the post-migration row counts on the VPS: `users=3`, `items=230`, `crawl_jobs=430`, `metrics_snapshots=430`, `raw_responses=1017`, and confirmed `https://spotify.jazzrelaxation.com/api/health` still returns `ok`.
- Notes:
  - Root password SSH was intentionally left enabled per user request; easier access is provided through the additional `deploy` user, SFTP/WinSCP compatibility, aliases, and the `spoticheck` wrapper command.
  - The automated backup timer is scheduled daily at `03:17` server time and writes compressed dumps to `/opt/spoticheck/backups/postgres`.

### Task: Extend shared Caddy for the video app and recover from compose-name collision

- Status: done
- Actions:
  - Updated `deploy/Caddyfile` so the existing Caddy instance can also reverse proxy `video.jazzrelaxation.com` to `host.docker.internal:8011`.
  - Updated `deploy/docker-compose.vps.yml` to add `host.docker.internal:host-gateway` for the Caddy container.
  - During the first video-app rollout, detected that the second repo reused Docker Compose's default project name `deploy`, which temporarily replaced the Spotify `app` service because both repos deploy from a `deploy/` directory.
  - Restored the Spotify stack on the VPS and verified `deploy-app-1`, `deploy-caddy-1`, and `deploy-db-1` were healthy again.
  - Recorded the rule that all additional VPS apps must use a unique compose project name, then redeployed the video app under its own `lushvideo` project.
- Notes:
  - Spotify public traffic was restored after the stack recovery and `https://spotify.jazzrelaxation.com/api/health` returned `200` again on `2026-03-19`.
  - `video.jazzrelaxation.com` still points to Railway, so Caddy cannot complete certificate issuance for that hostname until Cloudflare DNS is switched to the VPS.

### Task: Add admin credential rotation helper for VPS operations

- Status: done
- Actions:
  - Confirmed the migrated runtime now stores auth in PostgreSQL `users` and no longer rotates admin login through env-only config.
  - Added `deploy/scripts/set_admin_credentials.sh` to update `username`, internal email, and `password_hash` with the same bcrypt helper used by the app.
  - Extended the `spoticheck` wrapper and deploy docs so the VPS can rotate admin credentials with one command.
- Notes:
  - Existing JWT sessions are not revoked by this helper; the change affects the next login attempt.
