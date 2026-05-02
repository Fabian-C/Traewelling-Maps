// Data structure utilities

/**
 * Create empty stats object
 */
export function createEmptyStats() {
    return {
        trips: 0,
        distance: 0,
        lineCounts: {},
        typeCounts: {},
        oldestDate: null,
        newestDate: null,
        oldestStatusId: null,
        newestStatusId: null
    };
}
