import { store } from '../state/store.js';
import { deriveDelaySeconds, computeTripDurationMinutes } from '../utils/time.js';
import { formatDelayMinutes } from '../utils/format.js';
import { normalizeCategory, getTripBusinessType, extractTripTags, filterStopoversBetweenTraveledStations } from '../data/processing.js';
import { SessionDB } from '../cache/session.js';
import { TraewellingAPI } from '../api/traewelling.js';
import { processAndDisplayData } from '../fetch/orchestrator.js';
import { UI } from '../ui/ui.js';
import { updateMenuAccountList } from '../session/manager.js';
import { getTripBuddies } from '../trips/formatters.js';

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
        let polyline = (trip.geometry?.coordinates && trip.geometry.coordinates.length >= 2) ? trip : train.polyline;
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

        const bId = train.trip || train.tripId || trip.trip || trip.backend_trip_id || trip.properties?.backendTripId || trip.properties?.backend_trip_id || null;
        const activeUser = metadata.username || store.get()?.username || '';
        const buddiesList = getTripBuddies(trip, activeUser);
        const coPassengers = Array.isArray(trip.co_passengers) && trip.co_passengers.length ? trip.co_passengers : (Array.isArray(trip.properties?.co_passengers) && trip.properties.co_passengers.length ? trip.properties.co_passengers : null);
        const bodyMentions = Array.isArray(trip.bodyMentions) && trip.bodyMentions.length ? trip.bodyMentions : (Array.isArray(trip.properties?.bodyMentions) && trip.properties.bodyMentions.length ? trip.properties.bodyMentions : null);

        features.push({
            type: 'Feature',
            geometry: polyline.geometry,
            properties: {
                statusId: trip.id,
                id: trip.id,
                lineName: train.lineName || train.number || train.name || 'Unknown',
                line: train.lineName || train.number || train.name || 'Unknown',
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
                message: trip.body || trip.message || null,
                body: trip.body || trip.message || null,
                originLatitude: originData.station?.latitude ?? originData.latitude ?? (Array.isArray(polyline.geometry.coordinates?.[0]) ? polyline.geometry.coordinates[0][1] : null),
                originLongitude: originData.station?.longitude ?? originData.longitude ?? (Array.isArray(polyline.geometry.coordinates?.[0]) ? polyline.geometry.coordinates[0][0] : null),
                destLatitude: destData.station?.latitude ?? destData.latitude ?? (Array.isArray(polyline.geometry.coordinates?.[polyline.geometry.coordinates.length - 1]) ? polyline.geometry.coordinates[polyline.geometry.coordinates.length - 1][1] : null),
                destLongitude: destData.station?.longitude ?? destData.longitude ?? (Array.isArray(polyline.geometry.coordinates?.[polyline.geometry.coordinates.length - 1]) ? polyline.geometry.coordinates[polyline.geometry.coordinates.length - 1][0] : null),
                backendTripId: bId,
                backend_trip_id: bId,
                buddies: buddiesList.length ? buddiesList : (Array.isArray(trip.buddies) && trip.buddies.length ? trip.buddies : (Array.isArray(trip.fellowPassengers) && trip.fellowPassengers.length ? trip.fellowPassengers : null)),
                co_passengers: coPassengers,
                bodyMentions: bodyMentions,
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
 * Generic file download helper
 * @param {string} content File content string
 * @param {string} filename Name of the file
 * @param {string} mimeType MIME type
 */
export function downloadFile(content, filename, mimeType = 'text/plain;charset=utf-8') {
    if (typeof document === 'undefined') return;
    const blob = new Blob([content], { type: mimeType });
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
 * Download a GeoJSON file to the user's computer
 * @param {Object|string} geojsonData GeoJSON object or string
 * @param {string} filename Name of the file
 */
export function downloadGeoJSONFile(geojsonData, filename = 'traewelling-trips.geojson') {
    const jsonString = typeof geojsonData === 'string' ? geojsonData : JSON.stringify(geojsonData, null, 2);
    downloadFile(jsonString, filename, 'application/geo+json;charset=utf-8');
}

/**
 * Download a GPX file to the user's computer
 * @param {string} gpxData GPX XML string
 * @param {string} filename Name of the file
 */
export function downloadGPXFile(gpxData, filename = 'traewelling-trips.gpx') {
    downloadFile(gpxData, filename, 'application/gpx+xml;charset=utf-8');
}

/**
 * Download a KML file to the user's computer
 * @param {string} kmlData KML XML string
 * @param {string} filename Name of the file
 */
export function downloadKMLFile(kmlData, filename = 'traewelling-trips.kml') {
    downloadFile(kmlData, filename, 'application/vnd.google-earth.kml+xml;charset=utf-8');
}

/**
 * Download a CSV file to the user's computer
 * @param {string} csvData CSV string
 * @param {string} filename Name of the file
 */
export function downloadCSVFile(csvData, filename = 'traewelling-trips.csv') {
    downloadFile(csvData, filename, 'text/csv;charset=utf-8');
}

/**
 * Download a JSON file to the user's computer
 * @param {Object|string} jsonData JSON data or string
 * @param {string} filename Name of the file
 */
export function downloadJSONFile(jsonData, filename = 'traewelling-trips.json') {
    const jsonString = typeof jsonData === 'string' ? jsonData : JSON.stringify(jsonData, null, 2);
    downloadFile(jsonString, filename, 'application/json;charset=utf-8');
}

/**
 * Convert an array of Träwelling trips into standard GPX 1.1 format with trackpoints
 * and linearly interpolated timestamps between departure and arrival.
 * @param {Array} trips Array of trip objects
 * @param {Object} metadata Metadata for header
 * @returns {string} GPX 1.1 XML string
 */
export function tripsToGPX(trips = [], metadata = {}) {
    const creator = 'Träwelling Map Explorer';
    const title = metadata.title || (metadata.username ? `Träwelling Journeys - ${metadata.username}` : 'Träwelling Journeys');
    const timestamp = new Date().toISOString();

    const escapeXml = (str) => {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    };

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<gpx version="1.1" creator="${escapeXml(creator)}" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">\n`;
    xml += `  <metadata>\n`;
    xml += `    <name>${escapeXml(title)}</name>\n`;
    xml += `    <time>${timestamp}</time>\n`;
    xml += `  </metadata>\n`;

    trips.forEach(trip => {
        const train = trip.train || trip.checkin || trip.properties?.train || trip.properties?.checkin || {};
        const polyline = (trip.geometry?.coordinates && trip.geometry.coordinates.length >= 2) ? trip : train.polyline;
        const coords = polyline?.geometry?.coordinates;
        if (!Array.isArray(coords) || coords.length < 2) return;

        const line = train.lineName || train.number || train.name || trip.properties?.lineName || 'Journey';
        const origin = train.origin?.name || train.origin?.station?.name || trip.properties?.origin || 'Start';
        const dest = train.destination?.name || train.destination?.station?.name || trip.properties?.destination || 'Destination';
        const trkName = `${line}: ${origin} → ${dest}`;
        const trkDesc = `Category: ${train.category || 'Train'}, Operator: ${train.operator?.name || 'Unknown'}, Distance: ${Math.round((train.totalDistance || 0) / 1000)} km`;

        xml += `  <trk>\n`;
        xml += `    <name>${escapeXml(trkName)}</name>\n`;
        xml += `    <desc>${escapeXml(trkDesc)}</desc>\n`;
        xml += `    <type>${escapeXml(train.category || 'rail')}</type>\n`;
        xml += `    <trkseg>\n`;

        // Calculate time interpolation if timestamps exist
        const depStr = train.origin?.departureReal || train.origin?.departurePlanned || train.origin?.departure || trip.createdAt || trip.properties?.actualDeparture || trip.properties?.plannedDeparture;
        const arrStr = train.destination?.arrivalReal || train.destination?.arrivalPlanned || train.destination?.arrival || trip.properties?.actualArrival || trip.properties?.plannedArrival;
        const depMs = depStr ? Date.parse(depStr) : NaN;
        let arrMs = arrStr ? Date.parse(arrStr) : NaN;
        if (isNaN(arrMs) && !isNaN(depMs)) {
            const dur = computeTripDurationMinutes(train) || trip.properties?.durationMinutes;
            if (dur && dur > 0) arrMs = depMs + dur * 60000;
        }

        const hasTimes = !isNaN(depMs) && !isNaN(arrMs) && arrMs > depMs;
        const totalPoints = coords.length;

        coords.forEach((coord, idx) => {
            const lon = coord[0];
            const lat = coord[1];
            const ele = coord[2];
            xml += `      <trkpt lat="${lat}" lon="${lon}">\n`;
            if (typeof ele === 'number') {
                xml += `        <ele>${ele}</ele>\n`;
            }
            if (hasTimes) {
                const fraction = idx / (totalPoints - 1);
                const ptTime = new Date(depMs + Math.round(fraction * (arrMs - depMs))).toISOString();
                xml += `        <time>${ptTime}</time>\n`;
            }
            xml += `      </trkpt>\n`;
        });

        xml += `    </trkseg>\n`;
        xml += `  </trk>\n`;
    });

    xml += `</gpx>\n`;
    return xml;
}

/**
 * Convert an array of Träwelling trips into standard KML 2.2 format for Google Earth / GIS
 * @param {Array} trips Array of trip objects
 * @param {Object} metadata Metadata for header
 * @returns {string} KML XML string
 */
export function tripsToKML(trips = [], metadata = {}) {
    const title = metadata.title || (metadata.username ? `Träwelling Journeys - ${metadata.username}` : 'Träwelling Journeys');

    const escapeXml = (str) => {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    };

    let kml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    kml += `<kml xmlns="http://www.opengis.net/kml/2.2">\n`;
    kml += `  <Document>\n`;
    kml += `    <name>${escapeXml(title)}</name>\n`;

    trips.forEach(trip => {
        const train = trip.train || trip.checkin || trip.properties?.train || trip.properties?.checkin || {};
        const polyline = (trip.geometry?.coordinates && trip.geometry.coordinates.length >= 2) ? trip : train.polyline;
        const coords = polyline?.geometry?.coordinates;
        if (!Array.isArray(coords) || coords.length < 2) return;

        const line = train.lineName || train.number || train.name || trip.properties?.lineName || 'Journey';
        const origin = train.origin?.name || train.origin?.station?.name || trip.properties?.origin || 'Start';
        const dest = train.destination?.name || train.destination?.station?.name || trip.properties?.destination || 'Destination';
        const placemarkName = `${line}: ${origin} → ${dest}`;
        const distanceKm = Math.round((train.totalDistance || trip.properties?.totalDistance || 0) / 100) / 10;
        const departure = train.origin?.departureReal || train.origin?.departurePlanned || trip.properties?.actualDeparture || 'N/A';
        const arrival = train.destination?.arrivalReal || train.destination?.arrivalPlanned || trip.properties?.actualArrival || 'N/A';

        kml += `    <Placemark>\n`;
        kml += `      <name>${escapeXml(placemarkName)}</name>\n`;
        kml += `      <description><![CDATA[`;
        kml += `<b>Line:</b> ${escapeXml(line)}<br>`;
        kml += `<b>Origin:</b> ${escapeXml(origin)}<br>`;
        kml += `<b>Destination:</b> ${escapeXml(dest)}<br>`;
        kml += `<b>Departure:</b> ${escapeXml(departure)}<br>`;
        kml += `<b>Arrival:</b> ${escapeXml(arrival)}<br>`;
        kml += `<b>Distance:</b> ${distanceKm} km<br>`;
        if (trip.id) {
            kml += `<a href="https://traewelling.de/status/${trip.id}">View on Träwelling</a>`;
        }
        kml += `]]></description>\n`;
        kml += `      <LineString>\n`;
        kml += `        <tessellate>1</tessellate>\n`;
        kml += `        <coordinates>\n`;
        const coordStr = coords.map(c => `${c[0]},${c[1]},${c[2] || 0}`).join(' ');
        kml += `          ${coordStr}\n`;
        kml += `        </coordinates>\n`;
        kml += `      </LineString>\n`;
        kml += `    </Placemark>\n`;
    });

    kml += `  </Document>\n`;
    kml += `</kml>\n`;
    return kml;
}

/**
 * Convert an array of Träwelling trips into standard CSV format
 * @param {Array} trips Array of trip objects
 * @returns {string} RFC 4180 CSV string
 */
export function tripsToCSV(trips = []) {
    const columns = [
        'id', 'line', 'category', 'origin', 'destination',
        'planned_departure', 'actual_departure', 'delay_dep_min',
        'planned_arrival', 'actual_arrival', 'delay_arr_min',
        'distance_km', 'duration_min', 'operator', 'platform',
        'seat', 'wagon', 'class', 'ticket', 'business',
        'buddies', 'backend_trip_id', 'notes', 'traewelling_url'
    ];

    const escapeCsv = (val) => {
        if (val === null || val === undefined) return '""';
        return `"${String(val).replace(/"/g, '""')}"`;
    };

    const header = columns.map(escapeCsv).join(',');
    const rows = trips.map(trip => {
        const train = trip.train || trip.checkin || trip.properties?.train || trip.properties?.checkin || {};
        const origin = train.origin || trip.properties?.origin || {};
        const dest = train.destination || trip.properties?.destination || {};
        const delays = deriveDelaySeconds(train);
        const depDelayMin = delays.departure !== null ? formatDelayMinutes(delays.departure) : (trip.properties?.departureDelayMinutes ?? '');
        const arrDelayMin = delays.arrival !== null ? formatDelayMinutes(delays.arrival) : (trip.properties?.arrivalDelayMinutes ?? '');
        const distanceKm = trip.properties?.distanceKm ?? (train.totalDistance ? Math.round(train.totalDistance / 10) / 100 : '');
        const durationMin = computeTripDurationMinutes(train) || trip.properties?.durationMinutes || '';

        const buddiesList = getTripBuddies(trip);
        const buddiesStr = buddiesList.length ? buddiesList.map(b => `@${b.username}`).join(', ') : '';
        const bId = train.trip || train.tripId || trip.trip || trip.backend_trip_id || trip.properties?.backendTripId || trip.properties?.backend_trip_id || '';

        const rowValues = [
            trip.id || '',
            train.lineName || train.number || train.name || trip.properties?.lineName || '',
            normalizeCategory(train.category || trip.properties?.category),
            origin.name || origin.station?.name || (typeof origin === 'string' ? origin : '') || '',
            dest.name || dest.station?.name || (typeof dest === 'string' ? dest : '') || '',
            origin.departurePlanned || train.plannedDeparture || trip.properties?.plannedDeparture || '',
            origin.departureReal || origin.departure || train.departure || trip.properties?.actualDeparture || '',
            depDelayMin,
            dest.arrivalPlanned || train.plannedArrival || trip.properties?.plannedArrival || '',
            dest.arrivalReal || dest.arrival || train.arrival || trip.properties?.actualArrival || '',
            arrDelayMin,
            distanceKm,
            durationMin,
            train.operator?.name || (typeof train.operator === 'string' ? train.operator : '') || trip.properties?.operator || '',
            origin.departurePlatformReal || origin.platform || train.platform || trip.properties?.platform || '',
            train.seat?.number || trip.seat?.number || (typeof train.seat === 'string' ? train.seat : '') || trip.properties?.seat || '',
            train.seat?.wagon || train.wagon || trip.properties?.wagon || '',
            train.class || train.travelClass || trip.properties?.class || '',
            trip.ticket?.name || (typeof trip.ticket === 'string' ? trip.ticket : '') || trip.properties?.ticket || '',
            trip.business === 1 ? 'business' : (trip.business === 2 ? 'commute' : 'private'),
            buddiesStr,
            bId,
            trip.body || trip.message || trip.properties?.message || trip.properties?.body || '',
            trip.id ? `https://traewelling.de/status/${trip.id}` : ''
        ];
        return rowValues.map(escapeCsv).join(',');
    });

    return [header, ...rows].join('\n');
}

/**
 * Convert an array of Träwelling trips into standard JSON format
 * @param {Array} trips Array of trip objects
 * @param {Object} metadata Metadata for header
 * @returns {Object} JSON payload
 */
export function tripsToJSON(trips = [], metadata = {}) {
    return {
        generator: 'Träwelling Map Explorer',
        version: 1,
        exportedAt: new Date().toISOString(),
        username: metadata.username || null,
        tripCount: trips.length,
        trips: trips
    };
}

/**
 * Parse standard CSV text back into trip objects
 * @param {string} csvText CSV formatted string
 * @returns {{ trips: Array, username: string|null }}
 */
export function parseCSVToTrips(csvText) {
    if (!csvText || typeof csvText !== 'string') return { trips: [], username: null };

    // Standard RFC-4180 CSV parser
    const rows = [];
    let currentRow = [];
    let currentCell = '';
    let insideQuotes = false;
    let i = 0;
    const len = csvText.length;

    while (i < len) {
        const char = csvText[i];
        if (insideQuotes) {
            if (char === '"') {
                if (i + 1 < len && csvText[i + 1] === '"') {
                    currentCell += '"';
                    i += 2;
                    continue;
                } else {
                    insideQuotes = false;
                }
            } else {
                currentCell += char;
            }
        } else {
            if (char === '"') {
                insideQuotes = true;
            } else if (char === ',') {
                currentRow.push(currentCell.trim());
                currentCell = '';
            } else if (char === '\n' || char === '\r') {
                if (char === '\r' && i + 1 < len && csvText[i + 1] === '\n') {
                    i++;
                }
                currentRow.push(currentCell.trim());
                if (currentRow.some(c => c.length > 0)) {
                    rows.push(currentRow);
                }
                currentRow = [];
                currentCell = '';
            } else {
                currentCell += char;
            }
        }
        i++;
    }
    if (currentCell.length > 0 || currentRow.length > 0) {
        currentRow.push(currentCell.trim());
        if (currentRow.some(c => c.length > 0)) {
            rows.push(currentRow);
        }
    }

    if (rows.length < 2) return { trips: [], username: null };

    const headers = rows[0].map(h => h.toLowerCase().replace(/[^a-z0-9_]/g, '_'));
    const colIndex = (names) => {
        for (const name of names) {
            const idx = headers.indexOf(name);
            if (idx !== -1) return idx;
        }
        return -1;
    };

    const idIdx = colIndex(['id', 'status_id', 'statusid']);
    const lineIdx = colIndex(['line', 'linename', 'train', 'line_name']);
    const catIdx = colIndex(['category', 'type']);
    const origIdx = colIndex(['origin', 'start', 'from']);
    const destIdx = colIndex(['destination', 'dest', 'to']);
    const depPlannedIdx = colIndex(['planned_departure', 'departure_planned']);
    const depRealIdx = colIndex(['actual_departure', 'departure_real', 'departure', 'departure_time']);
    const arrPlannedIdx = colIndex(['planned_arrival', 'arrival_planned']);
    const arrRealIdx = colIndex(['actual_arrival', 'arrival_real', 'arrival', 'arrival_time']);
    const distIdx = colIndex(['distance_km', 'distance', 'total_distance']);
    const opIdx = colIndex(['operator', 'provider']);
    const platIdx = colIndex(['platform', 'track']);
    const seatIdx = colIndex(['seat']);
    const wagonIdx = colIndex(['wagon', 'coach']);
    const classIdx = colIndex(['class', 'travel_class']);
    const ticketIdx = colIndex(['ticket']);
    const bizIdx = colIndex(['business']);
    const buddiesIdx = colIndex(['buddies', 'fellow_passengers', 'co_passengers']);
    const backendTripIdx = colIndex(['backend_trip_id', 'trip_id', 'tripid', 'trip']);
    const notesIdx = colIndex(['notes', 'message', 'body', 'comment']);
    const origLatIdx = colIndex(['origin_lat', 'orig_lat', 'origin_latitude']);
    const origLonIdx = colIndex(['origin_lon', 'orig_lon', 'origin_longitude', 'orig_lng']);
    const destLatIdx = colIndex(['dest_lat', 'dest_latitude', 'destination_latitude']);
    const destLonIdx = colIndex(['dest_lon', 'dest_longitude', 'destination_longitude', 'dest_lng']);

    const trips = [];
    for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const val = (idx) => (idx !== -1 && idx < row.length ? row[idx] : null);

        const id = val(idIdx) ? (parseInt(val(idIdx), 10) || val(idIdx)) : Date.now() + r;
        const line = val(lineIdx) || 'Unknown';
        const category = normalizeCategory(val(catIdx));
        const originName = val(origIdx) || 'Unknown';
        const destName = val(destIdx) || 'Unknown';
        const depPlanned = val(depPlannedIdx);
        const depReal = val(depRealIdx);
        const arrPlanned = val(arrPlannedIdx);
        const arrReal = val(arrRealIdx);
        const distKm = parseFloat(val(distIdx)) || 0;
        const totalDistanceMeters = Math.round(distKm * 1000);
        const operatorName = val(opIdx);
        const bId = val(backendTripIdx) ? (parseInt(val(backendTripIdx), 10) || val(backendTripIdx)) : null;
        const notes = val(notesIdx) || '';
        const buddiesRaw = val(buddiesIdx);

        let parsedBuddies = [];
        if (buddiesRaw) {
            try {
                if (buddiesRaw.startsWith('[') && buddiesRaw.endsWith(']')) {
                    parsedBuddies = JSON.parse(buddiesRaw);
                } else {
                    parsedBuddies = buddiesRaw.split(',').map(s => s.trim().replace(/^@/, '')).filter(Boolean).map(u => ({ username: u, displayName: u }));
                }
            } catch {
                parsedBuddies = buddiesRaw.split(',').map(s => s.trim().replace(/^@/, '')).filter(Boolean).map(u => ({ username: u, displayName: u }));
            }
        }

        const origLat = parseFloat(val(origLatIdx));
        const origLon = parseFloat(val(origLonIdx));
        const destLat = parseFloat(val(destLatIdx));
        const destLon = parseFloat(val(destLonIdx));
        const hasCoords = !isNaN(origLat) && !isNaN(origLon) && !isNaN(destLat) && !isNaN(destLon);

        const trip = {
            id: id,
            backend_trip_id: bId,
            body: notes,
            createdAt: depReal || depPlanned || new Date().toISOString(),
            business: val(bizIdx) === 'business' || val(bizIdx) === '1' ? 1 : (val(bizIdx) === 'commute' || val(bizIdx) === '2' ? 2 : 0),
            ticket: val(ticketIdx) || null,
            buddies: parsedBuddies,
            train: {
                trip: bId,
                category: category,
                lineName: line,
                totalDistance: totalDistanceMeters,
                distance: totalDistanceMeters,
                origin: {
                    name: originName,
                    departurePlanned: depPlanned,
                    departureReal: depReal,
                    platform: val(platIdx),
                    station: {
                        name: originName,
                        latitude: hasCoords ? origLat : null,
                        longitude: hasCoords ? origLon : null
                    }
                },
                destination: {
                    name: destName,
                    arrivalPlanned: arrPlanned,
                    arrivalReal: arrReal,
                    station: {
                        name: destName,
                        latitude: hasCoords ? destLat : null,
                        longitude: hasCoords ? destLon : null
                    }
                },
                operator: operatorName ? { name: operatorName } : null,
                seat: val(seatIdx) ? { number: val(seatIdx), wagon: val(wagonIdx) } : null,
                wagon: val(wagonIdx) || null,
                class: val(classIdx) || null,
                ticket: val(ticketIdx) ? { name: val(ticketIdx) } : null,
                polyline: hasCoords ? {
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: [[origLon, origLat], [destLon, destLat]]
                    },
                    properties: { statusId: id, isApproximated: true }
                } : null
            }
        };
        trip.checkin = trip.train;
        trips.push(trip);
    }

    return {
        trips,
        username: 'Imported CSV'
    };
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
    const newlyFetched = {};
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
            completedCount += subBatch.length;
        } catch {
            if (subBatch.length > 5) {
                const mid = Math.ceil(subBatch.length / 2);
                await fetchExportBatchDynamic(subBatch.slice(0, mid));
                await fetchExportBatchDynamic(subBatch.slice(mid));
            } else {
                subBatch.forEach(t => {
                    if (!Array.isArray(t.train.stopovers)) t.train.stopovers = [];
                });
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
 * Generic export flow dispatcher
 * @param {'geojson'|'gpx'|'kml'|'csv'|'json'} format Format to export
 * @param {'active'|'all'} scope Which trips to export
 * @param {'download'|'copy'} action Action to perform
 */
export async function exportTrips(format = 'geojson', scope = 'active', action = 'download') {
    const state = store.get();
    let trips = scope === 'all' 
        ? (state.fetchedTrips || []) 
        : (state.activeTrips !== undefined && state.activeTrips !== null ? state.activeTrips : (state.fetchedTrips || []));

    if (scope === 'active') {
        const layerVisibility = new Map();
        if (state.layers?.data) {
            state.layers.data.forEach((layer, id) => {
                layerVisibility.set(id, layer.visible);
            });
        }
        if (layerVisibility.size > 0) {
            trips = trips.filter(trip => {
                const cat = normalizeCategory(trip.train?.category || trip.checkin?.category);
                return layerVisibility.has(cat) ? layerVisibility.get(cat) : true;
            });
        }
    }

    if (!trips.length) {
        alert('No trips available to export with current layer visibility.');
        return;
    }

    const includeStopovers = (document.getElementById('exportIncludeStopovers')?.checked || false) && format === 'geojson';

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

    const dateStr = new Date().toISOString().split('T')[0];
    const username = state.username || 'user';
    const metadata = { username: state.username, scope, title: `Träwelling Journeys - ${username}` };

    if (format === 'geojson') {
        const geojson = tripsToGeoJSON(trips, metadata, { includeStopovers });
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
    } else if (format === 'gpx') {
        const gpx = tripsToGPX(trips, metadata);
        const filename = `traewelling-${username}-${scope}-trips-${dateStr}.gpx`;
        downloadGPXFile(gpx, filename);
        showExportToast(`Downloaded ${trips.length} routes as GPX!`);
    } else if (format === 'kml') {
        const kml = tripsToKML(trips, metadata);
        const filename = `traewelling-${username}-${scope}-trips-${dateStr}.kml`;
        downloadKMLFile(kml, filename);
        showExportToast(`Downloaded ${trips.length} routes as KML!`);
    } else if (format === 'csv') {
        const csv = tripsToCSV(trips, metadata);
        const filename = `traewelling-${username}-${scope}-trips-${dateStr}.csv`;
        downloadCSVFile(csv, filename);
        showExportToast(`Downloaded ${trips.length} journeys as CSV!`);
    } else if (format === 'json') {
        const jsonData = tripsToJSON(trips, metadata);
        const filename = `traewelling-${username}-${scope}-trips-${dateStr}.json`;
        downloadJSONFile(jsonData, filename);
        showExportToast(`Downloaded ${trips.length} journeys as JSON!`);
    }
}

/**
 * Trigger GeoJSON export flow with scope selection (active or all)
 * @param {'active'|'all'} scope Which trips to export
 * @param {'download'|'copy'} action Action to perform
 */
export async function exportTripsGeoJSON(scope = 'active', action = 'download') {
    return exportTrips('geojson', scope, action);
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
    const username = data.username || null;

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
    } else if (data.trips && Array.isArray(data.trips)) {
        return {
            trips: data.trips.filter(t => t && (t.train?.polyline || t.polyline || t.id)),
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
        const backendTripId = p.backend_trip_id || p.backendTripId || p.tripId || null;
        const distanceMeters = typeof p.totalDistance === 'number'
            ? p.totalDistance
            : (typeof p.distanceKm === 'number' ? Math.round(p.distanceKm * 1000) : (p.distance || 0));

        let businessType = 0;
        if (p.business === 'work' || p.business === 1 || p.business === '1' || p.business === 'business') businessType = 1;
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

        const coPassengers = Array.isArray(p.co_passengers) ? p.co_passengers : (Array.isArray(p.coPassengers) ? p.coPassengers : []);
        const bodyMentions = Array.isArray(p.bodyMentions) ? p.bodyMentions : [];
        const buddies = Array.isArray(p.buddies) ? p.buddies : [];

        const trip = {
            id: statusId,
            backend_trip_id: backendTripId,
            body: p.message || p.body || '',
            createdAt: p.createdAt || p.actualDeparture || p.plannedDeparture || new Date().toISOString(),
            business: businessType,
            ticket: p.ticket || null,
            tags: Array.isArray(p.tags) ? p.tags : [],
            buddies: buddies,
            co_passengers: coPassengers,
            bodyMentions: bodyMentions,
            train: {
                trip: backendTripId,
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
 * Handle user uploading or dropping a travel data file (GeoJSON, JSON, or CSV).
 * Automatically converts routes, switches screens, and displays trips on map.
 * @param {File} file The selected file object
 */
export async function handleGeoJSONUpload(file) {
    if (!file) return;

    try {
        const text = await file.text();
        const fileName = (file.name || '').toLowerCase();
        let trips = [];
        let username = null;

        if (fileName.endsWith('.csv') || file.type?.includes('csv')) {
            const parsed = parseCSVToTrips(text);
            trips = parsed.trips;
            username = parsed.username;
        } else {
            let parsed = null;
            try {
                parsed = JSON.parse(text);
            } catch (jsonErr) {
                // If JSON parse fails, attempt CSV fallback
                try {
                    const csvParsed = parseCSVToTrips(text);
                    if (csvParsed.trips && csvParsed.trips.length > 0) {
                        trips = csvParsed.trips;
                        username = csvParsed.username;
                    } else {
                        throw jsonErr;
                    }
                } catch {
                    throw new Error('The selected file is not valid JSON or CSV.');
                }
            }

            if (!trips.length && parsed) {
                const parsedResult = parseGeoJSONToTrips(parsed);
                trips = parsedResult.trips;
                username = parsedResult.username;
            }
        }

        if (!trips || !trips.length) {
            alert('No valid travel routes or polyline features were found in this file.');
            return;
        }

        const state = store.get();
        // Determine clean username from parsed metadata, filename, or fallback
        let rawName = username;
        if (!rawName || rawName === 'Exported Trips' || rawName === 'Imported CSV') {
            const match = file.name.match(/traewelling-([a-zA-Z0-9_\-]+?)-(?:all|filtered|full|trips)/i);
            if (match && match[1]) {
                rawName = match[1];
            } else {
                rawName = file.name.replace(/\.(geojson|json|csv)$/i, '').replace(/[^a-zA-Z0-9_\-]/g, '_');
            }
        }
        const usernameKey = (rawName || 'imported_travels').toLowerCase().trim();
        const displayName = rawName ? (rawName.charAt(0).toUpperCase() + rawName.slice(1)) : 'Imported Travels';

        state.username = usernameKey;
        state.queriedUserProfile = {
            username: usernameKey,
            displayName: displayName,
            avatar: null
        };

        // Transition from setup screen
        if (typeof UI !== 'undefined' && UI.toggleSetup) {
            UI.toggleSetup(false);
            UI.toggleFetch(false);
        }

        // Process, populate layers, and display data on the map
        await processAndDisplayData(trips, { hideFetchUI: true });

        // Save imported trips into SessionDB cache so Rail Wrapped, Trips Database, and persistence work immediately
        try {
            await SessionDB.save(usernameKey, {
                username: usernameKey,
                displayName: displayName,
                avatar: null,
                tripCount: trips.length,
                trips: trips,
                timestamp: Date.now()
            });

            // Restore any co-passengers attached to the imported trips
            for (const trip of trips) {
                const bId = trip.backend_trip_id || trip.train?.trip;
                if (bId && Array.isArray(trip.co_passengers) && trip.co_passengers.length > 0) {
                    await SessionDB.saveTripCoPassengers(bId, trip.co_passengers).catch(() => {});
                }
            }

            if (typeof updateMenuAccountList === 'function') {
                updateMenuAccountList();
            }
        } catch (dbErr) {
            console.warn('Could not cache imported trips in SessionDB:', dbErr);
        }

        showExportToast(`Loaded ${trips.length} routes from ${file.name}!`);
    } catch (err) {
        console.error('Error importing file:', err);
        alert(`Failed to import file: ${err.message || 'Unknown error'}`);
    }
}
