/**
 * Pure Web Mercator Projection, Route Resampling, & Camera Smoothing Math
 * Zero external runtime dependencies so all functions can be unit-tested in Node/Vitest.
 */

export function lonToWorldX(lon, z) {
    const scale = 256 * Math.pow(2, z);
    return ((lon + 180) / 360) * scale;
}

export function latToWorldY(lat, z) {
    const scale = 256 * Math.pow(2, z);
    const clampedLat = Math.max(-85.0511, Math.min(85.0511, lat));
    const latRad = (clampedLat * Math.PI) / 180;
    return ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale;
}

export function computePolylineHaversineKm(coords) {
    if (!Array.isArray(coords) || coords.length < 2) return 0;
    const R = 6371;
    let totalKm = 0;
    for (let i = 1; i < coords.length; i++) {
        const [lon1, lat1] = coords[i - 1];
        const [lon2, lat2] = coords[i];
        const dLat = ((lat2 - lat1) * Math.PI) / 180;
        const dLon = ((lon2 - lon1) * Math.PI) / 180;
        const a = Math.sin(dLat / 2) ** 2
            + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
        totalKm += 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
    return totalKm;
}

/**
 * Resample polyline by uniform arc-length so dense station switch vertices
 * and long straight segments have smooth, consistent spacing.
 */
export function resampleCoordinatesByDistance(coords, sampleCount = 180) {
    if (!Array.isArray(coords) || coords.length < 2) return coords || [];
    const dists = [0];
    for (let i = 1; i < coords.length; i++) {
        const dx = coords[i][0] - coords[i - 1][0];
        const dy = coords[i][1] - coords[i - 1][1];
        dists.push(dists[i - 1] + Math.hypot(dx, dy));
    }
    const totalLen = dists[dists.length - 1];
    if (totalLen <= 1e-7) return coords;

    const out = [];
    let segIdx = 0;
    for (let s = 0; s <= sampleCount; s++) {
        const target = (s / sampleCount) * totalLen;
        while (segIdx < dists.length - 2 && dists[segIdx + 1] < target) {
            segIdx++;
        }
        const d0 = dists[segIdx];
        const d1 = dists[segIdx + 1];
        const t = d1 > d0 ? (target - d0) / (d1 - d0) : 0;
        const [x0, y0] = coords[segIdx];
        const [x1, y1] = coords[segIdx + 1];
        out.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
    }
    return out;
}

export function extractRouteCoordinates(trip) {
    const checkin = trip?.checkin || trip?.train || {};
    const poly = checkin?.polyline || trip?.polyline;
    let rawCoords = [];

    if (poly?.geometry?.coordinates && Array.isArray(poly.geometry.coordinates)) {
        rawCoords = poly.geometry.coordinates;
    } else if (Array.isArray(poly?.coordinates)) {
        rawCoords = poly.coordinates;
    } else if (Array.isArray(poly)) {
        rawCoords = poly;
    }

    const valid = rawCoords.filter(
        c => Array.isArray(c) && c.length >= 2 && Number.isFinite(Number(c[0])) && Number.isFinite(Number(c[1]))
    ).map(c => [Number(c[0]), Number(c[1])]);

    if (valid.length >= 2) {
        return resampleCoordinatesByDistance(valid, 180);
    }

    const orig = checkin?.origin?.station || checkin?.origin || {};
    const dest = checkin?.destination?.station || checkin?.destination || {};
    const lon1 = Number(orig.longitude ?? orig.lon ?? orig.lng);
    const lat1 = Number(orig.latitude ?? orig.lat);
    const lon2 = Number(dest.longitude ?? dest.lon ?? dest.lng);
    const lat2 = Number(dest.latitude ?? dest.lat);

    if (Number.isFinite(lon1) && Number.isFinite(lat1) && Number.isFinite(lon2) && Number.isFinite(lat2)) {
        const curved = [];
        const steps = 80;
        const dLon = lon2 - lon1;
        const dLat = lat2 - lat1;
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const arc = Math.sin(t * Math.PI) * 0.06;
            curved.push([
                lon1 + dLon * t - dLat * arc,
                lat1 + dLat * t + dLon * arc
            ]);
        }
        return curved;
    }

    return [
        [10.0069, 53.5533],
        [11.68, 53.04],
        [13.3695, 52.5255]
    ];
}

