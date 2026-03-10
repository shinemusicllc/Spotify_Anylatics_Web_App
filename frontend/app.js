/**
 * SpotiCheck — Frontend Application
 * Kết nối API backend, render dynamic rows, quản lý state
 */

// ═══════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════
const CONFIG = {
    API_BASE: window.location.hostname === 'localhost'
        ? 'http://localhost:8010/api'
        : '/api',
    POLL_INTERVAL: 1200,      // Faster polling for near-real-time row updates
    POPUP_WIDTH: 480,
    POPUP_HEIGHT: 720,
    SEARCH_DEBOUNCE: 300,
    DRAG_SCROLL_EDGE: 72,
    DRAG_SCROLL_MAX_SPEED: 22,
    BACKGROUND_SYNC_INTERVAL: 12000,
};
const GROUP_STORAGE_KEY = 'spoticheck_custom_groups_v1';
const ROW_ORDER_STORAGE_KEY = 'spoticheck_row_order_v1';
const COLUMN_WIDTH_STORAGE_KEY = 'spoticheck_column_widths_v4';
const ALL_GROUP_ID = 'all';
const ALL_GROUP_LABEL = 'All Links';
const GROUP_SELECT_ALL = '__all__';
const DEFAULT_COLUMN_WIDTHS = Object.freeze({
    asset: 420,
    owner: 160,
    playlistSaves: 92,
    playlistCount: 92,
    albumCount: 88,
    artistFollowers: 92,
    artistListeners: 104,
    trackViews: 100,
    checked: 84,
});
const MIN_COLUMN_WIDTHS = Object.freeze({
    asset: 320,
    owner: 132,
    playlistSaves: 84,
    playlistCount: 84,
    albumCount: 80,
    artistFollowers: 84,
    artistListeners: 88,
    trackViews: 88,
    checked: 72,
});
const MAX_COLUMN_WIDTHS = Object.freeze({
    asset: 900,
    owner: 360,
    playlistSaves: 240,
    playlistCount: 240,
    albumCount: 240,
    artistFollowers: 240,
    artistListeners: 260,
    trackViews: 260,
    checked: 140,
});
const COLUMN_WIDTH_VAR_MAP = Object.freeze({
    asset: '--asset-col',
    owner: '--owner-col',
    playlistSaves: '--playlist-save-col',
    playlistCount: '--playlist-count-col',
    albumCount: '--album-count-col',
    artistFollowers: '--artist-followers-col',
    artistListeners: '--artist-listeners-col',
    trackViews: '--track-views-col',
    checked: '--checked-col',
});
const RESIZABLE_COLUMN_KEYS = Object.freeze([
    'asset',
    'owner',
    'playlistSaves',
    'playlistCount',
    'albumCount',
    'artistFollowers',
    'artistListeners',
    'trackViews',
    'checked',
]);
const UI_PREF_SAVE_DEBOUNCE_MS = 700;

function getUserGroupStorageKey() {
    const user = getAuthUser();
    const userId = user?.id || 'anonymous';
    return `spoticheck_custom_groups_v1_${userId}`;
}

function getUserRowOrderStorageKey() {
    const user = getAuthUser();
    const userId = user?.id || 'anonymous';
    return `${ROW_ORDER_STORAGE_KEY}_${userId}`;
}

function getUserColumnWidthStorageKey() {
    const user = getAuthUser();
    const userId = user?.id || 'anonymous';
    return `${COLUMN_WIDTH_STORAGE_KEY}_${userId}`;
}

// ===================================================================
// AUTH
// ===================================================================
function getAuthToken() {
    return localStorage.getItem('spoticheck_token');
}
function getAuthUser() {
    try { return JSON.parse(localStorage.getItem('spoticheck_user')); } catch(e) { return null; }
}
function logout() {
    localStorage.removeItem('spoticheck_token');
    localStorage.removeItem('spoticheck_user');
    window.location.href = '/login.html';
}
function requireAuth() {
    if (!getAuthToken()) {
        window.location.href = '/login.html';
        return false;
    }
    return true;
}
function setupAuthUI() {
    const user = getAuthUser();
    if (user) {
        const initials = (user.display_name || user.username || '??').slice(0, 2).toUpperCase();
        const profileWrap = document.querySelector('.sidebar-profile-wrap');
        if (profileWrap) {
            profileWrap.style.cursor = 'pointer';
            profileWrap.onclick = () => document.getElementById('nav-settings')?.click();
            const avatarHtml = user.avatar
                ? '<img src="' + user.avatar + '" class="w-8 h-8 rounded-full object-cover flex-shrink-0 ring-1 ring-white/10">'
                : '<div class="w-8 h-8 rounded-full flex-shrink-0 bg-gradient-to-br from-emerald-400 via-cyan-500 to-blue-700 text-white text-[11px] font-bold leading-none grid place-items-center overflow-hidden ring-1 ring-white/10">' + initials + '</div>';
            profileWrap.innerHTML = avatarHtml +
                '<div class="sidebar-user-info overflow-hidden">' +
                '<p class="text-sm font-semibold truncate">' + (user.display_name || user.username) + '</p>' +
                '<p class="text-xs text-secondary-text truncate">' + (user.role === 'admin' ? 'Admin' : 'User') + '</p>' +
                '</div>';
        }
    }
    const sidebarProfile = document.querySelector('.sidebar-profile');
    if (sidebarProfile && !document.getElementById('btn-logout')) {
        const logoutBtn = document.createElement('button');
        logoutBtn.id = 'btn-logout';
        logoutBtn.className = 'sidebar-tooltip-target w-full flex items-center gap-3 px-5 py-2 text-secondary-text hover:text-white transition-colors cursor-pointer';
        logoutBtn.dataset.tooltip = 'Sign Out';
        logoutBtn.innerHTML = '<span class="material-icons-round text-sm">logout</span><span class="sidebar-label text-sm">Sign Out</span>';
        logoutBtn.onclick = logout;
        sidebarProfile.appendChild(logoutBtn);
    }
    if (user && user.role === 'admin') {
        const groupPanel = document.getElementById('group-panel');
        if (groupPanel && !document.getElementById('admin-badge')) {
            const badge = document.createElement('div');
            badge.id = 'admin-badge';
            badge.className = 'px-5 py-2 border-b border-white/5';
            badge.innerHTML = '<span class="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-primary"><span class="material-icons-round text-sm">admin_panel_settings</span>Admin Mode</span>';
            groupPanel.insertBefore(badge, groupPanel.firstChild);
        }
        setupAdminUserFilter();
        // Add Users nav item for admin
        const nav = document.querySelector('#sidebar nav');
        if (nav && !document.getElementById('nav-users')) {
            const usersLink = document.createElement('a');
            usersLink.id = 'nav-users';
            usersLink.className = 'sidebar-tooltip-target flex items-center gap-4 px-3 py-3 rounded-lg text-secondary-text hover:text-white transition-colors group cursor-pointer';
            usersLink.dataset.tooltip = 'Users';
            usersLink.href = '#';
            usersLink.innerHTML = '<span class="material-icons-round">group</span><span class="font-medium sidebar-label">Users</span>';
            // Insert before Settings
            const settingsNav = document.getElementById('nav-settings');
            if (settingsNav) nav.insertBefore(usersLink, settingsNav);
        }
        prefetchAdminUsers();
    }
}


// ═══════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════
const state = {
    items: [],
    filteredItems: [],
    groups: [{ id: ALL_GROUP_ID, name: ALL_GROUP_LABEL, count: 0 }],
    customGroups: [],
    groupSearchQuery: '',
    activeGroup: ALL_GROUP_ID,
    isCreatingGroup: false,
    renamingGroupId: null,
    searchQuery: '',
    pendingJobs: new Set(),
    pendingJobToItem: new Map(),
    batchRefresh: null,
    pollTimer: null,
    apiOnline: false,
    adminFilterUserId: null,
    adminUserList: [],
    adminUsersCacheTs: 0,
    adminUsersPromise: null,
    selectedItemKeys: new Set(),
    selectionAnchorKey: null,
    draggingRowKeys: [],
    dragOverRowKey: null,
    dragOverRowPlacement: 'before',
    draggingGroupId: null,
    dragOverGroupId: null,
    dragOverGroupPlacement: 'before',
    suppressNextGroupClick: false,
    suppressNextRowClick: false,
    dragScrollRaf: null,
    dragScrollContainer: null,
    dragScrollSpeed: 0,
    columnBudget: null,
    columnWidths: { ...DEFAULT_COLUMN_WIDTHS },
    uiPrefSaveTimer: null,
    remoteSyncTimer: null,
    remoteSyncInFlight: false,
};

// ═══════════════════════════════════════════════════════════════════
// API CLIENT
// ═══════════════════════════════════════════════════════════════════
class SpotiCheckAPI {
    constructor(baseUrl) {
        this.base = baseUrl;
    }

    async _fetch(path, opts = {}) {
        try {
            const token = getAuthToken();
            const headers = { 'Content-Type': 'application/json', ...opts.headers };
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
            const res = await fetch(`${this.base}${path}`, {
                headers,
                ...opts,
            });
            if (res.status === 401) {
                logout();
                return;
            }
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || `HTTP ${res.status}`);
            }
            return res.json();
        } catch (e) {
            if (e.message?.includes('Failed to fetch') || e.message?.includes('NetworkError')) {
                state.apiOnline = false;
                updateApiStatus();
            }
            throw e;
        }
    }
    health()              { return this._fetch('/health'); }
    getItems(params = {}) {
        const qs = new URLSearchParams();
        if (params.type) qs.set('type', params.type);
        if (params.user_id) qs.set('user_id', params.user_id);
        const suffix = qs.toString() ? `?${qs.toString()}` : '';
        return this._fetch(`/items${suffix}`);
    }
    getItem(type, id)     { return this._fetch(`/items/${type}/${id}`); }
    getJob(jobId)         { return this._fetch(`/jobs/${jobId}`); }
    deleteItem(type, id)  { return this._fetch(`/items/${type}/${id}`, { method: 'DELETE' }); }
    clearItems()          { return this._fetch('/items', { method: 'DELETE' }); }
    getMyPreferences()    { return this._fetch('/auth/me/preferences'); }
    saveMyPreferences(preferences = {}) {
        return this._fetch('/auth/me/preferences', {
            method: 'PUT',
            body: JSON.stringify({ preferences }),
        });
    }
    renameGroup(oldGroup, newGroup, userId = null) {
        const qs = new URLSearchParams();
        qs.set('old_group', String(oldGroup || ''));
        qs.set('new_group', String(newGroup || ''));
        if (userId) qs.set('user_id', String(userId));
        return this._fetch(`/items/group?${qs.toString()}`, { method: 'PATCH' });
    }

    crawl(url, group = null, targetUserId = null) {
        return this._fetch('/crawl', {
            method: 'POST',
            body: JSON.stringify({ url, group, target_user_id: targetUserId || null }),
        });
    }

    crawlBatch(urls, group = null, targetUserId = null) {
        return this._fetch('/crawl/batch', {
            method: 'POST',
            body: JSON.stringify({ urls, group, target_user_id: targetUserId || null }),
        });
    }
}

const api = new SpotiCheckAPI(CONFIG.API_BASE);

// ═══════════════════════════════════════════════════════════════════
// UTILITY HELPERS
// ═══════════════════════════════════════════════════════════════════

/** Format large numbers with suffix (1.2k, 3.4M) */
function formatNumber(n) {
    if (n == null || isNaN(n)) return '-';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
    return n.toLocaleString();
}

/** Format full number with separators: 1000000 -> 1.000.000 */
function formatDetailedNumber(n) {
    if (n == null || isNaN(n)) return '-';
    return Number(n).toLocaleString('vi-VN');
}

function formatDetailedMetric(n) {
    if (n == null || isNaN(n)) return '-';
    return Number(n).toLocaleString('vi-VN');
}

function formatDurationFromMs(ms) {
    if (ms == null || isNaN(ms)) return null;
    const totalSeconds = Math.floor(Number(ms) / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
}

function parseServerDate(value) {
    if (!value) return null;
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }

    const raw = String(value).trim();
    if (!raw) return null;

    let normalized = raw.replace(' ', 'T');
    const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/.test(normalized);
    if (!hasTimezone && /^\d{4}-\d{2}-\d{2}T/.test(normalized)) {
        // Backend can return naive UTC timestamps; treat them as UTC.
        normalized += 'Z';
    }

    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Relative time from ISO timestamp */
function timeAgo(isoDate) {
    const d = parseServerDate(isoDate);
    if (!d) return '-';
    const diff = Date.now() - d.getTime();
    if (diff <= 0) return 'Just now';
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
}

function formatUpdatedAt(isoDate) {
    const d = parseServerDate(isoDate);
    if (!d) return '-';
    const parts = new Intl.DateTimeFormat('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    }).formatToParts(d);
    const get = (type) => parts.find((p) => p.type === type)?.value || '';
    return `${get('hour')}:${get('minute')} ${get('day')}/${get('month')}/${get('year')}`;
}

function formatCellValue(value) {
    if (value == null || value === '' || Number.isNaN(Number(value))) return '-';
    return formatDetailedMetric(value);
}

function formatDeltaDays(days) {
    if (days == null || Number.isNaN(Number(days))) return '--';
    return String(Math.max(0, Number(days))).padStart(2, '0');
}

function renderDeltaBadge(delta, days) {
    if (delta == null || Number.isNaN(Number(delta))) return '';

    const numeric = Number(delta);
    let icon = 'remove';
    let cls = 'metric-delta-flat';
    let text = '0';

    if (numeric > 0) {
        icon = 'north';
        cls = 'metric-delta-up';
        text = `+${formatDetailedMetric(numeric)}`;
    } else if (numeric < 0) {
        icon = 'south';
        cls = 'metric-delta-down';
        text = `-${formatDetailedMetric(Math.abs(numeric))}`;
    }

    return `
        <div class="metric-delta ${cls}">
            <span class="material-icons-round">${icon}</span>
            <span>${text}/${formatDeltaDays(days)}</span>
        </div>
    `;
}

function renderMetricCell(value, delta, days) {
    const hasValue = !(value == null || value === '' || Number.isNaN(Number(value)));
    return `
        <div class="metric-stack">
            <span class="metric-main ${hasValue ? '' : 'metric-empty'}">${hasValue ? formatCellValue(value) : '-'}</span>
            ${renderDeltaBadge(delta, days)}
        </div>
    `;
}

function getExcelColumnValues(item) {
    const type = item.type;
    return {
        playlistSaves: type === 'playlist' ? (item.saves ?? item.followers) : null,
        playlistSavesDelta: type === 'playlist' ? item.followers_delta : null,
        playlistTrackCount: type === 'playlist' ? item.track_count : null,
        playlistTrackCountDelta: type === 'playlist' ? item.track_count_delta : null,
        albumTrackCount: type === 'album' ? item.track_count : null,
        albumTrackCountDelta: type === 'album' ? item.track_count_delta : null,
        artistFollowers: type === 'artist' || type === 'track' || type === 'album' ? item.followers : null,
        artistFollowersDelta: type === 'artist' || type === 'track' || type === 'album' ? item.followers_delta : null,
        artistListeners: type === 'artist' || type === 'track' || type === 'album' ? item.monthly_listeners : null,
        artistListenersDelta: type === 'artist' || type === 'track' || type === 'album' ? item.monthly_listeners_delta : null,
        trackViews: type === 'track' ? item.playcount : null,
        trackViewsDelta: type === 'track' ? item.playcount_delta : null,
        deltaDays: item.delta_days,
    };
}

function getItemSubtitle(item) {
    if (item.type === 'album' && Array.isArray(item.export_tracks) && item.export_tracks.length > 0) {
        return `${item.export_tracks.length} tracks ready for export`;
    }
    if (item.type === 'track' && Array.isArray(item.artist_names) && item.artist_names.length > 1) {
        return `Primary artist metrics from ${item.artist_names[0]}`;
    }
    return null;
}

/** Parse Spotify URL to get type and id */
function parseSpotifyUrl(input) {
    input = input.trim();
    // Handle Spotify URI format: spotify:playlist:37i9dQZF1DX...
    const uriMatch = input.match(/^spotify:(playlist|track|album|artist):([a-zA-Z0-9]+)/);
    if (uriMatch) return { type: uriMatch[1], id: uriMatch[2] };
    // Handle URL format: https://open.spotify.com/playlist/37i9dQZF1DX...
    const urlMatch = input.match(/open\.spotify\.com\/(playlist|track|album|artist)\/([a-zA-Z0-9]+)/);
    if (urlMatch) return { type: urlMatch[1], id: urlMatch[2] };
    return null;
}

/** Get the open.spotify.com URL from type + id */
function getSpotifyUrl(type, id) {
    return `https://open.spotify.com/${type}/${id}`;
}

/** Debounce function */
function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function itemKey(item) {
    return `${item?.type || ''}:${item?.spotify_id || ''}`;
}

function getCurrentUserIdentity() {
    const user = getAuthUser();
    return {
        id: user?.id ? String(user.id) : null,
        name: user ? (user.display_name || user.username || 'User') : 'User',
        avatar: user?.avatar || null,
    };
}

function getUserIdentityById(userId) {
    const currentIdentity = getCurrentUserIdentity();
    const targetId = userId ? String(userId) : '';
    if (!targetId || String(currentIdentity.id || '') === targetId) {
        return currentIdentity;
    }

    const match = (state.adminUserList || []).find((user) => (
        String(user.id || user._id || '') === targetId
    ));

    if (!match) {
        return {
            ...currentIdentity,
            id: targetId,
        };
    }

    return {
        id: targetId,
        name: match.display_name || match.username || targetId,
        avatar: match.avatar || null,
    };
}

function findOwnedItemIndex(type, spotifyId, ownerUserId = null) {
    const ownerId = ownerUserId ? String(ownerUserId) : null;
    return state.items.findIndex((item) => {
        if (item.type !== type || item.spotify_id !== spotifyId) return false;
        if (!ownerId) return true;
        const itemOwnerId = item.user_id ? String(item.user_id) : '';
        return !itemOwnerId || itemOwnerId === ownerId;
    });
}

function loadPersistedRowOrder() {
    try {
        const raw = localStorage.getItem(getUserRowOrderStorageKey());
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
    } catch {
        return [];
    }
}

function savePersistedRowOrder(keys, opts = {}) {
    try {
        localStorage.setItem(getUserRowOrderStorageKey(), JSON.stringify(Array.isArray(keys) ? keys : []));
        if (!opts?.skipServerSync) {
            queueUiPreferencesSave();
        }
    } catch {
        // Ignore storage failures.
    }
}

function clampColumnWidth(key, value) {
    const fallback = DEFAULT_COLUMN_WIDTHS[key] ?? 120;
    const min = MIN_COLUMN_WIDTHS[key] ?? 72;
    const max = MAX_COLUMN_WIDTHS[key] ?? 900;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, Math.round(numeric)));
}

function loadPersistedColumnWidths() {
    try {
        const raw = localStorage.getItem(getUserColumnWidthStorageKey());
        const parsed = raw ? JSON.parse(raw) : {};
        const widths = { ...DEFAULT_COLUMN_WIDTHS };
        Object.keys(DEFAULT_COLUMN_WIDTHS).forEach((key) => {
            widths[key] = clampColumnWidth(key, parsed?.[key]);
        });
        return rebalanceColumnWidths(widths);
    } catch {
        return rebalanceColumnWidths({ ...DEFAULT_COLUMN_WIDTHS });
    }
}

function savePersistedColumnWidths(widths, opts = {}) {
    try {
        localStorage.setItem(getUserColumnWidthStorageKey(), JSON.stringify(widths));
        if (!opts?.skipServerSync) {
            queueUiPreferencesSave();
        }
    } catch {
        // Ignore storage failures.
    }
}

function normalizeUiPreferences(raw) {
    const prefs = raw && typeof raw === 'object' ? raw : {};
    const rowOrder = Array.isArray(prefs.row_order)
        ? prefs.row_order.map((v) => String(v || '').trim()).filter(Boolean)
        : [];
    const columnWidths = {};
    const rawWidths = prefs.column_widths && typeof prefs.column_widths === 'object'
        ? prefs.column_widths
        : {};
    Object.keys(DEFAULT_COLUMN_WIDTHS).forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(rawWidths, key)) {
            columnWidths[key] = clampColumnWidth(key, rawWidths[key]);
        }
    });
    return { row_order: rowOrder, column_widths: columnWidths };
}

