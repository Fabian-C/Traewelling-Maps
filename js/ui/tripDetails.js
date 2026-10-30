/**
 * Shared trip details extraction and formatting component
 * Consumed by both the Map Explorer (route popups) and the Database Explorer (trip modals)
 */

import { escapeHtml, formatHumanDuration } from '../utils/format.js';
import { normalizeCategory, extractTripTags } from '../data/processing.js';
import { CATEGORY_NAMES } from '../map/layers.js';
import { getTripBuddies, renderLinkedComment } from '../trips/formatters.js';

/**
 * Normalizes all nested trip and check-in properties into a unified structure
 * @param {Object} tripOrFeature - Raw trip object or GeoJSON feature
 * @param {string} currentUsername - Active session username for filtering travel buddies
 * @returns {Object} Clean, normalized trip details
 */
export function extractTripDetails(tripOrFeature, currentUsername = '') {
    if (!tripOrFeature) return null;

    const props = tripOrFeature.properties || {};
    let train = props.train || props.checkin || tripOrFeature.train || tripOrFeature.checkin || {};
    if (typeof train === 'string') {
        try { train = JSON.parse(train); } catch (_) { train = {}; }
    }
    train = train || {};

    const rawId = props.statusId || tripOrFeature.id || props.id;
    const statusId = rawId !== undefined && rawId !== null && rawId !== 'unknown' ? String(rawId) : null;

    const lineName = train.lineName || train.number || train.name || props.lineName || 'Train';
    const rawCategory = normalizeCategory(props.category || train.category || tripOrFeature.layer?.id?.replace('-approximated', '') || 'regional');
    const categoryName = CATEGORY_NAMES[rawCategory] || rawCategory || 'Regional';

    const originData = train.origin || {};
    const destData = train.destination || {};
    const origin = originData.name || props.origin || 'Unknown';
    const dest = destData.name || props.destination || 'Unknown';

    const getDate = (val) => val ? new Date(val) : null;
    const plannedDeparture = getDate(originData.departurePlanned || train.plannedDeparture);
    const actualDeparture = getDate(originData.departureReal || originData.departure || train.departure);
    const plannedArrival = getDate(destData.arrivalPlanned || train.plannedArrival);
    const actualArrival = getDate(destData.arrivalReal || destData.arrival || train.arrival);

    const derivedDepDelay = (plannedDeparture && actualDeparture) ? Math.round((actualDeparture - plannedDeparture) / 1000) : null;
    const derivedArrDelay = (plannedArrival && actualArrival) ? Math.round((actualArrival - plannedArrival) / 1000) : null;
    const departureDelay = typeof train.departureDelay === 'number' ? train.departureDelay : (typeof originData.departureDelay === 'number' ? originData.departureDelay : derivedDepDelay);
    const arrivalDelay = typeof train.arrivalDelay === 'number' ? train.arrivalDelay : (typeof destData.arrivalDelay === 'number' ? destData.arrivalDelay : derivedArrDelay);

    const platform = originData.departurePlatformReal || originData.platform || train.platform || train.track || null;
    const destPlatform = destData.arrivalPlatformReal || destData.platform || null;

    const rawDistance = typeof train.totalDistance === 'number' ? train.totalDistance : (typeof train.distance === 'number' ? train.distance : (props.distance || 0));
    const distanceKm = Math.round((rawDistance / 1000) * 10) / 10;

    const durationMinProvided = typeof train.totalDuration === 'number' ? train.totalDuration : (typeof train.duration === 'number' ? train.duration : null);
    const durationPlannedMin = (plannedDeparture && plannedArrival) ? Math.round((plannedArrival - plannedDeparture) / 60000) : null;
    const durationActualMin = (actualDeparture && actualArrival) ? Math.round((actualArrival - actualDeparture) / 60000) : durationMinProvided;
    const durationMin = durationActualMin || durationPlannedMin || durationMinProvided;
    const durationDisplay = durationMin ? formatHumanDuration(durationMin) : '—';

    let seat = props.seat || train.seat?.number || (typeof train.seat === 'string' || typeof train.seat === 'number' ? train.seat : null) || null;
    let wagon = props.wagon || train.seat?.wagon || train.wagon || train.coach || null;
    let travelClass = props.travelClass || props.class || train.class || train.travelClass || null;
    let vehicleNumber = props.vehicleNumber || null;
    let locomotiveClass = props.locomotiveClass || null;
    let wagonClass = props.wagonClass || null;
    const coachPosition = train.coaches || null;

    let ticketName = typeof props.ticket === 'string' ? props.ticket : (props.ticket?.name || props.ticket?.title || props.ticket?.identifier || null);
    if (!ticketName && train.ticket) {
        ticketName = typeof train.ticket === 'string' ? train.ticket : (train.ticket.name || train.ticket.title || null);
    }

    const operator = train.operator?.name || train.operator?.identifier || train.provider?.name || train.provider || '—';
    const isApproximated = Boolean(props.isApproximated || tripOrFeature.layer?.id?.endsWith('-approximated'));

    // Extract tags
    const parsedTags = extractTripTags(props).concat(extractTripTags({ tags: train.tags })).concat(extractTripTags(tripOrFeature));
    const customTags = [];
    const seenTagKeys = new Set();

    parsedTags.forEach(t => {
        const k = (t.key || '').toLowerCase();
        const v = String(t.value || '').trim();
        if (!v && !k) return;

        if (k === 'trwl:wagon' || k === 'wagon') {
            if (!wagon) wagon = v;
        } else if (k === 'trwl:seat' || k === 'seat') {
            if (!seat) seat = v;
        } else if (k === 'trwl:ticket' || k === 'ticket') {
            if (!ticketName) ticketName = v;
        } else if (k === 'trwl:travel_class' || k === 'travel_class') {
            if (!travelClass) travelClass = v;
        } else if (k === 'trwl:vehicle_number' || k === 'vehicle_number') {
            if (!vehicleNumber) vehicleNumber = v;
        } else if (k === 'trwl:locomotive_class' || k === 'locomotive_class') {
            if (!locomotiveClass) locomotiveClass = v;
        } else if (k === 'trwl:wagon_class' || k === 'wagon_class') {
            if (!wagonClass) wagonClass = v;
        } else {
            const cleanKey = t.key.replace(/^trwl:/, '');
            const dedupeKey = `${cleanKey}:${v}`.toLowerCase();
            if (!seenTagKeys.has(dedupeKey)) {
                seenTagKeys.add(dedupeKey);
                customTags.push({ key: cleanKey, value: v });
            }
        }
    });

    const buddies = getTripBuddies(tripOrFeature, currentUsername);
    const bodyText = (props.body || tripOrFeature.body || '').trim();

    return {
        statusId,
        lineName,
        category: rawCategory,
        categoryName,
        origin,
        destination: dest,
        plannedDeparture,
        actualDeparture,
        plannedArrival,
        actualArrival,
        departureDelay,
        arrivalDelay,
        platform,
        destPlatform,
        distanceKm,
        durationDisplay,
        durationMin,
        seat,
        wagon,
        travelClass,
        vehicleNumber,
        locomotiveClass,
        wagonClass,
        coachPosition,
        ticketName,
        operator,
        isApproximated,
        customTags,
        buddies,
        bodyText
    };
}

