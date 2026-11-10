/**
 * Incremental Co-Passenger Batch Scanner for Traewelling-Maps.
 * Scans trips chronologically (newest-first) up to the last scan result watermark.
 * Prevents redundant re-scanning of historical check-ins and caches all results in IndexedDB.
 */

import { SessionDB } from '../cache/session.js';
import { TraewellingAPI } from '../api/traewelling.js';
import { Storage, STORAGE_KEYS } from '../storage/storage.js';

const WATERMARK_PREFIX = 'tw_copassengers_watermark_';

/**
 * Get the storage key for a user's scan watermark
 */
export function getWatermarkKey(username = '') {
    return `${WATERMARK_PREFIX}${String(username || 'default').toLowerCase().trim()}`;
}

/**
 * Get the last scanned status ID watermark for a given user
 */
export function getScanWatermark(username = '') {
    const raw = Storage.get(getWatermarkKey(username));
    return raw ? Number(raw) : null;
}

/**
 * Save the scan watermark for a given user
 */
export function setScanWatermark(username = '', statusId) {
    if (!statusId) return;
    Storage.set(getWatermarkKey(username), String(statusId));
}

/**
 * Clear the scan watermark (allowing a full re-scan)
 */
export function clearScanWatermark(username = '') {
    Storage.remove(getWatermarkKey(username));
}

/**
 * Extract the upstream backend trip ID from a trip object
 */
export function getTripBackendId(trip) {
    if (!trip) return null;
    const raw = trip.properties?.backend_trip_id ||
                trip.properties?.backendTripId ||
                trip.backend_trip_id ||
                trip.backendTripId ||
                trip.train?.trip ||
                trip.checkin?.trip ||
                trip.trip ||
                trip.properties?.checkin?.trip ||
                null;
    return (raw !== null && raw !== undefined && raw !== '') ? Number(raw) : null;
}

/**
 * Determine which trips need to be scanned up to the last scan watermark
 * @param {Array<Object>} trips All trips for the active user
 * @param {string} username Active username
 * @returns {{ unscannedTrips: Array<Object>, watermark: number|null, totalEligible: number }}
 */
export function getUnscannedTrips(trips = [], username = '', options = {}) {
    if (!Array.isArray(trips) || !trips.length) {
        return { unscannedTrips: [], watermark: null, totalEligible: 0 };
    }

    // Sort newest first
    const sorted = [...trips].sort((a, b) => {
        const timeA = new Date(a.createdAt || a.checkin?.createdAt || a.train?.origin?.departureReal || 0).getTime();
        const timeB = new Date(b.createdAt || b.checkin?.createdAt || b.train?.origin?.departureReal || 0).getTime();
        if (timeA && timeB && timeA !== timeB) return timeB - timeA;
        return (Number(b.id) || 0) - (Number(a.id) || 0);
    });

    const eligible = sorted.filter(t => Boolean(getTripBackendId(t)));
    const forceFull = Boolean(options.forceFullRescan);
    const watermark = forceFull ? null : getScanWatermark(username);

    if (!watermark || forceFull) {
        // Full scan (or forced re-scan): all eligible trips are candidates
        return {
            unscannedTrips: eligible,
            watermark: null,
            totalEligible: eligible.length,
            isFullRescan: forceFull
        };
    }

    // Incremental scan: only trips newer than the watermark
    const unscanned = [];
    for (const t of eligible) {
        const tripStatusId = Number(t.id);
        if (tripStatusId <= watermark) {
            // Reached last scan result! Stop scanning older trips.
            break;
        }
        unscanned.push(t);
    }

    return {
        unscannedTrips: unscanned,
        watermark,
        totalEligible: eligible.length,
        isFullRescan: false
    };
}

/**
 * Run an incremental batch scan of unscanned trips
 * @param {Object} options Configuration & callbacks
 * @returns {{ cancel: () => void }} Controller to abort scan
 */
