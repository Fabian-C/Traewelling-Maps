/**
 * Journey Video Clip Controller
 * Coordinates SessionDB, live Träwelling API & single-status fetch, URL parameters (?user=&id=),
 * 16:9 rectangular HD canvas player, 7 map tile sets with 100% tile preloading,
 * video file download, and prepopulated Mastodon post sharing.
 */

import React from 'https://esm.sh/react@18.3.1';
import ReactDOM from 'https://esm.sh/react-dom@18.3.1/client';
import htm from 'https://esm.sh/htm@3.1.1';
import { Player } from 'https://esm.sh/@remotion/player@4.0.539?deps=react@18.3.1,remotion@4.0.539';

import { SessionDB } from '../cache/session.js';
import { TraewellingAPI } from '../api/traewelling.js';
import { normalizeTripStatus } from '../data/processing.js';
import { syncNavigationLinks } from '../ui/navigation.js';
import { computeTripDurationMinutes, deriveDelaySeconds } from '../utils/time.js';
import { escapeHtml, formatHumanDuration } from '../utils/format.js';
import { TripStoryComposition, MAP_STYLES, CATEGORY_META } from './composition.js';
import { VideoClipRecorder } from './recorder.js';

const html = htm.bind(React.createElement);

const DEMO_FIXTURE_TRIPS = [
    {
        id: 9245926,
        body: 'Mit @Floxy',
        bodyMentions: [{ user: { username: 'Floxy', displayName: 'Floxy' } }],
        createdAt: '2026-10-05T15:32:00+00:00',
        train: {
            category: 'subway',
            lineName: 'U6',
            distance: 3055,
            duration: 8,
            origin: {
                name: 'U Leopoldplatz (Berlin)',
                departurePlanned: '2026-10-05T15:32:00+00:00',
                departureReal: '2026-10-05T15:30:00+00:00',
                station: { latitude: 52.546448, longitude: 13.359059 }
            },
            destination: {
                name: 'U Oranienburger Tor (Berlin)',
                arrivalPlanned: '2026-10-05T15:38:00+00:00',
                arrivalReal: '2026-10-05T15:38:00+00:00',
                station: { latitude: 52.52441, longitude: 13.387608 }
            },
            polyline: {
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: [
                        [13.359059, 52.546448],
                        [13.363120, 52.542650],
                        [13.369050, 52.538200],
                        [13.375200, 52.534900],
                        [13.382100, 52.529800],
                        [13.387608, 52.524410]
                    ]
                },
                properties: { statusId: 9245926 }
            }
        }
    },
    {
        id: 8877665,
        body: 'High-speed rail run across Northern Germany 🚄',
        createdAt: '2026-10-12T10:00:00+00:00',
        train: {
            category: 'nationalExpress',
            lineName: 'ICE 605',
            totalDistance: 284000,
            duration: 104,
            departureDelay: 180,
            origin: {
                name: 'Hamburg Hbf',
                departurePlanned: '2026-10-12T10:00:00+00:00',
                departureReal: '2026-10-12T10:03:00+00:00'
            },
            destination: {
                name: 'Berlin Hbf',
                arrivalPlanned: '2026-10-12T11:44:00+00:00',
                arrivalReal: '2026-10-12T11:47:00+00:00'
            },
            polyline: {
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: [
                        [10.0069, 53.5533],
                        [10.2130, 53.4790],
                        [10.5560, 53.3680],
                        [11.4140, 53.3320],
                        [11.8680, 53.0030],
                        [12.4350, 52.7120],
                        [13.0650, 52.5480],
                        [13.3695, 52.5255]
                    ]
                },
                properties: { statusId: 8877665 }
            }
        }
    },
    {
        id: 9309802,
        body: 'Evening S-Bahn ride through the Berlin Stadtbahn with @Fabi',
        bodyMentions: [{ id: 1, username: 'Fabi' }],
        createdAt: '2026-10-11T18:46:00+00:00',
        train: {
            category: 'suburban',
            lineName: 'S9',
            totalDistance: 4400,
            duration: 9,
            departureDelay: 60,
            origin: {
                name: 'Berlin Friedrichstraße',
                departurePlanned: '2026-10-11T18:46:00+00:00',
                departureReal: '2026-10-11T18:47:00+00:00'
            },
            destination: {
                name: 'Berlin Ostbahnhof',
                arrivalPlanned: '2026-10-11T18:55:00+00:00',
                arrivalReal: '2026-10-11T18:56:00+00:00'
            },
            polyline: {
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: [
                        [13.38635, 52.520424],
                        [13.4015, 52.5225],
                        [13.4112, 52.5219],
                        [13.4210, 52.5150],
                        [13.4347, 52.5108]
                    ]
                },
                properties: { statusId: 9309802 }
            }
        }
    },
    {
        id: 325374,
        body: 'Harbor ferry cruise on the Elbe with @Fabi',
        bodyMentions: [{ id: 1, username: 'Fabi' }],
        createdAt: '2022-04-16T16:49:46+00:00',
        train: {
            category: 'ferry',
            lineName: 'Fähre 62',
            totalDistance: 6200,
            duration: 24,
            departureDelay: 0,
            origin: { name: 'Hamburg Landungsbrücken' },
            destination: { name: 'Finkenwerder' },
            polyline: {
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: [
                        [9.970619, 53.546314],
                        [9.952236, 53.54395],
                        [9.935498, 53.543024],
                        [9.9082, 53.5421],
                        [9.8758, 53.5356]
                    ]
                },
                properties: { statusId: 325374 }
            }
        }
    }
];

