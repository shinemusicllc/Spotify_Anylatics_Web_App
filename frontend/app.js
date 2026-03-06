/**
 * SpotiCheck — Frontend Application
 * Kết nối API backend, render dynamic rows, quản lý state
 */

// ═══════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════
const CONFIG = {
    API_BASE: window.location.hostname === 'localhost'
        ? 'http://localhost:8001/api'
        : '/api',
    POLL_INTERVAL: 5000,      // 5s polling for pending jobs
    POPUP_WIDTH: 480,
    POPUP_HEIGHT: 720,
    SEARCH_DEBOUNCE: 300,
};

// ═══════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════
const state = {
    items: [],
    filteredItems: [],
    groups: [{ id: 'all', name: 'All Links', count: 0 }],
    activeGroup: 'all',
    searchQuery: '',
    pendingJobs: new Set(),
    pollTimer: null,
    apiOnline: false,
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
            const res = await fetch(`${this.base}${path}`, {
                headers: { 'Content-Type': 'application/json', ...opts.headers },
                ...opts,
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || `HTTP ${res.status}`);
            }
            return res.json();
        } catch (e) {
            if (e.message.includes('Failed to fetch') || e.message.includes('NetworkError')) {
                state.apiOnline = false;
                updateApiStatus();
            }
            throw e;
        }
    }

    health()              { return this._fetch('/health'); }
    getItems(type = null) { return this._fetch(type ? `/items/${type}` : '/items'); }
    getItem(type, id)     { return this._fetch(`/items/${type}/${id}`); }
    getJob(jobId)         { return this._fetch(`/jobs/${jobId}`); }

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
    if (n == null || isNaN(n)) return '—';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
    return n.toLocaleString();
}

/** Relative time from ISO timestamp */
function timeAgo(isoDate) {
    if (!isoDate) return '—';
    const diff = Date.now() - new Date(isoDate).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
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
        case 'album':    return { metric1: '—',                 metric2: 'Total Plays' };
        case 'playlist': return { metric1: 'Followers',         metric2: 'Total Plays' };
        default:         return { metric1: 'Metric 1',          metric2: 'Metric 2' };
    }
}

/** Get stat icons based on type */
function getStatIcons(item) {
    switch (item.type) {
        case 'playlist':
            return `
                <div class="flex items-center gap-1">
                    <span class="material-icons-round text-sm">favorite_border</span>
                    <span class="text-xs">${formatNumber(item.followers || item.saves)}</span>
                </div>
                <div class="flex items-center gap-1">
                    <span class="material-icons-round text-sm">music_note</span>
                    <span class="text-xs">${formatNumber(item.track_count)}</span>
                </div>`;
        case 'track':
            return `
                <div class="flex items-center gap-1">
                    <span class="material-icons-round text-sm">bookmark_border</span>
                    <span class="text-xs">${formatNumber(item.saves)}</span>
                </div>
                <div class="flex items-center gap-1">
                    <span class="material-icons-round text-sm">schedule</span>
                    <span class="text-xs">${item.duration || '—'}</span>
                </div>`;
        case 'album':
            return `
                <div class="flex items-center gap-1">
                    <span class="material-icons-round text-sm">album</span>
                    <span class="text-xs">${formatNumber(item.track_count)} tracks</span>
                </div>
                <div class="flex items-center gap-1">
                    <span class="material-icons-round text-sm">calendar_today</span>
                    <span class="text-xs">${item.release_date || '—'}</span>
                </div>`;
        case 'artist':
            return `
                <div class="flex items-center gap-1">
                    <span class="material-icons-round text-sm">people</span>
                    <span class="text-xs">${formatNumber(item.followers)}</span>
                </div>
                <div class="flex items-center gap-1">
                    <span class="material-icons-round text-sm">library_music</span>
                    <span class="text-xs">${formatNumber(item.album_count)} albums</span>
                </div>`;
        default:
            return '';
    }
}

/** Get metric 1 value (context-aware) */
function getMetric1(item) {
    switch (item.type) {
        case 'artist':   return formatNumber(item.monthly_listeners);
        case 'track':    return formatNumber(item.monthly_plays);
        case 'playlist': return formatNumber(item.followers || item.saves);
        case 'album':    return '—';
        default:         return '—';
    }
}