/**
 * Helper to format delays into readable strings
 */
export function formatDelayBadge(delaySeconds) {
    if (delaySeconds === null || delaySeconds === undefined) return '—';
    if (delaySeconds === 0) return 'On time';
    const minutes = Math.round(delaySeconds / 60);
    return `${minutes > 0 ? '+' : ''}${minutes} min`;
}

/**
 * Format date objects to time HH:mm
 */
export function formatTimeShort(dateObj) {
    return dateObj ? dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
}

/**
 * Format date objects to date string
 */
export function formatDateShort(dateObj) {
    return dateObj ? dateObj.toLocaleDateString() : '';
}

/**
 * Render shared tags HTML badge group
 */
export function renderTagsBadgesHTML(customTags) {
    if (!customTags || !customTags.length) return '';
    return customTags.map(t => {
        const k = escapeHtml(t.key);
        const v = escapeHtml(t.value);
        if (!v || v.toLowerCase() === k.toLowerCase()) {
            return `<span class="popup-tag-badge">#${k}</span>`;
        }
        return `<span class="popup-tag-badge"><strong>${k}:</strong> ${v}</span>`;
    }).join(' ');
}

/**
 * Render travel buddies HTML badges
 */
export function renderBuddiesBadgesHTML(buddies) {
    if (!buddies || !buddies.length) return '';
    return buddies.map(b => 
        `<a href="https://traewelling.de/profile/${encodeURIComponent(b.username)}" target="_blank" rel="noopener noreferrer" class="mention-link" title="Open @${escapeHtml(b.username)} on Träwelling">@${escapeHtml(b.username)}</a>`
    ).join(' ');
}

