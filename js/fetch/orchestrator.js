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
import { loadLayers, syncMapLayerOrder } from '../map/layers.js';
import { initMap, fitMapToData, waitForMapReady, setupMapInteractions, clearRouteHighlight } from '../map/interactions.js';
import { toggleDelayOverlay, updateDelayOverlay, updateDelayOverlaySummary, invalidateDelayOverlayCache } from '../map/delayOverlay.js';
import { fetchUserProfile, saveCurrentSession, rememberToken, logout } from '../session/manager.js';
import { FunFacts } from '../ui/funFacts.js';
import { updateFilterBadges } from '../events/listeners.js';
import { focusTripOnMap } from '../map/tripCycler.js';

export async function startDataFetch(resumeFromState = false, incremental = false, options = {}) {
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

    // Automatically detect if we already have data for this user to fetch only new check-ins
    let cachedTrips = null;
    let newestCachedTripId = null;
    let cachedTripIdSet = null;

    if (!options.forceFresh && !resumeFromState) {
        // 1. Check in-memory store if user matches
        if (state.username && state.username.toLowerCase() === username && Array.isArray(state.fetchedTrips) && state.fetchedTrips.length > 0) {
            cachedTrips = [...state.fetchedTrips];
        } else {
            // 2. Check cached session in IndexedDB
            try {
                const session = await SessionDB.get(username);
                if (session?.trips && session.trips.length > 0) {
                    cachedTrips = session.trips;
                }
            } catch (e) {
                console.warn('Failed to check cached session for user:', e);
            }
        }

        if (cachedTrips && cachedTrips.length > 0) {
            incremental = true;
            cachedTrips.forEach(s => dataProcessing.normalizeTripStatus(s));
            // Ensure cached trips are sorted newest first
            cachedTrips.sort((a, b) => {
                const timeA = new Date(a.createdAt || a.checkin?.createdAt || a.train?.origin?.departure || 0).getTime();
                const timeB = new Date(b.createdAt || b.checkin?.createdAt || b.train?.origin?.departure || 0).getTime();
                if (timeA && timeB && timeA !== timeB) return timeB - timeA;
                return (b.id || 0) - (a.id || 0);
            });
            newestCachedTripId = cachedTrips[0]?.id;
            cachedTripIdSet = new Set(cachedTrips.map(s => s.id));
            console.log(`Auto-incremental fetch active for @${username}: ${cachedTrips.length} cached trips, newest ID: ${newestCachedTripId}`);
        }
    }

    // Force fresh scrape only if requested or if exploring without existing user data
    const isFreshScrape = Boolean(options.forceFresh) || (!resumeFromState && !incremental);

    // If fresh scrape or exploring a different profile than the one previously loaded, clear out old state & progress
    if (isFreshScrape || (state.username && state.username.toLowerCase() !== username && !incremental)) {
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
        state.fetchProgress = { page: 1, pagesFetchComplete: false, allStatuses: [], polylineCount: 0, processedPolylines: 0, containersDelivered: 0 };
        UI.resetCargoAnimation();
    } else {
        UI.clearFetchError();
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
        allStatuses.forEach(s => dataProcessing.normalizeTripStatus(s));

        const skipPageFetching = resumeFromState && state.fetchProgress && state.fetchProgress.pagesFetchComplete;
        
        const urlLimit = typeof window !== 'undefined' ? parseInt(new URLSearchParams(window.location.search).get('limit'), 10) : 0;
        const tripLimit = !isNaN(urlLimit) && urlLimit > 0 ? urlLimit : 0;

        if (!skipPageFetching) {
            // Pipelined page fetching: initiate prefetch of next page (1 page ahead) so network latency
            // is masked behind depot container animations and UI rendering without stutter or pauses.
            let prefetchPagePromise = api.getUserStatuses(username, page);

            const PAGES_PER_CONTAINER = 2;
            let containerIndex = resumeFromState && state.fetchProgress?.containersDelivered
                ? state.fetchProgress.containersDelivered
                : Math.floor((page - 1) / PAGES_PER_CONTAINER);
            let pagesInContainerBatch = (page - 1) % PAGES_PER_CONTAINER;

            while (hasMore && !state.cancelFetch) {
                UI.updateFetchStats({ status: `Fetching page ${page}...` });

                const res = await prefetchPagePromise;

                if (!res?.data?.length) {
                    hasMore = false;
                    break;
                }
                res.data.forEach(s => dataProcessing.normalizeTripStatus(s));

                if (incremental && ((cachedTripIdSet && cachedTripIdSet.size > 0) || newestCachedTripId)) {
                    const foundIdx = cachedTripIdSet
                        ? res.data.findIndex(s => cachedTripIdSet.has(s.id))
                        : res.data.findIndex(s => s.id === newestCachedTripId);
                    if (foundIdx !== -1) {
                        if (foundIdx > 0) {
                            allStatuses.push(...res.data.slice(0, foundIdx));
                            pagesInContainerBatch++;
                        }
                        console.log(`Found cached trip (ID: ${res.data[foundIdx].id}) at index ${foundIdx} on page ${page}, stopping incremental fetch`);
                        hasMore = false;
                        break;
                    }
                }

                allStatuses.push(...res.data);
                pagesInContainerBatch++;

                if (tripLimit > 0 && allStatuses.length >= tripLimit) {
                    if (allStatuses.length > tripLimit) allStatuses.length = tripLimit;
                    hasMore = false;
                    break;
                }

                const pageProgress = Math.min(45, Math.round((page / (page + 4)) * 45));
                const totalDisplayTrips = (incremental && cachedTrips ? cachedTrips.length : 0) + allStatuses.length;
                UI.updateFetchStats({ trips: totalDisplayTrips, pages: page, progress: pageProgress });

                // Deliver 1 container per 2 fetched pages
                if (pagesInContainerBatch >= PAGES_PER_CONTAINER) {
                    containerIndex++;
                    UI.addPacketToDepot(containerIndex, 1);
                    pagesInContainerBatch = 0;
                }
                FunFacts.showFactsFromTrips(res.data, Math.floor(Math.random() * 2) + 1);

                if (!res.links?.next) {
                    hasMore = false;
                    break;
                }

                page++;
                // Prefetch page + 1 immediately while the UI animations for current page run
                prefetchPagePromise = api.getUserStatuses(username, page);

                state.fetchProgress = {
                    page: page,
                    pagesFetchComplete: !hasMore,
                    allStatuses: allStatuses,
                    polylineCount: 0,
                    processedPolylines: 0,
                    containersDelivered: containerIndex
                };
                if (page > 1500) break;
            }

            // Deliver any remaining partial batch as a container (e.g. if total pages was not a multiple of 2)
            if (!state.cancelFetch && pagesInContainerBatch > 0 && allStatuses.length > 0) {
                containerIndex++;
                UI.addPacketToDepot(containerIndex, 1);
                pagesInContainerBatch = 0;
            }

            if (state.fetchProgress) {
                state.fetchProgress.pagesFetchComplete = true;
                state.fetchProgress.containersDelivered = containerIndex;
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
                const departPromise = UI.departTrain(state.fetchedTrips);
                UI.updateFetchStats({ status: 'Already up to date!', progress: 96 });
                await processAndDisplayData(state.fetchedTrips, { hideFetchUI: false });
                await departPromise;
                UI.updateFetchStats({ status: 'Ready!', progress: 100 });
                await new Promise(r => setTimeout(r, 200));
                UI.toggleFetch(false);
                UI.refs.menu.style.display = 'block';
                const panel = document.getElementById('statsPanel');
                if (panel) {
                    panel.classList.add('active');
                    document.body.classList.add('stats-open');
                    document.getElementById('statsToggle')?.classList.add('active');
                }
                state.isFetching = false;
                FunFacts.stop();
                UI.releaseWakeLock();
                return;
            }

            state.isFetching = false;
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

        // 1. Count any polylines already in memory (only when resuming mid-fetch)
        if (resumeFromState) {
            allStatuses.forEach(s => {
                if (s.train?.polyline) polylineCount++;
            });
        }

        // 2. Check IndexedDB batch cache for polylines (only when NOT a fresh scrape)
        if (!isFreshScrape) {
            const tripsNeedingPolyline = allStatuses.filter(s => s.train && !s.train.polyline);
            if (tripsNeedingPolyline.length > 0) {
                UI.updateFetchStats({ status: 'Loading cached polylines...', progress: 47 });
                const missingIds = tripsNeedingPolyline.map(s => s.id);
                const cachedPolylines = await SessionDB.getPolylinesBatch(missingIds);
                tripsNeedingPolyline.forEach(s => {
                    if (cachedPolylines[s.id]) {
                        dataProcessing.normalizeTripStatus(s);
                        s.train.polyline = cachedPolylines[s.id];
                        if (s.checkin) s.checkin.polyline = cachedPolylines[s.id];
                        polylineCount++;
                    }
                });
            }
        }

        // 3. Batch fetch remaining missing polylines from Träwelling API (batchSize: 50 for faster throughput)
        const tripsToFetch = allStatuses.filter(s => s.train && !s.train.polyline);
        const batchSize = 50;
        const startIndex = resumeFromState && state.fetchProgress ? state.fetchProgress.processedPolylines : 0;
        // Total batches should reflect the work to load onto trains — guarantee at least 1 batch if we have items
        const rawBatches = Math.ceil((tripsToFetch.length - startIndex) / batchSize);
        const totalBatches = Math.max(1, rawBatches || Math.ceil(allStatuses.length / batchSize) || 1);
        UI.startLoadingToTrain(totalBatches);
        
        // Prefetch first batch ahead of time
        let nextBatchPrefetchPromise = null;
        const getBatchIds = (startIdx) => {
            const b = tripsToFetch.slice(startIdx, startIdx + Math.min(batchSize, tripsToFetch.length - startIdx));
            return b.map(s => s.id);
        };

        if (tripsToFetch.length > startIndex) {
            nextBatchPrefetchPromise = api.getPolylines(getBatchIds(startIndex));
        }
        
        for (let i = startIndex; i < tripsToFetch.length && !state.cancelFetch; i += batchSize) {
            const batch = tripsToFetch.slice(i, i + Math.min(batchSize, tripsToFetch.length - i));
            
            UI.updateFetchStats({ status: `Fetching polylines: batch ${Math.floor(i/batchSize)+1}/${Math.ceil(tripsToFetch.length/batchSize)}` });
            
            // Await currently prefetched batch
            const polylinesData = nextBatchPrefetchPromise ? await nextBatchPrefetchPromise : await api.getPolylines(batch.map(s => s.id));
            
            // Immediately kick off prefetch for next batch (i + batchSize) in background
            const nextIdx = i + batchSize;
            if (nextIdx < tripsToFetch.length && !state.cancelFetch) {
                nextBatchPrefetchPromise = api.getPolylines(getBatchIds(nextIdx));
            } else {
                nextBatchPrefetchPromise = null;
            }

            const newlyFetched = {};
            
            if (polylinesData?.data?.features) {
                polylinesData.data.features.forEach(feature => {
                    const statusId = feature?.properties?.statusId;
                    if (statusId) {
                        const status = statusMap.get(statusId);
                        if (status) {
                            dataProcessing.normalizeTripStatus(status);
                            if (status.train) status.train.polyline = feature;
                            if (status.checkin) status.checkin.polyline = feature;
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
            const overallProgress = 46 + Math.round(polyPct * 26); // 46% -> 72%
            UI.updateFetchStats({ routes: polylineCount, progress: overallProgress });
            UI.onPolylineBatchComplete();
            // Train loading animation proceeds seamlessly while next batch is already traveling across network
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

        // =========================================================================
        // DEPART LAST TRAIN & FLIP OVER TO SOLARI DEPARTURE BOARD
        // =========================================================================
        // Ensure all pending containers in queue have finished loading onto flatcars
        await UI.waitForTrainCatchUp(() => state.cancelFetch);

        UI.updateFetchStats({ status: 'Train departing terminal...', progress: 73 });
        if (UI.refs.cargoStage) {
            UI.refs.cargoStage.textContent = 'Consist departing terminal...';
            UI.refs.cargoStage.classList.add('visible');
        }

        // Depart the last train with isFinal: true, which flips the 3D scene over to the Solari board
        await UI.departTrain(allStatuses, { isFinal: true });

        // =========================================================================
        // STEP 3: WAYPOINT STATIONS & STOPOVERS FETCHING (73% -> 92%)
        // Solari board actively flips and displays real user train itineraries & via stations
        // Optional: user can disable or enable via toggle option
        // =========================================================================
        const shouldFetchStopovers = options.fetchStopovers !== undefined
            ? !!options.fetchStopovers
            : ((typeof document !== 'undefined' && (document.getElementById('fetchIncludeStopovers')?.checked ?? document.getElementById('menuFetchIncludeStopovers')?.checked)) ?? (localStorage.getItem('tw_fetch_stopovers') !== 'false'));

        let stopoverCount = 0;
        const allTripsWithTrain = allStatuses.filter(s => s && s.train);

        if (shouldFetchStopovers) {
            // 1. Count stopovers already present in memory (only when resuming mid-fetch)
            if (resumeFromState) {
                allTripsWithTrain.forEach(s => {
                    if (Array.isArray(s.train.stopovers)) {
                        s.train.stopovers = dataProcessing.filterStopoversBetweenTraveledStations(s.train.stopovers, s.train.origin, s.train.destination);
                        stopoverCount += s.train.stopovers.length;
                    }
                });
            }

            // 2. Check IndexedDB batch cache for stopovers (only when NOT a fresh scrape)
            if (!isFreshScrape) {
                const tripsNeedingStopovers = allTripsWithTrain.filter(s => !Array.isArray(s.train.stopovers));
                if (tripsNeedingStopovers.length > 0) {
                    UI.updateFetchStats({ status: 'Loading cached waypoint stopovers...', progress: 74, stopovers: stopoverCount });
                    const missingIds = tripsNeedingStopovers.map(s => s.id).filter(Boolean);
                    const cachedStopovers = await SessionDB.getStopoversBatch(missingIds);
                    tripsNeedingStopovers.forEach(s => {
                        if (cachedStopovers[s.id]) {
                            const raw = cachedStopovers[s.id];
                            const filtered = dataProcessing.filterStopoversBetweenTraveledStations(raw, s.train.origin, s.train.destination);
                            s.train.stopovers = filtered;
                            stopoverCount += (Array.isArray(filtered) ? filtered.length : 0);
                        }
                    });
                    // Update board with any cached stopovers
                    UI.onSolariBatchUpdated(tripsNeedingStopovers.filter(s => Array.isArray(s.train?.stopovers) && s.train.stopovers.length > 0));
                }
            }

            // 3. Batch fetch remaining missing stopovers from Träwelling API with dynamic adaptive split
            // Starts with batch size 60 (3x faster than 20). If the API fails or payload is too large,
            // dynamically splits into smaller chunks (30 -> 15 -> 5) until it succeeds.
            const stopoversToFetch = allTripsWithTrain.filter(s => !Array.isArray(s.train.stopovers));

            if (stopoversToFetch.length > 0 && !state.cancelFetch) {
                let initialBatchSize = 60;
                let fetchQueue = [stopoversToFetch];
                let processedCount = 0;
                const totalToFetch = stopoversToFetch.length;

                // Recursive fetcher that dynamically subdivides oversized or failing batches
                const fetchBatchDynamic = async (subBatch) => {
                    if (state.cancelFetch || !subBatch.length) return;
                    const queryIds = subBatch.map(s => s.train?.trip || s.id).filter(Boolean);

                    try {
                        const stopoversData = await api.getStopovers(queryIds);
                        const dataObj = stopoversData?.data;
                        if (!dataObj || typeof dataObj !== 'object') {
                            throw new Error('Empty or invalid stopovers response');
                        }

                        const newlyFetchedStopovers = {};
                        subBatch.forEach(s => {
                            const tripId = s.train?.trip;
                            const rawStops = Array.isArray(dataObj[tripId])
                                ? dataObj[tripId]
                                : (Array.isArray(dataObj[s.id]) ? dataObj[s.id] : []);
                            
                            // ONLY keep intermediate stations between origin and destination to prevent memory bloat
                            const filtered = dataProcessing.filterStopoversBetweenTraveledStations(rawStops, s.train?.origin, s.train?.destination);
                            if (s.train) s.train.stopovers = filtered;
                            if (s.checkin) s.checkin.stopovers = filtered;
                            newlyFetchedStopovers[s.id] = filtered;
                            stopoverCount += filtered.length;
                        });

                        // Store only the trimmed, traveled stopovers in IndexedDB to avoid multi-MB bloat
                        if (Object.keys(newlyFetchedStopovers).length > 0) {
                            SessionDB.saveStopoversBatch(newlyFetchedStopovers).catch(() => {});
                        }

                        processedCount += subBatch.length;
                        UI.onSolariBatchUpdated(subBatch, Math.ceil(processedCount / initialBatchSize), Math.ceil(totalToFetch / initialBatchSize));
                    } catch (err) {
                        // If batch failed and can be divided, dynamically split in half
                        if (subBatch.length > 5) {
                            const mid = Math.ceil(subBatch.length / 2);
                            console.warn(`Stopover batch size ${subBatch.length} failed (${err.message}). Dynamically splitting into ${mid} and ${subBatch.length - mid}...`);
                            await fetchBatchDynamic(subBatch.slice(0, mid));
                            await fetchBatchDynamic(subBatch.slice(mid));
                        } else {
                            // If even small chunk fails, assign empty array and continue gracefully without blocking user
                            console.warn('Stopover sub-batch failed, skipping gracefully:', err);
                            subBatch.forEach(s => {
                                if (!Array.isArray(s.train.stopovers)) s.train.stopovers = [];
                            });
                            processedCount += subBatch.length;
                        }
                    }

                    const stopPct = totalToFetch > 0 ? (processedCount / totalToFetch) : 1;
                    const overallProgress = 74 + Math.round(stopPct * 18); // 74% -> 92%
                    UI.updateFetchStats({
                        status: `Fetching stopovers: ${processedCount}/${totalToFetch} routes`,
                        stopovers: stopoverCount,
                        progress: overallProgress
                    });
                };

                for (let j = 0; j < stopoversToFetch.length && !state.cancelFetch; j += initialBatchSize) {
                    const chunk = stopoversToFetch.slice(j, j + initialBatchSize);
                    await fetchBatchDynamic(chunk);
                }
            }
        } else {
            // When stopover fetching is bypassed, set empty arrays for any trips lacking them
            allTripsWithTrain.forEach(s => {
                if (!Array.isArray(s.train.stopovers)) s.train.stopovers = [];
            });
            UI.updateFetchStats({ status: 'Skipping waypoint stopovers...', progress: 92, stopovers: 0 });
        }

        if (incremental && cachedTrips) {
            const seenIds = new Set(allStatuses.map(s => s.id));
            const uniqueCached = cachedTrips.filter(s => !seenIds.has(s.id));
            state.fetchedTrips = [...allStatuses, ...uniqueCached];
        } else {
            state.fetchedTrips = allStatuses;
        }
        state.activeTrips = state.fetchedTrips;
        saveCurrentSession(incremental); // Pass incremental flag to merge data and update timestamp

        // =========================================================================
        // STEP 4: LOAD ACTUAL MAP & FINALIZE (92% -> 100%)
        // =========================================================================
        UI.updateFetchStats({ status: 'Building map layers...', progress: 95, stopovers: stopoverCount });
        await processAndDisplayData(state.fetchedTrips, { hideFetchUI: false });

        UI.updateFetchStats({ status: 'Ready!', progress: 100, stopovers: stopoverCount });
        // Let the user admire their departure board before fading into the map
        await new Promise(r => setTimeout(r, 1200));

        UI.toggleFetch(false);
        UI.refs.menu.style.display = 'block';
        const panel = document.getElementById('statsPanel');
        if (panel) {
            panel.classList.add('active');
            document.body.classList.add('stats-open');
            document.getElementById('statsToggle')?.classList.add('active');
        }
        state.isFetching = false;
        FunFacts.stop(); // Stop fun facts when complete
        UI.releaseWakeLock();
    } catch (error) {
        state.isFetching = false;
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
    clearRouteHighlight();
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
    state.fetchedTrips.forEach(s => dataProcessing.normalizeTripStatus(s));
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

    analytics.updateAllStatistics();
    analytics.updateMenuBuddyList();
    analytics.refreshStatsDisplay(state.statistics);

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

    const addRouteLayers = async () => {
        let waitCount = 0;
        while ((!state.map || !state.map.isStyleLoaded()) && waitCount < 50) {
            await new Promise(r => setTimeout(r, 100));
            waitCount++;
        }
        
        // 1. Setup or update sources and layer data
        for (let i = 0; i < state.layers.order.length; i++) {
            const layerId = state.layers.order[i];
            const config = CONFIG.LAYER_CONFIG.find(([id]) => id === layerId);
            if (!config) continue;
            const color = config[1];
            const data = categories[layerId] || { type: 'FeatureCollection', features: [] };
            const existingLayer = state.layers.data.get(layerId);
            const isVisible = existingLayer !== undefined ? existingLayer.visible : true;

            try {
                const existingSource = state.map.getSource(layerId);
                if (existingSource) {
                    existingSource.setData(data);
                } else {
                    state.map.addSource(layerId, { type: 'geojson', data });
                }
                state.layers.data.set(layerId, { data, color, visible: isVisible });
            } catch (e) {
                console.error(`Failed to setup source for layer ${layerId}:`, e);
            }
        }

        // 2. Synchronize all route line layers (both solid and dotted approximated layers)
        syncMapLayerOrder();

        analytics.updateAllStatistics();
        analytics.updateMenuBuddyList();
        loadLayers();
    };
    
    // Populate layers UI immediately
    loadLayers();

    if (RouteAnimation.isMobile()) {
        await new Promise(r => setTimeout(r, 200));
    }
    await addRouteLayers();
    
    setTimeout(() => analytics.refreshStatsDisplay(state.statistics), 100);

    setupMapInteractions();
    analytics.updateMenuBuddyList();
    updateFilterBadges();
    const statsPanel = document.getElementById('statsPanel');
    if (statsPanel) {
        statsPanel.classList.add('active');
        document.body.classList.add('stats-open');
        document.getElementById('statsToggle')?.classList.add('active');
    }
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

    const deepTripId = new URLSearchParams(window.location.search).get('trip');
    if (deepTripId && Array.isArray(state.fetchedTrips)) {
        const foundTrip = state.fetchedTrips.find(t => String(t.id) === String(deepTripId));
        if (foundTrip) {
            setTimeout(() => focusTripOnMap(foundTrip), 400);
        }
    }

    document.body.dataset.mapReady = 'true';
}
