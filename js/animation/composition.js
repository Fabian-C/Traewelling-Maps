/**
 * Animated Journey Video Clip Composition (1280x720 16:9 HD)
 * Renders preloaded Web Mercator map tiles, glowing transit route, directional vehicles,
 * and mobile-first high-contrast telemetry onto an HTML5 Canvas driven by the player timeline.
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
 * 7 Curated Map Tile Sets:
 * - Träwelling Default Maps (traewelling-dark, traewelling-light)
 * - 2 Modern DB-Style Maps (db-light, db-dark)
 * - Classic Free & High-Detail Maps (voyager, topo, osm-de)
 * Every tile source supports CORS (Access-Control-Allow-Origin: *) for canvas video recording.
 */
export const MAP_STYLES = {
    'traewelling-dark': {
        name: 'Träwelling Dark',
        getTileUrl: (z, x, y) => `https://api.mapbox.com/styles/v1/mapbox/dark-v10/tiles/256/${z}/${x}/${y}@2x?access_token=${CONFIG.MAPBOX_TOKEN}`,
        getFallbackUrl: (z, x, y) => `https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/${z}/${y}/${x}`,
        bg: '#11141a',
        isDark: true,
        attribution: 'Träwelling Dark • OpenStreetMap'
    },
    'traewelling-light': {
        name: 'Träwelling Light',
        getTileUrl: (z, x, y) => {
            const sub = SUBDOMAINS[Math.abs(x + y) % SUBDOMAINS.length];
            return `https://${sub}.tile.openstreetmap.fr/hot/${z}/${x}/${y}.png`;
        },
        getFallbackUrl: (z, x, y) => `https://tile.openstreetmap.de/${z}/${x}/${y}.png`,
        bg: '#f5f4f0',
        isDark: false,
        attribution: 'Träwelling Transit • Humanitarian OSM'
    },
    'db-light': {
        name: 'DB Modern Light',
        getTileUrl: (z, x, y) => `https://api.mapbox.com/styles/v1/mapbox/light-v11/tiles/256/${z}/${x}/${y}@2x?access_token=${CONFIG.MAPBOX_TOKEN}`,
        getFallbackUrl: (z, x, y) => `https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/${z}/${y}/${x}`,
        bg: '#eef2f6',
        isDark: false,
        attribution: 'DB Clean Light • OpenStreetMap'
    },
    'db-dark': {
        name: 'DB Strecken Night',
        getTileUrl: (z, x, y) => `https://api.mapbox.com/styles/v1/mapbox/navigation-night-v1/tiles/256/${z}/${x}/${y}@2x?access_token=${CONFIG.MAPBOX_TOKEN}`,
        getFallbackUrl: (z, x, y) => `https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/256/${z}/${x}/${y}@2x?access_token=${CONFIG.MAPBOX_TOKEN}`,
        bg: '#0c1322',
        isDark: true,
        attribution: 'DB Strecken Night • OpenStreetMap'
    },
    voyager: {
        name: 'Classic Streets',
        getTileUrl: (z, x, y) => `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/${z}/${x}/${y}@2x?access_token=${CONFIG.MAPBOX_TOKEN}`,
        getFallbackUrl: (z, x, y) => `https://tile.openstreetmap.de/${z}/${x}/${y}.png`,
        bg: '#cad2d3',
        isDark: false,
        attribution: 'Classic Streets • OpenStreetMap'
    },
    topo: {
        name: 'Rail & Topo',
        getTileUrl: (z, x, y) => `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/tiles/256/${z}/${x}/${y}@2x?access_token=${CONFIG.MAPBOX_TOKEN}`,
        getFallbackUrl: (z, x, y) => {
            const sub = SUBDOMAINS[Math.abs(x + y) % SUBDOMAINS.length];
            return `https://${sub}.tile-cyclosm.openstreetmap.fr/cyclosm/${z}/${x}/${y}.png`;
        },
        bg: '#e6e4dd',
        isDark: false,
        attribution: 'Rail & Topo • OpenStreetMap'
    },
    'osm-de': {
        name: 'Free OSM Rail',
        getTileUrl: (z, x, y) => `https://tile.openstreetmap.de/${z}/${x}/${y}.png`,
        getFallbackUrl: (z, x, y) => {
            const sub = SUBDOMAINS[Math.abs(x + y) % SUBDOMAINS.length];
            return `https://${sub}.tile.openstreetmap.fr/osmfr/${z}/${x}/${y}.png`;
        },
        bg: '#ebe9e1',
        isDark: false,
        attribution: 'OpenStreetMap DE'
    }
};

