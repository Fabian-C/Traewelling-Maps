import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TraewellingAPI } from '../../js/api/traewelling.js';
import { normalizeTrip, denormalizeTrip } from '../../js/cache/normalizer.js';
import { SessionDB } from '../../js/cache/session.js';
import { executeTripQuery, flattenTripRecord, TABLE_SCHEMAS } from '../../js/trips/sqlEngine.js';
import { extractTripDetails } from '../../js/ui/tripDetails.js';
import { getTripBuddies } from '../../js/trips/formatters.js';

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
        let cleanupMock;

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

    describe('SQL Engine co_passengers table & queries', () => {
        it('defines co_passengers in TABLE_SCHEMAS', () => {
            expect(TABLE_SCHEMAS.co_passengers).toBeDefined();
            expect(TABLE_SCHEMAS.co_passengers.name).toBe('co_passengers');
            const colNames = TABLE_SCHEMAS.co_passengers.columns.map(c => c.name);
            expect(colNames).toContain('trip_id');
            expect(colNames).toContain('username');
            expect(colNames).toContain('origin');
            expect(colNames).toContain('destination');
        });

        it('queries co_passengers table using executeTripQuery', () => {
            const coPassengers = [
                { trip_id: 9289803, username: 'Astro', origin: 'Berlin', destination: 'Potsdam', body: 'Hi' },
                { trip_id: 9289804, username: 'Bob', origin: 'Hamburg', destination: 'Bremen', body: '' }
            ];

            const result = executeTripQuery('SELECT username, origin FROM co_passengers WHERE trip_id = 9289803', [], {
                tables: { co_passengers: coPassengers }
            });

            expect(result.table).toBe('co_passengers');
            expect(result.rows.length).toBe(1);
            expect(result.rows[0].username).toBe('Astro');
            expect(result.rows[0].origin).toBe('Berlin');
        });

        it('merges co_passengers in flattenTripRecord into buddies and buddy_count', () => {
            const trip = {
                id: 9577959,
                train: { lineName: 'U6', origin: { name: 'A' }, destination: { name: 'B' } },
                co_passengers: [
                    { username: 'Astro' }
                ]
            };

            const flattened = flattenTripRecord(trip);
            expect(flattened.buddies).toContain('@Astro');
            expect(flattened.buddy_count).toBeGreaterThanOrEqual(1);
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

});
