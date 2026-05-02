// Map and heatmap functions
import { store } from '../state/store.js';
import { toggleDelayOverlay } from './delayOverlay.js';
import { RouteAnimation } from './routeAnimation.js';
import { refreshActiveTrips } from '../fetch/orchestrator.js';

export function getCurrentBaseOpacity(state) {
    if (!state) state = store.get();
    return state.baseLayerOpacity || 0.8;
}

export function applyBaseLayerOpacity(opacity) {
    const state = store.get();
    state.baseLayerOpacity = opacity;
    state.layers.data.forEach((layer, id) => {
        // Only process actual layer entries (skip non-layer properties)
        if (!layer || !layer.data) return;
        if (state.map?.getLayer(id)) {
            try {
                state.map.setPaintProperty(id, 'line-opacity', opacity);
            } catch (error) {
                console.warn(`Failed to set opacity for ${id}:`, error);
            }
        }
    });
}

export function setBaseLayerVisibility(state, visible) {
    if (!state) state = store.get();
    if (!state.map) return;
    state.layers.data.forEach((layer, id) => {
        if (state.map.getLayer(id)) {
            state.map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
        }
    });
}

export function getDensityColor(feature) {
    const state = store.get();
    if (!feature?.properties?.density) return [100, 100, 100, 150];
    const density = feature.properties.density;
    const intensity = state.heatmap.intensity || 1;
    
    // Non-linear intensity scaling: fine granularity at low levels, sharper steps at high levels
    // Uses combination of linear and quadratic: intensity + (intensity^2 / 14) for 1-14 range
    // Maintains same behavior as original 1-10 with additional steps 11-14
    const intensityFactor = intensity + (intensity * intensity / 14);
    const normalizedDensity = (density * 6) / intensityFactor;
    
    return [
        Math.min(255, normalizedDensity * 25),
        Math.min(255, 128 * (1 - normalizedDensity * 0.15)),
        Math.min(255, 255 * (1 - normalizedDensity * 0.15)),
        150
    ];
}

export function getDensityWidth() {
    return 3;
}

export function toggleHeatmap(enabled) {
    const state = store.get();
    state.heatmap.enabled = enabled;
    if (enabled) {
        if (state.delays.enabled) {
            document.getElementById('delayOverlayToggle').checked = false;
            toggleDelayOverlay(false);
            setBaseLayerVisibility(state, false);
        }
        setBaseLayerVisibility(state, false);
        updateRouteDensity(true);
        // Check if animation toggle is checked
        const animateToggle = document.getElementById('animateToggle');
        if (animateToggle && animateToggle.checked) {
            RouteAnimation.start();
        }
    } else {
        // Restore Mapbox layers visibility
        state.layers.data.forEach((layer, id) => { 
            if (layer.visible) {
                state.map.setLayoutProperty(id, 'visibility', 'visible');
            }
        });
        applyBaseLayerOpacity(state.delays.enabled ? 0.25 : 0.8);
        RouteAnimation.stop();
        removeRouteDensityOverlay();
    }
}

export function updateRouteDensity(force = false) {
    const state = store.get();
    if (!state.heatmap.enabled || !state.useDeckGL) return;
    RouteAnimation.invalidateCache();
    const featureCollection = buildRouteDensityFeatureCollection(state, force);
    if (!featureCollection?.features?.length) {
        removeRouteDensityOverlay();
        return;
    }
    const overlayLayer = new deck.GeoJsonLayer({
        id: state.heatmap.layerId,
        data: featureCollection,
        stroked: true,
        filled: false,
        lineJointRounded: true,
        lineCapRounded: true,
        pickable: false,
        parameters: { depthTest: false },
        getLineColor: f => getDensityColor(f),
        getLineWidth: () => getDensityWidth(),
        lineWidthUnits: 'pixels',
        lineWidthMinPixels: 1.5
    });
    state.deckLayers = state.deckLayers.filter(l => l.id !== state.heatmap.layerId);
    const particleIndex = state.deckLayers.findIndex(l => l.id === 'animated-routes');
    if (particleIndex !== -1) {
        state.deckLayers.splice(particleIndex, 0, overlayLayer);
    } else {
        state.deckLayers.push(overlayLayer);
    }
    if (state.deck?.setProps) state.deck.setProps({ layers: state.deckLayers });
}

