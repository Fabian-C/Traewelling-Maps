import { SessionDB } from '../cache/session.js';
import { Storage, STORAGE_KEYS } from '../storage/storage.js';
import { tripsToGeoJSON, tripsToCSV, tripsToJSON, parseGeoJSONToTrips, parseCSVToTrips, downloadCSVFile, downloadJSONFile } from '../export/geojson.js';
import { syncNavigationLinks } from '../ui/navigation.js';
import { getTripBuddies, renderLinkedComment } from './formatters.js';
import { deriveDelaySeconds, computeTripDurationMinutes } from '../utils/time.js';
import { formatTotalTime, escapeHtml } from '../utils/format.js';
import { normalizeCategory, getTripBusinessType, extractTripTags } from '../data/processing.js';
import { getUnscannedTrips, startIncrementalScan } from './coPassengerScanner.js';
import { sortRawSqlRows, sortTrips, formatTime } from './sorting.js';
import { openTripDetailModal as openDetailModalView } from './detailModal.js';
import { createStudioWorkbench } from './studioWorkbench.js';

let sqlEngine = null;
let sqlAutocomplete = null;

export async function loadStudioModules() {
    if (!sqlEngine) {
        sqlEngine = await import('./sqlEngine.js');
        window.executeTripQuery = sqlEngine.executeTripQuery;
    }
    if (!sqlAutocomplete) {
        sqlAutocomplete = await import('./sqlAutocomplete.js');
    }
    return { sqlEngine, sqlAutocomplete };
}

let allSessions = [];
let activeSession = null;
let allTrips = [];
let filteredTrips = [];
let flattenedTrips = [];
let durationDisplayMode = 'standard'; // 'standard' | 'days' | 'months'

// Studio state
let appMode = 'standard'; // 'standard' | 'studio'
let studioTableMode = Storage.get(STORAGE_KEYS.STUDIO_TABLE_MODE, 'unified'); // 'unified' | 'raw'
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
    page: 1,
    pageSize: 100
};

let rawSqlSort = { column: null, direction: 'asc' };

// WeakMap cache of precomputed filter & telemetry metadata per trip object (invalidated on session switch / enrichment)
let tripFilterMetaCache = new WeakMap();

function invalidateTripCaches() {
    tripFilterMetaCache = new WeakMap();
    studioWorkbench.invalidateStudioCache();
}

function getTripFilterMeta(trip) {
    let meta = tripFilterMetaCache.get(trip);
    if (meta) return meta;

    const train = trip.train || trip.checkin || {};
    const category = normalizeCategory(train.category || 'regional');
    const rawDate = train.origin?.departureReal || train.origin?.departure || trip.createdAt;
    const year = rawDate ? String(new Date(rawDate).getFullYear()) : '';
    const delays = deriveDelaySeconds(train);
    const arrivalDelaySec = delays.arrival !== null ? delays.arrival : 0;
    const arrivalDelayMin = Math.round(arrivalDelaySec / 60);
    const businessType = getTripBusinessType(trip);
    const distanceMeters = typeof train.totalDistance === 'number' ? train.totalDistance : (train.distance || 0);
    const durationMin = computeTripDurationMinutes(train);

    const buddies = getTripBuddies(trip, activeSession?.username);
    const buddyUsernamesLower = new Set(buddies.map(b => b.username.toLowerCase()));

    const tags = extractTripTags(trip.properties || {}).concat(extractTripTags({ tags: train.tags }));
    const tagsText = tags.length ? tags.map(t => `${t.key} ${t.value}`).join(' ') : '';
    const buddiesText = buddies.length ? buddies.map(b => `${b.username} ${b.displayName}`).join(' ') : '';

    const searchCorpus = [
        train.lineName || train.number || train.name || '',
        train.origin?.name || '',
        train.destination?.name || '',
        trip.body || trip.properties?.body || '',
        train.operator?.name || '',
        tagsText,
        buddiesText
    ].join('\x1f').toLowerCase();

    meta = {
        category,
        year,
        arrivalDelaySec,
        arrivalDelayMin,
        businessType,
        distanceMeters,
        durationMin,
        buddyUsernamesLower,
        searchCorpus
    };
    tripFilterMetaCache.set(trip, meta);
    return meta;
}

const studioWorkbench = createStudioWorkbench({
    loadStudioModules,
    getAppMode: () => appMode,
    setAppMode: (m) => { appMode = m; },
    getStudioTableMode: () => studioTableMode,
    setStudioTableMode: (m) => { studioTableMode = m; },
    getSqlQueryResult: () => sqlQueryResult,
    setSqlQueryResult: (r) => { sqlQueryResult = r; },
    getActiveSession: () => activeSession,
    getAllSessions: () => allSessions,
    getAllTrips: () => allTrips,
    getFilteredTrips: () => filteredTrips,
    getFlattenedTrips: () => flattenedTrips,
    setFlattenedTrips: (rows) => { flattenedTrips = rows; },
    resetRawSqlSort: () => { rawSqlSort = { column: null, direction: 'asc' }; },
    setPage: (p) => { filterState.page = p; },
    updateTelemetry: (trips) => updateTelemetry(trips),
    renderResults: () => renderResults(),
    applyFiltersAndRender: () => applyFiltersAndRender()
});

