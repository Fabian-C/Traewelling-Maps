/**
 * Trip Clip Animation Studio Controller (KISS & Unified Architecture)
 * Orchestrates session loading, timeframe filtering, spatial precomputation,
 * live ClipSettings customization, native micro-player, and video/PNG export.
 */

import { SessionDB } from '../cache/session.js';
import { Storage, STORAGE_KEYS } from '../storage/storage.js';
import { TraewellingAPI } from '../api/traewelling.js';
import { normalizeTripStatus, filterStopoversBetweenTraveledStations } from '../data/processing.js';
import { syncNavigationLinks } from '../ui/navigation.js';
import { computeTripDurationMinutes, deriveDelaySeconds } from '../utils/time.js';
import { escapeHtml, formatHumanDuration } from '../utils/format.js';
import { extractIntermediateStopovers } from './sprites.js';
import {
    MAP_STYLES,
    preloadTripTiles,
    preloadSceneTiles
} from './tiles.js';
import {
    filterTripsByTimeframe,
    getTripTimestamp,
    getTimeframeLabel,
    TIMEFRAME_PRESETS
} from './timeframe.js';
import {
    buildFastTripPrecompute,
    buildFastAllTripsPrecompute,
    computeAllModeTiming
} from './precompute.js';
import { NativeTripPlayer } from './player.js';
import { VideoClipExporterV2 } from './exporter.js';
import { setAnimationTileLabelScale } from './geometry.js';
import { createDefaultClipSettings, resolveAspectDimensions } from './schema.js';

const FPS = 30;

const DEMO_FIXTURE_TRIPS = [
    {
        id: 9245926,
        body: 'Trip clip demo ride',
        createdAt: '2026-10-05T15:32:00+00:00',
        user: { username: 'Traveler', displayName: 'Explorer' },
        checkin: {
            category: 'nationalExpress',
            number: 'ICE 720',
            lineName: 'ICE 720',
            routeColor: 'ff2e55',
            distance: 284500,
            duration: 230,
            origin: {
                id: 8011160,
                name: 'Berlin Hbf',
                latitude: 52.5255,
                longitude: 13.3695,
                platform: '1',
                departurePlanned: '2026-10-05T15:32:00+00:00',
                departureReal: '2026-10-05T15:34:00+00:00'
            },
            destination: {
                id: 8000261,
                name: 'München Hbf',
                latitude: 48.1402,
                longitude: 11.5583,
                platform: '19',
                arrivalPlanned: '2026-10-05T19:22:00+00:00',
                arrivalReal: '2026-10-05T19:26:00+00:00'
            },
            stopovers: [
                {
                    station: { id: 8011160, name: 'Berlin Hbf', latitude: 52.5255, longitude: 13.3695 },
                    departurePlanned: '2026-10-05T15:32:00+00:00',
                    departureReal: '2026-10-05T15:34:00+00:00'
                },
                {
                    station: { id: 8011113, name: 'Berlin Südkreuz', latitude: 52.4754, longitude: 13.3653 },
                    arrivalPlanned: '2026-10-05T15:37:00+00:00',
                    arrivalReal: '2026-10-05T15:39:00+00:00',
                    departurePlanned: '2026-10-05T15:39:00+00:00',
                    departureReal: '2026-10-05T15:41:00+00:00'
                },
                {
                    station: { id: 8010159, name: 'Halle (Saale) Hbf', latitude: 51.4775, longitude: 11.9875 },
                    arrivalPlanned: '2026-10-05T16:33:00+00:00',
                    arrivalReal: '2026-10-05T16:35:00+00:00',
                    departurePlanned: '2026-10-05T16:35:00+00:00',
                    departureReal: '2026-10-05T16:37:00+00:00'
                },
                {
                    station: { id: 8010101, name: 'Erfurt Hbf', latitude: 50.9722, longitude: 11.0385 },
                    arrivalPlanned: '2026-10-05T17:05:00+00:00',
                    arrivalReal: '2026-10-05T17:08:00+00:00',
                    departurePlanned: '2026-10-05T17:08:00+00:00',
                    departureReal: '2026-10-05T17:10:00+00:00'
                },
                {
                    station: { id: 8000284, name: 'Nürnberg Hbf', latitude: 49.4456, longitude: 11.0829 },
                    arrivalPlanned: '2026-10-05T18:18:00+00:00',
                    arrivalReal: '2026-10-05T18:21:00+00:00',
                    departurePlanned: '2026-10-05T18:20:00+00:00',
                    departureReal: '2026-10-05T18:23:00+00:00'
                },
                {
                    station: { id: 8000261, name: 'München Hbf', latitude: 48.1402, longitude: 11.5583 },
                    arrivalPlanned: '2026-10-05T19:22:00+00:00',
                    arrivalReal: '2026-10-05T19:26:00+00:00'
                }
            ],
            polyline: [
                [13.3695, 52.5255],
                [13.3653, 52.4754],
                [11.9875, 51.4775],
                [11.0385, 50.9722],
                [11.0829, 49.4456],
                [11.5583, 48.1402]
            ]
        }
    }
];

let currentUser = '';
let currentTripId = '';
let currentTrip = null;
let currentMode = 'single';
let currentMapStyle = 'traewelling-dark';
let currentTimeframe = 'all';
let customTimeframeFrom = '';
let customTimeframeTo = '';
let customTimeframeFromTime = '';
let customTimeframeToTime = '';
const clipSettings = createDefaultClipSettings();
let userTrips = [];
let externalTrip = null;
let allSessions = [];
let player = null;
let activeExporter = null;

function getActiveTrips() {
    let refDate = new Date();
    if (currentTimeframe === 'last-7-days' && userTrips.length > 0) {
        const timestamps = userTrips.map(t => getTripTimestamp(t)).filter(ts => ts > 0);
        if (timestamps.length > 0) {
            const latestTime = Math.max(...timestamps);
            if ((Date.now() - latestTime) > 30 * 24 * 60 * 60 * 1000) {
                refDate = new Date(latestTime);
            }
        }
    }
    return filterTripsByTimeframe(
        userTrips,
        currentTimeframe,
        customTimeframeFrom,
        customTimeframeTo,
        refDate,
        customTimeframeFromTime,
        customTimeframeToTime
    );
}

function getActiveDurationInFrames() {
    const activeTrips = getActiveTrips();
    const scale = (clipSettings.clipDurationSec || 8) / 8;
    if (currentMode === 'all' && activeTrips.length > 0) {
        return Math.max(FPS * 3, Math.round(computeAllModeTiming(activeTrips, FPS).totalFrames * scale));
    }
    return Math.max(FPS * 3, Math.round((clipSettings.clipDurationSec || 8) * FPS));
}

function buildActivePrecompute(activeTrips) {
    const dims = resolveAspectDimensions(clipSettings.aspectRatio);
    if (currentMode === 'all') {
        return buildFastAllTripsPrecompute(activeTrips, dims.width, dims.height, FPS);
    }
    if (currentTrip) {
        return buildFastTripPrecompute(currentTrip, dims.width, dims.height);
    }
    return null;
}

