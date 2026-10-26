// IndexedDB for session storage
import { CONFIG } from '../config/config.js';

export const SessionDB = {
    DB_NAME: 'TraewellingMap',
    STORE_NAME: 'sessions',
    STOPOVERS_STORE: 'stopovers',
    POLYLINES_STORE: 'polylines',
    META_CACHE_KEY: 'tw_cached_sessions_meta',
    VERSION: 3,
    MAX_SESSIONS: 15,
    _db: null,
    
    isExpired(session, now = Date.now()) {
        if (!session) return false;
        const maxAge = CONFIG.SESSION_MAX_AGE_MS;
        if (!maxAge) return false;
        if (!session.timestamp) return false;
        return now - session.timestamp > maxAge;
    },

    // Fast synchronous cache for instant UI rendering in setup menu
    getStoredMetadata() {
        try {
            const raw = localStorage.getItem(this.META_CACHE_KEY);
            if (!raw) return [];
            const list = JSON.parse(raw);
            const now = Date.now();
            return Array.isArray(list) ? list.filter(item => !this.isExpired(item, now)) : [];
        } catch (e) {
            return [];
        }
    },

    saveStoredMetadata(sessions = []) {
        try {
            const meta = sessions.map(s => ({
                username: s.username,
                displayName: s.displayName || s.username,
                avatar: s.avatar || null,
                tripCount: s.tripCount || (s.trips ? s.trips.length : 0),
                timestamp: s.timestamp || Date.now()
            }));
            localStorage.setItem(this.META_CACHE_KEY, JSON.stringify(meta));
        } catch (e) {
            console.warn('Failed to save session metadata cache:', e);
        }
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
            };
            
            req.onsuccess = () => {
                this._db = req.result;
                resolve(this._db);
            };
            
            req.onerror = () => reject(req.error);
        });
    },
    
    // Save a session (including trip data)
    async save(username, data, options = {}) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([this.STORE_NAME], 'readwrite');
            const store = tx.objectStore(this.STORE_NAME);
            
            const isArray = Array.isArray(data);
            const trips = isArray ? data : (data?.trips || null);
            const meta = isArray ? (options || {}) : (data || {});

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
            tx.oncomplete = () => {
                if (Array.isArray(trips)) {
                    const polyMap = {};
                    trips.forEach(t => {
                        if (t?.id && t.train?.polyline) {
                            polyMap[t.id] = t.train.polyline;
                        }
                    });
                    if (Object.keys(polyMap).length > 0) {
                        this.savePolylinesBatch(polyMap).catch(() => {});
                    }
                }
                this.prune(); // Clean old sessions
                this.getAll().then(all => this.saveStoredMetadata(all)).catch(() => {});
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
                    expiredUsernames.forEach(username => {
                        this.delete(username).catch(err => console.warn('Failed to delete expired session', username, err));
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
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([this.STORE_NAME], 'readonly');
            const req = tx.objectStore(this.STORE_NAME).get(username);
            req.onsuccess = () => {
                const session = req.result || null;
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
        const db = await this.open();
        // First retrieve session to find all trip status IDs for this user
        let tripIds = [];
        try {
            const existingSession = await this.get(username);
            if (existingSession?.trips && Array.isArray(existingSession.trips)) {
                tripIds = existingSession.trips.map(t => Number(t.id)).filter(Boolean);
            }
        } catch (e) {
            console.warn('Could not read existing trips before session delete:', e);
        }

        return new Promise((resolve, reject) => {
            const stores = [this.STORE_NAME];
            if (db.objectStoreNames.contains(this.POLYLINES_STORE)) stores.push(this.POLYLINES_STORE);
            if (db.objectStoreNames.contains(this.STOPOVERS_STORE)) stores.push(this.STOPOVERS_STORE);

            const tx = db.transaction(stores, 'readwrite');
            tx.objectStore(this.STORE_NAME).delete(username);

            if (tripIds.length > 0) {
                if (stores.includes(this.POLYLINES_STORE)) {
                    const polyStore = tx.objectStore(this.POLYLINES_STORE);
                    tripIds.forEach(id => polyStore.delete(id));
                }
                if (stores.includes(this.STOPOVERS_STORE)) {
                    const stopStore = tx.objectStore(this.STOPOVERS_STORE);
                    tripIds.forEach(id => stopStore.delete(id));
                }
            }

            tx.oncomplete = () => {
                try {
                    const existing = this.getStoredMetadata().filter(s => s.username !== username);
                    localStorage.setItem(this.META_CACHE_KEY, JSON.stringify(existing));
                } catch (e) {}
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

            const tx = db.transaction(stores, 'readwrite');
            stores.forEach(s => tx.objectStore(s).clear());
            tx.oncomplete = () => {
                try {
                    localStorage.removeItem(this.META_CACHE_KEY);
                } catch (e) {}
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

                statusIds.forEach(rawId => {
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
                keys.forEach(rawId => {
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

                statusIds.forEach(rawId => {
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
                keys.forEach(rawId => {
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
    }
};
