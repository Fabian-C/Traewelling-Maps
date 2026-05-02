// Statistics and analytics functions
import { store } from '../state/store.js';

export function resetStatistics(statisticsObj) {
    if (!statisticsObj) {
        statisticsObj = { trips: 0, distance: 0, lineCounts: {}, typeCounts: {}, oldestDate: null, newestDate: null, oldestStatusId: null, newestStatusId: null };
    } else {
        statisticsObj.trips = 0;
        statisticsObj.distance = 0;
        statisticsObj.lineCounts = {};
        statisticsObj.typeCounts = {};
        statisticsObj.oldestDate = null;
        statisticsObj.newestDate = null;
        statisticsObj.oldestStatusId = null;
        statisticsObj.newestStatusId = null;
    }
    return statisticsObj;
}

export function updateStatistics(data, category, statisticsObj) {
    if (!statisticsObj) {
        statisticsObj = { trips: 0, distance: 0, lineCounts: {}, typeCounts: {}, oldestDate: null, newestDate: null, oldestStatusId: null, newestStatusId: null };
    }
    data.features.forEach(f => {
        let train = f.properties?.train;
        if (typeof train === 'string') try { train = JSON.parse(train); } catch (e) { train = {}; }
        train = train || {};
        const distance = train.distance || 0;
        const createdAt = f.properties?.createdAt;
        const statusId = f.properties?.statusId;

        statisticsObj.trips++;
        statisticsObj.distance += distance;

        const lineName = train.lineName || train.number || 'Unknown';
        statisticsObj.lineCounts[lineName] = (statisticsObj.lineCounts[lineName] || 0) + 1;
        statisticsObj.typeCounts[category] = (statisticsObj.typeCounts[category] || 0) + 1;

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
}

export function initializeDateInputs(statisticsObj) {
    const dateFrom = document.getElementById('dateFrom');
    const dateTo = document.getElementById('dateTo');
    if (dateFrom && statisticsObj?.oldestDate) {
        dateFrom.value = statisticsObj.oldestDate.toISOString().split('T')[0];
    }
    if (dateTo && statisticsObj?.newestDate) {
        dateTo.value = statisticsObj.newestDate.toISOString().split('T')[0];
    }
}

export function updateAllStatistics() {
    const state = store.get();
    state.statistics = resetStatistics(state.statistics);
    state.layers.data.forEach((layer, id) => { if (layer.visible) state.statistics = updateStatistics(layer.data, id, state.statistics); });
    refreshStatsDisplay(state.statistics);
}
