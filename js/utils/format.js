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
