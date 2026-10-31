import { describe, it, expect, beforeEach } from 'vitest';
import { getStationId, extractStation, normalizeTrip } from '../../js/cache/normalizer.js';
import { SessionDB } from '../../js/cache/session.js';
import { Storage } from '../../js/storage/storage.js';

// Minimal mock IndexedDB for Node environment test coverage
class MockIndex {
    constructor(name, keyPath, store) {
        this.name = name;
        this.keyPath = keyPath;
        this.store = store;
    }

    getAll(query) {
        const req = { onsuccess: null, onerror: null, result: [] };
        setTimeout(() => {
            let res = Object.values(this.store.data);
            if (query !== undefined) {
                const target = typeof query === 'object' && query._onlyVal !== undefined ? query._onlyVal : query;
                res = res.filter((item) => {
                    if (Array.isArray(this.keyPath)) {
                        return this.keyPath.every((k, idx) => item[k] === target[idx]);
                    }
                    return item[this.keyPath] === target;
                });
            }
            req.result = res;
            if (req.onsuccess) req.onsuccess({ target: req });
        }, 0);
        return req;
    }

    openKeyCursor(query) {
        const req = { onsuccess: null, onerror: null, result: null };
        setTimeout(() => {
            const target = typeof query === 'object' && query._onlyVal !== undefined ? query._onlyVal : query;
            const matches = Object.values(this.store.data).filter((item) => item[this.keyPath] === target);
            let idx = 0;
            const advance = () => {
                if (idx < matches.length) {
                    const match = matches[idx++];
                    const cursor = {
                        primaryKey: match[this.store.keyPath],
                        continue: () => advance()
                    };
                    if (req.onsuccess) req.onsuccess({ target: { result: cursor } });
                } else {
                    if (req.onsuccess) req.onsuccess({ target: { result: null } });
                }
            };
            advance();
        }, 0);
        return req;
    }
}

class MockObjectStore {
    constructor(name, options = {}) {
        this.name = name;
        this.keyPath = options.keyPath || 'id';
        this.data = {};
        this.indexes = {};
        this.indexNames = {
            contains: (idxName) => !!this.indexes[idxName]
        };
    }

    createIndex(name, keyPath) {
        const idx = new MockIndex(name, keyPath, this);
        this.indexes[name] = idx;
        return idx;
    }

    index(name) {
        return this.indexes[name];
    }

    put(item) {
        const key = item[this.keyPath];
        this.data[key] = item;
    }

    get(key) {
        const req = { onsuccess: null, onerror: null, result: this.data[key] || null };
        setTimeout(() => {
            if (req.onsuccess) req.onsuccess({ target: req });
        }, 0);
        return req;
    }

    getAll() {
        const req = { onsuccess: null, onerror: null, result: Object.values(this.data) };
        setTimeout(() => {
            if (req.onsuccess) req.onsuccess({ target: req });
        }, 0);
        return req;
    }

    delete(key) {
        delete this.data[key];
    }

    clear() {
        this.data = {};
    }
}

class MockDatabase {
    constructor(name, version) {
        this.name = name;
        this.version = version;
        this.stores = {};
        this.objectStoreNames = {
            contains: (storeName) => !!this.stores[storeName],
            push: (storeName) => {
                this.stores[storeName] = new MockObjectStore(storeName);
            }
        };
    }

    createObjectStore(name, options) {
        const store = new MockObjectStore(name, options);
        this.stores[name] = store;
        return store;
    }

    transaction(storeNames, mode) {
        const db = this;
        const tx = {
            mode,
            oncomplete: null,
            onerror: null,
            objectStore: (name) => db.stores[name]
        };
        setTimeout(() => {
            if (tx.oncomplete) tx.oncomplete();
        }, 5);
        return tx;
    }
}

function setupMockIndexedDB() {
    let currentDb = null;
    globalThis.IDBKeyRange = {
        only: (val) => ({ _onlyVal: val })
    };
    globalThis.indexedDB = {
        open: (name, version) => {
            const req = { onsuccess: null, onerror: null, onupgradeneeded: null, result: null };
            setTimeout(() => {
                if (!currentDb) {
                    currentDb = new MockDatabase(name, version);
                    if (req.onupgradeneeded) {
                        req.onupgradeneeded({ target: { result: currentDb } });
                    }
                }
                req.result = currentDb;
                if (req.onsuccess) req.onsuccess({ target: req });
            }, 0);
            return req;
        }
    };
    return () => {
        currentDb = null;
    };
}

