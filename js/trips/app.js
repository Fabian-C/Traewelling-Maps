import { SessionDB } from '../cache/session.js';
import { tripsToGeoJSON } from '../export/geojson.js';
import { deriveDelaySeconds, computeTripDurationMinutes } from '../utils/time.js';
import { formatDelayMinutes, formatHumanDuration, formatTotalTime, calculateCO2Saved, formatSpeed, escapeHtml } from '../utils/format.js';
import { openManualTripExportDialog } from '../export/manualTrip.js';
import { normalizeCategory, getTripBusinessType, extractTripTags } from '../data/processing.js';
import {
    TRIP_COLUMNS,
    QUERY_RECIPES,
    flattenTripRecord,
    executeTripQuery,
    visualFilterToSQL,
    exportRowsToCSV
} from './sqlEngine.js';
import { getSQLCompletions } from './sqlAutocomplete.js';

let allSessions = [];
let activeSession = null;
let allTrips = [];
let filteredTrips = [];
let flattenedTrips = [];
let currentModalTrip = null;
let durationDisplayMode = 'standard'; // 'standard' | 'days' | 'months'

// Studio state
let appMode = 'standard'; // 'standard' | 'studio'
let studioTab = 'visual'; // 'visual' | 'sql'
let visualRules = [
    { column: 'delay_dep', operator: 'greater_than', value: '15' }
];
let visualLogicMode = 'AND';
let sqlQueryResult = null;

// Filter state
const filterState = {
    searchQuery: '',
    selectedCategories: new Set(['all']),
    selectedYear: 'all',
    selectedDelay: 'all',
    selectedBuddy: 'all',
    selectedPurpose: 'all',
    sortBy: 'date-desc',
    viewMode: 'table',
    page: 1,
    pageSize: 100
};

// Initialize on DOM ready or immediately if already loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTripExplorer);
} else {
    initTripExplorer();
}

export async function initTripExplorer() {
    try {
        allSessions = await SessionDB.getAll();
    } catch (e) {
        console.warn('Failed to load sessions from SessionDB:', e);
        allSessions = [];
    }

    // Synchronous localStorage session fallback
    if (allSessions.length === 0) {
        try {
            const cachedRaw = localStorage.getItem('tw_cached_sessions_data');
            if (cachedRaw) {
                const parsed = JSON.parse(cachedRaw);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    allSessions = parsed;
                }
            }
        } catch (e) {}
    }

    const urlParams = new URLSearchParams(window.location.search);
    const requestedUser = urlParams.get('user')?.toLowerCase().trim();
    const requestedTripId = urlParams.get('trip');
    const fixtureUrl = urlParams.get('fixture');

    if (allSessions.length > 0) {
        if (requestedUser) {
            activeSession = allSessions.find(s => s.username?.toLowerCase() === requestedUser) || allSessions[0];
        } else {
            activeSession = allSessions[0];
        }
    }

    if (requestedUser && (!activeSession || activeSession.username?.toLowerCase() !== requestedUser || !activeSession.trips?.length)) {
        try {
            const direct = await SessionDB.get(requestedUser);
            if (direct && Array.isArray(direct.trips) && direct.trips.length > 0) {
                activeSession = direct;
                if (!allSessions.some(s => s.username?.toLowerCase() === requestedUser)) {
                    allSessions.unshift(direct);
                }
            }
        } catch (e) {}
    }

    // Fixture / Preview fallback for testing/previews
    const previewParam = urlParams.get('preview');
    if ((!activeSession || !activeSession.trips?.length)) {
        if (fixtureUrl) {
            try {
                const res = await fetch(fixtureUrl);
                const trips = await res.json();
                if (Array.isArray(trips) && trips.length > 0) {
                    const u = (requestedUser || 'resu').replace(/^@/, '');
                    activeSession = {
                        username: u,
                        displayName: u.charAt(0).toUpperCase() + u.slice(1),
                        trips: trips,
                        tripCount: trips.length,
                        timestamp: Date.now()
                    };
                    allSessions.unshift(activeSession);
                }
            } catch (err) {
                console.warn('Failed to load fixture in trips explorer:', err);
            }
        } else if (previewParam) {
            const sampleTrips = [
                {
                    id: 325374,
                    body: "Ferry cruise on the Elbe with @Fabi",
                    bodyMentions: [{ id: 1, username: "Fabi" }],
                    createdAt: "2022-04-16T16:49:46+00:00",
                    train: {
                        category: "ferry",
                        lineName: "Fäh 62",
                        totalDistance: 22590,
                        departureDelay: 120,
                        origin: { name: "Hamburg Landungsbrücken", departureReal: "2022-04-16T16:50:00Z" },
                        destination: { name: "Dockland", arrivalReal: "2022-04-16T17:15:00Z" }
                    }
                },
                {
                    id: 9309802,
                    body: "Evening ride home with @Fabi",
                    bodyMentions: [{ id: 1, username: "Fabi" }],
                    createdAt: "2026-10-11T18:46:00+00:00",
                    train: {
                        category: "suburban",
                        lineName: "S9",
                        totalDistance: 14030,
                        departureDelay: 300,
                        origin: { name: "Friedrichstraße", departureReal: "2026-10-11T18:46:00Z" },
                        destination: { name: "Alexanderplatz", arrivalReal: "2026-10-11T18:58:00Z" }
                    }
                },
                {
                    id: 8877665,
                    body: "Regional connection Hamburg to Berlin",
                    createdAt: "2026-10-12T10:00:00+00:00",
                    train: {
                        category: "regional",
                        lineName: "RE 1",
                        totalDistance: 280000,
                        departureDelay: 1200,
                        origin: { name: "Hamburg Hbf", departureReal: "2026-10-12T10:00:00Z" },
                        destination: { name: "Berlin Hbf", arrivalReal: "2026-10-12T11:45:00Z" }
                    }
                }
            ];
            const u = (requestedUser || 'resu').replace(/^@/, '');
            activeSession = {
                username: u,
                displayName: u.charAt(0).toUpperCase() + u.slice(1),
                trips: sampleTrips,
                tripCount: sampleTrips.length,
                timestamp: Date.now()
            };
            allSessions.unshift(activeSession);
        }
    }

    renderProfileDropdown();
    setupEventListeners();

    if (!activeSession || !Array.isArray(activeSession.trips) || activeSession.trips.length === 0) {
        showEmptyState();
        return;
    }

    allTrips = activeSession.trips.slice();
    flattenedTrips = allTrips.map(flattenTripRecord);

    // Populate Year pills, Companion dropdown, and Studio Recipes
    populateYearPills(allTrips);
    populateBuddyDropdown(allTrips);
    initStudioWorkbench();

    // Apply URL parameters if present
    if (urlParams.get('search')) filterState.searchQuery = urlParams.get('search');
    if (urlParams.get('year')) filterState.selectedYear = urlParams.get('year');
    if (urlParams.get('category')) filterState.selectedCategories = new Set([urlParams.get('category')]);
    if (urlParams.get('delay')) filterState.selectedDelay = urlParams.get('delay');

    applyFiltersAndRender();

    // If deep-linked to a specific trip, open its modal inspector
    if (requestedTripId) {
        const foundTrip = allTrips.find(t => String(t.id) === String(requestedTripId));
        if (foundTrip) {
            openTripDetailModal(foundTrip);
        }
    }
}

/**
 * Render user profile selector
 */
function renderProfileDropdown() {
    const select = document.getElementById('profileSelect');
    if (!select) return;

    if (!allSessions || allSessions.length === 0) {
        select.innerHTML = '<option value="">No profiles found</option>';
        return;
    }

    select.innerHTML = allSessions.map(s => {
        const u = s.username || 'unknown';
        const d = s.displayName || u;
        const count = s.tripCount || (s.trips ? s.trips.length : 0);
        const isSelected = activeSession?.username?.toLowerCase() === u.toLowerCase();
        return `<option value="${escapeHtml(u)}" ${isSelected ? 'selected' : ''}>${escapeHtml(d)} (@${escapeHtml(u)} · ${count} trips)</option>`;
    }).join('');

    // Update Wrapped link with active user
    const wrappedLink = document.getElementById('navWrappedLink');
    if (wrappedLink && activeSession?.username) {
        wrappedLink.href = `wrapped.html?user=${encodeURIComponent(activeSession.username)}`;
    }
}

/**
 * Setup UI event listeners
 */
