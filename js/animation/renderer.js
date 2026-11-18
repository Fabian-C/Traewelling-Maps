/**
 * Canvas 2D Frame Compositor for Trip Clip Studio
 * Orchestrates base map tiles/vectors, track curves, stopovers, sprites, and unified HUD.
 */

import { computeTripDurationMinutes, deriveDelaySeconds } from '../utils/time.js';
import { formatHumanDuration } from '../utils/format.js';
import { MAP_STYLES, CATEGORY_META, TILE_IMAGE_CACHE, loadSingleTileImage, preloadTripTiles, preloadSceneTiles } from './tiles.js';
import { drawVectorBaseMap } from './vectorRenderer.js';
import {
    computePolylineHaversineKm,
    smootherstep,
    samplePointAlongRoute,
    sampleSmoothedCameraTarget,
    computeCameraZoomMultiplier,
    shortenStationName,
    getContrastingTextColor,
    getVisibleTilesForViewport,
    getAnimationTileLabelScale
} from './geometry.js';
import {
    drawRoundedRect,
    drawVehicleOnCanvas,
    drawStationPin,
    computeSafeStationPillPlacement,
    drawStopoverDotsAndLabels,
    extractIntermediateStopovers,
    formatClockTime
} from './sprites.js';
import { drawVignetteAndScrim, drawTopHudBar, drawWatermarkPill } from './hud.js';
import { createDefaultClipSettings } from './schema.js';

export {
    MAP_STYLES,
    CATEGORY_META,
    preloadTripTiles,
    preloadSceneTiles,
    drawRoundedRect,
    drawVehicleOnCanvas,
    drawStationPin
};

function computeSpring({ frame, fps = 30, config = { damping: 18, stiffness: 90, mass: 1 } }) {
    if (frame <= 0) return 0;
    const m = config.mass || 1;
    const k = config.stiffness || 90;
    const c = config.damping || 18;
    const t = frame / fps;
    const omega0 = Math.sqrt(k / m);
    const zeta = c / (2 * Math.sqrt(m * k));
    if (zeta < 1) {
        const omegaD = omega0 * Math.sqrt(1 - zeta * zeta);
        const decay = Math.exp(-zeta * omega0 * t);
        return 1 - decay * (Math.cos(omegaD * t) + ((zeta * omega0) / omegaD) * Math.sin(omegaD * t));
    }
    return 1 - Math.exp(-omega0 * t) * (1 + omega0 * t);
}

/**
 * Draws a tile with hierarchical parent-tile fallback down to z=2.
 */
function drawTileWithParentFallback(ctx, styleConfig, tile, baseZ) {
    const tileZ = tile.z ?? baseZ;
    const tileX = tile.x;
    const tileY = tile.y;
    const tileSize = tile.size ?? 256;
    if (typeof styleConfig?.getTileUrl !== 'function') return;

    const url = styleConfig.getTileUrl(tileZ, tileX, tileY);
    const img = TILE_IMAGE_CACHE.get(url);
    if (img) {
        ctx.drawImage(img, tile.left, tile.top, tileSize * 1.002, tileSize * 1.002);
        return;
    }

    const minZ = 2;
    for (let pz = tileZ - 1; pz >= minZ; pz--) {
        const factor = Math.pow(2, tileZ - pz);
        const px = Math.floor(tileX / factor);
        const py = Math.floor(tileY / factor);
        const pUrl = styleConfig.getTileUrl(pz, px, py);
        const pImg = TILE_IMAGE_CACHE.get(pUrl);
        if (pImg) {
            const remX = ((tileX % factor) + factor) % factor;
            const remY = ((tileY % factor) + factor) % factor;
            const pWidth = pImg.naturalWidth || pImg.width || 256;
            const pHeight = pImg.naturalHeight || pImg.height || 256;
            const subW = pWidth / factor;
            const subH = pHeight / factor;
            ctx.drawImage(pImg, remX * subW, remY * subH, subW, subH, tile.left, tile.top, tileSize * 1.002, tileSize * 1.002);
            return;
        }
    }

    ctx.fillStyle = styleConfig.bg;
    ctx.fillRect(tile.left, tile.top, tileSize, tileSize);
}