function preloadTilesForCurrentState(precompute) {
    const dims = resolveAspectDimensions(clipSettings.aspectRatio);
    const styleConfig = MAP_STYLES[currentMapStyle] || MAP_STYLES['traewelling-dark'];
    if (styleConfig.isVector) return;
    if (currentMode === 'all' && precompute?.allScene) {
        preloadSceneTiles(precompute.allScene, currentMapStyle);
    } else if (currentTrip) {
        preloadTripTiles(currentTrip, currentMapStyle, dims.width, dims.height);
    }
}

async function init() {
    const urlParams = new URLSearchParams(window.location.search);
    currentUser = (urlParams.get('user') || '').toLowerCase().trim();
    currentTripId = urlParams.get('id') || urlParams.get('trip') || urlParams.get('statusId') || '';
    const modeParam = (urlParams.get('mode') || '').toLowerCase().trim();
    if (modeParam === 'all' || currentTripId.toLowerCase() === 'all') {
        currentMode = 'all';
        if (currentTripId.toLowerCase() === 'all') currentTripId = '';
    }

    const tfParam = (urlParams.get('timeframe') || '').toLowerCase().trim();
    if (TIMEFRAME_PRESETS.some(p => p.id === tfParam)) {
        currentTimeframe = tfParam;
    } else if (currentMode === 'all') {
        currentTimeframe = 'last-7-days';
    }
    customTimeframeFrom = urlParams.get('from') || '';
    customTimeframeTo = urlParams.get('to') || '';
    customTimeframeFromTime = urlParams.get('fromTime') || urlParams.get('startTime') || '';
    customTimeframeToTime = urlParams.get('toTime') || urlParams.get('endTime') || '';

    if (customTimeframeFrom || customTimeframeTo || customTimeframeFromTime || customTimeframeToTime) {
        currentTimeframe = 'custom';
    }

    const mapParam = urlParams.get('map') || urlParams.get('mapStyle') || urlParams.get('style');
    if (mapParam && MAP_STYLES[mapParam]) {
        currentMapStyle = mapParam;
    }

    setAnimationTileLabelScale(clipSettings.tileScale);
    syncNavigationLinks(currentUser);

    try {
        allSessions = await SessionDB.getAll();
    } catch (e) {
        console.warn('SessionDB retrieval fallback:', e);
        allSessions = [];
    }

    if (!currentUser && !currentTripId && allSessions.length > 0) {
        currentUser = allSessions[0].username || '';
    }

    renderUserSelect();
    setupControls();
    syncToolbarPills();
    syncCustomizerControls();

    if (currentUser || currentTripId) {
        await loadUserTrips(currentUser, currentTripId);
    } else {
        userTrips = DEMO_FIXTURE_TRIPS;
    }

    renderTripSelect();
    renderUserSelect();
    renderPlayer();
}

function renderUserSelect() {
    const userSelect = document.getElementById('userSelect');
    if (!userSelect) return;
    userSelect.replaceChildren();

    const isViewingExternal = Boolean(externalTrip && currentTrip && String(externalTrip.id) === String(currentTrip.id));
    const extOwner = (externalTrip?.user?.username || '').toLowerCase();
    const extDisplayName = externalTrip?.user?.displayName || externalTrip?.user?.username || 'Shared User';

    const usersMap = new Map();

    allSessions.forEach(sess => {
        const u = sess.username.toLowerCase();
        usersMap.set(u, {
            value: u,
            label: `${sess.displayName || sess.username} (@${sess.username})`
        });
    });

    if (extOwner && !usersMap.has(extOwner)) {
        usersMap.set(extOwner, {
            value: extOwner,
            label: `${extDisplayName} (@${extOwner}) (Shared)`
        });
    }

    if (currentUser && !usersMap.has(currentUser.toLowerCase())) {
        usersMap.set(currentUser.toLowerCase(), {
            value: currentUser.toLowerCase(),
            label: `@${currentUser} (Shared)`
        });
    }

    if (usersMap.size === 0) {
        const fallbackUser = isViewingExternal ? extOwner : (currentUser || 'demo');
        const opt = document.createElement('option');
        opt.value = fallbackUser;
        opt.textContent = isViewingExternal ? `@${fallbackUser} (Shared)` : `@${fallbackUser}`;
        userSelect.appendChild(opt);
        return;
    }

    const activeSelectedUser = isViewingExternal ? extOwner : (currentUser || '').toLowerCase();
    let matchedSelected = false;

    usersMap.forEach((u) => {
        const opt = document.createElement('option');
        opt.value = u.value;
        opt.textContent = u.label;
        if (u.value === activeSelectedUser) {
            opt.selected = true;
            matchedSelected = true;
        }
        userSelect.appendChild(opt);
    });

    if (!matchedSelected && userSelect.options.length > 0) {
        userSelect.options[0].selected = true;
    }
}

async function attachPolylinesToTrips(api, trips, maxFetchCount = 20) {
    if (!trips || !trips.length) return;

    try {
        const polylineStore = (typeof SessionDB.getAllPolylines === 'function') ? await SessionDB.getAllPolylines() : {};
        trips.forEach(t => {
            const checkin = t.checkin || t.train;
            if (checkin && !checkin.polyline && polylineStore && polylineStore[t.id]) {
                checkin.polyline = polylineStore[t.id];
            }
        });
    } catch {}

    const missing = trips.filter(t => {
        const c = t.checkin || t.train || {};
        return !c.polyline;
    }).slice(0, maxFetchCount);

    if (missing.length === 0) return;

    const ids = missing.map(t => t.id).filter(Boolean);
    const batchSize = 15;
    for (let i = 0; i < ids.length; i += batchSize) {
        const batch = ids.slice(i, i + batchSize);
        try {
            const polyData = await api.getPolylines(batch);
            const features = polyData?.data?.features || [];
            const polyMap = new Map();
            features.forEach(f => {
                const sid = f?.properties?.statusId ?? f?.properties?.id;
                if (sid) polyMap.set(String(sid), f);
            });
            trips.forEach(t => {
                const c = t.checkin || t.train;
                if (c && polyMap.has(String(t.id))) {
                    c.polyline = polyMap.get(String(t.id));
                }
            });
        } catch (e) {
            console.warn('Polylines batch fetch error:', e);
            break;
        }
    }
}

