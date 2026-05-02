// IndexedDB for session storage

const CONFIG = {
    SESSION_MAX_AGE_MS: 1000 * 60 * 60 * 24 * 90, // 90 days
};

export const SessionDB = {
    DB_NAME: 'TraewellingMap',
    STORE_NAME: 'sessions',
    VERSION: 1,
    MAX_SESSIONS: 15,
    _db: null,
    
    isExpired(session, now = Date.now()) {
        if (!session) return false;
        const maxAge = CONFIG.SESSION_MAX_AGE_MS;
        if (!maxAge) return false;
        if (!session.timestamp) return true;
        return now - session.timestamp > maxAge;
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
            };
            
            req.onsuccess = () => {
                this._db = req.result;
                resolve(this._db);
            };
            
            req.onerror = () => reject(req.error);
        });
    },
    
    // Save a session (including trip data)
    async save(username, data) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([this.STORE_NAME], 'readwrite');
            const store = tx.objectStore(this.STORE_NAME);
            
            const session = {
                username: username,
                displayName: data.displayName || username,
                avatar: data.avatar || null,
                tripCount: data.tripCount || 0,
                token: data.token || null,
                trips: data.trips || null, // Store trip data for caching
                timestamp: data.timestamp !== undefined ? data.timestamp : Date.now()
            };
            
            store.put(session);
            tx.oncomplete = () => {
                this.prune(); // Clean old sessions
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
    
    // Delete a session
    async delete(username) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([this.STORE_NAME], 'readwrite');
            tx.objectStore(this.STORE_NAME).delete(username);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    },
    
    // Clear all sessions
    async clear() {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction([this.STORE_NAME], 'readwrite');
            tx.objectStore(this.STORE_NAME).clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
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
