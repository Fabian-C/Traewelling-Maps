// @ts-check
import { SessionDB } from '../cache/session.js';
import { TraewellingAPI } from '../api/traewelling.js';
import { Storage, STORAGE_KEYS } from '../storage/storage.js';
import { getTripBuddies, renderLinkedComment } from './formatters.js';
import { formatSpeed, escapeHtml } from '../utils/format.js';
import { extractTripDetails, formatTimeShort } from '../ui/tripDetails.js';

/**
 * Open Trip Detail Inspector Modal
 * @param {any} trip
 * @param {Object} ctx
 * @param {() => any} ctx.getActiveSession
 * @param {() => Array<any>} ctx.getAllTrips
 * @param {(trips: Array<any>) => void} ctx.populateBuddyDropdown
 * @param {() => void} ctx.applyFiltersAndRender
 * @param {() => void} ctx.updateScanButtonState
 * @param {() => void} [ctx.invalidateCaches]
 */
export function openTripDetailModal(trip, ctx) {
    const modal = /** @type {HTMLDialogElement | null} */ (document.getElementById('tripDetailModal'));
    if (!modal || !trip) return;

    const activeSession = ctx.getActiveSession();
    const details = extractTripDetails(trip, activeSession?.username);
    if (!details) return;

    const {
        statusId,
        backendTripId,
        category,
        lineName,
        origin,
        destination: dest,
        operator,
        plannedDeparture,
        actualDeparture,
        plannedArrival,
        actualArrival,
        platform: originPlatform,
        destPlatform,
        distanceKm,
        durationMin,
        durationDisplay: durStr,
        arrivalDelay,
        seat,
        wagon,
        ticketName: ticket,
        buddies,
        bodyText
    } = details;

    const originPlanned = formatTimeShort(plannedDeparture);
    const originReal = actualDeparture ? formatTimeShort(actualDeparture) : originPlanned;
    const destPlanned = formatTimeShort(plannedArrival);
    const destReal = actualArrival ? formatTimeShort(actualArrival) : destPlanned;

    const distKm = Math.round(distanceKm);
    const speedStr = formatSpeed(distKm, durationMin);

    const arrDelaySec = (arrivalDelay !== null && arrivalDelay !== undefined) ? arrivalDelay : 0;
    const arrDelayMin = Math.round(arrDelaySec / 60);
    const delayFormatted = arrDelayMin > 0 ? `+${arrDelayMin} min late` : (arrDelayMin < 0 ? `${Math.abs(arrDelayMin)} min early` : 'Punctual (On-time)');

    // Store active modal trip for devtools & export actions
    /** @type {any} */ (window).currentModalTrip = trip;

    const setText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };

    const badgeEl = document.getElementById('modalLineBadge');
    if (badgeEl) {
        badgeEl.textContent = lineName;
        badgeEl.className = `line-badge ${category}`;
    }
    setText('modalTripTitle', `${origin} → ${dest}`);

    setText('modalOrigin', origin);
    setText('modalDepartureTime', `Sched: ${originPlanned} · Actual: ${originReal}`);
    setText('modalOriginPlatform', `Platform ${originPlatform || '—'}`);

    setText('modalDest', dest);
    setText('modalArrivalTime', `Sched: ${destPlanned} · Actual: ${destReal}`);
    setText('modalDestPlatform', `Platform ${destPlatform || '—'}`);

    setText('modalDistance', `${distKm} km${speedStr !== '—' ? ` (Avg: ${speedStr})` : ''}`);
    setText('modalDuration', durStr);
    setText('modalDelay', delayFormatted);
    setText('modalOperator', operator);
    setText('modalSeat', `Wagon ${wagon || '—'}, Seat ${seat || '—'}`);
    setText('modalTicket', String(ticket || '—'));

    // Buddies & Travel Companions (Unified)
    const buddiesSec = document.getElementById('modalBuddiesSection');
    const buddiesList = document.getElementById('modalBuddiesList');
    const enrichBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('modalEnrichCoPassengersBtn'));

    const renderBuddies = (buddiesListArray) => {
        if (!buddiesList) return;
        if (buddiesListArray && buddiesListArray.length > 0) {
            buddiesList.innerHTML = buddiesListArray.map(b => {
                const fromTo = (b.origin && b.destination) ? ` · ${escapeHtml(b.origin)} → ${escapeHtml(b.destination)}` : '';
                const msg = b.body ? `<div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">💬 ${escapeHtml(b.body)}</div>` : '';
                if (fromTo || msg) {
                    return `
                        <div style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 6px 10px; width: 100%;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div style="display: flex; align-items: center; gap: 6px;">
                                    <a href="https://traewelling.de/@${encodeURIComponent(b.username)}" target="_blank" rel="noopener noreferrer" class="buddy-badge-link" style="padding: 2px 6px; font-size: 12px; font-weight: 600;">
                                        <span class="buddy-badge-icon"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align: middle;"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg></span>
                                        <span>@${escapeHtml(b.username)}</span>
                                    </a>
                                    ${b.status_id ? `
                                        <a href="https://traewelling.de/status/${encodeURIComponent(b.status_id)}" target="_blank" rel="noopener noreferrer" class="buddy-badge-link" style="padding: 2px 6px; font-size: 11px; opacity: 0.85;" title="Open check-in #${escapeHtml(String(b.status_id))} on Träwelling">
                                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                                            <span>#${escapeHtml(String(b.status_id))}</span>
                                        </a>
                                    ` : ''}
                                </div>
                                ${fromTo ? `<span style="font-size: 11px; color: var(--text-muted);">${fromTo}</span>` : ''}
                            </div>
                            ${msg}
                        </div>
                    `;
                }
                return `
                    <span style="display: inline-flex; align-items: center; gap: 4px;">
                        <a href="https://traewelling.de/@${encodeURIComponent(b.username)}" target="_blank" rel="noopener noreferrer" class="buddy-badge-link" style="padding: 4px 10px; font-size: 12px;" title="Open @${escapeHtml(b.username)} profile on Träwelling">
                            <span class="buddy-badge-icon"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align: middle;"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg></span>
                            <span>@${escapeHtml(b.username)}</span>
                        </a>
                        ${b.status_id ? `
                            <a href="https://traewelling.de/status/${encodeURIComponent(b.status_id)}" target="_blank" rel="noopener noreferrer" class="buddy-badge-link" style="padding: 4px 6px; font-size: 11px; opacity: 0.85;" title="Open check-in #${escapeHtml(String(b.status_id))} on Träwelling">
                                #${escapeHtml(String(b.status_id))}
                            </a>
                        ` : ''}
                    </span>
                `;
            }).join('');
        } else {
            buddiesList.innerHTML = `<span style="color: var(--text-muted); font-size: 12px; font-style: italic;">No buddies recorded yet.</span>`;
        }
    };

    const hasBuddies = buddies && buddies.length > 0;
    if (buddiesSec) {
        const canEnrich = backendTripId || statusId;
        if (hasBuddies || canEnrich) {
            buddiesSec.style.display = 'block';
            renderBuddies(buddies);
        } else {
            buddiesSec.style.display = 'none';
        }

        if (enrichBtn) {
            if (canEnrich) {
                enrichBtn.style.display = 'inline-flex';
                enrichBtn.disabled = false;
                if (trip.co_passengers && trip.co_passengers.length > 0) {
                    const withUser = getTripBuddies(trip, activeSession?.username);
                    enrichBtn.innerHTML = withUser.length > 0
                        ? `<span>Enriched (${withUser.length})</span>`
                        : `<span>Enriched (0 on your segment)</span>`;
                } else {
                    enrichBtn.innerHTML = `
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
                        <span>Enrich from Träwelling</span>
                    `;
                }

                // Check IndexedDB cache if not loaded yet on trip
                if (!trip.co_passengers && backendTripId) {
                    SessionDB.getTripCoPassengers(backendTripId).then(cached => {
                        if (cached !== null && Array.isArray(cached)) {
                            const currentU = (ctx.getActiveSession()?.username || '').toLowerCase();
                            const filtered = cached.filter(p => (p.username || '').toLowerCase() !== currentU);
                            trip.co_passengers = filtered;
                            if (filtered.length > 0) {
                                const updated = getTripBuddies(trip, ctx.getActiveSession()?.username);
                                renderBuddies(updated);
                                enrichBtn.innerHTML = updated.length > 0
                                    ? `<span>Enriched (${updated.length})</span>`
                                    : `<span>Enriched (0 on your segment)</span>`;
                            }
                        }
                    }).catch(() => {});
                }

                enrichBtn.onclick = async () => {
                    enrichBtn.disabled = true;
                    enrichBtn.textContent = 'Fetching...';
                    try {
                        const api = new TraewellingAPI(Storage.get(STORAGE_KEYS.TOKEN));
                        let effectiveBackendId = backendTripId;
                        if (!effectiveBackendId && statusId) {
                            const statusResp = await api.getStatus(statusId);
                            const resolved = statusResp?.data?.train?.trip || statusResp?.data?.checkin?.trip || statusResp?.data?.trip;
                            if (resolved) {
                                effectiveBackendId = Number(resolved);
                                trip.backend_trip_id = effectiveBackendId;
                                if (trip.train) trip.train.trip = effectiveBackendId;
                                if (trip.checkin) trip.checkin.trip = effectiveBackendId;
                            }
                        }

                        if (!effectiveBackendId) {
                            enrichBtn.innerHTML = `<span>⚠️ No upstream trip</span>`;
                            enrichBtn.disabled = false;
                            return;
                        }

                        const resp = await api.getTripStatuses(effectiveBackendId);
                        const rawStatuses = resp?.data || [];
                        const currentU = (ctx.getActiveSession()?.username || '').toLowerCase();
                        const companions = rawStatuses
                            .filter(s => (s.user?.username || '').toLowerCase() !== currentU)
                            .map(s => ({
                                trip_id: Number(effectiveBackendId),
                                status_id: s.id,
                                co_status_id: s.id,
                                username: s.user?.username || 'unknown',
                                display_name: s.user?.name || s.user?.username || '',
                                origin: s.checkin?.origin?.name || 'Unknown',
                                destination: s.checkin?.destination?.name || 'Unknown',
                                departure_time: s.checkin?.origin?.departureReal || s.checkin?.origin?.departurePlanned || null,
                                arrival_time: s.checkin?.destination?.arrivalReal || s.checkin?.destination?.arrivalPlanned || null,
                                body: s.body || '',
                                created_at: s.createdAt || null
                            }));

                        await SessionDB.saveTripCoPassengers(effectiveBackendId, companions);
                        trip.co_passengers = companions;
                        if (ctx.invalidateCaches) ctx.invalidateCaches();
                        const updated = getTripBuddies(trip, ctx.getActiveSession()?.username);
                        renderBuddies(updated);
                        const withUser = updated.length;
                        enrichBtn.innerHTML = withUser > 0
                            ? `<span>Updated (${withUser})</span>`
                            : `<span>Updated (0 on your segment)</span>`;
                        enrichBtn.disabled = false;

                        ctx.populateBuddyDropdown(ctx.getAllTrips());
                        ctx.applyFiltersAndRender();
                        ctx.updateScanButtonState();
                    } catch (err) {
                        console.warn('Enrichment failed:', err);
                        enrichBtn.innerHTML = `<span>⚠️ Failed</span>`;
                        enrichBtn.disabled = false;
                    }
                };
            } else {
                enrichBtn.style.display = 'none';
            }
        }
    }

    // Notes
    const notesSec = document.getElementById('modalNotesSection');
    const notesText = document.getElementById('modalNotesText');
    if (notesSec && notesText) {
        if (bodyText) {
            notesSec.style.display = 'block';
            notesText.innerHTML = renderLinkedComment(bodyText);
        } else {
            notesSec.style.display = 'none';
        }
    }

    const tripId = statusId || trip.id;
    const tripRef = trip.uuid || tripId;
    const traewellingLink = /** @type {HTMLAnchorElement | null} */ (document.getElementById('modalTraewellingLink'));
    if (traewellingLink) {
        traewellingLink.href = `https://traewelling.de/status/${encodeURIComponent(tripRef)}`;
    }

    const animLink = /** @type {HTMLAnchorElement | null} */ (document.getElementById('modalAnimLink'));
    if (animLink) {
        animLink.href = `animation.html?trip=${tripId}&user=${encodeURIComponent(activeSession?.username || '')}`;
    }

    const mapLink = /** @type {HTMLAnchorElement | null} */ (document.getElementById('modalMapLink'));
    if (mapLink) {
        mapLink.href = `index.html?user=${encodeURIComponent(activeSession?.username || '')}&trip=${tripId}`;
    }

    modal.showModal();
}
