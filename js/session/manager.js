// Session management module
import { CONFIG } from '../config/config.js';
import { store } from '../state/store.js';
import { SessionDB } from '../cache/session.js';
import { TraewellingAPI } from '../api/traewelling.js';
import { UI } from '../ui/ui.js';
import { OAuth } from './oauth.js';
import { processAndDisplayData } from '../fetch/orchestrator.js';
import * as analytics from '../analytics/statistics.js';
import { startDataFetch } from '../fetch/orchestrator.js';

export { OAuth };

export async function fetchUserProfile(username, token = null) {
    try {
        const headers = { 'Accept': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        
        const response = await fetch(`${CONFIG.API_BASE_URL}/user/${username}`, { headers });
        if (!response.ok) return null;
        const data = await response.json();
        return {
            username: data.data?.username || username,
            displayName: data.data?.displayName || username,
            avatar: data.data?.profilePicture || null,
            profileUrl: `https://traewelling.de/@${username}`
        };
    } catch (e) {
        console.warn('Failed to fetch user profile:', e);
        return null;
    }
}

export async function saveCurrentSession(incremental = false) {
    const state = store.get();
    if (!state.username) return;
    
    try {
        let profile = state.queriedUserProfile;
        if (!profile) {
            profile = await fetchUserProfile(state.username, state.token);
        }
        
        await SessionDB.save(state.username, {
            displayName: profile?.displayName || state.username,
            avatar: profile?.avatar || null,
            tripCount: state.fetchedTrips?.length || 0,
            token: state.token,
            trips: state.fetchedTrips,
            // Force timestamp update for incremental fetches to reset the 90-day timer
            timestamp: incremental ? Date.now() : undefined
        });
        updateMenuAccountList();
    } catch (e) {
        console.warn('Failed to save session:', e);
    }
}

export async function loadSessionByUsername(username) {
    const state = store.get();
    try {
        const session = await SessionDB.get(username);
        if (!session) {
            console.warn('Session not found:', username);
            return;
        }
        
        state.username = session.username;
        state.token = session.token;
        state.queriedUserProfile = {
            username: session.username,
            displayName: session.displayName,
            avatar: session.avatar
        };
        
        document.getElementById('username').value = session.username;
        if (session.token) {
            document.getElementById('apiToken').value = session.token;
        }
        
        UI.syncTokenInputs(session.token);
        UI.syncUsernameInput(session.username);
        
        // Reset filters when switching accounts
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

        if (session.trips && session.trips.length > 0) {
            state.fetchedTrips = session.trips;
            
            UI.updateDatasetSummary(
                session.displayName,
                session.username,
                session.trips.length,
                session.avatar
            );
            
            document.getElementById('setupScreen').classList.add('hidden');
            document.getElementById('mainMenu').style.display = '';
            
            await processAndDisplayData(session.trips);
            analytics.refreshStatsDisplay(state.statistics);
            updateMenuAccountList();

            // Focus requested trip from URL parameter (?trip=, ?id=, ?status=, ?statusId=)
            const urlParams = new URLSearchParams(window.location.search);
            const deepTripId = urlParams.get('id') || urlParams.get('trip') || urlParams.get('statusId') || urlParams.get('status');
            if (deepTripId && Array.isArray(session.trips)) {
                const foundTrip = session.trips.find(t => String(t.id) === String(deepTripId));
                if (foundTrip) {
                    setTimeout(async () => {
                        try {
                            const { focusTripOnMap } = await import('../map/tripCycler.js');
                            focusTripOnMap(foundTrip);
                        } catch (err) {
                            console.warn('Failed to focus trip on map:', err);
                        }
                    }, 400);
                }
            }
        } else {
            startDataFetch(false, false);
        }
    } catch (e) {
        console.error('Failed to load session:', e);
    }
}

export async function deleteSession(username) {
    const state = store.get();
    try {
        await SessionDB.delete(username);
        if (state.username && state.username.toLowerCase() === (username || '').toLowerCase()) {
            state.username = null;
            state.fetchedTrips = [];
            state.activeTrips = [];
            state.fetchProgress = null;
            state.queriedUserProfile = null;
            if (state.cache?.clear) state.cache.clear();
            if (state.cacheTimestamps?.clear) state.cacheTimestamps.clear();
            UI.updateDatasetSummary(null, 0);
        }
        await updateMenuAccountList();
    } catch (e) {
        console.error('Failed to delete session:', e);
    }
}

export async function clearAllSessions() {
    const state = store.get();
    if (!confirm('Clear all cached sessions, stored trips, and tokens on this device? This cannot be undone.')) return;
    
    try {
        await SessionDB.clear();
        if (state.cache?.clear) state.cache.clear();
        if (state.cacheTimestamps?.clear) state.cacheTimestamps.clear();
        state.queriedUserProfile = null;
        localStorage.removeItem('tw_token');
        logout();
        await updateMenuAccountList();
        alert('All cached sessions and offline data have been removed from this device.');
    } catch (e) {
        console.error('Failed to clear sessions:', e);
    }
}

export function renderAccountItems(sessions = []) {
    const state = store.get();
    const menuContainer = document.getElementById('savedAccountsList');
    const setupContainer = document.getElementById('sessionsList');
    const setupSection = document.getElementById('savedSessions');
    
    if (menuContainer) {
        if (!sessions.length) {
            menuContainer.innerHTML = '<p class="section-sub" style="margin: 0; text-align: center;">No saved accounts</p>';
        } else {
            menuContainer.innerHTML = sessions.map(session => {
                if (!session) return '';
                const avatarStyle = session.avatar 
                    ? `background-image: url('${session.avatar}'); background-size: cover;`
                    : '';
                const avatarContent = session.avatar ? '' : (session.username?.[0]?.toUpperCase() || '?');
                const displayName = session.displayName || session.username || 'Unknown';
                const isActive = state?.username && session.username && state.username === session.username ? 'active' : '';
                const date = session.timestamp ? new Date(session.timestamp).toLocaleDateString() : '';
                
                return `
                    <div class="saved-account-item ${isActive}" onclick="loadSessionByUsername('${session.username || ''}')">
                        <div class="saved-account-avatar" style="${avatarStyle}">${avatarContent}</div>
                        <div class="saved-account-info">
                            <div class="saved-account-name">${displayName}</div>
                            <div class="saved-account-meta">@${session.username || 'unknown'} · ${session.tripCount || 0} trips · ${date}</div>
                        </div>
                        <button class="saved-account-delete" onclick="event.stopPropagation();deleteSession('${session.username || ''}')">✕</button>
                    </div>
                `;
            }).join('');
        }
    }
    
    if (setupContainer && setupSection) {
        if (!sessions.length) {
            setupSection.style.display = 'none';
        } else {
            setupSection.style.display = 'block';
            setupContainer.innerHTML = sessions.map(session => {
                if (!session) return '';
                const avatarStyle = session.avatar 
                    ? `background-image: url('${session.avatar}'); background-size: cover;`
                    : '';
                const avatarContent = session.avatar ? '' : (session.username?.[0]?.toUpperCase() || '?');
                const displayName = session.displayName || session.username;
                const date = session.timestamp ? new Date(session.timestamp).toLocaleDateString() : '';
                
                return `
                    <div class="saved-account-item" onclick="loadSessionByUsername('${session.username}')">
                        <div class="saved-account-avatar" style="${avatarStyle}">${avatarContent}</div>
                        <div class="saved-account-info">
                            <div class="saved-account-name">${displayName}</div>
                            <div class="saved-account-meta">@${session.username} · ${session.tripCount || 0} trips · ${date}</div>
                        </div>
                        <button class="saved-account-delete" onclick="event.stopPropagation();deleteSession('${session.username || ''}')">✕</button>
                    </div>
                `;
            }).join('');
        }
    }
}

export async function updateMenuAccountList() {
    // 1. Instant synchronous render from metadata cache (0ms delay in setup menu)
    try {
        const cached = SessionDB.getStoredMetadata();
        if (cached && cached.length) {
            renderAccountItems(cached);
        }
    } catch (e) {}

    // 2. Asynchronous freshness check and sync with IndexedDB
    try {
        const sessions = await SessionDB.getAll();
        renderAccountItems(sessions);
    } catch (e) {
        console.warn('Failed to update account lists:', e);
        const menuContainer = document.getElementById('savedAccountsList');
        const setupSection = document.getElementById('savedSessions');
        if (menuContainer && !menuContainer.children.length) {
            menuContainer.innerHTML = '<p class="section-sub" style="margin: 0; text-align: center;">No saved accounts</p>';
        }
        if (setupSection && !document.getElementById('sessionsList')?.children.length) {
            setupSection.style.display = 'none';
        }
    }
}

export function rememberToken(token, { autoValidate = true, authMethod = 'token' } = {}) {
    if (!token) return;
    try {
        localStorage.setItem('tw_token', token);
        if (authMethod) {
            localStorage.setItem('tw_auth_method', authMethod);
            const state = store.get();
            if (state) state.authMethod = authMethod;
        }
    } catch (error) {
        console.warn('Failed to persist API token for auto-validation:', error);
    }
    if (autoValidate) {
        validateStoredToken(token);
    }
}

export async function validateStoredToken(token) {
    const state = store.get();
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
        state.token = token;
        if (!state.authMethod) {
            state.authMethod = localStorage.getItem('tw_auth_method') || 'token';
        }
        UI.setTokenOwner(state.tokenOwner);
        UI.setTokenStatus('Token valid', 'success');
        UI.syncTokenInputs(token);
    } catch (error) {
        console.warn('Auto-validation failed:', error);
        UI.setTokenStatus('Token expired', 'error');
        localStorage.removeItem('tw_token');
        localStorage.removeItem('tw_auth_method');
        state.token = null;
        state.authMethod = null;
        UI.updateTokenVisibility();
    }
}

