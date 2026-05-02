// Event listeners module
import { store } from '../state/store.js';
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
import { reloadAllLayers } from '../map/layers.js';
import { updateAllStatistics as updateAllStats } from '../analytics/statistics.js';

export function setupEventListeners() {
    const state = store.get();
    document.getElementById('statsToggle').onclick = () => {
        const panel = document.getElementById('statsPanel');
        panel.classList.toggle('active');
        if (panel.classList.contains('active')) {
            analytics.refreshStatsDisplay(state.statistics);
        }
    };
    document.getElementById('railwayToggle').onclick = () => {
        state.railway.enabled = !state.railway.enabled;
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
    
    // Initialize filter level from slider
    const filterSlider = document.getElementById('filterSlider');
    const filterState = document.getElementById('filterState');
    const filterTicks = document.getElementById('filterTicks').querySelectorAll('span');
    
    state.filters.filterLevel = parseInt(filterSlider.value);
    
    filterSlider.oninput = (e) => {
        const val = parseInt(e.target.value);
        state.filters.filterLevel = val;
        
        const labels = ['Off', 'Normal', 'Strict'];
        filterState.textContent = labels[val];
        
        filterTicks.forEach((span, i) => {
            span.classList.toggle('active', i <= val);
        });
        
        // Refresh active trips to apply accuracy filter
        const filteredTrips = refreshActiveTrips();
        
        // Update map layers
        state.datasetVersion++;
        state.heatmap.needsRebuild = true;
        state.heatmap.cacheKey = null;
        const categories = dataProcessing.processTripsToGeoJSON(filteredTrips);
        state.layers.order.forEach(layerId => {
            let data = categories[layerId] || { type: 'FeatureCollection', features: [] };
            const source = state.map.getSource(layerId);
            if (source) source.setData(data);
            const layer = state.layers.data.get(layerId);
            if (layer) layer.data = data;
        });
        updateAllStats();
        
        // Update heatmap if enabled
        if (state.heatmap.enabled) updateRouteDensity(true);
        
        // Update delay overlay
        invalidateDelayOverlayCache();
        if (state.delays.enabled) {
            updateDelayOverlay();
        } else {
            updateDelayOverlaySummary();
        }
    };

    document.getElementById('heatmapToggle').onchange = (e) => toggleHeatmap(e.target.checked);

    const intensitySlider = document.getElementById('intensitySlider');
    const intensityValueEl = document.getElementById('intensityValue');
    const intensityStateEl = document.getElementById('intensityState');
    const intensityTickEls = document.querySelectorAll('#intensityTicks span');

    const getIntensityState = (value) => {
        if (value <= 4) return 'low';
        if (value <= 9) return 'medium';
        return 'high';
    };

    const updateIntensityUI = (value) => {
        const stateKey = getIntensityState(value);
        if (intensityStateEl) {
            const label = stateKey.charAt(0).toUpperCase() + stateKey.slice(1);
            intensityStateEl.textContent = label;
        }
        intensityTickEls.forEach(tick => {
            tick.classList.toggle('active', tick.dataset.state === stateKey);
        });
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
    
    // Initialize business filter state from checkboxes
    state.filters.business.personal = document.getElementById('businessPersonal').checked;
    state.filters.business.work = document.getElementById('businessWork').checked;
    state.filters.business.commute = document.getElementById('businessCommute').checked;
    
    // Add business filter event listeners
    document.getElementById('businessPersonal').onchange = applyBusinessFilter;
    document.getElementById('businessWork').onchange = applyBusinessFilter;
    document.getElementById('businessCommute').onchange = applyBusinessFilter;
    document.getElementById('shareBtn').onclick = shareView;
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
                UI.syncTokenInputs(token);
                rememberToken(token, { autoValidate: false });
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
        menuFetchBtn.onclick = async () => {
            const token = menuApiToken.value.trim();
            const username = menuUsername.value.trim();
            if (!username) {
                alert('Please enter a username to query');
                return;
            }
            state.token = token || null;
            state.username = username;
            UI.syncTokenInputs(token);
            UI.syncUsernameInput(username);
            
            // Check if there's cached data for incremental fetch
            const session = await SessionDB.get(username);
            const hasCachedData = session?.trips && session.trips.length > 0;
            
            // Use incremental fetch if there's cached data
            startDataFetch(false, hasCachedData);
        };
    }
}

function applyTimeFilter() {
    const state = store.get();
    const from = document.getElementById('dateFrom').value || null;
    const to = document.getElementById('dateTo').value || null;
    state.filters.fromDate = from; state.filters.toDate = to;

    const filteredTrips = refreshActiveTrips();

    state.datasetVersion++;
    state.heatmap.needsRebuild = true;
    state.heatmap.cacheKey = null;
    const categories = dataProcessing.processTripsToGeoJSON(filteredTrips);
    state.layers.order.forEach(layerId => {
        let data = categories[layerId] || { type: 'FeatureCollection', features: [] };
        const source = state.map.getSource(layerId);
        if (source) source.setData(data);
        const layer = state.layers.data.get(layerId);
        if (layer) layer.data = data;
    });
    updateAllStats();
    if (state.heatmap.enabled) updateRouteDensity(true);
}

function applyBusinessFilter() {
    const state = store.get();
    state.filters.business.personal = document.getElementById('businessPersonal').checked;
    state.filters.business.work = document.getElementById('businessWork').checked;
    state.filters.business.commute = document.getElementById('businessCommute').checked;

    const filteredTrips = refreshActiveTrips();

    state.datasetVersion++;
    state.heatmap.needsRebuild = true;
    state.heatmap.cacheKey = null;
    const categories = dataProcessing.processTripsToGeoJSON(filteredTrips);
    state.layers.order.forEach(layerId => {
        let data = categories[layerId] || { type: 'FeatureCollection', features: [] };
        const source = state.map.getSource(layerId);
        if (source) source.setData(data);
        const layer = state.layers.data.get(layerId);
        if (layer) layer.data = data;
    });
    updateAllStats();
    if (state.heatmap.enabled) updateRouteDensity(true);
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

