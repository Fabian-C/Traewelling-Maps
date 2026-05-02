// Math utilities

/**
 * Clamp a value between min and max
 */
export function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

/**
 * Get particle count based on route length
 */
export function getRouteParticleCount(lengthKm) {
    if (!Number.isFinite(lengthKm) || lengthKm <= 0) return 1;
    if (lengthKm >= 360) return 4;
    if (lengthKm >= 220) return 3;
    if (lengthKm >= 120) return 2;
    return 1;
}

/**
 * Get line width based on delay minutes
 */
export function getDelayWidth(delayMinutes) {
    const base = 2.5;
    const extra = Math.min(6, Math.max(0, delayMinutes * 0.25));
    return base + extra;
}
