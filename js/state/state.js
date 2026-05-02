// State management module

export function initializeAppState() {
    if (!window.state) {
        window.state = {
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
            statistics: window.createEmptyStats()
        };
    }
}