/**
 * Dynamically computes and renders visible Web Mercator tiles for the current camera viewport.
 */
export function drawDynamicMapTiles({
    ctx,
    styleConfig,
    baseScene,
    camTargetX,
    camTargetY,
    camZoom,
    width,
    height,
    labelScale = null
}) {
    if (typeof styleConfig?.getTileUrl !== 'function') return;

    if (!ctx.imageSmoothingEnabled) ctx.imageSmoothingEnabled = true;
    if (ctx.imageSmoothingQuality !== 'high') ctx.imageSmoothingQuality = 'high';

    const { tiles } = getVisibleTilesForViewport({
        baseScene,
        camTargetX,
        camTargetY,
        camZoom,
        width,
        height,
        minZ: 2,
        maxZ: 16,
        labelScale: getAnimationTileLabelScale(labelScale)
    });

    for (const tile of tiles) {
        drawTileWithParentFallback(ctx, styleConfig, tile, baseScene.z);
        const primaryUrl = styleConfig.getTileUrl(tile.z, tile.x, tile.y);
        if (!TILE_IMAGE_CACHE.has(primaryUrl)) {
            const fbUrl = styleConfig.getFallbackUrl ? styleConfig.getFallbackUrl(tile.z, tile.x, tile.y) : null;
            loadSingleTileImage(primaryUrl, fbUrl);
        }
    }
}

