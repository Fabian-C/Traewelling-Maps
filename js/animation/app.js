/**
 * TräwellBoast — Remotion Map Journey Animation Controller
 * Coordinates SessionDB, live API fallback, URL parameters (?user=&id=),
 * rectangular 1280x720 Remotion Player, map theme switching, and video export.
 */

import React from 'https://esm.sh/react@18.3.1';
import ReactDOM from 'https://esm.sh/react-dom@18.3.1/client';
import htm from 'https://esm.sh/htm@3.1.1';
import { Player } from 'https://esm.sh/@remotion/player@4.0.539?deps=react@18.3.1,remotion@4.0.539';

import { SessionDB } from '../cache/session.js';
import { TraewellingAPI } from '../api/traewelling.js';
import { SAMPLE_FIXTURE_TRIPS } from '../app.js';
import { syncNavigationLinks } from '../ui/navigation.js';
import { computeTripDurationMinutes } from '../utils/time.js';
import { escapeHtml, formatHumanDuration } from '../utils/format.js';
import { TripStoryComposition } from './composition.js';
import { RemotionRecorder } from './recorder.js';

const html = htm.bind(React.createElement);

const COMPOSITION_WIDTH = 1280;
const COMPOSITION_HEIGHT = 720;
const DURATION_IN_FRAMES = 240;
const FPS = 30;

let currentMapStyle = 'voyager';
let currentUser = '';
let currentTripId = '';
let currentTrip = null;
let userTrips = [];
let allSessions = [];
let playerRef = null;
let reactRoot = null;

async function init() {
    const urlParams = new URLSearchParams(window.location.search);
    currentUser = (urlParams.get('user') || '').toLowerCase().trim();
    currentTripId = urlParams.get('id') || urlParams.get('trip') || urlParams.get('statusId') || '';

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
        currentUser = 'resu';
    }

    await loadUserTrips(currentUser);

    renderSessionSelect();
    renderTripSelect();
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

async function loadUserTrips(username) {
    userTrips = [];
    if (username) {
        try {
            const session = await SessionDB.get(username);
            if (session && Array.isArray(session.trips) && session.trips.length > 0) {
                userTrips = session.trips;
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
                userTrips = resp.data;
                // Fetch polylines for the first batch so routes follow real tracks
                const ids = userTrips.slice(0, 15).map(t => t.id).filter(Boolean);
                if (ids.length > 0) {
                    const polyData = await TraewellingAPI.getPolylines(ids);
                    const features = polyData?.data?.features || [];
                    const polyMap = new Map();
                    features.forEach(f => {
                        const sid = f?.properties?.statusId ?? f?.properties?.id;
                        if (sid) polyMap.set(String(sid), f);
                    });
                    userTrips.forEach(t => {
                        if (t.train && polyMap.has(String(t.id))) {
                            t.train.polyline = polyMap.get(String(t.id));
                        }
                    });
                }
            }
        } catch (e) {
            console.warn('Live API fallback failed, using demo fixtures:', e);
        }
    }

    // Fallback to sample fixture trips if demo user or offline
    if (userTrips.length === 0) {
        userTrips = SAMPLE_FIXTURE_TRIPS;
    }

    if (currentTripId) {
        currentTrip = userTrips.find(t => String(t.id) === String(currentTripId));
    }

    if (!currentTrip && userTrips.length > 0) {
        currentTrip = userTrips[0];
        currentTripId = String(currentTrip.id);
    }

    updateTripSidebar(currentTrip);
}

function renderSessionSelect() {
    const select = document.getElementById('userSelect');
    if (!select) return;

    const options = [];
    const hasCurrentInSessions = allSessions.some(s => (s.username || '').toLowerCase() === currentUser.toLowerCase());

    if (!hasCurrentInSessions && currentUser) {
        const label = currentUser === 'resu' ? 'Resu (Demo)' : `@${currentUser}`;
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
        const line = t.train?.lineName || t.line || 'Train';
        const origin = t.train?.origin?.name || t.origin || 'Origin';
        const dest = t.train?.destination?.name || t.destination || 'Destination';
        const date = t.createdAt ? new Date(t.createdAt).toLocaleDateString() : '';
        const isSelected = String(t.id) === String(currentTripId);
        return `<option value="${t.id}" ${isSelected ? 'selected' : ''}>${escapeHtml(line)}: ${escapeHtml(origin)} → ${escapeHtml(dest)} (${date})</option>`;
    }).join('');
}