export function logout() {
    const state = store.get();
    try {
        localStorage.removeItem('tw_token');
        localStorage.removeItem('tw_auth_method');
    } catch (e) {}
    state.token = null; state.authMethod = null; state.username = null; state.fetchedTrips = [];
    state.tokenOwner = { username: null, displayName: null, avatar: null, profileUrl: null, validated: false };
    state.layers.data.clear();
    CONFIG.LAYER_CONFIG.forEach(([id]) => {
        if (state.map?.getLayer(id)) state.map.removeLayer(id);
        if (state.map?.getSource(id)) state.map.removeSource(id);
    });
    UI.refs.menu.style.display = 'none';
    const statsPanel = document.getElementById('statsPanel');
    if (statsPanel) statsPanel.classList.remove('active');
    document.body.classList.remove('stats-open');
    document.getElementById('statsToggle')?.classList.remove('active');
    UI.toggleSetup(true);
    UI.setTokenOwner(null);
    UI.setTokenStatus('Token not validated', 'idle');
    UI.updateDatasetSummary(null, 0);
}

export async function handleOAuthCallbackProcess() {
    try {
        const result = await OAuth.checkForCallback();
        if (!result) return false;

        rememberToken(result.accessToken, { autoValidate: false, authMethod: 'oauth' });

        const state = store.get();
        state.authMethod = 'oauth';
        try {
            localStorage.setItem('tw_auth_method', 'oauth');
        } catch (e) {}

        const api = new TraewellingAPI(result.accessToken);
        const user = await api.getAuthenticatedUser();

        state.tokenOwner = {
            username: user.data.username,
            displayName: user.data.displayName,
            avatar: user.data.profilePicture,
            profileUrl: `https://traewelling.de/@${user.data.username}`,
            validated: true
        };
        state.token = result.accessToken;
        // NOTE: Do NOT set state.username here — the token owner is NOT necessarily
        // the user being explored. The username input field determines the target.

        UI.setTokenOwner(state.tokenOwner);
        UI.setTokenStatus('Connected via OAuth', 'success');
        UI.syncTokenInputs(result.accessToken);

        // Ensure user is on the setup screen and can freely select/change the query username
        UI.toggleSetup(true);
        const usernameInput = document.getElementById('username');
        if (usernameInput) {
            // Only pre-fill with the logged-in user if the field is currently empty
            if (!usernameInput.value.trim()) {
                usernameInput.value = user.data.username;
            }
            usernameInput.focus();
            usernameInput.select();
        }
        return true;
    } catch (e) {
        console.error('OAuth callback failed:', e);
        UI.setTokenStatus(`OAuth Login Failed: ${e.message}`, 'error');
        const setupScreen = document.getElementById('setupScreen');
        if (setupScreen && !setupScreen.classList.contains('hidden')) {
            alert(`Träwelling OAuth notice: ${e.message}`);
        }
        return false;
    }
}

