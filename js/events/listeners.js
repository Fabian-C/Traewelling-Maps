// Event listeners module
import { store } from '../state/store.js';
import { escapeHtml } from '../utils/format.js';
import { RouteAnimation } from '../map/routeAnimation.js';
import { UI } from '../ui/ui.js';
import { TraewellingAPI } from '../api/traewelling.js';
import { invalidateDelayOverlayCache, updateDelayOverlay, updateDelayOverlaySummary, toggleDelayOverlay } from '../map/delayOverlay.js';
import { SessionDB } from '../cache/session.js';
import { applyAllFilters } from '../filters/filterManager.js';
import { updateRouteDensity, toggleHeatmap } from '../map/heatmap.js';
import { logout, rememberToken } from '../session/manager.js';
import { startDataFetch, refreshActiveTrips, processAndDisplayData } from '../fetch/orchestrator.js';
import * as dataProcessing from '../data/processing.js';
import * as analytics from '../analytics/statistics.js';
import { updateAllStatistics as updateAllStats } from '../analytics/statistics.js';
import { reloadAllLayers, loadLayers, syncMapLayerOrder } from '../map/layers.js';
import { exportTripsGeoJSON, handleStopoverToggleChange, handleGeoJSONUpload } from '../export/geojson.js';
import { clearRouteHighlight } from '../map/interactions.js';