async function hydrateUiPreferencesFromServer() {
    try {
        if (!getAuthToken()) return;
        const data = await api.getMyPreferences();
        const normalized = normalizeUiPreferences(data?.preferences || {});
        if (Array.isArray(normalized.row_order)) {
            savePersistedRowOrder(normalized.row_order, { skipServerSync: true });
        }
        if (normalized.column_widths && Object.keys(normalized.column_widths).length) {
            const next = { ...DEFAULT_COLUMN_WIDTHS };
            Object.keys(DEFAULT_COLUMN_WIDTHS).forEach((key) => {
                if (Object.prototype.hasOwnProperty.call(normalized.column_widths, key)) {
                    next[key] = clampColumnWidth(key, normalized.column_widths[key]);
                }
            });
            savePersistedColumnWidths(next, { skipServerSync: true });
        }
    } catch (err) {
        console.warn('[UI Prefs] Load failed:', err.message);
    }
}

function queueUiPreferencesSave() {
    if (state.uiPrefSaveTimer) {
        clearTimeout(state.uiPrefSaveTimer);
    }
    state.uiPrefSaveTimer = setTimeout(() => {
        state.uiPrefSaveTimer = null;
        saveUiPreferencesToServer();
    }, UI_PREF_SAVE_DEBOUNCE_MS);
}

async function saveUiPreferencesToServer() {
    try {
        if (!getAuthToken()) return;
        const rowOrder = loadPersistedRowOrder();
        const columnWidths = {};
        Object.keys(DEFAULT_COLUMN_WIDTHS).forEach((key) => {
            columnWidths[key] = clampColumnWidth(key, state.columnWidths[key]);
        });
        await api.saveMyPreferences({
            row_order: rowOrder,
            column_widths: columnWidths,
        });
    } catch (err) {
        console.warn('[UI Prefs] Save failed:', err.message);
    }
}

function applyColumnWidths(widths = state.columnWidths) {
    const root = document.documentElement;
    if (!root) return;
    Object.entries(COLUMN_WIDTH_VAR_MAP).forEach(([key, cssVar]) => {
        const width = clampColumnWidth(key, widths?.[key]);
        root.style.setProperty(cssVar, `${width}px`);
    });
}

function getDefaultResizableColumnBudget() {
    return RESIZABLE_COLUMN_KEYS.reduce((sum, key) => sum + DEFAULT_COLUMN_WIDTHS[key], 0);
}

function getMinResizableColumnBudget() {
    return RESIZABLE_COLUMN_KEYS.reduce((sum, key) => sum + (MIN_COLUMN_WIDTHS[key] ?? 72), 0);
}

function getMaxResizableColumnBudget() {
    return RESIZABLE_COLUMN_KEYS.reduce((sum, key) => sum + (MAX_COLUMN_WIDTHS[key] ?? 900), 0);
}

function measureAvailableColumnBudget() {
    const row = document.querySelector('.list-columns-head.custom-grid-row');
    if (!row) return null;
    const styles = window.getComputedStyle(row);
    const paddingLeft = parseFloat(styles.paddingLeft || '0');
    const paddingRight = parseFloat(styles.paddingRight || '0');
    const rootStyles = window.getComputedStyle(document.documentElement);
    const outerGap = parseFloat(styles.columnGap || styles.gap || '16') || 16;
    const metaGap = parseFloat(rootStyles.getPropertyValue('--meta-gap') || '12') || 12;
    const metaColumnCount = RESIZABLE_COLUMN_KEYS.length - 1;
    const internalMetaGaps = Math.max(0, metaColumnCount - 1) * metaGap;
    const available = row.getBoundingClientRect().width
        - paddingLeft
        - paddingRight
        - outerGap
        - internalMetaGaps;
    if (!Number.isFinite(available) || available <= 0) return null;
    return Math.round(available);
}

function distributeColumnDelta(widths, keys, delta) {
    let remaining = Math.round(delta);
    let safety = 0;
    while (Math.abs(remaining) > 0 && safety < 24) {
        const direction = Math.sign(remaining);
        const candidates = keys.filter((key) => {
            const current = widths[key];
            return direction > 0
                ? current < (MAX_COLUMN_WIDTHS[key] ?? current)
                : current > (MIN_COLUMN_WIDTHS[key] ?? current);
        });
        if (!candidates.length) break;

        const totalWeight = candidates.reduce((sum, key) => sum + Math.max(widths[key], 1), 0) || candidates.length;
        let applied = 0;

        candidates.forEach((key, index) => {
            const min = MIN_COLUMN_WIDTHS[key] ?? 72;
            const max = MAX_COLUMN_WIDTHS[key] ?? 900;
            const current = widths[key];
            const share = index === candidates.length - 1
                ? remaining - applied
                : Math.round((remaining * Math.max(current, 1)) / totalWeight);
            const next = Math.min(max, Math.max(min, current + share));
            const actual = next - current;
            widths[key] = next;
            applied += actual;
        });

        if (applied === 0) break;
        remaining -= applied;
        safety += 1;
    }

    return remaining;
}

function rebalanceColumnWidths(sourceWidths, preferredKey = null, targetBudget = null) {
    const widths = { ...sourceWidths };
    RESIZABLE_COLUMN_KEYS.forEach((key) => {
        widths[key] = clampColumnWidth(key, widths[key]);
    });

    const measuredBudget = targetBudget ?? state.columnBudget ?? measureAvailableColumnBudget() ?? getDefaultResizableColumnBudget();
    const budget = Math.min(
        getMaxResizableColumnBudget(),
        Math.max(getMinResizableColumnBudget(), measuredBudget),
    );
    const current = RESIZABLE_COLUMN_KEYS.reduce((sum, key) => sum + widths[key], 0);
    let remaining = budget - current;

    const firstPassKeys = preferredKey
        ? RESIZABLE_COLUMN_KEYS.filter((key) => key !== preferredKey)
        : [...RESIZABLE_COLUMN_KEYS];
    remaining = distributeColumnDelta(widths, firstPassKeys, remaining);

    if (Math.abs(remaining) > 0 && preferredKey && RESIZABLE_COLUMN_KEYS.includes(preferredKey)) {
        remaining = distributeColumnDelta(widths, [preferredKey], remaining);
    }

    if (Math.abs(remaining) > 0) {
        distributeColumnDelta(widths, [...RESIZABLE_COLUMN_KEYS], remaining);
    }

    return widths;
}

function getDirectionalCompensationKeys(key, resizeEdge = 'end') {
    const index = RESIZABLE_COLUMN_KEYS.indexOf(key);
    if (index === -1) return [];
    if (resizeEdge === 'start') {
        return RESIZABLE_COLUMN_KEYS.slice(0, index).reverse();
    }
    return RESIZABLE_COLUMN_KEYS.slice(index + 1);
}

function setColumnWidth(key, width, persist = false, resizeEdge = 'end') {
    if (!(key in DEFAULT_COLUMN_WIDTHS)) return;
    const currentWidth = clampColumnWidth(key, state.columnWidths[key]);
    const nextWidth = clampColumnWidth(key, width);
    if (currentWidth === nextWidth) return;

    const delta = nextWidth - currentWidth;
    const nextWidths = {
        ...state.columnWidths,
        [key]: nextWidth,
    };
    const compensationKeys = getDirectionalCompensationKeys(key, resizeEdge);
    const remaining = distributeColumnDelta(nextWidths, compensationKeys, -delta);
    if (remaining !== 0) {
        nextWidths[key] = clampColumnWidth(key, nextWidths[key] + remaining);
    }

    state.columnWidths = nextWidths;
    applyColumnWidths(state.columnWidths);
    if (persist) {
        savePersistedColumnWidths(state.columnWidths);
    }
}

function syncColumnWidthsToViewport(persist = false) {
    const measuredBudget = measureAvailableColumnBudget();
    if (!measuredBudget) return;
    state.columnBudget = Math.min(
        getMaxResizableColumnBudget(),
        Math.max(getMinResizableColumnBudget(), measuredBudget),
    );
    state.columnWidths = rebalanceColumnWidths(state.columnWidths, null, state.columnBudget);
    applyColumnWidths(state.columnWidths);
    if (persist) {
        savePersistedColumnWidths(state.columnWidths);
    }
}

function getTitleToneClass(type) {
    const map = {
        track: 'title-tone-track',
        album: 'title-tone-album',
        artist: 'title-tone-artist',
    };
    return map[type] || '';
}

function getItemUserName(item) {
    if (item.user_name) return item.user_name;
    const currentUser = getAuthUser();
    if (currentUser && String(currentUser.id || '') === String(item.user_id || '')) {
        return currentUser.display_name || currentUser.username || 'ADMIN';
    }
    const match = (state.adminUserList || []).find((user) => String(user.id || user._id || '') === String(item.user_id || ''));
    if (match) return match.display_name || match.username || 'User';
    return 'User';
}

function getItemUserAvatar(item) {
    if (item.user_avatar) return item.user_avatar;
    const currentUser = getAuthUser();
    if (currentUser && String(currentUser.id || '') === String(item.user_id || '')) {
        return currentUser.avatar || null;
    }
    const match = (state.adminUserList || []).find((user) => String(user.id || user._id || '') === String(item.user_id || ''));
    return match?.avatar || null;
}

function getDisplayTitle(item) {
    const baseTitle = item.name || 'Unknown';
    if (item.type !== 'playlist') return baseTitle;

    const artistOrOwner = (item.owner_name || (Array.isArray(item.artist_names) ? item.artist_names[0] : '') || '').trim();
    if (!artistOrOwner) return baseTitle;
    if (baseTitle.toLowerCase().startsWith(`${artistOrOwner.toLowerCase()} -`)) return baseTitle;
    return `${artistOrOwner} - ${baseTitle}`;
}

function renderOwnerUpdatedCell(item, ownerUrl, updatedAt) {
    const safeUpdatedAt = escapeHtml(updatedAt || '-');
    const userName = escapeHtml(getItemUserName(item));
    const userAvatarUrl = getItemUserAvatar(item);
    const avatarLabel = escapeHtml((getItemUserName(item) || 'US').slice(0, 2).toUpperCase());
    const ownerAvatar = userAvatarUrl
        ? `<img alt="User" class="list-owner-avatar" src="${userAvatarUrl}">`
        : `<div class="list-owner-avatar list-owner-fallback">${avatarLabel}</div>`;

    return `
        <div class="flex items-center gap-3 meta-cell">
            ${ownerAvatar}
            <div class="list-owner-meta">
                <div class="list-owner-name">${userName}</div>
                <div class="list-owner-time text-secondary-text">${safeUpdatedAt}</div>
            </div>
        </div>
    `;
}

function applyPersistedItemOrder(items) {
    const list = Array.isArray(items) ? items.slice() : [];
    const order = loadPersistedRowOrder();
    if (!order.length) return list;

    const indexByKey = new Map(order.map((key, idx) => [key, idx]));
    return list.sort((a, b) => {
        const aIdx = indexByKey.has(itemKey(a)) ? indexByKey.get(itemKey(a)) : Number.MAX_SAFE_INTEGER;
        const bIdx = indexByKey.has(itemKey(b)) ? indexByKey.get(itemKey(b)) : Number.MAX_SAFE_INTEGER;
        if (aIdx !== bIdx) return aIdx - bIdx;
        return 0;
    });
}

function persistCurrentItemOrder() {
    savePersistedRowOrder(state.items.map((item) => itemKey(item)));
}

function syncSelectedItemsWithState() {
    const existing = new Set(state.items.map((item) => itemKey(item)));
    state.selectedItemKeys = new Set(
        Array.from(state.selectedItemKeys).filter((key) => existing.has(key))
    );
    if (state.selectionAnchorKey && !existing.has(state.selectionAnchorKey)) {
        state.selectionAnchorKey = null;
    }
}

function mergeItemsKeepOrder(existingItems, incomingItems) {
    const existing = Array.isArray(existingItems) ? existingItems : [];
    const incoming = Array.isArray(incomingItems) ? incomingItems : [];

    const incomingByKey = new Map();
    incoming.forEach((it) => incomingByKey.set(itemKey(it), it));

    const merged = [];
    for (const oldItem of existing) {
        const k = itemKey(oldItem);
        if (!incomingByKey.has(k)) continue;
        merged.push({ ...oldItem, ...incomingByKey.get(k) });
        incomingByKey.delete(k);
    }

    for (const it of incoming) {
        const k = itemKey(it);
        if (!incomingByKey.has(k)) continue;
        merged.push(it);
        incomingByKey.delete(k);
    }

    return merged;
}

function normalizeGroupName(name) {
    return String(name || '').trim();
}

function splitLegacyGroupName(name) {
    const raw = normalizeGroupName(name);
    if (!raw) return { name: '', ownerUserId: null };
    const compositeIndex = raw.indexOf('::');
    if (compositeIndex <= 0) {
        return { name: raw, ownerUserId: null };
    }
    const ownerUserId = normalizeGroupName(raw.slice(0, compositeIndex));
    const groupName = normalizeGroupName(raw.slice(compositeIndex + 2));
    if (!ownerUserId || !groupName || !isUuidLike(ownerUserId)) {
        return { name: raw, ownerUserId: null };
    }
    return { name: groupName, ownerUserId };
}

function normalizeStoredGroupName(name) {
    return splitLegacyGroupName(name).name;
}

function escapeAttrSelectorValue(value) {
    const input = String(value || '');
    if (window.CSS && typeof window.CSS.escape === 'function') {
        return window.CSS.escape(input);
    }
    return input.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function loadCustomGroups() {
    // Load from localStorage as fallback (will be overwritten by server sync)
    try {
        const raw = localStorage.getItem(getUserGroupStorageKey());
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return [];
        return parsed
            .map(normalizeStoredGroupName)
            .filter(Boolean);
    } catch {
        return [];
    }
}

function getGroupsFromUserRecord(userRecord) {
    if (!userRecord) return [];
    const raw = userRecord.custom_groups;
    if (Array.isArray(raw)) {
        return raw.map(normalizeStoredGroupName).filter(Boolean);
    }
    if (typeof raw === 'string' && raw.trim()) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                return parsed.map(normalizeStoredGroupName).filter(Boolean);
            }
        } catch {
            return [];
        }
    }
    return [];
}

function getOwnerCustomGroups(ownerUserId) {
    const ownerId = ownerUserId ? String(ownerUserId) : '';
    if (isAdminAllUsersMode() && ownerId) {
        const user = (state.adminUserList || []).find((u) => String(u.id || u._id || '') === ownerId);
        return getGroupsFromUserRecord(user);
    }
    return (state.customGroups || []).map(normalizeStoredGroupName).filter(Boolean);
}

function setOwnerCustomGroups(ownerUserId, groups) {
    const ownerId = ownerUserId ? String(ownerUserId) : '';
    const cleaned = Array.from(new Set((groups || []).map(normalizeStoredGroupName).filter(Boolean)));
    if (isAdminAllUsersMode() && ownerId) {
        (state.adminUserList || []).forEach((u) => {
            if (String(u.id || u._id || '') === ownerId) {
                u.custom_groups = cleaned.slice();
            }
        });
        _adminUsersCache = (_adminUsersCache || []).map((u) => {
            if (String(u.id || u._id || '') !== ownerId) return u;
            return { ...u, custom_groups: cleaned.slice() };
        });
        const currentUser = getAuthUser();
        if (currentUser && String(currentUser.id || '') === ownerId) {
            state.customGroups = cleaned.slice();
            localStorage.setItem(getUserGroupStorageKey(), JSON.stringify(cleaned));
        }
        return cleaned;
    }
    state.customGroups = cleaned.slice();
    return cleaned;
}

async function syncGroupsFromServer(targetUserId) {
    try {
        var token = getAuthToken();
        if (!token) return;
        var url = CONFIG.API_BASE;
        if (targetUserId) {
            url += '/auth/users/' + targetUserId + '/groups';
        } else {
            url += '/auth/me/groups';
        }
        var res = await fetch(url, {
            headers: { 'Authorization': 'Bearer ' + token },
        });
        if (!res.ok) {
            console.warn('[Groups Sync] Server returned', res.status);
            return;
        }
        var data = await res.json();
        var serverGroups = (data.groups || []).map(normalizeStoredGroupName).filter(Boolean);

        if (targetUserId) {
            // Admin viewing another user's groups
            state.customGroups = serverGroups;
        } else {
            // Own groups — server is source of truth
            // But if server is empty and local has groups, push local to server (first sync)
            var localGroups = (state.customGroups || []).map(normalizeStoredGroupName).filter(Boolean);
            if (serverGroups.length === 0 && localGroups.length > 0) {
                // First time sync: upload local groups to server
                state.customGroups = localGroups;
                await saveGroupsToServer(localGroups);
            } else {
                // Server has data — use server as source of truth
                state.customGroups = serverGroups;
            }
            localStorage.setItem(getUserGroupStorageKey(), JSON.stringify(state.customGroups));
        }
        syncGroupUI(true);
        console.log('[Groups Sync] Synced', state.customGroups.length, 'groups for', targetUserId || 'self');
    } catch (err) {
        console.warn('[Groups Sync] Error:', err.message);
    }
}

async function saveGroupsToServer(groups, targetUserId) {
    try {
        var token = getAuthToken();
        if (!token) return;
        var url = CONFIG.API_BASE;
        // If admin is filtering a specific user, save to that user
        var uid = targetUserId || state.adminFilterUserId;
        var currentUser = getAuthUser();
        if (uid && currentUser && currentUser.role === 'admin' && uid !== currentUser.id) {
            url += '/auth/users/' + uid + '/groups';
        } else {
            url += '/auth/me/groups';
        }
        await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ groups: groups || state.customGroups }),
        });
    } catch (err) {
        // Silently fail
    }
}

function saveCustomGroups() {
    const cleaned = Array.from(new Set(
        (state.customGroups || [])
            .map(normalizeStoredGroupName)
            .filter(Boolean)
    ));
    state.customGroups = cleaned;
    var currentUser = getAuthUser();
    if (currentUser?.role === 'admin' && isAdminAllUsersMode() && currentUser.id) {
        setOwnerCustomGroups(currentUser.id, cleaned);
    }
    // If admin is filtering another user, don't save to own localStorage
    var filteringOther = state.adminFilterUserId && currentUser && currentUser.role === 'admin' && state.adminFilterUserId !== currentUser.id;
    if (!filteringOther) {
        localStorage.setItem(getUserGroupStorageKey(), JSON.stringify(cleaned));
    }
    // Sync to server in background (will auto-target filtered user if admin)
    saveGroupsToServer(cleaned);
}

function getActiveGroupName() {
    if (state.activeGroup === ALL_GROUP_ID) return ALL_GROUP_LABEL;
    const match = state.groups.find((g) => g.id === state.activeGroup);
    return match?.displayName || match?.name || state.activeGroup;
}

function isAdminAllUsersMode() {
    const currentUser = getAuthUser();
    return Boolean(currentUser?.role === 'admin' && !state.adminFilterUserId);
}

function buildGroupEntryId(groupName, ownerUserId = null) {
    const normalizedName = normalizeStoredGroupName(groupName);
    const normalizedOwner = ownerUserId ? String(ownerUserId) : '';
    if (!isAdminAllUsersMode() || !normalizedOwner) {
        return normalizedName;
    }
    return `${normalizedOwner}::${normalizedName}`;
}

function getGroupEntryById(groupId) {
    return state.groups.find((g) => String(g.id) === String(groupId)) || null;
}

function parseGroupEntryId(groupId) {
    const raw = normalizeGroupName(groupId);
    if (!raw || raw.toLowerCase() === ALL_GROUP_ID) {
        return { id: ALL_GROUP_ID, name: ALL_GROUP_LABEL, ownerUserId: null };
    }
    const compositeIndex = raw.indexOf('::');
    if (compositeIndex === -1) {
        return { id: raw, name: normalizeStoredGroupName(raw), ownerUserId: null };
    }
    const ownerUserId = normalizeGroupName(raw.slice(0, compositeIndex));
    const parsedName = normalizeStoredGroupName(raw.slice(compositeIndex + 2));
    if (!ownerUserId || !parsedName || !isUuidLike(ownerUserId)) {
        return { id: raw, name: normalizeStoredGroupName(raw), ownerUserId: null };
    }
    return {
        id: raw,
        ownerUserId: ownerUserId,
        name: parsedName,
    };
}

function doesItemMatchGroupEntry(item, groupEntry) {
    if (!groupEntry || groupEntry.id === ALL_GROUP_ID) return true;
    const itemParsed = splitLegacyGroupName(item.group);
    if (normalizeStoredGroupName(itemParsed.name) !== normalizeStoredGroupName(groupEntry.name)) return false;
    if (!groupEntry.ownerUserId) return true;
    return String(item.user_id || itemParsed.ownerUserId || '') === String(groupEntry.ownerUserId);
}

