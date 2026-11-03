// Main application controller for Träwelling Rail Wrapped
import { SessionDB } from '../cache/session.js';
import { Storage, STORAGE_KEYS } from '../storage/storage.js';
import { escapeHtml } from '../utils/format.js';
import { TraewellingAPI } from '../api/traewelling.js';
import { normalizeTripStatus } from '../data/processing.js';
import {
    extractAvailableYears,
    filterTripsByYear,
    calculateWrappedInsights,
    compareUsers
} from './analytics.js';
import {
    generateWrappedCardCanvas,
    downloadWrappedCard,
    shareWrappedCard
} from './socialCard.js';
import { syncNavigationLinks } from '../ui/navigation.js';

let allSessions = [];
let activeSession = null;
let activeYear = 'all';
let currentInsights = null;
let currentCardCanvas = null;
let duelOpponentSession = null;

// Initialize on DOM ready or immediately if already loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWrapped);
} else {
    initWrapped();
}

export async function initWrapped() {
    try {
        allSessions = await SessionDB.getAll();
    } catch (e) {
        console.warn('Failed to load sessions from SessionDB:', e);
        allSessions = [];
    }

    const urlParams = new URLSearchParams(window.location.search);
    const requestedUser = urlParams.get('user')?.toLowerCase().trim();
    const requestedYear = urlParams.get('year') || 'all';
    const fixtureUrl = urlParams.get('fixture');

    // Synchronous storage session fallback (for instant loading and offline/test setups)
    if (allSessions.length === 0) {
        const parsed = Storage.getJSON(STORAGE_KEYS.SESSIONS_DATA, null);
        if (Array.isArray(parsed) && parsed.length > 0) {
            allSessions = parsed;
        }
    }

    // Fixture / Preview fallback for testing / previews
    const previewParam = urlParams.get('preview');
    if (allSessions.length === 0) {
        if (fixtureUrl) {
            try {
                const res = await fetch(fixtureUrl);
                const trips = await res.json();
                if (Array.isArray(trips) && trips.length > 0) {
                    const u = (requestedUser || 'resu').replace(/^@/, '');
                    allSessions = [{
                        username: u,
                        displayName: u.charAt(0).toUpperCase() + u.slice(1),
                        trips: trips,
                        tripCount: trips.length,
                        timestamp: Date.now()
                    }];
                }
            } catch (err) {
                console.warn('Failed to load fixture data:', err);
            }
        } else if (previewParam) {
            const u = (requestedUser || 'resu').replace(/^@/, '');
            allSessions = [{
                username: u,
                displayName: u.charAt(0).toUpperCase() + u.slice(1),
                trips: [
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
                            origin: { name: "Hamburg Landungsbrücken", departureReal: "2022-04-16T16:50:00Z" },
                            destination: { name: "Dockland", arrivalReal: "2022-04-16T17:15:00Z" }
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
                            origin: { name: "Friedrichstraße", departureReal: "2026-10-11T18:46:00Z" },
                            destination: { name: "Alexanderplatz", arrivalReal: "2026-10-11T18:58:00Z" }
                        }
                    }
                ],
                tripCount: 2,
                timestamp: Date.now()
            }];
        }
    }

    const normUser = u => (u || '').toLowerCase().replace(/^@/, '').trim();

    const targetUsername = requestedUser ? normUser(requestedUser) : (allSessions[0]?.username ? normUser(allSessions[0].username) : null);

    if (targetUsername) {
        try {
            activeSession = await SessionDB.get(targetUsername);
        } catch (e) {
            console.warn('Failed to load active session from SessionDB:', e);
        }

        // If not found in IndexedDB or had no trips, check in allSessions (e.g. from fixture or localStorage)
        if (!activeSession || !activeSession.trips || activeSession.trips.length === 0) {
            const memSession = allSessions.find(s => normUser(s.username) === targetUsername);
            if (memSession && memSession.trips && memSession.trips.length > 0) {
                activeSession = memSession;
            }
        }

        // Live API fallback if still no trips and not a demo account
        if ((!activeSession || !activeSession.trips || activeSession.trips.length === 0) && targetUsername !== 'demo') {
            try {
                const token = Storage.get(STORAGE_KEYS.TOKEN);
                const api = new TraewellingAPI(token);
                const apiRes = await api.getUserStatuses(targetUsername);
                const rawTrips = apiRes?.data || [];
                if (rawTrips.length > 0) {
                    const normTrips = rawTrips.map(normalizeTripStatus);
                    activeSession = {
                        username: targetUsername,
                        displayName: targetUsername.charAt(0).toUpperCase() + targetUsername.slice(1),
                        trips: normTrips,
                        tripCount: normTrips.length,
                        timestamp: Date.now()
                    };
                    SessionDB.save(targetUsername, rawTrips).catch(() => {});
                }
            } catch (apiErr) {
                console.warn('Live API fetch error in Wrapped for user', targetUsername, apiErr);
            }
        }
    }

    // Ensure activeSession exists in allSessions so profile dropdown can display it
    if (activeSession && !allSessions.some(s => normUser(s.username) === normUser(activeSession.username))) {
        allSessions.unshift({
            username: activeSession.username,
            displayName: activeSession.displayName || activeSession.username,
            tripCount: activeSession.tripCount || activeSession.trips?.length || 0,
            timestamp: activeSession.timestamp || Date.now()
        });
    }

    syncNavigationLinks(activeSession?.username || targetUsername || '');
    setupEventListeners();
    renderProfileDropdown();

    if (!activeSession || !activeSession.trips || activeSession.trips.length === 0) {
        showEmptyState();
        return;
    }

    hideEmptyState();
    activeYear = requestedYear;
    updateUrlParams();
    renderWrapped();
}