function setupEventListeners() {
    // Profile Switcher
    const profileSelect = document.getElementById('profileSelect');
    if (profileSelect) {
        profileSelect.addEventListener('change', (e) => {
            const user = (e.target.value || '').toLowerCase().trim();
            const found = allSessions.find(s => s.username?.toLowerCase() === user);
            if (found) {
                activeSession = found;
                allTrips = activeSession.trips || [];
                flattenedTrips = allTrips.map(flattenTripRecord);
                populateYearPills(allTrips);
                populateBuddyDropdown(allTrips);
                filterState.page = 1;
                updateUrlParams();
                if (appMode === 'studio') {
                    const currentSql = document.getElementById('sqlQueryInput')?.value || QUERY_RECIPES[0].sql;
                    runSqlQuery(currentSql);
                } else {
                    applyFiltersAndRender();
                }
            }
        });
    }

    // Search input (debounced)
    const searchInput = document.getElementById('tripsSearchInput');
    const searchClearBtn = document.getElementById('searchClearBtn');
    let searchDebounce = null;

    if (searchInput) {
        searchInput.addEventListener('input', () => {
            if (searchClearBtn) {
                searchClearBtn.style.display = searchInput.value ? 'inline-block' : 'none';
            }
            clearTimeout(searchDebounce);
            searchDebounce = setTimeout(() => {
                filterState.searchQuery = searchInput.value.trim();
                filterState.page = 1;
                applyFiltersAndRender();
            }, 180);
        });

        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                clearTimeout(searchDebounce);
                filterState.searchQuery = searchInput.value.trim();
                filterState.page = 1;
                applyFiltersAndRender();
                searchInput.blur();
            }
        });
    }

    if (searchClearBtn) {
        searchClearBtn.addEventListener('click', () => {
            if (searchInput) searchInput.value = '';
            searchClearBtn.style.display = 'none';
            filterState.searchQuery = '';
            filterState.page = 1;
            applyFiltersAndRender();
        });
    }

    // Category Chips
    const catGroup = document.getElementById('categoryChipsGroup');
    if (catGroup) {
        catGroup.addEventListener('click', (e) => {
            const btn = e.target.closest('.filter-chip');
            if (!btn) return;
            const cat = btn.dataset.cat;
            if (cat === 'all') {
                filterState.selectedCategories = new Set(['all']);
            } else {
                filterState.selectedCategories.delete('all');
                if (filterState.selectedCategories.has(cat)) {
                    filterState.selectedCategories.delete(cat);
                    if (filterState.selectedCategories.size === 0) {
                        filterState.selectedCategories.add('all');
                    }
                } else {
                    filterState.selectedCategories.add(cat);
                }
            }
            updateCategoryChipsUI();
            filterState.page = 1;
            applyFiltersAndRender();
        });
    }

    // Year Pills
    const yearGroup = document.getElementById('yearPillsGroup');
    if (yearGroup) {
        yearGroup.addEventListener('click', (e) => {
            const btn = e.target.closest('.filter-pill');
            if (!btn) return;
            filterState.selectedYear = btn.dataset.year;
            yearGroup.querySelectorAll('.filter-pill').forEach(p => p.classList.toggle('active', p === btn));
            filterState.page = 1;
            applyFiltersAndRender();
        });
    }

    // Delay Pills
    const delayGroup = document.getElementById('delayPillsGroup');
    if (delayGroup) {
        delayGroup.addEventListener('click', (e) => {
            const btn = e.target.closest('.filter-pill');
            if (!btn) return;
            filterState.selectedDelay = btn.dataset.delay;
            delayGroup.querySelectorAll('.filter-pill').forEach(p => p.classList.toggle('active', p === btn));
            filterState.page = 1;
            applyFiltersAndRender();
        });
    }

    // Companion Dropdown
    const buddySelect = document.getElementById('buddySelect');
    if (buddySelect) {
        buddySelect.addEventListener('change', (e) => {
            filterState.selectedBuddy = e.target.value;
            filterState.page = 1;
            applyFiltersAndRender();
        });
    }

    // Purpose Dropdown
    const purposeSelect = document.getElementById('purposeSelect');
    if (purposeSelect) {
        purposeSelect.addEventListener('change', (e) => {
            filterState.selectedPurpose = e.target.value;
            filterState.page = 1;
            applyFiltersAndRender();
        });
    }

    // Sort Dropdown
    const sortSelect = document.getElementById('sortSelect');
    if (sortSelect) {
        sortSelect.addEventListener('change', (e) => {
            filterState.sortBy = e.target.value;
            applyFiltersAndRender();
        });
    }

    // View Mode Toggle (Table vs Cards)
    const viewTableBtn = document.getElementById('viewTableBtn');
    const viewCardsBtn = document.getElementById('viewCardsBtn');
    const tableView = document.getElementById('tableViewContainer');
    const cardsView = document.getElementById('cardViewContainer');

    if (viewTableBtn && viewCardsBtn) {
        viewTableBtn.addEventListener('click', () => {
            filterState.viewMode = 'table';
            viewTableBtn.classList.add('active');
            viewCardsBtn.classList.remove('active');
            tableView.style.display = 'block';
            cardsView.style.display = 'none';
        });

        viewCardsBtn.addEventListener('click', () => {
            filterState.viewMode = 'cards';
            viewCardsBtn.classList.add('active');
            viewTableBtn.classList.remove('active');
            tableView.style.display = 'none';
            cardsView.style.display = 'grid';
        });
    }

    // Page Size Selector
    const pageSizeSelect = document.getElementById('pageSizeSelect');
    if (pageSizeSelect) {
        pageSizeSelect.addEventListener('change', (e) => {
            filterState.pageSize = parseInt(e.target.value, 10) || 100;
            filterState.page = 1;
            renderResults();
        });
    }

    // Pagination Nav
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');
    if (prevPageBtn) {
        prevPageBtn.addEventListener('click', () => {
            if (filterState.page > 1) {
                filterState.page--;
                renderResults();
                window.scrollTo({ top: 300, behavior: 'smooth' });
            }
        });
    }
    if (nextPageBtn) {
        nextPageBtn.addEventListener('click', () => {
            const totalItems = (appMode === 'studio' && sqlQueryResult)
                ? (sqlQueryResult.isSelectAll ? (sqlQueryResult.rawTrips?.length || 0) : sqlQueryResult.rows.length)
                : filteredTrips.length;
            const maxPage = Math.ceil(totalItems / filterState.pageSize);
            if (filterState.page < maxPage) {
                filterState.page++;
                renderResults();
                window.scrollTo({ top: 300, behavior: 'smooth' });
            }
        });
    }

    // Modal Export Manual Trip Button
    const modalExportBtn = document.getElementById('modalExportManualBtn');
    if (modalExportBtn) {
        modalExportBtn.addEventListener('click', () => {
            if (currentModalTrip) {
                openManualTripExportDialog(currentModalTrip);
            }
        });
    }

    // Telemetry Duration Unit Switcher
    const durChip = document.getElementById('telemetryDurationChip');
    if (durChip) {
        durChip.addEventListener('click', () => {
            if (durationDisplayMode === 'standard') {
                durationDisplayMode = 'days';
            } else if (durationDisplayMode === 'days') {
                durationDisplayMode = 'months';
            } else {
                durationDisplayMode = 'standard';
            }
            updateTelemetry(filteredTrips);
        });
    }

    // Reset Filters Button
    const resetBtn = document.getElementById('resetFiltersBtn');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            filterState.searchQuery = '';
            filterState.selectedCategories = new Set(['all']);
            filterState.selectedYear = 'all';
            filterState.selectedDelay = 'all';
            filterState.selectedBuddy = 'all';
            filterState.selectedPurpose = 'all';
            filterState.sortBy = 'date-desc';
            filterState.page = 1;

            if (searchInput) searchInput.value = '';
            if (searchClearBtn) searchClearBtn.style.display = 'none';
            if (buddySelect) buddySelect.value = 'all';
            if (purposeSelect) purposeSelect.value = 'all';
            if (sortSelect) sortSelect.value = 'date-desc';

            updateCategoryChipsUI();
            document.querySelectorAll('#yearPillsGroup .filter-pill').forEach(p => p.classList.toggle('active', p.dataset.year === 'all'));
            document.querySelectorAll('#delayPillsGroup .filter-pill').forEach(p => p.classList.toggle('active', p.dataset.delay === 'all'));

            applyFiltersAndRender();
        });
    }

    // Export Filtered Button
    const exportBtn = document.getElementById('exportFilteredBtn');
    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            if (filteredTrips.length === 0) {
                alert('No trips match the current filter criteria to export.');
                return;
            }
            const geojson = getFilteredGeoJSON();
            const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `traewelling-${activeSession?.username || 'trips'}-filtered.geojson`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        });
    }

    // Modal Close
    const modalCloseBtn = document.getElementById('closeModalBtn');
    const modal = document.getElementById('tripDetailModal');
    if (modalCloseBtn && modal) {
        modalCloseBtn.addEventListener('click', () => modal.close());
    }

    // Setup Studio Database Workbench Listeners
    setupStudioEventListeners();
}

