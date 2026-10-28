/**
 * Centralized Storage Manager for Träwelling Maps
 *
 * Provides safe, typed access to localStorage, sessionStorage, and in-memory fallback
 * when browser storage APIs are restricted (e.g., Safari private mode, embedded iframes).
 */

export const STORAGE_KEYS = Object.freeze({
    TOKEN: 'tw_token',
    AUTH_METHOD: 'tw_auth_method',
    FETCH_STOPOVERS: 'tw_fetch_stopovers',
    FILTER_LEVEL: 'tw_filter_level',
    INCLUDE_NOTES: 'tw_include_notes',
    LAYER_ORDER: 'tw_layer_order',
    STUDIO_TABLE_MODE: 'tw_studio_table_mode',
    SESSIONS_META: 'tw_cached_sessions_meta',
    SESSIONS_DATA: 'tw_cached_sessions_data',
    OAUTH_VERIFIER: 'tw_oauth_verifier',
    OAUTH_STATE: 'tw_oauth_state'
});

const memoryStore = new Map();

function isStorageAvailable(type) {
    try {
        if (typeof window === 'undefined') return false;
        const storage = window[type];
        if (!storage) return false;
        const testKey = '__tw_test__';
        storage.setItem(testKey, '1');
        storage.removeItem(testKey);
        return true;
    } catch {
        return false;
    }
}

const hasLocalStorage = isStorageAvailable('localStorage');
const hasSessionStorage = isStorageAvailable('sessionStorage');

export const Storage = {
    /**
     * Get a string value from localStorage or memory fallback
     */
    get(key, fallback = null) {
        try {
            if (hasLocalStorage) {
                const val = window.localStorage.getItem(key);
                return val !== null ? val : fallback;
            }
        } catch {
            // Fallback to memory
        }
        return memoryStore.has(key) ? memoryStore.get(key) : fallback;
    },

    /**
     * Set a string value in localStorage or memory fallback
     */
    set(key, value) {
        const strVal = String(value);
        try {
            if (hasLocalStorage) {
                window.localStorage.setItem(key, strVal);
                return true;
            }
        } catch {
            // Storage quota exceeded or blocked
        }
        memoryStore.set(key, strVal);
        return true;
    },

    /**
     * Remove a key from localStorage and memory fallback
     */
    remove(key) {
        try {
            if (hasLocalStorage) {
                window.localStorage.removeItem(key);
            }
        } catch {}
        memoryStore.delete(key);
    },

    /**
     * Get a parsed JSON object from localStorage
     */
    getJSON(key, fallback = null) {
        const raw = this.get(key, null);
        if (raw === null) return fallback;
        try {
            return JSON.parse(raw);
        } catch {
            return fallback;
        }
    },

    /**
     * Set a serialized JSON object in localStorage
     */
    setJSON(key, value) {
        try {
            const raw = JSON.stringify(value);
            return this.set(key, raw);
        } catch {
            return false;
        }
    },

    /**
     * Get a string value from sessionStorage
     */
    getSession(key, fallback = null) {
        try {
            if (hasSessionStorage) {
                const val = window.sessionStorage.getItem(key);
                return val !== null ? val : fallback;
            }
        } catch {}
        return memoryStore.has(`session_${key}`) ? memoryStore.get(`session_${key}`) : fallback;
    },

    /**
     * Set a string value in sessionStorage
     */
    setSession(key, value) {
        const strVal = String(value);
        try {
            if (hasSessionStorage) {
                window.sessionStorage.setItem(key, strVal);
                return true;
            }
        } catch {}
        memoryStore.set(`session_${key}`, strVal);
        return true;
    },

    /**
     * Remove a key from sessionStorage
     */
    removeSession(key) {
        try {
            if (hasSessionStorage) {
                window.sessionStorage.removeItem(key);
            }
        } catch {}
        memoryStore.delete(`session_${key}`);
    }
};