describe('Normalized Relational Cache Architecture', () => {
    describe('Station Extraction & ID Derivation', () => {
        it('derives station id from numeric id, eva, or ibnr', () => {
            expect(getStationId({ id: 8000105 })).toBe(8000105);
            expect(getStationId({ station: { id: 42 } })).toBe(42);
            expect(getStationId({ eva_number: '8011160' })).toBe('8011160');
            expect(getStationId({ ibnr: 8000261 })).toBe(8000261);
        });

        it('falls back to stable sanitized string from name when no numeric id exists', () => {
            const stnId = getStationId({ name: 'Hamburg Hbf' });
            expect(stnId).toBe('stn_hamburg_hbf');
            expect(getStationId({ station: { name: 'Berlin Zoologischer Garten' } })).toBe(
                'stn_berlin_zoologischer_garten'
            );
        });

        it('returns null for null or empty station objects', () => {
            expect(getStationId(null)).toBeNull();
            expect(getStationId({})).toBeNull();
            expect(getStationId({ name: '' })).toBeNull();
        });

        it('extracts complete normalized station records', () => {
            const raw = {
                name: 'Köln Hbf',
                latitude: 50.943,
                longitude: 6.958,
                ibnr: 8000207,
                country_code: 'DE'
            };
            const extracted = extractStation(raw);
            expect(extracted).toEqual({
                id: 8000207,
                name: 'Köln Hbf',
                latitude: 50.943,
                longitude: 6.958,
                eva_number: '8000207',
                country_code: 'DE'
            });
        });
    });

    describe('Trip Decomposition & Normalization', () => {
        const sampleCheckin = {
            id: 987654,
            body: 'Heading south for work with @Alice',
            createdAt: '2026-10-15T08:30:00Z',
            train: {
                category: 'nationalExpress',
                lineName: 'ICE 720',
                number: 720,
                operator: 'DB Fernverkehr AG',
                distance: 280000,
                duration: 110,
                origin: {
                    name: 'Hamburg Hbf',
                    id: 8002549,
                    departureReal: '2026-10-15T08:35:00Z',
                    departurePlanned: '2026-10-15T08:30:00Z',
                    latitude: 53.553,
                    longitude: 10.007
                },
                destination: {
                    name: 'Frankfurt(Main)Hbf',
                    id: 8000105,
                    arrivalReal: '2026-10-15T10:25:00Z',
                    arrivalPlanned: '2026-10-15T10:20:00Z',
                    latitude: 50.107,
                    longitude: 8.663
                },
                polyline: {
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: [
                            [10.007, 53.553],
                            [8.663, 50.107]
                        ]
                    }
                }
            }
        };

        it('decomposes check-in into stations, tripRun, and status entities', () => {
            const normalized = normalizeTrip(sampleCheckin, 'testuser');
            expect(normalized).not.toBeNull();

            // 1. Stations
            expect(normalized.stations.length).toBe(2);
            expect(normalized.stations[0].id).toBe(8002549);
            expect(normalized.stations[0].name).toBe('Hamburg Hbf');
            expect(normalized.stations[1].id).toBe(8000105);
            expect(normalized.stations[1].name).toBe('Frankfurt(Main)Hbf');

            // 2. Trip line run
            expect(normalized.tripRun.line_name).toBe('ICE 720');
            expect(normalized.tripRun.category).toBe('nationalExpress');
            expect(normalized.tripRun.operator_name).toBe('DB Fernverkehr AG');
            expect(normalized.tripRun.origin_station_id).toBe(8002549);
            expect(normalized.tripRun.destination_station_id).toBe(8000105);
            expect(normalized.tripRun.polyline).toEqual(sampleCheckin.train.polyline);

            // 3. Status check-in
            expect(normalized.status.id).toBe(987654);
            expect(normalized.status.username).toBe('testuser');
            expect(normalized.status.trip_id).toBe(normalized.tripRun.id);
            expect(normalized.status.origin_id).toBe(8002549);
            expect(normalized.status.destination_id).toBe(8000105);
            expect(normalized.status.departure_delay).toBe(5); // 5 min delay
            expect(normalized.status.distance_km).toBe(280);
            expect(normalized.status.body).toBe('Heading south for work with @Alice');
        });

        it('handles minimal trips gracefully without errors', () => {
            const minimalTrip = {
                id: 111,
                train: {
                    lineName: 'S 3',
                    origin: { name: 'Altona' },
                    destination: { name: 'Jungfernstieg' }
                }
            };
            const normalized = normalizeTrip(minimalTrip, 'minuser');
            expect(normalized).not.toBeNull();
            expect(normalized.status.id).toBe(111);
            expect(normalized.stations.length).toBe(2);
            expect(normalized.stations[0].id).toBe('stn_altona');
            expect(normalized.stations[1].id).toBe('stn_jungfernstieg');
        });
    });

    describe('SessionDB Schema Upgrade & Relational Methods', () => {
        let cleanupMock;

        beforeEach(() => {
            SessionDB._db = null;
            cleanupMock = setupMockIndexedDB();
            Storage.remove(SessionDB.MIGRATED_KEY);
            Storage.remove(SessionDB.META_CACHE_KEY);
        });

        it('exposes VERSION 4 and normalized object store names', () => {
            expect(SessionDB.VERSION).toBe(4);
            expect(SessionDB.STORE_NAME).toBe('sessions');
            expect(SessionDB.STATIONS_STORE).toBe('stations');
            expect(SessionDB.TRIPS_STORE).toBe('trips');
            expect(SessionDB.STATUSES_STORE).toBe('statuses');
        });

        it('open creates all 6 object stores with indexes', async () => {
            const db = await SessionDB.open();
            expect(db.objectStoreNames.contains('sessions')).toBe(true);
            expect(db.objectStoreNames.contains('stopovers')).toBe(true);
            expect(db.objectStoreNames.contains('polylines')).toBe(true);
            expect(db.objectStoreNames.contains('stations')).toBe(true);
            expect(db.objectStoreNames.contains('trips')).toBe(true);
            expect(db.objectStoreNames.contains('statuses')).toBe(true);

            const statusStore = db.stores.statuses;
            expect(statusStore.indexNames.contains('username')).toBe(true);
            expect(statusStore.indexNames.contains('username_departure')).toBe(true);
            expect(statusStore.indexNames.contains('departure_delay')).toBe(true);
        });

        it('save executes dual-write into sessions and normalized stores', async () => {
            const trip = {
                id: 501,
                train: {
                    lineName: 'RE 1',
                    category: 'regional',
                    origin: { id: 101, name: 'Potsdam Hbf' },
                    destination: { id: 102, name: 'Berlin Hbf' }
                }
            };

            const saved = await SessionDB.save('alice', [trip], { displayName: 'Alice' });
            expect(saved.username).toBe('alice');

            // Verify monolithic session is intact
            const session = await SessionDB.get('alice');
            expect(session.trips.length).toBe(1);
            expect(session.trips[0].id).toBe(501);

            // Verify normalized stores received entities
            const statuses = await SessionDB.getStatusesByUser('alice');
            expect(statuses.length).toBe(1);
            expect(statuses[0].id).toBe(501);
            expect(statuses[0].origin_id).toBe(101);
            expect(statuses[0].destination_id).toBe(102);

            const stn1 = await SessionDB.getStation(101);
            expect(stn1.name).toBe('Potsdam Hbf');

            const allStations = await SessionDB.getAllStations();
            expect(allStations.length).toBe(2);

            const allTrips = await SessionDB.getAllTrips();
            expect(allTrips.length).toBe(1);
            expect(allTrips[0].line_name).toBe('RE 1');
        });

        it('saveIncrementalTrips appends new records without overwriting historical dataset', async () => {
            const trip1 = {
                id: 1001,
                train: { lineName: 'U2', origin: { name: 'Alexanderplatz' }, destination: { name: 'Pankow' } }
            };
            await SessionDB.save('commuter', [trip1]);

            const trip2 = {
                id: 1002,
                train: { lineName: 'U2', origin: { name: 'Pankow' }, destination: { name: 'Alexanderplatz' } }
            };
            await SessionDB.saveIncrementalTrips('commuter', [trip2]);

            const session = await SessionDB.get('commuter');
            expect(session.trips.length).toBe(2);

            const statuses = await SessionDB.getStatusesByUser('commuter');
            expect(statuses.length).toBe(2);
        });

        it('delete purges user records from statuses and sessions', async () => {
            const tripA = { id: 201, train: { lineName: 'ICE 1', origin: { name: 'A' }, destination: { name: 'B' } } };
            const tripB = { id: 202, train: { lineName: 'ICE 2', origin: { name: 'C' }, destination: { name: 'D' } } };

            await SessionDB.save('user_a', [tripA]);
            await SessionDB.save('user_b', [tripB]);

            await SessionDB.delete('user_a');

            const sessionA = await SessionDB.get('user_a');
            expect(sessionA).toBeNull();

            const statusesA = await SessionDB.getStatusesByUser('user_a');
            expect(statusesA.length).toBe(0);

            // User B remains intact
            const sessionB = await SessionDB.get('user_b');
            expect(sessionB).not.toBeNull();
            const statusesB = await SessionDB.getStatusesByUser('user_b');
            expect(statusesB.length).toBe(1);
        });

        it('clear removes all data across all object stores', async () => {
            const trip = {
                id: 301,
                train: { lineName: 'RE 7', origin: { name: 'Dessau' }, destination: { name: 'Berlin' } }
            };
            await SessionDB.save('bob', [trip]);

            await SessionDB.clear();

            const all = await SessionDB.getAll();
            expect(all.length).toBe(0);

            const stations = await SessionDB.getAllStations();
            expect(stations.length).toBe(0);

            const statuses = await SessionDB.getStatusesByUser('bob');
            expect(statuses.length).toBe(0);
        });

        it('migrateExistingSessions migrates legacy sessions into normalized stores', async () => {
            const db = await SessionDB.open();
            // Simulate pre-existing legacy session
            const legacyTrip = {
                id: 777,
                train: {
                    lineName: 'IC 2020',
                    origin: { id: 8000001, name: 'Aachen Hbf' },
                    destination: { id: 8000002, name: 'Düsseldorf Hbf' }
                }
            };
            db.stores.sessions.put({
                username: 'legacy_user',
                trips: [legacyTrip],
                timestamp: Date.now()
            });

            // Trigger migration
            await SessionDB.migrateExistingSessions();

            const statuses = await SessionDB.getStatusesByUser('legacy_user');
            expect(statuses.length).toBe(1);
            expect(statuses[0].id).toBe(777);

            const stn = await SessionDB.getStation(8000001);
            expect(stn.name).toBe('Aachen Hbf');
        });
    });
});
