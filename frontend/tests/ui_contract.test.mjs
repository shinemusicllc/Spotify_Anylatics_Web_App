import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = "D:/Spotify_AnylaticsWeb_App/frontend";
const appJs = fs.readFileSync(path.join(root, "app.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const styleCss = fs.readFileSync(path.join(root, "style.css"), "utf8");

test("display title helper supports multi-artist track and album labels", () => {
  assert.match(appJs, /function buildDisplayTitleWithArtists/);
  assert.match(appJs, /item\.type === 'track' \|\| item\.type === 'album'/);
  assert.match(appJs, /function buildExportTrackTitle/);
  assert.match(appJs, /splitArtistLabel\(artistLabel\)/);
  assert.match(appJs, /cleanExportText\(getDisplayTitle\(item\)\)/);
});

test("add-link flow handles per-user duplicate skips from backend", () => {
  assert.match(appJs, /result\?\.\s*skipped_duplicate/);
  assert.match(appJs, /accepted_indices/);
  assert.match(appJs, /skipped_duplicates/);
  assert.match(appJs, /already exists for this user/);
});

test("admin default scope uses own links instead of all users", () => {
  assert.match(appJs, /function getAdminTargetUserId/);
  assert.match(appJs, /params\.user_id = getAdminTargetUserId\(\)/);
  assert.doesNotMatch(appJs, /label: 'My Links'/);
  assert.doesNotMatch(appJs, /label: 'All Users'/);
  assert.match(appJs, /state\.adminFilterUserId = currentUserId \|\| null/);
  assert.match(appJs, /state\.adminFilterUserId = val \|\| \(currentUser\?\.id \? String\(currentUser\.id\) : null\)/);
});

test("add-link modal no longer renders the duplicate checkbox", () => {
  assert.doesNotMatch(indexHtml, /modal-dedupe-links/);
  assert.doesNotMatch(indexHtml, /Skip duplicate links/);
});

test("rendered rows expose STT column target", () => {
  assert.match(appJs, /data-col-key="stt"/);
  assert.match(indexHtml, /Resize STT column/);
  assert.match(appJs, /items\.forEach\(\(item, index\) => frag\.appendChild\(renderRow\(item, index\)\)\)/);
});

test("loadData does not pin the dashboard to a frontend item cap", () => {
  assert.doesNotMatch(appJs, /params\.limit = 500/);
});

test("admin edit payload includes username", () => {
  assert.match(appJs, /username: username/);
  assert.doesNotMatch(indexHtml, /id="admin-edit-username"[^>]*disabled/);
});

test("admin group labels only show the base group name", () => {
  assert.match(appJs, /return baseName;/);
  assert.doesNotMatch(appJs, /return `\$\{ownerLabel\} - \$\{baseName\}`;/);
});

test("move submenu and selected KPI are rendered", () => {
  assert.match(indexHtml, /data-context-group="move"/);
  assert.match(indexHtml, /data-context-action="copy-selected-links"/);
  assert.match(indexHtml, /id="kpi-selected"/);
  assert.match(indexHtml, /id="footer-selected"/);
});

test("keyboard shortcuts support move clipboard interactions", () => {
  assert.match(appJs, /function stageSelectedItemsForClipboard/);
  assert.match(appJs, /function pasteClipboardItems/);
  assert.match(appJs, /function copySelectedLinksToClipboard/);
  assert.match(appJs, /hotkey === 'c'/);
  assert.match(appJs, /hotkey === 'x'/);
  assert.match(appJs, /hotkey === 'v'/);
  assert.match(appJs, /handleEnterShortcutSubmit/);
});

test("frontend uses backend move endpoint for group moves", () => {
  assert.match(appJs, /moveItems\(itemIds = \[\], group = null, userId = null\)/);
  assert.match(appJs, /this\._fetch\('\/items\/move'/);
  assert.match(appJs, /await api\.moveItems\(stableItemIds, nextGroupName\)/);
});

test("all-links search highlights rows and group cards by group accent", () => {
  assert.match(appJs, /function isSearchGroupAccentMode/);
  assert.match(appJs, /function getSearchMatchGroupCounts/);
  assert.match(appJs, /function getGroupAccentHash/);
  assert.match(appJs, /function hslToRgbString/);
  assert.match(appJs, /const hue = hash % 360/);
  assert.doesNotMatch(appJs, /GROUP_ACCENT_PALETTE/);
  assert.match(appJs, /group-item-search-match/);
  assert.match(appJs, /row-group-search-match/);
  assert.match(appJs, /renderGroups\(\{ force: true \}\)/);
  assert.match(styleCss, /\.group-item-search-match/);
  assert.match(styleCss, /\.row-group-search-match/);
});

test("checked column exposes filter controls for error cleanup", () => {
  assert.match(appJs, /const CHECKED_SORT_MODES = Object\.freeze/);
  assert.match(appJs, /function ensureCheckedSortControls/);
  assert.match(appJs, /data-checked-sort-option="\$\{CHECKED_SORT_MODES\.ERROR_FIRST\}"/);
  assert.match(appJs, /state\.checkedSortMode = mode/);
});

test("pending job polling uses batch status endpoint", () => {
  assert.match(appJs, /getJobsBatch\(jobIds = \[\]\)/);
  assert.match(appJs, /this\._fetch\('\/jobs\/batch'/);
  assert.match(appJs, /const jobsById = await fetchPendingJobs\(pendingJobIds\)/);
});
