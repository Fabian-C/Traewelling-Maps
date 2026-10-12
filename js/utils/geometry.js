// Geometry and coordinate utilities

/**
 * Get tap tolerance in pixels based on device type and map zoom level.
 * High zoom levels (zoomed in) require a generous pixel tolerance, especially
 * on touch devices where fingers cover ~30-44px.
 */
export function getTapTolerancePx(zoom = null) {
    const isTouch = (typeof window !== 'undefined') && (
        window.matchMedia?.('(pointer: coarse)').matches ||
        window.innerWidth <= 768 ||
        (navigator.maxTouchPoints > 0)
    );

    // If zoom is not provided, try to read current map zoom if available
    let currentZoom = zoom;
    if (currentZoom === null && typeof window !== 'undefined') {
        try {
            const map = window._activeMapInstance || (window.store?.get?.()?.map);
            if (map?.getZoom) currentZoom = map.getZoom();
        } catch (_) {}
    }

    // Base tolerance for touch vs pointer
    const baseTol = isTouch ? 36 : 16;
    if (currentZoom == null) return baseTol;

    // When zoomed in (z12 to z20), lines are visually thicker or tracks are spread out,
    // so ensure tolerance is at least 32-44px on mobile and 18-28px on desktop.
    if (currentZoom >= 14) {
        return isTouch ? 44 : 24;
    } else if (currentZoom >= 10) {
        return isTouch ? 38 : 20;
    }
    return baseTol;
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