export function setupEventListeners() {
    const state = store.get();

    // Ensure layers are populated when opening Transport Layers submenu
    const transportLayersSubmenu = document.getElementById('transportLayersSubmenu');
    if (transportLayersSubmenu) {
        transportLayersSubmenu.addEventListener('toggle', () => {
            if (transportLayersSubmenu.open) {
                loadLayers();
            }
        });
    }

    const toggleStatsPanel = (show) => {
        const panel = document.getElementById('statsPanel');
        if (!panel) return;
        const isActive = show !== undefined ? show : !panel.classList.contains('active');
        panel.classList.toggle('active', isActive);
        document.body.classList.toggle('stats-open', isActive);
        const statsToggle = document.getElementById('statsToggle');
        if (statsToggle) {
            statsToggle.classList.toggle('active', isActive);
            statsToggle.blur();
        }
        if (isActive) {
            analytics.refreshStatsDisplay(state.statistics);
        }
    };
    window.toggleStatsPanel = toggleStatsPanel;

    const statsToggleBtn = document.getElementById('statsToggle');
    if (statsToggleBtn) {
        statsToggleBtn.onclick = (e) => {
            e.stopPropagation();
            toggleStatsPanel();
        };
    }
    const statsCloseBtn = document.getElementById('statsCloseBtn');
    if (statsCloseBtn) {
        statsCloseBtn.onclick = () => toggleStatsPanel(false);
    }



    const railwayToggle = document.getElementById('railwayToggle');
    if (railwayToggle) {
        const toggleRailway = (e) => {
            if (e) e.stopPropagation();
            clearRouteHighlight();
            state.railway.enabled = !state.railway.enabled;
            railwayToggle.classList.toggle('active', state.railway.enabled);
            railwayToggle.blur();
            if (state.map && state.map.getLayer('open-railway-map')) {
                state.map.setLayoutProperty('open-railway-map', 'visibility', state.railway.enabled ? 'visible' : 'none');
            } else {
                setTimeout(() => {
                    if (state.map && state.map.getLayer('open-railway-map')) {
                        state.map.setLayoutProperty('open-railway-map', 'visibility', state.railway.enabled ? 'visible' : 'none');
                    }
                }, RouteAnimation.isMobile() ? 300 : 100);
            }
        };
        railwayToggle.onclick = toggleRailway;
        railwayToggle.onkeydown = (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleRailway(e);
            }
        };
    }
    
    // Initialize filter level from slider
    const filterSlider = document.getElementById('filterSlider');
    const filterState = document.getElementById('filterState');
    const filterTicks = document.getElementById('filterTicks')?.querySelectorAll('.tick-dot, span') || [];
    const labels = ['Off', 'Normal', 'Strict'];

    const setAccuracyFilterUI = (level) => {
        const clamped = Math.max(0, Math.min(2, Math.round(level)));
        if (filterSlider) {
            filterSlider.value = clamped;
            filterSlider.style.setProperty('--slider-progress', `${clamped * 50}%`);
        }
        if (filterState) {
            filterState.textContent = labels[clamped] || 'Normal';
            filterState.setAttribute('data-level', String(clamped));
        }
        filterTicks.forEach((dot, idx) => {
            dot.classList.toggle('active', idx === clamped);
            dot.classList.toggle('passed', idx <= clamped);
        });
    };

    const applyAccuracyLevel = (level) => {
        const target = Math.max(0, Math.min(2, Math.round(level)));
        const changed = state.filters.filterLevel !== target;
        state.filters.filterLevel = target;
        try {
            localStorage.setItem('tw_filter_level', target);
        } catch (_) {}
        setAccuracyFilterUI(target);
        if (changed) {
            applyFiltersAndRefresh({ debounceMs: 75 });
        }
    };

    if (filterSlider) {
        const savedLevel = typeof localStorage !== 'undefined' && localStorage.getItem('tw_filter_level') !== null 
            ? parseInt(localStorage.getItem('tw_filter_level'), 10) 
            : 1;
        state.filters.filterLevel = savedLevel;
        setAccuracyFilterUI(savedLevel);

        // Continuous dragging feedback: thumb moves freely and updates progress & label in real time
        filterSlider.oninput = () => {
            const raw = parseFloat(filterSlider.value);
            const nearest = Math.max(0, Math.min(2, Math.round(raw)));
            filterSlider.style.setProperty('--slider-progress', `${(raw / 2) * 100}%`);
            if (filterState) {
                filterState.textContent = labels[nearest] || 'Normal';
                filterState.setAttribute('data-level', String(nearest));
            }
            filterTicks.forEach((dot, idx) => {
                dot.classList.toggle('active', idx === nearest);
                dot.classList.toggle('passed', idx <= nearest);
            });
        };

        // When let go: dynamically snap directly to the nearest discrete position (0, 1, or 2)
        const snapToNearest = () => {
            const nearest = Math.max(0, Math.min(2, Math.round(parseFloat(filterSlider.value))));
            applyAccuracyLevel(nearest);
        };

        filterSlider.onchange = snapToNearest;
        filterSlider.addEventListener('pointerup', snapToNearest);
        filterSlider.addEventListener('touchend', snapToNearest);

        // Clicking on any tick dot directly snaps to that position
        filterTicks.forEach((dot) => {
            dot.addEventListener('click', (e) => {
                e.stopPropagation();
                const step = parseInt(dot.getAttribute('data-step'), 10);
                if (!isNaN(step)) {
                    applyAccuracyLevel(step);
                }
            });
        });
    }

    document.getElementById('heatmapToggle').onchange = (e) => toggleHeatmap(e.target.checked);

    const intensitySlider = document.getElementById('intensitySlider');
    const intensityValueEl = document.getElementById('intensityValue');

    const updateIntensityUI = (value) => {
        if (intensitySlider) {
            const min = parseInt(intensitySlider.min || '0', 10);
            const max = parseInt(intensitySlider.max || '1', 10);
            const clamped = Math.min(max, Math.max(min, value));
            const progress = ((clamped - min) / (max - min || 1)) * 100;
            intensitySlider.style.setProperty('--slider-progress', `${progress}%`);
        }
    };

    let heatmapDebounce = null;
    const scheduleHeatmapUpdate = () => {
        if (heatmapDebounce) clearTimeout(heatmapDebounce);
        heatmapDebounce = setTimeout(() => {
            if (state.heatmap.enabled) {
                updateRouteDensity(false);
            }
        }, 150);
    };

    if (intensitySlider && intensityValueEl) {
        const initialIntensity = parseInt(intensitySlider.value, 10) || 1;
        state.heatmap.intensity = initialIntensity;
        intensityValueEl.textContent = initialIntensity;
        updateIntensityUI(initialIntensity);

        intensitySlider.oninput = (e) => {
            const newIntensity = parseInt(e.target.value, 10) || 1;
            state.heatmap.intensity = newIntensity;
            intensityValueEl.textContent = e.target.value;
            updateIntensityUI(newIntensity);

            scheduleHeatmapUpdate();
        };
    }
    const delayToggle = document.getElementById('delayOverlayToggle');
    const delayCountSlider = document.getElementById('delayCountSlider');
    const delayCountValue = document.getElementById('delayCountValue');

    const syncDelayCount = (value) => {
        const sliderMin = delayCountSlider ? parseInt(delayCountSlider.min, 10) || 5 : 5;
        const sliderMax = delayCountSlider ? parseInt(delayCountSlider.max, 10) || 50 : 50;
        const clamped = Math.min(sliderMax, Math.max(sliderMin, value || sliderMin));
        state.delays.topCount = clamped;
        if (delayCountValue) delayCountValue.textContent = clamped;
        if (delayCountSlider && parseInt(delayCountSlider.value, 10) !== clamped) {
            delayCountSlider.value = clamped;
        }
    };

    if (delayCountSlider) {
        syncDelayCount(parseInt(delayCountSlider.value, 10) || state.delays.topCount);
        delayCountSlider.oninput = (e) => {
            const newValue = parseInt(e.target.value, 10) || state.delays.topCount;
            syncDelayCount(newValue);
            if (state.delays.enabled) {
                updateDelayOverlay();
            }
            updateDelayOverlaySummary();
        };
    } else {
        syncDelayCount(state.delays.topCount);
    }

    if (delayToggle) {
        delayToggle.checked = state.delays.enabled;
        delayToggle.onchange = (e) => {
            toggleDelayOverlay(e.target.checked);
        };
    }
    updateDelayOverlaySummary();
    document.getElementById('dateFrom').onchange = applyTimeFilter;
    document.getElementById('dateTo').onchange = applyTimeFilter;
    const resetDateBtn = document.getElementById('resetDateFilterBtn');
    if (resetDateBtn) {
        resetDateBtn.onclick = resetDateFilter;
    }
    
    // Travel Buddies submenu & companion filtering
    analytics.registerBuddySelectHandler(applyBuddyFilter);
    const clearBuddyBtn = document.getElementById('clearBuddyFilterBtn');
    if (clearBuddyBtn) {
        clearBuddyBtn.onclick = () => applyBuddyFilter(null);
    }
    const buddiesSubmenu = document.getElementById('travelBuddiesSubmenu');
    if (buddiesSubmenu) {
        buddiesSubmenu.addEventListener('toggle', () => {
            if (buddiesSubmenu.open) {
                analytics.updateMenuBuddyList(applyBuddyFilter);
            }
        });
    }

    // Toggle for including check-in note mentions in buddies
    const menuIncludeNoteMentions = document.getElementById('menuIncludeNoteMentions');
    if (menuIncludeNoteMentions) {
        menuIncludeNoteMentions.checked = !!state.filters.includeNoteMentions;
        menuIncludeNoteMentions.onchange = (e) => {
            const checked = e.target.checked;
            state.filters.includeNoteMentions = checked;
            try {
                localStorage.setItem('tw_include_notes', checked ? 'true' : 'false');
            } catch (err) {}

            // If trips are loaded, refresh buddy list and active filters
            if (state.fetchedTrips?.length) {
                analytics.updateMenuBuddyList(applyBuddyFilter);
                if (state.filters.buddies?.length) {
                    applyFiltersAndRefresh({ immediate: true });
                }
            }
        };
    }

    // Initialize business filter state from checkboxes
    state.filters.business.personal = document.getElementById('businessPersonal').checked;
    state.filters.business.work = document.getElementById('businessWork').checked;
    state.filters.business.commute = document.getElementById('businessCommute').checked;
    
    // Add business filter event listeners
    document.getElementById('businessPersonal').onchange = applyBusinessFilter;
    document.getElementById('businessWork').onchange = applyBusinessFilter;
    document.getElementById('businessCommute').onchange = applyBusinessFilter;
    
    // Add search filter event listener with debounce
    const searchInput = document.getElementById('tripSearchInput');
    const searchClearBtn = document.getElementById('tripSearchClearBtn');
    if (searchInput) {
        searchInput.oninput = () => {
            if (searchClearBtn) {
                searchClearBtn.style.display = searchInput.value ? 'inline-block' : 'none';
            }
            applySearchFilter();
        };
        searchInput.onkeydown = (e) => {
            if (e.key === 'Enter') {
                const state = store.get();
                state.filters.searchQuery = searchInput.value.trim();
                applyFiltersAndRefresh({ immediate: true });
                searchInput.blur();
            }
        };
    }
    if (searchClearBtn) {
        searchClearBtn.onclick = () => {
            if (searchInput) {
                searchInput.value = '';
                searchClearBtn.style.display = 'none';
            }
            const state = store.get();
            state.filters.searchQuery = '';
            applyFiltersAndRefresh({ immediate: true });
        };
    }

    // Share functionality temporarily disabled for future reimplementation
    const shareBtn = document.getElementById('shareBtn');
    if (shareBtn) shareBtn.onclick = shareView;
    document.getElementById('logoutBtn').onclick = logout;
    const animateToggle = document.getElementById('animateToggle');
    if (animateToggle) {
        // Initialize state from checkbox
        state.heatmap.animate = animateToggle.checked;
        
        animateToggle.onchange = (e) => {
            state.heatmap.animate = e.target.checked;
            if (state.heatmap.enabled) {
                if (state.heatmap.animate) {
                    RouteAnimation.start();
                } else {
                    RouteAnimation.stop();
                }
            }
        };
    }
    
    // New menu event listeners
    const menuValidateBtn = document.getElementById('menuValidateBtn');
    const menuCopyTokenBtn = document.getElementById('menuCopyTokenBtn');
    const menuFetchBtn = document.getElementById('menuFetchBtn');
    const menuApiToken = document.getElementById('menuApiToken');
    const menuUsername = document.getElementById('menuUsername');
    
    if (menuValidateBtn) {
        menuValidateBtn.onclick = async () => {
            const token = menuApiToken.value.trim();
            if (!token) {
                UI.setTokenStatus('Please enter a token', 'error');
                return;
            }
            menuValidateBtn.disabled = true;
            UI.setTokenStatus('Validating...', 'idle');
            try {
                const api = new TraewellingAPI(token);
                const user = await api.getAuthenticatedUser();
                state.tokenOwner = {
                    username: user.data.username,
                    displayName: user.data.displayName,
                    avatar: user.data.profilePicture,
                    profileUrl: `https://traewelling.de/profile/${user.data.username}`,
                    validated: true
                };
                UI.setTokenOwner(state.tokenOwner);
                UI.setTokenStatus('Token valid', 'success');
                state.token = token;
                state.authMethod = 'token';
                UI.syncTokenInputs(token);
                rememberToken(token, { autoValidate: false, authMethod: 'token' });
            } catch (error) {
                UI.setTokenStatus('Invalid token', 'error');
                state.tokenOwner.validated = false;
            } finally {
                menuValidateBtn.disabled = false;
            }
        };
    }
    
    if (menuCopyTokenBtn) {
        menuCopyTokenBtn.onclick = () => {
            const token = menuApiToken.value;
            if (!token) return;
            navigator.clipboard.writeText(token).then(() => {
                menuCopyTokenBtn.textContent = 'Copied!';
                setTimeout(() => {
                    menuCopyTokenBtn.textContent = 'Copy Token';
                }, 2000);
            });
        };
    }
    
    if (menuFetchBtn) {
        menuFetchBtn.onclick = async (e) => {
            const token = menuApiToken.value.trim();
            const username = menuUsername.value.trim();
            if (!username) {
                alert('Please enter a username to query');
                return;
            }
            state.token = token || null;
            state.username = username.toLowerCase();
            UI.syncTokenInputs(token);
            UI.syncUsernameInput(username);
            
            // Incremental fetch by default if cached user data exists, Shift+click for fresh re-scrape
            const menuStopoversEl = document.getElementById('menuFetchIncludeStopovers') || document.getElementById('fetchIncludeStopovers');
            const shouldFetchStopovers = menuStopoversEl ? menuStopoversEl.checked : (localStorage.getItem('tw_fetch_stopovers') !== 'false');
            startDataFetch(false, false, { forceFresh: Boolean(e?.shiftKey), fetchStopovers: shouldFetchStopovers });
        };
    }

    // GeoJSON Export listeners
    const exportActiveBtn = document.getElementById('exportActiveGeoJsonBtn');
    if (exportActiveBtn) {
        exportActiveBtn.onclick = () => exportTripsGeoJSON('active', 'download');
    }
    const exportAllBtn = document.getElementById('exportAllGeoJsonBtn');
    if (exportAllBtn) {
        exportAllBtn.onclick = () => exportTripsGeoJSON('all', 'download');
    }
    const copyGeoJsonBtn = document.getElementById('copyGeoJsonBtn');
    if (copyGeoJsonBtn) {
        copyGeoJsonBtn.onclick = () => exportTripsGeoJSON('active', 'copy');
    }
    const exportIncludeStopovers = document.getElementById('exportIncludeStopovers');
    if (exportIncludeStopovers) {
        exportIncludeStopovers.addEventListener('change', handleStopoverToggleChange);
    }

    // Setup Screen GeoJSON file upload & dropzone
    const setupFileInput = document.getElementById('setupFileInput');
    const setupFileDropzone = document.getElementById('setupFileDropzone');
    if (setupFileInput && setupFileDropzone) {
        setupFileDropzone.onclick = () => setupFileInput.click();
        setupFileDropzone.onkeydown = (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setupFileInput.click();
            }
        };
        setupFileInput.onchange = (e) => {
            const file = e.target.files?.[0];
            if (file) handleGeoJSONUpload(file);
            e.target.value = '';
        };
        setupFileDropzone.ondragover = (e) => {
            e.preventDefault();
            setupFileDropzone.classList.add('drag-active');
        };
        setupFileDropzone.ondragleave = () => {
            setupFileDropzone.classList.remove('drag-active');
        };
        setupFileDropzone.ondrop = (e) => {
            e.preventDefault();
            setupFileDropzone.classList.remove('drag-active');
            const file = e.dataTransfer?.files?.[0];
            if (file) handleGeoJSONUpload(file);
        };
    }

    // Menu GeoJSON file upload
    const menuFileInput = document.getElementById('menuFileInput');
    const menuImportBtn = document.getElementById('menuImportBtn');
    if (menuFileInput && menuImportBtn) {
        menuImportBtn.onclick = () => menuFileInput.click();
        menuFileInput.onchange = (e) => {
            const file = e.target.files?.[0];
            if (file) handleGeoJSONUpload(file);
            e.target.value = '';
        };
    }

    // Global drag & drop on window
    let windowDragDepth = 0;
    window.addEventListener('dragenter', (e) => {
        e.preventDefault();
        windowDragDepth++;
        if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
            document.body.classList.add('drag-over');
        }
    });
    window.addEventListener('dragleave', (e) => {
        e.preventDefault();
        windowDragDepth--;
        if (windowDragDepth <= 0) {
            windowDragDepth = 0;
            document.body.classList.remove('drag-over');
        }
    });
    window.addEventListener('dragover', (e) => {
        e.preventDefault();
    });
    window.addEventListener('drop', (e) => {
        e.preventDefault();
        windowDragDepth = 0;
        document.body.classList.remove('drag-over');
        const file = e.dataTransfer?.files?.[0];
        const fileName = (file?.name || '').toLowerCase();
        if (file && (fileName.endsWith('.geojson') || fileName.endsWith('.json') || file.type?.includes('json'))) {
            handleGeoJSONUpload(file);
        }
    });
}

