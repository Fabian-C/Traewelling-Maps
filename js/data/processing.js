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

    const parsedTags = extractTripTags(trip);
    let wagonTag = null;
    let seatTag = null;
    let ticketTag = null;
    let travelClassTag = null;
    let vehicleNumber = null;
    let locomotiveClass = null;
    let wagonClass = null;

    parsedTags.forEach(t => {
        const k = (t.key || '').toLowerCase();
        const v = String(t.value || '').trim();
        if (k === 'trwl:wagon' || k === 'wagon') wagonTag = v;
        else if (k === 'trwl:seat' || k === 'seat') seatTag = v;
        else if (k === 'trwl:ticket' || k === 'ticket') ticketTag = v;
        else if (k === 'trwl:travel_class' || k === 'travel_class') travelClassTag = v;
        else if (k === 'trwl:vehicle_number' || k === 'vehicle_number') vehicleNumber = v;
        else if (k === 'trwl:locomotive_class' || k === 'locomotive_class') locomotiveClass = v;
        else if (k === 'trwl:wagon_class' || k === 'wagon_class') wagonClass = v;
    });

    const wagon = train.seat?.wagon || train.wagon || train.coach || trip.wagon || trip.properties?.wagon || wagonTag;
    const seatNum = train.seat?.number || (typeof train.seat === 'string' || typeof train.seat === 'number' ? train.seat : null) || trip.seat?.number || (typeof trip.seat === 'string' || typeof trip.seat === 'number' ? trip.seat : null) || trip.properties?.seat || seatTag;
    const ticketObj = trip.ticket || trip.properties?.ticket || train.ticket || null;
    const ticketVal = typeof ticketObj === 'string' ? ticketObj : (ticketObj?.name || ticketObj?.title || ticketObj?.identifier || ticketTag || null);
    const travelClass = train.class || train.travelClass || trip.class || trip.travelClass || travelClassTag;

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
        travelClass: travelClass ? String(travelClass) : null,
        vehicleNumber: vehicleNumber ? String(vehicleNumber) : null,
        locomotiveClass: locomotiveClass ? String(locomotiveClass) : null,
        wagonClass: wagonClass ? String(wagonClass) : null,
        tags: parsedTags,
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
 * Normalizes and extracts tags from a trip into a structured array of objects:
 * [ { key: string, value: string, visibility?: number } ]
 * Handles Träwelling's official StatusTagResource ({ key, value, visibility })
 * as well as legacy/custom formats (plain strings, objects, comma-separated strings).
 */
