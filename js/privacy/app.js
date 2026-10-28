/**
 * Check-in Privacy Manager Controller
 * Allows authenticated users to inspect and mass-update visibility (0..5)
 * across past check-ins via PUT /api/v1/status/{id}.
 */

import { TraewellingAPI } from '../api/traewelling.js';
import { SessionDB } from '../cache/session.js';
import { Storage, STORAGE_KEYS } from '../storage/storage.js';
import { normalizeTripStatus } from '../data/processing.js';
import { syncNavigationLinks } from '../ui/navigation.js';
import { escapeHtml } from '../utils/format.js';
import {
    getTripVisibilityValue,
    getVisibilityMeta,
    isVisibilityLocked,
    summarizeVisibilityCounts,
    filterTripsForPrivacy
} from './visibility.js';

let currentToken = '';
let currentUser = '';
let currentDisplayName = '';
let allTrips = [];
let filteredTrips = [];
const selectedIds = new Set();
const rowUpdateState = new Map();
let isRunningBulkUpdate = false;
let cancelBulkRequested = false;

async function init() {
    const urlParams = new URLSearchParams(window.location.search);
    const requestedUser = (urlParams.get('user') || '').toLowerCase().trim();

    currentToken = Storage.get(STORAGE_KEYS.TOKEN, '') || '';

    let sessions = [];
    try {
        sessions = await SessionDB.getAll();
    } catch {
        sessions = [];
    }

    if (!currentToken && sessions.length > 0) {
        const sessionWithToken = sessions.find(s => s.token);
        if (sessionWithToken) {
            currentToken = sessionWithToken.token;
            currentUser = sessionWithToken.username || '';
        }
    }

    if (!currentUser && requestedUser) {
        currentUser = requestedUser;
    } else if (!currentUser && sessions.length > 0) {
        currentUser = sessions[0].username || '';
    }

    const tokenInput = document.getElementById('tokenInput');
    if (tokenInput && currentToken) {
        tokenInput.value = currentToken;
    }

    syncNavigationLinks(currentUser);
    setupEventListeners();

    // If cached trips exist for currentUser, load them initially so the table is populated right away
    if (currentUser) {
        await loadFromLocalCache(currentUser, true);
    }

    // If we already have a token, validate it in the background
    if (currentToken) {
        validateTokenQuietly(currentToken);
    }
}

async function validateTokenQuietly(token) {
    try {
        const api = new TraewellingAPI(token);
        const userResp = await api.getAuthenticatedUser();
        if (userResp?.data?.username) {
            currentUser = userResp.data.username;
            currentDisplayName = userResp.data.displayName || currentUser;
            updateAuthBadge(true, `@${currentUser}`);
            syncNavigationLinks(currentUser);
        }
    } catch {
        updateAuthBadge(false, 'Token invalid or expired');
    }
}

function updateAuthBadge(connected, text) {
    const badge = document.getElementById('authStatusBadge');
    if (!badge) return;
    badge.textContent = text;
    badge.classList.toggle('connected', Boolean(connected));
}

function showBanner(message, isError = false) {
    const banner = document.getElementById('fetchStatusBanner');
    if (!banner) return;
    if (!message) {
        banner.classList.add('hidden');
        return;
    }
    banner.textContent = message;
    banner.classList.toggle('error', Boolean(isError));
    banner.classList.remove('hidden');
}

