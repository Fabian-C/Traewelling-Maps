// Data fetch orchestration module
import { CONFIG } from '../config/config.js';
import { store } from '../state/store.js';
import { SessionDB } from '../cache/session.js';
import { TraewellingAPI } from '../api/traewelling.js';
import * as dataProcessing from '../data/processing.js';
import * as analytics from '../analytics/statistics.js';
import * as heatmap from '../map/heatmap.js';
import { UI } from '../ui/ui.js';
import { RateLimitUI } from '../ui/rateLimit.js';
import { RouteAnimation } from '../map/routeAnimation.js';
import { applyAllFilters } from '../filters/filterManager.js';
import { loadLayers } from '../map/layers.js';
import { initMap, fitMapToData, waitForMapReady, setupMapInteractions } from '../map/interactions.js';
import { toggleDelayOverlay, updateDelayOverlay, updateDelayOverlaySummary, invalidateDelayOverlayCache } from '../map/delayOverlay.js';
import { fetchUserProfile, saveCurrentSession, rememberToken, logout } from '../session/manager.js';
import { FunFacts } from '../ui/funFacts.js';

export async function startDataFetch(resumeFromState = false, incremental = false) {
    const state = store.get();
    const token = state.token || document.getElementById('apiToken').value.trim();
    const username = state.username || document.getElementById('username').value.trim();
    if (!username) return alert('Please enter a username');

    state.token = token; state.username = username; state.isFetching = true;
    if (token) rememberToken(token, { autoValidate: false });
    state.cancelFetch = false;
    
    // Check for cached data for incremental fetch
    let cachedTrips = null;
    let oldestCachedTripId = null;
    if (incremental) {
        try {
            const session = await SessionDB.get(username);
            if (session?.trips && session.trips.length > 0) {
                cachedTrips = session.trips;
                // Get the oldest trip ID (trips are in reverse chronological order, so last one is oldest)
                oldestCachedTripId = cachedTrips[cachedTrips.length - 1]?.id;
                console.log(`Found ${cachedTrips.length} cached trips, oldest ID: ${oldestCachedTripId}`);
            }
        } catch (e) {
            console.warn('Failed to check cached data:', e);
        }
    }
    
    if (!resumeFromState) {
        state.fetchedTrips = cachedTrips || [];
        state.activeTrips = [];
        state.queriedUserProfile = null;
        state.fetchProgress = { page: 1, pagesFetchComplete: false, allStatuses: [], polylineCount: 0, processedPolylines: 0 };
        UI.resetCargoAnimation();
    } else {
        console.log('Resuming fetch from progress:', {
            page: state.fetchProgress?.page,
            trips: state.fetchProgress?.allStatuses?.length,
            polylines: state.fetchProgress?.polylineCount,
            processed: state.fetchProgress?.processedPolylines
        });
    }
    
    RateLimitUI.reset();
    UI.toggleSetup(false);
    UI.toggleFetch(true);
    UI.acquireWakeLock();
    FunFacts.start(); // Start fun facts flying text
    
    document.getElementById('fetchError').classList.add('hidden');
    document.getElementById('retryFetchBtn').classList.add('hidden');

    const handleRateLimit = (payload = {}) => {
        RateLimitUI.updateUsage(payload.used || 0);
        if (payload.waitMs) {
            RateLimitUI.showWaiting(payload.waitMs);
        } else {
            RateLimitUI.setStatus(payload.used ? 'Tracking API usage' : 'Ready');
        }
    };

    const api = new TraewellingAPI(token, { onRateLimitUpdate: handleRateLimit });
    try {
        if (token) {
            UI.updateFetchStats({ status: 'Validating token...' });
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
        } else {
            UI.updateFetchStats({ status: 'Fetching public data...' });
            UI.setTokenStatus('No token (public access)', 'idle');
        }
        
        if (!resumeFromState || !state.queriedUserProfile) {
            UI.updateFetchStats({ status: 'Fetching user profile...' });
            state.queriedUserProfile = await fetchUserProfile(username, token);
            
            if (state.queriedUserProfile) {
                UI.updateDatasetSummary(
                    state.queriedUserProfile.displayName,
                    state.queriedUserProfile.username,
                    0,
                    state.queriedUserProfile.avatar
                );
            }
        }

        let page = resumeFromState && state.fetchProgress ? state.fetchProgress.page : 1;
        let hasMore = true;
        const allStatuses = resumeFromState && state.fetchProgress ? [...state.fetchProgress.allStatuses] : [];

        const skipPageFetching = resumeFromState && state.fetchProgress && state.fetchProgress.pagesFetchComplete;
        
        if (!skipPageFetching) {
            while (hasMore && !state.cancelFetch) {
                UI.updateFetchStats({ status: `Fetching page ${page}...` });
                const response = await api.getUserStatuses(username, page);
                if (!response?.data?.length) { hasMore = false; break; }
                
                // For incremental fetch, check if we've hit the oldest cached trip
                if (incremental && oldestCachedTripId) {
                    const foundOldestIndex = response.data.findIndex(s => s.id === oldestCachedTripId);
                    if (foundOldestIndex !== -1) {
                        // Found the oldest cached trip, only add trips before it (newer trips)
                        allStatuses.push(...response.data.slice(0, foundOldestIndex));
                        console.log(`Found oldest cached trip at index ${foundOldestIndex} on page ${page}, stopping incremental fetch`);
                        hasMore = false;
                        break;
                    }
                }
                
                allStatuses.push(...response.data);
                UI.updateFetchStats({ trips: allStatuses.length, pages: page });
                UI.addPacketToDepot(page);
                const randomFactCount = Math.floor(Math.random() * 3) + 1; // Random 1-3 facts per page
                FunFacts.showFactsFromTrips(response.data, randomFactCount);
                hasMore = !!response.links?.next;
                
                state.fetchProgress = {
                    page: page + 1,
                    pagesFetchComplete: !hasMore,
                    allStatuses: allStatuses,
                    polylineCount: 0,
                    processedPolylines: 0
                };
                
                page++;
                if (page > 1500) break;
            }
            
            if (state.fetchProgress) {
                state.fetchProgress.pagesFetchComplete = true;
            }
        } else {
            UI.updateFetchStats({ trips: allStatuses.length, pages: page - 1 });
        }

        if (state.cancelFetch) return showFetchError('Cancelled', false);

        UI.updateFetchStats({ status: 'Fetching route polylines...' });
        let polylineCount = resumeFromState && state.fetchProgress ? state.fetchProgress.polylineCount : 0;
        const tripsWithTrain = allStatuses.filter(s => s.train);
        const batchSize = 15;
        const startIndex = resumeFromState && state.fetchProgress ? state.fetchProgress.processedPolylines : 0;
        const totalBatches = Math.ceil((tripsWithTrain.length - startIndex) / batchSize);
        UI.startLoadingToTrain(totalBatches);
        
        for (let i = startIndex; i < tripsWithTrain.length && !state.cancelFetch; i += batchSize) {
            const batch = tripsWithTrain.slice(i, i + Math.min(batchSize, tripsWithTrain.length - i));
            const statusIds = batch.map(s => s.id);
            
            UI.updateFetchStats({ status: `Fetching polylines: batch ${Math.floor(i/batchSize)+1}/${Math.ceil(tripsWithTrain.length/batchSize)}` });
            
            const polylinesData = await api.getPolylines(statusIds);
            
            if (polylinesData?.data?.features) {
                polylinesData.data.features.forEach(feature => {
                    if (feature?.properties?.statusId) {
                        const status = allStatuses.find(s => s.id === feature.properties.statusId);
                        if (status && status.train) {
                            status.train.polyline = feature;
                            polylineCount++;
                        }
                    }
                });
            }
            
            UI.updateFetchStats({ routes: polylineCount, progress: ((i + batch.length) / tripsWithTrain.length) * 100 });
            UI.onPolylineBatchComplete();
            await UI.waitForTrainCatchUp(() => state.cancelFetch);
            if (state.cancelFetch) break;
            
            state.fetchProgress = {
                page: page,
                pagesFetchComplete: true,
                allStatuses: allStatuses,
                polylineCount: polylineCount,
                processedPolylines: i + batch.length
            };
        }

        if (UI.refs.cargoStage && (totalBatches === 0 || tripsWithTrain.length === 0)) {
            UI.refs.cargoStage.textContent = 'Processing\u2026';
            setTimeout(() => { if (UI.refs.cargoStage) UI.refs.cargoStage.classList.remove('visible'); }, 1500);
        }

        state.fetchedTrips = incremental && cachedTrips ? [...allStatuses, ...cachedTrips] : allStatuses;
        state.activeTrips = state.fetchedTrips;
        saveCurrentSession(incremental); // Pass incremental flag to merge data and update timestamp
        UI.updateFetchStats({ status: 'Processing data...' });
        await processAndDisplayData(state.fetchedTrips);
        FunFacts.stop(); // Stop fun facts when complete
        UI.releaseWakeLock();
    } catch (error) {
        console.error('Fetch error:', error);
        FunFacts.stop(); // Stop fun facts on error
        const isNetworkError = error.message.includes('fetch') || 
                               error.message.includes('network') || 
                               error.message.includes('timeout') ||
                               error.message.includes('Failed to fetch') ||
                               error.name === 'TypeError' ||
                               error.message.includes('NetworkError');
        const canRetry = isNetworkError && state.fetchProgress && 
                       (state.fetchProgress.allStatuses.length > 0 || state.fetchProgress.processedPolylines > 0);
        showFetchError(error.message, canRetry);
    }
}

