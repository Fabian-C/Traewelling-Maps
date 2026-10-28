/**
 * Animated Journey Video Clip Composition (960x960 1:1 Square)
 * Built around the Träwelling API v1 'checkin' response model.
 * Preloads 100% of required Web Mercator map tiles silently in the background
 * and renders the multi-layer track, real stopovers, vehicles, and HUD onto a 960x960 HTML5 Canvas.
 */

import React from 'https://esm.sh/react@18.3.1';
import htm from 'https://esm.sh/htm@3.1.1';
import {
    useCurrentFrame,
    useVideoConfig,
    spring,
    interpolate,
    AbsoluteFill,
    delayRender,
    continueRender
} from 'https://esm.sh/remotion@4.0.539?deps=react@18.3.1';
import { CONFIG } from '../config/config.js';
import { computeTripDurationMinutes, deriveDelaySeconds } from '../utils/time.js';
import { formatHumanDuration } from '../utils/format.js';

const html = htm.bind(React.createElement);

export const CATEGORY_META = {
    nationalExpress: { label: 'High-Speed Rail', color: '#ff2e55', accent: '#ffffff', vehicle: 'ice' },
    national: { label: 'InterCity', color: '#00c8ff', accent: '#ffffff', vehicle: 'ice' },
    regionalExp: { label: 'Regional Express', color: '#e11d48', accent: '#fecdd3', vehicle: 'train' },
    regional: { label: 'Regional Train', color: '#db2777', accent: '#fbcfe8', vehicle: 'train' },
    suburban: { label: 'S-Bahn', color: '#16a34a', accent: '#bbf7d0', vehicle: 'sbahn' },
    subway: { label: 'U-Bahn', color: '#8c6dab', accent: '#e9d5ff', vehicle: 'ubahn' },
    tram: { label: 'Tram / Streetcar', color: '#06b6d4', accent: '#cffafe', vehicle: 'tram' },
    bus: { label: 'Bus', color: '#22c55e', accent: '#dcfce7', vehicle: 'bus' },
    ferry: { label: 'Ferry', color: '#0284c7', accent: '#e0f2fe', vehicle: 'ferry' },
    plane: { label: 'Flight', color: '#6366f1', accent: '#e0e7ff', vehicle: 'plane' },
    taxi: { label: 'Taxi', color: '#eab308', accent: '#fef9c3', vehicle: 'bus' },
    unknown: { label: 'Transit Journey', color: '#38bdf8', accent: '#e0f2fe', vehicle: 'train' }
};

const SUBDOMAINS = ['a', 'b', 'c'];

/**
 * 7 Curated Map Tile Sets (CORS-enabled for WebM canvas recording)
 */
export const MAP_STYLES = {
    'traewelling-dark': {
        name: 'Träwelling Dark',
        getTileUrl: (z, x, y) => `https://api.mapbox.com/styles/v1/mapbox/dark-v10/tiles/256/${z}/${x}/${y}@2x?access_token=${CONFIG.MAPBOX_TOKEN}`,
        getFallbackUrl: (z, x, y) => `https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/${z}/${y}/${x}`,
        bg: '#11141a',
        isDark: true
    },
    'traewelling-light': {
        name: 'Träwelling Light',
        getTileUrl: (z, x, y) => {
            const sub = SUBDOMAINS[Math.abs(x + y) % SUBDOMAINS.length];
            return `https://${sub}.tile.openstreetmap.fr/hot/${z}/${x}/${y}.png`;
        },
        getFallbackUrl: (z, x, y) => `https://tile.openstreetmap.de/${z}/${x}/${y}.png`,
        bg: '#f5f4f0',
        isDark: false
    },
    'db-light': {
        name: 'Modern Light',
        getTileUrl: (z, x, y) => `https://api.mapbox.com/styles/v1/mapbox/light-v11/tiles/256/${z}/${x}/${y}@2x?access_token=${CONFIG.MAPBOX_TOKEN}`,
        getFallbackUrl: (z, x, y) => `https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/${z}/${y}/${x}`,
        bg: '#eef2f6',
        isDark: false
    },
    'db-dark': {
        name: 'Modern Night',
        getTileUrl: (z, x, y) => `https://api.mapbox.com/styles/v1/mapbox/navigation-night-v1/tiles/256/${z}/${x}/${y}@2x?access_token=${CONFIG.MAPBOX_TOKEN}`,
        getFallbackUrl: (z, x, y) => `https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/256/${z}/${x}/${y}@2x?access_token=${CONFIG.MAPBOX_TOKEN}`,
        bg: '#0c1322',
        isDark: true
    },
    voyager: {
        name: 'Classic Streets',
        getTileUrl: (z, x, y) => `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/${z}/${x}/${y}@2x?access_token=${CONFIG.MAPBOX_TOKEN}`,
        getFallbackUrl: (z, x, y) => `https://tile.openstreetmap.de/${z}/${x}/${y}.png`,
        bg: '#cad2d3',
        isDark: false
    },
    topo: {
        name: 'Rail & Topo',
        getTileUrl: (z, x, y) => `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/tiles/256/${z}/${x}/${y}@2x?access_token=${CONFIG.MAPBOX_TOKEN}`,
        getFallbackUrl: (z, x, y) => {
            const sub = SUBDOMAINS[Math.abs(x + y) % SUBDOMAINS.length];
            return `https://${sub}.tile-cyclosm.openstreetmap.fr/cyclosm/${z}/${x}/${y}.png`;
        },
        bg: '#e6e4dd',
        isDark: false
    },
    'osm-de': {
        name: 'Free OSM Rail',
        getTileUrl: (z, x, y) => `https://tile.openstreetmap.de/${z}/${x}/${y}.png`,
        getFallbackUrl: (z, x, y) => {
            const sub = SUBDOMAINS[Math.abs(x + y) % SUBDOMAINS.length];
            return `https://${sub}.tile.openstreetmap.fr/osmfr/${z}/${x}/${y}.png`;
        },
        bg: '#ebe9e1',
        isDark: false
    }
};

