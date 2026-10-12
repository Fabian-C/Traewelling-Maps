// Data processing functions
import { CONFIG } from '../config/config.js';

const KNOWN_CATEGORIES = new Set([
    'nationalExpress', 'national', 'regionalExp', 'regional',
    'suburban', 'bus', 'tram', 'subway', 'taxi', 'plane', 'ferry'
]);

/**
 * Normalize transport categories from Träwelling API (e.g. ferry vs ship, unknown, taxi)
 */
export function normalizeCategory(category) {
    if (!category) return 'unknown';
    const c = typeof category === 'string' ? category.trim() : String(category);
    const lower = c.toLowerCase();
    if (lower === 'ship') return 'ferry';
    if (lower === 'taxi' || lower === 'cab' || lower === 'taxicab' || lower === 'rideshare' || lower === 'ondemand' || lower === 'on-demand') return 'taxi';
    if (KNOWN_CATEGORIES.has(c)) return c;
    for (const known of KNOWN_CATEGORIES) {
        if (known.toLowerCase() === lower) return known;
    }
    return 'unknown';
}

/**
 * Pre-indexes a trip for ultra-fast filtering and analytics.
 * Attaches _index object to the trip.
 */
export function indexTrip(trip, currentUsername = '') {
    const currentUser = (currentUsername || '').toLowerCase().trim();
    if (trip._index && trip._index.owner === currentUser) {
        return trip._index;
    }

    const train = trip.train || trip.properties?.train || {};
    const rawDate = trip.createdAt || trip.properties?.createdAt || train.origin?.departure || train.origin?.plannedDeparture;
    let timestamp = null;
    if (rawDate) {
        const parsed = Date.parse(rawDate);
        if (!isNaN(parsed)) timestamp = parsed;
    }

    const category = normalizeCategory(train.category);
    const distance = (typeof train.totalDistance === 'number' ? train.totalDistance : train.distance) || 0;
    const lineName = train.lineName || train.number || train.name || 'Unknown';
    const originName = train.origin?.name || train.origin?.station?.name || '';
    const destName = train.destination?.name || train.destination?.station?.name || '';
    const bodyText = typeof trip.body === 'string' ? trip.body : '';

    let mentionsText = '';
    const buddiesNoNotes = new Map();
    const buddiesWithNotes = new Map();

    const addBuddy = (name) => {
        if (!name) return;
        const clean = String(name).trim();
        const lower = clean.toLowerCase();
        if (!lower || (currentUser && lower === currentUser)) return;
        if (!buddiesNoNotes.has(lower)) {
            buddiesNoNotes.set(lower, clean);
        }
        if (!buddiesWithNotes.has(lower)) {
            buddiesWithNotes.set(lower, clean);
        }
    };

    // 1. bodyMentions
    let mentions = trip.bodyMentions || trip.properties?.bodyMentions;
    if (typeof mentions === 'string') {
        try { mentions = JSON.parse(mentions); } catch (e) { mentions = []; }
    }
    if (Array.isArray(mentions)) {
        mentions.forEach(m => {
            const u = m.user?.username || m.username;
            const d = m.user?.displayName || '';
            if (u) {
                addBuddy(u);
                mentionsText += ' ' + u + ' ' + d;
            }
        });
    }

    // 2. createdBy
    let createdBy = trip.createdBy || trip.properties?.createdBy;
    if (typeof createdBy === 'string') {
        try { createdBy = JSON.parse(createdBy); } catch (e) { createdBy = null; }
    }
    if (createdBy?.username) {
        addBuddy(createdBy.username);
        mentionsText += ' ' + createdBy.username;
    }

    // 3. fellowPassengers
    let fps = trip.fellowPassengers || trip.properties?.fellowPassengers;
    if (typeof fps === 'string') {
        try { fps = JSON.parse(fps); } catch (e) { fps = []; }
    }
    if (Array.isArray(fps)) {
        fps.forEach(fp => {
            const u = fp.user?.username || fp.username;
            if (u) {
                addBuddy(u);
                mentionsText += ' ' + u;
            }
        });
    }

    // 4. Notes mentions (@username)
    if (bodyText.includes('@')) {
        const matches = bodyText.match(/@([a-zA-Z0-9_-]+)/g);
        if (matches) {
            matches.forEach(m => {
                const clean = m.substring(1).trim();
                const lower = clean.toLowerCase();
                if (lower && (!currentUser || lower !== currentUser) && !buddiesWithNotes.has(lower)) {
                    buddiesWithNotes.set(lower, clean);
                }
            });
        }
    }

    const wagon = train.seat?.wagon || train.wagon || train.coach || trip.wagon || trip.properties?.wagon;
    const seatNum = train.seat?.number || (typeof train.seat === 'string' || typeof train.seat === 'number' ? train.seat : null) || trip.seat?.number || (typeof trip.seat === 'string' || typeof trip.seat === 'number' ? trip.seat : null) || trip.properties?.seat;
    const ticketObj = trip.ticket || trip.properties?.ticket || train.ticket || null;
    const ticketVal = typeof ticketObj === 'string' ? ticketObj : (ticketObj?.name || ticketObj?.title || ticketObj?.identifier || null);
    const tagsVal = trip.tags || trip.properties?.tags || train.tags || trip.customTags || trip.labels || null;

    const searchCorpus = buildTripSearchCorpus(trip);

    trip._index = {
        owner: currentUser,
        timestamp,
        category,
        distance,
        lineName,
        originName,
        destName,
        wagon: wagon ? String(wagon) : null,
        seat: seatNum ? String(seatNum) : null,
        ticket: ticketVal,
        tags: tagsVal,
        business: getTripBusinessType(trip),
        searchCorpus,
        buddiesNoNotes,
        buddiesWithNotes,
        buddySetNoNotes: new Set(buddiesNoNotes.keys()),
        buddySetWithNotes: new Set(buddiesWithNotes.keys())
    };

    return trip._index;
}

