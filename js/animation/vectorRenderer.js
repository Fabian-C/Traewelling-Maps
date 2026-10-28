/**
 * Vector Map Canvas Renderer
 * Renders European continental landmasses, country boundaries, German states,
 * graticule gridlines, and major cities with pure vector paths.
 * 100% offline, zero network tile requests, infinite mathematical resolution.
 */

import { VECTOR_COUNTRIES, VECTOR_GERMAN_STATES } from './vectorData.js';
import { lonToWorldX, latToWorldY } from './geometry.js';

export function drawVectorBaseMap({
    ctx,
    baseScene,
    camZoom,
    styleConfig
}) {
    const isDark = styleConfig.isDark !== false;

    const landColor = isDark ? '#141c2e' : '#f8fafc';
    const countryBorderColor = isDark ? 'rgba(71, 85, 105, 0.55)' : 'rgba(148, 163, 184, 0.65)';
    const targetCountryColor = isDark ? '#1a243a' : '#ffffff';
    const stateBorderColor = isDark ? 'rgba(96, 165, 250, 0.35)' : 'rgba(100, 116, 139, 0.45)';
    const graticuleColor = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
    const graticuleText = isDark ? 'rgba(148, 163, 184, 0.45)' : 'rgba(100, 116, 139, 0.60)';

    // 1. European Countries
    ctx.save();
    for (const country of VECTOR_COUNTRIES) {
        const isDE = country.id === 'DEU';
        ctx.fillStyle = isDE ? targetCountryColor : landColor;
        ctx.strokeStyle = countryBorderColor;
        ctx.lineWidth = 1.6 / camZoom;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        ctx.beginPath();
        drawGeometryPath(ctx, country.geometry, baseScene);
        ctx.fill();
        ctx.stroke();
    }
    ctx.restore();

    // 2. German Bundesländer (States)
    ctx.save();
    ctx.strokeStyle = stateBorderColor;
    ctx.lineWidth = 1.1 / camZoom;
    ctx.setLineDash([4 / camZoom, 4 / camZoom]);
    ctx.lineJoin = 'round';
    for (const state of VECTOR_GERMAN_STATES) {
        ctx.beginPath();
        drawGeometryPath(ctx, state.geometry, baseScene);
        ctx.stroke();
    }
    ctx.restore();

    // 3. Graticule Grid Lines (Parallels & Meridians)
    ctx.save();
    ctx.strokeStyle = graticuleColor;
    ctx.lineWidth = 1.0 / camZoom;
    ctx.fillStyle = graticuleText;
    ctx.font = `${Math.max(9, 11 / camZoom)}px Inter, sans-serif`;

    const lonStep = camZoom > 4 ? 0.5 : (camZoom > 1.5 ? 1 : 2);
    const minLon = 2;
    const maxLon = 18;
    for (let lon = minLon; lon <= maxLon; lon += lonStep) {
        const x = lonToWorldX(lon, baseScene.z) - baseScene.originWX;
        const yTop = latToWorldY(56, baseScene.z) - baseScene.originWY;
        const yBot = latToWorldY(46, baseScene.z) - baseScene.originWY;
        ctx.beginPath();
        ctx.moveTo(x, yTop);
        ctx.lineTo(x, yBot);
        ctx.stroke();
    }

    const latStep = camZoom > 4 ? 0.5 : (camZoom > 1.5 ? 1 : 2);
    for (let lat = 46; lat <= 56; lat += latStep) {
        const y = latToWorldY(lat, baseScene.z) - baseScene.originWY;
        const xLeft = lonToWorldX(minLon, baseScene.z) - baseScene.originWX;
        const xRight = lonToWorldX(maxLon, baseScene.z) - baseScene.originWY;
        ctx.beginPath();
        ctx.moveTo(xLeft, y);
        ctx.lineTo(xRight, y);
        ctx.stroke();
    }
    ctx.restore();

    // 4. Major Reference Cities
    const CITIES = [
        { name: 'Berlin', lon: 13.4050, lat: 52.5200 },
        { name: 'Hamburg', lon: 9.9937, lat: 53.5511 },
        { name: 'München', lon: 11.5820, lat: 48.1351 },
        { name: 'Köln', lon: 6.9603, lat: 50.9375 },
        { name: 'Frankfurt', lon: 8.6821, lat: 50.1109 },
        { name: 'Stuttgart', lon: 9.1829, lat: 48.7758 },
        { name: 'Düsseldorf', lon: 6.7735, lat: 51.2277 },
        { name: 'Leipzig', lon: 12.3731, lat: 51.3397 },
        { name: 'Dresden', lon: 13.7373, lat: 51.0504 },
        { name: 'Hannover', lon: 9.7320, lat: 52.3759 },
        { name: 'Nürnberg', lon: 11.0767, lat: 49.4521 },
        { name: 'Bremen', lon: 8.8017, lat: 53.0793 }
    ];

    ctx.save();
    for (const city of CITIES) {
        const cx = lonToWorldX(city.lon, baseScene.z) - baseScene.originWX;
        const cy = latToWorldY(city.lat, baseScene.z) - baseScene.originWY;

        ctx.fillStyle = isDark ? '#60a5fa' : '#2563eb';
        ctx.beginPath();
        ctx.arc(cx, cy, 3.5 / camZoom, 0, Math.PI * 2);
        ctx.fill();

        ctx.font = `600 ${Math.max(8, 12 / camZoom)}px Inter, sans-serif`;
        ctx.fillStyle = isDark ? 'rgba(226, 232, 240, 0.75)' : 'rgba(30, 41, 59, 0.85)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(city.name, cx + 6 / camZoom, cy);
    }
    ctx.restore();
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
