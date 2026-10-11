// GeoJSON Exporter Module for Träwelling Maps
import { store } from '../state/store.js';
import { deriveDelaySeconds, computeTripDurationMinutes } from '../utils/time.js';
import { formatDelayMinutes } from '../utils/format.js';

/**
 * Convert an array of Träwelling trips into a standard GeoJSON FeatureCollection
 * @param {Array} trips Array of trip status objects
 * @param {Object} metadata Additional metadata for the FeatureCollection
 * @returns {Object} GeoJSON FeatureCollection
 */
export function tripsToGeoJSON(trips = [], metadata = {}) {
    const features = [];

    trips.forEach(trip => {
        const train = trip.train || {};
        const polyline = train.polyline;
        if (!polyline?.geometry?.coordinates || polyline.geometry.coordinates.length < 2) {
            return;
        }

        const originData = train.origin || {};
        const destData = train.destination || {};
        const delays = deriveDelaySeconds(train);

        const departureDelayMin = delays.departure !== null ? formatDelayMinutes(delays.departure) : null;
        const arrivalDelayMin = delays.arrival !== null ? formatDelayMinutes(delays.arrival) : null;

        const rawDistance = typeof train.totalDistance === 'number' ? train.totalDistance : (train.distance || 0);
        const distanceKm = Math.round(rawDistance / 10) / 100;
        const durationMin = computeTripDurationMinutes(train);

        const businessLabel = trip.business === 1 ? 'work' : (trip.business === 2 ? 'commute' : 'personal');

        features.push({
            type: 'Feature',
            geometry: polyline.geometry,
            properties: {
                statusId: trip.id,
                lineName: train.lineName || train.number || train.name || 'Unknown',
                category: train.category || 'unknown',
                origin: originData.name || originData.station?.name || 'Unknown',
                destination: destData.name || destData.station?.name || 'Unknown',
                plannedDeparture: originData.departurePlanned || train.plannedDeparture || null,
                actualDeparture: originData.departureReal || originData.departure || train.departure || null,
                departureDelayMinutes: departureDelayMin,
                plannedArrival: destData.arrivalPlanned || train.plannedArrival || null,
                actualArrival: destData.arrivalReal || destData.arrival || train.arrival || null,
                arrivalDelayMinutes: arrivalDelayMin,
                durationMinutes: durationMin,
                distanceKm: distanceKm,
                operator: train.operator?.name || train.operator?.identifier || train.provider?.name || train.provider || null,
                platform: originData.departurePlatformReal || originData.platform || train.platform || train.track || null,
                seat: train.seat?.number || null,
                wagon: train.seat?.wagon || train.wagon || null,
                class: train.class || train.travelClass || null,
                business: businessLabel,
                message: trip.body || null,
                createdAt: trip.createdAt || null,
                traewellingUrl: trip.id ? `https://traewelling.de/status/${trip.id}` : null
            }
        });
    });

    return {
        type: 'FeatureCollection',
        generator: 'Träwelling Map Explorer',
        timestamp: new Date().toISOString(),
        username: metadata.username || null,
        tripCount: features.length,
        features: features
    };
}

/**
 * Download a GeoJSON file to the user's computer
 * @param {Object} geojsonData GeoJSON object
 * @param {string} filename Name of the file
 */
export function downloadGeoJSONFile(geojsonData, filename = 'traewelling-trips.geojson') {
    const jsonString = JSON.stringify(geojsonData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/geo+json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }, 100);
}

/**
 * Copy GeoJSON string to clipboard
 * @param {Object} geojsonData GeoJSON object
 * @returns {Promise<boolean>} True if copied successfully
 */
export async function copyGeoJSONToClipboard(geojsonData) {
    const jsonString = JSON.stringify(geojsonData, null, 2);
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(jsonString);
        return true;
    }
    return false;
}

/**
 * Trigger export flow with scope selection (active or all)
 * @param {'active'|'all'} scope Which trips to export
 * @param {'download'|'copy'} action Action to perform
 */
export async function exportTripsGeoJSON(scope = 'active', action = 'download') {
    const state = store.get();
    const trips = scope === 'all' 
        ? (state.fetchedTrips || []) 
        : (state.activeTrips?.length ? state.activeTrips : state.fetchedTrips || []);

    if (!trips.length) {
        alert('No trips available to export.');
        return;
    }

    const geojson = tripsToGeoJSON(trips, {
        username: state.username,
        scope: scope
    });

    const dateStr = new Date().toISOString().split('T')[0];
    const username = state.username || 'user';
    const filename = `traewelling-${username}-${scope}-trips-${dateStr}.geojson`;

    if (action === 'download') {
        downloadGeoJSONFile(geojson, filename);
        showExportToast(`Downloaded ${geojson.features.length} routes as GeoJSON!`);
    } else if (action === 'copy') {
        const success = await copyGeoJSONToClipboard(geojson);
        if (success) {
            showExportToast(`Copied GeoJSON (${geojson.features.length} routes) to clipboard!`);
        } else {
            prompt('Copy GeoJSON text:', JSON.stringify(geojson));
        }
    }
}

/**
 * Display a temporary floating toast message
 * @param {string} message Text to display
 */
export function showExportToast(message) {
    const existing = document.getElementById('exportToast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'exportToast';
    toast.className = 'export-toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('visible');
    }, 10);

    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
