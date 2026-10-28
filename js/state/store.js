// State store with pub/sub pattern
import { Storage, STORAGE_KEYS } from '../storage/storage.js';

class StateStore {
    constructor() {
        this.state = null;
        this.listeners = new Map();
    }

    // Initialize the state with default values
    initialize(createEmptyStats) {
        const savedFilter = Storage.get(STORAGE_KEYS.FILTER_LEVEL);
        this.state = {
            map: null,
            deck: null,
            deckLayers: [],
            currentPopup: null,
            preserveHighlightOnPopupClose: false,
            isMapMoving: false,
            lastMoveEndTime: 0,
            token: null,
            authMethod: Storage.get(STORAGE_KEYS.AUTH_METHOD),
            username: null,
            datasetVersion: 0,
            fetchedTrips: [],
            activeTrips: [],
            filters: { 
                fromDate: null, 
                toDate: null, 
                searchQuery: '', 
                filterLevel: savedFilter !== null ? parseInt(savedFilter, 10) : 1,
                buddies: [],
                get buddy() { return this.buddies?.[0] || null; },
                set buddy(val) { this.buddies = val ? (Array.isArray(val) ? val : [val]) : []; },
                includeNoteMentions: Storage.get(STORAGE_KEYS.INCLUDE_NOTES) !== 'false',
                business: { personal: true, work: true, commute: true } 
            },
            railway: { enabled: false },
            heatmap: { 
                enabled: false, 
                animate: false, 
                animationFrameId: null, 
                intensity: 3, 
                cacheKey: null,
                needsRebuild: true,
                pendingColorFrame: null,
                overlayFeatureCollection: null,
                overlayLookup: new Map(),
                layerId: 'route-heatmap'
            },
            baseLayerOpacity: 0.8,
            delays: {
                enabled: false,
                topCount: 15,
                cache: null,
                cacheKey: null,
                layerId: 'delay-overlay',
                minDelayMinutes: 3,
                lastStats: null,
                overlayFeatureCollection: null,
                overlayLookup: new Map()
            },
            layers: { 
                data: new Map(), 
                order: [
                    'unknown',
                    'plane',
                    'ferry',
                    'taxi',
                    'bus',
                    'tram',
                    'subway',
                    'suburban',
                    'regional',
                    'regionalExp',
                    'national',
                    'nationalExpress'
                ]
            },
            statistics: createEmptyStats ? createEmptyStats() : {}
        };
        if (typeof window !== 'undefined') {
            window.state = this.state;
            window.store = this;
        }
        this.notify('initialize', this.state);
    }

    // Get the entire state
    get() {
        return this.state;
    }

    // Get a specific state property
    getProp(key) {
        return key.split('.').reduce((obj, k) => obj?.[k], this.state);
    }

    // Set a specific state property
    setProp(key, value) {
        const keys = key.split('.');
        const lastKey = keys.pop();
        const target = keys.reduce((obj, k) => obj?.[k], this.state);
        if (target) {
            target[lastKey] = value;
            this.notify(key, value);
        }
    }

    // Update multiple properties at once
    update(updates) {
        Object.entries(updates).forEach(([key, value]) => {
            this.setProp(key, value);
        });
    }

    // Subscribe to state changes
    subscribe(key, callback) {
        if (!this.listeners.has(key)) {
            this.listeners.set(key, new Set());
        }
        this.listeners.get(key).add(callback);

        // Return unsubscribe function
        return () => {
            this.listeners.get(key)?.delete(callback);
        };
    }

    // Notify listeners of state change
    notify(key, value) {
        const callbacks = this.listeners.get(key);
        if (callbacks) {
            callbacks.forEach(cb => cb(value, key));
        }
    }

    // Subscribe to all changes
    subscribeAll(callback) {
        return this.subscribe('*', callback);
    }
}

// Create singleton instance
const store = new StateStore();

// Export the store and a convenience function to initialize it
export { store };
export function initializeState(createEmptyStats) {
    store.initialize(createEmptyStats);
    return store;
}
