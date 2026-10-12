// Centralized filter manager module
// All filter logic is centralized here for consistency and modularity

import { isAccuratePolyline, normalizeCategory, getTripBusinessType } from '../data/processing.js';
import { extractUniqueBuddiesFromTrip } from '../analytics/statistics.js';

// Filter registry - allows easy addition of new filters
const filters = {
    dateRange: {
        name: 'Date Range',
        apply: (trips, config) => filterTripsByDateRange(trips, config.fromDate, config.toDate)
    },
    business: {
        name: 'Business Type',
        apply: (trips, config) => filterTripsByBusiness(trips, config.business)
    },
    buddy: {
        name: 'Travel Buddy',
        apply: (trips, config) => filterTripsByBuddy(trips, config.buddies || config.buddy, config.includeNoteMentions)
    },
    search: {
        name: 'Search Query',
        apply: (trips, config) => filterTripsBySearch(trips, config.searchQuery)
    },
    accuracy: {
        name: 'Accuracy',
        apply: (trips, config) => filterTripsByAccuracy(trips, config.filterLevel)
    }
};

/**
 * Apply all filters in consistent order at trip level
 * This ensures all components (map, heatmap, statistics) see the same filtered data
 */
export function applyAllFilters(trips, filterConfig) {
    if (!trips || !Array.isArray(trips)) return [];
    
    let filtered = trips;
    
    // Apply filters in order: date -> business -> buddy -> search -> accuracy
    filtered = filters.dateRange.apply(filtered, filterConfig);
    filtered = filters.business.apply(filtered, filterConfig);
    filtered = filters.buddy.apply(filtered, filterConfig);
    filtered = filters.search.apply(filtered, filterConfig);
    filtered = filters.accuracy.apply(filtered, filterConfig);
    
    return filtered;
}

/**
 * Filter trips by date range
 */
function filterTripsByDateRange(trips, fromDate, toDate) {
    if (!trips.length) return [];
    if (!fromDate && !toDate) return trips.slice();
    
    const from = fromDate ? new Date(fromDate + 'T00:00:00Z').getTime() : null;
    const to = toDate ? new Date(toDate + 'T23:59:59.999Z').getTime() : null;
    
    return trips.filter(trip => {
        const idx = trip._index;
        const time = idx?.timestamp !== undefined ? idx.timestamp : (trip.createdAt ? new Date(trip.createdAt).getTime() : null);
        if (time === null || isNaN(time)) return true;
        if (from !== null && time < from) return false;
        if (to !== null && time > to) return false;
        return true;
    });
}

/**
 * Filter trips by business type (personal, work, commute)
 */
function filterTripsByBusiness(trips, businessFilters) {
    if (!trips.length) return [];
    if (!businessFilters) return trips.slice();
    
    return trips.filter(trip => {
        const b = getTripBusinessType(trip);
        if (b === 0 && !businessFilters.personal) return false;
        if (b === 1 && !businessFilters.work) return false;
        if (b === 2 && !businessFilters.commute) return false;
        return true;
    });
}

/**
 * Filter trips by accuracy at trip level
 * This is more efficient than filtering at GeoJSON level
 */
function filterTripsByAccuracy(trips, filterLevel) {
    if (!trips.length) return [];
    if (filterLevel === 0) return trips.slice();
    
    return trips.filter(trip => {
        const category = trip._index?.category || normalizeCategory(trip.train?.category);
        const coords = trip.train?.polyline?.geometry?.coordinates;
        // Check-ins without geodata do not disrupt the map and must still be counted in statistics
        if (!coords || coords.length < 2) return true;
        return isAccuratePolyline(coords, category, filterLevel);
    });
}

/**
 * Register a new filter (for extensibility)
 */
export function registerFilter(key, name, applyFn) {
    if (filters[key]) {
        console.warn(`Filter ${key} already exists, overwriting`);
    }
    filters[key] = { name, apply: applyFn };
}

/**
 * Get all registered filters
 */
export function getRegisteredFilters() {
    return Object.keys(filters).map(key => ({ key, ...filters[key] }));
}

/**
 * Filter trips by free-text search (comments, mentions, buddies, line names, stations)
 */
function filterTripsBySearch(trips, query) {
    if (!query || !query.trim()) return trips;
    const q = query.trim().toLowerCase();
    return trips.filter(trip => {
        if (trip._index) {
            return trip._index.searchCorpus.includes(q);
        }
        // Fallback if not indexed
        if (trip.body && String(trip.body).toLowerCase().includes(q)) return true;
        if (Array.isArray(trip.bodyMentions)) {
            if (trip.bodyMentions.some(m => {
                const u = m.user?.username || m.username || '';
                const d = m.user?.displayName || '';
                return u.toLowerCase().includes(q) || d.toLowerCase().includes(q);
            })) return true;
        }
        const train = trip.train || {};
        const line = (train.lineName || train.number || '').toLowerCase();
        const origin = (train.origin?.name || '').toLowerCase();
        const dest = (train.destination?.name || '').toLowerCase();
        return line.includes(q) || origin.includes(q) || dest.includes(q);
    });
}

/**
 * Filter trips by specific travel buddy or buddies (from deduplicated sources: bodyMentions, createdBy, fellowPassengers, and optional notes)
 */
function filterTripsByBuddy(trips, targetBuddies, includeNotes = false) {
    if (!trips.length || !targetBuddies) return trips.slice();
    const buddyList = Array.isArray(targetBuddies) ? targetBuddies : [targetBuddies];
    const targets = buddyList.map(b => String(b).toLowerCase().trim()).filter(Boolean);
    if (!targets.length) return trips.slice();

    return trips.filter(trip => {
        if (trip._index) {
            const set = includeNotes ? trip._index.buddySetWithNotes : trip._index.buddySetNoNotes;
            for (let i = 0; i < targets.length; i++) {
                if (set.has(targets[i])) return true;
            }
            return false;
        }
        const tripBuddies = extractUniqueBuddiesFromTrip(trip, includeNotes);
        for (let i = 0; i < targets.length; i++) {
            if (tripBuddies.has(targets[i])) return true;
        }
        return false;
    });
}

