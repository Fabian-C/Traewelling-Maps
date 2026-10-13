// Statistics and analytics functions
import { store } from '../state/store.js';
import { escapeHtml } from '../utils/format.js';
import { normalizeCategory, indexTrip, indexTrips, getTripBusinessType, matchesTripSearch } from '../data/processing.js';

export function resetStatistics(statisticsObj) {
    if (!statisticsObj) {
        statisticsObj = { trips: 0, distance: 0, lineCounts: {}, typeCounts: {}, travelBuddies: {}, oldestDate: null, newestDate: null, oldestStatusId: null, newestStatusId: null, oldestTimestamp: null, newestTimestamp: null };
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
        statisticsObj.oldestTimestamp = null;
        statisticsObj.newestTimestamp = null;
    }
    return statisticsObj;
}

export function updateStatisticsWithTrip(trip, statisticsObj) {
    if (!statisticsObj) {
        statisticsObj = { trips: 0, distance: 0, lineCounts: {}, typeCounts: {}, travelBuddies: {}, oldestDate: null, newestDate: null, oldestStatusId: null, newestStatusId: null, oldestTimestamp: null, newestTimestamp: null };
    }
    if (!statisticsObj.travelBuddies) statisticsObj.travelBuddies = {};

    const idx = trip._index;
    let distance = 0;
    let lineName = 'Unknown';
    let category = 'unknown';
    let timestamp = null;

    if (idx) {
        distance = idx.distance;
        lineName = idx.lineName;
        category = idx.category;
        timestamp = idx.timestamp;
    } else {
        let train = trip.train || trip.properties?.train;
        if (typeof train === 'string') try { train = JSON.parse(train); } catch (e) { train = {}; }
        train = train || {};
        distance = (typeof train.totalDistance === 'number' ? train.totalDistance : train.distance) || 0;
        lineName = train.lineName || train.number || 'Unknown';
        category = normalizeCategory(train.category);
        const createdAt = trip.createdAt || trip.properties?.createdAt;
        if (createdAt) {
            const d = Date.parse(createdAt);
            if (!isNaN(d)) timestamp = d;
        }
    }

    const statusId = trip.id || trip.properties?.statusId;

    statisticsObj.trips++;
    statisticsObj.distance += distance;

    statisticsObj.lineCounts[lineName] = (statisticsObj.lineCounts[lineName] || 0) + 1;
    statisticsObj.typeCounts[category] = (statisticsObj.typeCounts[category] || 0) + 1;

    if (timestamp !== null) {
        if (statisticsObj.oldestTimestamp == null || timestamp < statisticsObj.oldestTimestamp) { 
            statisticsObj.oldestTimestamp = timestamp; 
            statisticsObj.oldestDate = new Date(timestamp); 
            statisticsObj.oldestStatusId = statusId; 
        }
        if (statisticsObj.newestTimestamp == null || timestamp > statisticsObj.newestTimestamp) { 
            statisticsObj.newestTimestamp = timestamp; 
            statisticsObj.newestDate = new Date(timestamp); 
            statisticsObj.newestStatusId = statusId; 
        }
    }

    return statisticsObj;
}

