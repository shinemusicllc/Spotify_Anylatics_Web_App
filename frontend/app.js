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
};
const GROUP_STORAGE_KEY = 'spoticheck_custom_groups_v1';
const ALL_GROUP_ID = 'all';
const ALL_GROUP_LABEL = 'All Links';
const GROUP_SELECT_ALL = '__all__';

function getUserGroupStorageKey() {
    const user = getAuthUser();
    const userId = user?.id || 'anonymous';
    return `spoticheck_custom_groups_v1_${userId}`;
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
            profileWrap.innerHTML = '<div class="w-8 h-8 rounded-full flex-shrink-0 bg-gradient-to-br from-emerald-400 via-cyan-500 to-blue-700 text-white text-[11px] font-bold leading-none grid place-items-center overflow-hidden ring-1 ring-white/10">' + initials + '</div>' +
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
        logoutBtn.className = 'w-full flex items-center gap-3 px-5 py-2 text-secondary-text hover:text-white transition-colors cursor-pointer';
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

    crawl(url, group = null) {
        return this._fetch('/crawl', {
            method: 'POST',
            body: JSON.stringify({ url, group }),
        });
    }

    crawlBatch(urls, group = null) {
        return this._fetch('/crawl/batch', {
            method: 'POST',
            body: JSON.stringify({ urls, group }),
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

function escapeAttrSelectorValue(value) {
    const input = String(value || '');
    if (window.CSS && typeof window.CSS.escape === 'function') {
        return window.CSS.escape(input);
    }
    return input.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function loadCustomGroups() {
    try {
        const raw = localStorage.getItem(getUserGroupStorageKey());
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return [];
        return parsed
            .map(normalizeGroupName)
            .filter(Boolean);
    } catch {
        return [];
    }
}

function saveCustomGroups() {
    const cleaned = Array.from(new Set(
        (state.customGroups || [])
            .map(normalizeGroupName)
            .filter(Boolean)
    ));
    state.customGroups = cleaned;
    localStorage.setItem(getUserGroupStorageKey(), JSON.stringify(cleaned));
}

function getActiveGroupName() {
    if (state.activeGroup === ALL_GROUP_ID) return ALL_GROUP_LABEL;
    const match = state.groups.find((g) => g.id === state.activeGroup);
    return match?.name || state.activeGroup;
}

function updateGroupHeader() {
    const name = getActiveGroupName();
    const breadcrumb = document.getElementById('breadcrumb-group');
    const pageTitle = document.getElementById('page-title');
    if (breadcrumb) breadcrumb.textContent = name;
    if (pageTitle) pageTitle.textContent = name;
}

function rebuildGroups() {
    const counts = new Map();
    for (const item of state.items) {
        const group = normalizeGroupName(item.group);
        if (!group) continue;
        if (group.toLowerCase() === ALL_GROUP_ID) continue;
        counts.set(group, (counts.get(group) || 0) + 1);
    }

    const groups = [{ id: ALL_GROUP_ID, name: ALL_GROUP_LABEL, count: state.items.length }];
    const namedGroups = [];
    const seen = new Set();
    const pushUnique = (rawName) => {
        const name = normalizeGroupName(rawName);
        if (!name || name.toLowerCase() === ALL_GROUP_ID) return;
        const key = name.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        namedGroups.push(name);
    };

    // Show groups that already contain links first.
    Array.from(counts.keys())
        .sort((a, b) => a.localeCompare(b, 'vi'))
        .forEach(pushUnique);

    // Then append custom empty/user groups; newly created group stays at the bottom.
    (state.customGroups || []).forEach((rawName) => {
        const normalized = normalizeGroupName(rawName);
        if (!normalized) return;
        if (counts.has(normalized)) return;
        pushUnique(normalized);
    });

    // Keep currently-selected group visible even if empty.
    if (state.activeGroup !== ALL_GROUP_ID) {
        pushUnique(state.activeGroup);
    }

    for (const name of namedGroups) {
        groups.push({
            id: name,
            name,
            count: counts.get(name) || 0,
        });
    }

    state.groups = groups;
    if (!state.groups.some((g) => g.id === state.activeGroup)) {
        state.activeGroup = ALL_GROUP_ID;
    }
}

function renderGroups() {
    const container = document.getElementById('group-list');
    if (!container) return;

    const q = state.groupSearchQuery.trim().toLowerCase();
    const groups = state.groups.filter((g) => {
        if (g.id === ALL_GROUP_ID) return true;
        if (!q) return true;
        return g.name.toLowerCase().includes(q);
    });

    const groupButtons = groups.map((g) => {
        const isActive = g.id === state.activeGroup;
        const canDelete = g.id !== ALL_GROUP_ID;
        const isRenaming = Boolean(
            state.renamingGroupId
            && state.renamingGroupId.toLowerCase() === g.id.toLowerCase()
        );
        return `
            <button class="group-item ${canDelete ? 'group-item-has-delete' : ''} w-full flex items-center justify-between px-3 py-3 rounded-lg transition-colors ${isActive ? 'bg-primary/10 text-white' : 'text-secondary-text hover:text-white hover:bg-white/5'}" data-group="${escapeHtml(g.id)}">
                <div class="flex items-center gap-3 min-w-0">
                    <span class="material-icons-round ${isActive ? 'text-primary' : 'text-secondary-text'} text-sm">folder</span>
                    ${isRenaming
                        ? `<input
                            data-role="rename-group-input"
                            data-group-id="${escapeHtml(g.id)}"
                            value="${escapeHtml(g.name)}"
                            class="w-full bg-white/5 border border-primary/50 rounded-lg px-2 py-1 text-[14px] font-semibold text-white focus:outline-none focus:border-primary"
                        >`
                        : `<span class="text-[14px] font-semibold truncate" data-role="group-name" data-group-id="${escapeHtml(g.id)}">${escapeHtml(g.name)}</span>`
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
    const select = document.getElementById('modal-group-select');
    if (!select) return;

    const options = [`<option value="${GROUP_SELECT_ALL}">${ALL_GROUP_LABEL} (Default)</option>`];
    for (const g of state.groups) {
        if (g.id === ALL_GROUP_ID) continue;
        options.push(`<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`);
    }
    select.innerHTML = options.join('');

    select.value = GROUP_SELECT_ALL;
}

function resolveSelectedGroup() {
    const select = document.getElementById('modal-group-select');
    const picked = normalizeGroupName(select?.value);
    if (picked && picked !== GROUP_SELECT_ALL) return picked;
    return null;
}

function handleCreateGroup(rawName) {
    const name = normalizeGroupName(rawName);
    if (!name) return;
    if (name.toLowerCase() === ALL_GROUP_ID) {
        showToast('"All Links" is reserved', 'error');
        return;
    }

    const existing = state.groups.find((g) => g.id.toLowerCase() === name.toLowerCase());
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
    state.activeGroup = name;
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
    const groupName = target?.name || groupId;
    const confirmed = window.confirm(`Delete group "${groupName}"?\nAll links in this group will move to All Links.`);
    if (!confirmed) return;

    const groupKey = groupId.toLowerCase();
    state.customGroups = (state.customGroups || []).filter((name) => {
        const normalized = normalizeGroupName(name);
        return normalized && normalized.toLowerCase() !== groupKey;
    });
    saveCustomGroups();

    state.items = state.items.map((item) => {
        const itemGroup = normalizeGroupName(item.group);
        if (!itemGroup || itemGroup.toLowerCase() !== groupKey) return item;
        return { ...item, group: null };
    });

    if ((state.activeGroup || '').toLowerCase() === groupKey) {
        state.activeGroup = ALL_GROUP_ID;
    }
    state.isCreatingGroup = false;
    if ((state.renamingGroupId || '').toLowerCase() === groupKey) {
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

function handleRenameGroup(rawGroupId, rawName, opts = {}) {
    const groupId = normalizeGroupName(rawGroupId);
    if (!groupId || groupId.toLowerCase() === ALL_GROUP_ID) return;

    const target = state.groups.find((g) => normalizeGroupName(g.id).toLowerCase() === groupId.toLowerCase());
    if (!target) {
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

    const oldKey = target.id.toLowerCase();
    const sameByCaseInsensitive = nextName.toLowerCase() === oldKey;
    const duplicate = state.groups.find((g) => (
        normalizeGroupName(g.id).toLowerCase() === nextName.toLowerCase()
        && normalizeGroupName(g.id).toLowerCase() !== oldKey
    ));
    if (duplicate) {
        showToast(`Group "${duplicate.name}" already exists`, 'error');
        return;
    }

    if (!sameByCaseInsensitive || nextName !== target.id) {
        state.customGroups = (state.customGroups || []).map((raw) => {
            const n = normalizeGroupName(raw);
            if (n.toLowerCase() !== oldKey) return n;
            return nextName;
        });
        saveCustomGroups();

        state.items = state.items.map((item) => {
            const itemGroup = normalizeGroupName(item.group);
            if (itemGroup.toLowerCase() !== oldKey) return item;
            return { ...item, group: nextName };
        });

        if (normalizeGroupName(state.activeGroup).toLowerCase() === oldKey) {
            state.activeGroup = nextName;
        }
    }

    state.renamingGroupId = null;
    syncGroupUI(true);
    renderList({ preserveScroll: true });
    if (!sameByCaseInsensitive || nextName !== target.id) {
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
    const spotifyUrl = getSpotifyUrl(item.type, item.spotify_id);
    const checkedAt = item.last_checked || item.created_at || '';
    const updatedAt = formatUpdatedAt(checkedAt);

    // Owner / Artist display
    const ownerHtml = item.owner_image
        ? `<img alt="Owner" class="list-owner-avatar" src="${item.owner_image}">`
        : `<div class="list-owner-avatar list-owner-fallback">${(item.owner_name || '?').slice(0, 2).toUpperCase()}</div>`;

    const row = document.createElement('div');
    row.className = 'custom-grid-row px-4 py-3 bg-white/5 rounded-lg border border-transparent hover:bg-row-hover hover:border-white/10 transition-all group';
    row.dataset.spotifyUrl = spotifyUrl;
    row.dataset.itemId = item.id;
    row.dataset.type = item.type;
    row.dataset.spotifyId = item.spotify_id;

    // Click → open popup window
    row.addEventListener('click', (e) => {
        // Ignore clicks on row actions (delete, etc.)
        if (e.target.closest('.row-delete-btn') || e.target.closest('.row-refresh-btn')) return;
        // Don't open if user is selecting text
        if (window.getSelection().toString()) return;
        openSpotifyPopup(spotifyUrl);
    });

    row.innerHTML = `
        <!-- Left: Asset Details -->
        <div class="flex items-center gap-4">
            <img alt="Cover" class="list-cover-image" src="${item.image || `https://picsum.photos/seed/${item.spotify_id}/128/128`}">
            <div>
                <span class="list-type-badge ${isError ? 'badge-error' : getBadgeClass(item.type)}">${item.type}</span>
                <h3 class="list-asset-title ${isError ? 'text-white/80' : ''}">${escapeHtml(item.name || 'Unknown')}</h3>
                ${isError
                    ? `<p class="list-asset-error text-red-400 font-medium flex items-center gap-1"><span class="material-icons-round list-error-icon">warning</span> Error ${item.error_code}: ${item.error_message || 'Unknown error'}</p>`
                    : `<p class="list-asset-uri text-secondary-text">spotify:${item.type}:${item.spotify_id}</p>`
                }
            </div>
        </div>
        <!-- Right: Metadata -->
        <div class="meta-grid w-full">
            <div class="flex items-center gap-3 meta-cell">
                ${ownerHtml}
                <div class="list-owner-meta">
                    <div class="list-owner-name">${escapeHtml(item.owner_name || '-')}</div>
                    <div class="list-owner-time text-secondary-text">${updatedAt}</div>
                </div>
            </div>
            <div class="list-stats-cell text-secondary-text meta-cell">
                ${getStatIcons(item)}
            </div>
            <div class="list-metric-value text-secondary-text meta-cell">${getMetric1(item)}</div>
            <div class="list-metric-value text-secondary-text meta-cell">${getMetric2(item)}</div>
            <div class="flex items-center gap-2 meta-cell">
                <span class="status-dot ${status.dot}"></span>
                <span class="list-status-label ${status.color} truncate">${status.label}</span>
            </div>
            <div class="meta-cell text-right row-action-cell">
                <span class="list-checked-text text-secondary-text row-checked" data-checked-at="${escapeHtml(checkedAt)}">${timeAgo(checkedAt)}</span>
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
    const listWrap = document.querySelector('.list-wrap');
    const prevScrollTop = preserveScroll && listWrap ? listWrap.scrollTop : null;
    const restoreScroll = () => {
        if (prevScrollTop == null || !listWrap) return;
        requestAnimationFrame(() => {
            listWrap.scrollTop = prevScrollTop;
        });
    };
    syncGroupUI();

    // Filter items
    let items = state.items;

    // Group filter
    if (state.activeGroup !== ALL_GROUP_ID) {
        items = items.filter(i => i.group === state.activeGroup);
    }

    // Search filter
    if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase();
        items = items.filter(i =>
            (i.name || '').toLowerCase().includes(q) ||
            (i.owner_name || '').toLowerCase().includes(q) ||
            (i.spotify_id || '').toLowerCase().includes(q) ||
            (i.type || '').toLowerCase().includes(q)
        );
    }

    state.filteredItems = items;

    // Clear previous rows (keep skeleton & empty state)
    container.querySelectorAll('.custom-grid-row').forEach(el => el.remove());

    if (skeleton) skeleton.style.display = 'none';

    if (items.length === 0 && state.items.length === 0) {
        // No data at all → show empty state
        if (emptyState) emptyState.style.display = '';
        restoreScroll();
        return;
    }

    if (emptyState) emptyState.style.display = 'none';

    if (items.length === 0) {
        // Has data but filtered to zero
        const noResult = document.createElement('div');
        noResult.className = 'custom-grid-row text-center py-12 text-secondary-text';
        const msg = state.searchQuery
            ? `No results for "${escapeHtml(state.searchQuery)}"`
            : `No links in "${escapeHtml(getActiveGroupName())}"`;
        noResult.innerHTML = `<div class="col-span-2">${msg}</div>`;
        container.appendChild(noResult);
        restoreScroll();
        return;
    }

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
    const scoped = state.activeGroup === ALL_GROUP_ID
        ? state.items
        : state.items.filter((i) => i.group === state.activeGroup);
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
// POPUP WINDOW — Open Spotify link in mini window
// ═══════════════════════════════════════════════════════════════════

async function handleDeleteItem(item) {
    if (!item) return;
    const label = item.name || `${item.type}:${item.spotify_id}`;
    state.items = state.items.filter((i) => i.id !== item.id);
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
    const targetItems = state.activeGroup === ALL_GROUP_ID
        ? state.items
        : state.items.filter((i) => i.group === state.activeGroup);

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
        showToast(`Refresh started for ${result.count || urls.length} links`, 'success');
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

    const group = resolveSelectedGroup();

    try {
        const result = await api.crawl(url, group);
        const jobId = result?.job_id;
        if (!jobId) {
            throw new Error('Backend did not return job_id');
        }
        showToast(`Added ${parsed.type}: crawling started`, 'success');

        const now = new Date().toISOString();
        const existingIdx = state.items.findIndex(
            (item) => item.type === parsed.type && item.spotify_id === parsed.id
        );

        if (existingIdx >= 0) {
            state.items[existingIdx] = {
                ...state.items[existingIdx],
                status: 'crawling',
                error_code: null,
                error_message: null,
                last_checked: now,
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
            };
            state.items.unshift(newItem);
            state.pendingJobToItem.set(jobId, newItem.id);
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

    const group = resolveSelectedGroup();

    try {
        const result = await api.crawlBatch(urls, group);
        showToast(`Added ${urls.length} links — crawling started`, 'success');

        const now = new Date().toISOString();
        let mappedJobs = 0;

        // Mark existing rows as crawling or add placeholders
        urls.forEach((url, i) => {
            const parsed = parseSpotifyUrl(url);
            if (!parsed) return;
            const jobId = result.job_ids?.[i];
            if (!jobId) return;

            const existingIdx = state.items.findIndex(
                (item) => item.type === parsed.type && item.spotify_id === parsed.id
            );

            if (existingIdx >= 0) {
                state.items[existingIdx] = {
                    ...state.items[existingIdx],
                    status: 'crawling',
                    error_code: null,
                    error_message: null,
                    last_checked: now,
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
                };
                state.items.unshift(newItem);
                state.pendingJobToItem.set(jobId, newItem.id);
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

    let shouldReload = false;
    let hasTerminalUpdate = false;
    let shouldNotifyBatchDone = false;
    for (const jobId of Array.from(state.pendingJobs)) {
        try {
            const job = await api.getJob(jobId);
            const mappedItemId = state.pendingJobToItem.get(jobId) || jobId;
            const inBatch = Boolean(
                state.batchRefresh?.active
                && state.batchRefresh?.jobIds?.has(jobId)
            );
            if (job.status === 'completed') {
                hasTerminalUpdate = true;
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
                } else {
                    showToast(`Crawl completed: ${job.result?.name || 'item'}`, 'success');
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
                } else {
                    showToast(`Crawl failed: ${job.error || 'Unknown'}`, 'error');
                }
            }
        } catch {
            // API offline, skip this poll cycle
        }
    }

    if (state.batchRefresh?.active && shouldNotifyBatchDone) {
        const batch = state.batchRefresh;
        if (batch.done >= batch.expected) {
            const ok = Math.max(0, batch.expected - batch.errors);
            if (batch.errors > 0) {
                showToast(`Refresh done (${batch.groupName}): ${ok} ok, ${batch.errors} errors`, 'info');
            } else {
                showToast(`Refresh done for ${batch.groupName}: ${ok} links`, 'success');
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
        const token = getAuthToken();
        const res = await fetch(`${CONFIG.API_BASE}/auth/users`, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
        });
        if (!res.ok) return;
        const users = await res.json();
        state.adminUserList = Array.isArray(users) ? users : (users.users || []);
    } catch {
        return;
    }

    const groupPanel = document.getElementById('group-panel');
    if (!groupPanel || document.getElementById('admin-user-filter')) return;

    const filterDiv = document.createElement('div');
    filterDiv.className = 'px-5 py-2 border-b border-white/5';
    filterDiv.id = 'admin-user-filter-wrap';
    filterDiv.innerHTML = `
        <label class="block text-[11px] font-bold uppercase tracking-[0.12em] text-secondary-text mb-2">Filter by User</label>
        <select id="admin-user-filter" class="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50 transition-all" style="appearance:none; color-scheme:dark;">
            <option value="">All Users</option>
        </select>
    `;

    // Insert after admin badge (if present), before the group search area
    const adminBadge = document.getElementById('admin-badge');
    if (adminBadge && adminBadge.nextSibling) {
        groupPanel.insertBefore(filterDiv, adminBadge.nextSibling);
    } else {
        groupPanel.insertBefore(filterDiv, groupPanel.firstChild);
    }

    const select = document.getElementById('admin-user-filter');
    if (select) {
        for (const u of state.adminUserList) {
            const opt = document.createElement('option');
            opt.value = u.id || u._id || '';
            opt.textContent = u.display_name || u.username || u.email || String(u.id);
            select.appendChild(opt);
        }

        select.addEventListener('change', () => {
            state.adminFilterUserId = select.value || null;

            // Update page title to show selected user
            const pageTitle = document.getElementById('page-title');
            const breadcrumb = document.getElementById('breadcrumb-group');
            if (select.value) {
                const selectedUser = state.adminUserList.find(
                    (u) => String(u.id || u._id) === select.value
                );
                const username = selectedUser?.display_name || selectedUser?.username || select.value;
                const groupName = getActiveGroupName();
                if (pageTitle) pageTitle.textContent = `${groupName} (${username})`;
                if (breadcrumb) breadcrumb.textContent = `${groupName} (${username})`;
            } else {
                updateGroupHeader();
            }

            loadData({ preserveScroll: false });
        });
    }
}

async function loadData(opts = {}) {
    const preserveScroll = Boolean(opts?.preserveScroll);
    const skeleton = document.getElementById('skeleton-container');

    // Health check (separate from data fetch)
    try {
        await api.health();
        state.apiOnline = true;
        updateApiStatus();
    } catch {
        state.apiOnline = false;
        updateApiStatus();
    }

    // Fetch items
    try {
        const params = {};
        const currentUser = getAuthUser();
        if (currentUser?.role === 'admin' && state.adminFilterUserId) {
            params.user_id = state.adminFilterUserId;
        }
        const data = await api.getItems(params);
        if (!data) return;
        const incoming = data.items || data || [];
        state.items = mergeItemsKeepOrder(state.items, incoming);
        syncGroupUI(true);
        if (skeleton) skeleton.style.display = 'none';
        renderList({ preserveScroll });
    } catch (err) {
        console.error('loadData error:', err);
        if (skeleton) skeleton.style.display = 'none';
        if (getAuthToken()) {
            state.items = [];
        } else {
            state.items = getDemoData();
        }
        syncGroupUI(true);
        renderList({ preserveScroll });
    }
}

// ═══════════════════════════════════════════════════════════════════
// HERO IMAGE
// ═══════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    if (!requireAuth()) return;
    setupAuthUI();

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

    // Batch toggle
    document.getElementById('modal-batch-toggle').addEventListener('click', () => {
        document.getElementById('modal-batch-area').classList.toggle('hidden');
    });
    document.getElementById('modal-batch-submit').addEventListener('click', submitBatch);

    // Search
    document.getElementById('search-input').addEventListener('input', (e) => {
        handleSearch(e.target.value);
    });
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
            if (state.renamingGroupId) return;
            const groupId = normalizeGroupName(groupBtn.getAttribute('data-group')) || ALL_GROUP_ID;
            const currentGroupId = normalizeGroupName(state.activeGroup) || ALL_GROUP_ID;
            if (groupId.toLowerCase() === currentGroupId.toLowerCase()) {
                state.isCreatingGroup = false;
                return;
            }
            state.activeGroup = groupId;
            state.isCreatingGroup = false;
            updateGroupHeader();
            renderGroups();
            renderList();
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
        listElForDelete.addEventListener('click', (e) => {
            const btn = e.target.closest('.row-delete-btn');
            const refreshBtn = e.target.closest('.row-refresh-btn');
            if (!btn && !refreshBtn) return;
            e.preventDefault();
            e.stopPropagation();
            const row = (btn || refreshBtn).closest('.custom-grid-row');
            if (!row) return;
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
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
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