let pendingFilterRaf = null;
let pendingFilterTimer = null;

/**
 * Centrally schedules filter application using requestAnimationFrame and optional debounce
 * to prevent frame drops and redundant GPU buffer re-uploads during rapid user interactions.
 */
export function applyFiltersAndRefresh({ immediate = false, debounceMs = 0, updateOverlay = true } = {}) {
    clearRouteHighlight();
    if (pendingFilterTimer) {
        clearTimeout(pendingFilterTimer);
        pendingFilterTimer = null;
    }
    if (pendingFilterRaf) {
        cancelAnimationFrame(pendingFilterRaf);
        pendingFilterRaf = null;
    }

    const execute = () => {
        const state = store.get();
        const filteredTrips = refreshActiveTrips();

        state.datasetVersion++;
        state.heatmap.needsRebuild = true;
        state.heatmap.cacheKey = null;

        const categories = dataProcessing.processTripsToGeoJSON(filteredTrips);
        let missingApproxLayer = false;
        state.layers.order.forEach(layerId => {
            const data = categories[layerId] || { type: 'FeatureCollection', features: [] };
            const source = state.map?.getSource(layerId);
            if (source) source.setData(data);
            const layer = state.layers.data.get(layerId);
            if (layer) layer.data = data;
            if (state.map && !state.map.getLayer(`${layerId}-approximated`)) {
                missingApproxLayer = true;
            }
        });

        if (missingApproxLayer && state.map) {
            syncMapLayerOrder();
        }

        loadLayers();
        updateAllStats();
        if (state.heatmap.enabled) updateRouteDensity(true);

        if (updateOverlay) {
            invalidateDelayOverlayCache();
            if (state.delays.enabled) {
                updateDelayOverlay();
            } else {
                updateDelayOverlaySummary();
            }
        }

        analytics.updateMenuBuddyList(applyBuddyFilter);
        updateFilterBadges();
    };

    if (immediate) {
        execute();
    } else if (debounceMs > 0) {
        pendingFilterTimer = setTimeout(() => {
            pendingFilterRaf = requestAnimationFrame(execute);
        }, debounceMs);
    } else {
        pendingFilterRaf = requestAnimationFrame(execute);
    }
}

