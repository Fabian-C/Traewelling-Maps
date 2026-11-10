/**
 * Formatting and buddy extraction helpers for the Trips database and explorer
 */

import { escapeHtml } from '../utils/format.js';

/**
 * Check if a co-passenger traveled on an overlapping segment with the user's trip.
 * @param {Object} userTrip - User's trip or feature record
 * @param {Object} co - Co-passenger record from upstream train run
 * @returns {boolean} True if they traveled together on at least one shared segment
 */
export function hasJourneyOverlap(userTrip, co) {
    if (!userTrip || !co) return false;

    // Direct check-in buddies without origin/destination/timestamps are always considered with the user
    const hasCoRoute = Boolean(
        (co.origin && co.origin !== 'Unknown') ||
        (co.destination && co.destination !== 'Unknown') ||
        co.departure_time ||
        co.arrival_time ||
        co.checkin?.origin?.name ||
        co.checkin?.destination?.name
    );
    if (!hasCoRoute) return true;

    const cleanStation = (s) => {
        if (!s || typeof s !== 'string') return '';
        return s.toLowerCase()
            .replace(/\s+(hbf|hauptbahnhof|bahnhof|bf|central station)\b/gi, '')
            .replace(/[^a-z0-9]/g, '')
            .trim();
    };

    const train = userTrip.train || userTrip.checkin || userTrip.properties?.train || userTrip.properties?.checkin || {};
    const originObj = train.origin || userTrip.origin || userTrip.properties?.origin || {};
    const destObj = train.destination || userTrip.destination || userTrip.properties?.destination || {};

    const userOrigin = cleanStation(typeof originObj === 'string' ? originObj : (originObj.name || originObj.station?.name || ''));
    const userDest = cleanStation(typeof destObj === 'string' ? destObj : (destObj.name || destObj.station?.name || ''));

    const coOriginObj = co.checkin?.origin || co.origin || {};
    const coDestObj = co.checkin?.destination || co.destination || {};
    const coOrigin = cleanStation(typeof coOriginObj === 'string' ? coOriginObj : (coOriginObj.name || coOriginObj.station?.name || ''));
    const coDest = cleanStation(typeof coDestObj === 'string' ? coDestObj : (coDestObj.name || coDestObj.station?.name || ''));

    // 1. Definite same-endpoint matches:
    // If both boarded at the same station, they traveled together leaving that station
    if (userOrigin && coOrigin && userOrigin === coOrigin) return true;
    // If both alighted at the same station, they traveled together arriving at that station
    if (userDest && coDest && userDest === coDest) return true;

    // 2. Definite non-overlapping boundary transitions:
    // Companion got off at or before user's departure station
    if (coDest && userOrigin && coDest === userOrigin && coOrigin !== userOrigin) return false;
    // Companion got on at or after user's arrival station
    if (coOrigin && userDest && coOrigin === userDest && coDest !== userDest) return false;

    // 3. Temporal overlap check:
    const uDepRaw = originObj.departureReal || originObj.departurePlanned || originObj.departure ||
                    train.departure || train.plannedDeparture ||
                    userTrip.departure_time || userTrip.properties?.departure_time;

    const uArrRaw = destObj.arrivalReal || destObj.arrivalPlanned || destObj.arrival ||
                    train.arrival || train.plannedArrival ||
                    userTrip.arrival_time || userTrip.properties?.arrival_time;

    const cDepRaw = co.departure_time || coOriginObj.departureReal || coOriginObj.departurePlanned || coOriginObj.departure;
    const cArrRaw = co.arrival_time || coDestObj.arrivalReal || coDestObj.arrivalPlanned || coDestObj.arrival;

    const uDep = uDepRaw ? Date.parse(uDepRaw) : NaN;
    const uArr = uArrRaw ? Date.parse(uArrRaw) : NaN;
    const cDep = cDepRaw ? Date.parse(cDepRaw) : NaN;
    const cArr = cArrRaw ? Date.parse(cArrRaw) : NaN;

    if (!isNaN(uDep) && !isNaN(uArr) && !isNaN(cDep) && !isNaN(cArr)) {
        const overlapStart = Math.max(uDep, cDep);
        const overlapEnd = Math.min(uArr, cArr);
        // At least 60 seconds of mutual train travel
        return (overlapEnd - overlapStart) >= 60000;
    }

    // 4. Fallback if stopovers are available on user trip:
    const stopovers = train.stopovers || userTrip.stopovers || [];
    if (Array.isArray(stopovers) && stopovers.length > 0) {
        const stopNames = new Set(stopovers.map(s => cleanStation(s.name || s.station?.name || s)).filter(Boolean));
        if (coOrigin && stopNames.has(coOrigin)) return true;
        if (coDest && stopNames.has(coDest)) return true;
    }

    return false;
}

