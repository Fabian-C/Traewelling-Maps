// Statistics and analytics functions
import { store } from '../state/store.js';
import { escapeHtml } from '../utils/format.js';
import { normalizeCategory } from '../data/processing.js';

export function resetStatistics(statisticsObj) {
    if (!statisticsObj) {
        statisticsObj = { trips: 0, distance: 0, lineCounts: {}, typeCounts: {}, travelBuddies: {}, oldestDate: null, newestDate: null, oldestStatusId: null, newestStatusId: null };
    } else {
        statisticsObj.trips = 0;
        statisticsObj.distance = 0;
        statisticsObj.lineCounts = {};
        statisticsObj.typeCounts = {};
        statisticsObj.travelBuddies = {};
        statisticsObj.oldestDate = null;
        statisticsObj.newestDate = null;
        statisticsObj.oldestStatusId = null;
        statisticsObj.newestStatusId = null;
    }
    return statisticsObj;
}

export function updateStatisticsWithTrip(trip, statisticsObj) {
    if (!statisticsObj) {
        statisticsObj = { trips: 0, distance: 0, lineCounts: {}, typeCounts: {}, travelBuddies: {}, oldestDate: null, newestDate: null, oldestStatusId: null, newestStatusId: null };
    }
    if (!statisticsObj.travelBuddies) statisticsObj.travelBuddies = {};

    let train = trip.train || trip.properties?.train;
    if (typeof train === 'string') try { train = JSON.parse(train); } catch (e) { train = {}; }
    train = train || {};
    const distance = (typeof train.totalDistance === 'number' ? train.totalDistance : train.distance) || 0;
    const createdAt = trip.createdAt || trip.properties?.createdAt;
    const statusId = trip.id || trip.properties?.statusId;
    const category = normalizeCategory(train.category);

    statisticsObj.trips++;
    statisticsObj.distance += distance;

    const lineName = train.lineName || train.number || 'Unknown';
    statisticsObj.lineCounts[lineName] = (statisticsObj.lineCounts[lineName] || 0) + 1;
    statisticsObj.typeCounts[category] = (statisticsObj.typeCounts[category] || 0) + 1;


    if (createdAt) {
        const d = new Date(createdAt);
        if (!isNaN(d.getTime())) {
            if (!statisticsObj.oldestDate || d < statisticsObj.oldestDate) { 
                statisticsObj.oldestDate = d; 
                statisticsObj.oldestStatusId = statusId; 
            }
            if (!statisticsObj.newestDate || d > statisticsObj.newestDate) { 
                statisticsObj.newestDate = d; 
                statisticsObj.newestStatusId = statusId; 
            }
        }
    }

    return statisticsObj;
}

export function updateStatistics(data, category, statisticsObj) {
    if (!statisticsObj) {
        statisticsObj = { trips: 0, distance: 0, lineCounts: {}, typeCounts: {}, travelBuddies: {}, oldestDate: null, newestDate: null, oldestStatusId: null, newestStatusId: null };
    }
    if (data?.features) {
        data.features.forEach(f => {
            updateStatisticsWithTrip(f, statisticsObj);
        });
    } else if (Array.isArray(data)) {
        data.forEach(t => {
            updateStatisticsWithTrip(t, statisticsObj);
        });
    }
    return statisticsObj;
}

