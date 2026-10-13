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

function measureFeatureDistance(feature, lngLat, clickPoint = null) {
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
    let winner = null;
    let bestDistance = Infinity;
    features.forEach((feature) => {
        const distance = measureFeatureDistance(feature, lngLat, clickPoint);
        if (distance < bestDistance) {
            bestDistance = distance;
            winner = feature;
        }
    });
    return winner || features[0];
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
    const getActiveLayers = () => CONFIG.LAYER_CONFIG
        .map(([id]) => id)
        .filter(id => state.map.getLayer(id));
    
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
        const feature = pickClosestFeature(features, e.lngLat, e.point) || features[0];
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
    const departureLabel = actualDeparture || plannedDeparture;
    const arrivalLabel = actualArrival || plannedArrival;
    const durationDisplay = formatDuration(durationActual || durationPlanned);

    const rawCategory = normalizeCategory(props.category || train.category || feature.layer?.id);
    const category = CATEGORY_NAMES[rawCategory] || rawCategory || 'Unknown';

    highlightRoute(feature, statusId);

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

    const body = props.body ? escapeHtml(props.body.trim()) : '';

    // Extract deduplicated buddies for the popup
    const popupBuddies = [];
    let bodyMentions = props.bodyMentions;
    if (typeof bodyMentions === 'string') {
        try { bodyMentions = JSON.parse(bodyMentions); } catch (e) { bodyMentions = []; }
    }
    if (Array.isArray(bodyMentions)) {
        bodyMentions.forEach(m => {
            const u = m.user?.username || m.username;
            if (u && !popupBuddies.some(b => b.toLowerCase() === u.toLowerCase())) {
                popupBuddies.push(u);
            }
        });
    }

    let createdBy = props.createdBy;
    if (typeof createdBy === 'string') {
        try { createdBy = JSON.parse(createdBy); } catch (e) { createdBy = null; }
    }
    const createdByUsername = createdBy?.username;
    if (createdByUsername && !popupBuddies.some(b => b.toLowerCase() === createdByUsername.toLowerCase())) {
        popupBuddies.push(createdByUsername);
    }

    let mentionsHtml = '';
    if (popupBuddies.length > 0) {
        const buddyLinks = popupBuddies.map(u => `<a href="https://traewelling.de/@${escapeHtml(u)}" target="_blank" class="mention-link">@${escapeHtml(u)}</a>`);
        mentionsHtml = `
            <div class="popup-mentions">
                <label>Travel Buddies:</label>
                <span>${buddyLinks.join(' ')}</span>
            </div>
        `;
    }

    let commentHtml = '';
    if (body || mentionsHtml) {
        commentHtml = `
            <div class="popup-comment">
                ${body ? `
                    <details class="popup-comment-details">
                        <summary class="popup-comment-summary">
                            <span>💬 Check-in Note</span>
                            <span class="popup-comment-toggle">▾</span>
                        </summary>
                        <div class="popup-comment-content">
                            <p>${body}</p>
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
        // Resolve original trip object from store for complete metadata
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

    const html = `<div class="popup-content">
        <div class="popup-title">
            <span class="popup-badge">${category}</span>
            <span>${lineName}</span>
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
            <button type="button" class="meta-item meta-toggle-btn" id="popupMetaToggle" title="Show operator & platform details" aria-expanded="false">
                <label>Details</label>
                <span class="meta-toggle-text">more…</span>
            </button>
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

        const metaToggle = popupEl.querySelector('#popupMetaToggle');
        const metaContainer = popupEl.querySelector('#popupMeta');
        if (metaToggle && metaContainer) {
            metaToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                const isExpanded = metaContainer.classList.toggle('expanded');
                metaToggle.setAttribute('aria-expanded', String(isExpanded));
                const toggleText = metaToggle.querySelector('.meta-toggle-text');
                if (toggleText) {
                    toggleText.textContent = isExpanded ? 'less…' : 'more…';
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
    if (state.map?.getLayer('route-highlight')) {
        state.map.removeLayer('route-highlight');
    }
    if (state.map?.getLayer('route-highlight-glow')) {
        state.map.removeLayer('route-highlight-glow');
    }
    if (state.map?.getSource('route-highlight')) {
        state.map.removeSource('route-highlight');
    }
    if (state.useDeckGL && state.deck) {
        state.deckLayers = state.deckLayers.filter(l => l.id !== 'deck-route-highlight');
        if (state.deck.setProps) {
            state.deck.setProps({ layers: state.deckLayers });
        }
    }
}