// Silent in-memory decoded tile cache
const TILE_IMAGE_CACHE = new Map();
const TILE_PROMISE_CACHE = new Map();

function loadSingleTileImage(primaryUrl, fallbackUrl) {
    if (TILE_IMAGE_CACHE.has(primaryUrl)) {
        return Promise.resolve(TILE_IMAGE_CACHE.get(primaryUrl));
    }
    if (TILE_PROMISE_CACHE.has(primaryUrl)) {
        return TILE_PROMISE_CACHE.get(primaryUrl);
    }

    const promise = new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';

        const finalize = async (loadedImg) => {
            try {
                if (loadedImg && typeof loadedImg.decode === 'function') {
                    await loadedImg.decode();
                }
            } catch {
                // Ignore decode warnings
            }
            if (loadedImg) {
                TILE_IMAGE_CACHE.set(primaryUrl, loadedImg);
            } else {
                TILE_PROMISE_CACHE.delete(primaryUrl);
            }
            resolve(loadedImg);
        };

        img.onload = () => finalize(img);
        img.onerror = () => {
            if (fallbackUrl && fallbackUrl !== primaryUrl) {
                const fbImg = new Image();
                fbImg.crossOrigin = 'anonymous';
                fbImg.onload = () => finalize(fbImg);
                fbImg.onerror = () => finalize(null);
                fbImg.src = fallbackUrl;
            } else {
                finalize(null);
            }
        };
        img.src = primaryUrl;
    });

    TILE_PROMISE_CACHE.set(primaryUrl, promise);
    return promise;
}

/**
 * Preload 100% of Web Mercator tiles required across the trip trajectory
 * before playback or WebM video recording starts.
 */
export async function preloadTripTiles(trip, mapStyle = 'traewelling-dark', width = 960, height = 960, onProgress = null) {
    if (!trip) return { total: 0, loaded: 0 };
    const coords = extractRouteCoordinates(trip);
    const scene = buildMapScene(coords, width, height);
    const styleConfig = MAP_STYLES[mapStyle] || MAP_STYLES['traewelling-dark'];

    const total = scene.tiles.length;
    let loaded = 0;
    if (onProgress) onProgress({ loaded, total });

    await Promise.all(
        scene.tiles.map(async (tile) => {
            const primaryUrl = styleConfig.getTileUrl(scene.z, tile.x, tile.y);
            const fallbackUrl = styleConfig.getFallbackUrl ? styleConfig.getFallbackUrl(scene.z, tile.x, tile.y) : null;
            await loadSingleTileImage(primaryUrl, fallbackUrl);
            loaded += 1;
            if (onProgress) onProgress({ loaded, total });
        })
    );

    return { total, loaded };
}