function applyTimeFilter() {
    const state = store.get();
    const from = document.getElementById('dateFrom').value || null;
    const to = document.getElementById('dateTo').value || null;
    state.filters.fromDate = from;
    state.filters.toDate = to;
    applyFiltersAndRefresh({ debounceMs: 60 });
}

function applyBusinessFilter() {
    const state = store.get();
    state.filters.business.personal = document.getElementById('businessPersonal').checked;
    state.filters.business.work = document.getElementById('businessWork').checked;
    state.filters.business.commute = document.getElementById('businessCommute').checked;
    applyFiltersAndRefresh({ immediate: true });
}

function applySearchFilter() {
    const state = store.get();
    const searchInput = document.getElementById('tripSearchInput');
    state.filters.searchQuery = searchInput ? searchInput.value.trim() : '';
    applyFiltersAndRefresh({ debounceMs: 200 });
}

function shareView() {
    const state = store.get();
    const center = state.map.getCenter(), zoom = state.map.getZoom();
    const url = window.location.origin + window.location.pathname + '#map=' + zoom + '/' + center.lat + '/' + center.lng;
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(url).then(() => {
            const msg = document.createElement('div');
            msg.style.cssText = 'position:fixed;top:20px;right:20px;background:#4CAF50;color:white;padding:10px 20px;border-radius:5px;z-index:10000;';
            msg.textContent = 'Link copied!';
            document.body.appendChild(msg);
            setTimeout(() => msg.remove(), 2000);
        });
    } else {
        prompt('Share this link:', url);
    }
}