function updateGroupHeader() {
    const name = getActiveGroupName();
    const breadcrumb = document.getElementById('breadcrumb-group');
    const pageTitle = document.getElementById('page-title');
    if (breadcrumb) breadcrumb.textContent = name;
    if (pageTitle) pageTitle.textContent = name;
}

function clearRowSelection() {
    state.selectedItemKeys = new Set();
    state.selectionAnchorKey = null;
}

function getVisibleItems() {
    let items = state.items;

    if (state.activeGroup !== ALL_GROUP_ID) {
        const activeEntry = getGroupEntryById(state.activeGroup);
        items = items.filter((i) => doesItemMatchGroupEntry(i, activeEntry));
    }

    if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase();
        items = items.filter((i) =>
            (i.name || '').toLowerCase().includes(q) ||
            (i.owner_name || '').toLowerCase().includes(q) ||
            (i.spotify_id || '').toLowerCase().includes(q) ||
            (i.type || '').toLowerCase().includes(q)
        );
    }

    return items;
}

function isInteractiveRowTarget(target) {
    return Boolean(target?.closest('a, button, input, textarea, select, label, [role="button"], .row-action-cell, .row-action-buttons'));
}

function handleRowSelection(item, event) {
    if (!item) return;
    const key = itemKey(item);
    const visibleKeys = state.filteredItems.map((it) => itemKey(it));

    if (event.shiftKey && state.selectionAnchorKey && visibleKeys.includes(state.selectionAnchorKey)) {
        const start = visibleKeys.indexOf(state.selectionAnchorKey);
        const end = visibleKeys.indexOf(key);
        if (start !== -1 && end !== -1) {
            const [from, to] = start < end ? [start, end] : [end, start];
            state.selectedItemKeys = new Set(visibleKeys.slice(from, to + 1));
            renderList({ preserveScroll: true });
            return;
        }
    }

    if (event.ctrlKey || event.metaKey) {
        const next = new Set(state.selectedItemKeys);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        state.selectedItemKeys = next;
        state.selectionAnchorKey = key;
        renderList({ preserveScroll: true });
        return;
    }

    state.selectedItemKeys = new Set([key]);
    state.selectionAnchorKey = key;
    renderList({ preserveScroll: true });
}

function moveItemsByKeys(draggedKeys, targetKey, placement = 'before') {
    const draggedSet = new Set((draggedKeys || []).filter(Boolean));
    if (!draggedSet.size || !targetKey || draggedSet.has(targetKey)) return false;

    const draggedItems = state.items.filter((item) => draggedSet.has(itemKey(item)));
    if (!draggedItems.length) return false;

    const remaining = state.items.filter((item) => !draggedSet.has(itemKey(item)));
    const targetIndex = remaining.findIndex((item) => itemKey(item) === targetKey);
    if (targetIndex === -1) return false;

    const insertIndex = placement === 'after' ? targetIndex + 1 : targetIndex;
    remaining.splice(insertIndex, 0, ...draggedItems);
    state.items = remaining;
    persistCurrentItemOrder();
    return true;
}

function moveCustomGroupBefore(draggedGroupId, targetGroupId, placement = 'before') {
    const dragged = normalizeGroupName(draggedGroupId);
    const target = normalizeGroupName(targetGroupId);
    if (!dragged || !target || dragged === target) return false;
    if (dragged.toLowerCase() === ALL_GROUP_ID || target.toLowerCase() === ALL_GROUP_ID) return false;

    const draggedEntry = getGroupEntryById(dragged) || parseGroupEntryId(dragged);
    const targetEntry = getGroupEntryById(target) || parseGroupEntryId(target);
    const draggedGroupName = normalizeStoredGroupName(draggedEntry?.name || dragged);
    const targetGroupName = normalizeStoredGroupName(targetEntry?.name || target);
    if (!draggedGroupName || !targetGroupName || draggedGroupName.toLowerCase() === targetGroupName.toLowerCase()) return false;

    const current = Array.from(new Set((state.customGroups || []).map(normalizeStoredGroupName).filter(Boolean)));
    const next = current.slice();

    if (!next.some((name) => name.toLowerCase() === draggedGroupName.toLowerCase())) {
        next.push(draggedGroupName);
    }
    if (!next.some((name) => name.toLowerCase() === targetGroupName.toLowerCase())) {
        next.push(targetGroupName);
    }

    const draggedIndex = next.findIndex((name) => name.toLowerCase() === draggedGroupName.toLowerCase());
    const [movedName] = next.splice(draggedIndex, 1);
    const targetIndex = next.findIndex((name) => name.toLowerCase() === targetGroupName.toLowerCase());
    if (targetIndex === -1) return false;
    const insertIndex = placement === 'after' ? targetIndex + 1 : targetIndex;
    next.splice(insertIndex, 0, movedName);

    state.customGroups = next;
    saveCustomGroups();
    return true;
}

function syncRowDragUi(container) {
    const host = container || document.getElementById('link-list');
    if (!host) return;
    host.querySelectorAll('.custom-grid-row').forEach((row) => {
        const key = row.dataset.itemKey;
        const isDragging = state.draggingRowKeys.includes(key);
        row.classList.toggle('row-dragging', isDragging);
        const isDropTarget = Boolean(state.dragOverRowKey && state.dragOverRowKey === key && !state.draggingRowKeys.includes(key));
        row.classList.toggle('row-drop-target', isDropTarget);
        row.classList.toggle('row-drop-before', isDropTarget && state.dragOverRowPlacement !== 'after');
        row.classList.toggle('row-drop-after', isDropTarget && state.dragOverRowPlacement === 'after');
    });
}

function syncGroupDragUi(container) {
    const host = container || document.getElementById('group-list');
    if (!host) return;
    host.querySelectorAll('.group-item[data-group]').forEach((groupBtn) => {
        const groupId = normalizeGroupName(groupBtn.getAttribute('data-group'));
        const isDropTarget = Boolean(groupId && state.dragOverGroupId === groupId && state.draggingGroupId !== groupId);
        groupBtn.classList.toggle('group-item-dragging', Boolean(groupId && state.draggingGroupId === groupId));
        groupBtn.classList.toggle('group-item-drop-target', isDropTarget);
        groupBtn.classList.toggle('group-drop-before', isDropTarget && state.dragOverGroupPlacement !== 'after');
        groupBtn.classList.toggle('group-drop-after', isDropTarget && state.dragOverGroupPlacement === 'after');
    });
}

function stopDragAutoScroll() {
    if (state.dragScrollRaf) {
        cancelAnimationFrame(state.dragScrollRaf);
        state.dragScrollRaf = null;
    }
    state.dragScrollContainer = null;
    state.dragScrollSpeed = 0;
}

function ensureDragAutoScroll() {
    if (state.dragScrollRaf) return;
    const tick = () => {
        const container = state.dragScrollContainer;
        const speed = state.dragScrollSpeed;
        if (!container || !speed) {
            state.dragScrollRaf = null;
            return;
        }
        container.scrollTop += speed;
        state.dragScrollRaf = requestAnimationFrame(tick);
    };
    state.dragScrollRaf = requestAnimationFrame(tick);
}

function updateDragAutoScroll(container, clientY) {
    if (!container) {
        stopDragAutoScroll();
        return;
    }

    const rect = container.getBoundingClientRect();
    const edge = CONFIG.DRAG_SCROLL_EDGE;
    let speed = 0;

    if (clientY < rect.top + edge) {
        const ratio = Math.max(0, (rect.top + edge - clientY) / edge);
        speed = -Math.ceil(CONFIG.DRAG_SCROLL_MAX_SPEED * ratio);
    } else if (clientY > rect.bottom - edge) {
        const ratio = Math.max(0, (clientY - (rect.bottom - edge)) / edge);
        speed = Math.ceil(CONFIG.DRAG_SCROLL_MAX_SPEED * ratio);
    }

    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    if (speed < 0 && container.scrollTop <= 0) speed = 0;
    if (speed > 0 && container.scrollTop >= maxScrollTop) speed = 0;

    if (!speed) {
        if (state.dragScrollContainer === container) {
            stopDragAutoScroll();
        }
        return;
    }

    state.dragScrollContainer = container;
    state.dragScrollSpeed = speed;
    ensureDragAutoScroll();
}

function getAdminUserLabelById(userId) {
    if (!userId) return '';
    const currentUser = getAuthUser();
    if (currentUser && String(currentUser.id || '') === String(userId)) {
        return currentUser.display_name || currentUser.username || 'Admin';
    }
    const match = (state.adminUserList || []).find((user) => String(user.id || user._id || '') === String(userId));
    return (match && (match.display_name || match.username)) || '';
}