async function loadFromLocalCache(usernameHint = '', silentIfEmpty = false) {
    try {
        const sessions = await SessionDB.getAll();
        let targetSession = null;
        if (usernameHint) {
            targetSession = sessions.find(s => (s.username || '').toLowerCase() === usernameHint.toLowerCase());
        }
        if (!targetSession && sessions.length > 0) {
            targetSession = sessions[0];
        }

        if (!targetSession || !Array.isArray(targetSession.trips) || targetSession.trips.length === 0) {
            if (!silentIfEmpty) {
                showBanner('No cached check-ins found in local storage. Enter your Personal Access Token and click Load Check-ins.', true);
            }
            return;
        }

        currentUser = targetSession.username || currentUser;
        currentDisplayName = targetSession.displayName || currentUser;
        if (targetSession.token && !currentToken) {
            currentToken = targetSession.token;
            const tokenInput = document.getElementById('tokenInput');
            if (tokenInput) tokenInput.value = currentToken;
        }

        allTrips = targetSession.trips.map(t => normalizeTripStatus(t));
        rowUpdateState.clear();
        applyFiltersAndSelectMatching();
        showBanner(`Loaded ${allTrips.length} check-ins from local cache for @${currentUser}.`);
    } catch (e) {
        if (!silentIfEmpty) {
            showBanner(`Failed to read local cache: ${e.message}`, true);
        }
    }
}

async function fetchCheckinsFromApi() {
    const tokenInput = document.getElementById('tokenInput');
    const maxPagesSelect = document.getElementById('maxPagesSelect');
    const loadBtn = document.getElementById('loadCheckinsBtn');

    const rawToken = (tokenInput?.value || '').trim();
    if (!rawToken) {
        showBanner('Please paste your Träwelling Personal Access Token first.', true);
        tokenInput?.focus();
        return;
    }

    currentToken = rawToken;
    Storage.set(STORAGE_KEYS.TOKEN, currentToken);
    const maxPages = Math.max(1, Number(maxPagesSelect?.value || 50));

    if (loadBtn) loadBtn.disabled = true;

    try {
        showBanner('Verifying Personal Access Token…');
        const api = new TraewellingAPI(currentToken, {
            onRateLimitUpdate: ({ used, waitMs }) => {
                if (waitMs) {
                    showBanner(`Rate limit reached (${used}/55 requests) — pausing ${Math.ceil(waitMs / 1000)}s…`);
                }
            }
        });

        const authResp = await api.getAuthenticatedUser();
        const username = authResp?.data?.username;
        if (!username) {
            throw new Error('Could not resolve username from token.');
        }

        currentUser = username;
        currentDisplayName = authResp.data.displayName || username;
        updateAuthBadge(true, `Connected as @${currentUser}`);
        syncNavigationLinks(currentUser);

        const fetched = [];
        for (let page = 1; page <= maxPages; page++) {
            showBanner(`Fetching check-ins for @${currentUser} — page ${page} (${fetched.length} loaded)…`);
            const pageResp = await api.getUserStatuses(currentUser, page);
            const items = pageResp?.data;
            if (!Array.isArray(items) || items.length === 0) {
                break;
            }
            items.forEach(item => fetched.push(normalizeTripStatus(item)));

            const hasNext = Boolean(pageResp?.links?.next) || (pageResp?.meta?.current_page < pageResp?.meta?.last_page);
            if (!hasNext) {
                break;
            }
        }

        allTrips = fetched;
        rowUpdateState.clear();

        // Save to SessionDB so local cache has the latest visibility values
        await SessionDB.save(currentUser, {
            displayName: currentDisplayName,
            avatar: authResp.data.profilePicture || null,
            tripCount: allTrips.length,
            token: currentToken,
            trips: allTrips,
            timestamp: Date.now()
        });

        applyFiltersAndSelectMatching();
        const counts = summarizeVisibilityCounts(allTrips);
        const nonPublicCount = counts.total - counts[0];
        showBanner(`Loaded ${allTrips.length} check-ins for @${currentUser} (${counts[3]} Private, ${nonPublicCount} total non-public).`);
    } catch (e) {
        updateAuthBadge(false, 'Authentication error');
        showBanner(`Failed to load check-ins: ${e.message}`, true);
    } finally {
        if (loadBtn) loadBtn.disabled = false;
    }
}