export function refreshStatsDisplay(statisticsObj) {
    if (!statisticsObj) return;
    document.getElementById('statTrips').textContent = statisticsObj.trips;
    document.getElementById('statDistance').textContent = Math.round(statisticsObj.distance / 1000 * 100) / 100 + ' km';

    const mostLine = Object.entries(statisticsObj.lineCounts).sort((a,b) => b[1]-a[1])[0];
    document.getElementById('statLine').textContent = mostLine ? mostLine[0] : '-';

    const mostType = Object.entries(statisticsObj.typeCounts).sort((a,b) => b[1]-a[1])[0];
    document.getElementById('statType').textContent = mostType ? mostType[0] : '-';

    const oldest = statisticsObj.oldestDate;
    const newest = statisticsObj.newestDate;
    document.getElementById('statOldestDate').innerHTML = oldest && statisticsObj.oldestStatusId
        ? `<a href="https://traewelling.de/status/${statisticsObj.oldestStatusId}" target="_blank" class="popup-link">${oldest.toLocaleDateString('de-DE')}</a>` : '-';
    document.getElementById('statNewestDate').innerHTML = newest && statisticsObj.newestStatusId
        ? `<a href="https://traewelling.de/status/${statisticsObj.newestStatusId}" target="_blank" class="popup-link">${newest.toLocaleDateString('de-DE')}</a>` : '-';

    // Favorite travel buddy in Stats panel
    const buddiesItem = document.getElementById('statBuddiesItem');
    const buddiesEl = document.getElementById('statBuddies');
    if (buddiesItem && buddiesEl) {
        const state = store.get();
        const selectedBuddies = state.filters?.buddies || (state.filters?.buddy ? [state.filters.buddy] : []);
        const activeBuddyFilter = selectedBuddies.length > 0 ? selectedBuddies[0] : null;

        let displayBuddy = null;
        let displayCount = 0;

        if (activeBuddyFilter && statisticsObj.travelBuddies) {
            const lowerFilter = String(activeBuddyFilter).toLowerCase().trim();
            for (const [name, count] of Object.entries(statisticsObj.travelBuddies)) {
                if (name.toLowerCase() === lowerFilter) {
                    displayBuddy = name;
                    displayCount = count;
                    break;
                }
            }
            if (!displayBuddy) {
                displayBuddy = activeBuddyFilter;
                displayCount = statisticsObj.travelBuddies[activeBuddyFilter] || 0;
            }
        } else {
            const sortedBuddies = Object.entries(statisticsObj.travelBuddies || {})
                .sort((a,b) => b[1] - a[1]);
            if (sortedBuddies.length > 0) {
                [displayBuddy, displayCount] = sortedBuddies[0];
            }
        }

        if (displayBuddy && displayCount > 0) {
            buddiesItem.style.display = 'flex';
            buddiesEl.innerHTML = `<a href="https://traewelling.de/@${escapeHtml(displayBuddy)}" target="_blank" class="mention-link stat-top-buddy">@${escapeHtml(displayBuddy)}</a> <span class="stat-buddy-badge">${displayCount} ${displayCount === 1 ? 'trip' : 'trips'}</span>`;
        } else {
            buddiesItem.style.display = 'none';
            buddiesEl.textContent = '-';
        }
    }

    updateMenuBuddyList();
}

/**
 * Helper to extract unique travel companions from a single trip.
 * Deduplicates multiple mentions/sources per trip and groups case-insensitively.
 * Returns a Map of lowercaseHandle -> preferredDisplayName.
 */
export function extractUniqueBuddiesFromTrip(trip, includeNotes = null, currentUsername = null) {
    const state = store.get() || {};
    const shouldIncludeNotes = includeNotes !== null ? includeNotes : !!state.filters?.includeNoteMentions;
    const currentUser = (currentUsername !== null ? currentUsername : (state.username || '')).toLowerCase().trim();
    const buddyMap = new Map(); // key: lowercase username, value: display username

    const addBuddy = (name) => {
        if (!name) return;
        const cleanName = String(name).trim();
        const lower = cleanName.toLowerCase();
        if (!lower || (currentUser && lower === currentUser)) return;
        if (!buddyMap.has(lower)) {
            buddyMap.set(lower, cleanName);
        }
    };

    // 1. Structured API bodyMentions
    let mentions = trip.bodyMentions || trip.properties?.bodyMentions;
    if (typeof mentions === 'string') {
        try { mentions = JSON.parse(mentions); } catch (e) { mentions = []; }
    }
    if (Array.isArray(mentions)) {
        mentions.forEach(m => {
            const u = m.user?.username || m.username;
            addBuddy(u);
        });
    }

    // 2. Structured API createdBy (e.g. check-in created by companion)
    let createdBy = trip.createdBy || trip.properties?.createdBy;
    if (typeof createdBy === 'string') {
        try { createdBy = JSON.parse(createdBy); } catch (e) { createdBy = null; }
    }
    const createdByUsername = createdBy?.username;
    addBuddy(createdByUsername);

    // 3. Structured API fellowPassengers / alsoOnThisConnection if available
    let fps = trip.fellowPassengers || trip.properties?.fellowPassengers;
    if (typeof fps === 'string') {
        try { fps = JSON.parse(fps); } catch (e) { fps = []; }
    }
    if (Array.isArray(fps)) {
        fps.forEach(fp => {
            const u = fp.user?.username || fp.username;
            addBuddy(u);
        });
    }

    // 4. Optionally parse @mentions from check-in notes text
    if (shouldIncludeNotes) {
        const noteText = trip.body || trip.properties?.body;
        if (typeof noteText === 'string' && noteText.includes('@')) {
            // Match @username (alphanumeric, underscore, hyphen)
            const matches = noteText.match(/@([a-zA-Z0-9_-]+)/g);
            if (matches) {
                matches.forEach(m => {
                    const handle = m.substring(1);
                    addBuddy(handle);
                });
            }
        }
    }

    return buddyMap;
}