function isUuidLike(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

function getCurrentUserLabel() {
    const currentUser = getAuthUser();
    return currentUser?.display_name || currentUser?.username || 'Admin';
}

function getScopedGroupOwnerUserId() {
    const currentUser = getAuthUser();
    if (!currentUser?.id) return null;
    if (currentUser.role === 'admin' && state.adminFilterUserId) {
        return String(state.adminFilterUserId);
    }
    return String(currentUser.id);
}

function getAdminGroupBaseName(groupName, ownerLabel = '') {
    const raw = normalizeStoredGroupName(groupName);
    if (!raw) return 'Group';
    if (isUuidLike(raw)) return 'Group';
    const prefixed = ownerLabel ? `${ownerLabel} - ` : '';
    if (prefixed && raw.toLowerCase().startsWith(prefixed.toLowerCase())) {
        return raw.slice(prefixed.length).trim() || 'Group';
    }
    return raw;
}

function getAdminGroupDisplayName(groupName, ownerUserId = null) {
    const currentUser = getAuthUser();
    if (currentUser?.role !== 'admin' || !groupName || groupName === ALL_GROUP_LABEL) {
        return groupName;
    }

    let ownerLabel = '';
    if (state.adminFilterUserId) {
        ownerLabel = getAdminUserLabelById(state.adminFilterUserId) || getCurrentUserLabel();
    } else if (ownerUserId) {
        ownerLabel = getAdminUserLabelById(ownerUserId) || getCurrentUserLabel();
    } else if ((state.customGroups || []).some((name) => normalizeStoredGroupName(name) === normalizeStoredGroupName(groupName))) {
        ownerLabel = getCurrentUserLabel();
    } else {
        ownerLabel = getCurrentUserLabel();
    }

    const baseName = getAdminGroupBaseName(groupName, ownerLabel);
    return `${ownerLabel} - ${baseName}`;
}

function canManageGroupEntry(groupEntry) {
    if (!groupEntry || groupEntry.id === ALL_GROUP_ID) return false;
    const currentUser = getAuthUser();
    if (currentUser?.role === 'admin') return true;
    return true;
}

function rebuildGroups() {
    const previousGroups = Array.isArray(state.groups) ? state.groups.slice() : [];
    const previousActiveId = state.activeGroup;
    const previousActiveEntry =
        previousGroups.find((g) => String(g.id) === String(previousActiveId))
        || parseGroupEntryId(previousActiveId);
    const counts = new Map();
    const encountered = [];
    for (const item of state.items) {
        const parsedItemGroup = splitLegacyGroupName(item.group);
        const group = normalizeStoredGroupName(parsedItemGroup.name);
        if (!group) continue;
        if (group.toLowerCase() === ALL_GROUP_ID) continue;
        const ownerUserId = item.user_id ? String(item.user_id) : (parsedItemGroup.ownerUserId || null);
        const entryId = buildGroupEntryId(group, ownerUserId);
        if (!counts.has(entryId)) {
            encountered.push({
                id: entryId,
                name: group,
                ownerUserId: ownerUserId,
            });
        }
        counts.set(entryId, (counts.get(entryId) || 0) + 1);
    }

    const groups = [{ id: ALL_GROUP_ID, name: ALL_GROUP_LABEL, count: state.items.length }];
    const namedGroups = [];
    const seen = new Set();
    const pushUnique = (rawEntry) => {
        const isEntryObject = rawEntry && typeof rawEntry === 'object';
        const parsed = splitLegacyGroupName(isEntryObject ? rawEntry.name : rawEntry);
        const name = normalizeStoredGroupName(parsed.name);
        if (!name || name.toLowerCase() === ALL_GROUP_ID) return;
        const ownerUserId = isEntryObject && rawEntry.ownerUserId
            ? String(rawEntry.ownerUserId)
            : (parsed.ownerUserId || null);
        const id = isEntryObject
            ? normalizeGroupName(rawEntry.id || buildGroupEntryId(name, ownerUserId))
            : normalizeGroupName(name);
        const key = id.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        namedGroups.push({ id, name, ownerUserId });
    };

    // Follow user-defined order first.
    if (isAdminAllUsersMode()) {
        (state.adminUserList || []).forEach((user) => {
            const ownerUserId = String(user.id || user._id || '');
            if (!ownerUserId) return;
            getGroupsFromUserRecord(user).forEach((rawName) => {
                const normalized = normalizeStoredGroupName(rawName);
                pushUnique({
                    id: buildGroupEntryId(normalized, ownerUserId),
                    name: normalized,
                    ownerUserId: ownerUserId,
                });
            });
        });
    } else {
        const scopedOwnerUserId = getScopedGroupOwnerUserId();
        (state.customGroups || []).forEach((rawName) => {
            const normalized = normalizeStoredGroupName(rawName);
            pushUnique({
                id: buildGroupEntryId(normalized, scopedOwnerUserId),
                name: normalized,
                ownerUserId: scopedOwnerUserId,
            });
        });
    }

    // Then append any groups discovered from data but not explicitly ordered yet.
    encountered.forEach(pushUnique);

    for (const entry of namedGroups) {
        groups.push({
            id: entry.id,
            name: entry.name,
            ownerUserId: entry.ownerUserId,
            displayName: getAdminGroupDisplayName(entry.name, entry.ownerUserId),
            count: counts.get(entry.id) || 0,
        });
    }

    state.groups = groups;
    if (state.activeGroup === ALL_GROUP_ID) {
        return;
    }

    if (state.groups.some((g) => String(g.id) === String(state.activeGroup))) {
        return;
    }

    const previousName = normalizeGroupName(previousActiveEntry?.name);
    const previousOwner = previousActiveEntry?.ownerUserId ? String(previousActiveEntry.ownerUserId) : null;
    let remapped = null;

    if (previousName) {
        remapped = state.groups.find((g) => {
            if (g.id === ALL_GROUP_ID) return false;
            if (normalizeGroupName(g.name).toLowerCase() !== previousName.toLowerCase()) return false;
            if (state.adminFilterUserId) return true;
            if (previousOwner && g.ownerUserId) {
                return String(g.ownerUserId) === previousOwner;
            }
            return !previousOwner || !g.ownerUserId;
        }) || null;
    }

    state.activeGroup = remapped ? remapped.id : ALL_GROUP_ID;
}

function renderGroups() {
    const container = document.getElementById('group-list');
    if (!container) return;

    const q = state.groupSearchQuery.trim().toLowerCase();
    const groups = state.groups.filter((g) => {
        if (g.id === ALL_GROUP_ID) return true;
        if (!q) return true;
        return (g.displayName || g.name).toLowerCase().includes(q);
    });

    const groupButtons = groups.map((g) => {
        const isActive = g.id === state.activeGroup;
        const canDelete = canManageGroupEntry(g);
        const isDragging = state.draggingGroupId === g.id;
        const isDropTarget = state.dragOverGroupId === g.id && !isDragging;
        const isRenaming = Boolean(
            state.renamingGroupId
            && state.renamingGroupId.toLowerCase() === g.id.toLowerCase()
        );
        return `
            <button
                class="group-item ${canDelete ? 'group-item-has-delete' : ''} ${isDragging ? 'group-item-dragging' : ''} ${isDropTarget ? 'group-item-drop-target' : ''} w-full flex items-center justify-between px-3 py-3 rounded-lg transition-colors ${isActive ? 'bg-primary/10 text-white' : 'text-secondary-text hover:text-white hover:bg-white/5'}"
                data-group="${escapeHtml(g.id)}"
                draggable="${canDelete ? 'true' : 'false'}"
            >
                <div class="flex items-center gap-3 min-w-0">
                    <span class="material-icons-round ${isActive ? 'text-primary' : 'text-secondary-text'} text-sm">folder</span>
                    ${isRenaming
                        ? `<input
                            data-role="rename-group-input"
                            data-group-id="${escapeHtml(g.id)}"
                            value="${escapeHtml(g.name)}"
                            class="w-full bg-white/5 border border-primary/50 rounded-lg px-2 py-1 text-[14px] font-semibold text-white focus:outline-none focus:border-primary"
                        >`
                        : `<span class="text-[14px] font-semibold truncate" data-role="group-name" data-group-id="${escapeHtml(g.id)}">${escapeHtml(g.displayName || g.name)}</span>`
                    }
                </div>
                <div class="group-item-actions flex items-center gap-2">
                    ${isRenaming
                        ? `
                            <span
                                class="material-icons-round text-secondary-text hover:text-white text-[18px] cursor-pointer"
                                title="Save group name"
                                data-action="save-rename-group"
                                data-group-id="${escapeHtml(g.id)}"
                                tabindex="0"
                            >check</span>
                            <span
                                class="material-icons-round text-secondary-text hover:text-white text-[18px] cursor-pointer"
                                title="Cancel rename"
                                data-action="cancel-rename-group"
                                data-group-id="${escapeHtml(g.id)}"
                                tabindex="0"
                            >close</span>
                        `
                        : `
                            <span ${g.id === ALL_GROUP_ID ? 'id="group-count-all"' : ''} class="group-count text-xs font-bold ${isActive ? 'bg-primary/20 text-primary' : 'bg-white/10 text-secondary-text'} px-2 py-0.5 rounded-full">${g.count}</span>
                            ${canDelete ? `
                            <span
                                class="group-delete-btn material-icons-round"
                                title="Delete group"
                                data-action="delete-group"
                                data-group-id="${escapeHtml(g.id)}"
                            >delete</span>` : ''}
                        `
                    }
                </div>
            </button>
        `;
    }).join('');

    const createBox = state.isCreatingGroup
        ? `
        <div class="mt-3 p-3 rounded-lg border border-white/10 bg-white/5">
            <input data-role="new-group-input" type="text" placeholder="Group name..." class="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-secondary-text focus:outline-none focus:border-primary/60">
            <div class="mt-2 flex gap-2">
                <button data-action="create-group" class="flex-1 px-3 py-2 rounded-lg bg-white hover:bg-white/90 text-black text-sm font-semibold">Create</button>
                <button data-action="cancel-create-group" class="flex-1 px-3 py-2 rounded-lg border border-white/20 text-secondary-text hover:text-white text-sm">Cancel</button>
            </div>
        </div>
        `
        : '';

    container.innerHTML = `
        ${groupButtons}
        <button class="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-secondary-text hover:text-primary transition-colors mt-4 cursor-pointer" data-action="new-group">
            <span class="material-icons-round text-sm">add</span>
            <span class="font-medium">New Group</span>
        </button>
        ${createBox}
    `;
}

function populateGroupSelect() {
    var wrap = document.getElementById('modal-group-select-wrap');
    if (!wrap) return;

    var options = [{value: GROUP_SELECT_ALL, label: ALL_GROUP_LABEL + ' (Default)'}];
    for (var i = 0; i < state.groups.length; i++) {
        var g = state.groups[i];
        if (g.id === ALL_GROUP_ID) continue;
        options.push({value: g.id, label: g.displayName || g.name});
    }

    var selectedValue = GROUP_SELECT_ALL;
    if (state.activeGroup && state.activeGroup !== ALL_GROUP_ID) {
        var hasActive = options.some(function(opt) {
            return String(opt.value) === String(state.activeGroup);
        });
        if (hasActive) selectedValue = state.activeGroup;
    }

    // Check if dropdown already exists
    var existing = document.getElementById('modal-group-select-dropdown');
    if (existing) {
        updateCustomDropdownOptions('modal-group-select-dropdown', options, selectedValue);
    } else {
        var dd = createCustomDropdown({
            id: 'modal-group-select',
            options: options,
            selected: selectedValue,
            cssClass: 'dropdown-modal'
        });
        wrap.innerHTML = '';
        wrap.appendChild(dd);
    }
}

function resolveSelectedGroupContext() {
    var dd = document.getElementById('modal-group-select-dropdown');
    var picked = normalizeGroupName(dd ? dd.getAttribute('data-value') : null);
    var currentUser = getAuthUser();
    var adminTargetUserId = null;
    if (currentUser?.role === 'admin' && state.adminFilterUserId) {
        adminTargetUserId = String(state.adminFilterUserId);
    }
    if (!picked || picked.toLowerCase() === GROUP_SELECT_ALL.toLowerCase()) {
        return {
            group: null,
            targetUserId: adminTargetUserId,
        };
    }

    // In admin all-users mode, dropdown values may be composite ids (userId::groupName).
    // Always resolve to the raw group name before sending to backend.
    var resolvedGroup = null;
    var resolvedTargetUserId = adminTargetUserId;
    var entry = getGroupEntryById(picked);
    if (entry && entry.id !== ALL_GROUP_ID) {
        var nameFromEntry = normalizeStoredGroupName(entry.name);
        if (nameFromEntry) resolvedGroup = nameFromEntry;
        if (currentUser?.role === 'admin' && entry.ownerUserId) {
            resolvedTargetUserId = String(entry.ownerUserId);
        }
    }

    if (!resolvedGroup) {
        var parsed = parseGroupEntryId(picked);
        var parsedName = normalizeStoredGroupName(parsed ? parsed.name : '');
        if (parsedName && parsedName.toLowerCase() !== ALL_GROUP_ID) {
            resolvedGroup = parsedName;
            if (currentUser?.role === 'admin' && parsed?.ownerUserId) {
                resolvedTargetUserId = String(parsed.ownerUserId);
            }
        }
    }

    // Fallback for non-composite ids
    if (!resolvedGroup && picked.toLowerCase() !== ALL_GROUP_ID) {
        resolvedGroup = picked;
    }

    return {
        group: resolvedGroup || null,
        targetUserId: currentUser?.role === 'admin' ? (resolvedTargetUserId || null) : null,
    };
}

function resolveSelectedGroup() {
    return resolveSelectedGroupContext().group;
}

function handleCreateGroup(rawName) {
    const name = normalizeGroupName(rawName);
    if (!name) return;
    if (name.toLowerCase() === ALL_GROUP_ID) {
        showToast('"All Links" is reserved', 'error');
        return;
    }

    const scopedOwnerUserId = getScopedGroupOwnerUserId();
    const existing = state.groups.find((g) => (
        normalizeGroupName(g.name).toLowerCase() === name.toLowerCase()
        && String(g.ownerUserId || scopedOwnerUserId || '') === String(scopedOwnerUserId || '')
    ));
    if (existing) {
        state.activeGroup = existing.id;
        state.isCreatingGroup = false;
        state.renamingGroupId = null;
        updateGroupHeader();
        renderGroups();
        renderList();
        populateGroupSelect();
        showToast(`Switched to group: ${existing.name}`, 'info');
        return;
    }

    state.customGroups.push(name);
    saveCustomGroups();
    state.activeGroup = buildGroupEntryId(name, scopedOwnerUserId);
    state.isCreatingGroup = false;
    state.renamingGroupId = null;
    rebuildGroups();
    updateGroupHeader();
    renderGroups();
    renderList();
    populateGroupSelect();
    showToast(`Created group: ${name}`, 'success');
}

function handleDeleteGroup(rawGroupId) {
    const groupId = normalizeGroupName(rawGroupId);
    if (!groupId || groupId.toLowerCase() === ALL_GROUP_ID) return;

    const target = state.groups.find((g) => g.id.toLowerCase() === groupId.toLowerCase());
    if (!canManageGroupEntry(target)) {
        showToast('Select that user in Filter by User to manage this group', 'info');
        return;
    }
    const groupName = target?.name || groupId;
    const confirmed = window.confirm(`Delete group "${groupName}"?\nAll links in this group will move to All Links.`);
    if (!confirmed) return;

    const ownerUserId = target?.ownerUserId ? String(target.ownerUserId) : getScopedGroupOwnerUserId();
    const groupKey = normalizeStoredGroupName(target?.name || groupId).toLowerCase();
    const nextGroups = getOwnerCustomGroups(ownerUserId).filter((name) => {
        const normalized = normalizeStoredGroupName(name);
        return normalized && normalized.toLowerCase() !== groupKey;
    });
    if (isAdminAllUsersMode() && ownerUserId) {
        setOwnerCustomGroups(ownerUserId, nextGroups);
        saveGroupsToServer(nextGroups, ownerUserId);
    } else {
        state.customGroups = nextGroups;
        saveCustomGroups();
    }

    state.items = state.items.map((item) => {
        const itemGroup = normalizeStoredGroupName(item.group);
        if (!itemGroup || itemGroup.toLowerCase() !== groupKey) return item;
        if (target?.ownerUserId && String(item.user_id || '') !== String(target.ownerUserId)) return item;
        return { ...item, group: null };
    });
    syncGroupItemsToServer(target?.name || groupName, '', ownerUserId || null);

    if ((state.activeGroup || '').toLowerCase() === groupId.toLowerCase()) {
        state.activeGroup = ALL_GROUP_ID;
    }
    state.isCreatingGroup = false;
    if ((state.renamingGroupId || '').toLowerCase() === groupId.toLowerCase()) {
        state.renamingGroupId = null;
    }
    syncGroupUI(true);
    renderList();
    showToast(`Deleted group: ${groupName}`, 'success');
}

function startCreateGroupFlow() {
    state.isCreatingGroup = true;
    state.renamingGroupId = null;
    renderGroups();
    setTimeout(() => {
        const input = document.querySelector('#group-list [data-role="new-group-input"]');
        if (input) input.focus();
    }, 0);
}

function cancelCreateGroupFlow() {
    state.isCreatingGroup = false;
    renderGroups();
}

function startRenameGroupFlow(rawGroupId) {
    const groupId = normalizeGroupName(rawGroupId);
    if (!groupId || groupId.toLowerCase() === ALL_GROUP_ID) return;

    const target = state.groups.find((g) => normalizeGroupName(g.id).toLowerCase() === groupId.toLowerCase());
    if (!target) return;
    if (!canManageGroupEntry(target)) {
        showToast('Select that user in Filter by User to rename this group', 'info');
        return;
    }

    state.isCreatingGroup = false;
    state.renamingGroupId = target.id;
    renderGroups();
    setTimeout(() => {
        const input = document.querySelector('#group-list [data-role="rename-group-input"]');
        if (!input) return;
        input.focus();
        const len = input.value.length;
        input.setSelectionRange(len, len);
    }, 0);
}

function cancelRenameGroupFlow() {
    if (!state.renamingGroupId) return;
    state.renamingGroupId = null;
    renderGroups();
}

function syncGroupItemsToServer(oldName, newName, ownerUserId = null) {
    const oldGroup = normalizeGroupName(oldName);
    if (!oldGroup) return;
    const nextGroup = normalizeGroupName(newName);
    const targetUserId = ownerUserId ? String(ownerUserId) : null;
    api.renameGroup(oldGroup, nextGroup, targetUserId).catch((err) => {
        console.warn('[Group Sync] Failed:', err.message);
        showToast(`Saved locally, server sync failed: ${err.message}`, 'info');
    });
}

function handleRenameGroup(rawGroupId, rawName, opts = {}) {
    const groupId = normalizeGroupName(rawGroupId);
    if (!groupId || groupId.toLowerCase() === ALL_GROUP_ID) return;

    const target = state.groups.find((g) => normalizeGroupName(g.id).toLowerCase() === groupId.toLowerCase());
    if (!target) {
        state.renamingGroupId = null;
        renderGroups();
        return;
    }
    if (!canManageGroupEntry(target)) {
        showToast('Select that user in Filter by User to rename this group', 'info');
        state.renamingGroupId = null;
        renderGroups();
        return;
    }

    const nextName = normalizeGroupName(rawName);
    if (!nextName) {
        if (opts.onBlur) {
            cancelRenameGroupFlow();
        } else {
            showToast('Group name cannot be empty', 'error');
        }
        return;
    }
    if (nextName.toLowerCase() === ALL_GROUP_ID) {
        showToast('"All Links" is reserved', 'error');
        return;
    }

    const oldKey = normalizeStoredGroupName(target.name).toLowerCase();
    const sameByCaseInsensitive = nextName.toLowerCase() === oldKey;
    const duplicate = state.groups.find((g) => (
        normalizeGroupName(g.name).toLowerCase() === nextName.toLowerCase()
        && String(g.ownerUserId || '') === String(target.ownerUserId || '')
        && normalizeGroupName(g.name).toLowerCase() !== oldKey
    ));
    if (duplicate) {
        showToast(`Group "${duplicate.name}" already exists`, 'error');
        return;
    }

    if (!sameByCaseInsensitive || nextName !== target.name) {
        const oldName = target.name;
        const ownerUserId = target?.ownerUserId ? String(target.ownerUserId) : getScopedGroupOwnerUserId();
        const renamedGroups = getOwnerCustomGroups(ownerUserId).map((raw) => {
            const n = normalizeStoredGroupName(raw);
            if (n.toLowerCase() !== oldKey) return n;
            return nextName;
        });
        if (isAdminAllUsersMode() && ownerUserId) {
            setOwnerCustomGroups(ownerUserId, renamedGroups);
            saveGroupsToServer(renamedGroups, ownerUserId);
        } else {
            state.customGroups = renamedGroups;
            saveCustomGroups();
        }

        state.items = state.items.map((item) => {
            const itemGroup = normalizeStoredGroupName(item.group);
            if (itemGroup.toLowerCase() !== oldKey) return item;
            if (target?.ownerUserId && String(item.user_id || '') !== String(target.ownerUserId)) return item;
            return { ...item, group: nextName };
        });

        if (normalizeGroupName(state.activeGroup).toLowerCase() === normalizeGroupName(target.id).toLowerCase()) {
            state.activeGroup = buildGroupEntryId(nextName, target.ownerUserId || null);
        }
        syncGroupItemsToServer(oldName, nextName, ownerUserId || null);
    }

    state.renamingGroupId = null;
    syncGroupUI(true);
    renderList({ preserveScroll: true });
    if (!sameByCaseInsensitive || nextName !== target.name) {
        showToast(`Renamed group: ${target.name} → ${nextName}`, 'success');
    }
}

function syncGroupUI(syncSelect = false) {
    rebuildGroups();
    renderGroups();
    updateGroupHeader();
    if (syncSelect) populateGroupSelect();
}

/** Get badge class based on item type */
function getBadgeClass(type) {
    const map = { playlist: 'badge-playlist', track: 'badge-track', album: 'badge-album', artist: 'badge-artist' };
    return map[type] || 'badge-error';
}

/** Get dynamic metric labels based on item type */
function getMetricLabels(type) {
    switch (type) {
        case 'artist':   return { metric1: 'Monthly Listeners', metric2: 'Followers' };
        case 'track':    return { metric1: 'Monthly Plays',     metric2: 'Total Plays' };
        case 'album':    return { metric1: '-',                 metric2: 'Total Plays' };
        case 'playlist': return { metric1: 'Followers',         metric2: 'Total Plays' };
        default:         return { metric1: 'Metric 1',          metric2: 'Metric 2' };
    }
}

function getReleaseYear(item) {
    const candidates = [
        item?.release_year,
        item?.release_date,
        item?.album_release_date,
        item?.year,
    ];
    for (const value of candidates) {
        if (value == null) continue;
        const s = String(value).trim();
        if (!s) continue;
        const m = s.match(/\b(19|20)\d{2}\b/);
        if (m) return m[0];
    }
    return '-';
}

/** Get stat icons based on type */
function getStatIcons(item) {
    switch (item.type) {
        case 'playlist':
            return `
                <div class="flex items-center gap-1">
                    <span class="material-icons-round list-stat-icon">favorite_border</span>
                    <span class="list-stat-value">${formatNumber(item.followers || item.saves)}</span>
                </div>
                <div class="flex items-center gap-1">
                    <span class="material-icons-round list-stat-icon">music_note</span>
                    <span class="list-stat-value">${formatNumber(item.track_count)}</span>
                </div>`;
        case 'track':
            return `
                <div class="flex items-center gap-1">
                    <span class="material-icons-round list-stat-icon">schedule</span>
                    <span class="list-stat-value">${item.duration || '-'}</span>
                </div>
                <div class="flex items-center gap-1">
                    <span class="material-icons-round list-stat-icon">calendar_today</span>
                    <span class="list-stat-value">${getReleaseYear(item)}</span>
                </div>`;
        case 'album':
            return `
                <div class="flex items-center gap-1">
                    <span class="material-icons-round list-stat-icon">music_note</span>
                    <span class="list-stat-value">${formatNumber(item.track_count)}</span>
                </div>
                <div class="flex items-center gap-1">
                    <span class="material-icons-round list-stat-icon">calendar_today</span>
                    <span class="list-stat-value">${getReleaseYear(item)}</span>
                </div>`;
        case 'artist':
            return `
                <div class="flex items-center gap-1">
                    <span class="material-icons-round list-stat-icon">people</span>
                    <span class="list-stat-value">${formatNumber(item.followers)}</span>
                </div>
                <div class="flex items-center gap-1">
                    <span class="material-icons-round list-stat-icon">library_music</span>
                    <span class="list-stat-value">${formatNumber(item.album_count)} albums</span>
                </div>`;
        default:
            return '';
    }
}

/** Get metric 1 value (context-aware) */
function getMetric1(item) {
    switch (item.type) {
        case 'artist':   return formatDetailedMetric(item.monthly_listeners);
        case 'track':    return formatDetailedMetric(item.monthly_plays);
        case 'playlist': return formatDetailedMetric(item.followers || item.saves);
        case 'album':    return '-';
        default:         return '-';
    }
}

/** Get metric 2 value (context-aware) */
function getMetric2(item) {
    switch (item.type) {
        case 'artist':   return formatDetailedMetric(item.total_plays);
        case 'track':    return formatDetailedMetric(item.playcount);
        case 'playlist': return formatDetailedMetric(item.total_plays);
        case 'album':    return formatDetailedMetric(item.total_plays);
        default:         return '-';
    }
}

/** Get status info */
function getStatusInfo(item) {
    const statusMap = {
        active:   { dot: 'active',   label: 'Active',   color: 'text-primary' },
        error:    { dot: 'error',    label: `Error (${item.error_code || '?'})`, color: 'text-red-500' },
        pending:  { dot: 'pending',  label: 'Pending',  color: 'text-yellow-500' },
        crawling: { dot: 'crawling', label: 'Crawling...', color: 'text-blue-400' },
    };
    return statusMap[item.status] || statusMap.pending;
}

function normalizeJobResult(result, fallback = {}) {
    const resultObj = result || {};
    const merged = { ...fallback, ...resultObj };
    const has = (key) => Object.prototype.hasOwnProperty.call(resultObj, key);
    const keepFallbackWhenEmpty = (incoming, current) => {
        if (incoming === null || incoming === undefined) return current;
        if (typeof incoming === 'string' && !incoming.trim()) return current;
        return incoming;
    };

    let monthly = fallback.monthly_plays ?? fallback.monthly_listeners ?? null;
    if (has('monthly_plays')) monthly = keepFallbackWhenEmpty(resultObj.monthly_plays, monthly);
    else if (has('monthly_listeners')) monthly = keepFallbackWhenEmpty(resultObj.monthly_listeners, monthly);

    let total = fallback.total_plays ?? fallback.playcount ?? null;
    if (has('total_plays')) total = keepFallbackWhenEmpty(resultObj.total_plays, total);
    else if (has('playcount')) total = keepFallbackWhenEmpty(resultObj.playcount, total);

    let playcount = fallback.playcount ?? fallback.total_plays ?? null;
    if (has('playcount')) playcount = keepFallbackWhenEmpty(resultObj.playcount, playcount);
    else if (has('total_plays')) playcount = keepFallbackWhenEmpty(resultObj.total_plays, playcount);

    let duration = fallback.duration ?? null;
    if (has('duration')) {
        duration = keepFallbackWhenEmpty(resultObj.duration, duration);
    } else if (has('duration_ms')) {
        duration = keepFallbackWhenEmpty(formatDurationFromMs(resultObj.duration_ms), duration);
    } else if (merged.duration_ms != null) {
        duration = keepFallbackWhenEmpty(formatDurationFromMs(merged.duration_ms), duration);
    }

    return {
        ...fallback,
        ...resultObj,
        spotify_id: merged.spotify_id || fallback.spotify_id,
        type: merged.type || fallback.type,
        monthly_plays: monthly,
        monthly_listeners: merged.monthly_listeners ?? monthly,
        total_plays: total,
        playcount: playcount,
        duration: duration,
        saves: merged.saves ?? merged.followers ?? fallback.saves ?? fallback.followers ?? null,
        last_checked: new Date().toISOString(),
    };
}

// ═══════════════════════════════════════════════════════════════════
// ROW RENDERER
// ═══════════════════════════════════════════════════════════════════

function renderRow(item) {
    const status = getStatusInfo(item);
    const isError = item.status === 'error';
    const spotifyUrl = item.spotify_url || getSpotifyUrl(item.type, item.spotify_id);
    const ownerUrl = item.owner_url || spotifyUrl;
    const coverUrl = item.image || `https://picsum.photos/seed/${item.spotify_id}/128/128`;
    const checkedAt = item.last_checked || item.created_at || '';
    const updatedAt = formatUpdatedAt(checkedAt);
    const key = itemKey(item);
    const isSelected = state.selectedItemKeys.has(key);
    const isDragging = state.draggingRowKeys.includes(key);
    const isDropTarget = state.dragOverRowKey === key && !isDragging;

    const isDropBefore = isDropTarget && state.dragOverRowPlacement !== 'after';
    const isDropAfter = isDropTarget && state.dragOverRowPlacement === 'after';
    const excel = getExcelColumnValues(item);
    const subtitle = getItemSubtitle(item);
    const titleToneClass = isError ? 'list-asset-title-muted' : getTitleToneClass(item.type);
    const ownerUpdatedCell = renderOwnerUpdatedCell(item, ownerUrl, updatedAt);
    const displayTitle = getDisplayTitle(item);

    const row = document.createElement('div');
    row.className = `custom-grid-row px-4 py-3 bg-white/5 rounded-lg border border-transparent hover:bg-row-hover hover:border-white/10 transition-all group ${isSelected ? 'row-selected' : ''} ${isDragging ? 'row-dragging' : ''} ${isDropTarget ? 'row-drop-target' : ''} ${isDropBefore ? 'row-drop-before' : ''} ${isDropAfter ? 'row-drop-after' : ''}`;
    row.dataset.itemId = item.id;
    row.dataset.type = item.type;
    row.dataset.spotifyId = item.spotify_id;
    row.dataset.itemKey = key;
    row.draggable = true;

    row.innerHTML = `
        <!-- Left: Asset Details -->
        <div class="flex items-center gap-4">
            <button type="button" class="list-cover-trigger" data-action="preview-image" data-image-url="${escapeHtml(coverUrl)}" aria-label="Preview cover image">
                <img alt="Cover" class="list-cover-image" src="${coverUrl}">
            </button>
            <div>
                <span class="list-type-badge ${isError ? 'badge-error' : getBadgeClass(item.type)}">${item.type}</span>
                <h3 class="list-asset-title ${titleToneClass}">
                    <a class="list-title-link" href="${spotifyUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(displayTitle)}</a>
                </h3>
                <div class="list-asset-meta">
                    <p class="list-asset-uri text-secondary-text">spotify:${item.type}:${item.spotify_id}</p>
                    <button type="button" class="list-copy-btn" data-action="copy-link" data-copy-value="${spotifyUrl}" aria-label="Copy Spotify link">
                        <span class="material-icons-round">content_copy</span>
                        <span>Copy</span>
                    </button>
                </div>
                ${isError
                    ? `<p class="list-asset-error text-red-400 font-medium flex items-center gap-1"><span class="material-icons-round list-error-icon">warning</span> Error ${item.error_code}: ${item.error_message || 'Unknown error'}</p>`
                    : ``
                }
                ${subtitle ? `<p class="list-asset-subtitle text-secondary-text">${escapeHtml(subtitle)}</p>` : ``}
            </div>
        </div>
        <!-- Right: Metadata -->
        <div class="meta-grid w-full">
            ${ownerUpdatedCell}
            <div class="meta-cell">${renderMetricCell(excel.playlistSaves, excel.playlistSavesDelta, excel.deltaDays)}</div>
            <div class="meta-cell">${renderMetricCell(excel.playlistTrackCount, excel.playlistTrackCountDelta, excel.deltaDays)}</div>
            <div class="meta-cell">${renderMetricCell(excel.albumTrackCount, excel.albumTrackCountDelta, excel.deltaDays)}</div>
            <div class="meta-cell">${renderMetricCell(excel.artistFollowers, excel.artistFollowersDelta, excel.deltaDays)}</div>
            <div class="meta-cell">${renderMetricCell(excel.artistListeners, excel.artistListenersDelta, excel.deltaDays)}</div>
            <div class="meta-cell">${renderMetricCell(excel.trackViews, excel.trackViewsDelta, excel.deltaDays)}</div>
            <div class="meta-cell text-right row-action-cell">
                <div class="checked-stack">
                    <span class="list-checked-text text-secondary-text row-checked" data-checked-at="${escapeHtml(checkedAt)}">${timeAgo(checkedAt)}</span>
                    <span class="checked-status ${status.color}">
                        <span class="status-dot ${status.dot}"></span>
                        <span class="truncate">${status.label}</span>
                    </span>
                </div>
                <div class="row-action-buttons">
                    <button type="button" class="row-refresh-btn" aria-label="Refresh row">
                        <span class="material-icons-round">refresh</span>
                    </button>
                    <button type="button" class="row-delete-btn" aria-label="Delete link">
                        <span class="material-icons-round">delete</span>
                    </button>
                </div>
            </div>
        </div>
    `;

    return row;
}

function setupColumnResizers() {
    const handles = document.querySelectorAll('.column-resize-handle[data-col-key]');
    if (!handles.length) return;

    handles.forEach((handle) => {
        if (handle.dataset.bound === 'true') return;
        handle.dataset.bound = 'true';

        handle.addEventListener('dblclick', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const key = handle.dataset.colKey;
            if (!key || !(key in DEFAULT_COLUMN_WIDTHS)) return;
            setColumnWidth(key, DEFAULT_COLUMN_WIDTHS[key], true);
        });

        handle.addEventListener('pointerdown', (event) => {
            const key = handle.dataset.colKey;
            if (!key || !(key in DEFAULT_COLUMN_WIDTHS)) return;
            const resizeEdge = handle.dataset.resizeEdge === 'start' ? 'start' : 'end';

            event.preventDefault();
            event.stopPropagation();

            const startX = event.clientX;
            const startWidth = clampColumnWidth(key, state.columnWidths[key]);
            document.body.classList.add('column-resizing');

            const onMove = (moveEvent) => {
                const delta = moveEvent.clientX - startX;
                const nextWidth = resizeEdge === 'start'
                    ? startWidth - delta
                    : startWidth + delta;
                setColumnWidth(key, nextWidth, false, resizeEdge);
            };

            const onUp = () => {
                document.body.classList.remove('column-resizing');
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
                savePersistedColumnWidths(state.columnWidths);
            };

            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
        });
    });
}

