/**
 * Normalizer and entity extractor for relational storage in Traewelling Maps.
 * Converts upstream hierarchical trip check-ins into normalized relational entities:
 * - stations
 * - trips (line runs)
 * - statuses (user check-ins)
 */
import { normalizeCategory, getTripBusinessType } from '../data/processing.js';
import { deriveDelaySeconds, computeTripDurationMinutes } from '../utils/time.js';

/**
 * Derive a stable unique station ID from a station object.
 * Checks for numeric ID, EVA/IBNR numbers, or generates a stable normalized string key.
 * @param {Object} stationObj Station or location container
 * @returns {string|number|null} Unique station identifier
 */
export function getStationId(stationObj) {
    if (!stationObj || typeof stationObj !== 'object') return null;
    const stn = stationObj.station || stationObj;
    if (stn.id !== undefined && stn.id !== null && stn.id !== '') return stn.id;
    if (stn.ibnr !== undefined && stn.ibnr !== null && stn.ibnr !== '') return stn.ibnr;
    if (stn.eva !== undefined && stn.eva !== null && stn.eva !== '') return stn.eva;
    if (stn.eva_number !== undefined && stn.eva_number !== null && stn.eva_number !== '') return stn.eva_number;
    const name = (stn.name || stationObj.name || '').trim();
    if (name) {
        return 'stn_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    }
    return null;
}

/**
 * Extract normalized station record
 * @param {Object} stationObj Station object
 * @returns {Object|null} Normalized station row
 */
export function extractStation(stationObj) {
    if (!stationObj || typeof stationObj !== 'object') return null;
    const stn = stationObj.station || stationObj;
    const id = getStationId(stationObj);
    if (!id) return null;
    const name = (stn.name || stationObj.name || '').trim();
    const lat =
        typeof stn.latitude === 'number'
            ? stn.latitude
            : typeof stationObj.latitude === 'number'
              ? stationObj.latitude
              : null;
    const lon =
        typeof stn.longitude === 'number'
            ? stn.longitude
            : typeof stationObj.longitude === 'number'
              ? stationObj.longitude
              : null;
    const eva = stn.eva_number || stn.eva || stn.ibnr || stationObj.eva_number || stationObj.ibnr || null;
    return {
        id,
        name: name || 'Unknown',
        latitude: lat,
        longitude: lon,
        eva_number: eva ? String(eva) : null,
        country_code: stn.country_code || stationObj.country_code || null
    };
}

/**
 * Normalize a single raw check-in / trip object into relational components.
 * @param {Object} trip Check-in object from Träwelling API or cache
 * @param {string} username Active username owning this record
 * @returns {{ stations: Object[], tripRun: Object|null, status: Object|null }|null}
 */
export function normalizeTrip(trip, username = '') {
    if (!trip || typeof trip !== 'object') return null;
    const train = trip.train || trip.checkin || trip.properties?.train || trip.properties?.checkin || trip;

    // 1. Extract stations
    const originStationObj = train.origin || {};
    const destStationObj = train.destination || {};
    const originStn = extractStation(originStationObj);
    const destStn = extractStation(destStationObj);

    const stations = [];
    if (originStn) stations.push(originStn);
    if (destStn && destStn.id !== originStn?.id) stations.push(destStn);

    // 2. Extract trip line run
    const lineName = train.lineName || train.number || train.name || 'Unknown';
    const category = normalizeCategory(train.category || 'regional');
    const operator = train.operator?.name || train.operator || 'Unknown';
    const tripRunId =
        train.tripId ||
        train.hafasId ||
        train.journeyId ||
        `${lineName}_${originStn?.id || 'orig'}_${destStn?.id || 'dest'}`;
    const polyline = train.polyline || trip.polyline || null;

    const tripRun = {
        id: String(tripRunId),
        line_name: lineName,
        train_number: train.number ? String(train.number) : null,
        category: category,
        operator_name: typeof operator === 'string' ? operator : operator.name || 'Unknown',
        origin_station_id: originStn ? originStn.id : null,
        destination_station_id: destStn ? destStn.id : null,
        polyline: polyline
    };

    // 3. Extract check-in status
    const depTime =
        originStationObj.departureReal ||
        originStationObj.departurePlanned ||
        originStationObj.departure ||
        train.departure ||
        train.plannedDeparture ||
        trip.createdAt ||
        '';
    const arrTime =
        destStationObj.arrivalReal ||
        destStationObj.arrivalPlanned ||
        destStationObj.arrival ||
        train.arrival ||
        train.plannedArrival ||
        '';

    const delays = deriveDelaySeconds(trip);
    const depDelayMin = Math.round((delays.departure !== null ? delays.departure : delays.worst || 0) / 60);
    const arrDelayMin = Math.round((delays.arrival !== null ? delays.arrival : delays.worst || 0) / 60);

    const distanceMeters = (typeof train.totalDistance === 'number' ? train.totalDistance : train.distance) || 0;
    const distanceKm = Math.round((distanceMeters / 1000) * 10) / 10;

    const durationMin = computeTripDurationMinutes(trip) || 0;
    const businessType = getTripBusinessType(trip) || 'private';

    const statusId = trip.id ? Number(trip.id) : Date.now();
    const status = {
        id: statusId,
        username: String(username).toLowerCase(),
        trip_id: String(tripRunId),
        origin_id: originStn ? originStn.id : null,
        destination_id: destStn ? destStn.id : null,
        departure_time: depTime,
        arrival_time: arrTime,
        departure_delay: depDelayMin,
        arrival_delay: arrDelayMin,
        distance_km: distanceKm,
        duration_min: durationMin,
        business_type: businessType,
        body: typeof trip.body === 'string' ? trip.body : '',
        created_at: trip.createdAt || depTime || new Date().toISOString()
    };

    return { stations, tripRun, status };
}
