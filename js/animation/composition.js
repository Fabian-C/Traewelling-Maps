/**
 * TravelBoast-Inspired ("TräwellBoast") Remotion Map Route Composition
 * Rectangular 1280x720 HD animated map journey with Web Mercator tile projection,
 * 3D perspective camera tracking, directional vehicle models, and spring telemetry.
 */

import React from 'https://esm.sh/react@18.3.1';
import htm from 'https://esm.sh/htm@3.1.1';
import {
    interpolate,
    spring,
    useCurrentFrame,
    useVideoConfig,
    AbsoluteFill
} from 'https://esm.sh/remotion@4.0.539?deps=react@18.3.1';
import { CONFIG } from '../config/config.js';
import { computeTripDurationMinutes } from '../utils/time.js';
import { formatHumanDuration } from '../utils/format.js';

const html = htm.bind(React.createElement);

const CATEGORY_META = {
    nationalExpress: { label: 'High-Speed ICE', color: '#ff2e55', accent: '#ffffff', vehicle: 'ice' },
    national: { label: 'InterCity', color: '#00c8ff', accent: '#ffffff', vehicle: 'ice' },
    regionalExp: { label: 'Regional Express', color: '#e11d48', accent: '#fecdd3', vehicle: 'train' },
    regional: { label: 'Regional Train', color: '#db2777', accent: '#fbcfe8', vehicle: 'train' },
    suburban: { label: 'S-Bahn', color: '#16a34a', accent: '#bbf7d0', vehicle: 'sbahn' },
    subway: { label: 'U-Bahn', color: '#f59e0b', accent: '#fef3c7', vehicle: 'tram' },
    tram: { label: 'Tram / Streetcar', color: '#06b6d4', accent: '#cffafe', vehicle: 'tram' },
    bus: { label: 'Bus', color: '#22c55e', accent: '#dcfce7', vehicle: 'bus' },
    ferry: { label: 'Ferry Boat', color: '#0284c7', accent: '#e0f2fe', vehicle: 'ferry' },
    plane: { label: 'Flight', color: '#6366f1', accent: '#e0e7ff', vehicle: 'plane' },
    taxi: { label: 'Taxi', color: '#eab308', accent: '#fef9c3', vehicle: 'bus' },
    unknown: { label: 'Rail Journey', color: '#38bdf8', accent: '#e0f2fe', vehicle: 'train' }
};

const MAP_STYLES = {
    voyager: {
        name: 'TravelBoast Classic',
        getTileUrl: (z, x, y) => `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/${z}/${x}/${y}@2x?access_token=${CONFIG.MAPBOX_TOKEN}`,
        bg: '#cad2d3',
        isDark: false
    },
    dark: {
        name: 'Night Rail Map',
        getTileUrl: (z, x, y) => `https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/256/${z}/${x}/${y}@2x?access_token=${CONFIG.MAPBOX_TOKEN}`,
        bg: '#090d16',
        isDark: true
    },
    outdoors: {
        name: 'Topo & Tracks',
        getTileUrl: (z, x, y) => `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/tiles/256/${z}/${x}/${y}@2x?access_token=${CONFIG.MAPBOX_TOKEN}`,
        bg: '#e6e4dd',
        isDark: false
    },
    satellite: {
        name: 'Satellite Hybrid',
        getTileUrl: (z, x, y) => `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/256/${z}/${x}/${y}@2x?access_token=${CONFIG.MAPBOX_TOKEN}`,
        bg: '#0b1622',
        isDark: true
    }
};

// Web Mercator projection helpers (Tile size = 256px)
function lonToWorldX(lon, z) {
    const scale = 256 * Math.pow(2, z);
    return ((lon + 180) / 360) * scale;
}

function latToWorldY(lat, z) {
    const scale = 256 * Math.pow(2, z);
    const clampedLat = Math.max(-85.0511, Math.min(85.0511, lat));
    const rad = (clampedLat * Math.PI) / 180;
    const sinLat = Math.sin(rad);
    return (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
}

/**
 * Extract or synthesize a smooth coordinate path [[lon, lat], ...] for a trip
 */
function extractRouteCoordinates(trip) {
    const train = trip?.train || {};
    const rawCoords = train.polyline?.geometry?.coordinates;

    let baseCoords = [];
    if (Array.isArray(rawCoords) && rawCoords.length >= 2) {
        baseCoords = rawCoords
            .filter(c => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]))
            .map(c => [Number(c[0]), Number(c[1])]);
    }

    if (baseCoords.length < 2) {
        const origLon = train.origin?.longitude ?? train.origin?.lon ?? 9.9937;
        const origLat = train.origin?.latitude ?? train.origin?.lat ?? 53.5511;
        const destLon = train.destination?.longitude ?? train.destination?.lon ?? 13.4050;
        const destLat = train.destination?.latitude ?? train.destination?.lat ?? 52.5200;
        baseCoords = [
            [Number(origLon), Number(origLat)],
            [Number(destLon), Number(destLat)]
        ];
    }

    // If only 2 points exist, subdivide with a subtle geodesic arc so the vehicle glides along a lively path
    if (baseCoords.length === 2) {
        const [p0, p1] = baseCoords;
        const dx = p1[0] - p0[0];
        const dy = p1[1] - p0[1];
        const curved = [];
        const steps = 32;
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const arcOffset = Math.sin(t * Math.PI) * 0.08;
            const lon = p0[0] + dx * t - dy * arcOffset;
            const lat = p0[1] + dy * t + dx * arcOffset;
            curved.push([lon, lat]);
        }
        return curved;
    }

    return baseCoords;
}

