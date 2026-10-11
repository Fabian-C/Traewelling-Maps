// Centralized filter manager module
// All filter logic is centralized here for consistency and modularity

import { isAccuratePolyline } from '../data/processing.js';

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
        apply: (trips, config) => filterTripsByBuddy(trips, config.buddy)
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
        const raw = trip?.createdAt || trip?.train?.origin?.departure || trip?.train?.origin?.plannedDeparture;
        if (!raw) return true;
        const time = new Date(raw).getTime();
        if (isNaN(time)) return true;
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
        const businessValue = trip?.business;
        
        // business: 0 = personal, 1 = work, 2 = commute (based on Träwelling API)
        if (businessValue === 0 && !businessFilters.personal) return false;
        if (businessValue === 1 && !businessFilters.work) return false;
        if (businessValue === 2 && !businessFilters.commute) return false;
        
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
        const category = trip.train?.category || 'unknown';
        const coords = trip.train?.polyline?.geometry?.coordinates;
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
        // Search in status body / comment
        if (trip.body && String(trip.body).toLowerCase().includes(q)) return true;
        // Search in bodyMentions usernames
        if (Array.isArray(trip.bodyMentions)) {
            if (trip.bodyMentions.some(m => {
                const u = m.user?.username || m.username || '';
                const d = m.user?.displayName || '';
                return u.toLowerCase().includes(q) || d.toLowerCase().includes(q);
            })) return true;
        }
        // Search lineName or origin / destination
        const train = trip.train || {};
        const line = (train.lineName || train.number || '').toLowerCase();
        const origin = (train.origin?.name || '').toLowerCase();
        const dest = (train.destination?.name || '').toLowerCase();
        return line.includes(q) || origin.includes(q) || dest.includes(q);
    });
}

/**
 * Filter trips by specific travel buddy (from API data: bodyMentions, createdBy, fellowPassengers)
 */
function filterTripsByBuddy(trips, targetBuddy) {
    if (!trips.length || !targetBuddy) return trips.slice();
    const target = targetBuddy.toLowerCase().trim();
    return trips.filter(trip => {
        // Check bodyMentions
        let mentions = trip.bodyMentions || trip.properties?.bodyMentions;
        if (typeof mentions === 'string') {
            try { mentions = JSON.parse(mentions); } catch (e) { mentions = []; }
        }
        if (Array.isArray(mentions)) {
            if (mentions.some(m => {
                const u = m.user?.username || m.username || '';
                return u.toLowerCase() === target;
            })) return true;
        }
        // Check createdBy
        const createdBy = trip.createdBy?.username || trip.properties?.createdBy?.username;
        if (createdBy && createdBy.toLowerCase() === target) {
            return true;
        }
        // Check fellowPassengers / alsoOnThisConnection if present
        let fps = trip.fellowPassengers || trip.properties?.fellowPassengers;
        if (typeof fps === 'string') {
            try { fps = JSON.parse(fps); } catch (e) { fps = []; }
        }
        if (Array.isArray(fps)) {
            if (fps.some(fp => (fp.user?.username || fp.username || '').toLowerCase() === target)) return true;
        }
        return false;
    });
}