export function renderTripFrame({
    ctx,
    frame,
    width,
    height,
    trip,
    username,
    coords,
    scene,
    styleConfig,
    introSpring,
    totalFrames = 240,
    settings = createDefaultClipSettings()
}) {
    const activeSettings = { ...createDefaultClipSettings(), ...(settings || {}) };
    const normFrame = totalFrames > 0 ? (frame / totalFrames) * 240 : frame;
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
    const depTimeRaw = checkin.origin?.departureReal || checkin.origin?.departurePlanned || checkin.origin?.departure || checkin.departure;
    const arrTimeRaw = checkin.destination?.arrivalReal || checkin.destination?.arrivalPlanned || checkin.destination?.arrival || checkin.arrival;
    const dateRaw = depTimeRaw || trip.createdAt;
    const dateStr = dateRaw
        ? new Date(dateRaw).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
        : '';
    const depTimeShort = formatClockTime(depTimeRaw);
    const arrTimeShort = formatClockTime(arrTimeRaw);

    const travelProgress = smootherstep(22, 176, normFrame);
    const cameraMode = activeSettings.cameraMode || 'cinematic';

    let overviewBlend = 0;
    if (cameraMode === 'overview') {
        overviewBlend = 1;
    } else if (cameraMode === 'cinematic') {
        const introOverviewBlend = 1 - smootherstep(0, 44, normFrame);
        const finaleBlend = smootherstep(148, 212, normFrame);
        overviewBlend = Math.max(introOverviewBlend, finaleBlend);
    }

    const isUrbanTransit = ['tram', 'subway', 'bus', 'cablecar', 'ferry', 'suburban'].includes(categoryKey)
        || totalDistanceKm < 20;

    let peakMultiplier = 2.15;
    if (isUrbanTransit) {
        const targetCityZ = totalDistanceKm < 6 ? 14.0 : (totalDistanceKm < 15 ? 13.7 : 13.3);
        const neededZoom = Math.pow(2, targetCityZ - scene.z);
        peakMultiplier = Math.max(2.15, Math.min(8.0, neededZoom / Math.max(0.1, scene.fitScale)));
    }

    const camZoom = scene.fitScale * computeCameraZoomMultiplier(normFrame, peakMultiplier, cameraMode);
    const vehiclePose = samplePointAlongRoute(scene, travelProgress);
    const smoothChaseTarget = sampleSmoothedCameraTarget({ ...scene, camZoom }, travelProgress);
    const camTargetX = smoothChaseTarget.x + (scene.centerSceneX - smoothChaseTarget.x) * overviewBlend;
    const camTargetY = smoothChaseTarget.y + (scene.centerSceneY - smoothChaseTarget.y) * overviewBlend;

    const currentDistKm = (totalDistanceKm * travelProgress).toFixed(1);
    const viewCenterY = activeSettings.showHud ? (height / 2 + 42) : (height / 2);
    const routeWidthScale = activeSettings.routeWidthScale || 1.0;

    ctx.save();
    ctx.fillStyle = styleConfig.bg;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(width / 2, viewCenterY);
    ctx.scale(camZoom, camZoom);
    ctx.translate(-camTargetX, -camTargetY);

    if (styleConfig.isVector) {
        drawVectorBaseMap({
            ctx,
            baseScene: scene,
            camZoom,
            styleConfig,
            camTargetX,
            camTargetY,
            width,
            height
        });
    } else {
        drawDynamicMapTiles({
            ctx,
            styleConfig,
            baseScene: scene,
            camTargetX,
            camTargetY,
            camZoom,
            width,
            height,
            labelScale: activeSettings.tileScale
        });
    }

    if (scene.points.length >= 2) {
        ctx.save();
        ctx.strokeStyle = styleConfig.isDark ? 'rgba(255, 255, 255, 0.20)' : 'rgba(15, 23, 42, 0.24)';
        ctx.lineWidth = (10 * routeWidthScale) / camZoom;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.setLineDash([(10 * routeWidthScale) / camZoom, (10 * routeWidthScale) / camZoom]);
        if (scene.path2D) {
            ctx.stroke(scene.path2D);
        } else {
            ctx.beginPath();
            ctx.moveTo(scene.points[0].x, scene.points[0].y);
            for (let i = 1; i < scene.points.length; i++) {
                ctx.lineTo(scene.points[i].x, scene.points[i].y);
            }
            ctx.stroke();
        }
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
        ctx.lineWidth = (15 * routeWidthScale) / camZoom;
        ctx.stroke();
        ctx.restore();

        ctx.strokeStyle = lineColor;
        ctx.lineWidth = (9.5 * routeWidthScale) / camZoom;
        ctx.stroke();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.42)';
        ctx.lineWidth = (3 * routeWidthScale) / camZoom;
        ctx.setLineDash([(8 * routeWidthScale) / camZoom, (14 * routeWidthScale) / camZoom]);
        ctx.lineDashOffset = -(normFrame * 0.8) / camZoom;
        ctx.stroke();
        ctx.restore();
    }

    const validStops = extractIntermediateStopovers(trip);
    drawStopoverDotsAndLabels(ctx, {
        validStops,
        travelProgress,
        scene,
        camZoom,
        lineColor,
        showStopDots: activeSettings.showStopDots,
        showStopNames: activeSettings.showStopNames,
        showScheduleTimes: activeSettings.showScheduleTimes
    });

    const originPt = scene.points[0];
    const destPt = scene.points[scene.points.length - 1];
    const originIsNorthOfDest = originPt && destPt ? originPt.y <= destPt.y : true;

    const originOverviewY = originPt ? (originPt.y - scene.centerSceneY) * scene.fitScale + viewCenterY : 0;
    const originLockedAbove = originOverviewY - 80 < 120 ? false : originIsNorthOfDest;
    const destOverviewY = destPt ? (destPt.y - scene.centerSceneY) * scene.fitScale + viewCenterY : 0;
    const destLockedAbove = destOverviewY - 80 < 120 ? false : !originIsNorthOfDest;

    if (activeSettings.showStationPills !== false) {
        if (originPt) {
            const { placeAbove, horizontalShiftPx } = computeSafeStationPillPlacement(
                originPt, camTargetX, camTargetY, camZoom, width, height, viewCenterY, originLockedAbove
            );
            ctx.save();
            ctx.translate(originPt.x, originPt.y);
            const pinScale = Math.max(0.01, introSpring) / camZoom;
            ctx.scale(pinScale, pinScale);
            drawStationPin(ctx, originName, '#10b981', false, placeAbove, horizontalShiftPx, normFrame, activeSettings.showScheduleTimes ? depTimeShort : '');
            ctx.restore();
        }
        if (destPt) {
            const { placeAbove, horizontalShiftPx } = computeSafeStationPillPlacement(
                destPt, camTargetX, camTargetY, camZoom, width, height, viewCenterY, destLockedAbove
            );
            ctx.save();
            ctx.translate(destPt.x, destPt.y);
            const destPulse = smootherstep(0.84, 1.0, travelProgress);
            const destScale = (0.94 + destPulse * 0.08) / camZoom;
            ctx.scale(destScale, destScale);
            drawStationPin(ctx, destName, lineColor, true, placeAbove, horizontalShiftPx, normFrame, activeSettings.showScheduleTimes ? arrTimeShort : '');
            ctx.restore();
        }
    }

    const vehicleScale = activeSettings.vehicleScale ?? 1.0;
    if (vehicleScale > 0) {
        ctx.save();
        ctx.translate(vehiclePose.x, vehiclePose.y);
        ctx.scale((1.08 * vehicleScale) / camZoom, (1.08 * vehicleScale) / camZoom);
        ctx.rotate(vehiclePose.angleRad || 0);
        drawVehicleOnCanvas(ctx, catMeta.vehicle, lineColor, normFrame);
        ctx.restore();
    }

    ctx.restore(); // End camera transform

    drawVignetteAndScrim(ctx, width, height, activeSettings.showHud, activeSettings.showVignette);

    if (activeSettings.showHud) {
        const shortOrig = shortenStationName(originName);
        const shortDest = shortenStationName(destName);
        const scheduleSpan = (activeSettings.showScheduleTimes && (depTimeShort || arrTimeShort))
            ? `${depTimeShort || '—'} → ${arrTimeShort || '—'}`
            : '';
        const delayPart = delayMinutes > 0 ? `+${delayMinutes}m` : '';
        const subParts = [dateStr, scheduleSpan, delayPart].filter(Boolean);
        drawTopHudBar(ctx, {
            width,
            lineName,
            lineColor,
            badgeTextColor,
            routeTitle: `${shortOrig} → ${shortDest}`,
            subTitle: `@${resolvedUsername}${subParts.length ? ` • ${subParts.join(' • ')}` : ''}`,
            leftMetricLabel: 'DISTANCE',
            leftMetricValue: `${currentDistKm} km`,
            rightMetricLabel: 'DURATION',
            rightMetricValue: durationFormatted,
            isAllMode: false
        });
    }

    if (activeSettings.showWatermark) {
        drawWatermarkPill(ctx, width, height);
    }

    ctx.restore();
}