/**
 * Build projected Mercator geometry, tile grid, and cumulative distance table
 */
function buildMapScene(coords, viewportW = 1280, viewportH = 720) {
    const lons = coords.map(c => c[0]);
    const lats = coords.map(c => c[1]);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);

    // Choose optimal integer zoom level z in [4..15]
    let bestZ = 10;
    for (let z = 15; z >= 4; z--) {
        const x0 = lonToWorldX(minLon, z);
        const x1 = lonToWorldX(maxLon, z);
        const y0 = latToWorldY(maxLat, z);
        const y1 = latToWorldY(minLat, z);
        const spanX = Math.abs(x1 - x0);
        const spanY = Math.abs(y1 - y0);
        if (spanX <= viewportW * 0.62 && spanY <= viewportH * 0.56) {
            bestZ = z;
            break;
        }
    }

    const worldMinX = lonToWorldX(minLon, bestZ);
    const worldMaxX = lonToWorldX(maxLon, bestZ);
    const worldMinY = latToWorldY(maxLat, bestZ);
    const worldMaxY = latToWorldY(minLat, bestZ);

    const centerWorldX = (worldMinX + worldMaxX) / 2;
    const centerWorldY = (worldMinY + worldMaxY) / 2;

    // Local scene canvas dimensions (large enough to pan around without seeing edges)
    const sceneW = viewportW * 2.5;
    const sceneH = viewportH * 2.5;
    const originWorldX = centerWorldX - sceneW / 2;
    const originWorldY = centerWorldY - sceneH / 2;

    // Tile range covering the entire sceneW x sceneH
    const maxTileIdx = Math.pow(2, bestZ) - 1;
    const startTileX = Math.max(0, Math.floor(originWorldX / 256) - 1);
    const endTileX = Math.min(maxTileIdx, Math.floor((originWorldX + sceneW) / 256) + 1);
    const startTileY = Math.max(0, Math.floor(originWorldY / 256) - 1);
    const endTileY = Math.min(maxTileIdx, Math.floor((originWorldY + sceneH) / 256) + 1);

    const tiles = [];
    for (let tx = startTileX; tx <= endTileX; tx++) {
        for (let ty = startTileY; ty <= endTileY; ty++) {
            tiles.push({
                tx,
                ty,
                z: bestZ,
                left: tx * 256 - originWorldX,
                top: ty * 256 - originWorldY
            });
        }
    }

    // Project polyline points into scene coordinates
    const points = coords.map(([lon, lat]) => ({
        x: lonToWorldX(lon, bestZ) - originWorldX,
        y: latToWorldY(lat, bestZ) - originWorldY,
        lon,
        lat
    }));

    // Cumulative arc-length table for smooth constant-speed vehicle interpolation
    const cumulativeLengths = [0];
    let totalLength = 0;
    for (let i = 1; i < points.length; i++) {
        const dx = points[i].x - points[i - 1].x;
        const dy = points[i].y - points[i - 1].y;
        const segLen = Math.hypot(dx, dy);
        totalLength += segLen;
        cumulativeLengths.push(totalLength);
    }

    // Overview fit scale so the entire route fills ~62% of the viewport at Finale
    const routeSpanX = Math.max(80, worldMaxX - worldMinX);
    const routeSpanY = Math.max(80, worldMaxY - worldMinY);
    const fitScale = Math.min(
        2.2,
        Math.max(0.85, Math.min((viewportW * 0.60) / routeSpanX, (viewportH * 0.52) / routeSpanY))
    );

    return {
        z: bestZ,
        sceneW,
        sceneH,
        centerSceneX: sceneW / 2,
        centerSceneY: sceneH / 2,
        tiles,
        points,
        cumulativeLengths,
        totalLength: Math.max(1, totalLength),
        fitScale
    };
}

/**
 * Sample exact position (x, y) and smoothed tangent heading angle (deg) at progress t in [0..1]
 */
