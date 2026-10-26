// Main application controller for Träwelling Insights & Wrapped
import { SessionDB } from '../cache/session.js';
import {
    extractAvailableYears,
    filterTripsByYear,
    calculateWrappedInsights,
    compareUsers,
    CATEGORY_LABELS,
    CATEGORY_COLORS
} from './analytics.js';
import {
    generateWrappedCardCanvas,
    downloadWrappedCard,
    shareWrappedCard
} from './socialCard.js';

let allSessions = [];
let activeSession = null;
let activeYear = 'all';
let currentInsights = null;
let currentCardCanvas = null;
let duelOpponentSession = null;

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', initInsights);

export async function initInsights() {
    try {
        allSessions = await SessionDB.getAll();
    } catch (e) {
        console.warn('Failed to load sessions from SessionDB:', e);
        allSessions = [];
    }

    const urlParams = new URLSearchParams(window.location.search);
    const requestedUser = urlParams.get('user')?.toLowerCase().trim();
    const requestedYear = urlParams.get('year') || 'all';

    if (allSessions.length > 0) {
        if (requestedUser) {
            activeSession = allSessions.find(s => s.username?.toLowerCase() === requestedUser) || allSessions[0];
        } else {
            activeSession = allSessions[0];
        }
    }

    setupEventListeners();
    renderProfileDropdown();

    if (!activeSession || !activeSession.trips || activeSession.trips.length === 0) {
        showEmptyState();
        return;
    }

    activeYear = requestedYear;
    renderInsights();
}

function setupEventListeners() {
    // Profile Switcher
    const profileSelect = document.getElementById('profileSelect');
    if (profileSelect) {
        profileSelect.addEventListener('change', (e) => {
            const user = (e.target.value || '').toLowerCase().trim();
            const found = allSessions.find(s => s.username?.toLowerCase() === user);
            if (found) {
                activeSession = found;
                activeYear = 'all';
                updateUrlParams();
                runWithTransition(() => renderInsights());
            }
        });
    }

    // Duel Toggle
    const duelToggleBtn = document.getElementById('duelToggleBtn');
    if (duelToggleBtn) {
        duelToggleBtn.addEventListener('click', () => {
            const container = document.getElementById('duelContainer');
            const isActive = container.classList.toggle('active');
            duelToggleBtn.classList.toggle('active', isActive);
            if (isActive && !duelOpponentSession && allSessions.length > 1) {
                const currentLower = (activeSession?.username || '').toLowerCase();
                duelOpponentSession = allSessions.find(s => s.username?.toLowerCase() !== currentLower) || allSessions[1];
                renderDuelSection();
            }
        });
    }

    // Duel Opponent Switcher
    const duelSelect = document.getElementById('duelOpponentSelect');
    if (duelSelect) {
        duelSelect.addEventListener('change', (e) => {
            const user = (e.target.value || '').toLowerCase().trim();
            duelOpponentSession = allSessions.find(s => s.username?.toLowerCase() === user);
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
                shareBtn.innerHTML = '<span>✨</span><span>Share My Year</span>';
            }
        });
    }

    if (modalCloseBtn && shareModal) {
        modalCloseBtn.addEventListener('click', () => shareModal.close());
    }

    if (downloadCardBtn) {
        downloadCardBtn.addEventListener('click', () => {
            if (currentCardCanvas) {
                const yearLabel = activeYear === 'all' ? 'all-time' : activeYear;
                downloadWrappedCard(currentCardCanvas, `traewelling-wrapped-${activeSession.username}-${yearLabel}.png`);
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
                    shareWrappedCard(currentCardCanvas, `${activeSession.displayName || activeSession.username}'s Träwelling Wrapped (${yearLabel})`);
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
}

function renderProfileDropdown() {
    const profileSelect = document.getElementById('profileSelect');
    if (!profileSelect) return;

    if (!allSessions.length) {
        profileSelect.innerHTML = '<option value="">No cached users</option>';
        return;
    }

    profileSelect.innerHTML = allSessions.map(s => {
        const selected = (activeSession && s.username?.toLowerCase() === activeSession.username?.toLowerCase()) ? 'selected' : '';
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
                runWithTransition(() => renderInsights());
            }
        });
    });
}