export function getFilteredGeoJSON() {
    return tripsToGeoJSON(filteredTrips, {
        title: `Träwelling Filtered Export (${activeSession?.username || 'user'})`,
        exportDate: new Date().toISOString()
    });
}
window.getFilteredGeoJSON = getFilteredGeoJSON;

/**
 * Populate Year pills from journey timestamps
 */
function populateYearPills(trips) {
    const container = document.getElementById('yearPillsGroup');
    if (!container) return;

    const yearsSet = new Set();
    trips.forEach(t => {
        const train = t.train || t.checkin || {};
        const raw = train.origin?.departureReal || train.origin?.departure || t.createdAt;
        if (raw) {
            const yr = new Date(raw).getFullYear();
            if (!isNaN(yr) && yr >= 2010 && yr <= 2030) {
                yearsSet.add(yr);
            }
        }
    });

    const sortedYears = Array.from(yearsSet).sort((a, b) => b - a);
    let html = `<button type="button" class="filter-pill ${filterState.selectedYear === 'all' ? 'active' : ''}" data-year="all">All-Time</button>`;
    sortedYears.forEach(yr => {
        html += `<button type="button" class="filter-pill ${String(filterState.selectedYear) === String(yr) ? 'active' : ''}" data-year="${yr}">${yr}</button>`;
    });
    container.innerHTML = html;
}

/**
 * Populate Travel Buddy selector
 */
function populateBuddyDropdown(trips) {
    const select = document.getElementById('buddySelect');
    if (!select) return;

    const buddyCounts = new Map();
    trips.forEach(t => {
        const train = t.train || t.checkin || {};
        let mentions = t.bodyMentions || t.properties?.bodyMentions;
        if (typeof mentions === 'string') {
            try { mentions = JSON.parse(mentions); } catch (e) { mentions = []; }
        }
        if (Array.isArray(mentions)) {
            mentions.forEach(m => {
                const username = m.username || m.name || m;
                if (typeof username === 'string' && username.trim()) {
                    const clean = username.trim().toLowerCase();
                    buddyCounts.set(clean, (buddyCounts.get(clean) || 0) + 1);
                }
            });
        }
    });

    const sortedBuddies = Array.from(buddyCounts.entries()).sort((a, b) => b[1] - a[1]);
    let html = '<option value="all">All Companions</option>';
    sortedBuddies.forEach(([user, count]) => {
        html += `<option value="${escapeHtml(user)}">@${escapeHtml(user)} (${count} trips)</option>`;
    });
    select.innerHTML = html;
}

/**
 * Update active state on category chips
 */
function updateCategoryChipsUI() {
    const chips = document.querySelectorAll('#categoryChipsGroup .filter-chip');
    chips.forEach(chip => {
        const cat = chip.dataset.cat;
        if (filterState.selectedCategories.has(cat)) {
            chip.classList.add('active');
        } else {
            chip.classList.remove('active');
        }
    });
}

/**
 * Initialize Database Studio workbench controls and recipes
 */
function initStudioWorkbench() {
    // Populate Recipes dropdown
    const recipeSelect = document.getElementById('sqlRecipeSelect');
    if (recipeSelect) {
        recipeSelect.innerHTML = '<option value="">⚡ Quick Recipes...</option>' +
            QUERY_RECIPES.map((r, i) => `<option value="${i}">${escapeHtml(r.title)}</option>`).join('');
    }

    // Default SQL query if empty
    const sqlInput = document.getElementById('sqlQueryInput');
    if (sqlInput && !sqlInput.value.trim()) {
        sqlInput.value = QUERY_RECIPES[0].sql;
    }

    // Render initial visual rules
    renderVisualRules();
}

/**
 * Setup Event Listeners for Database Studio Mode
 */