async function attachStopoversToTrips(api, trips, maxFetchCount = 15) {
    if (!Array.isArray(trips) || !trips.length) return;

    const candidates = trips.filter(t => {
        const c = t?.checkin || t?.train || {};
        return !Array.isArray(c.stopovers) || c.stopovers.length === 0;
    });
    if (!candidates.length) return;

    const cachedIds = new Set();
    try {
        if (typeof SessionDB.getStopoversBatch === 'function') {
            const ids = candidates.map(t => t.id).filter(Boolean);
            const cachedMap = await SessionDB.getStopoversBatch(ids);
            candidates.forEach(t => {
                const cachedStops = cachedMap?.[t.id];
                if (Array.isArray(cachedStops)) {
                    cachedIds.add(String(t.id));
                    const c = t.checkin || t.train;
                    const filtered = filterStopoversBetweenTraveledStations(cachedStops, c?.origin, c?.destination);
                    if (c) c.stopovers = filtered;
                    if (t.train && t.train !== c) t.train.stopovers = filtered;
                    t.stopovers = filtered;
                }
            });
        }
    } catch {}

    const missing = candidates
        .filter(t => !cachedIds.has(String(t.id)))
        .slice(0, maxFetchCount);
    if (!missing.length || !api || typeof api.getStopovers !== 'function') return;

    const batchSize = 15;
    const newlyFetched = {};
    for (let i = 0; i < missing.length; i += batchSize) {
        const batch = missing.slice(i, i + batchSize);
        const queryIds = batch.map(t => {
            const c = t.checkin || t.train || {};
            return c.trip || c.tripId || t.backend_trip_id || t.id;
        }).filter(Boolean);
        if (!queryIds.length) continue;

        try {
            const stopRes = await api.getStopovers(queryIds);
            const data = stopRes?.data;
            if (!data) continue;

            batch.forEach(t => {
                const c = t.checkin || t.train || {};
                const tripRunId = c.trip || c.tripId || t.backend_trip_id;
                let rawStops = null;
                if (tripRunId && Array.isArray(data[tripRunId])) {
                    rawStops = data[tripRunId];
                } else if (Array.isArray(data[t.id])) {
                    rawStops = data[t.id];
                } else if (batch.length === 1 && Array.isArray(data)) {
                    rawStops = data;
                }
                if (Array.isArray(rawStops)) {
                    const filtered = filterStopoversBetweenTraveledStations(rawStops, c.origin, c.destination);
                    c.stopovers = filtered;
                    if (t.train && t.train !== c) t.train.stopovers = filtered;
                    t.stopovers = filtered;
                    if (t.id) newlyFetched[t.id] = filtered;
                }
            });
        } catch (e) {
            console.warn('Stopovers batch fetch error:', e);
            break;
        }
    }

    if (Object.keys(newlyFetched).length > 0 && typeof SessionDB.saveStopoversBatch === 'function') {
        SessionDB.saveStopoversBatch(newlyFetched).catch(() => {});
    }
}

function showTripMissingNotice(targetTripId, username) {
    let notice = document.getElementById('tripNoticeBanner');
    if (!notice) {
        notice = document.createElement('div');
        notice.id = 'tripNoticeBanner';
        notice.className = 'anim-notice-banner';
        notice.style.cssText = 'position: fixed; top: 68px; left: 50%; transform: translateX(-50%); background: rgba(15, 23, 42, 0.94); border: 1px solid rgba(245, 158, 11, 0.5); border-radius: 8px; color: #f8fafc; padding: 10px 18px; font-size: 12px; z-index: 10000; box-shadow: 0 10px 30px rgba(0,0,0,0.6); display: flex; align-items: center; gap: 10px; max-width: 90vw; animation: fadeIn 0.25s ease-out;';
        document.body.appendChild(notice);
    }
    notice.innerHTML = `<span style="font-size: 16px;">⚠️</span> <span>Trip <strong>#${escapeHtml(targetTripId)}</strong> is private, deleted, or unavailable on Träwelling. Replaying latest journey for <strong>@${escapeHtml(username || 'Traveler')}</strong>.</span> <button type="button" style="background: transparent; border: none; color: #94a3b8; font-size: 14px; cursor: pointer; padding: 2px 6px;" onclick="this.parentElement.remove()">✕</button>`;
    setTimeout(() => {
        if (notice && notice.parentElement) notice.remove();
    }, 6500);
}

async function loadUserTrips(username, targetTripId = '') {
    const token = Storage.get(STORAGE_KEYS.TOKEN);
    const api = new TraewellingAPI(token);

    if (username) {
        try {
            const session = await SessionDB.get(username);
            if (session && Array.isArray(session.trips) && session.trips.length > 0) {
                userTrips = session.trips.map(normalizeTripStatus);
            }
        } catch (e) {
            console.warn('SessionDB lookup error:', e);
        }
    }

    if (targetTripId && !userTrips.some(t => String(t.id) === String(targetTripId))) {
        try {
            const singleRes = await api.getStatus(targetTripId);
            if (singleRes?.data) {
                const fetchedTrip = normalizeTripStatus(singleRes.data);
                try {
                    const polyRes = await api.getPolyline(targetTripId);
                    const polyData = polyRes?.data;
                    const feature = polyData?.features?.[0] || polyData;
                    if (feature) {
                        const checkin = fetchedTrip.checkin || fetchedTrip.train || {};
                        checkin.polyline = feature;
                        if (fetchedTrip.train) fetchedTrip.train.polyline = feature;
                        fetchedTrip.polyline = feature;
                        SessionDB.savePolylinesBatch({ [targetTripId]: feature }).catch(() => {});
                    }
                } catch (pe) {
                    console.warn('Polyline fetch warning for status', targetTripId, pe);
                }

                await attachStopoversToTrips(api, [fetchedTrip], 1);

                const tripOwner = (fetchedTrip.user?.username || '').toLowerCase().trim();
                const activeLower = (username || '').toLowerCase().trim();
                const isOwnTrip = tripOwner && activeLower && tripOwner === activeLower;

                if (isOwnTrip || !username) {
                    userTrips.unshift(fetchedTrip);
                    externalTrip = null;
                    if (!currentUser && tripOwner) {
                        currentUser = tripOwner;
                        renderUserSelect();
                    }
                } else {
                    externalTrip = fetchedTrip;
                }
            }
        } catch (se) {
            console.warn('Direct status fetch failed for ID', targetTripId, se);
        }
    }

    if (userTrips.length <= 1 && username && username !== 'demo') {
        try {
            const apiRes = await api.getUserStatuses(username);
            const rawTrips = apiRes?.data || [];
            if (rawTrips.length > 0) {
                const fetchedList = rawTrips.map(normalizeTripStatus);
                fetchedList.forEach(ft => {
                    if (!userTrips.some(t => String(t.id) === String(ft.id))) {
                        userTrips.push(ft);
                    }
                });
                await attachPolylinesToTrips(api, userTrips, currentMode === 'all' ? 50 : 15);
                SessionDB.save(username, userTrips).catch(() => {});
            }
        } catch (ue) {
            console.warn('Live user statuses API fetch error:', ue);
        }
    }

    const activeMissing = userTrips.filter(t => {
        const c = t.checkin || t.train || {};
        return !c.polyline;
    }).slice(0, 10);
    if (activeMissing.length > 0) {
        await attachPolylinesToTrips(api, activeMissing, 10);
    }

    if (targetTripId) {
        const targetTrip = (externalTrip && String(externalTrip.id) === String(targetTripId))
            ? externalTrip
            : userTrips.find(t => String(t.id) === String(targetTripId));
        if (targetTrip) {
            const checkin = targetTrip.checkin || targetTrip.train || {};
            if (!checkin.polyline) {
                try {
                    const polyRes = await api.getPolyline(targetTripId);
                    const polyData = polyRes?.data;
                    const feature = polyData?.features?.[0] || polyData;
                    if (feature) {
                        checkin.polyline = feature;
                        if (targetTrip.train) targetTrip.train.polyline = feature;
                        targetTrip.polyline = feature;
                        SessionDB.savePolylinesBatch({ [targetTripId]: feature }).catch(() => {});
                    }
                } catch (pe) {
                    console.warn('Direct polyline fetch warning for target trip', targetTripId, pe);
                }
            }
            await attachStopoversToTrips(api, [targetTrip], 1);
        }
    }

    if (userTrips.length > 0 && username && username !== 'demo') {
        await attachStopoversToTrips(api, userTrips, currentMode === 'all' ? 20 : 12);
    }

    const activeUser = currentUser;
    if (activeUser && activeUser !== 'demo' && userTrips.length > 0) {
        SessionDB.save(activeUser, userTrips).catch(() => {});
    }

    if (!userTrips.length && !externalTrip) {
        userTrips = DEMO_FIXTURE_TRIPS;
    }

    const targetFound = (externalTrip && String(externalTrip.id) === String(targetTripId)) ||
        userTrips.some(t => String(t.id) === String(targetTripId));
    if (targetTripId && !targetFound) {
        showTripMissingNotice(targetTripId, username);
    }
}