function renderInsights() {
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
    setVal('kpiDistanceSub', `🌍 ${currentInsights.earthCircumferences}× Earth circumferences · 🌙 ${currentInsights.moonDistancePercent}% to Moon`);

    setVal('kpiTrips', currentInsights.totalTrips.toLocaleString());
    setVal('kpiTripsSub', `⏱️ ~${currentInsights.totalDurationHours} hours spent on tracks`);

    setVal('kpiPunctuality', `${currentInsights.punctuality.rate}%`);
    setVal('kpiPunctualitySub', `⚠️ ${currentInsights.punctuality.delayedCount} delayed trips (${currentInsights.punctuality.totalDelayMinutes.toLocaleString()} min total)`);

    setVal('kpiCo2', `${currentInsights.co2SavedKg.toLocaleString()} kg`);
    setVal('kpiCo2Sub', `🌱 Saved vs driving equivalent distance`);

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
        const deepLink = stn.coords
            ? `<a class="map-deep-link" href="index.html?user=${encodeURIComponent(activeSession.username)}#map=12/${stn.coords[1].toFixed(4)}/${stn.coords[0].toFixed(4)}" title="View on map">📍 Map</a>`
            : '';

        return `
            <div class="top-item-row">
                <div class="top-item-left">
                    <span class="top-item-rank">#${idx + 1}</span>
                    <span class="top-item-name">${escapeHtml(stn.name)}</span>
                </div>
                <div style="display: flex; align-items: center; gap: 12px;">
                    <span class="top-item-badge">${stn.visits} visits</span>
                    ${deepLink}
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
        longestEl.textContent = records.longestTrip ? `${records.longestTrip.origin} ➔ ${records.longestTrip.destination}` : 'None';
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

    // Delay Hall of Fame
    const worstDelayEl = document.getElementById('worstDelayMinutes');
    const worstDelayRoute = document.getElementById('worstDelayRoute');
    const delayTotalEl = document.getElementById('delayTotalMinutes');
    const delayCountEl = document.getElementById('delayDelayedCount');
    const delayRateEl = document.getElementById('delayPunctualityRate');

    if (punctuality.worstDelay) {
        if (worstDelayEl) worstDelayEl.textContent = `+${punctuality.worstDelay.delayMinutes} min`;
        if (worstDelayRoute) worstDelayRoute.textContent = `${punctuality.worstDelay.lineName}: ${punctuality.worstDelay.origin} ➔ ${punctuality.worstDelay.destination}`;
    } else {
        if (worstDelayEl) worstDelayEl.textContent = 'None';
        if (worstDelayRoute) worstDelayRoute.textContent = 'Zero significant delays recorded!';
    }

    if (delayTotalEl) delayTotalEl.textContent = `${punctuality.totalDelayMinutes.toLocaleString()} min`;
    if (delayCountEl) delayCountEl.textContent = `${punctuality.delayedCount} / ${records.uniqueStationsCount ? punctuality.onTimeCount + punctuality.delayedCount : 0}`;
    if (delayRateEl) delayRateEl.textContent = `${punctuality.rate}%`;

    // Top Companions
    const buddiesContainer = document.getElementById('topBuddiesList');
    if (buddiesContainer) {
        if (!records.topBuddies.length) {
            buddiesContainer.innerHTML = '<p class="section-sub" style="margin: 0; font-size: 13px;">No travel companions recorded in this period</p>';
        } else {
            buddiesContainer.innerHTML = records.topBuddies.map(b => `
                <div class="top-item-row">
                    <div class="top-item-left">
                        <span style="font-size: 16px;">👥</span>
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
                <td class="${r.win === 'userA' ? 'winner' : ''}">${r.win === 'userA' ? '👑 ' : ''}${r.a}</td>
                <td style="font-weight: 600; color: var(--text-secondary);">${r.label}</td>
                <td class="${r.win === 'userB' ? 'winner' : ''}">${r.win === 'userB' ? '👑 ' : ''}${r.b}</td>
            </tr>
        `).join('');
    }
}

function showEmptyState() {
    const main = document.querySelector('.insights-container');
    if (main) {
        main.innerHTML = `
            <div class="panel-card" style="text-align: center; padding: 60px 20px; max-width: 600px; margin: 60px auto;">
                <div style="font-size: 54px; margin-bottom: 16px;">🚂</div>
                <h2 style="font-family: var(--font-heading); margin: 0 0 12px; font-size: 1.8rem;">No Travel Journeys Found Yet</h2>
                <p style="color: var(--text-secondary); font-size: 15px; margin: 0 0 24px;">
                    Start by exploring any Träwelling user profile or uploading exported GeoJSON data on the main map.
                </p>
                <div style="display: flex; justify-content: center; gap: 12px;">
                    <a href="index.html" class="nav-link-btn primary" style="padding: 12px 24px; font-size: 14px; border-radius: 24px;">
                        Open Map Explorer
                    </a>
                </div>
            </div>
        `;
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