// Initialize on DOM ready or immediately if already loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTripExplorer);
} else {
    initTripExplorer();
}

export async function initTripExplorer() {
    try {
        allSessions = await SessionDB.getSessionSummaries();
    } catch (e) {
        console.warn('Failed to load session summaries from SessionDB:', e);
        allSessions = [];
    }

    // Synchronous storage session fallback
    if (allSessions.length === 0) {
        const parsed = Storage.getJSON(STORAGE_KEYS.SESSIONS_DATA, null);
        if (Array.isArray(parsed) && parsed.length > 0) {
            allSessions = parsed.map(s => ({
                username: s.username,
                displayName: s.displayName || s.username,
                avatar: s.avatar || null,
                tripCount: s.tripCount || (s.trips ? s.trips.length : 0),
                timestamp: s.timestamp || Date.now()
            }));
        }
    }

    const urlParams = new URLSearchParams(window.location.search);
    const requestedUser = urlParams.get('user')?.toLowerCase().trim();
    const requestedTripId = urlParams.get('trip');
    const fixtureUrl = urlParams.get('fixture');

    const targetUser = requestedUser || (allSessions.length > 0 ? allSessions[0].username : null);
    if (targetUser) {
        try {
            activeSession = await SessionDB.get(targetUser);
        } catch (e) {
            console.warn('Failed to load active session from SessionDB:', e);
        }
        if (!activeSession || !activeSession.trips?.length) {
            try {
                const fullList = await SessionDB.getAll();
                activeSession = fullList.find(s => s.username?.toLowerCase() === targetUser.toLowerCase()) || null;
                if (!activeSession && !requestedUser && fullList.length > 0) {
                    activeSession = fullList[0];
                }
            } catch (e) {
                console.warn('Failed to load fallback sessions from SessionDB:', e);
            }
        }
        if (!activeSession && allSessions.length > 0) {
            activeSession = allSessions.find(s => s.username?.toLowerCase() === targetUser.toLowerCase()) || null;
        }
    }

    if (requestedUser && activeSession && !allSessions.some(s => s.username?.toLowerCase() === requestedUser)) {
        allSessions.unshift({
            username: activeSession.username,
            displayName: activeSession.displayName || activeSession.username,
            avatar: activeSession.avatar || null,
            tripCount: activeSession.tripCount || (activeSession.trips ? activeSession.trips.length : 0),
            timestamp: activeSession.timestamp || Date.now()
        });
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
            } catch {}
        }
    }

    renderProfileDropdown();
    setupEventListeners();

    if (!activeSession || !Array.isArray(activeSession.trips) || activeSession.trips.length === 0) {
        showEmptyState();
        return;
    }

    allTrips = activeSession.trips.slice();
    await hydrateTripsWithCoPassengers(allTrips);
    flattenedTrips = [];

    // Populate Year pills and Companion dropdown
    populateYearPills(allTrips);
    populateBuddyDropdown(allTrips);

    // Apply URL parameters if present
    if (urlParams.get('search')) filterState.searchQuery = urlParams.get('search');
    if (urlParams.get('year')) filterState.selectedYear = urlParams.get('year');
    if (urlParams.get('category')) filterState.selectedCategories = new Set([urlParams.get('category')]);
    if (urlParams.get('delay')) filterState.selectedDelay = urlParams.get('delay');

    applyFiltersAndRender();

    if (urlParams.get('mode') === 'studio') {
        const modeStudioBtn = document.getElementById('modeStudioBtn');
        if (modeStudioBtn) modeStudioBtn.click();
    }

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

    // Update cross-page navigation links with active user
    syncNavigationLinks(activeSession?.username);
}

/**
 * Hydrate trips array with cached co-passengers from IndexedDB
 */
async function hydrateTripsWithCoPassengers(tripsList) {
    if (!tripsList || !tripsList.length) return;
    try {
        const allCo = await SessionDB.getAllCoPassengers();
        if (allCo && allCo.length > 0) {
            const coByTrip = new Map();
            for (const cp of allCo) {
                const tid = Number(cp.trip_id);
                if (!coByTrip.has(tid)) coByTrip.set(tid, []);
                coByTrip.get(tid).push(cp);
            }
            for (const t of tripsList) {
                const bId = Number(t.train?.trip || t.checkin?.trip || t.trip || t.backend_trip_id || t.properties?.backend_trip_id);
                if (bId && coByTrip.has(bId)) {
                    t.co_passengers = coByTrip.get(bId);
                }
            }
        }
    } catch (e) {
        console.warn('Failed to hydrate co-passengers:', e);
    }
}