/**
 * Extracts travel companions and trip counts across all fetched trips
 */
export function getBuddyStats(trips = null, includeNotes = null) {
    const state = store.get() || {};
    const tripList = trips || state.fetchedTrips || [];
    const currentUsername = (state.username || '').toLowerCase().trim();
    const buddyCounts = new Map(); // key: lowercase, value: { name: string, count: number }

    tripList.forEach(t => {
        const tripBuddies = extractUniqueBuddiesFromTrip(t, includeNotes, currentUsername);
        tripBuddies.forEach((displayName, lowerHandle) => {
            if (!buddyCounts.has(lowerHandle)) {
                buddyCounts.set(lowerHandle, { name: displayName, count: 0 });
            }
            buddyCounts.get(lowerHandle).count++;
        });
    });

    // Convert to dictionary { [displayName]: count }
    const result = {};
    buddyCounts.forEach(val => {
        result[val.name] = val.count;
    });
    return result;
}

/**
 * Prefills the time filter inputs with the first and last dates from the user's travel data.
 * Should ONLY be called when initializing the full dataset or resetting the filter.
 */
export function initializeDateInputs(trips = null) {
    const dateFrom = document.getElementById('dateFrom');
    const dateTo = document.getElementById('dateTo');
    if (!dateFrom && !dateTo) return;

    const state = store.get();
    const tripList = trips || state.fetchedTrips || [];
    if (!tripList.length) return;

    let oldest = null;
    let newest = null;

    tripList.forEach(t => {
        const raw = t.createdAt || t.train?.origin?.departure || t.train?.origin?.plannedDeparture;
        if (raw) {
            const d = new Date(raw);
            if (!isNaN(d.getTime())) {
                if (!oldest || d < oldest) oldest = d;
                if (!newest || d > newest) newest = d;
            }
        }
    });

    if (oldest && newest) {
        const oldestD = oldest instanceof Date ? oldest : new Date(oldest);
        const newestD = newest instanceof Date ? newest : new Date(newest);
        const minStr = oldestD.toISOString().slice(0, 10);
        const maxStr = newestD.toISOString().slice(0, 10);

        // Store dataset boundaries
        state.dateBounds = { min: minStr, max: maxStr };

        // Set min and max limits based on the full dataset so user can always pick any date
        if (dateFrom) {
            dateFrom.min = minStr;
            dateFrom.max = maxStr;
            dateFrom.value = minStr;
        }
        if (dateTo) {
            dateTo.min = minStr;
            dateTo.max = maxStr;
            dateTo.value = maxStr;
        }
    }
}

let activeBuddySelectHandler = null;

export function registerBuddySelectHandler(handler) {
    activeBuddySelectHandler = handler;
}

/**
 * Gets trips for buddy calculations matching active filters (date, business, search)
 * without requiring geodata/polylines so all buddies with or without geodata are counted.
 */
export function getFilteredContextTrips() {
    const state = store.get();
    let contextTrips = state.fetchedTrips || [];
    if (state.filters.fromDate || state.filters.toDate) {
        const from = state.filters.fromDate ? new Date(state.filters.fromDate + 'T00:00:00Z').getTime() : null;
        const to = state.filters.toDate ? new Date(state.filters.toDate + 'T23:59:59.999Z').getTime() : null;
        contextTrips = contextTrips.filter(t => {
            const raw = t?.createdAt || t?.train?.origin?.departure || t?.train?.origin?.plannedDeparture;
            if (!raw) return true;
            const time = new Date(raw).getTime();
            if (isNaN(time)) return true;
            if (from !== null && time < from) return false;
            if (to !== null && time > to) return false;
            return true;
        });
    }

    if (state.filters.business && (!state.filters.business.personal || !state.filters.business.work || !state.filters.business.commute)) {
        contextTrips = contextTrips.filter(t => {
            const b = t?.business;
            if (b === 0 && !state.filters.business.personal) return false;
            if (b === 1 && !state.filters.business.work) return false;
            if (b === 2 && !state.filters.business.commute) return false;
            return true;
        });
    }

    if (state.filters.searchQuery) {
        const q = state.filters.searchQuery.toLowerCase();
        contextTrips = contextTrips.filter(t => {
            if (t.body && String(t.body).toLowerCase().includes(q)) return true;
            const train = t.train || {};
            const line = (train.lineName || train.number || '').toLowerCase();
            const origin = (train.origin?.name || '').toLowerCase();
            const dest = (train.destination?.name || '').toLowerCase();
            return line.includes(q) || origin.includes(q) || dest.includes(q);
        });
    }

    return contextTrips;
}

