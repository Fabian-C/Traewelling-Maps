import { store } from '../state/store.js';
import { deriveDelaySeconds, computeTripDurationMinutes } from '../utils/time.js';
import { formatDelayMinutes } from '../utils/format.js';
import { normalizeCategory, getTripBusinessType, extractTripTags, filterStopoversBetweenTraveledStations } from '../data/processing.js';
import { SessionDB } from '../cache/session.js';
import { TraewellingAPI } from '../api/traewelling.js';
import { processAndDisplayData } from '../fetch/orchestrator.js';
import { UI } from '../ui/ui.js';

/**
 * Convert an array of Träwelling trips into a standard GeoJSON FeatureCollection
 * @param {Array} trips Array of trip status objects
 * @param {Object} metadata Additional metadata for the FeatureCollection
 * @param {Object} options Configuration options including includeStopovers
 * @returns {Object} GeoJSON FeatureCollection
 */
export function tripsToGeoJSON(trips = [], metadata = {}, options = {}) {
    const features = [];
    const includeStopovers = options.includeStopovers ?? ((typeof document !== 'undefined' ? document.getElementById('exportIncludeStopovers')?.checked : false) || false);

    trips.forEach(trip => {
        const train = trip.train || trip.checkin || trip.properties?.train || trip.properties?.checkin || {};
        let polyline = train.polyline;
        if (!polyline?.geometry?.coordinates || polyline.geometry.coordinates.length < 2) {
            const origLng = parseFloat(train.origin?.station?.longitude ?? train.origin?.longitude);
            const origLat = parseFloat(train.origin?.station?.latitude ?? train.origin?.latitude);
            const destLng = parseFloat(train.destination?.station?.longitude ?? train.destination?.longitude);
            const destLat = parseFloat(train.destination?.station?.latitude ?? train.destination?.latitude);
            if (!isNaN(origLng) && !isNaN(origLat) && !isNaN(destLng) && !isNaN(destLat)) {
                polyline = {
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: (origLng === destLng && origLat === destLat)
                            ? [[origLng, origLat], [destLng + 0.00001, destLat + 0.00001]]
                            : [[origLng, origLat], [destLng, destLat]]
                    },
                    properties: { statusId: trip.id, isApproximated: true }
                };
            } else {
                return;
            }
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

        const parsedTags = trip._index?.tags || extractTripTags(trip);
        let wagonTag = null, seatTag = null, ticketTag = null, classTag = null, vehicleNum = null, locoClass = null, wagonCls = null;
        if (Array.isArray(parsedTags)) {
            parsedTags.forEach(t => {
                const k = (t.key || '').toLowerCase();
                const v = t.value;
                if (k === 'trwl:wagon' || k === 'wagon') wagonTag = v;
                else if (k === 'trwl:seat' || k === 'seat') seatTag = v;
                else if (k === 'trwl:ticket' || k === 'ticket') ticketTag = v;
                else if (k === 'trwl:travel_class' || k === 'travel_class') classTag = v;
                else if (k === 'trwl:vehicle_number' || k === 'vehicle_number') vehicleNum = v;
                else if (k === 'trwl:locomotive_class' || k === 'locomotive_class') locoClass = v;
                else if (k === 'trwl:wagon_class' || k === 'wagon_class') wagonCls = v;
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
                totalDistance: rawDistance,
                operator: train.operator?.name || train.operator?.identifier || train.provider?.name || train.provider || null,
                platform: originData.departurePlatformReal || originData.platform || train.platform || train.track || null,
                seat: trip._index?.seat || train.seat?.number || (typeof train.seat === 'string' || typeof train.seat === 'number' ? train.seat : null) || trip.seat?.number || trip.properties?.seat || seatTag || null,
                wagon: trip._index?.wagon || train.seat?.wagon || train.wagon || train.coach || trip.wagon || trip.properties?.wagon || wagonTag || null,
                class: trip._index?.travelClass || train.class || train.travelClass || trip.class || classTag || null,
                ticket: trip._index?.ticket || trip.ticket?.name || (typeof trip.ticket === 'string' ? trip.ticket : null) || train.ticket?.name || (typeof train.ticket === 'string' ? train.ticket : null) || ticketTag || null,
                vehicleNumber: trip._index?.vehicleNumber || vehicleNum || null,
                locomotiveClass: trip._index?.locomotiveClass || locoClass || null,
                wagonClass: trip._index?.wagonClass || wagonCls || null,
                tags: parsedTags.length ? parsedTags : null,
                business: businessLabel,
                message: trip.body || null,
                originLatitude: originData.station?.latitude ?? originData.latitude ?? (Array.isArray(polyline.geometry.coordinates?.[0]) ? polyline.geometry.coordinates[0][1] : null),
                originLongitude: originData.station?.longitude ?? originData.longitude ?? (Array.isArray(polyline.geometry.coordinates?.[0]) ? polyline.geometry.coordinates[0][0] : null),
                destLatitude: destData.station?.latitude ?? destData.latitude ?? (Array.isArray(polyline.geometry.coordinates?.[polyline.geometry.coordinates.length - 1]) ? polyline.geometry.coordinates[polyline.geometry.coordinates.length - 1][1] : null),
                destLongitude: destData.station?.longitude ?? destData.longitude ?? (Array.isArray(polyline.geometry.coordinates?.[polyline.geometry.coordinates.length - 1]) ? polyline.geometry.coordinates[polyline.geometry.coordinates.length - 1][0] : null),
                buddies: Array.isArray(trip.buddies) ? trip.buddies : (Array.isArray(trip.fellowPassengers) ? trip.fellowPassengers : null),
                isApproximated: !!polyline.properties?.isApproximated,
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
        try {
            await navigator.clipboard.writeText(jsonString);
            return true;
        } catch (err) {
            console.warn('Clipboard writeText failed:', err);
            return false;
        }
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
            const raw = cachedMap[t.id];
            t.train.stopovers = filterStopoversBetweenTraveledStations(raw, t.train?.origin, t.train?.destination);
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
    // 3. Dynamic batch fetch missing stopovers with adaptive splitting
    const initialBatchSize = 60;
    const totalToFetch = stillMissing.length;
    let completedCount = targetTrips.length - totalToFetch;
    let processedMissing = 0;

    const fetchExportBatchDynamic = async (subBatch) => {
        if (!subBatch.length) return;
        const queryIds = subBatch.map(t => t.train?.trip || t.id).filter(Boolean);

        try {
            const res = await api.getStopovers(queryIds);
            const data = res?.data;
            if (!data || typeof data !== 'object') throw new Error('Invalid stopovers response');

            subBatch.forEach(t => {
                const tripId = t.train?.trip;
                const rawStops = Array.isArray(data[tripId])
                    ? data[tripId]
                    : (Array.isArray(data[t.id]) ? data[t.id] : []);
                
                // Keep ONLY stations between origin and destination
                const filtered = filterStopoversBetweenTraveledStations(rawStops, t.train?.origin, t.train?.destination);
                t.train.stopovers = filtered;
                newlyFetched[t.id] = filtered;
            });
            processedMissing += subBatch.length;
            completedCount += subBatch.length;
        } catch (err) {
            if (subBatch.length > 5) {
                const mid = Math.ceil(subBatch.length / 2);
                await fetchExportBatchDynamic(subBatch.slice(0, mid));
                await fetchExportBatchDynamic(subBatch.slice(mid));
            } else {
                subBatch.forEach(t => {
                    if (!Array.isArray(t.train.stopovers)) t.train.stopovers = [];
                });
                processedMissing += subBatch.length;
                completedCount += subBatch.length;
            }
        }

        if (onProgress) {
            onProgress({
                current: completedCount,
                total: targetTrips.length,
                percentage: Math.min(100, Math.round((completedCount / targetTrips.length) * 100))
            });
        }
    };

    for (let i = 0; i < stillMissing.length; i += initialBatchSize) {
        const batch = stillMissing.slice(i, i + initialBatchSize);
        await fetchExportBatchDynamic(batch);
    }

    // 4. Save newly fetched trimmed stopovers to IndexedDB
    if (Object.keys(newlyFetched).length > 0) {
        await SessionDB.saveStopoversBatch(newlyFetched);
    }
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
            const cat = normalizeCategory(trip.train?.category || trip.checkin?.category);
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

/**
 * Parse an uploaded GeoJSON FeatureCollection or JSON trips file back into internal trip objects.
 * Handles:
 * - Träwelling Map Explorer GeoJSON exports
 * - Standard GeoJSON FeatureCollections / Features with route geometries
 * - Direct JSON trip arrays
 *
 * @param {Object|Array} data Parsed JSON object or array
 * @returns {{ trips: Array, username: string|null }}
 */
export function parseGeoJSONToTrips(data) {
    if (!data) return { trips: [], username: null };

    let features = [];
    let username = data.username || null;

    if (data.type === 'FeatureCollection' && Array.isArray(data.features)) {
        features = data.features;
    } else if (data.type === 'Feature') {
        features = [data];
    } else if (Array.isArray(data)) {
        if (data.length > 0 && data[0]?.type === 'Feature') {
            features = data;
        } else {
            return {
                trips: data.filter(t => t && (t.train?.polyline || t.polyline || t.id)),
                username: username || 'Exported Trips'
            };
        }
    } else if (data.data && Array.isArray(data.data)) {
        return {
            trips: data.data.filter(t => t && (t.train?.polyline || t.polyline || t.id)),
            username: username || 'Exported Trips'
        };
    }

    const trips = [];
    features.forEach((feature, idx) => {
        if (!feature) return;
        const geom = feature.geometry;
        const p = feature.properties || {};

        if (!geom?.coordinates || !Array.isArray(geom.coordinates) || geom.coordinates.length < 2) {
            return;
        }

        const statusId = p.statusId || p.id || (Date.now() + idx);
        const distanceMeters = typeof p.totalDistance === 'number'
            ? p.totalDistance
            : (typeof p.distanceKm === 'number' ? Math.round(p.distanceKm * 1000) : (p.distance || 0));

        let businessType = 0;
        if (p.business === 'work' || p.business === 1 || p.business === '1') businessType = 1;
        else if (p.business === 'commute' || p.business === 2 || p.business === '2') businessType = 2;

        const originName = typeof p.origin === 'string'
            ? p.origin
            : (p.origin?.name || p.origin?.station?.name || 'Unknown');
        const destName = typeof p.destination === 'string'
            ? p.destination
            : (p.destination?.name || p.destination?.station?.name || 'Unknown');

        const originCoords = geom.coordinates[0];
        const destCoords = geom.coordinates[geom.coordinates.length - 1];
        const originLat = typeof p.originLatitude === 'number' ? p.originLatitude : (originCoords ? originCoords[1] : null);
        const originLon = typeof p.originLongitude === 'number' ? p.originLongitude : (originCoords ? originCoords[0] : null);
        const destLat = typeof p.destLatitude === 'number' ? p.destLatitude : (destCoords ? destCoords[1] : null);
        const destLon = typeof p.destLongitude === 'number' ? p.destLongitude : (destCoords ? destCoords[0] : null);

        const trip = {
            id: statusId,
            body: p.message || p.body || '',
            createdAt: p.createdAt || p.actualDeparture || p.plannedDeparture || new Date().toISOString(),
            business: businessType,
            ticket: p.ticket || null,
            tags: Array.isArray(p.tags) ? p.tags : [],
            buddies: Array.isArray(p.buddies) ? p.buddies : [],
            train: {
                category: normalizeCategory(p.category || p.train?.category),
                lineName: p.lineName || p.train?.lineName || p.line || p.name || '',
                totalDistance: distanceMeters,
                distance: distanceMeters,
                origin: {
                    name: originName,
                    departurePlanned: p.plannedDeparture || null,
                    departureReal: p.actualDeparture || null,
                    platform: p.platform || null,
                    station: {
                        name: originName,
                        latitude: originLat,
                        longitude: originLon
                    }
                },
                destination: {
                    name: destName,
                    arrivalPlanned: p.plannedArrival || null,
                    arrivalReal: p.actualArrival || null,
                    station: {
                        name: destName,
                        latitude: destLat,
                        longitude: destLon
                    }
                },
                operator: p.operator ? (typeof p.operator === 'string' ? { name: p.operator } : p.operator) : null,
                seat: p.seat ? (typeof p.seat === 'object' ? p.seat : { number: p.seat, wagon: p.wagon }) : null,
                wagon: p.wagon || null,
                class: p.class || null,
                travelClass: p.class || null,
                ticket: p.ticket ? (typeof p.ticket === 'object' ? p.ticket : { name: p.ticket }) : null,
                polyline: {
                    type: 'Feature',
                    geometry: geom,
                    properties: { statusId }
                },
                stopovers: Array.isArray(p.stopovers) ? p.stopovers.map(s => ({
                    name: s.station || s.name || 'Station',
                    station: {
                        name: s.station || s.name || 'Station',
                        latitude: s.latitude,
                        longitude: s.longitude
                    },
                    arrivalPlanned: s.plannedArrival || null,
                    arrivalReal: s.actualArrival || null,
                    departurePlanned: s.plannedDeparture || null,
                    departureReal: s.actualDeparture || null,
                    platform: s.actualPlatform || s.plannedPlatform || null,
                    cancelled: !!s.cancelled
                })) : []
            }
        };

        if (p.vehicleNumber) trip._index = { ...trip._index, vehicleNumber: p.vehicleNumber };
        if (p.locomotiveClass) trip._index = { ...trip._index, locomotiveClass: p.locomotiveClass };
        if (p.wagonClass) trip._index = { ...trip._index, wagonClass: p.wagonClass };
        trip.checkin = trip.train;

        trips.push(trip);
    });

    return {
        trips,
        username: username || (trips.length > 0 ? 'Exported Trips' : null)
    };
}

/**
 * Handle user uploading or dropping a GeoJSON / JSON file.
 * Automatically converts routes, switches screens, and displays trips on map.
 * @param {File} file The selected file object
 */
export async function handleGeoJSONUpload(file) {
    if (!file) return;

    try {
        const text = await file.text();
        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch (jsonErr) {
            throw new Error('The selected file is not valid JSON.');
        }

        const { trips, username } = parseGeoJSONToTrips(parsed);
        if (!trips || !trips.length) {
            alert('No valid travel routes or polyline features were found in this file.');
            return;
        }

        const state = store.get();
        const displayUser = username || file.name.replace(/\.(geojson|json)$/i, '') || 'Imported Travels';
        state.username = displayUser;
        state.queriedUserProfile = {
            username: displayUser,
            displayName: displayUser,
            avatar: null
        };

        // Transition from setup screen
        UI.toggleSetup(false);
        UI.toggleFetch(false);

        // Process, populate layers, and display data on the map
        await processAndDisplayData(trips, { hideFetchUI: true });

        // Save imported trips into SessionDB cache so Rail Wrapped and persistence work immediately
        try {
            await SessionDB.save(displayUser, trips);
        } catch (dbErr) {
            console.warn('Could not cache imported trips in SessionDB:', dbErr);
        }

        showExportToast(`Loaded ${trips.length} routes from ${file.name}!`);
    } catch (err) {
        console.error('Error importing GeoJSON file:', err);
        alert(`Failed to import file: ${err.message || 'Unknown error'}`);
    }
}
