// Delay Overlay module
import { store } from '../state/store.js';
import { refreshActiveTrips } from '../fetch/orchestrator.js';
import * as dataProcessing from '../data/processing.js';
import * as time from '../utils/time.js';
import * as color from '../utils/color.js';
import * as math from '../utils/math.js';
import * as format from '../utils/format.js';
import { findOverlayFeatureAtPoint } from './interactions.js';
import { updateRouteDensity, toggleHeatmap, applyBaseLayerOpacity, setBaseLayerVisibility } from './heatmap.js';

export function toggleDelayOverlay(enabled) {
    const state = store.get();
    state.delays.enabled = enabled;
    if (enabled) {
        // Disable heatmap if enabled (mutual exclusion)
        if (state.heatmap.enabled) {
            document.getElementById('heatmapToggle').checked = false;
            toggleHeatmap(false);
        }
        applyBaseLayerOpacity(0.25);
        updateDelayOverlay(true);
    } else {
        applyBaseLayerOpacity(0.8);
        removeDelayOverlay();
        if (!state.heatmap.enabled) {
            setBaseLayerVisibility(true);
        }
    }
    updateDelayOverlaySummary();
}

export function removeDelayOverlay() {
    const state = store.get();
    if (state.useDeckGL) {
        state.deckLayers = state.deckLayers.filter(l => !l.id.startsWith(state.delays.layerId));
        if (state.deck?.setProps) state.deck.setProps({ layers: state.deckLayers });
    }
    state.delays.lastStats = null;
    state.delays.overlayFeatureCollection = null;
    state.delays.overlayLookup = new Map();
}

export function buildDelayOverlayCache(force = false) {
    const state = store.get();
    const cacheKey = [
        state.datasetVersion,
        state.filters.filterLevel,
        state.filters.fromDate || 'null',
        state.filters.toDate || 'null'
    ].join('|');

    if (!force && state.delays.cache && state.delays.cacheKey === cacheKey) {
        return state.delays.cache;
    }

    const trips = state.activeTrips?.length ? state.activeTrips : refreshActiveTrips();
    if (!Array.isArray(trips) || !trips.length) {
        state.delays.cache = [];
        state.delays.cacheKey = cacheKey;
        return state.delays.cache;
    }

    const results = [];
    trips.forEach(trip => {
        const train = trip.train || {};
        const coords = train.polyline?.geometry?.coordinates;
        if (!coords || coords.length < 2) return;
        const category = train.category || 'unknown';

        const delays = time.deriveDelaySeconds(train);
        if (delays.worst === null || delays.worst <= 0) return;

        const layerInfo = state.layers.data.get(category);
        if (layerInfo && layerInfo.visible === false) return;

        results.push({
            statusId: trip.id,
            lineName: train.lineName || train.number || 'Unknown',
            category,
            delaySeconds: delays.worst,
            coordinates: coords,
            train,
            body: trip.body || null,
            createdAt: trip.createdAt || null
        });
    });

    results.sort((a, b) => b.delaySeconds - a.delaySeconds);
    state.delays.cache = results;
    state.delays.cacheKey = cacheKey;
    return state.delays.cache;
}

