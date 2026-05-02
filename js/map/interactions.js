// Map interactions module
import { CONFIG } from '../config/config.js';
import { store } from '../state/store.js';
import { RouteAnimation } from './routeAnimation.js';
import { getTapTolerancePx, snapLngLatToLine, computeRouteLengthKm } from '../utils/geometry.js';
import { getDelayColor } from '../utils/color.js';
import { getDelayWidth } from '../utils/math.js';
import { getPixelRadiusKm } from './delayOverlay.js';
import { getDelayOverlayFeatureAtLngLat, buildFeatureFromDelayOverlay } from './delayOverlay.js';
import { setupEventListeners } from '../events/listeners.js';
import { updateRouteDensity } from './heatmap.js';

export function initMap() {
    const state = store.get();
    mapboxgl.accessToken = CONFIG.MAPBOX_TOKEN;
    const isMobile = window.innerWidth <= 768;
    state.map = new mapboxgl.Map({
        container: 'map', style: 'mapbox://styles/mapbox/dark-v10',
        center: [10.4515, 51.1657], zoom: isMobile ? 5 : 6, pitch: isMobile ? 0 : 15,
        attributionControl: false, fadeDuration: 0, antialias: true, renderWorldCopies: false,
        // Mobile-specific optimizations
        touchZoomRotate: true,
        touchPitch: false,
        dragRotate: !isMobile,
        maxZoom: 20,
        // Ensure proper rendering on mobile
        preserveDrawingBuffer: isMobile
    });

    try {
        const gl2 = document.createElement('canvas').getContext('webgl2');
        if (!gl2) throw new Error('No WebGL2');
        state.deck = new deck.MapboxOverlay({ interleaved: false, layers: [] });
        state.map.addControl(state.deck);
        state.useDeckGL = true;
    } catch (e) { state.useDeckGL = false; }

    state.map.on('style.load', () => { state.map.setFog({ 'high-color': 'rgb(36, 92, 223)', 'horizon-blend': 0.4 }); });
    state.map.on('load', () => {
        // Add a small delay for mobile to ensure proper loading
        const addLayersDelay = RouteAnimation.isMobile() ? 100 : 0;
        
        setTimeout(() => {
            try {
                state.map.addLayer({
                    id: 'open-railway-map', type: 'raster',
                    source: { type: 'raster', tiles: ['https://a.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png'], tileSize: 256 },
                    layout: { visibility: state.railway.enabled ? 'visible' : 'none' }, paint: { 'raster-opacity': 0.15 }, minzoom: 0, maxzoom: 22
                });
            } catch (e) {
                console.warn('Failed to add open railway map layer:', e);
            }
        }, addLayersDelay);
        
        // Update heatmap on map move - longer debounce on mobile
        let heatmapUpdateTimeout = null;
        const debounceTime = RouteAnimation.isMobile() ? 400 : 200;
        
        state.map.on('moveend', () => {
            if (state.heatmap.enabled) {
                if (heatmapUpdateTimeout) {
                    clearTimeout(heatmapUpdateTimeout);
                    heatmapUpdateTimeout = null;
                }
                
                heatmapUpdateTimeout = setTimeout(() => {
                    try {
                        updateRouteDensity();
                    } catch (error) {
                        console.error('Error updating heatmap on move:', error);
                    }
                }, debounceTime);
            }
        });
    });
    setupEventListeners();
}

export function fitMapToData() {
    const state = store.get();
    const bounds = new mapboxgl.LngLatBounds();
    let hasPoints = false;
    state.layers.data.forEach(layer => {
        if (!layer.visible) return;
        layer.data.features.forEach(f => {
            f.geometry?.coordinates?.forEach(c => { if (c?.length >= 2) { bounds.extend(c); hasPoints = true; } });
        });
    });
    if (hasPoints) state.map.fitBounds(bounds, { padding: 50, maxZoom: 12 });
}