function setupStudioEventListeners() {
    // 1. Mode Switcher (Standard Explorer vs Database Studio)
    const modeStandardBtn = document.getElementById('modeStandardBtn');
    const modeStudioBtn = document.getElementById('modeStudioBtn');
    const filterPanel = document.getElementById('tripsFilterPanel');
    const studioPanel = document.getElementById('tripsStudioPanel');

    if (modeStandardBtn && modeStudioBtn) {
        modeStandardBtn.addEventListener('click', () => {
            appMode = 'standard';
            modeStandardBtn.classList.add('active');
            modeStudioBtn.classList.remove('active');
            if (filterPanel) filterPanel.style.display = 'flex';
            if (studioPanel) studioPanel.style.display = 'none';
            applyFiltersAndRender();
        });

        modeStudioBtn.addEventListener('click', () => {
            appMode = 'studio';
            modeStudioBtn.classList.add('active');
            modeStandardBtn.classList.remove('active');
            if (filterPanel) filterPanel.style.display = 'none';
            if (studioPanel) studioPanel.style.display = 'flex';
            const viewTableBtn = document.getElementById('viewTableBtn');
            if (viewTableBtn && !viewTableBtn.classList.contains('active')) {
                viewTableBtn.click();
            }

            if (!sqlQueryResult) {
                const currentSql = document.getElementById('sqlQueryInput')?.value || QUERY_RECIPES[0].sql;
                runSqlQuery(currentSql);
            } else {
                renderResults();
            }
        });
    }

    // 2. Studio Sub-tabs (Visual Builder vs SQL Console)
    const tabVisualBtn = document.getElementById('studioTabVisualBtn');
    const tabSqlBtn = document.getElementById('studioTabSqlBtn');
    const visualPane = document.getElementById('studioVisualPane');
    const sqlPane = document.getElementById('studioSqlPane');

    if (tabVisualBtn && tabSqlBtn) {
        tabVisualBtn.addEventListener('click', () => {
            studioTab = 'visual';
            tabVisualBtn.classList.add('active');
            tabSqlBtn.classList.remove('active');
            if (visualPane) visualPane.style.display = 'block';
            if (sqlPane) sqlPane.style.display = 'none';
        });

        tabSqlBtn.addEventListener('click', () => {
            studioTab = 'sql';
            tabSqlBtn.classList.add('active');
            tabVisualBtn.classList.remove('active');
            if (visualPane) visualPane.style.display = 'none';
            if (sqlPane) sqlPane.style.display = 'block';
        });
    }

    // 3. Quick Recipe Selector
    const recipeSelect = document.getElementById('sqlRecipeSelect');
    if (recipeSelect) {
        recipeSelect.addEventListener('change', (e) => {
            const idx = parseInt(e.target.value, 10);
            if (!isNaN(idx) && QUERY_RECIPES[idx]) {
                const sql = QUERY_RECIPES[idx].sql;
                const sqlInput = document.getElementById('sqlQueryInput');
                if (sqlInput) sqlInput.value = sql;
                runSqlQuery(sql);
            }
        });
    }

    // 4. SQL Console Run, Autocomplete, and Keyboard Navigation
    const runSqlBtn = document.getElementById('runSqlQueryBtn');
    const sqlInput = document.getElementById('sqlQueryInput');
    const acPopover = document.getElementById('sqlAutocompletePopover');
    let activeACIndex = 0;
    let currentACResult = null;

    function renderAC() {
        if (!sqlInput || !acPopover) return;
        const val = sqlInput.value;
        const cursorPos = sqlInput.selectionStart || 0;
        currentACResult = getSQLCompletions(val, cursorPos);

        if (!currentACResult.items || currentACResult.items.length === 0) {
            acPopover.style.display = 'none';
            return;
        }

        if (activeACIndex >= currentACResult.items.length) {
            activeACIndex = 0;
        }

        acPopover.innerHTML = currentACResult.items.map((item, idx) => `
            <div class="sql-ac-item ${idx === activeACIndex ? 'active' : ''}" data-ac-index="${idx}" role="option" aria-selected="${idx === activeACIndex}">
                <div class="sql-ac-left">
                    <span class="sql-ac-badge ${item.type}">${item.type === 'keyword' ? 'KW' : (item.type === 'column' ? 'COL' : (item.type === 'value' ? 'VAL' : (item.type === 'table' ? 'TBL' : 'REC')))}</span>
                    <span class="sql-ac-label">${escapeHtml(item.label)}</span>
                </div>
                <div class="sql-ac-detail">${escapeHtml(item.detail || '')}</div>
            </div>
        `).join('') + `
            <div class="sql-ac-footer">
                <span>↑/↓ to navigate • ↵ / Tab to apply • Esc to close</span>
                <span>${currentACResult.items.length} suggestions</span>
            </div>
        `;

        acPopover.style.display = 'flex';

        acPopover.querySelectorAll('.sql-ac-item').forEach(itemEl => {
            itemEl.addEventListener('mousedown', (e) => {
                e.preventDefault();
                const idx = parseInt(itemEl.dataset.acIndex, 10);
                applyAC(idx);
            });
            itemEl.addEventListener('mouseenter', () => {
                activeACIndex = parseInt(itemEl.dataset.acIndex, 10);
                updateACActiveItem();
            });
        });
    }

    function updateACActiveItem() {
        if (!acPopover) return;
        acPopover.querySelectorAll('.sql-ac-item').forEach((el, idx) => {
            el.classList.toggle('active', idx === activeACIndex);
            el.setAttribute('aria-selected', idx === activeACIndex ? 'true' : 'false');
        });
    }

    function applyAC(index) {
        if (!currentACResult || !currentACResult.items[index]) return;
        const item = currentACResult.items[index];
        const val = sqlInput.value;
        const tokenStart = currentACResult.tokenStart;
        const tokenEnd = tokenStart + currentACResult.token.length;

        const before = val.slice(0, tokenStart);
        const after = val.slice(tokenEnd);
        const insert = item.insertText;

        sqlInput.value = before + insert + after;
        const newCursor = tokenStart + insert.length;
        sqlInput.selectionStart = newCursor;
        sqlInput.selectionEnd = newCursor;
        sqlInput.focus();

        acPopover.style.display = 'none';
        currentACResult = null;
        activeACIndex = 0;
    }

    if (runSqlBtn && sqlInput) {
        runSqlBtn.addEventListener('click', () => {
            if (acPopover) acPopover.style.display = 'none';
            runSqlQuery(sqlInput.value);
        });

        sqlInput.addEventListener('input', () => {
            renderAC();
        });

        sqlInput.addEventListener('keydown', (e) => {
            // Ctrl+Enter or Cmd+Enter to execute query
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                if (acPopover) acPopover.style.display = 'none';
                runSqlQuery(sqlInput.value);
                return;
            }

            // Ctrl+Space to force open suggestions
            if ((e.ctrlKey || e.metaKey) && e.key === ' ') {
                e.preventDefault();
                renderAC();
                return;
            }

            // If autocomplete popover is open
            if (acPopover && acPopover.style.display !== 'none' && currentACResult && currentACResult.items.length > 0) {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    activeACIndex = (activeACIndex + 1) % currentACResult.items.length;
                    updateACActiveItem();
                    return;
                }
                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    activeACIndex = (activeACIndex - 1 + currentACResult.items.length) % currentACResult.items.length;
                    updateACActiveItem();
                    return;
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault();
                    applyAC(activeACIndex);
                    return;
                }
                if (e.key === 'Escape') {
                    e.preventDefault();
                    acPopover.style.display = 'none';
                    return;
                }
            }
        });

        sqlInput.addEventListener('blur', () => {
            setTimeout(() => {
                if (acPopover) acPopover.style.display = 'none';
            }, 200);
        });
    }

    // 5. SQL Reference Chips
    document.querySelectorAll('.sql-chip-tag').forEach(chip => {
        chip.addEventListener('click', () => {
            const snippet = chip.dataset.insert;
            if (snippet && sqlInput) {
                if (snippet.startsWith('SELECT *')) {
                    sqlInput.value = snippet;
                } else if (sqlInput.value.includes('WHERE')) {
                    sqlInput.value += ` AND ${snippet.replace(/^WHERE /, '')}`;
                } else {
                    sqlInput.value += ` ${snippet}`;
                }
                sqlInput.focus();
            }
        });
    });

    // 6. Visual Query Builder Controls
    const addRuleBtn = document.getElementById('addRuleBtn');
    const clearRulesBtn = document.getElementById('clearRulesBtn');
    const applyRulesBtn = document.getElementById('applyVisualRulesBtn');
    const logicSelect = document.getElementById('visualLogicMode');

    if (addRuleBtn) {
        addRuleBtn.addEventListener('click', () => {
            visualRules.push({ column: 'line', operator: 'contains', value: '' });
            renderVisualRules();
        });
    }

    if (clearRulesBtn) {
        clearRulesBtn.addEventListener('click', () => {
            visualRules = [];
            renderVisualRules();
        });
    }

    if (logicSelect) {
        logicSelect.addEventListener('change', (e) => {
            visualLogicMode = e.target.value;
        });
    }

    if (applyRulesBtn) {
        applyRulesBtn.addEventListener('click', () => {
            const generatedSql = visualFilterToSQL(visualRules, visualLogicMode);
            if (sqlInput) sqlInput.value = generatedSql;
            runSqlQuery(generatedSql);
        });
    }

    // 7. Studio Result Exports (CSV, JSON, GeoJSON)
    const exportCsvBtn = document.getElementById('exportCsvBtn');
    const exportJsonBtn = document.getElementById('exportJsonBtn');
    const exportSqlGeoBtn = document.getElementById('exportSqlGeoJsonBtn');

    if (exportCsvBtn) {
        exportCsvBtn.addEventListener('click', () => {
            if (!sqlQueryResult || !sqlQueryResult.rows?.length) {
                alert('No active query results to export.');
                return;
            }
            const csv = exportRowsToCSV(sqlQueryResult.rows, sqlQueryResult.columns);
            downloadFile(csv, `traewelling-query-${Date.now()}.csv`, 'text/csv');
        });
    }

    if (exportJsonBtn) {
        exportJsonBtn.addEventListener('click', () => {
            if (!sqlQueryResult || !sqlQueryResult.rows?.length) {
                alert('No active query results to export.');
                return;
            }
            const json = JSON.stringify(sqlQueryResult.rows, null, 2);
            downloadFile(json, `traewelling-query-${Date.now()}.json`, 'application/json');
        });
    }

    if (exportSqlGeoBtn) {
        exportSqlGeoBtn.addEventListener('click', () => {
            const trips = (sqlQueryResult?.rawTrips?.length ? sqlQueryResult.rawTrips : filteredTrips);
            if (!trips.length) {
                alert('No geo-referenced trips in current result.');
                return;
            }
            const geojson = tripsToGeoJSON(trips, {
                title: 'SQL Query Export',
                exportDate: new Date().toISOString()
            });
            downloadFile(JSON.stringify(geojson, null, 2), `traewelling-query-${Date.now()}.geojson`, 'application/geo+json');
        });
    }
}

/**
 * Execute an arbitrary SQL query on the dataset
 */
export function runSqlQuery(sql) {
    if (!sql) return;

    if (!flattenedTrips.length && allTrips.length) {
        flattenedTrips = allTrips.map(flattenTripRecord);
    }
    if (!flattenedTrips.length) return;

    try {
        const result = executeTripQuery(sql, flattenedTrips);
        sqlQueryResult = result;

        // Ensure table view is visible
        const tableView = document.getElementById('tableViewContainer');
        const cardsView = document.getElementById('cardViewContainer');
        const viewTableBtn = document.getElementById('viewTableBtn');
        const viewCardsBtn = document.getElementById('viewCardsBtn');
        if (tableView && cardsView) {
            tableView.style.display = 'block';
            cardsView.style.display = 'none';
            if (viewTableBtn) viewTableBtn.classList.add('active');
            if (viewCardsBtn) viewCardsBtn.classList.remove('active');
        }

        // Update benchmark badge
        const badge = document.getElementById('sqlBenchmarkBadge');
        if (badge) {
            badge.textContent = `⏱️ ${result.executionTimeMs}ms • ${result.totalRows.toLocaleString()} rows`;
            badge.style.color = '#34d399';
            badge.style.borderColor = 'rgba(16, 185, 129, 0.3)';
        }

        // Update main telemetry chips
        if (result.rawTrips) {
            updateTelemetry(result.rawTrips);
        }

        // Set page to 1 and render
        filterState.page = 1;
        renderResults();
    } catch (err) {
        console.error('SQL execution error:', err);
        const badge = document.getElementById('sqlBenchmarkBadge');
        if (badge) {
            badge.textContent = `❌ ${err.message}`;
            badge.style.color = '#ef4444';
            badge.style.borderColor = 'rgba(239, 68, 68, 0.4)';
        }
        sqlQueryResult = {
            columns: ['error'],
            rows: [],
            totalRows: 0,
            rawTrips: [],
            executionTimeMs: 0,
            isSelectAll: false,
            error: err.message
        };
        filterState.page = 1;
        renderResults();
    }
}
window.runSqlQuery = runSqlQuery;
window.executeTripQuery = executeTripQuery;
window.visualFilterToSQL = visualFilterToSQL;

