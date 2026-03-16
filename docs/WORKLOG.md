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
