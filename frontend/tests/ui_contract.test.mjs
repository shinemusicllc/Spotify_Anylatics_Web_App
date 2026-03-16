import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = "D:/Spotify_AnylaticsWeb_App/frontend";
const appJs = fs.readFileSync(path.join(root, "app.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");

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
  assert.match(appJs, /label: 'My Links'/);
  assert.doesNotMatch(appJs, /label: 'All Users'/);
});

test("add-link modal no longer renders the duplicate checkbox", () => {
  assert.doesNotMatch(indexHtml, /modal-dedupe-links/);
  assert.doesNotMatch(indexHtml, /Skip duplicate links/);
});