/** Escape HTML to prevent XSS */
function escapeHtml(str) {
    const el = document.createElement('span');
    el.textContent = str;
    return el.innerHTML;
}

// ═══════════════════════════════════════════════════════════════════
// RENDER ENGINE
// ═══════════════════════════════════════════════════════════════════

function renderList(opts = {}) {
    const preserveScroll = Boolean(opts?.preserveScroll);
    const container = document.getElementById('link-list');
    const skeleton = document.getElementById('skeleton-container');
    const emptyState = document.getElementById('empty-state');
    const emptyTitleEl = emptyState ? (emptyState.querySelector('[data-empty-title]') || emptyState.querySelector('h3')) : null;
    const emptyDescEl = emptyState ? (emptyState.querySelector('[data-empty-description]') || emptyState.querySelector('p')) : null;
    const defaultEmptyTitle = 'No links yet';
    const defaultEmptyDescription = 'Add your first Spotify link to start monitoring play counts, followers, and more.';
    const listWrap = document.querySelector('.list-wrap');
    const prevScrollTop = preserveScroll && listWrap ? listWrap.scrollTop : null;
    const restoreScroll = () => {
        if (prevScrollTop == null || !listWrap) return;
        requestAnimationFrame(() => {
            listWrap.scrollTop = prevScrollTop;
        });
    };
    syncGroupUI();
    syncSelectedItemsWithState();

    const items = getVisibleItems();
    state.filteredItems = items;

    // Clear previous rows (keep skeleton and empty state)
    container.querySelectorAll('.custom-grid-row').forEach(el => el.remove());

    if (skeleton) skeleton.style.display = 'none';

    if (items.length === 0) {
        if (!state.searchQuery && emptyState) {
            if (emptyTitleEl) {
                emptyTitleEl.textContent = state.items.length === 0
                    ? defaultEmptyTitle
                    : `No links in "${getActiveGroupName()}"`;
            }
            if (emptyDescEl) {
                emptyDescEl.textContent = state.items.length === 0
                    ? defaultEmptyDescription
                    : 'Add a Spotify link to this group to start monitoring.';
            }
            emptyState.style.display = '';
            restoreScroll();
            return;
        }

        if (emptyState) emptyState.style.display = 'none';

        const noResult = document.createElement('div');
        noResult.className = 'custom-grid-row text-center py-12 text-secondary-text';
        noResult.innerHTML = `<div class="col-span-2">No results for "${escapeHtml(state.searchQuery)}"</div>`;
        container.appendChild(noResult);
        restoreScroll();
        return;
    }

    if (emptyTitleEl) emptyTitleEl.textContent = defaultEmptyTitle;
    if (emptyDescEl) emptyDescEl.textContent = defaultEmptyDescription;
    if (emptyState) emptyState.style.display = 'none';

    // Render all rows
    const frag = document.createDocumentFragment();
    items.forEach(item => frag.appendChild(renderRow(item)));
    container.appendChild(frag);

    // Update KPIs
    updateKPIs();
    refreshCheckedLabels();
    restoreScroll();
}
function refreshCheckedLabels() {
    const labels = document.querySelectorAll('#link-list .row-checked');
    labels.forEach((label) => {
        const checkedAt = label.getAttribute('data-checked-at');
        label.textContent = timeAgo(checkedAt);
    });
}

function updateKPIs() {
    const activeEntry = getGroupEntryById(state.activeGroup);
    const scoped = state.activeGroup === ALL_GROUP_ID
        ? state.items
        : state.items.filter((i) => doesItemMatchGroupEntry(i, activeEntry));
    const active = scoped.filter(i => i.status === 'active').length;
    const errors = scoped.filter(i => i.status === 'error').length;
    const crawling = scoped.filter(i => i.status === 'crawling' || i.status === 'pending').length;

    setText('kpi-total', scoped.length);
    setText('kpi-active', active);
    setText('kpi-errors', errors);
    setText('kpi-crawling', crawling);
    setText('footer-total', scoped.length);
    setText('footer-active', active);
    setText('footer-errors', errors);
    setText('footer-crawling', crawling);
    setText('group-count-all', state.items.length);
}

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

function updateApiStatus() {
    const el = document.getElementById('api-status');
    if (!el) return;
    if (state.apiOnline) {
        el.textContent = 'Optimal';
        el.className = 'text-primary font-bold uppercase';
    } else {
        el.textContent = 'Offline';
        el.className = 'text-red-500 font-bold uppercase';
    }
}

// ═══════════════════════════════════════════════════════════════════
// LINK / PREVIEW HELPERS
// ═══════════════════════════════════════════════════════════════════

async function copyToClipboard(value, successMessage) {
    if (!value) return;
    try {
        await navigator.clipboard.writeText(value);
        showToast(successMessage || 'Copied', 'success');
    } catch (err) {
        showToast('Copy failed', 'error');
    }
}

function openImagePreview(url) {
    if (!url) return;
    const modal = document.getElementById('image-preview-modal');
    const image = document.getElementById('image-preview-img');
    if (!modal || !image) return;
    image.src = url;
    modal.classList.add('open');
}

function closeImagePreview() {
    const modal = document.getElementById('image-preview-modal');
    const image = document.getElementById('image-preview-img');
    if (modal) modal.classList.remove('open');
    if (image) image.src = '';
}

async function handleDeleteItem(item) {
    if (!item) return;
    const label = item.name || `${item.type}:${item.spotify_id}`;
    state.selectedItemKeys.delete(itemKey(item));
    if (state.selectionAnchorKey === itemKey(item)) {
        state.selectionAnchorKey = null;
    }
    state.items = state.items.filter((i) => i.id !== item.id);
    persistCurrentItemOrder();
    state.pendingJobs.delete(item.id);
    for (const [jobId, itemId] of state.pendingJobToItem.entries()) {
        if (itemId === item.id || jobId === item.id) {
            state.pendingJobToItem.delete(jobId);
        }
    }
    renderList({ preserveScroll: true });

    try {
        if (state.apiOnline) {
            await api.deleteItem(item.type, item.spotify_id);
        }
        showToast(`Deleted: ${label}`, 'success');
    } catch (e) {
        showToast(`Deleted local only: ${label} (${e.message})`, 'info');
    }
}

function markItemAsRefreshing(item, nowIso) {
    return {
        ...item,
        status: 'crawling',
        error_code: null,
        error_message: null,
        last_checked: nowIso,
    };
}

async function handleRefreshItem(item) {
    if (!item) return;
    if (!state.apiOnline) {
        showToast('API offline, cannot refresh this row', 'info');
        return;
    }

    const url = getSpotifyUrl(item.type, item.spotify_id);
    const now = new Date().toISOString();
    const idx = state.items.findIndex((i) => i.id === item.id);
    if (idx >= 0) {
        state.items[idx] = markItemAsRefreshing(state.items[idx], now);
    }
    renderList({ preserveScroll: true });

    try {
        const result = await api.crawl(url, item.group || null);
        const jobId = result?.job_id;
        if (!jobId) {
            throw new Error('Backend did not return job_id');
        }
        state.pendingJobs.add(jobId);
        state.pendingJobToItem.set(jobId, item.id);
        startPolling();
        showToast(`Refreshing: ${item.name || `${item.type}:${item.spotify_id}`}`, 'success');
    } catch (e) {
        if (idx >= 0) {
            state.items[idx] = {
                ...state.items[idx],
                status: 'error',
                error_message: e.message,
                last_checked: new Date().toISOString(),
            };
        }
        renderList({ preserveScroll: true });
        showToast(`Refresh failed: ${e.message}`, 'error');
    }
}

async function clearList() {
    if (state.items.length === 0) {
        showToast('List is already empty', 'info');
        return;
    }

    state.items = [];
    state.filteredItems = [];
    clearRowSelection();
    savePersistedRowOrder([]);
    state.pendingJobs.clear();
    state.pendingJobToItem.clear();
    stopPolling();
    renderList({ preserveScroll: true });

    try {
        if (state.apiOnline) {
            await api.clearItems();
        }
        showToast('List cleared', 'success');
    } catch (e) {
        showToast(`Clear list local only: ${e.message}`, 'info');
    }
}

async function refreshAllItems() {
    const selectedVisibleItems = state.filteredItems.filter((item) => state.selectedItemKeys.has(itemKey(item)));
    const useSelectionScope = selectedVisibleItems.length >= 2;
    const targetItems = useSelectionScope
        ? selectedVisibleItems
        : (state.activeGroup === ALL_GROUP_ID
            ? state.items
            : state.items.filter((i) => doesItemMatchGroupEntry(i, getGroupEntryById(state.activeGroup))));

    if (targetItems.length === 0) {
        showToast('No links to refresh', 'info');
        return;
    }

    if (!state.apiOnline) {
        showToast('API offline, loading local data', 'info');
        await loadData({ preserveScroll: true });
        return;
    }

    const now = new Date().toISOString();
    const targetKeys = new Set(targetItems.map((item) => itemKey(item)));
    state.items = state.items.map((item) => (
        targetKeys.has(itemKey(item)) ? markItemAsRefreshing(item, now) : item
    ));
    renderList({ preserveScroll: true });

    try {
        const itemIds = targetItems.map((item) => item.id);
        const urls = targetItems.map((item) => getSpotifyUrl(item.type, item.spotify_id));
        const result = await api.crawlBatch(urls);
        const jobIds = result.job_ids || [];
        jobIds.forEach((jobId, idx) => {
            state.pendingJobs.add(jobId);
            if (itemIds[idx]) {
                state.pendingJobToItem.set(jobId, itemIds[idx]);
            }
        });
        state.batchRefresh = {
            active: true,
            groupName: getActiveGroupName(),
            expected: jobIds.length,
            done: 0,
            errors: 0,
            jobIds: new Set(jobIds),
        };
        startPolling();
        renderList({ preserveScroll: true });
        const scopeLabel = useSelectionScope ? 'selected links' : 'links';
        showToast(`Refresh started for ${result.count || urls.length} ${scopeLabel}`, 'success');
    } catch (e) {
        state.batchRefresh = null;
        await loadData({ preserveScroll: true });
        showToast(`Refresh fallback loaded data: ${e.message}`, 'info');
    }
}

function openSpotifyPopup(url) {
    const w = CONFIG.POPUP_WIDTH;
    const h = CONFIG.POPUP_HEIGHT;
    const left = window.screenX + window.outerWidth - w - 30;
    const top = window.screenY + 60;

    window.open(
        url,
        'spotify_preview',
        `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes,toolbar=no,menubar=no,location=yes,status=no`
    );
}

// ═══════════════════════════════════════════════════════════════════
// MODAL HANDLERS
// ═══════════════════════════════════════════════════════════════════

function openModal() {
    document.getElementById('add-link-modal').classList.add('open');
    document.getElementById('modal-url-input').value = '';
    document.getElementById('modal-url-input').focus();
    document.getElementById('modal-batch-area').classList.add('hidden');
    document.getElementById('modal-url-hint').textContent = 'Supports: playlist, track, album, and artist links';
    document.getElementById('modal-url-hint').className = 'text-xs text-secondary-text mt-2';
    populateGroupSelect();
}

function closeModal() {
    document.getElementById('add-link-modal').classList.remove('open');
}

async function submitSingle() {
    const input = document.getElementById('modal-url-input');
    const url = input.value.trim();
    const hint = document.getElementById('modal-url-hint');

    if (!url) {
        hint.textContent = 'Please enter a Spotify URL or URI';
        hint.className = 'text-xs text-red-400 mt-2';
        return;
    }

    const parsed = parseSpotifyUrl(url);
    if (!parsed) {
        hint.textContent = 'Invalid Spotify URL. Example: https://open.spotify.com/playlist/...';
        hint.className = 'text-xs text-red-400 mt-2';
        return;
    }

    const selectedGroup = resolveSelectedGroupContext();
    const group = selectedGroup.group;
    const currentIdentity = getUserIdentityById(selectedGroup.targetUserId);

    try {
        const result = await api.crawl(url, group, selectedGroup.targetUserId);
        const jobId = result?.job_id;
        if (!jobId) {
            throw new Error('Backend did not return job_id');
        }
        showToast(`Added ${parsed.type}: crawling started`, 'success');

        const now = new Date().toISOString();
        const existingIdx = findOwnedItemIndex(parsed.type, parsed.id, currentIdentity.id);

        if (existingIdx >= 0) {
            const existingOwnerId = state.items[existingIdx].user_id ? String(state.items[existingIdx].user_id) : '';
            const shouldAttachCurrentUser = !existingOwnerId || existingOwnerId === String(currentIdentity.id || '');
            state.items[existingIdx] = {
                ...state.items[existingIdx],
                status: 'crawling',
                error_code: null,
                error_message: null,
                last_checked: now,
                ...(shouldAttachCurrentUser
                    ? {
                        user_id: currentIdentity.id,
                        user_name: currentIdentity.name,
                        user_avatar: currentIdentity.avatar,
                    }
                    : {}),
            };
            state.pendingJobToItem.set(jobId, state.items[existingIdx].id);
        } else {
            const newItem = {
                id: `temp-${jobId}`,
                spotify_id: parsed.id,
                type: parsed.type,
                name: `Loading ${parsed.type}...`,
                status: 'crawling',
                group: group,
                last_checked: now,
                user_id: currentIdentity.id,
                user_name: currentIdentity.name,
                user_avatar: currentIdentity.avatar,
            };
            state.items.unshift(newItem);
            state.pendingJobToItem.set(jobId, newItem.id);
            persistCurrentItemOrder();
        }

        state.pendingJobs.add(jobId);
        startPolling();
        renderList();
        closeModal();
    } catch (e) {
        hint.textContent = `Error: ${e.message}`;
        hint.className = 'text-xs text-red-400 mt-2';
    }
}

async function submitBatch() {
    const textarea = document.getElementById('modal-batch-input');
    const urls = textarea.value.split('\n').map(u => u.trim()).filter(Boolean);

    if (urls.length === 0) {
        showToast('No URLs to add', 'error');
        return;
    }

    const invalid = urls.filter(u => !parseSpotifyUrl(u));
    if (invalid.length > 0) {
        showToast(`${invalid.length} invalid URL(s) found`, 'error');
        return;
    }

    const selectedGroup = resolveSelectedGroupContext();
    const group = selectedGroup.group;
    const currentIdentity = getUserIdentityById(selectedGroup.targetUserId);

    try {
        const result = await api.crawlBatch(urls, group, selectedGroup.targetUserId);
        showToast(`Added ${urls.length} links — crawling started`, 'success');

        const now = new Date().toISOString();
        let mappedJobs = 0;

        // Mark existing rows as crawling or add placeholders
        urls.forEach((url, i) => {
            const parsed = parseSpotifyUrl(url);
            if (!parsed) return;
            const jobId = result.job_ids?.[i];
            if (!jobId) return;

            const ownedIdx = findOwnedItemIndex(parsed.type, parsed.id, currentIdentity.id);

            if (ownedIdx >= 0) {
                const existingOwnerId = state.items[ownedIdx].user_id ? String(state.items[ownedIdx].user_id) : '';
                const shouldAttachCurrentUser = !existingOwnerId || existingOwnerId === String(currentIdentity.id || '');
                state.items[ownedIdx] = {
                    ...state.items[ownedIdx],
                    status: 'crawling',
                    error_code: null,
                    error_message: null,
                    last_checked: now,
                    ...(shouldAttachCurrentUser
                        ? {
                            user_id: currentIdentity.id,
                            user_name: currentIdentity.name,
                            user_avatar: currentIdentity.avatar,
                        }
                        : {}),
                };
                state.pendingJobToItem.set(jobId, state.items[ownedIdx].id);
            } else {
                const newItem = {
                    id: `temp-${jobId}`,
                    spotify_id: parsed.id,
                    type: parsed.type,
                    name: `Loading ${parsed.type}...`,
                    status: 'crawling',
                    group: group,
                    last_checked: now,
                    user_id: currentIdentity.id,
                    user_name: currentIdentity.name,
                    user_avatar: currentIdentity.avatar,
                };
                state.items.unshift(newItem);
                state.pendingJobToItem.set(jobId, newItem.id);
                persistCurrentItemOrder();
            }

            state.pendingJobs.add(jobId);
            mappedJobs += 1;
        });

        if (mappedJobs === 0) {
            showToast('No jobs were created by backend', 'error');
            return;
        }

        startPolling();
        renderList();
        closeModal();
    } catch (e) {
        showToast(`Batch error: ${e.message}`, 'error');
    }
}

// ═══════════════════════════════════════════════════════════════════
// TOAST NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = { success: 'check_circle', error: 'error', info: 'info' }[type] || 'info';
    toast.innerHTML = `<span class="material-icons-round text-lg">${icon}</span>${escapeHtml(message)}`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(16px)';
        toast.style.transition = 'all 300ms ease';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ═══════════════════════════════════════════════════════════════════
// POLLING — Check pending job status
// ═══════════════════════════════════════════════════════════════════

function startPolling() {
    if (state.pollTimer) return;
    pollJobs();
    state.pollTimer = setInterval(pollJobs, CONFIG.POLL_INTERVAL);
}

function stopPolling() {
    if (state.pollTimer) {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
    }
}