/**
 * Builds a comprehensive lowercase search corpus string for any trip,
 * including comments, notes, line, stations, buddies, tickets, wagon/coach,
 * seat, travel class, operator, platform, and arbitrary user tags.
 */
export function buildTripSearchCorpus(trip) {
    if (!trip) return '';

    const bodyText = typeof trip.body === 'string' ? trip.body : '';
    const noteText = typeof trip.notes === 'string' ? trip.notes : (typeof trip.comment === 'string' ? trip.comment : '');

    const train = trip.train || trip.properties?.train || {};
    const lineName = train.lineName || train.number || train.name || '';

    const originData = train.origin || {};
    const destData = train.destination || {};
    const originName = originData.name || originData.station?.name || '';
    const destName = destData.name || destData.station?.name || '';

    // Mentions & buddy text
    let mentionsText = '';
    let mentions = trip.bodyMentions || trip.properties?.bodyMentions;
    if (typeof mentions === 'string') {
        try { mentions = JSON.parse(mentions); } catch (e) { mentions = []; }
    }
    if (Array.isArray(mentions)) {
        mentionsText = mentions.map(m => {
            const u = m.user?.username || m.username || '';
            const d = m.user?.displayName || '';
            return `${u} ${d}`;
        }).join(' ');
    }

    let createdBy = trip.createdBy || trip.properties?.createdBy;
    if (typeof createdBy === 'string') {
        try { createdBy = JSON.parse(createdBy); } catch (e) { createdBy = null; }
    }
    if (createdBy?.username) {
        mentionsText += ' ' + createdBy.username;
    }

    let fps = trip.fellowPassengers || trip.properties?.fellowPassengers;
    if (typeof fps === 'string') {
        try { fps = JSON.parse(fps); } catch (e) { fps = []; }
    }
    if (Array.isArray(fps)) {
        fps.forEach(fp => {
            const u = fp.user?.username || fp.username;
            if (u) mentionsText += ' ' + u;
        });
    }

    // Stopovers station names if present
    let stopoversText = '';
    const stopovers = train.stopovers || trip.stopovers;
    if (Array.isArray(stopovers)) {
        stopoversText = stopovers.map(s => s.name || s.station?.name || '').join(' ');
    }

    // Extra metadata tokens: tickets, wagon, seat, travelClass, operator, platform, tags
    const extraTokens = [];

    // Tickets
    const extractTicket = (t) => {
        if (!t) return;
        if (typeof t === 'string' || typeof t === 'number') extraTokens.push(String(t));
        else if (typeof t === 'object') {
            if (t.name) extraTokens.push(String(t.name));
            if (t.title) extraTokens.push(String(t.title));
            if (t.identifier) extraTokens.push(String(t.identifier));
            if (t.type) extraTokens.push(String(t.type));
        }
    };
    extractTicket(trip.ticket);
    extractTicket(trip.properties?.ticket);
    extractTicket(train.ticket);
    extractTicket(trip.ticketType || trip.ticket_type || train.ticketType);

    // Wagon / Coach
    const wagon = train.seat?.wagon || train.wagon || train.coach || trip.wagon || trip.properties?.wagon;
    if (wagon !== undefined && wagon !== null && wagon !== '') {
        extraTokens.push(String(wagon), `wagon ${wagon}`, `wagen ${wagon}`, `coach ${wagon}`);
    }

    // Seat
    const seatNum = train.seat?.number || (typeof train.seat === 'string' || typeof train.seat === 'number' ? train.seat : null) || trip.seat?.number || (typeof trip.seat === 'string' || typeof trip.seat === 'number' ? trip.seat : null) || trip.properties?.seat;
    if (seatNum !== undefined && seatNum !== null && seatNum !== '') {
        extraTokens.push(String(seatNum), `seat ${seatNum}`, `platz ${seatNum}`, `sitz ${seatNum}`);
    }

    // Class
    const travelClass = train.class || train.travelClass || trip.class || trip.travelClass;
    if (travelClass) {
        extraTokens.push(String(travelClass), `class ${travelClass}`, `klasse ${travelClass}`, `${travelClass}. klasse`, `${travelClass}st class`, `${travelClass}nd class`);
    }

    // Operator
    const operator = train.operator?.name || train.operator?.identifier || train.provider?.name || (typeof train.provider === 'string' ? train.provider : null) || train.line?.operator?.name || train.line?.productName;
    if (operator) extraTokens.push(String(operator));

    // Platform / Track
    const platform = originData.departurePlatformReal || originData.platform || train.platform || train.track;
    if (platform) {
        extraTokens.push(String(platform), `gl ${platform}`, `gleis ${platform}`, `platform ${platform}`, `track ${platform}`);
    }

    // Tags & Labels (array of strings or objects, or string)
    const extractTags = (tagsList) => {
        if (!tagsList) return;
        if (Array.isArray(tagsList)) {
            tagsList.forEach(item => {
                if (typeof item === 'string' || typeof item === 'number') {
                    extraTokens.push(String(item));
                    if (typeof item === 'string' && item.startsWith('#')) {
                        extraTokens.push(item.slice(1));
                    }
                } else if (typeof item === 'object' && item) {
                    if (item.name) extraTokens.push(String(item.name));
                    if (item.label) extraTokens.push(String(item.label));
                    if (item.title) extraTokens.push(String(item.title));
                    if (item.tag) extraTokens.push(String(item.tag));
                }
            });
        } else if (typeof tagsList === 'string') {
            try {
                const parsed = JSON.parse(tagsList);
                extractTags(parsed);
            } catch (e) {
                if (tagsList.includes(',')) {
                    tagsList.split(',').forEach(s => extraTokens.push(s.trim()));
                } else {
                    extraTokens.push(tagsList);
                }
            }
        }
    };
    extractTags(trip.tags);
    extractTags(trip.properties?.tags);
    extractTags(train.tags);
    extractTags(trip.customTags);
    extractTags(trip.labels);
    extractTags(trip.properties?.labels);
    extractTags(trip.tag);
    extractTags(train.tag);

    const extraText = extraTokens.join(' ');
    return `${bodyText} ${noteText} ${lineName} ${originName} ${destName} ${mentionsText} ${stopoversText} ${extraText}`.toLowerCase();
}