export function waitForMapReady(timeoutMs = 4000) {
    const state = store.get();
    if (!state.map || typeof state.map.isStyleLoaded !== 'function') return Promise.resolve();
    if (state.map.isStyleLoaded()) return Promise.resolve();
    
    return new Promise((resolve) => {
        let resolved = false;
        const cleanup = () => {
            if (state.map?.off && handler) state.map.off('load', handler);
            resolved = true;
            if (timeout) clearTimeout(timeout);
        };
        const handler = () => {
            cleanup();
            resolve();
        };
        const timeout = setTimeout(() => {
            if (!resolved) {
                cleanup();
                resolve();
            }
        }, timeoutMs);
        
        if (state.map?.on) {
            state.map.on('load', handler);
        } else {
            resolve();
        }
    });
}

function queryLayersNearPoint(point, layers, tolerance = 10) {
    const state = window.state;
    if (!state.map || !point || !layers?.length) return [];
    const clamped = Math.max(2, Math.min(50, tolerance));
    const bounds = [
        [point.x - clamped, point.y - clamped],
        [point.x + clamped, point.y + clamped]
    ];
    try {
        return state.map.queryRenderedFeatures(bounds, { layers }) || [];
    } catch (error) {
        console.warn('Failed to query features with tolerance:', error);
        return [];
    }
}

function measureFeatureDistance(feature, lngLat) {
    if (!feature || !lngLat || !window.turf) return Infinity;
    try {
        const point = turf.point([lngLat.lng, lngLat.lat]);
        const geom = feature.geometry;
        if (geom?.type === 'LineString' && Array.isArray(geom.coordinates)) {
            const line = turf.lineString(geom.coordinates);
            return turf.pointToLineDistance(point, line, { units: 'kilometers' });
        }
        if (geom?.type === 'Point') {
            const target = turf.point(geom.coordinates);
            return turf.distance(point, target, { units: 'kilometers' });
        }
        if (geom) {
            const centroid = turf.center(feature);
            if (centroid?.geometry?.coordinates) {
                const target = turf.point(centroid.geometry.coordinates);
                return turf.distance(point, target, { units: 'kilometers' });
            }
        }
    } catch (error) {
        console.warn('Failed to measure feature distance:', error);
    }
    return Infinity;
}

function pickClosestFeature(features, lngLat) {
    if (!Array.isArray(features) || !features.length) return null;
    let winner = null;
    let bestDistance = Infinity;
    features.forEach((feature) => {
        const distance = measureFeatureDistance(feature, lngLat);
        if (distance < bestDistance) {
            bestDistance = distance;
            winner = feature;
        }
    });
    return winner || features[0];
}

export function findOverlayFeatureAtPoint(featureCollection, lngLat, options = {}) {
    if (!featureCollection?.features?.length || !window.turf) return null;
    const point = turf.point([lngLat.lng, lngLat.lat]);
    const tapTolerancePx = options.maxDistancePx ?? getTapTolerancePx();
    const distanceThreshold = getPixelRadiusKm(lngLat, tapTolerancePx);
    let bestFeature = null;
    let bestPriority = -Infinity;
    let bestDistance = Infinity;
    const getPriority = typeof options.priorityAccessor === 'function'
        ? options.priorityAccessor
        : () => 0;
    featureCollection.features.forEach((feature) => {
        try {
            const distance = turf.pointToLineDistance(point, feature, { units: 'kilometers' });
            if (distance <= distanceThreshold) {
                const priorityValue = Number(getPriority(feature)) || 0;
                if (
                    priorityValue > bestPriority ||
                    (priorityValue === bestPriority && distance < bestDistance)
                ) {
                    bestPriority = priorityValue;
                    bestDistance = distance;
                    bestFeature = feature;
                }
            }
        } catch (error) {
            console.warn('Failed to evaluate overlay feature distance:', error);
        }
    });
    return bestFeature;
}