/**
 * Render visual filter rule rows
 */
function renderVisualRules() {
    const container = document.getElementById('visualRulesContainer');
    if (!container) return;

    if (!visualRules.length) {
        container.innerHTML = `<div style="text-align: center; padding: 24px; color: var(--text-muted); font-size: 13px;">No conditions set. All journeys match. Click <strong>+ Add Condition</strong> above.</div>`;
        return;
    }

    container.innerHTML = visualRules.map((rule, idx) => {
        const colOptions = TRIP_COLUMNS.map(c => `
            <option value="${c.name}" ${c.name === rule.column ? 'selected' : ''}>${c.label} (${c.name})</option>
        `).join('');

        const selectedCol = TRIP_COLUMNS.find(c => c.name === rule.column);
        const isNum = selectedCol?.type === 'number';

        const operators = isNum
            ? [
                { id: 'equals', label: '=' },
                { id: 'not_equals', label: '!=' },
                { id: 'greater_than', label: '>' },
                { id: 'less_than', label: '<' },
                { id: 'greater_equal', label: '>=' },
                { id: 'less_equal', label: '<=' },
                { id: 'is_empty', label: 'is empty' },
                { id: 'is_not_empty', label: 'is not empty' }
            ]
            : [
                { id: 'contains', label: 'contains' },
                { id: 'starts_with', label: 'starts with' },
                { id: 'equals', label: 'equals' },
                { id: 'not_equals', label: 'does not equal' },
                { id: 'is_empty', label: 'is empty' },
                { id: 'is_not_empty', label: 'is not empty' }
            ];

        const opOptions = operators.map(o => `
            <option value="${o.id}" ${o.id === rule.operator ? 'selected' : ''}>${o.label}</option>
        `).join('');

        const hideValue = rule.operator === 'is_empty' || rule.operator === 'is_not_empty';

        return `
            <div class="visual-rule-row" data-rule-index="${idx}">
                <select class="rule-select rule-col-select" aria-label="Select Column">${colOptions}</select>
                <select class="rule-select rule-op-select" aria-label="Select Operator">${opOptions}</select>
                ${hideValue ? '' : `<input type="${isNum ? 'number' : 'text'}" class="rule-input" value="${escapeHtml(rule.value || '')}" placeholder="Value..." aria-label="Rule Value">`}
                <button type="button" class="rule-delete-btn" title="Remove condition" aria-label="Remove condition">✕</button>
            </div>
        `;
    }).join('');

    // Attach listeners
    container.querySelectorAll('.visual-rule-row').forEach(rowEl => {
        const idx = parseInt(rowEl.dataset.ruleIndex, 10);
        const colSelect = rowEl.querySelector('.rule-col-select');
        const opSelect = rowEl.querySelector('.rule-op-select');
        const valInput = rowEl.querySelector('.rule-input');
        const delBtn = rowEl.querySelector('.rule-delete-btn');

        if (colSelect) {
            colSelect.addEventListener('change', (e) => {
                visualRules[idx].column = e.target.value;
                const colDef = TRIP_COLUMNS.find(c => c.name === e.target.value);
                visualRules[idx].operator = colDef?.type === 'number' ? 'greater_than' : 'contains';
                renderVisualRules();
            });
        }
        if (opSelect) {
            opSelect.addEventListener('change', (e) => {
                visualRules[idx].operator = e.target.value;
                renderVisualRules();
            });
        }
        if (valInput) {
            valInput.addEventListener('input', (e) => {
                visualRules[idx].value = e.target.value;
            });
        }
        if (delBtn) {
            delBtn.addEventListener('click', () => {
                visualRules.splice(idx, 1);
                renderVisualRules();
            });
        }
    });
}

function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Main filter and sort executor
 */
export function applyFiltersAndRender() {
    if (!allTrips || allTrips.length === 0) return;

    const query = filterState.searchQuery.toLowerCase();
    const isAllCategories = filterState.selectedCategories.has('all');
    const selectedYear = filterState.selectedYear;
    const selectedDelay = filterState.selectedDelay;
    const selectedBuddy = filterState.selectedBuddy;
    const selectedPurpose = filterState.selectedPurpose;

    filteredTrips = allTrips.filter(trip => {
        const train = trip.train || trip.checkin || {};
        const cat = normalizeCategory(train.category || 'regional');

        // 1. Category Filter
        if (!isAllCategories && !filterState.selectedCategories.has(cat)) {
            return false;
        }

        // 2. Year Filter
        const rawDate = train.origin?.departureReal || train.origin?.departure || trip.createdAt;
        if (selectedYear !== 'all') {
            if (!rawDate) return false;
            const tripYear = String(new Date(rawDate).getFullYear());
            if (tripYear !== selectedYear) return false;
        }

        // 3. Delay Tier Filter
        if (selectedDelay !== 'all') {
            const delays = deriveDelaySeconds(train);
            const arrivalDelayMin = delays.arrival !== null ? Math.round(delays.arrival / 60) : 0;
            if (selectedDelay === 'ontime' && arrivalDelayMin > 5) return false;
            if (selectedDelay === 'minor' && (arrivalDelayMin <= 5 || arrivalDelayMin > 15)) return false;
            if (selectedDelay === 'moderate' && (arrivalDelayMin <= 15 || arrivalDelayMin > 30)) return false;
            if (selectedDelay === 'severe' && arrivalDelayMin <= 30) return false;
            if (selectedDelay === 'delayed' && arrivalDelayMin <= 0) return false;
        }

        // 4. Companion Filter
        if (selectedBuddy !== 'all') {
            let mentions = trip.bodyMentions || trip.properties?.bodyMentions;
            if (typeof mentions === 'string') {
                try { mentions = JSON.parse(mentions); } catch (e) { mentions = []; }
            }
            if (!Array.isArray(mentions)) return false;
            const hasBuddy = mentions.some(m => {
                const u = (m.username || m.name || m || '').toLowerCase();
                return u === selectedBuddy;
            });
            if (!hasBuddy) return false;
        }

        // 5. Purpose Filter
        if (selectedPurpose !== 'all') {
            const bType = getTripBusinessType(trip);
            if (selectedPurpose === 'work' && bType !== 1) return false;
            if (selectedPurpose === 'commute' && bType !== 2) return false;
            if (selectedPurpose === 'personal' && bType !== 0) return false;
        }

        // 6. Free-Text Search
        if (query) {
            const line = (train.lineName || train.number || train.name || '').toLowerCase();
            const origin = (train.origin?.name || '').toLowerCase();
            const dest = (train.destination?.name || '').toLowerCase();
            const body = (trip.body || trip.properties?.body || '').toLowerCase();
            const operator = (train.operator?.name || '').toLowerCase();

            // Search tags
            const tags = extractTripTags(trip.properties || {}).concat(extractTripTags({ tags: train.tags }));
            const tagsText = tags.map(t => `${t.key} ${t.value}`).join(' ').toLowerCase();

            // Search mentions
            let mentionsText = '';
            let mentions = trip.bodyMentions || trip.properties?.bodyMentions;
            if (typeof mentions === 'string') try { mentions = JSON.parse(mentions); } catch (e) {}
            if (Array.isArray(mentions)) {
                mentionsText = mentions.map(m => m.username || m.name || m).join(' ').toLowerCase();
            }

            const matched = line.includes(query) ||
                            origin.includes(query) ||
                            dest.includes(query) ||
                            body.includes(query) ||
                            operator.includes(query) ||
                            tagsText.includes(query) ||
                            mentionsText.includes(query);
            if (!matched) return false;
        }

        return true;
    });

    // Sort Results
    sortTrips(filteredTrips, filterState.sortBy);

    // Update Telemetry Bar
    updateTelemetry(filteredTrips);

    // Render Table or Cards
    renderResults();
}