export function buildMapScene(coords, viewportWidth = 960, viewportHeight = 960) {
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;

    coords.forEach(([lon, lat]) => {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
    });

    if (!Number.isFinite(minLon) || (Math.abs(maxLon - minLon) < 0.0005 && Math.abs(maxLat - minLat) < 0.0005)) {
        minLon = Number.isFinite(minLon) ? minLon - 0.02 : 13.34;
        maxLon = Number.isFinite(maxLon) ? maxLon + 0.02 : 13.40;
        minLat = Number.isFinite(minLat) ? minLat - 0.015 : 52.51;
        maxLat = Number.isFinite(maxLat) ? maxLat + 0.015 : 52.55;
    }

    // Reserve top 120px for HUD header and bottom 64px for station pills/watermark
    const usableW = viewportWidth * 0.62;
    const usableH = (viewportHeight - 184) * 0.60;

    let chosenZ = 7;
    for (let z = 15; z >= 4; z--) {
        const w = Math.abs(lonToWorldX(maxLon, z) - lonToWorldX(minLon, z));
        const h = Math.abs(latToWorldY(minLat, z) - latToWorldY(maxLat, z));
        if (w <= usableW && h <= usableH) {
            chosenZ = z;
            break;
        }
    }

    const minWX = lonToWorldX(minLon, chosenZ);
    const maxWX = lonToWorldX(maxLon, chosenZ);
    const minWY = latToWorldY(maxLat, chosenZ);
    const maxWY = latToWorldY(minLat, chosenZ);

    const centerWX = (minWX + maxWX) / 2;
    const centerWY = (minWY + maxWY) / 2;

    const routeBoundsW = Math.max(80, maxWX - minWX);
    const routeBoundsH = Math.max(80, maxWY - minWY);
    const fitScale = Math.min(
        1.48,
        Math.max(0.75, Math.min(usableW / routeBoundsW, usableH / routeBoundsH))
    );

    const minCamZoom = Math.max(0.65, fitScale * 0.90);
    const halfSpanX = Math.max(
        viewportWidth * 0.78,
        (maxWX - minWX) * 0.50 + (viewportWidth * 0.56) / minCamZoom
    );
    const halfSpanY = Math.max(
        viewportHeight * 0.78,
        (maxWY - minWY) * 0.50 + (viewportHeight * 0.56) / minCamZoom
    );

    const startTileX = Math.floor((centerWX - halfSpanX) / 256) - 1;
    const endTileX = Math.floor((centerWX + halfSpanX) / 256) + 1;
    const startTileY = Math.floor((centerWY - halfSpanY) / 256) - 1;
    const endTileY = Math.floor((centerWY + halfSpanY) / 256) + 1;

    const originWX = startTileX * 256;
    const originWY = startTileY * 256;
    const sceneWidth = (endTileX - startTileX + 1) * 256;
    const sceneHeight = (endTileY - startTileY + 1) * 256;

    const maxTileIdx = Math.pow(2, chosenZ);
    const tiles = [];
    for (let tx = startTileX; tx <= endTileX; tx++) {
        for (let ty = startTileY; ty <= endTileY; ty++) {
            if (ty < 0 || ty >= maxTileIdx) continue;
            const wrappedX = ((tx % maxTileIdx) + maxTileIdx) % maxTileIdx;
            tiles.push({
                key: `${chosenZ}-${tx}-${ty}`,
                z: chosenZ,
                x: wrappedX,
                y: ty,
                left: (tx - startTileX) * 256,
                top: (ty - startTileY) * 256
            });
        }
    }

    const points = coords.map(([lon, lat]) => ({
        x: lonToWorldX(lon, chosenZ) - originWX,
        y: latToWorldY(lat, chosenZ) - originWY,
        lon,
        lat
    }));

    const cumDist = [0];
    for (let i = 1; i < points.length; i++) {
        const dx = points[i].x - points[i - 1].x;
        const dy = points[i].y - points[i - 1].y;
        cumDist.push(cumDist[i - 1] + Math.hypot(dx, dy));
    }
    const totalPathPx = Math.max(1, cumDist[cumDist.length - 1]);

    return {
        z: chosenZ,
        originWX,
        originWY,
        tiles,
        points,
        cumDist,
        totalPathPx,
        sceneWidth,
        sceneHeight,
        centerSceneX: centerWX - originWX,
        centerSceneY: centerWY - originWY,
        fitScale
    };
}

export function smootherstep(edge0, edge1, x) {
    const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(0.0001, edge1 - edge0)));
    return t * t * t * (t * (t * 6 - 15) + 10);
}