export function setupMapInteractions() {
    const state = store.get();
    const getActiveLayers = () => CONFIG.LAYER_CONFIG
        .map(([id]) => id)
        .filter(id => state.map.getLayer(id));
    
    const handleMapTap = (e) => {
        const now = Date.now();
        if (state.isMapMoving || (now - state.lastMoveEndTime < 300)) {
            return;
        }

        if (state.delays.enabled) {
            const overlayFeature = getDelayOverlayFeatureAtLngLat(e.lngLat);
            if (overlayFeature) {
                const synthetic = buildFeatureFromDelayOverlay(overlayFeature);
                if (synthetic) {
                    showPopup(e.lngLat, synthetic);
                    return;
                }
            }
            return;
        }

        const layers = getActiveLayers();
        if (!layers.length) return;
        
        const tolerance = getTapTolerancePx();
        let features = state.map.queryRenderedFeatures(e.point, { layers });
        if (!features.length) {
            features = queryLayersNearPoint(e.point, layers, tolerance);
        }
        if (features.length) {
            const lineFeatures = features.filter(f => f.layer?.type === 'line');
            if (lineFeatures.length) {
                features = lineFeatures;
            }
        }
        if (!features.length) return;
        const feature = pickClosestFeature(features, e.lngLat) || features[0];
        const snapped = snapLngLatToLine(e.lngLat, feature);
        const anchor = snapped || e.lngLat;
        showPopup(anchor, feature);
    };

    state.map.on('click', handleMapTap);
    state.map.on('movestart', () => { state.isMapMoving = true; });
    state.map.on('moveend', () => { 
        state.isMapMoving = false; 
        state.lastMoveEndTime = Date.now();
        if (state.heatmap.enabled) setTimeout(() => updateRouteDensity(), 200); 
    });

    state.map.on('touchend', (e) => {
        if (e.points && e.points[0]) {
            handleMapTap({ point: e.points[0], lngLat: e.lngLat });
        }
    });
}

