/**
 * Vector Map Canvas Renderer
 * Renders European continental landmasses, country boundaries, German states,
 * major rivers/waterways, trunk railway corridors, graticule gridlines, and
 * multi-tier reference cities with pure vector paths and Path2D hardware acceleration.
 * 100% offline, zero network tile requests, infinite mathematical resolution.
 */

import {
    VECTOR_COUNTRIES,
    VECTOR_GERMAN_STATES,
    VECTOR_RIVERS,
    VECTOR_CITIES,
    VECTOR_RAIL_CORRIDORS
} from './vectorData.js';
import { lonToWorldX, latToWorldY } from './geometry.js';

// Global Path2D Cache keyed by baseScene signature
const SCENE_PATH_CACHE = new Map();

/**
 * Get or build cached Path2D objects for countries, states, rivers, and railways.
 * Pre-baking these eliminates thousands of trigonometric Mercator projections per frame.
 */
function getOrCreateScenePaths(baseScene) {
    if (typeof Path2D === 'undefined') return null;
    if (!baseScene || typeof baseScene.z !== 'number') return null;
    const cacheKey = `${baseScene.z}_${Math.round(baseScene.originWX)}_${Math.round(baseScene.originWY)}`;

    if (SCENE_PATH_CACHE.has(cacheKey)) {
        return SCENE_PATH_CACHE.get(cacheKey);
    }

    // 1. Countries (consolidated compound paths: DE vs all other countries for batch rendering)
    const otherCountriesPath = new Path2D();
    const deCountryPath = new Path2D();
    for (const country of VECTOR_COUNTRIES) {
        if (country.id === 'DEU') {
            buildGeometryPath2D(deCountryPath, country.geometry, baseScene);
        } else {
            buildGeometryPath2D(otherCountriesPath, country.geometry, baseScene);
        }
    }

    // 2. German Bundesländer (combined single path for maximum performance)
    const statesPath = new Path2D();
    for (const state of VECTOR_GERMAN_STATES) {
        buildGeometryPath2D(statesPath, state.geometry, baseScene);
    }

    // 3. Major Rivers / Waterways
    const riversPath = new Path2D();
    for (const river of VECTOR_RIVERS) {
        if (!river.coordinates || river.coordinates.length < 2) continue;
        const pts = river.coordinates;
        const x0 = lonToWorldX(pts[0][0], baseScene.z) - baseScene.originWX;
        const y0 = latToWorldY(pts[0][1], baseScene.z) - baseScene.originWY;
        riversPath.moveTo(x0, y0);
        for (let i = 1; i < pts.length; i++) {
            const xi = lonToWorldX(pts[i][0], baseScene.z) - baseScene.originWX;
            const yi = latToWorldY(pts[i][1], baseScene.z) - baseScene.originWY;
            riversPath.lineTo(xi, yi);
        }
    }

    // 4. Trunk Rail Corridors
    const railPath = new Path2D();
    for (const line of VECTOR_RAIL_CORRIDORS) {
        if (!line || line.length < 2) continue;
        const x0 = lonToWorldX(line[0][0], baseScene.z) - baseScene.originWX;
        const y0 = latToWorldY(line[0][1], baseScene.z) - baseScene.originWY;
        railPath.moveTo(x0, y0);
        for (let i = 1; i < line.length; i++) {
            const xi = lonToWorldX(line[i][0], baseScene.z) - baseScene.originWX;
            const yi = latToWorldY(line[i][1], baseScene.z) - baseScene.originWY;
            railPath.lineTo(xi, yi);
        }
    }

    // 5. Pre-projected reference cities (avoids spherical math in hot render loop)
    const projectedCities = VECTOR_CITIES.map(city => ({
        ...city,
        cx: lonToWorldX(city.lon, baseScene.z) - baseScene.originWX,
        cy: latToWorldY(city.lat, baseScene.z) - baseScene.originWY
    }));

    const scenePaths = { otherCountriesPath, deCountryPath, statesPath, riversPath, railPath, projectedCities };

    // Limit cache size to prevent memory leaks across long sessions
    if (SCENE_PATH_CACHE.size > 8) {
        SCENE_PATH_CACHE.clear();
    }
    SCENE_PATH_CACHE.set(cacheKey, scenePaths);
    return scenePaths;
}