function samplePointAlongRoute(scene, progress) {
    const { points, cumulativeLengths, totalLength } = scene;
    if (points.length === 0) return { x: 0, y: 0, angleDeg: 0 };
    if (points.length === 1) return { x: points[0].x, y: points[0].y, angleDeg: 0 };

    const targetDist = Math.max(0, Math.min(1, progress)) * totalLength;

    let segIdx = 0;
    for (let i = 0; i < cumulativeLengths.length - 1; i++) {
        if (targetDist >= cumulativeLengths[i] && targetDist <= cumulativeLengths[i + 1]) {
            segIdx = i;
            break;
        }
    }

    const p0 = points[segIdx];
    const p1 = points[Math.min(points.length - 1, segIdx + 1)];
    const segStart = cumulativeLengths[segIdx];
    const segLen = Math.max(0.0001, cumulativeLengths[segIdx + 1] - segStart);
    const localT = (targetDist - segStart) / segLen;

    const x = p0.x + (p1.x - p0.x) * localT;
    const y = p0.y + (p1.y - p0.y) * localT;

    // Look ahead/behind slightly along the path to smooth corner rotations
    const lookDelta = Math.max(4, totalLength * 0.035);
    const behindDist = Math.max(0, targetDist - lookDelta);
    const aheadDist = Math.min(totalLength, targetDist + lookDelta);

    const getCoordAtDist = (d) => {
        let idx = 0;
        for (let i = 0; i < cumulativeLengths.length - 1; i++) {
            if (d >= cumulativeLengths[i] && d <= cumulativeLengths[i + 1]) {
                idx = i;
                break;
            }
        }
        const a = points[idx];
        const b = points[Math.min(points.length - 1, idx + 1)];
        const s = cumulativeLengths[idx];
        const l = Math.max(0.0001, cumulativeLengths[idx + 1] - s);
        const u = (d - s) / l;
        return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
    };

    const behindPt = getCoordAtDist(behindDist);
    const aheadPt = getCoordAtDist(aheadDist);
    const angleDeg = (Math.atan2(aheadPt.y - behindPt.y, aheadPt.x - behindPt.x) * 180) / Math.PI;

    return { x, y, angleDeg };
}

/**
 * Render TravelBoast-style directional SVG vehicle model (oriented pointing RIGHT at 0 deg)
 */
function VehicleSprite({ vehicleType, color, frame }) {
    const pulse = Math.sin(frame * 0.35) * 0.5 + 0.5;

    if (vehicleType === 'ferry') {
        return html`
            <svg width="84" height="84" viewBox="-42 -42 84 84" style=${{ overflow: 'visible' }}>
                <!-- Water Wake Ripples -->
                <path d="M -18,-8 L -38,-20 M -18,8 L -38,20" stroke="rgba(255,255,255,0.65)" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="4 4" />
                <ellipse cx="-24" cy="0" rx=${10 + pulse * 4} ry=${6 + pulse * 2} fill="rgba(224,242,254,0.35)" />
                <!-- Drop Shadow -->
                <path d="M -22,-11 L 14,-11 L 28,0 L 14,11 L -22,11 Z" fill="rgba(0,0,0,0.45)" transform="translate(0, 5)" />
                <!-- Ferry Hull -->
                <path d="M -22,-11 L 14,-11 L 28,0 L 14,11 L -22,11 Z" fill="#ffffff" stroke=${color} stroke-width="3" stroke-linejoin="round" />
                <!-- Blue Deck & Cabin -->
                <rect x="-16" y="-7" width="24" height="14" rx="3" fill=${color} />
                <rect x="-6" y="-5" width="10" height="10" rx="2" fill="#e0f2fe" />
                <!-- Bow Accent -->
                <circle cx="18" cy="0" r="2.5" fill=${color} />
            </svg>
        `;
    }

    if (vehicleType === 'plane') {
        return html`
            <svg width="90" height="90" viewBox="-45 -45 90 90" style=${{ overflow: 'visible' }}>
                <!-- Ground Shadow -->
                <path d="M -20,0 L -6,-3 L 4,-22 L 10,-22 L 6,-3 L 22,-3 L 28,0 L 22,3 L 6,3 L 10,22 L 4,22 L -6,3 Z" fill="rgba(0,0,0,0.35)" transform="translate(8, 14) scale(0.85)" />
                <!-- Jet Contrails -->
                <line x1="-22" y1="-5" x2="-42" y2="-5" stroke="rgba(255,255,255,0.6)" stroke-width="2.5" stroke-linecap="round" />
                <line x1="-22" y1="5" x2="-42" y2="5" stroke="rgba(255,255,255,0.6)" stroke-width="2.5" stroke-linecap="round" />
                <!-- Fuselage & Swept Wings -->
                <path d="M -22,-12 L -14,0 L -22,12 L -16,12 L -8,3 L 6,3 L 2,26 L 9,26 L 16,3 L 26,3 C 31,3 34,0 34,0 C 34,0 31,-3 26,-3 L 16,-3 L 9,-26 L 2,-26 L 6,-3 L -8,-3 L -16,-12 Z" fill="#ffffff" stroke=${color} stroke-width="2.5" stroke-linejoin="round" />
            </svg>
        `;
    }

    if (vehicleType === 'ice') {
        return html`
            <svg width="92" height="92" viewBox="-46 -46 92 92" style=${{ overflow: 'visible' }}>
                <!-- Headlight Beam Cone -->
                <polygon points="28,0 56,-14 56,14" fill="rgba(254, 240, 138, 0.32)" />
                <!-- Drop Shadow -->
                <path d="M -30,-9 L 16,-9 C 26,-9 32,-4 32,0 C 32,4 26,9 16,9 L -30,9 Z" fill="rgba(0,0,0,0.5)" transform="translate(0, 5)" />
                <!-- Rear & Front Carriages -->
                <rect x="-32" y="-9" width="22" height="18" rx="3" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1.5" />
                <!-- Aerodynamic ICE Nose Cone -->
                <path d="M -8,-9 L 16,-9 C 26,-9 33,-4 33,0 C 33,4 26,9 16,9 L -8,9 Z" fill="#ffffff" stroke="#e2e8f0" stroke-width="1.5" />
                <!-- Iconic Red/Cyan Speed Stripe -->
                <line x1="-30" y1="-6" x2="24" y2="-6" stroke=${color} stroke-width="2.5" stroke-linecap="round" />
                <line x1="-30" y1="6" x2="24" y2="6" stroke=${color} stroke-width="2.5" stroke-linecap="round" />
                <!-- Cockpit Windshield -->
                <path d="M 15,-5 C 21,-5 25,-2 25,0 C 25,2 21,5 15,5 L 12,4 L 12,-4 Z" fill="#0f172a" />
                <!-- Roof Louvers -->
                <rect x="-24" y="-3" width="12" height="6" rx="1.5" fill="#94a3b8" />
                <rect x="-3" y="-3" width="11" height="6" rx="1.5" fill="#94a3b8" />
            </svg>
        `;
    }

    // Default Regional / S-Bahn / Tram / Bus Toy Vehicle
    return html`
        <svg width="88" height="88" viewBox="-44 -44 88 88" style=${{ overflow: 'visible' }}>
            <!-- Headlight Glow -->
            <polygon points="24,0 48,-12 48,12" fill="rgba(253, 224, 71, 0.28)" />
            <!-- Shadow -->
            <rect x="-26" y="-10" width="52" height="20" rx="7" fill="rgba(0,0,0,0.48)" transform="translate(0, 5)" />
            <!-- Main Train Body -->
            <rect x="-26" y="-10" width="52" height="20" rx="7" fill=${color} stroke="#ffffff" stroke-width="2.5" />
            <!-- Silver Roof Panel -->
            <rect x="-20" y="-6" width="34" height="12" rx="4" fill="rgba(255,255,255,0.22)" />
            <!-- Front Windshield -->
            <rect x="14" y="-7" width="8" height="14" rx="3" fill="#0f172a" />
            <!-- Headlights -->
            <circle cx="24" cy="-5" r="2" fill="#fef08a" />
            <circle cx="24" cy="5" r="2" fill="#fef08a" />
        </svg>
    `;
}