function updateTripSidebar(trip) {
    if (!trip) return;

    const lineEl = document.getElementById('sidebarLine');
    const routeEl = document.getElementById('sidebarRoute');
    const distEl = document.getElementById('sidebarDistance');
    const delayEl = document.getElementById('sidebarDelay');
    const durEl = document.getElementById('sidebarDuration');
    const noteEl = document.getElementById('sidebarNote');

    const train = trip.train || {};
    const line = train.lineName || 'Train';
    const origin = train.origin?.name || trip.origin || 'Origin';
    const dest = train.destination?.name || trip.destination || 'Destination';
    const dist = train.totalDistance ? (train.totalDistance / 1000).toFixed(1) + ' km' : '—';
    const delay = typeof train.departureDelay === 'number' ? `${Math.round(train.departureDelay / 60)} min` : '0 min';
    const durationMin = computeTripDurationMinutes(trip);
    const durStr = durationMin !== null ? formatHumanDuration(durationMin) : '42m';

    if (lineEl) lineEl.textContent = line;
    if (routeEl) routeEl.textContent = `${origin} → ${dest}`;
    if (distEl) distEl.textContent = dist;
    if (delayEl) delayEl.textContent = delay;
    if (durEl) durEl.textContent = durStr;
    if (noteEl) noteEl.textContent = trip.body ? `"${trip.body}"` : 'No check-in note';
}

function renderPlayer() {
    const container = document.getElementById('playerContainer');
    if (!container) return;

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
                    mapStyle: currentMapStyle
                }}
                durationInFrames=${DURATION_IN_FRAMES}
                compositionWidth=${COMPOSITION_WIDTH}
                compositionHeight=${COMPOSITION_HEIGHT}
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
            updateTripSidebar(currentTrip);
            updateUrlParams();
            renderPlayer();
        });
    }

    // Map Theme Switcher Pills
    document.querySelectorAll('.map-style-pill').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.map-style-pill').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentMapStyle = btn.dataset.style || 'voyager';
            renderPlayer();
        });
    });

    // Scene Jump Buttons for inspecting keyframes or replaying
    document.querySelectorAll('.scene-jump-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!playerRef) return;
            const action = btn.dataset.scene;
            if (action === 'play') {
                playerRef.seekTo(0);
                playerRef.play();
            } else {
                const targetFrame = parseInt(btn.dataset.frame || '0', 10);
                playerRef.pause();
                playerRef.seekTo(targetFrame);
            }
        });
    });

    // Video Export Button
    const exportBtn = document.getElementById('exportVideoBtn');
    const exportStatus = document.getElementById('exportStatus');

    if (exportBtn) {
        exportBtn.addEventListener('click', async () => {
            if (!playerRef) return;
            exportBtn.disabled = true;
            exportBtn.textContent = '⏳ Recording Journey...';
            if (exportStatus) exportStatus.textContent = '';

            const recorder = new RemotionRecorder(playerRef, DURATION_IN_FRAMES);
            const lineName = (currentTrip?.train?.lineName || 'trip').replace(/[^a-zA-Z0-9_-]/g, '_');
            const filename = `traewellboast-${currentUser}-${lineName}-${currentTripId}.webm`;

            try {
                await recorder.recordAndDownload({
                    filename,
                    onProgress: (pct) => {
                        exportBtn.textContent = `⏳ Playing & Capturing: ${pct}%`;
                    }
                });
                exportBtn.textContent = '✓ Video Saved!';
                setTimeout(() => {
                    exportBtn.disabled = false;
                    exportBtn.textContent = '🎬 Replay & Save Video';
                }, 3000);
            } catch (err) {
                console.error('Video recording failed:', err);
                exportBtn.disabled = false;
                exportBtn.textContent = '🎬 Replay & Save Video';
                if (exportStatus) exportStatus.textContent = err.message;
            }
        });
    }
}

function updateUrlParams() {
    const params = new URLSearchParams();
    if (currentUser) params.set('user', currentUser);
    if (currentTripId) params.set('id', currentTripId);
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
}

document.addEventListener('DOMContentLoaded', init);
