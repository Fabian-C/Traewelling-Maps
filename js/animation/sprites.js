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

function makeLinearGrad(ctx, x0, y0, x1, y1, stops, fallback) {
    if (typeof ctx.createLinearGradient !== 'function') return fallback;
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    stops.forEach(([offset, col]) => g.addColorStop(offset, col));
    return g;
}

function createCarProjector(cx, cy, angleRad) {
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);
    const fx = cos;
    const fy = sin;
    const rx = -sin;
    const ry = cos;
    return {
        cx,
        cy,
        angleRad,
        fx,
        fy,
        rx,
        ry,
        visSideSign: (rx * 0.18 + ry * 0.98) >= 0 ? 1 : -1,
        frontVisible: (fx * 0.18 + fy * 0.98) >= 0,
        proj(lx, ly, lz = 0) {
            return [
                cx + lx * cos - ly * sin - 0.16 * lz,
                cy + lx * sin + ly * cos - 0.85 * lz
            ];
        }
    };
}

function traceProjectedPoly(ctx, pts) {
    if (!pts.length) return;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i][0], pts[i][1]);
    }
    ctx.closePath();
}

function draw3DBox(ctx, P, x0, x1, y0, y1, z0, z1, { topFill, sideFill, endFill, stroke = null, lineWidth = 0.8 }) {
    const sy = P.visSideSign > 0 ? y1 : y0;
    const ex = P.frontVisible ? x1 : x0;

    // Visible side wall
    if (sideFill) {
        traceProjectedPoly(ctx, [
            P.proj(x0, sy, z0),
            P.proj(x1, sy, z0),
            P.proj(x1, sy, z1),
            P.proj(x0, sy, z1)
        ]);
        ctx.fillStyle = sideFill;
        ctx.fill();
        if (stroke) {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = lineWidth;
            ctx.stroke();
        }
    }

    // Visible front/rear end face
    if (endFill) {
        traceProjectedPoly(ctx, [
            P.proj(ex, y0, z0),
            P.proj(ex, y1, z0),
            P.proj(ex, y1, z1),
            P.proj(ex, y0, z1)
        ]);
        ctx.fillStyle = endFill;
        ctx.fill();
        if (stroke) {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = lineWidth;
            ctx.stroke();
        }
    }

    // Top face
    if (topFill) {
        traceProjectedPoly(ctx, [
            P.proj(x0, y0, z1),
            P.proj(x1, y0, z1),
            P.proj(x1, y1, z1),
            P.proj(x0, y1, z1)
        ]);
        ctx.fillStyle = topFill;
        ctx.fill();
        if (stroke) {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = lineWidth;
            ctx.stroke();
        }
    }
}

function draw3DPantograph(ctx, P, x, zBase) {
    const zTop = zBase + 3.6;
    ctx.save();
    // Recessed roof well
    traceProjectedPoly(ctx, [
        P.proj(x - 4.5, -4.5, zBase + 0.05),
        P.proj(x + 4.5, -4.5, zBase + 0.05),
        P.proj(x + 4.5, 4.5, zBase + 0.05),
        P.proj(x - 4.5, 4.5, zBase + 0.05)
    ]);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.35)';
    ctx.fill();

    // Articulated 3D scissor arms rising in Z
    const pBaseL = P.proj(x - 3, -2.5, zBase + 0.2);
    const pBaseR = P.proj(x - 3, 2.5, zBase + 0.2);
    const pMid = P.proj(x + 1.5, 0, zBase + 2.1);
    const pBowL = P.proj(x + 0.2, -5.0, zTop);
    const pBowR = P.proj(x + 0.2, 5.0, zTop);
    const pBowMid = P.proj(x + 0.2, 0, zTop);

    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1.1;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pBaseL[0], pBaseL[1]);
    ctx.lineTo(pMid[0], pMid[1]);
    ctx.lineTo(pBaseR[0], pBaseR[1]);
    ctx.moveTo(pMid[0], pMid[1]);
    ctx.lineTo(pBowMid[0], pBowMid[1]);
    ctx.stroke();

    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(pBowL[0], pBowL[1]);
    ctx.lineTo(pBowR[0], pBowR[1]);
    ctx.stroke();
    ctx.restore();
}