const VIDEO_WIDTH = 1280;
const VIDEO_HEIGHT = 720;
const DURATION_IN_FRAMES = 240;
const FPS = 30;

let currentMapStyle = 'traewelling-dark';
let currentUser = '';
let currentTripId = '';
let currentTrip = null;
let userTrips = [];
let allSessions = [];
let playerRef = null;
let reactRoot = null;
let lastRecordedVideo = null;

async function init() {
    const urlParams = new URLSearchParams(window.location.search);
    currentUser = (urlParams.get('user') || '').toLowerCase().trim();
    currentTripId = urlParams.get('id') || urlParams.get('trip') || urlParams.get('statusId') || '';

    const mapParam = urlParams.get('map');
    if (mapParam && MAP_STYLES[mapParam]) {
        currentMapStyle = mapParam;
    }

    const savedInstance = localStorage.getItem('trwl_mastodon_instance');
    const instInput = document.getElementById('mastodonInstanceInput');
    if (savedInstance && instInput) {
        instInput.value = savedInstance;
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
    } else if (!currentUser) {
        currentUser = 'hash';
    }

    await loadUserTrips(currentUser);

    renderSessionSelect();
    renderTripSelect();
    syncToolbarPills();
    renderPlayer();
    setupControls();

    // Expose seek helper for automated visual inspection & testing
    window.__seekAnimationFrame = (frameNum) => {
        if (playerRef) {
            playerRef.pause();
            playerRef.seekTo(frameNum);
        }
    };
}

function syncToolbarPills() {
    document.querySelectorAll('.map-style-pill').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.style === currentMapStyle);
    });
}

async function attachPolylinesToTrips(trips) {
    const missingPolyIds = trips
        .filter(t => {
            const tr = t.train || t.checkin || {};
            return !tr.polyline;
        })
        .slice(0, 20)
        .map(t => t.id)
        .filter(Boolean);

    if (missingPolyIds.length === 0) return;
    try {
        const polyData = await TraewellingAPI.getPolylines(missingPolyIds);
        const features = polyData?.data?.features || [];
        const polyMap = new Map();
        features.forEach(f => {
            const sid = f?.properties?.statusId ?? f?.properties?.id;
            if (sid) polyMap.set(String(sid), f);
        });
        trips.forEach(t => {
            normalizeTripStatus(t);
            if (t.train && polyMap.has(String(t.id))) {
                t.train.polyline = polyMap.get(String(t.id));
            }
        });
    } catch (e) {
        console.warn('Polyline fetch warning:', e);
    }
}