export function showPopup(lngLat, feature) {
    const state = store.get();
    if (state.currentPopup) state.currentPopup.remove();
    clearRouteHighlight();
    
    const props = feature.properties || {};
    let train = props.train;
    if (typeof train === 'string') try { train = JSON.parse(train); } catch (e) { train = {}; }
    train = train || {};

    const statusId = props.statusId || 'unknown';
    const lineName = train.lineName || train.number || 'Unknown';
    const originData = train.origin || {};
    const destData = train.destination || {};
    const origin = originData.name || 'Unknown';
    const dest = destData.name || 'Unknown';
    const distance = Math.round((train.distance || 0) / 10) / 100;

    const getDate = (value) => value ? new Date(value) : null;
    const plannedDeparture = getDate(originData.departurePlanned || train.plannedDeparture);
    const actualDeparture = getDate(originData.departureReal || originData.departure || train.departure);
    const plannedArrival = getDate(destData.arrivalPlanned || train.plannedArrival);
    const actualArrival = getDate(destData.arrivalReal || destData.arrival || train.arrival);
    const derivedDepartureDelay = (plannedDeparture && actualDeparture) ? Math.round((actualDeparture - plannedDeparture) / 1000) : null;
    const derivedArrivalDelay = (plannedArrival && actualArrival) ? Math.round((actualArrival - plannedArrival) / 1000) : null;
    const departureDelay = typeof train.departureDelay === 'number' ? train.departureDelay : derivedDepartureDelay;
    const arrivalDelay = typeof train.arrivalDelay === 'number' ? train.arrivalDelay : derivedArrivalDelay;
    const platform = originData.departurePlatformReal || originData.platform || train.platform || train.track;
    const seat = train.seat?.number || null;
    const wagon = train.seat?.wagon || train.wagon;
    const travelClass = train.class || train.travelClass;
    const coachPosition = train.coaches || null;
    const shareUrl = statusId !== 'unknown' ? `https://traewelling.de/status/${statusId}` : null;
    const operator = train.operator?.name || train.operator?.identifier || train.provider?.name || train.provider || '—';

    const formatTime = (dateObj) => dateObj ? dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
    const formatDate = (dateObj) => dateObj ? dateObj.toLocaleDateString() : '';
    const formatDelay = (value) => {
        if (value === null || value === undefined) return '—';
        if (value === 0) return 'On time';
        const minutes = Math.round(value / 60);
        return `${minutes > 0 ? '+' : ''}${minutes} min`;
    };
    const formatDuration = (minutes) => {
        if (minutes === null || minutes === undefined) return '—';
        const hrs = Math.floor(minutes / 60);
        const mins = minutes % 60;
        if (hrs <= 0) return `${mins} min`;
        if (mins === 0) return `${hrs} h`;
        return `${hrs} h ${mins} min`;
    };
    const durationProvided = typeof train.duration === 'number' ? train.duration : null;
    const durationPlanned = (plannedDeparture && plannedArrival) ? Math.round((plannedArrival - plannedDeparture) / 60000) : null;
    const durationActual = (actualDeparture && actualArrival) ? Math.round((actualArrival - actualDeparture) / 60000) : durationProvided;
    const departureLabel = actualDeparture || plannedDeparture;
    const arrivalLabel = actualArrival || plannedArrival;
    const durationDisplay = formatDuration(durationActual || durationPlanned);

    const category = feature.layer?.id || 'Unknown';

    highlightRoute(feature, statusId);

    const buildTimestampBlock = (primary, fallback) => {
        const dateObj = primary || fallback;
        if (!dateObj) return `<span>—</span>`;
        return `<span>${formatTime(dateObj)}</span><span>${formatDate(dateObj)}</span>`;
    };
    const departureTimestamp = buildTimestampBlock(actualDeparture, plannedDeparture);
    const arrivalTimestamp = buildTimestampBlock(actualArrival, plannedArrival);

    const timingDetails = `
        <details>
            <summary class="popup-expander-summary">
                <span>Timing & delays</span>
                <span>${formatDelay(departureDelay)} / ${formatDelay(arrivalDelay)}</span>
            </summary>
            <div class="popup-body popup-scrollable">
                <dl>
                    <dt>Planned departure</dt>
                    <dd class="popup-detail-value">
                        <span>${formatTime(plannedDeparture)}</span>
                        <span>${formatDate(plannedDeparture)}</span>
                    </dd>
                    <dt>Actual departure</dt>
                    <dd class="popup-detail-value">
                        <span>${formatTime(actualDeparture)}</span>
                        <span>${formatDate(actualDeparture)}</span>
                    </dd>
                    <dt>Departure delay</dt>
                    <dd class="popup-detail-value">
                        <span>${formatDelay(departureDelay)}</span>
                    </dd>
                    <dt>Planned arrival</dt>
                    <dd class="popup-detail-value">
                        <span>${formatTime(plannedArrival)}</span>
                        <span>${formatDate(plannedArrival)}</span>
                    </dd>
                    <dt>Actual arrival</dt>
                    <dd class="popup-detail-value">
                        <span>${formatTime(actualArrival)}</span>
                        <span>${formatDate(actualArrival)}</span>
                    </dd>
                    <dt>Arrival delay</dt>
                    <dd class="popup-detail-value">
                        <span>${formatDelay(arrivalDelay)}</span>
                    </dd>
                </dl>
            </div>
        </details>
    `;

    const seatDetails = (seat || wagon || travelClass || coachPosition) ? `
        <details>
            <summary>Seat & coach info</summary>
            <div class="popup-body">
                <dl>
                    <dt>Seat</dt><dd>${seat || '—'}</dd>
                    <dt>Coach / Wagon</dt><dd>${wagon || '—'}</dd>
                    <dt>Class</dt><dd>${travelClass || '—'}</dd>
                    <dt>Coach position</dt><dd>${coachPosition || '—'}</dd>
                </dl>
            </div>
        </details>
    ` : '';

    const html = `<div class="popup-content">
        <div class="popup-title">
            <span class="popup-badge">${category}</span>
            <span>${lineName}</span>
        </div>
        <div class="popup-route">
            <div class="popup-stop">
                <label>Origin</label>
                <strong>${origin}</strong>
                <div class="popup-stop-time">
                    ${departureTimestamp}
                </div>
            </div>
            <div class="popup-arrow">→</div>
            <div class="popup-stop">
                <label>Destination</label>
                <strong>${dest}</strong>
                <div class="popup-stop-time">
                    ${arrivalTimestamp}
                </div>
            </div>
        </div>
        <div class="popup-meta">
            <div>
                <label>Distance</label>
                <span>${distance} km</span>
            </div>
            <div>
                <label>Operator</label>
                <span>${operator || '—'}</span>
            </div>
            <div>
                <label>Duration</label>
                <span>${durationDisplay}</span>
            </div>
            <div>
                <label>Platform</label>
                <span>${platform || '—'}</span>
            </div>
        </div>
        ${timingDetails}
        ${seatDetails}
        ${shareUrl ? `<div class="popup-actions"><a class="primary" href="${shareUrl}" target="_blank">View on Träwelling</a></div>` : ''}
    </div>`;

    state.currentPopup = new mapboxgl.Popup({ className: 'route-popup', closeButton: true, closeOnClick: true })
        .setLngLat(lngLat).setHTML(html).addTo(state.map);
    
    const popupEl = state.currentPopup.getElement();
    if (popupEl) {
        popupEl.style.zIndex = '9999';
        const closeBtn = popupEl.querySelector('.mapboxgl-popup-close-button');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                state.preserveHighlightOnPopupClose = true;
            }, { capture: true });
        }
    }
    
    state.currentPopup.on('close', () => {
        const preserveHighlight = state.preserveHighlightOnPopupClose;
        state.preserveHighlightOnPopupClose = false;
        if (!preserveHighlight) {
            clearRouteHighlight();
        }
    });
}