/**
 * Sort trips array in-place
 */
function sortTrips(trips, sortBy) {
    trips.sort((a, b) => {
        const trainA = a.train || a.checkin || {};
        const trainB = b.train || b.checkin || {};

        if (sortBy === 'date-desc') {
            const timeA = new Date(trainA.origin?.departureReal || trainA.origin?.departure || a.createdAt || 0).getTime();
            const timeB = new Date(trainB.origin?.departureReal || trainB.origin?.departure || b.createdAt || 0).getTime();
            return timeB - timeA;
        }
        if (sortBy === 'date-asc') {
            const timeA = new Date(trainA.origin?.departureReal || trainA.origin?.departure || a.createdAt || 0).getTime();
            const timeB = new Date(trainB.origin?.departureReal || trainB.origin?.departure || b.createdAt || 0).getTime();
            return timeA - timeB;
        }
        if (sortBy === 'dist-desc') {
            const distA = typeof trainA.totalDistance === 'number' ? trainA.totalDistance : (trainA.distance || 0);
            const distB = typeof trainB.totalDistance === 'number' ? trainB.totalDistance : (trainB.distance || 0);
            return distB - distA;
        }
        if (sortBy === 'dist-asc') {
            const distA = typeof trainA.totalDistance === 'number' ? trainA.totalDistance : (trainA.distance || 0);
            const distB = typeof trainB.totalDistance === 'number' ? trainB.totalDistance : (trainB.distance || 0);
            return distA - distB;
        }
        if (sortBy === 'delay-desc') {
            const delayA = deriveDelaySeconds(trainA).arrival || 0;
            const delayB = deriveDelaySeconds(trainB).arrival || 0;
            return delayB - delayA;
        }
        if (sortBy === 'dur-desc') {
            const durA = computeTripDurationMinutes(trainA);
            const durB = computeTripDurationMinutes(trainB);
            return durB - durA;
        }
        return 0;
    });
}

/**
 * Update Telemetry Header Chips
 */
function updateTelemetry(trips) {
    const countEl = document.getElementById('telemetryCount');
    const countSubEl = document.getElementById('telemetryCountSub');
    const distEl = document.getElementById('telemetryDistance');
    const distSubEl = document.getElementById('telemetryDistanceSub');
    const punctEl = document.getElementById('telemetryPunctuality');
    const durEl = document.getElementById('telemetryDuration');
    const durSubEl = document.getElementById('telemetryDurationSub');
    const ecoEl = document.getElementById('telemetryEco');
    const ecoSubEl = document.getElementById('telemetryEcoSub');

    let totalDistMeters = 0;
    let onTimeCount = 0;
    let totalMinutes = 0;

    trips.forEach(t => {
        const train = t.train || t.checkin || {};
        totalDistMeters += (typeof train.totalDistance === 'number' ? train.totalDistance : (train.distance || 0));
        const delays = deriveDelaySeconds(train);
        const arrDelay = delays.arrival !== null ? delays.arrival : 0;
        if (arrDelay <= 300) { // <= 5 min is on-time
            onTimeCount++;
        }
        totalMinutes += computeTripDurationMinutes(train);
    });

    const distKm = Math.round(totalDistMeters / 1000);
    const punctRate = trips.length > 0 ? Math.round((onTimeCount / trips.length) * 100) : 100;
    const totalHours = Math.round(totalMinutes / 60);
    const timeInfo = formatTotalTime(totalHours);
    const eco = calculateCO2Saved(distKm);

    if (countEl) countEl.textContent = trips.length.toLocaleString();
    if (countSubEl) countSubEl.textContent = `of ${allTrips.length.toLocaleString()} total journeys`;
    if (distEl) distEl.textContent = `${distKm.toLocaleString()} km`;
    if (distSubEl) distSubEl.textContent = `${(distKm / 40075).toFixed(1)}x Earth laps`;
    if (punctEl) punctEl.textContent = `${punctRate}%`;

    if (durEl) {
        if (durationDisplayMode === 'days') {
            durEl.textContent = timeInfo.primary;
        } else if (durationDisplayMode === 'months') {
            durEl.textContent = `~${timeInfo.months} mo`;
        } else {
            durEl.textContent = `${totalHours.toLocaleString()} hrs`;
        }
    }

    if (durSubEl) {
        if (durationDisplayMode === 'days') {
            durSubEl.textContent = `${timeInfo.secondary} (click to toggle)`;
        } else if (durationDisplayMode === 'months') {
            durSubEl.textContent = `${timeInfo.primary} (${totalHours.toLocaleString()} hrs)`;
        } else {
            durSubEl.textContent = `~${timeInfo.days} days on tracks • click to toggle`;
        }
    }

    if (ecoEl) ecoEl.textContent = `${eco.tonnes} tonnes`;
    if (ecoSubEl) ecoSubEl.textContent = `~${eco.kg.toLocaleString()} kg CO₂ avoided vs car`;
}

/**
 * Render paginated results into Table and Cards
 */