export function applyBuddyFilter(buddy) {
    const state = store.get();
    if (!state.filters.buddies) state.filters.buddies = [];

    if (!buddy) {
        state.filters.buddies = [];
    } else {
        const lower = buddy.toLowerCase().trim();
        const existingIndex = state.filters.buddies.findIndex(b => b.toLowerCase().trim() === lower);
        if (existingIndex >= 0) {
            state.filters.buddies.splice(existingIndex, 1);
        } else {
            state.filters.buddies.push(buddy);
        }
    }

    applyFiltersAndRefresh({ immediate: true });
}

function resetDateFilter() {
    const state = store.get();
    state.filters.fromDate = null;
    state.filters.toDate = null;
    analytics.initializeDateInputs(state.fetchedTrips);
    applyFiltersAndRefresh({ immediate: true });
}

/**
 * Reset all active filters (date, business, buddy, search) back to defaults
 */
export function resetAllActiveFilters() {
    const state = store.get();
    state.filters.fromDate = null;
    state.filters.toDate = null;
    state.filters.buddies = [];
    state.filters.buddy = null;
    state.filters.searchQuery = '';
    state.filters.business = { personal: true, work: true, commute: true };
    state.filters.filterLevel = 1;
    try {
        localStorage.setItem('tw_filter_level', '1');
    } catch (_) {}

    // Reset UI inputs
    analytics.initializeDateInputs(state.fetchedTrips);
    const filterSlider = document.getElementById('filterSlider');
    const filterState = document.getElementById('filterState');
    const filterTicks = document.getElementById('filterTicks')?.querySelectorAll('.tick-dot, span') || [];
    if (filterSlider) {
        filterSlider.value = 1;
        filterSlider.style.setProperty('--slider-progress', '50%');
        if (filterState) {
            filterState.textContent = 'Normal';
            filterState.setAttribute('data-level', '1');
        }
        filterTicks.forEach((dot, i) => {
            dot.classList.toggle('active', i === 1);
            dot.classList.toggle('passed', i <= 1);
        });
    }
    const p = document.getElementById('businessPersonal');
    const w = document.getElementById('businessWork');
    const c = document.getElementById('businessCommute');
    if (p) p.checked = true;
    if (w) w.checked = true;
    if (c) c.checked = true;

    const s = document.getElementById('tripSearchInput');
    if (s) s.value = '';
    const clr = document.getElementById('tripSearchClearBtn');
    if (clr) clr.style.display = 'none';

    applyFiltersAndRefresh({ immediate: true });
}

