// Data processing functions

const CONFIG = {
    LAYER_CONFIG: [
        ['nationalExpress', '#0073ff'],
        ['national', '#00eeff'],
        ['regionalExp', '#d1024e'],
        ['regional', '#a6026c'],
        ['suburban', '#fc0000'],
        ['bus', '#238443'],
        ['tram', '#2FC5CC'],
        ['subway', '#F69A00'],
        ['plane', '#111111'],
        ['ship', '#0055aa'],
        ['unknown', '#888888']
    ]
};

/**
 * Process trips to GeoJSON by category
 */
export function processTripsToGeoJSON(trips) {
    const categories = {};
    CONFIG.LAYER_CONFIG.forEach(([cat]) => { categories[cat] = { type: 'FeatureCollection', features: [] }; });

    trips.forEach(trip => {
        const category = trip.train?.category || 'unknown';
        const targetCat = categories[category] ? category : 'unknown';
        const polyline = trip.train?.polyline;
        if (!polyline?.geometry?.coordinates) return;

        categories[targetCat].features.push({
            type: 'Feature',
            geometry: polyline.geometry,
            properties: { statusId: trip.id, createdAt: trip.createdAt, train: trip.train, body: trip.body }
        });
    });
    return categories;
}

/**
 * Check if polyline coordinates are accurate based on filter level
 */
export function isAccuratePolyline(coords, category, filterLevel = 0) {
    if (!coords || coords.length < 2) return false;
    if (category === 'plane' || category === 'ship') return true;

    if (filterLevel === 0) return true;

    let totalDist = 0;
    let maxSegmentDist = 0;
    const segments = [];
    
    for (let i = 0; i < coords.length - 1; i++) {
        const [x1,y1] = coords[i], [x2,y2] = coords[i+1];
        const dist = Math.sqrt((x2-x1)**2 + (y2-y1)**2);
        totalDist += dist;
        if (dist > maxSegmentDist) maxSegmentDist = dist;
        segments.push(dist);
    }

    // Level 2 (Strict): Detect "teleportation" and median outliers
    if (filterLevel === 2 && coords.length > 2) {
        // Loosened from 0.5 to 0.7 (max segment can be 70% of trip)
        if (totalDist > 0.1 && maxSegmentDist / totalDist > 0.7) return false;
        if (segments.length >= 8) {
            const sorted = [...segments].sort((a,b) => b-a);
            const avgTop3 = (sorted[0] + sorted[1] + sorted[2]) / 3;
            const median = sorted[Math.floor(sorted.length / 2)];
            // Loosened from 25x to 40x median
            if (avgTop3 > median * 40 && avgTop3 > 0.1) return false;
        }
    }

    // Level 1 (Normal)
    if (coords.length <= 10) {
        let threshold = 0.1;
        if (['bus','tram','subway'].includes(category)) threshold = 0.05;
        else if (['regional','regionalExp'].includes(category)) threshold = 0.2;
        else if (['national','nationalExpress'].includes(category)) threshold = 0.3;
        if (totalDist > threshold) return false;
    }
    if (totalDist > 0.3 && totalDist / coords.length > 0.027) return false;

    return true;
}

/**
 * Filter out inaccurate data based on filter level
 */
export function filterInaccurateData(data, category, filterLevel = 0) {
    if (filterLevel === 0) return data;
    const filtered = data.features.filter(f => isAccuratePolyline(f.geometry?.coordinates, category, filterLevel));
    return { type: 'FeatureCollection', features: filtered };
}

/**
 * Filter trips by date range
 */
export function filterTripsByDateRange(trips = [], fromDate, toDate) {
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
export function filterTripsByBusiness(trips = [], businessFilters) {
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
