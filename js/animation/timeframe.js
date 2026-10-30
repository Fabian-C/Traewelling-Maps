/**
 * Timeframe Presets & Date Filtering for Journey Animations
 */

export const TIMEFRAME_PRESETS = [
    { id: 'all', label: 'All Time' },
    { id: 'today', label: 'Today / Last 24 Hours' },
    { id: 'last-7-days', label: 'Last 7 Days' },
    { id: 'this-week', label: 'This Week' },
    { id: 'last-week', label: 'Last Week' },
    { id: 'this-month', label: 'This Month' },
    { id: 'last-30-days', label: 'Last 30 Days' },
    { id: 'this-year', label: 'This Year' },
    { id: 'custom', label: 'Custom Date & Time Range…' }
];

export function parseDateTimeBoundary(dateStr, timeStr = '', isEnd = false) {
    if (!dateStr && !timeStr) return null;
    let cleanDate = String(dateStr || '').trim();
    let cleanTime = String(timeStr || '').trim();

    // Check if cleanDate contains time (e.g. 'YYYY-MM-DDTHH:mm' or 'YYYY-MM-DD HH:mm')
    if (cleanDate.includes('T')) {
        const parts = cleanDate.split('T');
        cleanDate = parts[0];
        if (!cleanTime) cleanTime = parts[1];
    } else if (cleanDate.includes(' ')) {
        const parts = cleanDate.split(' ');
        cleanDate = parts[0];
        if (!cleanTime) cleanTime = parts[1];
    }

    if (!cleanDate) return null;

    if (cleanTime) {
        const timeParts = cleanTime.split(':');
        const hh = String(timeParts[0] || '00').padStart(2, '0');
        const mm = String(timeParts[1] || '00').padStart(2, '0');
        let ss = '00.000';
        if (isEnd) {
            ss = timeParts[2] ? String(timeParts[2]).padStart(2, '0') : '59.999';
        } else if (timeParts[2]) {
            ss = String(timeParts[2]).padStart(2, '0');
        }
        const dt = new Date(`${cleanDate}T${hh}:${mm}:${ss}`);
        if (!Number.isNaN(dt.getTime())) return dt.getTime();
    }

    if (isEnd) {
        const dt = new Date(`${cleanDate}T23:59:59.999`);
        return Number.isNaN(dt.getTime()) ? null : dt.getTime();
    } else {
        const dt = new Date(`${cleanDate}T00:00:00.000`);
        return Number.isNaN(dt.getTime()) ? null : dt.getTime();
    }
}

export function getTripTimestamp(trip) {
    const checkin = trip?.checkin || trip?.train || {};
    const raw = checkin.origin?.departureReal
        || checkin.origin?.departurePlanned
        || trip?.createdAt
        || checkin.createdAt
        || '';
    const ts = raw ? Date.parse(raw) : NaN;
    return Number.isFinite(ts) ? ts : 0;
}

/**
 * Filter an array of trips by a preset timeframe or custom date boundary [from, to] with optional time ranges.
 * @param {Array} trips
 * @param {string} timeframe - 'all' | 'today' | 'last-7-days' | 'this-week' | 'last-week' | 'this-month' | 'last-30-days' | 'this-year' | 'custom'
 * @param {string|Object} [customFrom] - 'YYYY-MM-DD' or options object { from, to, fromTime, toTime }
 * @param {string} [customTo] - 'YYYY-MM-DD'
 * @param {Date} [referenceDate] - Base reference date (defaults to new Date())
 * @param {string} [customFromTime] - Optional start time 'HH:mm'
 * @param {string} [customToTime] - Optional end time 'HH:mm'
 * @returns {Array} Filtered trips
 */
export function filterTripsByTimeframe(
    trips = [],
    timeframe = 'all',
    customFrom = '',
    customTo = '',
    referenceDate = new Date(),
    customFromTime = '',
    customToTime = ''
) {
    if (!Array.isArray(trips) || trips.length === 0) return [];
    if (!timeframe || timeframe === 'all') return [...trips];

    if (typeof customFrom === 'object' && customFrom !== null) {
        const opts = customFrom;
        customFrom = opts.from || '';
        customTo = opts.to || '';
        customFromTime = opts.fromTime || opts.startTime || '';
        customToTime = opts.toTime || opts.endTime || '';
        if (opts.referenceDate) referenceDate = opts.referenceDate;
    }

    const ref = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
    const refMs = ref.getTime();

    let startMs = null;
    let endMs = null;

    switch (timeframe) {
        case 'today':
        case 'last-24h':
            startMs = refMs - 24 * 60 * 60 * 1000;
            break;

        case 'last-7-days':
            startMs = refMs - 7 * 24 * 60 * 60 * 1000;
            break;

        case 'this-week': {
            // Monday 00:00:00 local time to now
            const day = (ref.getDay() + 6) % 7; // 0 for Mon, 6 for Sun
            const mon = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - day, 0, 0, 0, 0);
            startMs = mon.getTime();
            break;
        }

        case 'last-week': {
            const day = (ref.getDay() + 6) % 7;
            const thisMon = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - day, 0, 0, 0, 0);
            const prevMon = new Date(thisMon.getTime() - 7 * 24 * 60 * 60 * 1000);
            startMs = prevMon.getTime();
            endMs = thisMon.getTime() - 1;
            break;
        }

        case 'this-month': {
            const startOfMonth = new Date(ref.getFullYear(), ref.getMonth(), 1, 0, 0, 0, 0);
            startMs = startOfMonth.getTime();
            break;
        }

        case 'last-30-days':
            startMs = refMs - 30 * 24 * 60 * 60 * 1000;
            break;

        case 'this-year': {
            const startOfYear = new Date(ref.getFullYear(), 0, 1, 0, 0, 0, 0);
            startMs = startOfYear.getTime();
            break;
        }

        case 'custom': {
            startMs = parseDateTimeBoundary(customFrom, customFromTime, false);
            endMs = parseDateTimeBoundary(customTo, customToTime, true);
            break;
        }

        default:
            return [...trips];
    }

    return trips.filter((trip) => {
        const ts = getTripTimestamp(trip);
        if (!ts) return false;
        if (startMs !== null && ts < startMs) return false;
        if (endMs !== null && ts > endMs) return false;
        return true;
    });
}

/**
 * Format a human-readable label for the active timeframe.
 */
export function getTimeframeLabel(timeframe = 'all', customFrom = '', customTo = '', customFromTime = '', customToTime = '') {
    if (typeof customFrom === 'object' && customFrom !== null) {
        const opts = customFrom;
        customFrom = opts.from || '';
        customTo = opts.to || '';
        customFromTime = opts.fromTime || opts.startTime || '';
        customToTime = opts.toTime || opts.endTime || '';
    }
    if (timeframe === 'custom') {
        const fromStr = customFrom ? `${customFrom}${customFromTime ? ` ${customFromTime}` : ''}` : '';
        const toStr = customTo ? `${customTo}${customToTime ? ` ${customToTime}` : ''}` : '';
        if (fromStr && toStr) return `${fromStr} → ${toStr}`;
        if (fromStr) return `Since ${fromStr}`;
        if (toStr) return `Until ${toStr}`;
        return 'Custom Range';
    }
    const match = TIMEFRAME_PRESETS.find((p) => p.id === timeframe);
    return match ? match.label : 'All Time';
}

