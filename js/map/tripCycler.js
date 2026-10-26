// Trip focus and route highlighting module
import { store } from '../state/store.js';
import { showPopup, highlightRoute } from './interactions.js';

/**
 * Focus and highlight a trip on the map, opening its popup with stacked check-ins context
 * @param {Object} trip 
 */
export function focusTripOnMap(trip) {
    const state = store.get();
    if (!state.map) return;

    const train = trip.train || trip.checkin || {};
    const polyline = train.polyline;
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

    if (targetLngLat) {
        state.map.flyTo({
            center: targetLngLat,
            zoom: Math.max(state.map.getZoom(), 8.5),
            duration: 800
        });

        const syntheticFeature = {
            type: 'Feature',
            properties: {
                statusId: trip.id,
                train: train,
                checkin: train
            },
            geometry: polyline?.geometry || {
                type: 'Point',
                coordinates: targetLngLat
            }
        };

        // Find all stacked trips on the exact same polyline or origin/dest in activeTrips
        const origName = train.origin?.name;
        const destName = train.destination?.name;
        const stackedTrips = (state.activeTrips || []).filter(t => {
            const tr = t.train || t.checkin || {};
            return (tr.origin?.name === origName && tr.destination?.name === destName);
        });

        const stackedFeatures = stackedTrips.map(st => ({
            type: 'Feature',
            properties: {
                statusId: st.id,
                train: st.train || st.checkin || {},
                checkin: st.train || st.checkin || {}
            },
            geometry: st.train?.polyline?.geometry || syntheticFeature.geometry
        }));

        const stackIndex = Math.max(0, stackedTrips.findIndex(t => t.id === trip.id));

        showPopup(targetLngLat, syntheticFeature, {
            stack: stackedFeatures.length > 1 ? stackedFeatures : null,
            stackIndex
        });

        highlightRoute(syntheticFeature, trip.id);
    }
}

// No-ops for backward compatibility if referenced
export function updateTripCycler() {}
export function hideTripCycler() {}
export function resetTripCyclerDismissed() {}
export function stepTrip() {}