export function extractTripTags(trip) {
    if (!trip) return [];
    let rawTags = trip.tags ?? trip.properties?.tags ?? trip.train?.tags ?? trip.customTags ?? trip.labels ?? trip.properties?.labels ?? null;
    if (typeof rawTags === 'string') {
        try {
            rawTags = JSON.parse(rawTags);
        } catch (e) {
            rawTags = rawTags.includes(',') ? rawTags.split(',').map(s => s.trim()) : [rawTags];
        }
    }
    if (!rawTags) return [];
    if (!Array.isArray(rawTags)) {
        if (typeof rawTags === 'object') {
            rawTags = Object.entries(rawTags).map(([k, v]) => ({ key: k, value: v }));
        } else {
            rawTags = [rawTags];
        }
    }

    const result = [];
    rawTags.forEach(item => {
        if (!item && item !== 0) return;
        if (typeof item === 'string' || typeof item === 'number') {
            const str = String(item).trim();
            if (str) {
                result.push({
                    key: str.startsWith('#') ? str.slice(1) : str,
                    value: str,
                    visibility: 1
                });
            }
        } else if (typeof item === 'object') {
            const rawKey = item.key ?? item.name ?? item.tag ?? item.label ?? item.title ?? '';
            const rawValue = item.value !== undefined && item.value !== null ? item.value : (item.name ?? item.label ?? item.title ?? '');
            const keyStr = String(rawKey || rawValue || '').trim();
            const valStr = String(rawValue !== '' ? rawValue : keyStr).trim();
            if (keyStr || valStr) {
                result.push({
                    key: keyStr,
                    value: valStr,
                    visibility: item.visibility !== undefined ? item.visibility : 1
                });
            }
        }
    });
    return result;
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

    // Platform / Track
    const platform = originData.departurePlatformReal || originData.platform || train.platform || train.track;
    if (platform) {
        extraTokens.push(String(platform), `gl ${platform}`, `gleis ${platform}`, `platform ${platform}`, `track ${platform}`);
    }

    // Operator
    const operator = train.operator?.name || train.operator?.identifier || train.provider?.name || (typeof train.provider === 'string' ? train.provider : null) || train.line?.operator?.name || train.line?.productName;
    if (operator) extraTokens.push(String(operator));

    // Structured tags parsing (including Träwelling StatusTagResource: key/value)
    const parsedTags = extractTripTags(trip);
    let wagonTag = null;
    let seatTag = null;
    let ticketTag = null;
    let travelClassTag = null;

    parsedTags.forEach(t => {
        const k = (t.key || '').toLowerCase();
        const v = String(t.value || '').trim();
        if (!v && !k) return;

        if (k === 'trwl:wagon' || k === 'wagon' || k === 'wagen' || k === 'coach') {
            wagonTag = v;
            extraTokens.push(v, `wagon ${v}`, `wagen ${v}`, `coach ${v}`);
        } else if (k === 'trwl:seat' || k === 'seat' || k === 'platz' || k === 'sitz') {
            seatTag = v;
            extraTokens.push(v, `seat ${v}`, `platz ${v}`, `sitz ${v}`);
        } else if (k === 'trwl:ticket' || k === 'ticket') {
            ticketTag = v;
            extraTokens.push(v, `ticket ${v}`);
        } else if (k === 'trwl:travel_class' || k === 'travel_class' || k === 'class' || k === 'klasse') {
            travelClassTag = v;
            extraTokens.push(v, `class ${v}`, `klasse ${v}`, `${v}. klasse`, `${v}st class`, `${v}nd class`);
        } else if (k === 'trwl:vehicle_number' || k === 'vehicle_number' || k === 'vehicle' || k === 'uic') {
            extraTokens.push(v, `vehicle ${v}`, `zug ${v}`, `fahrzeug ${v}`, `unit ${v}`, `triebzug ${v}`);
        } else if (k === 'trwl:locomotive_class' || k === 'locomotive_class' || k === 'locomotive' || k === 'baureihe') {
            extraTokens.push(v, `locomotive ${v}`, `lok ${v}`, `baureihe ${v}`, `br ${v}`);
        } else if (k === 'trwl:wagon_class' || k === 'wagon_class') {
            extraTokens.push(v, `wagon class ${v}`, `wagenklasse ${v}`);
        } else if (k === 'trwl:role' || k === 'role') {
            extraTokens.push(v, `role ${v}`);
        } else if (k === 'trwl:journey_number' || k === 'journey_number') {
            extraTokens.push(v, `journey ${v}`, `fahrt ${v}`);
        } else if (k === 'trwl:price' || k === 'price') {
            extraTokens.push(v, `price ${v}`, `preis ${v}`);
        } else if (k === 'trwl:social_status') {
            extraTokens.push(v);
        } else if (k === 'trwl:passenger_rights' || k === 'passenger_rights') {
            extraTokens.push(v, 'passenger rights', 'fahrgastrechte');
        } else {
            // Custom user tag
            const cleanKey = k.replace(/^trwl:/, '');
            if (cleanKey) {
                extraTokens.push(cleanKey, `#${cleanKey}`);
            }
            if (v && v.toLowerCase() !== cleanKey) {
                extraTokens.push(v);
            }
            if (cleanKey && v) {
                extraTokens.push(`${cleanKey} ${v}`, `${cleanKey}:${v}`);
            }
        }
    });

    // Wagon / Coach (if not already found in tags)
    const wagon = train.seat?.wagon || train.wagon || train.coach || trip.wagon || trip.properties?.wagon || wagonTag;
    if (wagon !== undefined && wagon !== null && wagon !== '' && wagon !== wagonTag) {
        extraTokens.push(String(wagon), `wagon ${wagon}`, `wagen ${wagon}`, `coach ${wagon}`);
    }

    // Seat (if not already found in tags)
    const seatNum = train.seat?.number || (typeof train.seat === 'string' || typeof train.seat === 'number' ? train.seat : null) || trip.seat?.number || (typeof trip.seat === 'string' || typeof trip.seat === 'number' ? trip.seat : null) || trip.properties?.seat || seatTag;
    if (seatNum !== undefined && seatNum !== null && seatNum !== '' && seatNum !== seatTag) {
        extraTokens.push(String(seatNum), `seat ${seatNum}`, `platz ${seatNum}`, `sitz ${seatNum}`);
    }

    // Class (if not already found in tags)
    const travelClass = train.class || train.travelClass || trip.class || trip.travelClass || travelClassTag;
    if (travelClass && travelClass !== travelClassTag) {
        extraTokens.push(String(travelClass), `class ${travelClass}`, `klasse ${travelClass}`, `${travelClass}. klasse`, `${travelClass}st class`, `${travelClass}nd class`);
    }

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
 * Returns human-readable explanation(s) of why a trip matched an active search query.
 * e.g. "Called at intermediate station Berlin Südkreuz", "Destination: Berlin Hbf", etc.
 */
export function getTripSearchMatchReason(trip, query) {
    if (!query || !query.trim()) return [];
    const q = query.trim().toLowerCase();
    const train = trip.train || trip.properties?.train || {};
    const reasons = [];

    // 1. Origin & Destination
    const originName = train.origin?.name || train.origin?.station?.name || '';
    const destName = train.destination?.name || train.destination?.station?.name || '';
    if (originName.toLowerCase().includes(q)) {
        reasons.push(`Origin station matches: "${originName}"`);
    }
    if (destName.toLowerCase().includes(q)) {
        reasons.push(`Destination station matches: "${destName}"`);
    }

    // 2. Intermediate stopover stations
    const stopovers = train.stopovers || trip.stopovers;
    if (Array.isArray(stopovers)) {
        const matchedStops = stopovers
            .map(s => s.name || s.station?.name || '')
            .filter(name => name && name.toLowerCase().includes(q));
        if (matchedStops.length > 0) {
            const uniqueStops = [...new Set(matchedStops)];
            reasons.push(`Stopover waypoint: ${uniqueStops.join(', ')}`);
        }
    }

    // 3. Line / Service name
    const lineName = train.lineName || train.number || train.name || '';
    if (lineName.toLowerCase().includes(q)) {
        reasons.push(`Train/Line matches: "${lineName}"`);
    }

    // 4. Notes / Comment
    const bodyText = typeof trip.body === 'string' ? trip.body : '';
    const noteText = typeof trip.notes === 'string' ? trip.notes : (typeof trip.comment === 'string' ? trip.comment : '');
    if (bodyText.toLowerCase().includes(q) || noteText.toLowerCase().includes(q)) {
        reasons.push(`Check-in note mentions: "${query.trim()}"`);
    }

    // 5. Travel buddies / mentions
    let mentions = trip.bodyMentions || trip.properties?.bodyMentions;
    if (typeof mentions === 'string') {
        try { mentions = JSON.parse(mentions); } catch (e) { mentions = []; }
    }
    if (Array.isArray(mentions)) {
        const matchedBuddies = mentions
            .map(m => m.user?.username || m.username || '')
            .filter(u => u && u.toLowerCase().includes(q));
        if (matchedBuddies.length > 0) {
            reasons.push(`Buddy @${matchedBuddies.join(', @')}`);
        }
    }

    // 6. Tags
    const tags = extractTripTags(trip);
    const matchedTags = tags.filter(t => {
        const k = (t.key || '').toLowerCase();
        const v = String(t.value || '').toLowerCase();
        return k.includes(q) || v.includes(q);
    });
    if (matchedTags.length > 0) {
        reasons.push(`Tag: #${matchedTags.map(t => t.value || t.key).join(', #')}`);
    }

    // 7. Ticket / Seat / Wagon
    const ticketObj = trip.ticket || trip.properties?.ticket || train.ticket;
    const ticketName = typeof ticketObj === 'string' ? ticketObj : (ticketObj?.name || ticketObj?.title || '');
    if (ticketName.toLowerCase().includes(q)) {
        reasons.push(`Ticket: "${ticketName}"`);
    }

    if (reasons.length === 0 && matchesTripSearch(trip, query)) {
        reasons.push(`Matches search: "${query.trim()}"`);
    }

    return reasons;
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
                ticket: trip._index?.ticket || trip.ticket || trip.properties?.ticket || trip.train?.ticket || null,
                tags: trip._index?.tags || trip.tags || trip.properties?.tags || trip.train?.tags || trip.customTags || trip.labels || null,
                wagon: trip._index?.wagon || trip.train?.seat?.wagon || trip.train?.wagon || trip.train?.coach || trip.wagon || trip.properties?.wagon || null,
                seat: trip._index?.seat || trip.train?.seat?.number || (typeof trip.train?.seat === 'string' ? trip.train.seat : null) || trip.seat?.number || (typeof trip.seat === 'string' ? trip.seat : null) || trip.properties?.seat || null,
                travelClass: trip._index?.travelClass || trip.train?.class || trip.train?.travelClass || trip.class || null,
                vehicleNumber: trip._index?.vehicleNumber || null,
                locomotiveClass: trip._index?.locomotiveClass || null,
                wagonClass: trip._index?.wagonClass || null
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
 * Filter a trip's stopovers to only include stations between the origin and destination
 * that the user actually traveled.
 *
 * Träwelling API returns all stopovers for the whole train run/service (from train terminal to terminal).
 * This function locates the user's boarding station (origin) and exit station (destination) along
 * the stopovers list and keeps only the stopovers between them (inclusive or intermediate).
 * If either origin or destination is not matched, returns the original stopovers list as fallback.
 *
 * @param {Array} stopovers Array of stopover objects
 * @param {Object} origin Origin station object (e.g. { name: 'Berlin Hbf', ... })
 * @param {Object} destination Destination station object (e.g. { name: 'Hamburg Hbf', ... })
 * @param {Object} [options]
 * @param {boolean} [options.includeEndpoints=true] Whether to keep the origin and destination in the returned list
 * @returns {Array} Filtered stopovers array
 */
export function filterStopoversBetweenTraveledStations(stopovers = [], origin = {}, destination = {}, options = {}) {
    if (!Array.isArray(stopovers) || stopovers.length === 0) return [];
    const includeEndpoints = options.includeEndpoints !== false;

    const normalizeStationName = (name) => {
        if (!name) return '';
        return String(name)
            .toLowerCase()
            .replace(/\s*\(.*?\)\s*/g, ' ') // remove parentheses content like (Westf), (Breisgau)
            .replace(/[.,\-\/]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    };

    const originName = origin?.name || origin?.station?.name || '';
    const destName = destination?.name || destination?.station?.name || '';
    const originEva = origin?.id || origin?.evaId || origin?.station?.id || origin?.station?.evaId || null;
    const destEva = destination?.id || destination?.evaId || destination?.station?.id || destination?.station?.evaId || null;

    const normOrigin = normalizeStationName(originName);
    const normDest = normalizeStationName(destName);

    const matchesStation = (stop, targetNormName, targetEva) => {
        if (!stop) return false;
        const stopEva = stop.id || stop.evaId || stop.station?.id || stop.station?.evaId || null;
        if (targetEva && stopEva && String(targetEva) === String(stopEva)) return true;
        
        const stopName = normalizeStationName(stop.name || stop.station?.name || '');
        if (!stopName || !targetNormName) return false;
        if (stopName === targetNormName) return true;
        // Prefix/substring match if names are reasonably long
        if (stopName.length >= 4 && targetNormName.length >= 4) {
            if (stopName.startsWith(targetNormName) || targetNormName.startsWith(stopName)) return true;
        }
        return false;
    };

    let startIndex = -1;
    let endIndex = -1;

    for (let i = 0; i < stopovers.length; i++) {
        const stop = stopovers[i];
        if (startIndex === -1 && matchesStation(stop, normOrigin, originEva)) {
            startIndex = i;
        }
        if (endIndex === -1 && matchesStation(stop, normDest, destEva)) {
            endIndex = i;
        }
    }

    // If both origin and destination stations were found in sequence:
    if (startIndex !== -1 && endIndex !== -1) {
        let fromIdx = startIndex;
        let toIdx = endIndex;
        // In case indices are reversed (reverse trip schedule)
        if (fromIdx > toIdx) {
            fromIdx = endIndex;
            toIdx = startIndex;
        }

        const sliceStart = includeEndpoints ? fromIdx : fromIdx + 1;
        const sliceEnd = includeEndpoints ? toIdx + 1 : toIdx;

        if (sliceStart <= sliceEnd) {
            return stopovers.slice(sliceStart, sliceEnd);
        }
        return [];
    }

    // If only origin was matched: slice from origin onward
    if (startIndex !== -1 && endIndex === -1) {
        return includeEndpoints ? stopovers.slice(startIndex) : stopovers.slice(startIndex + 1);
    }

    // If only destination was matched: slice up to destination
    if (startIndex === -1 && endIndex !== -1) {
        return includeEndpoints ? stopovers.slice(0, endIndex + 1) : stopovers.slice(0, endIndex);
    }

    // Fallback if neither found: return original list
    return stopovers;
}
