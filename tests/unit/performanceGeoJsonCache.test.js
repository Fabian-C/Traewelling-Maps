import { describe, it, expect, beforeEach } from 'vitest';
import { SessionDB } from '../../js/cache/session.js';
import { processTripsToGeoJSON } from '../../js/data/processing.js';
import { loadSessionByUsername } from '../../js/session/manager.js';
import { store, initializeState } from '../../js/state/store.js';
import { UI } from '../../js/ui/ui.js';

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
}

class MockObjectStore {
    constructor(name, options = {}) {
        this.name = name;
        this.keyPath = options.keyPath || 'id';
        this.data = {};
        this.indexes = {};
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
}

if (typeof globalThis.indexedDB === 'undefined') {
    setupMockIndexedDB();
}

if (typeof globalThis.window === 'undefined') {
    globalThis.window = globalThis;
}
if (!globalThis.window.location) {
    globalThis.window.location = { search: '', hash: '' };
}
if (typeof globalThis.mapboxgl === 'undefined') {
    globalThis.mapboxgl = {
        LngLatBounds: class {
            extend() {}
            isEmpty() { return true; }
        }
    };
}

function createMockElement() {
    const el = {
        value: '',
        dataset: {},
        style: {
            setProperty: () => {}
        },
        classList: { add: () => {}, remove: () => {}, contains: () => false, toggle: () => {} },
        innerHTML: '',
        textContent: '',
        children: [],
        appendChild: () => {},
        querySelectorAll: () => [],
        querySelector: () => el,
        addEventListener: () => {}
    };
    return el;
}

if (typeof globalThis.document === 'undefined') {
    const defaultEl = createMockElement();
    globalThis.document = {
        body: createMockElement(),
        getElementById: () => defaultEl,
        createElement: () => createMockElement(),
        querySelectorAll: () => []
    };
}

describe('Data Loading & Map Rendering Performance Architecture', () => {
    beforeEach(async () => {
        setupMockIndexedDB();
        initializeState();
        UI.refs = new Proxy({}, {
            get: (target, prop) => {
                if (!target[prop]) {
                    target[prop] = createMockElement();
                }
                return target[prop];
            }
        });
        SessionDB._db = null;
        SessionDB._stationsCache = null;
        SessionDB._tripRunsCache = null;
        await SessionDB.clear();
    });

    describe('Materialized GeoJSON Cache Lifecycle', () => {
        it('saves and retrieves materialized GeoJSON collections for sub-50ms instant boot', async () => {
            const mockCategories = {
                nationalExpress: {
                    type: 'FeatureCollection',
                    features: [
                        {
                            type: 'Feature',
                            geometry: { type: 'LineString', coordinates: [[13.37, 52.52], [10.0, 53.55]] },
                            properties: { statusId: 101, train: { lineName: 'ICE 800' } }
                        }
                    ]
                },
                regional: {
                    type: 'FeatureCollection',
                    features: []
                }
            };

            await SessionDB.saveMaterializedGeoJSON('hash', mockCategories, 1);

            const cached = await SessionDB.getMaterializedGeoJSON('hash');
            expect(cached).toBeDefined();
            expect(cached.username).toBe('hash');
            expect(cached.count).toBe(1);
            expect(cached.geojson).toBeDefined();
            expect(cached.geojson.nationalExpress.features.length).toBe(1);
            expect(cached.geojson.nationalExpress.features[0].properties.statusId).toBe(101);
        });

        it('returns null gracefully when no materialized GeoJSON exists for user', async () => {
            const result = await SessionDB.getMaterializedGeoJSON('nonexistent_user');
            expect(result).toBeNull();
        });
    });

    describe('Fast-Path Polyline Approximation Caching', () => {
        it('computes polyline approximation once and caches the result on trip._index', () => {
            const trip = {
                id: 555,
                train: {
                    lineName: 'ICE 920',
                    category: 'nationalExpress',
                    origin: { name: 'Berlin Hbf', latitude: 52.525, longitude: 13.37 },
                    destination: { name: 'Hamburg Hbf', latitude: 53.553, longitude: 10.006 },
                    polyline: {
                        type: 'Feature',
                        geometry: {
                            type: 'LineString',
                            coordinates: [
                                [13.37, 52.525],
                                [11.5, 53.0],
                                [10.006, 53.553]
                            ]
                        },
                        properties: { statusId: 555 }
                    }
                }
            };

            // First run computes and caches on _index
            const result1 = processTripsToGeoJSON([trip]);
            expect(trip._index).toBeDefined();
            expect(typeof trip._index.isApproximated).toBe('boolean');

            // Second run uses cached result directly without repeating Euclidean distance loop
            const cachedBool = trip._index.isApproximated;
            const result2 = processTripsToGeoJSON([trip]);
            expect(trip._index.isApproximated).toBe(cachedBool);
            expect(result1.nationalExpress.features.length).toBe(1);
            expect(result2.nationalExpress.features.length).toBe(1);
        });
    });

    describe('Single-Pass Session Loading (Elimination of Duplicate Rehydration)', () => {
        it('uses preloadedSession when passed to loadSessionByUsername without re-querying SessionDB', async () => {
            const preloaded = {
                username: 'fast_user',
                displayName: 'Fast User',
                avatar: null,
                trips: [
                    { id: 777, train: { lineName: 'RE 1', category: 'regional' } }
                ]
            };

            let getCallCount = 0;
            const originalGet = SessionDB.get;
            SessionDB.get = async (u) => {
                getCallCount++;
                return originalGet.call(SessionDB, u);
            };

            const state = store.get();
            const originalMap = state.map;
            state.map = {
                isStyleLoaded: () => true,
                loaded: () => true,
                on: () => {},
                off: () => {},
                getSource: () => null,
                addSource: () => {},
                addLayer: () => {},
                getLayer: () => null,
                moveLayer: () => {},
                setPaintProperty: () => {},
                setLayoutProperty: () => {},
                fitBounds: () => {}
            };

            try {
                await loadSessionByUsername('fast_user', preloaded);
                // Should use preloaded object without calling SessionDB.get
                expect(getCallCount).toBe(0);

                const currentState = store.get();
                expect(currentState.username).toBe('fast_user');
                expect(currentState.fetchedTrips.length).toBe(1);
                expect(currentState.fetchedTrips[0].id).toBe(777);
            } finally {
                SessionDB.get = originalGet;
                state.map = originalMap;
            }
        });
    });

    describe('In-Memory Relational Station and Trip Run Cache', () => {
        it('caches stations and trip runs in memory after first read', async () => {
            const rawTrips = [
                {
                    id: 888,
                    train: {
                        lineName: 'S 1',
                        category: 'suburban',
                        origin: { name: 'Station A', latitude: 52.5, longitude: 13.3 },
                        destination: { name: 'Station B', latitude: 52.6, longitude: 13.4 }
                    }
                }
            ];

            await SessionDB.save('alice', rawTrips);

            // First call reads from IndexedDB and caches in memory
            const stations1 = await SessionDB.getAllStations();
            expect(stations1.length).toBeGreaterThan(0);
            expect(SessionDB._stationsCache).toBeDefined();

            // Second call returns cached reference
            const stations2 = await SessionDB.getAllStations();
            expect(stations2).toBe(stations1);

            const trips1 = await SessionDB.getAllTrips();
            expect(trips1.length).toBeGreaterThan(0);
            expect(SessionDB._tripRunsCache).toBeDefined();

            const trips2 = await SessionDB.getAllTrips();
            expect(trips2).toBe(trips1);
        });
    });
});