function getCurrentFilterConfig() {
    return {
        visibilityFilter: document.getElementById('filterVisibilitySelect')?.value || 'non-public',
        fromDate: document.getElementById('filterFromDate')?.value || '',
        toDate: document.getElementById('filterToDate')?.value || '',
        searchQuery: document.getElementById('filterSearchInput')?.value || ''
    };
}

function applyFiltersAndSelectMatching() {
    updateKpiSummary();
    filteredTrips = filterTripsForPrivacy(allTrips, getCurrentFilterConfig());
    selectedIds.clear();
    filteredTrips.forEach((t) => {
        if (!isVisibilityLocked(t)) {
            selectedIds.add(String(t.id));
        }
    });
    renderTable();
    updateSelectionSummary();
}

function applyFiltersKeepSelection() {
    updateKpiSummary();
    filteredTrips = filterTripsForPrivacy(allTrips, getCurrentFilterConfig());
    const validIds = new Set(filteredTrips.map(t => String(t.id)));
    for (const id of Array.from(selectedIds)) {
        if (!validIds.has(id)) {
            selectedIds.delete(id);
        }
    }
    renderTable();
    updateSelectionSummary();
}

function updateKpiSummary() {
    const counts = summarizeVisibilityCounts(allTrips);
    const setEl = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = String(val);
    };
    setEl('kpiTotal', counts.total);
    setEl('kpiPublic', counts[0]);
    setEl('kpiUnlisted', counts[1]);
    setEl('kpiFollowers', counts[2]);
    setEl('kpiPrivate', counts[3]);
    setEl('kpiOther', (counts[4] || 0) + (counts[5] || 0));
}

function updateSelectionSummary() {
    const summaryEl = document.getElementById('selectionSummaryText');
    const applyBtn = document.getElementById('applyMassUpdateBtn');
    const headerCheck = document.getElementById('headerSelectAllCheck');

    const count = selectedIds.size;
    if (summaryEl) {
        summaryEl.textContent = `${count} of ${filteredTrips.length} selected`;
    }
    if (applyBtn) {
        applyBtn.disabled = isRunningBulkUpdate || count === 0;
    }
    if (headerCheck) {
        const selectableCount = filteredTrips.filter(t => !isVisibilityLocked(t)).length;
        headerCheck.checked = selectableCount > 0 && count === selectableCount;
        headerCheck.indeterminate = count > 0 && count < selectableCount;
    }
}

