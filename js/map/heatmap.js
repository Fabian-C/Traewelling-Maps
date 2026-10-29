// Map and heatmap functions
import { store } from '../state/store.js';
import { toggleDelayOverlay } from './delayOverlay.js';
import { RouteAnimation } from './routeAnimation.js';
import { refreshActiveTrips } from '../fetch/orchestrator.js';
import { normalizeCategory } from '../data/processing.js';
import { clearRouteHighlight } from './interactions.js';

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
        const approxId = `${id}-approximated`;
        if (state.map?.getLayer(approxId)) {
            try {
                state.map.setPaintProperty(approxId, 'line-opacity', opacity * 0.85);
            } catch (error) {
                console.warn(`Failed to set opacity for ${approxId}:`, error);
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
        const approxId = `${id}-approximated`;
        if (state.map.getLayer(approxId)) {
            state.map.setLayoutProperty(approxId, 'visibility', (visible && layer.visible) ? 'visible' : 'none');
        }
    });
}

export function getDensityColor(featureOrDensity, maybeIntensity = null) {
    const state = store.get();
    let density = 1;
    const intensity = maybeIntensity !== null ? maybeIntensity : (state.heatmap.intensity || 1);
    
    if (typeof featureOrDensity === 'number') {
        density = featureOrDensity;
    } else if (featureOrDensity?.properties?.density) {
        density = featureOrDensity.properties.density;
    } else if (featureOrDensity?.density) {
        density = featureOrDensity.density;
    }
    
    // Non-linear intensity scaling: fine granularity at low levels, sharper steps at high levels
    // Uses combination of linear and quadratic: intensity + (intensity^2 / 14) for 1-14 range
    // Maintains same behavior as original 1-10 with additional steps 11-14
    const intensityFactor = intensity + (intensity * intensity / 14);
    const normalizedDensity = (density * 6) / intensityFactor;
    
    return [
        Math.min(255, normalizedDensity * 25),
        Math.min(255, 128 * (1 - normalizedDensity * 0.15)),
        Math.min(255, 255 * (1 - normalizedDensity * 0.15)),
        160
    ];
}

export function getDensityWidth() {
    return 3;
}

export function toggleHeatmap(enabled) {
    clearRouteHighlight();
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
            if (layer.visible && state.map?.getLayer(id)) {
                state.map.setLayoutProperty(id, 'visibility', 'visible');
            }
            const approxId = `${id}-approximated`;
            if (layer.visible && state.map?.getLayer(approxId)) {
                state.map.setLayoutProperty(approxId, 'visibility', 'visible');
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
    const lines = buildRouteDensityLines(state, force);
    if (!lines?.length) {
        removeRouteDensityOverlay();
        return;
    }
    const hasLayer = state.deckLayers.some(l => l.id === state.heatmap.layerId);
    if (!force && hasLayer && state.heatmap.appliedCacheKey === state.heatmap.cacheKey) {
        return;
    }
    RouteAnimation.invalidateCache();
    state.heatmap.appliedCacheKey = state.heatmap.cacheKey;
    const overlayLayer = new deck.LineLayer({
        id: state.heatmap.layerId,
        data: lines,
        getSourcePosition: d => d.source,
        getTargetPosition: d => d.target,
        getColor: d => d.color,
        getWidth: () => getDensityWidth(),
        widthUnits: 'pixels',
        widthMinPixels: 1.5,
        parameters: { depthTest: false },
        pickable: false
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
    clearRouteHighlight();
    const state = store.get();
    state.deckLayers = state.deckLayers.filter(l => l.id !== state.heatmap.layerId);
    if (state.deck?.setProps) state.deck.setProps({ layers: state.deckLayers });
    state.heatmap.lineData = null;
    state.heatmap.appliedCacheKey = null;
    state.heatmap.overlayFeatureCollection = null;
    state.heatmap.overlayLookup = new Map();
}

export function buildRouteDensityLines(state, force = false) {
    if (!state.heatmap.enabled || !state.useDeckGL) return null;
    
    const cacheKey = [
        state.datasetVersion,
        state.heatmap.intensity,
        state.heatmap.densityRadius,
        state.filters.filterLevel,
        state.filters.fromDate || 'null',
        state.filters.toDate || 'null',
        (state.filters.buddies || []).join(','),
        state.filters.buddy || 'null',
        state.filters.business ? `${state.filters.business.personal ? 1 : 0}${state.filters.business.work ? 1 : 0}${state.filters.business.commute ? 1 : 0}` : '111',
        state.filters.searchQuery || 'null'
    ].join('|');

    if (!force && state.heatmap.lineData && state.heatmap.cacheKey === cacheKey) {
        return state.heatmap.lineData;
    }

    const trips = state.activeTrips?.length ? state.activeTrips : refreshActiveTrips();
    if (!Array.isArray(trips) || !trips.length) {
        state.heatmap.lineData = [];
        state.heatmap.overlayFeatureCollection = { type: 'FeatureCollection', features: [] };
        state.heatmap.cacheKey = cacheKey;
        return state.heatmap.lineData;
    }

    const segmentMap = new Map();
    const roundVal = (v) => Math.round(v * 1e5);
    
    for (let t = 0; t < trips.length; t++) {
        const trip = trips[t];
        const train = trip.train || trip.checkin || trip.properties?.train || trip.properties?.checkin || {};
        const coords = train.polyline?.geometry?.coordinates;
        if (!coords || coords.length < 2) continue;

        const layerId = trip._index?.category || normalizeCategory(train.category);
        const layerInfo = state.layers.data.get(layerId);
        if (layerInfo && layerInfo.visible === false) continue;

        const tripSegments = new Set();

        for (let i = 0; i < coords.length - 1; i++) {
            const p1 = coords[i];
            const p2 = coords[i + 1];
            const x1 = roundVal(p1[0]), y1 = roundVal(p1[1]);
            const x2 = roundVal(p2[0]), y2 = roundVal(p2[1]);

            if (x1 === x2 && y1 === y2) continue;

            let k1x = x1, k1y = y1, k2x = x2, k2y = y2;
            if (k1x > k2x || (k1x === k2x && k1y > k2y)) {
                k1x = x2; k1y = y2; k2x = x1; k2y = y1;
            }

            const segKey = `${k1x},${k1y}:${k2x},${k2y}`;
            if (!tripSegments.has(segKey)) {
                tripSegments.add(segKey);
                const existing = segmentMap.get(segKey);
                if (existing) {
                    existing.count++;
                } else {
                    segmentMap.set(segKey, {
                        source: [k1x / 1e5, k1y / 1e5],
                        target: [k2x / 1e5, k2y / 1e5],
                        count: 1
                    });
                }
            }
        }
    }

    const lines = [];
    const intensity = state.heatmap.intensity || 1;
    segmentMap.forEach(item => {
        lines.push({
            source: item.source,
            target: item.target,
            density: item.count,
            color: getDensityColor(item.count, intensity)
        });
    });

    lines.sort((a, b) => a.density - b.density);

    state.heatmap.lineData = lines;
    state.heatmap.overlayFeatureCollection = {
        type: 'FeatureCollection',
        features: lines
    };
    state.heatmap.cacheKey = cacheKey;
    return lines;
}

export function buildRouteDensityFeatureCollection(state, force = false) {
    buildRouteDensityLines(state, force);
    return state.heatmap.overlayFeatureCollection;
}
