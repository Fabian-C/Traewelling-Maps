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

    // Base tolerance for touch vs pointer when zoomed out (50% smaller than before to prevent accidental clicks)
    const baseTol = isTouch ? 18 : 8;
    if (currentZoom == null) return baseTol;

    // When zoomed in (z10 to z20), lines and tracks are visually spread out,
    // so provide a comfortable tapping target on mobile and precision on desktop.
    if (currentZoom >= 14) {
        return isTouch ? 36 : 20;
    } else if (currentZoom >= 10) {
        return isTouch ? 26 : 14;
    } else if (currentZoom >= 6) {
        return isTouch ? 18 : 8;
    }
    // Deep zoom out (< z6) continental scale: very compact margin
    return isTouch ? 14 : 6;
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
