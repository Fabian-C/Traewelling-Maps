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

export function computeHaversineKm(lon1, lat1, lon2, lat2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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

export function extractRouteCoordinates(trip, sampleCount = null) {
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

    // Always preserve full authentic coordinate resolution unless caller explicitly requests resampling
    if (valid.length >= 2) {
        if (typeof sampleCount === 'number' && sampleCount > 0) {
            return resampleCoordinatesByDistance(valid, sampleCount);
        }
        return valid;
    }

    const orig = checkin?.origin?.station || checkin?.origin || {};
    const dest = checkin?.destination?.station || checkin?.destination || {};
    const lon1 = Number(orig.longitude ?? orig.lon ?? orig.lng);
    const lat1 = Number(orig.latitude ?? orig.lat);
    const lon2 = Number(dest.longitude ?? dest.lon ?? dest.lng);
    const lat2 = Number(dest.latitude ?? dest.lat);

    if (Number.isFinite(lon1) && Number.isFinite(lat1) && Number.isFinite(lon2) && Number.isFinite(lat2)) {
        const curved = [];
        const steps = typeof sampleCount === 'number' && sampleCount > 0 ? Math.min(80, sampleCount) : 64;
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

    // Pre-compile Path2D for full route to eliminate per-frame point iteration loops
    let path2D = null;
    if (typeof Path2D !== 'undefined' && points.length >= 2) {
        path2D = new Path2D();
        path2D.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            path2D.lineTo(points[i].x, points[i].y);
        }
    }

    // Sample along the single trip: overview + vehicle chase zoom to collect trajectory detail tiles
    const trajectoryTileMap = new Map();
    const overTiles = getVisibleTilesForViewport({
        baseScene: { z: chosenZ, originWX, originWY },
        camTargetX: centerWX - originWX,
        camTargetY: centerWY - originWY,
        camZoom: fitScale,
        width: viewportWidth,
        height: viewportHeight
    }).tiles;
    overTiles.forEach(t => trajectoryTileMap.set(t.key, t));

    const chaseZoom = fitScale * 2.2;
    const sampleSteps = Math.min(24, Math.max(8, points.length));
    for (let i = 0; i <= sampleSteps; i++) {
        const pt = getXYAtDistance(points, cumDist, (i / sampleSteps) * totalPathPx);
        const vTiles = getVisibleTilesForViewport({
            baseScene: { z: chosenZ, originWX, originWY },
            camTargetX: pt.x,
            camTargetY: pt.y,
            camZoom: chaseZoom,
            width: viewportWidth,
            height: viewportHeight
        }).tiles;
        vTiles.forEach(t => trajectoryTileMap.set(t.key, t));
    }
    const detailTiles = Array.from(trajectoryTileMap.values()).filter(t => t.z > chosenZ);

    return {
        z: chosenZ,
        originWX,
        originWY,
        tiles,
        detailTiles,
        points,
        path2D,
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
    if (!points || !points.length) return { x: 0, y: 0, index: 0 };
    if (points.length === 1 || !cumDist || cumDist.length < 2) {
        return { x: points[0].x, y: points[0].y, index: 0 };
    }

    const maxDist = cumDist[cumDist.length - 1] || 0;
    const clamped = Math.max(0, Math.min(maxDist, distPx));

    // Fast binary search: O(log N) instead of O(N) linear scan
    let low = 0;
    let high = cumDist.length - 2;
    let idx = 0;

    while (low <= high) {
        const mid = (low + high) >> 1;
        if (cumDist[mid + 1] <= clamped) {
            low = mid + 1;
        } else if (cumDist[mid] > clamped) {
            high = mid - 1;
        } else {
            idx = mid;
            break;
        }
    }
    if (low > high) {
        idx = Math.max(0, Math.min(cumDist.length - 2, high));
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

/**
 * Compute visible Web Mercator tile keys and boundaries for a given canvas viewport.
 * Based on standard Web Mercator tiling projection.
 */
export function getVisibleTilesForViewport({
    baseScene,
    camTargetX,
    camTargetY,
    camZoom,
    width = 960,
    height = 960,
    minZ = 2,
    maxZ = 16
}) {
    if (!baseScene || typeof baseScene.z !== 'number') return { tileZ: 6, effectiveZ: 6, tiles: [] };

    // Continuous Web Mercator zoom level of the viewport:
    // When baseScene is at baseScene.z and camera scales by camZoom:
    const effectiveZ = baseScene.z + Math.log2(Math.max(0.001, camZoom));
    const tileZ = Math.max(minZ, Math.min(maxZ, Math.round(effectiveZ)));

    const scaleToBase = Math.pow(2, tileZ - baseScene.z);
    const maxTileIdx = Math.pow(2, tileZ);

    // Viewport center in world coordinates at tileZ:
    const worldCenterX = (camTargetX + baseScene.originWX) * scaleToBase;
    const worldCenterY = (camTargetY + baseScene.originWY) * scaleToBase;

    // Screen scale factor relative to tileZ world pixels:
    const screenScale = camZoom * Math.pow(2, baseScene.z - tileZ);
    // Add 16px safety margin around viewport edges so edge tiles never flicker
    const halfSpanX = (width / 2 + 16) / Math.max(0.001, screenScale);
    const halfSpanY = (height / 2 + 16) / Math.max(0.001, screenScale);

    const minTX = Math.floor((worldCenterX - halfSpanX) / 256);
    const maxTX = Math.floor((worldCenterX + halfSpanX) / 256);
    const minTY = Math.floor((worldCenterY - halfSpanY) / 256);
    const maxTY = Math.floor((worldCenterY + halfSpanY) / 256);

    const tiles = [];
    for (let tx = minTX; tx <= maxTX; tx++) {
        for (let ty = minTY; ty <= maxTY; ty++) {
            if (ty < 0 || ty >= maxTileIdx) continue;
            const wrappedX = ((tx % maxTileIdx) + maxTileIdx) % maxTileIdx;
            tiles.push({
                key: `${tileZ}-${wrappedX}-${ty}`,
                z: tileZ,
                x: wrappedX,
                y: ty,
                left: (tx * 256) / scaleToBase - baseScene.originWX,
                top: (ty * 256) / scaleToBase - baseScene.originWY,
                size: 256 / scaleToBase
            });
        }
    }

    return { tileZ, effectiveZ, tiles };
}

export function samplePointAlongRoute(scene, progress) {
    const { points, cumDist, totalPathPx } = scene;
    if (!points.length) return { x: 0, y: 0, angleRad: 0, index: 0 };
    if (points.length === 1) return { x: points[0].x, y: points[0].y, angleRad: 0, index: 0 };

    const targetDist = Math.max(0, Math.min(1, progress)) * totalPathPx;
    const pos = getXYAtDistance(points, cumDist, targetDist);

    // Adaptive lookahead window:
    // Scales down smoothly with route length so short city rides accurately follow street corners
    // and track curves without freezing or under-rotating, while long rail journeys retain silky smooth tangent gliding.
    const windowPx = Math.min(20, Math.max(0.4, totalPathPx * 0.035));
    const ahead1 = getXYAtDistance(points, cumDist, Math.min(totalPathPx, targetDist + windowPx * 0.5));
    const behind1 = getXYAtDistance(points, cumDist, Math.max(0, targetDist - windowPx * 0.5));
    const ahead2 = getXYAtDistance(points, cumDist, Math.min(totalPathPx, targetDist + windowPx));
    const behind2 = getXYAtDistance(points, cumDist, Math.max(0, targetDist - windowPx));

    let dx = (ahead1.x - behind1.x) * 0.65 + (ahead2.x - behind2.x) * 0.35;
    let dy = (ahead1.y - behind1.y) * 0.65 + (ahead2.y - behind2.y) * 0.35;

    // Fallback to local segment tangent if ahead/behind collapse
    if (Math.hypot(dx, dy) < 0.0001) {
        const segIdx = Math.min(points.length - 2, Math.max(0, Math.floor(pos.index)));
        dx = points[segIdx + 1].x - points[segIdx].x;
        dy = points[segIdx + 1].y - points[segIdx].y;
    }

    const angleRad = Math.atan2(dy, dx);
    return { x: pos.x, y: pos.y, angleRad, index: pos.index };
}

/**
 * Organic cinematic camera chase filter:
 * Allows subtle natural movement (~5-10% off-center) along curves and speed changes
 * while applying a soft tanh saturation clamp and 5-point Gaussian smoothing
 * to eliminate high-frequency GPS track giggle without introducing hard jitter.
 */
export function sampleSmoothedCameraTarget(scene, progress) {
    const { points, cumDist, totalPathPx, centerSceneX, centerSceneY, fitScale = 1.0 } = scene;
    if (!points || !points.length) return { x: centerSceneX || 0, y: centerSceneY || 0 };

    const clampedProg = Math.max(0, Math.min(1, progress));
    const targetDist = clampedProg * totalPathPx;
    const vehiclePt = getXYAtDistance(points, cumDist, targetDist);

    // Continuous 5-point Gaussian filter window along track
    const filterSpan = Math.min(80, Math.max(12, totalPathPx * 0.04));
    const pMinus1 = getXYAtDistance(points, cumDist, Math.max(0, targetDist - filterSpan));
    const pMinusHalf = getXYAtDistance(points, cumDist, Math.max(0, targetDist - filterSpan * 0.5));
    const pPlusHalf = getXYAtDistance(points, cumDist, Math.min(totalPathPx, targetDist + filterSpan * 0.5));
    const pPlus1 = getXYAtDistance(points, cumDist, Math.min(totalPathPx, targetDist + filterSpan));

    const rawSmoothX = vehiclePt.x * 0.36 + (pMinusHalf.x + pPlusHalf.x) * 0.24 + (pMinus1.x + pPlus1.x) * 0.08;
    const rawSmoothY = vehiclePt.y * 0.36 + (pMinusHalf.y + pPlusHalf.y) * 0.24 + (pMinus1.y + pPlus1.y) * 0.08;

    const dx = rawSmoothX - vehiclePt.x;
    const dy = rawSmoothY - vehiclePt.y;
    const driftDist = Math.hypot(dx, dy);

    // Soft-saturation clamp: allows subtle natural drift up to ~10% off-center,
    // using smooth C-infinity tanh curve so hard velocity kinks/jitter are mathematically impossible.
    const maxDrift = Math.min(48 / Math.max(0.01, fitScale), Math.max(8, totalPathPx * 0.08));

    if (driftDist > 0.0001) {
        const softDist = maxDrift * Math.tanh(driftDist / maxDrift);
        const scale = softDist / driftDist;
        return {
            x: vehiclePt.x + dx * scale,
            y: vehiclePt.y + dy * scale
        };
    }

    return { x: vehiclePt.x, y: vehiclePt.y };
}

/**
 * Single-arc C2-continuous camera zoom multiplier:
 * - Frame 0..48: Zoom IN from full-route overview (0.98x) to close chase zoom (2.15x)
 * - Frame 48..152: Hold close chase zoom along the track (gentle 2.15x -> 2.00x)
 * - Frame 152..212: Zoom OUT to full-route finale overview (0.94x)
 */
export function computeCameraZoomMultiplier(frame) {
    if (frame <= 48) {
        const t = smootherstep(0, 48, frame);
        return 0.98 + (2.15 - 0.98) * t;
    }
    if (frame <= 152) {
        const t = smootherstep(48, 152, frame);
        return 2.15 + (2.00 - 2.15) * t;
    }
    const t = smootherstep(152, 212, frame);
    return 2.00 + (0.94 - 2.00) * t;
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

/**
 * Sort trips chronologically from oldest to newest for mode=all historical replay.
 */
export function sortTripsChronologically(trips = []) {
    if (!Array.isArray(trips)) return [];
    const getTs = (t) => {
        const c = t?.checkin || t?.train || {};
        const raw = c.origin?.departureReal || c.origin?.departurePlanned || t?.createdAt || '';
        const parsed = raw ? Date.parse(raw) : NaN;
        return Number.isFinite(parsed) ? parsed : 0;
    };
    return [...trips].sort((a, b) => {
        const ta = getTs(a);
        const tb = getTs(b);
        if (ta !== tb) return ta - tb;
        return (Number(a?.id) || 0) - (Number(b?.id) || 0);
    });
}

/**
 * Build a unified Web Mercator scene covering an entire historical dataset of trips.
 */
export function buildAllTripsScene(trips = [], viewportWidth = 960, viewportHeight = 960, fps = 30) {
    const sorted = sortTripsChronologically(trips);
    const allCoords = [];
    const rawRides = sorted.map((trip) => {
        // Always preserve full resolution coordinates so connecting stations and transfers line up with 100% precision
        const coords = extractRouteCoordinates(trip);
        coords.forEach(pt => allCoords.push(pt));
        const checkin = trip?.checkin || trip?.train || {};
        const rawDist = typeof checkin.distance === 'number'
            ? checkin.distance
            : (typeof checkin.totalDistance === 'number' ? checkin.totalDistance : (trip?.distance || 0));
        const distanceKm = rawDist > 0 ? rawDist / 1000 : computePolylineHaversineKm(coords);
        return { trip, coords, distanceKm };
    });

    const baseScene = buildMapScene(
        allCoords.length ? allCoords : [[13.3695, 52.5255]],
        viewportWidth,
        viewportHeight
    );

    let runningKm = 0;
    const minSpanBasePx = 160 * Math.pow(2, baseScene.z - 13.5);
    const usableW = viewportWidth * 0.62;
    const usableH = (viewportHeight - 184) * 0.60;

    // Step 1: Pre-calculate ride geometries, bounds, and natural ideal zoom
    const rideInfos = rawRides.map(({ trip, coords, distanceKm }) => {
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        let minLon = Infinity;
        let maxLon = -Infinity;
        let minLat = Infinity;
        let maxLat = -Infinity;

        const points = coords.map(([lon, lat]) => {
            const x = lonToWorldX(lon, baseScene.z) - baseScene.originWX;
            const y = latToWorldY(lat, baseScene.z) - baseScene.originWY;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            if (lon < minLon) minLon = lon;
            if (lon > maxLon) maxLon = lon;
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
            return { x, y, lon, lat };
        });

        const cumDist = [0];
        for (let i = 1; i < points.length; i++) {
            const dx = points[i].x - points[i - 1].x;
            const dy = points[i].y - points[i - 1].y;
            cumDist.push(cumDist[i - 1] + Math.hypot(dx, dy));
        }
        const totalPathPx = Math.max(1, cumDist[cumDist.length - 1]);
        const startKm = runningKm;
        runningKm += distanceKm;

        let path2D = null;
        if (typeof Path2D !== 'undefined' && points.length >= 2) {
            path2D = new Path2D();
            path2D.moveTo(points[0].x, points[0].y);
            for (let i = 1; i < points.length; i++) {
                path2D.lineTo(points[i].x, points[i].y);
            }
        }

        const spanX = Math.max(minSpanBasePx, (maxX - minX) * 1.30);
        const spanY = Math.max(minSpanBasePx, (maxY - minY) * 1.30);
        const rideCenterX = Number.isFinite(minX) ? (minX + maxX) / 2 : baseScene.centerSceneX;
        const rideCenterY = Number.isFinite(minY) ? (minY + maxY) / 2 : baseScene.centerSceneY;
        const idealRideZoom = Math.min(usableW / spanX, usableH / spanY);
        const centerLon = Number.isFinite(minLon) ? (minLon + maxLon) / 2 : 13.37;
        const centerLat = Number.isFinite(minLat) ? (minLat + maxLat) / 2 : 52.52;

        return {
            trip,
            coords,
            points,
            path2D,
            cumDist,
            totalPathPx,
            distanceKm,
            startKm,
            endKm: runningKm,
            rideCenterX,
            rideCenterY,
            idealRideZoom,
            minLon,
            maxLon,
            minLat,
            maxLat,
            centerLon,
            centerLat
        };
    });

    // Step 2: Deep city zoom calculation with 3-point temporal smoothing
    // City rides zoom in deeply so streets, stations, and routes are clearly visible.
    // Temporal smoothing avoids momentary spikes while maintaining intimate city views.
    const maxAllowedCityZoom = Math.min(96, Math.pow(2, Math.max(2.0, 13.5 - baseScene.z)));
    const rawZooms = rideInfos.map((info) => {
        return Math.min(
            maxAllowedCityZoom,
            Math.max(baseScene.fitScale * 1.05, info.idealRideZoom)
        );
    });

    const smoothedZooms = rawZooms.map((z, idx) => {
        const prev = idx > 0 ? rawZooms[idx - 1] : z;
        const next = idx < rawZooms.length - 1 ? rawZooms[idx + 1] : z;
        const logZ = 0.25 * Math.log(prev) + 0.50 * Math.log(z) + 0.25 * Math.log(next);
        return Math.exp(logZ);
    });

    // Step 3: Adaptive ride duration schedule (2x slower replay for clear readability and smooth pacing)
    // Regional and long-distance trains get extra time to traverse the landscape without rushing.
    // If the zoom level between consecutive rides is vastly different, extra transition frames are granted.
    let currentTimelineFrame = 0;
    const rideSchedules = rideInfos.map((info, i) => {
        const dKm = info.distanceKm;
        const z = smoothedZooms[i];
        const prevZ = i > 0 ? smoothedZooms[i - 1] : z;
        const zoomRatio = Math.max(z / prevZ, prevZ / z);

        let f = 40;
        if (dKm > 300) {
            f = 100; // Long distance ICE across country (was 50)
        } else if (dKm > 80) {
            f = 72; // Regional train crossing state (was 36)
        } else if (dKm > 25) {
            f = 52; // Outer suburban / regional (was 26)
        }

        if (zoomRatio > 1.8) {
            const extraZoomFrames = Math.min(48, Math.round(Math.log2(zoomRatio) * 10));
            f += extraZoomFrames;
        }

        const startFrame = currentTimelineFrame;
        currentTimelineFrame += f;
        const endFrame = currentTimelineFrame;
        return {
            durationFrames: f,
            startFrame,
            endFrame,
            rideZoom: z
        };
    });

    const rides = rideInfos.map((info, idx) => ({
        trip: info.trip,
        coords: info.coords,
        points: info.points,
        cumDist: info.cumDist,
        totalPathPx: info.totalPathPx,
        distanceKm: info.distanceKm,
        startKm: info.startKm,
        endKm: info.endKm,
        rideCenterX: info.rideCenterX,
        rideCenterY: info.rideCenterY,
        startZoom: idx === 0 ? baseScene.fitScale : smoothedZooms[idx - 1],
        endZoom: smoothedZooms[idx],
        targetZoom: smoothedZooms[idx],
        rideZoom: smoothedZooms[idx],
        durationFrames: rideSchedules[idx].durationFrames,
        startFrame: rideSchedules[idx].startFrame,
        endFrame: rideSchedules[idx].endFrame
    }));

    // Step 4: Register trajectory tiles along the camera path across all rides for preloading
    const trajectoryTileMap = new Map();
    // 1. Overview tiles
    const overTiles = getVisibleTilesForViewport({
        baseScene,
        camTargetX: baseScene.centerSceneX,
        camTargetY: baseScene.centerSceneY,
        camZoom: baseScene.fitScale * 0.95,
        width: viewportWidth,
        height: viewportHeight
    }).tiles;
    overTiles.forEach(t => trajectoryTileMap.set(t.key, t));

    // 2. Sample along each ride at its actual target zoom:
    rides.forEach(ride => {
        const z = ride.rideZoom;
        const steps = ride.distanceKm > 100 ? 5 : (ride.distanceKm > 30 ? 4 : 3);
        for (let s = 0; s <= steps; s++) {
            const p = s / steps;
            const pt = samplePointAlongRoute(ride, p);
            const vTiles = getVisibleTilesForViewport({
                baseScene,
                camTargetX: pt.x,
                camTargetY: pt.y,
                camZoom: z,
                width: viewportWidth,
                height: viewportHeight
            }).tiles;
            vTiles.forEach(t => {
                if (!trajectoryTileMap.has(t.key) && trajectoryTileMap.size < 600) {
                    trajectoryTileMap.set(t.key, t);
                }
            });
        }
    });

    const detailTiles = Array.from(trajectoryTileMap.values())
        .filter(t => t.z > baseScene.z)
        .sort((a, b) => a.z - b.z);
    const travelTotalFrames = currentTimelineFrame;
    const finaleTransitionFrames = Math.round(fps * 1.5); // 45 frames (1.5s zoom-out)
    const finaleStaticHoldFrames = Math.round(fps * 3.0); // 90 frames (3s static hold)
    const finaleFrames = finaleTransitionFrames + finaleStaticHoldFrames; // 135 frames
    const totalFrames = travelTotalFrames + finaleFrames;

    return {
        ...baseScene,
        detailTiles,
        rides,
        totalDistanceKm: runningKm,
        travelTotalFrames,
        finaleTransitionFrames,
        finaleStaticHoldFrames,
        finaleFrames,
        totalFrames
    };
}

/**
 * Compute adaptive frame timing for mode=all so every ride is traversed sequentially.
 */
export function computeAllModeTiming(tripsOrCount = 1, fps = 30) {
    if (Array.isArray(tripsOrCount)) {
        const scene = buildAllTripsScene(tripsOrCount, 960, 960, fps);
        return {
            tripCount: tripsOrCount.length,
            framesPerTrip: Math.round(scene.travelTotalFrames / Math.max(1, tripsOrCount.length)),
            finaleFrames: scene.finaleFrames,
            finaleTransitionFrames: scene.finaleTransitionFrames,
            finaleStaticHoldFrames: scene.finaleStaticHoldFrames,
            travelTotalFrames: scene.travelTotalFrames,
            totalFrames: scene.totalFrames
        };
    }

    const count = Math.max(1, Number(tripsOrCount) || 1);
    let avgFrames = 96;
    if (count > 300) avgFrames = 24;
    else if (count > 120) avgFrames = 32;
    else if (count > 45) avgFrames = 44;
    else if (count > 12) avgFrames = 60;

    const finaleTransitionFrames = Math.round(fps * 1.5); // 45 frames (1.5s zoom-out)
    const finaleStaticHoldFrames = Math.round(fps * 3.0); // 90 frames (3 seconds static hold)
    const finaleFrames = finaleTransitionFrames + finaleStaticHoldFrames; // 135 frames total finale
    const travelTotalFrames = count * avgFrames;
    const totalFrames = Math.max(240, travelTotalFrames + finaleFrames);
    return {
        tripCount: count,
        framesPerTrip: avgFrames,
        finaleFrames,
        finaleTransitionFrames,
        finaleStaticHoldFrames,
        travelTotalFrames,
        totalFrames
    };
}


