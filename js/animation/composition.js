/**
 * Animated Journey Video Clip Composition (1280x720 16:9 HD)
 * Built around the Träwelling API v1 'checkin' response model.
 * Preloads 100% of required Web Mercator map tiles silently in the background
 * and renders the multi-layer track, stopover waypoints, detailed vehicles,
 * and mobile-first telemetry onto a 1280x720 HTML5 Canvas.
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
    nationalExpress: { label: 'High-Speed Rail', color: '#ff2e55', accent: '#ffffff', vehicle: 'ice', emoji: '🚄' },
    national: { label: 'InterCity', color: '#00c8ff', accent: '#ffffff', vehicle: 'ice', emoji: '🚆' },
    regionalExp: { label: 'Regional Express', color: '#e11d48', accent: '#fecdd3', vehicle: 'train', emoji: '🚆' },
    regional: { label: 'Regional Train', color: '#db2777', accent: '#fbcfe8', vehicle: 'train', emoji: '🚆' },
    suburban: { label: 'S-Bahn', color: '#16a34a', accent: '#bbf7d0', vehicle: 'sbahn', emoji: '🚆' },
    subway: { label: 'U-Bahn', color: '#8c6dab', accent: '#e9d5ff', vehicle: 'ubahn', emoji: '🚇' },
    tram: { label: 'Tram / Streetcar', color: '#06b6d4', accent: '#cffafe', vehicle: 'tram', emoji: '🚊' },
    bus: { label: 'Bus', color: '#22c55e', accent: '#dcfce7', vehicle: 'bus', emoji: '🚌' },
    ferry: { label: 'Ferry', color: '#0284c7', accent: '#e0f2fe', vehicle: 'ferry', emoji: '⛴️' },
    plane: { label: 'Flight', color: '#6366f1', accent: '#e0e7ff', vehicle: 'plane', emoji: '✈️' },
    taxi: { label: 'Taxi', color: '#eab308', accent: '#fef9c3', vehicle: 'bus', emoji: '🚕' },
    unknown: { label: 'Transit Journey', color: '#38bdf8', accent: '#e0f2fe', vehicle: 'train', emoji: '🚆' }
};

const SUBDOMAINS = ['a', 'b', 'c'];

/**
 * 7 Curated Map Tile Sets (CORS-enabled for seamless WebM canvas recording)
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
            }
            resolve(loadedImg);
        };

        img.onload = () => finalize(img);
        img.onerror = () => {
            if (fallbackUrl && fallbackUrl !== primaryUrl) {
                const fbImg = new Image();
                fbImg.crossOrigin = 'anonymous';
                fbImg.onload = () => finalize(fbImg);
                fbImg.onerror = () => resolve(null);
                fbImg.src = fallbackUrl;
            } else {
                resolve(null);
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
        return densifyCoordinates(valid, 140);
    }

    const orig = checkin?.origin?.station || checkin?.origin || {};
    const dest = checkin?.destination?.station || checkin?.destination || {};
    const lon1 = orig.longitude ?? orig.lon ?? orig.lng ?? 13.359059;
    const lat1 = orig.latitude ?? orig.lat ?? 52.546448;
    const lon2 = dest.longitude ?? dest.lon ?? dest.lng ?? 13.387608;
    const lat2 = dest.latitude ?? dest.lat ?? 52.524410;

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

function densifyCoordinates(coords, targetCount = 140) {
    if (coords.length >= targetCount || coords.length < 2) return coords;
    const out = [];
    const segs = coords.length - 1;
    const perSeg = Math.max(2, Math.ceil(targetCount / segs));
    for (let i = 0; i < segs; i++) {
        const [x1, y1] = coords[i];
        const [x2, y2] = coords[i + 1];
        for (let j = 0; j < perSeg; j++) {
            const t = j / perSeg;
            out.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]);
        }
    }
    out.push(coords[coords.length - 1]);
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

    let chosenZ = 7;
    for (let z = 14; z >= 4; z--) {
        const w = Math.abs(lonToWorldX(maxLon, z) - lonToWorldX(minLon, z));
        const h = Math.abs(latToWorldY(minLat, z) - latToWorldY(maxLat, z));
        if (w <= viewportWidth * 0.65 && h <= viewportHeight * 0.56) {
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

    const halfSpanX = Math.max(viewportWidth * 0.72, (maxWX - minWX) * 0.88);
    const halfSpanY = Math.max(viewportHeight * 0.72, (maxWY - minWY) * 0.88);

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
        1.55,
        Math.max(0.75, Math.min((viewportWidth * 0.58) / routeBoundsW, (viewportHeight * 0.48) / routeBoundsH))
    );

    return {
        z: chosenZ,
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

function samplePointAlongRoute(scene, progress) {
    const { points, cumDist, totalPathPx } = scene;
    if (!points.length) return { x: 0, y: 0, angleRad: 0, index: 0 };
    if (points.length === 1) return { x: points[0].x, y: points[0].y, angleRad: 0, index: 0 };

    const targetDist = Math.max(0, Math.min(1, progress)) * totalPathPx;
    let idx = 0;
    while (idx < cumDist.length - 2 && cumDist[idx + 1] < targetDist) {
        idx++;
    }

    const d0 = cumDist[idx];
    const d1 = cumDist[idx + 1];
    const segLen = Math.max(0.0001, d1 - d0);
    const t = Math.max(0, Math.min(1, (targetDist - d0) / segLen));

    const p0 = points[idx];
    const p1 = points[idx + 1];
    const x = p0.x + (p1.x - p0.x) * t;
    const y = p0.y + (p1.y - p0.y) * t;

    const lookAheadIdx = Math.min(points.length - 1, idx + 3);
    const lookBackIdx = Math.max(0, idx - 2);
    const dx = points[lookAheadIdx].x - points[lookBackIdx].x;
    const dy = points[lookAheadIdx].y - points[lookBackIdx].y;
    const angleRad = Math.atan2(dy, dx);

    return { x, y, angleRad, index: idx + t };
}

function shortenStationName(name) {
    if (!name) return '';
    return String(name)
        .replace(/\s*\(Berlin\)/gi, '')
        .replace(/\s*,\s*Berlin$/gi, '')
        .replace(/\s*Bhf$/gi, '')
        .trim();
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
 * Restored Detailed Vehicle Design (ICE aerodynamic nose cone + carriages,
 * Ferry with water wake ripples, Plane with swept wings & contrails,
 * Regional/S-Bahn/U-Bahn/Tram/Bus with roof panel & headlights).
 */
