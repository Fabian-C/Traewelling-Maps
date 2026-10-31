// IndexedDB for session storage
import { CONFIG } from '../config/config.js';
import { Storage, STORAGE_KEYS } from '../storage/storage.js';
import { normalizeTrip, extractStation, getStationId } from './normalizer.js';

export const SessionDB = {
    DB_NAME: 'TraewellingMap',
    STORE_NAME: 'sessions',
    STOPOVERS_STORE: 'stopovers',
    POLYLINES_STORE: 'polylines',
    STATIONS_STORE: 'stations',
    TRIPS_STORE: 'trips',
    STATUSES_STORE: 'statuses',
    META_CACHE_KEY: STORAGE_KEYS.SESSIONS_META,
    MIGRATED_KEY: 'tw_db_relational_v4_migrated',
    VERSION: 4,
    MAX_SESSIONS: 15,
    _db: null,

    // Normalization utilities
    normalizeTrip,
    extractStation,
    getStationId,

    isExpired(session, now = Date.now()) {
        if (!session) return false;
        const maxAge = CONFIG.SESSION_MAX_AGE_MS;
        if (!maxAge) return false;
        if (!session.timestamp) return false;
        return now - session.timestamp > maxAge;
    },

    // Fast synchronous cache for instant UI rendering in setup menu
    getStoredMetadata() {
        const list = Storage.getJSON(this.META_CACHE_KEY, []);
        const now = Date.now();
        return Array.isArray(list) ? list.filter((item) => !this.isExpired(item, now)) : [];
    },

    // Retrieve lightweight session summaries without reading full trip lists into memory
    async getSessionSummaries() {
        const stored = this.getStoredMetadata();
        if (stored.length > 0) return stored;
        try {
            const all = await this.getAll();
            return all.map((s) => ({
                username: s.username,
                displayName: s.displayName || s.username,
                avatar: s.avatar || null,
                tripCount: s.tripCount || (s.trips ? s.trips.length : 0),
                timestamp: s.timestamp || Date.now()
            }));
        } catch {
            return [];
        }
    },

    saveStoredMetadata(sessions = []) {
        const meta = sessions.map((s) => ({
            username: s.username,
            displayName: s.displayName || s.username,
            avatar: s.avatar || null,
            tripCount: s.tripCount || (s.trips ? s.trips.length : 0),
            timestamp: s.timestamp || Date.now()
        }));
        Storage.setJSON(this.META_CACHE_KEY, meta);
    },

    // Open database connection
    open() {
        if (this._db) return Promise.resolve(this._db);

        return new Promise((resolve, reject) => {
            const req = indexedDB.open(this.DB_NAME, this.VERSION);

            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(this.STORE_NAME)) {
                    db.createObjectStore(this.STORE_NAME, { keyPath: 'username' });
                }
                if (!db.objectStoreNames.contains(this.STOPOVERS_STORE)) {
                    db.createObjectStore(this.STOPOVERS_STORE, { keyPath: 'statusId' });
                }
                if (!db.objectStoreNames.contains(this.POLYLINES_STORE)) {
                    db.createObjectStore(this.POLYLINES_STORE, { keyPath: 'statusId' });
                }
                if (!db.objectStoreNames.contains(this.STATIONS_STORE)) {
                    const stnStore = db.createObjectStore(this.STATIONS_STORE, { keyPath: 'id' });
                    stnStore.createIndex('name', 'name', { unique: false });
                }
                if (!db.objectStoreNames.contains(this.TRIPS_STORE)) {
                    const tripStore = db.createObjectStore(this.TRIPS_STORE, { keyPath: 'id' });
                    tripStore.createIndex('category', 'category', { unique: false });
                }
                if (!db.objectStoreNames.contains(this.STATUSES_STORE)) {
                    const statusStore = db.createObjectStore(this.STATUSES_STORE, { keyPath: 'id' });
                    statusStore.createIndex('username', 'username', { unique: false });
                    statusStore.createIndex('username_departure', ['username', 'departure_time'], { unique: false });
                    statusStore.createIndex('departure_delay', 'departure_delay', { unique: false });
                }
            };

            req.onsuccess = () => {
                this._db = req.result;
                this.migrateExistingSessions().catch(() => {});
                resolve(this._db);
            };

            req.onerror = () => reject(req.error);
        });
    },

    // Save a session (including trip data and normalized relational records)
    async save(username, data, options = {}) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const isArray = Array.isArray(data);
            const trips = isArray ? data : data?.trips || null;
            const meta = isArray ? options || {} : data || {};

            const storesToOpen = [this.STORE_NAME];
            const hasRelational =
                Array.isArray(trips) &&
                db.objectStoreNames.contains(this.STATIONS_STORE) &&
                db.objectStoreNames.contains(this.TRIPS_STORE) &&
                db.objectStoreNames.contains(this.STATUSES_STORE);
            if (hasRelational) {
                storesToOpen.push(this.STATIONS_STORE, this.TRIPS_STORE, this.STATUSES_STORE);
            }

            const tx = db.transaction(storesToOpen, 'readwrite');
            const store = tx.objectStore(this.STORE_NAME);

            const session = {
                username: username,
                displayName: meta.displayName || username,
                avatar: meta.avatar || null,
                tripCount: meta.tripCount || (trips ? trips.length : 0),
                token: meta.token || null,
                trips: trips, // Store trip data for caching
                timestamp: meta.timestamp !== undefined ? meta.timestamp : Date.now()
            };

            store.put(session);

            // Dual-write: Normalize and write to relational stores
            if (hasRelational) {
                const stnStore = tx.objectStore(this.STATIONS_STORE);
                const tripStore = tx.objectStore(this.TRIPS_STORE);
                const statusStore = tx.objectStore(this.STATUSES_STORE);

                for (const trip of trips) {
                    const norm = this.normalizeTrip(trip, username);
                    if (norm) {
                        for (const stn of norm.stations) {
                            stnStore.put(stn);
                        }
                        if (norm.tripRun) {
                            tripStore.put(norm.tripRun);
                        }
                        if (norm.status) {
                            statusStore.put(norm.status);
                        }
                    }
                }
            }

            tx.oncomplete = () => {
                if (Array.isArray(trips)) {
                    const polyMap = {};
                    trips.forEach((t) => {
                        if (t?.id && t.train?.polyline) {
                            polyMap[t.id] = t.train.polyline;
                        }
                    });
                    if (Object.keys(polyMap).length > 0) {
                        this.savePolylinesBatch(polyMap).catch(() => {});
                    }
                }
                this.prune(); // Clean old sessions
                this.getAll()
                    .then((all) => this.saveStoredMetadata(all))
                    .catch(() => {});
                resolve(session);
            };
            tx.onerror = () => reject(tx.error);
        });
    },

    // Get all sessions
    async getAll(includeExpired = false) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([this.STORE_NAME], 'readonly');
            const req = tx.objectStore(this.STORE_NAME).getAll();
            req.onsuccess = () => {
                const sessions = req.result || [];
                sessions.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

                if (includeExpired) {
                    resolve(sessions);
                    return;
                }

                const now = Date.now();
                const fresh = [];
                const expiredUsernames = [];

                for (const session of sessions) {
                    if (this.isExpired(session, now)) {
                        expiredUsernames.push(session.username);
                    } else {
                        fresh.push(session);
                    }
                }

                if (expiredUsernames.length) {
                    expiredUsernames.forEach((username) => {
                        this.delete(username).catch((err) =>
                            console.warn('Failed to delete expired session', username, err)
                        );
                    });
                }

                this.saveStoredMetadata(fresh);
                resolve(fresh);
            };
            req.onerror = () => reject(req.error);
        });
    },

    // Get single session
    async get(username) {
        if (!username) return null;
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([this.STORE_NAME], 'readonly');
            const store = tx.objectStore(this.STORE_NAME);
            const req = store.get(username);
            req.onsuccess = () => {
                let session = req.result || null;
                if (!session) {
                    // IndexedDB keys are exact case-sensitive strings.
                    // Fall back to scanning all sessions case-insensitively.
                    const allReq = store.getAll();
                    allReq.onsuccess = () => {
                        const all = allReq.result || [];
                        const target = String(username).toLowerCase();
                        session = all.find((s) => s.username && s.username.toLowerCase() === target) || null;
                        if (!session) {
                            // Check synchronous localStorage fallback
                            const fallbackData = Storage.getJSON(STORAGE_KEYS.SESSIONS_DATA, null);
                            if (Array.isArray(fallbackData)) {
                                session =
                                    fallbackData.find((s) => s.username && s.username.toLowerCase() === target) || null;
                            }
                        }
                        if (session && this.isExpired(session)) {
                            this.delete(session.username).catch(() => {});
                            resolve(null);
                        } else {
                            resolve(session);
                        }
                    };
                    allReq.onerror = () => {
                        const fallbackData = Storage.getJSON(STORAGE_KEYS.SESSIONS_DATA, null);
                        if (Array.isArray(fallbackData)) {
                            const target = String(username).toLowerCase();
                            const session =
                                fallbackData.find((s) => s.username && s.username.toLowerCase() === target) || null;
                            if (session && !this.isExpired(session)) {
                                resolve(session);
                                return;
                            }
                        }
                        resolve(null);
                    };
                    return;
                }
                if (session && this.isExpired(session)) {
                    this.delete(username).catch(() => {});
                    resolve(null);
                } else {
                    resolve(session);
                }
            };
            req.onerror = () => reject(req.error);
        });
    },

    // Delete a session and all its associated cached routes and stopovers
    async delete(username) {
        if (!username) return;
        const db = await this.open();
        let exactUsername = username;
        // First retrieve session to find all trip status IDs for this user
        let tripIds = [];
        try {
            const existingSession = await this.get(username);
            if (existingSession) {
                exactUsername = existingSession.username || username;
                if (existingSession.trips && Array.isArray(existingSession.trips)) {
                    tripIds = existingSession.trips.map((t) => Number(t.id)).filter(Boolean);
                }
            }
        } catch (e) {
            console.warn('Could not read existing trips before session delete:', e);
        }

        return new Promise((resolve, reject) => {
            const stores = [this.STORE_NAME];
            if (db.objectStoreNames.contains(this.POLYLINES_STORE)) stores.push(this.POLYLINES_STORE);
            if (db.objectStoreNames.contains(this.STOPOVERS_STORE)) stores.push(this.STOPOVERS_STORE);
            if (db.objectStoreNames.contains(this.STATUSES_STORE)) stores.push(this.STATUSES_STORE);

            const tx = db.transaction(stores, 'readwrite');
            tx.objectStore(this.STORE_NAME).delete(exactUsername);
            if (exactUsername !== username) {
                tx.objectStore(this.STORE_NAME).delete(username);
            }

            if (tripIds.length > 0) {
                if (stores.includes(this.POLYLINES_STORE)) {
                    const polyStore = tx.objectStore(this.POLYLINES_STORE);
                    tripIds.forEach((id) => polyStore.delete(id));
                }
                if (stores.includes(this.STOPOVERS_STORE)) {
                    const stopStore = tx.objectStore(this.STOPOVERS_STORE);
                    tripIds.forEach((id) => stopStore.delete(id));
                }
            }

            if (stores.includes(this.STATUSES_STORE)) {
                const statusStore = tx.objectStore(this.STATUSES_STORE);
                if (statusStore.indexNames && statusStore.indexNames.contains('username')) {
                    const normUser = String(username).toLowerCase();
                    const userIndex = statusStore.index('username');
                    const req =
                        typeof IDBKeyRange !== 'undefined'
                            ? userIndex.openKeyCursor(IDBKeyRange.only(normUser))
                            : userIndex.openKeyCursor(normUser);
                    req.onsuccess = (e) => {
                        const cursor = e.target.result;
                        if (cursor) {
                            statusStore.delete(cursor.primaryKey);
                            cursor.continue();
                        }
                    };
                }
            }

            tx.oncomplete = () => {
                const existing = this.getStoredMetadata().filter(
                    (s) => s.username?.toLowerCase() !== username.toLowerCase()
                );
                Storage.setJSON(this.META_CACHE_KEY, existing);
                resolve();
            };
            tx.onerror = () => reject(tx.error);
        });
    },

    // Clear all sessions and all cached routes and stopovers
    async clear() {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const stores = [this.STORE_NAME];
            if (db.objectStoreNames.contains(this.POLYLINES_STORE)) stores.push(this.POLYLINES_STORE);
            if (db.objectStoreNames.contains(this.STOPOVERS_STORE)) stores.push(this.STOPOVERS_STORE);
            if (db.objectStoreNames.contains(this.STATIONS_STORE)) stores.push(this.STATIONS_STORE);
            if (db.objectStoreNames.contains(this.TRIPS_STORE)) stores.push(this.TRIPS_STORE);
            if (db.objectStoreNames.contains(this.STATUSES_STORE)) stores.push(this.STATUSES_STORE);

            const tx = db.transaction(stores, 'readwrite');
            stores.forEach((s) => tx.objectStore(s).clear());
            tx.oncomplete = () => {
                Storage.remove(this.META_CACHE_KEY);
                Storage.remove(this.MIGRATED_KEY);
                resolve();
            };
            tx.onerror = () => reject(tx.error);
        });
    },

    // Retrieve cached stopovers for a batch of status IDs
    async getStopoversBatch(statusIds = []) {
        if (!statusIds || !statusIds.length) return {};
        const db = await this.open();
        return new Promise((resolve) => {
            try {
                const tx = db.transaction([this.STOPOVERS_STORE], 'readonly');
                const store = tx.objectStore(this.STOPOVERS_STORE);
                const results = {};
                let remaining = statusIds.length;

                statusIds.forEach((rawId) => {
                    const id = Number(rawId);
                    const req = store.get(id);
                    req.onsuccess = () => {
                        if (req.result?.stopovers) {
                            results[id] = req.result.stopovers;
                        }
                        remaining--;
                        if (remaining === 0) resolve(results);
                    };
                    req.onerror = () => {
                        remaining--;
                        if (remaining === 0) resolve(results);
                    };
                });
            } catch (e) {
                console.warn('Failed to get cached stopovers batch:', e);
                resolve({});
            }
        });
    },

    // Persist a batch of stopovers keyed by status ID
    async saveStopoversBatch(entries = {}) {
        const keys = Object.keys(entries);
        if (!keys.length) return;
        const db = await this.open();
        return new Promise((resolve, reject) => {
            try {
                const tx = db.transaction([this.STOPOVERS_STORE], 'readwrite');
                const store = tx.objectStore(this.STOPOVERS_STORE);
                keys.forEach((rawId) => {
                    const id = Number(rawId);
                    store.put({ statusId: id, stopovers: entries[rawId] });
                });
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            } catch (e) {
                console.warn('Failed to save stopovers batch:', e);
                resolve();
            }
        });
    },

    // Retrieve cached polylines for a batch of status IDs
    async getPolylinesBatch(statusIds = []) {
        if (!statusIds || !statusIds.length) return {};
        const db = await this.open();
        return new Promise((resolve) => {
            try {
                const tx = db.transaction([this.POLYLINES_STORE], 'readonly');
                const store = tx.objectStore(this.POLYLINES_STORE);
                const results = {};
                let remaining = statusIds.length;

                statusIds.forEach((rawId) => {
                    const id = Number(rawId);
                    const req = store.get(id);
                    req.onsuccess = () => {
                        if (req.result?.polyline) {
                            results[id] = req.result.polyline;
                        }
                        remaining--;
                        if (remaining === 0) resolve(results);
                    };
                    req.onerror = () => {
                        remaining--;
                        if (remaining === 0) resolve(results);
                    };
                });
            } catch (e) {
                console.warn('Failed to get cached polylines batch:', e);
                resolve({});
            }
        });
    },

    // Persist a batch of polylines keyed by status ID
    async savePolylinesBatch(entries = {}) {
        const keys = Object.keys(entries);
        if (!keys.length) return;
        const db = await this.open();
        return new Promise((resolve, reject) => {
            try {
                const tx = db.transaction([this.POLYLINES_STORE], 'readwrite');
                const store = tx.objectStore(this.POLYLINES_STORE);
                keys.forEach((rawId) => {
                    const id = Number(rawId);
                    if (entries[rawId]) {
                        store.put({ statusId: id, polyline: entries[rawId] });
                    }
                });
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            } catch (e) {
                console.warn('Failed to save polylines batch:', e);
                resolve();
            }
        });
    },

    // Remove old sessions beyond MAX_SESSIONS and expired entries
    async prune() {
        try {
            const now = Date.now();
            const sessions = await this.getAll(true);

            const freshSessions = [];
            for (const session of sessions) {
                if (this.isExpired(session, now)) {
                    await this.delete(session.username);
                } else {
                    freshSessions.push(session);
                }
            }

            if (freshSessions.length > this.MAX_SESSIONS) {
                const toDelete = freshSessions.slice(this.MAX_SESSIONS);
                for (const s of toDelete) {
                    await this.delete(s.username);
                }
            }
        } catch (e) {
            console.warn('Session prune failed:', e);
        }
    },

    // Save only new incremental trips to avoid full-array serialization overhead
    async saveIncrementalTrips(username, newTrips = []) {
        if (!username || !newTrips.length) return;
        const db = await this.open();
        const hasRelational =
            db.objectStoreNames.contains(this.STATIONS_STORE) &&
            db.objectStoreNames.contains(this.TRIPS_STORE) &&
            db.objectStoreNames.contains(this.STATUSES_STORE);

        return new Promise((resolve, reject) => {
            const storesToOpen = [this.STORE_NAME];
            if (hasRelational) {
                storesToOpen.push(this.STATIONS_STORE, this.TRIPS_STORE, this.STATUSES_STORE);
            }
            const tx = db.transaction(storesToOpen, 'readwrite');
            const sessStore = tx.objectStore(this.STORE_NAME);

            const getReq = sessStore.get(username);
            getReq.onsuccess = () => {
                const session = getReq.result || {
                    username,
                    displayName: username,
                    trips: [],
                    timestamp: Date.now()
                };
                const existingIds = new Set((session.trips || []).map((t) => t.id));
                const addedTrips = [];
                for (const trip of newTrips) {
                    if (trip?.id && !existingIds.has(trip.id)) {
                        existingIds.add(trip.id);
                        addedTrips.push(trip);
                    }
                }
                session.trips = [...addedTrips, ...(session.trips || [])];
                session.tripCount = session.trips.length;
                session.timestamp = Date.now();
                sessStore.put(session);

                if (hasRelational && addedTrips.length > 0) {
                    const stnStore = tx.objectStore(this.STATIONS_STORE);
                    const tripStore = tx.objectStore(this.TRIPS_STORE);
                    const statusStore = tx.objectStore(this.STATUSES_STORE);

                    for (const trip of addedTrips) {
                        const norm = this.normalizeTrip(trip, username);
                        if (norm) {
                            for (const stn of norm.stations) {
                                stnStore.put(stn);
                            }
                            if (norm.tripRun) {
                                tripStore.put(norm.tripRun);
                            }
                            if (norm.status) {
                                statusStore.put(norm.status);
                            }
                        }
                    }
                }
            };

            tx.oncomplete = () => {
                this.getAll()
                    .then((all) => this.saveStoredMetadata(all))
                    .catch(() => {});
                resolve();
            };
            tx.onerror = () => reject(tx.error);
        });
    },

    // Retrieve normalized statuses for a given username using the username index
    async getStatusesByUser(username) {
        if (!username) return [];
        const db = await this.open();
        if (!db.objectStoreNames.contains(this.STATUSES_STORE)) return [];
        return new Promise((resolve) => {
            try {
                const tx = db.transaction([this.STATUSES_STORE], 'readonly');
                const store = tx.objectStore(this.STATUSES_STORE);
                const index = store.index('username');
                const normUser = String(username).toLowerCase();
                const keyRange = typeof IDBKeyRange !== 'undefined' ? IDBKeyRange.only(normUser) : normUser;
                const req = index.getAll(keyRange);
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => resolve([]);
            } catch {
                resolve([]);
            }
        });
    },

    // Retrieve a normalized station by ID
    async getStation(id) {
        if (id === undefined || id === null) return null;
        const db = await this.open();
        if (!db.objectStoreNames.contains(this.STATIONS_STORE)) return null;
        return new Promise((resolve) => {
            try {
                const tx = db.transaction([this.STATIONS_STORE], 'readonly');
                const req = tx.objectStore(this.STATIONS_STORE).get(id);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => resolve(null);
            } catch {
                resolve(null);
            }
        });
    },

    // Retrieve all normalized stations
    async getAllStations() {
        const db = await this.open();
        if (!db.objectStoreNames.contains(this.STATIONS_STORE)) return [];
        return new Promise((resolve) => {
            try {
                const tx = db.transaction([this.STATIONS_STORE], 'readonly');
                const req = tx.objectStore(this.STATIONS_STORE).getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => resolve([]);
            } catch {
                resolve([]);
            }
        });
    },

    // Retrieve a normalized trip (line run) by ID
    async getTrip(id) {
        if (!id) return null;
        const db = await this.open();
        if (!db.objectStoreNames.contains(this.TRIPS_STORE)) return null;
        return new Promise((resolve) => {
            try {
                const tx = db.transaction([this.TRIPS_STORE], 'readonly');
                const req = tx.objectStore(this.TRIPS_STORE).get(String(id));
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => resolve(null);
            } catch {
                resolve(null);
            }
        });
    },

    // Retrieve all normalized trips (line runs)
    async getAllTrips() {
        const db = await this.open();
        if (!db.objectStoreNames.contains(this.TRIPS_STORE)) return [];
        return new Promise((resolve) => {
            try {
                const tx = db.transaction([this.TRIPS_STORE], 'readonly');
                const req = tx.objectStore(this.TRIPS_STORE).getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => resolve([]);
            } catch {
                resolve([]);
            }
        });
    },

    // Background migration routine for legacy cached sessions
    async migrateExistingSessions() {
        if (!this._db) return;
        const db = this._db;
        if (
            !db.objectStoreNames.contains(this.STATIONS_STORE) ||
            !db.objectStoreNames.contains(this.TRIPS_STORE) ||
            !db.objectStoreNames.contains(this.STATUSES_STORE)
        ) {
            return;
        }

        if (Storage.get(this.MIGRATED_KEY) === 'true') {
            return;
        }

        try {
            const all = await this.getAll(true);
            if (!all || !all.length) {
                Storage.set(this.MIGRATED_KEY, 'true');
                return;
            }

            const tx = db.transaction([this.STATIONS_STORE, this.TRIPS_STORE, this.STATUSES_STORE], 'readwrite');
            const stnStore = tx.objectStore(this.STATIONS_STORE);
            const tripStore = tx.objectStore(this.TRIPS_STORE);
            const statusStore = tx.objectStore(this.STATUSES_STORE);

            for (const sess of all) {
                if (Array.isArray(sess.trips)) {
                    for (const trip of sess.trips) {
                        const norm = this.normalizeTrip(trip, sess.username);
                        if (norm) {
                            for (const stn of norm.stations) {
                                stnStore.put(stn);
                            }
                            if (norm.tripRun) {
                                tripStore.put(norm.tripRun);
                            }
                            if (norm.status) {
                                statusStore.put(norm.status);
                            }
                        }
                    }
                }
            }

            tx.oncomplete = () => {
                Storage.set(this.MIGRATED_KEY, 'true');
            };
        } catch (e) {
            console.warn('Background relational migration deferred:', e);
        }
    }
};