export function getXYAtDistance(points, cumDist, distPx) {
    const clamped = Math.max(0, Math.min(cumDist[cumDist.length - 1], distPx));
    let idx = 0;
    while (idx < cumDist.length - 2 && cumDist[idx + 1] < clamped) {
        idx++;
    }
    const d0 = cumDist[idx];
    const d1 = cumDist[idx + 1];
    const segLen = Math.max(0.0001, d1 - d0);
    const t = Math.max(0, Math.min(1, (clamped - d0) / segLen));
    const p0 = points[idx];
    const p1 = points[idx + 1];
    return {
        x: p0.x + (p1.x - p0.x) * t,
        y: p0.y + (p1.y - p0.y) * t,
        index: idx + t
    };
}

export function samplePointAlongRoute(scene, progress) {
    const { points, cumDist, totalPathPx } = scene;
    if (!points.length) return { x: 0, y: 0, angleRad: 0, index: 0 };
    if (points.length === 1) return { x: points[0].x, y: points[0].y, angleRad: 0, index: 0 };

    const targetDist = Math.max(0, Math.min(1, progress)) * totalPathPx;
    const pos = getXYAtDistance(points, cumDist, targetDist);

    const windowPx = Math.min(32, Math.max(8, totalPathPx * 0.065));
    const b2 = getXYAtDistance(points, cumDist, targetDist - windowPx);
    const b1 = getXYAtDistance(points, cumDist, targetDist - windowPx * 0.5);
    const a1 = getXYAtDistance(points, cumDist, targetDist + windowPx * 0.5);
    const a2 = getXYAtDistance(points, cumDist, targetDist + windowPx);
    const dx = (a1.x - b1.x) * 0.65 + (a2.x - b2.x) * 0.35;
    const dy = (a1.y - b1.y) * 0.65 + (a2.y - b2.y) * 0.35;
    const angleRad = Math.atan2(dy, dx);

    return { x: pos.x, y: pos.y, angleRad, index: pos.index };
}

/**
 * Low-pass spatial filter for the camera target along the route so track bends
 * never cause lateral camera shake.
 */
export function sampleSmoothedCameraTarget(scene, progress) {
    const { points, cumDist, totalPathPx, centerSceneX, centerSceneY } = scene;
    if (!points.length) return { x: centerSceneX, y: centerSceneY };

    const offsets = [-0.10, -0.05, 0, 0.05, 0.10];
    const weights = [0.15, 0.22, 0.26, 0.22, 0.15];
    let sumX = 0;
    let sumY = 0;

    for (let i = 0; i < offsets.length; i++) {
        const p = Math.max(0, Math.min(1, progress + offsets[i]));
        const pt = getXYAtDistance(points, cumDist, p * totalPathPx);
        sumX += pt.x * weights[i];
        sumY += pt.y * weights[i];
    }

    return {
        x: sumX * 0.86 + centerSceneX * 0.14,
        y: sumY * 0.86 + centerSceneY * 0.14
    };
}

/**
 * Multi-phase C2-continuous camera zoom multiplier:
 * - Frame 0..52: Zoom IN from full-route overview (0.98x) to close departure chase (2.20x)
 * - Frame 52..108: Zoom OUT to mid-journey regional overview (1.22x)
 * - Frame 108..154: Zoom IN for destination approach (2.05x)
 * - Frame 154..212: Zoom OUT to full-route finale overview (0.94x)
 */
export function computeCameraZoomMultiplier(frame) {
    if (frame <= 52) {
        const t = smootherstep(0, 52, frame);
        return 0.98 + (2.20 - 0.98) * t;
    }
    if (frame <= 108) {
        const t = smootherstep(52, 108, frame);
        return 2.20 + (1.22 - 2.20) * t;
    }
    if (frame <= 154) {
        const t = smootherstep(108, 154, frame);
        return 1.22 + (2.05 - 1.22) * t;
    }
    const t = smootherstep(154, 212, frame);
    return 2.05 + (0.94 - 2.05) * t;
}

export function shortenStationName(name) {
    if (!name) return '';
    return String(name)
        .replace(/\s*\(Berlin\)/gi, '')
        .replace(/\s*,\s*Berlin$/gi, '')
        .replace(/\s*Bhf$/gi, '')
        .trim();
}

export function getContrastingTextColor(hexColor, explicitTextColor) {
    if (explicitTextColor) {
        const clean = String(explicitTextColor).replace(/^#/, '').trim();
        if (/^[0-9a-fA-F]{6}$/.test(clean) && clean.toLowerCase() !== '000000') {
            return `#${clean}`;
        }
    }
    const hex = String(hexColor || '').replace(/^#/, '').trim();
    if (/^[0-9a-fA-F]{6}$/.test(hex)) {
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return luminance > 0.66 ? '#0f172a' : '#ffffff';
    }
    return '#ffffff';
}
