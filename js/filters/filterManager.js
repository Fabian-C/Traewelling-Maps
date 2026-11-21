// @ts-check
// Centralized filter manager module
// All filter logic is centralized here for consistency and modularity

import { isAccuratePolyline, normalizeCategory, getTripBusinessType, matchesTripSearch } from '../data/processing.js';
import { extractUniqueBuddiesFromTrip } from '../analytics/statistics.js';

/** @type {WeakMap<Array<any>, Map<number, boolean>>} */
const polylineAccuracyCache = new WeakMap();

/**
 * Cached polyline accuracy check keyed by coordinate array reference & filterLevel.
 * Prevents recomputing Haversine geometry over 5,000+ trips on every search keystroke.
 * @param {any} trip
 * @param {number} filterLevel
 * @returns {boolean}
 */
function isTripAccurateCached(trip, filterLevel) {
    if (filterLevel === 0) return true;
    const train = trip.train || trip.checkin || trip.properties?.train || trip.properties?.checkin;
    const coords = train?.polyline?.geometry?.coordinates;
    if (!coords || coords.length < 2) return true;

    let levelMap = polylineAccuracyCache.get(coords);
    if (levelMap && levelMap.has(filterLevel)) {
        return Boolean(levelMap.get(filterLevel));
    }
    const category = trip._index?.category || normalizeCategory(train?.category);
    const accurate = isAccuratePolyline(coords, category, filterLevel);
    if (!levelMap) {
        levelMap = new Map();
        polylineAccuracyCache.set(coords, levelMap);
    }
    levelMap.set(filterLevel, accurate);
    return accurate;
}

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
 * Apply all filters in a single short-circuiting pass at trip level.
 * Avoids 5x intermediate array allocations and caches polyline accuracy checks.
 * @param {Array<any>} trips
 * @param {any} filterConfig
 * @returns {Array<any>}
 */
export function applyAllFilters(trips, filterConfig) {
    if (!trips || !Array.isArray(trips)) return [];
    if (!trips.length) return [];
    const cfg = filterConfig || {};

    // Pre-parse filter boundaries once (O(1))
    const fromMs = cfg.fromDate ? new Date(cfg.fromDate + 'T00:00:00Z').getTime() : null;
    const toMs = cfg.toDate ? new Date(cfg.toDate + 'T23:59:59.999Z').getTime() : null;
    const hasDateFilter = fromMs !== null || toMs !== null;

    const business = cfg.business || null;
    const hasBusinessFilter = Boolean(business && (!business.personal || !business.work || !business.commute));

    const rawBuddies = cfg.buddies || cfg.buddy;
    const buddyList = rawBuddies ? (Array.isArray(rawBuddies) ? rawBuddies : [rawBuddies]) : [];
    const targets = buddyList.map(b => String(b).toLowerCase().trim()).filter(Boolean);
    const hasBuddyFilter = targets.length > 0;
    const includeNotes = Boolean(cfg.includeNoteMentions);

    const searchQ = (cfg.searchQuery && cfg.searchQuery.trim()) ? cfg.searchQuery.trim().toLowerCase() : '';
    const filterLevel = cfg.filterLevel !== undefined ? cfg.filterLevel : 1;

    const result = [];
    for (let i = 0; i < trips.length; i++) {
        const trip = trips[i];

        // 1. Date Range
        if (hasDateFilter) {
            const idx = trip._index;
            const time = idx?.timestamp !== undefined ? idx.timestamp : (trip.createdAt ? new Date(trip.createdAt).getTime() : null);
            if (time !== null && !Number.isNaN(time)) {
                if (fromMs !== null && time < fromMs) continue;
                if (toMs !== null && time > toMs) continue;
            }
        }

        // 2. Business Type
        if (hasBusinessFilter) {
            const b = trip._index?.business !== undefined ? trip._index.business : getTripBusinessType(trip);
            if (b === 0 && !business.personal) continue;
            if (b === 1 && !business.work) continue;
            if (b === 2 && !business.commute) continue;
        }

        // 3. Travel Buddy
        if (hasBuddyFilter) {
            let matchedBuddy = false;
            if (trip._index) {
                const set = includeNotes ? trip._index.buddySetWithNotes : trip._index.buddySetNoNotes;
                for (let j = 0; j < targets.length; j++) {
                    if (set.has(targets[j])) {
                        matchedBuddy = true;
                        break;
                    }
                }
            } else {
                const tripBuddies = extractUniqueBuddiesFromTrip(trip, includeNotes);
                for (let j = 0; j < targets.length; j++) {
                    if (tripBuddies.has(targets[j])) {
                        matchedBuddy = true;
                        break;
                    }
                }
            }
            if (!matchedBuddy) continue;
        }

        // 4. Search Query
        if (searchQ && !matchesTripSearch(trip, searchQ)) {
            continue;
        }

        // 5. Polyline Accuracy (cached per coords array + filterLevel)
        if (filterLevel !== 0 && !isTripAccurateCached(trip, filterLevel)) {
            continue;
        }

        result.push(trip);
    }

    return result;
}

/**
 * Filter trips by date range
 */
export function filterTripsByDateRange(trips, fromDate, toDate) {
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
function filterTripsByAccuracy(trips, filterLevel = 1) {
    if (!trips.length) return [];
    if (filterLevel === 0) return trips.slice();
    
    return trips.filter(trip => {
        const train = trip.train || trip.checkin || trip.properties?.train || trip.properties?.checkin;
        const category = trip._index?.category || normalizeCategory(train?.category);
        const coords = train?.polyline?.geometry?.coordinates;
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
 * Filter trips by free-text search (comments, mentions, buddies, line names, stations, tickets, wagon/coach, seat, tags)
 */
function filterTripsBySearch(trips, query) {
    if (!query || !query.trim()) return trips;
    const q = query.trim().toLowerCase();
    return trips.filter(trip => matchesTripSearch(trip, q));
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

