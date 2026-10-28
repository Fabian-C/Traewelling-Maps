import { CONFIG } from './config/config.js';
import { Storage, STORAGE_KEYS } from './storage/storage.js';
import * as geometry from './utils/geometry.js';
import * as color from './utils/color.js';
import * as math from './utils/math.js';
import * as format from './utils/format.js';
import * as time from './utils/time.js';
import * as dataUtils from './utils/data.js';

import { SessionDB } from './cache/session.js';
import { TraewellingAPI } from './api/traewelling.js';
import * as dataProcessing from './data/processing.js';
import * as analytics from './analytics/statistics.js';
import * as heatmap from './map/heatmap.js';

import { UI } from './ui/ui.js';
import { RateLimitUI } from './ui/rateLimit.js';

import { store, initializeState } from './state/store.js';

import { RouteAnimation, isDensityActive } from './map/routeAnimation.js';
import { loadLayers, toggleLayer, reloadAllLayers } from './map/layers.js';
import {
    initMap,
    fitMapToData,
    waitForMapReady,
    setupMapInteractions,
    showPopup,
    highlightRoute,
    clearRouteHighlight,
    findOverlayFeatureAtPoint
} from './map/interactions.js';
import {
    toggleDelayOverlay,
    removeDelayOverlay,
    updateDelayOverlay,
    updateDelayOverlaySummary,
    updateHeatmapColors,
    getPixelRadiusKm,
    getDelayOverlayFeatureAtLngLat,
    buildFeatureFromDelayOverlay,
    invalidateDelayOverlayCache
} from './map/delayOverlay.js';

import {
    startDataFetch,
    cancelFetch,
    showFetchError,
    refreshActiveTrips,
    processAndDisplayData
} from './fetch/orchestrator.js';

import {
    fetchUserProfile,
    saveCurrentSession,
    loadSessionByUsername,
    deleteSession,
    clearAllSessions,
    updateMenuAccountList,
    rememberToken,
    validateStoredToken,
    logout,
    handleOAuthCallbackProcess,
    OAuth
} from './session/manager.js';

import { setupEventListeners } from './events/listeners.js';
import { exportTripsGeoJSON } from './export/geojson.js';

/**
 * =========================================================================
 * Träwelling Map Explorer - Main Application Entrypoint
 * =========================================================================
 * ARCHITECTURE NOTE FOR FUTURE AI AGENTS & DEVELOPERS:
 * - This file orchestrates application bootstrap, event binding, and preview modes.
 * - Subsystems communicate primarily via ES module imports and the reactive store
 *   (`store.js`).
 * - Window globals (`window.*`) are maintained strictly for backward compatibility
 *   with external devtools, console debugging, and legacy callbacks.
 */

// Backward-compatibility bridge for window object
window.SessionDB = SessionDB;
window.UI = UI;
window.RateLimitUI = RateLimitUI;
window.RouteAnimation = RouteAnimation;
window.toggleDelayOverlay = toggleDelayOverlay;
window.toggleLayer = toggleLayer;
window.setBaseLayerVisibility = heatmap.setBaseLayerVisibility;
window.applyBaseLayerOpacity = heatmap.applyBaseLayerOpacity;
window.startDataFetch = startDataFetch;
window.cancelFetch = cancelFetch;
window.showFetchError = showFetchError;
window.processAndDisplayData = processAndDisplayData;
window.saveCurrentSession = saveCurrentSession;
window.loadSessionByUsername = loadSessionByUsername;
window.deleteSession = deleteSession;
window.logout = logout;
window.rememberToken = rememberToken;
window.updateMenuAccountList = updateMenuAccountList;
window.reloadAllLayers = reloadAllLayers;
window.loadLayers = loadLayers;
window.CONFIG = CONFIG;
window.validateStoredToken = validateStoredToken;
window.initializeState = initializeState;
window.store = store;
window.exportTripsGeoJSON = exportTripsGeoJSON;
window.OAuth = OAuth;
window.handleOAuthCallbackProcess = handleOAuthCallbackProcess;

// Status banner close buttons
export function setupBannerHandlers() {
    document.querySelectorAll('.status-banner').forEach((banner) => {
        const closeBtn = banner.querySelector('[data-banner-close]');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => banner.classList.add('hidden'));
        }
    });
}