const TRIP_SELECT_INITIAL_LIMIT = 250;
let tripSelectExpanded = false;
const shortDateFormatter = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' });

function formatTripOptionDate(isoStr) {
    if (!isoStr) return '';
    const ms = Date.parse(isoStr);
    return Number.isFinite(ms) ? shortDateFormatter.format(ms) : '';
}

function renderTripSelect() {
    const tripSelect = document.getElementById('tripSelect');
    if (!tripSelect) return;

    const frag = document.createDocumentFragment();

    const allOpt = document.createElement('option');
    allOpt.value = 'all';
    allOpt.textContent = `★ All ${userTrips.length} Rides (Replay)`;
    if (currentMode === 'all') allOpt.selected = true;
    frag.appendChild(allOpt);

    let matchedSelected = false;

    if (externalTrip) {
        const checkin = externalTrip.checkin || externalTrip.train || {};
        const line = checkin.lineName || checkin.number || 'Trip';
        const origin = checkin.origin?.name || checkin.origin?.station?.name || externalTrip.origin || 'Origin';
        const dest = checkin.destination?.name || checkin.destination?.station?.name || externalTrip.destination || 'Destination';
        const dateStr = formatTripOptionDate(externalTrip.createdAt);
        const owner = externalTrip.user?.username ? `@${externalTrip.user.username}` : 'Shared';

        const opt = document.createElement('option');
        opt.value = String(externalTrip.id);
        opt.textContent = `★ ${line}: ${origin} → ${dest} (${owner} • ${dateStr})`;
        if (currentMode !== 'all' && String(externalTrip.id) === String(currentTripId)) {
            opt.selected = true;
            matchedSelected = true;
            currentTrip = externalTrip;
        }
        frag.appendChild(opt);
    }

    const limit = tripSelectExpanded ? userTrips.length : Math.min(userTrips.length, TRIP_SELECT_INITIAL_LIMIT);
    const appendTripOption = (trip) => {
        const checkin = trip.checkin || trip.train || {};
        const line = checkin.lineName || checkin.number || 'Trip';
        const origin = checkin.origin?.name || checkin.origin?.station?.name || trip.origin || 'Origin';
        const dest = checkin.destination?.name || checkin.destination?.station?.name || trip.destination || 'Destination';
        const dateStr = formatTripOptionDate(trip.createdAt);

        const opt = document.createElement('option');
        opt.value = String(trip.id);
        opt.textContent = `${line}: ${origin} → ${dest} (${dateStr})`;
        if (currentMode !== 'all' && String(trip.id) === String(currentTripId)) {
            opt.selected = true;
            matchedSelected = true;
            currentTrip = trip;
        }
        frag.appendChild(opt);
    };

    for (let i = 0; i < limit; i++) {
        appendTripOption(userTrips[i]);
    }

    // Ensure deep-linked older trip beyond initial cap is still present and selected
    if (!matchedSelected && currentMode !== 'all' && currentTripId && limit < userTrips.length) {
        const olderMatch = userTrips.find((t, idx) => idx >= limit && String(t.id) === String(currentTripId));
        if (olderMatch) {
            appendTripOption(olderMatch);
        }
    }

    if (limit < userTrips.length) {
        const moreOpt = document.createElement('option');
        moreOpt.value = '__load_all_trips__';
        moreOpt.textContent = `Load all ${userTrips.length.toLocaleString()} rides…`;
        frag.appendChild(moreOpt);
    }

    tripSelect.replaceChildren(frag);

    if (currentMode !== 'all') {
        if (!matchedSelected) {
            if (externalTrip && (!currentTripId || String(externalTrip.id) === String(currentTripId))) {
                currentTrip = externalTrip;
                currentTripId = String(externalTrip.id);
                matchedSelected = true;
            } else {
                currentTrip = userTrips.find(t => String(t.id) === String(currentTripId)) || externalTrip || userTrips[0];
                currentTripId = String(currentTrip?.id || '');
            }
        }
        if (!matchedSelected && tripSelect.options.length > 1) {
            tripSelect.options[1].selected = true;
            if (externalTrip) {
                currentTrip = externalTrip;
                currentTripId = String(externalTrip.id);
            } else if (userTrips[0]) {
                currentTrip = userTrips[0];
                currentTripId = String(userTrips[0].id);
            }
        }
    } else {
        currentTrip = null;
        allOpt.selected = true;
    }

    renderSidebarDetails();
}

function formatEndpointTimestamp(realVal, plannedVal, platform = '') {
    const primaryRaw = realVal || plannedVal;
    if (!primaryRaw) return '—';
    const primaryDate = new Date(primaryRaw);
    if (Number.isNaN(primaryDate.getTime())) return '—';

    const dateStr = primaryDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const timeStr = primaryDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    let out = `${dateStr}, ${timeStr}`;

    if (plannedVal && realVal) {
        const plannedDate = new Date(plannedVal);
        if (!Number.isNaN(plannedDate.getTime()) && Math.abs(primaryDate.getTime() - plannedDate.getTime()) >= 60000) {
            const planStr = plannedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
            out += ` (plan ${planStr})`;
        }
    }
    if (platform) {
        out += ` • Pl. ${platform}`;
    }
    return out;
}