function setupEventListeners() {
    const normUser = u => (u || '').toLowerCase().replace(/^@/, '').trim();

    // Profile Switcher
    const profileSelect = document.getElementById('profileSelect');
    if (profileSelect) {
        profileSelect.addEventListener('change', async (e) => {
            const user = normUser(e.target.value);
            let found = null;
            try {
                found = await SessionDB.get(user);
            } catch (err) {
                console.warn('Failed to load session for user:', user, err);
            }
            if (!found || !found.trips || found.trips.length === 0) {
                found = allSessions.find(s => normUser(s.username) === user);
            }
            if (found) {
                activeSession = found;
                duelOpponentSession = null;
                activeYear = 'all';
                updateUrlParams();
                if (!activeSession.trips || activeSession.trips.length === 0) {
                    showEmptyState();
                } else {
                    hideEmptyState();
                    runWithTransition(() => renderWrapped());
                }
            }
        });
    }

    // Duel Toggle
    const duelToggleBtn = document.getElementById('duelToggleBtn');
    if (duelToggleBtn) {
        duelToggleBtn.addEventListener('click', async () => {
            const container = document.getElementById('duelContainer');
            const isActive = container.classList.toggle('active');
            duelToggleBtn.classList.toggle('active', isActive);
            if (isActive) {
                if (!duelOpponentSession && allSessions.length > 1) {
                    const currentNorm = normUser(activeSession?.username);
                    const oppSummary = allSessions.find(s => normUser(s.username) !== currentNorm) || allSessions[1];
                    if (oppSummary) {
                        try {
                            duelOpponentSession = await SessionDB.get(oppSummary.username);
                        } catch (err) {
                            console.warn('Failed to rehydrate duel opponent session:', err);
                        }
                        if (!duelOpponentSession || !duelOpponentSession.trips) {
                            duelOpponentSession = oppSummary;
                        }
                    }
                }
                renderDuelSection();
                container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        });
    }

    const duelCloseBtn = document.getElementById('duelCloseBtn');
    if (duelCloseBtn) {
        duelCloseBtn.addEventListener('click', () => {
            const container = document.getElementById('duelContainer');
            if (container) container.classList.remove('active');
            if (duelToggleBtn) duelToggleBtn.classList.remove('active');
        });
    }

    // Duel Opponent Switcher
    const duelSelect = document.getElementById('duelOpponentSelect');
    if (duelSelect) {
        duelSelect.addEventListener('change', async (e) => {
            const user = normUser(e.target.value);
            try {
                duelOpponentSession = await SessionDB.get(user);
            } catch (err) {
                console.warn('Failed to rehydrate opponent session:', err);
            }
            if (!duelOpponentSession || !duelOpponentSession.trips) {
                duelOpponentSession = allSessions.find(s => normUser(s.username) === user);
            }
            renderDuelSection();
        });
    }

    // Share Wrapped Modal
    const shareBtn = document.getElementById('shareWrappedBtn');
    const shareModal = document.getElementById('shareCardModal');
    const modalCloseBtn = document.getElementById('closeShareModalBtn');
    const downloadCardBtn = document.getElementById('downloadCardBtn');
    const shareNativeBtn = document.getElementById('shareNativeBtn');

    if (shareBtn && shareModal) {
        shareBtn.addEventListener('click', async () => {
            shareBtn.disabled = true;
            shareBtn.textContent = 'Generating Card...';
            try {
                currentCardCanvas = await generateWrappedCardCanvas(currentInsights, activeSession, activeYear === 'all' ? 'All-Time' : activeYear);
                const previewImg = document.getElementById('cardPreviewImg');
                if (previewImg) {
                    previewImg.src = currentCardCanvas.toDataURL('image/png');
                }
                shareModal.showModal();
            } catch (err) {
                console.error('Failed to generate card:', err);
                alert('Could not generate story card. Please try again.');
            } finally {
                shareBtn.disabled = false;
                shareBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align: middle;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg><span>Share My Year</span>';
            }
        });
    }

    if (shareModal) {
        if (modalCloseBtn) {
            modalCloseBtn.addEventListener('click', () => shareModal.close());
        }
        // Light dismiss when clicking outside modal (on native <dialog> backdrop)
        shareModal.addEventListener('click', (e) => {
            const rect = shareModal.getBoundingClientRect();
            const isInDialog = (
                rect.top <= e.clientY && e.clientY <= rect.top + rect.height &&
                rect.left <= e.clientX && e.clientX <= rect.left + rect.width
            );
            if (!isInDialog) {
                shareModal.close();
            }
        });
    }

    if (downloadCardBtn) {
        downloadCardBtn.addEventListener('click', () => {
            if (currentCardCanvas) {
                const yearLabel = activeYear === 'all' ? 'all-time' : activeYear;
                downloadWrappedCard(currentCardCanvas, `rail-wrapped-${activeSession.username}-${yearLabel}.png`);
            }
        });
    }

    if (shareNativeBtn) {
        if (!navigator.share) {
            shareNativeBtn.style.display = 'none';
        } else {
            shareNativeBtn.addEventListener('click', () => {
                if (currentCardCanvas) {
                    const yearLabel = activeYear === 'all' ? 'All-Time' : activeYear;
                    shareWrappedCard(currentCardCanvas, `${activeSession.displayName || activeSession.username}'s Rail Wrapped (${yearLabel})`);
                }
            });
        }
    }
}

function runWithTransition(fn) {
    if (document.startViewTransition && typeof document.startViewTransition === 'function') {
        document.startViewTransition(fn);
    } else {
        fn();
    }
}

function updateUrlParams() {
    const url = new URL(window.location);
    if (activeSession?.username) {
        url.searchParams.set('user', activeSession.username);
    }
    if (activeYear && activeYear !== 'all') {
        url.searchParams.set('year', activeYear);
    } else {
        url.searchParams.delete('year');
    }
    window.history.replaceState({}, '', url);

    // Synchronize cross-view navigation links
    syncNavigationLinks(activeSession?.username);
}

function renderProfileDropdown() {
    const profileSelect = document.getElementById('profileSelect');
    if (!profileSelect) return;

    if (!allSessions.length) {
        profileSelect.innerHTML = '<option value="">No cached users</option>';
        return;
    }

    const normUser = u => (u || '').toLowerCase().replace(/^@/, '').trim();
    profileSelect.innerHTML = allSessions.map(s => {
        const selected = (activeSession && normUser(s.username) === normUser(activeSession.username)) ? 'selected' : '';
        const name = s.displayName ? `${s.displayName} (@${s.username})` : `@${s.username}`;
        return `<option value="${s.username}" ${selected}>${name}</option>`;
    }).join('');
}

function renderYearPills(years) {
    const container = document.getElementById('yearPillsContainer');
    if (!container) return;

    const allPill = `<button type="button" class="control-pill ${activeYear === 'all' ? 'active' : ''}" data-year="all">All-Time</button>`;
    const yearPills = years.map(y => {
        const isActive = String(activeYear) === String(y);
        return `<button type="button" class="control-pill ${isActive ? 'active' : ''}" data-year="${y}">${y}</button>`;
    }).join('');

    container.innerHTML = allPill + yearPills;

    container.querySelectorAll('.control-pill').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const yr = e.target.getAttribute('data-year');
            if (yr !== activeYear) {
                activeYear = yr;
                updateUrlParams();
                runWithTransition(() => renderWrapped());
            }
        });
    });
}