/**
 * Main application initialization sequence.
 * Executed as soon as the DOM is interactive.
 */
export async function initApp() {
    UI.init();
    UI.bindGlobalActions();
    RateLimitUI.init();
    updateMenuAccountList();
    loadLayers();
    setupEventListeners();
    setupBannerHandlers();

    // Intermediate stopovers persistence toggle synchronization
    const setupStopoversToggle = document.getElementById('fetchIncludeStopovers');
    const menuStopoversToggle = document.getElementById('menuFetchIncludeStopovers');
    const savedFetchStopovers = Storage.get(STORAGE_KEYS.FETCH_STOPOVERS);
    const initialFetchStopovers = savedFetchStopovers !== null ? savedFetchStopovers === 'true' : true;
    if (setupStopoversToggle) setupStopoversToggle.checked = initialFetchStopovers;
    if (menuStopoversToggle) menuStopoversToggle.checked = initialFetchStopovers;

    const onStopoverToggleChange = (checked) => {
        Storage.set(STORAGE_KEYS.FETCH_STOPOVERS, checked ? 'true' : 'false');
        if (setupStopoversToggle) setupStopoversToggle.checked = checked;
        if (menuStopoversToggle) menuStopoversToggle.checked = checked;
    };

    if (setupStopoversToggle) {
        setupStopoversToggle.addEventListener('change', (e) => onStopoverToggleChange(e.target.checked));
    }
    if (menuStopoversToggle) {
        menuStopoversToggle.addEventListener('change', (e) => onStopoverToggleChange(e.target.checked));
    }

    // Setup screen fetch action
    const startFetchBtn = document.getElementById('startFetchBtn');
    if (startFetchBtn) {
        startFetchBtn.onclick = (e) => {
            const userField = document.getElementById('username');
            const target = userField?.value?.trim();
            if (target) {
                const st = store ? store.get() : (window.state || {});
                if (st.username && st.username.toLowerCase() !== target.toLowerCase()) {
                    st.fetchProgress = null;
                    st.queriedUserProfile = null;
                    st.fetchedTrips = [];
                    st.activeTrips = [];
                }
                st.username = target.toLowerCase();
                if (UI?.syncUsernameInput) {
                    UI.syncUsernameInput(target);
                }
            }
            const shouldFetchStopovers = setupStopoversToggle?.checked ?? true;
            startDataFetch(false, false, { forceFresh: Boolean(e?.shiftKey), fetchStopovers: shouldFetchStopovers });
        };
    }

    const usernameInput = document.getElementById('username');
    if (usernameInput) {
        usernameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                startFetchBtn?.click();
            }
        });
        // Auto-focus username input on setup screen if empty
        if (!usernameInput.value && !new URLSearchParams(window.location.search).has('user')) {
            usernameInput.focus();
        }
    }

    const cancelBtn = document.getElementById('cancelFetchBtn');
    if (cancelBtn) cancelBtn.onclick = cancelFetch;

    const oauthBtn = document.getElementById('oauthLoginBtn');
    if (oauthBtn) {
        oauthBtn.onclick = () => OAuth.startLogin();
    }

    const pasteBtn = document.getElementById('pasteTokenBtn');
    if (pasteBtn) {
        pasteBtn.onclick = async () => {
            try {
                if (!navigator.clipboard?.readText) {
                    alert('Clipboard access not supported by your browser. Please tap and paste into the field.');
                    return;
                }
                const clipText = await navigator.clipboard.readText();
                if (clipText) {
                    const tokenField = document.getElementById('apiToken');
                    if (tokenField) tokenField.value = clipText.trim();
                    pasteBtn.textContent = '✅ Pasted';
                    setTimeout(() => { pasteBtn.textContent = '📋 Paste'; }, 2000);
                }
            } catch (err) {
                alert('Could not access clipboard automatically. Please tap and paste into the field.');
            }
        };
    }

    const authLogoutBtn = document.getElementById('authLogoutBtn');
    if (authLogoutBtn) {
        authLogoutBtn.onclick = () => logout();
    }

    // Check if returning from OAuth redirect callback (?code=...)
    const hasOAuthCode = new URLSearchParams(window.location.search).has('code');
    if (hasOAuthCode) {
        if (oauthBtn) {
            oauthBtn.disabled = true;
            oauthBtn.innerHTML = '<span class="oauth-spinner"></span> Connecting with Träwelling...';
        }
        await handleOAuthCallbackProcess();
        if (oauthBtn) {
            oauthBtn.disabled = false;
            oauthBtn.innerHTML = '<span class="oauth-icon">🚆</span><span>Log in with Träwelling</span>';
        }
    }

    // Auto-validate stored token
    const storedToken = Storage.get(STORAGE_KEYS.TOKEN);
    if (storedToken) {
        validateStoredToken(storedToken);
    }

    // Deep-link viewport coordinates hash (#map=zoom/lat/lng)
    if (window.location.hash?.startsWith('#map=')) {
        const parts = window.location.hash.substring(5).split('/');
        if (parts.length === 3) {
            const [zoom, lat, lng] = parts.map(parseFloat);
            if (!isNaN(zoom) && !isNaN(lat) && !isNaN(lng)) {
                waitForMapReady().then(() => {
                    const map = store?.get()?.map || window.state?.map;
                    if (map) map.jumpTo({ center: [lng, lat], zoom });
                });
            }
        }
    }

    // Support ?user= and/or ?trip= / ?id= query params
    // If the user or checkin already exists in IndexedDB, load it directly without forcing the query dialog
    const urlParams = new URLSearchParams(window.location.search);
    const userParam = urlParams.get('user')?.toLowerCase();
    const deepTripId = urlParams.get('id') || urlParams.get('trip') || urlParams.get('statusId') || urlParams.get('status');

    let sessionToLoad = null;
    try {
        if (userParam) {
            const cached = await SessionDB.get(userParam);
            if (cached?.trips?.length > 0) {
                sessionToLoad = cached.username;
            }
        }
        if (!sessionToLoad && deepTripId) {
            const allSessions = await SessionDB.getAll();
            const found = allSessions.find(s => Array.isArray(s.trips) && s.trips.some(t => String(t.id) === String(deepTripId)));
            if (found) {
                sessionToLoad = found.username;
            }
        }
        // If not cached in IndexedDB yet, resolve from fixture dataset for deep links and demo users
        if (!sessionToLoad && (userParam === 'resu' || (deepTripId && SAMPLE_FIXTURE_TRIPS.some(t => String(t.id) === String(deepTripId))))) {
            sessionToLoad = 'resu';
            try {
                await SessionDB.save('resu', SAMPLE_FIXTURE_TRIPS, { displayName: 'Resu (Demo)' });
            } catch (e) {}
        }
    } catch (e) {
        console.warn('Failed to check IndexedDB for session quick-load:', e);
    }

    if (sessionToLoad) {
        console.log(`⚡ Instant load for @${sessionToLoad} from IndexedDB without query modal`);
        const setupEl = document.getElementById('setupScreen');
        if (setupEl) setupEl.classList.add('hidden');
        await loadSessionByUsername(sessionToLoad);
    } else if (userParam) {
        const userInput = document.getElementById('username');
        if (userInput) {
            userInput.value = userParam;
        }
        startDataFetch(false);
    }

    // Preview query param handler for testing and automated screenshots (?preview=fetch|layers|search|stats)
    handlePreviewMode();

    // Handle visibility change, focus, and online state for wake lock and animation retuning
    const onWakeAndRetune = async () => {
        const state = store ? store.get() : null;
        if (document.visibilityState === 'visible') {
            if (state?.isFetching && !UI.wakeLock) {
                await UI.acquireWakeLock();
            }
            if (UI?.retuneCargoAnimation) {
                UI.retuneCargoAnimation();
            }
        }
    };

    document.addEventListener('visibilitychange', onWakeAndRetune);
    window.addEventListener('focus', onWakeAndRetune);
    window.addEventListener('online', onWakeAndRetune);
}