function renderSidebarDetails() {
    const activeTrips = getActiveTrips();
    const isAllMode = currentMode === 'all';

    const lineEl = document.getElementById('sidebarLine');
    const distEl = document.getElementById('sidebarDistance');
    const routeEl = document.getElementById('sidebarRoute');
    const startedEl = document.getElementById('sidebarStarted');
    const endedEl = document.getElementById('sidebarEnded');
    const delayEl = document.getElementById('sidebarDelay');
    const durationEl = document.getElementById('sidebarDuration');
    const stopoversEl = document.getElementById('sidebarStopovers');
    const noteEl = document.getElementById('sidebarNote');

    if (isAllMode) {
        const totalKm = activeTrips.reduce((acc, t) => {
            const raw = t.checkin?.distance || t.train?.totalDistance || t.distance || 0;
            return acc + (raw > 1000 ? raw / 1000 : raw);
        }, 0);

        const tfLabel = getTimeframeLabel(currentTimeframe, customTimeframeFrom, customTimeframeTo, customTimeframeFromTime, customTimeframeToTime);

        const depTimes = activeTrips.map(t => {
            const c = t.checkin || t.train || {};
            const raw = c.origin?.departureReal || c.origin?.departurePlanned || c.origin?.departure || t.createdAt;
            return raw ? Date.parse(raw) : NaN;
        }).filter(Number.isFinite);
        const arrTimes = activeTrips.map(t => {
            const c = t.checkin || t.train || {};
            const raw = c.destination?.arrivalReal || c.destination?.arrivalPlanned || c.destination?.arrival || c.origin?.departureReal || t.createdAt;
            return raw ? Date.parse(raw) : NaN;
        }).filter(Number.isFinite);
        const totalIntermediateStops = activeTrips.reduce((sum, t) => sum + extractIntermediateStopovers(t).length, 0);

        if (lineEl) lineEl.textContent = `${activeTrips.length} rides`;
        if (distEl) distEl.textContent = `${Math.round(totalKm).toLocaleString()} km total`;
        if (routeEl) routeEl.textContent = `Network replay (${tfLabel})`;
        if (startedEl) startedEl.textContent = depTimes.length ? formatEndpointTimestamp(new Date(Math.min(...depTimes)).toISOString()) : '—';
        if (endedEl) endedEl.textContent = arrTimes.length ? formatEndpointTimestamp(new Date(Math.max(...arrTimes)).toISOString()) : '—';
        if (delayEl) delayEl.textContent = 'All modes & lines';
        if (durationEl) durationEl.textContent = `${Math.round(getActiveDurationInFrames() / FPS)}s video`;
        if (stopoversEl) stopoversEl.textContent = totalIntermediateStops > 0 ? `${totalIntermediateStops} intermediate stops across rides` : '—';
        if (noteEl) noteEl.textContent = `Chronological animated journey map of @${currentUser || 'user'}'s recorded rides.`;
        return;
    }

    if (!currentTrip) {
        if (lineEl) lineEl.textContent = '—';
        if (distEl) distEl.textContent = '—';
        if (routeEl) routeEl.textContent = '—';
        if (startedEl) startedEl.textContent = '—';
        if (endedEl) endedEl.textContent = '—';
        if (delayEl) delayEl.textContent = '—';
        if (durationEl) durationEl.textContent = '—';
        if (stopoversEl) stopoversEl.textContent = '—';
        if (noteEl) noteEl.textContent = '—';
        return;
    }

    const checkin = currentTrip.checkin || currentTrip.train || {};
    const line = checkin.lineName || checkin.number || 'Train';
    const origin = checkin.origin?.name || checkin.origin?.station?.name || currentTrip.origin || 'Origin';
    const dest = checkin.destination?.name || checkin.destination?.station?.name || currentTrip.destination || 'Destination';
    const distMeters = checkin.distance || checkin.totalDistance || currentTrip.distance || 0;
    const distKm = distMeters > 0 ? (distMeters / 1000).toFixed(1) : '—';
    const durationMins = computeTripDurationMinutes(checkin) || checkin.duration;
    const delays = deriveDelaySeconds(checkin);

    const depReal = checkin.origin?.departureReal || checkin.origin?.departure || checkin.departure || currentTrip.createdAt;
    const depPlan = checkin.origin?.departurePlanned || checkin.plannedDeparture;
    const depPlatform = checkin.origin?.departurePlatformReal || checkin.origin?.platform || '';
    const arrReal = checkin.destination?.arrivalReal || checkin.destination?.arrival || checkin.arrival;
    const arrPlan = checkin.destination?.arrivalPlanned || checkin.plannedArrival;
    const arrPlatform = checkin.destination?.arrivalPlatformReal || checkin.destination?.platform || '';
    const intermediateStops = extractIntermediateStopovers(currentTrip);

    if (lineEl) lineEl.textContent = line;
    if (distEl) distEl.textContent = distKm !== '—' ? `${distKm} km` : '—';
    if (routeEl) routeEl.textContent = `${origin} → ${dest}`;
    if (startedEl) startedEl.textContent = formatEndpointTimestamp(depReal, depPlan, depPlatform);
    if (endedEl) endedEl.textContent = formatEndpointTimestamp(arrReal, arrPlan, arrPlatform);
    if (delayEl) {
        const depD = typeof delays.departure === 'number' ? Math.round(delays.departure / 60) : 0;
        const arrD = typeof delays.arrival === 'number' ? Math.round(delays.arrival / 60) : 0;
        delayEl.textContent = (depD || arrD) ? `+${depD}m / +${arrD}m` : 'On time';
    }
    if (durationEl) durationEl.textContent = durationMins ? formatHumanDuration(durationMins) : '—';
    if (stopoversEl) {
        if (intermediateStops.length > 0) {
            const summary = intermediateStops
                .map(s => (s.timeShort ? `${s.shortName} (${s.timeShort})` : s.shortName))
                .join(' → ');
            stopoversEl.textContent = `${intermediateStops.length} stop${intermediateStops.length === 1 ? '' : 's'}: ${summary}`;
        } else {
            stopoversEl.textContent = 'Nonstop / no intermediate stops';
        }
    }
    if (noteEl) {
        const isExternal = externalTrip && currentTrip && String(externalTrip.id) === String(currentTrip.id);
        const tripOwner = currentTrip.user?.username;
        const baseNote = currentTrip.body || currentTrip.message || '';
        if (isExternal && tripOwner) {
            noteEl.textContent = baseNote ? `Shared by @${tripOwner} — "${baseNote}"` : `Shared ride by @${tripOwner}`;
        } else {
            noteEl.textContent = baseNote || '—';
        }
    }
}

function syncPlayerHostAspectClass() {
    const container = document.getElementById('playerContainer');
    if (!container) return;
    container.classList.remove('ratio-square', 'ratio-vertical', 'ratio-landscape');
    if (clipSettings.aspectRatio === '9:16') {
        container.classList.add('ratio-vertical');
    } else if (clipSettings.aspectRatio === '16:9') {
        container.classList.add('ratio-landscape');
    } else {
        container.classList.add('ratio-square');
    }
}