async function loadUserTrips(username) {
    userTrips = [];
    if (username) {
        try {
            const session = await SessionDB.get(username);
            if (session && Array.isArray(session.trips) && session.trips.length > 0) {
                userTrips = session.trips.map(t => normalizeTripStatus(t));
            }
        } catch (e) {
            console.warn('Failed to load cached trips for user:', username, e);
        }
    }

    // Live API fallback if a real username was requested via URL but is not cached locally yet
    if (userTrips.length === 0 && username && username !== 'resu') {
        try {
            const resp = await TraewellingAPI.getUserStatuses(username, 1);
            if (resp && Array.isArray(resp.data) && resp.data.length > 0) {
                userTrips = resp.data.map(t => normalizeTripStatus(t));
                await attachPolylinesToTrips(userTrips);
            }
        } catch (e) {
            console.warn('Live API fallback failed, using demo fixtures:', e);
        }
    }

    // If a specific check-in ID (?id=9245926) was requested and isn't in page 1, fetch that exact status
    if (currentTripId && !userTrips.some(t => String(t.id) === String(currentTripId))) {
        try {
            const singleRes = await fetch(`https://traewelling.de/api/v1/status/${encodeURIComponent(currentTripId)}`);
            if (singleRes.ok) {
                const singleJson = await singleRes.json();
                if (singleJson?.data) {
                    const exactTrip = normalizeTripStatus(singleJson.data);
                    await attachPolylinesToTrips([exactTrip]);
                    userTrips.unshift(exactTrip);
                }
            }
        } catch (e) {
            console.warn('Single status fetch fallback:', e);
        }
    }

    if (userTrips.length === 0) {
        userTrips = DEMO_FIXTURE_TRIPS.map(t => normalizeTripStatus(t));
    }

    if (currentTripId) {
        currentTrip = userTrips.find(t => String(t.id) === String(currentTripId))
            || DEMO_FIXTURE_TRIPS.find(t => String(t.id) === String(currentTripId));
        if (currentTrip && !userTrips.includes(currentTrip)) {
            userTrips.unshift(currentTrip);
        }
    }

    if (!currentTrip && userTrips.length > 0) {
        currentTrip = userTrips[0];
        currentTripId = String(currentTrip.id);
    }

    lastRecordedVideo = null;
    updateTripSidebar(currentTrip);
}

function renderSessionSelect() {
    const select = document.getElementById('userSelect');
    if (!select) return;

    const options = [];
    const hasCurrentInSessions = allSessions.some(s => (s.username || '').toLowerCase() === currentUser.toLowerCase());

    if (!hasCurrentInSessions && currentUser) {
        const label = `@${currentUser}`;
        options.push(`<option value="${escapeHtml(currentUser)}" selected>${escapeHtml(label)} (${userTrips.length} trips)</option>`);
    }

    allSessions.forEach(s => {
        const u = s.username || 'unknown';
        const d = s.displayName || u;
        const count = Array.isArray(s.trips) ? s.trips.length : 0;
        const isSelected = u.toLowerCase() === currentUser.toLowerCase();
        options.push(`<option value="${escapeHtml(u)}" ${isSelected ? 'selected' : ''}>${escapeHtml(d)} (@${escapeHtml(u)} · ${count} trips)</option>`);
    });

    select.innerHTML = options.join('');
}

function renderTripSelect() {
    const select = document.getElementById('tripSelect');
    if (!select) return;

    if (userTrips.length === 0) {
        select.innerHTML = '<option value="">No trips found</option>';
        return;
    }

    select.innerHTML = userTrips.map(t => {
        const train = t.train || t.checkin || {};
        const line = train.lineName || train.number || t.line || 'Train';
        const origin = train.origin?.name || t.origin || 'Origin';
        const dest = train.destination?.name || t.destination || 'Destination';
        const dateRaw = train.origin?.departureReal || train.origin?.departurePlanned || t.createdAt;
        const date = dateRaw ? new Date(dateRaw).toLocaleDateString() : '';
        const isSelected = String(t.id) === String(currentTripId);
        return `<option value="${t.id}" ${isSelected ? 'selected' : ''}>${escapeHtml(line)}: ${escapeHtml(origin)} → ${escapeHtml(dest)} (${date})</option>`;
    }).join('');
}

function buildMastodonPostText(trip) {
    if (!trip) return '';
    const train = trip.train || trip.checkin || {};
    const catMeta = CATEGORY_META[train.category] || CATEGORY_META.unknown;
    const line = train.lineName || train.number || 'Train';
    const origin = train.origin?.name || trip.origin || 'Origin';
    const dest = train.destination?.name || trip.destination || 'Destination';
    const rawDist = typeof train.totalDistance === 'number'
        ? train.totalDistance
        : (typeof train.distance === 'number' ? train.distance : 0);
    const distStr = rawDist > 0 ? `${(rawDist / 1000).toFixed(1)} km` : '';
    const durationMin = computeTripDurationMinutes(train);
    const durStr = durationMin !== null ? formatHumanDuration(durationMin) : '';
    const statsPart = [distStr, durStr].filter(Boolean).join(' in ');
    const note = (trip.body || '').trim();
    const statusUrl = `https://traewelling.de/status/${trip.id}`;

    const lines = [
        `${catMeta.emoji} ${line}: ${origin} → ${dest}${statsPart ? ` (${statsPart})` : ''}`
    ];
    if (note) {
        lines.push(`💬 "${note}"`);
    }
    lines.push(statusUrl);
    lines.push('#Träwelling #Trainspotting #ÖPNV');
    return lines.join('\n\n');
}

