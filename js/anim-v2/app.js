/**
 * Trip Clip V2 Application Controller (Zero-Dependency Architecture)
 * Orchestrates session loading, timeframe filtering, spatial precomputation,
 * the native micro-player, and deterministic MP4 video export.
 */

import { SessionDB } from '../cache/session.js';
import { Storage, STORAGE_KEYS } from '../storage/storage.js';
import { TraewellingAPI } from '../api/traewelling.js';
import { normalizeTripStatus } from '../data/processing.js';
import { syncNavigationLinks } from '../ui/navigation.js';
import { computeTripDurationMinutes, deriveDelaySeconds } from '../utils/time.js';
import { escapeHtml, formatHumanDuration } from '../utils/format.js';
import {
    MAP_STYLES,
    preloadTripTiles,
    preloadSceneTiles
} from '../animation/tiles.js';
import {
    filterTripsByTimeframe,
    getTripTimestamp,
    getTimeframeLabel,
    TIMEFRAME_PRESETS
} from '../animation/timeframe.js';
import {
    buildFastTripPrecompute,
    buildFastAllTripsPrecompute,
    computeAllModeTiming
} from './precompute.js';
import { NativeTripPlayer } from './player.js';
import { VideoClipExporterV2 } from './export.js';

const VIDEO_WIDTH = 960;
const VIDEO_HEIGHT = 960;
const FPS = 30;
const DURATION_IN_FRAMES = 240;

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
            duration: 110,
            origin: {
                name: 'Berlin Hbf',
                departurePlanned: '2026-10-05T15:32:00+00:00',
                departureReal: '2026-10-05T15:34:00+00:00'
            },
            destination: {
                name: 'München Hbf',
                arrivalPlanned: '2026-10-05T19:22:00+00:00',
                arrivalReal: '2026-10-05T19:26:00+00:00'
            },
            polyline: [
                [13.3695, 52.5255],
                [13.3421, 52.4832],
                [12.3731, 51.3397],
                [11.5819, 48.1402]
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
let userTrips = [];
let allSessions = [];
let player = null;
let activeExporter = null;

function getActiveTrips() {
    let refDate = new Date();
    // If all user trips are historical (e.g. from an archived year), anchor the 7-day window to the latest trip
    // so historical datasets display their latest 7 days rather than returning an empty set.
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
    if (currentMode === 'all' && activeTrips.length > 0) {
        return computeAllModeTiming(activeTrips, FPS).totalFrames;
    }
    return DURATION_IN_FRAMES;
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
        // Default to last-7-days when entering All Trips mode to prevent browser unresponsiveness
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

    syncNavigationLinks(currentUser);

    try {
        allSessions = await SessionDB.getAll();
    } catch (e) {
        console.warn('SessionDB retrieval fallback:', e);
        allSessions = [];
    }

    if (!currentUser && allSessions.length > 0) {
        currentUser = allSessions[0].username || '';
    }

    renderUserSelect();
    setupControls();
    syncToolbarPills();

    if (currentUser || currentTripId) {
        await loadUserTrips(currentUser, currentTripId);
    } else {
        userTrips = DEMO_FIXTURE_TRIPS;
    }

    renderTripSelect();
    renderPlayer();
}

function renderUserSelect() {
    const userSelect = document.getElementById('userSelect');
    if (!userSelect) return;
    userSelect.innerHTML = '';

    if (allSessions.length === 0) {
        const opt = document.createElement('option');
        opt.value = currentUser || 'demo';
        opt.textContent = `@${currentUser || 'demo'}`;
        userSelect.appendChild(opt);
        return;
    }

    let hasSelected = false;
    allSessions.forEach(sess => {
        const opt = document.createElement('option');
        opt.value = sess.username;
        opt.textContent = `${sess.displayName || sess.username} (@${sess.username})`;
        if (sess.username === currentUser) {
            opt.selected = true;
            hasSelected = true;
        }
        userSelect.appendChild(opt);
    });

    // If currentUser is from a shared link not in local sessions, add an option for them
    if (currentUser && !hasSelected) {
        const sharedOpt = document.createElement('option');
        sharedOpt.value = currentUser;
        sharedOpt.textContent = `@${currentUser} (Shared)`;
        sharedOpt.selected = true;
        userSelect.appendChild(sharedOpt);
    }
}

async function attachPolylinesToTrips(api, trips, maxFetchCount = 20) {
    if (!trips || !trips.length) return;

    // Check cached polylines from SessionDB first
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
    let targetFetched = false;

    // 1. Check if user is cached in local SessionDB
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

    // 2. Direct status fetch if targetTripId was requested but missing in local userTrips
    if (targetTripId && !userTrips.some(t => String(t.id) === String(targetTripId))) {
        try {
            const singleRes = await api.getStatus(targetTripId);
            if (singleRes?.data) {
                const fetchedTrip = normalizeTripStatus(singleRes.data);
                // Fetch the high-resolution route polyline geodata
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
                    } else {
                        const stopRes = await api.getStopovers([targetTripId]);
                        const stops = stopRes?.data?.[targetTripId] || stopRes?.data;
                        if (Array.isArray(stops) && stops.length > 0) {
                            const checkin = fetchedTrip.checkin || fetchedTrip.train || {};
                            checkin.stopovers = stops;
                            if (fetchedTrip.train) fetchedTrip.train.stopovers = stops;
                        }
                    }
                } catch (pe) {
                    console.warn('Polyline fetch warning for status', targetTripId, pe);
                }
                userTrips.unshift(fetchedTrip);
                targetFetched = true;
                if (!currentUser && fetchedTrip.user?.username) {
                    currentUser = fetchedTrip.user.username.toLowerCase();
                    renderUserSelect();
                }
            }
        } catch (se) {
            console.warn('Direct status fetch failed for ID', targetTripId, se);
        }
    }

    // 3. Live API fallback if username was requested and we have fewer than 2 trips (uncached user or only single trip fetched)
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

                // Cache to SessionDB so subsequent loads are immediate & offline
                SessionDB.save(username, userTrips).catch(() => {});
            }
        } catch (ue) {
            console.warn('Live user statuses API fetch error:', ue);
        }
    }

    // 4. Attach polylines to active trips if missing
    const activeMissing = userTrips.filter(t => {
        const c = t.checkin || t.train || {};
        return !c.polyline;
    }).slice(0, 10);
    if (activeMissing.length > 0) {
        await attachPolylinesToTrips(api, activeMissing, 10);
    }

    // 4b. Ensure the requested target trip definitely has its polyline geodata
    if (targetTripId) {
        const targetTrip = userTrips.find(t => String(t.id) === String(targetTripId));
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
                    } else {
                        const stopRes = await api.getStopovers([targetTripId]);
                        const stops = stopRes?.data?.[targetTripId] || stopRes?.data;
                        if (Array.isArray(stops) && stops.length > 0) {
                            checkin.stopovers = stops;
                            if (targetTrip.train) targetTrip.train.stopovers = stops;
                        }
                    }
                } catch (pe) {
                    console.warn('Direct polyline fetch warning for target trip', targetTripId, pe);
                }
            }
        }
    }

    // Persist newly fetched live trips into SessionDB cache
    const activeUser = currentUser || (targetTripId && userTrips.find(t => String(t.id) === String(targetTripId))?.user?.username?.toLowerCase());
    if (activeUser && activeUser !== 'demo' && userTrips.length > 0) {
        SessionDB.save(activeUser, userTrips).catch(() => {});
    }

    if (!userTrips.length) {
        userTrips = DEMO_FIXTURE_TRIPS;
    }

    // 5. If targetTripId was requested but neither direct fetch nor user history contained it:
    if (targetTripId && !userTrips.some(t => String(t.id) === String(targetTripId))) {
        showTripMissingNotice(targetTripId, username);
    }
}