/**
 * Updates the dedicated Travel Buddies list in the menu and binds filter interactions
 */
export function updateMenuBuddyList(onSelectBuddy = null) {
    if (onSelectBuddy) {
        activeBuddySelectHandler = onSelectBuddy;
    }
    const state = store.get();
    const listEl = document.getElementById('menuBuddyList');
    const clearBtn = document.getElementById('clearBuddyFilterBtn');
    if (!listEl) return;

    // Calculate buddy stats dynamically from current filter context (ignoring buddy filter so all companions in the active subset are visible)
    const contextTrips = getFilteredContextTrips();
    const buddies = getBuddyStats(contextTrips);
    const sorted = Object.entries(buddies).sort((a, b) => b[1] - a[1]);
    const metCount = sorted.length;

    // Update count in travel buddy expanded section
    const totalMet = Object.keys(getBuddyStats(state.fetchedTrips || [])).length;
    const metCountEl = document.getElementById('travelBuddiesMetCount');
    if (metCountEl) {
        if (totalMet > metCount) {
            metCountEl.textContent = `Traveled with ${metCount} of ${totalMet}`;
        } else {
            metCountEl.textContent = `Traveled with ${metCount} companion${metCount !== 1 ? 's' : ''}`;
        }
    }

    if (clearBtn) {
        clearBtn.style.display = 'none';
    }

    if (sorted.length === 0) {
        listEl.innerHTML = '<p class="section-sub" style="margin: 0; text-align: center; font-size: 11px;">No travel buddies recorded in loaded trips</p>';
        return;
    }

    const selectedBuddies = (state.filters.buddies || (state.filters.buddy ? [state.filters.buddy] : []))
        .map(b => String(b).toLowerCase().trim());
    const selectedSet = new Set(selectedBuddies);

    listEl.innerHTML = sorted.map(([user, count]) => {
        const isActive = selectedSet.has(user.toLowerCase());
        return `
            <div class="buddy-item ${isActive ? 'active' : ''}" data-buddy="${escapeHtml(user)}" role="button" tabindex="0">
                <div class="buddy-item-left">
                    <span class="buddy-item-icon">${isActive ? '✓' : '👤'}</span>
                    <span class="buddy-item-name">@${escapeHtml(user)}</span>
                </div>
                <span class="buddy-item-count">${count} ${count === 1 ? 'trip' : 'trips'}</span>
            </div>
        `;
    }).join('');

    listEl.querySelectorAll('.buddy-item').forEach(item => {
        item.onclick = () => {
            const buddy = item.dataset.buddy;
            if (typeof activeBuddySelectHandler === 'function') {
                activeBuddySelectHandler(buddy);
            }
        };
    });
}

export function updateAllStatistics() {
    const state = store.get();
    state.statistics = resetStatistics(state.statistics);

    // Get layer visibility map
    const layerVisibility = new Map();
    state.layers.data.forEach((layer, id) => {
        layerVisibility.set(id, layer.visible);
    });

    const activeList = state.activeTrips || [];
    activeList.forEach(trip => {
        const cat = normalizeCategory(trip.train?.category);
        // If layer exists, check its visibility; if not tracked in layers (or legacy category), include by default
        const isVisible = layerVisibility.has(cat) ? layerVisibility.get(cat) : true;
        if (isVisible) {
            state.statistics = updateStatisticsWithTrip(trip, state.statistics);
        }
    });

    // Ensure travel buddy counts in statistics align with menu buddy counts across all trips (including those without geodata)
    const contextTrips = getFilteredContextTrips();
    state.statistics.travelBuddies = getBuddyStats(contextTrips);

    refreshStatsDisplay(state.statistics);
}
