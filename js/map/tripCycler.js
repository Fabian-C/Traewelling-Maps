// Trip focus and route highlighting module
import { store } from '../state/store.js';
import { showPopup, highlightRoute, measureFeatureDistance } from './interactions.js';
import { snapLngLatToLine } from '../utils/geometry.js';
import { normalizeCategory } from '../data/processing.js';

/**
 * Focus and highlight a trip on the map, opening its popup with identical fidelity to a normal map click
 * @param {Object} trip 
 */
export function focusTripOnMap(trip) {
    const state = store.get();
    if (!state.map || !trip) return;

    // 1. Resolve real rendered GeoJSON feature from map layers if available
    let targetFeature = null;
    if (state.layers?.data) {
        for (const [, layerObj] of state.layers.data.entries()) {
            const found = layerObj.data?.features?.find(f => 
                String(f.properties?.statusId || f.id) === String(trip.id)
            );
            if (found) {
                targetFeature = found;
                break;
            }
        }
    }

    const train = trip.train || trip.checkin || targetFeature?.properties?.train || {};
    const polyline = train.polyline || targetFeature;
    const coords = polyline?.geometry?.coordinates;

    let targetLngLat = null;
    if (coords && coords.length > 0) {
        const midIdx = Math.floor(coords.length / 2);
        targetLngLat = coords[midIdx];
    } else {
        const lng = parseFloat(train.origin?.station?.longitude ?? train.origin?.longitude);
        const lat = parseFloat(train.origin?.station?.latitude ?? train.origin?.latitude);
        if (!isNaN(lng) && !isNaN(lat)) {
            targetLngLat = [lng, lat];
        }
    }

    if (!targetLngLat) return;

    // 2. Build complete feature fallback if not found directly in rendered layer
    if (!targetFeature) {
        const props = trip.properties || {};
        targetFeature = {
            type: 'Feature',
            properties: {
                statusId: trip.id,
                lineName: train.lineName || train.number || train.name || 'Unknown',
                category: normalizeCategory(train.category || props.category || 'regional'),
                origin: train.origin?.name || 'Unknown',
                destination: train.destination?.name || 'Unknown',
                train: train,
                checkin: train,
                body: trip.body || props.body || null,
                bodyMentions: trip.bodyMentions || props.bodyMentions || null,
                ticket: props.ticket || train.ticket || trip.ticket || null,
                seat: props.seat || train.seat?.number || train.seat || trip.seat || null,
                wagon: props.wagon || train.seat?.wagon || train.wagon || trip.wagon || null,
                class: props.class || props.travelClass || trip.class || trip.travelClass || null,
                buddies: trip.buddies || props.buddies || trip.companions || props.companions || trip.fellowPassengers || null,
                tags: props.tags || trip.tags || train.tags || []
            },
            geometry: polyline?.geometry || {
                type: 'Point',
                coordinates: targetLngLat
            }
        };
    } else if (!targetFeature.properties.train) {
        targetFeature.properties.train = train;
        targetFeature.properties.checkin = train;
    }

    // 3. Snap coordinates to route line
    const snapped = snapLngLatToLine({ lng: targetLngLat[0], lat: targetLngLat[1] }, targetFeature);
    const anchor = snapped ? [snapped.lng, snapped.lat] : targetLngLat;

    // 4. Center map view with smooth camera transition
    state.map.flyTo({
        center: anchor,
        zoom: Math.max(state.map.getZoom(), 8.5),
        duration: 800
    });

    // 5. Detect stacked check-ins using strict proximity threshold (<= 20 meters), matching handleMapTap
    const MAX_STACK_DISTANCE_KM = 0.020;
    const tightStack = [];
    const seenIds = new Set();
    const initialId = targetFeature.properties?.statusId || targetFeature.id;
    if (initialId !== undefined && initialId !== null) seenIds.add(String(initialId));
    tightStack.push(targetFeature);

    if (state.layers?.data) {
        for (const [, layerObj] of state.layers.data.entries()) {
            const features = layerObj.data?.features || [];
            for (const feat of features) {
                const sid = feat.properties?.statusId || feat.id;
                if (sid !== undefined && sid !== null && seenIds.has(String(sid))) continue;
                const distKm = measureFeatureDistance(feat, { lng: anchor[0], lat: anchor[1] }, null);
                if (distKm <= MAX_STACK_DISTANCE_KM) {
                    if (sid !== undefined && sid !== null) seenIds.add(String(sid));
                    tightStack.push(feat);
                }
            }
        }
    }

    const featureStack = tightStack.length > 1 ? tightStack : null;

    // 6. Display popup with identical popout presentation as a regular click
    showPopup(anchor, targetFeature, {
        stack: featureStack,
        stackIndex: 0
    });

    highlightRoute(targetFeature, trip.id);
}

// No-ops for backward compatibility if referenced
export function updateTripCycler() {}
export function hideTripCycler() {}
export function resetTripCyclerDismissed() {}
export function stepTrip() {}