// Web Mercator projection helpers (Tile size = 256px)
function lonToWorldX(lon, z) {
    const scale = 256 * Math.pow(2, z);
    return ((lon + 180) / 360) * scale;
}

function latToWorldY(lat, z) {
    const scale = 256 * Math.pow(2, z);
    const clampedLat = Math.max(-85.0511, Math.min(85.0511, lat));
    const latRad = (clampedLat * Math.PI) / 180;
    return ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale;
}

function computePolylineHaversineKm(coords) {
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

    // Fallback central Europe coordinates only when trip has no coordinates at all
    return [
        [10.0069, 53.5533],
        [11.68, 53.04],
        [13.3695, 52.5255]
    ];
}

/**
 * Resample polyline by uniform arc-length so dense station switch vertices
 * and long straight segments have smooth, consistent spacing.
 */
function resampleCoordinatesByDistance(coords, sampleCount = 180) {
    if (coords.length < 2) return coords;
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

export function buildMapScene(coords, viewportWidth, viewportHeight) {
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
        minLon -= 0.02;
        maxLon += 0.02;
        minLat -= 0.015;
        maxLat += 0.015;
    }

    // Reserve top 116px for HUD header and bottom 56px for station pills/watermark
    const usableW = viewportWidth * 0.62;
    const usableH = (viewportHeight - 172) * 0.62;

    let chosenZ = 7;
    for (let z = 14; z >= 4; z--) {
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

    const halfSpanX = Math.max(viewportWidth * 0.74, (maxWX - minWX) * 0.90);
    const halfSpanY = Math.max(viewportHeight * 0.74, (maxWY - minWY) * 0.90);

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

    const routeBoundsW = Math.max(80, maxWX - minWX);
    const routeBoundsH = Math.max(80, maxWY - minWY);
    const fitScale = Math.min(
        1.50,
        Math.max(0.75, Math.min(usableW / routeBoundsW, usableH / routeBoundsH))
    );

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

function getXYAtDistance(points, cumDist, distPx) {
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

function smootherstep(edge0, edge1, x) {
    const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(0.0001, edge1 - edge0)));
    return t * t * t * (t * (t * 6 - 15) + 10);
}

function samplePointAlongRoute(scene, progress) {
    const { points, cumDist, totalPathPx } = scene;
    if (!points.length) return { x: 0, y: 0, angleRad: 0, index: 0 };
    if (points.length === 1) return { x: points[0].x, y: points[0].y, angleRad: 0, index: 0 };

    const targetDist = Math.max(0, Math.min(1, progress)) * totalPathPx;
    const pos = getXYAtDistance(points, cumDist, targetDist);

    // Multi-tap Gaussian-smoothed tangent so vehicle rotation is completely fluid around bends
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
function sampleSmoothedCameraTarget(scene, progress) {
    const { points, cumDist, totalPathPx, centerSceneX, centerSceneY } = scene;
    if (!points.length) return { x: centerSceneX, y: centerSceneY };

    const offsets = [-0.14, -0.07, 0, 0.07, 0.14];
    const weights = [0.12, 0.24, 0.28, 0.24, 0.12];
    let sumX = 0;
    let sumY = 0;

    for (let i = 0; i < offsets.length; i++) {
        const p = Math.max(0, Math.min(1, progress + offsets[i]));
        const pt = getXYAtDistance(points, cumDist, p * totalPathPx);
        sumX += pt.x * weights[i];
        sumY += pt.y * weights[i];
    }

    // Blend 28% toward the overall route center even during the chase for gentle, cinematic framing
    return {
        x: sumX * 0.72 + centerSceneX * 0.28,
        y: sumY * 0.72 + centerSceneY * 0.28
    };
}

function shortenStationName(name) {
    if (!name) return '';
    return String(name)
        .replace(/\s*\(Berlin\)/gi, '')
        .replace(/\s*,\s*Berlin$/gi, '')
        .replace(/\s*Bhf$/gi, '')
        .trim();
}

function getContrastingTextColor(hexColor, explicitTextColor) {
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

function drawRoundedRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
}

/**
 * Clean top-down vehicle models without artificial yellow headlight cones.
 */
function drawVehicleOnCanvas(ctx, vehicleType, color, frame) {
    const pulse = Math.sin(frame * 0.35) * 0.5 + 0.5;
    ctx.save();
    ctx.scale(1.22, 1.22);

    if (vehicleType === 'ferry') {
        // Water Wake Ripples
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(-18, -8);
        ctx.lineTo(-38, -20);
        ctx.moveTo(-18, 8);
        ctx.lineTo(-38, 20);
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = 'rgba(224, 242, 254, 0.35)';
        ctx.beginPath();
        ctx.ellipse(-24, 0, 10 + pulse * 4, 6 + pulse * 2, 0, 0, Math.PI * 2);
        ctx.fill();

        // Drop Shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
        ctx.beginPath();
        ctx.moveTo(-22, -6);
        ctx.lineTo(14, -6);
        ctx.lineTo(28, 5);
        ctx.lineTo(14, 16);
        ctx.lineTo(-22, 16);
        ctx.closePath();
        ctx.fill();

        // Ferry Hull (Pointed Bow)
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(-22, -11);
        ctx.lineTo(14, -11);
        ctx.lineTo(28, 0);
        ctx.lineTo(14, 11);
        ctx.lineTo(-22, 11);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Blue Deck & Cabin
        ctx.fillStyle = color;
        drawRoundedRect(ctx, -16, -7, 24, 14, 3);
        ctx.fill();
        ctx.fillStyle = '#e0f2fe';
        drawRoundedRect(ctx, -6, -5, 10, 10, 2);
        ctx.fill();

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(18, 0, 2.5, 0, Math.PI * 2);
        ctx.fill();
    } else if (vehicleType === 'plane') {
        // Jet Contrails
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-22, -5);
        ctx.lineTo(-42, -5);
        ctx.moveTo(-22, 5);
        ctx.lineTo(-42, 5);
        ctx.stroke();

        const planePath = new Path2D(
            'M -22,-12 L -14,0 L -22,12 L -16,12 L -8,3 L 6,3 L 2,26 L 9,26 L 16,3 L 26,3 C 31,3 34,0 34,0 C 34,0 31,-3 26,-3 L 16,-3 L 9,-26 L 2,-26 L 6,-3 L -8,-3 L -16,-12 Z'
        );
        ctx.save();
        ctx.translate(8, 14);
        ctx.scale(0.85, 0.85);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.fill(planePath);
        ctx.restore();

        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.lineJoin = 'round';
        ctx.fill(planePath);
        ctx.stroke(planePath);
    } else if (vehicleType === 'ice') {
        // Drop Shadow
        const shadowPath = new Path2D('M -30,-4 L 16,-4 C 26,-4 32,1 32,5 C 32,9 26,14 16,14 L -30,14 Z');
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.fill(shadowPath);

        // Rear Carriage
        ctx.fillStyle = '#f8fafc';
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 1.5;
        drawRoundedRect(ctx, -32, -9, 22, 18, 3);
        ctx.fill();
        ctx.stroke();

        // Aerodynamic ICE Nose Cone
        const nosePath = new Path2D('M -8,-9 L 16,-9 C 26,-9 33,-4 33,0 C 33,4 26,9 16,9 L -8,9 Z');
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 1.5;
        ctx.fill(nosePath);
        ctx.stroke(nosePath);

        // Iconic Dual Speed Stripes along sides
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-30, -6);
        ctx.lineTo(24, -6);
        ctx.moveTo(-30, 6);
        ctx.lineTo(24, 6);
        ctx.stroke();

        // Cockpit Windshield
        const windPath = new Path2D('M 15,-5 C 21,-5 25,-2 25,0 C 25,2 21,5 15,5 L 12,4 L 12,-4 Z');
        ctx.fillStyle = '#0f172a';
        ctx.fill(windPath);

        // Roof Louvers
        ctx.fillStyle = '#94a3b8';
        drawRoundedRect(ctx, -24, -3, 12, 6, 1.5);
        ctx.fill();
        drawRoundedRect(ctx, -3, -3, 11, 6, 1.5);
        ctx.fill();
    } else {
        // Regional / S-Bahn / U-Bahn / Tram / Bus Vehicle (clean top-down without yellow cone)
        ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
        drawRoundedRect(ctx, -24, -5, 48, 19, 7);
        ctx.fill();

        // Main Train Body
        ctx.fillStyle = color;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5;
        drawRoundedRect(ctx, -24, -9.5, 48, 19, 7);
        ctx.fill();
        ctx.stroke();

        // Roof Panel
        ctx.fillStyle = 'rgba(255, 255, 255, 0.24)';
        drawRoundedRect(ctx, -18, -5.5, 30, 11, 3.5);
        ctx.fill();

        // Front Windshield
        ctx.fillStyle = '#0f172a';
        drawRoundedRect(ctx, 13, -6.5, 7.5, 13, 3);
        ctx.fill();
    }

    ctx.restore();
}