/**
 * Updates floating active filter badges on the map
 */
export function updateFilterBadges() {
    const state = store.get();
    const badgesContainer = document.getElementById('activeFilterBadges');
    if (!badgesContainer) return;

    const badges = [];

    // Date range badge
    if (state.filters.fromDate || state.filters.toDate) {
        const label = state.filters.fromDate && state.filters.toDate
            ? `${state.filters.fromDate} → ${state.filters.toDate}`
            : (state.filters.fromDate ? `From ${state.filters.fromDate}` : `Until ${state.filters.toDate}`);
        badges.push({
            id: 'date',
            icon: '📅',
            text: label,
            onClear: () => resetDateFilter()
        });
    }

    // Buddy badges (individual badges for each selected companion)
    const selectedBuddies = state.filters.buddies || (state.filters.buddy ? [state.filters.buddy] : []);
    selectedBuddies.forEach((buddyUser, idx) => {
        badges.push({
            id: `buddy-${idx}`,
            icon: '👤',
            text: `@${buddyUser}`,
            onClear: () => applyBuddyFilter(buddyUser)
        });
    });

    // Search query badge
    if (state.filters.searchQuery) {
        badges.push({
            id: 'search',
            icon: '🔍',
            text: `"${state.filters.searchQuery}"`,
            onClear: () => {
                const s = document.getElementById('tripSearchInput');
                if (s) s.value = '';
                const c = document.getElementById('tripSearchClearBtn');
                if (c) c.style.display = 'none';
                applySearchFilter();
            }
        });
    }



    // Business type filter badge (if not all checked)
    const b = state.filters.business;
    if (b && (!b.personal || !b.work || !b.commute)) {
        const types = [];
        if (b.personal) types.push('Personal');
        if (b.work) types.push('Work');
        if (b.commute) types.push('Commute');
        badges.push({
            id: 'business',
            icon: '💼',
            text: types.length ? types.join(', ') : 'None',
            onClear: () => {
                const bp = document.getElementById('businessPersonal');
                const bw = document.getElementById('businessWork');
                const bc = document.getElementById('businessCommute');
                if (bp) bp.checked = true;
                if (bw) bw.checked = true;
                if (bc) bc.checked = true;
                applyBusinessFilter();
            }
        });
    }

    if (badges.length === 0) {
        badgesContainer.style.display = 'none';
        badgesContainer.innerHTML = '';
        return;
    }

    badgesContainer.style.display = 'flex';
    badgesContainer.innerHTML = badges.map(b => `
        <div class="filter-badge" data-badge="${b.id}">
            <span>${b.icon} ${escapeHtml(b.text)}</span>
            <button type="button" class="filter-badge-clear" data-badge-id="${b.id}" aria-label="Clear filter">✕</button>
        </div>
    `).join('') + `
        <button type="button" class="filter-badge-reset-all" id="badgeResetAllBtn">Clear All</button>
    `;

    badges.forEach(b => {
        const btn = badgesContainer.querySelector(`[data-badge-id="${b.id}"]`);
        if (btn) btn.onclick = b.onClear;
    });

    const resetAllBtn = badgesContainer.querySelector('#badgeResetAllBtn');
    if (resetAllBtn) resetAllBtn.onclick = resetAllActiveFilters;
}


