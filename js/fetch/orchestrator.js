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
import { updateFilterBadges } from '../events/listeners.js';
import { escapeHtml } from '../utils/format.js';

export async function startDataFetch(resumeFromState = false, incremental = false) {
    const state = store.get();
    const token = state.token || document.getElementById('apiToken')?.value?.trim();

    // In setup screen / manual explore, ALWAYS read the username from the input fields first
    const setupInputVal = document.getElementById('username')?.value?.trim() || '';
    const menuInputVal = document.getElementById('menuUsername')?.value?.trim() || '';
    const enteredUsername = setupInputVal || menuInputVal;

    let targetUsername = '';
    if (resumeFromState) {
        targetUsername = (state.username || enteredUsername).trim();
    } else {
        // When explicitly starting or exploring, the entered username has absolute priority
        targetUsername = (enteredUsername || state.username || '').trim();
    }

    // Normalize username to lowercase — Träwelling usernames are case-insensitive
    const username = targetUsername.toLowerCase();
    if (!username) return alert('Please enter a username to explore');

    // If exploring a different profile than the one previously loaded, clear out old state & progress
    if (state.username && state.username.toLowerCase() !== username) {
        state.fetchProgress = null;
        state.queriedUserProfile = null;
        state.fetchedTrips = [];
        state.activeTrips = [];
    }

    state.token = token; state.username = username; state.isFetching = true;
    UI.syncUsernameInput(username);
    if (token) {
        const authMethod = state.authMethod || (document.getElementById('apiToken')?.value?.trim() ? 'token' : 'token');
        rememberToken(token, { autoValidate: false, authMethod });
    }
    state.cancelFetch = false;
    
    // Check for cached data for incremental fetch
    let cachedTrips = null;
    let newestCachedTripId = null;
    if (incremental) {
        try {
            const session = await SessionDB.get(username);
            if (session?.trips && session.trips.length > 0) {
                cachedTrips = session.trips;
                // Get the newest cached trip ID (page 1 is newest in API)
                newestCachedTripId = cachedTrips[0]?.id;
                console.log(`Found ${cachedTrips.length} cached trips, newest ID: ${newestCachedTripId}`);
            }
        } catch (e) {
            console.warn('Failed to check cached data:', e);
        }
    }
    
    if (!resumeFromState) {
        state.fetchedTrips = cachedTrips || [];
        state.activeTrips = [];
        state.queriedUserProfile = null;
        state.filters.fromDate = null;
        state.filters.toDate = null;
        state.filters.buddies = [];
        state.filters.buddy = null;
        state.filters.searchQuery = '';
        state.filters.business = { personal: true, work: true, commute: true };
        const tripSearch = document.getElementById('tripSearchInput');
        if (tripSearch) tripSearch.value = '';
        const tripSearchClear = document.getElementById('tripSearchClearBtn');
        if (tripSearchClear) tripSearchClear.style.display = 'none';
        updateFilterBadges();
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
        
        const urlLimit = typeof window !== 'undefined' ? parseInt(new URLSearchParams(window.location.search).get('limit'), 10) : 0;
        const tripLimit = !isNaN(urlLimit) && urlLimit > 0 ? urlLimit : 0;

        if (!skipPageFetching) {
            // First page check (crucial for instant incremental stops and determining next link)
            if (page === 1 && hasMore && !state.cancelFetch) {
                UI.updateFetchStats({ status: `Fetching page 1...` });
                const response = await api.getUserStatuses(username, 1);
                if (!response?.data?.length) {
                    hasMore = false;
                } else {
                    if (incremental && newestCachedTripId) {
                        const foundIdx = response.data.findIndex(s => s.id === newestCachedTripId);
                        if (foundIdx !== -1) {
                            if (foundIdx > 0) allStatuses.push(...response.data.slice(0, foundIdx));
                            console.log(`Found newest cached trip on page 1, stopping incremental fetch`);
                            hasMore = false;
                        } else {
                            allStatuses.push(...response.data);
                        }
                    } else {
                        allStatuses.push(...response.data);
                    }

                    if (tripLimit > 0 && allStatuses.length >= tripLimit) {
                        if (allStatuses.length > tripLimit) allStatuses.length = tripLimit;
                        hasMore = false;
                    }

                    const pageProgress = Math.min(45, Math.round((1 / 5) * 45));
                    UI.updateFetchStats({ trips: allStatuses.length, pages: 1, progress: pageProgress });
                    UI.addPacketToDepot(1);
                    FunFacts.showFactsFromTrips(response.data, 2);

                    hasMore = hasMore && !!response.links?.next;
                    page = 2;
                }
            }

            // Pipelined concurrent fetching for subsequent pages (2 at a time)
            const PAGE_PIPELINE_SIZE = 2;
            while (hasMore && !state.cancelFetch) {
                const targetPages = [];
                for (let k = 0; k < PAGE_PIPELINE_SIZE; k++) {
                    targetPages.push(page + k);
                }
                UI.updateFetchStats({ status: `Fetching pages ${targetPages.join(', ')}...` });

                const responses = await Promise.all(
                    targetPages.map(p => api.getUserStatuses(username, p))
                );

                for (let idx = 0; idx < responses.length; idx++) {
                    const res = responses[idx];
                    const currPage = targetPages[idx];
                    if (!res?.data?.length) {
                        hasMore = false;
                        break;
                    }

                    if (incremental && newestCachedTripId) {
                        const foundIdx = res.data.findIndex(s => s.id === newestCachedTripId);
                        if (foundIdx !== -1) {
                            if (foundIdx > 0) allStatuses.push(...res.data.slice(0, foundIdx));
                            console.log(`Found newest cached trip at index ${foundIdx} on page ${currPage}, stopping incremental fetch`);
                            hasMore = false;
                            break;
                        }
                    }

                    allStatuses.push(...res.data);

                    if (tripLimit > 0 && allStatuses.length >= tripLimit) {
                        if (allStatuses.length > tripLimit) allStatuses.length = tripLimit;
                        hasMore = false;
                        break;
                    }

                    const pageProgress = Math.min(45, Math.round((currPage / (currPage + 4)) * 45));
                    UI.updateFetchStats({ trips: allStatuses.length, pages: currPage, progress: pageProgress });
                    UI.addPacketToDepot(currPage);
                    FunFacts.showFactsFromTrips(res.data, Math.floor(Math.random() * 2) + 1);

                    if (!res.links?.next) {
                        hasMore = false;
                        break;
                    }
                }

                page += PAGE_PIPELINE_SIZE;
                state.fetchProgress = {
                    page: page,
                    pagesFetchComplete: !hasMore,
                    allStatuses: allStatuses,
                    polylineCount: 0,
                    processedPolylines: 0
                };
                if (page > 1500) break;
            }

            if (state.fetchProgress) {
                state.fetchProgress.pagesFetchComplete = true;
            }
        } else {
            UI.updateFetchStats({ trips: allStatuses.length, pages: page - 1, progress: 45 });
        }

        if (state.cancelFetch) return showFetchError('Cancelled', false);

        if (allStatuses.length === 0) {
            if (incremental && cachedTrips && cachedTrips.length > 0) {
                state.fetchedTrips = cachedTrips;
                state.activeTrips = state.fetchedTrips;
                saveCurrentSession(true);
                UI.updateFetchStats({ status: 'Train departing terminal...', progress: 92 });
                if (UI.refs.cargoStage) {
                    UI.refs.cargoStage.textContent = 'Consist departing terminal...';
                    UI.refs.cargoStage.classList.add('visible');
                }
                const departPromise = UI.departTrain();
                UI.updateFetchStats({ status: 'Already up to date!', progress: 96 });
                await processAndDisplayData(state.fetchedTrips, { hideFetchUI: false });
                await departPromise;
                UI.updateFetchStats({ status: 'Ready!', progress: 100 });
                await new Promise(r => setTimeout(r, 200));
                UI.toggleFetch(false);
                UI.refs.menu.style.display = 'block';
                FunFacts.stop();
                UI.releaseWakeLock();
                return;
            }

            FunFacts.stop();
            UI.releaseWakeLock();
            return showFetchError({
                type: 'no_trips',
                icon: '🚆',
                title: 'No Trips Found',
                message: `No public travel check-ins found for @${username}.`,
                tip: 'This account has not recorded any public journeys yet, or all check-ins might be private.',
                action: 'setup'
            }, false);
        }

        UI.updateFetchStats({ status: 'Preparing route polylines...', progress: 46 });
        let polylineCount = resumeFromState && state.fetchProgress ? state.fetchProgress.polylineCount : 0;
        
        // Fast O(1) status lookup index
        const statusMap = new Map();
        allStatuses.forEach(s => {
            if (s?.id) {
                statusMap.set(String(s.id), s);
                statusMap.set(Number(s.id), s);
            }
        });

        // 1. Count any polylines already in memory
        allStatuses.forEach(s => {
            if (s.train?.polyline) polylineCount++;
        });

        // 2. Check IndexedDB batch cache for polylines (stopovers-style)
        const tripsNeedingPolyline = allStatuses.filter(s => s.train && !s.train.polyline);
        if (tripsNeedingPolyline.length > 0) {
            UI.updateFetchStats({ status: 'Loading cached polylines...', progress: 47 });
            const missingIds = tripsNeedingPolyline.map(s => s.id);
            const cachedPolylines = await SessionDB.getPolylinesBatch(missingIds);
            tripsNeedingPolyline.forEach(s => {
                if (cachedPolylines[s.id]) {
                    s.train.polyline = cachedPolylines[s.id];
                    polylineCount++;
                }
            });
        }

        // 3. Batch fetch remaining missing polylines from Träwelling API (batchSize: 25)
        const tripsToFetch = allStatuses.filter(s => s.train && !s.train.polyline);
        const batchSize = 25;
        const startIndex = resumeFromState && state.fetchProgress ? state.fetchProgress.processedPolylines : 0;
        const totalBatches = Math.ceil((tripsToFetch.length - startIndex) / batchSize);
        UI.startLoadingToTrain(totalBatches);
        
        for (let i = startIndex; i < tripsToFetch.length && !state.cancelFetch; i += batchSize) {
            const batch = tripsToFetch.slice(i, i + Math.min(batchSize, tripsToFetch.length - i));
            const statusIds = batch.map(s => s.id);
            
            UI.updateFetchStats({ status: `Fetching polylines: batch ${Math.floor(i/batchSize)+1}/${Math.ceil(tripsToFetch.length/batchSize)}` });
            
            const polylinesData = await api.getPolylines(statusIds);
            const newlyFetched = {};
            
            if (polylinesData?.data?.features) {
                polylinesData.data.features.forEach(feature => {
                    const statusId = feature?.properties?.statusId;
                    if (statusId) {
                        const status = statusMap.get(statusId);
                        if (status && status.train) {
                            status.train.polyline = feature;
                            newlyFetched[statusId] = feature;
                            polylineCount++;
                        }
                    }
                });
            }

            if (Object.keys(newlyFetched).length > 0) {
                SessionDB.savePolylinesBatch(newlyFetched).catch(() => {});
            }
            
            const polyPct = tripsToFetch.length > 0 ? ((i + batch.length) / tripsToFetch.length) : 1;
            const overallProgress = 48 + Math.round(polyPct * 42); // 48% -> 90%
            UI.updateFetchStats({ routes: polylineCount, progress: overallProgress });
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

        if (UI.refs.cargoStage && (totalBatches === 0 || tripsToFetch.length === 0)) {
            UI.refs.cargoStage.textContent = 'Processing\u2026';
            setTimeout(() => { if (UI.refs.cargoStage) UI.refs.cargoStage.classList.remove('visible'); }, 1500);
        }

        state.fetchedTrips = incremental && cachedTrips ? [...allStatuses, ...cachedTrips] : allStatuses;
        state.activeTrips = state.fetchedTrips;
        saveCurrentSession(incremental); // Pass incremental flag to merge data and update timestamp

        // Final 10% (90% -> 100%): Train departs terminal while background builds layers & finalizes map
        UI.updateFetchStats({ status: 'Train departing terminal...', progress: 92 });
        if (UI.refs.cargoStage) {
            UI.refs.cargoStage.textContent = 'Consist departing terminal...';
            UI.refs.cargoStage.classList.add('visible');
        }

        const departPromise = UI.departTrain();

        UI.updateFetchStats({ status: 'Building map layers...', progress: 96 });
        await processAndDisplayData(state.fetchedTrips, { hideFetchUI: false });

        await departPromise;

        UI.updateFetchStats({ status: 'Ready!', progress: 100 });
        await new Promise(r => setTimeout(r, 200));

        UI.toggleFetch(false);
        UI.refs.menu.style.display = 'block';
        FunFacts.stop(); // Stop fun facts when complete
        UI.releaseWakeLock();
    } catch (error) {
        console.error('Fetch error:', error);
        FunFacts.stop(); // Stop fun facts on error
        UI.releaseWakeLock();
        const classified = classifyError(error, username);
        const canRetry = (classified.action === 'retry' || classified.type === 'network' || classified.type === 'rate_limit') &&
            state.fetchProgress && (state.fetchProgress.allStatuses.length > 0 || state.fetchProgress.processedPolylines > 0);
        showFetchError(classified, canRetry);
    }
}

export function cancelFetch() { 
    const state = store.get();
    state.cancelFetch = true; 
    FunFacts.stop(); // Stop fun facts when cancelled
    state.isFetching = false; 
    UI.releaseWakeLock();
}

export function classifyError(error, username = '') {
    if (!error) {
        return {
            type: 'generic',
            icon: '⚠️',
            title: 'An Error Occurred',
            message: 'An unknown error occurred while retrieving data.',
            tip: 'Please try again or return to Setup.',
            action: 'setup'
        };
    }
    if (typeof error === 'object' && error.type && error.title && error.message) {
        return error;
    }
    const msg = (error && error.message) ? error.message : String(error);
    const errStatus = (error && error.status) || (msg.match(/API Error:\s*(\d+)/)?.[1]) || null;
    const cleanUser = username ? `@${username}` : 'the specified user';

    if (errStatus === '404' || msg.includes('404')) {
        return {
            type: 'not_found',
            icon: '🔍',
            title: 'User Not Found',
            message: `Could not find a Träwelling profile for ${cleanUser}.`,
            tip: 'Please double-check the spelling of the username or confirm the account exists on traewelling.de.',
            action: 'setup'
        };
    }
    if (errStatus === '401' || errStatus === '403' || msg.includes('401') || msg.includes('403') || msg.includes('Authentication token required')) {
        return {
            type: 'auth_required',
            icon: '🔒',
            title: 'Private Profile / Token Required',
            message: `The profile for ${cleanUser} is private or requires authentication to access.`,
            tip: 'To access private check-ins, add your Personal Access Token in the Setup screen.',
            action: 'token'
        };
    }
    if (errStatus === '429' || msg.includes('429') || msg.toLowerCase().includes('rate limit')) {
        return {
            type: 'rate_limit',
            icon: '⏳',
            title: 'Rate Limit Reached',
            message: 'Träwelling API limit reached (maximum 55 requests per minute).',
            tip: 'The rate window refreshes automatically every 60 seconds. You can retry in a moment without losing progress.',
            action: 'retry'
        };
    }
    if (msg.includes('fetch') || msg.includes('network') || msg.includes('timeout') || msg.includes('Failed to fetch') || error.name === 'TypeError' || msg.includes('NetworkError')) {
        return {
            type: 'network',
            icon: '📡',
            title: 'Connection Lost',
            message: 'Unable to connect to Träwelling servers. Your network connection may be offline or interrupted.',
            tip: 'Check your internet connection. You can resume fetching where it stopped.',
            action: 'retry'
        };
    }
    if (errStatus && parseInt(errStatus, 10) >= 500) {
        return {
            type: 'server_error',
            icon: '⚠️',
            title: `Träwelling Server Error (${errStatus})`,
            message: 'Träwelling servers encountered a temporary issue while retrieving status data.',
            tip: 'This is usually a temporary outage with Träwelling. Please wait a minute and retry.',
            action: 'retry'
        };
    }
    if (msg === 'Cancelled') {
        return {
            type: 'cancelled',
            icon: '⏹️',
            title: 'Fetch Stopped',
            message: 'Data loading was cancelled.',
            tip: 'You can return to Setup to query another user or change settings.',
            action: 'setup'
        };
    }
    return {
        type: 'generic',
        icon: '⚠️',
        title: 'Error Loading Rides',
        message: msg,
        tip: 'Try retrying the connection or returning to Setup.',
        action: 'retry'
    };
}

export function showFetchError(errInput, showRetry = false) {
    const state = store.get();
    const errorEl = document.getElementById('fetchError');
    const retryBtn = document.getElementById('retryFetchBtn');
    const cancelBtn = document.getElementById('cancelFetchBtn');
    
    UI.onFetchError();

    const info = (typeof errInput === 'object' && errInput !== null && errInput.title)
        ? errInput
        : classifyError(errInput, state.username);

    if (errorEl) {
        errorEl.innerHTML = `
            <div class="fetch-error-header">
                <span class="fetch-error-icon" aria-hidden="true">${info.icon || '⚠️'}</span>
                <h3 class="fetch-error-title">${escapeHtml(info.title || 'Error')}</h3>
            </div>
            <p class="fetch-error-desc">${escapeHtml(info.message || 'An error occurred.')}</p>
            ${info.tip ? `<div class="fetch-error-tip">${escapeHtml(info.tip)}</div>` : ''}
            <div class="fetch-error-actions">
                ${(showRetry || info.action === 'retry') && state.fetchProgress ? `
                    <button class="fetch-error-btn-primary" id="cardRetryBtn">🔄 Retry Connection</button>
                ` : ''}
                <button class="fetch-error-btn-secondary" id="cardSetupBtn">⚙️ Back to Setup</button>
            </div>
        `;
        errorEl.classList.remove('hidden');

        const cardRetry = document.getElementById('cardRetryBtn');
        if (cardRetry) {
            cardRetry.onclick = () => {
                errorEl.classList.add('hidden');
                startDataFetch(true);
            };
        }
        const cardSetup = document.getElementById('cardSetupBtn');
        if (cardSetup) {
            cardSetup.onclick = () => {
                UI.toggleFetch(false);
                UI.toggleSetup(true);
                errorEl.classList.add('hidden');
                if (retryBtn) retryBtn.classList.add('hidden');
                if (cancelBtn) {
                    cancelBtn.textContent = 'Cancel';
                    cancelBtn.onclick = cancelFetch;
                }
                state.fetchProgress = null;
            };
        }
    }

    if (showRetry && state.fetchProgress) {
        if (retryBtn) {
            retryBtn.classList.remove('hidden');
            retryBtn.onclick = () => {
                if (errorEl) errorEl.classList.add('hidden');
                console.log('Retrying fetch from saved progress...');
                startDataFetch(true);
            };
        }
    } else {
        if (retryBtn) retryBtn.classList.add('hidden');
    }

    if (cancelBtn) {
        cancelBtn.textContent = 'Back to Setup';
        cancelBtn.onclick = () => {
            UI.toggleFetch(false);
            UI.toggleSetup(true);
            if (errorEl) errorEl.classList.add('hidden');
            if (retryBtn) retryBtn.classList.add('hidden');
            cancelBtn.textContent = 'Cancel';
            cancelBtn.onclick = cancelFetch;
            state.fetchProgress = null;
        };
    }
}

export function refreshActiveTrips() {
    const state = store.get();
    const sourceTrips = state.fetchedTrips || [];
    const filteredTrips = applyAllFilters(sourceTrips, state.filters);
    state.activeTrips = filteredTrips;
    return state.activeTrips;
}

export async function processAndDisplayData(trips, { hideFetchUI = true } = {}) {
    const state = store.get();
    state.statistics = analytics.resetStatistics(state.statistics);
    analytics.refreshStatsDisplay(state.statistics);
    const profile = state.queriedUserProfile;
    UI.updateDatasetSummary(
        profile?.displayName || state.username,
        profile?.username || state.username,
        trips.length,
        profile?.avatar || null
    );
    state.datasetVersion++;
    state.heatmap.needsRebuild = true;
    state.heatmap.cacheKey = null;
    invalidateDelayOverlayCache();

    state.fetchedTrips = Array.isArray(trips) ? trips.slice() : [];
    dataProcessing.indexTrips(state.fetchedTrips, state.username);
    // Reset buddy and time filters for fresh dataset, and prefill dates from travel data
    state.filters.buddies = [];
    state.filters.buddy = null;
    state.filters.fromDate = null;
    state.filters.toDate = null;
    analytics.initializeDateInputs(state.fetchedTrips);

    const activeTrips = refreshActiveTrips();
    const categories = dataProcessing.processTripsToGeoJSON(activeTrips);

    // Populate initial state.layers.data with route data so layer counts are accurate immediately
    state.layers.order.forEach(layerId => {
        const config = CONFIG.LAYER_CONFIG.find(([id]) => id === layerId);
        const color = config ? config[1] : '#888888';
        const data = categories[layerId] || { type: 'FeatureCollection', features: [] };
        const existing = state.layers.data.get(layerId);
        state.layers.data.set(layerId, {
            data,
            color,
            visible: existing !== undefined ? existing.visible : true
        });
    });

    if (!state.map) {
        if (!window.mapboxgl || !window.deck) {
            await new Promise(resolve => {
                const startTime = Date.now();
                const check = () => {
                    if ((window.mapboxgl && window.deck) || Date.now() - startTime > 15000) {
                        return resolve();
                    }
                    setTimeout(check, 50);
                };
                check();
            });
        }
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
            } catch (e) {
                console.error(`Failed to add layer ${layerId}:`, e);
            }
        }
        analytics.updateAllStatistics();
        analytics.updateMenuBuddyList();
        loadLayers();
    };
    
    // Populate layers UI immediately
    loadLayers();

    if (RouteAnimation.isMobile()) {
        setTimeout(() => {
            addRouteLayers();
        }, 200);
    } else {
        addRouteLayers();
    }
    
    setTimeout(() => analytics.refreshStatsDisplay(state.statistics), 100);

    setupMapInteractions();
    analytics.updateMenuBuddyList();
    updateFilterBadges();
    if (hideFetchUI) {
        UI.toggleFetch(false);
        UI.refs.menu.style.display = 'block';
    }
    
    fitMapToData();
    if (state.delays.enabled) {
        updateDelayOverlay(true);
    } else {
        updateDelayOverlaySummary();
    }
    document.body.dataset.mapReady = 'true';
}
