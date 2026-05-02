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
    
    // Apply filters in order: date -> business -> accuracy
    // This order is important for performance and correctness
    filtered = filters.dateRange.apply(filtered, filterConfig);
    filtered = filters.business.apply(filtered, filterConfig);
    filtered = filters.accuracy.apply(filtered, filterConfig);
    
    return filtered;
}

/**
 * Filter trips by date range
 */
function filterTripsByDateRange(trips, fromDate, toDate) {
    if (!trips.length) return [];
    if (!fromDate && !toDate) return trips.slice();
    
    const from = fromDate ? new Date(fromDate + 'T00:00:00Z') : null;
    const to = toDate ? new Date(toDate + 'T23:59:59Z') : null;
    
    return trips.filter(trip => {
        if (!trip?.createdAt) return true;
        const created = new Date(trip.createdAt);
        if (from && created < from) return false;
        if (to && created > to) return false;
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
 * Apply a specific filter by key
 */
export function applyFilter(trips, filterKey, config) {
    const filter = filters[filterKey];
    if (!filter) {
        console.warn(`Filter ${filterKey} not found`);
        return trips;
    }
    return filter.apply(trips, config);
}
