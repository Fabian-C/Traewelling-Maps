// @ts-check
import { deriveDelaySeconds, computeTripDurationMinutes } from '../utils/time.js';
import { getTripBuddies } from './formatters.js';

/**
 * Sort raw SQL result rows in-place by a specific column using Schwartzian key extraction.
 * @param {Array<Record<string, any>>} rows
 * @param {string | null} column
 * @param {'asc' | 'desc'} [direction='asc']
 * @returns {Array<Record<string, any>>}
 */
export function sortRawSqlRows(rows, column, direction = 'asc') {
    if (!column || !Array.isArray(rows) || rows.length < 2) return rows;
    const isDesc = direction === 'desc';
    rows.sort((a, b) => {
        const valA = a[column];
        const valB = b[column];
        if (valA === valB) return 0;
        if (valA === null || valA === undefined || valA === '') return 1;
        if (valB === null || valB === undefined || valB === '') return -1;

        if (typeof valA === 'number' && typeof valB === 'number') {
            return isDesc ? valB - valA : valA - valB;
        }
        const numA = Number(valA);
        const numB = Number(valB);
        if (!Number.isNaN(numA) && !Number.isNaN(numB) && typeof valA !== 'boolean' && typeof valB !== 'boolean') {
            return isDesc ? numB - numA : numA - numB;
        }
        return isDesc
            ? String(valB).localeCompare(String(valA))
            : String(valA).localeCompare(String(valB));
    });
    return rows;
}

/**
 * Extract a single sort key for a trip record (O(1) per trip via Schwartzian transform).
 * @param {any} item
 * @param {string} field
 * @param {string | undefined} activeUsername
 * @returns {number | string | null | undefined}
 */
function extractTripSortKey(item, field, activeUsername) {
    const raw = item._rawTrip || item;
    const train = raw.train || raw.checkin || raw.properties?.train || raw.properties?.checkin || raw.properties || raw || {};

    if (field === 'date') {
        const ts = train.origin?.departureReal || train.origin?.departure || train.departure || raw.createdAt || 0;
        const ms = typeof ts === 'number' ? ts : Date.parse(ts);
        return Number.isFinite(ms) ? ms : 0;
    }
    if (field === 'line') {
        return String(train.lineName || train.number || train.name || item.line || '').toLowerCase();
    }
    if (field === 'origin') {
        return String(train.origin?.name || item.origin || '').toLowerCase();
    }
    if (field === 'destination') {
        return String(train.destination?.name || item.destination || '').toLowerCase();
    }
    if (field === 'dist') {
        return typeof train.totalDistance === 'number' ? train.totalDistance : (train.distance || item.distance_km || 0);
    }
    if (field === 'dur') {
        return item.duration_min !== undefined ? item.duration_min : computeTripDurationMinutes(train);
    }
    if (field === 'delay') {
        return item.delay_arr !== undefined ? item.delay_arr : (deriveDelaySeconds(train).arrival || 0);
    }
    if (field === 'buddies') {
        return item.buddy_count !== undefined ? item.buddy_count : getTripBuddies(raw, activeUsername).length;
    }

    return item[field] !== undefined ? item[field] : (raw[field] !== undefined ? raw[field] : train[field]);
}

/**
 * Sort trips array in-place across all supported fields.
 * Uses a Schwartzian transform so expensive date parsing / delay / buddy extraction
 * runs O(N) times instead of O(N log N) times.
 * @param {Array<any>} trips
 * @param {string} sortBy
 * @param {string} [activeUsername]
 */
export function sortTrips(trips, sortBy, activeUsername) {
    if (!sortBy || !Array.isArray(trips) || trips.length < 2) return;
    const isDesc = sortBy.endsWith('-desc');
    const field = sortBy.replace(/-(asc|desc)$/, '');

    const keyed = new Array(trips.length);
    for (let i = 0; i < trips.length; i++) {
        keyed[i] = { item: trips[i], key: extractTripSortKey(trips[i], field, activeUsername) };
    }

    const isNumericField = field === 'date' || field === 'dist' || field === 'dur' || field === 'delay' || field === 'buddies';
    const isStringField = field === 'line' || field === 'origin' || field === 'destination';

    keyed.sort((a, b) => {
        const valA = a.key;
        const valB = b.key;

        if (isNumericField) {
            return isDesc ? Number(valB) - Number(valA) : Number(valA) - Number(valB);
        }
        if (isStringField) {
            return isDesc
                ? String(valB).localeCompare(String(valA))
                : String(valA).localeCompare(String(valB));
        }

        if (valA === valB) return 0;
        if (valA === null || valA === undefined) return 1;
        if (valB === null || valB === undefined) return -1;

        if (typeof valA === 'number' && typeof valB === 'number') {
            return isDesc ? valB - valA : valA - valB;
        }
        const nA = Number(valA);
        const nB = Number(valB);
        if (!Number.isNaN(nA) && !Number.isNaN(nB) && typeof valA !== 'boolean' && typeof valB !== 'boolean') {
            return isDesc ? nB - nA : nA - nB;
        }
        return isDesc
            ? String(valB).localeCompare(String(valA))
            : String(valA).localeCompare(String(valB));
    });

    for (let i = 0; i < keyed.length; i++) {
        trips[i] = keyed[i].item;
    }
}

/**
 * Format timestamp to HH:mm
 * @param {string | null | undefined} isoStr
 * @returns {string}
 */
export function formatTime(isoStr) {
    if (!isoStr) return '—';
    try {
        const d = new Date(isoStr);
        return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    } catch {
        return '—';
    }
}

/**
 * Trigger a browser file download from string content.
 * @param {string} content
 * @param {string} filename
 * @param {string} mimeType
 */
export function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => {
        try { URL.revokeObjectURL(url); } catch { /* ignore */ }
    }, 1000);
}