function updateTripSidebar(trip) {
    if (!trip) return;

    const lineEl = document.getElementById('sidebarLine');
    const routeEl = document.getElementById('sidebarRoute');
    const distEl = document.getElementById('sidebarDistance');
    const delayEl = document.getElementById('sidebarDelay');
    const durEl = document.getElementById('sidebarDuration');
    const noteEl = document.getElementById('sidebarNote');
    const mastodonTextEl = document.getElementById('mastodonPostText');

    const train = trip.train || trip.checkin || {};
    const line = train.lineName || train.number || 'Train';
    const origin = train.origin?.name || trip.origin || 'Origin';
    const dest = train.destination?.name || trip.destination || 'Destination';
    const rawDist = typeof train.totalDistance === 'number'
        ? train.totalDistance
        : (typeof train.distance === 'number' ? train.distance : 0);
    const dist = rawDist > 0 ? (rawDist / 1000).toFixed(1) + ' km' : '—';

    const delays = deriveDelaySeconds(train);
    const delaySec = delays.arrival !== null ? delays.arrival : (delays.departure || 0);
    const delayMin = Math.round(delaySec / 60);
    const delayStr = delayMin > 0 ? `+${delayMin} min` : (delayMin < 0 ? `${delayMin} min` : 'On time (0 min)');

    const durationMin = computeTripDurationMinutes(train);
    const durStr = durationMin !== null ? formatHumanDuration(durationMin) : '—';

    if (lineEl) lineEl.textContent = line;
    if (routeEl) routeEl.textContent = `${origin} → ${dest}`;
    if (distEl) distEl.textContent = dist;
    if (delayEl) delayEl.textContent = delayStr;
    if (durEl) durEl.textContent = durStr;
    if (noteEl) noteEl.textContent = trip.body ? `"${trip.body}"` : 'No check-in note';
    if (mastodonTextEl) mastodonTextEl.value = buildMastodonPostText(trip);
}

function handleTilesProgress({ loaded, total }) {
    const badge = document.getElementById('tilePreloadBadge');
    if (!badge) return;
    if (loaded >= total && total > 0) {
        badge.textContent = `✓ ${total}/${total} Map Tiles Loaded`;
        badge.classList.add('ready');
    } else {
        badge.textContent = `⏳ Preloading Tiles (${loaded}/${total})…`;
        badge.classList.remove('ready');
    }
}

function renderPlayer() {
    const container = document.getElementById('playerContainer');
    if (!container) return;

    container.className = 'player-host ratio-landscape';

    if (!reactRoot) {
        reactRoot = ReactDOM.createRoot(container);
    }

    reactRoot.render(html`
        <div class="player-wrapper">
            <${Player}
                ref=${(ref) => { playerRef = ref; }}
                component=${TripStoryComposition}
                inputProps=${{
                    trip: currentTrip,
                    username: currentUser,
                    mapStyle: currentMapStyle,
                    onTilesProgress: handleTilesProgress
                }}
                durationInFrames=${DURATION_IN_FRAMES}
                compositionWidth=${VIDEO_WIDTH}
                compositionHeight=${VIDEO_HEIGHT}
                fps=${FPS}
                style=${{ width: '100%', height: '100%' }}
                controls
                autoPlay
                loop
                acknowledgeRemotionLicense
            />
        </div>
    `);
}