function renderResults() {
    const countText = document.getElementById('resultsCountText');
    const summaryText = document.getElementById('paginationSummary');
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');

    const isStudio = (appMode === 'studio' && Boolean(sqlQueryResult));
    const isStudioCustom = (isStudio && !sqlQueryResult.isSelectAll);
    let total = filteredTrips.length;
    let pageItems = [];

    if (isStudio) {
        if (sqlQueryResult.error) {
            total = 0;
            pageItems = [];
        } else if (sqlQueryResult.isSelectAll) {
            total = (sqlQueryResult.rawTrips || []).length;
        } else {
            total = (sqlQueryResult.rows || []).length;
        }
    }

    const totalPages = Math.max(1, Math.ceil(total / filterState.pageSize));
    if (filterState.page > totalPages) filterState.page = totalPages;

    const startIdx = (filterState.page - 1) * filterState.pageSize;
    const endIdx = Math.min(total, startIdx + filterState.pageSize);

    if (isStudio) {
        if (sqlQueryResult.error) {
            pageItems = [];
        } else if (sqlQueryResult.isSelectAll) {
            pageItems = (sqlQueryResult.rawTrips || []).slice(startIdx, endIdx);
        } else {
            pageItems = (sqlQueryResult.rows || []).slice(startIdx, endIdx);
        }
    } else {
        pageItems = filteredTrips.slice(startIdx, endIdx);
    }

    if (countText) {
        if (isStudio && sqlQueryResult?.error) {
            countText.innerHTML = `<span style="color: var(--accent-danger);">SQL Syntax Error</span>`;
        } else {
            countText.innerHTML = total > 0
                ? `Showing <strong>${startIdx + 1}–${endIdx}</strong> of <strong>${total.toLocaleString()}</strong> matching ${isStudio ? 'records' : 'journeys'}`
                : `No ${isStudio ? 'records' : 'journeys'} match the active ${isStudio ? 'SQL query' : 'filters'}`;
        }
    }

    if (summaryText) summaryText.textContent = `Page ${filterState.page} of ${totalPages}`;
    if (prevBtn) prevBtn.disabled = (filterState.page <= 1);
    if (nextBtn) nextBtn.disabled = (filterState.page >= totalPages);

    // 1. Render Table
    const thead = document.querySelector('.trips-table thead');
    if (thead) {
        if (isStudioCustom) {
            thead.innerHTML = `
                <tr>
                    ${sqlQueryResult.columns.map(c => {
                        const colDef = TRIP_COLUMNS.find(col => col.name === c);
                        return `<th>${escapeHtml(colDef?.label || c)}</th>`;
                    }).join('')}
                    <th>Actions</th>
                </tr>
            `;
        } else {
            thead.innerHTML = `
                <tr>
                    <th class="sortable" data-sort="date">Departure</th>
                    <th>Line / Mode</th>
                    <th>Origin</th>
                    <th>Destination</th>
                    <th class="sortable" data-sort="dist">Distance</th>
                    <th class="sortable" data-sort="dur">Duration</th>
                    <th class="sortable" data-sort="delay">Delay</th>
                    <th>Companions</th>
                    <th>Actions</th>
                </tr>
            `;
        }
    }

    const tbody = document.getElementById('tripsTableBody');
    if (tbody) {
        if (pageItems.length === 0) {
            const colSpan = isStudioCustom ? (sqlQueryResult?.columns?.length || 1) + 1 : 9;
            const errorMsg = isStudio && sqlQueryResult?.error;
            tbody.innerHTML = `
                <tr>
                    <td colspan="${colSpan}" style="text-align: center; padding: 48px 16px;">
                        <div style="font-size: 38px; margin-bottom: 8px;">${errorMsg ? '⚠️' : '🔍'}</div>
                        <div style="font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">
                            ${errorMsg ? 'SQL Query Error' : (isStudio ? 'No records match your SQL query' : 'No journeys match your active filters')}
                        </div>
                        <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 14px;">
                            ${errorMsg ? escapeHtml(sqlQueryResult.error) : (isStudio ? 'Try checking your WHERE conditions, column names, or table names.' : 'Try loosening your search query, transport category, or delay tier.')}
                        </div>
                        ${isStudio ? `<button type="button" class="studio-action-btn primary" id="emptyTableResetBtn">Reset to Default Query</button>` : `<button type="button" class="studio-action-btn primary" id="emptyTableResetBtn">Reset All Filters</button>`}
                    </td>
                </tr>
            `;
            const emptyResetBtn = tbody.querySelector('#emptyTableResetBtn');
            if (emptyResetBtn) {
                emptyResetBtn.addEventListener('click', () => {
                    if (isStudio) {
                        const defaultSql = QUERY_RECIPES[0].sql;
                        const input = document.getElementById('sqlQueryInput');
                        if (input) input.value = defaultSql;
                        runSqlQuery(defaultSql);
                    } else {
                        const rBtn = document.getElementById('resetFiltersBtn');
                        if (rBtn) rBtn.click();
                    }
                });
            }
        } else if (isStudioCustom) {
            tbody.innerHTML = pageItems.map(row => {
                const cells = sqlQueryResult.columns.map(col => {
                    const val = row[col];
                    if (col === 'line') {
                        return `<td data-label="${escapeHtml(col)}"><span class="line-badge ${row.category || 'regional'}">${escapeHtml(val || 'Train')}</span></td>`;
                    }
                    if (col === 'delay_dep' || col === 'delay_arr') {
                        const min = Number(val) || 0;
                        let delayPillClass = 'on-time';
                        if (min > 30) delayPillClass = 'severe';
                        else if (min > 15) delayPillClass = 'moderate';
                        else if (min > 5) delayPillClass = 'minor';
                        const text = min > 0 ? `+${min}m` : (min < 0 ? `${min}m` : 'On-time');
                        return `<td data-label="${escapeHtml(col)}"><span class="delay-pill ${delayPillClass}">${text}</span></td>`;
                    }
                    if (col === 'distance_km') {
                        return `<td data-label="${escapeHtml(col)}">${val} km</td>`;
                    }
                    if (col === 'duration_min') {
                        const durStr = val > 0 ? `${Math.floor(val / 60)}h ${val % 60}m` : '—';
                        return `<td data-label="${escapeHtml(col)}">${durStr}</td>`;
                    }
                    if (col === 'departure' || col === 'arrival') {
                        const dateStr = val ? new Date(val).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
                        const timeStr = val ? new Date(val).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '';
                        return `<td data-label="${escapeHtml(col)}">${dateStr} <span style="color: var(--text-muted); font-size: 11px;">${timeStr}</span></td>`;
                    }
                    return `<td data-label="${escapeHtml(col)}">${val !== null && val !== undefined ? escapeHtml(val) : '—'}</td>`;
                }).join('');

                const hasRealTrip = row.id && allTrips.some(t => String(t.id) === String(row.id));

                return `
                    <tr data-trip-id="${row.id}">
                        ${cells}
                        <td data-label="Actions">
                            ${hasRealTrip ? `
                                <button type="button" class="nav-link-btn inspect-trip-btn" data-trip-id="${row.id}" style="padding: 4px 8px; font-size: 11px;">
                                    🔍 Inspect
                                </button>
                            ` : '—'}
                        </td>
                    </tr>
                `;
            }).join('');
        } else {
            tbody.innerHTML = pageItems.map(trip => {
                const train = trip.train || trip.checkin || {};
                const cat = normalizeCategory(train.category || 'regional');
                const lineName = train.lineName || train.number || train.name || 'Train';
                const origin = train.origin?.name || '—';
                const dest = train.destination?.name || '—';
                const rawDist = typeof train.totalDistance === 'number' ? train.totalDistance : (train.distance || 0);
                const distKm = (rawDist / 1000).toFixed(1);
                const durationMin = computeTripDurationMinutes(train);
                const durStr = durationMin > 0 ? `${Math.floor(durationMin / 60)}h ${durationMin % 60}m` : '—';

                const delays = deriveDelaySeconds(train);
                const arrDelaySec = delays.arrival !== null ? delays.arrival : 0;
                const arrDelayMin = Math.round(arrDelaySec / 60);

                let delayPillClass = 'on-time';
                if (arrDelayMin > 30) delayPillClass = 'severe';
                else if (arrDelayMin > 15) delayPillClass = 'moderate';
                else if (arrDelayMin > 5) delayPillClass = 'minor';

                const delayText = arrDelayMin > 0 ? `+${arrDelayMin}m` : (arrDelayMin < 0 ? `${arrDelayMin}m` : 'On-time');

                const rawDate = train.origin?.departureReal || train.origin?.departure || trip.createdAt;
                const dateStr = rawDate ? new Date(rawDate).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
                const timeStr = rawDate ? new Date(rawDate).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '';

                // Companions
                let mentions = trip.bodyMentions || trip.properties?.bodyMentions;
                if (typeof mentions === 'string') try { mentions = JSON.parse(mentions); } catch (e) {}
                const buddyStr = Array.isArray(mentions) && mentions.length > 0
                    ? mentions.map(m => `@${escapeHtml(m.username || m.name || m)}`).join(', ')
                    : '—';

                return `
                    <tr data-trip-id="${trip.id}">
                        <td data-label="Departure">${dateStr} <span style="color: var(--text-muted); font-size: 11px;">${timeStr}</span></td>
                        <td data-label="Line"><span class="line-badge ${cat}">${escapeHtml(lineName)}</span></td>
                        <td data-label="Origin"><strong>${escapeHtml(origin)}</strong></td>
                        <td data-label="Destination"><strong>${escapeHtml(dest)}</strong></td>
                        <td data-label="Distance">${distKm} km</td>
                        <td data-label="Duration">${durStr}</td>
                        <td data-label="Delay"><span class="delay-pill ${delayPillClass}">${delayText}</span></td>
                        <td data-label="Companions" style="max-width: 150px; overflow: hidden; text-overflow: ellipsis;">${buddyStr}</td>
                        <td data-label="Actions">
                            <button type="button" class="nav-link-btn inspect-trip-btn" data-trip-id="${trip.id}" style="padding: 4px 8px; font-size: 11px;">
                                🔍 Inspect
                            </button>
                        </td>
                    </tr>
                `;
            }).join('');
        }
    }

    // 2. Render Cards
    const cardsGrid = document.getElementById('cardViewContainer');
    if (cardsGrid) {
        if (pageItems.length === 0) {
            cardsGrid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-muted);">No journeys found matching your search.</div>`;
        } else {
            cardsGrid.innerHTML = pageItems.map(trip => {
                const train = trip.train || trip.checkin || {};
                const cat = normalizeCategory(train.category || 'regional');
                const lineName = train.lineName || train.number || train.name || 'Train';
                const origin = train.origin?.name || '—';
                const dest = train.destination?.name || '—';
                const rawDist = typeof train.totalDistance === 'number' ? train.totalDistance : (train.distance || 0);
                const distKm = (rawDist / 1000).toFixed(1);
                const durationMin = computeTripDurationMinutes(train);
                const durStr = durationMin > 0 ? `${Math.floor(durationMin / 60)}h ${durationMin % 60}m` : '—';

                const delays = deriveDelaySeconds(train);
                const arrDelaySec = delays.arrival !== null ? delays.arrival : 0;
                const arrDelayMin = Math.round(arrDelaySec / 60);

                let delayPillClass = 'on-time';
                if (arrDelayMin > 30) delayPillClass = 'severe';
                else if (arrDelayMin > 15) delayPillClass = 'moderate';
                else if (arrDelayMin > 5) delayPillClass = 'minor';
                const delayText = arrDelayMin > 0 ? `+${arrDelayMin}m` : (arrDelayMin < 0 ? `${arrDelayMin}m` : 'On-time');

                const rawDate = train.origin?.departureReal || train.origin?.departure || trip.createdAt;
                const dateStr = rawDate ? new Date(rawDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

                return `
                    <div class="trip-card" data-trip-id="${trip.id}">
                        <div class="trip-card-header">
                            <span class="line-badge ${cat}">${escapeHtml(lineName)}</span>
                            <span class="trip-card-date">${dateStr}</span>
                        </div>
                        <div class="trip-card-route">
                            <div class="trip-card-station">📍 ${escapeHtml(origin)}</div>
                            <div class="trip-card-arrow">↓</div>
                            <div class="trip-card-station">🏁 ${escapeHtml(dest)}</div>
                        </div>
                        <div class="trip-card-footer">
                            <span>${distKm} km · ${durStr}</span>
                            <span class="delay-pill ${delayPillClass}">${delayText}</span>
                        </div>
                    </div>
                `;
            }).join('');
        }
    }

    // Attach row/card click listeners to open detail modal
    document.querySelectorAll('#tripsTableBody tr[data-trip-id], .trip-card[data-trip-id]').forEach(el => {
        el.addEventListener('click', (e) => {
            const tripId = el.dataset.tripId;
            const trip = allTrips.find(t => String(t.id) === String(tripId));
            if (trip) openTripDetailModal(trip);
        });
    });
}

