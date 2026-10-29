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
import { escapeHtml } from '../utils/format.js';
import { CATEGORY_NAMES } from './layers.js';
import { normalizeCategory, extractTripTags, getTripSearchMatchReason } from '../data/processing.js';

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
        // Ensure proper rendering and canvas screenshots on all devices
        preserveDrawingBuffer: true
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

function extendBoundsRecursively(coords, bounds) {
    if (!Array.isArray(coords) || !coords.length) return false;
    if (typeof coords[0] === 'number' && typeof coords[1] === 'number' && !isNaN(coords[0]) && !isNaN(coords[1])) {
        bounds.extend([coords[0], coords[1]]);
        return true;
    }
    let extended = false;
    for (let i = 0; i < coords.length; i++) {
        if (extendBoundsRecursively(coords[i], bounds)) extended = true;
    }
    return extended;
}

export function fitMapToData(force = false) {
    if (!force && typeof window !== 'undefined' && window.location.hash?.startsWith('#map=')) {
        return;
    }
    const state = store.get();
    if (!state.map) return;
    const bounds = new mapboxgl.LngLatBounds();
    let hasPoints = false;
    state.layers.data.forEach(layer => {
        if (!layer.visible || !layer.data?.features) return;
        layer.data.features.forEach(f => {
            if (f.geometry?.coordinates) {
                if (extendBoundsRecursively(f.geometry.coordinates, bounds)) {
                    hasPoints = true;
                }
            }
        });
    });
    if (hasPoints && !bounds.isEmpty()) {
        try {
            state.map.fitBounds(bounds, { padding: 50, maxZoom: 14 });
        } catch (e) {
            console.warn('fitBounds error:', e);
        }
    }
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
    const state = store.get();
    if (!state?.map || !point || !layers?.length) return [];
    const clamped = Math.max(2, Math.min(80, tolerance));
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

export function measureFeatureDistance(feature, lngLat, clickPoint = null) {
    if (!feature) return Infinity;
    const state = store.get();
    const geom = feature.geometry;

    // Prefer screen-space pixel distance if map.project and clickPoint are available
    if (state.map?.project && clickPoint && geom?.type === 'LineString' && Array.isArray(geom.coordinates)) {
        let minPixelDist = Infinity;
        const coords = geom.coordinates;
        for (let i = 0; i < coords.length - 1; i++) {
            const p1 = state.map.project(coords[i]);
            const p2 = state.map.project(coords[i + 1]);
            const d = pointToSegmentDistancePx(clickPoint.x, clickPoint.y, p1.x, p1.y, p2.x, p2.y);
            if (d < minPixelDist) minPixelDist = d;
            if (minPixelDist <= 1) break;
        }
        return minPixelDist;
    }

    if (!lngLat || !window.turf) return Infinity;
    try {
        const point = turf.point([lngLat.lng, lngLat.lat]);
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

function pickClosestFeature(features, lngLat, clickPoint = null) {
    if (!Array.isArray(features) || !features.length) return null;
    const state = store.get();

    // If clickPoint is missing but lngLat and map.project are available, resolve screen-space point
    let resolvedClickPoint = clickPoint;
    if (!resolvedClickPoint && state.map?.project && lngLat) {
        try {
            resolvedClickPoint = state.map.project([lngLat.lng, lngLat.lat]);
        } catch (_) {}
    }

    const layerOrder = Array.isArray(state?.layers?.order) ? state.layers.order : [];

    // Calculate distance and visual layer rank for each candidate feature
    const scored = features.map((feature) => {
        const distance = measureFeatureDistance(feature, lngLat, resolvedClickPoint);
        const rawLayerId = (feature.layer?.id || feature.properties?.category || feature.properties?.layerId || '').toString();
        const layerId = rawLayerId.replace('-approximated', '');
        const rankIndex = layerOrder.indexOf(layerId);
        // Rank 0 is top of the visual stack (rendered topmost); unranked layers fall to the bottom (999)
        const rank = rankIndex !== -1 ? rankIndex : 999;
        return { feature, distance, rank };
    });

    // Find the minimum distance among all candidates
    let minDistance = Infinity;
    scored.forEach(item => {
        if (item.distance < minDistance) minDistance = item.distance;
    });

    if (!Number.isFinite(minDistance)) {
        return features[0];
    }

    // Visual overlap threshold in pixels (or km if screen projection is unavailable):
    // Lines within 6 pixels of each other visually appear overlapping/on the same corridor.
    // In this overlap zone, the higher visible layer in state.layers.order takes priority.
    const visualOverlapThreshold = resolvedClickPoint ? 6.0 : 0.05;

    // Filter to candidates that are within the visual overlap window of the closest line
    const nearCandidates = scored.filter(item => item.distance <= minDistance + visualOverlapThreshold);

    // Sort: 1) Lowest rank (topmost visible layer in menu/canvas), 2) Smallest distance
    nearCandidates.sort((a, b) => {
        if (a.rank !== b.rank) {
            return a.rank - b.rank; // Topmost visible layer wins
        }
        return a.distance - b.distance; // If same layer, closer line wins
    });

    return nearCandidates[0]?.feature || scored[0]?.feature || features[0];
}

function pointToSegmentDistancePx(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - x1, py - y1);
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function findOverlayFeatureAtPoint(featureCollection, lngLat, options = {}) {
    if (!featureCollection?.features?.length) return null;
    const state = store.get();
    const tapTolerancePx = options.maxDistancePx ?? getTapTolerancePx();
    const distanceThreshold = getPixelRadiusKm(lngLat, tapTolerancePx);
    let bestFeature = null;
    let bestPriority = -Infinity;
    let bestDistance = Infinity;
    const getPriority = typeof options.priorityAccessor === 'function'
        ? options.priorityAccessor
        : () => 0;

    const clickPoint = state.map?.project ? state.map.project([lngLat.lng, lngLat.lat]) : null;

    featureCollection.features.forEach((feature) => {
        try {
            let distance = Infinity;
            if (clickPoint && feature.geometry?.coordinates?.length) {
                const coords = feature.geometry.coordinates;
                for (let i = 0; i < coords.length - 1; i++) {
                    const p1 = state.map.project(coords[i]);
                    const p2 = state.map.project(coords[i + 1]);
                    const d = pointToSegmentDistancePx(clickPoint.x, clickPoint.y, p1.x, p1.y, p2.x, p2.y);
                    if (d < distance) distance = d;
                    if (distance <= 2) break;
                }
                if (distance <= tapTolerancePx) {
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
            } else if (window.turf) {
                const point = turf.point([lngLat.lng, lngLat.lat]);
                const kmDistance = turf.pointToLineDistance(point, feature, { units: 'kilometers' });
                if (kmDistance <= distanceThreshold) {
                    const priorityValue = Number(getPriority(feature)) || 0;
                    if (
                        priorityValue > bestPriority ||
                        (priorityValue === bestPriority && kmDistance < bestDistance)
                    ) {
                        bestPriority = priorityValue;
                        bestDistance = kmDistance;
                        bestFeature = feature;
                    }
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
    const getActiveLayers = () => {
        const layers = [];
        CONFIG.LAYER_CONFIG.forEach(([id]) => {
            if (state.map.getLayer(id)) layers.push(id);
            const approxId = `${id}-approximated`;
            if (state.map.getLayer(approxId) && state.map.getLayoutProperty(approxId, 'visibility') !== 'none') {
                layers.push(approxId);
            }
        });
        return layers;
    };
    
    let lastTapTimestamp = 0;
    const handleMapTap = (e) => {
        const now = Date.now();
        if (state.isMapMoving || (now - state.lastMoveEndTime < 300) || (now - lastTapTimestamp < 350)) {
            return;
        }
        lastTapTimestamp = now;

        if (state.delays.enabled) {
            const touchTolerance = ('ontouchstart' in window || navigator.maxTouchPoints > 0) ? 44 : 32;
            const overlayFeature = getDelayOverlayFeatureAtLngLat(e.lngLat, { maxDistancePx: touchTolerance });
            if (overlayFeature) {
                const synthetic = buildFeatureFromDelayOverlay(overlayFeature);
                if (synthetic) {
                    const snapped = snapLngLatToLine(e.lngLat, synthetic);
                    showPopup(snapped || e.lngLat, synthetic);
                    return;
                }
            }
            // If delay overlay not hit, continue falling through to regular layers
        }

        const layers = getActiveLayers();
        if (!layers.length) return;
        
        const currentZoom = state.map?.getZoom?.() ?? null;
        const tolerance = getTapTolerancePx(currentZoom);
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

        // Deduplicate distinct check-ins intersecting the tap area
        const seenStatusIds = new Set();
        const candidateFeatures = [];
        for (const feat of features) {
            const sid = feat.properties?.statusId || feat.id;
            if (sid && !seenStatusIds.has(sid)) {
                seenStatusIds.add(sid);
                candidateFeatures.push(feat);
            } else if (!sid) {
                candidateFeatures.push(feat);
            }
        }

        const initialFeature = pickClosestFeature(candidateFeatures, e.lngLat, e.point) || candidateFeatures[0];
        const snapped = snapLngLatToLine(e.lngLat, initialFeature);
        const anchor = snapped || e.lngLat;

        // User requirement: Cycling must ONLY cycle through check-ins on top of each other
        // or maximum really close within a few meters (<= 20 meters), strictly excluding anything 50+ meters away.
        const MAX_STACK_DISTANCE_KM = 0.020; // 20 meters maximum
        const tightStack = [];
        const seenIds = new Set();

        const initialId = initialFeature?.properties?.statusId || initialFeature?.id;
        if (initialId) seenIds.add(initialId);
        tightStack.push(initialFeature);

        for (const feat of candidateFeatures) {
            const sid = feat.properties?.statusId || feat.id;
            if (sid && seenIds.has(sid)) continue;

            const distKm = measureFeatureDistance(feat, anchor, null);
            // Must be within 20 meters of the clicked anchor point to be considered stacked
            if (distKm <= MAX_STACK_DISTANCE_KM) {
                if (sid) seenIds.add(sid);
                tightStack.push(feat);
            }
        }

        const featureStack = tightStack.length > 1 ? tightStack : null;
        showPopup(anchor, initialFeature, { stack: featureStack, stackIndex: 0 });
    };

    state.map.on('click', handleMapTap);
    state.map.on('movestart', () => { state.isMapMoving = true; });
    state.map.on('moveend', () => { 
        state.isMapMoving = false; 
        state.lastMoveEndTime = Date.now();
        if (state.heatmap.enabled) setTimeout(() => updateRouteDensity(), 200); 
    });
}

export function showPopup(lngLat, feature, { stack = null, stackIndex = 0 } = {}) {
    const state = store.get();
    if (state.currentPopup) state.currentPopup.remove();
    clearRouteHighlight();

    const activeStatusId = feature?.properties?.statusId || 'unknown';
    highlightRoute(feature, activeStatusId);

    const isStacked = Boolean(stack && stack.length > 1);

    const buildFeaturePopupHtml = (targetFeature, idx) => {
        const props = targetFeature?.properties || {};
        let train = props.train || props.checkin;
        if (typeof train === 'string') try { train = JSON.parse(train); } catch (e) { train = {}; }
        train = train || {};

        const statusId = props.statusId || 'unknown';
        const lineName = train.lineName || train.number || train.name || 'Unknown';
        const originData = train.origin || {};
        const destData = train.destination || {};
        const origin = originData.name || 'Unknown';
        const dest = destData.name || 'Unknown';
        const rawDistance = typeof train.totalDistance === 'number' ? train.totalDistance : (train.distance || 0);
        const distance = Math.round(rawDistance / 10) / 100;

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
        let seat = props.seat || train.seat?.number || (typeof train.seat === 'string' || typeof train.seat === 'number' ? train.seat : null) || null;
        let wagon = props.wagon || train.seat?.wagon || train.wagon || train.coach || null;
        let travelClass = props.travelClass || props.class || train.class || train.travelClass || null;
        let vehicleNumber = props.vehicleNumber || null;
        let locomotiveClass = props.locomotiveClass || null;
        let wagonClass = props.wagonClass || null;
        const coachPosition = train.coaches || null;
        const shareUrl = statusId !== 'unknown' ? `https://traewelling.de/status/${statusId}` : null;
        const animUrl = (statusId && statusId !== 'unknown')
            ? `animation.html?trip=${encodeURIComponent(statusId)}${state.username ? `&user=${encodeURIComponent(state.username)}` : ''}`
            : null;
        const operator = train.operator?.name || train.operator?.identifier || train.provider?.name || train.provider || '—';

        let ticketName = typeof props.ticket === 'string' ? props.ticket : (props.ticket?.name || props.ticket?.title || props.ticket?.identifier || null);
        if (!ticketName && train.ticket) {
            ticketName = typeof train.ticket === 'string' ? train.ticket : (train.ticket.name || train.ticket.title || null);
        }

        const parsedTags = extractTripTags(props).concat(extractTripTags({ tags: train.tags }));
        const customTags = [];
        const seenTagKeys = new Set();

        parsedTags.forEach(t => {
            const k = (t.key || '').toLowerCase();
            const v = String(t.value || '').trim();
            if (!v && !k) return;

            if (k === 'trwl:wagon' || k === 'wagon') {
                if (!wagon) wagon = v;
            } else if (k === 'trwl:seat' || k === 'seat') {
                if (!seat) seat = v;
            } else if (k === 'trwl:ticket' || k === 'ticket') {
                if (!ticketName) ticketName = v;
            } else if (k === 'trwl:travel_class' || k === 'travel_class') {
                if (!travelClass) travelClass = v;
            } else if (k === 'trwl:vehicle_number' || k === 'vehicle_number') {
                if (!vehicleNumber) vehicleNumber = v;
            } else if (k === 'trwl:locomotive_class' || k === 'locomotive_class') {
                if (!locomotiveClass) locomotiveClass = v;
            } else if (k === 'trwl:wagon_class' || k === 'wagon_class') {
                if (!wagonClass) wagonClass = v;
            } else {
                const cleanKey = t.key.replace(/^trwl:/, '');
                const dedupeKey = `${cleanKey}:${v}`.toLowerCase();
                if (!seenTagKeys.has(dedupeKey)) {
                    seenTagKeys.add(dedupeKey);
                    customTags.push({ key: cleanKey, value: v });
                }
            }
        });

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
        const durationProvided = typeof train.totalDuration === 'number' ? train.totalDuration : (typeof train.duration === 'number' ? train.duration : null);
        const durationPlanned = (plannedDeparture && plannedArrival) ? Math.round((plannedArrival - plannedDeparture) / 60000) : null;
        const durationActual = (actualDeparture && actualArrival) ? Math.round((actualArrival - actualDeparture) / 60000) : durationProvided;
        const durationDisplay = formatDuration(durationActual || durationPlanned);

        const isApproximated = Boolean(props.isApproximated || targetFeature?.layer?.id?.endsWith('-approximated'));

        const rawCategory = normalizeCategory(props.category || train.category || targetFeature?.layer?.id?.replace('-approximated', ''));
        const category = CATEGORY_NAMES[rawCategory] || rawCategory || 'Unknown';

        const buildTimestampBlock = (primary, fallback) => {
            const dateObj = primary || fallback;
            if (!dateObj) return `<span>—</span>`;
            return `<span>${formatTime(dateObj)}</span><span>${formatDate(dateObj)}</span>`;
        };
        const departureTimestamp = buildTimestampBlock(actualDeparture, plannedDeparture);
        const arrivalTimestamp = buildTimestampBlock(actualArrival, plannedArrival);

        const timingDetails = `
            <details class="popup-timing-details">
                <summary class="popup-expander-summary">
                    <span class="popup-summary-title">⏱️ Schedule & Delays</span>
                    <span class="popup-delay-summary-pill">
                        ${departureDelay !== null ? `<span class="delay-tag ${departureDelay > 0 ? 'delay-late' : (departureDelay < 0 ? 'delay-early' : 'delay-ok')}">Dep ${formatDelay(departureDelay)}</span>` : ''}
                        ${arrivalDelay !== null ? `<span class="delay-tag ${arrivalDelay > 0 ? 'delay-late' : (arrivalDelay < 0 ? 'delay-early' : 'delay-ok')}">Arr ${formatDelay(arrivalDelay)}</span>` : ''}
                    </span>
                </summary>
                <div class="popup-body">
                    <div class="popup-sched-table">
                        <div class="sched-row sched-header">
                            <span>Event</span>
                            <span>Plan</span>
                            <span>Actual</span>
                            <span>Delay</span>
                        </div>
                        <div class="sched-row">
                            <span class="sched-label">Departure</span>
                            <span class="sched-time plan">${formatTime(plannedDeparture)}</span>
                            <span class="sched-time real">${formatTime(actualDeparture)}</span>
                            <span class="sched-delay ${departureDelay > 0 ? 'late' : (departureDelay < 0 ? 'early' : 'ok')}">${formatDelay(departureDelay)}</span>
                        </div>
                        <div class="sched-row">
                            <span class="sched-label">Arrival</span>
                            <span class="sched-time plan">${formatTime(plannedArrival)}</span>
                            <span class="sched-time real">${formatTime(actualArrival)}</span>
                            <span class="sched-delay ${arrivalDelay > 0 ? 'late' : (arrivalDelay < 0 ? 'early' : 'ok')}">${formatDelay(arrivalDelay)}</span>
                        </div>
                    </div>
                </div>
            </details>
        `;

        const customTagBadges = customTags.map(t => {
            const k = escapeHtml(t.key);
            const v = escapeHtml(t.value);
            if (!v || v.toLowerCase() === k.toLowerCase()) {
                return `<span class="popup-tag-badge">#${k}</span>`;
            }
            return `<span class="popup-tag-badge"><strong>${k}:</strong> ${v}</span>`;
        }).join(' ');

        const tagsDetails = (customTags && customTags.length > 0) ? `
            <details class="popup-tags-details">
                <summary class="popup-expander-summary">
                    <span class="popup-summary-title">🏷️ Tags (${customTags.length})</span>
                    <span class="popup-toggle-arrow">▾</span>
                </summary>
                <div class="popup-body">
                    <div class="popup-tags-container">
                        ${customTagBadges}
                    </div>
                </div>
            </details>
        ` : '';

        const seatDetails = (seat || wagon || travelClass || coachPosition || ticketName || vehicleNumber || locomotiveClass || wagonClass) ? `
            <details>
                <summary class="popup-expander-summary">
                    <span class="popup-summary-title">Seat, ticket & coach info</span>
                    <span class="popup-toggle-arrow">▾</span>
                </summary>
                <div class="popup-body">
                    <dl>
                        ${ticketName ? `<dt>Ticket</dt><dd>${escapeHtml(ticketName)}</dd>` : ''}
                        <dt>Seat</dt><dd>${escapeHtml(String(seat || '—'))}</dd>
                        <dt>Coach / Wagon</dt><dd>${escapeHtml(String(wagon || '—'))}</dd>
                        <dt>Class</dt><dd>${escapeHtml(String(travelClass || '—'))}</dd>
                        ${vehicleNumber ? `<dt>Vehicle / Unit</dt><dd>${escapeHtml(vehicleNumber)}</dd>` : ''}
                        ${locomotiveClass ? `<dt>Locomotive</dt><dd>${escapeHtml(locomotiveClass)}</dd>` : ''}
                        ${wagonClass ? `<dt>Wagon type</dt><dd>${escapeHtml(wagonClass)}</dd>` : ''}
                        <dt>Coach position</dt><dd>${escapeHtml(String(coachPosition || '—'))}</dd>
                    </dl>
                </div>
            </details>
        ` : '';

        const rawBody = (props.body || '').trim();
        const currentUsername = (state.username || '').toLowerCase().trim();

        const renderPopupLinkedComment = (text) => {
            if (!text) return '';
            const safe = escapeHtml(text);
            return safe.replace(/@([a-zA-Z0-9_\-\.]+)/g, (match, u) => {
                return `<a href="https://traewelling.de/profile/${encodeURIComponent(u)}" target="_blank" rel="noopener noreferrer" class="mention-link" title="Open @${u} on Träwelling">@${u}</a>`;
            });
        };

        const popupBuddiesMap = new Map();
        const addPopupBuddy = (u) => {
            if (!u || typeof u !== 'string') return;
            const clean = u.replace(/^@/, '').trim();
            if (!clean) return;
            const key = clean.toLowerCase();
            if (currentUsername && key === currentUsername) return;
            if (!popupBuddiesMap.has(key)) {
                popupBuddiesMap.set(key, clean);
            }
        };

        let bodyMentions = props.bodyMentions;
        if (typeof bodyMentions === 'string') {
            try { bodyMentions = JSON.parse(bodyMentions); } catch (e) { bodyMentions = []; }
        }
        if (Array.isArray(bodyMentions)) {
            bodyMentions.forEach(m => {
                const u = m.user?.username || m.username || m.name || (typeof m === 'string' ? m : null);
                addPopupBuddy(u);
            });
        }

        let companions = props.companions || props.buddies || props.fellowPassengers;
        if (typeof companions === 'string') {
            try { companions = JSON.parse(companions); } catch (e) { companions = []; }
        }
        if (Array.isArray(companions)) {
            companions.forEach(c => {
                const u = c.username || c.name || (typeof c === 'string' ? c : null);
                addPopupBuddy(u);
            });
        }

        let createdBy = props.createdBy;
        if (typeof createdBy === 'string') {
            try { createdBy = JSON.parse(createdBy); } catch (e) { createdBy = null; }
        }
        const createdByUsername = createdBy?.username || (typeof createdBy === 'string' ? createdBy : null);
        addPopupBuddy(createdByUsername);

        if (rawBody.includes('@')) {
            const matches = rawBody.match(/@([a-zA-Z0-9_\-\.]+)/g);
            if (matches) matches.forEach(m => addPopupBuddy(m));
        }

        const popupBuddies = Array.from(popupBuddiesMap.values());

        let mentionsHtml = '';
        if (popupBuddies.length > 0) {
            const buddyLinks = popupBuddies.map(u => 
                `<a href="https://traewelling.de/profile/${encodeURIComponent(u)}" target="_blank" rel="noopener noreferrer" class="mention-link" title="Open @${escapeHtml(u)} on Träwelling">@${escapeHtml(u)}</a>`
            );
            mentionsHtml = `
                <div class="popup-mentions">
                    <label>Travel Buddies:</label>
                    <span>${buddyLinks.join(' ')}</span>
                </div>
            `;
        }

        let commentHtml = '';
        if (rawBody || mentionsHtml) {
            commentHtml = `
                <div class="popup-comment">
                    ${rawBody ? `
                        <details class="popup-comment-details">
                            <summary class="popup-comment-summary">
                                <span>💬 Check-in Note</span>
                                <span class="popup-comment-toggle">▾</span>
                            </summary>
                            <div class="popup-comment-content">
                                <p>${renderPopupLinkedComment(rawBody)}</p>
                            </div>
                        </details>
                    ` : ''}
                    ${mentionsHtml}
                </div>
            `;
        }

        let matchBannerHtml = '';
        const activeSearchQuery = state.filters?.searchQuery?.trim();
        if (activeSearchQuery) {
            const fullTrip = (statusId !== 'unknown' && Array.isArray(state.fetchedTrips))
                ? state.fetchedTrips.find(t => String(t.id) === String(statusId))
                : null;
            const tripToEvaluate = fullTrip || { properties: props, train, body: props.body, ticket: props.ticket };
            const matchReasons = getTripSearchMatchReason(tripToEvaluate, activeSearchQuery);
            if (matchReasons.length > 0) {
                matchBannerHtml = `
                    <div class="popup-match-banner">
                        <div class="popup-match-title">
                            <span class="popup-match-icon">🔍</span>
                            <span>Matched search: <strong>"${escapeHtml(activeSearchQuery)}"</strong></span>
                        </div>
                        <ul class="popup-match-list">
                            ${matchReasons.map(r => `<li>${escapeHtml(r)}</li>`).join('')}
                        </ul>
                    </div>
                `;
            }
        }

        let stackNavHtml = '';
        if (isStacked) {
            const maxDots = 7;
            const dotsHtml = stack.length <= maxDots
                ? `<div class="stack-nav-dots" aria-hidden="true">${stack.map((_, dotIdx) => `<span class="stack-dot${dotIdx === idx ? ' active' : ''}" data-idx="${dotIdx}"></span>`).join('')}</div>`
                : '';
            stackNavHtml = `
                <div class="popup-stack-nav" role="toolbar" aria-label="Stacked check-ins navigation">
                    <button type="button" class="stack-nav-btn prev" id="stackNavPrevBtn" aria-label="Previous check-in" title="Previous check-in (Left Arrow or [)">◀</button>
                    <div class="stack-nav-info">
                        <div class="stack-nav-top-row">
                            <span class="stack-nav-badge">Stacked</span>
                            <span class="stack-nav-count">Trip <strong>${idx + 1}</strong> of <strong>${stack.length}</strong></span>
                        </div>
                        ${dotsHtml}
                    </div>
                    <button type="button" class="stack-nav-btn next" id="stackNavNextBtn" aria-label="Next check-in" title="Next check-in (Right Arrow or ])">▶</button>
                </div>
            `;
        }

        return `<div class="popup-content${isStacked ? ' is-stacked' : ''}">
            ${stackNavHtml}
            <div class="popup-title">
                <span class="popup-badge">${category}</span>
                <span>${lineName}</span>
                ${isApproximated ? `<span class="popup-approx-badge" title="Approximated track (straight-line fallback)"><span class="dashed-preview-pill"></span>Approx.</span>` : ''}
            </div>
            ${matchBannerHtml}
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
            <div class="popup-meta" id="popupMeta">
                <div class="meta-item">
                    <label>Distance</label>
                    <span>${distance} km</span>
                </div>
                <div class="meta-item">
                    <label>Duration</label>
                    <span>${durationDisplay}</span>
                </div>
                <div class="meta-item meta-toggle-btn" id="popupMetaToggle" role="button" tabindex="0" title="Show operator & platform details" aria-expanded="false">
                    <label>Details</label>
                    <span class="meta-toggle-text">more…</span>
                </div>
                <div class="meta-item meta-extra">
                    <label>Operator</label>
                    <span title="${escapeHtml(operator || '—')}">${operator || '—'}</span>
                </div>
                <div class="meta-item meta-extra">
                    <label>Platform</label>
                    <span>${platform || '—'}</span>
                </div>
            </div>
            ${commentHtml}
            ${timingDetails}
            ${seatDetails}
            ${tagsDetails}
            <div class="popup-actions">
                ${shareUrl ? `<a class="primary popup-traewelling-btn" href="${shareUrl}" target="_blank" rel="noopener noreferrer" title="Open check-in on Traewelling.de">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="margin-right: 3px; flex-shrink: 0;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                    <span>Träwelling</span>
                </a>` : ''}
                ${animUrl ? `<a class="popup-anim-btn" href="${animUrl}" target="_blank" rel="noopener noreferrer" title="Replay journey in Animation Studio (Alpha feature)">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="margin-right: 3px; flex-shrink: 0;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                    <span>Animate</span>
                    <span class="popup-alpha-badge">Alpha</span>
                </a>` : ''}
            </div>
        </div>`;
    };

    const html = buildFeaturePopupHtml(feature, stackIndex);

    // Anchor stacked popups at the top so the top navigation bar (◀ / ▶) stays pinned
    // at the exact same screen coordinate while the bottom of the popup resizes freely without a scrollbar.
    const popupOptions = {
        className: 'route-popup',
        closeButton: true,
        closeOnClick: true,
        ...(isStacked ? { anchor: 'top' } : {})
    };

    state.currentPopup = new mapboxgl.Popup(popupOptions)
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

        if (isStacked) {
            const prevBtn = popupEl.querySelector('#stackNavPrevBtn');
            const nextBtn = popupEl.querySelector('#stackNavNextBtn');

            const goToStackedIndex = (newIdx) => {
                const targetIdx = (newIdx + stack.length) % stack.length;
                const targetFeature = stack[targetIdx];
                const tripId = targetFeature?.properties?.statusId || targetFeature?.properties?.id;
                if (tripId) {
                    highlightRoute(targetFeature, tripId);
                }
                showPopup(lngLat, targetFeature, {
                    stack,
                    stackIndex: targetIdx
                });
            };

            if (prevBtn) {
                prevBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    goToStackedIndex(stackIndex - 1);
                });
            }
            if (nextBtn) {
                nextBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    goToStackedIndex(stackIndex + 1);
                });
            }

            popupEl.querySelectorAll('.stack-dot').forEach((dot) => {
                dot.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const idx = parseInt(dot.getAttribute('data-idx'), 10);
                    if (!Number.isNaN(idx) && idx !== stackIndex) {
                        goToStackedIndex(idx);
                    }
                });
            });

            // Touch swipe left/right to cycle through stacked check-ins
            let touchStartX = null;
            let touchStartY = null;
            popupEl.addEventListener('touchstart', (e) => {
                if (e.touches && e.touches.length === 1) {
                    touchStartX = e.touches[0].clientX;
                    touchStartY = e.touches[0].clientY;
                }
            }, { passive: true });

            popupEl.addEventListener('touchend', (e) => {
                if (touchStartX === null || touchStartY === null || !e.changedTouches || !e.changedTouches.length) return;
                const dx = e.changedTouches[0].clientX - touchStartX;
                const dy = e.changedTouches[0].clientY - touchStartY;
                touchStartX = null;
                touchStartY = null;
                if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.4) {
                    if (dx < 0) {
                        goToStackedIndex(stackIndex + 1);
                    } else {
                        goToStackedIndex(stackIndex - 1);
                    }
                }
            }, { passive: true });

            const handleStackKeyNav = (e) => {
                // Only handle if popup is currently open and not typing into an input
                if (document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
                if (e.key === 'ArrowLeft' || e.key === '[') {
                    e.preventDefault();
                    goToStackedIndex(stackIndex - 1);
                } else if (e.key === 'ArrowRight' || e.key === ']') {
                    e.preventDefault();
                    goToStackedIndex(stackIndex + 1);
                }
            };
            window.addEventListener('keydown', handleStackKeyNav);
            state.currentPopup.once('close', () => {
                window.removeEventListener('keydown', handleStackKeyNav);
            });
        }

        const metaToggle = popupEl.querySelector('#popupMetaToggle');
        const metaContainer = popupEl.querySelector('#popupMeta');
        if (metaToggle && metaContainer) {
            const toggleHandler = (e) => {
                e.stopPropagation();
                const isExpanded = metaContainer.classList.toggle('expanded');
                metaToggle.setAttribute('aria-expanded', String(isExpanded));
                const toggleText = metaToggle.querySelector('.meta-toggle-text');
                if (toggleText) {
                    toggleText.textContent = isExpanded ? 'less…' : 'more…';
                }
            };
            metaToggle.addEventListener('click', toggleHandler);
            metaToggle.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleHandler(e);
                }
            });
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
    if (!state.map) return;
    let coordinates = null;
    
    if (statusId && statusId !== 'unknown') {
        const trip = state.fetchedTrips?.find(t => t.id === parseInt(statusId) || t.id === statusId);
        const train = trip?.train || trip?.checkin;
        if (train?.polyline?.geometry?.coordinates) {
            coordinates = train.polyline.geometry.coordinates;
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
    
    const isApproximated = Boolean(feature?.properties?.isApproximated || feature?.layer?.id?.endsWith('-approximated'));

    state.map.addLayer({
        id: 'route-highlight-glow',
        type: 'line',
        source: 'route-highlight',
        layout: { 'line-join': 'round', 'line-cap': isApproximated ? 'butt' : 'round' },
        paint: {
            'line-color': '#ffffff',
            'line-width': 12,
            'line-opacity': 0.4,
            'line-blur': 3,
            ...(isApproximated ? { 'line-dasharray': [2, 2] } : {})
        }
    }, topLayer);
    
    state.map.addLayer({
        id: 'route-highlight',
        type: 'line',
        source: 'route-highlight',
        layout: { 'line-join': 'round', 'line-cap': isApproximated ? 'butt' : 'round' },
        paint: {
            'line-color': '#ffff00',
            'line-width': 5,
            'line-opacity': 1,
            ...(isApproximated ? { 'line-dasharray': [2, 2] } : {})
        }
    });

    if (state.useDeckGL && state.deck && window.deck?.GeoJsonLayer) {
        const deckHighlight = new deck.GeoJsonLayer({
            id: 'deck-route-highlight',
            data: highlightData,
            stroked: true,
            filled: false,
            lineJointRounded: true,
            lineCapRounded: true,
            parameters: { depthTest: false },
            getLineColor: [255, 255, 0, 255],
            getLineWidth: 6,
            lineWidthUnits: 'pixels',
            lineWidthMinPixels: 4
        });
        state.deckLayers = state.deckLayers.filter(l => l.id !== 'deck-route-highlight');
        state.deckLayers.push(deckHighlight);
        if (state.deck.setProps) {
            state.deck.setProps({ layers: state.deckLayers });
        }
    }
}

export function clearRouteHighlight() {
    const state = store.get();
    if (state.currentPopup) {
        const popup = state.currentPopup;
        state.currentPopup = null;
        try {
            popup.remove();
        } catch (_) {}
    }
    if (state.map) {
        try {
            if (state.map.getLayer('route-highlight')) {
                state.map.removeLayer('route-highlight');
            }
            if (state.map.getLayer('route-highlight-glow')) {
                state.map.removeLayer('route-highlight-glow');
            }
            if (state.map.getSource('route-highlight')) {
                state.map.removeSource('route-highlight');
            }
        } catch (_) {}
    }
    if (state.useDeckGL && state.deck) {
        state.deckLayers = (state.deckLayers || []).filter(l => l.id !== 'deck-route-highlight');
        if (state.deck.setProps) {
            try {
                state.deck.setProps({ layers: state.deckLayers });
            } catch (_) {}
        }
    }
}