export function drawVectorBaseMap({
    ctx,
    baseScene,
    camZoom,
    styleConfig,
    camTargetX,
    camTargetY,
    width = 960,
    height = 960
}) {
    const isDark = styleConfig.isDark !== false;

    const landColor = isDark ? '#141c2e' : '#f8fafc';
    const countryBorderColor = isDark ? 'rgba(71, 85, 105, 0.55)' : 'rgba(148, 163, 184, 0.65)';
    const targetCountryColor = isDark ? '#1a243a' : '#ffffff';
    const stateBorderColor = isDark ? 'rgba(96, 165, 250, 0.40)' : 'rgba(100, 116, 139, 0.50)';
    const riverColor = isDark ? 'rgba(56, 189, 248, 0.32)' : 'rgba(14, 165, 233, 0.42)';
    const railColor = isDark ? 'rgba(148, 163, 184, 0.25)' : 'rgba(100, 116, 139, 0.35)';
    const graticuleColor = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
    const graticuleText = isDark ? 'rgba(148, 163, 184, 0.55)' : 'rgba(100, 116, 139, 0.70)';

    const cached = getOrCreateScenePaths(baseScene);

    // 1. European Countries (batched compound fills & borders: 4 draw calls instead of 70+)
    ctx.save();
    ctx.lineWidth = 1.6 / camZoom;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (cached) {
        ctx.fillStyle = landColor;
        ctx.strokeStyle = countryBorderColor;
        ctx.fill(cached.otherCountriesPath);
        ctx.stroke(cached.otherCountriesPath);

        ctx.fillStyle = targetCountryColor;
        ctx.fill(cached.deCountryPath);
        ctx.stroke(cached.deCountryPath);
    } else {
        ctx.fillStyle = landColor;
        ctx.strokeStyle = countryBorderColor;
        ctx.beginPath();
        for (const country of VECTOR_COUNTRIES) {
            if (country.id !== 'DEU') {
                drawGeometryPath(ctx, country.geometry, baseScene);
            }
        }
        ctx.fill();
        ctx.stroke();

        const de = VECTOR_COUNTRIES.find(c => c.id === 'DEU');
        if (de) {
            ctx.fillStyle = targetCountryColor;
            ctx.beginPath();
            drawGeometryPath(ctx, de.geometry, baseScene);
            ctx.fill();
            ctx.stroke();
        }
    }
    ctx.restore();

    // 2. Major Waterways / Rivers (Level of Detail: appears at regional zoom)
    if (camZoom >= 1.0) {
        ctx.save();
        ctx.strokeStyle = riverColor;
        ctx.lineWidth = Math.max(1.8, 2.8 / Math.pow(camZoom, 0.6)) / camZoom;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (cached) {
            ctx.stroke(cached.riversPath);
        } else {
            ctx.beginPath();
            for (const river of VECTOR_RIVERS) {
                const pts = river.coordinates;
                if (!pts || pts.length < 2) continue;
                ctx.moveTo(
                    lonToWorldX(pts[0][0], baseScene.z) - baseScene.originWX,
                    latToWorldY(pts[0][1], baseScene.z) - baseScene.originWY
                );
                for (let i = 1; i < pts.length; i++) {
                    ctx.lineTo(
                        lonToWorldX(pts[i][0], baseScene.z) - baseScene.originWX,
                        latToWorldY(pts[i][1], baseScene.z) - baseScene.originWY
                    );
                }
            }
            ctx.stroke();
        }
        ctx.restore();
    }

    // 3. German Bundesländer (States)
    ctx.save();
    ctx.strokeStyle = stateBorderColor;
    ctx.lineWidth = 1.2 / camZoom;
    ctx.setLineDash([4 / camZoom, 4 / camZoom]);
    ctx.lineJoin = 'round';
    if (cached) {
        ctx.stroke(cached.statesPath);
    } else {
        ctx.beginPath();
        for (const state of VECTOR_GERMAN_STATES) {
            drawGeometryPath(ctx, state.geometry, baseScene);
        }
        ctx.stroke();
    }
    ctx.restore();

    // 4. Trunk Rail Corridors (Level of Detail: subtle track network at mid/high zoom)
    if (camZoom >= 1.5) {
        ctx.save();
        ctx.strokeStyle = railColor;
        ctx.lineWidth = 1.1 / camZoom;
        ctx.lineJoin = 'round';
        ctx.setLineDash([5 / camZoom, 4 / camZoom]);
        if (cached) {
            ctx.stroke(cached.railPath);
        } else {
            ctx.beginPath();
            for (const line of VECTOR_RAIL_CORRIDORS) {
                if (!line || line.length < 2) continue;
                ctx.moveTo(
                    lonToWorldX(line[0][0], baseScene.z) - baseScene.originWX,
                    latToWorldY(line[0][1], baseScene.z) - baseScene.originWY
                );
                for (let i = 1; i < line.length; i++) {
                    ctx.lineTo(
                        lonToWorldX(line[i][0], baseScene.z) - baseScene.originWX,
                        latToWorldY(line[i][1], baseScene.z) - baseScene.originWY
                    );
                }
            }
            ctx.stroke();
        }
        ctx.restore();
    }

    // 5. Graticule Grid Lines (Compound batched path: 1 draw call instead of 25+)
    ctx.save();
    ctx.strokeStyle = graticuleColor;
    ctx.lineWidth = 1.0 / camZoom;
    ctx.fillStyle = graticuleText;
    const gratFontSize = 13 / camZoom;
    ctx.font = `600 ${gratFontSize}px Inter, sans-serif`;

    const lonStep = camZoom > 4 ? 0.5 : (camZoom > 1.5 ? 1 : 2);
    const minLon = 2;
    const maxLon = 18;
    ctx.beginPath();
    for (let lon = minLon; lon <= maxLon; lon += lonStep) {
        const x = lonToWorldX(lon, baseScene.z) - baseScene.originWX;
        const yTop = latToWorldY(56, baseScene.z) - baseScene.originWY;
        const yBot = latToWorldY(46, baseScene.z) - baseScene.originWY;
        ctx.moveTo(x, yTop);
        ctx.lineTo(x, yBot);
    }

    const latStep = camZoom > 4 ? 0.5 : (camZoom > 1.5 ? 1 : 2);
    for (let lat = 46; lat <= 56; lat += latStep) {
        const y = latToWorldY(lat, baseScene.z) - baseScene.originWY;
        const xLeft = lonToWorldX(minLon, baseScene.z) - baseScene.originWX;
        const xRight = lonToWorldX(maxLon, baseScene.z) - baseScene.originWY;
        ctx.moveTo(xLeft, y);
        ctx.lineTo(xRight, y);
    }
    ctx.stroke();
    ctx.restore();

    // 6. Reference Cities (Multi-Tier LOD with Viewport Culling & pre-projected coords)
    ctx.save();
    const haloColor = isDark ? 'rgba(10, 16, 28, 0.92)' : 'rgba(255, 255, 255, 0.92)';
    const textColor = isDark ? '#f1f5f9' : '#0f172a';
    const tier2TextColor = isDark ? 'rgba(203, 213, 225, 0.88)' : 'rgba(51, 65, 85, 0.88)';

    const cities = cached?.projectedCities || VECTOR_CITIES;

    // Viewport bounds in scene coordinates for frustum culling
    const hasCam = typeof camTargetX === 'number' && typeof camTargetY === 'number';
    const margin = (140 / camZoom);
    const halfW = (width / (2 * camZoom)) + margin;
    const halfH = (height / (2 * camZoom)) + margin;
    const minSceneX = hasCam ? camTargetX - halfW : -Infinity;
    const maxSceneX = hasCam ? camTargetX + halfW : Infinity;
    const minSceneY = hasCam ? camTargetY - halfH : -Infinity;
    const maxSceneY = hasCam ? camTargetY + halfH : Infinity;

    for (const city of cities) {
        const isTier1 = (city.tier || 1) === 1;
        // Level of Detail: Tier 2 regional cities fade in at camZoom >= 1.7
        if (!isTier1 && camZoom < 1.7) continue;

        const cx = typeof city.cx === 'number'
            ? city.cx
            : lonToWorldX(city.lon, baseScene.z) - baseScene.originWX;
        const cy = typeof city.cy === 'number'
            ? city.cy
            : latToWorldY(city.lat, baseScene.z) - baseScene.originWY;

        // Viewport Culling: Skip offscreen cities to avoid heavy font rasterization
        if (cx < minSceneX || cx > maxSceneX || cy < minSceneY || cy > maxSceneY) {
            continue;
        }

        const dotRadius = (isTier1 ? 5.8 : 4.0) / camZoom;
        ctx.fillStyle = isDark
            ? (isTier1 ? '#60a5fa' : '#38bdf8')
            : (isTier1 ? '#2563eb' : '#0284c7');
        ctx.beginPath();
        ctx.arc(cx, cy, dotRadius, 0, Math.PI * 2);
        ctx.fill();

        // High-contrast, phone-optimized typography for Instagram & Twitter
        const fontSizePx = (isTier1 ? 28 : 20) / camZoom;
        const fontWeight = isTier1 ? '800' : '700';
        ctx.font = `${fontWeight} ${fontSizePx}px Inter, -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        const labelX = cx + (isTier1 ? 10 : 8) / camZoom;
        const labelY = cy;

        // Protective text halo so letters are legible over borders & lines
        ctx.strokeStyle = haloColor;
        ctx.lineWidth = 4.5 / camZoom;
        ctx.lineJoin = 'round';
        if (typeof ctx.strokeText === 'function') {
            ctx.strokeText(city.name, labelX, labelY);
        }

        ctx.fillStyle = isTier1 ? textColor : tier2TextColor;
        ctx.fillText(city.name, labelX, labelY);
    }
    ctx.restore();
}

function buildGeometryPath2D(targetPath, geometry, baseScene) {
    if (!geometry) return;
    if (geometry.type === 'Polygon') {
        appendPolygonToPath(targetPath, geometry.coordinates, baseScene);
    } else if (geometry.type === 'MultiPolygon') {
        for (const poly of geometry.coordinates) {
            appendPolygonToPath(targetPath, poly, baseScene);
        }
    }
}

function appendPolygonToPath(targetPath, rings, baseScene) {
    for (const ring of rings) {
        if (!ring || ring.length < 3) continue;
        const startX = lonToWorldX(ring[0][0], baseScene.z) - baseScene.originWX;
        const startY = latToWorldY(ring[0][1], baseScene.z) - baseScene.originWY;
        targetPath.moveTo(startX, startY);
        for (let i = 1; i < ring.length; i++) {
            const rx = lonToWorldX(ring[i][0], baseScene.z) - baseScene.originWX;
            const ry = latToWorldY(ring[i][1], baseScene.z) - baseScene.originWY;
            targetPath.lineTo(rx, ry);
        }
        targetPath.closePath();
    }
}

function drawGeometryPath(ctx, geometry, baseScene) {
    if (!geometry) return;
    if (geometry.type === 'Polygon') {
        drawPolygon(ctx, geometry.coordinates, baseScene);
    } else if (geometry.type === 'MultiPolygon') {
        for (const poly of geometry.coordinates) {
            drawPolygon(ctx, poly, baseScene);
        }
    }
}

function drawPolygon(ctx, rings, baseScene) {
    for (const ring of rings) {
        if (!ring || ring.length < 3) continue;
        const startX = lonToWorldX(ring[0][0], baseScene.z) - baseScene.originWX;
        const startY = latToWorldY(ring[0][1], baseScene.z) - baseScene.originWY;
        ctx.moveTo(startX, startY);
        for (let i = 1; i < ring.length; i++) {
            const rx = lonToWorldX(ring[i][0], baseScene.z) - baseScene.originWX;
            const ry = latToWorldY(ring[i][1], baseScene.z) - baseScene.originWY;
            ctx.lineTo(rx, ry);
        }
        ctx.closePath();
    }
}