function renderTable() {
    const tbody = document.getElementById('privacyTableBody');
    if (!tbody) return;

    if (allTrips.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="priv-empty-cell">
                    Connect your token and click <strong>Load Check-ins</strong> (or <strong>Use Local Cache</strong>) to inspect and mass-update check-in visibility.
                </td>
            </tr>
        `;
        return;
    }

    if (filteredTrips.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="priv-empty-cell">
                    No check-ins match the active visibility/date/search filters (${allTrips.length} total check-ins loaded).
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = filteredTrips.map((trip) => {
        const idStr = String(trip.id);
        const checkin = trip.checkin || trip.train || {};
        const line = checkin.lineName || checkin.number || 'Train';
        const origin = checkin.origin?.name || checkin.origin?.station?.name || trip.origin || 'Origin';
        const dest = checkin.destination?.name || checkin.destination?.station?.name || trip.destination || 'Destination';
        const depRaw = checkin.origin?.departureReal || checkin.origin?.departurePlanned || trip.createdAt;
        const dateStr = depRaw ? new Date(depRaw).toLocaleString(undefined, {
            year: 'numeric',
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }) : '—';

        const visVal = getTripVisibilityValue(trip);
        const visMeta = getVisibilityMeta(visVal);
        const locked = isVisibilityLocked(trip);
        const isChecked = selectedIds.has(idStr);
        const st = rowUpdateState.get(idStr);

        let statusHtml = '<span class="row-status-pill">Ready</span>';
        if (locked) {
            statusHtml = '<span class="row-status-pill error">Locked by moderation</span>';
        } else if (st) {
            statusHtml = `<span class="row-status-pill ${escapeHtml(st.type)}">${escapeHtml(st.text)}</span>`;
        }

        return `
            <tr data-trip-id="${escapeHtml(idStr)}">
                <td class="col-check">
                    <input
                        type="checkbox"
                        class="row-select-check"
                        data-id="${escapeHtml(idStr)}"
                        aria-label="Select check-in ${escapeHtml(idStr)}"
                        ${isChecked ? 'checked' : ''}
                        ${locked || isRunningBulkUpdate ? 'disabled' : ''}
                    >
                </td>
                <td><code>#${escapeHtml(idStr)}</code></td>
                <td>${escapeHtml(dateStr)}</td>
                <td><strong>${escapeHtml(line)}</strong></td>
                <td>${escapeHtml(origin)} → ${escapeHtml(dest)}</td>
                <td>${trip.body ? escapeHtml(trip.body) : '—'}</td>
                <td>
                    <span class="vis-badge ${escapeHtml(visMeta.badgeClass)}">
                        ${escapeHtml(String(visMeta.value))} · ${escapeHtml(visMeta.label)}
                    </span>
                </td>
                <td>${statusHtml}</td>
            </tr>
        `;
    }).join('');
}

async function runMassVisibilityUpdate() {
    if (isRunningBulkUpdate || selectedIds.size === 0) return;

    const tokenInput = document.getElementById('tokenInput');
    const rawToken = (tokenInput?.value || currentToken || '').trim();
    if (!rawToken) {
        showBanner('A Personal Access Token with write-statuses scope is required to update check-ins.', true);
        tokenInput?.focus();
        return;
    }
    currentToken = rawToken;
    Storage.set(STORAGE_KEYS.TOKEN, currentToken);

    const targetSelect = document.getElementById('targetVisibilitySelect');
    const targetVisibility = Number(targetSelect?.value ?? 0);
    const targetMeta = getVisibilityMeta(targetVisibility);

    const tripsToProcess = filteredTrips.filter(t => selectedIds.has(String(t.id)) && !isVisibilityLocked(t));
    if (tripsToProcess.length === 0) return;

    isRunningBulkUpdate = true;
    cancelBulkRequested = false;

    const applyBtn = document.getElementById('applyMassUpdateBtn');
    const cancelBtn = document.getElementById('cancelMassUpdateBtn');
    const progressWrap = document.getElementById('bulkProgressWrap');
    const progressBar = document.getElementById('bulkProgressBar');
    const progressText = document.getElementById('bulkProgressText');
    const rateLimitText = document.getElementById('bulkRateLimitText');

    if (applyBtn) applyBtn.disabled = true;
    if (cancelBtn) cancelBtn.classList.remove('hidden');
    if (progressWrap) progressWrap.classList.remove('hidden');
    if (progressBar) progressBar.style.inlineSize = '0%';

    const api = new TraewellingAPI(currentToken, {
        onRateLimitUpdate: ({ used, waitMs }) => {
            if (rateLimitText) {
                rateLimitText.textContent = waitMs
                    ? `Rate limit window full (${used}/55) — waiting ${Math.ceil(waitMs / 1000)}s…`
                    : `API budget: ${used}/55 req/min`;
            }
        }
    });

    let updatedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    const total = tripsToProcess.length;

    for (let i = 0; i < total; i++) {
        if (cancelBulkRequested) {
            break;
        }

        const trip = tripsToProcess[i];
        const idStr = String(trip.id);
        const currentVis = getTripVisibilityValue(trip);

        if (currentVis === targetVisibility) {
            skippedCount += 1;
            rowUpdateState.set(idStr, { type: 'updated', text: `Already ${targetMeta.label}` });
        } else {
            rowUpdateState.set(idStr, { type: 'updating', text: 'Updating…' });
            renderTable();

            try {
                await api.updateStatus(trip.id, { visibility: targetVisibility });
                trip.visibility = targetVisibility;
                if (trip.checkin) trip.checkin.visibility = targetVisibility;
                if (trip.train) trip.train.visibility = targetVisibility;
                updatedCount += 1;
                rowUpdateState.set(idStr, { type: 'updated', text: `Set to ${targetMeta.label}` });
            } catch (err) {
                failedCount += 1;
                rowUpdateState.set(idStr, { type: 'error', text: err.message || 'Update failed' });
            }
        }

        const done = i + 1;
        const pct = Math.round((done / total) * 100);
        if (progressBar) progressBar.style.inlineSize = `${pct}%`;
        if (progressText) {
            progressText.textContent = `Processed ${done}/${total} (${updatedCount} updated, ${skippedCount} unchanged, ${failedCount} failed)`;
        }

        updateKpiSummary();
        renderTable();
    }

    // Persist updated visibility back into SessionDB cache
    if (currentUser && updatedCount > 0) {
        try {
            const existing = await SessionDB.get(currentUser);
            if (existing) {
                await SessionDB.save(currentUser, {
                    ...existing,
                    trips: allTrips,
                    timestamp: Date.now()
                });
            }
        } catch {
            // Ignore cache save error
        }
    }

    isRunningBulkUpdate = false;
    if (cancelBtn) cancelBtn.classList.add('hidden');
    if (progressText) {
        const prefix = cancelBulkRequested ? 'Stopped' : 'Completed';
        progressText.textContent = `${prefix}: ${updatedCount} updated to ${targetMeta.label}, ${skippedCount} unchanged, ${failedCount} failed.`;
    }
    updateSelectionSummary();
    renderTable();
}

function setupEventListeners() {
    document.getElementById('loadCheckinsBtn')?.addEventListener('click', () => {
        fetchCheckinsFromApi();
    });

    document.getElementById('useCachedBtn')?.addEventListener('click', () => {
        loadFromLocalCache(currentUser, false);
    });

    document.getElementById('filterVisibilitySelect')?.addEventListener('change', () => {
        applyFiltersAndSelectMatching();
    });

    document.getElementById('filterFromDate')?.addEventListener('change', () => {
        applyFiltersKeepSelection();
    });

    document.getElementById('filterToDate')?.addEventListener('change', () => {
        applyFiltersKeepSelection();
    });

    document.getElementById('filterSearchInput')?.addEventListener('input', () => {
        applyFiltersKeepSelection();
    });

    document.getElementById('selectAllBtn')?.addEventListener('click', () => {
        filteredTrips.forEach((t) => {
            if (!isVisibilityLocked(t)) {
                selectedIds.add(String(t.id));
            }
        });
        renderTable();
        updateSelectionSummary();
    });

    document.getElementById('deselectAllBtn')?.addEventListener('click', () => {
        selectedIds.clear();
        renderTable();
        updateSelectionSummary();
    });

    document.getElementById('headerSelectAllCheck')?.addEventListener('change', (e) => {
        if (e.target.checked) {
            filteredTrips.forEach((t) => {
                if (!isVisibilityLocked(t)) {
                    selectedIds.add(String(t.id));
                }
            });
        } else {
            selectedIds.clear();
        }
        renderTable();
        updateSelectionSummary();
    });

    document.getElementById('privacyTableBody')?.addEventListener('change', (e) => {
        const checkbox = e.target.closest('.row-select-check');
        if (!checkbox) return;
        const id = String(checkbox.dataset.id || '');
        if (!id) return;
        if (checkbox.checked) {
            selectedIds.add(id);
        } else {
            selectedIds.delete(id);
        }
        updateSelectionSummary();
    });

    document.getElementById('applyMassUpdateBtn')?.addEventListener('click', () => {
        runMassVisibilityUpdate();
    });

    document.getElementById('cancelMassUpdateBtn')?.addEventListener('click', () => {
        cancelBulkRequested = true;
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