export async function switchActiveSession(session) {
    if (!session) return;
    activeSession = session;
    allTrips = activeSession.trips || [];
    await hydrateTripsWithCoPassengers(allTrips);
    flattenedTrips = [];
    invalidateTripCaches();
    populateYearPills(allTrips);
    populateBuddyDropdown(allTrips);
    filterState.page = 1;
    updateUrlParams();
    syncNavigationLinks(activeSession.username);
    if (appMode === 'studio') {
        const currentSql = document.getElementById('sqlQueryInput')?.value || sqlEngine?.QUERY_RECIPES?.[0]?.sql;
        if (currentSql) runSqlQuery(currentSql);
    } else {
        applyFiltersAndRender();
    }
}

/**
 * Setup UI event listeners
 */
function setupEventListeners() {
    // Profile Switcher
    const profileSelect = document.getElementById('profileSelect');
    if (profileSelect) {
        profileSelect.addEventListener('change', async (e) => {
            const user = (e.target.value || '').toLowerCase().trim();
            let session = null;
            try {
                session = await SessionDB.get(user);
            } catch {}
            if (!session || !session.trips?.length) {
                try {
                    const fullList = await SessionDB.getAll();
                    session = fullList.find(s => s.username?.toLowerCase() === user) || null;
                } catch {}
            }
            if (!session) {
                session = allSessions.find(s => s.username?.toLowerCase() === user);
            }
            if (session) {
                await switchActiveSession(session);
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

    // Export Filtered Button (GeoJSON)
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

    // Export Filtered CSV Button
    const exportFilteredCsvBtn = document.getElementById('exportFilteredCsvBtn');
    if (exportFilteredCsvBtn) {
        exportFilteredCsvBtn.addEventListener('click', () => {
            if (filteredTrips.length === 0) {
                alert('No trips match the current filter criteria to export.');
                return;
            }
            const csv = tripsToCSV(filteredTrips);
            downloadCSVFile(csv, `traewelling-${activeSession?.username || 'trips'}-filtered.csv`);
        });
    }

    // Export Filtered JSON Button
    const exportFilteredJsonBtn = document.getElementById('exportFilteredJsonBtn');
    if (exportFilteredJsonBtn) {
        exportFilteredJsonBtn.addEventListener('click', () => {
            if (filteredTrips.length === 0) {
                alert('No trips match the current filter criteria to export.');
                return;
            }
            const jsonData = tripsToJSON(filteredTrips, { username: activeSession?.username });
            downloadJSONFile(jsonData, `traewelling-${activeSession?.username || 'trips'}-filtered.json`);
        });
    }

    // Navigation Import Button & File Input
    const navImportBtn = document.getElementById('navImportBtn');
    const tripsImportFileInput = document.getElementById('tripsImportFileInput');
    if (navImportBtn && tripsImportFileInput) {
        navImportBtn.addEventListener('click', () => tripsImportFileInput.click());
        tripsImportFileInput.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                const fileName = (file.name || '').toLowerCase();
                let trips = [];
                let username = null;

                if (fileName.endsWith('.csv') || file.type?.includes('csv')) {
                    const parsed = parseCSVToTrips(text);
                    trips = parsed.trips;
                    username = parsed.username;
                } else {
                    let parsed = null;
                    try {
                        parsed = JSON.parse(text);
                    } catch (jsonErr) {
                        try {
                            const csvParsed = parseCSVToTrips(text);
                            if (csvParsed.trips && csvParsed.trips.length > 0) {
                                trips = csvParsed.trips;
                                username = csvParsed.username;
                            } else {
                                throw jsonErr;
                            }
                        } catch {
                            throw new Error('The selected file is not valid JSON or CSV.');
                        }
                    }

                    if (!trips.length && parsed) {
                        const parsedResult = parseGeoJSONToTrips(parsed);
                        trips = parsedResult.trips;
                        username = parsedResult.username;
                    }
                }

                if (!trips || !trips.length) {
                    alert('No valid journeys were found in the selected file.');
                    return;
                }

                let rawName = username;
                if (!rawName || rawName === 'Exported Trips' || rawName === 'Imported CSV') {
                    const match = file.name.match(/traewelling-([a-zA-Z0-9_\-]+?)-(?:all|filtered|full|trips)/i);
                    if (match && match[1]) {
                        rawName = match[1];
                    } else {
                        rawName = file.name.replace(/\.(geojson|json|csv)$/i, '').replace(/[^a-zA-Z0-9_\-]/g, '_');
                    }
                }
                const usernameKey = (rawName || 'imported_travels').toLowerCase().trim();
                const displayName = rawName ? (rawName.charAt(0).toUpperCase() + rawName.slice(1)) : 'Imported Travels';

                const newSession = {
                    username: usernameKey,
                    displayName: displayName,
                    avatar: null,
                    tripCount: trips.length,
                    trips: trips,
                    timestamp: Date.now()
                };

                await SessionDB.save(usernameKey, newSession);

                for (const t of trips) {
                    const bId = t.backend_trip_id || t.train?.trip;
                    if (bId && Array.isArray(t.co_passengers) && t.co_passengers.length > 0) {
                        await SessionDB.saveTripCoPassengers(bId, t.co_passengers).catch(() => {});
                    }
                }

                allSessions = await SessionDB.getSessionSummaries();
                renderProfileDropdown();
                const select = document.getElementById('profileSelect');
                if (select) select.value = usernameKey;
                await switchActiveSession(newSession);
            } catch (err) {
                console.error('Import error on trips page:', err);
                alert(`Import failed: ${err.message || 'Unknown error'}`);
            } finally {
                e.target.value = '';
            }
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

    // Setup Incremental Co-Passenger Batch Scanner
    setupCoPassengerScanner();
}

let activeScanController = null;

export function updateScanButtonState() {
    const btn = document.getElementById('btnScanCoPassengers');
    const badge = document.getElementById('scanCoPassengersBadge');
    const text = document.getElementById('scanCoPassengersText');
    if (!btn || !text) return;

    const username = activeSession?.username || '';
    if (!username || !allTrips || !allTrips.length) {
        btn.style.display = 'none';
        return;
    }
    btn.style.display = 'inline-flex';

    const { unscannedTrips } = getUnscannedTrips(allTrips, username);
    if (unscannedTrips.length > 0) {
        text.textContent = 'Scan for Travel Buddies';
        if (badge) {
            badge.textContent = `${unscannedTrips.length} new`;
            badge.style.display = 'inline-block';
            badge.style.background = 'rgba(56, 189, 248, 0.25)';
            badge.style.color = '#38bdf8';
            badge.classList.remove('up-to-date');
            badge.title = `${unscannedTrips.length} unscanned trips. Click to scan.`;
        }
    } else {
        text.textContent = 'Travel Buddies Up to Date';
        if (badge) {
            badge.textContent = '✓';
            badge.style.display = 'inline-block';
            badge.style.background = 'rgba(16, 185, 129, 0.2)';
            badge.style.color = '#10b981';
            badge.classList.add('up-to-date');
            badge.title = 'Click to force full re-scan of all trips';
        }
    }
}

function setupCoPassengerScanner() {
    const btn = document.getElementById('btnScanCoPassengers');
    const badge = document.getElementById('scanCoPassengersBadge');
    const progressBar = document.getElementById('scanProgressBar');
    const progressText = document.getElementById('scanProgressText');
    const cancelBtn = document.getElementById('btnCancelScan');

    if (!btn) return;

    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            if (activeScanController) {
                activeScanController.cancel();
                activeScanController = null;
            }
        });
    }

    const executeScan = ({ forceFullRescan = false } = {}) => {
        const username = activeSession?.username || '';
        if (!username) return;

        const { unscannedTrips } = getUnscannedTrips(allTrips, username, { forceFullRescan });
        if (!unscannedTrips.length) {
            if (progressBar && progressText) {
                progressBar.style.display = 'flex';
                progressText.textContent = 'All trips are already up to date with Träwelling!';
                setTimeout(() => {
                    if (!activeScanController && progressBar) {
                        progressBar.style.display = 'none';
                    }
                }, 3000);
            }
            return;
        }

        btn.disabled = true;
        if (progressBar) progressBar.style.display = 'flex';
        if (progressText && forceFullRescan) {
            progressText.textContent = `Force re-scanning all ${unscannedTrips.length} trips...`;
        }

        activeScanController = startIncrementalScan({
            trips: allTrips,
            username,
            forceFullRescan,
            onProgress: ({ status, foundBuddies }) => {
                if (progressText) {
                    progressText.textContent = `${status} (${foundBuddies} travel buddies found)`;
                }
            },
            onComplete: async ({ scannedCount, foundBuddiesCount, cancelled }) => {
                btn.disabled = false;
                activeScanController = null;
                if (progressText) {
                    progressText.textContent = cancelled
                        ? `Scan paused. Checked ${scannedCount} trips, found ${foundBuddiesCount} buddies.`
                        : `Scan complete! Checked ${scannedCount} ${forceFullRescan ? '' : 'new '}trips, found ${foundBuddiesCount} buddies.`;
                }
                setTimeout(() => {
                    if (progressBar) progressBar.style.display = 'none';
                }, 4000);

                invalidateTripCaches();
                if (sqlEngine) {
                    flattenedTrips = allTrips.map(sqlEngine.flattenTripRecord);
                }
                populateBuddyDropdown(allTrips);
                applyFiltersAndRender();
                updateScanButtonState();
            },
            onError: (err) => {
                btn.disabled = false;
                activeScanController = null;
                if (progressText) {
                    progressText.textContent = `Error: ${err.message}`;
                }
                setTimeout(() => {
                    if (progressBar) progressBar.style.display = 'none';
                }, 5000);
            }
        });
    };

    // Clicking the green tick badge directly forces a full re-scan immediately
    if (badge) {
        badge.addEventListener('click', (e) => {
            if (btn.disabled || activeScanController) return;
            e.stopPropagation();
            e.preventDefault();
            executeScan({ forceFullRescan: true });
        });
    }

    // Clicking the scan button
    let clickCount = 0;
    let clickTimer = null;

    btn.addEventListener('click', () => {
        if (btn.disabled || activeScanController) return;
        const username = activeSession?.username || '';
        const { unscannedTrips } = getUnscannedTrips(allTrips, username);

        // If already up to date, clicking the button directly initiates a full re-scan
        if (!unscannedTrips.length) {
            executeScan({ forceFullRescan: true });
            return;
        }

        clickCount++;
        clearTimeout(clickTimer);

        if (clickCount >= 2) {
            clickCount = 0;
            executeScan({ forceFullRescan: true });
            return;
        }

        clickTimer = setTimeout(() => {
            const count = clickCount;
            clickCount = 0;
            if (count === 1) {
                executeScan({ forceFullRescan: false });
            }
        }, 350);
    });
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

function setupStudioEventListeners() {
    studioWorkbench.setupStudioEventListeners();
}

export function renderSpatialSqlPreview() {
    return studioWorkbench.renderSpatialSqlPreview();
}

export async function getStudioDatasets() {
    return studioWorkbench.getStudioDatasets();
}

export async function runSqlQuery(sql) {
    return studioWorkbench.runSqlQuery(sql);
}
window.runSqlQuery = runSqlQuery;

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
    const selectedBuddyLower = selectedBuddy !== 'all' ? selectedBuddy.toLowerCase() : '';
    const selectedPurpose = filterState.selectedPurpose;

    filteredTrips = allTrips.filter(trip => {
        const meta = getTripFilterMeta(trip);

        if (!isAllCategories && !filterState.selectedCategories.has(meta.category)) {
            return false;
        }
        if (selectedYear !== 'all' && meta.year !== selectedYear) {
            return false;
        }
        if (selectedDelay !== 'all') {
            const arrivalDelayMin = meta.arrivalDelayMin;
            if (selectedDelay === 'ontime' && arrivalDelayMin > 5) return false;
            if (selectedDelay === 'minor' && (arrivalDelayMin <= 5 || arrivalDelayMin > 15)) return false;
            if (selectedDelay === 'moderate' && (arrivalDelayMin <= 15 || arrivalDelayMin > 30)) return false;
            if (selectedDelay === 'severe' && arrivalDelayMin <= 30) return false;
            if (selectedDelay === 'delayed' && arrivalDelayMin <= 0) return false;
        }
        if (selectedBuddyLower && !meta.buddyUsernamesLower.has(selectedBuddyLower)) {
            return false;
        }
        if (selectedPurpose !== 'all') {
            if (selectedPurpose === 'work' && meta.businessType !== 1) return false;
            if (selectedPurpose === 'commute' && meta.businessType !== 2) return false;
            if (selectedPurpose === 'personal' && meta.businessType !== 0) return false;
        }
        if (query && !meta.searchCorpus.includes(query)) {
            return false;
        }

        return true;
    });

    // Sort Results (O(N) Schwartzian key extraction)
    sortTrips(filteredTrips, filterState.sortBy, activeSession?.username);

    // Update Telemetry Bar
    updateTelemetry(filteredTrips);

    // Render Table or Cards
    renderResults();

    // Update Incremental Co-Passenger Batch Scanner Button
    updateScanButtonState();

    // Update Spatial Map preview if active
    const spatialPanel = document.getElementById('spatialSqlPanel');
    if (spatialPanel && spatialPanel.style.display !== 'none') {
        renderSpatialSqlPreview();
    }
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

    let totalDistMeters = 0;
    let onTimeCount = 0;
    let totalMinutes = 0;

    for (let i = 0; i < trips.length; i++) {
        const meta = getTripFilterMeta(trips[i]);
        totalDistMeters += meta.distanceMeters;
        if (meta.arrivalDelaySec <= 300) {
            onTimeCount++;
        }
        totalMinutes += meta.durationMin;
    }

    const distKm = Math.round(totalDistMeters / 1000);
    const punctRate = trips.length > 0 ? Math.round((onTimeCount / trips.length) * 100) : 100;
    const totalHours = Math.round(totalMinutes / 60);
    const timeInfo = formatTotalTime(totalHours);

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
    const isScalarCount = isStudio && Boolean(sqlQueryResult) && sqlQueryResult.columns?.length === 1 && (sqlQueryResult.isAggregate || sqlQueryResult.columns[0]?.startsWith('COUNT('));
    const isRawSqlMode = isStudio && (studioTableMode === 'raw' || sqlQueryResult?.isAggregate || (sqlQueryResult?.table && sqlQueryResult.table !== 'trips')) && !isScalarCount && !sqlQueryResult?.error;

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
            items = (sqlQueryResult.rows && sqlQueryResult.rows.length > 0)
                ? sqlQueryResult.rows
                : (sqlQueryResult.rawTrips || []);
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
    const activeColsDef = (sqlQueryResult?.table && sqlEngine?.TABLE_SCHEMAS?.[sqlQueryResult.table]?.columns) || sqlEngine?.TRIP_COLUMNS || [];
    const colTypeMap = new Map(activeColsDef.map(c => [c.name, c.type]));
    const rawCols = (isRawSqlMode && sqlQueryResult?.columns && sqlQueryResult.columns.length > 0)
        ? sqlQueryResult.columns
        : (isRawSqlMode && pageItems.length > 0 ? Object.keys(pageItems[0]).filter(k => !k.startsWith('_')) : []);

    // Custom SQL projected columns for Unified Mode
    const CORE_UNIFIED_FIELDS = new Set([
        'id', 'status_id', '_rawtrip',
        'departure', 'dep_time', 'dep_planned', 'created_at',
        'line', 'line_name', 'category',
        'origin', 'origin_name', 'origin_id',
        'destination', 'destination_name', 'destination_id',
        'distance_km', 'duration_min',
        'delay_arr', 'delay_dep', 'delay_arr_min', 'delay_dep_min',
        'buddies', 'buddy_count', 'buddies_count', 'buddy_usernames'
    ]);
    const tripSchemaColNames = new Set(sqlEngine?.TRIP_COLUMNS?.map(c => c.name.toLowerCase()) || []);
    const customCols = (!isRawSqlMode && isStudio && sqlQueryResult?.columns)
        ? sqlQueryResult.columns.filter(col => {
            const lower = col.toLowerCase();
            if (CORE_UNIFIED_FIELDS.has(lower)) return false;
            if (sqlQueryResult.isSelectAll && tripSchemaColNames.has(lower)) return false;
            return true;
        })
        : [];

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
                        const isSorted = rawSqlSort.column === col;
                        const sortDir = isSorted ? rawSqlSort.direction : 'idle';
                        const sortIcon = isSorted ? (rawSqlSort.direction === 'desc' ? '▼' : '▲') : '↕';
                        const ariaSort = isSorted ? (rawSqlSort.direction === 'desc' ? 'descending' : 'ascending') : 'none';
                        return `
                            <th class="sql-raw-th sortable ${isNum ? 'numeric' : ''}" data-col="${escapeHtml(col)}" tabindex="0" role="columnheader" aria-sort="${ariaSort}" title="Click to sort by ${escapeHtml(col)}">
                                <div class="sql-th-content">
                                    <span class="sql-th-name">${escapeHtml(col)}</span>
                                    <span class="sql-th-type">${badgeText}</span>
                                    <span class="sql-th-sort-arrow ${sortDir}">${sortIcon}</span>
                                </div>
                            </th>
                        `;
                    }).join('')}
                </tr>
            `;

            thead.querySelectorAll('th.sql-raw-th.sortable').forEach(th => {
                const col = th.dataset.col;
                const triggerSort = () => {
                    if (!col || !sqlQueryResult?.rows) return;
                    let nextDir = 'asc';
                    if (rawSqlSort.column === col) {
                        nextDir = rawSqlSort.direction === 'asc' ? 'desc' : 'asc';
                    }
                    rawSqlSort = { column: col, direction: nextDir };
                    sortRawSqlRows(sqlQueryResult.rows, col, nextDir);
                    filterState.page = 1;
                    renderResults();
                };
                th.addEventListener('click', triggerSort);
                th.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        triggerSort();
                    }
                });
            });
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

            const customThsHtml = customCols.map(col => {
                const label = col.replace(/_/g, ' ');
                return `<th class="th-custom-col sortable" data-sort="${escapeHtml(col)}" aria-sort="${getAriaSort(col)}" role="columnheader" tabindex="0" title="Click to sort by ${escapeHtml(label)}">
                    <span class="custom-col-title">${escapeHtml(label)}</span> ${getSortIndicator(col)}
                </th>`;
            }).join('');

            thead.innerHTML = `
                <tr>
                    <th class="th-expand" aria-label="Expand checkin"></th>
                    <th class="sortable" data-sort="date" aria-sort="${getAriaSort('date')}" role="columnheader" tabindex="0" title="Click to sort by departure time">Departure ${getSortIndicator('date')}</th>
                    <th class="sortable" data-sort="line" aria-sort="${getAriaSort('line')}" role="columnheader" tabindex="0" title="Click to sort by line">Line / Mode ${getSortIndicator('line')}</th>
                    <th class="sortable" data-sort="origin" aria-sort="${getAriaSort('origin')}" role="columnheader" tabindex="0" title="Click to sort by origin">Origin ${getSortIndicator('origin')}</th>
                    <th class="sortable" data-sort="destination" aria-sort="${getAriaSort('destination')}" role="columnheader" tabindex="0" title="Click to sort by destination">Destination ${getSortIndicator('destination')}</th>
                    <th class="sortable" data-sort="dist" aria-sort="${getAriaSort('dist')}" role="columnheader" tabindex="0" title="Click to sort by distance">Distance ${getSortIndicator('dist')}</th>
                    <th class="sortable" data-sort="dur" aria-sort="${getAriaSort('dur')}" role="columnheader" tabindex="0" title="Click to sort by duration">Duration ${getSortIndicator('dur')}</th>
                    <th class="sortable" data-sort="delay" aria-sort="${getAriaSort('delay')}" role="columnheader" tabindex="0" title="Click to sort by delay">Delay ${getSortIndicator('delay')}</th>
                    <th class="sortable" data-sort="buddies" aria-sort="${getAriaSort('buddies')}" role="columnheader" tabindex="0" title="Click to sort by travel companions">Companions ${getSortIndicator('buddies')}</th>
                    ${customThsHtml}
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
                if (sortSelect) {
                    const hasOption = Array.from(sortSelect.options).some(o => o.value === nextSort);
                    if (hasOption) sortSelect.value = nextSort;
                }
                filterState.page = 1;
                if (isStudio && sqlQueryResult) {
                    if (sqlQueryResult.rows) sortTrips(sqlQueryResult.rows, nextSort);
                    if (sqlQueryResult.rawTrips) sortTrips(sqlQueryResult.rawTrips, nextSort);
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
            const colSpan = isScalarCount ? 1 : (isRawSqlMode ? Math.max(1, rawCols.length + 1) : (10 + customCols.length));
            const errorMsg = isStudio && sqlQueryResult?.error;
            const emptyIcon = errorMsg
                ? '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="margin-bottom: 8px;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>'
                : '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="margin-bottom: 8px;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';
            tbody.innerHTML = `
                <tr>
                    <td colspan="${colSpan}" style="text-align: center; padding: 48px 16px;">
                        <div>${emptyIcon}</div>
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
                        const defaultSql = sqlEngine?.QUERY_RECIPES?.[0]?.sql || 'SELECT * FROM trips';
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
            const colName = sqlQueryResult.columns?.[0] || 'COUNT(*)';
            tbody.innerHTML = pageItems.map(row => `
                <tr>
                    <td style="text-align: center; font-size: 28px; font-weight: 700; color: var(--accent-cyan); padding: 36px;">
                        ${(row[colName] ?? 0).toLocaleString()}
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
                const purposeText = bType === 1 ? 'Work' : (bType === 2 ? 'Commute' : 'Leisure / Personal');

                const originPlanned = train.origin?.departurePlanned ? formatTime(train.origin.departurePlanned) : '—';
                const originReal = train.origin?.departureReal ? formatTime(train.origin.departureReal) : originPlanned;
                const destPlanned = train.destination?.arrivalPlanned ? formatTime(train.destination.arrivalPlanned) : '—';
                const destReal = train.destination?.arrivalReal ? formatTime(train.destination.arrivalReal) : destPlanned;

                const originPlatform = train.origin?.departurePlatformReal || train.origin?.platform || '—';
                const destPlatform = train.destination?.arrivalPlatformReal || train.destination?.platform || '—';
                const operator = train.operator?.name || train.operator?.identifier || train.provider?.name || train.provider || '—';

                const buddyBadgesHtml = buddies.length > 0
                    ? `<div class="buddy-pills-list">${buddies.map(b => `
                        <a href="https://traewelling.de/@${encodeURIComponent(b.username)}" target="_blank" rel="noopener noreferrer" class="buddy-badge-link" title="Open @${escapeHtml(b.username)} profile on Träwelling" onclick="event.stopPropagation()">
                            <span class="buddy-badge-icon"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align: middle;"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg></span>
                            <span>@${escapeHtml(b.username)}</span>
                        </a>
                    `).join('')}</div>`
                    : '<span style="color: var(--text-muted);">—</span>';

                const customTdsHtml = customCols.map(col => {
                    const val = item[col] !== undefined ? item[col] : (trip[col] !== undefined ? trip[col] : null);
                    if (val === null || val === undefined || val === '') {
                        return `<td class="td-custom-col" data-label="${escapeHtml(col)}"><span class="sql-null-pill">NULL</span></td>`;
                    }
                    const isNum = typeof val === 'number';
                    const formattedVal = isNum ? (Number.isInteger(val) ? val.toLocaleString() : Number(val).toFixed(2)) : escapeHtml(String(val));
                    return `<td class="td-custom-col ${isNum ? 'numeric' : ''}" data-label="${escapeHtml(col)}">${formattedVal}</td>`;
                }).join('');

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
                        ${customTdsHtml}
                        <td data-label="Actions">
                            <button type="button" class="nav-link-btn inspect-trip-btn" data-trip-id="${trip.id}" style="padding: 4px 8px; font-size: 11px;">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align: middle;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                                <span>Inspect</span>
                            </button>
                        </td>
                    </tr>
                    <tr class="trip-expand-row" id="expandRow-${trip.id}" style="display: none;">
                        <td colspan="${10 + customCols.length}" class="trip-expand-cell">
                            <div class="expand-card-container">
                                <div class="expand-comment-card ${bodyText ? '' : 'empty'}">
                                    <span class="comment-icon">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align: middle;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                                    </span>
                                    <div class="comment-body-text">
                                        ${bodyText ? renderLinkedComment(bodyText) : '<em>No checkin note or comment was attached to this journey.</em>'}
                                    </div>
                                </div>
                                ${buddies.length > 0 ? `
                                    <div class="expand-buddies-row">
                                        <span class="expand-buddies-label">
                                             <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align: middle;"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                                            <span>Travel Companions (${buddies.length}):</span>
                                        </span>
                                        <div class="expand-buddies-chips">
                                            ${buddies.map(b => `
                                                <div class="buddy-chip-wrapper">
                                                    <a href="https://traewelling.de/@${encodeURIComponent(b.username)}" target="_blank" rel="noopener noreferrer" class="buddy-link-pill" title="View @${escapeHtml(b.username)} on Träwelling" onclick="event.stopPropagation()">
                                                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align: middle;"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                                                        <span>@${escapeHtml(b.username)}</span>
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
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align: middle;"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"></polygon><line x1="9" y1="3" x2="9" y2="18"></line><line x1="15" y1="6" x2="15" y2="21"></line></svg>
                                        <span>View on Map</span>
                                    </a>
                                    <button type="button" class="nav-link-btn inspect-trip-btn" data-trip-id="${trip.id}" style="padding: 6px 14px; font-size: 12px;">
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align: middle;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                                        <span>Full Details</span>
                                    </button>
                                    <a href="https://traewelling.de/status/${encodeURIComponent(trip.uuid || trip.id)}" target="_blank" rel="noopener noreferrer" class="nav-link-btn" style="padding: 6px 14px; font-size: 12px;" onclick="event.stopPropagation()">
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align: middle;"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
                                        <span>Träwelling.de</span>
                                    </a>
                                    <a href="animation.html?trip=${trip.id}&user=${encodeURIComponent(activeSession?.username || '')}" target="_blank" rel="noopener noreferrer" class="nav-link-btn" style="padding: 6px 14px; font-size: 12px; background: linear-gradient(135deg, rgba(245, 158, 11, 0.16) 0%, rgba(168, 85, 247, 0.16) 100%); border-color: rgba(245, 158, 11, 0.4); color: #f8fafc;" onclick="event.stopPropagation()" title="Watch journey replay in Animation Studio (Alpha feature)">
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align: middle;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                                        <span>Animate</span>
                                        <span class="alpha-pill" style="margin-left: 4px; font-size: 8px; padding: 1px 4px; background: rgba(245,158,11,0.25); color: #fbbf24; border: 1px solid rgba(245,158,11,0.55); border-radius: 4px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">Alpha</span>
                                    </a>
                                </div>
                            </div>
                        </td>
                    </tr>
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

    // Attach inspect buttons (table & expanded row)
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

export function openTripDetailModal(trip) {
    openDetailModalView(trip, {
        getActiveSession: () => activeSession,
        getAllTrips: () => allTrips,
        populateBuddyDropdown,
        applyFiltersAndRender,
        updateScanButtonState,
        invalidateCaches: invalidateTripCaches
    });
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
                <div style="margin-bottom: 16px; color: var(--accent-cyan); display: flex; justify-content: center;">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg>
                </div>
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