/** Get metric 2 value (context-aware) */
function getMetric2(item) {
    switch (item.type) {
        case 'artist':   return formatNumber(item.followers);
        case 'track':    return formatNumber(item.playcount);
        case 'playlist': return formatNumber(item.total_plays);
        case 'album':    return formatNumber(item.total_plays);
        default:         return '—';
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

// ═══════════════════════════════════════════════════════════════════
// ROW RENDERER
// ═══════════════════════════════════════════════════════════════════

function renderRow(item) {
    const status = getStatusInfo(item);
    const isError = item.status === 'error';
    const spotifyUrl = getSpotifyUrl(item.type, item.spotify_id);

    // Owner / Artist display
    const ownerHtml = item.owner_image
        ? `<img alt="Owner" class="w-6 h-6 rounded-full" src="${item.owner_image}">`
        : `<div class="w-6 h-6 bg-white/10 rounded-full flex items-center justify-center text-[10px] font-bold text-secondary-text">${(item.owner_name || '?').slice(0, 2).toUpperCase()}</div>`;

    const row = document.createElement('div');
    row.className = 'custom-grid-row px-4 py-3 bg-white/5 rounded-lg border border-transparent hover:bg-row-hover hover:border-white/10 transition-all group';
    row.dataset.spotifyUrl = spotifyUrl;
    row.dataset.itemId = item.id;
    row.dataset.type = item.type;

    // Click → open popup window
    row.addEventListener('click', (e) => {
        // Don't open if user is selecting text
        if (window.getSelection().toString()) return;
        openSpotifyPopup(spotifyUrl);
    });

    row.innerHTML = `
        <!-- Left: Asset Details -->
        <div class="flex items-center gap-4">
            <img alt="Cover" class="w-[70px] h-[70px] rounded-lg object-cover shadow-lg" src="${item.image || `https://picsum.photos/seed/${item.spotify_id}/128/128`}">
            <div>
                <span class="text-[10px] font-bold ${isError ? 'badge-error' : getBadgeClass(item.type)} px-1.5 py-0.5 rounded uppercase mb-1 inline-block">${item.type}</span>
                <h3 class="font-bold text-[15px] leading-snug ${isError ? 'text-white/80' : ''}">${escapeHtml(item.name || 'Unknown')}</h3>
                ${isError
                    ? `<p class="text-[11px] text-red-400 font-medium mt-0.5 flex items-center gap-1"><span class="material-icons-round" style="font-size:12px">warning</span> Error ${item.error_code}: ${item.error_message || 'Unknown error'}</p>`
                    : `<p class="text-[11px] text-secondary-text font-mono truncate mt-0.5">spotify:${item.type}:${item.spotify_id}</p>`
                }
            </div>
        </div>
        <!-- Right: Metadata -->
        <div class="meta-grid w-full">
            <div class="flex items-center gap-2 meta-cell">
                ${ownerHtml}
                <div>
                    <div class="text-sm font-medium leading-tight truncate">${escapeHtml(item.owner_name || '—')}</div>
                    <div class="text-[11px] text-secondary-text leading-tight">${item.added_date || '—'}</div>
                </div>
            </div>
            <div class="flex items-center gap-3 text-secondary-text meta-cell">
                ${getStatIcons(item)}
            </div>
            <div class="text-sm text-secondary-text meta-cell">${getMetric1(item)}</div>
            <div class="text-sm text-secondary-text meta-cell">${getMetric2(item)}</div>
            <div class="flex items-center gap-2 meta-cell">
                <span class="status-dot ${status.dot}"></span>
                <span class="text-sm font-medium ${status.color} truncate">${status.label}</span>
            </div>
            <div class="text-xs text-secondary-text meta-cell text-right">${timeAgo(item.last_checked)}</div>
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

function renderList() {
    const container = document.getElementById('link-list');
    const skeleton = document.getElementById('skeleton-container');
    const emptyState = document.getElementById('empty-state');

    // Filter items
    let items = state.items;

    // Group filter
    if (state.activeGroup !== 'all') {
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
        return;
    }

    if (emptyState) emptyState.style.display = 'none';

    if (items.length === 0) {
        // Has data but filtered to zero
        const noResult = document.createElement('div');
        noResult.className = 'custom-grid-row text-center py-12 text-secondary-text';
        noResult.innerHTML = `<div class="col-span-2">No results for "${escapeHtml(state.searchQuery)}"</div>`;
        container.appendChild(noResult);
        return;
    }

    // Render all rows
    const frag = document.createDocumentFragment();
    items.forEach(item => frag.appendChild(renderRow(item)));
    container.appendChild(frag);

    // Update KPIs
    updateKPIs();
}

function updateKPIs() {
    const all = state.items;
    const active = all.filter(i => i.status === 'active').length;
    const errors = all.filter(i => i.status === 'error').length;
    const crawling = all.filter(i => i.status === 'crawling' || i.status === 'pending').length;

    setText('kpi-total', all.length);
    setText('kpi-active', active);
    setText('kpi-errors', errors);
    setText('kpi-crawling', crawling);
    setText('footer-total', all.length);
    setText('footer-active', active);
    setText('footer-errors', errors);
    setText('footer-crawling', crawling);
    setText('group-count-all', all.length);
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

    const group = document.getElementById('modal-group-select').value || null;

    try {
        const result = await api.crawl(url, group);
        showToast(`Added ${parsed.type}: crawling started`, 'success');

        // Add placeholder item to state
        const newItem = {
            id: result.job_id || `temp-${Date.now()}`,
            spotify_id: parsed.id,
            type: parsed.type,
            name: `Loading ${parsed.type}...`,
            status: 'crawling',
            group: group,
            last_checked: new Date().toISOString(),
        };
        state.items.unshift(newItem);
        state.pendingJobs.add(newItem.id);
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

    const group = document.getElementById('modal-group-select').value || null;

    try {
        const result = await api.crawlBatch(urls, group);
        showToast(`Added ${urls.length} links — crawling started`, 'success');

        // Add placeholders
        urls.forEach((url, i) => {
            const parsed = parseSpotifyUrl(url);
            if (!parsed) return;
            const newItem = {
                id: result.job_ids?.[i] || `temp-${Date.now()}-${i}`,
                spotify_id: parsed.id,
                type: parsed.type,
                name: `Loading ${parsed.type}...`,
                status: 'crawling',
                group: group,
                last_checked: new Date().toISOString(),
            };
            state.items.unshift(newItem);
            state.pendingJobs.add(newItem.id);
        });
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

    for (const jobId of state.pendingJobs) {
        try {
            const job = await api.getJob(jobId);
            if (job.status === 'completed') {
                state.pendingJobs.delete(jobId);
                // Update item in state with real data
                const idx = state.items.findIndex(i => i.id === jobId);
                if (idx >= 0 && job.result) {
                    state.items[idx] = { ...state.items[idx], ...job.result, status: 'active' };
                }
                showToast(`Crawl completed: ${job.result?.name || 'item'}`, 'success');
            } else if (job.status === 'error') {
                state.pendingJobs.delete(jobId);
                const idx = state.items.findIndex(i => i.id === jobId);
                if (idx >= 0) {
                    state.items[idx].status = 'error';
                    state.items[idx].error_message = job.error;
                }
                showToast(`Crawl failed: ${job.error || 'Unknown'}`, 'error');
            }
        } catch {
            // API offline, skip this poll cycle
        }
    }
    renderList();
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

async function loadData() {
    const skeleton = document.getElementById('skeleton-container');

    try {
        // Try to connect to backend API
        await api.health();
        state.apiOnline = true;
        updateApiStatus();

        const data = await api.getItems();
        state.items = data.items || data || [];
        if (skeleton) skeleton.style.display = 'none';
        renderList();
    } catch {
        // Backend not available — use demo data
        state.apiOnline = false;
        updateApiStatus();
        state.items = getDemoData();
        if (skeleton) skeleton.style.display = 'none';
        renderList();
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

    // Refresh
    document.getElementById('btn-refresh').addEventListener('click', () => {
        showToast('Refreshing all links...', 'info');
        loadData();
    });

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

    // MutationObserver to update hero when list changes
    const listEl = document.getElementById('link-list');
    if (listEl) {
        const obs = new MutationObserver(() => setTimeout(updateHeroImage, 50));
        obs.observe(listEl, { childList: true });
    }
});