/**
 * Incrementally accumulates completed ride vectors into composite Path2D layers batched by transit color.
 */
export function syncNetworkCompositePaths(allScene, completedCount) {
    if (!allScene || completedCount <= 0) return null;
    if (typeof Path2D === 'undefined' || typeof Path2D.prototype?.addPath !== 'function') {
        return null;
    }

    if (!allScene._pathCache) {
        allScene._pathCache = {
            committedCount: 0,
            colorPaths: new Map(),
            seenRouteSignatures: new Set()
        };
    }

    const cache = allScene._pathCache;
    const rides = allScene.rides || [];

    if (cache.committedCount > completedCount) {
        cache.committedCount = 0;
        cache.colorPaths = new Map();
        cache.seenRouteSignatures = new Set();
    }

    while (cache.committedCount < completedCount && cache.committedCount < rides.length) {
        const ride = rides[cache.committedCount];
        let p2d = ride.path2D;
        if (!p2d && ride.points && ride.points.length >= 2) {
            p2d = new Path2D();
            p2d.moveTo(ride.points[0].x, ride.points[0].y);
            for (let p = 1; p < ride.points.length; p++) {
                p2d.lineTo(ride.points[p].x, ride.points[p].y);
            }
            ride.path2D = p2d;
        }

        if (p2d) {
            const pastCheckin = ride.trip?.checkin || ride.trip?.train || {};
            const pastCat = CATEGORY_META[pastCheckin.category || 'regional'] || CATEGORY_META.unknown;
            const pastColor = pastCheckin.routeColor
                ? `#${String(pastCheckin.routeColor).replace(/^#/, '')}`
                : pastCat.color;

            let isDuplicate = false;
            const pts = ride.points;
            if (pts && pts.length >= 2 && pts[0].lon !== undefined) {
                const pStart = pts[0];
                const pEnd = pts[pts.length - 1];
                const sig = `${pStart.lon.toFixed(4)},${pStart.lat.toFixed(4)}_${pEnd.lon.toFixed(4)},${pEnd.lat.toFixed(4)}_${pastColor}_${pts.length}`;
                if (cache.seenRouteSignatures.has(sig)) {
                    isDuplicate = true;
                } else {
                    cache.seenRouteSignatures.add(sig);
                }
            }

            if (!isDuplicate) {
                let colorPath = cache.colorPaths.get(pastColor);
                if (!colorPath) {
                    colorPath = new Path2D();
                    cache.colorPaths.set(pastColor, colorPath);
                }
                colorPath.addPath(p2d);
            }
        }
        cache.committedCount++;
    }

    return cache;
}

