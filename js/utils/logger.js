/**
 * Application Logger
 *
 * Provides leveled logging (debug, info, warn, error) with configurable verbosity.
 * Automatically activates DEBUG level when ?debug=1 is in the URL or tw_debug is set in storage.
 */

export const LOG_LEVELS = Object.freeze({
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    SILENT: 4
});

let currentLevel = LOG_LEVELS.INFO;

// Check for debug query param or stored preference if in browser environment
try {
    if (typeof window !== 'undefined' && window.location) {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('debug') === '1' || urlParams.get('debug') === 'true') {
            currentLevel = LOG_LEVELS.DEBUG;
        } else if (window.localStorage && window.localStorage.getItem('tw_debug') === '1') {
            currentLevel = LOG_LEVELS.DEBUG;
        }
    }
} catch {}

export const logger = {
    setLevel(level) {
        if (typeof level === 'number' && level >= 0 && level <= 4) {
            currentLevel = level;
        }
    },

    getLevel() {
        return currentLevel;
    },

    debug(...args) {
        if (currentLevel <= LOG_LEVELS.DEBUG) {
            console.debug('[TraewellingMaps:DEBUG]', ...args);
        }
    },

    info(...args) {
        if (currentLevel <= LOG_LEVELS.INFO) {
            console.log('[TraewellingMaps:INFO]', ...args);
        }
    },

    warn(...args) {
        if (currentLevel <= LOG_LEVELS.WARN) {
            console.warn('[TraewellingMaps:WARN]', ...args);
        }
    },

    error(...args) {
        if (currentLevel <= LOG_LEVELS.ERROR) {
            console.error('[TraewellingMaps:ERROR]', ...args);
        }
    }
};
