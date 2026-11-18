/**
 * Unified HUD & Watermark Overlay Renderer for Trip Clip Studio
 * Shared across Single Trip and All Trips modes, responsive across 1:1, 9:16, and 16:9.
 */

import { drawRoundedRect } from './sprites.js';

/**
 * Draws the subtle edge vignette and optional top gradient scrim under the HUD bar.
 */
export function drawVignetteAndScrim(ctx, width, height, showHud = true, showVignette = true) {
    if (showVignette !== false && typeof ctx.createRadialGradient === 'function') {
        const vig = ctx.createRadialGradient(width / 2, height / 2, width * 0.34, width / 2, height / 2, width * 0.70);
        vig.addColorStop(0, 'rgba(0, 0, 0, 0)');
        vig.addColorStop(1, 'rgba(4, 7, 15, 0.38)');
        ctx.fillStyle = vig;
        ctx.fillRect(0, 0, width, height);
    }

    if (showHud && typeof ctx.createLinearGradient === 'function') {
        const topScrim = ctx.createLinearGradient(0, 0, 0, 126);
        topScrim.addColorStop(0, 'rgba(7, 10, 18, 0.55)');
        topScrim.addColorStop(1, 'rgba(7, 10, 18, 0)');
        ctx.fillStyle = topScrim;
        ctx.fillRect(0, 0, width, 126);
    }
}

/**
 * Unified Top HUD Header Bar (Line Badge + Route Card & Live Metrics Card).
 * Adapts spacing and typography cleanly for 720px (9:16), 960px (1:1), and 1280px (16:9).
 */
export function drawTopHudBar(ctx, {
    width,
    lineName,
    lineColor,
    badgeBgColor = null,
    badgeTextColor,
    routeTitle,
    subTitle,
    leftMetricLabel,
    leftMetricValue,
    rightMetricLabel,
    rightMetricValue,
    isAllMode = false
}) {
    const isNarrow = width < 820;
    const pad = isNarrow ? 16 : 22;
    const headerH = isNarrow ? 74 : 84;
    const gap = isNarrow ? 10 : 14;
    const rightCardW = isNarrow ? 228 : (isAllMode ? 304 : 294);
    const leftCardW = Math.max(200, width - pad * 2 - rightCardW - gap);

    // Left Card: Transit Line Badge + Route & User Metadata
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 20;
    ctx.fillStyle = 'rgba(10, 14, 24, 0.90)';
    drawRoundedRect(ctx, pad, pad, leftCardW, headerH, isNarrow ? 16 : 20);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const badgeFontPx = isNarrow ? 20 : 24;
    ctx.font = `800 ${badgeFontPx}px Inter, -apple-system, BlinkMacSystemFont, sans-serif`;
    const badgeTextW = ctx.measureText(lineName).width;
    const badgeW = Math.max(isNarrow ? 64 : 76, Math.min(isNarrow ? 124 : 164, badgeTextW + (isNarrow ? 24 : 30)));
    const badgeH = isNarrow ? 44 : 50;
    const badgeX = pad + (isNarrow ? 12 : 16);
    const badgeY = pad + (headerH - badgeH) / 2;

    ctx.fillStyle = badgeBgColor || lineColor;
    drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, isNarrow ? 10 : 12);
    ctx.fill();

    ctx.fillStyle = badgeTextColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(lineName, badgeX + badgeW / 2, badgeY + badgeH / 2 + 1, badgeW - 12);

    const textStartX = badgeX + badgeW + (isNarrow ? 12 : 16);
    const maxTextW = Math.max(60, leftCardW - (textStartX - pad) - (isNarrow ? 12 : 16));

    ctx.fillStyle = '#f8fafc';
    const titleFontPx = isNarrow ? 20 : (isAllMode ? 23 : 24);
    ctx.font = `800 ${titleFontPx}px Inter, -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(routeTitle, textStartX, pad + (isNarrow ? 13 : 14), maxTextW);

    ctx.fillStyle = '#94a3b8';
    const subFontPx = isNarrow ? 14 : (isAllMode ? 16 : 17);
    ctx.font = `600 ${subFontPx}px Inter, -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.fillText(subTitle, textStartX, pad + (isNarrow ? 42 : 48), maxTextW);
    ctx.restore();

    // Right Card: Live Distance + Duration / Ride Count
    const rightCardX = width - pad - rightCardW;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 20;
    ctx.fillStyle = 'rgba(10, 14, 24, 0.90)';
    drawRoundedRect(ctx, rightCardX, pad, rightCardW, headerH, isNarrow ? 16 : 20);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const labelFontPx = isNarrow ? 11 : 13;
    const valFontPx = isNarrow ? 19 : (isAllMode ? 24 : 25);
    const col1X = rightCardX + (isNarrow ? 14 : 18);
    const dividerOffset = isNarrow ? 124 : (isAllMode ? 180 : 160);
    const col2X = rightCardX + dividerOffset + (isNarrow ? 12 : 14);
    const col1MaxW = dividerOffset - (isNarrow ? 22 : 28);
    const col2MaxW = rightCardW - dividerOffset - (isNarrow ? 20 : 24);

    ctx.fillStyle = '#94a3b8';
    ctx.font = `700 ${labelFontPx}px Inter, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(leftMetricLabel, col1X, pad + (isNarrow ? 12 : 14));

    ctx.fillStyle = '#38bdf8';
    ctx.font = `800 ${valFontPx}px "JetBrains Mono", monospace`;
    ctx.fillText(leftMetricValue, col1X, pad + (isNarrow ? 33 : 35), col1MaxW);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.fillRect(rightCardX + dividerOffset, pad + 16, 1.5, headerH - 32);

    ctx.fillStyle = '#94a3b8';
    ctx.font = `700 ${labelFontPx}px Inter, sans-serif`;
    ctx.fillText(rightMetricLabel, col2X, pad + (isNarrow ? 12 : 14));

    ctx.fillStyle = '#4ade80';
    ctx.font = `800 ${valFontPx}px "JetBrains Mono", monospace`;
    ctx.fillText(rightMetricValue, col2X, pad + (isNarrow ? 33 : 35), col2MaxW);
    ctx.restore();
}

/**
 * Corner Watermark Pill
 */
export function drawWatermarkPill(ctx, width, height) {
    const pad = width < 820 ? 16 : 22;
    ctx.save();
    const wmText = 'Generated on fabian-c.github.io/Traewelling-Maps';
    ctx.font = '600 14px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
    const wmTextW = ctx.measureText(wmText).width;
    const wmW = wmTextW + 22;
    const wmH = 26;
    const wmX = Math.max(pad, width - pad - 44 - wmW);
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
}
