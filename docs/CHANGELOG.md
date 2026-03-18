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
### 2026-03-17 16:10 - Expand admin user management and remove hidden list cap
- Added: Backend regression tests for admin username updates and unbounded item listing; frontend `Stt` column with resize support.
- Changed: Admin Users modal now edits `username`; admin group labels now show only the base group name; frontend asset bundle version bumped to `v=20260317-70`.
- Fixed: Removed the hidden `100`-row dashboard cap that made users think they could not add more links.
- Affected files: `backend/app/api/auth.py`, `backend/app/api/items.py`, `backend/app/schemas/auth.py`, `backend/tests/test_admin_user_updates.py`, `frontend/app.js`, `frontend/index.html`, `frontend/style.css`, `frontend/tests/ui_contract.test.mjs`, `docs/DECISIONS.md`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Low to medium; list loading is now unbounded, so extremely large datasets may cost more render time, but current tests and local smoke checks passed.
### 2026-03-17 16:45 - Secure move-items contract
- Added: Focused pytest coverage for `POST /items/move` to assert the `ItemMoveRequest` workflow across user and admin scopes.
- Changed: Unauthorized move tests now simulate filtered queries (zero rows) so the endpoint consistently returns HTTP 404 instead of updating unrelated rows.
- Fixed: The backend contract now guarantees a no-op response for a user moving another user's link while still returning the expected `moved` count and `group` payload on successful moves.
- Affected files: `backend/tests/test_items_move.py`
- Impact/Risk: Low; reinforces backend authorization before the frontend handles move actions, and no UI changes were required.
### 2026-03-17 17:00 - Add move interactions for selected links
- Added: Internal move clipboard shortcuts (`Ctrl/Cmd+C`, `Ctrl/Cmd+X`, `Ctrl/Cmd+V`), row-context `Move to group` submenu, sidebar row-to-group drag/drop, and `Selected` KPI chips in the hero/footer.
- Changed: Save-style actions in admin/settings inputs can now submit with `Enter`; frontend bundle version bumped to `v=20260317-71`.
- Fixed: Multi-link moves no longer depend on manual per-row edits because users can paste into a group, paste before a selected row, or drag the current selection onto another group.
- Affected files: `frontend/app.js`, `frontend/index.html`, `frontend/tests/ui_contract.test.mjs`, `docs/DECISIONS.md`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Medium; keyboard shortcuts now intercept `Ctrl/Cmd+C/X/V` in `linkchecker` when focus is outside text inputs, so future clipboard-related features in that view should reuse the same gating rules.
### 2026-03-17 17:10 - Widen footer Selected spacing
- Added: Minimum width and tabular number alignment for the footer `Selected` stat.
- Changed: Frontend asset bundle version bumped to `v=20260317-73`.
- Fixed: Larger selected counts no longer crowd the divider and `API Status` area in the footer.
- Affected files: `frontend/index.html`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Low; purely presentational footer spacing update.
### 2026-03-17 17:25 - Add group-colored search highlights in All Links
- Added: Deterministic group accent colors for matched sidebar cards and list rows during `All Links` searches.
- Changed: Search now forces a sidebar rerender so group cards react immediately to the current query; frontend assets bumped to `v=20260317-74`.
- Fixed: Search results in `All Links` no longer lose group context because rows and their owning group cards now glow with the same accent color.
- Affected files: `frontend/app.js`, `frontend/style.css`, `frontend/index.html`, `frontend/tests/ui_contract.test.mjs`, `docs/DECISIONS.md`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Low to medium; adds more visual emphasis only during `All Links` search mode and leaves normal group browsing unchanged.
### 2026-03-17 17:32 - Smooth search highlight cards
- Added: More even full-card glow treatment for search-matched group cards and list rows.
- Changed: Frontend asset bundle version bumped to `v=20260317-75`.
- Fixed: Search highlights no longer look like a separate vertical line; the tint now follows the card shape more cleanly.
- Affected files: `frontend/style.css`, `frontend/index.html`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Low; presentational refinement only.
### 2026-03-17 17:38 - Restore rounded left accent without search borders
- Added: Rounded inset accent lines on the left edge of search-highlighted group cards and list rows.
- Changed: Frontend asset bundle version bumped to `v=20260317-76`.
- Fixed: Search highlight cards now keep the accent stripe while dropping the surrounding border/outline emphasis.
- Affected files: `frontend/style.css`, `frontend/index.html`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Low; presentational refinement only.
### 2026-03-17 17:43 - Remove outer glow from search highlights
- Added: Tighter inset positioning for the rounded left accent line on search-highlighted cards.
- Changed: Frontend asset bundle version bumped to `v=20260317-77`.
- Fixed: Search-highlighted group cards and rows no longer bleed glow outside their card bounds.
- Affected files: `frontend/style.css`, `frontend/index.html`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Low; presentational refinement only.
### 2026-03-17 17:54 - Refine search accent line and STT divider
- Added: A dedicated header divider between `STT` and `Asset Details` so the first column boundary now matches the rest of the table header.
- Changed: Search-highlight accent lines on sidebar group cards and list rows now use an inset pill shape with a softer inner edge; frontend assets bumped to `v=20260317-79`.
- Fixed: The previous full-height straight stripe looked too rigid inside rounded cards and the header lacked the vertical separator after `STT`.
- Affected files: `frontend/style.css`, `frontend/index.html`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Low; presentational refinement only.
### 2026-03-17 18:21 - Stabilize large batch adds and add Checked sorting
- Added: `POST /api/jobs/batch` for batch crawl-status polling, `CRAWL_TASK_MAX_CONCURRENCY` for bounded worker fan-out, and a `Checked` header menu with `Error First`, `Crawling First`, `Active First`, `Newest Check`, and `Oldest Check`.
- Changed: Frontend pending-job polling now requests statuses in bulk instead of one HTTP call per job; frontend bundle version bumped to `v=20260317-80`.
- Fixed: Large add batches no longer overwhelm the DB pool through combined crawl-task fan-out and per-job polling, and error rows can now be surfaced quickly for cleanup.
- Affected files: `backend/app/api/jobs.py`, `backend/app/config.py`, `backend/app/schemas/job.py`, `backend/app/services/crawler.py`, `backend/tests/test_jobs_batch.py`, `frontend/app.js`, `frontend/index.html`, `frontend/tests/ui_contract.test.mjs`, `docs/DECISIONS.md`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Medium; job status polling contract changed from single-job bursts to an additional batch endpoint, and crawl throughput is now intentionally capped to protect DB stability during large imports.
### 2026-03-17 18:31 - Reposition Checked sort control
- Added: Inline positioning rules so the `Checked` sort control now sits directly after the `Checked` label and its dropdown anchors from that inline trigger.
- Changed: Frontend bundle version bumped to `v=20260317-81`.
- Fixed: The `Checked` sort UI no longer feels detached at the edge of the column and now reads as part of the header text.
- Affected files: `frontend/style.css`, `frontend/index.html`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Low; presentational layout adjustment only.
### 2026-03-17 18:33 - Keep Checked sort dropdown inside viewport
- Added: Dynamic dropdown alignment for the `Checked` sort menu so it flips inward when opened near the right edge of the table header.
- Changed: Tightened the inline spacing between the `Checked` label and sort trigger; frontend bundle version bumped to `v=20260317-82`.
- Fixed: The `Checked` dropdown no longer overflows outside the visible table area, and the trigger now sits immediately after the header text instead of leaving a wide gap.
- Affected files: `frontend/style.css`, `frontend/app.js`, `frontend/index.html`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Low; UI positioning change only.
### 2026-03-18 10:58 - Remove group accent collisions in All Links search
- Added: Hash-derived HSL accent generation for group search highlights, plus regression checks that assert the new group-accent helpers are present.
- Changed: Frontend bundle version bumped to `v=20260318-83`.
- Fixed: Different group names such as `Follow > 5` and `312` no longer collapse into the same search highlight color in `All Links`.
- Affected files: `frontend/app.js`, `frontend/index.html`, `frontend/tests/ui_contract.test.mjs`, `docs/DECISIONS.md`, `docs/WORKLOG.md`, `docs/CHANGELOG.md`
- Impact/Risk: Low; visual differentiation only, no API contract changes.
