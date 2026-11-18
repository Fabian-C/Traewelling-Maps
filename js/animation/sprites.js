/**
 * Canvas 2D Sprites: Transit Vehicles, Station Pins & Intermediate Stopover Markers
 */

import { lonToWorldX, latToWorldY, samplePointAlongRoute, shortenStationName } from './geometry.js';

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

const PLANE_PATH = typeof Path2D !== 'undefined'
    ? new Path2D('M -22,-12 L -14,0 L -22,12 L -16,12 L -8,3 L 6,3 L 2,26 L 9,26 L 16,3 L 26,3 C 31,3 34,0 34,0 C 34,0 31,-3 26,-3 L 16,-3 L 9,-26 L 2,-26 L 6,-3 L -8,-3 L -16,-12 Z')
    : null;

const ICE_NOSE_PATH = typeof Path2D !== 'undefined'
    ? new Path2D('M -8,-9.5 L 16,-9.5 C 26,-9.5 33,-4.5 33,0 C 33,4.5 26,9.5 16,9.5 L -8,9.5 Z')
    : null;

const ICE_WIND_PATH = typeof Path2D !== 'undefined'
    ? new Path2D('M 15,-5.2 C 21,-5.2 25,-2.2 25,0 C 25,2.2 21,5.2 15,5.2 L 11.5,4.2 L 11.5,-4.2 Z')
    : null;

/**
 * High-contrast top-down transit vehicles drawn above map dots and tracks.
 */
export function drawVehicleOnCanvas(ctx, vehicleType, color, frame) {
    const pulse = Math.sin(frame * 0.35) * 0.5 + 0.5;
    ctx.save();
    ctx.scale(1.22, 1.22);

    if (vehicleType === 'ferry') {
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
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-22, -5);
        ctx.lineTo(-42, -5);
        ctx.moveTo(-22, 5);
        ctx.lineTo(-42, 5);
        ctx.stroke();

        if (PLANE_PATH) {
            ctx.save();
            ctx.translate(8, 14);
            ctx.scale(0.85, 0.85);
            ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
            ctx.fill(PLANE_PATH);
            ctx.restore();

            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = color;
            ctx.lineWidth = 2.5;
            ctx.lineJoin = 'round';
            ctx.fill(PLANE_PATH);
            ctx.stroke(PLANE_PATH);
        }
    } else if (vehicleType === 'ice') {
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

        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 1.5;
        if (ICE_NOSE_PATH) {
            ctx.fill(ICE_NOSE_PATH);
            ctx.stroke(ICE_NOSE_PATH);
        }
        ctx.restore();

        ctx.strokeStyle = color;
        ctx.lineWidth = 2.8;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-30, -6.2);
        ctx.lineTo(24, -6.2);
        ctx.moveTo(-30, 6.2);
        ctx.lineTo(24, 6.2);
        ctx.stroke();

        if (ICE_WIND_PATH) {
            ctx.fillStyle = '#0f172a';
            ctx.fill(ICE_WIND_PATH);
        }

        ctx.fillStyle = '#94a3b8';
        drawRoundedRect(ctx, -24, -3, 12, 6, 1.5);
        ctx.fill();
        drawRoundedRect(ctx, -3, -3, 11, 6, 1.5);
        ctx.fill();
    } else {
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

        ctx.fillStyle = color;
        drawRoundedRect(ctx, -22, -7.5, 43, 15, 5);
        ctx.fill();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
        drawRoundedRect(ctx, -16, -4.2, 26, 8.4, 3);
        ctx.fill();

        ctx.strokeStyle = 'rgba(15, 23, 42, 0.35)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-3, -4);
        ctx.lineTo(-3, 4);
        ctx.stroke();

        ctx.fillStyle = '#0f172a';
        drawRoundedRect(ctx, 13, -6.2, 7.5, 12.4, 3);
        ctx.fill();
    }

    ctx.restore();
}

/**
 * Formats an ISO date string or Date into 24-hour HH:mm clock time.
 */
