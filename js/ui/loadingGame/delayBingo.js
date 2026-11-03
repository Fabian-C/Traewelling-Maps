/**
 * DB Delay Bingo — Interactive Loading Screen Mini-Game
 * A lightweight, zero-dependency 3x3 interactive card that reacts directly to incoming travel check-ins.
 * Users can click to stamp manually, or watch incoming data auto-stamp authentic railway events.
 */

export const BINGO_TILE_POOL = [
    {
        id: 'delay_15',
        title: 'Verspätung > 15m',
        subtitle: 'Klassiker der Schiene',
        icon: '⏱️',
        match: (t) => {
            const depDelay = t.train?.departureDelay ?? t.checkin?.departureDelay ?? 0;
            const arrDelay = t.train?.arrivalDelay ?? t.checkin?.arrivalDelay ?? 0;
            const maxDelay = Math.max(depDelay, arrDelay);
            if (maxDelay >= 900) {
                return { match: true, detail: `+${Math.round(maxDelay / 60)}m` };
            }
            return { match: false };
        }
    },
    {
        id: 'delay_30',
        title: 'Verspätung > 30m',
        subtitle: 'Fahrgastrechte freigeschaltet!',
        icon: '☕',
        match: (t) => {
            const depDelay = t.train?.departureDelay ?? t.checkin?.departureDelay ?? 0;
            const arrDelay = t.train?.arrivalDelay ?? t.checkin?.arrivalDelay ?? 0;
            const maxDelay = Math.max(depDelay, arrDelay);
            if (maxDelay >= 1800) {
                return { match: true, detail: `+${Math.round(maxDelay / 60)}m` };
            }
            return { match: false };
        }
    },
    {
        id: 'ontime',
        title: 'Pünktlich (±1m)',
        subtitle: 'Auf die Minute genau',
        icon: '🎯',
        match: (t) => {
            const depDelay = t.train?.departureDelay ?? t.checkin?.departureDelay ?? 0;
            const arrDelay = t.train?.arrivalDelay ?? t.checkin?.arrivalDelay ?? 0;
            const maxDelay = Math.max(Math.abs(depDelay), Math.abs(arrDelay));
            if (maxDelay <= 60) {
                return { match: true, detail: 'Pünktlich' };
            }
            return { match: false };
        }
    },
    {
        id: 'highspeed',
        title: 'ICE / Schnellzug',
        subtitle: 'Bis zu 300 km/h',
        icon: '🚅',
        match: (t) => {
            const cat = (t.train?.category || t.checkin?.category || '').toLowerCase();
            const line = (t.train?.lineName || t.checkin?.lineName || t.train?.number || '').toLowerCase();
            if (cat.includes('express') || cat.includes('highspeed') || line.includes('ice') || line.includes('tgv')) {
                return { match: true, detail: (t.train?.lineName || 'ICE').slice(0, 10) };
            }
            return { match: false };
        }
    },
    {
        id: 'regional',
        title: 'Regional-Express',
        subtitle: 'Das Rückgrat im Takt',
        icon: '🚆',
        match: (t) => {
            const cat = (t.train?.category || t.checkin?.category || '').toLowerCase();
            const line = (t.train?.lineName || t.checkin?.lineName || '').toLowerCase();
            if (cat.includes('regional') || line.startsWith('re') || line.startsWith('rb')) {
                return { match: true, detail: (t.train?.lineName || 'RE').slice(0, 8) };
            }
            return { match: false };
        }
    },
    {
        id: 'suburban',
        title: 'S-Bahn Sprint',
        subtitle: 'Quer durch die Metropole',
        icon: '🚇',
        match: (t) => {
            const cat = (t.train?.category || t.checkin?.category || '').toLowerCase();
            const line = (t.train?.lineName || t.checkin?.lineName || '').toLowerCase();
            if (cat.includes('suburban') || line.startsWith('s') || cat.includes('metro')) {
                return { match: true, detail: (t.train?.lineName || 'S-Bahn').slice(0, 8) };
            }
            return { match: false };
        }
    },
    {
        id: 'buddy',
        title: 'Reise mit Buddy',
        subtitle: 'Gemeinsam verspätet',
        icon: '👥',
        match: (t) => {
            const mentions = t.bodyMentions || [];
            const users = t.users || t.buddies || [];
            const body = t.body || '';
            if (mentions.length > 0 || users.length > 0 || /@[a-z0-9_]+/i.test(body)) {
                const name = mentions[0]?.username || users[0]?.username || 'Freunde';
                return { match: true, detail: `@${name}` };
            }
            return { match: false };
        }
    },
    {
        id: 'night_ride',
        title: 'Nachtfahrt (> 22h)',
        subtitle: 'Im schlafenden Zug',
        icon: '🌙',
        match: (t) => {
            const dStr = t.train?.origin?.departureReal || t.train?.origin?.departure || t.createdAt;
            if (!dStr) return { match: false };
            const hour = new Date(dStr).getHours();
            if (hour >= 22 || hour < 5) {
                return { match: true, detail: `${hour}:00 Uhr` };
            }
            return { match: false };
        }
    },
    {
        id: 'early_bird',
        title: 'Frühaufsteher (< 06h)',
        subtitle: 'Erster Kaffee am Gleis',
        icon: '🌅',
        match: (t) => {
            const dStr = t.train?.origin?.departureReal || t.train?.origin?.departure || t.createdAt;
            if (!dStr) return { match: false };
            const hour = new Date(dStr).getHours();
            if (hour >= 4 && hour < 6) {
                return { match: true, detail: `${hour}:00 Uhr` };
            }
            return { match: false };
        }
    },
    {
        id: 'long_haul',
        title: 'Fernreise > 250km',
        subtitle: 'Große Deutschland-Tour',
        icon: '🗺️',
        match: (t) => {
            const dist = (t.train?.totalDistance || t.train?.distance || t.checkin?.distance || 0);
            if (dist >= 250000) {
                return { match: true, detail: `${Math.round(dist / 1000)} km` };
            }
            return { match: false };
        }
    },
    {
        id: 'short_hop',
        title: 'Kurzstrecke < 15km',
        subtitle: 'Nur ein Katzensprung',
        icon: '👟',
        match: (t) => {
            const dist = (t.train?.totalDistance || t.train?.distance || t.checkin?.distance || 0);
            if (dist > 100 && dist <= 15000) {
                return { match: true, detail: `${Math.round(dist / 1000)} km` };
            }
            return { match: false };
        }
    },
    {
        id: 'has_comment',
        title: 'Reisetagebuch',
        subtitle: 'Check-in mit persönlicher Notiz',
        icon: '📝',
        match: (t) => {
            const b = (t.body || '').trim();
            if (b.length > 5 && !b.startsWith('#')) {
                return { match: true, detail: `"${b.slice(0, 14)}..."` };
            }
            return { match: false };
        }
    },
    {
        id: 'has_hashtag',
        title: 'Hashtag (#)',
        subtitle: '#bahnliebe #pendeln',
        icon: '🏷️',
        match: (t) => {
            const b = t.body || '';
            const m = b.match(/#([a-z0-9_]+)/i);
            if (m) {
                return { match: true, detail: `#${m[1]}` };
            }
            return { match: false };
        }
    },
    {
        id: 'bus_tram',
        title: 'Bus / Tram / Fähre',
        subtitle: 'Abseits der Hauptgleise',
        icon: '🚌',
        match: (t) => {
            const cat = (t.train?.category || t.checkin?.category || '').toLowerCase();
            const line = (t.train?.lineName || t.checkin?.lineName || '').toLowerCase();
            if (cat.includes('bus') || cat.includes('tram') || cat.includes('ferry') || line.includes('bus')) {
                return { match: true, detail: (t.train?.lineName || 'Bus/Tram').slice(0, 8) };
            }
            return { match: false };
        }
    },
    {
        id: 'weekend',
        title: 'Wochenend-Ausflug',
        subtitle: 'Samstag oder Sonntag',
        icon: '🎉',
        match: (t) => {
            const dStr = t.train?.origin?.departureReal || t.train?.origin?.departure || t.createdAt;
            if (!dStr) return { match: false };
            const day = new Date(dStr).getDay();
            if (day === 0 || day === 6) {
                return { match: true, detail: day === 0 ? 'Sonntag' : 'Samstag' };
            }
            return { match: false };
        }
    },
    {
        id: 'business',
        title: 'Geschäftsreise',
        subtitle: 'Arbeiten im Großraumwagen',
        icon: '💼',
        match: (t) => {
            const biz = t.business || t.checkin?.business || 0;
            if (biz === 1 || biz === 'business') {
                return { match: true, detail: 'Dienstreise' };
            }
            return { match: false };
        }
    }
];

export const FREE_CENTER_TILE = {
    id: 'free_center',
    title: 'DB Freifahrt',
    subtitle: 'Glückszahl des Zugchefs',
    icon: '⭐',
    stamped: true,
    stampedBy: 'system',
    matchedDetail: 'FREE'
};

const BINGO_LINES = [
    // Rows
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    // Columns
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    // Diagonals
    [0, 4, 8],
    [2, 4, 6]
];

export const DelayBingo = {
    container: null,
    cardEl: null,
    tiles: [],
    isMinimized: false,
    hasBingo: false,
    winningLines: [],
    activeUsername: '',

    init() {
        if (this.container && document.body.contains(this.container)) {
            return this.container;
        }

        const screen = document.getElementById('fetchScreen') || document.body;
        let c = document.getElementById('loadingBingoWidget');
        if (!c) {
            c = document.createElement('div');
            c.id = 'loadingBingoWidget';
            c.className = 'loading-bingo-widget';
            screen.appendChild(c);
        }
        this.container = c;
        return this.container;
    },

    start(options = {}) {
        this.activeUsername = options.username || '';
        this.hasBingo = false;
        this.winningLines = [];
        this.isMinimized = false;
        this.init();
        this.reshuffleCard();
        this.render();
        if (this.container) {
            this.container.classList.remove('hidden');
            this.container.classList.add('visible');
        }
    },

    stop() {
        if (this.container) {
            this.container.classList.remove('visible');
            this.container.classList.add('hidden');
        }
    },

    destroy() {
        if (this.container && this.container.parentElement) {
            this.container.remove();
        }
        this.container = null;
        this.cardEl = null;
        this.tiles = [];
    },

    reset() {
        this.hasBingo = false;
        this.winningLines = [];
        this.reshuffleCard();
        this.render();
    },

    reshuffleCard() {
        this.hasBingo = false;
        this.winningLines = [];

        // Pick 8 unique random items from the pool
        const shuffledPool = [...BINGO_TILE_POOL].sort(() => Math.random() - 0.5);
        const selected = shuffledPool.slice(0, 8).map(tile => ({
            ...tile,
            stamped: false,
            stampedBy: null,
            matchedDetail: null
        }));

        // Place them around the center free square (index 4)
        this.tiles = [
            selected[0],
            selected[1],
            selected[2],
            selected[3],
            { ...FREE_CENTER_TILE },
            selected[4],
            selected[5],
            selected[6],
            selected[7]
        ];

        this.checkBingo(false);
    },

    stampTile(index, detail = null, stampedBy = 'manual') {
        if (index < 0 || index >= this.tiles.length) return false;
        const tile = this.tiles[index];
        if (tile.stamped) return false;

        tile.stamped = true;
        tile.stampedBy = stampedBy;
        tile.matchedDetail = detail || (stampedBy === 'manual' ? 'ENTWERTET' : 'Matched');

        const isNewBingo = this.checkBingo(true);
        this.updateTileDOM(index, true);
        this.updateHeaderDOM();

        return isNewBingo;
    },

    toggleTileManual(index) {
        if (index === 4) return; // Free center square is permanently stamped
        const tile = this.tiles[index];
        if (!tile) return;

        if (tile.stamped) {
            // Unstamp
            tile.stamped = false;
            tile.stampedBy = null;
            tile.matchedDetail = null;
        } else {
            // Stamp
            tile.stamped = true;
            tile.stampedBy = 'manual';
            tile.matchedDetail = 'ENTWERTET';
        }

        this.checkBingo(true);
        this.updateTileDOM(index, true);
        this.updateHeaderDOM();
    },

    onTripBatch(trips = []) {
        if (!trips || !trips.length || !this.tiles.length) return;

        let stampedCount = 0;
        for (const trip of trips) {
            for (let i = 0; i < this.tiles.length; i++) {
                const tile = this.tiles[i];
                if (tile.stamped || typeof tile.match !== 'function') continue;

                try {
                    const res = tile.match(trip);
                    if (res && res.match) {
                        tile.stamped = true;
                        tile.stampedBy = 'auto';
                        tile.matchedDetail = res.detail || 'Matched';
                        stampedCount++;
                        this.updateTileDOM(i, true);
                    }
                } catch {
                    // Ignore matcher error
                }
            }
        }

        if (stampedCount > 0) {
            this.checkBingo(true);
            this.updateHeaderDOM();
        }
    },

    checkBingo(triggerAnimation = true) {
        const winning = [];
        for (const line of BINGO_LINES) {
            if (line.every(idx => this.tiles[idx]?.stamped)) {
                winning.push(line);
            }
        }

        const hadBingoBefore = this.hasBingo;
        this.winningLines = winning;
        this.hasBingo = winning.length > 0;

        if (this.hasBingo && !hadBingoBefore && triggerAnimation) {
            this.triggerBingoCelebration();
        }

        return this.hasBingo;
    },

    triggerBingoCelebration() {
        if (!this.container) return;
        const banner = this.container.querySelector('.bingo-celebration-banner');
        if (banner) {
            banner.classList.add('animate-celebrate');
            setTimeout(() => {
                if (banner) banner.classList.remove('animate-celebrate');
            }, 3000);
        }
    },

    toggleMinimize() {
        this.isMinimized = !this.isMinimized;
        if (this.container) {
            this.container.classList.toggle('minimized', this.isMinimized);
        }
        this.render();
    },

    render() {
        if (!this.container) return;

        const stampedCount = this.tiles.filter(t => t.stamped).length;
        const totalCount = this.tiles.length;

        if (this.isMinimized) {
            this.container.innerHTML = `
                <div class="bingo-minimized-pill" id="bingoExpandBtn" role="button" tabindex="0" title="Transit Bingo vergrößern">
                    <span class="bingo-pill-icon">🎯</span>
                    <span class="bingo-pill-label">Delay Bingo</span>
                    <span class="bingo-pill-score ${this.hasBingo ? 'is-bingo' : ''}">${this.hasBingo ? '★ BINGO!' : `${stampedCount}/${totalCount}`}</span>
                </div>
            `;
            const btn = document.getElementById('bingoExpandBtn');
            if (btn) {
                btn.addEventListener('click', () => this.toggleMinimize());
                btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') this.toggleMinimize(); });
            }
            return;
        }

        const winningIndices = new Set(this.winningLines.flat());

        this.container.innerHTML = `
            <div class="bingo-card-container">
                <div class="bingo-card-header">
                    <div class="bingo-title-wrap">
                        <span class="bingo-header-icon" aria-hidden="true">🎯</span>
                        <div>
                            <span class="bingo-title">DB Delay Bingo</span>
                            <span class="bingo-subtitle">Live-Fahrten Stempelspiel</span>
                        </div>
                    </div>
                    <div class="bingo-header-actions">
                        <button type="button" class="bingo-btn-icon" id="bingoReshuffleBtn" title="Neu mischen" aria-label="Neu mischen">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>
                        </button>
                        <button type="button" class="bingo-btn-icon" id="bingoMinimizeBtn" title="Minimieren" aria-label="Minimieren">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                        </button>
                    </div>
                </div>

                <div class="bingo-status-bar">
                    <span class="bingo-score-pill ${this.hasBingo ? 'has-bingo' : ''}">
                        ${this.hasBingo ? '★ BINGO! ALLES IM PLAN' : `${stampedCount} von ${totalCount} gestempelt`}
                    </span>
                    <span class="bingo-hint-text">Klicken zum manuellen Stempeln</span>
                </div>

                <div class="bingo-grid" role="grid" aria-label="DB Delay Bingo Spielfeld">
                    ${this.tiles.map((t, idx) => `
                        <div class="bingo-tile ${t.stamped ? 'stamped' : ''} ${winningIndices.has(idx) ? 'winning-line' : ''} ${idx === 4 ? 'is-free' : ''}"
                             data-index="${idx}"
                             role="button"
                             tabindex="0"
                             aria-label="${t.title} - ${t.stamped ? 'Gestempelt' : 'Offen'}">
                            <div class="bingo-tile-icon">${t.icon}</div>
                            <div class="bingo-tile-title">${t.title}</div>
                            <div class="bingo-tile-sub">${t.subtitle}</div>
                            ${t.stamped ? `
                                <div class="bingo-stamp-overlay ${t.stampedBy === 'auto' ? 'stamp-auto' : 'stamp-manual'}">
                                    <span class="stamp-text">${t.matchedDetail || 'ENTWERTET'}</span>
                                </div>
                            ` : ''}
                        </div>
                    `).join('')}
                </div>

                <div class="bingo-celebration-banner ${this.hasBingo ? 'visible' : ''}">
                    <span class="celebration-sparkle">✨</span>
                    <span><strong>BINGO!</strong> Reise-Experte Stufe 1 erreicht!</span>
                    <span class="celebration-sparkle">✨</span>
                </div>
            </div>
        `;

        // Event Listeners
        const reshuffleBtn = document.getElementById('bingoReshuffleBtn');
        if (reshuffleBtn) reshuffleBtn.addEventListener('click', () => this.reset());

        const minBtn = document.getElementById('bingoMinimizeBtn');
        if (minBtn) minBtn.addEventListener('click', () => this.toggleMinimize());

        const tileEls = this.container.querySelectorAll('.bingo-tile');
        tileEls.forEach(el => {
            const idx = parseInt(el.getAttribute('data-index'), 10);
            el.addEventListener('click', () => this.toggleTileManual(idx));
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.toggleTileManual(idx);
                }
            });
        });
    },

    updateTileDOM(index, animate = false) {
        if (!this.container || this.isMinimized) return;
        const tile = this.tiles[index];
        const tileEl = this.container.querySelector(`.bingo-tile[data-index="${index}"]`);
        if (!tile || !tileEl) return;

        if (tile.stamped) {
            tileEl.classList.add('stamped');
            let stampOverlay = tileEl.querySelector('.bingo-stamp-overlay');
            if (!stampOverlay) {
                stampOverlay = document.createElement('div');
                stampOverlay.className = `bingo-stamp-overlay ${tile.stampedBy === 'auto' ? 'stamp-auto' : 'stamp-manual'}`;
                if (animate) stampOverlay.classList.add('stamp-pop-animation');
                stampOverlay.innerHTML = `<span class="stamp-text">${tile.matchedDetail || 'ENTWERTET'}</span>`;
                tileEl.appendChild(stampOverlay);
            }
        } else {
            tileEl.classList.remove('stamped');
            const stampOverlay = tileEl.querySelector('.bingo-stamp-overlay');
            if (stampOverlay) stampOverlay.remove();
        }
    },

    updateHeaderDOM() {
        if (!this.container || this.isMinimized) return;
        const stampedCount = this.tiles.filter(t => t.stamped).length;
        const totalCount = this.tiles.length;
        const scorePill = this.container.querySelector('.bingo-score-pill');
        if (scorePill) {
            scorePill.className = `bingo-score-pill ${this.hasBingo ? 'has-bingo' : ''}`;
            scorePill.textContent = this.hasBingo ? '★ BINGO! ALLES IM PLAN' : `${stampedCount} von ${totalCount} gestempelt`;
        }

        const banner = this.container.querySelector('.bingo-celebration-banner');
        if (banner) {
            banner.classList.toggle('visible', this.hasBingo);
        }

        const winningIndices = new Set(this.winningLines.flat());
        this.container.querySelectorAll('.bingo-tile').forEach(el => {
            const idx = parseInt(el.getAttribute('data-index'), 10);
            el.classList.toggle('winning-line', winningIndices.has(idx));
        });
    }
};