function drawVehicleOnCanvas(ctx, vehicleType, color, frame) {
    const pulse = Math.sin(frame * 0.35) * 0.5 + 0.5;
    ctx.save();
    ctx.scale(1.25, 1.25);

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

        // Pulsing wake ellipse
        ctx.fillStyle = 'rgba(224, 242, 254, 0.35)';
        ctx.beginPath();
        ctx.ellipse(-24, 0, 10 + pulse * 4, 6 + pulse * 2, 0, 0, Math.PI * 2);
        ctx.fill();

        // Drop Shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
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

        // Bow Accent
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

        // Swept Wing Aircraft Fuselage
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
        // Headlight Beam Cone
        ctx.fillStyle = 'rgba(254, 240, 138, 0.32)';
        ctx.beginPath();
        ctx.moveTo(28, 0);
        ctx.lineTo(56, -14);
        ctx.lineTo(56, 14);
        ctx.closePath();
        ctx.fill();

        // Drop Shadow
        const shadowPath = new Path2D('M -30,-4 L 16,-4 C 26,-4 32,1 32,5 C 32,9 26,14 16,14 L -30,14 Z');
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
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
        // Default Regional / S-Bahn / U-Bahn / Tram / Bus Vehicle
        ctx.fillStyle = 'rgba(253, 224, 71, 0.28)';
        ctx.beginPath();
        ctx.moveTo(24, 0);
        ctx.lineTo(48, -12);
        ctx.lineTo(48, 12);
        ctx.closePath();
        ctx.fill();

        // Shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.48)';
        drawRoundedRect(ctx, -26, -5, 52, 20, 7);
        ctx.fill();

        // Main Train Body
        ctx.fillStyle = color;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5;
        drawRoundedRect(ctx, -26, -10, 52, 20, 7);
        ctx.fill();
        ctx.stroke();

        // Silver Roof Panel
        ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
        drawRoundedRect(ctx, -20, -6, 34, 12, 4);
        ctx.fill();

        // Front Windshield
        ctx.fillStyle = '#0f172a';
        drawRoundedRect(ctx, 14, -7, 8, 14, 3);
        ctx.fill();

        // Headlights
        ctx.fillStyle = '#fef08a';
        ctx.beginPath();
        ctx.arc(24, -5, 2, 0, Math.PI * 2);
        ctx.arc(24, 5, 2, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.restore();
}

/**
 * Restored Origin & Destination Station Pins & Callout Flags
 */
function drawStationPin(ctx, x, y, label, dotColor, isDest = false, frame = 0) {
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

    // Station Circle (24px origin / 26px destination with 4px white border)
    const radius = isDest ? 13 : 12;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = dotColor;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Callout Pill (Origin above pin, Destination below pin)
    const shortName = shortenStationName(label);
    ctx.font = '700 18px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
    const textW = ctx.measureText(shortName).width;
    const pillW = textW + 40;
    const pillH = 36;
    const pillX = -pillW / 2;
    const pillY = isDest ? 20 : -20 - pillH;

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = '#0f172a';
    drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 18);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = dotColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Small status dot inside pill
    ctx.fillStyle = dotColor;
    ctx.beginPath();
    ctx.arc(pillX + 16, pillY + pillH / 2, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(shortName, pillX + 27, pillY + pillH / 2 + 0.5);
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

        // Focus on the new Träwelling API v1 'checkin' response model
        const checkin = trip.checkin || trip.train || {};
        const categoryKey = checkin.category || 'regional';
        const catMeta = CATEGORY_META[categoryKey] || CATEGORY_META.unknown;

        // Use official routeColor from new Träwelling API if provided (e.g. "8c6dab" for U6), otherwise category color
        const lineColor = checkin.routeColor
            ? `#${String(checkin.routeColor).replace(/^#/, '')}`
            : catMeta.color;

        const lineName = checkin.lineName || checkin.number || 'Train';
        const originName = checkin.origin?.name || checkin.origin?.station?.name || trip.origin || 'Origin';
        const destName = checkin.destination?.name || checkin.destination?.station?.name || trip.destination || 'Destination';
        const rawDist = typeof checkin.distance === 'number'
            ? checkin.distance
            : (typeof checkin.totalDistance === 'number' ? checkin.totalDistance : (trip.distance || 0));
        const totalDistanceKm = rawDist > 0 ? rawDist / 1000 : 3.1;

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

        // Choreography (240 frames @ 30fps = 8.0s)
        const introSpring = spring({ frame, fps, config: { damping: 13, stiffness: 110 } });
        const rawTravel = interpolate(frame, [28, 172], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp'
        });
        const travelProgress = rawTravel < 0.5
            ? 4 * rawTravel * rawTravel * rawTravel
            : 1 - Math.pow(-2 * rawTravel + 2, 3) / 2;

        const finaleBlend = spring({
            frame: frame - 170,
            fps,
            config: { damping: 16, stiffness: 70, mass: 1.1 }
        });

        const vehiclePose = samplePointAlongRoute(scene, travelProgress);
        const camTargetX = interpolate(finaleBlend, [0, 1], [vehiclePose.x, scene.centerSceneX]);
        const camTargetY = interpolate(finaleBlend, [0, 1], [vehiclePose.y, scene.centerSceneY]);

        const chaseZoom = interpolate(
            frame,
            [0, 28, 100, 170],
            [scene.fitScale * 1.68, scene.fitScale * 1.54, scene.fitScale * 1.40, scene.fitScale * 1.50],
            { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
        );
        const camZoom = interpolate(finaleBlend, [0, 1], [chaseZoom, scene.fitScale * 1.02]);

        const currentDistKm = (totalDistanceKm * travelProgress).toFixed(1);

        // 1. Clear background
        ctx.save();
        ctx.fillStyle = styleConfig.bg;
        ctx.fillRect(0, 0, width, height);

        // 2. Camera transform
        ctx.save();
        ctx.translate(width / 2, height / 2);
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

        // 4. Restored 4-Layer Track Design
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
            ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
            ctx.shadowBlur = 10;
            ctx.shadowOffsetY = 4;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 16 / camZoom;
            ctx.stroke();
            ctx.restore();

            // Layer 4c: Vibrant Line-Colored Core
            ctx.strokeStyle = lineColor;
            ctx.lineWidth = 10 / camZoom;
            ctx.stroke();

            // Layer 4d: Inner Animated Dash Striping
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
            ctx.lineWidth = 3.5 / camZoom;
            ctx.setLineDash([8 / camZoom, 14 / camZoom]);
            ctx.lineDashOffset = -(frame * 0.8) / camZoom;
            ctx.stroke();
            ctx.restore();
        }

        // 5. Restored Intermediate Stopover Waypoint Dots (20%, 40%, 60%, 80%)
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
                ctx.arc(0, 0, 8, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                ctx.restore();
            }
        });

        // 6. Restored Origin & Destination Station Pins & Callout Flags
        const originPt = scene.points[0];
        const destPt = scene.points[scene.points.length - 1];
        if (originPt) {
            ctx.save();
            ctx.translate(originPt.x, originPt.y);
            const pinScale = Math.max(0.01, introSpring) / camZoom;
            ctx.scale(pinScale, pinScale);
            drawStationPin(ctx, 0, 0, originName, '#10b981', false, frame);
            ctx.restore();
        }
        if (destPt) {
            ctx.save();
            ctx.translate(destPt.x, destPt.y);
            const destScale = (travelProgress > 0.92 ? 1.08 : 0.88) / camZoom;
            ctx.scale(destScale, destScale);
            drawStationPin(ctx, 0, 0, destName, lineColor, true, frame);
            ctx.restore();
        }

        // 7. Restored Moving Directional Vehicle Model (without floating train number tag over vehicle)
        ctx.save();
        ctx.translate(vehiclePose.x, vehiclePose.y);
        ctx.scale(1.08 / camZoom, 1.08 / camZoom);
        ctx.rotate(vehiclePose.angleRad || 0);
        drawVehicleOnCanvas(ctx, catMeta.vehicle, lineColor, frame);
        ctx.restore();

        ctx.restore(); // End camera transform

        // 8. Vignette framing around edges
        const vig = ctx.createRadialGradient(width / 2, height / 2, width * 0.34, width / 2, height / 2, width * 0.70);
        vig.addColorStop(0, 'rgba(0, 0, 0, 0)');
        vig.addColorStop(1, 'rgba(4, 7, 15, 0.42)');
        ctx.fillStyle = vig;
        ctx.fillRect(0, 0, width, height);

        // =========================================================================
        // 9. TOP HUD HEADER BAR (Sized cleanly for 1:1 960x960 Square)
        // =========================================================================
        const pad = 22;
        const headerH = 84;
        const rightCardW = 284;
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
        ctx.font = '800 24px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
        const badgeTextW = ctx.measureText(lineName).width;
        const badgeW = Math.max(76, badgeTextW + 30);
        const badgeH = 50;
        const badgeX = pad + 16;
        const badgeY = pad + (headerH - badgeH) / 2;

        ctx.fillStyle = lineColor;
        drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 12);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(lineName, badgeX + badgeW / 2, badgeY + badgeH / 2 + 1);

        // Route Title & Subtitle
        const textStartX = badgeX + badgeW + 16;
        const shortOrig = shortenStationName(originName);
        const shortDest = shortenStationName(destName);
        const routeTitle = `${shortOrig} → ${shortDest}`;

        ctx.fillStyle = '#f8fafc';
        ctx.font = '800 23px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(routeTitle, textStartX, pad + 15, leftCardW - (textStartX - pad) - 16);

        const delayLabel = delayMinutes > 0 ? ` • +${delayMinutes}m` : '';
        const subTitle = `@${resolvedUsername} • ${dateStr}${delayLabel}`;
        ctx.fillStyle = '#94a3b8';
        ctx.font = '600 17px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.fillText(subTitle, textStartX, pad + 49);
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
        ctx.font = '800 24px "JetBrains Mono", monospace';
        ctx.fillText(`${currentDistKm} km`, rightCardX + 18, pad + 36);

        // Divider
        ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.fillRect(rightCardX + 152, pad + 16, 1.5, headerH - 32);

        // Duration Column
        ctx.fillStyle = '#94a3b8';
        ctx.font = '700 12px Inter, sans-serif';
        ctx.fillText('DURATION', rightCardX + 168, pad + 15);

        ctx.fillStyle = '#4ade80';
        ctx.font = '800 24px "JetBrains Mono", monospace';
        ctx.fillText(durationFormatted, rightCardX + 168, pad + 36);
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
        const wmY = height - 50 - wmH;

        ctx.fillStyle = 'rgba(10, 14, 24, 0.80)';
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
    }, [frame, fps, width, height, trip, username, mapStyle, scene, styleConfig, tilesReadyCount]);

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
