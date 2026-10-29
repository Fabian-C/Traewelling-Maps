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
    { id: 'custom', label: 'Custom Date Range…' }
];

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
 * Filter an array of trips by a preset timeframe or custom date boundary [from, to].
 * @param {Array} trips
 * @param {string} timeframe - 'all' | 'today' | 'last-7-days' | 'this-week' | 'last-week' | 'this-month' | 'last-30-days' | 'this-year' | 'custom'
 * @param {string} [customFrom] - 'YYYY-MM-DD'
 * @param {string} [customTo] - 'YYYY-MM-DD'
 * @param {Date} [referenceDate] - Base reference date (defaults to new Date())
 * @returns {Array} Filtered trips
 */
export function filterTripsByTimeframe(
    trips = [],
    timeframe = 'all',
    customFrom = '',
    customTo = '',
    referenceDate = new Date()
) {
    if (!Array.isArray(trips) || trips.length === 0) return [];
    if (!timeframe || timeframe === 'all') return [...trips];

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
            if (customFrom) {
                const f = new Date(`${customFrom}T00:00:00`);
                if (!Number.isNaN(f.getTime())) startMs = f.getTime();
            }
            if (customTo) {
                const t = new Date(`${customTo}T23:59:59.999`);
                if (!Number.isNaN(t.getTime())) endMs = t.getTime();
            }
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
export function getTimeframeLabel(timeframe = 'all', customFrom = '', customTo = '') {
    if (timeframe === 'custom') {
        if (customFrom && customTo) return `${customFrom} → ${customTo}`;
        if (customFrom) return `Since ${customFrom}`;
        if (customTo) return `Until ${customTo}`;
        return 'Custom Range';
    }
    const match = TIMEFRAME_PRESETS.find((p) => p.id === timeframe);
    return match ? match.label : 'All Time';
}