export function highlightRoute(feature, statusId) {
    const state = store.get();
    let coordinates = null;
    
    if (statusId && statusId !== 'unknown') {
        const trip = state.fetchedTrips?.find(t => t.id === parseInt(statusId) || t.id === statusId);
        if (trip?.train?.polyline?.geometry?.coordinates) {
            coordinates = trip.train.polyline.geometry.coordinates;
        }
    }
    
    if (!coordinates && feature.geometry?.coordinates) {
        coordinates = feature.geometry.coordinates;
    }
    
    if (!coordinates || coordinates.length < 2) return;
    
    const highlightData = {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates }
    };
    
    if (state.map.getLayer('route-highlight')) {
        state.map.removeLayer('route-highlight');
    }
    if (state.map.getLayer('route-highlight-glow')) {
        state.map.removeLayer('route-highlight-glow');
    }
    if (state.map.getSource('route-highlight')) {
        state.map.removeSource('route-highlight');
    }
    
    state.map.addSource('route-highlight', { type: 'geojson', data: highlightData });
    
    const layers = state.map.getStyle().layers;
    let topLayer = null;
    for (let i = layers.length - 1; i >= 0; i--) {
        if (layers[i].type === 'line' && layers[i].id !== 'route-highlight' && layers[i].id !== 'route-highlight-glow') {
            topLayer = layers[i].id;
            break;
        }
    }
    
    if (!topLayer) {
        topLayer = layers.length > 0 ? layers[layers.length - 1].id : null;
    }
    
    state.map.addLayer({
        id: 'route-highlight-glow',
        type: 'line',
        source: 'route-highlight',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
            'line-color': '#ffffff',
            'line-width': 12,
            'line-opacity': 0.4,
            'line-blur': 3
        }
    }, topLayer);
    
    state.map.addLayer({
        id: 'route-highlight',
        type: 'line',
        source: 'route-highlight',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
            'line-color': '#ffff00',
            'line-width': 5,
            'line-opacity': 1
        }
    });
}

export function clearRouteHighlight() {
    const state = store.get();
    if (state.map?.getLayer('route-highlight')) {
        state.map.removeLayer('route-highlight');
    }
    if (state.map?.getLayer('route-highlight-glow')) {
        state.map.removeLayer('route-highlight-glow');
    }
    if (state.map?.getSource('route-highlight')) {
        state.map.removeSource('route-highlight');
    }
}