export function TripStoryComposition({
    trip,
    username = 'Traveler',
    mapStyle = 'voyager'
}) {
    const frame = useCurrentFrame();
    const { fps, width, height } = useVideoConfig();

    if (!trip) {
        return html`
            <${AbsoluteFill} style=${{
                backgroundColor: '#080a10',
                color: '#94a3b8',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 24,
                fontFamily: 'sans-serif'
            }}>
                Select a journey to generate your TravelBoast map animation
            <//>
        `;
    }

    const train = trip.train || {};
    const categoryKey = train.category || 'regional';
    const catMeta = CATEGORY_META[categoryKey] || CATEGORY_META.unknown;
    const styleConfig = MAP_STYLES[mapStyle] || MAP_STYLES.voyager;

    const lineName = train.lineName || 'Train';
    const originName = train.origin?.name || trip.origin || 'Origin';
    const destName = train.destination?.name || trip.destination || 'Destination';
    const totalDistanceKm = train.totalDistance
        ? (train.totalDistance / 1000)
        : (trip.distance ? trip.distance / 1000 : 28.5);
    const delayMinutes = typeof train.departureDelay === 'number' ? Math.round(train.departureDelay / 60) : 0;
    const durationMin = computeTripDurationMinutes(trip);
    const durationFormatted = durationMin !== null ? formatHumanDuration(durationMin) : '42m';
    const note = trip.body || '';
    const buddies = Array.isArray(trip.bodyMentions) ? trip.bodyMentions.map(m => m.username) : [];
    const dateStr = trip.createdAt
        ? new Date(trip.createdAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
        : 'Journey';

    // Build Mercator map projection scene
    const coords = React.useMemo(() => extractRouteCoordinates(trip), [trip]);
    const scene = React.useMemo(() => buildMapScene(coords, width, height), [coords, width, height]);

    const originPt = scene.points[0];
    const destPt = scene.points[scene.points.length - 1];

    // -------------------------------------------------------------------------
    // TIMELINE CHOREOGRAPHY (240 Frames @ 30fps = 8.0 seconds)
    // - Frames 0..32:   Origin Zoom-In & Pin Drop Intro
    // - Frames 32..172: Vehicle Chase & Dynamic Camera Follow along the Map
    // - Frames 172..240: Destination Arrival Burst & Full-Route Overview Finale
    // -------------------------------------------------------------------------
    const introSpring = spring({ frame, fps, config: { damping: 13, stiffness: 110 } });

    // Smooth S-curve journey progress from 0 to 1 during frames [30..172]
    const rawTravel = interpolate(frame, [30, 172], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp'
    });
    // Ease-in-out cubic for natural train acceleration & braking
    const travelProgress = rawTravel < 0.5
        ? 4 * rawTravel * rawTravel * rawTravel
        : 1 - Math.pow(-2 * rawTravel + 2, 3) / 2;

    const finaleBlend = spring({
        frame: frame - 170,
        fps,
        config: { damping: 16, stiffness: 70, mass: 1.1 }
    });

    const cardPopupSpring = spring({
        frame: frame - 182,
        fps,
        config: { damping: 13, stiffness: 95 }
    });

    // Current vehicle position & heading along the projected polyline
    const vehiclePose = samplePointAlongRoute(scene, travelProgress);

    // Camera target position blends from following the vehicle -> full route center at Finale
    const camTargetX = interpolate(finaleBlend, [0, 1], [vehiclePose.x, scene.centerSceneX]);
    const camTargetY = interpolate(finaleBlend, [0, 1], [vehiclePose.y, scene.centerSceneY]);

    // Camera zoom: starts zoomed in (2.15x), stays tight during chase (1.85x), zooms out to fitScale on Finale
    const chaseZoom = interpolate(
        frame,
        [0, 30, 100, 170],
        [scene.fitScale * 1.95, scene.fitScale * 1.75, scene.fitScale * 1.55, scene.fitScale * 1.70],
        { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
    );
    const camScale = interpolate(finaleBlend, [0, 1], [chaseZoom, scene.fitScale]);

    // 3D Perspective Camera Tilt: 24deg during chase, flattens to 6deg on Finale overview
    const camTiltX = interpolate(finaleBlend, [0, 1], [24, 6]);
    const camSwayZ = interpolate(finaleBlend, [0, 1], [Math.sin(frame * 0.04) * 2.2, 0]);

    // Build SVG path string for the entire route and the drawn portion
    const fullSvgPath = scene.points
        .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)},${p.y.toFixed(1)}`)
        .join(' ');

    const dashTotal = scene.totalLength + 20;
    const dashOffset = dashTotal * (1 - travelProgress);

    // Live counters
    const currentKm = (totalDistanceKm * travelProgress).toFixed(1);
    const currentCo2 = (totalDistanceKm * travelProgress * 0.14).toFixed(1);

    // Waypoint milestone popups along the track (25%, 50%, 75%)
    const milestones = [0.3, 0.65].map((mPct) => {
        const pt = samplePointAlongRoute(scene, mPct);
        const passed = travelProgress >= mPct;
        return { mPct, pt, passed };
    });

    return html`
        <${AbsoluteFill} style=${{
            backgroundColor: styleConfig.bg,
            overflow: 'hidden',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            userSelect: 'none'
        }}>
            <!-- =================================================================
                 3D PERSPECTIVE WORLD MAP STAGE
                 ================================================================= -->
            <div style=${{
                position: 'absolute',
                width: `${width}px`,
                height: `${height}px`,
                perspective: '1100px',
                overflow: 'hidden'
            }}>
                <div style=${{
                    position: 'absolute',
                    width: `${scene.sceneW}px`,
                    height: `${scene.sceneH}px`,
                    left: `${width / 2}px`,
                    top: `${height / 2}px`,
                    transformOrigin: `${camTargetX}px ${camTargetY}px`,
                    transform: `translate3d(${-camTargetX}px, ${-camTargetY}px, 0px) rotateX(${camTiltX.toFixed(2)}deg) rotateZ(${camSwayZ.toFixed(2)}deg) scale(${camScale.toFixed(4)})`,
                    willChange: 'transform'
                }}>
                    <!-- 1. Web Mercator Raster Map Tiles -->
                    ${scene.tiles.map(t => html`
                        <img
                            key=${`${t.z}-${t.tx}-${t.ty}-${mapStyle}`}
                            src=${styleConfig.getTileUrl(t.z, t.tx, t.ty)}
                            crossOrigin="anonymous"
                            alt=""
                            style=${{
                                position: 'absolute',
                                left: `${t.left}px`,
                                top: `${t.top}px`,
                                width: '256.5px',
                                height: '256.5px',
                                display: 'block',
                                pointerEvents: 'none'
                            }}
                        />
                    `)}

                    <!-- 2. SVG Route Trail Layer -->
                    <svg
                        width=${scene.sceneW}
                        height=${scene.sceneH}
                        viewBox=${`0 0 ${scene.sceneW} ${scene.sceneH}`}
                        style=${{
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            overflow: 'visible',
                            pointerEvents: 'none'
                        }}
                    >
                        <defs>
                            <filter id="tbRouteShadow" x="-20%" y="-20%" width="140%" height="140%">
                                <feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="rgba(0,0,0,0.45)" />
                            </filter>
                        </defs>

                        <!-- Subtle Unvisited Guide Track -->
                        <path
                            d=${fullSvgPath}
                            fill="none"
                            stroke=${styleConfig.isDark ? 'rgba(255,255,255,0.18)' : 'rgba(15,23,42,0.22)'}
                            stroke-width=${10 / Math.sqrt(camScale)}
                            stroke-dasharray=${`${10 / Math.sqrt(camScale)} ${10 / Math.sqrt(camScale)}`}
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        />

                        <!-- White Outer Casing for TravelBoast Pop -->
                        <path
                            d=${fullSvgPath}
                            fill="none"
                            stroke="#ffffff"
                            stroke-width=${16 / Math.sqrt(camScale)}
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-dasharray=${dashTotal}
                            stroke-dashoffset=${dashOffset}
                            filter="url(#tbRouteShadow)"
                        />

                        <!-- Vibrant Category Colored Core Line -->
                        <path
                            d=${fullSvgPath}
                            fill="none"
                            stroke=${catMeta.color}
                            stroke-width=${10 / Math.sqrt(camScale)}
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-dasharray=${dashTotal}
                            stroke-dashoffset=${dashOffset}
                        />

                        <!-- Inner Animated Dash Striping -->
                        <path
                            d=${fullSvgPath}
                            fill="none"
                            stroke="rgba(255,255,255,0.45)"
                            stroke-width=${3.5 / Math.sqrt(camScale)}
                            stroke-linecap="round"
                            stroke-dasharray=${`${8 / Math.sqrt(camScale)} ${14 / Math.sqrt(camScale)}`}
                            stroke-dashoffset=${dashOffset}
                        />
                    </svg>

                    <!-- 3. Intermediate Milestone Waypoint Dots -->
                    ${milestones.map((m, idx) => html`
                        <div
                            key=${idx}
                            style=${{
                                position: 'absolute',
                                left: `${m.pt.x}px`,
                                top: `${m.pt.y}px`,
                                transform: `translate(-50%, -50%) scale(${(m.passed ? 1 : 0) / Math.sqrt(camScale)})`,
                                transition: 'transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)',
                                pointerEvents: 'none'
                            }}
                        >
                            <div style=${{
                                width: 16,
                                height: 16,
                                borderRadius: '50%',
                                background: '#ffffff',
                                border: `4px solid ${catMeta.color}`,
                                boxShadow: '0 2px 8px rgba(0,0,0,0.4)'
                            }} />
                        </div>
                    `)}

                    <!-- 4. Origin Station Pin & Callout Flag -->
                    <div style=${{
                        position: 'absolute',
                        left: `${originPt.x}px`,
                        top: `${originPt.y}px`,
                        transform: `translate(-50%, -50%) scale(${introSpring / Math.sqrt(camScale)})`,
                        zIndex: 20
                    }}>
                        <div style=${{
                            width: 24,
                            height: 24,
                            borderRadius: '50%',
                            background: '#10b981',
                            border: '4px solid #ffffff',
                            boxShadow: '0 4px 14px rgba(0,0,0,0.45)'
                        }} />
                        <div style=${{
                            position: 'absolute',
                            bottom: 22,
                            left: '50%',
                            transform: 'translateX(-50%)',
                            background: '#0f172a',
                            color: '#ffffff',
                            padding: '5px 12px',
                            borderRadius: 999,
                            fontSize: 13,
                            fontWeight: 800,
                            whiteSpace: 'nowrap',
                            border: '2px solid #10b981',
                            boxShadow: '0 6px 16px rgba(0,0,0,0.45)'
                        }}>
                            🟢 ${originName}
                        </div>
                    </div>

                    <!-- 5. Destination Station Pin & Celebration Ring -->
                    <div style=${{
                        position: 'absolute',
                        left: `${destPt.x}px`,
                        top: `${destPt.y}px`,
                        transform: `translate(-50%, -50%) scale(${(travelProgress > 0.92 ? 1.15 : 0.85) / Math.sqrt(camScale)})`,
                        zIndex: 21
                    }}>
                        ${travelProgress >= 0.98 ? html`
                            <div style=${{
                                position: 'absolute',
                                left: -24,
                                top: -24,
                                width: 72,
                                height: 72,
                                borderRadius: '50%',
                                border: `4px solid ${catMeta.color}`,
                                opacity: Math.max(0, 1 - (frame - 170) / 35),
                                transform: `scale(${1 + Math.max(0, frame - 170) * 0.06})`
                            }} />
                        ` : null}
                        <div style=${{
                            width: 26,
                            height: 26,
                            borderRadius: '50%',
                            background: catMeta.color,
                            border: '4px solid #ffffff',
                            boxShadow: '0 4px 14px rgba(0,0,0,0.45)'
                        }} />
                        <div style=${{
                            position: 'absolute',
                            top: 22,
                            left: '50%',
                            transform: 'translateX(-50%)',
                            background: '#0f172a',
                            color: '#ffffff',
                            padding: '5px 12px',
                            borderRadius: 999,
                            fontSize: 13,
                            fontWeight: 800,
                            whiteSpace: 'nowrap',
                            border: `2px solid ${catMeta.color}`,
                            boxShadow: '0 6px 16px rgba(0,0,0,0.45)'
                        }}>
                            🏁 ${destName}
                        </div>
                    </div>

                    <!-- 6. Moving Directional 3D-Style Vehicle Model -->
                    <div style=${{
                        position: 'absolute',
                        left: `${vehiclePose.x}px`,
                        top: `${vehiclePose.y}px`,
                        transform: `translate(-50%, -50%) scale(${1.05 / Math.sqrt(camScale)}) rotate(${vehiclePose.angleDeg.toFixed(1)}deg)`,
                        zIndex: 30,
                        pointerEvents: 'none'
                    }}>
                        <${VehicleSprite}
                            vehicleType=${catMeta.vehicle}
                            color=${catMeta.color}
                            frame=${frame}
                        />
                    </div>

                    <!-- 7. Upright Floating Vehicle Line Tag (Follows Vehicle during Chase) -->
                    ${finaleBlend < 0.85 ? html`
                        <div style=${{
                            position: 'absolute',
                            left: `${vehiclePose.x}px`,
                            top: `${vehiclePose.y}px`,
                            transform: `translate(-50%, ${-46 / Math.sqrt(camScale)}px) scale(${1 / Math.sqrt(camScale)})`,
                            opacity: 1 - finaleBlend,
                            zIndex: 35,
                            background: catMeta.color,
                            color: '#ffffff',
                            padding: '4px 11px',
                            borderRadius: 999,
                            fontWeight: 800,
                            fontSize: 13,
                            whiteSpace: 'nowrap',
                            border: '2px solid #ffffff',
                            boxShadow: '0 6px 16px rgba(0,0,0,0.4)'
                        }}>
                            ${lineName} • ${currentKm} km
                        </div>
                    ` : null}
                </div>
            </div>

            <!-- =================================================================
                 CINEMATIC VIGNETTE & TOP HUD OVERLAY
                 ================================================================= -->
            <div style=${{
                position: 'absolute',
                inset: 0,
                background: 'radial-gradient(circle at center, transparent 58%, rgba(7, 10, 18, 0.42) 100%)',
                pointerEvents: 'none'
            }} />

            <!-- Top-Left Pill: Traveler & Route Header -->
            <div style=${{
                position: 'absolute',
                top: 24,
                left: 28,
                right: 28,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                transform: `translateY(${(1 - introSpring) * -40}px)`,
                opacity: introSpring,
                zIndex: 50
            }}>
                <div style=${{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    background: 'rgba(11, 15, 25, 0.88)',
                    backdropFilter: 'blur(12px)',
                    padding: '10px 18px',
                    borderRadius: 18,
                    border: '1px solid rgba(255,255,255,0.16)',
                    boxShadow: '0 12px 28px rgba(0,0,0,0.4)'
                }}>
                    <span style=${{
                        background: catMeta.color,
                        color: '#ffffff',
                        fontWeight: 900,
                        fontSize: 15,
                        padding: '5px 12px',
                        borderRadius: 10,
                        letterSpacing: '0.03em',
                        boxShadow: `0 0 16px ${catMeta.color}88`
                    }}>
                        ${lineName}
                    </span>
                    <div>
                        <div style=${{ fontSize: 16, fontWeight: 800, color: '#f8fafc' }}>
                            ${originName} <span style=${{ color: '#38bdf8', margin: '0 6px' }}>➔</span> ${destName}
                        </div>
                        <div style=${{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>
                            @${username} • ${dateStr} • ${catMeta.label}
                        </div>
                    </div>
                </div>

                <!-- Live Telemetry Counter Pill -->
                <div style=${{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 18,
                    background: 'rgba(11, 15, 25, 0.88)',
                    backdropFilter: 'blur(12px)',
                    padding: '10px 20px',
                    borderRadius: 18,
                    border: '1px solid rgba(255,255,255,0.16)',
                    boxShadow: '0 12px 28px rgba(0,0,0,0.4)'
                }}>
                    <div style=${{ textAlign: 'right' }}>
                        <div style=${{ fontSize: 10, textTransform: 'uppercase', color: '#94a3b8', fontWeight: 700 }}>Distance</div>
                        <div style=${{ fontSize: 20, fontWeight: 900, color: '#38bdf8', fontVariantNumeric: 'tabular-nums' }}>
                            ${currentKm} <span style=${{ fontSize: 12 }}>km</span>
                        </div>
                    </div>
                    <div style=${{ width: 1, height: 28, background: 'rgba(255,255,255,0.14)' }} />
                    <div style=${{ textAlign: 'right' }}>
                        <div style=${{ fontSize: 10, textTransform: 'uppercase', color: '#94a3b8', fontWeight: 700 }}>Duration</div>
                        <div style=${{ fontSize: 18, fontWeight: 800, color: '#f8fafc' }}>${durationFormatted}</div>
                    </div>
                    <div style=${{ width: 1, height: 28, background: 'rgba(255,255,255,0.14)' }} />
                    <div style=${{ textAlign: 'right' }}>
                        <div style=${{ fontSize: 10, textTransform: 'uppercase', color: '#94a3b8', fontWeight: 700 }}>CO₂ Saved</div>
                        <div style=${{ fontSize: 18, fontWeight: 800, color: '#34d399', fontVariantNumeric: 'tabular-nums' }}>
                            ${currentCo2} <span style=${{ fontSize: 12 }}>kg</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- =================================================================
                 BOTTOM PROGRESS BAR OR FINALE SUMMARY BANNER
                 ================================================================= -->
            <!-- Journey Progress Bar (visible during chase) -->
            <div style=${{
                position: 'absolute',
                bottom: 98,
                left: 40,
                right: 40,
                opacity: 1 - cardPopupSpring,
                transform: `translateY(${cardPopupSpring * 30}px)`,
                zIndex: 50,
                pointerEvents: 'none'
            }}>
                <div style=${{
                    background: 'rgba(11, 15, 25, 0.85)',
                    backdropFilter: 'blur(10px)',
                    borderRadius: 16,
                    padding: '10px 20px',
                    border: '1px solid rgba(255,255,255,0.14)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16
                }}>
                    <span style=${{ fontSize: 13, fontWeight: 700, color: '#10b981', whiteSpace: 'nowrap' }}>
                        ${originName}
                    </span>
                    <div style=${{
                        flex: 1,
                        height: 8,
                        background: 'rgba(255,255,255,0.12)',
                        borderRadius: 999,
                        overflow: 'hidden',
                        position: 'relative'
                    }}>
                        <div style=${{
                            width: `${(travelProgress * 100).toFixed(1)}%`,
                            height: '100%',
                            background: `linear-gradient(90deg, #10b981, ${catMeta.color})`,
                            borderRadius: 999
                        }} />
                    </div>
                    <span style=${{ fontSize: 13, fontWeight: 700, color: '#f8fafc', whiteSpace: 'nowrap' }}>
                        ${destName}
                    </span>
                </div>
            </div>

            <!-- Finale Summary Card (Springs in at Frame 182+) -->
            ${cardPopupSpring > 0.01 ? html`
                <div style=${{
                    position: 'absolute',
                    bottom: 98,
                    left: 40,
                    right: 40,
                    transform: `translateY(${(1 - cardPopupSpring) * 60}px) scale(${0.92 + cardPopupSpring * 0.08})`,
                    opacity: cardPopupSpring,
                    zIndex: 60,
                    background: 'rgba(11, 15, 25, 0.92)',
                    backdropFilter: 'blur(16px)',
                    borderRadius: 20,
                    padding: '16px 24px',
                    border: `2px solid ${catMeta.color}`,
                    boxShadow: '0 20px 50px rgba(0,0,0,0.65)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 20
                }}>
                    <div style=${{ display: 'flex', alignItems: 'center', gap: 16 }}>
                        <div style=${{
                            width: 48,
                            height: 48,
                            borderRadius: 14,
                            background: `${catMeta.color}22`,
                            border: `2px solid ${catMeta.color}`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 24
                        }}>
                            🎉
                        </div>
                        <div>
                            <div style=${{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <span style=${{ fontSize: 18, fontWeight: 900, color: '#ffffff' }}>
                                    Journey Complete!
                                </span>
                                <span style=${{
                                    fontSize: 12,
                                    fontWeight: 700,
                                    padding: '2px 10px',
                                    borderRadius: 999,
                                    background: delayMinutes > 0 ? 'rgba(239,68,68,0.2)' : 'rgba(16,185,129,0.2)',
                                    color: delayMinutes > 0 ? '#f87171' : '#34d399',
                                    border: `1px solid ${delayMinutes > 0 ? 'rgba(239,68,68,0.4)' : 'rgba(16,185,129,0.4)'}`
                                }}>
                                    ${delayMinutes > 0 ? `+${delayMinutes} min delay` : '✓ Punctual Arrival'}
                                </span>
                            </div>
                            <div style=${{ fontSize: 13, color: '#cbd5e1', marginTop: 4 }}>
                                ${note ? `"${note}"` : `${lineName} from ${originName} to ${destName}`}
                                ${buddies.length > 0 ? ` • With ${buddies.map(b => `@${b}`).join(', ')}` : ''}
                            </div>
                        </div>
                    </div>

                    <div style=${{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 16,
                        background: 'rgba(255,255,255,0.05)',
                        padding: '10px 18px',
                        borderRadius: 14
                    }}>
                        <div style=${{ textAlign: 'center' }}>
                            <div style=${{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700 }}>Total Route</div>
                            <div style=${{ fontSize: 18, fontWeight: 900, color: '#38bdf8' }}>${totalDistanceKm.toFixed(1)} km</div>
                        </div>
                        <div style=${{ width: 1, height: 26, background: 'rgba(255,255,255,0.12)' }} />
                        <div style=${{ textAlign: 'center' }}>
                            <div style=${{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700 }}>Travel Time</div>
                            <div style=${{ fontSize: 18, fontWeight: 900, color: '#f8fafc' }}>${durationFormatted}</div>
                        </div>
                    </div>
                </div>
            ` : null}
        <//>
    `;
}
