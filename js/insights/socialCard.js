// Social card canvas generator for Rail Wrapped
import { CATEGORY_LABELS } from './analytics.js';

/**
 * Render a high-resolution 1080x1350 (4:5 portrait) shareable social card on an HTML5 canvas.
 */
export async function generateWrappedCardCanvas(insights, user = {}, year = 'All-Time') {
    const canvas = document.createElement('canvas');
    const width = 1080;
    const height = 1350;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // 1. Deep cosmic gradient background
    const bgGradient = ctx.createLinearGradient(0, 0, width, height);
    bgGradient.addColorStop(0, '#0a0d14');
    bgGradient.addColorStop(0.4, '#121726');
    bgGradient.addColorStop(0.8, '#1b122c');
    bgGradient.addColorStop(1, '#0c0714');
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, width, height);

    // 2. Ambient glowing orbs
    const drawGlow = (x, y, radius, color) => {
        const radGrad = ctx.createRadialGradient(x, y, 0, x, y, radius);
        radGrad.addColorStop(0, color);
        radGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = radGrad;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
    };

    drawGlow(width * 0.2, height * 0.15, 380, 'rgba(102, 224, 255, 0.22)');
    drawGlow(width * 0.85, height * 0.45, 420, 'rgba(124, 93, 255, 0.25)');
    drawGlow(width * 0.3, height * 0.85, 450, 'rgba(255, 107, 156, 0.2)');

    // 3. Subtle grid lines / railway track motif in background
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1.5;
    for (let y = 60; y < height; y += 60) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }

    // Helper: Rounded rectangle card
    const roundRect = (x, y, w, h, r, fillColor, strokeColor) => {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
        if (fillColor) {
            ctx.fillStyle = fillColor;
            ctx.fill();
        }
        if (strokeColor) {
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = 2;
            ctx.stroke();
        }
        ctx.restore();
    };

    // 4. Header Badge & Logo
    roundRect(80, 80, 260, 48, 24, 'rgba(255, 255, 255, 0.08)', 'rgba(255, 255, 255, 0.15)');
    ctx.font = '600 20px -apple-system, BlinkMacSystemFont, "Space Grotesk", sans-serif';
    ctx.fillStyle = '#66e0ff';
    ctx.fillText('🚂 TRÄWELLING WRAPPED', 104, 112);

    ctx.font = '700 22px -apple-system, BlinkMacSystemFont, "Space Grotesk", sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.textAlign = 'right';
    ctx.fillText(String(year).toUpperCase(), width - 80, 112);
    ctx.textAlign = 'left';

    // 5. User Title Banner
    const username = user.displayName || user.username || 'Explorer';
    const handle = user.username ? `@${user.username}` : '';
    const fontSize = username.length > 28 ? 34 : (username.length > 20 ? 40 : 52);
    ctx.font = `800 ${fontSize}px -apple-system, BlinkMacSystemFont, "Space Grotesk", sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(username, 80, 205);

    ctx.font = '500 26px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = '#a1a4ba';
    ctx.fillText(`${handle} · Year on Rails Summary`, 80, 245);

    // 6. Primary KPI Hero Cards (2x2 Grid)
    const cardW = (width - 160 - 30) / 2;
    const cardH = 200;
    const startY = 285;

    // Card 1: Total Distance
    roundRect(80, startY, cardW, cardH, 20, 'rgba(16, 20, 36, 0.75)', 'rgba(102, 224, 255, 0.25)');
    ctx.font = '600 22px sans-serif';
    ctx.fillStyle = '#66e0ff';
    ctx.fillText('TOTAL DISTANCE', 110, startY + 45);
    ctx.font = '800 54px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${insights.totalKm.toLocaleString()} km`, 110, startY + 115);
    ctx.font = '500 20px sans-serif';
    ctx.fillStyle = '#a1a4ba';
    ctx.fillText(`🌍 ${insights.earthCircumferences}× Earth circumferences`, 110, startY + 160);

    // Card 2: Total Journeys
    roundRect(80 + cardW + 30, startY, cardW, cardH, 20, 'rgba(16, 20, 36, 0.75)', 'rgba(124, 93, 255, 0.25)');
    ctx.font = '600 22px sans-serif';
    ctx.fillStyle = '#a78bfa';
    ctx.fillText('JOURNEYS RECORDED', 80 + cardW + 30 + 30, startY + 45);
    ctx.font = '800 54px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${insights.totalTrips.toLocaleString()} trips`, 80 + cardW + 30 + 30, startY + 115);
    ctx.font = '500 20px sans-serif';
    ctx.fillStyle = '#a1a4ba';
    ctx.fillText(`⏱️ ~${insights.totalDurationHours} hours on tracks`, 80 + cardW + 30 + 30, startY + 160);

    // Card 3: Punctuality
    roundRect(80, startY + cardH + 24, cardW, cardH, 20, 'rgba(16, 20, 36, 0.75)', 'rgba(46, 204, 113, 0.25)');
    ctx.font = '600 22px sans-serif';
    ctx.fillStyle = '#2ecc71';
    ctx.fillText('PUNCTUALITY RATE', 110, startY + cardH + 24 + 45);
    ctx.font = '800 54px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${insights.punctuality.rate}%`, 110, startY + cardH + 24 + 115);
    ctx.font = '500 20px sans-serif';
    ctx.fillStyle = '#a1a4ba';
    ctx.fillText(`⚠️ ${insights.punctuality.delayedCount} delays recorded`, 110, startY + cardH + 24 + 160);

    // Card 4: CO2 Saved
    roundRect(80 + cardW + 30, startY + cardH + 24, cardW, cardH, 20, 'rgba(16, 20, 36, 0.75)', 'rgba(255, 107, 156, 0.25)');
    ctx.font = '600 22px sans-serif';
    ctx.fillStyle = '#ff6b9c';
    ctx.fillText('CO₂ EMISSIONS SAVED', 80 + cardW + 30 + 30, startY + cardH + 24 + 45);
    ctx.font = '800 54px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${insights.co2SavedKg.toLocaleString()} kg`, 80 + cardW + 30 + 30, startY + cardH + 24 + 115);
    ctx.font = '500 20px sans-serif';
    ctx.fillStyle = '#a1a4ba';
    ctx.fillText(`🌱 vs equivalent car travel`, 80 + cardW + 30 + 30, startY + cardH + 24 + 160);

    // 7. Highlights Section (Clean full-width cards with smart collision avoidance)
    const listY = 740;

    const drawHighlightCard = (y, icon, label, title, badge, accentColor) => {
        const cardH = 98;
        roundRect(80, y, width - 160, cardH, 16, 'rgba(255, 255, 255, 0.04)', 'rgba(255, 255, 255, 0.08)');
        
        // Label header
        ctx.font = '700 17px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.fillStyle = accentColor;
        ctx.textAlign = 'left';
        ctx.fillText(`${icon}  ${label}`, 108, y + 33);

        // Right badge measurement
        ctx.font = '600 19px -apple-system, BlinkMacSystemFont, sans-serif';
        const badgeText = String(badge || '').trim();
        const badgeW = badgeText ? ctx.measureText(badgeText).width : 0;
        const badgeBoxW = badgeText ? Math.max(badgeW + 28, 90) : 0;
        const badgeBoxH = 34;

        if (badgeText) {
            const badgeX = width - 108 - badgeBoxW;
            const badgeY = y + 46;
            roundRect(badgeX, badgeY, badgeBoxW, badgeBoxH, 17, 'rgba(255, 255, 255, 0.08)', 'rgba(255, 255, 255, 0.15)');
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.fillText(badgeText, badgeX + badgeBoxW / 2, badgeY + 23);
        }

        // Title with smart truncation against right badge boundary
        const maxTitleW = width - 160 - 40 - (badgeBoxW > 0 ? (badgeBoxW + 20) : 0);
        ctx.font = '700 24px -apple-system, BlinkMacSystemFont, "Space Grotesk", sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'left';

        let displayTitle = String(title || 'None');
        if (ctx.measureText(displayTitle).width > maxTitleW) {
            while (displayTitle.length > 3 && ctx.measureText(displayTitle + '...').width > maxTitleW) {
                displayTitle = displayTitle.slice(0, -1);
            }
            displayTitle += '...';
        }
        ctx.fillText(displayTitle, 108, y + 72);
    };

    // Highlight 1: Top Arrival Station
    const topStationName = insights.records.topStations[0]?.name || 'None recorded';
    const topStationVisits = insights.records.topStations[0]?.visits || 0;
    drawHighlightCard(
        listY,
        '🚉',
        'TOP ARRIVAL STATION',
        topStationName,
        topStationVisits > 0 ? `${topStationVisits} arrivals` : '',
        '#66e0ff'
    );

    // Highlight 2: Favorite Line
    const favLine = insights.records.favoriteLine?.line || 'Various Lines';
    const favLineCount = insights.records.favoriteLine?.count || 0;
    drawHighlightCard(
        listY + 118,
        '🚆',
        'FAVORITE LINE',
        favLine,
        favLineCount > 0 ? `${favLineCount} check-ins` : '',
        '#a78bfa'
    );

    // Highlight 3: Longest Journey
    const longest = insights.records.longestTrip;
    const longestRoute = longest ? `${longest.origin} ➔ ${longest.destination}` : 'Not available';
    const longestDist = longest ? `${Math.round(longest.distance)} km` : '';
    drawHighlightCard(
        listY + 236,
        '🗺️',
        'LONGEST JOURNEY (EXCL. FLIGHTS)',
        longestRoute,
        longestDist,
        '#ff6b9c'
    );

    // Highlight 4: Peak Travel Habit or Top Companion
    if (insights.records.topBuddies && insights.records.topBuddies.length > 0) {
        const topBuddy = insights.records.topBuddies[0];
        drawHighlightCard(
            listY + 354,
            '👥',
            'TOP TRAVEL COMPANION',
            `@${topBuddy.username}`,
            `${topBuddy.sharedTrips} shared trips`,
            '#2ecc71'
        );
    } else {
        const busiestDay = insights.habits?.busiestDayName || 'Weekend';
        const busiestHour = insights.habits?.busiestHourLabel || '17:00';
        drawHighlightCard(
            listY + 354,
            '⏰',
            'PRIME TRANSIT HABIT',
            `${busiestDay}s around ${busiestHour}`,
            'Peak Time',
            '#ffd32a'
        );
    }

    // 8. Footer Watermark
    ctx.font = '500 18px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.textAlign = 'center';
    ctx.fillText('Generated with Träwelling Map Explorer · traewelling.de', width / 2, height - 44);

    return canvas;
}

/**
 * Trigger download of generated canvas as PNG image.
 */
export function downloadWrappedCard(canvas, filename = 'traewelling-wrapped.png') {
    if (!canvas) return;
    const a = document.createElement('a');
    a.download = filename;
    a.href = canvas.toDataURL('image/png');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

/**
 * Use Web Share API to share the canvas image directly on supported platforms.
 */
export async function shareWrappedCard(canvas, title = 'My Träwelling Wrapped', text = 'Check out my railway travel stats on Träwelling!') {
    if (!canvas) return false;

    if (navigator.share && navigator.canShare) {
        try {
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            const file = new File([blob], 'traewelling-wrapped.png', { type: 'image/png' });
            if (navigator.canShare({ files: [file] })) {
                await navigator.share({
                    title,
                    text,
                    files: [file]
                });
                return true;
            }
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.warn('Native share failed, falling back to download:', err);
            }
        }
    }

    // Fallback: download
    downloadWrappedCard(canvas);
    return false;
}