export function updateStatistics(data, category, statisticsObj) {
    if (!statisticsObj) {
        statisticsObj = { trips: 0, distance: 0, lineCounts: {}, typeCounts: {}, travelBuddies: {}, oldestDate: null, newestDate: null, oldestStatusId: null, newestStatusId: null, oldestTimestamp: null, newestTimestamp: null };
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
        ? `<a href="https://traewelling.de/status/${statisticsObj.oldestStatusId}" target="_blank" class="stat-link popup-link">${oldest.toLocaleDateString('de-DE')}</a>` : '-';
    document.getElementById('statNewestDate').innerHTML = newest && statisticsObj.newestStatusId
        ? `<a href="https://traewelling.de/status/${statisticsObj.newestStatusId}" target="_blank" class="stat-link popup-link">${newest.toLocaleDateString('de-DE')}</a>` : '-';

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
            buddiesEl.innerHTML = `
                <div class="stat-buddy-container">
                    <a href="https://traewelling.de/@${escapeHtml(displayBuddy)}" target="_blank" class="mention-link stat-top-buddy">@${escapeHtml(displayBuddy)}</a>
                    <span class="stat-buddy-badge">${displayCount} ${displayCount === 1 ? 'trip' : 'trips'}</span>
                </div>
            `;
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
/**
 * Helper to extract unique travel companions from a single trip.
 * Deduplicates multiple mentions/sources per trip and groups case-insensitively.
 * Returns a Map of lowercaseHandle -> preferredDisplayName.
 */
export function extractUniqueBuddiesFromTrip(trip, includeNotes = null, currentUsername = null) {
    const state = store.get() || {};
    const shouldIncludeNotes = includeNotes !== null ? includeNotes : !!state.filters?.includeNoteMentions;
    const currentUser = (currentUsername !== null ? currentUsername : (state.username || '')).toLowerCase().trim();

    if (trip._index && trip._index.owner === currentUser) {
        return shouldIncludeNotes ? trip._index.buddiesWithNotes : trip._index.buddiesNoNotes;
    }

    const idx = indexTrip(trip, currentUser);
    return shouldIncludeNotes ? idx.buddiesWithNotes : idx.buddiesNoNotes;
}

/**
 * Extracts travel companions and trip counts across all fetched trips
 */
export function getBuddyStats(trips = null, includeNotes = null) {
    const state = store.get() || {};
    const tripList = trips || state.fetchedTrips || [];
    const shouldIncludeNotes = includeNotes !== null ? includeNotes : !!state.filters?.includeNoteMentions;
    const currentUsername = (state.username || '').toLowerCase().trim();
    const buddyCounts = new Map(); // key: lowercase, value: { name: string, count: number }

    for (let i = 0; i < tripList.length; i++) {
        const t = tripList[i];
        const tripBuddies = extractUniqueBuddiesFromTrip(t, shouldIncludeNotes, currentUsername);
        tripBuddies.forEach((displayName, lowerHandle) => {
            const existing = buddyCounts.get(lowerHandle);
            if (!existing) {
                buddyCounts.set(lowerHandle, { name: displayName, count: 1 });
            } else {
                existing.count++;
            }
        });
    }

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

    let oldestTime = null;
    let newestTime = null;

    for (let i = 0; i < tripList.length; i++) {
        const t = tripList[i];
        const time = t._index?.timestamp !== undefined ? t._index.timestamp : (t.createdAt ? Date.parse(t.createdAt) : null);
        if (time !== null && !isNaN(time)) {
            if (oldestTime === null || time < oldestTime) oldestTime = time;
            if (newestTime === null || time > newestTime) newestTime = time;
        }
    }

    if (oldestTime !== null && newestTime !== null) {
        const minStr = new Date(oldestTime).toISOString().slice(0, 10);
        const maxStr = new Date(newestTime).toISOString().slice(0, 10);

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
            const time = t._index?.timestamp !== undefined ? t._index.timestamp : (t.createdAt ? Date.parse(t.createdAt) : null);
            if (time === null || isNaN(time)) return true;
            if (from !== null && time < from) return false;
            if (to !== null && time > to) return false;
            return true;
        });
    }

    if (state.filters.business && (!state.filters.business.personal || !state.filters.business.work || !state.filters.business.commute)) {
        contextTrips = contextTrips.filter(t => {
            const b = getTripBusinessType(t);
            if (b === 0 && !state.filters.business.personal) return false;
            if (b === 1 && !state.filters.business.work) return false;
            if (b === 2 && !state.filters.business.commute) return false;
            return true;
        });
    }

    if (state.filters.searchQuery) {
        const q = state.filters.searchQuery.trim().toLowerCase();
        contextTrips = contextTrips.filter(t => matchesTripSearch(t, q));
    }

    if (state.layers?.data) {
        const layerVisibility = new Map();
        let anyHidden = false;
        state.layers.data.forEach((layer, id) => {
            layerVisibility.set(id, layer.visible);
            if (!layer.visible) anyHidden = true;
        });
        if (anyHidden) {
            contextTrips = contextTrips.filter(t => {
                const cat = normalizeCategory(t.train?.category);
                return layerVisibility.has(cat) ? layerVisibility.get(cat) : true;
            });
        }
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

    const selectedBuddies = (state.filters.buddies || (state.filters.buddy ? [state.filters.buddy] : []))
        .map(b => String(b).toLowerCase().trim())
        .filter(Boolean);
    const selectedSet = new Set(selectedBuddies);

    if (clearBtn) {
        clearBtn.style.display = selectedBuddies.length > 0 ? '' : 'none';
    }

    if (sorted.length === 0) {
        listEl.innerHTML = '<p class="section-sub" style="margin: 0; text-align: center; font-size: 11px;">No travel buddies recorded in loaded trips</p>';
        return;
    }

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
    const stats = state.statistics;
    const shouldIncludeNotes = !!state.filters?.includeNoteMentions;
    const currentUsername = (state.username || '').toLowerCase().trim();
    const buddyCounts = new Map(); // lowercase -> { name: string, count: number }

    // Single-pass aggregation over activeTrips
    for (let i = 0; i < activeList.length; i++) {
        const trip = activeList[i];
        if (!trip) continue;
        const idx = trip._index || indexTrip(trip, currentUsername);
        const cat = idx?.category || normalizeCategory(trip.train?.category);

        const isVisible = layerVisibility.has(cat) ? layerVisibility.get(cat) : true;
        if (isVisible) {
            stats.trips++;
            stats.distance += idx?.distance || 0;
            const lineName = idx?.lineName || 'Unknown';
            stats.lineCounts[lineName] = (stats.lineCounts[lineName] || 0) + 1;
            stats.typeCounts[cat] = (stats.typeCounts[cat] || 0) + 1;

            const timestamp = idx?.timestamp;
            if (timestamp !== null && timestamp !== undefined) {
                const statusId = trip.id || trip.properties?.statusId;
                if (stats.oldestTimestamp == null || timestamp < stats.oldestTimestamp) {
                    stats.oldestTimestamp = timestamp;
                    stats.oldestDate = new Date(timestamp);
                    stats.oldestStatusId = statusId;
                }
                if (stats.newestTimestamp == null || timestamp > stats.newestTimestamp) {
                    stats.newestTimestamp = timestamp;
                    stats.newestDate = new Date(timestamp);
                    stats.newestStatusId = statusId;
                }
            }

            // Aggregate buddy stats for active visible trips in the same pass
            const tripBuddies = shouldIncludeNotes ? idx?.buddiesWithNotes : idx?.buddiesNoNotes;
            if (tripBuddies) {
                tripBuddies.forEach((displayName, lowerHandle) => {
                    const existing = buddyCounts.get(lowerHandle);
                    if (!existing) {
                        buddyCounts.set(lowerHandle, { name: displayName, count: 1 });
                    } else {
                        existing.count++;
                    }
                });
            }
        }
    }

    const buddiesObj = {};
    buddyCounts.forEach(val => {
        buddiesObj[val.name] = val.count;
    });
    stats.travelBuddies = buddiesObj;

    refreshStatsDisplay(stats);
}
