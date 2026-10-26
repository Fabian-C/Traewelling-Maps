// Formatting and ID generation utilities

/**
 * Build a unique key from route endpoints
 */
export function buildEndpointKey(coords) {
    if (!coords || coords.length < 2) return null;
    const start = coords[0];
    const end = coords[coords.length - 1];
    return `${start[0].toFixed(3)},${start[1].toFixed(3)}-${end[0].toFixed(3)},${end[1].toFixed(3)}`;
}

/**
 * Generate a unique line ID for a route
 */
export function getRouteLineId(feature, fallbackCategory) {
    const props = feature?.properties || {};
    const train = props.train || {};
    const line = train.lineName || train.number || train.name;
    const originName = train.origin?.name || train.origin?.station?.name;
    const destName = train.destination?.name || train.destination?.station?.name;
    if (line && (originName || destName)) return `${line}|${originName || 'start'}|${destName || 'end'}`;
    if (line) return line.toString();
    if (props.statusId) return `status-${props.statusId}`;
    return fallbackCategory || 'unknown';
}

/**
 * Format delay seconds to minutes
 */
export function formatDelayMinutes(seconds) {
    if (!Number.isFinite(seconds)) return null;
    return Math.max(0, Math.round(seconds / 60));
}

/**
 * Safely escape HTML characters to prevent XSS
 */
export function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Format a trip duration into a human-friendly string (e.g. "45m", "2h 15m", "1d 4h")
 * @param {number|null} minutes
 * @returns {string}
 */
export function formatHumanDuration(minutes) {
    if (!Number.isFinite(minutes) || minutes === null || minutes === undefined) return '—';
    const totalMins = Math.round(minutes);
    if (totalMins < 0) return '—';
    if (totalMins < 60) return `${totalMins}m`;

    const days = Math.floor(totalMins / 1440);
    const remainingMins = totalMins % 1440;
    const hours = Math.floor(remainingMins / 60);
    const mins = remainingMins % 60;

    if (days > 0) {
        return mins > 0 ? `${days}d ${hours}h ${mins}m` : `${days}d ${hours}h`;
    }
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

/**
 * Format aggregate travel time into intuitive multi-unit representations
 * @param {number} totalHours
 * @returns {{ primary: string, secondary: string, tooltip: string, days: number, months: string }}
 */
export function formatTotalTime(totalHours) {
    const hours = Math.max(0, Math.round(totalHours));
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    const months = (days / 30.44).toFixed(1);

    if (days < 1) {
        return {
            primary: `${hours.toLocaleString()} hrs`,
            secondary: 'on tracks',
            tooltip: `${hours.toLocaleString()} total hours`,
            days,
            months
        };
    }

    return {
        primary: `${days.toLocaleString()}d ${remHours}h`,
        secondary: `~${months} months (${hours.toLocaleString()} hrs)`,
        tooltip: `${days.toLocaleString()} days, ${remHours} hours • Total: ${hours.toLocaleString()} hrs`,
        days,
        months
    };
}

/**
 * Calculate CO2 emission savings of rail journey compared to average passenger car (142g CO2/km)
 * @param {number} distanceKm
 * @returns {{ kg: number, tonnes: string, label: string }}
 */
export function calculateCO2Saved(distanceKm) {
    const km = Math.max(0, Number(distanceKm) || 0);
    // Average savings: ~142 grams CO2 per passenger-kilometer (EEA / DB Umweltbilanz)
    const kg = Math.round(km * 0.142);
    const tonnes = (kg / 1000).toFixed(1);
    const label = kg >= 1000 ? `${tonnes} tonnes CO₂ saved` : `${kg.toLocaleString()} kg CO₂ saved`;
    return { kg, tonnes, label };
}

/**
 * Format average speed in km/h
 * @param {number} distanceKm
 * @param {number} durationMinutes
 * @returns {string}
 */
export function formatSpeed(distanceKm, durationMinutes) {
    if (!distanceKm || !durationMinutes || durationMinutes <= 0) return '—';
    const hours = durationMinutes / 60;
    const speed = Math.round(distanceKm / hours);
    return speed > 0 && speed < 500 ? `${speed} km/h` : '—';
}

/**
 * Shift an ISO date string or timestamp by an offset in milliseconds
 * @param {string|Date} dateInput
 * @param {number} deltaMs
 * @returns {string} ISO timestamp
 */
export function shiftIsoTimestamp(dateInput, deltaMs) {
    if (!dateInput) return '';
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) return '';
    const shifted = new Date(date.getTime() + deltaMs);
    return shifted.toISOString();
}