function renderPlayer() {
    const container = document.getElementById('playerContainer');
    if (!container) return;

    syncPlayerHostAspectClass();

    const activeTrips = getActiveTrips();
    const isAllMode = currentMode === 'all';

    if (isAllMode && activeTrips.length === 0) {
        container.innerHTML = `
            <div class="anim-empty-state">
                <div class="anim-empty-state-title">No rides in timeframe</div>
                <div class="anim-empty-state-desc">
                    There are no recorded journeys matching <strong>${escapeHtml(getTimeframeLabel(currentTimeframe, customTimeframeFrom, customTimeframeTo, customTimeframeFromTime, customTimeframeToTime))}</strong>.
                </div>
            </div>
        `;
        return;
    }

    const totalFrames = getActiveDurationInFrames();
    const dims = resolveAspectDimensions(clipSettings.aspectRatio);
    const precompute = buildActivePrecompute(activeTrips);
    preloadTilesForCurrentState(precompute);

    if (!player) {
        player = new NativeTripPlayer(container, {
            width: dims.width,
            height: dims.height,
            fps: FPS,
            totalFrames,
            settings: clipSettings
        });
        window.playerRef = player;
        window.__nativePlayer = player;
    }

    const displayUser = (currentMode === 'single' && currentTrip?.user?.username)
        ? currentTrip.user.username
        : (currentUser || 'Traveler');

    player.load({
        trip: currentTrip,
        trips: activeTrips,
        mode: currentMode,
        username: displayUser,
        mapStyle: currentMapStyle,
        totalFrames,
        fps: FPS,
        precompute,
        settings: clipSettings,
        autoPlay: true
    });
}

function syncToolbarPills() {
    document.querySelectorAll('.map-style-pill').forEach(btn => {
        const style = btn.dataset.style;
        const isActive = style === currentMapStyle;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', String(isActive));
    });

    const tfSelect = document.getElementById('timeframeSelect');
    if (tfSelect) tfSelect.value = currentTimeframe;

    const customDateContainer = document.getElementById('customDateContainer');
    if (customDateContainer) {
        customDateContainer.style.display = currentTimeframe === 'custom' ? 'inline-flex' : 'none';
    }

    const fromInput = document.getElementById('timeframeFrom');
    if (fromInput) fromInput.value = customTimeframeFrom;
    const toInput = document.getElementById('timeframeTo');
    if (toInput) toInput.value = customTimeframeTo;
    const fromTimeInput = document.getElementById('timeframeFromTime');
    if (fromTimeInput) fromTimeInput.value = customTimeframeFromTime;
    const toTimeInput = document.getElementById('timeframeToTime');
    if (toTimeInput) toTimeInput.value = customTimeframeToTime;

    const timeframeGroup = document.getElementById('timeframeGroup');
    if (timeframeGroup) {
        timeframeGroup.style.display = currentMode === 'all' ? 'flex' : 'none';
    }
}

function syncNumericPillGroup(selector, datasetKey, currentVal, fallbackStr) {
    document.querySelectorAll(selector).forEach(btn => {
        const val = parseFloat(btn.dataset[datasetKey] || fallbackStr);
        const isActive = Math.abs(val - currentVal) < 0.05;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', String(isActive));
    });
}

function syncCustomizerControls() {
    document.querySelectorAll('.aspect-ratio-pill').forEach(btn => {
        const isActive = btn.dataset.aspect === clipSettings.aspectRatio;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', String(isActive));
    });

    document.querySelectorAll('.camera-mode-pill').forEach(btn => {
        const isActive = btn.dataset.camera === clipSettings.cameraMode;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', String(isActive));
    });

    document.querySelectorAll('.vehicle-style-pill').forEach(btn => {
        const isActive = btn.dataset.vehicleStyle === clipSettings.vehicleStyle;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', String(isActive));
    });

    syncNumericPillGroup('.clip-duration-pill', 'duration', clipSettings.clipDurationSec, '8');
    syncNumericPillGroup('.tile-scale-pill', 'tileScale', clipSettings.tileScale, '2');
    syncNumericPillGroup('.route-width-pill', 'routeWidth', clipSettings.routeWidthScale, '1');
    syncNumericPillGroup('.vehicle-scale-pill', 'vehicleScale', clipSettings.vehicleScale, '1');

    const checkboxBindings = [
        ['toggleHudInput', 'showHud'],
        ['toggleScheduleTimesInput', 'showScheduleTimes'],
        ['toggleStationPillsInput', 'showStationPills'],
        ['toggleStopDotsInput', 'showStopDots'],
        ['toggleStopNamesInput', 'showStopNames'],
        ['toggleVignetteInput', 'showVignette'],
        ['toggleWatermarkInput', 'showWatermark']
    ];
    checkboxBindings.forEach(([id, key]) => {
        const el = /** @type {HTMLInputElement|null} */ (document.getElementById(id));
        if (el) el.checked = Boolean(clipSettings[key]);
    });

    const exportSpecEl = document.getElementById('exportResolutionSummary');
    if (exportSpecEl) {
        const dims = resolveAspectDimensions(clipSettings.aspectRatio);
        exportSpecEl.textContent = `${dims.width} × ${dims.height} px • ${FPS} FPS • ${clipSettings.clipDurationSec}s • ${clipSettings.aspectRatio}`;
    }
}

function buildClipFilename(ext = 'mp4') {
    const activeTrips = getActiveTrips();
    const checkin = currentTrip?.checkin || currentTrip?.train || {};
    const cleanLine = (checkin.lineName || checkin.number || 'trip').replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
    const tfPart = currentTimeframe === 'all' ? 'all' : currentTimeframe.replace(/[^a-zA-Z0-9_-]/g, '-');
    const exportUser = (currentMode === 'single' && currentTrip?.user?.username)
        ? currentTrip.user.username
        : (currentUser || 'clip');
    return currentMode === 'all'
        ? `traewelling-${currentUser || 'clip'}-${tfPart}-${activeTrips.length}-rides.${ext}`
        : `traewelling-${exportUser}-${cleanLine}-${currentTrip?.id || 'video'}.${ext}`;
}

async function triggerVideoDownload() {
    const activeTrips = getActiveTrips();
    if ((!currentTrip && currentMode !== 'all') || (currentMode === 'all' && activeTrips.length === 0)) return null;

    const downloadBtn = document.getElementById('downloadVideoBtn');
    const cancelBtn = document.getElementById('cancelRecordBtn');
    const progressWrap = document.getElementById('recordProgressWrap');
    const progressBar = document.getElementById('recordProgressBar');
    const statusText = document.getElementById('recordStatusText');

    const filename = buildClipFilename('mp4');
    const dims = resolveAspectDimensions(clipSettings.aspectRatio);

    try {
        if (downloadBtn) {
            downloadBtn.disabled = true;
            downloadBtn.textContent = 'Rendering video…';
        }
        if (cancelBtn) cancelBtn.classList.remove('hidden');
        if (progressWrap) progressWrap.classList.remove('hidden');
        if (progressBar) progressBar.style.width = '2%';

        const totalFrames = getActiveDurationInFrames();
        const precompute = buildActivePrecompute(activeTrips);

        const exporter = new VideoClipExporterV2();
        activeExporter = exporter;

        const result = await exporter.exportAndDownload({
            trip: currentTrip,
            mode: currentMode,
            username: (currentMode === 'single' && currentTrip?.user?.username) ? currentTrip.user.username : (currentUser || 'Traveler'),
            mapStyle: currentMapStyle,
            width: dims.width,
            height: dims.height,
            fps: FPS,
            totalFrames,
            precompute,
            settings: clipSettings,
            filename,
            onProgress: (pct, msg) => {
                if (progressBar) progressBar.style.width = `${pct}%`;
                if (statusText && msg) statusText.textContent = msg;
            }
        });

        if (statusText) statusText.textContent = `Saved ${result.filename} (${Math.round(result.blob.size / 1024)} KB)`;
        if (downloadBtn) {
            downloadBtn.disabled = false;
            downloadBtn.textContent = 'Download .mp4';
        }
        if (cancelBtn) cancelBtn.classList.add('hidden');
        activeExporter = null;
        return result;
    } catch (e) {
        console.error('Video export error:', e);
        if (statusText) statusText.textContent = e.message.includes('cancelled') ? 'Export cancelled' : `Error: ${e.message}`;
        if (downloadBtn) {
            downloadBtn.disabled = false;
            downloadBtn.textContent = 'Download .mp4';
        }
        if (cancelBtn) cancelBtn.classList.add('hidden');
        activeExporter = null;
        return null;
    }
}

