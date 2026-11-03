/**
 * Check-in Text Randomizer — Interactive Loading Screen Feature
 * Replaces DB Delay Bingo with an automatic live check-in showcase.
 * Every X seconds (default: 4s), it picks and animates a random status text/comment
 * from incoming user check-in data, preserving the sleek floating window design.
 */

import { escapeHtml } from '../../utils/format.js';
import { normalizeCategory } from '../../data/processing.js';

export const ROTATION_INTERVAL_MS = 4000;

export const CheckinRandomizer = {
    container: null,
    cardEl: null,
    checkinsWithText: [],
    allCheckins: [],
    seenIds: new Set(),
    currentTrip: null,
    timerId: null,
    progressTimerId: null,
    progressStart: 0,
    isPaused: false,
    isMinimized: false,
    activeUsername: '',
    intervalMs: ROTATION_INTERVAL_MS,

    /**
     * Initialize container element in DOM
     */
    init() {
        if (this.container && document.body?.contains?.(this.container)) {
            return this.container;
        }

        const screen = document.getElementById('fetchScreen') || document.body;
        let c = document.getElementById('loadingBingoWidget');
        if (!c) {
            c = document.createElement('div');
            c.id = 'loadingBingoWidget';
            screen?.appendChild?.(c);
        }
        c.className = 'loading-bingo-widget loading-randomizer-widget';
        this.container = c;
        return this.container;
    },

    /**
     * Start the randomizer when data fetching begins
     * @param {Object} options Options including username and incremental flag
     */
    start(options = {}) {
        this.activeUsername = options.username || '';
        this.checkinsWithText = [];
        this.allCheckins = [];
        this.seenIds.clear();
        this.currentTrip = null;
        this.isPaused = false;
        this.isMinimized = false;
        this.stopTimers();

        this.init();
        this.render();

        if (this.container) {
            this.container.classList.remove('hidden');
            this.container.classList.add('visible');
        }

        this.startTimer();
    },

    /**
     * Ingest incoming batch of check-in trips from the orchestrator
     * @param {Array<Object>} trips Incoming trip objects
     */
    onTripBatch(trips = []) {
        if (!Array.isArray(trips) || trips.length === 0) return;

        let addedNotesCount = 0;

        for (const trip of trips) {
            if (!trip) continue;
            const id = trip.id ? String(trip.id) : null;
            if (id && this.seenIds.has(id)) continue;
            if (id) this.seenIds.add(id);

            const bodyText = (typeof trip.body === 'string' ? trip.body : (trip.checkin?.body || '')).trim();

            const item = {
                id: trip.id,
                body: bodyText,
                createdAt: trip.createdAt || trip.train?.origin?.departureReal || trip.checkin?.origin?.departureReal || null,
                train: trip.train || trip.checkin || {},
                checkin: trip.checkin || trip.train || {},
                business: trip.business ?? trip.checkin?.business ?? 0
            };

            this.allCheckins.push(item);
            if (bodyText.length > 0) {
                this.checkinsWithText.push(item);
                addedNotesCount++;
            }
        }

        // If no trip is currently shown, display one immediately
        if (!this.currentTrip && (this.checkinsWithText.length > 0 || this.allCheckins.length > 0)) {
            this.nextRandom();
        } else {
            this.updateCounter();
        }
    },

    /**
     * Pick and display the next random check-in
     */
    nextRandom() {
        const pool = this.checkinsWithText.length > 0 ? this.checkinsWithText : this.allCheckins;
        if (pool.length === 0) {
            this.render();
            return;
        }

        // Avoid repeating the exact same trip consecutively if we have more than 1
        let nextTrip;
        if (pool.length === 1) {
            nextTrip = pool[0];
        } else {
            const candidates = this.currentTrip ? pool.filter(t => t.id !== this.currentTrip.id) : pool;
            const pickPool = candidates.length > 0 ? candidates : pool;
            const randomIndex = Math.floor(Math.random() * pickPool.length);
            nextTrip = pickPool[randomIndex];
        }

        this.currentTrip = nextTrip;
        this.renderCardContent(true);
        this.resetProgress();
    },

    /**
     * Start the automatic rotation interval
     */
    startTimer() {
        this.stopTimers();
        this.progressStart = Date.now();

        // High-frequency progress bar animator
        this.progressTimerId = setInterval(() => {
            if (this.isPaused || this.isMinimized) return;
            const elapsed = Date.now() - this.progressStart;
            const pct = Math.min(100, (elapsed / this.intervalMs) * 100);
            const fillEl = this.container?.querySelector?.('.randomizer-progress-fill');
            if (fillEl) {
                fillEl.style.width = `${pct}%`;
            }
        }, 50);

        // Rotation trigger
        this.timerId = setInterval(() => {
            if (this.isPaused || this.isMinimized) return;
            this.nextRandom();
        }, this.intervalMs);
    },

    /**
     * Reset rotation progress bar
     */
    resetProgress() {
        this.progressStart = Date.now();
        const fillEl = this.container?.querySelector?.('.randomizer-progress-fill');
        if (fillEl) {
            fillEl.style.width = '0%';
        }
    },

    /**
     * Stop active timers
     */
    stopTimers() {
        if (this.timerId) {
            clearInterval(this.timerId);
            this.timerId = null;
        }
        if (this.progressTimerId) {
            clearInterval(this.progressTimerId);
            this.progressTimerId = null;
        }
    },

    /**
     * Toggle pause / play state
     */
    togglePause() {
        this.isPaused = !this.isPaused;
        const pauseBtn = this.container?.querySelector?.('#randomizerPauseBtn');
        if (pauseBtn) {
            pauseBtn.textContent = this.isPaused ? '▶' : '⏸';
            pauseBtn.title = this.isPaused ? 'Fortsetzen' : 'Pausieren';
            pauseBtn.setAttribute('aria-label', this.isPaused ? 'Fortsetzen' : 'Pausieren');
        }
        const badge = this.container?.querySelector?.('.randomizer-status-pill');
        if (badge) {
            badge.textContent = this.isPaused ? 'Pausiert' : 'Live';
            badge.className = `randomizer-status-pill ${this.isPaused ? 'paused' : 'live'}`;
        }
    },

    /**
     * Toggle minimized floating bar state
     */
    toggleMinimize() {
        this.isMinimized = !this.isMinimized;
        if (this.container) {
            this.container.classList.toggle('minimized', this.isMinimized);
        }
        const minBtn = this.container?.querySelector?.('#randomizerMinimizeBtn');
        if (minBtn) {
            minBtn.textContent = this.isMinimized ? '□' : '−';
            minBtn.title = this.isMinimized ? 'Maximieren' : 'Minimieren';
            minBtn.setAttribute('aria-label', this.isMinimized ? 'Maximieren' : 'Minimieren');
        }
        const bodyEl = this.container?.querySelector?.('.randomizer-card-body');
        if (bodyEl) {
            bodyEl.style.display = this.isMinimized ? 'none' : 'flex';
        }
    },

    /**
     * Stop the randomizer when data fetching concludes
     */
    stop() {
        this.stopTimers();
        if (this.container) {
            this.container.classList.remove('visible');
            this.container.classList.add('hidden');
        }
    },

    /**
     * Reset data state
     */
    reset() {
        this.stopTimers();
        this.checkinsWithText = [];
        this.allCheckins = [];
        this.seenIds.clear();
        this.currentTrip = null;
        this.isPaused = false;
        this.render();
    },

    /**
     * Destroy DOM elements and cleanup
     */
    destroy() {
        this.stopTimers();
        if (this.container && this.container.parentElement) {
            this.container.remove();
        }
        this.container = null;
        this.cardEl = null;
        this.checkinsWithText = [];
        this.allCheckins = [];
        this.seenIds.clear();
        this.currentTrip = null;
    },

    /**
     * Update the counter displayed in the header
     */
    updateCounter() {
        const counterEl = this.container?.querySelector?.('.randomizer-subtitle');
        if (counterEl) {
            const notesCount = this.checkinsWithText.length;
            const totalCount = this.allCheckins.length;
            if (notesCount > 0) {
                counterEl.textContent = `${notesCount} Notizen in ${totalCount} Check-ins`;
            } else if (totalCount > 0) {
                counterEl.textContent = `${totalCount} Check-ins geladen`;
            } else {
                counterEl.textContent = 'Warte auf Reisedaten...';
            }
        }
    },

    /**
     * Render the initial floating window skeleton
     */
    render() {
        if (!this.container) return;

        const notesCount = this.checkinsWithText.length;
        const totalCount = this.allCheckins.length;
        let subText = 'Warte auf Reisedaten...';
        if (notesCount > 0) subText = `${notesCount} Notizen in ${totalCount} Check-ins`;
        else if (totalCount > 0) subText = `${totalCount} Check-ins geladen`;

        this.container.innerHTML = `
            <div class="bingo-card-container randomizer-card-container">
                <!-- Header -->
                <div class="bingo-card-header randomizer-header">
                    <div class="bingo-title-wrap">
                        <span class="bingo-header-icon" aria-hidden="true">💬</span>
                        <div>
                            <div style="display: flex; align-items: center; gap: 6px;">
                                <span class="bingo-title">Check-in Ticker</span>
                                <span class="randomizer-status-pill ${this.isPaused ? 'paused' : 'live'}">${this.isPaused ? 'Pausiert' : 'Live'}</span>
                            </div>
                            <span class="bingo-subtitle randomizer-subtitle">${escapeHtml(subText)}</span>
                        </div>
                    </div>
                    <div class="bingo-header-actions">
                        <button type="button" class="bingo-btn-icon" id="randomizerNextBtn" title="Nächster Zufalls-Check-in" aria-label="Nächster Zufalls-Check-in">🎲</button>
                        <button type="button" class="bingo-btn-icon" id="randomizerPauseBtn" title="${this.isPaused ? 'Fortsetzen' : 'Pausieren'}" aria-label="Pause / Weiter">${this.isPaused ? '▶' : '⏸'}</button>
                        <button type="button" class="bingo-btn-icon" id="randomizerMinimizeBtn" title="Minimieren" aria-label="Minimieren">− </button>
                        <button type="button" class="bingo-btn-icon" id="randomizerCloseBtn" title="Schließen" aria-label="Schließen">✕</button>
                    </div>
                </div>

                <!-- Main Content Body -->
                <div class="randomizer-card-body" id="randomizerCardBody" style="${this.isMinimized ? 'display: none;' : ''}">
                    ${this.generateCardHtml()}
                </div>

                <!-- Sleek Rotation Progress Bar -->
                <div class="randomizer-progress-track">
                    <div class="randomizer-progress-fill"></div>
                </div>
            </div>
        `;

        this.bindEvents();
    },

    /**
     * Generate HTML representation of the current check-in
     */
    generateCardHtml() {
        if (!this.currentTrip) {
            return `
                <div class="randomizer-empty-state">
                    <div class="randomizer-empty-spinner"></div>
                    <div class="randomizer-empty-title">Check-ins werden analysiert...</div>
                    <div class="randomizer-empty-desc">Reisetexte und Kommentare erscheinen hier live alle ${Math.round(this.intervalMs / 1000)}s.</div>
                </div>
            `;
        }

        const trip = this.currentTrip;
        const train = trip.train || trip.checkin || {};
        const cat = normalizeCategory(train.category);
        const lineName = train.lineName || train.number || 'Zug';
        const originName = train.origin?.name || train.origin?.station?.name || 'Start';
        const destName = train.destination?.name || train.destination?.station?.name || 'Ziel';

        const depDelay = Math.round(((train.departureDelay ?? train.origin?.departureDelay ?? 0)) / 60);
        const arrDelay = Math.round(((train.arrivalDelay ?? train.destination?.arrivalDelay ?? 0)) / 60);
        const maxDelay = Math.max(depDelay, arrDelay);

        let delayTag = '<span class="randomizer-tag ontime">Pünktlich</span>';
        if (maxDelay > 0) {
            delayTag = `<span class="randomizer-tag delayed">+${maxDelay}m</span>`;
        } else if (maxDelay < 0) {
            delayTag = `<span class="randomizer-tag early">${maxDelay}m</span>`;
        }

        let dateStr = '—';
        if (trip.createdAt) {
            const d = new Date(trip.createdAt);
            if (!isNaN(d.getTime())) {
                dateStr = d.toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' });
            }
        }

        const hasText = trip.body && trip.body.trim().length > 0;
        const textContent = hasText
            ? escapeHtml(trip.body)
            : `<em style="color: #64748b;">(Check-in ohne Notiztext)</em>`;

        return `
            <div class="randomizer-bubble-wrap">
                <div class="randomizer-quote-icon" aria-hidden="true">“</div>
                <div class="randomizer-quote-text">${textContent}</div>
            </div>

            <div class="randomizer-trip-meta">
                <div class="randomizer-route-row">
                    <span class="randomizer-line-badge ${escapeHtml(cat)}">${escapeHtml(lineName)}</span>
                    <span class="randomizer-route-text" title="${escapeHtml(originName)} → ${escapeHtml(destName)}">
                        <strong>${escapeHtml(originName)}</strong> → <strong>${escapeHtml(destName)}</strong>
                    </span>
                </div>
                <div class="randomizer-footer-row">
                    <span class="randomizer-date">${escapeHtml(dateStr)}</span>
                    ${delayTag}
                </div>
            </div>
        `;
    },

    /**
     * Animate content change for the current check-in
     * @param {boolean} animated Whether to play a smooth cross-fade animation
     */
    renderCardContent(animated = true) {
        const bodyEl = this.container?.querySelector?.('#randomizerCardBody');
        if (!bodyEl) return;

        if (animated) {
            bodyEl.classList.remove('fading-in');
            bodyEl.classList.add('fading-out');
            setTimeout(() => {
                bodyEl.innerHTML = this.generateCardHtml();
                bodyEl.classList.remove('fading-out');
                bodyEl.classList.add('fading-in');
            }, 150);
        } else {
            bodyEl.innerHTML = this.generateCardHtml();
        }

        this.updateCounter();
    },

    /**
     * Attach UI event listeners
     */
    bindEvents() {
        const nextBtn = this.container?.querySelector?.('#randomizerNextBtn');
        nextBtn?.addEventListener?.('click', (e) => {
            e.stopPropagation();
            this.nextRandom();
        });

        const pauseBtn = this.container?.querySelector?.('#randomizerPauseBtn');
        pauseBtn?.addEventListener?.('click', (e) => {
            e.stopPropagation();
            this.togglePause();
        });

        const minBtn = this.container?.querySelector?.('#randomizerMinimizeBtn');
        minBtn?.addEventListener?.('click', (e) => {
            e.stopPropagation();
            this.toggleMinimize();
        });

        const closeBtn = this.container?.querySelector?.('#randomizerCloseBtn');
        closeBtn?.addEventListener?.('click', (e) => {
            e.stopPropagation();
            this.stop();
        });
    }
};
