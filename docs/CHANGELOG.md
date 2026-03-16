# Changelog

### 2026-03-16 11:20 - Sync to Shine baseline and restore multi-artist titles
- Added: root `AGENTS.md`, `backend/AGENTS.md`, `frontend/AGENTS.md`, `backend/tests/test_multi_artist_titles.py`, `frontend/tests/ui_contract.test.mjs`.
- Changed: local workspace moved to `shinemusic/main` baseline commit `de59c2a`; track/album title formatting now uses the full artist list in UI and export helpers.
- Fixed: stale single-artist prefixes in copied/exported track and album titles; local app cache now refreshes with the new JS bundle version.
- Affected files: `backend/app/api/items.py`, `frontend/app.js`, `frontend/index.html`, docs and test files above.
- Impact/Risk: local UI now matches the Shine branch baseline with only the multi-artist title diff layered on top; existing stale DB rows still depend on available `artist_names` data.

### 2026-03-16 11:50 - Enforce per-user duplicate skipping for Add Link
- Added: `backend/tests/test_crawl_user_dedupe.py`.
- Changed: crawl responses now report duplicate skips and accepted batch indices so the frontend can map created jobs correctly.
- Fixed: the same user can no longer add the same Spotify link multiple times, while different users can still track the same link independently.
- Affected files: `backend/app/api/crawl.py`, `backend/app/schemas/crawl.py`, `frontend/app.js`, `frontend/index.html`, test files above.
- Impact/Risk: duplicate prevention is now scoped to `user_id`; pre-existing duplicate rows already in the database are not auto-merged by this patch.

### 2026-03-16 11:58 - Restrict admin All Links to admin-owned rows
- Added: frontend contract coverage for admin self-scope and duplicate-toggle removal.
- Changed: admin default filter label is now `My Links`; admin list fetches default to the admin user's own `user_id`.
- Fixed: `All Links` in admin mode no longer shows every user's rows, and the Add Link modal no longer exposes the removed duplicate checkbox.
- Affected files: `frontend/app.js`, `frontend/index.html`, `frontend/tests/ui_contract.test.mjs`, docs above.
- Impact/Risk: global all-user aggregation is no longer available from the default admin state; selecting another user remains supported.

### 2026-03-16 12:08 - Fix incomplete album and track artist titles
- Added: backend regression coverage for album artist extraction from nested track data.
- Changed: normalized album payloads now keep top-level `artist_names`/`artists`, and crawler formatting uses the full artist list for album titles too.
- Fixed: UI and export album titles no longer collapse to only the first artist when the raw response still contains the complete credited list.
- Affected files: `backend/app/api/items.py`, `backend/app/services/spotify_client.py`, `backend/app/services/crawler.py`, `backend/tests/test_multi_artist_titles.py`.
- Impact/Risk: existing rows still depend on stored raw track artist data for fallback; rows with incomplete raw data may need recrawl.

### 2026-03-16 12:15 - Remove pseudo admin filter option
- Added: frontend contract coverage for defaulting the admin filter to a real user selection.
- Changed: the admin user dropdown now lists only actual users and defaults to the admin account itself.
- Fixed: `All Links` semantics now consistently mean all links of the currently selected user without showing a synthetic `My Links` option.
- Affected files: `frontend/app.js`, `frontend/index.html`, `frontend/tests/ui_contract.test.mjs`, docs above.
- Impact/Risk: any workflow expecting an empty admin filter state no longer applies; admin self-scope is now explicit via the selected admin user.