// Global in-memory decoded tile cache so tiles are loaded once and drawn synchronously onto canvas
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
                // Ignore decode warnings on already loaded images
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
 * Preload 100% of Web Mercator tiles required across the entire camera trajectory of a trip
 * before video playback or recording begins.
 */
export async function preloadTripTiles(trip, mapStyle = 'traewelling-dark', width = 1280, height = 720, onProgress = null) {
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
    const train = trip?.train || trip?.checkin || {};
    const poly = train?.polyline || trip?.polyline;
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

    const orig = train?.origin?.station || train?.origin || {};
    const dest = train?.destination?.station || train?.destination || {};
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
    if (!points.length) return { x: 0, y: 0, angleDeg: 0, index: 0 };
    if (points.length === 1) return { x: points[0].x, y: points[0].y, angleDeg: 0, index: 0 };

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

function drawVehicleOnCanvas(ctx, vehicleType, color) {
    ctx.save();
    // Scale 1.4x so the vehicle stands out clearly on mobile screens
    ctx.scale(1.4, 1.4);

    // Headlight beam
    const grad = ctx.createLinearGradient(20, 0, 58, 0);
    grad.addColorStop(0, 'rgba(253, 224, 71, 0.42)');
    grad.addColorStop(1, 'rgba(253, 224, 71, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(18, -5);
    ctx.lineTo(58, -18);
    ctx.lineTo(58, 18);
    ctx.lineTo(18, 5);
    ctx.closePath();
    ctx.fill();

    // Drop shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    drawRoundedRect(ctx, -30, -9, 60, 22, 10);
    ctx.fill();

    if (vehicleType === 'ice') {
        // Aerodynamic High-Speed Train
        ctx.fillStyle = '#f8fafc';
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 2;
        drawRoundedRect(ctx, -32, -11, 64, 22, 11);
        ctx.fill();
        ctx.stroke();

        // Red/Category racing stripe
        ctx.fillStyle = color;
        drawRoundedRect(ctx, -28, -3, 52, 6, 3);
        ctx.fill();

        // Cockpit windshield
        ctx.fillStyle = '#0f172a';
        drawRoundedRect(ctx, 14, -7, 12, 14, 5);
        ctx.fill();
    } else if (vehicleType === 'ferry') {
        // Ferry hull
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        drawRoundedRect(ctx, -28, -12, 56, 24, 10);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = color;
        drawRoundedRect(ctx, -16, -7, 28, 14, 4);
        ctx.fill();
    } else {
        // U-Bahn / S-Bahn / Regional / Tram / Bus
        ctx.fillStyle = color;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        drawRoundedRect(ctx, -28, -11, 56, 22, 8);
        ctx.fill();
        ctx.stroke();

        // Roof panel
        ctx.fillStyle = 'rgba(255, 255, 255, 0.26)';
        drawRoundedRect(ctx, -20, -6, 34, 12, 4);
        ctx.fill();

        // Windshield
        ctx.fillStyle = '#0f172a';
        drawRoundedRect(ctx, 15, -8, 9, 16, 3);
        ctx.fill();
    }

    // Headlights
    ctx.fillStyle = '#fef08a';
    ctx.beginPath();
    ctx.arc(26, -5, 2.5, 0, Math.PI * 2);
    ctx.arc(26, 5, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}

function drawStationPin(ctx, x, y, label, dotColor, isDest = false) {
    ctx.save();
    ctx.translate(x, y);

    // Outer halo pulse
    ctx.fillStyle = isDest ? 'rgba(255, 46, 85, 0.28)' : 'rgba(34, 197, 94, 0.28)';
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, Math.PI * 2);
    ctx.fill();

    // Pin circle
    ctx.fillStyle = dotColor;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Station Name Pill above pin (large font for mobile!)
    const shortName = shortenStationName(label);
    ctx.font = '800 22px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
    const textW = ctx.measureText(shortName).width;
    const pillW = textW + 34;
    const pillH = 42;
    const pillX = -pillW / 2;
    const pillY = -58;

    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = 'rgba(10, 14, 24, 0.94)';
    drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 21);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = dotColor;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(shortName, 0, pillY + pillH / 2 + 1);

    ctx.restore();
}

export function TripStoryComposition({
    trip,
    username = 'Traveler',
    mapStyle = 'traewelling-dark',
    onTilesProgress = null
}) {
    const frame = useCurrentFrame();
    const { fps, width, height } = useVideoConfig();
    const canvasRef = React.useRef(null);
    const [tilesReadyCount, setTilesReadyCount] = React.useState(0);

    const coords = React.useMemo(() => (trip ? extractRouteCoordinates(trip) : []), [trip]);
    const scene = React.useMemo(() => buildMapScene(coords, width, height), [coords, width, height]);
    const styleConfig = MAP_STYLES[mapStyle] || MAP_STYLES['traewelling-dark'];

    // Preload all scene tiles and gate Remotion rendering until tiles are ready
    React.useEffect(() => {
        if (!trip || !scene.tiles.length) return;
        let cancelled = false;
        const handle = delayRender(`Preloading ${scene.tiles.length} map tiles`);

        const safetyTimer = setTimeout(() => {
            if (!cancelled) {
                try { continueRender(handle); } catch { /* ignore */ }
            }
        }, 6500);

        preloadTripTiles(trip, mapStyle, width, height, ({ loaded, total }) => {
            if (!cancelled) {
                setTilesReadyCount(loaded);
                if (onTilesProgress) onTilesProgress({ loaded, total });
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

    // Draw the complete 1280x720 frame onto the canvas whenever frame, trip, mapStyle, or tilesReadyCount updates
    React.useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !trip) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const train = trip.train || trip.checkin || {};
        const categoryKey = train.category || 'regional';
        const catMeta = CATEGORY_META[categoryKey] || CATEGORY_META.unknown;

        const lineName = train.lineName || train.number || 'Train';
        const originName = train.origin?.name || trip.origin || 'Origin';
        const destName = train.destination?.name || trip.destination || 'Destination';
        const rawDist = typeof train.totalDistance === 'number'
            ? train.totalDistance
            : (typeof train.distance === 'number' ? train.distance : (trip.distance || 0));
        const totalDistanceKm = rawDist > 0 ? rawDist / 1000 : 3.1;

        const delays = deriveDelaySeconds(train);
        const delaySec = delays.arrival !== null ? delays.arrival : (delays.departure || 0);
        const delayMinutes = Math.round(delaySec / 60);

        const durationMin = computeTripDurationMinutes(train);
        const durationFormatted = durationMin !== null ? formatHumanDuration(durationMin) : '—';
        const note = (trip.body || '').trim();
        const dateRaw = train.origin?.departureReal || train.origin?.departurePlanned || trip.createdAt;
        const dateStr = dateRaw
            ? new Date(dateRaw).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
            : '';

        // Choreography (240 frames @ 30fps = 8.0s)
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

        const cardPopupSpring = spring({
            frame: frame - 178,
            fps,
            config: { damping: 14, stiffness: 95 }
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

        // Subtle contrast/readability wash over light maps so glowing route & badges pop on mobile
        if (!styleConfig.isDark) {
            ctx.fillStyle = 'rgba(15, 23, 42, 0.06)';
            ctx.fillRect(0, 0, scene.sceneWidth, scene.sceneHeight);
        }

        // 4. Draw Upcoming Dashed Route Path
        if (scene.points.length >= 2) {
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(scene.points[0].x, scene.points[0].y);
            for (let i = 1; i < scene.points.length; i++) {
                ctx.lineTo(scene.points[i].x, scene.points[i].y);
            }
            ctx.strokeStyle = styleConfig.isDark ? 'rgba(255, 255, 255, 0.25)' : 'rgba(15, 23, 42, 0.28)';
            ctx.lineWidth = 8 / camZoom;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.setLineDash([14 / camZoom, 12 / camZoom]);
            ctx.stroke();
            ctx.restore();

            // 5. Draw Active Traveled Route Path with Glow
            const maxIdx = Math.max(0, Math.min(scene.points.length - 1, vehiclePose.index));
            const wholeIdx = Math.floor(maxIdx);
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(scene.points[0].x, scene.points[0].y);
            for (let i = 1; i <= wholeIdx; i++) {
                ctx.lineTo(scene.points[i].x, scene.points[i].y);
            }
            ctx.lineTo(vehiclePose.x, vehiclePose.y);

            // Outer glow
            ctx.shadowColor = catMeta.color;
            ctx.shadowBlur = 24;
            ctx.strokeStyle = catMeta.color;
            ctx.lineWidth = 13 / camZoom;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.stroke();

            // Inner bright core
            ctx.shadowBlur = 0;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 4.5 / camZoom;
            ctx.stroke();
            ctx.restore();
        }

        // 6. Draw Origin & Destination Pins (in world space, inverse-scaled so text is always crisp)
        const originPt = scene.points[0];
        const destPt = scene.points[scene.points.length - 1];
        if (originPt) {
            ctx.save();
            ctx.translate(originPt.x, originPt.y);
            ctx.scale(1 / camZoom, 1 / camZoom);
            drawStationPin(ctx, 0, 0, originName, '#22c55e', false);
            ctx.restore();
        }
        if (destPt && (frame >= 155 || travelProgress > 0.85)) {
            ctx.save();
            ctx.translate(destPt.x, destPt.y);
            ctx.scale(1 / camZoom, 1 / camZoom);
            drawStationPin(ctx, 0, 0, destName, catMeta.color, true);
            ctx.restore();
        }

        // 7. Draw Directional Vehicle + Floating Telemetry Callout
        if (travelProgress < 0.995) {
            ctx.save();
            ctx.translate(vehiclePose.x, vehiclePose.y);
            ctx.scale(1 / camZoom, 1 / camZoom);

            ctx.save();
            ctx.rotate(vehiclePose.angleRad || 0);
            drawVehicleOnCanvas(ctx, catMeta.vehicle, catMeta.color);
            ctx.restore();

            // Floating Callout Pill above Vehicle (Big 22px bold font for mobile!)
            const calloutText = `${lineName} • ${currentDistKm} km`;
            ctx.font = '800 22px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
            const cw = ctx.measureText(calloutText).width + 36;
            const ch = 42;
            ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
            ctx.shadowBlur = 14;
            ctx.fillStyle = catMeta.color;
            drawRoundedRect(ctx, -cw / 2, -74, cw, ch, 21);
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2.5;
            ctx.stroke();
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(calloutText, 0, -74 + ch / 2 + 1);

            ctx.restore();
        }

        ctx.restore(); // End camera transform

        // 8. Vignette framing around edges
        const vig = ctx.createRadialGradient(width / 2, height / 2, width * 0.32, width / 2, height / 2, width * 0.68);
        vig.addColorStop(0, 'rgba(0, 0, 0, 0)');
        vig.addColorStop(1, 'rgba(4, 7, 15, 0.45)');
        ctx.fillStyle = vig;
        ctx.fillRect(0, 0, width, height);

        // =========================================================================
        // 9. MOBILE-OPTIMIZED TOP HUD HEADER BAR (Large 26-30px fonts!)
        // =========================================================================
        const pad = 28;
        const bottomSafePad = 74;
        const headerH = 92;
        const rightCardW = 336;
        const leftCardW = width - pad * 2 - rightCardW - 18;

        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.48)';
        ctx.shadowBlur = 22;
        ctx.fillStyle = 'rgba(10, 14, 24, 0.90)';
        drawRoundedRect(ctx, pad, pad, leftCardW, headerH, 22);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Line Badge Pill inside Header
        ctx.font = '900 28px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
        const badgeTextW = ctx.measureText(lineName).width;
        const badgeW = Math.max(88, badgeTextW + 38);
        const badgeH = 56;
        const badgeX = pad + 18;
        const badgeY = pad + (headerH - badgeH) / 2;

        ctx.fillStyle = catMeta.color;
        drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 14);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(lineName, badgeX + badgeW / 2, badgeY + badgeH / 2 + 1);

        // Route Title & Subtitle
        const textStartX = badgeX + badgeW + 20;
        const shortOrig = shortenStationName(originName);
        const shortDest = shortenStationName(destName);
        const routeTitle = `${shortOrig}  →  ${shortDest}`;

        ctx.fillStyle = '#f8fafc';
        ctx.font = '800 27px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(routeTitle, textStartX, pad + 16, leftCardW - (textStartX - pad) - 20);

        const subTitle = `@${username}  •  ${dateStr}  •  ${catMeta.label}`;
        ctx.fillStyle = '#94a3b8';
        ctx.font = '600 19px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.fillText(subTitle, textStartX, pad + 54);
        ctx.restore();

        // =========================================================================
        // 10. TOP-RIGHT LIVE METRICS CARD (Distance + Duration, 30px bold!)
        // =========================================================================
        const rightCardX = width - pad - rightCardW;

        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.48)';
        ctx.shadowBlur = 22;
        ctx.fillStyle = 'rgba(10, 14, 24, 0.90)';
        drawRoundedRect(ctx, rightCardX, pad, rightCardW, headerH, 22);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Distance Column
        ctx.fillStyle = '#94a3b8';
        ctx.font = '800 14px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('DISTANCE', rightCardX + 20, pad + 16);

        ctx.fillStyle = '#38bdf8';
        ctx.font = '900 29px "JetBrains Mono", monospace';
        ctx.fillText(`${currentDistKm} km`, rightCardX + 20, pad + 39);

        // Divider
        ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
        ctx.fillRect(rightCardX + 178, pad + 18, 2, headerH - 36);

        // Duration Column (Real computed duration, e.g. 8m!)
        ctx.fillStyle = '#94a3b8';
        ctx.font = '800 14px Inter, sans-serif';
        ctx.fillText('DURATION', rightCardX + 196, pad + 16);

        ctx.fillStyle = '#4ade80';
        ctx.font = '900 29px "JetBrains Mono", monospace';
        ctx.fillText(durationFormatted, rightCardX + 196, pad + 39);
        ctx.restore();

        // =========================================================================
        // 11. BOTTOM PROGRESS BAR OR FINALE SUMMARY BANNER
        // =========================================================================
        if (frame < 178) {
            const barH = 52;
            const barY = height - bottomSafePad - barH;
            const barW = width - pad * 2;

            ctx.save();
            ctx.fillStyle = 'rgba(10, 14, 24, 0.88)';
            drawRoundedRect(ctx, pad, barY, barW, barH, 26);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            ctx.font = '700 19px Inter, sans-serif';
            ctx.fillStyle = '#4ade80';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(shortOrig, pad + 24, barY + barH / 2);

            ctx.fillStyle = '#f8fafc';
            ctx.textAlign = 'right';
            ctx.fillText(shortDest, pad + barW - 24, barY + barH / 2);

            const trackLeft = pad + 260;
            const trackRight = pad + barW - 260;
            const trackW = Math.max(120, trackRight - trackLeft);
            const trackY = barY + barH / 2 - 5;

            ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
            drawRoundedRect(ctx, trackLeft, trackY, trackW, 10, 5);
            ctx.fill();

            ctx.fillStyle = catMeta.color;
            drawRoundedRect(ctx, trackLeft, trackY, Math.max(12, trackW * travelProgress), 10, 5);
            ctx.fill();
            ctx.restore();
        } else {
            // Finale Summary Card (Big, mobile-friendly summary banner above player controls)
            const cardH = 104;
            const slideOffset = interpolate(cardPopupSpring, [0, 1], [50, 0]);
            const cardY = height - bottomSafePad - cardH + slideOffset;
            const cardW = width - pad * 2;

            ctx.save();
            ctx.globalAlpha = Math.max(0, Math.min(1, cardPopupSpring));
            ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
            ctx.shadowBlur = 28;
            ctx.fillStyle = 'rgba(10, 14, 24, 0.94)';
            drawRoundedRect(ctx, pad, cardY, cardW, cardH, 24);
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.strokeStyle = catMeta.color;
            ctx.lineWidth = 3;
            ctx.stroke();

            // Emoji / Category Icon Box
            const iconBox = 68;
            const iconX = pad + 20;
            const iconY = cardY + (cardH - iconBox) / 2;
            ctx.fillStyle = catMeta.color;
            drawRoundedRect(ctx, iconX, iconY, iconBox, iconBox, 18);
            ctx.fill();

            ctx.font = '36px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(catMeta.emoji, iconX + iconBox / 2, iconY + iconBox / 2 + 2);

            // Traveler + Delay Badge + Note
            const infoX = iconX + iconBox + 22;
            ctx.fillStyle = '#ffffff';
            ctx.font = '800 26px Inter, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            const statusLabel = delayMinutes > 0 ? `+${delayMinutes} min delay` : 'On Time';
            ctx.fillText(`@${username}  •  ${statusLabel}`, infoX, cardY + 20);

            const noteDisplay = note
                ? `"${note.slice(0, 58)}${note.length > 58 ? '…' : ''}"`
                : `Checked in on Träwelling • ${shortOrig} → ${shortDest}`;
            ctx.fillStyle = '#cbd5e1';
            ctx.font = '600 21px Inter, sans-serif';
            ctx.fillText(noteDisplay, infoX, cardY + 58);

            // Right-side Finale Totals
            const statRightX = pad + cardW - 28;
            ctx.textAlign = 'right';
            ctx.fillStyle = '#4ade80';
            ctx.font = '900 32px "JetBrains Mono", monospace';
            ctx.fillText(`${totalDistanceKm.toFixed(1)} km  •  ${durationFormatted}`, statRightX, cardY + 36);
            ctx.restore();
        }

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
