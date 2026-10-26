// Main application logic for Trip Database Explorer
import { SessionDB } from '../cache/session.js';
import { tripsToGeoJSON } from '../export/geojson.js';
import { deriveDelaySeconds, computeTripDurationMinutes } from '../utils/time.js';
import { formatDelayMinutes } from '../utils/format.js';
import { normalizeCategory, getTripBusinessType, extractTripTags } from '../data/processing.js';

let allSessions = [];
let activeSession = null;
let allTrips = [];
let filteredTrips = [];

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

    if (allSessions.length > 0) {
        if (requestedUser) {
            activeSession = allSessions.find(s => s.username?.toLowerCase() === requestedUser) || allSessions[0];
        } else {
            activeSession = allSessions[0];
        }
    }

    renderProfileDropdown();
    setupEventListeners();

    if (!activeSession || !Array.isArray(activeSession.trips) || activeSession.trips.length === 0) {
        showEmptyState();
        return;
    }

    allTrips = activeSession.trips.slice();

    // Populate Year pills and Companion dropdown from dataset
    populateYearPills(allTrips);
    populateBuddyDropdown(allTrips);

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
                populateYearPills(allTrips);
                populateBuddyDropdown(allTrips);
                filterState.page = 1;
                updateUrlParams();
                applyFiltersAndRender();
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
            const maxPage = Math.ceil(filteredTrips.length / filterState.pageSize);
            if (filterState.page < maxPage) {
                filterState.page++;
                renderResults();
                window.scrollTo({ top: 300, behavior: 'smooth' });
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

export function getFilteredGeoJSON() {
    return tripsToGeoJSON(filteredTrips, {
        title: `Träwelling Filtered Export (${activeSession?.username || 'user'})`,
        exportDate: new Date().toISOString()
    });
}
window.getFilteredGeoJSON = getFilteredGeoJSON;

    // Modal Close
    const modalCloseBtn = document.getElementById('closeModalBtn');
    const modal = document.getElementById('tripDetailModal');
    if (modalCloseBtn && modal) {
        modalCloseBtn.addEventListener('click', () => modal.close());
    }
}

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

    if (countEl) countEl.textContent = trips.length.toLocaleString();
    if (countSubEl) countSubEl.textContent = `of ${allTrips.length.toLocaleString()} total journeys`;
    if (distEl) distEl.textContent = `${distKm.toLocaleString()} km`;
    if (distSubEl) distSubEl.textContent = `${(distKm / 40075).toFixed(1)}x Earth laps`;
    if (punctEl) punctEl.textContent = `${punctRate}%`;
    if (durEl) durEl.textContent = `${totalHours.toLocaleString()} hrs`;
    if (durSubEl) durSubEl.textContent = `~${(totalHours / 24).toFixed(0)} days on tracks`;
}

/**
 * Render paginated results into Table and Cards
 */
function renderResults() {
    const countText = document.getElementById('resultsCountText');
    const summaryText = document.getElementById('paginationSummary');
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');

    const total = filteredTrips.length;
    const totalPages = Math.max(1, Math.ceil(total / filterState.pageSize));
    if (filterState.page > totalPages) filterState.page = totalPages;

    const startIdx = (filterState.page - 1) * filterState.pageSize;
    const endIdx = Math.min(total, startIdx + filterState.pageSize);
    const pageItems = filteredTrips.slice(startIdx, endIdx);

    if (countText) {
        countText.innerHTML = total > 0
            ? `Showing <strong>${startIdx + 1}–${endIdx}</strong> of <strong>${total.toLocaleString()}</strong> matching journeys`
            : 'No journeys match the active filters';
    }

    if (summaryText) summaryText.textContent = `Page ${filterState.page} of ${totalPages}`;
    if (prevBtn) prevBtn.disabled = (filterState.page <= 1);
    if (nextBtn) nextBtn.disabled = (filterState.page >= totalPages);

    // 1. Render Table
    const tbody = document.getElementById('tripsTableBody');
    if (tbody) {
        if (pageItems.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 40px; color: var(--text-muted);">No journeys found matching your search.</td></tr>`;
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
    const durStr = durationMin > 0 ? `${Math.floor(durationMin / 60)}h ${durationMin % 60}m` : '—';

    const delays = deriveDelaySeconds(train);
    const arrDelaySec = delays.arrival !== null ? delays.arrival : 0;
    const arrDelayMin = Math.round(arrDelaySec / 60);
    const delayFormatted = arrDelayMin > 0 ? `+${arrDelayMin} min late` : (arrDelayMin < 0 ? `${Math.abs(arrDelayMin)} min early` : 'Punctual (On-time)');

    const seat = trip.properties?.seat || train.seat?.number || train.seat || '—';
    const wagon = trip.properties?.wagon || train.seat?.wagon || train.wagon || '—';
    const ticket = trip.properties?.ticket?.name || trip.properties?.ticket || train.ticket?.name || train.ticket || '—';

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

    document.getElementById('modalDistance').textContent = `${distKm} km`;
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

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