export function removeRouteDensityOverlay() {
    const state = store.get();
    state.deckLayers = state.deckLayers.filter(l => l.id !== state.heatmap.layerId);
    if (state.deck?.setProps) state.deck.setProps({ layers: state.deckLayers });
    state.heatmap.overlayFeatureCollection = null;
    state.heatmap.overlayLookup = new Map();
}

export function buildRouteDensityFeatureCollection(state, force = false) {
    if (!state.heatmap.enabled || !state.useDeckGL) return null;
    
    const cacheKey = [
        state.datasetVersion,
        state.heatmap.intensity,
        state.heatmap.densityRadius,
        state.filters.filterLevel,
        state.filters.fromDate || 'null',
        state.filters.toDate || 'null'
    ].join('|');

    if (!force && state.heatmap.overlayFeatureCollection && state.heatmap.cacheKey === cacheKey) {
        return state.heatmap.overlayFeatureCollection;
    }

    const trips = state.activeTrips?.length ? state.activeTrips : refreshActiveTrips();
    if (!Array.isArray(trips) || !trips.length) {
        state.heatmap.overlayFeatureCollection = null;
        state.heatmap.cacheKey = cacheKey;
        return state.heatmap.overlayFeatureCollection;
    }

    const segmentMap = new Map();
    // Round to 5 decimal places for precise segment matching
    const roundCoord = (value) => Math.round(value * 1e5) / 1e5;
    
    trips.forEach(trip => {
        const train = trip.train || {};
        const coords = train.polyline?.geometry?.coordinates;
        if (!coords || coords.length < 2) return;

        const layerId = train.category || 'unknown';
        const layerInfo = state.layers.data.get(layerId);
        if (layerInfo && layerInfo.visible === false) return;

        // Use a simpler Set-like approach with an object for better performance
        const tripSegments = Object.create(null);

        for (let i = 0; i < coords.length - 1; i++) {
            const x1 = coords[i][0], y1 = coords[i][1];
            const x2 = coords[i + 1][0], y2 = coords[i + 1][1];
            
            // Normalize direction
            const ax = x1, ay = y1, bx = x2, by = y2;
            let key;
            if (ax < bx || (ax === bx && ay <= by)) {
                key = `${ax},${ay}-${bx},${by}`;
            } else {
                key = `${bx},${by}-${ax},${ay}`;
            }
            
            // Only increment if this segment hasn't been counted for this trip yet
            if (!tripSegments[key]) {
                // Round coordinates for the actual segment map key
                const p1x = roundCoord(x1), p1y = roundCoord(y1);
                const p2x = roundCoord(x2), p2y = roundCoord(y2);
                const roundedKey = `${p1x},${p1y}-${p2x},${p2y}`;
                segmentMap.set(roundedKey, (segmentMap.get(roundedKey) || 0) + 1);
                tripSegments[key] = true;
            }
        }
    });

    const lineData = [];
    segmentMap.forEach((count, key) => {
        const [s, t] = key.split('-');
        lineData.push({ source: s.split(',').map(Number), target: t.split(',').map(Number), density: count });
    });

    const intensity = (state.heatmap.intensity * 3) / 4;
    const ordered = lineData.slice().sort((a, b) => a.density - b.density);
    const features = ordered.map((item, index) => ({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [item.source, item.target] },
        properties: {
            density: item.density,
            intensity: intensity,
            order: index
        }
    }));

    state.heatmap.overlayFeatureCollection = { type: 'FeatureCollection', features };
    state.heatmap.overlayLookup = new Map(features.map((feature, idx) => [idx, feature]));
    state.heatmap.cacheKey = cacheKey;
    return state.heatmap.overlayFeatureCollection;
}