async function pollJobs() {
    if (state.pendingJobs.size === 0) {
        stopPolling();
        return;
    }

    const pendingJobIds = Array.from(state.pendingJobs);
    if (pendingJobIds.length === 0) {
        stopPolling();
        return;
    }

    let shouldReload = false;
    let hasTerminalUpdate = false;
    let shouldNotifyBatchDone = false;
    const jobResults = await Promise.all(
        pendingJobIds.map(async (jobId) => {
            try {
                return { jobId, job: await api.getJob(jobId) };
            } catch {
                return { jobId, job: null };
            }
        })
    );

    for (const { jobId, job } of jobResults) {
        if (!job) continue;

        const mappedItemId = state.pendingJobToItem.get(jobId) || jobId;
        const inBatch = Boolean(
            state.batchRefresh?.active
            && state.batchRefresh?.jobIds?.has(jobId)
        );
        if (job.status === 'completed') {
            hasTerminalUpdate = true;
            // Force a canonical reload so delta badges (snapshot-based) appear immediately.
            shouldReload = true;
            state.pendingJobs.delete(jobId);
            state.pendingJobToItem.delete(jobId);
            const completedAt = job.completed_at || new Date().toISOString();
            // Update item in state with real data
            const idx = state.items.findIndex(i => i.id === mappedItemId || i.id === jobId);
            if (idx >= 0 && job.result) {
                state.items[idx] = {
                    ...state.items[idx],
                    ...normalizeJobResult(job.result, state.items[idx]),
                    status: 'active',
                    last_checked: completedAt,
                };
            } else if (job.result) {
                const bySpotifyId = state.items.findIndex(i => i.spotify_id === job.result.spotify_id);
                if (bySpotifyId >= 0) {
                    state.items[bySpotifyId] = {
                        ...state.items[bySpotifyId],
                        ...normalizeJobResult(job.result, state.items[bySpotifyId]),
                        status: 'active',
                        last_checked: completedAt,
                    };
                } else {
                    shouldReload = true;
                }
            } else {
                shouldReload = true;
            }
            if (inBatch && state.batchRefresh) {
                state.batchRefresh.done += 1;
                shouldNotifyBatchDone = true;
            }
        } else if (job.status === 'error') {
            hasTerminalUpdate = true;
            state.pendingJobs.delete(jobId);
            state.pendingJobToItem.delete(jobId);
            const idx = state.items.findIndex(i => i.id === mappedItemId || i.id === jobId);
            if (idx >= 0) {
                state.items[idx].status = 'error';
                state.items[idx].error_message = job.error;
                state.items[idx].last_checked = job.completed_at || new Date().toISOString();
            } else {
                shouldReload = true;
            }
            if (inBatch && state.batchRefresh) {
                state.batchRefresh.done += 1;
                state.batchRefresh.errors += 1;
                shouldNotifyBatchDone = true;
            }
        }
    }

    if (state.batchRefresh?.active && shouldNotifyBatchDone) {
        const batch = state.batchRefresh;
        if (batch.done >= batch.expected) {
            const ok = Math.max(0, batch.expected - batch.errors);
            if (batch.errors > 0) {
                showToast(`Refresh completed: ${ok}/${batch.expected} links, ${batch.errors} errors`, 'info');
            } else {
                showToast(`Refresh completed: ${ok}/${batch.expected} links`, 'success');
            }
            state.batchRefresh = null;
        }
    }

    if (shouldReload) {
        await loadData({ preserveScroll: true });
    } else if (hasTerminalUpdate) {
        renderList({ preserveScroll: true });
    } else {
        renderList({ preserveScroll: true });
    }
}

// ═══════════════════════════════════════════════════════════════════
// SEARCH
// ═══════════════════════════════════════════════════════════════════

const handleSearch = debounce((query) => {
    state.searchQuery = query;
    renderList();
}, CONFIG.SEARCH_DEBOUNCE);

// ═══════════════════════════════════════════════════════════════════
// DATA LOADING (with demo fallback)
// ═══════════════════════════════════════════════════════════════════

/** Demo data — shown when backend is not available */
function getDemoData() {
    return [
        {
            id: 'demo-1', spotify_id: '37i9dQZF1DX8U', type: 'playlist',
            name: 'Whiskey Blues Best Of Slow Blues & Smoky Bar Vibes',
            image: 'https://picsum.photos/seed/jazz1/128/128',
            owner_name: 'Sarah Melodic', owner_image: 'https://randomuser.me/api/portraits/women/44.jpg',
            added_date: '10/02 11:22', followers: 12500, saves: 12500, track_count: 150,
            monthly_plays: 1158201, total_plays: 15482900,
            status: 'active', last_checked: new Date(Date.now() - 2 * 60000).toISOString(),
        },
        {
            id: 'demo-2', spotify_id: '5Rrf7iqB3Pjx', type: 'playlist',
            name: 'Winter Jazz Café — Cozy Fireplace Ambience',
            image: 'https://picsum.photos/seed/jazz2/128/128',
            owner_name: 'David Jazz', owner_image: 'https://randomuser.me/api/portraits/women/68.jpg',
            added_date: '10/02 11:20', followers: 4200, saves: 4200, track_count: 95,
            monthly_plays: 552532, total_plays: 5891204,
            status: 'error', error_code: 404, error_message: 'Not Found',
            last_checked: new Date(Date.now() - 14 * 60000).toISOString(),
        },
        {
            id: 'demo-3', spotify_id: '2N3D9rE', type: 'album',
            name: 'Midnight Sax — Smooth Saxophone Sessions',
            image: 'https://picsum.photos/seed/jazz3/128/128',
            owner_name: 'Marc C.', owner_image: null,
            added_date: '09/02 14:44', followers: 1800, saves: 1800, track_count: 12,
            monthly_plays: 128647, total_plays: 1450230,
            status: 'pending', last_checked: new Date().toISOString(),
        },
        {
            id: 'demo-4', spotify_id: '1A4K', type: 'playlist',
            name: 'Bebop Essentials — Classic Bebop Jazz Standards',
            image: 'https://picsum.photos/seed/jazz4/128/128',
            owner_name: 'Erik Vance', owner_image: 'https://randomuser.me/api/portraits/men/75.jpg',
            added_date: '06/02 14:29', followers: 28400, saves: 28400, track_count: 210,
            monthly_plays: 892104, total_plays: 12501890,
            status: 'active', last_checked: new Date(Date.now() - 45 * 60000).toISOString(),
        },
        {
            id: 'demo-5', spotify_id: '9Vb2', type: 'playlist',
            name: 'Nu Jazz Waves — Future Jazz & Electronic Grooves',
            image: 'https://picsum.photos/seed/jazz5/128/128',
            owner_name: 'Liam Stone', owner_image: 'https://randomuser.me/api/portraits/men/22.jpg',
            added_date: '06/02 14:29', followers: 5900, saves: 5900, track_count: 88,
            monthly_plays: 238528, total_plays: 3120500,
            status: 'active', last_checked: new Date(Date.now() - 60 * 60000).toISOString(),
        },
        {
            id: 'demo-6', spotify_id: '6rqhFg', type: 'track',
            name: "I Won't Never Go — Smooth Jazz Ballad",
            image: 'https://picsum.photos/seed/track1/128/128',
            owner_name: 'Tony Blues', owner_image: 'https://randomuser.me/api/portraits/men/55.jpg',
            added_date: '10/02 11:20', saves: 18200, duration: '4:32',
            monthly_plays: 238528, playcount: 1795709,
            status: 'active', last_checked: new Date(Date.now() - 30 * 60000).toISOString(),
        },
        {
            id: 'demo-7', spotify_id: '8mXk2j', type: 'track',
            name: 'All Night Long — Saxophone Lounge Mix',
            image: 'https://picsum.photos/seed/track2/128/128',
            owner_name: 'Nina Sax', owner_image: 'https://randomuser.me/api/portraits/women/31.jpg',
            added_date: '10/02 11:20', saves: 7400, duration: '3:48',
            monthly_plays: 238528, playcount: 570994,
            status: 'active', last_checked: new Date(Date.now() - 30 * 60000).toISOString(),
        },
        {
            id: 'demo-8', spotify_id: '3kLmNp', type: 'track',
            name: 'Slow Tunes — Late Night Jazz Session',
            image: 'https://picsum.photos/seed/track3/128/128',
            owner_name: 'Jazz Keys', owner_image: 'https://randomuser.me/api/portraits/men/42.jpg',
            added_date: '10/02 11:20', saves: 12100, duration: '5:12',
            monthly_plays: 238528, playcount: 976684,
            status: 'active', last_checked: new Date(Date.now() - 30 * 60000).toISOString(),
        },
        {
            id: 'demo-9', spotify_id: 'Xp4qR8', type: 'playlist',
            name: 'Late Night Bar — Smooth Saxophone & Whiskey Blues',
            image: 'https://picsum.photos/seed/jazz7/128/128',
            owner_name: 'Chris Miller', owner_image: 'https://randomuser.me/api/portraits/men/85.jpg',
            added_date: '10/02 11:20', followers: 1200, saves: 1200, track_count: 122,
            status: 'error', error_code: 403, error_message: 'Forbidden',
            last_checked: new Date(Date.now() - 3 * 3600000).toISOString(),
        },
        {
            id: 'demo-10', spotify_id: '0Pq2', type: 'playlist',
            name: 'Jazz Morning ☕ Positive Energy Bossa Nova & Café Music',
            image: 'https://picsum.photos/seed/lofi8/128/128',
            owner_name: 'JazzBot', owner_image: null,
            added_date: '10/02 11:24', followers: 92500, saves: 92500, track_count: 450,
            monthly_plays: 2341072, total_plays: 42620900,
            status: 'active', last_checked: new Date(Date.now() - 5 * 3600000).toISOString(),
        },
        {
            id: 'demo-11', spotify_id: '4kFd9X', type: 'artist',
            name: 'Bill Evans',
            image: 'https://picsum.photos/seed/artist1/128/128',
            owner_name: 'Bill Evans', owner_image: 'https://picsum.photos/seed/artist1/128/128',
            added_date: '11/02 09:30', followers: 1245000, monthly_listeners: 3892400,
            album_count: 42,
            status: 'active', last_checked: new Date(Date.now() - 2 * 3600000).toISOString(),
        },
    ];
}

async function setupAdminUserFilter() {
    const user = getAuthUser();
    if (!user || user.role !== 'admin') return;

    try {
        const users = await _fetchAdminUsers({ preferCache: true });
        state.adminUserList = Array.isArray(users) ? users.slice() : [];
        rebuildAdminUserFilterOptions();
        if (state.items.length) {
            rebuildGroups();
            updateGroupHeader();
            renderGroups();
        }
    } catch {
        return;
    }

    const groupPanel = document.getElementById('group-panel');
    if (!groupPanel || document.getElementById('admin-user-filter')) return;

    const filterDiv = document.createElement('div');
    filterDiv.className = 'px-5 py-2 border-b border-white/5';
    filterDiv.id = 'admin-user-filter-wrap';
    var filterLabel = document.createElement('label');
    filterLabel.className = 'block text-[11px] font-bold uppercase tracking-[0.12em] text-secondary-text mb-2';
    filterLabel.textContent = 'Filter by User';
    filterDiv.appendChild(filterLabel);

    var filterOptions = [{value: '', label: 'All Users'}];
    for (var fi = 0; fi < state.adminUserList.length; fi++) {
        var fu = state.adminUserList[fi];
        filterOptions.push({value: fu.id || fu._id || '', label: fu.display_name || fu.username || String(fu.id)});
    }
    var filterDropdown = createCustomDropdown({
        id: 'admin-user-filter',
        options: filterOptions,
        selected: '',
        onChange: handleAdminFilterChange
    });
    filterDiv.appendChild(filterDropdown);

    // Insert after admin badge (if present), before the group search area
    const adminBadge = document.getElementById('admin-badge');
    if (adminBadge && adminBadge.nextSibling) {
        groupPanel.insertBefore(filterDiv, adminBadge.nextSibling);
    } else {
        groupPanel.insertBefore(filterDiv, groupPanel.firstChild);
    }

}

function rebuildAdminUserFilterOptions() {
    const filterWrap = document.getElementById('admin-user-filter-dropdown');
    if (!filterWrap) return;
    const options = [{ value: '', label: 'All Users' }];
    (state.adminUserList || []).forEach((user) => {
        options.push({
            value: user.id || user._id || '',
            label: user.display_name || user.username || String(user.id || user._id || ''),
        });
    });
    updateCustomDropdownOptions('admin-user-filter-dropdown', options, state.adminFilterUserId || '');
}

function handleAdminFilterChange(val) {
    state.adminFilterUserId = val || null;
    state.activeGroup = ALL_GROUP_ID;
    state.groupSearchQuery = '';
    clearRowSelection();

    var pageTitle = document.getElementById('page-title');
    var breadcrumb = document.getElementById('breadcrumb-group');
    if (val) {
        var selectedUser = state.adminUserList.find(function(u) { return String(u.id || u._id) === val; });
        var username = (selectedUser && (selectedUser.display_name || selectedUser.username)) || val;
        if (pageTitle) pageTitle.textContent = ALL_GROUP_LABEL + ' (' + username + ')';
        if (breadcrumb) breadcrumb.textContent = ALL_GROUP_LABEL + ' (' + username + ')';
    } else {
        updateGroupHeader();
    }

    loadData({ preserveScroll: false });
    if (val) {
        syncGroupsFromServer(val);
    } else {
        state.customGroups = loadCustomGroups();
        syncGroupsFromServer();
    }
}

async function loadData(opts = {}) {
    const preserveScroll = Boolean(opts?.preserveScroll);
    const skeleton = document.getElementById('skeleton-container');

    // Keep health async so list rendering is not blocked by a separate round-trip.
    api.health()
        .then(() => {
            state.apiOnline = true;
            updateApiStatus();
        })
        .catch(() => {
            state.apiOnline = false;
            updateApiStatus();
        });

    // Fetch items
    try {
        const params = {};
        const currentUser = getAuthUser();
        if (currentUser?.role === 'admin') {
            await _fetchAdminUsers({ preferCache: Boolean(state.adminFilterUserId) });
        }
        if (currentUser?.role === 'admin' && state.adminFilterUserId) {
            params.user_id = state.adminFilterUserId;
        }
        const data = await api.getItems(params);
        if (!data) return;
        const incoming = data.items || data || [];
        state.items = applyPersistedItemOrder(mergeItemsKeepOrder(state.items, incoming));
        persistCurrentItemOrder();
        syncSelectedItemsWithState();
        syncGroupUI(true);
        if (skeleton) skeleton.style.display = 'none';
        renderList({ preserveScroll });
    } catch (err) {
        console.error('loadData error:', err);
        if (skeleton) skeleton.style.display = 'none';
        if (getAuthToken()) {
            state.items = [];
        } else {
            state.items = applyPersistedItemOrder(getDemoData());
        }
        persistCurrentItemOrder();
        syncSelectedItemsWithState();
        syncGroupUI(true);
        renderList({ preserveScroll });
    }
}

// ═══════════════════════════════════════════════════════════════════
// HERO IMAGE
// ═══════════════════════════════════════════════════════════════════

async function runBackgroundSync(opts = {}) {
    const force = Boolean(opts?.force);
    if (state.remoteSyncInFlight) return;
    if (!getAuthToken()) return;
    if (!force && document.hidden) return;
    if (!force && state.pendingJobs.size > 0) return;
    if (!force && state.currentView && state.currentView !== 'linkchecker') return;

    state.remoteSyncInFlight = true;
    try {
        await syncGroupsFromServer(state.adminFilterUserId || null);
        await loadData({ preserveScroll: true });
    } catch (err) {
        console.warn('[Background Sync] Failed:', err.message);
    } finally {
        state.remoteSyncInFlight = false;
    }
}

function startBackgroundSync() {
    if (state.remoteSyncTimer) return;
    state.remoteSyncTimer = setInterval(() => {
        runBackgroundSync();
    }, CONFIG.BACKGROUND_SYNC_INTERVAL);

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            runBackgroundSync({ force: true });
        }
    });
    window.addEventListener('focus', () => {
        runBackgroundSync({ force: true });
    });
}

function updateHeroImage() {
    const hero = document.querySelector('.playlist-hero');
    if (!hero) return;
    const firstCover = document.querySelector('.list-grid .custom-grid-row img');
    const src = firstCover && firstCover.getAttribute('src');

    const upscaleCover = (url) => {
        if (!url) return '';
        if (url.includes('picsum.photos/seed/')) {
            return url.replace(/\/\d+\/\d+(\?.*)?$/, '/1800/900');
        }
        return url;
    };

    const heroImage = upscaleCover(src) || 'https://picsum.photos/seed/spotify-warm-cover/1800/900';
    hero.style.setProperty('--hero-image', `url('${heroImage}')`);
}

// ═══════════════════════════════════════════════════════════════════
// STICKY HEADER
// ═══════════════════════════════════════════════════════════════════

function initStickyHeader() {
    const listWrap = document.querySelector('.list-wrap');
    const listHead = document.querySelector('.list-head');
    if (!listWrap || !listHead) return;

    const updateStickyState = () => {
        const stuck = listWrap.scrollTop >= listHead.offsetTop;
        listHead.classList.toggle('is-stuck', stuck);
    };
    updateStickyState();
    listWrap.addEventListener('scroll', updateStickyState, { passive: true });
    window.addEventListener('resize', updateStickyState);
}


// ===================================================================
// VIEW MANAGEMENT — single source of truth for panel switching
// ===================================================================

state.currentView = 'linkchecker'; // 'linkchecker' | 'settings' | 'users'

function setElementDisplay(el, mode) {
    if (!el) return;
    if (!mode) {
        el.style.removeProperty('display');
        return;
    }
    el.style.display = mode;
}

function switchToView(view) {
    var listWrap = document.querySelector('.list-wrap');
    var settingsPanel = document.getElementById('settings-panel');
    var adminPanel = document.getElementById('admin-users-panel');
    var btnRefresh = document.getElementById('btn-refresh');
    var btnAddLink = document.getElementById('btn-add-link');
    var searchWrap = document.getElementById('search-input') ? document.getElementById('search-input').parentElement : null;
    var breadcrumb = document.getElementById('breadcrumb-group');
    var pageTitle = document.getElementById('page-title');
    // Find the breadcrumb parent label (e.g. "Link Checker" > "All Links")
    var breadcrumbParent = breadcrumb && breadcrumb.previousElementSibling
        ? breadcrumb.previousElementSibling.previousElementSibling
        : null;

    // 1) Hide ALL panels
    setElementDisplay(listWrap, 'none');
    setElementDisplay(settingsPanel, 'none');
    setElementDisplay(adminPanel, 'none');

    // 2) Update sidebar nav active state
    var navMap = { linkchecker: 'nav-links', settings: 'nav-settings', users: 'nav-users' };
    document.querySelectorAll('#sidebar nav a').forEach(function(a) {
        a.classList.remove('text-white', 'bg-white/10');
        a.classList.add('text-secondary-text');
        var icon = a.querySelector('.material-icons-round');
        if (icon) icon.classList.remove('text-primary');
    });
    var activeNav = document.getElementById(navMap[view]);
    if (activeNav) {
        activeNav.classList.add('text-white', 'bg-white/10');
        activeNav.classList.remove('text-secondary-text');
        var icon = activeNav.querySelector('.material-icons-round');
        if (icon) icon.classList.add('text-primary');
    }

    // 3) Show/hide toolbar (only for linkchecker)
    var showToolbar = (view === 'linkchecker');
    setElementDisplay(btnRefresh, showToolbar ? null : 'none');
    setElementDisplay(btnAddLink, showToolbar ? null : 'none');
    setElementDisplay(searchWrap, showToolbar ? null : 'none');

    // 4) Show the correct panel and load its data
    state.currentView = view;

    if (view === 'linkchecker') {
        setElementDisplay(listWrap, null);
        if (breadcrumbParent) breadcrumbParent.textContent = 'Link Checker';
        updateGroupHeader();
        if (state.items.length > 0) {
            renderList({ preserveScroll: true });
        }
        loadData({ preserveScroll: true });
    } else if (view === 'settings') {
        setElementDisplay(settingsPanel, 'block');
        if (breadcrumbParent) breadcrumbParent.textContent = 'Account';
        if (breadcrumb) breadcrumb.textContent = 'Settings';
        if (pageTitle) pageTitle.textContent = 'Account Settings';
        loadSettingsData();
    } else if (view === 'users') {
        setElementDisplay(adminPanel, 'block');
        if (breadcrumbParent) breadcrumbParent.textContent = 'Admin';
        if (breadcrumb) breadcrumb.textContent = 'Users';
        if (pageTitle) pageTitle.textContent = 'User Management';
        loadAdminUsers({ force: true });
    }
}

// Legacy wrappers for backward compatibility
function showSettings() { switchToView('settings'); }
function hideSettings() {
    if (state.currentView === 'settings') switchToView('linkchecker');
}
function showAdminUsers() { switchToView('users'); }
function hideAdminUsers() {
    if (state.currentView === 'users') switchToView('linkchecker');
}

function loadSettingsData() {
    const user = getAuthUser();
    if (!user) return;

    document.getElementById('settings-username').value = user.username || '';
    document.getElementById('settings-displayname').value = user.display_name || '';
    document.getElementById('settings-role').textContent = user.role === 'admin' ? 'Admin' : 'User';
    document.getElementById('settings-created').textContent = user.created_at ? new Date(user.created_at).toLocaleDateString() : '-';

    updateSettingsAvatar(user);

    document.getElementById('settings-current-pw').value = '';
    document.getElementById('settings-new-pw').value = '';
    document.getElementById('settings-confirm-pw').value = '';
}

