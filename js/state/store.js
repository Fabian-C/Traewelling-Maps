// State store with pub/sub pattern

class StateStore {
    constructor() {
        this.state = null;
        this.listeners = new Map();
    }

    // Initialize the state with default values
    initialize(createEmptyStats) {
        this.state = {
            map: null,
            deck: null,
            deckLayers: [],
            currentPopup: null,
            preserveHighlightOnPopupClose: false,
            isMapMoving: false,
            lastMoveEndTime: 0,
            token: null,
            username: null,
            datasetVersion: 0,
            fetchedTrips: [],
            activeTrips: [],
            filters: { fromDate: null, toDate: null, filterLevel: 1, business: { personal: true, work: true, commute: true } },
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
                    'bus',
                    'ship',
                    'tram',
                    'subway',
                    'suburban',
                    'regional',
                    'national',
                    'regionalExp',
                    'nationalExpress'
                ]
            },
            statistics: createEmptyStats()
        };
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