/**
 * Station Pin & Callout Pill placed on the outward side of the route
 * so the track and vehicle never collide with the station text.
 */
function drawStationPin(ctx, x, y, label, dotColor, isDest = false, placeAbove = true, frame = 0) {
    ctx.save();
    ctx.translate(x, y);

    // Destination arrival celebration ring
    if (isDest && frame >= 168) {
        const ringProgress = Math.min(1, (frame - 168) / 35);
        ctx.save();
        ctx.strokeStyle = dotColor;
        ctx.globalAlpha = Math.max(0, 1 - ringProgress);
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(0, 0, 14 + ringProgress * 32, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    // Station Circle
    const radius = isDest ? 12.5 : 11.5;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = dotColor;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Callout Pill placed away from the route track
    const shortName = shortenStationName(label);
    ctx.font = '700 17px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
    const textW = ctx.measureText(shortName).width;
    const pillW = textW + 38;
    const pillH = 34;
    const pillX = -pillW / 2;
    const pillY = placeAbove ? -26 - pillH : 26;

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
    drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 17);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = dotColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Status dot inside pill
    ctx.fillStyle = dotColor;
    ctx.beginPath();
    ctx.arc(pillX + 15, pillY + pillH / 2, 4.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(shortName, pillX + 26, pillY + pillH / 2 + 0.5);
    ctx.restore();

    ctx.restore();
}

export function TripStoryComposition({
    trip,
    username = 'Traveler',
    mapStyle = 'traewelling-dark'
}) {
    const frame = useCurrentFrame();
    const { fps, width, height } = useVideoConfig();
    const canvasRef = React.useRef(null);
    const [tilesReadyCount, setTilesReadyCount] = React.useState(0);

    const coords = React.useMemo(() => (trip ? extractRouteCoordinates(trip) : []), [trip]);
    const scene = React.useMemo(() => buildMapScene(coords, width, height), [coords, width, height]);
    const styleConfig = MAP_STYLES[mapStyle] || MAP_STYLES['traewelling-dark'];

    // Silently preload 100% of scene tiles before rendering/recording starts
    React.useEffect(() => {
        if (!trip || !scene.tiles.length) return;
        let cancelled = false;
        const handle = delayRender(`Preloading ${scene.tiles.length} map tiles`);

        const safetyTimer = setTimeout(() => {
            if (!cancelled) {
                try { continueRender(handle); } catch { /* ignore */ }
            }
        }, 6500);

        preloadTripTiles(trip, mapStyle, width, height, ({ loaded }) => {
            if (!cancelled) {
                setTilesReadyCount(loaded);
            }
        }).then(() => {
            clearTimeout(safetyTimer);
            if (!cancelled) {
                try { continueRender(handle); } catch { /* ignore */ }
            }
        });

        return () => {
            cancelled = true;
            clearTimeout(safetyTimer);
            try { continueRender(handle); } catch { /* ignore */ }
        };
    }, [trip, mapStyle, width, height, scene]);

    React.useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !trip) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Focus on the Träwelling API v1 'checkin' response model
        const checkin = trip.checkin || trip.train || {};
        const categoryKey = checkin.category || 'regional';
        const catMeta = CATEGORY_META[categoryKey] || CATEGORY_META.unknown;

        const lineColor = checkin.routeColor
            ? `#${String(checkin.routeColor).replace(/^#/, '')}`
            : catMeta.color;
        const badgeTextColor = getContrastingTextColor(lineColor, checkin.routeTextColor);

        const lineName = checkin.lineName || checkin.number || 'Train';
        const originName = checkin.origin?.name || checkin.origin?.station?.name || trip.origin || 'Origin';
        const destName = checkin.destination?.name || checkin.destination?.station?.name || trip.destination || 'Destination';
        const rawDist = typeof checkin.distance === 'number'
            ? checkin.distance
            : (typeof checkin.totalDistance === 'number' ? checkin.totalDistance : (trip.distance || 0));
        const totalDistanceKm = rawDist > 0 ? rawDist / 1000 : computePolylineHaversineKm(coords);

        const delays = deriveDelaySeconds(checkin);
        const delaySec = delays.arrival !== null ? delays.arrival : (delays.departure || 0);
        const delayMinutes = Math.round(delaySec / 60);

        const durationMin = computeTripDurationMinutes(checkin);
        const durationFormatted = durationMin !== null ? formatHumanDuration(durationMin) : '—';
        const resolvedUsername = trip.user?.username || username || 'Traveler';
        const dateRaw = checkin.origin?.departureReal || checkin.origin?.departurePlanned || trip.createdAt;
        const dateStr = dateRaw
            ? new Date(dateRaw).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
            : '';

        // Choreography (240 frames @ 30fps = 8.0s) — C2-continuous quintic smootherstep curves
        const introSpring = spring({ frame, fps, config: { damping: 18, stiffness: 90 } });
        const travelProgress = smootherstep(22, 176, frame);

        // Overlapping quintic blend to full-route overview (starts gently at frame 120, settles smoothly by 212)
        const finaleBlend = smootherstep(120, 212, frame);

        const vehiclePose = samplePointAlongRoute(scene, travelProgress);
        const smoothChaseTarget = sampleSmoothedCameraTarget(scene, travelProgress);
        const camTargetX = interpolate(finaleBlend, [0, 1], [smoothChaseTarget.x, scene.centerSceneX]);
        const camTargetY = interpolate(finaleBlend, [0, 1], [smoothChaseTarget.y, scene.centerSceneY]);

        // Single continuous, non-reversing zoom glide from 1.36x down to 0.98x fitScale
        const zoomProgress = smootherstep(12, 212, frame);
        const camZoom = interpolate(zoomProgress, [0, 1], [scene.fitScale * 1.36, scene.fitScale * 0.98]);

        const currentDistKm = (totalDistanceKm * travelProgress).toFixed(1);

        // 1. Clear background
        ctx.save();
        ctx.fillStyle = styleConfig.bg;
        ctx.fillRect(0, 0, width, height);

        // 2. Camera transform (shifted down by 38px so the top HUD header never covers the northernmost station)
        const viewCenterY = height / 2 + 38;
        ctx.save();
        ctx.translate(width / 2, viewCenterY);
        ctx.scale(camZoom, camZoom);
        ctx.translate(-camTargetX, -camTargetY);

        // 3. Draw preloaded Map Tiles
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        for (const tile of scene.tiles) {
            const url = styleConfig.getTileUrl(scene.z, tile.x, tile.y);
            const img = TILE_IMAGE_CACHE.get(url);
            if (img) {
                ctx.drawImage(img, tile.left, tile.top, 256.5, 256.5);
            } else {
                ctx.fillStyle = styleConfig.bg;
                ctx.fillRect(tile.left, tile.top, 256, 256);
            }
        }

        // 4. 4-Layer Track Design
        if (scene.points.length >= 2) {
            // Layer 4a: Subtle Unvisited Dashed Guide Track
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(scene.points[0].x, scene.points[0].y);
            for (let i = 1; i < scene.points.length; i++) {
                ctx.lineTo(scene.points[i].x, scene.points[i].y);
            }
            ctx.strokeStyle = styleConfig.isDark ? 'rgba(255, 255, 255, 0.20)' : 'rgba(15, 23, 42, 0.24)';
            ctx.lineWidth = 10 / camZoom;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.setLineDash([10 / camZoom, 10 / camZoom]);
            ctx.stroke();
            ctx.restore();

            // Build traveled path up to vehiclePose
            const maxIdx = Math.max(0, Math.min(scene.points.length - 1, vehiclePose.index));
            const wholeIdx = Math.floor(maxIdx);

            ctx.save();
            ctx.beginPath();
            ctx.moveTo(scene.points[0].x, scene.points[0].y);
            for (let i = 1; i <= wholeIdx; i++) {
                ctx.lineTo(scene.points[i].x, scene.points[i].y);
            }
            ctx.lineTo(vehiclePose.x, vehiclePose.y);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            // Layer 4b: White Outer Casing with Drop Shadow
            ctx.save();
            ctx.shadowColor = 'rgba(0, 0, 0, 0.42)';
            ctx.shadowBlur = 10;
            ctx.shadowOffsetY = 4;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 15 / camZoom;
            ctx.stroke();
            ctx.restore();

            // Layer 4c: Vibrant Line-Colored Core
            ctx.strokeStyle = lineColor;
            ctx.lineWidth = 9.5 / camZoom;
            ctx.stroke();

            // Layer 4d: Inner Animated Dash Striping
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.42)';
            ctx.lineWidth = 3 / camZoom;
            ctx.setLineDash([8 / camZoom, 14 / camZoom]);
            ctx.lineDashOffset = -(frame * 0.8) / camZoom;
            ctx.stroke();
            ctx.restore();
        }

        // 5. Intermediate Stopover Dots (real stopovers if present, otherwise milestone dots along the track)
        const rawStops = checkin.stopovers || trip.stopovers || [];
        const validStops = Array.isArray(rawStops)
            ? rawStops.slice(1, -1).filter((stop) => {
                const st = stop?.station || stop;
                return Number.isFinite(Number(st?.longitude ?? st?.lon ?? st?.lng))
                    && Number.isFinite(Number(st?.latitude ?? st?.lat));
            })
            : [];

        if (validStops.length > 0) {
            validStops.forEach((stop) => {
                const st = stop?.station || stop;
                const sLon = Number(st?.longitude ?? st?.lon ?? st?.lng);
                const sLat = Number(st?.latitude ?? st?.lat);
                const sx = lonToWorldX(sLon, scene.z) - scene.originWX;
                const sy = latToWorldY(sLat, scene.z) - scene.originWY;
                ctx.save();
                ctx.translate(sx, sy);
                ctx.scale(1 / camZoom, 1 / camZoom);
                ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
                ctx.shadowBlur = 8;
                ctx.shadowOffsetY = 2;
                ctx.fillStyle = '#ffffff';
                ctx.strokeStyle = lineColor;
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.arc(0, 0, 7.5, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                ctx.restore();
            });
        } else {
            const milestoneFractions = [0.2, 0.4, 0.6, 0.8];
            milestoneFractions.forEach((mPct) => {
                if (travelProgress >= mPct) {
                    const mPt = samplePointAlongRoute(scene, mPct);
                    ctx.save();
                    ctx.translate(mPt.x, mPt.y);
                    ctx.scale(1 / camZoom, 1 / camZoom);
                    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
                    ctx.shadowBlur = 8;
                    ctx.shadowOffsetY = 2;
                    ctx.fillStyle = '#ffffff';
                    ctx.strokeStyle = lineColor;
                    ctx.lineWidth = 4;
                    ctx.beginPath();
                    ctx.arc(0, 0, 7.5, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                    ctx.restore();
                }
            });
        }

        // 6. Origin & Destination Station Pins & Callout Pills (drawn below the train)
        const originPt = scene.points[0];
        const destPt = scene.points[scene.points.length - 1];
        const originIsNorthOfDest = originPt && destPt ? originPt.y <= destPt.y : true;

        if (originPt) {
            ctx.save();
            ctx.translate(originPt.x, originPt.y);
            const pinScale = Math.max(0.01, introSpring) / camZoom;
            ctx.scale(pinScale, pinScale);
            drawStationPin(ctx, 0, 0, originName, '#10b981', false, originIsNorthOfDest, frame);
            ctx.restore();
        }
        if (destPt) {
            ctx.save();
            ctx.translate(destPt.x, destPt.y);
            const destPulse = smootherstep(0.84, 1.0, travelProgress);
            const destScale = (0.94 + destPulse * 0.08) / camZoom;
            ctx.scale(destScale, destScale);
            drawStationPin(ctx, 0, 0, destName, lineColor, true, !originIsNorthOfDest, frame);
            ctx.restore();
        }

        // 7. Moving Directional Vehicle Model (drawn ABOVE all dots and station pins on the map)
        ctx.save();
        ctx.translate(vehiclePose.x, vehiclePose.y);
        ctx.scale(1.06 / camZoom, 1.06 / camZoom);
        ctx.rotate(vehiclePose.angleRad || 0);
        drawVehicleOnCanvas(ctx, catMeta.vehicle, lineColor, frame);
        ctx.restore();

        ctx.restore(); // End camera transform

        // 8. Vignette framing around edges
        const vig = ctx.createRadialGradient(width / 2, height / 2, width * 0.34, width / 2, height / 2, width * 0.70);
        vig.addColorStop(0, 'rgba(0, 0, 0, 0)');
        vig.addColorStop(1, 'rgba(4, 7, 15, 0.38)');
        ctx.fillStyle = vig;
        ctx.fillRect(0, 0, width, height);

        // =========================================================================
        // 9. TOP HUD HEADER BAR (Sized cleanly for 1:1 960x960 Square)
        // =========================================================================
        const pad = 22;
        const headerH = 84;
        const rightCardW = 294;
        const leftCardW = width - pad * 2 - rightCardW - 14;

        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
        ctx.shadowBlur = 20;
        ctx.fillStyle = 'rgba(10, 14, 24, 0.90)';
        drawRoundedRect(ctx, pad, pad, leftCardW, headerH, 20);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Line Badge Pill inside Header
        ctx.font = '800 23px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
        const badgeTextW = ctx.measureText(lineName).width;
        const badgeW = Math.max(74, Math.min(160, badgeTextW + 28));
        const badgeH = 50;
        const badgeX = pad + 16;
        const badgeY = pad + (headerH - badgeH) / 2;

        ctx.fillStyle = lineColor;
        drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 12);
        ctx.fill();

        ctx.fillStyle = badgeTextColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(lineName, badgeX + badgeW / 2, badgeY + badgeH / 2 + 1, badgeW - 14);

        // Route Title & Subtitle
        const textStartX = badgeX + badgeW + 16;
        const shortOrig = shortenStationName(originName);
        const shortDest = shortenStationName(destName);
        const routeTitle = `${shortOrig} → ${shortDest}`;

        ctx.fillStyle = '#f8fafc';
        ctx.font = '800 22px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(routeTitle, textStartX, pad + 15, leftCardW - (textStartX - pad) - 16);

        const delayLabel = delayMinutes > 0 ? ` • +${delayMinutes}m` : '';
        const subTitle = `@${resolvedUsername} • ${dateStr}${delayLabel}`;
        ctx.fillStyle = '#94a3b8';
        ctx.font = '600 16px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.fillText(subTitle, textStartX, pad + 49, leftCardW - (textStartX - pad) - 16);
        ctx.restore();

        // =========================================================================
        // 10. TOP-RIGHT LIVE METRICS CARD (Distance + Duration)
        // =========================================================================
        const rightCardX = width - pad - rightCardW;

        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
        ctx.shadowBlur = 20;
        ctx.fillStyle = 'rgba(10, 14, 24, 0.90)';
        drawRoundedRect(ctx, rightCardX, pad, rightCardW, headerH, 20);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Distance Column
        ctx.fillStyle = '#94a3b8';
        ctx.font = '700 12px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('DISTANCE', rightCardX + 18, pad + 15);

        ctx.fillStyle = '#38bdf8';
        ctx.font = '800 23px "JetBrains Mono", monospace';
        ctx.fillText(`${currentDistKm} km`, rightCardX + 18, pad + 36, 134);

        // Divider
        ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.fillRect(rightCardX + 160, pad + 16, 1.5, headerH - 32);

        // Duration Column
        ctx.fillStyle = '#94a3b8';
        ctx.font = '700 12px Inter, sans-serif';
        ctx.fillText('DURATION', rightCardX + 176, pad + 15);

        ctx.fillStyle = '#4ade80';
        ctx.font = '800 23px "JetBrains Mono", monospace';
        ctx.fillText(durationFormatted, rightCardX + 176, pad + 36, 104);
        ctx.restore();

        // =========================================================================
        // 11. CORNER WATERMARK: "Generated on fabian-c.github.io/Traewelling-Maps"
        // =========================================================================
        ctx.save();
        const wmText = 'Generated on fabian-c.github.io/Traewelling-Maps';
        ctx.font = '600 13px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
        const wmTextW = ctx.measureText(wmText).width;
        const wmW = wmTextW + 22;
        const wmH = 26;
        const wmX = width - pad - 44 - wmW;
        const wmY = height - 48 - wmH;

        ctx.fillStyle = 'rgba(10, 14, 24, 0.82)';
        drawRoundedRect(ctx, wmX, wmY, wmW, wmH, 13);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = 'rgba(226, 232, 240, 0.90)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(wmText, wmX + wmW / 2, wmY + wmH / 2 + 0.5);
        ctx.restore();

        ctx.restore();
    }, [frame, fps, width, height, trip, username, mapStyle, coords, scene, styleConfig, tilesReadyCount]);

    return html`
        <${AbsoluteFill} style=${{ backgroundColor: styleConfig.bg }}>
            <canvas
                id="tripClipCanvas"
                ref=${canvasRef}
                width=${width}
                height=${height}
                style=${{ width: '100%', height: '100%', display: 'block' }}
            />
        <//>
    `;
}