function renderTripSelect() {
    const tripSelect = document.getElementById('tripSelect');
    if (!tripSelect) return;
    tripSelect.innerHTML = '';

    const allOpt = document.createElement('option');
    allOpt.value = 'all';
    allOpt.textContent = `★ All ${userTrips.length} Rides (Replay)`;
    if (currentMode === 'all') allOpt.selected = true;
    tripSelect.appendChild(allOpt);

    let matchedSelected = false;
    userTrips.forEach((trip) => {
        const checkin = trip.checkin || trip.train || {};
        const line = checkin.lineName || checkin.number || 'Trip';
        const origin = checkin.origin?.name || checkin.origin?.station?.name || trip.origin || 'Origin';
        const dest = checkin.destination?.name || checkin.destination?.station?.name || trip.destination || 'Destination';
        const dateStr = trip.createdAt ? new Date(trip.createdAt).toLocaleDateString() : '';

        const opt = document.createElement('option');
        opt.value = String(trip.id);
        opt.textContent = `${line}: ${origin} → ${dest} (${dateStr})`;
        if (currentMode !== 'all' && String(trip.id) === String(currentTripId)) {
            opt.selected = true;
            matchedSelected = true;
        }
        tripSelect.appendChild(opt);
    });

    if (currentMode !== 'all') {
        currentTrip = userTrips.find(t => String(t.id) === String(currentTripId)) || userTrips[0];
        currentTripId = String(currentTrip?.id || '');
        // Guard against HTML select falling back to allOpt: explicitly select option index 1 if target was unmatched
        if (!matchedSelected && tripSelect.options.length > 1) {
            tripSelect.options[1].selected = true;
        }
    } else {
        currentTrip = null;
        allOpt.selected = true;
    }

    renderSidebarDetails();
}

