/**
 * Canvas 2D Rendering Pipeline for the 960x960 Square Trip Clip
 * Handles map tiles, 4-layer track, stopovers, viewport-clamped station pills,
 * high-contrast top-down vehicles, HUD cards, and corner watermark.
 */

import { computeTripDurationMinutes, deriveDelaySeconds } from '../utils/time.js';
import { formatHumanDuration } from '../utils/format.js';
import { CATEGORY_META, TILE_IMAGE_CACHE, loadSingleTileImage } from './tiles.js';
import { drawVectorBaseMap } from './vectorRenderer.js';
import {
    lonToWorldX,
    latToWorldY,
    computePolylineHaversineKm,
    smootherstep,
    samplePointAlongRoute,
    sampleSmoothedCameraTarget,
    computeCameraZoomMultiplier,
    shortenStationName,
    getContrastingTextColor
} from './geometry.js';

export function drawRoundedRect(ctx, x, y, w, h, r) {
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
 * High-contrast top-down transit vehicles (drawn above all map dots and tracks,
 * without artificial yellow headlight cones).
 */
export function drawVehicleOnCanvas(ctx, vehicleType, color, frame) {
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

        // Hull with elevation shadow
        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
        ctx.shadowBlur = 12;
        ctx.shadowOffsetY = 4;
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
        ctx.restore();

        // Deck & Cabin
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
        // Rear Carriage with elevation shadow
        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
        ctx.shadowBlur = 12;
        ctx.shadowOffsetY = 4;
        ctx.fillStyle = '#f8fafc';
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 1.5;
        drawRoundedRect(ctx, -32, -9.5, 22, 19, 3.5);
        ctx.fill();
        ctx.stroke();

        // Aerodynamic ICE Nose Cone
        const nosePath = new Path2D('M -8,-9.5 L 16,-9.5 C 26,-9.5 33,-4.5 33,0 C 33,4.5 26,9.5 16,9.5 L -8,9.5 Z');
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 1.5;
        ctx.fill(nosePath);
        ctx.stroke(nosePath);
        ctx.restore();

        // Iconic Dual Speed Stripes along sides
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.8;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-30, -6.2);
        ctx.lineTo(24, -6.2);
        ctx.moveTo(-30, 6.2);
        ctx.lineTo(24, 6.2);
        ctx.stroke();

        // Cockpit Windshield
        const windPath = new Path2D('M 15,-5.2 C 21,-5.2 25,-2.2 25,0 C 25,2.2 21,5.2 15,5.2 L 11.5,4.2 L 11.5,-4.2 Z');
        ctx.fillStyle = '#0f172a';
        ctx.fill(windPath);

        // Roof Louvers
        ctx.fillStyle = '#94a3b8';
        drawRoundedRect(ctx, -24, -3, 12, 6, 1.5);
        ctx.fill();
        drawRoundedRect(ctx, -3, -3, 11, 6, 1.5);
        ctx.fill();
    } else {
        // High-contrast Regional / S-Bahn / U-Bahn / Tram / Bus Livery
        // Metallic white outer hull + bold line-colored livery stripes so it pops above the colored track
        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.58)';
        ctx.shadowBlur = 12;
        ctx.shadowOffsetY = 4;
        ctx.fillStyle = '#f8fafc';
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 1.8;
        drawRoundedRect(ctx, -25, -10.5, 50, 21, 7.5);
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        // Line-colored center livery band
        ctx.fillStyle = color;
        drawRoundedRect(ctx, -22, -7.5, 43, 15, 5);
        ctx.fill();

        // Brushed metallic roof panel
        ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
        drawRoundedRect(ctx, -16, -4.2, 26, 8.4, 3);
        ctx.fill();

        // Car articulation seam
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.35)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-3, -4);
        ctx.lineTo(-3, 4);
        ctx.stroke();

        // Panoramic Front Cab Windshield
        ctx.fillStyle = '#0f172a';
        drawRoundedRect(ctx, 13, -6.2, 7.5, 12.4, 3);
        ctx.fill();
    }

    ctx.restore();
}