export function updateDelayOverlay(force = false) {
    const state = store.get();
    if (!state.delays.enabled) {
        removeDelayOverlay();
        updateDelayOverlaySummary();
        return;
    }
    if (!state.useDeckGL) {
        console.warn('Delay overlay requires Deck.GL support.');
        updateDelayOverlaySummary();
        return;
    }

    const delayData = buildDelayOverlayCache(force);
    const minDelaySeconds = (state.delays.minDelayMinutes || 0) * 60;
    const filtered = delayData.filter(item => item.delaySeconds >= minDelaySeconds);
    const selected = filtered.slice(0, state.delays.topCount || 10);

    if (!selected.length) {
        removeDelayOverlay();
        state.delays.lastStats = { count: 0, minDelay: state.delays.minDelayMinutes };
        updateDelayOverlaySummary();
        return;
    }

    const featureCollection = buildDelayOverlayFeatureCollection(selected);

    const overlayLayer = new deck.GeoJsonLayer({
        id: state.delays.layerId,
        data: featureCollection,
        stroked: true,
        filled: false,
        lineJointRounded: true,
        lineCapRounded: true,
        pickable: false,
        parameters: { depthTest: false },
        getLineColor: f => color.getDelayColor(f.properties.delayMinutes, 200),
        getLineWidth: f => Math.max(2, math.getDelayWidth(f.properties.delayMinutes) * 0.6),
        lineWidthUnits: 'pixels',
        lineWidthMinPixels: 1.5
    });

    state.deckLayers = state.deckLayers.filter(l => !l.id.startsWith(state.delays.layerId));
    state.deckLayers.push(overlayLayer);
    if (state.deck?.setProps) state.deck.setProps({ layers: state.deckLayers });

    state.delays.lastStats = {
        count: featureCollection.features.length,
        minDelay: state.delays.minDelayMinutes,
        worstDelayMinutes: featureCollection.features.length
            ? featureCollection.features[featureCollection.features.length - 1].properties.delayMinutes
            : null,
        worstLine: selected[0]?.lineName
    };
    updateDelayOverlaySummary();
}

export function buildDelayOverlayFeatureCollection(selectedRoutes) {
    const state = store.get();
    const lookup = new Map();
    const ordered = selectedRoutes.slice().reverse(); // draw lower delays first so highest stays on top
    const features = ordered.map((item, index) => {
        const properties = {
            statusId: item.statusId,
            lineName: item.lineName,
            category: item.category,
            delaySeconds: item.delaySeconds,
            delayMinutes: format.formatDelayMinutes(item.delaySeconds),
            order: index
        };
        const feature = {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: item.coordinates },
            properties
        };
        lookup.set(item.statusId, { ...item, feature });
        return feature;
    });
    state.delays.overlayFeatureCollection = { type: 'FeatureCollection', features };
    state.delays.overlayLookup = lookup;
    return state.delays.overlayFeatureCollection;
}

export function updateDelayOverlaySummary() {
    const state = store.get();
    const summaryEl = document.getElementById('delayOverlaySummary');
    if (!summaryEl) return;

    if (!state.delays.enabled) {
        summaryEl.textContent = 'Disabled';
        return;
    }

    const stats = state.delays.lastStats;
    if (!stats || !stats.count) {
        summaryEl.innerHTML = `<span class="delay-summary-line">No trips exceed ${state.delays.minDelayMinutes} min.</span>`;
        return;
    }

    summaryEl.innerHTML = `
        <span class="delay-summary-line">Worst: ${stats.worstDelayMinutes} min (${stats.worstLine}).</span>
    `;
}

export function updateHeatmapColors() {
    const state = store.get();
    if (!state.heatmap.overlayFeatureCollection || !state.useDeckGL) return;
    updateRouteDensity(false);
}

export function getPixelRadiusKm(lngLat, pixelRadius = 20) {
    const state = store.get();
    const zoom = state.map?.getZoom?.() ?? 6;
    const lat = Math.max(-89, Math.min(89, lngLat?.lat ?? 0));
    const metersPerPixel = 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoom);
    const km = (metersPerPixel * pixelRadius) / 1000;
    return Math.max(0.03, Math.min(1.5, km));
}

export function getDelayOverlayFeatureAtLngLat(lngLat) {
    const state = store.get();
    return findOverlayFeatureAtPoint(
        state.delays.overlayFeatureCollection,
        lngLat,
        { priorityAccessor: feature => feature.properties?.delaySeconds || 0 }
    );
}

export function buildFeatureFromDelayOverlay(feature) {
    const state = store.get();
    if (!feature?.properties?.statusId) return null;
    const metadata = state.delays.overlayLookup.get(feature.properties.statusId);
    if (!metadata) return null;
    return {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: metadata.coordinates },
        properties: {
            statusId: metadata.statusId,
            train: metadata.train,
            body: metadata.body,
            createdAt: metadata.createdAt
        },
        layer: { id: metadata.category }
    };
}

export function invalidateDelayOverlayCache() {
    const state = store.get();
    state.delays.cache = null;
    state.delays.cacheKey = null;
    state.delays.overlayFeatureCollection = null;
    state.delays.overlayLookup = new Map();
}