export function renderAllTripsFrame({
    ctx,
    frame,
    fps = 30,
    totalFrames = null,
    width,
    height,
    username,
    allScene,
    timing,
    styleConfig,
    settings = createDefaultClipSettings()
}) {
    const activeSettings = { ...createDefaultClipSettings(), ...(settings || {}) };
    const rides = allScene?.rides || [];
    if (!rides.length) return;

    const travelTotalFrames = allScene?.travelTotalFrames ?? (timing?.travelTotalFrames || (rides.length * 20));
    const finaleTransitionFrames = timing?.finaleTransitionFrames || Math.round(fps * 1.5);
    const timingTotal = timing?.totalFrames || allScene?.totalFrames || (travelTotalFrames + finaleTransitionFrames);
    const effFrame = (typeof totalFrames === 'number' && totalFrames > 0 && timingTotal > 0 && totalFrames !== timingTotal)
        ? (frame / totalFrames) * timingTotal
        : frame;

    const isFinale = effFrame >= travelTotalFrames;

    let activeIdx = 0;
    while (activeIdx < rides.length - 1 && effFrame >= (rides[activeIdx].endFrame ?? ((activeIdx + 1) * 20))) {
        activeIdx++;
    }

    const activeRide = rides[activeIdx];
    const rideStartFrame = activeRide.startFrame ?? (activeIdx * 20);
    const rideEndFrame = activeRide.endFrame ?? ((activeIdx + 1) * 20);
    const rideDuration = Math.max(1, rideEndFrame - rideStartFrame);
    const localFrame = isFinale ? rideDuration : Math.max(0, effFrame - rideStartFrame);
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

    const rideProgressT = Math.max(0, Math.min(1, localFrame / rideDuration));
    const zStart = typeof activeRide.startZoom === 'number' ? activeRide.startZoom : (activeRide.rideZoom || allScene.fitScale);
    const zEnd = typeof activeRide.endZoom === 'number' ? activeRide.endZoom : (activeRide.rideZoom || allScene.fitScale);
    const logZStart = Math.log(Math.max(0.1, zStart));
    const logZEnd = Math.log(Math.max(0.1, zEnd));

    const zoomT = zEnd > zStart * 1.35
        ? smootherstep(0, 1, Math.min(1, rideProgressT / 0.50))
        : smootherstep(0, 1, rideProgressT);
    let camZoom = Math.exp(logZStart + (logZEnd - logZStart) * zoomT);

    const activeRideScene = {
        points: activeRide.points,
        cumDist: activeRide.cumDist,
        totalPathPx: activeRide.totalPathPx,
        centerSceneX: activeRide.rideCenterX,
        centerSceneY: activeRide.rideCenterY,
        fitScale: camZoom,
        camZoom
    };

    const vehiclePose = samplePointAlongRoute(activeRideScene, rideProgress);
    const currChaseTarget = sampleSmoothedCameraTarget(activeRideScene, rideProgress);

    let camTargetX = currChaseTarget.x;
    let camTargetY = currChaseTarget.y;

    if (activeIdx > 0 && !isFinale) {
        const prevRide = rides[activeIdx - 1];
        const prevRideScene = {
            points: prevRide.points,
            cumDist: prevRide.cumDist,
            totalPathPx: prevRide.totalPathPx,
            centerSceneX: prevRide.rideCenterX,
            centerSceneY: prevRide.rideCenterY,
            fitScale: zStart,
            camZoom: zStart
        };
        const prevEndTarget = sampleSmoothedCameraTarget(prevRideScene, 1);
        const handoffDuration = Math.min(rideDuration * 0.70, Math.max(12, 40 * 0.40));
        const handoffT = smootherstep(0, handoffDuration, localFrame);
        camTargetX = prevEndTarget.x + (currChaseTarget.x - prevEndTarget.x) * handoffT;
        camTargetY = prevEndTarget.y + (currChaseTarget.y - prevEndTarget.y) * handoffT;

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

    const cameraMode = activeSettings.cameraMode || 'cinematic';
    let overviewBlend = 0;
    if (cameraMode === 'overview') {
        overviewBlend = 1;
    } else if (cameraMode === 'cinematic') {
        const introDuration = Math.min(60, (rides[0]?.durationFrames || 40) * 0.85);
        const introBlend = 1 - smootherstep(0, introDuration, effFrame);
        const finaleBlend = isFinale
            ? smootherstep(travelTotalFrames, travelTotalFrames + finaleTransitionFrames, effFrame)
            : 0;
        overviewBlend = Math.max(introBlend, finaleBlend);
    }

    const overviewZoom = allScene.fitScale * 0.95;
    camTargetX = camTargetX + (allScene.centerSceneX - camTargetX) * overviewBlend;
    camTargetY = camTargetY + (allScene.centerSceneY - camTargetY) * overviewBlend;
    if (overviewBlend > 0.0001) {
        const logRide = Math.log(Math.max(0.1, camZoom));
        const logOver = Math.log(Math.max(0.1, overviewZoom));
        camZoom = Math.exp(logRide + (logOver - logRide) * overviewBlend);
    }

    const viewCenterY = activeSettings.showHud ? (height / 2 + 42) : (height / 2);

    ctx.save();
    ctx.fillStyle = styleConfig.bg;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(width / 2, viewCenterY);
    ctx.scale(camZoom, camZoom);
    ctx.translate(-camTargetX, -camTargetY);

    if (styleConfig.isVector) {
        drawVectorBaseMap({
            ctx,
            baseScene: allScene,
            camZoom,
            styleConfig,
            camTargetX,
            camTargetY,
            width,
            height
        });
    } else {
        drawDynamicMapTiles({
            ctx,
            styleConfig,
            baseScene: allScene,
            camTargetX,
            camTargetY,
            camZoom,
            width,
            height,
            labelScale: activeSettings.tileScale
        });
    }

    const routeWidthScale = activeSettings.routeWidthScale || 1.0;
    const completedCount = isFinale ? rides.length : activeIdx;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const batchedCache = syncNetworkCompositePaths(allScene, completedCount);
    if (batchedCache && batchedCache.committedCount > 0 && batchedCache.colorPaths.size > 0) {
        ctx.lineWidth = (4.2 * routeWidthScale) / camZoom;
        for (const [color, colorPath] of batchedCache.colorPaths) {
            ctx.strokeStyle = color;
            ctx.stroke(colorPath);
        }
    } else if (completedCount > 0) {
        ctx.lineWidth = (4.2 * routeWidthScale) / camZoom;
        for (let i = 0; i < completedCount; i++) {
            const pastRide = rides[i];
            if (!pastRide.points || pastRide.points.length < 2) continue;
            const pastCheckin = pastRide.trip?.checkin || pastRide.trip?.train || {};
            const pastCat = CATEGORY_META[pastCheckin.category || 'regional'] || CATEGORY_META.unknown;
            ctx.strokeStyle = pastCheckin.routeColor
                ? `#${String(pastCheckin.routeColor).replace(/^#/, '')}`
                : pastCat.color;
            if (pastRide.path2D) {
                ctx.stroke(pastRide.path2D);
            } else {
                ctx.beginPath();
                ctx.moveTo(pastRide.points[0].x, pastRide.points[0].y);
                for (let p = 1; p < pastRide.points.length; p++) {
                    ctx.lineTo(pastRide.points[p].x, pastRide.points[p].y);
                }
                ctx.stroke();
            }
        }
    }
    ctx.restore();

    if (!isFinale && activeRide.points.length >= 2) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(activeRide.points[0].x, activeRide.points[0].y);
        for (let i = 1; i < activeRide.points.length; i++) {
            ctx.lineTo(activeRide.points[i].x, activeRide.points[i].y);
        }
        ctx.strokeStyle = styleConfig.isDark ? 'rgba(255, 255, 255, 0.22)' : 'rgba(15, 23, 42, 0.24)';
        ctx.lineWidth = (9 * routeWidthScale) / camZoom;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.setLineDash([(9 * routeWidthScale) / camZoom, (9 * routeWidthScale) / camZoom]);
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
        ctx.lineWidth = (14 * routeWidthScale) / camZoom;
        ctx.stroke();
        ctx.restore();

        ctx.strokeStyle = lineColor;
        ctx.lineWidth = (9 * routeWidthScale) / camZoom;
        ctx.stroke();
        ctx.restore();
    }

    if (!isFinale) {
        const activeStops = extractIntermediateStopovers(activeTrip);
        if (activeStops.length > 0) {
            drawStopoverDotsAndLabels(ctx, {
                validStops: activeStops,
                travelProgress: rideProgress,
                scene: {
                    z: allScene.z,
                    originWX: allScene.originWX,
                    originWY: allScene.originWY,
                    points: activeRide.points,
                    cumDist: activeRide.cumDist,
                    totalPathPx: activeRide.totalPathPx
                },
                camZoom,
                lineColor,
                showStopDots: activeSettings.showStopDots,
                showStopNames: activeSettings.showStopNames,
                showScheduleTimes: activeSettings.showScheduleTimes
            });
        }
    }

    const depTimeRaw = checkin.origin?.departureReal || checkin.origin?.departurePlanned || checkin.origin?.departure || checkin.departure;
    const arrTimeRaw = checkin.destination?.arrivalReal || checkin.destination?.arrivalPlanned || checkin.destination?.arrival || checkin.arrival;
    const depTimeShort = formatClockTime(depTimeRaw);
    const arrTimeShort = formatClockTime(arrTimeRaw);

    const originPt = activeRide.points[0];
    const destPt = activeRide.points[activeRide.points.length - 1];
    const originIsNorthOfDest = originPt && destPt ? originPt.y <= destPt.y : true;

    const originOverviewY = originPt ? (originPt.y - allScene.centerSceneY) * allScene.fitScale + viewCenterY : 0;
    const originLockedAbove = originOverviewY - 80 < 120 ? false : originIsNorthOfDest;
    const destOverviewY = destPt ? (destPt.y - allScene.centerSceneY) * allScene.fitScale + viewCenterY : 0;
    const destLockedAbove = destOverviewY - 80 < 120 ? false : !originIsNorthOfDest;

    if (activeSettings.showStationPills !== false) {
        if (originPt && !isFinale) {
            const { placeAbove, horizontalShiftPx } = computeSafeStationPillPlacement(
                originPt, camTargetX, camTargetY, camZoom, width, height, viewCenterY, originLockedAbove
            );
            ctx.save();
            ctx.translate(originPt.x, originPt.y);
            ctx.scale(1 / camZoom, 1 / camZoom);
            drawStationPin(ctx, originName, '#10b981', false, placeAbove, horizontalShiftPx, frame, activeSettings.showScheduleTimes ? depTimeShort : '');
            ctx.restore();
        }
        if (destPt && !isFinale) {
            const { placeAbove, horizontalShiftPx } = computeSafeStationPillPlacement(
                destPt, camTargetX, camTargetY, camZoom, width, height, viewCenterY, destLockedAbove
            );
            ctx.save();
            ctx.translate(destPt.x, destPt.y);
            ctx.scale(1 / camZoom, 1 / camZoom);
            drawStationPin(ctx, destName, lineColor, true, placeAbove, horizontalShiftPx, frame, activeSettings.showScheduleTimes ? arrTimeShort : '');
            ctx.restore();
        }
    }

    const vehicleScale = activeSettings.vehicleScale ?? 1.0;
    if (!isFinale && vehicleScale > 0) {
        ctx.save();
        ctx.translate(vehiclePose.x, vehiclePose.y);
        ctx.scale((1.08 * vehicleScale) / camZoom, (1.08 * vehicleScale) / camZoom);
        ctx.rotate(vehiclePose.angleRad || 0);
        drawVehicleOnCanvas(ctx, catMeta.vehicle, lineColor, frame);
        ctx.restore();
    }

    ctx.restore(); // End camera transform

    drawVignetteAndScrim(ctx, width, height, activeSettings.showHud, activeSettings.showVignette);

    if (activeSettings.showHud) {
        const shortOrig = shortenStationName(originName);
        const shortDest = shortenStationName(destName);
        const resolvedUsername = activeTrip.user?.username || username || 'Traveler';
        const dateRaw = depTimeRaw || activeTrip.createdAt;
        const dateStr = dateRaw
            ? new Date(dateRaw).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
            : '';
        const scheduleSpan = (activeSettings.showScheduleTimes && (depTimeShort || arrTimeShort))
            ? `${depTimeShort || '—'} → ${arrTimeShort || '—'}`
            : '';
        const cumulativeKm = isFinale
            ? (allScene.totalDistanceKm || (activeRide.startKm + activeRide.distanceKm)).toFixed(1)
            : (activeRide.startKm + activeRide.distanceKm * rideProgress).toFixed(1);
        const displayRidesCount = isFinale ? rides.length : activeIdx + 1;
        const activeSubParts = [`Ride #${activeIdx + 1}/${rides.length}`, dateStr, scheduleSpan].filter(Boolean);

        drawTopHudBar(ctx, {
            width,
            lineName: isFinale ? 'ALL' : lineName,
            lineColor,
            badgeBgColor: isFinale ? '#38bdf8' : lineColor,
            badgeTextColor: isFinale ? '#0f172a' : badgeTextColor,
            routeTitle: isFinale ? `All ${rides.length} Saved Rides Completed` : `${shortOrig} → ${shortDest}`,
            subTitle: isFinale
                ? `@${resolvedUsername} • Historical Replay`
                : `@${resolvedUsername} • ${activeSubParts.join(' • ')}`,
            leftMetricLabel: 'TOTAL DISTANCE',
            leftMetricValue: `${cumulativeKm} km`,
            rightMetricLabel: 'RIDE',
            rightMetricValue: `${displayRidesCount}/${rides.length}`,
            isAllMode: true
        });
    }

    if (activeSettings.showWatermark) {
        drawWatermarkPill(ctx, width, height);
    }

    ctx.restore();
}

/**
 * Renders a single animation frame to any HTML5 Canvas 2D context.
 */
export function renderV2Frame({
    ctx,
    frame,
    fps = 30,
    totalFrames = 240,
    width = 960,
    height = 960,
    trip = null,
    mode = 'single',
    username = 'Traveler',
    mapStyle = 'traewelling-dark',
    precompute = null,
    settings = createDefaultClipSettings()
}) {
    if (!ctx) return;
    const styleConfig = MAP_STYLES[mapStyle] || MAP_STYLES['traewelling-dark'];

    if (mode === 'all') {
        if (!precompute?.allScene) return;
        renderAllTripsFrame({
            ctx,
            frame,
            fps,
            totalFrames,
            width,
            height,
            username,
            allScene: precompute.allScene,
            timing: precompute.timing,
            styleConfig,
            settings
        });
        return;
    }

    if (!trip || !precompute) return;

    const introSpring = computeSpring({ frame, fps, config: { damping: 18, stiffness: 90 } });
    renderTripFrame({
        ctx,
        frame,
        width,
        height,
        trip,
        username,
        coords: precompute.coords,
        scene: precompute.scene,
        styleConfig,
        introSpring,
        totalFrames,
        settings
    });
}

export const renderFrame = renderV2Frame;