/**
 * Station Pin & Viewport-Clamped Callout Pill
 */
export function drawStationPin(
    ctx,
    label,
    dotColor,
    isDest = false,
    placeAbove = true,
    horizontalShiftPx = 0,
    frame = 0
) {
    ctx.save();

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

    // Callout Pill placed away from the route track and clamped within the canvas viewport
    const shortName = shortenStationName(label);
    ctx.font = '700 17px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
    const textW = ctx.measureText(shortName).width;
    const pillW = textW + 38;
    const pillH = 34;
    const pillX = -pillW / 2 + horizontalShiftPx;
    const pillY = placeAbove ? -28 - pillH : 28;

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.48)';
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

/**
 * Compute safe screen-space placement for a station callout pill so it never
 * gets clipped by the top HUD header or the left/right edges of the 960x960 canvas.
 */
function computeSafeStationPillPlacement(pt, camTargetX, camTargetY, camZoom, width, height, viewCenterY, preferAbove) {
    const screenX = (pt.x - camTargetX) * camZoom + width / 2;
    const screenY = (pt.y - camTargetY) * camZoom + viewCenterY;

    let placeAbove = preferAbove;
    // Top HUD occupies y = 0..118; bottom watermark/controls occupy y = height-64..height
    if (placeAbove && screenY - 68 < 118) {
        placeAbove = false;
    } else if (!placeAbove && screenY + 68 > height - 56) {
        placeAbove = true;
    }

    let horizontalShiftPx = 0;
    const margin = 120;
    if (screenX < margin) {
        horizontalShiftPx = margin - screenX;
    } else if (screenX > width - margin) {
        horizontalShiftPx = (width - margin) - screenX;
    }

    return { placeAbove, horizontalShiftPx };
}

/**
 * Draws a tile with hierarchical parent-tile fallback.
 * If the exact tile is not yet loaded in cache, it searches upwards for parent tiles (z-1, z-2)
 * and draws the corresponding sub-quadrant seamlessly so blank holes never appear.
 */
function drawTileWithParentFallback(ctx, styleConfig, tile, baseZ) {
    const tileZ = tile.z ?? baseZ;
    const tileX = tile.x;
    const tileY = tile.y;
    const tileSize = tile.size ?? 256;
    if (typeof styleConfig.getTileUrl !== 'function') return;

    const url = styleConfig.getTileUrl(tileZ, tileX, tileY);
    const img = TILE_IMAGE_CACHE.get(url);
    if (img) {
        ctx.drawImage(img, tile.left, tile.top, tileSize * 1.002, tileSize * 1.002);
        return;
    }

    for (let pz = tileZ - 1; pz >= baseZ; pz--) {
        const factor = Math.pow(2, tileZ - pz);
        const px = Math.floor(tileX / factor);
        const py = Math.floor(tileY / factor);
        const pUrl = styleConfig.getTileUrl(pz, px, py);
        const pImg = TILE_IMAGE_CACHE.get(pUrl);
        if (pImg) {
            const remX = ((tileX % factor) + factor) % factor;
            const remY = ((tileY % factor) + factor) % factor;
            const subW = 256 / factor;
            const subH = 256 / factor;
            const sx = remX * subW;
            const sy = remY * subH;
            ctx.drawImage(pImg, sx, sy, subW, subH, tile.left, tile.top, tileSize * 1.002, tileSize * 1.002);
            return;
        }
    }

    ctx.fillStyle = styleConfig.bg;
    ctx.fillRect(tile.left, tile.top, tileSize, tileSize);
}