export function startIncrementalScan({
    trips = [],
    username = '',
    token = null,
    forceFullRescan = false,
    onProgress = () => {},
    onComplete = () => {},
    onError = () => {}
}) {
    let isCancelled = false;
    const { unscannedTrips } = getUnscannedTrips(trips, username, { forceFullRescan });

    if (!unscannedTrips.length) {
        onComplete({
            scannedCount: 0,
            foundBuddiesCount: 0,
            alreadyUpToDate: true
        });
        return { cancel: () => {} };
    }

    const apiToken = token || Storage.get(STORAGE_KEYS.TOKEN);
    const api = new TraewellingAPI(apiToken);
    const newestTripId = Number(unscannedTrips[0]?.id);

    (async () => {
        let scannedCount = 0;
        let foundBuddiesCount = 0;
        const total = unscannedTrips.length;
        const currentClean = (username || '').toLowerCase().trim();

        try {
            for (let i = 0; i < total; i++) {
                if (isCancelled) {
                    onProgress({
                        current: i,
                        total,
                        percentage: Math.round((i / total) * 100),
                        status: 'Cancelled',
                        foundBuddies: foundBuddiesCount
                    });
                    break;
                }

                const trip = unscannedTrips[i];
                const tripBackendId = getTripBackendId(trip);
                const lineName = trip.train?.lineName || trip.checkin?.lineName || 'Transit';

                onProgress({
                    current: i + 1,
                    total,
                    percentage: Math.round(((i + 1) / total) * 100),
                    status: `Checking ${lineName} (${i + 1}/${total})...`,
                    foundBuddies: foundBuddiesCount,
                    currentTrip: trip
                });

                if (tripBackendId) {
                    // 1. Check if already cached in IndexedDB
                    let cached = null;
                    try {
                        cached = await SessionDB.getTripCoPassengers(tripBackendId);
                    } catch {}

                    if (cached && Array.isArray(cached) && cached.length > 0 && !forceFullRescan) {
                        const others = cached.filter(p => (p.username || '').toLowerCase() !== currentClean);
                        foundBuddiesCount += others.length;
                        trip.co_passengers = others;
                    } else {
                        // 2. Fetch from upstream API
                        try {
                            const resp = await api.getTripStatuses(tripBackendId);
                            const rawStatuses = resp?.data || [];
                            const companions = rawStatuses
                                .filter(s => (s.user?.username || '').toLowerCase() !== currentClean)
                                .map(s => ({
                                    trip_id: Number(tripBackendId),
                                    status_id: s.id,
                                    co_status_id: s.id,
                                    username: s.user?.username || 'unknown',
                                    display_name: s.user?.name || s.user?.username || '',
                                    origin: s.checkin?.origin?.name || 'Unknown',
                                    destination: s.checkin?.destination?.name || 'Unknown',
                                    departure_time: s.checkin?.origin?.departureReal || s.checkin?.origin?.departurePlanned || null,
                                    arrival_time: s.checkin?.destination?.arrivalReal || s.checkin?.destination?.arrivalPlanned || null,
                                    body: s.body || '',
                                    created_at: s.createdAt || null
                                }));

                            await SessionDB.saveTripCoPassengers(tripBackendId, companions);
                            trip.co_passengers = companions;
                            if (companions.length > 0) {
                                foundBuddiesCount += companions.length;
                            }
                        } catch (err) {
                            console.warn(`[CoPassengerScanner] Skipped trip ${tripBackendId}:`, err.message);
                        }
                    }
                }

                scannedCount++;

                // Polite pause between queries to avoid UI stutter and respect server
                if (i < total - 1 && !isCancelled) {
                    await new Promise(r => setTimeout(r, 150));
                }
            }

            // Update watermark to the newest scanned trip ID
            if (newestTripId) {
                setScanWatermark(username, newestTripId);
            }

            onComplete({
                scannedCount,
                foundBuddiesCount,
                cancelled: isCancelled,
                watermark: newestTripId
            });
        } catch (fatalErr) {
            console.error('[CoPassengerScanner] Fatal error:', fatalErr);
            onError(fatalErr);
        }
    })();

    return {
        cancel: () => {
            isCancelled = true;
        }
    };
}

