/**
 * Träwelling Journey Animation Controller
 * Coordinates SessionDB, URL parameters, trip selection, Remotion Player, and video recording
 */

import React from 'https://esm.sh/react@18.3.1';
import ReactDOM from 'https://esm.sh/react-dom@18.3.1/client';
import htm from 'https://esm.sh/htm@3.1.1';
import { Player } from 'https://esm.sh/@remotion/player@4.0.539?deps=react@18.3.1,remotion@4.0.539';

import { SessionDB } from '../cache/session.js';
import { SAMPLE_FIXTURE_TRIPS } from '../app.js';
import { syncNavigationLinks } from '../ui/navigation.js';
import { escapeHtml } from '../utils/format.js';
import { TripStoryComposition } from './composition.js';
import { RemotionRecorder } from './recorder.js';

const html = htm.bind(React.createElement);

// Aspect ratio configurations
const ASPECT_CONFIGS = {
    story: {
        label: 'Story (9:16)',
        width: 720,
        height: 1280,
        playerStyle: { width: '337px', height: '600px' }
    },
    landscape: {
        label: 'Widescreen (16:9)',
        width: 1280,
        height: 720,
        playerStyle: { width: '640px', height: '360px' }
    },
    square: {
        label: 'Square (1:1)',
        width: 1080,
        height: 1080,
        playerStyle: { width: '460px', height: '460px' }
    }
};

let currentAspect = 'story';
let currentUser = '';
let currentTripId = '';
let currentTrip = null;
let userTrips = [];
let allSessions = [];
let playerRef = null;
let reactRoot = null;

async function init() {
    console.log('🎬 Initializing Träwelling Remotion Animation Studio...');

    // 1. Read URL query parameters
    const urlParams = new URLSearchParams(window.location.search);
    currentUser = (urlParams.get('user') || '').toLowerCase().trim();
    currentTripId = urlParams.get('id') || urlParams.get('trip') || urlParams.get('statusId') || '';

    // Synchronize navigation links (?user=...)
    syncNavigationLinks(currentUser);

    // 2. Load stored sessions
    try {
        allSessions = await SessionDB.getAll();
    } catch (e) {
        console.warn('SessionDB retrieval fallback:', e);
        allSessions = [];
    }

    // Default to 'resu' demo if no cached sessions exist
    if (!currentUser && allSessions.length > 0) {
        currentUser = allSessions[0].username || '';
    } else if (!currentUser) {
        currentUser = 'resu';
    }

    await loadUserTrips(currentUser);

    // 3. Render Profile and Trip Dropdowns
    renderSessionSelect();
    renderTripSelect();

    // 4. Mount Remotion Player
    renderPlayer();

    // 5. Setup UI Listeners
    setupControls();
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
            console.warn('Failed to load trips for user:', username, e);
        }
    }

    // Fallback to sample fixture trips if user is demo or has no cached trips
    if (userTrips.length === 0) {
        userTrips = SAMPLE_FIXTURE_TRIPS;
    }

    // Resolve current trip
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
    if (allSessions.length === 0) {
        options.push(`<option value="resu" ${currentUser === 'resu' ? 'selected' : ''}>Resu (Demo)</option>`);
    } else {
        allSessions.forEach(s => {
            const u = s.username || 'unknown';
            const d = s.displayName || u;
            const count = Array.isArray(s.trips) ? s.trips.length : 0;
            const isSelected = u.toLowerCase() === currentUser.toLowerCase();
            options.push(`<option value="${escapeHtml(u)}" ${isSelected ? 'selected' : ''}>${escapeHtml(d)} (@${escapeHtml(u)} · ${count} trips)</option>`);
        });
    }

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
    const noteEl = document.getElementById('sidebarNote');

    const train = trip.train || {};
    const line = train.lineName || 'Train';
    const origin = train.origin?.name || trip.origin || 'Origin';
    const dest = train.destination?.name || trip.destination || 'Destination';
    const dist = train.totalDistance ? (train.totalDistance / 1000).toFixed(1) + ' km' : '—';
    const delay = typeof train.departureDelay === 'number' ? `${Math.round(train.departureDelay / 60)} min` : '0 min';

    if (lineEl) lineEl.textContent = line;
    if (routeEl) routeEl.textContent = `${origin} → ${dest}`;
    if (distEl) distEl.textContent = dist;
    if (delayEl) delayEl.textContent = delay;
    if (noteEl) noteEl.textContent = trip.body ? `"${trip.body}"` : 'No notes attached';
}

function renderPlayer() {
    const container = document.getElementById('playerContainer');
    if (!container) return;

    if (!reactRoot) {
        reactRoot = ReactDOM.createRoot(container);
    }

    const cfg = ASPECT_CONFIGS[currentAspect] || ASPECT_CONFIGS.story;

    reactRoot.render(html`
        <div class="player-wrapper" style=${cfg.playerStyle}>
            <${Player}
                ref=${(ref) => { playerRef = ref; }}
                component=${TripStoryComposition}
                inputProps=${{ trip: currentTrip, username: currentUser }}
                durationInFrames=${180}
                compositionWidth=${cfg.width}
                compositionHeight=${cfg.height}
                fps=${30}
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
    // User Selector change
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

    // Trip Selector change
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

    // Aspect Ratio Pills
    document.querySelectorAll('.aspect-pill').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.aspect-pill').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentAspect = btn.dataset.aspect || 'story';
            renderPlayer();
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

            const recorder = new RemotionRecorder(playerRef);
            const lineName = (currentTrip?.train?.lineName || 'trip').replace(/[^a-zA-Z0-9_-]/g, '_');
            const filename = `traewelling-${currentUser}-${lineName}-${currentTripId}.webm`;

            try {
                await recorder.recordAndDownload({
                    filename,
                    onProgress: (pct) => {
                        exportBtn.textContent = `⏳ Rendering: ${pct}%`;
                    }
                });
                exportBtn.textContent = '✓ Video Downloaded!';
                setTimeout(() => {
                    exportBtn.disabled = false;
                    exportBtn.textContent = '🎬 Export Video (.webm)';
                }, 3000);
            } catch (err) {
                console.error('Video recording failed:', err);
                exportBtn.disabled = false;
                exportBtn.textContent = '⚠️ Export Failed (Try Chrome)';
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