/**
 * Extract all travel companions / buddies from checkin metadata, mentions, and text
 * @param {Object} trip - Raw journey / checkin record
 * @param {string} currentUser - Current session username to exclude from buddies
 * @returns {Array<{username: string, displayName: string}>}
 */
export function getTripBuddies(trip, currentUser = '') {
    if (!trip) return [];
    const buddies = new Map();
    const currentClean = (currentUser || '').toLowerCase().trim();

    const addBuddy = (u, display = '', origin = '', destination = '', body = '') => {
        if (!u || typeof u !== 'string') return;
        const clean = u.replace(/^@/, '').trim();
        if (!clean) return;
        const key = clean.toLowerCase();
        if (currentClean && key === currentClean) return;
        if (!buddies.has(key)) {
            buddies.set(key, {
                username: clean,
                displayName: display || clean,
                origin: origin || null,
                destination: destination || null,
                body: body || null
            });
        } else {
            const existing = buddies.get(key);
            if (origin && !existing.origin) existing.origin = origin;
            if (destination && !existing.destination) existing.destination = destination;
            if (body && !existing.body) existing.body = body;
            if (display && (!existing.displayName || existing.displayName === existing.username)) {
                existing.displayName = display;
            }
        }
    };

    // 1. Mentions array in bodyMentions or properties.bodyMentions
    let mentions = trip.bodyMentions || trip.properties?.bodyMentions;
    if (typeof mentions === 'string') {
        try { mentions = JSON.parse(mentions); } catch { mentions = []; }
    }
    if (Array.isArray(mentions)) {
        mentions.forEach(m => {
            if (typeof m === 'string') {
                addBuddy(m);
            } else if (m && typeof m === 'object') {
                const u = m.user?.username || m.username || m.name;
                const d = m.user?.displayName || m.displayName || m.name || u;
                addBuddy(u, d);
            }
        });
    }

    // 2. Companions / buddies / fellowPassengers / co_passengers / users arrays
    const companionLists = [
        trip.companions,
        trip.properties?.companions,
        trip.buddies,
        trip.properties?.buddies,
        trip.fellowPassengers,
        trip.properties?.fellowPassengers,
        trip.co_passengers,
        trip.properties?.co_passengers,
        trip.users,
        trip.properties?.users
    ];

    companionLists.forEach(list => {
        if (!list) return;
        let arr = list;
        if (typeof arr === 'string') {
            try { arr = JSON.parse(arr); } catch { return; }
        }
        if (Array.isArray(arr)) {
            arr.forEach(c => {
                if (typeof c === 'string') {
                    addBuddy(c);
                } else if (c && typeof c === 'object') {
                    // Only include co-passengers who actually traveled on an overlapping segment with the user
                    if (!hasJourneyOverlap(trip, c)) {
                        return;
                    }
                    const u = c.user?.username || c.username || c.name;
                    const d = c.user?.displayName || c.user?.name || c.displayName || c.name || u;
                    const orig = c.origin?.name || c.checkin?.origin?.name || c.origin || '';
                    const dest = c.destination?.name || c.checkin?.destination?.name || c.destination || '';
                    const body = c.body || '';
                    addBuddy(u, d, orig, dest, body);
                }
            });
        }
    });

    // 3. createdBy
    let createdBy = trip.createdBy || trip.properties?.createdBy;
    if (typeof createdBy === 'string') {
        try { createdBy = JSON.parse(createdBy); } catch { createdBy = null; }
    }
    if (createdBy?.username) {
        addBuddy(createdBy.username, createdBy.displayName || createdBy.username);
    }

    // 4. Regex @mentions in body text
    const body = trip.body || trip.properties?.body || '';
    if (typeof body === 'string' && body.includes('@')) {
        const matches = body.match(/@([a-zA-Z0-9_\-\.]+)/g);
        if (matches) {
            matches.forEach(m => addBuddy(m));
        }
    }

    return Array.from(buddies.values());
}

/**
 * Render comment/notes text safely with clickable @mention profile links
 * @param {string} text
 * @returns {string} Safe HTML string with linked @mentions
 */
export function renderLinkedComment(text) {
    if (!text || typeof text !== 'string') return '';
    const safe = escapeHtml(text);
    return safe.replace(/@([a-zA-Z0-9_\-\.]+)/g, (match, username) => {
        return `<a href="https://traewelling.de/@${encodeURIComponent(username)}" target="_blank" rel="noopener noreferrer" class="comment-mention-link" title="Open @${username} on Träwelling" onclick="event.stopPropagation()">@${username}</a>`;
    });
}

