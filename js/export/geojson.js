import { store } from '../state/store.js';
import { deriveDelaySeconds, computeTripDurationMinutes } from '../utils/time.js';
import { formatDelayMinutes } from '../utils/format.js';
import { normalizeCategory, getTripBusinessType } from '../data/processing.js';
import { SessionDB } from '../cache/session.js';
import { TraewellingAPI } from '../api/traewelling.js';

/**
 * Convert an array of Träwelling trips into a standard GeoJSON FeatureCollection
 * @param {Array} trips Array of trip status objects
 * @param {Object} metadata Additional metadata for the FeatureCollection
 * @param {Object} options Configuration options including includeStopovers
 * @returns {Object} GeoJSON FeatureCollection
 */
export function tripsToGeoJSON(trips = [], metadata = {}, options = {}) {
    const features = [];
    const includeStopovers = options.includeStopovers ?? (document.getElementById('exportIncludeStopovers')?.checked || false);

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

        const bType = getTripBusinessType(trip);
        const businessLabel = bType === 1 ? 'work' : (bType === 2 ? 'commute' : 'personal');

        let stopoversList = undefined;
        if (includeStopovers) {
            const rawStopovers = Array.isArray(train.stopovers) ? train.stopovers : [];
            stopoversList = rawStopovers.map(s => {
                const station = s.station || {};
                const lat = typeof station.latitude === 'number' ? station.latitude : (parseFloat(station.latitude) || null);
                const lon = typeof station.longitude === 'number' ? station.longitude : (parseFloat(station.longitude) || null);
                return {
                    station: station.name || s.name || 'Unknown',
                    latitude: Number.isFinite(lat) ? lat : null,
                    longitude: Number.isFinite(lon) ? lon : null,
                    plannedArrival: s.arrivalPlanned || null,
                    actualArrival: s.arrivalReal || s.arrival || null,
                    plannedDeparture: s.departurePlanned || null,
                    actualDeparture: s.departureReal || s.departure || null,
                    plannedPlatform: s.arrivalPlatformPlanned || s.departurePlatformPlanned || null,
                    actualPlatform: s.arrivalPlatformReal || s.departurePlatformReal || s.platform || null,
                    cancelled: !!s.cancelled
                };
            });
        }

        features.push({
            type: 'Feature',
            geometry: polyline.geometry,
            properties: {
                statusId: trip.id,
                lineName: train.lineName || train.number || train.name || 'Unknown',
                category: normalizeCategory(train.category),
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
                traewellingUrl: trip.id ? `https://traewelling.de/status/${trip.id}` : null,
                ...(includeStopovers ? { stopovers: stopoversList } : {})
            }
        });
    });

    return {
        type: 'FeatureCollection',
        generator: 'Träwelling Map Explorer',
        timestamp: new Date().toISOString(),
        username: metadata.username || null,
        tripCount: features.length,
        ...(includeStopovers ? { hasStopovers: true } : {}),
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
 * Update UI state for stopover fetching status in the export menu
 * @param {Object} options Options containing show, text, progress, and loading
 */
export function updateExportStopoverStatusUI({ show = false, text = '', progress = 0, loading = false } = {}) {
    const container = document.getElementById('exportStopoversStatus');
    const label = document.getElementById('exportStopoversLabel');
    const spinner = document.getElementById('exportStopoversSpinner');
    const barBg = document.getElementById('exportStopoversBarBg');
    const barFill = document.getElementById('exportStopoversBarFill');

    if (!container) return;

    if (!show) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';
    if (label) label.textContent = text;
    if (spinner) spinner.textContent = loading ? '⏳' : (progress === 100 ? '✅' : 'ℹ️');
    if (barBg) barBg.style.display = loading || progress > 0 ? 'block' : 'none';
    if (barFill) barFill.style.width = `${progress}%`;
}

/**
 * Fetch stopover information for trips that lack it, checking IndexedDB cache first
 * @param {Array} trips Array of trip objects
 * @param {Function} onProgress Progress callback ({ current, total, percentage })
 */
export async function fetchStopoversForTrips(trips = [], onProgress = null) {
    if (!trips || !trips.length) return;
    const targetTrips = trips.filter(t => t?.train);
    if (!targetTrips.length) return;

    // 1. Check in-memory first
    const needsLookup = targetTrips.filter(t => !Array.isArray(t.train.stopovers));
    if (!needsLookup.length) {
        if (onProgress) onProgress({ current: targetTrips.length, total: targetTrips.length, percentage: 100 });
        return;
    }

    // 2. Check IndexedDB batch cache
    const ids = needsLookup.map(t => t.id).filter(Boolean);
    const cachedMap = await SessionDB.getStopoversBatch(ids);

    const stillMissing = [];
    needsLookup.forEach(t => {
        if (cachedMap[t.id]) {
            t.train.stopovers = cachedMap[t.id];
        } else {
            stillMissing.push(t);
        }
    });

    if (!stillMissing.length) {
        if (onProgress) onProgress({ current: targetTrips.length, total: targetTrips.length, percentage: 100 });
        return;
    }

    // 3. Batch fetch missing stopovers from Träwelling API
    const state = store.get();
    const api = new TraewellingAPI(state.token);
    if (window.RateLimitUI?.update) {
        api.onRateLimitUpdate = (stats) => window.RateLimitUI.update(stats);
    }
    const BATCH_SIZE = 20;
    const newlyFetched = {};
    const totalToFetch = stillMissing.length;
    let completedCount = targetTrips.length - totalToFetch;

    for (let i = 0; i < stillMissing.length; i += BATCH_SIZE) {
        const batch = stillMissing.slice(i, i + BATCH_SIZE);
        const batchIds = batch.map(t => t.id);

        try {
            const res = await api.getStopovers(batchIds);
            const data = res?.data || {};
            batch.forEach(t => {
                const stops = Array.isArray(data[t.id]) ? data[t.id] : [];
                t.train.stopovers = stops;
                newlyFetched[t.id] = stops;
            });
        } catch (err) {
            console.warn('Failed to fetch stopover batch:', err);
            batch.forEach(t => {
                if (!Array.isArray(t.train.stopovers)) t.train.stopovers = [];
            });
        }

        completedCount += batch.length;
        if (onProgress) {
            onProgress({
                current: completedCount,
                total: targetTrips.length,
                percentage: Math.min(100, Math.round((completedCount / targetTrips.length) * 100))
            });
        }
    }

    // 4. Save newly fetched stopovers to IndexedDB
    if (Object.keys(newlyFetched).length > 0) {
        await SessionDB.saveStopoversBatch(newlyFetched);
        // Persist updated trip stopovers back to session in IndexedDB if active
        if (state.username && state.fetchedTrips) {
            SessionDB.save(state.username, {
                trips: state.fetchedTrips,
                tripCount: state.fetchedTrips.length,
                displayName: state.queriedUserProfile?.displayName || state.username,
                avatar: state.queriedUserProfile?.avatar,
                token: state.token
            }).catch(() => {});
        }
    }
}

/**
 * Handle user changing the "Include intermediate stations" checkbox
 * Automatically initiates fetching stopover information for loaded trips
 */
export async function handleStopoverToggleChange(e) {
    const isChecked = e?.target?.checked;
    if (!isChecked) {
        updateExportStopoverStatusUI({ show: false });
        return;
    }

    const state = store.get();
    const trips = (state.activeTrips && state.activeTrips.length) 
        ? state.activeTrips 
        : (state.fetchedTrips || []);

    if (!trips.length) {
        updateExportStopoverStatusUI({
            show: true,
            text: 'No trips loaded to fetch stopovers for.',
            progress: 0,
            loading: false
        });
        return;
    }

    updateExportStopoverStatusUI({
        show: true,
        text: 'Checking & fetching stopovers for trips...',
        progress: 0,
        loading: true
    });

    try {
        await fetchStopoversForTrips(trips, ({ current, total, percentage }) => {
            updateExportStopoverStatusUI({
                show: true,
                text: `Fetching stopovers: ${current}/${total} (${percentage}%)...`,
                progress: percentage,
                loading: true
            });
        });
        updateExportStopoverStatusUI({
            show: true,
            text: `✓ Stopovers ready for ${trips.length} trips!`,
            progress: 100,
            loading: false
        });
    } catch (err) {
        console.warn('Error fetching stopovers on toggle:', err);
        updateExportStopoverStatusUI({
            show: true,
            text: 'Failed to fetch stopovers. Check network connection.',
            progress: 0,
            loading: false
        });
    }
}

/**
 * Trigger export flow with scope selection (active or all)
 * @param {'active'|'all'} scope Which trips to export
 * @param {'download'|'copy'} action Action to perform
 */
export async function exportTripsGeoJSON(scope = 'active', action = 'download') {
    const state = store.get();
    let trips = scope === 'all' 
        ? (state.fetchedTrips || []) 
        : (state.activeTrips !== undefined && state.activeTrips !== null ? state.activeTrips : (state.fetchedTrips || []));

    if (scope === 'active') {
        const layerVisibility = new Map();
        state.layers.data.forEach((layer, id) => {
            layerVisibility.set(id, layer.visible);
        });
        trips = trips.filter(trip => {
            const cat = normalizeCategory(trip.train?.category);
            return layerVisibility.has(cat) ? layerVisibility.get(cat) : true;
        });
    }

    if (!trips.length) {
        alert('No trips available to export with current layer visibility.');
        return;
    }

    const includeStopovers = document.getElementById('exportIncludeStopovers')?.checked || false;

    if (includeStopovers) {
        updateExportStopoverStatusUI({ show: true, text: 'Preparing stopover data...', progress: 0, loading: true });
        try {
            await fetchStopoversForTrips(trips, ({ current, total, percentage }) => {
                updateExportStopoverStatusUI({
                    show: true,
                    text: `Fetching stopovers: ${current}/${total} (${percentage}%)...`,
                    progress: percentage,
                    loading: true
                });
            });
            updateExportStopoverStatusUI({
                show: true,
                text: `✓ Stopover data ready (${trips.length} trips)`,
                progress: 100,
                loading: false
            });
        } catch (err) {
            console.warn('Error fetching stopovers during export:', err);
            updateExportStopoverStatusUI({
                show: true,
                text: '⚠️ Exporting with available stopovers.',
                progress: 100,
                loading: false
            });
        }
    }

    const geojson = tripsToGeoJSON(trips, {
        username: state.username,
        scope: scope
    }, { includeStopovers });

    const dateStr = new Date().toISOString().split('T')[0];
    const username = state.username || 'user';
    const stopoverSuffix = includeStopovers ? '-with-stopovers' : '';
    const filename = `traewelling-${username}-${scope}-trips${stopoverSuffix}-${dateStr}.geojson`;
    const stopoverNote = includeStopovers ? ' with intermediate stations' : '';

    if (action === 'download') {
        downloadGeoJSONFile(geojson, filename);
        showExportToast(`Downloaded ${geojson.features.length} routes${stopoverNote} as GeoJSON!`);
    } else if (action === 'copy') {
        const success = await copyGeoJSONToClipboard(geojson);
        if (success) {
            showExportToast(`Copied GeoJSON (${geojson.features.length} routes${stopoverNote}) to clipboard!`);
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