/**
 * Render seat, ticket, and train unit details HTML block
 */
export function renderSeatAndVehicleDetailsHTML(details) {
    const hasInfo = Boolean(
        details.seat ||
        details.wagon ||
        details.travelClass ||
        details.coachPosition ||
        details.ticketName ||
        details.vehicleNumber ||
        details.locomotiveClass ||
        details.wagonClass
    );
    if (!hasInfo) return '';

    return `
        <details>
            <summary class="popup-expander-summary">
                <span class="popup-summary-title">Seat, ticket & coach info</span>
                <span class="popup-toggle-arrow">▾</span>
            </summary>
            <div class="popup-body">
                <dl>
                    ${details.ticketName ? `<dt>Ticket</dt><dd>${escapeHtml(details.ticketName)}</dd>` : ''}
                    <dt>Seat</dt><dd>${escapeHtml(String(details.seat || '—'))}</dd>
                    <dt>Coach / Wagon</dt><dd>${escapeHtml(String(details.wagon || '—'))}</dd>
                    <dt>Class</dt><dd>${escapeHtml(String(details.travelClass || '—'))}</dd>
                    ${details.vehicleNumber ? `<dt>Vehicle / Unit</dt><dd>${escapeHtml(details.vehicleNumber)}</dd>` : ''}
                    ${details.locomotiveClass ? `<dt>Locomotive</dt><dd>${escapeHtml(details.locomotiveClass)}</dd>` : ''}
                    ${details.wagonClass ? `<dt>Wagon type</dt><dd>${escapeHtml(details.wagonClass)}</dd>` : ''}
                    <dt>Coach position</dt><dd>${escapeHtml(String(details.coachPosition || '—'))}</dd>
                </dl>
            </div>
        </details>
    `;
}

/**
 * Render schedule & delays details HTML block
 */
export function renderScheduleDetailsHTML(details) {
    const { departureDelay, arrivalDelay, plannedDeparture, actualDeparture, plannedArrival, actualArrival } = details;
    return `
        <details class="popup-timing-details">
            <summary class="popup-expander-summary">
                <span class="popup-summary-title">⏱️ Schedule & Delays</span>
                <span class="popup-delay-summary-pill">
                    ${departureDelay !== null ? `<span class="delay-tag ${departureDelay > 0 ? 'delay-late' : (departureDelay < 0 ? 'delay-early' : 'delay-ok')}">Dep ${formatDelayBadge(departureDelay)}</span>` : ''}
                    ${arrivalDelay !== null ? `<span class="delay-tag ${arrivalDelay > 0 ? 'delay-late' : (arrivalDelay < 0 ? 'delay-early' : 'delay-ok')}">Arr ${formatDelayBadge(arrivalDelay)}</span>` : ''}
                </span>
            </summary>
            <div class="popup-body">
                <div class="popup-sched-table">
                    <div class="sched-row sched-header">
                        <span>Event</span>
                        <span>Plan</span>
                        <span>Actual</span>
                        <span>Delay</span>
                    </div>
                    <div class="sched-row">
                        <span class="sched-label">Departure</span>
                        <span class="sched-time plan">${formatTimeShort(plannedDeparture)}</span>
                        <span class="sched-time real">${formatTimeShort(actualDeparture)}</span>
                        <span class="sched-delay ${departureDelay > 0 ? 'late' : (departureDelay < 0 ? 'early' : 'ok')}">${formatDelayBadge(departureDelay)}</span>
                    </div>
                    <div class="sched-row">
                        <span class="sched-label">Arrival</span>
                        <span class="sched-time plan">${formatTimeShort(plannedArrival)}</span>
                        <span class="sched-time real">${formatTimeShort(actualArrival)}</span>
                        <span class="sched-delay ${arrivalDelay > 0 ? 'late' : (arrivalDelay < 0 ? 'early' : 'ok')}">${formatDelayBadge(arrivalDelay)}</span>
                    </div>
                </div>
            </div>
        </details>
    `;
}