export const SAMPLE_FIXTURE_TRIPS = [
    {
        id: 325374,
        body: "Ferry cruise on the Elbe with @Fabi",
        bodyMentions: [{ id: 1, username: "Fabi" }],
        createdAt: "2022-04-16T16:49:46+00:00",
        train: {
            category: "ferry",
            lineName: "Fäh 62",
            totalDistance: 22590,
            departureDelay: 120,
            origin: { name: "Hamburg Landungsbrücken" },
            destination: { name: "Dockland" },
            polyline: {
                type: "Feature",
                geometry: { type: "LineString", coordinates: [[9.970619, 53.546314], [9.952236, 53.54395], [9.935498, 53.543024]] },
                properties: { statusId: 325374 }
            }
        }
    },
    {
        id: 9309802,
        body: "Evening ride home with @Fabi",
        bodyMentions: [{ id: 1, username: "Fabi" }],
        createdAt: "2026-10-11T18:46:00+00:00",
        train: {
            category: "suburban",
            lineName: "S9",
            totalDistance: 14030,
            departureDelay: 300,
            origin: { name: "Friedrichstraße" },
            destination: { name: "Alexanderplatz" },
            polyline: {
                type: "Feature",
                geometry: { type: "LineString", coordinates: [[13.38635, 52.520424], [13.400, 52.521], [13.411, 52.522]] },
                properties: { statusId: 9309802 }
            }
        }
    },
    {
        id: 8877665,
        body: "Regional connection (fallback straight section)",
        createdAt: "2026-10-12T10:00:00+00:00",
        train: {
            category: "regional",
            lineName: "RE 1",
            totalDistance: 280000,
            departureDelay: 0,
            origin: { name: "Hamburg Hbf" },
            destination: { name: "Berlin Hbf" },
            polyline: {
                type: "Feature",
                geometry: {
                    type: "LineString",
                    coordinates: [[10.0069, 53.5533], [13.3695, 52.5255]]
                },
                properties: { statusId: 8877665 }
            }
        }
    }
];