export function cancelFetch() { 
    const state = store.get();
    state.cancelFetch = true; 
    FunFacts.stop(); // Stop fun facts when cancelled
    state.isFetching = false; 
    UI.releaseWakeLock();
}

export function showFetchError(msg, showRetry = false) {
    const state = store.get();
    const errorEl = document.getElementById('fetchError');
    const retryBtn = document.getElementById('retryFetchBtn');
    const cancelBtn = document.getElementById('cancelFetchBtn');
    
    errorEl.textContent = msg;
    errorEl.classList.remove('hidden');
    
    if (showRetry && state.fetchProgress) {
        retryBtn.classList.remove('hidden');
        retryBtn.onclick = () => {
            console.log('Retrying fetch from saved progress...');
            startDataFetch(true);
        };
    } else {
        retryBtn.classList.add('hidden');
    }
    
    cancelBtn.textContent = 'Back to Setup';
    cancelBtn.onclick = () => {
        UI.toggleFetch(false);
        UI.toggleSetup(true);
        errorEl.classList.add('hidden');
        retryBtn.classList.add('hidden');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.onclick = cancelFetch;
        state.fetchProgress = null;
    };
}

export function refreshActiveTrips() {
    const state = store.get();
    const sourceTrips = state.fetchedTrips || [];
    const filteredTrips = applyAllFilters(sourceTrips, state.filters);
    state.activeTrips = filteredTrips;
    return state.activeTrips;
}

