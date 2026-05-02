// Color utilities

/**
 * Convert hex color to RGB array
 */
export function hexToRgbArray(hex) {
    if (!hex) return [255, 255, 255];
    const normalized = hex.replace('#', '');
    const value = normalized.length === 3
        ? normalized.split('').map(ch => ch + ch).join('')
        : normalized.padEnd(6, '0');
    const intVal = parseInt(value, 16);
    if (Number.isNaN(intVal)) return [255, 255, 255];
    return [
        (intVal >> 16) & 255,
        (intVal >> 8) & 255,
        intVal & 255
    ];
}

/**
 * Get delay color based on delay minutes
 */
export function getDelayColor(delayMinutes, alpha = 255) {
    const gradients = [
        { min: 45, color: [98, 0, 23] },     // near-massive disruptions
        { min: 35, color: [150, 0, 31] },    // extreme delays
        { min: 25, color: [229, 57, 53] },   // severe delays
        { min: 18, color: [255, 111, 0] },   // heavy delays
        { min: 12, color: [255, 179, 0] },   // noticeable delays
        { min: 7,  color: [255, 214, 0] },   // moderate delays
        { min: 3,  color: [129, 199, 132] }  // low delays
    ];
    for (const stop of gradients) {
        if (delayMinutes >= stop.min) {
            const [r, g, b] = stop.color;
            return [r, g, b, alpha];
        }
    }
    return [76, 175, 80, alpha]; // default for minimal/no delay
}
