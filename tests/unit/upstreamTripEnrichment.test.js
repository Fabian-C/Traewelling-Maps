import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TraewellingAPI } from '../../js/api/traewelling.js';
import { normalizeTrip, denormalizeTrip } from '../../js/cache/normalizer.js';
import { SessionDB } from '../../js/cache/session.js';
import { executeTripQuery, flattenTripRecord, TABLE_SCHEMAS } from '../../js/trips/sqlEngine.js';
import { extractTripDetails } from '../../js/ui/tripDetails.js';
import { getTripBuddies, hasJourneyOverlap } from '../../js/trips/formatters.js';

describe('Upstream Trip Data & Co-Passenger Enrichment', () => {

    describe('TraewellingAPI.getTripStatuses', () => {
        let api;
        let originalFetch;

        beforeEach(() => {
            api = new TraewellingAPI('test-token');
            originalFetch = globalThis.fetch;
        });

        afterEach(() => {
            globalThis.fetch = originalFetch;
        });

        it('queries /trips/{id}/statuses with proper headers', async () => {
            const mockResponse = {
                data: [
                    { id: 9577958, user: { username: 'Astro' }, checkin: { origin: { name: 'Berlin' } } },
                    { id: 9577959, user: { username: 'Hash' }, checkin: { origin: { name: 'Berlin' } } }
                ]
            };

            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => mockResponse
            });

            const result = await api.getTripStatuses(9289803);
            expect(globalThis.fetch).toHaveBeenCalledTimes(1);
            const callUrl = globalThis.fetch.mock.calls[0][0];
            expect(callUrl).toContain('/trips/9289803/statuses');
            expect(result).toEqual(mockResponse);
        });

        it('safely handles missing or empty tripId', async () => {
            globalThis.fetch = vi.fn();
            const result = await api.getTripStatuses(null);
            expect(result).toBeNull();
            expect(globalThis.fetch).not.toHaveBeenCalled();
        });
    });

    describe('Normalizer backend_trip_id extraction', () => {
        it('extracts backend_trip_id from train.trip (integer)', () => {
            const rawTrip = {
                id: 9577959,
                train: {
                    trip: 9289803,
                    lineName: 'U6',
                    category: 'subway',
                    origin: { id: 1, name: 'Alt-Mariendorf' },
                    destination: { id: 2, name: 'Friedrichstraße' }
                }
            };

            const norm = normalizeTrip(rawTrip, 'Hash');
            expect(norm).not.toBeNull();
            expect(norm.status.backend_trip_id).toBe(9289803);
            expect(norm.tripRun.backend_trip_id).toBe(9289803);
        });

        it('extracts backend_trip_id from checkin.trip or top-level trip', () => {
            const rawTrip = {
                id: 9577958,
                trip: 9289803,
                checkin: {
                    lineName: 'U6',
                    category: 'subway',
                    origin: { id: 1, name: 'Alt-Mariendorf' },
                    destination: { id: 2, name: 'Friedrichstraße' }
                }
            };

            const norm = normalizeTrip(rawTrip, 'Astro');
            expect(norm).not.toBeNull();
            expect(norm.status.backend_trip_id).toBe(9289803);
            expect(norm.tripRun.backend_trip_id).toBe(9289803);
        });

        it('rehydrates train.trip in denormalizeTrip', () => {
            const status = {
                id: 9577959,
                trip_id: '9289803',
                backend_trip_id: 9289803,
                origin_id: 1,
                destination_id: 2
            };
            const tripRunsMap = new Map([
                ['9289803', { id: '9289803', backend_trip_id: 9289803, line_name: 'U6' }]
            ]);

            const rehydrated = denormalizeTrip(status, new Map(), tripRunsMap);
            expect(rehydrated.train.trip).toBe(9289803);
            expect(rehydrated.train.tripId).toBe(9289803);
        });
    });

    describe('SessionDB co_passengers store & methods', () => {
        beforeEach(() => {
            SessionDB._db = null;
            // Setup simple in-memory mock IndexedDB
            const storeData = new Map();
            globalThis.IDBKeyRange = { only: (val) => val };
            globalThis.indexedDB = {
                open: (name, version) => {
                    const req = {
                        result: {
                            objectStoreNames: {
                                contains: (s) => true
                            },
                            transaction: (stores, mode) => {
                                const tx = {
                                    oncomplete: null,
                                    onerror: null,
                                    objectStore: (storeName) => ({
                                        put: (val) => {
                                            storeData.set(val.trip_id || val.id || val.username, val);
                                        },
                                        get: (key) => {
                                            const getReq = { result: storeData.get(key) || null, onsuccess: null, onerror: null };
                                            setTimeout(() => { if (getReq.onsuccess) getReq.onsuccess(); }, 0);
                                            return getReq;
                                        },
                                        getAll: () => {
                                            const allReq = { result: Array.from(storeData.values()), onsuccess: null, onerror: null };
                                            setTimeout(() => { if (allReq.onsuccess) allReq.onsuccess(); }, 0);
                                            return allReq;
                                        }
                                    })
                                };
                                setTimeout(() => { if (tx.oncomplete) tx.oncomplete(); }, 5);
                                return tx;
                            }
                        },
                        onsuccess: null,
                        onerror: null
                    };
                    setTimeout(() => { if (req.onsuccess) req.onsuccess(); }, 0);
                    return req;
                }
            };
        });

        afterEach(() => {
            SessionDB._db = null;
        });

        it('saves and retrieves cached co-passengers by trip_id', async () => {
            const tripId = 9289803;
            const coPassengers = [
                {
                    id: 9577958,
                    user: { username: 'Astro', name: 'Astro' },
                    checkin: {
                        origin: { name: 'Alt-Mariendorf' },
                        destination: { name: 'Friedrichstraße' }
                    },
                    body: 'Traveling together!'
                }
            ];

            await SessionDB.saveTripCoPassengers(tripId, coPassengers);
            const cached = await SessionDB.getTripCoPassengers(tripId);

            expect(cached.length).toBe(1);
            expect(cached[0].username).toBe('Astro');
            expect(cached[0].origin).toBe('Alt-Mariendorf');
            expect(cached[0].destination).toBe('Friedrichstraße');
            expect(cached[0].body).toBe('Traveling together!');
        });

        it('retrieves all co-passengers flattened across multiple trips for SQL Studio', async () => {
            await SessionDB.saveTripCoPassengers(1001, [{ username: 'UserA', origin: 'Station A', destination: 'Station B' }]);
            await SessionDB.saveTripCoPassengers(1002, [{ username: 'UserB', origin: 'Station C', destination: 'Station D' }]);

            const allCo = await SessionDB.getAllCoPassengers();
            expect(allCo.length).toBe(2);
            const names = allCo.map(c => c.username);
            expect(names).toContain('UserA');
            expect(names).toContain('UserB');
        });
    });

    describe('SQL Engine Unified Buddies on trips', () => {
        it('includes buddies and buddy_count in trips schema and defines co_passengers table', () => {
            expect(TABLE_SCHEMAS.co_passengers).toBeDefined();
            expect(TABLE_SCHEMAS.trips).toBeDefined();
            const colNames = TABLE_SCHEMAS.trips.columns.map(c => c.name);
            expect(colNames).toContain('buddies');
            expect(colNames).toContain('buddy_count');
        });

        it('queries trips table with buddies using executeTripQuery', () => {
            const trip = {
                id: 9577959,
                line: 'U6',
                origin: 'Alt-Mariendorf',
                destination: 'Friedrichstraße',
                buddies: '@Astro, @Max',
                buddy_count: 2
            };

            const result = executeTripQuery('SELECT line, buddies, buddy_count FROM trips WHERE buddy_count >= 2', [trip]);

            expect(result.table).toBe('trips');
            expect(result.rows.length).toBe(1);
            expect(result.rows[0].buddies).toBe('@Astro, @Max');
            expect(result.rows[0].buddy_count).toBe(2);
        });

        it('merges co_passengers and text mentions in flattenTripRecord into deduplicated buddies and buddy_count', () => {
            const trip = {
                id: 9577959,
                body: 'Riding with @astro and @someone',
                train: { lineName: 'U6', origin: { name: 'A' }, destination: { name: 'B' } },
                co_passengers: [
                    { username: 'Astro' },
                    { username: 'Elena' }
                ]
            };

            const flattened = flattenTripRecord(trip);
            // astro is in both text mention and co_passengers: should be deduplicated
            expect(flattened.buddies.toLowerCase()).toContain('@astro');
            expect(flattened.buddies.toLowerCase()).toContain('@someone');
            expect(flattened.buddies.toLowerCase()).toContain('@elena');
            expect(flattened.buddy_count).toBe(3);
        });
    });

    describe('UI Trip Details & Buddy Extraction', () => {
        it('extracts backendTripId in extractTripDetails', () => {
            const raw = {
                id: 9577959,
                train: {
                    trip: 9289803,
                    lineName: 'U6'
                }
            };

            const details = extractTripDetails(raw, 'Hash');
            expect(details.backendTripId).toBe(9289803);
            expect(details.statusId).toBe('9577959');
        });

        it('getTripBuddies includes companions from trip.co_passengers', () => {
            const raw = {
                id: 9577959,
                co_passengers: [
                    { username: 'Astro', displayName: 'Astro' },
                    { username: 'Hash', displayName: 'Hash' } // Should be filtered if currentUser = 'Hash'
                ]
            };

            const buddies = getTripBuddies(raw, 'Hash');
            expect(buddies.length).toBe(1);
            expect(buddies[0].username).toBe('Astro');
        });
    });

    describe('Real-World User Scenario (Floxy)', () => {
        const sampleTrips = [
            {
                id: 9580001,
                body: 'Traveling with @Hash today!',
                train: { lineName: 'RE8', origin: { name: 'Berlin Südkreuz' }, destination: { name: 'Berlin Hbf' } }
            },
            {
                id: 9580002,
                body: 'ICE ride across Germany',
                train: { lineName: 'ICE 692', origin: { name: 'Frankfurt(Main)Hbf' }, destination: { name: 'Berlin' } }
            },
            {
                id: 9580003,
                body: 'Quick metro with @Magginator',
                train: { lineName: 'U6', origin: { name: 'Mariendorf' }, destination: { name: 'Friedrichstr' } }
            }
        ];

        it('discovers only text mentions prior to upstream enrichment', () => {
            const buddiesBefore = new Set();
            sampleTrips.forEach(t => {
                getTripBuddies(t, 'floxy').forEach(b => buddiesBefore.add(b.username));
            });

            expect(Array.from(buddiesBefore).sort()).toEqual(['Hash', 'Magginator']);
        });

        it('discovers fellow train travelers after enrichment while deduplicating existing text buddies and filtering non-overlapping legs', () => {
            // Simulate upstream enrichment on ICE 692 and RE8
            sampleTrips[0].co_passengers = [
                { username: 'Hash', origin: 'Berlin Südkreuz', destination: 'Berlin Hbf' } // already in text, deduplicate!
            ];
            // Floxy's trip: Frankfurt(Main)Hbf -> Berlin (Dep: 09:17, Arr: 13:22)
            sampleTrips[1].train.origin.departurePlanned = '2026-11-03T09:17:00Z';
            sampleTrips[1].train.destination.arrivalPlanned = '2026-11-03T13:22:00Z';

            sampleTrips[1].co_passengers = [
                // 1. Same trip leg: Frankfurt -> Berlin (traveled together)
                { username: 'ichbinreis', origin: 'Frankfurt', destination: 'Berlin', departure_time: '2026-11-03T09:17:00Z', arrival_time: '2026-11-03T13:22:00Z' },
                // 2. Boarded midway: Erfurt -> Berlin (traveled together between Erfurt and Berlin)
                { username: 'DanielKeller', origin: 'Erfurt', destination: 'Berlin', departure_time: '2026-11-03T10:45:00Z', arrival_time: '2026-11-03T13:22:00Z' },
                // 3. Different leg BEFORE Floxy boarded: Stuttgart -> Mannheim (NOT together)
                { username: 'Marci44', origin: 'Stuttgart Hbf', destination: 'Mannheim Hbf', departure_time: '2026-11-03T07:52:00Z', arrival_time: '2026-11-03T08:26:00Z' },
                // 4. Branch off leg AFTER Floxy alighted: Leipzig -> Dresden (NOT together)
                { username: 'viehmann', origin: 'Leipzig', destination: 'Dresden', departure_time: '2026-11-03T14:10:00Z', arrival_time: '2026-11-03T15:20:00Z' }
            ];

            const buddiesAfter = new Set();
            sampleTrips.forEach(t => {
                getTripBuddies(t, 'floxy').forEach(b => buddiesAfter.add(b.username));
            });

            // Floxy's buddies: Hash (RE8 text + checkin), Magginator (U6 text), ichbinreis (ICE 692), DanielKeller (ICE 692)
            // Marci44 and viehmann are excluded because their train legs did not overlap Floxy's ride!
            expect(buddiesAfter.size).toBe(4);
            expect(buddiesAfter.has('Hash')).toBe(true);
            expect(buddiesAfter.has('Magginator')).toBe(true);
            expect(buddiesAfter.has('ichbinreis')).toBe(true);
            expect(buddiesAfter.has('DanielKeller')).toBe(true);
            expect(buddiesAfter.has('Marci44')).toBe(false);
            expect(buddiesAfter.has('viehmann')).toBe(false);

            // Verify flattened record on ICE 692 only counts overlapping travel buddies
            const flattenedIce = flattenTripRecord(sampleTrips[1]);
            expect(flattenedIce.buddy_count).toBe(2);
            expect(flattenedIce.buddies).toContain('@ichbinreis');
            expect(flattenedIce.buddies).toContain('@DanielKeller');
            expect(flattenedIce.buddies).not.toContain('@Marci44');
            expect(flattenedIce.buddies).not.toContain('@viehmann');
        });

        it('retains co_passengers even when trip.buddies or trip.fellowPassengers is an empty array', () => {
            const trip = {
                id: 999901,
                buddies: [], // empty array from normalizer/session store
                fellowPassengers: [],
                co_passengers: [
                    { username: 'Marci44', display_name: 'Marcel' }
                ]
            };

            const buddies = getTripBuddies(trip, 'floxy');
            expect(buddies.length).toBe(1);
            expect(buddies[0].username).toBe('Marci44');

            const flattened = flattenTripRecord(trip);
            expect(flattened.buddy_count).toBe(1);
            expect(flattened.buddies).toBe('@Marci44');
        });
    });

    describe('hasJourneyOverlap (Segment & Temporal Validation)', () => {
        const userTrip = {
            train: {
                origin: { name: 'Augsburg Hbf', departurePlanned: '2026-11-04T06:18:00Z' },
                destination: { name: 'Stuttgart Hbf', arrivalPlanned: '2026-11-04T07:48:00Z' }
            }
        };

        it('returns true for exact same train journey', () => {
            const companion = {
                origin: 'Augsburg Hbf',
                destination: 'Stuttgart Hbf',
                departure_time: '2026-11-04T06:18:00Z',
                arrival_time: '2026-11-04T07:48:00Z'
            };
            expect(hasJourneyOverlap(userTrip, companion)).toBe(true);
        });

        it('returns true when companion boards midway between start and end', () => {
            const companion = {
                origin: 'Ulm Hbf',
                destination: 'Stuttgart Hbf',
                departure_time: '2026-11-04T06:55:00Z',
                arrival_time: '2026-11-04T07:48:00Z'
            };
            expect(hasJourneyOverlap(userTrip, companion)).toBe(true);
        });

        it('returns true when companion alights midway between start and end', () => {
            const companion = {
                origin: 'Augsburg Hbf',
                destination: 'Ulm Hbf',
                departure_time: '2026-11-04T06:18:00Z',
                arrival_time: '2026-11-04T06:55:00Z'
            };
            expect(hasJourneyOverlap(userTrip, companion)).toBe(true);
        });

        it('returns true when companion rides an enclosing journey (started before, ends after)', () => {
            const companion = {
                origin: 'München Hbf',
                destination: 'Frankfurt(Main)Hbf',
                departure_time: '2026-11-04T05:40:00Z',
                arrival_time: '2026-11-04T09:15:00Z'
            };
            expect(hasJourneyOverlap(userTrip, companion)).toBe(true);
        });

        it('returns false when companion rode a later leg of the same train (e.g. Frankfurt -> Berlin)', () => {
            const companion = {
                origin: 'Frankfurt(Main)Hbf',
                destination: 'Berlin Südkreuz',
                departure_time: '2026-11-04T09:17:00Z',
                arrival_time: '2026-11-04T13:22:00Z'
            };
            expect(hasJourneyOverlap(userTrip, companion)).toBe(false);
        });

        it('returns false when companion boarded at user destination station for a later leg (Stuttgart -> Mannheim)', () => {
            const companion = {
                origin: 'Stuttgart Hbf',
                destination: 'Mannheim Hbf',
                departure_time: '2026-11-04T07:52:00Z',
                arrival_time: '2026-11-04T08:26:00Z'
            };
            expect(hasJourneyOverlap(userTrip, companion)).toBe(false);
        });

        it('returns false when companion alighted at user departure station prior to departure (München -> Augsburg)', () => {
            const companion = {
                origin: 'München Hbf',
                destination: 'Augsburg Hbf',
                departure_time: '2026-11-04T05:30:00Z',
                arrival_time: '2026-11-04T06:15:00Z'
            };
            expect(hasJourneyOverlap(userTrip, companion)).toBe(false);
        });
    });

});