async function triggerVideoDownload() {
    if (!playerRef || !currentTrip) return null;
    const downloadBtn = document.getElementById('downloadVideoBtn');
    const progressWrap = document.getElementById('recordProgressWrap');
    const progressBar = document.getElementById('recordProgressBar');
    const statusText = document.getElementById('recordStatusText');

    const train = currentTrip.train || currentTrip.checkin || {};
    const cleanLine = (train.lineName || 'trip').replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
    const filename = `traewelling-${currentUser || 'clip'}-${cleanLine}-${currentTrip.id || 'video'}.webm`;

    try {
        if (downloadBtn) {
            downloadBtn.disabled = true;
            downloadBtn.textContent = '⏳ Rendering & Downloading Video…';
        }
        if (progressWrap) progressWrap.classList.remove('hidden');
        if (progressBar) progressBar.style.width = '5%';

        const recorder = new VideoClipRecorder(playerRef, DURATION_IN_FRAMES);
        const result = await recorder.recordAndDownload({
            trip: currentTrip,
            mapStyle: currentMapStyle,
            width: VIDEO_WIDTH,
            height: VIDEO_HEIGHT,
            filename,
            onProgress: (pct, msg) => {
                if (progressBar) progressBar.style.width = `${pct}%`;
                if (statusText && msg) statusText.textContent = msg;
            }
        });

        lastRecordedVideo = result;
        if (statusText) statusText.textContent = `✓ Downloaded ${result.filename} (${Math.round(result.blob.size / 1024)} KB)`;
        if (downloadBtn) {
            downloadBtn.disabled = false;
            downloadBtn.textContent = '✓ Video Downloaded! (Click to Download Again)';
        }
        return result;
    } catch (e) {
        console.error('Video recording error:', e);
        if (statusText) statusText.textContent = `Error: ${e.message}`;
        if (downloadBtn) {
            downloadBtn.disabled = false;
            downloadBtn.textContent = '⬇ Download Video Clip (16:9 HD)';
        }
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
            currentTripId = String(e.target.value);
            currentTrip = userTrips.find(t => String(t.id) === currentTripId);
            lastRecordedVideo = null;
            updateTripSidebar(currentTrip);
            updateUrlParams();
            renderPlayer();
        });
    }

    // 7 Map Theme Switcher Pills
    document.querySelectorAll('.map-style-pill').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.map-style-pill').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentMapStyle = btn.dataset.style || 'traewelling-dark';
            lastRecordedVideo = null;
            updateUrlParams();
            renderPlayer();
        });
    });

    // Download Video Button
    const downloadBtn = document.getElementById('downloadVideoBtn');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', () => {
            triggerVideoDownload();
        });
    }

    // Mastodon Instance Chips
    const instInput = document.getElementById('mastodonInstanceInput');
    document.querySelectorAll('.instance-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            if (instInput && chip.dataset.instance) {
                instInput.value = chip.dataset.instance;
                localStorage.setItem('trwl_mastodon_instance', instInput.value.trim());
            }
        });
    });
    if (instInput) {
        instInput.addEventListener('change', () => {
            localStorage.setItem('trwl_mastodon_instance', instInput.value.trim());
        });
    }

    // Share on Mastodon Button (Downloads video + opens Mastodon share composer with Träwelling link)
    const shareMastodonBtn = document.getElementById('shareMastodonBtn');
    if (shareMastodonBtn) {
        shareMastodonBtn.addEventListener('click', async () => {
            const postText = (document.getElementById('mastodonPostText')?.value || buildMastodonPostText(currentTrip)).trim();
            const rawInstance = (document.getElementById('mastodonInstanceInput')?.value || 'mastodon.social')
                .trim()
                .replace(/^https?:\/\//i, '')
                .replace(/\/.*$/, '');
            const instance = rawInstance || 'mastodon.social';
            localStorage.setItem('trwl_mastodon_instance', instance);

            // Ensure video file is downloaded so user has the video clip ready to attach
            let videoRes = lastRecordedVideo;
            if (!videoRes) {
                videoRes = await triggerVideoDownload();
            }

            // Try native Web Share API with video file on mobile if supported
            if (videoRes?.blob && navigator.canShare) {
                try {
                    const file = new File([videoRes.blob], videoRes.filename, { type: videoRes.mimeType });
                    if (navigator.canShare({ files: [file], text: postText })) {
                        await navigator.share({ text: postText, files: [file] });
                        return;
                    }
                } catch {
                    // Fall back to opening Mastodon instance share intent
                }
            }

            const mastodonShareUrl = `https://${encodeURIComponent(instance)}/share?text=${encodeURIComponent(postText)}`;
            window.open(mastodonShareUrl, '_blank', 'noopener,noreferrer');
        });
    }

    // Copy Mastodon Post Text Button
    const copyMastodonTextBtn = document.getElementById('copyMastodonTextBtn');
    if (copyMastodonTextBtn) {
        copyMastodonTextBtn.addEventListener('click', async () => {
            const postText = (document.getElementById('mastodonPostText')?.value || buildMastodonPostText(currentTrip)).trim();
            try {
                await navigator.clipboard.writeText(postText);
                copyMastodonTextBtn.textContent = '✓ Post Text Copied!';
                setTimeout(() => {
                    copyMastodonTextBtn.textContent = '📋 Copy Post Text';
                }, 2200);
            } catch (e) {
                console.warn('Clipboard copy failed:', e);
            }
        });
    }
}

function updateUrlParams() {
    const params = new URLSearchParams();
    if (currentUser) params.set('user', currentUser);
    if (currentTripId) params.set('id', currentTripId);
    if (currentMapStyle && currentMapStyle !== 'traewelling-dark') params.set('map', currentMapStyle);
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
