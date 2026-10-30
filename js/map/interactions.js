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
import {
    extractTripDetails,
    formatTimeShort,
    formatDateShort,
    renderScheduleDetailsHTML,
    renderSeatAndVehicleDetailsHTML,
    renderTagsBadgesHTML,
    renderBuddiesBadgesHTML
} from '../ui/tripDetails.js';
import { renderLinkedComment } from '../trips/formatters.js';

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

    const turfLib = (typeof window !== 'undefined' && window.turf) ? window.turf : (typeof turf !== 'undefined' ? turf : null);
    if (!lngLat || !turfLib) return Infinity;
    try {
        const point = turfLib.point([lngLat.lng, lngLat.lat]);
        if (geom?.type === 'LineString' && Array.isArray(geom.coordinates)) {
            const line = turfLib.lineString(geom.coordinates);
            return turfLib.pointToLineDistance(point, line, { units: 'kilometers' });
        }
        if (geom?.type === 'Point') {
            const target = turfLib.point(geom.coordinates);
            return turfLib.distance(point, target, { units: 'kilometers' });
        }
        if (geom) {
            const centroid = turfLib.center(feature);
            if (centroid?.geometry?.coordinates) {
                const target = turfLib.point(centroid.geometry.coordinates);
                return turfLib.distance(point, target, { units: 'kilometers' });
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

        // Always query both the exact point and the visual tolerance bounding box around the click
        const pointFeatures = state.map.queryRenderedFeatures(e.point, { layers }) || [];
        const areaFeatures = queryLayersNearPoint(e.point, layers, tolerance) || [];
        const combined = [...pointFeatures, ...areaFeatures];
        if (!combined.length) return;

        let lineFeatures = combined.filter(f => f.layer?.type === 'line');
        let features = lineFeatures.length ? lineFeatures : combined;

        // Deduplicate distinct check-ins intersecting the tap area
        const seenStatusIds = new Set();
        const candidateFeatures = [];
        for (const feat of features) {
            const rawSid = feat.properties?.statusId ?? feat.id;
            const sidKey = rawSid !== undefined && rawSid !== null ? String(rawSid) : null;
            if (sidKey && !seenStatusIds.has(sidKey)) {
                seenStatusIds.add(sidKey);
                candidateFeatures.push(feat);
            } else if (!sidKey) {
                candidateFeatures.push(feat);
            }
        }
        if (!candidateFeatures.length) return;

        const initialFeature = pickClosestFeature(candidateFeatures, e.lngLat, e.point) || candidateFeatures[0];
        const snapped = snapLngLatToLine(e.lngLat, initialFeature);
        const anchor = snapped || e.lngLat;
        const initialId = String(initialFeature?.properties?.statusId ?? initialFeature?.id ?? '');

        // Stacking corridor: match rides along the actual transit line based on geographic proximity
        // to this transit line anchor (within sensible proximity: 80 meters)
        const MAX_LINE_STACK_DISTANCE_KM = 0.080; // 80 meters actual proximity along line
        const layerOrder = Array.isArray(state?.layers?.order) ? state.layers.order : [];
        const tightStack = [initialFeature];
        const seenStackIds = new Set();
        if (initialId) seenStackIds.add(initialId);

        const otherCandidates = [];
        for (const feat of candidateFeatures) {
            const sid = String(feat.properties?.statusId ?? feat.id ?? '');
            if (sid && seenStackIds.has(sid)) continue;

            const distKm = measureFeatureDistance(feat, anchor, null);
            if (distKm <= MAX_LINE_STACK_DISTANCE_KM) {
                const rawLayerId = (feat.layer?.id || feat.properties?.category || feat.properties?.layerId || '').toString();
                const layerId = rawLayerId.replace('-approximated', '');
                const rankIndex = layerOrder.indexOf(layerId);
                const rank = rankIndex !== -1 ? rankIndex : 999;
                otherCandidates.push({ feat, distKm, rank, sid });
            }
        }

        // Sort stacked candidates: 1) Topmost visible layer, 2) Proximity to line anchor
        otherCandidates.sort((a, b) => {
            if (a.rank !== b.rank) return a.rank - b.rank;
            return a.distKm - b.distKm;
        });

        for (const item of otherCandidates) {
            if (item.sid) seenStackIds.add(item.sid);
            tightStack.push(item.feat);
        }

        const featureStack = tightStack.length > 1 ? tightStack : null;
        showPopup(anchor, initialFeature, { stack: featureStack, stackIndex: 0 });
    };

    state.map.on('click', handleMapTap);
    state.map.on('movestart', () => { state.isMapMoving = true; });
    state.map.on('moveend', () => { 
        state.isMapMoving = false; 
        state.lastMoveEndTime = Date.now();
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
        const details = extractTripDetails(targetFeature, state.username);
        const {
            statusId,
            lineName,
            categoryName,
            origin,
            destination: dest,
            plannedDeparture,
            actualDeparture,
            plannedArrival,
            actualArrival,
            departureDelay,
            arrivalDelay,
            platform,
            distanceKm: distance,
            durationDisplay,
            operator,
            isApproximated,
            customTags,
            buddies,
            bodyText
        } = details;

        const shareUrl = statusId ? `https://traewelling.de/status/${statusId}` : null;
        const animUrl = statusId
            ? `animation.html?trip=${encodeURIComponent(statusId)}${state.username ? `&user=${encodeURIComponent(state.username)}` : ''}`
            : null;

        const buildTimestampBlock = (primary, fallback) => {
            const dateObj = primary || fallback;
            if (!dateObj) return `<span>—</span>`;
            return `<span>${formatTimeShort(dateObj)}</span><span>${formatDateShort(dateObj)}</span>`;
        };
        const departureTimestamp = buildTimestampBlock(actualDeparture, plannedDeparture);
        const arrivalTimestamp = buildTimestampBlock(actualArrival, plannedArrival);

        const timingDetails = renderScheduleDetailsHTML(details);

        const tagsDetails = (customTags && customTags.length > 0) ? `
            <details class="popup-tags-details">
                <summary class="popup-expander-summary">
                    <span class="popup-summary-title">🏷️ Tags (${customTags.length})</span>
                    <span class="popup-toggle-arrow">▾</span>
                </summary>
                <div class="popup-body">
                    <div class="popup-tags-container">
                        ${renderTagsBadgesHTML(customTags)}
                    </div>
                </div>
            </details>
        ` : '';

        const seatDetails = renderSeatAndVehicleDetailsHTML(details);

        let mentionsHtml = '';
        if (buddies && buddies.length > 0) {
            mentionsHtml = `
                <div class="popup-mentions">
                    <label>Travel Buddies:</label>
                    <span>${renderBuddiesBadgesHTML(buddies)}</span>
                </div>
            `;
        }

        let commentHtml = '';
        if (bodyText || mentionsHtml) {
            commentHtml = `
                <div class="popup-comment">
                    ${bodyText ? `
                        <details class="popup-comment-details">
                            <summary class="popup-comment-summary">
                                <span>💬 Check-in Note</span>
                                <span class="popup-comment-toggle">▾</span>
                            </summary>
                            <div class="popup-comment-content">
                                <p>${renderLinkedComment(bodyText)}</p>
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
            const props = targetFeature?.properties || {};
            let train = props.train || props.checkin;
            if (typeof train === 'string') try { train = JSON.parse(train); } catch (e) { train = {}; }
            const fullTrip = (statusId && Array.isArray(state.fetchedTrips))
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
                <span class="popup-badge">${categoryName}</span>
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

    // Dynamic popup positioning: Allow both stacked and unstacked popups to open dynamically
    // above, below, or to either side based on available map viewport space.
    const popupOptions = {
        className: 'route-popup',
        closeButton: true,
        closeOnClick: true
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
                // Keep route highlight preserved across cycling transitions without canvas flickers
                state.preserveHighlightOnPopupClose = true;
                // Dynamically snap anchor to the active ride's line geometry
                const nextAnchor = snapLngLatToLine(lngLat, targetFeature) || lngLat;
                showPopup(nextAnchor, targetFeature, {
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
            if (typeof window !== 'undefined') {
                if (state._activeStackKeyNavHandler) {
                    window.removeEventListener('keydown', state._activeStackKeyNavHandler);
                    state._activeStackKeyNavHandler = null;
                }
                state._activeStackKeyNavHandler = handleStackKeyNav;
                window.addEventListener('keydown', handleStackKeyNav);
                state.currentPopup.once('close', () => {
                    if (state._activeStackKeyNavHandler === handleStackKeyNav) {
                        window.removeEventListener('keydown', handleStackKeyNav);
                        state._activeStackKeyNavHandler = null;
                    }
                });
            }
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
    
    const layers = state.map.getStyle?.()?.layers || [];
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