/**
 * Preview harness for automated visual regression & headless debugging.
 */
function handlePreviewMode() {
    const previewMode = new URLSearchParams(window.location.search).get('preview');
    if (!previewMode) return;

    const sampleTrips = SAMPLE_FIXTURE_TRIPS;

    if (previewMode === 'fetch') {
        UI.toggleSetup(false);
        UI.toggleFetch(true);
        UI.resetCargoAnimation();
        UI.addPacketToDepot(1);
        UI.addPacketToDepot(2);
        UI.updateFetchStats({ status: 'Fetching page 2...', trips: 30, pages: 2, routes: 15, progress: 50 });
    } else {
        const setupEl = document.getElementById('setupScreen');
        if (setupEl) setupEl.classList.add('hidden');
        const m = document.getElementById('mainMenu');
        if (m && previewMode !== 'stats') {
            m.style.display = '';
            m.setAttribute('open', '');
            m.open = true;
        }
        if (previewMode === 'search') {
            const s = document.getElementById('searchTripsSubmenu');
            if (s) { s.setAttribute('open', ''); s.open = true; }
        } else if (previewMode === 'layers') {
            const l = document.getElementById('transportLayersSubmenu');
            if (l) { l.setAttribute('open', ''); l.open = true; }
        }

        import('./fetch/orchestrator.js').then(async ({ processAndDisplayData }) => {
            try {
                await processAndDisplayData(sampleTrips, true);
            } catch (err) {
                console.warn('Preview processAndDisplayData error:', err);
            }

            if (previewMode === 'layers') {
                if (m) { m.style.display = ''; m.setAttribute('open', ''); m.open = true; }
                const l = document.getElementById('transportLayersSubmenu');
                if (l) { l.setAttribute('open', ''); l.open = true; }
            } else if (previewMode === 'search') {
                if (m) { m.style.display = ''; m.setAttribute('open', ''); m.open = true; }
                const s = document.getElementById('searchTripsSubmenu');
                if (s) { s.setAttribute('open', ''); s.open = true; }
            } else if (previewMode === 'stats') {
                const panel = document.getElementById('statsPanel');
                if (panel) {
                    panel.classList.add('active');
                    panel.style.transition = 'none';
                    panel.style.opacity = '1';
                    document.body.classList.add('stats-open');
                }
                if (m) {
                    m.open = false;
                    m.removeAttribute('open');
                }
            }
        }).catch(e => console.warn('Preview orchestrator import error:', e));
    }
}

// Auto-initialize state store
initializeState(dataUtils.createEmptyStats);

// Immediately render cached accounts from localStorage (0ms display on startup)
updateMenuAccountList();

// Boot application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
