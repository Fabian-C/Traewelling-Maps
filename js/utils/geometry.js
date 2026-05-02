// Geometry and coordinate utilities

/**
 * Get tap tolerance in pixels based on device type
 */
export function getTapTolerancePx() {
    return window.matchMedia?.('(pointer: coarse)').matches || window.innerWidth <= 768 ? 12 : 10;
}

/**
 * Snap a point to the nearest position on a line using turf.js
 */
export function snapLngLatToLine(lngLat, featureOrGeometry) {
    if (!lngLat || !featureOrGeometry || !window.turf) return null;
    const geometry = featureOrGeometry.geometry || featureOrGeometry;
    if (geometry?.type !== 'LineString' || !Array.isArray(geometry.coordinates)) return null;
    try {
        const coords = geometry.coordinates;
        const nearest = turf.nearestPointOnLine(
            turf.lineString(coords),
            [lngLat.lng, lngLat.lat],
            { units: 'kilometers' }
        );
        const nearestCoords = nearest?.geometry?.coordinates;
        if (!nearestCoords) return null;
        const snappedPoint = turf.point(nearestCoords);
        let closestVertex = null;
        let bestDistance = Infinity;
        coords.forEach(coord => {
            const vertexPoint = turf.point(coord);
            const distance = turf.distance(snappedPoint, vertexPoint, { units: 'kilometers' });
            if (distance < bestDistance) {
                bestDistance = distance;
                closestVertex = coord;
            }
        });
        if (closestVertex) {
            return { lng: closestVertex[0], lat: closestVertex[1] };
        }
        return { lng: nearestCoords[0], lat: nearestCoords[1] };
    } catch (error) {
        console.warn('Failed to snap point to line:', error);
    }
    return null;
}

/**
 * Compute route length in kilometers from coordinates
 */
export function computeRouteLengthKm(coords) {
    if (!coords || coords.length < 2) return 0;
    let total = 0;
    for (let i = 0; i < coords.length - 1; i++) {
        const dx = (coords[i + 1][0] - coords[i][0]) * 111.32;
        const dy = (coords[i + 1][1] - coords[i][1]) * 110.54;
        total += Math.sqrt(dx * dx + dy * dy);
    }
    return total;
}
