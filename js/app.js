import { CONFIG } from './config/config.js';
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
    const savedFetchStopovers = localStorage.getItem('tw_fetch_stopovers');
    const initialFetchStopovers = savedFetchStopovers !== null ? savedFetchStopovers === 'true' : true;
    if (setupStopoversToggle) setupStopoversToggle.checked = initialFetchStopovers;
    if (menuStopoversToggle) menuStopoversToggle.checked = initialFetchStopovers;

    const onStopoverToggleChange = (checked) => {
        try { localStorage.setItem('tw_fetch_stopovers', checked ? 'true' : 'false'); } catch (e) {}
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
    const storedToken = localStorage.getItem('tw_token');
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

    // Support ?user= query param to automatically explore a user profile
    const userParam = new URLSearchParams(window.location.search).get('user')?.toLowerCase();
    if (userParam) {
        const userInput = document.getElementById('username');
        if (userInput) {
            userInput.value = userParam;
        }
        startDataFetch(false);
    }

    // Preview query param handler for testing and automated screenshots (?preview=fetch|layers|search|stats)
    handlePreviewMode();

    // Handle visibility change for wake lock
    document.addEventListener('visibilitychange', async () => {
        const state = store ? store.get() : null;
        if (state?.isFetching && document.visibilityState === 'visible' && !UI.wakeLock) {
            await UI.acquireWakeLock();
        }
    });
}

/**
 * Preview harness for automated visual regression & headless debugging.
 */
function handlePreviewMode() {
    const previewMode = new URLSearchParams(window.location.search).get('preview');
    if (!previewMode) return;

    const sampleTrips = [
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
        const menuEl = document.getElementById('mainMenu');
        if (menuEl) menuEl.style.display = '';

        const state = store.get();
        state.username = 'hash';
        state.fetchedTrips = sampleTrips;
        state.activeTrips = sampleTrips;

        const categories = dataProcessing.processTripsToGeoJSON(sampleTrips);
        state.layers.order.forEach(layerId => {
            const cfg = CONFIG.LAYER_CONFIG.find(([id]) => id === layerId);
            const colorVal = cfg ? cfg[1] : '#888888';
            const data = categories[layerId] || { type: 'FeatureCollection', features: [] };
            state.layers.data.set(layerId, {
                data,
                color: colorVal,
                visible: true
            });
        });
        loadLayers();
        analytics.updateAllStatistics(sampleTrips);

        if (previewMode === 'layers') {
            const m = document.getElementById('mainMenu');
            if (m) { m.setAttribute('open', ''); m.open = true; }
            const l = document.getElementById('transportLayersSubmenu');
            if (l) { l.setAttribute('open', ''); l.open = true; }
        } else if (previewMode === 'search') {
            const m = document.getElementById('mainMenu');
            if (m) { m.setAttribute('open', ''); m.open = true; }
            const s = document.querySelectorAll('.menu-submenu');
            s.forEach(el => { if (el.textContent.includes('Search Trips')) { el.setAttribute('open', ''); el.open = true; } });
        } else if (previewMode === 'stats') {
            const panel = document.getElementById('statsPanel');
            if (panel) {
                panel.classList.add('active');
                panel.style.transition = 'none';
                panel.style.opacity = '1';
                document.body.classList.add('stats-open');
            }
            const m = document.getElementById('mainMenu');
            if (m) {
                m.open = false;
                m.removeAttribute('open');
            }
        }
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