export async function processAndDisplayData(trips) {
    const state = store.get();
    state.statistics = analytics.resetStatistics(state.statistics);
    analytics.refreshStatsDisplay(state.statistics);
    UI.updateDatasetSummary(state.username, trips.length);
    state.datasetVersion++;
    state.heatmap.needsRebuild = true;
    state.heatmap.cacheKey = null;
    invalidateDelayOverlayCache();

    state.fetchedTrips = Array.isArray(trips) ? trips.slice() : [];
    const activeTrips = refreshActiveTrips();
    const categories = dataProcessing.processTripsToGeoJSON(activeTrips);

    if (!state.map) {
        initMap();
    }

    await waitForMapReady();

    const addRouteLayers = () => {
        if (!state.map.isStyleLoaded()) {
            console.warn('Map style not loaded yet, waiting...');
            setTimeout(addRouteLayers, 100);
            return;
        }
        
        const baseOpacity = heatmap.getCurrentBaseOpacity(state);
        for (let i = 0; i < state.layers.order.length; i++) {
            const layerId = state.layers.order[i];
            const config = CONFIG.LAYER_CONFIG.find(([id]) => id === layerId);
            if (!config) continue;
            const color = config[1];
            let data = categories[layerId] || { type: 'FeatureCollection', features: [] };

            if (state.map.getLayer(layerId)) {
                try {
                    state.map.removeLayer(layerId);
                } catch (e) {
                    console.warn(`Failed to remove layer ${layerId}:`, e);
                }
            }
            if (state.map.getSource(layerId)) {
                try {
                    state.map.removeSource(layerId);
                } catch (e) {
                    console.warn(`Failed to remove source ${layerId}:`, e);
                }
            }

            try {
                state.map.addSource(layerId, { type: 'geojson', data });
                
                let beforeLayer = null;
                if (i > 0) {
                    const prevLayerId = state.layers.order[i-1];
                    if (state.map.getLayer(prevLayerId)) {
                        beforeLayer = prevLayerId;
                    }
                } else if (state.map.getLayer('open-railway-map')) {
                    beforeLayer = 'open-railway-map';
                }
                
                state.map.addLayer({
                    id: layerId, type: 'line', source: layerId,
                    layout: { 'line-join': 'round', 'line-cap': 'round', visibility: state.heatmap.enabled ? 'none' : 'visible' },
                    paint: { 'line-color': color, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3, 18, 16], 'line-opacity': baseOpacity }
                }, beforeLayer);

                state.layers.data.set(layerId, { data, color, visible: true });
                state.statistics = analytics.updateStatistics(data, layerId, state.statistics);
            } catch (e) {
                console.error(`Failed to add layer ${layerId}:`, e);
            }
        }
    };
    
    if (RouteAnimation.isMobile()) {
        setTimeout(() => {
            addRouteLayers();
            setTimeout(loadLayers, 50);
        }, 200);
    } else {
        addRouteLayers();
        setTimeout(loadLayers, 50);
    }
    
    setTimeout(() => analytics.refreshStatsDisplay(state.statistics), 100);

    setupMapInteractions();
    analytics.initializeDateInputs(state.statistics);
    UI.toggleFetch(false);
    UI.refs.menu.style.display = 'block';
    
    fitMapToData();
    if (state.delays.enabled) {
        updateDelayOverlay(true);
    } else {
        updateDelayOverlaySummary();
    }
}
