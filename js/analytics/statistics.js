// Statistics and analytics functions
import { store } from '../state/store.js';
import { escapeHtml } from '../utils/format.js';

export function resetStatistics(statisticsObj) {
    if (!statisticsObj) {
        statisticsObj = { trips: 0, distance: 0, lineCounts: {}, typeCounts: {}, travelBuddies: {}, oldestDate: null, newestDate: null, oldestStatusId: null, newestStatusId: null };
    } else {
        statisticsObj.trips = 0;
        statisticsObj.distance = 0;
        statisticsObj.lineCounts = {};
        statisticsObj.typeCounts = {};
        statisticsObj.travelBuddies = {};
        statisticsObj.oldestDate = null;
        statisticsObj.newestDate = null;
        statisticsObj.oldestStatusId = null;
        statisticsObj.newestStatusId = null;
    }
    return statisticsObj;
}

export function updateStatistics(data, category, statisticsObj) {
    if (!statisticsObj) {
        statisticsObj = { trips: 0, distance: 0, lineCounts: {}, typeCounts: {}, travelBuddies: {}, oldestDate: null, newestDate: null, oldestStatusId: null, newestStatusId: null };
    }
    if (!statisticsObj.travelBuddies) statisticsObj.travelBuddies = {};
    data.features.forEach(f => {
        let train = f.properties?.train;
        if (typeof train === 'string') try { train = JSON.parse(train); } catch (e) { train = {}; }
        train = train || {};
        const distance = (typeof train.totalDistance === 'number' ? train.totalDistance : train.distance) || 0;
        const createdAt = f.properties?.createdAt;
        const statusId = f.properties?.statusId;

        statisticsObj.trips++;
        statisticsObj.distance += distance;

        const lineName = train.lineName || train.number || 'Unknown';
        statisticsObj.lineCounts[lineName] = (statisticsObj.lineCounts[lineName] || 0) + 1;
        statisticsObj.typeCounts[category] = (statisticsObj.typeCounts[category] || 0) + 1;

        // Track travel buddies directly from API data structures (no notes parsing)
        const currentUsername = (store.get().username || '').toLowerCase();
        let mentions = f.properties?.bodyMentions;
        if (typeof mentions === 'string') {
            try { mentions = JSON.parse(mentions); } catch (e) { mentions = []; }
        }
        if (Array.isArray(mentions)) {
            mentions.forEach(m => {
                const u = m.user?.username || m.username;
                if (u && u.toLowerCase() !== currentUsername) {
                    statisticsObj.travelBuddies[u] = (statisticsObj.travelBuddies[u] || 0) + 1;
                }
            });
        }
        const createdBy = f.properties?.createdBy?.username;
        if (createdBy && createdBy.toLowerCase() !== currentUsername) {
            statisticsObj.travelBuddies[createdBy] = (statisticsObj.travelBuddies[createdBy] || 0) + 1;
        }

        if (createdAt) {
            const d = new Date(createdAt);
            if (!statisticsObj.oldestDate || d < statisticsObj.oldestDate) { 
                statisticsObj.oldestDate = d; 
                statisticsObj.oldestStatusId = statusId; 
            }
            if (!statisticsObj.newestDate || d > statisticsObj.newestDate) { 
                statisticsObj.newestDate = d; 
                statisticsObj.newestStatusId = statusId; 
            }
        }
    });
    return statisticsObj;
}

export function refreshStatsDisplay(statisticsObj) {
    document.getElementById('statTrips').textContent = statisticsObj.trips;
    document.getElementById('statDistance').textContent = Math.round(statisticsObj.distance / 1000 * 100) / 100 + ' km';

    const mostLine = Object.entries(statisticsObj.lineCounts).sort((a,b) => b[1]-a[1])[0];
    document.getElementById('statLine').textContent = mostLine ? mostLine[0] : '-';

    const mostType = Object.entries(statisticsObj.typeCounts).sort((a,b) => b[1]-a[1])[0];
    document.getElementById('statType').textContent = mostType ? mostType[0] : '-';

    const oldest = statisticsObj.oldestDate;
    const newest = statisticsObj.newestDate;
    document.getElementById('statOldestDate').innerHTML = oldest && statisticsObj.oldestStatusId
        ? `<a href="https://traewelling.de/status/${statisticsObj.oldestStatusId}" target="_blank" class="popup-link">${oldest.toLocaleDateString('de-DE')}</a>` : '-';
    document.getElementById('statNewestDate').innerHTML = newest && statisticsObj.newestStatusId
        ? `<a href="https://traewelling.de/status/${statisticsObj.newestStatusId}" target="_blank" class="popup-link">${newest.toLocaleDateString('de-DE')}</a>` : '-';

    // Travel buddies ranking in Stats panel
    const buddiesItem = document.getElementById('statBuddiesItem');
    const buddiesEl = document.getElementById('statBuddies');
    if (buddiesItem && buddiesEl) {
        const sortedBuddies = Object.entries(statisticsObj.travelBuddies || {})
            .sort((a,b) => b[1] - a[1]);
        if (sortedBuddies.length > 0) {
            buddiesItem.style.display = 'flex';
            buddiesEl.innerHTML = sortedBuddies.slice(0, 5).map(([user, count]) => {
                return `<a href="https://traewelling.de/@${user}" target="_blank" class="mention-link">@${user}</a> (${count} ${count === 1 ? 'trip' : 'trips'})`;
            }).join(', ');
        } else {
            buddiesItem.style.display = 'none';
            buddiesEl.textContent = '-';
        }
    }

    // Prefill date selectors if not already populated
    initializeDateInputs(statisticsObj, null, false);
    updateMenuBuddyList();
}