function updateSettingsAvatar(user) {
    const preview = document.getElementById('settings-avatar-preview');
    if (!preview) return;
    if (user.avatar) {
        preview.innerHTML = '<img src="' + user.avatar + '" class="w-full h-full object-cover">';
    } else {
        const initials = (user.display_name || user.username || '??').slice(0, 2).toUpperCase();
        preview.innerHTML = initials;
    }
}

async function handleSaveProfile() {
    const displayName = document.getElementById('settings-displayname').value.trim();
    const statusEl = document.getElementById('settings-profile-status');

    try {
        const token = getAuthToken();
        const res = await fetch(CONFIG.API_BASE + '/auth/me', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ display_name: displayName || null }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Failed to update profile');

        localStorage.setItem('spoticheck_user', JSON.stringify(data));
        setupAuthUI();

        statusEl.textContent = 'Saved!';
        statusEl.style.display = '';
        statusEl.style.color = '#1db954';
        setTimeout(() => { statusEl.style.display = 'none'; }, 3000);
    } catch (err) {
        statusEl.textContent = err.message;
        statusEl.style.display = '';
        statusEl.style.color = '#ef4444';
        setTimeout(() => { statusEl.style.display = 'none'; }, 5000);
    }
}

async function handleChangePassword() {
    const currentPw = document.getElementById('settings-current-pw').value;
    const newPw = document.getElementById('settings-new-pw').value;
    const confirmPw = document.getElementById('settings-confirm-pw').value;
    const statusEl = document.getElementById('settings-pw-status');

    if (!currentPw || !newPw) { statusEl.textContent = 'Please fill in all fields'; statusEl.style.display = ''; statusEl.style.color = '#ef4444'; return; }
    if (newPw !== confirmPw) { statusEl.textContent = 'New passwords do not match'; statusEl.style.display = ''; statusEl.style.color = '#ef4444'; return; }
    if (newPw.length < 4) { statusEl.textContent = 'Password must be at least 4 characters'; statusEl.style.display = ''; statusEl.style.color = '#ef4444'; return; }

    try {
        const token = getAuthToken();
        const res = await fetch(CONFIG.API_BASE + '/auth/me/password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ current_password: currentPw, new_password: newPw }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Failed to change password');

        document.getElementById('settings-current-pw').value = '';
        document.getElementById('settings-new-pw').value = '';
        document.getElementById('settings-confirm-pw').value = '';

        statusEl.textContent = 'Password changed!';
        statusEl.style.display = '';
        statusEl.style.color = '#1db954';
        setTimeout(() => { statusEl.style.display = 'none'; }, 3000);
    } catch (err) {
        statusEl.textContent = err.message;
        statusEl.style.display = '';
        statusEl.style.color = '#ef4444';
        setTimeout(() => { statusEl.style.display = 'none'; }, 5000);
    }
}

async function handleAvatarUpload(file) {
    if (!file) return;
    if (file.size > 500000) { showToast('Image too large (max 500KB)', 'error'); return; }

    const reader = new FileReader();
    reader.onload = async function(e) {
        const dataUrl = e.target.result;
        try {
            const token = getAuthToken();
            const res = await fetch(CONFIG.API_BASE + '/auth/me/avatar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                body: JSON.stringify({ avatar: dataUrl }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Failed to upload avatar');

            const user = getAuthUser();
            user.avatar = dataUrl;
            localStorage.setItem('spoticheck_user', JSON.stringify(user));
            updateSettingsAvatar(user);
            setupAuthUI();
            showToast('Avatar updated!', 'success');
        } catch (err) {
            showToast(err.message, 'error');
        }
    };
    reader.readAsDataURL(file);
}

async function handleAvatarRemove() {
    try {
        const token = getAuthToken();
        const res = await fetch(CONFIG.API_BASE + '/auth/me/avatar', {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + token },
        });
        if (!res.ok) { const d = await res.json(); throw new Error(d.detail || 'Failed'); }

        const user = getAuthUser();
        user.avatar = null;
        localStorage.setItem('spoticheck_user', JSON.stringify(user));
        updateSettingsAvatar(user);
        setupAuthUI();
        showToast('Avatar removed', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
}



// ═══════════════════════════════════════════════════════════════════
// CUSTOM DROPDOWN COMPONENT
// ═══════════════════════════════════════════════════════════════════

/**
 * Creates a custom dropdown replacing a native <select>
 * @param {object} opts - { id, options: [{value, label}], selected, onChange, cssClass }
 * @returns {HTMLElement} the custom dropdown element
 */
function createCustomDropdown(opts) {
    var wrap = document.createElement('div');
    wrap.className = 'custom-dropdown' + (opts.cssClass ? ' ' + opts.cssClass : '');
    wrap.id = (opts.id || '') + '-dropdown';
    wrap.setAttribute('data-value', opts.selected || '');

    var arrowSvg = '<svg class="custom-dropdown-arrow" viewBox="0 0 12 8" fill="none"><path d="M1 1.5l5 5 5-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    var selectedLabel = '';
    for (var i = 0; i < opts.options.length; i++) {
        if (opts.options[i].value === (opts.selected || '')) {
            selectedLabel = opts.options[i].label;
            break;
        }
    }
    if (!selectedLabel && opts.options.length > 0) selectedLabel = opts.options[0].label;

    var toggle = document.createElement('div');
    toggle.className = 'custom-dropdown-toggle';
    toggle.setAttribute('tabindex', '0');
    toggle.innerHTML = '<span class="custom-dropdown-label" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + selectedLabel + '</span>' + arrowSvg;
    wrap.appendChild(toggle);

    var menu = document.createElement('div');
    menu.className = 'custom-dropdown-menu';

    for (var i = 0; i < opts.options.length; i++) {
        var opt = document.createElement('div');
        opt.className = 'custom-dropdown-option' + (opts.options[i].value === (opts.selected || '') ? ' selected' : '');
        opt.setAttribute('data-value', opts.options[i].value);
        opt.textContent = opts.options[i].label;
        menu.appendChild(opt);
    }
    wrap.appendChild(menu);

    // Toggle open/close
    toggle.addEventListener('click', function(e) {
        e.stopPropagation();
        // Close all other open dropdowns
        document.querySelectorAll('.custom-dropdown.open').forEach(function(d) {
            if (d !== wrap) d.classList.remove('open');
        });
        wrap.classList.toggle('open');
    });

    toggle.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle.click();
        } else if (e.key === 'Escape') {
            wrap.classList.remove('open');
        }
    });

    // Select option
    menu.addEventListener('click', function(e) {
        var optEl = e.target.closest('.custom-dropdown-option');
        if (!optEl) return;
        var val = optEl.getAttribute('data-value');
        wrap.setAttribute('data-value', val);
        toggle.querySelector('.custom-dropdown-label').textContent = optEl.textContent;
        menu.querySelectorAll('.custom-dropdown-option').forEach(function(o) { o.classList.remove('selected'); });
        optEl.classList.add('selected');
        wrap.classList.remove('open');
        if (opts.onChange) opts.onChange(val);
    });

    return wrap;
}

// Update options of an existing custom dropdown
function updateCustomDropdownOptions(dropdownId, options, selected) {
    var wrap = document.getElementById(dropdownId);
    if (!wrap) return;
    var menu = wrap.querySelector('.custom-dropdown-menu');
    var label = wrap.querySelector('.custom-dropdown-label');
    if (!menu || !label) return;

    menu.innerHTML = '';
    var selectedLabel = '';
    for (var i = 0; i < options.length; i++) {
        var opt = document.createElement('div');
        opt.className = 'custom-dropdown-option' + (options[i].value === (selected || '') ? ' selected' : '');
        opt.setAttribute('data-value', options[i].value);
        opt.textContent = options[i].label;
        menu.appendChild(opt);
        if (options[i].value === (selected || '')) selectedLabel = options[i].label;
    }
    if (!selectedLabel && options.length > 0) selectedLabel = options[0].label;
    label.textContent = selectedLabel;
    wrap.setAttribute('data-value', selected || '');
}

// Close dropdowns when clicking outside
document.addEventListener('click', function() {
    document.querySelectorAll('.custom-dropdown.open').forEach(function(d) {
        d.classList.remove('open');
    });
});


// ═══════════════════════════════════════════════════════════════════
// ADMIN USER MANAGEMENT
// ═══════════════════════════════════════════════════════════════════

let _adminUsersCache = [];

function renderAdminUsersLoading() {
    var container = document.getElementById('admin-users-list');
    var countEl = document.getElementById('admin-users-count');
    if (!container) return;
    if (countEl) countEl.textContent = 'Loading...';
    container.innerHTML = '<div class="p-5 rounded-xl border border-white/10 text-sm text-secondary-text" style="background:#1a1d21">Loading users...</div>';
}

function prefetchAdminUsers() {
    var user = getAuthUser();
    if (!user || user.role !== 'admin') return;
    _fetchAdminUsers({ preferCache: true })
        .then(function(users) {
            state.adminUserList = Array.isArray(users) ? users.slice() : [];
            rebuildAdminUserFilterOptions();
        })
        .catch(function() {});
}

async function _fetchAdminUsers(opts) {
    opts = opts || {};
    var now = Date.now();
    var hasCache = Array.isArray(_adminUsersCache) && _adminUsersCache.length > 0;
    var cacheFresh = hasCache && (now - state.adminUsersCacheTs) < 60_000;
    if (opts.preferCache && cacheFresh) {
        return _adminUsersCache;
    }
    if (state.adminUsersPromise) {
        return state.adminUsersPromise;
    }

    const token = getAuthToken();
    state.adminUsersPromise = fetch(CONFIG.API_BASE + '/auth/users', {
        headers: { 'Authorization': 'Bearer ' + token },
    })
    .then(async function(res) {
        if (!res.ok) throw new Error('Failed to load users');
        const data = await res.json();
        _adminUsersCache = Array.isArray(data) ? data : (data.users || []);
        state.adminUserList = _adminUsersCache.slice();
        state.adminUsersCacheTs = Date.now();
        rebuildAdminUserFilterOptions();
        return _adminUsersCache;
    })
    .finally(function() {
        state.adminUsersPromise = null;
    });

    return state.adminUsersPromise;
}

async function loadAdminUsers(opts) {
    opts = opts || {};
    try {
        var force = Boolean(opts.force);
        var hasCache = Array.isArray(_adminUsersCache) && _adminUsersCache.length > 0;
        if (hasCache && !force) {
            renderAdminUsers(_adminUsersCache);
        } else {
            renderAdminUsersLoading();
        }
        const users = await _fetchAdminUsers({ preferCache: !force });
        renderAdminUsers(users);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function renderAdminUsers(users) {
    var container = document.getElementById('admin-users-list');
    var countEl = document.getElementById('admin-users-count');
    if (!container) return;
    if (countEl) countEl.textContent = users.length + ' user' + (users.length !== 1 ? 's' : '');

    var currentUser = getAuthUser();
    var html = '';

    for (var i = 0; i < users.length; i++) {
        var u = users[i];
        var initials = (u.display_name || u.username || '??').slice(0, 2).toUpperCase();
        var avatarHtml = u.avatar
            ? '<img src="' + u.avatar + '" class="w-12 h-12 rounded-full object-cover flex-shrink-0 ring-1 ring-white/10">'
            : '<div class="w-12 h-12 rounded-full flex-shrink-0 bg-gradient-to-br from-emerald-400 via-cyan-500 to-blue-700 text-white text-sm font-bold grid place-items-center ring-1 ring-white/10">' + initials + '</div>';

        var roleBadge = u.role === 'admin'
            ? '<span class="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-primary bg-primary/10 px-2 py-0.5 rounded-full"><span class="material-icons-round" style="font-size:12px">admin_panel_settings</span>Admin</span>'
            : '<span class="text-[11px] font-bold uppercase tracking-wider text-secondary-text bg-white/5 px-2 py-0.5 rounded-full">User</span>';

        var statusBadge = u.is_active
            ? '<span class="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400"><span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>Active</span>'
            : '<span class="inline-flex items-center gap-1 text-[11px] font-medium text-red-400"><span class="w-1.5 h-1.5 rounded-full bg-red-400"></span>Inactive</span>';

        var lastLogin = u.last_login ? new Date(u.last_login).toLocaleDateString() + ' ' + new Date(u.last_login).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) : 'Never';
        var created = u.created_at ? new Date(u.created_at).toLocaleDateString() : '-';

        var isSelf = currentUser && currentUser.id === u.id;

        var extraBtns = '';
        if (!isSelf) {
            var toggleColor = u.is_active ? 'red' : 'emerald';
            var toggleTitle = u.is_active ? 'Deactivate' : 'Activate';
            var toggleIcon = u.is_active ? 'person_off' : 'person';
            extraBtns = '<button data-action="toggle-active" data-uid="' + u.id + '" data-uname="' + u.username + '" data-active="' + u.is_active + '" class="p-2 rounded-lg hover:bg-white/10 text-secondary-text hover:text-' + toggleColor + '-400 transition-colors cursor-pointer" title="' + toggleTitle + '"><span class="material-icons-round text-lg">' + toggleIcon + '</span></button>' +
                '<button data-action="delete-user" data-uid="' + u.id + '" data-uname="' + u.username + '" class="p-2 rounded-lg hover:bg-white/10 text-secondary-text hover:text-red-500 transition-colors cursor-pointer" title="Delete user permanently"><span class="material-icons-round text-lg">delete_forever</span></button>';
        }

        html += '<div class="p-5 rounded-xl border border-white/10 hover:border-white/20 transition-colors" style="background:#1a1d21">' +
            '<div class="flex items-center gap-4">' +
                avatarHtml +
                '<div class="flex-1 min-w-0">' +
                    '<div class="flex items-center gap-2 mb-0.5 flex-wrap">' +
                        '<span class="font-semibold text-white truncate">' + (u.display_name || u.username) + '</span>' +
                        roleBadge +
                        statusBadge +
                        (isSelf ? '<span class="text-[11px] text-secondary-text">(you)</span>' : '') +
                    '</div>' +
                    '<div class="text-sm text-secondary-text truncate">@' + u.username + '</div>' +
                    '<div class="text-xs text-secondary-text mt-1">Joined ' + created + ' &middot; Last login: ' + lastLogin + '</div>' +
                '</div>' +
                '<div class="flex items-center gap-2 flex-shrink-0">' +
                    '<button data-action="edit-user" data-uid="' + u.id + '" class="p-2 rounded-lg hover:bg-white/10 text-secondary-text hover:text-white transition-colors cursor-pointer" title="Edit user"><span class="material-icons-round text-lg">edit</span></button>' +
                    '<button data-action="reset-pw" data-uid="' + u.id + '" data-uname="' + u.username + '" class="p-2 rounded-lg hover:bg-white/10 text-secondary-text hover:text-white transition-colors cursor-pointer" title="Reset password"><span class="material-icons-round text-lg">lock_reset</span></button>' +
                    extraBtns +
                '</div>' +
            '</div>' +
        '</div>';
    }
    container.innerHTML = html;
}

function openAdminEditModal(userId) {
    var user = _adminUsersCache.find(function(u) { return u.id === userId; });
    if (!user) { loadAdminUsers(); return; }

    document.getElementById('admin-edit-user-id').value = user.id;
    document.getElementById('admin-edit-username').value = user.username;
    document.getElementById('admin-edit-displayname').value = user.display_name || '';
    // Create or update role dropdown
    var roleWrap = document.getElementById('admin-edit-role-wrap');
    if (roleWrap) {
        var existingRoleDD = document.getElementById('admin-edit-role-dropdown');
        if (existingRoleDD) {
            updateCustomDropdownOptions('admin-edit-role-dropdown', [{value:'user',label:'User'},{value:'admin',label:'Admin'}], user.role);
        } else {
            var roleDD = createCustomDropdown({
                id: 'admin-edit-role',
                options: [{value:'user',label:'User'},{value:'admin',label:'Admin'}],
                selected: user.role
            });
            roleWrap.innerHTML = '';
            roleWrap.appendChild(roleDD);
        }
    }
    document.getElementById('admin-edit-status').style.display = 'none';

    var modal = document.getElementById('admin-edit-modal');
    if (modal) modal.classList.add('open');
}

function openAdminCreateModal() {
    document.getElementById('admin-create-username').value = '';
    document.getElementById('admin-create-displayname').value = '';
    document.getElementById('admin-create-password').value = '';

    var roleWrap = document.getElementById('admin-create-role-wrap');
    if (roleWrap) {
        var existingRoleDD = document.getElementById('admin-create-role-dropdown');
        if (existingRoleDD) {
            updateCustomDropdownOptions('admin-create-role-dropdown', [{value:'user',label:'User'},{value:'admin',label:'Admin'}], 'user');
        } else {
            var roleDD = createCustomDropdown({
                id: 'admin-create-role',
                cssClass: 'dropdown-modal',
                options: [{value:'user',label:'User'},{value:'admin',label:'Admin'}],
                selected: 'user'
            });
            roleWrap.innerHTML = '';
            roleWrap.appendChild(roleDD);
        }
    }

    var statusEl = document.getElementById('admin-create-status');
    statusEl.style.display = 'none';
    statusEl.textContent = '';

    var modal = document.getElementById('admin-create-modal');
    if (modal) modal.classList.add('open');
}

function closeAdminCreateModal() {
    var modal = document.getElementById('admin-create-modal');
    if (modal) modal.classList.remove('open');
}

function closeAdminEditModal() {
    var modal = document.getElementById('admin-edit-modal');
    if (modal) modal.classList.remove('open');
}

async function submitAdminCreateUser() {
    var username = document.getElementById('admin-create-username').value.trim();
    var displayName = document.getElementById('admin-create-displayname').value.trim();
    var password = document.getElementById('admin-create-password').value;
    var roleDD = document.getElementById('admin-create-role-dropdown');
    var role = roleDD ? roleDD.getAttribute('data-value') : 'user';
    var statusEl = document.getElementById('admin-create-status');

    statusEl.style.display = 'none';
    statusEl.textContent = '';

    if (!username || !password) {
        statusEl.textContent = 'Username and password are required';
        statusEl.style.display = '';
        statusEl.style.color = '#ef4444';
        return;
    }

    try {
        var token = getAuthToken();
        var res = await fetch(CONFIG.API_BASE + '/auth/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({
                username: username,
                password: password,
                display_name: displayName || null,
                role: role || 'user',
            }),
        });
        var data = await res.json().catch(function() { return {}; });
        if (!res.ok) throw new Error(data.detail || 'Failed to create user');

        showToast('User ' + username + ' created', 'success');
        closeAdminCreateModal();
        await loadAdminUsers({ force: true });
        var filterWrap = document.getElementById('admin-user-filter-wrap');
        if (filterWrap) filterWrap.remove();
        await setupAdminUserFilter();
    } catch (err) {
        statusEl.textContent = err.message;
        statusEl.style.display = '';
        statusEl.style.color = '#ef4444';
    }
}

async function saveAdminEditUser() {
    var userId = document.getElementById('admin-edit-user-id').value;
    var displayName = document.getElementById('admin-edit-displayname').value.trim();
    var roleDD = document.getElementById('admin-edit-role-dropdown');
    var role = roleDD ? roleDD.getAttribute('data-value') : 'user';
    var statusEl = document.getElementById('admin-edit-status');

    try {
        var token = getAuthToken();
        var res = await fetch(CONFIG.API_BASE + '/auth/users/' + userId, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ display_name: displayName || null, role: role }),
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Failed to update user');

        showToast('User updated!', 'success');
        closeAdminEditModal();
        await loadAdminUsers({ force: true });
        var filterWrap = document.getElementById('admin-user-filter-wrap');
        if (filterWrap) filterWrap.remove();
        await setupAdminUserFilter();
    } catch (err) {
        statusEl.textContent = err.message;
        statusEl.style.display = '';
        statusEl.style.color = '#ef4444';
        setTimeout(function() { statusEl.style.display = 'none'; }, 5000);
    }
}

function openAdminPwModal(userId, username) {
    document.getElementById('admin-pw-user-id').value = userId;
    document.getElementById('admin-pw-username').textContent = username;
    document.getElementById('admin-pw-new').value = '';
    document.getElementById('admin-pw-status').style.display = 'none';

    var modal = document.getElementById('admin-pw-modal');
    if (modal) modal.classList.add('open');
}

function closeAdminPwModal() {
    var modal = document.getElementById('admin-pw-modal');
    if (modal) modal.classList.remove('open');
}

