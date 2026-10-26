// Floating Trip Cycler module for sequentially stepping through filtered trips on the map
import { store } from '../state/store.js';
import { showPopup, highlightRoute } from './interactions.js';

let cyclerContainer = null;
let currentTripIndex = 0;
let isUserDismissed = false;

/**
 * Initialize or update the floating trip cycler widget
 */
export function updateTripCycler() {
    const state = store.get();
    const activeTrips = state.activeTrips || [];
    const totalTrips = state.fetchedTrips || [];

    // Only show if there are filtered trips and a filter is active, or if search has results
    const hasActiveFilter = Boolean(
        state.filters?.searchQuery?.trim() ||
        state.filters?.fromDate ||
        state.filters?.toDate ||
        state.filters?.buddy ||
        (state.filters?.buddies && state.filters.buddies.length > 0) ||
        (activeTrips.length > 0 && activeTrips.length < totalTrips.length)
    );

    if (!hasActiveFilter || activeTrips.length === 0 || isUserDismissed) {
        hideTripCycler();
        return;
    }

    if (currentTripIndex >= activeTrips.length) {
        currentTripIndex = 0;
    }

    renderTripCycler(activeTrips);
}

/**
 * Render or update the DOM for the floating cycler
 * @param {Array} trips 
 */
function renderTripCycler(trips) {
    if (!cyclerContainer) {
        cyclerContainer = document.createElement('div');
        cyclerContainer.id = 'floatingTripCycler';
        cyclerContainer.className = 'floating-trip-cycler';
        cyclerContainer.setAttribute('role', 'region');
        cyclerContainer.setAttribute('aria-label', 'Filtered trips navigator');
        document.body.appendChild(cyclerContainer);
    }

    cyclerContainer.classList.remove('hidden');

    const trip = trips[currentTripIndex];
    if (!trip) return;

    const train = trip.train || trip.checkin || {};
    const lineName = train.lineName || train.number || train.name || 'Train';
    const origin = train.origin?.name || 'Origin';
    const dest = train.destination?.name || 'Destination';
    const rawDate = train.origin?.departureReal || train.origin?.departure || trip.createdAt;
    const dateFormatted = rawDate ? new Date(rawDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';

    // Check if this trip has duplicate/stacked trips with the exact same origin & destination in the active set
    const identicalRoutes = trips.filter(t => {
        const tr = t.train || t.checkin || {};
        return (tr.origin?.name === origin && tr.destination?.name === dest);
    });
    const stackedNote = identicalRoutes.length > 1
        ? `<span class="stack-nav-badge" style="font-size: 8px;">${identicalRoutes.length} on this route</span>`
        : '';

    cyclerContainer.innerHTML = `
        <button type="button" class="cycler-btn prev" id="cyclerPrevBtn" aria-label="Previous trip (Press [)">◀</button>
        <div class="cycler-info">
            <div class="cycler-route">${escapeHtml(lineName)}: ${escapeHtml(origin)} ➔ ${escapeHtml(dest)}</div>
            <div class="cycler-sub">
                <span>Trip <strong>${currentTripIndex + 1}</strong> of <strong>${trips.length}</strong></span>
                ${dateFormatted ? `<span>· ${escapeHtml(dateFormatted)}</span>` : ''}
                ${stackedNote}
            </div>
        </div>
        <button type="button" class="cycler-btn next" id="cyclerNextBtn" aria-label="Next trip (Press ])">▶</button>
        <button type="button" class="cycler-close-btn" id="cyclerCloseBtn" aria-label="Dismiss navigator" title="Dismiss navigator">✕</button>
    `;

    const prevBtn = cyclerContainer.querySelector('#cyclerPrevBtn');
    const nextBtn = cyclerContainer.querySelector('#cyclerNextBtn');
    const closeBtn = cyclerContainer.querySelector('#cyclerCloseBtn');

    prevBtn.onclick = (e) => {
        e.stopPropagation();
        stepTrip(-1, trips);
    };

    nextBtn.onclick = (e) => {
        e.stopPropagation();
        stepTrip(1, trips);
    };

    closeBtn.onclick = (e) => {
        e.stopPropagation();
        isUserDismissed = true;
        hideTripCycler();
    };
}

/**
 * Step forward or backward through trips
 * @param {number} delta 
 * @param {Array} trips 
 */
export function stepTrip(delta, trips = null) {
    const state = store.get();
    const activeTrips = trips || state.activeTrips || [];
    if (!activeTrips.length) return;

    currentTripIndex = (currentTripIndex + delta + activeTrips.length) % activeTrips.length;
    renderTripCycler(activeTrips);

    const trip = activeTrips[currentTripIndex];
    if (!trip) return;

    focusTripOnMap(trip);
}

/**
 * Focus and highlight a trip on the map
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
        // Find mid point or origin
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

export function hideTripCycler() {
    if (cyclerContainer) {
        cyclerContainer.classList.add('hidden');
    }
}

export function resetTripCyclerDismissed() {
    isUserDismissed = false;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