function renderWrapped() {
    const trips = activeSession?.trips || [];
    const availableYears = extractAvailableYears(trips);
    renderYearPills(availableYears);

    const filteredTrips = filterTripsByYear(trips, activeYear);
    currentInsights = calculateWrappedInsights(filteredTrips, activeSession.username);

    // 1. Profile Banner
    const avatarEl = document.getElementById('heroAvatar');
    const nameEl = document.getElementById('heroName');
    const subtitleEl = document.getElementById('heroSubtitle');
    const mapLinkEl = document.getElementById('viewOnMapLink');

    if (avatarEl) {
        if (activeSession.avatar) {
            avatarEl.style.backgroundImage = `url('${activeSession.avatar}')`;
            avatarEl.textContent = '';
        } else {
            avatarEl.style.backgroundImage = 'none';
            avatarEl.textContent = (activeSession.username?.[0] || 'T').toUpperCase();
        }
    }

    const yearText = activeYear === 'all' ? 'All-Time Journey Record' : `${activeYear} Year on Rails`;
    if (nameEl) nameEl.textContent = activeSession.displayName || activeSession.username;
    if (subtitleEl) subtitleEl.textContent = `@${activeSession.username} · ${yearText} · ${filteredTrips.length} check-ins`;
    if (mapLinkEl) mapLinkEl.href = `index.html?user=${encodeURIComponent(activeSession.username)}`;

    // 2. KPI Cards
    setVal('kpiDistance', `${currentInsights.totalKm.toLocaleString()} km`);
    setVal('kpiDistanceSub', `${currentInsights.earthCircumferences}× Earth circumferences · ${currentInsights.moonDistancePercent}% to Moon`);

    setVal('kpiTrips', currentInsights.totalTrips.toLocaleString());
    setVal('kpiTripsSub', `~${currentInsights.totalDurationHours} hours spent on tracks`);

    setVal('kpiPunctuality', `${currentInsights.punctuality.rate}%`);
    setVal('kpiPunctualitySub', `${currentInsights.punctuality.delayedCount} delayed trips (${currentInsights.punctuality.totalDelayMinutes.toLocaleString()} min total)`);

    setVal('kpiCo2', `${currentInsights.co2SavedKg.toLocaleString()} kg`);
    setVal('kpiCo2Sub', `Saved vs driving equivalent distance`);

    // 3. Habits Heatmap
    renderHeatmap(currentInsights.habits);

    // 4. Transport Categories
    renderCategoryBreakdown(currentInsights.records.categoryBreakdown);

    // 5. Stations
    renderTopStations(currentInsights.records.topStations);

    // 6. Highlight Records
    renderHighlights(currentInsights.records, currentInsights.punctuality);

    // 7. Duel Mode
    if (document.getElementById('duelContainer')?.classList.contains('active')) {
        renderDuelSection();
    }
}