/**
 * Open Trip Detail Inspector Modal
 */
export function openTripDetailModal(trip) {
    const modal = document.getElementById('tripDetailModal');
    if (!modal) return;

    const train = trip.train || trip.checkin || {};
    const cat = normalizeCategory(train.category || 'regional');
    const lineName = train.lineName || train.number || train.name || 'Train';
    const origin = train.origin?.name || '—';
    const dest = train.destination?.name || '—';
    const operator = train.operator?.name || train.operator?.identifier || train.provider?.name || train.provider || '—';

    const originPlanned = train.origin?.departurePlanned ? formatTime(train.origin.departurePlanned) : '—';
    const originReal = train.origin?.departureReal ? formatTime(train.origin.departureReal) : originPlanned;
    const destPlanned = train.destination?.arrivalPlanned ? formatTime(train.destination.arrivalPlanned) : '—';
    const destReal = train.destination?.arrivalReal ? formatTime(train.destination.arrivalReal) : destPlanned;

    const originPlatform = train.origin?.departurePlatformReal || train.origin?.platform || '—';
    const destPlatform = train.destination?.arrivalPlatformReal || train.destination?.platform || '—';

    const rawDist = typeof train.totalDistance === 'number' ? train.totalDistance : (train.distance || 0);
    const distKm = Math.round(rawDist / 1000);
    const durationMin = computeTripDurationMinutes(train);
    const durStr = durationMin > 0 ? formatHumanDuration(durationMin) : '—';
    const speedStr = formatSpeed(distKm, durationMin);

    const delays = deriveDelaySeconds(train);
    const arrDelaySec = delays.arrival !== null ? delays.arrival : 0;
    const arrDelayMin = Math.round(arrDelaySec / 60);
    const delayFormatted = arrDelayMin > 0 ? `+${arrDelayMin} min late` : (arrDelayMin < 0 ? `${Math.abs(arrDelayMin)} min early` : 'Punctual (On-time)');

    const seat = trip.properties?.seat || train.seat?.number || train.seat || '—';
    const wagon = trip.properties?.wagon || train.seat?.wagon || train.wagon || '—';
    const ticket = trip.properties?.ticket?.name || trip.properties?.ticket || train.ticket?.name || train.ticket || '—';

    // Store active modal trip for export actions
    currentModalTrip = trip;

    // Modal elements
    document.getElementById('modalLineBadge').textContent = lineName;
    document.getElementById('modalLineBadge').className = `line-badge ${cat}`;
    document.getElementById('modalTripTitle').textContent = `${origin} ➔ ${dest}`;

    document.getElementById('modalOrigin').textContent = origin;
    document.getElementById('modalDepartureTime').textContent = `Sched: ${originPlanned} · Actual: ${originReal}`;
    document.getElementById('modalOriginPlatform').textContent = `Platform ${originPlatform}`;

    document.getElementById('modalDest').textContent = dest;
    document.getElementById('modalArrivalTime').textContent = `Sched: ${destPlanned} · Actual: ${destReal}`;
    document.getElementById('modalDestPlatform').textContent = `Platform ${destPlatform}`;

    document.getElementById('modalDistance').textContent = `${distKm} km${speedStr !== '—' ? ` (Avg: ${speedStr})` : ''}`;
    document.getElementById('modalDuration').textContent = durStr;
    document.getElementById('modalDelay').textContent = delayFormatted;
    document.getElementById('modalOperator').textContent = operator;
    document.getElementById('modalSeat').textContent = `Wagon ${wagon}, Seat ${seat}`;
    document.getElementById('modalTicket').textContent = String(ticket);

    // Buddies
    const buddiesSec = document.getElementById('modalBuddiesSection');
    const buddiesList = document.getElementById('modalBuddiesList');
    let mentions = trip.bodyMentions || trip.properties?.bodyMentions;
    if (typeof mentions === 'string') try { mentions = JSON.parse(mentions); } catch (e) {}
    if (Array.isArray(mentions) && mentions.length > 0) {
        buddiesSec.style.display = 'block';
        buddiesList.innerHTML = mentions.map(m => {
            const u = m.username || m.name || m;
            return `<a href="https://traewelling.de/@${escapeHtml(u)}" target="_blank" class="nav-link-btn" style="padding: 2px 8px; font-size: 11px;">@${escapeHtml(u)}</a>`;
        }).join('');
    } else {
        buddiesSec.style.display = 'none';
    }

    // Notes
    const notesSec = document.getElementById('modalNotesSection');
    const notesText = document.getElementById('modalNotesText');
    const body = trip.body || trip.properties?.body;
    if (body && body.trim()) {
        notesSec.style.display = 'block';
        notesText.textContent = body.trim();
    } else {
        notesSec.style.display = 'none';
    }

    // Traewelling Status Link
    const traewellingLink = document.getElementById('modalTraewellingLink');
    if (traewellingLink) {
        traewellingLink.href = `https://traewelling.de/status/${trip.id}`;
    }

    // Map Deep-Link
    const mapLink = document.getElementById('modalMapLink');
    if (mapLink) {
        mapLink.href = `index.html?user=${encodeURIComponent(activeSession?.username || '')}&trip=${trip.id}`;
    }

    modal.showModal();
}

/**
 * Format timestamp to HH:mm
 */
function formatTime(isoStr) {
    if (!isoStr) return '—';
    try {
        const d = new Date(isoStr);
        return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
        return '—';
    }
}

/**
 * Update URL parameters to reflect active filters
 */
function updateUrlParams() {
    const params = new URLSearchParams();
    if (activeSession?.username) params.set('user', activeSession.username);
    if (filterState.searchQuery) params.set('search', filterState.searchQuery);
    if (filterState.selectedYear !== 'all') params.set('year', filterState.selectedYear);
    if (!filterState.selectedCategories.has('all')) {
        params.set('category', Array.from(filterState.selectedCategories)[0]);
    }
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, '', newUrl);
}

/**
 * Display empty state when no sessions exist
 */
function showEmptyState() {
    const main = document.querySelector('.trips-container');
    if (main) {
        main.innerHTML = `
            <div style="text-align: center; padding: 60px 20px; max-width: 600px; margin: 60px auto; background: var(--bg-panel); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg);">
                <div style="font-size: 54px; margin-bottom: 16px;">🗂️</div>
                <h2 style="font-family: var(--font-heading); margin: 0 0 12px; font-size: 1.8rem;">No Travel Journeys Found Yet</h2>
                <p style="color: var(--text-secondary); font-size: 15px; margin: 0 0 24px;">
                    Start by exploring any Träwelling user profile or uploading exported GeoJSON data on the main interactive map.
                </p>
                <div style="display: flex; justify-content: center; gap: 12px;">
                    <a href="index.html" class="nav-link-btn primary" style="padding: 12px 24px; font-size: 14px; border-radius: 24px;">
                        Open Map Explorer
                    </a>
                </div>
            </div>
        `;
    }
}