function setupInspectorTabs() {
    const tabBtns = document.querySelectorAll('.inspector-tab-btn');
    const panels = {
        details: document.getElementById('panelDetails'),
        customize: document.getElementById('panelCustomize'),
        export: document.getElementById('panelExport')
    };

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.tab || 'details';
            tabBtns.forEach(b => {
                const active = b.dataset.tab === target;
                b.classList.toggle('active', active);
                b.setAttribute('aria-selected', String(active));
            });
            Object.entries(panels).forEach(([key, panel]) => {
                if (panel) panel.classList.toggle('hidden', key !== target);
            });
        });
    });
}

function setupControls() {
    setupInspectorTabs();

    const userSelect = document.getElementById('userSelect');
    if (userSelect) {
        userSelect.addEventListener('change', async (e) => {
            const selectedVal = (e.target.value || '').trim();
            const extOwner = (externalTrip?.user?.username || '').toLowerCase();

            if (externalTrip && selectedVal.toLowerCase() === extOwner) {
                currentMode = 'single';
                currentTrip = externalTrip;
                currentTripId = String(externalTrip.id);
                renderTripSelect();
                renderUserSelect();
                updateUrlParams();
                renderPlayer();
                return;
            }

            currentUser = selectedVal.toLowerCase();
            tripSelectExpanded = false;
            currentTripId = '';
            currentTrip = null;
            await loadUserTrips(currentUser);
            renderTripSelect();
            renderUserSelect();
            updateUrlParams();
            syncNavigationLinks(currentUser);
            renderPlayer();
        });
    }

    const tripSelect = document.getElementById('tripSelect');
    if (tripSelect) {
        tripSelect.addEventListener('change', (e) => {
            const val = e.target.value;
            if (val === '__load_all_trips__') {
                tripSelectExpanded = true;
                renderTripSelect();
                return;
            }
            if (val === 'all') {
                currentMode = 'all';
                currentTrip = null;
                currentTripId = '';
                if (currentTimeframe === 'all' || !currentTimeframe) {
                    currentTimeframe = 'last-7-days';
                }
            } else {
                currentMode = 'single';
                currentTripId = val;
                if (externalTrip && String(externalTrip.id) === String(val)) {
                    currentTrip = externalTrip;
                } else {
                    currentTrip = userTrips.find(t => String(t.id) === String(val)) || null;
                }
            }
            renderUserSelect();
            syncToolbarPills();
            renderSidebarDetails();
            updateUrlParams();
            renderPlayer();

            if (currentMode === 'single' && currentTrip) {
                const selectedTrip = currentTrip;
                const c = selectedTrip.checkin || selectedTrip.train || {};
                if (!Array.isArray(c.stopovers) || c.stopovers.length === 0) {
                    const token = Storage.get(STORAGE_KEYS.TOKEN);
                    const api = new TraewellingAPI(token);
                    attachStopoversToTrips(api, [selectedTrip], 1).then(() => {
                        if (currentMode === 'single' && currentTrip && String(currentTrip.id) === String(selectedTrip.id)) {
                            renderSidebarDetails();
                            if (player) player.updateSettings({});
                        }
                    }).catch(() => {});
                }
            }
        });
    }

    const timeframeSelect = document.getElementById('timeframeSelect');
    if (timeframeSelect) {
        timeframeSelect.addEventListener('change', (e) => {
            currentTimeframe = e.target.value;
            syncToolbarPills();
            renderSidebarDetails();
            updateUrlParams();
            renderPlayer();
        });
    }

    const bindCustomDate = (id, setter) => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', (e) => {
                setter(e.target.value);
                currentTimeframe = 'custom';
                syncToolbarPills();
                renderSidebarDetails();
                updateUrlParams();
                renderPlayer();
            });
        }
    };

    bindCustomDate('timeframeFrom', (v) => { customTimeframeFrom = v; });
    bindCustomDate('timeframeTo', (v) => { customTimeframeTo = v; });
    bindCustomDate('timeframeFromTime', (v) => { customTimeframeFromTime = v; });
    bindCustomDate('timeframeToTime', (v) => { customTimeframeToTime = v; });

    document.querySelectorAll('.map-style-pill').forEach(btn => {
        btn.addEventListener('click', () => {
            currentMapStyle = btn.dataset.style || 'traewelling-dark';
            syncToolbarPills();
            updateUrlParams();
            renderPlayer();
        });
    });

    // Feature 1: Aspect Ratio Switcher
    document.querySelectorAll('.aspect-ratio-pill').forEach(btn => {
        btn.addEventListener('click', () => {
            const nextAspect = btn.dataset.aspect || '1:1';
            if (nextAspect === clipSettings.aspectRatio) return;
            clipSettings.aspectRatio = nextAspect;
            syncPlayerHostAspectClass();
            syncCustomizerControls();
            const precompute = buildActivePrecompute(getActiveTrips());
            preloadTilesForCurrentState(precompute);
            if (player) {
                player.updateSettings({ aspectRatio: nextAspect }, precompute);
            }
        });
    });

    // Feature 2: Camera Mode Switcher
    document.querySelectorAll('.camera-mode-pill').forEach(btn => {
        btn.addEventListener('click', () => {
            const nextMode = btn.dataset.camera || 'cinematic';
            clipSettings.cameraMode = nextMode;
            syncCustomizerControls();
            if (player) {
                player.updateSettings({ cameraMode: nextMode });
            }
        });
    });

    const bindNumericPillGroup = (selector, datasetKey, settingsKey, fallbackStr, extraHandler = null) => {
        document.querySelectorAll(selector).forEach(btn => {
            btn.addEventListener('click', () => {
                const val = parseFloat(btn.dataset[datasetKey] || fallbackStr);
                clipSettings[settingsKey] = val;
                syncCustomizerControls();
                if (extraHandler) {
                    extraHandler(val);
                } else if (player) {
                    player.updateSettings({ [settingsKey]: val });
                }
            });
        });
    };

    // Clip Duration Switcher
    bindNumericPillGroup('.clip-duration-pill', 'duration', 'clipDurationSec', '8', (sec) => {
        renderSidebarDetails();
        if (player) {
            player.updateSettings({ clipDurationSec: sec }, null, getActiveDurationInFrames());
        }
    });

    // Feature 3: Live Map Tile Scale Control
    bindNumericPillGroup('.tile-scale-pill', 'tileScale', 'tileScale', '2', (scaleVal) => {
        setAnimationTileLabelScale(scaleVal);
        const precompute = buildActivePrecompute(getActiveTrips());
        preloadTilesForCurrentState(precompute);
        if (player) {
            player.updateSettings({ tileScale: scaleVal }, precompute);
        }
    });

    // Vehicle Style Switcher (3D Isometric vs Classic 2D)
    document.querySelectorAll('.vehicle-style-pill').forEach(btn => {
        btn.addEventListener('click', () => {
            const nextStyle = btn.dataset.vehicleStyle || '3d';
            clipSettings.vehicleStyle = nextStyle;
            syncCustomizerControls();
            if (player) {
                player.updateSettings({ vehicleStyle: nextStyle });
            }
        });
    });

    // Route Width & Vehicle Size Switchers
    bindNumericPillGroup('.route-width-pill', 'routeWidth', 'routeWidthScale', '1');
    bindNumericPillGroup('.vehicle-scale-pill', 'vehicleScale', 'vehicleScale', '1');

    // Feature 4: Live Overlay & Stopover Toggles
    const bindOverlayToggle = (id, key) => {
        const el = /** @type {HTMLInputElement|null} */ (document.getElementById(id));
        if (el) {
            el.addEventListener('change', () => {
                clipSettings[key] = el.checked;
                syncCustomizerControls();
                if (player) {
                    player.updateSettings({ [key]: el.checked });
                }
            });
        }
    };
    bindOverlayToggle('toggleHudInput', 'showHud');
    bindOverlayToggle('toggleScheduleTimesInput', 'showScheduleTimes');
    bindOverlayToggle('toggleStationPillsInput', 'showStationPills');
    bindOverlayToggle('toggleStopDotsInput', 'showStopDots');
    bindOverlayToggle('toggleStopNamesInput', 'showStopNames');
    bindOverlayToggle('toggleVignetteInput', 'showVignette');
    bindOverlayToggle('toggleWatermarkInput', 'showWatermark');

    // Reset Studio Defaults
    const resetBtn = document.getElementById('resetCustomizeBtn');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            Object.assign(clipSettings, createDefaultClipSettings());
            setAnimationTileLabelScale(clipSettings.tileScale);
            syncPlayerHostAspectClass();
            syncCustomizerControls();
            renderSidebarDetails();
            const precompute = buildActivePrecompute(getActiveTrips());
            preloadTilesForCurrentState(precompute);
            if (player) {
                player.updateSettings(clipSettings, precompute, getActiveDurationInFrames());
            }
        });
    }

    // Feature 5: Instant PNG Frame Snapshot
    const snapshotBtn = document.getElementById('downloadSnapshotBtn');
    if (snapshotBtn) {
        snapshotBtn.addEventListener('click', () => {
            if (!player) return;
            const snapName = buildClipFilename('png');
            player.captureSnapshotPng(snapName);
        });
    }

    const downloadBtn = document.getElementById('downloadVideoBtn');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', () => {
            triggerVideoDownload();
        });
    }

    const cancelBtn = document.getElementById('cancelRecordBtn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            if (activeExporter) {
                activeExporter.cancel();
            }
        });
    }

    const shareBtn = document.getElementById('shareAnimationBtn');
    if (shareBtn) {
        shareBtn.addEventListener('click', async () => {
            const url = new URL(window.location.origin + window.location.pathname.replace(/\/+$/, ''));
            const isExternal = externalTrip && currentTrip && String(externalTrip.id) === String(currentTrip.id);
            const shareUser = (isExternal && externalTrip?.user?.username) ? externalTrip.user.username : currentUser;
            if (shareUser) url.searchParams.set('user', shareUser);
            if (currentMode === 'all') {
                url.searchParams.set('mode', 'all');
                if (currentTimeframe && currentTimeframe !== 'all') {
                    url.searchParams.set('timeframe', currentTimeframe);
                }
            } else if (currentTrip?.id || currentTripId) {
                url.searchParams.set('trip', String(currentTrip?.id || currentTripId));
            }
            if (currentMapStyle && currentMapStyle !== 'traewelling-dark') {
                url.searchParams.set('style', currentMapStyle);
            }

            const shareUrl = url.toString();
            const originalHtml = shareBtn.innerHTML;

            if (navigator.share && window.innerWidth <= 768) {
                try {
                    await navigator.share({
                        title: `Träwelling Trip Clip — @${shareUser || 'traveler'}`,
                        text: currentTrip ? `Watch animated train journey: ${document.getElementById('sidebarRoute')?.textContent || 'Trip Clip'}` : 'Watch my Träwelling Trip Clip!',
                        url: shareUrl
                    });
                    return;
                } catch {}
            }

            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    await Promise.race([
                        navigator.clipboard.writeText(shareUrl),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 250))
                    ]);
                } else {
                    throw new Error('Clipboard API unavailable');
                }
                shareBtn.innerHTML = `
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align: middle; margin-right: 6px;"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    <span>✓ Link Copied!</span>
                `;
                shareBtn.classList.add('copied');
                setTimeout(() => {
                    shareBtn.innerHTML = originalHtml;
                    shareBtn.classList.remove('copied');
                }, 2500);
            } catch {
                const tmp = document.createElement('textarea');
                tmp.value = shareUrl;
                tmp.style.position = 'fixed';
                tmp.style.opacity = '0';
                document.body.appendChild(tmp);
                tmp.focus();
                tmp.select();
                try { document.execCommand('copy'); } catch {}
                document.body.removeChild(tmp);

                shareBtn.innerHTML = `
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align: middle; margin-right: 6px;"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    <span>✓ Link Copied!</span>
                `;
                shareBtn.classList.add('copied');
                setTimeout(() => {
                    shareBtn.innerHTML = originalHtml;
                    shareBtn.classList.remove('copied');
                }, 2500);
            }
        });
    }
}

function updateUrlParams() {
    const params = new URLSearchParams();
    const isViewingExternal = Boolean(externalTrip && currentTrip && String(externalTrip.id) === String(currentTrip.id));
    const activeAccount = isViewingExternal ? (externalTrip.user?.username || currentUser) : currentUser;
    if (activeAccount) params.set('user', activeAccount);
    if (currentMode === 'all') {
        params.set('mode', 'all');
    } else if (currentTripId) {
        params.set('id', currentTripId);
    }
    if (currentTimeframe && currentTimeframe !== 'all') {
        params.set('timeframe', currentTimeframe);
    }
    if (currentTimeframe === 'custom') {
        if (customTimeframeFrom) params.set('from', customTimeframeFrom);
        if (customTimeframeTo) params.set('to', customTimeframeTo);
        if (customTimeframeFromTime) params.set('fromTime', customTimeframeFromTime);
        if (customTimeframeToTime) params.set('toTime', customTimeframeToTime);
    }
    if (currentMapStyle && currentMapStyle !== 'traewelling-dark') {
        params.set('map', currentMapStyle);
    }
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