function setVal(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function renderHeatmap(habits) {
    const container = document.getElementById('habitsHeatmap');
    if (!container) return;

    const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    let maxHourVal = 1;
    habits.dayHourMatrix.forEach(row => {
        row.forEach(val => {
            if (val > maxHourVal) maxHourVal = val;
        });
    });

    let html = '';
    habits.dayHourMatrix.forEach((hours, dayIdx) => {
        html += `<div class="heatmap-row">`;
        html += `<span class="heatmap-day-label">${dayLabels[dayIdx]}</span>`;
        html += `<div class="heatmap-cells">`;
        hours.forEach((count, hour) => {
            let intensity = 0;
            if (count > 0) {
                const ratio = count / maxHourVal;
                if (ratio > 0.75) intensity = 4;
                else if (ratio > 0.45) intensity = 3;
                else if (ratio > 0.2) intensity = 2;
                else intensity = 1;
            }
            const timeLabel = `${String(hour).padStart(2, '0')}:00`;
            html += `<div class="heatmap-cell" data-intensity="${intensity}" title="${dayLabels[dayIdx]} at ${timeLabel}: ${count} trip(s)"></div>`;
        });
        html += `</div></div>`;
    });

    container.innerHTML = html;

    const summaryEl = document.getElementById('habitsSummaryText');
    if (summaryEl) {
        summaryEl.textContent = `Prime travel time: ${habits.busiestDayName}s around ${habits.busiestHourLabel}. Busiest month: ${habits.busiestMonthName}.`;
    }
}

function renderCategoryBreakdown(categories = []) {
    const container = document.getElementById('categoryBarsContainer');
    if (!container) return;

    if (!categories.length) {
        container.innerHTML = '<p class="section-sub">No categories recorded</p>';
        return;
    }

    container.innerHTML = categories.slice(0, 6).map(c => `
        <div class="category-bar-item">
            <div class="category-bar-meta">
                <span>${c.label} (${c.trips} trips)</span>
                <span>${c.distance.toLocaleString()} km (${c.percent}%)</span>
            </div>
            <div class="category-progress-track">
                <div class="category-progress-fill" style="width: ${c.percent}%; background: ${c.color};"></div>
            </div>
        </div>
    `).join('');
}

function renderTopStations(stations = []) {
    const container = document.getElementById('topStationsList');
    if (!container) return;

    if (!stations.length) {
        container.innerHTML = '<p class="section-sub">No stations recorded</p>';
        return;
    }

    container.innerHTML = stations.slice(0, 8).map((stn, idx) => {
        return `
            <div class="top-item-row">
                <div class="top-item-left">
                    <span class="top-item-rank">#${idx + 1}</span>
                    <span class="top-item-name">${escapeHtml(stn.name)}</span>
                </div>
                <div style="display: flex; align-items: center; gap: 12px;">
                    <span class="top-item-badge">${stn.visits} visits</span>
                </div>
            </div>
        `;
    }).join('');
}

function renderHighlights(records, punctuality) {
    // Favorite Line
    const favLineEl = document.getElementById('favLineText');
    const favLineSub = document.getElementById('favLineSub');
    if (favLineEl) {
        favLineEl.textContent = records.favoriteLine ? records.favoriteLine.line : 'Various Lines';
    }
    if (favLineSub) {
        favLineSub.textContent = records.favoriteLine ? `${records.favoriteLine.count} check-ins` : '0 trips';
    }

    // Longest Journey
    const longestEl = document.getElementById('longestTripRoute');
    const longestSub = document.getElementById('longestTripSub');
    if (longestEl) {
        longestEl.textContent = records.longestTrip ? `${records.longestTrip.origin} → ${records.longestTrip.destination}` : 'None';
    }
    if (longestSub) {
        if (records.longestTrip) {
            const dist = records.longestTrip.distance;
            const distStr = dist >= 10 ? Math.round(dist).toLocaleString() : (Math.round(dist * 10) / 10).toLocaleString();
            longestSub.textContent = `${distStr} km · ${records.longestTrip.lineName}`;
        } else {
            longestSub.textContent = '0 km';
        }
    }

    // Delay Hall of Fame (Redesigned)
    const worstDelayEl = document.getElementById('worstDelayMinutes');
    const worstDelayRoute = document.getElementById('worstDelayRoute');
    const worstDelayTrain = document.getElementById('worstDelayTrain');
    const worstDelayDate = document.getElementById('worstDelayDate');

    const totalTrips = (punctuality.onTimeCount || 0) + (punctuality.delayedCount || 0);

    if (punctuality.worstDelay) {
        if (worstDelayEl) worstDelayEl.textContent = `+${punctuality.worstDelay.delayMinutes} min`;
        if (worstDelayRoute) worstDelayRoute.textContent = `${punctuality.worstDelay.origin} → ${punctuality.worstDelay.destination}`;
        if (worstDelayTrain) worstDelayTrain.textContent = punctuality.worstDelay.lineName;
        if (worstDelayDate) {
            const d = punctuality.worstDelay.date ? new Date(punctuality.worstDelay.date) : null;
            worstDelayDate.textContent = (d && !isNaN(d.getTime()))
                ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
                : '';
        }
    } else {
        if (worstDelayEl) worstDelayEl.textContent = '0 min';
        if (worstDelayRoute) worstDelayRoute.textContent = 'Zero significant delays recorded!';
        if (worstDelayTrain) worstDelayTrain.textContent = 'Fully on-time';
        if (worstDelayDate) worstDelayDate.textContent = '';
    }

    // 4-Tier Spectrum Bar & Legend
    const tiers = punctuality.tiers || {
        onTimePct: punctuality.rate,
        minorPct: 0,
        moderatePct: 0,
        severePct: 0,
        onTime: punctuality.onTimeCount,
        minor: 0,
        moderate: 0,
        severe: 0
    };

    const pBadge = document.getElementById('delayPunctualityBadge');
    if (pBadge) {
        pBadge.textContent = `${punctuality.rate}% on-time`;
        pBadge.style.color = punctuality.rate >= 80 ? '#2ecc71' : (punctuality.rate >= 60 ? '#f1c40f' : '#ff4757');
    }

    const tOnTimeBar = document.getElementById('tierOnTimeBar');
    const tMinorBar = document.getElementById('tierMinorBar');
    const tModerateBar = document.getElementById('tierModerateBar');
    const tSevereBar = document.getElementById('tierSevereBar');
    if (tOnTimeBar) tOnTimeBar.style.width = `${tiers.onTimePct}%`;
    if (tMinorBar) tMinorBar.style.width = `${tiers.minorPct}%`;
    if (tModerateBar) tModerateBar.style.width = `${tiers.moderatePct}%`;
    if (tSevereBar) tSevereBar.style.width = `${tiers.severePct}%`;

    const lOnTime = document.getElementById('tierOnTimeLegend');
    const lMinor = document.getElementById('tierMinorLegend');
    const lModerate = document.getElementById('tierModerateLegend');
    const lSevere = document.getElementById('tierSevereLegend');
    if (lOnTime) lOnTime.textContent = `≤5m: ${tiers.onTimePct}%`;
    if (lMinor) lMinor.textContent = `6-15m: ${tiers.minorPct}%`;
    if (lModerate) lModerate.textContent = `16-30m: ${tiers.moderatePct}%`;
    if (lSevere) lSevere.textContent = `>30m: ${tiers.severePct}%`;

    // 3 Telemetry Metrics
    const delayTotalEl = document.getElementById('delayTotalMinutes');
    const delayHoursSub = document.getElementById('delayTotalHoursSub');
    const delayCountEl = document.getElementById('delayDelayedCount');
    const delayFractionSub = document.getElementById('delayDelayedFractionSub');
    const delayRateEl = document.getElementById('delayPunctualityRate');
    const delayStatus = document.getElementById('delayPunctualityStatus');

    if (delayTotalEl) delayTotalEl.textContent = `${punctuality.totalDelayMinutes.toLocaleString()} min`;
    if (delayHoursSub) {
        const hrs = Math.floor(punctuality.totalDelayMinutes / 60);
        const mins = punctuality.totalDelayMinutes % 60;
        delayHoursSub.textContent = hrs > 0 ? `~${hrs}h ${mins}m lost` : `${mins}m total lost`;
    }

    if (delayCountEl) delayCountEl.textContent = `${punctuality.delayedCount}`;
    if (delayFractionSub) delayFractionSub.textContent = `of ${totalTrips} check-in${totalTrips === 1 ? '' : 's'}`;

    if (delayRateEl) delayRateEl.textContent = `${punctuality.rate}%`;
    if (delayStatus) {
        if (punctuality.rate >= 90) {
            delayStatus.textContent = 'Excellent';
            delayStatus.style.color = '#2ecc71';
        } else if (punctuality.rate >= 75) {
            delayStatus.textContent = 'Good';
            delayStatus.style.color = '#2ecc71';
        } else if (punctuality.rate >= 55) {
            delayStatus.textContent = 'Moderate';
            delayStatus.style.color = '#f1c40f';
        } else {
            delayStatus.textContent = 'High Delays';
            delayStatus.style.color = '#ff4757';
        }
    }

    // Top Companions
    const buddiesContainer = document.getElementById('topBuddiesList');
    if (buddiesContainer) {
        if (!records.topBuddies.length) {
            buddiesContainer.innerHTML = '<p class="section-sub" style="margin: 0; font-size: 13px;">No travel companions recorded in this period</p>';
        } else {
            buddiesContainer.innerHTML = records.topBuddies.map(b => `
                <div class="top-item-row">
                    <div class="top-item-left">
                        <span style="display: inline-flex; align-items: center; color: var(--accent-purple);"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg></span>
                        <span class="top-item-name">@${escapeHtml(b.username)}</span>
                    </div>
                    <span class="top-item-badge">${b.sharedTrips} trips (${Math.round(b.sharedKm)} km)</span>
                </div>
            `).join('');
        }
    }
}

function renderDuelSection() {
    const duelSelect = document.getElementById('duelOpponentSelect');
    if (duelSelect) {
        const curUser = (activeSession?.username || '').toLowerCase();
        duelSelect.innerHTML = allSessions
            .filter(s => s.username?.toLowerCase() !== curUser)
            .map(s => `<option value="${s.username}" ${(duelOpponentSession && s.username?.toLowerCase() === duelOpponentSession.username?.toLowerCase()) ? 'selected' : ''}>${s.displayName || s.username} (@${s.username})</option>`)
            .join('');
    }

    if (!duelOpponentSession) return;

    const opponentTrips = filterTripsByYear(duelOpponentSession.trips || [], activeYear);
    const opponentInsights = calculateWrappedInsights(opponentTrips, duelOpponentSession.username);
    const comparison = compareUsers(currentInsights, opponentInsights, activeSession.displayName || activeSession.username, duelOpponentSession.displayName || duelOpponentSession.username);

    if (!comparison) return;

    const nameA = document.getElementById('duelPlayerAName');
    const nameB = document.getElementById('duelPlayerBName');
    if (nameA) nameA.textContent = comparison.userA.name;
    if (nameB) nameB.textContent = comparison.userB.name;

    const avatarA = document.getElementById('duelPlayerAAvatar');
    const avatarB = document.getElementById('duelPlayerBAvatar');
    if (avatarA) {
        avatarA.textContent = (comparison.userA.name || '1').charAt(0).toUpperCase();
    }
    if (avatarB) {
        avatarB.textContent = (comparison.userB.name || '2').charAt(0).toUpperCase();
    }

    const tbody = document.getElementById('duelTableBody');
    if (tbody) {
        const rows = [
            { label: 'Total Distance', a: `${comparison.userA.km.toLocaleString()} km`, b: `${comparison.userB.km.toLocaleString()} km`, win: comparison.winners.km },
            { label: 'Journeys Recorded', a: `${comparison.userA.trips.toLocaleString()} trips`, b: `${comparison.userB.trips.toLocaleString()} trips`, win: comparison.winners.trips },
            { label: 'Hours on Tracks', a: `~${comparison.userA.hours} hrs`, b: `~${comparison.userB.hours} hrs`, win: comparison.winners.hours },
            { label: 'Punctuality Rate', a: `${comparison.userA.punctuality}%`, b: `${comparison.userB.punctuality}%`, win: comparison.winners.punctuality },
            { label: 'Unique Arrival Stations', a: `${comparison.userA.stations} stations`, b: `${comparison.userB.stations} stations`, win: comparison.winners.stations }
        ];

        tbody.innerHTML = rows.map(r => `
            <tr>
                <td class="${r.win === 'userA' ? 'winner' : ''}">${r.win === 'userA' ? '★ ' : ''}${r.a}</td>
                <td style="font-weight: 600; color: var(--text-secondary);">${r.label}</td>
                <td class="${r.win === 'userB' ? 'winner' : ''}">${r.win === 'userB' ? '★ ' : ''}${r.b}</td>
            </tr>
        `).join('');
    }
}

function showEmptyState() {
    const emptyEl = document.getElementById('wrappedEmptyState');
    const contentEl = document.getElementById('wrappedContent');
    if (emptyEl) {
        emptyEl.classList.remove('hidden');
        emptyEl.style.display = 'block';
    }
    if (contentEl) {
        contentEl.classList.add('hidden');
        contentEl.style.display = 'none';
    }
}

function hideEmptyState() {
    const emptyEl = document.getElementById('wrappedEmptyState');
    const contentEl = document.getElementById('wrappedContent');
    if (emptyEl) {
        emptyEl.classList.add('hidden');
        emptyEl.style.display = 'none';
    }
    if (contentEl) {
        contentEl.classList.remove('hidden');
        contentEl.style.display = 'block';
    }
}