/**
 * Extracts travel companions and trip counts across all fetched trips
 */
export function getBuddyStats(trips = null) {
    const state = store.get();
    const tripList = trips || state.fetchedTrips || [];
    const currentUsername = (state.username || '').toLowerCase().trim();
    const buddies = {};

    tripList.forEach(t => {
        let mentions = t.bodyMentions || t.properties?.bodyMentions;
        if (typeof mentions === 'string') {
            try { mentions = JSON.parse(mentions); } catch (e) { mentions = []; }
        }
        if (Array.isArray(mentions)) {
            mentions.forEach(m => {
                const u = m.user?.username || m.username;
                if (u && u.toLowerCase() !== currentUsername) {
                    buddies[u] = (buddies[u] || 0) + 1;
                }
            });
        }
        const createdBy = t.createdBy?.username || t.properties?.createdBy?.username;
        if (createdBy && createdBy.toLowerCase() !== currentUsername) {
            buddies[createdBy] = (buddies[createdBy] || 0) + 1;
        }
    });

    return buddies;
}

/**
 * Prefills the time filter inputs with the first and last dates from the user's travel data
 */
export function initializeDateInputs(statisticsObj, trips = null, force = false) {
    const dateFrom = document.getElementById('dateFrom');
    const dateTo = document.getElementById('dateTo');
    if (!dateFrom && !dateTo) return;

    let oldest = statisticsObj?.oldestDate;
    let newest = statisticsObj?.newestDate;

    // If statistics dates aren't computed yet, compute directly from trips
    if (!oldest || !newest) {
        const state = store.get();
        const tripList = trips || state.fetchedTrips || [];
        tripList.forEach(t => {
            const raw = t.createdAt || t.train?.origin?.departure || t.train?.origin?.plannedDeparture;
            if (raw) {
                const d = new Date(raw);
                if (!isNaN(d.getTime())) {
                    if (!oldest || d < oldest) oldest = d;
                    if (!newest || d > newest) newest = d;
                }
            }
        });
    }

    if (oldest) {
        const oldestD = oldest instanceof Date ? oldest : new Date(oldest);
        if (!isNaN(oldestD.getTime())) {
            const str = oldestD.toISOString().slice(0, 10);
            if (force || !dateFrom.value) {
                dateFrom.value = str;
            }
            dateFrom.min = str;
            if (dateTo) dateTo.min = str;
        }
    }
    if (newest) {
        const newestD = newest instanceof Date ? newest : new Date(newest);
        if (!isNaN(newestD.getTime())) {
            const str = newestD.toISOString().slice(0, 10);
            if (force || !dateTo.value) {
                dateTo.value = str;
            }
            dateTo.max = str;
            if (dateFrom) dateFrom.max = str;
        }
    }
}

let activeBuddySelectHandler = null;

export function registerBuddySelectHandler(handler) {
    activeBuddySelectHandler = handler;
}

/**
 * Updates the dedicated Travel Buddies list in the menu and binds filter interactions
 */
export function updateMenuBuddyList(onSelectBuddy = null) {
    if (onSelectBuddy) {
        activeBuddySelectHandler = onSelectBuddy;
    }
    const state = store.get();
    const listEl = document.getElementById('menuBuddyList');
    const clearBtn = document.getElementById('clearBuddyFilterBtn');
    if (!listEl) return;

    const buddies = getBuddyStats(state.fetchedTrips);
    const sorted = Object.entries(buddies).sort((a, b) => b[1] - a[1]);

    if (clearBtn) {
        clearBtn.style.display = state.filters.buddy ? 'inline-block' : 'none';
        if (state.filters.buddy) {
            clearBtn.textContent = `Clear Filter (@${state.filters.buddy})`;
        } else {
            clearBtn.textContent = 'Show All';
        }
    }

    if (sorted.length === 0) {
        listEl.innerHTML = '<p class="section-sub" style="margin: 0; text-align: center; font-size: 11px;">No travel buddies recorded in loaded trips</p>';
        return;
    }

    listEl.innerHTML = sorted.map(([user, count]) => {
        const isActive = state.filters.buddy && state.filters.buddy.toLowerCase() === user.toLowerCase();
        return `
            <div class="buddy-item ${isActive ? 'active' : ''}" data-buddy="${escapeHtml(user)}" role="button" tabindex="0">
                <div class="buddy-item-left">
                    <span class="buddy-item-icon">${isActive ? '✓' : '👤'}</span>
                    <span class="buddy-item-name">@${escapeHtml(user)}</span>
                </div>
                <span class="buddy-item-count">${count} ${count === 1 ? 'trip' : 'trips'}</span>
            </div>
        `;
    }).join('');

    listEl.querySelectorAll('.buddy-item').forEach(item => {
        item.onclick = () => {
            const buddy = item.dataset.buddy;
            if (typeof activeBuddySelectHandler === 'function') {
                if (state.filters.buddy && state.filters.buddy.toLowerCase() === buddy.toLowerCase()) {
                    activeBuddySelectHandler(null);
                } else {
                    activeBuddySelectHandler(buddy);
                }
            }
        };
    });
}

export function updateAllStatistics() {
    const state = store.get();
    state.statistics = resetStatistics(state.statistics);
    state.layers.data.forEach((layer, id) => { if (layer.visible) state.statistics = updateStatistics(layer.data, id, state.statistics); });
    refreshStatsDisplay(state.statistics);
}
