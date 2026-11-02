/**
 * WebGL2 Scene VBO Packer
 * Converts normalized ride polylines into an interleaved GPU vertex buffer
 * with screen-space line extrusion attributes, temporal windows, and category colors.
 */

import { CATEGORY_META } from '../../animation/tiles.js';

export function parseHexColor(hexStr, defaultAlpha = 1.0) {
    if (!hexStr) return [0.2, 0.6, 1.0, defaultAlpha];
    const clean = String(hexStr).replace(/^#/, '');
    if (clean.length === 6) {
        return [
            parseInt(clean.slice(0, 2), 16) / 255,
            parseInt(clean.slice(2, 4), 16) / 255,
            parseInt(clean.slice(4, 6), 16) / 255,
            defaultAlpha
        ];
    }
    if (clean.length === 3) {
        return [
            parseInt(clean[0] + clean[0], 16) / 255,
            parseInt(clean[1] + clean[1], 16) / 255,
            parseInt(clean[2] + clean[2], 16) / 255,
            defaultAlpha
        ];
    }
    return [0.2, 0.6, 1.0, defaultAlpha];
}

/**
 * Packs multiple rides into a contiguous Float32Array for gl.bufferData.
 *
 * Vertex Attribute Layout (13 floats = 52 bytes per vertex):
 * [0..1]   a_currPoint     (vec2)
 * [2..3]   a_prevPoint     (vec2)
 * [4..5]   a_nextPoint     (vec2)
 * [6]      a_extrusionSide (float: -1.0 or +1.0)
 * [7]      a_timeProgress  (float: 0.0 .. 1.0)
 * [8..9]   a_timeWindow    (vec2: tStart, tEnd)
 * [10..13] a_categoryColor (vec4: r, g, b, a)
 */
export const FLOATS_PER_VERTEX = 13;
export const BYTES_PER_VERTEX = FLOATS_PER_VERTEX * 4;

export function packRidesIntoVBO(rides = [], totalFrames = 240) {
    // 1. Calculate total segments across all rides
    let totalSegments = 0;
    for (const ride of rides) {
        const pts = ride.points;
        if (pts && pts.length >= 2) {
            totalSegments += (pts.length - 1);
        }
    }

    if (totalSegments === 0) {
        return {
            buffer: new Float32Array(0),
            vertexCount: 0,
            segmentCount: 0
        };
    }

    // 2 triangles = 6 vertices per line segment
    const vertexCount = totalSegments * 6;
    const buffer = new Float32Array(vertexCount * FLOATS_PER_VERTEX);
    let offset = 0;

    for (const ride of rides) {
        const pts = ride.points;
        if (!pts || pts.length < 2) continue;

        const checkin = ride.trip?.checkin || ride.trip?.train || {};
        const catKey = checkin.category || 'regional';
        const catMeta = CATEGORY_META[catKey] || CATEGORY_META.unknown;
        const colorHex = checkin.routeColor ? `#${String(checkin.routeColor).replace(/^#/, '')}` : catMeta.color;
        const [cr, cg, cb, ca] = parseHexColor(colorHex, 1.0);

        const tStart = ride.startFrame ?? 0;
        const tEnd = ride.endFrame ?? totalFrames;

        // Compute cumulative path lengths for accurate temporal progress
        const cumDist = new Float32Array(pts.length);
        cumDist[0] = 0;
        for (let i = 1; i < pts.length; i++) {
            const dx = pts[i].x - pts[i - 1].x;
            const dy = pts[i].y - pts[i - 1].y;
            cumDist[i] = cumDist[i - 1] + Math.hypot(dx, dy);
        }
        const totalDist = cumDist[pts.length - 1] || 1.0;

        for (let i = 0; i < pts.length - 1; i++) {
            const pA = pts[i];
            const pB = pts[i + 1];

            const prevA = pts[Math.max(0, i - 1)];
            const nextA = pts[i + 1];

            const prevB = pts[i];
            const nextB = pts[Math.min(pts.length - 1, i + 2)];

            const progA = cumDist[i] / totalDist;
            const progB = cumDist[i + 1] / totalDist;

            // Helper to push 1 vertex
            const pushVertex = (curr, prev, next, side, prog) => {
                buffer[offset++] = curr.x;
                buffer[offset++] = curr.y;
                buffer[offset++] = prev.x;
                buffer[offset++] = prev.y;
                buffer[offset++] = next.x;
                buffer[offset++] = next.y;
                buffer[offset++] = side;
                buffer[offset++] = prog;
                buffer[offset++] = tStart;
                buffer[offset++] = tEnd;
                buffer[offset++] = cr;
                buffer[offset++] = cg;
                buffer[offset++] = cb;
                buffer[offset++] = ca;
            };

            // Triangle 1: (A-, A+, B-)
            pushVertex(pA, prevA, nextA, -1.0, progA);
            pushVertex(pA, prevA, nextA, +1.0, progA);
            pushVertex(pB, prevB, nextB, -1.0, progB);

            // Triangle 2: (B-, A+, B+)
            pushVertex(pB, prevB, nextB, -1.0, progB);
            pushVertex(pA, prevA, nextA, +1.0, progA);
            pushVertex(pB, prevB, nextB, +1.0, progB);
        }
    }

    return {
        buffer,
        vertexCount,
        segmentCount: totalSegments
    };
}