export function renderTripFrame({
    ctx,
    frame,
    fps,
    width,
    height,
    trip,
    username,
    coords,
    scene,
    styleConfig,
    introSpring
}) {
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

    // C2-continuous quintic smootherstep curves with multi-phase zoom in/out
    const travelProgress = smootherstep(22, 176, frame);
    const introOverviewBlend = 1 - smootherstep(0, 44, frame);
    const finaleBlend = smootherstep(148, 212, frame);
    const overviewBlend = Math.max(introOverviewBlend, finaleBlend);

    const vehiclePose = samplePointAlongRoute(scene, travelProgress);
    const smoothChaseTarget = sampleSmoothedCameraTarget(scene, travelProgress);
    const camTargetX = smoothChaseTarget.x + (scene.centerSceneX - smoothChaseTarget.x) * overviewBlend;
    const camTargetY = smoothChaseTarget.y + (scene.centerSceneY - smoothChaseTarget.y) * overviewBlend;

    const camZoom = scene.fitScale * computeCameraZoomMultiplier(frame);

    const currentDistKm = (totalDistanceKm * travelProgress).toFixed(1);
    const viewCenterY = height / 2 + 42;

    // 1. Clear background
    ctx.save();
    ctx.fillStyle = styleConfig.bg;
    ctx.fillRect(0, 0, width, height);

    // 2. Camera transform
    ctx.save();
    ctx.translate(width / 2, viewCenterY);
    ctx.scale(camZoom, camZoom);
    ctx.translate(-camTargetX, -camTargetY);

    // 3. Draw Base Map (Vector or Tiles)
    if (styleConfig.isVector) {
        drawVectorBaseMap({
            ctx,
            baseScene: scene,
            camZoom,
            styleConfig
        });
    } else {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        for (const tile of scene.tiles) {
            drawTileWithParentFallback(ctx, styleConfig, { ...tile, z: scene.z, size: 256 }, scene.z);
        }
    }

    // 4. 4-Layer Track Design
    if (scene.points.length >= 2) {
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

        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.42)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetY = 4;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 15 / camZoom;
        ctx.stroke();
        ctx.restore();

        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 9.5 / camZoom;
        ctx.stroke();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.42)';
        ctx.lineWidth = 3 / camZoom;
        ctx.setLineDash([8 / camZoom, 14 / camZoom]);
        ctx.lineDashOffset = -(frame * 0.8) / camZoom;
        ctx.stroke();
        ctx.restore();
    }

    // 5. Intermediate Stopover Dots (real stopovers if present, otherwise 25%, 50%, 75% waypoints)
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
            ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
            ctx.shadowBlur = 6;
            ctx.shadowOffsetY = 2;
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = lineColor;
            ctx.lineWidth = 3.5;
            ctx.beginPath();
            ctx.arc(0, 0, 6.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        });
    } else {
        const milestoneFractions = [0.25, 0.50, 0.75];
        milestoneFractions.forEach((mPct) => {
            if (travelProgress >= mPct) {
                const mPt = samplePointAlongRoute(scene, mPct);
                ctx.save();
                ctx.translate(mPt.x, mPt.y);
                ctx.scale(1 / camZoom, 1 / camZoom);
                ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
                ctx.shadowBlur = 6;
                ctx.shadowOffsetY = 2;
                ctx.fillStyle = '#ffffff';
                ctx.strokeStyle = lineColor;
                ctx.lineWidth = 3.5;
                ctx.beginPath();
                ctx.arc(0, 0, 6.5, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                ctx.restore();
            }
        });
    }

    // 6. Origin & Destination Station Pins & Viewport-Clamped Callout Pills (drawn below the train)
    const originPt = scene.points[0];
    const destPt = scene.points[scene.points.length - 1];
    const originIsNorthOfDest = originPt && destPt ? originPt.y <= destPt.y : true;

    if (originPt) {
        const { placeAbove, horizontalShiftPx } = computeSafeStationPillPlacement(
            originPt,
            camTargetX,
            camTargetY,
            camZoom,
            width,
            height,
            viewCenterY,
            originIsNorthOfDest
        );
        ctx.save();
        ctx.translate(originPt.x, originPt.y);
        const pinScale = Math.max(0.01, introSpring) / camZoom;
        ctx.scale(pinScale, pinScale);
        drawStationPin(ctx, originName, '#10b981', false, placeAbove, horizontalShiftPx, frame);
        ctx.restore();
    }
    if (destPt) {
        const { placeAbove, horizontalShiftPx } = computeSafeStationPillPlacement(
            destPt,
            camTargetX,
            camTargetY,
            camZoom,
            width,
            height,
            viewCenterY,
            !originIsNorthOfDest
        );
        ctx.save();
        ctx.translate(destPt.x, destPt.y);
        const destPulse = smootherstep(0.84, 1.0, travelProgress);
        const destScale = (0.94 + destPulse * 0.08) / camZoom;
        ctx.scale(destScale, destScale);
        drawStationPin(ctx, destName, lineColor, true, placeAbove, horizontalShiftPx, frame);
        ctx.restore();
    }

    // 7. Moving Directional Vehicle Model (drawn ABOVE all dots and station pins on the map)
    ctx.save();
    ctx.translate(vehiclePose.x, vehiclePose.y);
    ctx.scale(1.08 / camZoom, 1.08 / camZoom);
    ctx.rotate(vehiclePose.angleRad || 0);
    drawVehicleOnCanvas(ctx, catMeta.vehicle, lineColor, frame);
    ctx.restore();

    ctx.restore(); // End camera transform

    // 8. Vignette & Top Header Scrim
    const vig = ctx.createRadialGradient(width / 2, height / 2, width * 0.34, width / 2, height / 2, width * 0.70);
    vig.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vig.addColorStop(1, 'rgba(4, 7, 15, 0.38)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, width, height);

    const topScrim = ctx.createLinearGradient(0, 0, 0, 126);
    topScrim.addColorStop(0, 'rgba(7, 10, 18, 0.55)');
    topScrim.addColorStop(1, 'rgba(7, 10, 18, 0)');
    ctx.fillStyle = topScrim;
    ctx.fillRect(0, 0, width, 126);

    // 9. TOP HUD HEADER BAR
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

    // 10. TOP-RIGHT LIVE METRICS CARD (Distance + Duration)
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

    ctx.fillStyle = '#94a3b8';
    ctx.font = '700 12px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('DISTANCE', rightCardX + 18, pad + 15);

    ctx.fillStyle = '#38bdf8';
    ctx.font = '800 23px "JetBrains Mono", monospace';
    ctx.fillText(`${currentDistKm} km`, rightCardX + 18, pad + 36, 134);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.fillRect(rightCardX + 160, pad + 16, 1.5, headerH - 32);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '700 12px Inter, sans-serif';
    ctx.fillText('DURATION', rightCardX + 176, pad + 15);

    ctx.fillStyle = '#4ade80';
    ctx.font = '800 23px "JetBrains Mono", monospace';
    ctx.fillText(durationFormatted, rightCardX + 176, pad + 36, 104);
    ctx.restore();

    // 11. CORNER WATERMARK: "Generated on fabian-c.github.io/Traewelling-Maps"
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
}

/**
 * Render a single frame of the Historical All-Rides Replay (mode=all).
 * Sequentially animates every ride from oldest to newest while accumulating
 * the completed rail network and live cumulative distance on the map.
 */
export function renderAllTripsFrame({
    ctx,
    frame,
    fps = 30,
    width,
    height,
    username,
    allScene,
    timing,
    styleConfig
}) {
    const rides = allScene?.rides || [];
    if (!rides.length) return;

    const travelTotalFrames = allScene?.travelTotalFrames ?? (timing?.travelTotalFrames || (rides.length * 20));
    const finaleTransitionFrames = timing?.finaleTransitionFrames || Math.round(fps * 1.5);
    const isFinale = frame >= travelTotalFrames;

    let activeIdx = 0;
    while (activeIdx < rides.length - 1 && frame >= (rides[activeIdx].endFrame ?? ((activeIdx + 1) * 20))) {
        activeIdx++;
    }

    const activeRide = rides[activeIdx];
    const rideStartFrame = activeRide.startFrame ?? (activeIdx * 20);
    const rideEndFrame = activeRide.endFrame ?? ((activeIdx + 1) * 20);
    const rideDuration = Math.max(1, rideEndFrame - rideStartFrame);
    const localFrame = isFinale ? rideDuration : Math.max(0, frame - rideStartFrame);
    const rideProgress = isFinale
        ? 1
        : smootherstep(0.04, 0.94, localFrame / rideDuration);

    const activeTrip = activeRide.trip || {};
    const checkin = activeTrip.checkin || activeTrip.train || {};
    const categoryKey = checkin.category || 'regional';
    const catMeta = CATEGORY_META[categoryKey] || CATEGORY_META.unknown;
    const lineColor = checkin.routeColor
        ? `#${String(checkin.routeColor).replace(/^#/, '')}`
        : catMeta.color;
    const badgeTextColor = getContrastingTextColor(lineColor, checkin.routeTextColor);

    const lineName = checkin.lineName || checkin.number || 'Train';
    const originName = checkin.origin?.name || checkin.origin?.station?.name || activeTrip.origin || 'Origin';
    const destName = checkin.destination?.name || checkin.destination?.station?.name || activeTrip.destination || 'Destination';

    const activeRideScene = {
        points: activeRide.points,
        cumDist: activeRide.cumDist,
        totalPathPx: activeRide.totalPathPx,
        centerSceneX: activeRide.rideCenterX,
        centerSceneY: activeRide.rideCenterY
    };

    const vehiclePose = samplePointAlongRoute(activeRideScene, rideProgress);
    const currChaseTarget = sampleSmoothedCameraTarget(activeRideScene, rideProgress);

    let camTargetX = currChaseTarget.x;
    let camTargetY = currChaseTarget.y;

    // Continuous creeping zoom: smoothly ease from activeRide.startZoom toward activeRide.endZoom across this ride
    const rideProgressT = Math.max(0, Math.min(1, localFrame / rideDuration));
    const zStart = typeof activeRide.startZoom === 'number' ? activeRide.startZoom : (activeRide.rideZoom || allScene.fitScale);
    const zEnd = typeof activeRide.endZoom === 'number' ? activeRide.endZoom : (activeRide.rideZoom || allScene.fitScale);
    const logZStart = Math.log(Math.max(0.1, zStart));
    const logZEnd = Math.log(Math.max(0.1, zEnd));
    let camZoom = Math.exp(logZStart + (logZEnd - logZStart) * smootherstep(0, 1, rideProgressT));

    // Smooth camera handoff from previous ride so there is never an abrupt jump between rides
    if (activeIdx > 0 && !isFinale) {
        const prevRide = rides[activeIdx - 1];
        const prevRideScene = {
            points: prevRide.points,
            cumDist: prevRide.cumDist,
            totalPathPx: prevRide.totalPathPx,
            centerSceneX: prevRide.rideCenterX,
            centerSceneY: prevRide.rideCenterY
        };
        const prevEndTarget = sampleSmoothedCameraTarget(prevRideScene, 1);
        const handoffDuration = Math.min(rideDuration * 0.70, Math.max(12, 40 * 0.40));
        const handoffT = smootherstep(0, handoffDuration, localFrame);
        camTargetX = prevEndTarget.x + (currChaseTarget.x - prevEndTarget.x) * handoffT;
        camTargetY = prevEndTarget.y + (currChaseTarget.y - prevEndTarget.y) * handoffT;

        // If hopping between two distant cities while zoomed in, dip zoom slightly mid-hop;
        // if staying within the same city, hopDist is small so camera stays zoomed in on the city!
        const hopDistScenePx = Math.hypot(currChaseTarget.x - prevEndTarget.x, currChaseTarget.y - prevEndTarget.y);
        const hopScreenPx = hopDistScenePx * Math.min(zStart, zEnd);
        if (hopScreenPx > 520) {
            const midHopZoom = Math.max(allScene.fitScale * 1.15, (width * 0.65) / Math.max(1, hopDistScenePx));
            const hopArch = Math.sin(handoffT * Math.PI);
            if (midHopZoom < camZoom) {
                const logMid = Math.log(Math.max(0.1, midHopZoom));
                const logCur = Math.log(Math.max(0.1, camZoom));
                camZoom = Math.exp(logCur + (logMid - logCur) * hopArch * 0.72);
            }
        }
    }

    // Smooth intro zoom-in from full network overview
    const introDuration = Math.min(60, (rides[0]?.durationFrames || 40) * 0.85);
    const introBlend = 1 - smootherstep(0, introDuration, frame);

    // Finale zoom-out: 1.5s (45 frames) smooth glide to overview, followed by 3.0s (90 frames) completely static hold
    const finaleBlend = isFinale
        ? smootherstep(travelTotalFrames, travelTotalFrames + finaleTransitionFrames, frame)
        : 0;

    const overviewBlend = Math.max(introBlend, finaleBlend);
    const overviewZoom = allScene.fitScale * 0.95;

    camTargetX = camTargetX + (allScene.centerSceneX - camTargetX) * overviewBlend;
    camTargetY = camTargetY + (allScene.centerSceneY - camTargetY) * overviewBlend;
    if (overviewBlend > 0.0001) {
        const logRide = Math.log(Math.max(0.1, camZoom));
        const logOver = Math.log(Math.max(0.1, overviewZoom));
        camZoom = Math.exp(logRide + (logOver - logRide) * overviewBlend);
    }

    const viewCenterY = height / 2 + 42;

    // 1. Clear background
    ctx.save();
    ctx.fillStyle = styleConfig.bg;
    ctx.fillRect(0, 0, width, height);

    // 2. Camera transform
    ctx.save();
    ctx.translate(width / 2, viewCenterY);
    ctx.scale(camZoom, camZoom);
    ctx.translate(-camTargetX, -camTargetY);

    // 3. Draw Base Map (Vector or Tiles)
    if (styleConfig.isVector) {
        drawVectorBaseMap({
            ctx,
            baseScene: allScene,
            camZoom,
            styleConfig
        });
    } else {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        for (const tile of allScene.tiles) {
            drawTileWithParentFallback(ctx, styleConfig, { ...tile, z: allScene.z, size: 256 }, allScene.z);
        }

        if (camZoom > 1.4 && Array.isArray(allScene.detailTiles) && allScene.detailTiles.length > 0) {
            for (const dTile of allScene.detailTiles) {
                // Viewport frustum culling
                const tileScreenLeft = (dTile.left - camTargetX) * camZoom + width / 2;
                const tileScreenTop = (dTile.top - camTargetY) * camZoom + viewCenterY;
                const tileScreenSize = dTile.size * camZoom;

                if (
                    tileScreenLeft + tileScreenSize < -60 ||
                    tileScreenLeft > width + 60 ||
                    tileScreenTop + tileScreenSize < -60 ||
                    tileScreenTop > height + 60
                ) {
                    continue;
                }

                drawTileWithParentFallback(ctx, styleConfig, dTile, allScene.z);
                const dUrl = styleConfig.getTileUrl(dTile.z, dTile.x, dTile.y);
                if (!TILE_IMAGE_CACHE.has(dUrl)) {
                    const fbUrl = styleConfig.getFallbackUrl ? styleConfig.getFallbackUrl(dTile.z, dTile.x, dTile.y) : null;
                    loadSingleTileImage(dUrl, fbUrl);
                }
            }
        }
    }

    // 4. Draw completed historical network tracks
    // When isFinale is reached, ALL rides (including the very last one) are drawn uniformly as completed network tracks!
    const completedCount = isFinale ? rides.length : activeIdx;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 0; i < completedCount; i++) {
        const pastRide = rides[i];
        if (!pastRide.points || pastRide.points.length < 2) continue;
        const pastCheckin = pastRide.trip?.checkin || pastRide.trip?.train || {};
        const pastCat = CATEGORY_META[pastCheckin.category || 'regional'] || CATEGORY_META.unknown;
        const pastColor = pastCheckin.routeColor
            ? `#${String(pastCheckin.routeColor).replace(/^#/, '')}`
            : pastCat.color;

        ctx.beginPath();
        ctx.moveTo(pastRide.points[0].x, pastRide.points[0].y);
        for (let p = 1; p < pastRide.points.length; p++) {
            ctx.lineTo(pastRide.points[p].x, pastRide.points[p].y);
        }
        ctx.strokeStyle = styleConfig.isDark ? 'rgba(255, 255, 255, 0.45)' : 'rgba(15, 23, 42, 0.35)';
        ctx.lineWidth = 6.5 / camZoom;
        ctx.stroke();

        ctx.strokeStyle = pastColor;
        ctx.lineWidth = 4.2 / camZoom;
        ctx.stroke();
    }
    ctx.restore();

    // 5. Draw active ride track (only while ride is in progress, never in the finale overview!)
    if (!isFinale && activeRide.points.length >= 2) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(activeRide.points[0].x, activeRide.points[0].y);
        for (let i = 1; i < activeRide.points.length; i++) {
            ctx.lineTo(activeRide.points[i].x, activeRide.points[i].y);
        }
        ctx.strokeStyle = styleConfig.isDark ? 'rgba(255, 255, 255, 0.22)' : 'rgba(15, 23, 42, 0.24)';
        ctx.lineWidth = 9 / camZoom;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.setLineDash([9 / camZoom, 9 / camZoom]);
        ctx.stroke();
        ctx.restore();

        const maxIdx = Math.max(0, Math.min(activeRide.points.length - 1, vehiclePose.index));
        const wholeIdx = Math.floor(maxIdx);

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(activeRide.points[0].x, activeRide.points[0].y);
        for (let i = 1; i <= wholeIdx; i++) {
            ctx.lineTo(activeRide.points[i].x, activeRide.points[i].y);
        }
        ctx.lineTo(vehiclePose.x, vehiclePose.y);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.42)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetY = 3;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 14 / camZoom;
        ctx.stroke();
        ctx.restore();

        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 9 / camZoom;
        ctx.stroke();
        ctx.restore();
    }

    // 6. Active Ride Origin & Destination Station Pins (hidden during finale)
    const originPt = activeRide.points[0];
    const destPt = activeRide.points[activeRide.points.length - 1];
    const originIsNorthOfDest = originPt && destPt ? originPt.y <= destPt.y : true;

    if (originPt && !isFinale) {
        const { placeAbove, horizontalShiftPx } = computeSafeStationPillPlacement(
            originPt,
            camTargetX,
            camTargetY,
            camZoom,
            width,
            height,
            viewCenterY,
            originIsNorthOfDest
        );
        ctx.save();
        ctx.translate(originPt.x, originPt.y);
        ctx.scale(1 / camZoom, 1 / camZoom);
        drawStationPin(ctx, originName, '#10b981', false, placeAbove, horizontalShiftPx, frame);
        ctx.restore();
    }
    if (destPt && !isFinale) {
        const { placeAbove, horizontalShiftPx } = computeSafeStationPillPlacement(
            destPt,
            camTargetX,
            camTargetY,
            camZoom,
            width,
            height,
            viewCenterY,
            !originIsNorthOfDest
        );
        ctx.save();
        ctx.translate(destPt.x, destPt.y);
        ctx.scale(1 / camZoom, 1 / camZoom);
        drawStationPin(ctx, destName, lineColor, true, placeAbove, horizontalShiftPx, frame);
        ctx.restore();
    }

    // 7. Moving Vehicle on Active Ride (hidden during finale)
    if (!isFinale) {
        ctx.save();
        ctx.translate(vehiclePose.x, vehiclePose.y);
        ctx.scale(1.08 / camZoom, 1.08 / camZoom);
        ctx.rotate(vehiclePose.angleRad || 0);
        drawVehicleOnCanvas(ctx, catMeta.vehicle, lineColor, frame);
        ctx.restore();
    }

    ctx.restore(); // End camera transform

    // 8. Vignette & Top Header Scrim
    const vig = ctx.createRadialGradient(width / 2, height / 2, width * 0.34, width / 2, height / 2, width * 0.70);
    vig.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vig.addColorStop(1, 'rgba(4, 7, 15, 0.38)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, width, height);

    const topScrim = ctx.createLinearGradient(0, 0, 0, 126);
    topScrim.addColorStop(0, 'rgba(7, 10, 18, 0.55)');
    topScrim.addColorStop(1, 'rgba(7, 10, 18, 0)');
    ctx.fillStyle = topScrim;
    ctx.fillRect(0, 0, width, 126);

    // 9. TOP HUD HEADER BAR (Active Ride + Historical Counter)
    const pad = 22;
    const headerH = 84;
    const rightCardW = 304;
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

    const badgeLabel = isFinale ? 'ALL' : lineName;
    ctx.font = '800 22px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
    const badgeTextW = ctx.measureText(badgeLabel).width;
    const badgeW = Math.max(72, Math.min(156, badgeTextW + 26));
    const badgeH = 50;
    const badgeX = pad + 16;
    const badgeY = pad + (headerH - badgeH) / 2;

    ctx.fillStyle = isFinale ? '#38bdf8' : lineColor;
    drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 12);
    ctx.fill();

    ctx.fillStyle = isFinale ? '#0f172a' : badgeTextColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeLabel, badgeX + badgeW / 2, badgeY + badgeH / 2 + 1, badgeW - 14);

    const textStartX = badgeX + badgeW + 16;
    const shortOrig = shortenStationName(originName);
    const shortDest = shortenStationName(destName);
    const routeTitle = isFinale
        ? `All ${rides.length} Saved Rides Completed`
        : `${shortOrig} → ${shortDest}`;

    ctx.fillStyle = '#f8fafc';
    ctx.font = '800 21px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(routeTitle, textStartX, pad + 15, leftCardW - (textStartX - pad) - 16);

    const resolvedUsername = activeTrip.user?.username || username || 'Traveler';
    const dateRaw = checkin.origin?.departureReal || checkin.origin?.departurePlanned || activeTrip.createdAt;
    const dateStr = dateRaw
        ? new Date(dateRaw).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
        : '';
    const subTitle = isFinale
        ? `@${resolvedUsername} • Historical Replay`
        : `@${resolvedUsername} • Ride #${activeIdx + 1}/${rides.length}${dateStr ? ` • ${dateStr}` : ''}`;

    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 15px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(subTitle, textStartX, pad + 49, leftCardW - (textStartX - pad) - 16);
    ctx.restore();

    // 10. TOP-RIGHT LIVE CUMULATIVE METRICS CARD
    const rightCardX = width - pad - rightCardW;
    const cumulativeKm = isFinale
        ? (allScene.totalDistanceKm || (activeRide.startKm + activeRide.distanceKm)).toFixed(1)
        : (activeRide.startKm + activeRide.distanceKm * rideProgress).toFixed(1);
    const displayRidesCount = isFinale ? rides.length : activeIdx + 1;

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

    ctx.fillStyle = '#94a3b8';
    ctx.font = '700 12px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('TOTAL DISTANCE', rightCardX + 18, pad + 15);

    ctx.fillStyle = '#38bdf8';
    ctx.font = '800 22px "JetBrains Mono", monospace';
    ctx.fillText(`${cumulativeKm} km`, rightCardX + 18, pad + 36, 152);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.fillRect(rightCardX + 180, pad + 16, 1.5, headerH - 32);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '700 12px Inter, sans-serif';
    ctx.fillText('RIDE', rightCardX + 194, pad + 15);

    ctx.fillStyle = '#4ade80';
    ctx.font = '800 22px "JetBrains Mono", monospace';
    ctx.fillText(`${displayRidesCount}/${rides.length}`, rightCardX + 194, pad + 36, 96);
    ctx.restore();

    // 11. CORNER WATERMARK
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
}

