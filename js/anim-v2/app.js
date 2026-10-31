/**
 * Trip Clip V2 Application Controller (Zero-Dependency Architecture)
 * Orchestrates session loading, timeframe filtering, spatial precomputation,
 * the native micro-player, and deterministic MP4 video export.
 */

import { SessionDB } from '../cache/session.js';
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
    return filterTripsByTimeframe(
        userTrips,
        currentTimeframe,
        customTimeframeFrom,
        customTimeframeTo,
        new Date(),
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

    if (currentUser) {
        await loadUserTrips(currentUser);
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

    allSessions.forEach(sess => {
        const opt = document.createElement('option');
        opt.value = sess.username;
        opt.textContent = `${sess.displayName || sess.username} (@${sess.username})`;
        if (sess.username === currentUser) opt.selected = true;
        userSelect.appendChild(opt);
    });
}

async function loadUserTrips(username) {
    if (!username) {
        userTrips = DEMO_FIXTURE_TRIPS;
        return;
    }

    try {
        const session = await SessionDB.get(username);
        if (session && Array.isArray(session.trips) && session.trips.length > 0) {
            userTrips = session.trips.map(normalizeTripStatus);
        } else {
            const apiRes = await TraewellingAPI.getUserStatuses(username);
            const rawTrips = apiRes?.data || [];
            userTrips = rawTrips.map(normalizeTripStatus);
        }
    } catch (err) {
        console.warn('Could not load user trips from session or API, falling back to demo fixture:', err);
        userTrips = DEMO_FIXTURE_TRIPS;
    }

    if (!userTrips.length) {
        userTrips = DEMO_FIXTURE_TRIPS;
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
        }
        tripSelect.appendChild(opt);
    });

    if (currentMode !== 'all') {
        currentTrip = userTrips.find(t => String(t.id) === String(currentTripId)) || userTrips[0];
        currentTripId = String(currentTrip?.id || '');
    } else {
        currentTrip = null;
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