export function formatClockTime(value) {
    if (!value) return '';
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function normalizeStopName(name) {
    if (!name) return '';
    return String(name)
        .toLowerCase()
        .replace(/\s*\(.*?\)\s*/g, ' ')
        .replace(/[.,\-/]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractStopStationId(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const s = (obj.station && typeof obj.station === 'object') ? obj.station : obj;
    if (Array.isArray(s.identifiers)) {
        const ident = s.identifiers.find(i => i.type === 'de_db_ibnr' || i.type === 'ibnr' || i.type === 'eva' || i.type === 'eva_number');
        if (ident?.value) return String(ident.value);
    }
    return (obj.station && typeof obj.station === 'object' ? obj.station.id : null)
        || s.evaId || s.eva || s.ibnr || null;
}

/**
 * Extracts intermediate stopovers between origin and destination, handling both endpoint-inclusive
 * and intermediate-only stop arrays, object/string station shapes, and coordinate-less stops.
 */
export function extractIntermediateStopovers(trip) {
    if (!trip || typeof trip !== 'object') return [];
    const checkin = trip.checkin || trip.train || {};
    const rawStops = Array.isArray(checkin.stopovers)
        ? checkin.stopovers
        : (Array.isArray(trip.stopovers) ? trip.stopovers : []);
    if (!rawStops.length) return [];

    const origObj = checkin.origin || {};
    const destObj = checkin.destination || {};
    const origName = normalizeStopName(origObj.name || origObj.station?.name || trip.origin || '');
    const destName = normalizeStopName(destObj.name || destObj.station?.name || trip.destination || '');
    const origId = extractStopStationId(origObj) || (origObj.id ? String(origObj.id) : null);
    const destId = extractStopStationId(destObj) || (destObj.id ? String(destObj.id) : null);

    const depRaw = origObj.departureReal || origObj.departurePlanned || origObj.departure || checkin.departure;
    const arrRaw = destObj.arrivalReal || destObj.arrivalPlanned || destObj.arrival || checkin.arrival;
    const depMs = depRaw ? Date.parse(depRaw) : NaN;
    const arrMs = arrRaw ? Date.parse(arrRaw) : NaN;
    const totalMs = (Number.isFinite(depMs) && Number.isFinite(arrMs) && arrMs > depMs) ? (arrMs - depMs) : 0;

    const filtered = rawStops.filter((stop) => {
        if (!stop || stop.cancelled === true) return false;
        const stObj = (stop.station && typeof stop.station === 'object') ? stop.station : stop;
        const rawName = (stop.station && typeof stop.station === 'string')
            ? stop.station
            : (stObj.name || stop.name || '');
        const normName = normalizeStopName(rawName);
        const stopId = extractStopStationId(stop);

        if (origId && stopId && String(origId) === String(stopId)) return false;
        if (destId && stopId && String(destId) === String(stopId)) return false;
        if (origName && normName && normName === origName) return false;
        if (destName && normName && normName === destName) return false;
        return Boolean(rawName || stopId || stObj.longitude !== undefined || stObj.lon !== undefined || stObj.lng !== undefined);
    });

    return filtered.map((stop, idx) => {
        const stObj = (stop.station && typeof stop.station === 'object') ? stop.station : stop;
        const fullName = String((typeof stop.station === 'string' ? stop.station : '') || stObj.name || stop.name || '').trim();
        const shortName = shortenStationName(fullName);

        const rawLon = stObj.longitude ?? stObj.lon ?? stObj.lng ?? stop.longitude ?? stop.lon ?? stop.lng;
        const rawLat = stObj.latitude ?? stObj.lat ?? stop.latitude ?? stop.lat;
        const lon = (rawLon !== null && rawLon !== undefined && rawLon !== '') ? Number(rawLon) : NaN;
        const lat = (rawLat !== null && rawLat !== undefined && rawLat !== '') ? Number(rawLat) : NaN;
        const hasCoords = Number.isFinite(lon) && Number.isFinite(lat) && (lon !== 0 || lat !== 0);

        const stopTimeRaw = stop.arrivalReal || stop.arrivalPlanned || stop.arrival
            || stop.departureReal || stop.departurePlanned || stop.departure || '';
        const timeShort = formatClockTime(stopTimeRaw);

        let progressFrac = (idx + 1) / (filtered.length + 1);
        if (totalMs > 0 && stopTimeRaw) {
            const stopMs = Date.parse(stopTimeRaw);
            if (Number.isFinite(stopMs)) {
                const rawFrac = (stopMs - depMs) / totalMs;
                if (rawFrac > 0.03 && rawFrac < 0.97) {
                    progressFrac = rawFrac;
                }
            }
        }

        return {
            name: fullName,
            shortName,
            lon,
            lat,
            hasCoords,
            timeShort,
            progressFrac
        };
    });
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
    frame = 0,
    timeLabel = ''
) {
    ctx.save();

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

    const shortName = shortenStationName(label);
    ctx.font = '800 24px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
    const textW = ctx.measureText(shortName).width;

    const cleanTime = timeLabel ? String(timeLabel).trim() : '';
    let timeW = 0;
    if (cleanTime) {
        ctx.font = '700 18px "JetBrains Mono", monospace';
        timeW = ctx.measureText(cleanTime).width;
    }

    const extraTimePad = cleanTime ? (timeW + 24) : 0;
    const pillW = textW + 54 + extraTimePad;
    const pillH = 46;
    const pillX = -pillW / 2 + horizontalShiftPx;
    const pillY = placeAbove ? -34 - pillH : 34;

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.96)';
    drawRoundedRect(ctx, pillX, pillY, pillW, pillH, 23);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = dotColor;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.fillStyle = dotColor;
    ctx.beginPath();
    ctx.arc(pillX + 20, pillY + pillH / 2, 6.0, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = '800 24px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(shortName, pillX + 36, pillY + pillH / 2 + 1);

    if (cleanTime) {
        const divX = pillX + 36 + textW + 10;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
        ctx.fillRect(divX, pillY + 12, 1.5, pillH - 24);
        ctx.font = '700 18px "JetBrains Mono", monospace';
        ctx.fillStyle = '#cbd5e1';
        ctx.fillText(cleanTime, divX + 9, pillY + pillH / 2 + 1);
    }
    ctx.restore();

    ctx.restore();
}

/**
 * Compute safe screen-space placement for a station callout pill.
 */
export function computeSafeStationPillPlacement(pt, camTargetX, camTargetY, camZoom, width, _height, _viewCenterY, placeAboveLocked) {
    const screenX = (pt.x - camTargetX) * camZoom + width / 2;

    let horizontalShiftPx = 0;
    const margin = 140;
    if (screenX < margin) {
        horizontalShiftPx = Math.min(50, (margin - screenX) * 0.5);
    } else if (screenX > width - margin) {
        horizontalShiftPx = Math.max(-50, ((width - margin) - screenX) * 0.5);
    }

    return { placeAbove: placeAboveLocked, horizontalShiftPx };
}

/**
 * Renders intermediate stopover dots (and optional station labels / times) along a journey.
 */
export function drawStopoverDotsAndLabels(ctx, {
    validStops = [],
    travelProgress,
    scene,
    camZoom,
    lineColor,
    showStopDots = true,
    showStopNames = true,
    showScheduleTimes = false
}) {
    if (!showStopDots && !showStopNames) return;

    if (Array.isArray(validStops) && validStops.length > 0) {
        validStops.forEach((stop, idx) => {
            const st = (stop?.station && typeof stop.station === 'object') ? stop.station : stop;
            const rawLon = stop.hasCoords !== undefined ? (stop.hasCoords ? stop.lon : NaN) : (st?.longitude ?? st?.lon ?? st?.lng);
            const rawLat = stop.hasCoords !== undefined ? (stop.hasCoords ? stop.lat : NaN) : (st?.latitude ?? st?.lat);
            const sLon = (rawLon !== null && rawLon !== undefined && rawLon !== '') ? Number(rawLon) : NaN;
            const sLat = (rawLat !== null && rawLat !== undefined && rawLat !== '') ? Number(rawLat) : NaN;
            const hasCoords = Number.isFinite(sLon) && Number.isFinite(sLat) && (sLon !== 0 || sLat !== 0);

            let sx;
            let sy;
            if (hasCoords) {
                sx = lonToWorldX(sLon, scene.z) - scene.originWX;
                sy = latToWorldY(sLat, scene.z) - scene.originWY;
            } else if (scene?.points?.length >= 2) {
                const fallbackFrac = stop.progressFrac ?? ((idx + 1) / (validStops.length + 1));
                const pt = samplePointAlongRoute(scene, fallbackFrac);
                sx = pt.x;
                sy = pt.y;
            } else {
                return;
            }

            ctx.save();
            ctx.translate(sx, sy);
            ctx.scale(1 / camZoom, 1 / camZoom);

            if (showStopDots) {
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
            }

            if (showStopNames) {
                const rawName = stop.shortName
                    || shortenStationName(
                        (typeof stop?.station === 'string' ? stop.station : '')
                        || st?.name
                        || stop?.name
                        || ''
                    );
                if (rawName) {
                    ctx.shadowBlur = 0;
                    ctx.shadowOffsetY = 0;
                    ctx.font = '700 18px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    ctx.strokeStyle = 'rgba(15, 23, 42, 0.92)';
                    ctx.lineWidth = 4.5;
                    ctx.lineJoin = 'round';
                    if (typeof ctx.strokeText === 'function') {
                        ctx.strokeText(rawName, 12, 0);
                    }
                    ctx.fillStyle = '#ffffff';
                    ctx.fillText(rawName, 12, 0);

                    const timeStr = stop.timeShort || formatClockTime(
                        stop?.arrivalReal || stop?.arrivalPlanned || stop?.arrival
                        || stop?.departureReal || stop?.departurePlanned || stop?.departure
                    );
                    if (showScheduleTimes && timeStr) {
                        const nameW = ctx.measureText(rawName).width;
                        ctx.font = '700 14px "JetBrains Mono", monospace';
                        if (typeof ctx.strokeText === 'function') {
                            ctx.strokeText(timeStr, 12 + nameW + 7, 0.5);
                        }
                        ctx.fillStyle = '#cbd5e1';
                        ctx.fillText(timeStr, 12 + nameW + 7, 0.5);
                    }
                }
            }
            ctx.restore();
        });
    } else if (showStopDots && scene?.points?.length >= 2) {
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
}
