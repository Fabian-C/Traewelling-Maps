import { SessionDB } from '../cache/session.js';
import { Storage, STORAGE_KEYS } from '../storage/storage.js';
import { tripsToGeoJSON } from '../export/geojson.js';
import { getTripBuddies, renderLinkedComment } from './formatters.js';
import { deriveDelaySeconds, computeTripDurationMinutes } from '../utils/time.js';
import { formatDelayMinutes, formatHumanDuration, formatTotalTime, calculateCO2Saved, formatSpeed, escapeHtml } from '../utils/format.js';
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
let studioTableMode = Storage.get(STORAGE_KEYS.STUDIO_TABLE_MODE, 'unified'); // 'unified' | 'raw'
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

    // Synchronous storage session fallback
    if (allSessions.length === 0) {
        const parsed = Storage.getJSON(STORAGE_KEYS.SESSIONS_DATA, null);
        if (Array.isArray(parsed) && parsed.length > 0) {
            allSessions = parsed;
        }
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
                        origin: { name: "Hamburg Landungsbrücken", departureReal: "2022-04-16T16:50:00Z", latitude: 53.546314, longitude: 9.970619 },
                        destination: { name: "Dockland", arrivalReal: "2022-04-16T17:15:00Z", latitude: 53.543024, longitude: 9.935498 },
                        polyline: {
                            type: "Feature",
                            geometry: { type: "LineString", coordinates: [[9.970619, 53.546314], [9.952236, 53.54395], [9.935498, 53.543024]] },
                            properties: { statusId: 325374 }
                        }
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
                        origin: { name: "Friedrichstraße", departureReal: "2026-10-11T18:46:00Z", latitude: 52.520424, longitude: 13.38635 },
                        destination: { name: "Alexanderplatz", arrivalReal: "2026-10-11T18:58:00Z", latitude: 52.522, longitude: 13.411 },
                        polyline: {
                            type: "Feature",
                            geometry: { type: "LineString", coordinates: [[13.38635, 52.520424], [13.400, 52.521], [13.411, 52.522]] },
                            properties: { statusId: 9309802 }
                        }
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
                        origin: { name: "Hamburg Hbf", departureReal: "2026-10-12T10:00:00Z", latitude: 53.5533, longitude: 10.0069 },
                        destination: { name: "Berlin Hbf", arrivalReal: "2026-10-12T11:45:00Z", latitude: 52.5255, longitude: 13.3695 },
                        polyline: {
                            type: "Feature",
                            geometry: {
                                type: "LineString",
                                coordinates: [[10.0069, 53.5533], [13.3695, 52.5255]]
                            },
                            properties: { statusId: 8877665 }
                        }
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
            try {
                await SessionDB.save(activeSession.username, activeSession.trips, { displayName: activeSession.displayName });
            } catch (e) {}
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
            if (appMode === 'studio' && sqlQueryResult?.rawTrips) {
                sortTrips(sqlQueryResult.rawTrips, filterState.sortBy);
                renderResults();
            } else {
                applyFiltersAndRender();
            }
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
            const sqlTableToggle = document.getElementById('sqlTableModeToggle');
            if (sqlTableToggle && appMode === 'studio') {
                sqlTableToggle.style.display = 'inline-flex';
            }
        });

        viewCardsBtn.addEventListener('click', () => {
            filterState.viewMode = 'cards';
            viewCardsBtn.classList.add('active');
            viewTableBtn.classList.remove('active');
            tableView.style.display = 'none';
            cardsView.style.display = 'grid';
            const sqlTableToggle = document.getElementById('sqlTableModeToggle');
            if (sqlTableToggle) {
                sqlTableToggle.style.display = 'none';
            }
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
                ? (sqlQueryResult.rawTrips?.length || sqlQueryResult.rows?.length || 0)
                : filteredTrips.length;
            const maxPage = Math.ceil(totalItems / filterState.pageSize);
            if (filterState.page < maxPage) {
                filterState.page++;
                renderResults();
                window.scrollTo({ top: 300, behavior: 'smooth' });
            }
        });
    }

    // Telemetry Duration Unit Switcher
    const durChip = document.getElementById('telemetryDurationChip');
    if (durChip) {
        const cycleDuration = () => {
            if (durationDisplayMode === 'standard') {
                durationDisplayMode = 'days';
            } else if (durationDisplayMode === 'days') {
                durationDisplayMode = 'months';
            } else {
                durationDisplayMode = 'standard';
            }
            const activeTrips = (appMode === 'studio' && sqlQueryResult?.rawTrips) ? sqlQueryResult.rawTrips : filteredTrips;
            updateTelemetry(activeTrips);
        };

        durChip.addEventListener('click', cycleDuration);
        durChip.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                cycleDuration();
            }
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

    // Modal Close (Button + Backdrop Click)
    const modalCloseBtn = document.getElementById('closeModalBtn');
    const modal = document.getElementById('tripDetailModal');
    if (modalCloseBtn && modal) {
        modalCloseBtn.addEventListener('click', () => modal.close());
        modal.addEventListener('click', (e) => {
            const rect = modal.getBoundingClientRect();
            if (
                e.clientX < rect.left ||
                e.clientX > rect.right ||
                e.clientY < rect.top ||
                e.clientY > rect.bottom
            ) {
                modal.close();
            }
        });
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

export { getTripBuddies, renderLinkedComment };
window.getTripBuddies = getTripBuddies;
window.renderLinkedComment = renderLinkedComment;

/**
 * Populate Travel Buddy selector
 */
function populateBuddyDropdown(trips) {
    const select = document.getElementById('buddySelect');
    if (!select) return;

    const buddyCounts = new Map();
    trips.forEach(t => {
        const buddies = getTripBuddies(t, activeSession?.username);
        buddies.forEach(b => {
            const clean = b.username.toLowerCase();
            buddyCounts.set(clean, (buddyCounts.get(clean) || 0) + 1);
        });
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

    const sqlTableToggle = document.getElementById('sqlTableModeToggle');
    const btnTableUnified = document.getElementById('btnTableUnified');
    const btnTableRawSql = document.getElementById('btnTableRawSql');

    const updateSqlTableModeButtons = () => {
        if (sqlTableToggle) {
            sqlTableToggle.style.display = (appMode === 'studio') ? 'inline-flex' : 'none';
        }
        if (btnTableUnified && btnTableRawSql) {
            if (studioTableMode === 'raw') {
                btnTableRawSql.classList.add('active');
                btnTableUnified.classList.remove('active');
            } else {
                btnTableUnified.classList.add('active');
                btnTableRawSql.classList.remove('active');
            }
        }
    };
    updateSqlTableModeButtons();

    if (btnTableUnified && btnTableRawSql) {
        btnTableUnified.addEventListener('click', () => {
            studioTableMode = 'unified';
            Storage.set(STORAGE_KEYS.STUDIO_TABLE_MODE, 'unified');
            updateSqlTableModeButtons();
            renderResults();
        });

        btnTableRawSql.addEventListener('click', () => {
            studioTableMode = 'raw';
            Storage.set(STORAGE_KEYS.STUDIO_TABLE_MODE, 'raw');
            updateSqlTableModeButtons();
            renderResults();
        });
    }

    if (modeStandardBtn && modeStudioBtn) {
        modeStandardBtn.addEventListener('click', () => {
            appMode = 'standard';
            modeStandardBtn.classList.add('active');
            modeStudioBtn.classList.remove('active');
            if (filterPanel) filterPanel.style.display = 'flex';
            if (studioPanel) studioPanel.style.display = 'none';
            updateSqlTableModeButtons();
            applyFiltersAndRender();
        });

        modeStudioBtn.addEventListener('click', () => {
            appMode = 'studio';
            modeStudioBtn.classList.add('active');
            modeStandardBtn.classList.remove('active');
            if (filterPanel) filterPanel.style.display = 'none';
            if (studioPanel) studioPanel.style.display = 'flex';
            updateSqlTableModeButtons();
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
                <span>↑/↓ navigate • ↵ / Tab apply</span>
                <button type="button" class="sql-ac-close-btn" aria-label="Dismiss suggestions">✕ Close</button>
            </div>
        `;

        acPopover.style.display = 'flex';

        acPopover.querySelectorAll('.sql-ac-item').forEach(itemEl => {
            const handleSelect = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const idx = parseInt(itemEl.dataset.acIndex, 10);
                applyAC(idx);
            };
            itemEl.addEventListener('pointerdown', handleSelect);
            itemEl.addEventListener('click', handleSelect);
            itemEl.addEventListener('mouseenter', () => {
                activeACIndex = parseInt(itemEl.dataset.acIndex, 10);
                updateACActiveItem();
            });
        });

        const closeBtn = acPopover.querySelector('.sql-ac-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                acPopover.style.display = 'none';
            });
            closeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                acPopover.style.display = 'none';
            });
        }
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
                const currentVal = sqlInput.value.trim();
                const hasFrom = /\bFROM\s+trips\b/i.test(currentVal);
                if (snippet.startsWith('SELECT *')) {
                    sqlInput.value = snippet;
                } else if (!currentVal || !currentVal.toUpperCase().startsWith('SELECT')) {
                    sqlInput.value = `SELECT * FROM trips ${snippet}`;
                } else if (!hasFrom && snippet.startsWith('WHERE')) {
                    sqlInput.value = `${currentVal} FROM trips ${snippet}`;
                } else if (!hasFrom && snippet.startsWith('ORDER BY')) {
                    sqlInput.value = `${currentVal} FROM trips ${snippet}`;
                } else if (snippet.startsWith('WHERE') && currentVal.toUpperCase().includes('WHERE')) {
                    const extraCond = snippet.replace(/^WHERE\s+/i, '');
                    if (currentVal.toUpperCase().includes('ORDER BY')) {
                        const parts = currentVal.split(/ORDER\s+BY/i);
                        sqlInput.value = `${parts[0].trim()} AND ${extraCond} ORDER BY${parts[1]}`;
                    } else {
                        sqlInput.value = `${currentVal} AND ${extraCond}`;
                    }
                } else if (snippet.startsWith('ORDER BY') && currentVal.toUpperCase().includes('ORDER BY')) {
                    const base = currentVal.replace(/ORDER\s+BY\s+.*$/i, '').trim();
                    sqlInput.value = `${base} ${snippet}`;
                } else {
                    sqlInput.value = `${currentVal} ${snippet}`;
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

const VISUAL_CATEGORY_OPTIONS = [
    { value: 'highspeed', label: '🚄 High-Speed (ICE/TGV)' },
    { value: 'regional', label: '🚆 Regional (RE/RB)' },
    { value: 'suburban', label: '🚈 Suburban (S-Bahn)' },
    { value: 'subway', label: '🚇 Subway (U-Bahn)' },
    { value: 'tram', label: '🚊 Tram / Streetcar' },
    { value: 'bus', label: '🚌 Bus' },
    { value: 'ferry', label: '⛴️ Ferry' }
];

const VISUAL_BUSINESS_OPTIONS = [
    { value: 'private', label: '🌴 Private / Leisure' },
    { value: 'commute', label: '💼 Commute' },
    { value: 'business', label: '👔 Business / Work' }
];

/**
 * Render visual filter rule rows
 */
function renderVisualRules() {
    const container = document.getElementById('visualRulesContainer');
    if (!container) return;

    if (!visualRules.length) {
        container.innerHTML = `<div class="visual-rules-empty">No conditions set. All journeys match. Click <strong>➕ Add Condition</strong> above.</div>`;
        return;
    }

    container.innerHTML = visualRules.map((rule, idx) => {
        const colOptions = TRIP_COLUMNS.map(c => `
            <option value="${c.name}" ${c.name === rule.column ? 'selected' : ''}>${c.label} (${c.name})</option>
        `).join('');

        const selectedCol = TRIP_COLUMNS.find(c => c.name === rule.column);
        const isNum = selectedCol?.type === 'number';
        const isDate = selectedCol?.type === 'datetime';
        const isCategory = rule.column === 'category';
        const isBusiness = rule.column === 'business';

        let operators;
        if (isNum) {
            operators = [
                { id: 'greater_than', label: '> greater than' },
                { id: 'less_than', label: '< less than' },
                { id: 'greater_equal', label: '>= at least' },
                { id: 'less_equal', label: '<= at most' },
                { id: 'equals', label: '= equals' },
                { id: 'not_equals', label: '!= not equals' },
                { id: 'is_empty', label: 'is empty (NULL)' },
                { id: 'is_not_empty', label: 'is not empty' }
            ];
        } else if (isDate) {
            operators = [
                { id: 'after', label: '📅 on or after (>=)' },
                { id: 'before', label: '📅 on or before (<=)' },
                { id: 'equals', label: '= exact date' },
                { id: 'is_empty', label: 'is empty (NULL)' },
                { id: 'is_not_empty', label: 'is not empty' }
            ];
        } else if (isCategory) {
            operators = [
                { id: 'equals', label: 'is mode (=)' },
                { id: 'not_equals', label: 'is not mode (!=)' },
                { id: 'is_empty', label: 'is empty' },
                { id: 'is_not_empty', label: 'is not empty' }
            ];
        } else if (isBusiness) {
            operators = [
                { id: 'equals', label: 'is purpose (=)' },
                { id: 'not_equals', label: 'is not purpose (!=)' },
                { id: 'is_empty', label: 'is empty' },
                { id: 'is_not_empty', label: 'is not empty' }
            ];
        } else {
            operators = [
                { id: 'contains', label: 'contains' },
                { id: 'starts_with', label: 'starts with' },
                { id: 'equals', label: 'equals' },
                { id: 'not_equals', label: 'does not equal' },
                { id: 'is_empty', label: 'is empty' },
                { id: 'is_not_empty', label: 'is not empty' }
            ];
        }

        const opOptions = operators.map(o => `
            <option value="${o.id}" ${o.id === rule.operator ? 'selected' : ''}>${o.label}</option>
        `).join('');

        const hideValue = rule.operator === 'is_empty' || rule.operator === 'is_not_empty';

        let valueControlHtml = '';
        if (!hideValue) {
            if (isCategory) {
                const catOpts = VISUAL_CATEGORY_OPTIONS.map(c => `
                    <option value="${c.value}" ${rule.value === c.value ? 'selected' : ''}>${c.label}</option>
                `).join('');
                valueControlHtml = `<select class="rule-select rule-val-element rule-val-select" aria-label="Select Category">${catOpts}</select>`;
            } else if (isBusiness) {
                const bizOpts = VISUAL_BUSINESS_OPTIONS.map(b => `
                    <option value="${b.value}" ${rule.value === b.value ? 'selected' : ''}>${b.label}</option>
                `).join('');
                valueControlHtml = `<select class="rule-select rule-val-element rule-val-select" aria-label="Select Purpose">${bizOpts}</select>`;
            } else if (isDate) {
                valueControlHtml = `<input type="date" class="rule-input rule-val-element rule-val-date" value="${escapeHtml(rule.value || '')}" aria-label="Filter Date" placeholder="YYYY-MM-DD">`;
            } else if (isNum) {
                valueControlHtml = `<input type="number" class="rule-input rule-val-element" value="${escapeHtml(rule.value ?? '')}" placeholder="Value..." step="any" aria-label="Filter Number">`;
            } else {
                valueControlHtml = `<input type="text" class="rule-input rule-val-element" value="${escapeHtml(rule.value || '')}" placeholder="Value or text..." aria-label="Filter Text">`;
            }
        }

        return `
            <div class="visual-rule-row" data-rule-index="${idx}">
                <div class="rule-field-col">
                    <select class="rule-select rule-col-select" aria-label="Select Column">${colOptions}</select>
                </div>
                <div class="rule-field-op">
                    <select class="rule-select rule-op-select" aria-label="Select Operator">${opOptions}</select>
                </div>
                <div class="rule-field-val ${hideValue ? 'val-hidden' : ''}">
                    ${valueControlHtml}
                </div>
                <div class="rule-field-del">
                    <button type="button" class="rule-delete-btn" title="Remove condition" aria-label="Remove condition">✕</button>
                </div>
            </div>
        `;
    }).join('');

    // Attach listeners
    container.querySelectorAll('.visual-rule-row').forEach(rowEl => {
        const idx = parseInt(rowEl.dataset.ruleIndex, 10);
        const colSelect = rowEl.querySelector('.rule-col-select');
        const opSelect = rowEl.querySelector('.rule-op-select');
        const valElem = rowEl.querySelector('.rule-val-element');
        const delBtn = rowEl.querySelector('.rule-delete-btn');

        if (colSelect) {
            colSelect.addEventListener('change', (e) => {
                const newCol = e.target.value;
                visualRules[idx].column = newCol;
                const colDef = TRIP_COLUMNS.find(c => c.name === newCol);
                if (newCol === 'category') {
                    visualRules[idx].operator = 'equals';
                    visualRules[idx].value = 'highspeed';
                } else if (newCol === 'business') {
                    visualRules[idx].operator = 'equals';
                    visualRules[idx].value = 'commute';
                } else if (colDef?.type === 'datetime') {
                    visualRules[idx].operator = 'after';
                    visualRules[idx].value = '';
                } else if (colDef?.type === 'number') {
                    visualRules[idx].operator = 'greater_than';
                    visualRules[idx].value = '';
                } else {
                    visualRules[idx].operator = 'contains';
                    visualRules[idx].value = '';
                }
                renderVisualRules();
            });
        }
        if (opSelect) {
            opSelect.addEventListener('change', (e) => {
                visualRules[idx].operator = e.target.value;
                renderVisualRules();
            });
        }
        if (valElem) {
            const handleValChange = (e) => {
                visualRules[idx].value = e.target.value;
            };
            valElem.addEventListener('input', handleValChange);
            valElem.addEventListener('change', handleValChange);
            valElem.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    document.getElementById('applyVisualRulesBtn')?.click();
                }
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
    setTimeout(() => {
        try { URL.revokeObjectURL(url); } catch (e) {}
    }, 1000);
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
            const buddies = getTripBuddies(trip, activeSession?.username);
            const hasBuddy = buddies.some(b => b.username.toLowerCase() === selectedBuddy.toLowerCase());
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

            // Search mentions and buddies
            const buddies = getTripBuddies(trip, activeSession?.username);
            const buddiesText = buddies.map(b => `${b.username} ${b.displayName}`).join(' ').toLowerCase();

            const matched = line.includes(query) ||
                            origin.includes(query) ||
                            dest.includes(query) ||
                            body.includes(query) ||
                            operator.includes(query) ||
                            tagsText.includes(query) ||
                            buddiesText.includes(query);
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
        if (sortBy === 'delay-asc') {
            const delayA = deriveDelaySeconds(trainA).arrival || 0;
            const delayB = deriveDelaySeconds(trainB).arrival || 0;
            return delayA - delayB;
        }
        if (sortBy === 'dur-desc') {
            const durA = computeTripDurationMinutes(trainA);
            const durB = computeTripDurationMinutes(trainB);
            return durB - durA;
        }
        if (sortBy === 'dur-asc') {
            const durA = computeTripDurationMinutes(trainA);
            const durB = computeTripDurationMinutes(trainB);
            return durA - durB;
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
    const isScalarCount = isStudio && Boolean(sqlQueryResult) && sqlQueryResult.columns?.length === 1 && sqlQueryResult.columns[0]?.startsWith('COUNT(');
    const isRawSqlMode = isStudio && studioTableMode === 'raw' && !isScalarCount && !sqlQueryResult?.error;

    let total = 0;
    let items = [];

    if (isStudio) {
        if (sqlQueryResult.error) {
            items = [];
            total = 0;
        } else if (isScalarCount) {
            items = sqlQueryResult.rows || [];
            total = items.length;
        } else if (isRawSqlMode) {
            items = sqlQueryResult.rows || [];
            total = items.length;
        } else {
            items = (sqlQueryResult.rawTrips && sqlQueryResult.rawTrips.length > 0)
                ? sqlQueryResult.rawTrips
                : (sqlQueryResult.rows || []).map(r => r._rawTrip || allTrips.find(t => String(t.id) === String(r.id)) || r);
            total = items.length;
        }
    } else {
        items = filteredTrips;
        total = items.length;
    }

    const totalPages = Math.max(1, Math.ceil(total / filterState.pageSize));
    if (filterState.page > totalPages) filterState.page = totalPages;

    const startIdx = (filterState.page - 1) * filterState.pageSize;
    const endIdx = Math.min(total, startIdx + filterState.pageSize);
    const pageItems = items.slice(startIdx, endIdx);

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

    // Column metadata helper for Raw SQL Table mode
    const colTypeMap = new Map(TRIP_COLUMNS.map(c => [c.name, c.type]));
    const rawCols = (isRawSqlMode && sqlQueryResult?.columns && sqlQueryResult.columns.length > 0)
        ? sqlQueryResult.columns
        : (isRawSqlMode && pageItems.length > 0 ? Object.keys(pageItems[0]).filter(k => !k.startsWith('_')) : []);

    // 1. Render Table
    const thead = document.querySelector('.trips-table thead');
    if (thead) {
        if (isScalarCount) {
            thead.innerHTML = `
                <tr>
                    <th style="text-align: center; padding: 14px 20px;">COUNT(*)</th>
                </tr>
            `;
        } else if (isRawSqlMode) {
            thead.innerHTML = `
                <tr class="sql-raw-header-row">
                    <th class="sql-th-index" title="Row index in current result set">#</th>
                    ${rawCols.map(col => {
                        const typeStr = colTypeMap.get(col) || (col.endsWith('_km') || col.endsWith('_min') || col.endsWith('_count') || col === 'id' || col === 'year' ? 'number' : 'string');
                        const isNum = (typeStr === 'number');
                        const badgeText = isNum ? 'NUM' : (typeStr === 'datetime' ? 'DATE' : 'TEXT');
                        return `
                            <th class="sql-raw-th ${isNum ? 'numeric' : ''}" title="Column: ${escapeHtml(col)} (${badgeText})">
                                <div class="sql-th-content">
                                    <span class="sql-th-name">${escapeHtml(col)}</span>
                                    <span class="sql-th-type">${badgeText}</span>
                                </div>
                            </th>
                        `;
                    }).join('')}
                </tr>
            `;
        } else {
            const getSortIndicator = (field) => {
                if (filterState.sortBy === `${field}-desc`) return '<span class="sort-arrow desc" aria-hidden="true">▼</span>';
                if (filterState.sortBy === `${field}-asc`) return '<span class="sort-arrow asc" aria-hidden="true">▲</span>';
                return '<span class="sort-arrow idle" aria-hidden="true">↕</span>';
            };
            const getAriaSort = (field) => {
                if (filterState.sortBy === `${field}-desc`) return 'descending';
                if (filterState.sortBy === `${field}-asc`) return 'ascending';
                return 'none';
            };

            thead.innerHTML = `
                <tr>
                    <th class="th-expand" aria-label="Expand checkin"></th>
                    <th class="sortable" data-sort="date" aria-sort="${getAriaSort('date')}" role="columnheader" tabindex="0" title="Click to sort by departure time">Departure ${getSortIndicator('date')}</th>
                    <th>Line / Mode</th>
                    <th>Origin</th>
                    <th>Destination</th>
                    <th class="sortable" data-sort="dist" aria-sort="${getAriaSort('dist')}" role="columnheader" tabindex="0" title="Click to sort by distance">Distance ${getSortIndicator('dist')}</th>
                    <th class="sortable" data-sort="dur" aria-sort="${getAriaSort('dur')}" role="columnheader" tabindex="0" title="Click to sort by duration">Duration ${getSortIndicator('dur')}</th>
                    <th class="sortable" data-sort="delay" aria-sort="${getAriaSort('delay')}" role="columnheader" tabindex="0" title="Click to sort by delay">Delay ${getSortIndicator('delay')}</th>
                    <th>Companions</th>
                    <th>Actions</th>
                </tr>
            `;

            // Attach interactive sorting listeners
            const handleHeaderSort = (sortField) => {
                const currentSort = filterState.sortBy;
                let nextSort = `${sortField}-desc`;
                if (currentSort === `${sortField}-desc`) {
                    nextSort = `${sortField}-asc`;
                } else if (currentSort === `${sortField}-asc`) {
                    nextSort = `${sortField}-desc`;
                }
                filterState.sortBy = nextSort;
                const sortSelect = document.getElementById('sortSelect');
                if (sortSelect) sortSelect.value = nextSort;
                filterState.page = 1;
                if (isStudio && sqlQueryResult?.rawTrips) {
                    sortTrips(sqlQueryResult.rawTrips, nextSort);
                    renderResults();
                } else {
                    applyFiltersAndRender();
                }
            };

            thead.querySelectorAll('th.sortable').forEach(th => {
                th.addEventListener('click', () => {
                    const sortField = th.dataset.sort;
                    if (sortField) handleHeaderSort(sortField);
                });
                th.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        const sortField = th.dataset.sort;
                        if (sortField) handleHeaderSort(sortField);
                    }
                });
            });
        }
    }

    const tbody = document.getElementById('tripsTableBody');
    if (tbody) {
        if (pageItems.length === 0) {
            const colSpan = isScalarCount ? 1 : (isRawSqlMode ? Math.max(1, rawCols.length + 1) : 10);
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
        } else if (isScalarCount) {
            tbody.innerHTML = pageItems.map(row => `
                <tr>
                    <td style="text-align: center; font-size: 28px; font-weight: 700; color: var(--accent-cyan); padding: 36px;">
                        ${(row['COUNT(*)'] ?? 0).toLocaleString()}
                    </td>
                </tr>
            `).join('');
        } else if (isRawSqlMode) {
            tbody.innerHTML = pageItems.map((row, idx) => {
                const rowNum = startIdx + idx + 1;
                const cellsHtml = rawCols.map(col => {
                    const val = row[col];
                    if (val === null || val === undefined || val === '') {
                        return `<td class="sql-td-null"><span class="sql-null-pill">NULL</span></td>`;
                    }
                    const typeStr = colTypeMap.get(col) || (typeof val === 'number' ? 'number' : 'string');
                    if (typeStr === 'number' || typeof val === 'number') {
                        const formattedNum = Number.isInteger(val) ? val.toLocaleString() : Number(val).toFixed(1);
                        return `<td class="sql-td-num">${formattedNum}</td>`;
                    } else if (typeStr === 'datetime' || (typeof val === 'string' && val.includes('T') && !isNaN(Date.parse(val)))) {
                        return `<td class="sql-td-date">${escapeHtml(String(val))}</td>`;
                    } else {
                        return `<td class="sql-td-text">${escapeHtml(String(val))}</td>`;
                    }
                }).join('');

                return `
                    <tr class="sql-raw-row">
                        <td class="sql-td-index">${rowNum}</td>
                        ${cellsHtml}
                    </tr>
                `;
            }).join('');
        } else {
            tbody.innerHTML = pageItems.map(item => {
                const trip = item._rawTrip || (item.train || item.checkin ? item : allTrips.find(t => String(t.id) === String(item.id))) || item;
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

                // Buddies and Comment
                const buddies = getTripBuddies(trip, activeSession?.username);
                const bodyText = (trip.body || trip.properties?.body || '').trim();
                const bType = getTripBusinessType(trip);
                const purposeText = bType === 1 ? '💼 Work' : (bType === 2 ? '🚇 Commute' : '🌴 Leisure / Personal');

                const originPlanned = train.origin?.departurePlanned ? formatTime(train.origin.departurePlanned) : '—';
                const originReal = train.origin?.departureReal ? formatTime(train.origin.departureReal) : originPlanned;
                const destPlanned = train.destination?.arrivalPlanned ? formatTime(train.destination.arrivalPlanned) : '—';
                const destReal = train.destination?.arrivalReal ? formatTime(train.destination.arrivalReal) : destPlanned;

                const originPlatform = train.origin?.departurePlatformReal || train.origin?.platform || '—';
                const destPlatform = train.destination?.arrivalPlatformReal || train.destination?.platform || '—';
                const operator = train.operator?.name || train.operator?.identifier || train.provider?.name || train.provider || '—';

                const buddyBadgesHtml = buddies.length > 0
                    ? `<div class="buddy-pills-list">${buddies.map(b => `
                        <a href="https://traewelling.de/profile/${encodeURIComponent(b.username)}" target="_blank" rel="noopener noreferrer" class="buddy-badge-link" title="Open @${escapeHtml(b.username)} profile on Träwelling" onclick="event.stopPropagation()">
                            <span class="buddy-badge-icon">👤</span>
                            <span>@${escapeHtml(b.username)}</span>
                        </a>
                    `).join('')}</div>`
                    : '<span style="color: var(--text-muted);">—</span>';

                return `
                    <tr class="trip-row" data-trip-id="${trip.id}" id="tripRow-${trip.id}" title="Click row or arrow to expand comments &amp; details">
                        <td class="expand-cell" onclick="event.stopPropagation()">
                            <button type="button" class="expand-trip-btn" data-trip-id="${trip.id}" aria-label="Toggle details for trip ${trip.id}" aria-expanded="false" title="Click to view comments and details">▶</button>
                        </td>
                        <td data-label="Departure">${dateStr} <span style="color: var(--text-muted); font-size: 11px;">${timeStr}</span></td>
                        <td data-label="Line"><span class="line-badge ${cat}">${escapeHtml(lineName)}</span></td>
                        <td data-label="Origin"><strong>${escapeHtml(origin)}</strong></td>
                        <td data-label="Destination"><strong>${escapeHtml(dest)}</strong></td>
                        <td data-label="Distance">${distKm} km</td>
                        <td data-label="Duration">${durStr}</td>
                        <td data-label="Delay"><span class="delay-pill ${delayPillClass}">${delayText}</span></td>
                        <td data-label="Companions" style="max-width: 170px;">${buddyBadgesHtml}</td>
                        <td data-label="Actions">
                            <button type="button" class="nav-link-btn inspect-trip-btn" data-trip-id="${trip.id}" style="padding: 4px 8px; font-size: 11px;">
                                🔍 Inspect
                            </button>
                        </td>
                    </tr>
                    <tr class="trip-expand-row" id="expandRow-${trip.id}" style="display: none;">
                        <td colspan="10" class="trip-expand-cell">
                            <div class="expand-card-container">
                                <div class="expand-comment-card ${bodyText ? '' : 'empty'}">
                                    <span class="comment-icon">💬</span>
                                    <div class="comment-body-text">
                                        ${bodyText ? renderLinkedComment(bodyText) : '<em>No checkin note or comment was attached to this journey.</em>'}
                                    </div>
                                </div>
                                ${buddies.length > 0 ? `
                                    <div class="expand-buddies-row">
                                        <span class="expand-buddies-label">👥 Travel Companions (${buddies.length}):</span>
                                        <div class="expand-buddies-chips">
                                            ${buddies.map(b => `
                                                <div class="buddy-chip-wrapper">
                                                    <a href="https://traewelling.de/profile/${encodeURIComponent(b.username)}" target="_blank" rel="noopener noreferrer" class="buddy-link-pill" title="View @${escapeHtml(b.username)} on Träwelling" onclick="event.stopPropagation()">
                                                        <span>👤 @${escapeHtml(b.username)}</span>
                                                    </a>
                                                    <button type="button" class="buddy-filter-btn" data-username="${escapeHtml(b.username.toLowerCase())}" title="Filter trips with @${escapeHtml(b.username)}">Filter</button>
                                                </div>
                                            `).join('')}
                                        </div>
                                    </div>
                                ` : ''}
                                <div class="expand-details-grid">
                                    <div class="expand-detail-item">
                                        <span class="expand-detail-label">Schedule Departure</span>
                                        <span class="expand-detail-value">${originPlanned} (Actual: ${originReal})</span>
                                    </div>
                                    <div class="expand-detail-item">
                                        <span class="expand-detail-label">Schedule Arrival</span>
                                        <span class="expand-detail-value">${destPlanned} (Actual: ${destReal})</span>
                                    </div>
                                    <div class="expand-detail-item">
                                        <span class="expand-detail-label">Platform</span>
                                        <span class="expand-detail-value">Dep: ${originPlatform} • Arr: ${destPlatform}</span>
                                    </div>
                                    <div class="expand-detail-item">
                                        <span class="expand-detail-label">Operator</span>
                                        <span class="expand-detail-value">${escapeHtml(operator)}</span>
                                    </div>
                                    <div class="expand-detail-item">
                                        <span class="expand-detail-label">Punctuality</span>
                                        <span class="expand-detail-value"><span class="delay-pill ${delayPillClass}">${delayText}</span></span>
                                    </div>
                                    <div class="expand-detail-item">
                                        <span class="expand-detail-label">Purpose</span>
                                        <span class="expand-detail-value">${purposeText}</span>
                                    </div>
                                </div>
                                <div class="expand-actions-row">
                                    <a href="index.html?user=${encodeURIComponent(activeSession?.username || '')}&trip=${trip.id}" class="nav-link-btn primary" style="padding: 6px 14px; font-size: 12px;">
                                        🗺️ View on Map
                                    </a>
                                    <button type="button" class="nav-link-btn inspect-trip-btn" data-trip-id="${trip.id}" style="padding: 6px 14px; font-size: 12px;">
                                        🔍 Full Details
                                    </button>
                                    <a href="https://traewelling.de/status/${trip.id}" target="_blank" rel="noopener noreferrer" class="nav-link-btn" style="padding: 6px 14px; font-size: 12px;" onclick="event.stopPropagation()">
                                        🌐 Träwelling.de
                                    </a>
                                </div>
                            </div>
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
            const errorMsg = isStudio && sqlQueryResult?.error;
            cardsGrid.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 48px 16px; background: var(--bg-panel); border: 1px solid var(--border-subtle); border-radius: var(--radius-md);">
                    <div style="font-size: 38px; margin-bottom: 8px;">${errorMsg ? '⚠️' : '🔍'}</div>
                    <div style="font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">
                        ${errorMsg ? 'SQL Query Error' : (isStudio ? 'No records match your SQL query' : 'No journeys match your active filters')}
                    </div>
                    <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 14px;">
                        ${errorMsg ? escapeHtml(sqlQueryResult.error) : (isStudio ? 'Try checking your WHERE conditions, column names, or table names.' : 'Try loosening your search query, transport category, or delay tier.')}
                    </div>
                    ${isStudio ? `<button type="button" class="studio-action-btn primary" id="emptyCardsResetBtn">Reset to Default Query</button>` : `<button type="button" class="studio-action-btn primary" id="emptyCardsResetBtn">Reset All Filters</button>`}
                </div>
            `;
            const emptyCardsResetBtn = cardsGrid.querySelector('#emptyCardsResetBtn');
            if (emptyCardsResetBtn) {
                emptyCardsResetBtn.addEventListener('click', () => {
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
        } else {
            cardsGrid.innerHTML = pageItems.map(item => {
                const trip = item._rawTrip || (item.train || item.checkin ? item : allTrips.find(t => String(t.id) === String(item.id))) || item;
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

                const buddies = getTripBuddies(trip, activeSession?.username);
                const bodyText = (trip.body || trip.properties?.body || '').trim();

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
                        ${bodyText ? `
                            <div class="trip-card-comment" style="padding: 8px 12px; font-size: 12.5px; background: rgba(15, 23, 42, 0.6); border-radius: 6px; border-left: 2px solid var(--accent-primary); margin: 6px 0; color: var(--text-primary); line-height: 1.4;">
                                <span style="font-size: 13px; margin-right: 4px;">💬</span>
                                <span>${renderLinkedComment(bodyText)}</span>
                            </div>
                        ` : ''}
                        ${buddies.length > 0 ? `
                            <div class="trip-card-buddies" style="display: flex; flex-wrap: wrap; gap: 4px; align-items: center; margin: 4px 0;">
                                <span style="font-size: 10px; color: var(--text-muted); font-weight: 700; text-transform: uppercase;">With:</span>
                                <div class="buddy-pills-list">
                                    ${buddies.map(b => `
                                        <a href="https://traewelling.de/profile/${encodeURIComponent(b.username)}" target="_blank" rel="noopener noreferrer" class="buddy-badge-link" onclick="event.stopPropagation()">
                                            <span class="buddy-badge-icon">👤</span>
                                            <span>@${escapeHtml(b.username)}</span>
                                        </a>
                                    `).join('')}
                                </div>
                            </div>
                        ` : ''}
                        <div class="trip-card-footer">
                            <span>${distKm} km · ${durStr}</span>
                            <span class="delay-pill ${delayPillClass}">${delayText}</span>
                        </div>
                    </div>
                `;
            }).join('');
        }
    }

    // Toggle row expansion helper
    function toggleTripExpansion(tripId) {
        const row = document.getElementById(`tripRow-${tripId}`);
        const expandRow = document.getElementById(`expandRow-${tripId}`);
        const btn = document.querySelector(`.expand-trip-btn[data-trip-id="${tripId}"]`);
        if (!expandRow) return;

        const isCurrentlyExpanded = expandRow.style.display !== 'none';
        if (isCurrentlyExpanded) {
            expandRow.style.display = 'none';
            if (row) row.classList.remove('expanded');
            if (btn) {
                btn.setAttribute('aria-expanded', 'false');
                btn.textContent = '▶';
            }
        } else {
            expandRow.style.display = 'table-row';
            if (row) row.classList.add('expanded');
            if (btn) {
                btn.setAttribute('aria-expanded', 'true');
                btn.textContent = '▼';
            }
        }
    }

    // Attach expand button click listeners
    document.querySelectorAll('.expand-trip-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const tripId = btn.dataset.tripId;
            toggleTripExpansion(tripId);
        });
    });

    // Attach row click listeners (expanding inline on click unless button/link clicked)
    document.querySelectorAll('#tripsTableBody tr.trip-row').forEach(row => {
        row.addEventListener('click', (e) => {
            if (e.target.closest('a, button, input, select, .nav-link-btn, .expand-trip-btn')) {
                return;
            }
            const tripId = row.dataset.tripId;
            toggleTripExpansion(tripId);
        });
    });

    // Attach card click listener to open modal
    document.querySelectorAll('.trip-card[data-trip-id]').forEach(card => {
        card.addEventListener('click', (e) => {
            if (e.target.closest('a, button')) return;
            const tripId = card.dataset.tripId;
            const trip = allTrips.find(t => String(t.id) === String(tripId));
            if (trip) openTripDetailModal(trip);
        });
    });

    // Attach inspect buttons (table & cards & expanded row)
    document.querySelectorAll('.inspect-trip-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const tripId = btn.dataset.tripId;
            const trip = allTrips.find(t => String(t.id) === String(tripId));
            if (trip) openTripDetailModal(trip);
        });
    });

    // Attach companion quick-filter buttons in expanded row
    document.querySelectorAll('.buddy-filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const username = btn.dataset.username;
            if (username) {
                const buddySelect = document.getElementById('buddySelect');
                if (buddySelect) {
                    let option = Array.from(buddySelect.options).find(opt => opt.value.toLowerCase() === username.toLowerCase());
                    if (!option) {
                        option = document.createElement('option');
                        option.value = username;
                        option.textContent = `@${username}`;
                        buddySelect.appendChild(option);
                    }
                    buddySelect.value = option.value;
                }
                filterState.selectedBuddy = username;
                filterState.page = 1;
                applyFiltersAndRender();
            }
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
    const buddies = getTripBuddies(trip, activeSession?.username);
    if (buddies.length > 0) {
        buddiesSec.style.display = 'block';
        buddiesList.innerHTML = buddies.map(b => {
            return `<a href="https://traewelling.de/profile/${encodeURIComponent(b.username)}" target="_blank" rel="noopener noreferrer" class="buddy-badge-link" style="padding: 4px 10px; font-size: 12px;" title="Open @${escapeHtml(b.username)} profile on Träwelling">
                <span class="buddy-badge-icon">👤</span>
                <span>@${escapeHtml(b.username)}</span>
            </a>`;
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
        notesText.innerHTML = renderLinkedComment(body.trim());
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