/**
 * Checks whether a trip matches a freetext search query.
 * Uses trip._index.searchCorpus when available for fast lookup.
 */
export function matchesTripSearch(trip, query) {
    if (!query || !query.trim()) return true;
    const q = query.trim().toLowerCase();
    if (trip._index?.searchCorpus) {
        return trip._index.searchCorpus.includes(q);
    }
    return buildTripSearchCorpus(trip).includes(q);
}

/**
 * Pre-index an array of trips in a single efficient pass.
 */
export function indexTrips(trips, currentUsername = '') {
    if (!Array.isArray(trips)) return;
    for (let i = 0; i < trips.length; i++) {
        indexTrip(trips[i], currentUsername);
    }
}

/**
 * Process trips to GeoJSON by category
 */
export function processTripsToGeoJSON(trips) {
    const categories = {};
    CONFIG.LAYER_CONFIG.forEach(([cat]) => { categories[cat] = { type: 'FeatureCollection', features: [] }; });

    trips.forEach(trip => {
        const category = trip._index?.category || normalizeCategory(trip.train?.category);
        const targetCat = categories[category] ? category : 'unknown';
        const polyline = trip.train?.polyline;
        if (!polyline?.geometry?.coordinates) return;

        categories[targetCat].features.push({
            type: 'Feature',
            geometry: polyline.geometry,
            properties: { 
                statusId: trip.id, 
                createdAt: trip.createdAt, 
                train: trip.train, 
                body: typeof trip.body === 'string' ? trip.body : '',
                bodyMentions: Array.isArray(trip.bodyMentions) ? trip.bodyMentions : [],
                createdBy: trip.createdBy || null,
                ticket: trip.ticket || trip.properties?.ticket || trip.train?.ticket || null,
                tags: trip.tags || trip.properties?.tags || trip.train?.tags || trip.customTags || trip.labels || null,
                wagon: trip.train?.seat?.wagon || trip.train?.wagon || trip.train?.coach || trip.wagon || trip.properties?.wagon || null,
                seat: trip.train?.seat?.number || (typeof trip.train?.seat === 'string' ? trip.train.seat : null) || trip.seat?.number || (typeof trip.seat === 'string' ? trip.seat : null) || trip.properties?.seat || null
            }
        });
    });
    return categories;
}

/**
 * Check if polyline coordinates are accurate based on filter level
 */
export function isAccuratePolyline(coords, category, filterLevel = 0) {
    if (!coords || coords.length < 2) return false;
    const normCat = normalizeCategory(category);
    if (normCat === 'plane' || normCat === 'ferry') return true;

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
        if (['bus','tram','subway','taxi'].includes(category)) threshold = 0.05;
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
 * Normalize and determine the trip business type:
 * 0 = Personal (default, null, 0)
 * 1 = Work / Business (1, 'work')
 * 2 = Commute (2, 'commute', or boolean commute)
 */
export function getTripBusinessType(trip) {
    if (!trip) return 0;
    const raw = trip._index?.business !== undefined ? trip._index.business : trip.business;
    if (raw === 2 || raw === '2' || raw === 'commute' || trip.commute === true || trip._index?.commute === true) return 2;
    if (raw === 1 || raw === '1' || raw === 'work' || raw === 'business') return 1;
    return 0;
}

/**
 * Filter trips by business type (personal, work, commute)
 */
export function filterTripsByBusiness(trips = [], businessFilters) {
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