function draw3DHeadlightGlow(ctx, P, lx, ySpread = 3.2, z = 3.6, warm = true) {
    ctx.save();
    [-ySpread, ySpread].forEach((ly) => {
        const [sx, sy] = P.proj(lx, ly, z);
        if (typeof ctx.createRadialGradient === 'function') {
            const g = ctx.createRadialGradient(sx, sy, 0.3, sx + P.fx * 3, sy + P.fy * 3, 7.0);
            g.addColorStop(0, warm ? 'rgba(254, 249, 195, 0.90)' : 'rgba(224, 242, 254, 0.85)');
            g.addColorStop(0.5, warm ? 'rgba(254, 240, 138, 0.25)' : 'rgba(186, 230, 253, 0.22)');
            g.addColorStop(1, 'rgba(254, 240, 138, 0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(sx + P.fx * 2, sy + P.fy * 2, 7.0, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.fillStyle = warm ? '#fef08a' : '#e0f2fe';
        ctx.beginPath();
        ctx.arc(sx, sy, 1.35, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.restore();
}

function draw3DTailLights(ctx, P, lx, ySpread = 3.4, z = 3.8) {
    ctx.save();
    ctx.fillStyle = '#fb7185';
    [-ySpread, ySpread].forEach((ly) => {
        const [sx, sy] = P.proj(lx, ly, z);
        ctx.beginPath();
        ctx.arc(sx, sy, 1.2, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.restore();
}

function draw3DBellowsBridge(ctx, P1, x1, P2, x2, halfW = 5.4, zBase = 2.2, zTop = 8.4) {
    const sy1 = P1.visSideSign > 0 ? halfW : -halfW;
    const sy2 = P2.visSideSign > 0 ? halfW : -halfW;

    ctx.save();
    // Side wall of flexible joint
    traceProjectedPoly(ctx, [
        P1.proj(x1, sy1, zBase),
        P2.proj(x2, sy2, zBase),
        P2.proj(x2, sy2, zTop),
        P1.proj(x1, sy1, zTop)
    ]);
    ctx.fillStyle = '#0f172a';
    ctx.fill();

    // Top roof of flexible joint
    traceProjectedPoly(ctx, [
        P1.proj(x1, -halfW, zTop),
        P2.proj(x2, -halfW, zTop),
        P2.proj(x2, halfW, zTop),
        P1.proj(x1, halfW, zTop)
    ]);
    ctx.fillStyle = '#1e293b';
    ctx.fill();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();
}

function draw3DCar(ctx, P, {
    halfL = 13,
    halfW = 6.8,
    zBase = 2.0,
    zRoof = 8.4,
    zCrown = 10.2,
    color = '#ff2e55',
    role = 'mid', // 'lead' | 'mid' | 'tail' | 'single'
    noseStyle = 'bevel', // 'bullet' | 'bevel' | 'flat'
    hasPantograph = false,
    hasAc = true,
    windowCount = 4
}) {
    const bodyGradTop = makeLinearGrad(ctx, P.cx, P.cy - 14, P.cx, P.cy + 14, [
        [0, '#ffffff'],
        [0.55, '#f1f5f9'],
        [1, '#cbd5e1']
    ], '#f8fafc');
    const sideDark = '#334155';
    const sideLit = '#cbd5e1';
    const endDark = '#475569';

    // 1. Soft ground shadow on z = 0
    ctx.save();
    traceProjectedPoly(ctx, [
        P.proj(-halfL + 1, -halfW - 0.5, 0),
        P.proj(halfL + 1, -halfW - 0.5, 0),
        P.proj(halfL + 1, halfW + 1.5, 0),
        P.proj(-halfL + 1, halfW + 1.5, 0)
    ]);
    ctx.fillStyle = 'rgba(2, 6, 23, 0.44)';
    ctx.fill();
    ctx.restore();

    // 2. Dark 3D Bogies / Wheels (z = 0.2 .. 2.2)
    draw3DBox(ctx, P, -halfL * 0.72, -halfL * 0.24, -halfW * 0.82, halfW * 0.82, 0.2, zBase + 0.3, {
        topFill: '#0f172a',
        sideFill: '#020617',
        endFill: '#0f172a'
    });
    draw3DBox(ctx, P, halfL * 0.24, halfL * 0.72, -halfW * 0.82, halfW * 0.82, 0.2, zBase + 0.3, {
        topFill: '#0f172a',
        sideFill: '#020617',
        endFill: '#0f172a'
    });

    const isBulletEnd = noseStyle === 'bullet' && (role === 'lead' || role === 'tail');
    const bulletDir = role === 'tail' ? -1 : 1;

    if (isBulletEnd) {
        // Tapered 3D Bullet Car (front or rear ICE nose)
        const rearX = bulletDir > 0 ? -halfL : halfL;
        const midX = bulletDir > 0 ? 1.5 : -1.5;
        const tipX = bulletDir > 0 ? halfL + 2.5 : -halfL - 2.5;
        const xMin = Math.min(rearX, midX);
        const xMax = Math.max(rearX, midX);

        // Straight rear section prism
        draw3DBox(ctx, P, xMin, xMax, -halfW, halfW, zBase, zRoof, {
            topFill: bodyGradTop,
            sideFill: sideLit,
            endFill: endDark,
            stroke: 'rgba(15, 23, 42, 0.42)',
            lineWidth: 0.9
        });

        // Crowned roof on straight section
        draw3DBox(ctx, P, xMin + 0.5, xMax, -halfW * 0.74, halfW * 0.74, zRoof, zCrown, {
            topFill: '#ffffff',
            sideFill: '#e2e8f0',
            endFill: '#cbd5e1'
        });

        // 3D Sculpted Nose Cone (sloping in Y and Z toward tipX)
        const sy = P.visSideSign * halfW;
        const tipW = 1.6 * P.visSideSign;
        const zNoseTipLow = zBase + 0.8;
        const zNoseTipHigh = zBase + 3.2;

        // Visible side wall of nose
        traceProjectedPoly(ctx, [
            P.proj(midX, sy, zBase),
            P.proj(tipX, tipW, zNoseTipLow),
            P.proj(tipX, tipW, zNoseTipHigh),
            P.proj(midX, sy, zRoof)
        ]);
        ctx.fillStyle = sideLit;
        ctx.fill();
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.38)';
        ctx.lineWidth = 0.8;
        ctx.stroke();

        // Top sloped hood of nose
        traceProjectedPoly(ctx, [
            P.proj(midX, -halfW, zRoof),
            P.proj(tipX, -1.6, zNoseTipHigh),
            P.proj(tipX, 1.6, zNoseTipHigh),
            P.proj(midX, halfW, zRoof)
        ]);
        ctx.fillStyle = bodyGradTop;
        ctx.fill();
        ctx.stroke();

        // Signature tapered ICE livery stripe on visible side
        traceProjectedPoly(ctx, [
            P.proj(xMin + 0.5, sy * 1.01, zBase + 1.0),
            P.proj(xMax, sy * 1.01, zBase + 1.0),
            P.proj(tipX - bulletDir * 0.6, tipW * 1.01, zNoseTipLow + 0.5),
            P.proj(tipX - bulletDir * 0.6, tipW * 1.01, zNoseTipLow + 1.7),
            P.proj(xMax, sy * 1.01, zBase + 2.3),
            P.proj(xMin + 0.5, sy * 1.01, zBase + 2.3)
        ]);
        ctx.fillStyle = color;
        ctx.fill();

        // Panoramic curved cockpit glass on sloped hood
        const glassStart = midX + bulletDir * 2.0;
        const glassEnd = tipX - bulletDir * 3.5;
        traceProjectedPoly(ctx, [
            P.proj(glassStart, -halfW * 0.64, zRoof - 0.6),
            P.proj(glassEnd, -2.5, zNoseTipHigh + 1.1),
            P.proj(glassEnd, 2.5, zNoseTipHigh + 1.1),
            P.proj(glassStart, halfW * 0.64, zRoof - 0.6)
        ]);
        ctx.fillStyle = '#0f172a';
        ctx.fill();

        // Side windows on straight section
        const syWin = sy * 1.01;
        for (let w = 0; w < 2; w++) {
            const wx0 = xMin + 2.2 + w * 4.8;
            traceProjectedPoly(ctx, [
                P.proj(wx0, syWin, zBase + 3.1),
                P.proj(wx0 + 3.4, syWin, zBase + 3.1),
                P.proj(wx0 + 3.4, syWin, zRoof - 1.2),
                P.proj(wx0, syWin, zRoof - 1.2)
            ]);
            ctx.fillStyle = '#0f172a';
            ctx.fill();
        }

        if (role === 'lead') {
            draw3DHeadlightGlow(ctx, P, tipX - 0.5, 1.5, zNoseTipLow + 1.0, true);
        } else {
            draw3DTailLights(ctx, P, tipX + 0.5, 1.5, zNoseTipLow + 1.2);
        }
    } else {
        // Standard 3D Coach / Cab Prism
        const endColor = (role === 'lead' && P.frontVisible) || (role === 'tail' && !P.frontVisible)
            ? '#cbd5e1'
            : endDark;

        draw3DBox(ctx, P, -halfL, halfL, -halfW, halfW, zBase, zRoof, {
            topFill: '#e2e8f0',
            sideFill: sideLit,
            endFill: endColor,
            stroke: 'rgba(15, 23, 42, 0.45)',
            lineWidth: 0.9
        });

        // Raised beveled roof crown
        draw3DBox(ctx, P, -halfL + 0.8, halfL - 0.8, -halfW * 0.78, halfW * 0.78, zRoof, zCrown, {
            topFill: bodyGradTop,
            sideFill: '#cbd5e1',
            endFill: '#94a3b8'
        });

        // Visible side wall livery stripe + individual recessed windows
        const sy = P.visSideSign * halfW * 1.01;
        traceProjectedPoly(ctx, [
            P.proj(-halfL + 0.4, sy, zBase + 0.8),
            P.proj(halfL - 0.4, sy, zBase + 0.8),
            P.proj(halfL - 0.4, sy, zBase + 2.2),
            P.proj(-halfL + 0.4, sy, zBase + 2.2)
        ]);
        ctx.fillStyle = color;
        ctx.fill();

        const span = (halfL * 2 - 4.4) / Math.max(1, windowCount);
        for (let i = 0; i < windowCount; i++) {
            const wx0 = -halfL + 2.4 + i * span;
            const wx1 = wx0 + span * 0.72;
            traceProjectedPoly(ctx, [
                P.proj(wx0, sy, zBase + 3.0),
                P.proj(wx1, sy, zBase + 3.0),
                P.proj(wx1, sy, zRoof - 1.1),
                P.proj(wx0, sy, zRoof - 1.1)
            ]);
            ctx.fillStyle = '#0f172a';
            ctx.fill();
        }

        // Front cab windshield & headlights
        if (role === 'lead' || role === 'single') {
            if (P.frontVisible) {
                traceProjectedPoly(ctx, [
                    P.proj(halfL + 0.05, -halfW * 0.72, zBase + 3.4),
                    P.proj(halfL + 0.05, halfW * 0.72, zBase + 3.4),
                    P.proj(halfL + 0.05, halfW * 0.66, zRoof - 0.9),
                    P.proj(halfL + 0.05, -halfW * 0.66, zRoof - 0.9)
                ]);
                ctx.fillStyle = '#0f172a';
                ctx.fill();

                // Front livery bumper band
                traceProjectedPoly(ctx, [
                    P.proj(halfL + 0.05, -halfW * 0.95, zBase + 0.8),
                    P.proj(halfL + 0.05, halfW * 0.95, zBase + 0.8),
                    P.proj(halfL + 0.05, halfW * 0.95, zBase + 2.2),
                    P.proj(halfL + 0.05, -halfW * 0.95, zBase + 2.2)
                ]);
                ctx.fillStyle = color;
                ctx.fill();
            }
            draw3DHeadlightGlow(ctx, P, halfL + 0.1, halfW * 0.56, zBase + 1.5, true);
        }

        if ((role === 'tail' || role === 'single') && !P.frontVisible) {
            draw3DTailLights(ctx, P, -halfL - 0.05, halfW * 0.56, zBase + 1.6);
        } else if (role === 'tail' || role === 'single') {
            draw3DTailLights(ctx, P, -halfL - 0.05, halfW * 0.56, zBase + 2.2);
        }
    }

    // 4. Raised 3D Roof Equipment (zCrown .. zCrown + 2.6)
    if (hasAc) {
        draw3DBox(ctx, P, -4.2, 4.2, -3.2, 3.2, zCrown, zCrown + 1.5, {
            topFill: '#e2e8f0',
            sideFill: sideDark,
            endFill: '#475569',
            stroke: 'rgba(15, 23, 42, 0.35)',
            lineWidth: 0.6
        });
    }
    if (hasPantograph) {
        draw3DPantograph(ctx, P, isBulletEnd ? -bulletDir * 5.0 : 0, zCrown);
    }
}

function getConsistSpec(vehicleType) {
    switch (vehicleType) {
        case 'ice':
            return [
                { role: 'tail', halfL: 13.5, halfW: 6.8, noseStyle: 'bullet', hasPantograph: false, hasAc: true, windowCount: 2, spacingPrev: 26 },
                { role: 'mid', halfL: 11.5, halfW: 6.8, noseStyle: 'flat', hasPantograph: true, hasAc: false, windowCount: 4, spacingPrev: 24.5 },
                { role: 'lead', halfL: 13.5, halfW: 6.8, noseStyle: 'bullet', hasPantograph: false, hasAc: true, windowCount: 2, spacingPrev: 0 }
            ];
        case 'tram':
            return [
                { role: 'tail', halfL: 10.5, halfW: 5.6, noseStyle: 'bevel', hasPantograph: false, hasAc: true, windowCount: 3, spacingPrev: 18 },
                { role: 'mid', halfL: 6.5, halfW: 5.6, noseStyle: 'flat', hasPantograph: true, hasAc: false, windowCount: 2, spacingPrev: 18 },
                { role: 'lead', halfL: 10.5, halfW: 5.6, noseStyle: 'bevel', hasPantograph: false, hasAc: true, windowCount: 3, spacingPrev: 0 }
            ];
        case 'sbahn':
            return [
                { role: 'tail', halfL: 13.0, halfW: 6.6, noseStyle: 'bevel', hasPantograph: false, hasAc: true, windowCount: 4, spacingPrev: 27 },
                { role: 'lead', halfL: 13.0, halfW: 6.6, noseStyle: 'bevel', hasPantograph: true, hasAc: false, windowCount: 4, spacingPrev: 0 }
            ];
        case 'ubahn':
            return [
                { role: 'tail', halfL: 12.5, halfW: 6.6, noseStyle: 'flat', hasPantograph: false, hasAc: true, windowCount: 4, spacingPrev: 26 },
                { role: 'lead', halfL: 12.5, halfW: 6.6, noseStyle: 'flat', hasPantograph: false, hasAc: true, windowCount: 4, spacingPrev: 0 }
            ];
        case 'bus':
            return [
                { role: 'single', halfL: 15.0, halfW: 6.8, zBase: 1.6, zRoof: 8.2, zCrown: 9.6, noseStyle: 'bevel', hasPantograph: false, hasAc: true, windowCount: 5, spacingPrev: 0 }
            ];
        default: // 'train'
            return [
                { role: 'tail', halfL: 12.5, halfW: 6.8, noseStyle: 'flat', hasPantograph: false, hasAc: true, windowCount: 4, spacingPrev: 26 },
                { role: 'mid', halfL: 12.0, halfW: 6.8, noseStyle: 'flat', hasPantograph: false, hasAc: true, windowCount: 4, spacingPrev: 25.5 },
                { role: 'lead', halfL: 13.0, halfW: 6.8, noseStyle: 'bevel', hasPantograph: true, hasAc: false, windowCount: 3, spacingPrev: 0 }
            ];
    }
}

function draw3DFerry(ctx, P, color, pulse) {
    // Animated water wake
    ctx.save();
    ctx.strokeStyle = 'rgba(224, 242, 254, 0.45)';
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.setLineDash([4, 5]);
    const [w1x, w1y] = P.proj(-15, -6, 0);
    const [w2x, w2y] = P.proj(-32, -14, 0);
    const [w3x, w3y] = P.proj(-15, 6, 0);
    const [w4x, w4y] = P.proj(-32, 14, 0);
    ctx.beginPath();
    ctx.moveTo(w1x, w1y);
    ctx.lineTo(w2x, w2y);
    ctx.moveTo(w3x, w3y);
    ctx.lineTo(w4x, w4y);
    ctx.stroke();
    ctx.restore();

    const [fx, fy] = P.proj(-21, 0, 0);
    ctx.fillStyle = 'rgba(224, 242, 254, 0.25)';
    ctx.beginPath();
    ctx.ellipse(fx, fy, 7 + pulse * 2.5, 4.5 + pulse * 1.2, P.angleRad, 0, Math.PI * 2);
    ctx.fill();

    // 3D Hull + Upper Passenger Cabin + Elevated Bridge
    draw3DBox(ctx, P, -18, 12, -8.5, 8.5, 0.4, 3.8, {
        topFill: '#f8fafc',
        sideFill: '#334155',
        endFill: '#475569',
        stroke: 'rgba(15, 23, 42, 0.4)'
    });
    // Tapered bow
    const sy = P.visSideSign * 8.5;
    traceProjectedPoly(ctx, [
        P.proj(12, sy, 0.4),
        P.proj(24, P.visSideSign * 1.2, 0.4),
        P.proj(24, P.visSideSign * 1.2, 3.8),
        P.proj(12, sy, 3.8)
    ]);
    ctx.fillStyle = '#334155';
    ctx.fill();
    traceProjectedPoly(ctx, [
        P.proj(12, -8.5, 3.8),
        P.proj(24, 0, 3.8),
        P.proj(12, 8.5, 3.8)
    ]);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    draw3DBox(ctx, P, -14, 8, -6.2, 6.2, 3.8, 7.6, {
        topFill: '#ffffff',
        sideFill: color,
        endFill: '#0f172a',
        stroke: 'rgba(15, 23, 42, 0.3)'
    });
    draw3DBox(ctx, P, -6, 4, -4.5, 4.5, 7.6, 10.6, {
        topFill: '#f1f5f9',
        sideFill: '#cbd5e1',
        endFill: '#0f172a'
    });
    draw3DHeadlightGlow(ctx, P, 23, 0, 3.4, false);
}

function draw3DPlane(ctx, P, color) {
    // Contrails at flight altitude z = 11
    ctx.save();
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.35)';
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    [-7, 7].forEach((ly) => {
        const [a, b] = P.proj(-8, ly, 11);
        const [c, d] = P.proj(-38, ly, 11);
        ctx.beginPath();
        ctx.moveTo(a, b);
        ctx.lineTo(c, d);
        ctx.stroke();
    });
    ctx.restore();

    const traceJetAtZ = (z, scale = 1) => {
        const pts = [
            [28, 0], [18, 2.8], [9, 3.0], [-4, 22], [-8, 22], [-2, 3.0],
            [-18, 2.2], [-23, 9], [-26.5, 9], [-24, 1.2], [-25, 0],
            [-24, -1.2], [-26.5, -9], [-23, -9], [-18, -2.2], [-2, -3.0],
            [-8, -22], [-4, -22], [9, -3.0], [18, -2.8]
        ].map(([x, y]) => P.proj(x * scale, y * scale, z));
        traceProjectedPoly(ctx, pts);
    };

    // Ground shadow at z = 0
    traceJetAtZ(0, 0.9);
    ctx.fillStyle = 'rgba(2, 6, 23, 0.35)';
    ctx.fill();

    // Aircraft at altitude z = 11
    traceJetAtZ(11, 1);
    ctx.fillStyle = '#f8fafc';
    ctx.fill();
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.35)';
    ctx.lineWidth = 0.9;
    ctx.stroke();

    // 3D Vertical Tailfin rising from z = 11 to z = 18
    traceProjectedPoly(ctx, [
        P.proj(-16, 0, 11),
        P.proj(-25, 0, 11),
        P.proj(-26.5, 0, 18),
        P.proj(-21, 0, 18)
    ]);
    ctx.fillStyle = color;
    ctx.fill();
}

function drawClassic2DVehicle(ctx, vehicleType, color, frame) {
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

        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(32, 0);
        ctx.lineTo(16, 3);
        ctx.lineTo(9, 25);
        ctx.lineTo(2, 25);
        ctx.lineTo(6, 3);
        ctx.lineTo(-8, 3);
        ctx.lineTo(-16, 12);
        ctx.lineTo(-22, 12);
        ctx.lineTo(-14, 0);
        ctx.lineTo(-22, -12);
        ctx.lineTo(-16, -12);
        ctx.lineTo(-8, -3);
        ctx.lineTo(6, -3);
        ctx.lineTo(2, -25);
        ctx.lineTo(9, -25);
        ctx.lineTo(16, -3);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
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
        ctx.beginPath();
        ctx.moveTo(-8, -9.5);
        ctx.lineTo(16, -9.5);
        ctx.quadraticCurveTo(32, -6.5, 33, 0);
        ctx.quadraticCurveTo(32, 6.5, 16, 9.5);
        ctx.lineTo(-8, 9.5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
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

        ctx.fillStyle = '#0f172a';
        drawRoundedRect(ctx, 13, -4.5, 10, 9, 3.5);
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

        ctx.fillStyle = '#0f172a';
        drawRoundedRect(ctx, 13, -6.2, 7.5, 12.4, 3);
        ctx.fill();
    }

    ctx.restore();
}

/**
 * Draws an articulated 3D consist (or classic 2D sprite when vehicleStyle === '2d') along `scene`.
 */
export function drawArticulatedVehicleOnRoute(ctx, {
    scene,
    progress,
    camZoom,
    vehicleScale = 1.0,
    vehicleType = 'train',
    vehicleStyle = '3d',
    color = '#ff2e55',
    frame = 0
}) {
    if (!scene?.points?.length) return;
    const worldScale = (1.08 * vehicleScale) / camZoom;
    const headPose = samplePointAlongRoute(scene, progress);
    const pulse = Math.sin(frame * 0.35) * 0.5 + 0.5;

    ctx.save();
    ctx.translate(headPose.x, headPose.y);
    ctx.scale(worldScale, worldScale);

    if (vehicleStyle === '2d') {
        ctx.rotate(headPose.angleRad || 0);
        drawClassic2DVehicle(ctx, vehicleType, color, frame);
        ctx.restore();
        return;
    }

    if (vehicleType === 'ferry') {
        const P = createCarProjector(0, 0, headPose.angleRad || 0);
        draw3DFerry(ctx, P, color, pulse);
        ctx.restore();
        return;
    }
    if (vehicleType === 'plane') {
        const P = createCarProjector(0, 0, headPose.angleRad || 0);
        draw3DPlane(ctx, P, color);
        ctx.restore();
        return;
    }

    const cars = getConsistSpec(vehicleType);
    const totalPathPx = Math.max(1, scene.totalPathPx || 1);
    let backDistLocal = 0;

    // Cars are ordered [rear ... lead]; lead is at index cars.length - 1
    const posedCars = new Array(cars.length);
    for (let i = cars.length - 1; i >= 0; i--) {
        const car = cars[i];
        const carProgress = Math.max(0, progress - (backDistLocal * worldScale) / totalPathPx);
        const pose = (i === cars.length - 1) ? headPose : samplePointAlongRoute(scene, carProgress);
        const lx = (pose.x - headPose.x) / worldScale;
        const ly = (pose.y - headPose.y) / worldScale;
        posedCars[i] = {
            car,
            idx: i,
            P: createCarProjector(lx, ly, pose.angleRad || 0)
        };
        if (i > 0) {
            backDistLocal += cars[i - 1].spacingPrev || 25;
        }
    }

    // Draw articulated bellows between adjacent cars first
    for (let i = 0; i < posedCars.length - 1; i++) {
        const rear = posedCars[i];
        const front = posedCars[i + 1];
        draw3DBellowsBridge(ctx, rear.P, rear.car.halfL - 0.5, front.P, -front.car.halfL + 0.5);
    }

    // Painter's order back-to-front by screen Y (ascending)
    const sorted = [...posedCars].sort((a, b) => a.P.cy - b.P.cy);
    sorted.forEach(({ car, P }) => {
        draw3DCar(ctx, P, { ...car, color });
    });

    ctx.restore();
}

/**
 * Renders any 3D or Classic 2D category-specific vehicle at local origin (used by tests & previews).
 */
export function drawVehicleOnCanvas(ctx, vehicleType, color, frame, angleRad = -0.22, vehicleStyle = '3d') {
    if (vehicleStyle === '2d') {
        ctx.save();
        ctx.rotate(angleRad);
        drawClassic2DVehicle(ctx, vehicleType, color, frame);
        ctx.restore();
        return;
    }
    const pulse = Math.sin(frame * 0.35) * 0.5 + 0.5;
    ctx.save();
    ctx.scale(1.12, 1.12);

    if (vehicleType === 'ferry') {
        draw3DFerry(ctx, createCarProjector(0, 0, angleRad), color, pulse);
        ctx.restore();
        return;
    }
    if (vehicleType === 'plane') {
        draw3DPlane(ctx, createCarProjector(0, 0, angleRad), color);
        ctx.restore();
        return;
    }

    const cars = getConsistSpec(vehicleType);
    const fx = Math.cos(angleRad);
    const fy = Math.sin(angleRad);
    let totalSpan = 0;
    cars.forEach((c, idx) => {
        if (idx < cars.length - 1) totalSpan += c.spacingPrev || 25;
    });

    let offset = -totalSpan / 2;
    const posedCars = cars.map((car, idx) => {
        const P = createCarProjector(offset * fx, offset * fy, angleRad);
        if (idx < cars.length - 1) offset += car.spacingPrev || 25;
        return { car, P };
    });

    for (let i = 0; i < posedCars.length - 1; i++) {
        draw3DBellowsBridge(ctx, posedCars[i].P, posedCars[i].car.halfL - 0.5, posedCars[i + 1].P, -posedCars[i + 1].car.halfL + 0.5);
    }

    const sorted = [...posedCars].sort((a, b) => a.P.cy - b.P.cy);
    sorted.forEach(({ car, P }) => {
        draw3DCar(ctx, P, { ...car, color });
    });

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