function renderSidebarDetails() {
    const activeTrips = getActiveTrips();
    const isAllMode = currentMode === 'all';

    const lineEl = document.getElementById('sidebarLine');
    const distEl = document.getElementById('sidebarDistance');
    const routeEl = document.getElementById('sidebarRoute');
    const delayEl = document.getElementById('sidebarDelay');
    const durationEl = document.getElementById('sidebarDuration');
    const noteEl = document.getElementById('sidebarNote');

    if (isAllMode) {
        const totalKm = activeTrips.reduce((acc, t) => {
            const raw = t.checkin?.distance || t.train?.totalDistance || t.distance || 0;
            return acc + (raw > 1000 ? raw / 1000 : raw);
        }, 0);

        const tfLabel = getTimeframeLabel(currentTimeframe, customTimeframeFrom, customTimeframeTo, customTimeframeFromTime, customTimeframeToTime);

        if (lineEl) lineEl.textContent = `${activeTrips.length} rides`;
        if (distEl) distEl.textContent = `${Math.round(totalKm).toLocaleString()} km total`;
        if (routeEl) routeEl.textContent = `Network replay (${tfLabel})`;
        if (delayEl) delayEl.textContent = 'All modes & lines';
        if (durationEl) durationEl.textContent = `${Math.round(getActiveDurationInFrames() / FPS)}s video`;
        if (noteEl) noteEl.textContent = `Chronological animated journey map of @${currentUser || 'user'}'s recorded rides.`;
        return;
    }

    if (!currentTrip) {
        if (lineEl) lineEl.textContent = '—';
        if (distEl) distEl.textContent = '—';
        if (routeEl) routeEl.textContent = '—';
        if (delayEl) delayEl.textContent = '—';
        if (durationEl) durationEl.textContent = '—';
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

    if (lineEl) lineEl.textContent = line;
    if (distEl) distEl.textContent = distKm !== '—' ? `${distKm} km` : '—';
    if (routeEl) routeEl.textContent = `${origin} → ${dest}`;
    if (delayEl) {
        const depD = delays.departureDelaySeconds ? Math.round(delays.departureDelaySeconds / 60) : 0;
        const arrD = delays.arrivalDelaySeconds ? Math.round(delays.arrivalDelaySeconds / 60) : 0;
        delayEl.textContent = (depD || arrD) ? `+${depD}m / +${arrD}m` : 'On time';
    }
    if (durationEl) durationEl.textContent = durationMins ? formatHumanDuration(durationMins) : '—';
    if (noteEl) noteEl.textContent = currentTrip.body || currentTrip.message || '—';
}

function renderPlayer() {
    const container = document.getElementById('playerContainer');
    if (!container) return;

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

    // Precalculate high-speed spatial LUTs
    let precompute = null;
    if (isAllMode) {
        precompute = buildFastAllTripsPrecompute(activeTrips, VIDEO_WIDTH, VIDEO_HEIGHT, FPS);
    } else if (currentTrip) {
        precompute = buildFastTripPrecompute(currentTrip, VIDEO_WIDTH, VIDEO_HEIGHT);
    }

    // Preload tiles silently in background
    const styleConfig = MAP_STYLES[currentMapStyle] || MAP_STYLES['traewelling-dark'];
    if (!styleConfig.isVector) {
        if (isAllMode && precompute?.allScene) {
            preloadSceneTiles(precompute.allScene, currentMapStyle);
        } else if (currentTrip) {
            preloadTripTiles(currentTrip, currentMapStyle, VIDEO_WIDTH, VIDEO_HEIGHT);
        }
    }

    if (!player) {
        player = new NativeTripPlayer(container, {
            width: VIDEO_WIDTH,
            height: VIDEO_HEIGHT,
            fps: FPS,
            totalFrames
        });
    }

    player.load({
        trip: currentTrip,
        trips: activeTrips,
        mode: currentMode,
        username: currentUser,
        mapStyle: currentMapStyle,
        totalFrames,
        fps: FPS,
        precompute,
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

async function triggerVideoDownload() {
    const activeTrips = getActiveTrips();
    if ((!currentTrip && currentMode !== 'all') || (currentMode === 'all' && activeTrips.length === 0)) return null;

    const downloadBtn = document.getElementById('downloadVideoBtn');
    const cancelBtn = document.getElementById('cancelRecordBtn');
    const progressWrap = document.getElementById('recordProgressWrap');
    const progressBar = document.getElementById('recordProgressBar');
    const statusText = document.getElementById('recordStatusText');

    const checkin = currentTrip?.checkin || currentTrip?.train || {};
    const cleanLine = (checkin.lineName || checkin.number || 'trip').replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
    const tfPart = currentTimeframe === 'all' ? 'all' : currentTimeframe.replace(/[^a-zA-Z0-9_-]/g, '-');
    const filename = currentMode === 'all'
        ? `traewelling-${currentUser || 'clip'}-${tfPart}-${activeTrips.length}-rides.mp4`
        : `traewelling-${currentUser || 'clip'}-${cleanLine}-${currentTrip?.id || 'video'}.mp4`;

    try {
        if (downloadBtn) {
            downloadBtn.disabled = true;
            downloadBtn.textContent = 'Rendering video…';
        }
        if (cancelBtn) cancelBtn.classList.remove('hidden');
        if (progressWrap) progressWrap.classList.remove('hidden');
        if (progressBar) progressBar.style.width = '2%';

        const totalFrames = getActiveDurationInFrames();
        let precompute = null;
        if (currentMode === 'all') {
            precompute = buildFastAllTripsPrecompute(activeTrips, VIDEO_WIDTH, VIDEO_HEIGHT, FPS);
        } else if (currentTrip) {
            precompute = buildFastTripPrecompute(currentTrip, VIDEO_WIDTH, VIDEO_HEIGHT);
        }

        const exporter = new VideoClipExporterV2();
        activeExporter = exporter;

        const result = await exporter.exportAndDownload({
            trip: currentTrip,
            trips: activeTrips,
            mode: currentMode,
            username: currentUser || 'Traveler',
            mapStyle: currentMapStyle,
            width: VIDEO_WIDTH,
            height: VIDEO_HEIGHT,
            fps: FPS,
            totalFrames,
            precompute,
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

function setupControls() {
    const userSelect = document.getElementById('userSelect');
    if (userSelect) {
        userSelect.addEventListener('change', async (e) => {
            currentUser = (e.target.value || '').trim();
            currentTripId = '';
            await loadUserTrips(currentUser);
            renderTripSelect();
            updateUrlParams();
            syncNavigationLinks(currentUser);
            renderPlayer();
        });
    }

    const tripSelect = document.getElementById('tripSelect');
    if (tripSelect) {
        tripSelect.addEventListener('change', (e) => {
            const val = e.target.value;
            if (val === 'all') {
                currentMode = 'all';
                currentTrip = null;
                currentTripId = '';
                // Default timeframe to last-7-days when entering All Trips mode to prevent unresponsiveness
                if (currentTimeframe === 'all' || !currentTimeframe) {
                    currentTimeframe = 'last-7-days';
                }
            } else {
                currentMode = 'single';
                currentTripId = val;
                currentTrip = userTrips.find(t => String(t.id) === String(val)) || null;
            }
            syncToolbarPills();
            renderSidebarDetails();
            updateUrlParams();
            renderPlayer();
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
            if (currentUser) url.searchParams.set('user', currentUser);
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

            // Try Web Share API on mobile devices first
            if (navigator.share && window.innerWidth <= 768) {
                try {
                    await navigator.share({
                        title: `Träwelling Trip Clip — @${currentUser || 'traveler'}`,
                        text: currentTrip ? `Watch animated train journey: ${document.getElementById('sidebarRoute')?.textContent || 'Trip Clip'}` : 'Watch my Träwelling Trip Clip!',
                        url: shareUrl
                    });
                    return;
                } catch {
                    // Fall back to clipboard if user dismissed or cancelled native share sheet
                }
            }

            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(shareUrl);
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
                // Non-blocking fallback for restricted/headless environments
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
    if (currentUser) params.set('user', currentUser);
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