async function submitAdminResetPassword() {
    var userId = document.getElementById('admin-pw-user-id').value;
    var newPw = document.getElementById('admin-pw-new').value;
    var statusEl = document.getElementById('admin-pw-status');

    if (!newPw || newPw.length < 4) {
        statusEl.textContent = 'Password must be at least 4 characters';
        statusEl.style.display = '';
        statusEl.style.color = '#ef4444';
        return;
    }

    try {
        var token = getAuthToken();
        var res = await fetch(CONFIG.API_BASE + '/auth/users/' + userId + '/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ new_password: newPw }),
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Failed to reset password');

        showToast('Password reset successfully!', 'success');
        closeAdminPwModal();
    } catch (err) {
        statusEl.textContent = err.message;
        statusEl.style.display = '';
        statusEl.style.color = '#ef4444';
        setTimeout(function() { statusEl.style.display = 'none'; }, 5000);
    }
}

async function adminToggleActive(userId, username, isCurrentlyActive) {
    var action = isCurrentlyActive ? 'deactivate' : 'activate';
    if (!confirm('Are you sure you want to ' + action + ' user "' + username + '"?')) return;

    try {
        var token = getAuthToken();
        var res = await fetch(CONFIG.API_BASE + '/auth/users/' + userId, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ is_active: !isCurrentlyActive }),
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Failed');
        showToast('User ' + action + 'd!', 'success');
        await loadAdminUsers({ force: true });
    } catch (err) {
        showToast(err.message, 'error');
    }
}


async function adminDeleteUser(userId, username) {
    if (!confirm('WARNING: This will permanently delete user "' + username + '" and ALL their data (links, groups, crawl jobs).\n\nThis action CANNOT be undone. Continue?')) return;
    if (!confirm('Are you REALLY sure? Type OK to confirm you want to delete "' + username + '" permanently.')) return;

    try {
        var token = getAuthToken();
        var res = await fetch(CONFIG.API_BASE + '/auth/users/' + userId, {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + token },
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Failed to delete user');
        showToast('User ' + username + ' deleted permanently', 'success');
        await loadAdminUsers({ force: true });
        var filterWrap = document.getElementById('admin-user-filter-wrap');
        if (filterWrap) filterWrap.remove();
        await setupAdminUserFilter();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// Expose to window for inline onclick handlers
window.openAdminEditModal = openAdminEditModal;
window.openAdminCreateModal = openAdminCreateModal;
window.closeAdminCreateModal = closeAdminCreateModal;
window.closeAdminEditModal = closeAdminEditModal;
window.submitAdminCreateUser = submitAdminCreateUser;
window.saveAdminEditUser = saveAdminEditUser;
window.openAdminPwModal = openAdminPwModal;
window.closeAdminPwModal = closeAdminPwModal;
window.submitAdminResetPassword = submitAdminResetPassword;
window.adminToggleActive = adminToggleActive;
window.adminDeleteUser = adminDeleteUser;
window.showAdminUsers = showAdminUsers;
window.hideAdminUsers = hideAdminUsers;


// ═══════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
    if (!requireAuth()) return;
    setupAuthUI();
    await hydrateUiPreferencesFromServer();
    state.columnWidths = loadPersistedColumnWidths();
    applyColumnWidths(state.columnWidths);
    setupColumnResizers();
    syncColumnWidthsToViewport();
    window.addEventListener('resize', () => syncColumnWidthsToViewport());

    state.customGroups = loadCustomGroups();
    syncGroupUI(true);

    // Modal
    document.getElementById('btn-add-link').addEventListener('click', openModal);
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-submit').addEventListener('click', submitSingle);
    document.getElementById('add-link-modal').addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) closeModal();
    });
    ['admin-edit-modal', 'admin-pw-modal', 'admin-create-modal'].forEach((modalId) => {
        const modalEl = document.getElementById(modalId);
        if (!modalEl) return;
        modalEl.addEventListener('click', (e) => {
            if (!e.target.classList.contains('modal-overlay')) return;
            if (modalId === 'admin-edit-modal') closeAdminEditModal();
            if (modalId === 'admin-pw-modal') closeAdminPwModal();
            if (modalId === 'admin-create-modal') closeAdminCreateModal();
        });
    });

    // Batch toggle
    document.getElementById('modal-batch-toggle').addEventListener('click', () => {
        document.getElementById('modal-batch-area').classList.toggle('hidden');
    });
    document.getElementById('modal-batch-submit').addEventListener('click', submitBatch);

    // Search
    document.getElementById('search-input').addEventListener('input', (e) => {
        handleSearch(e.target.value);
    });
    const adminCreateBtn = document.getElementById('admin-users-create-btn');
    if (adminCreateBtn) {
        adminCreateBtn.addEventListener('click', openAdminCreateModal);
    }
    const groupSearchInput = document.getElementById('group-search');
    if (groupSearchInput) {
        groupSearchInput.addEventListener('input', (e) => {
            state.groupSearchQuery = e.target.value || '';
            renderGroups();
        });
    }
    const groupList = document.getElementById('group-list');
    if (groupList) {
        groupList.addEventListener('click', (e) => {
            const deleteGroupBtn = e.target.closest('[data-action="delete-group"]');
            const saveRenameBtn = e.target.closest('[data-action="save-rename-group"]');
            const cancelRenameBtn = e.target.closest('[data-action="cancel-rename-group"]');
            const groupBtn = e.target.closest('[data-group]');
            const newGroupBtn = e.target.closest('[data-action="new-group"]');
            const createGroupBtn = e.target.closest('[data-action="create-group"]');
            const cancelCreateBtn = e.target.closest('[data-action="cancel-create-group"]');
            if (deleteGroupBtn) {
                e.preventDefault();
                e.stopPropagation();
                handleDeleteGroup(deleteGroupBtn.getAttribute('data-group-id'));
                return;
            }
            if (saveRenameBtn) {
                e.preventDefault();
                e.stopPropagation();
                const groupId = saveRenameBtn.getAttribute('data-group-id');
                const selectorGroupId = escapeAttrSelectorValue(groupId || '');
                const input = groupList.querySelector(`[data-role="rename-group-input"][data-group-id="${selectorGroupId}"]`);
                handleRenameGroup(groupId, input?.value || '');
                return;
            }
            if (cancelRenameBtn) {
                e.preventDefault();
                e.stopPropagation();
                cancelRenameGroupFlow();
                return;
            }
            if (createGroupBtn) {
                const input = groupList.querySelector('[data-role="new-group-input"]');
                handleCreateGroup(input?.value);
                return;
            }
            if (cancelCreateBtn) {
                cancelCreateGroupFlow();
                return;
            }
            if (newGroupBtn) {
                startCreateGroupFlow();
                return;
            }
            if (e.target.closest('[data-role="rename-group-input"]')) return;
            if (!groupBtn) return;
            if (state.suppressNextGroupClick) {
                state.suppressNextGroupClick = false;
                return;
            }
            if (state.renamingGroupId) return;
            const groupId = normalizeGroupName(groupBtn.getAttribute('data-group')) || ALL_GROUP_ID;
            const currentGroupId = normalizeGroupName(state.activeGroup) || ALL_GROUP_ID;
            if (groupId.toLowerCase() === currentGroupId.toLowerCase()) {
                state.isCreatingGroup = false;
                return;
            }
            state.activeGroup = groupId;
            state.isCreatingGroup = false;
            clearRowSelection();
            // If currently on Settings or Users tab, navigate back to Link Checker
            if (state.currentView !== 'linkchecker') {
                switchToView('linkchecker');
            } else {
                updateGroupHeader();
                renderGroups();
                renderList();
            }
        });
        groupList.addEventListener('dblclick', (e) => {
            const groupName = e.target.closest('[data-role="group-name"]');
            if (!groupName) return;
            const groupId = normalizeGroupName(groupName.getAttribute('data-group-id'));
            if (!groupId || groupId.toLowerCase() === ALL_GROUP_ID) return;
            const currentGroupId = normalizeGroupName(state.activeGroup) || ALL_GROUP_ID;
            if (groupId.toLowerCase() !== currentGroupId.toLowerCase()) return;
            e.preventDefault();
            e.stopPropagation();
            startRenameGroupFlow(groupId);
        });
        groupList.addEventListener('keydown', (e) => {
            const renameInput = e.target.closest('[data-role="rename-group-input"]');
            if (renameInput) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    handleRenameGroup(renameInput.getAttribute('data-group-id'), renameInput.value);
                    return;
                }
                if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelRenameGroupFlow();
                    return;
                }
            }

            if (e.key !== 'Enter') return;
            const input = e.target.closest('[data-role="new-group-input"]');
            if (!input) return;
            e.preventDefault();
            handleCreateGroup(input.value);
        });
        groupList.addEventListener('focusout', (e) => {
            const renameInput = e.target.closest('[data-role="rename-group-input"]');
            if (!renameInput || !state.renamingGroupId) return;
            const related = e.relatedTarget;
            if (related && related.closest('[data-action="save-rename-group"], [data-action="cancel-rename-group"]')) {
                return;
            }
            handleRenameGroup(renameInput.getAttribute('data-group-id'), renameInput.value, { onBlur: true });
        });
        groupList.addEventListener('dragstart', (e) => {
            const groupBtn = e.target.closest('[data-group][draggable="true"]');
            if (!groupBtn || e.target.closest('[data-action="delete-group"], [data-role="rename-group-input"]')) {
                e.preventDefault();
                return;
            }
            const groupId = normalizeGroupName(groupBtn.getAttribute('data-group'));
            if (!groupId || groupId.toLowerCase() === ALL_GROUP_ID) {
                e.preventDefault();
                return;
            }
            state.draggingGroupId = groupId;
            state.dragOverGroupId = groupId;
            state.dragOverGroupPlacement = 'before';
            state.suppressNextGroupClick = true;
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', groupId);
            }
            syncGroupDragUi(groupList);
        });
        groupList.addEventListener('dragover', (e) => {
            const groupBtn = e.target.closest('[data-group]');
            if (!state.draggingGroupId) return;
            updateDragAutoScroll(groupList, e.clientY);
            if (!groupBtn) return;
            const targetGroupId = normalizeGroupName(groupBtn.getAttribute('data-group'));
            if (!targetGroupId) return;
            if (targetGroupId.toLowerCase() === ALL_GROUP_ID) return;
            e.preventDefault();
            const rect = groupBtn.getBoundingClientRect();
            const placement = e.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
            if (targetGroupId === state.dragOverGroupId && placement === state.dragOverGroupPlacement) return;
            state.dragOverGroupId = targetGroupId;
            state.dragOverGroupPlacement = placement;
            syncGroupDragUi(groupList);
        });
        groupList.addEventListener('drop', (e) => {
            const groupBtn = e.target.closest('[data-group]');
            if (!groupBtn || !state.draggingGroupId) return;
            e.preventDefault();
            stopDragAutoScroll();
            const targetGroupId = normalizeGroupName(groupBtn.getAttribute('data-group'));
            const moved = moveCustomGroupBefore(state.draggingGroupId, targetGroupId, state.dragOverGroupPlacement);
            state.draggingGroupId = null;
            state.dragOverGroupId = null;
            state.dragOverGroupPlacement = 'before';
            rebuildGroups();
            renderGroups();
            if (moved) {
                showToast('Group order updated', 'success');
            }
            window.setTimeout(() => {
                state.suppressNextGroupClick = false;
            }, 0);
        });
        groupList.addEventListener('dragend', () => {
            if (!state.draggingGroupId && !state.dragOverGroupId) return;
            stopDragAutoScroll();
            state.draggingGroupId = null;
            state.dragOverGroupId = null;
            state.dragOverGroupPlacement = 'before';
            syncGroupDragUi(groupList);
            window.setTimeout(() => {
                state.suppressNextGroupClick = false;
            }, 0);
        });
        groupList.addEventListener('dragleave', (e) => {
            if (!state.draggingGroupId) return;
            if (e.currentTarget.contains(e.relatedTarget)) return;
            stopDragAutoScroll();
        });
    }

    // Refresh/Clear fallback binding (skip when inline onclick exists)
    const refreshBtn = document.getElementById('btn-refresh');
    if (refreshBtn && !refreshBtn.getAttribute('onclick')) {
        refreshBtn.addEventListener('click', refreshAllItems);
    }

    const clearBtn = document.getElementById('btn-clear-list');
    if (clearBtn && !clearBtn.getAttribute('onclick')) {
        clearBtn.addEventListener('click', clearList);
    }

    const listElForDelete = document.getElementById('link-list');
    if (listElForDelete) {
        const listScrollWrap = document.querySelector('.list-wrap');
        listElForDelete.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            if (isInteractiveRowTarget(e.target)) return;
            const row = e.target.closest('.custom-grid-row');
            if (!row) return;
            const rowKey = row.dataset.itemKey;
            const keepMultiSelection =
                !e.shiftKey
                && !e.ctrlKey
                && !e.metaKey
                && state.selectedItemKeys.size > 1
                && state.selectedItemKeys.has(rowKey);
            if (keepMultiSelection) return;
            const item = state.items.find((i) =>
                String(i.id) === String(row.dataset.itemId)
                || (i.type === row.dataset.type && i.spotify_id === row.dataset.spotifyId)
            );
            if (!item) return;
            handleRowSelection(item, e);
        });
        listElForDelete.addEventListener('click', (e) => {
            const btn = e.target.closest('.row-delete-btn');
            const refreshBtn = e.target.closest('.row-refresh-btn');
            const copyBtn = e.target.closest('[data-action="copy-link"]');
            const previewBtn = e.target.closest('[data-action="preview-image"]');
            if (copyBtn) {
                e.preventDefault();
                e.stopPropagation();
                copyToClipboard(copyBtn.getAttribute('data-copy-value'), 'Link copied');
                return;
            }
            if (previewBtn) {
                e.preventDefault();
                e.stopPropagation();
                openImagePreview(previewBtn.getAttribute('data-image-url'));
                return;
            }
            const row = e.target.closest('.custom-grid-row');
            if (!row) return;
            if (!btn && !refreshBtn) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            const item = state.items.find((i) =>
                String(i.id) === String(row.dataset.itemId)
                || (i.type === row.dataset.type && i.spotify_id === row.dataset.spotifyId)
            );
            if (!item) return;
            if (btn) {
                handleDeleteItem(item);
            } else if (refreshBtn) {
                handleRefreshItem(item);
            }
        });
        listElForDelete.addEventListener('dragstart', (e) => {
            const row = e.target.closest('.custom-grid-row');
            if (!row || isInteractiveRowTarget(e.target)) {
                e.preventDefault();
                return;
            }
            const draggedKey = row.dataset.itemKey;
            const selectedKeys = state.selectedItemKeys.has(draggedKey)
                ? state.filteredItems.map((item) => itemKey(item)).filter((key) => state.selectedItemKeys.has(key))
                : [draggedKey];
            state.draggingRowKeys = selectedKeys;
            state.dragOverRowKey = draggedKey;
            state.dragOverRowPlacement = 'before';
            state.suppressNextRowClick = true;
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', draggedKey);
            }
            syncRowDragUi(listElForDelete);
        });
        listElForDelete.addEventListener('dragover', (e) => {
            const row = e.target.closest('.custom-grid-row');
            if (!state.draggingRowKeys.length) return;
            updateDragAutoScroll(listScrollWrap, e.clientY);
            if (!row) return;
            const targetKey = row.dataset.itemKey;
            if (!targetKey) return;
            e.preventDefault();
            const rect = row.getBoundingClientRect();
            const placement = e.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
            if (targetKey === state.dragOverRowKey && placement === state.dragOverRowPlacement) return;
            state.dragOverRowKey = targetKey;
            state.dragOverRowPlacement = placement;
            syncRowDragUi(listElForDelete);
        });
        listElForDelete.addEventListener('drop', (e) => {
            const row = e.target.closest('.custom-grid-row');
            if (!row || !state.draggingRowKeys.length) return;
            e.preventDefault();
            stopDragAutoScroll();
            const moved = moveItemsByKeys(state.draggingRowKeys, row.dataset.itemKey, state.dragOverRowPlacement);
            state.draggingRowKeys = [];
            state.dragOverRowKey = null;
            state.dragOverRowPlacement = 'before';
            renderList({ preserveScroll: true });
            if (moved) {
                showToast('Row order updated', 'success');
            }
            window.setTimeout(() => {
                state.suppressNextRowClick = false;
            }, 0);
        });
        listElForDelete.addEventListener('dragend', () => {
            if (!state.draggingRowKeys.length && !state.dragOverRowKey) return;
            stopDragAutoScroll();
            state.draggingRowKeys = [];
            state.dragOverRowKey = null;
            state.dragOverRowPlacement = 'before';
            syncRowDragUi(listElForDelete);
            window.setTimeout(() => {
                state.suppressNextRowClick = false;
            }, 0);
        });
        if (listScrollWrap) {
            listScrollWrap.addEventListener('dragover', (e) => {
                if (!state.draggingRowKeys.length) return;
                e.preventDefault();
                updateDragAutoScroll(listScrollWrap, e.clientY);
            });
            listScrollWrap.addEventListener('dragleave', (e) => {
                if (!state.draggingRowKeys.length) return;
                if (e.currentTarget.contains(e.relatedTarget)) return;
                stopDragAutoScroll();
            });
            listScrollWrap.addEventListener('drop', () => {
                stopDragAutoScroll();
            });
        }
    }

    const imagePreviewModal = document.getElementById('image-preview-modal');
    if (imagePreviewModal) {
        imagePreviewModal.addEventListener('click', (e) => {
            if (!e.target.closest('#image-preview-img') || e.target.closest('#image-preview-close')) {
                closeImagePreview();
            }
        });
    }


    // Settings nav
    document.getElementById('nav-settings').addEventListener('click', (e) => {
        e.preventDefault();
        switchToView('settings');
    });

    document.getElementById('nav-links').addEventListener('click', (e) => {
        e.preventDefault();
        switchToView('linkchecker');
    });

    // Users nav (admin)
    const navUsersEl = document.getElementById('nav-users');
    if (navUsersEl) {
        navUsersEl.addEventListener('click', function(e) {
            e.preventDefault();
            switchToView('users');
        });
    }

    // Settings event listeners
    document.getElementById('settings-save-profile')?.addEventListener('click', handleSaveProfile);
    document.getElementById('settings-change-pw')?.addEventListener('click', handleChangePassword);
    document.getElementById('settings-avatar-input')?.addEventListener('change', (e) => {
        if (e.target.files[0]) handleAvatarUpload(e.target.files[0]);
    });
    document.getElementById('settings-avatar-remove')?.addEventListener('click', handleAvatarRemove);

    // Admin modal click-outside-to-close
    ['admin-edit-modal', 'admin-pw-modal'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('click', function(e) {
            if (e.target.classList.contains('modal-overlay')) {
                el.classList.remove('open');
            }
        });
    });

    // Admin users list event delegation
    var adminList = document.getElementById('admin-users-list');
    if (adminList) {
        adminList.addEventListener('click', function(e) {
            var btn = e.target.closest('[data-action]');
            if (!btn) return;
            e.preventDefault();
            e.stopPropagation();
            var action = btn.getAttribute('data-action');
            var uid = btn.getAttribute('data-uid');
            var uname = btn.getAttribute('data-uname');
            if (action === 'edit-user') {
                openAdminEditModal(uid);
            } else if (action === 'reset-pw') {
                openAdminPwModal(uid, uname);
            } else if (action === 'toggle-active') {
                var isActive = btn.getAttribute('data-active') === 'true';
                adminToggleActive(uid, uname, isActive);
            } else if (action === 'delete-user') {
                adminDeleteUser(uid, uname);
            }
        });
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal();
            closeImagePreview();
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            document.getElementById('search-input').focus();
        }
    });

    // Sticky header
    initStickyHeader();

    // Initial data load
    loadData().then(() => {
        // Update hero image after data is rendered
        setTimeout(updateHeroImage, 100);
        // Sync groups from server
        syncGroupsFromServer(state.adminFilterUserId || null);
        // Keep remote updates (from other users/tabs) in sync without manual refresh.
        startBackgroundSync();
    });

    // Keep "Checked" relative times live without page reload.
    setInterval(refreshCheckedLabels, 30_000);

    // MutationObserver to update hero when list changes
    const listEl = document.getElementById('link-list');
    if (listEl) {
        const obs = new MutationObserver(() => setTimeout(updateHeroImage, 50));
        obs.observe(listEl, { childList: true });
    }
});

// Fallback hooks for inline onclick handlers
window.clearList = clearList;
window.refreshAllItems = refreshAllItems;

