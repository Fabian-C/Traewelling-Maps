// UI module
import { store } from '../state/store.js';
import { CONFIG } from '../config/config.js';
import { clearAllSessions } from '../session/manager.js';

export const UI = {
    init() {
        this.wakeLock = null;
        this.refs = {
            setupScreen: document.getElementById('setupScreen'),
            fetchScreen: document.getElementById('fetchScreen'),
            fetchStatus: document.getElementById('fetchStatus'),
            fetchProgress: document.getElementById('fetchProgress'),
            fetchTrips: document.getElementById('fetchTrips'),
            fetchPages: document.getElementById('fetchPages'),
            fetchRoutes: document.getElementById('fetchPolylines'),
            fetchError: document.getElementById('fetchError'),
            menu: document.getElementById('mainMenu'),
            tokenOwnerAvatar: document.getElementById('tokenOwnerAvatar'),
            tokenOwnerName: document.getElementById('tokenOwnerName'),
            tokenOwnerUsername: document.getElementById('tokenOwnerUsername'),
            tokenOwnerProfileLink: document.getElementById('tokenOwnerProfileLink'),
            tokenStatusText: document.getElementById('tokenStatusText'),
            tokenExpiryText: document.getElementById('tokenExpiryText'),
            menuApiTokenDetails: document.getElementById('menuApiTokenDetails'),
            menuApiToken: document.getElementById('menuApiToken'),
            menuUsername: document.getElementById('menuUsername'),
            menuValidateBtn: document.getElementById('menuValidateBtn'),
            menuCopyTokenBtn: document.getElementById('menuCopyTokenBtn'),
            menuFetchBtn: document.getElementById('menuFetchBtn'),
            setupTokenInput: document.getElementById('apiToken'),
            setupUsernameInput: document.getElementById('username'),
            cargoScene: document.getElementById('cargoScene'),
            depotStack: document.getElementById('depotStack'),
            gantry: document.querySelector('.gantry'),
            gantryTrolley: document.getElementById('gantryTrolley'),
            gantryHoist: document.getElementById('gantryHoist'),
            gantryPayload: document.getElementById('gantryPayload'),
            trainZone: document.getElementById('trainZone'),
            cargoStage: document.getElementById('cargoStage')
        };
        this.depotCrates = [];
        this.depotColumns = [];
        this.trainCarsCount = 0;
        this.craneAnimating = false;
        this.loadQueue = [];
        this.totalDepotReceived = 0;
        this.totalBatches = 0;
        this.batchesCompleted = 0;
        this._animSpeed = 0.8;
        this._cargoSceneWidth = this.refs.cargoScene ? this.refs.cargoScene.clientWidth : 500;
        this._containerDesignPool = [];
        this._containerDesignPoolWeight = 0;
        this._rebuildContainerDesignPool();
        if (this.refs.cargoScene && typeof ResizeObserver !== 'undefined') {
            if (this._cargoSceneResizeObserver) this._cargoSceneResizeObserver.disconnect();
            this._cargoSceneResizeObserver = new ResizeObserver(entries => {
                const entry = entries[0];
                if (!entry) return;
                this._cargoSceneWidth = entry.contentRect.width || this._cargoSceneWidth;
            });
            this._cargoSceneResizeObserver.observe(this.refs.cargoScene);
        }
    },
    toggleSetup(show) {
        if (!this.refs) return;
        this.refs.setupScreen.classList.toggle('hidden', !show);
    },
    toggleFetch(show) {
        if (!this.refs) return;
        this.refs.fetchScreen.classList.toggle('hidden', !show);
    },
    bindGlobalActions() {
        document.querySelectorAll('[data-action="clear-cache"]').forEach(btn => {
            btn.addEventListener('click', (event) => {
                event.preventDefault();
                clearAllSessions();
            });
        });
    },
    updateFetchStats({ trips, pages, routes, progress, status }) {
        if (!this.refs) return;
        if (typeof trips === 'number') this.refs.fetchTrips.textContent = trips;
        if (typeof pages === 'number') this.refs.fetchPages.textContent = pages;
        if (typeof routes === 'number') this.refs.fetchRoutes.textContent = routes;
        if (typeof progress === 'number') {
            this.refs.fetchProgress.style.width = `${Math.min(100, progress)}%`;
        }
        if (status) this.refs.fetchStatus.textContent = status;
    },

    async acquireWakeLock() {
        if (!('wakeLock' in navigator)) return;
        try {
            this.wakeLock = await navigator.wakeLock.request('screen');
            this.wakeLock.addEventListener('release', () => {
                console.log('Wake Lock was released');
            });
            console.log('Wake Lock is active');
        } catch (err) {
            console.error(`${err.name}, ${err.message}`);
        }
    },

    async releaseWakeLock() {
        if (!this.wakeLock) return;
        try {
            await this.wakeLock.release();
            this.wakeLock = null;
        } catch (err) {
            console.error(`${err.name}, ${err.message}`);
        }
    },
    _containerDesigns: [
        { id: 'classic-red', weight: 10, bg: 'linear-gradient(135deg, #e74c3c 0%, #b71c1c 100%)' },
        { id: 'classic-green', weight: 10, bg: 'linear-gradient(135deg, #2ecc71 0%, #1b7a3d 100%)' },
        { id: 'classic-blue', weight: 10, bg: 'linear-gradient(135deg, #3498db 0%, #15578a 100%)' },
        { id: 'classic-amber', weight: 10, bg: 'linear-gradient(135deg, #f39c12 0%, #c77d0a 100%)' },
        { id: 'classic-purple', weight: 10, bg: 'linear-gradient(135deg, #9b59b6 0%, #6c3483 100%)' },
        { id: 'classic-teal', weight: 10, bg: 'linear-gradient(135deg, #1abc9c 0%, #0e6f5c 100%)' },
        { id: 'classic-orange', weight: 10, bg: 'linear-gradient(135deg, #e67e22 0%, #a85c17 100%)' },
        { id: 'classic-pink', weight: 10, bg: 'linear-gradient(135deg, #e84393 0%, #a52d6b 100%)' },
        { id: 'classic-emerald', weight: 10, bg: 'linear-gradient(135deg, #00b894 0%, #007a5e 100%)' },
        { id: 'classic-indigo', weight: 10, bg: 'linear-gradient(135deg, #6c5ce7 0%, #4834a8 100%)' }
    ],
    _specialContainerTargetChances: {
        dbCargo: 0.10,
        pride: 0.12
    },
    _dbCargoBg: 'center / 100% 100% no-repeat url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 560 360%27%3E%3Cdefs%3E%3Cpattern id=%27v%27 width=%2710%27 height=%2710%27 patternUnits=%27userSpaceOnUse%27%3E%3Cpath d=%27M5 0v10%27 stroke=%27rgba(255,255,255,0.22)%27 stroke-width=%271.4%27/%3E%3C/pattern%3E%3C/defs%3E%3Crect width=%27560%27 height=%27360%27 fill=%27%235a8d45%27/%3E%3Crect width=%27560%27 height=%27360%27 fill=%27url(%23v)%27/%3E%3Ctext x=%2750%25%27 y=%2748%25%27 fill=%27%23ffffff%27 font-size=%2788%27 font-family=%27Arial%20Black,Arial,sans-serif%27 font-weight=%27900%27 text-anchor=%27middle%27 lengthAdjust=%27spacingAndGlyphs%27 textLength=%27496%27%3EG%C3%BCter geh%C3%B6ren%3C/text%3E%3Ctext x=%2750%25%27 y=%2769%25%27 fill=%27%23ffffff%27 font-size=%2788%27 font-family=%27Arial%20Black,Arial,sans-serif%27 font-weight=%27900%27 text-anchor=%27middle%27 lengthAdjust=%27spacingAndGlyphs%27 textLength=%27496%27%3Eauf die Schiene%3C/text%3E%3C/svg%3E")',
    _prideBg: 'center / cover no-repeat url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 6000 3810%27%3E%3Cpath fill=%27%236d2380%27 d=%27M0 0h6000v3810H0z%27/%3E%3Cpath fill=%27%232c58a4%27 d=%27M0 0h6000v3175H0z%27/%3E%3Cpath fill=%27%2378b82a%27 d=%27M0 0h6000v2540H0z%27/%3E%3Cpath fill=%27%23efe524%27 d=%27M0 0h6000v1905H0z%27/%3E%3Cpath fill=%27%23f28917%27 d=%27M0 0h6000v1270H0z%27/%3E%3Cpath fill=%27%23e22016%27 d=%27M0 0h6000v635H0z%27/%3E%3Cpath d=%27M0 0h1577l1764 1905-1764 1905H0z%27/%3E%3Cpath fill=%27%23945516%27 d=%27M0 0h1209l1764 1905-1764 1905H0z%27/%3E%3Cpath fill=%27%237bcce5%27 d=%27M0 0h844l1764 1905L844 3810H0z%27/%3E%3Cpath fill=%27%23f4aec8%27 d=%27M0 0h477l1764 1905L477 3810H0z%27/%3E%3Cpath fill=%27%23fff%27 d=%27M0 0h111l1763 1905L111 3810H0z%27/%3E%3Cpath fill=%27%23fdd817%27 d=%27m0 278 1507 1627L0 3532z%27/%3E%3Ccircle cx=%27556%27 cy=%271905%27 r=%27404%27 fill=%27none%27 stroke=%27%2366338b%27 stroke-width=%2795%27/%3E%3C/svg%3E")',
    _maxStack: 4,
    _maxVisibleCols: 4,
    _buildContainerDesignPool() {
        const classicDesigns = this._containerDesigns
            .filter((design) => design && typeof design.bg === 'string' && Number(design.weight) > 0)
            .map((design) => ({
                id: design.id,
                bg: design.bg,
                weight: Number(design.weight)
            }));

        const classicWeightTotal = classicDesigns.reduce((sum, design) => sum + design.weight, 0);

        const specialCandidates = [
            {
                id: 'db-cargo-special',
                bg: this._dbCargoBg,
                chance: Number(this._specialContainerTargetChances?.dbCargo)
            },
            {
                id: 'pride-special',
                bg: this._prideBg,
                chance: Number(this._specialContainerTargetChances?.pride)
            }
        ].filter((design) => design && typeof design.bg === 'string' && Number.isFinite(design.chance) && design.chance > 0);

        const totalSpecialChance = specialCandidates.reduce((sum, design) => sum + design.chance, 0);
        const specialWeightFactor = totalSpecialChance > 0 && totalSpecialChance < 1
            ? classicWeightTotal / (1 - totalSpecialChance)
            : 0;

        const specialDesigns = specialCandidates.map((design) => ({
            id: design.id,
            bg: design.bg,
            weight: design.chance * specialWeightFactor
        })).filter((design) => Number.isFinite(design.weight) && design.weight > 0);

        return [...classicDesigns, ...specialDesigns];
    },
    _rebuildContainerDesignPool() {
        this._containerDesignPool = this._buildContainerDesignPool();
        this._containerDesignPoolWeight = this._containerDesignPool.reduce((sum, design) => sum + design.weight, 0);
    },
    _getDefaultContainerBackground() {
        return this._containerDesigns[0]?.bg || '';
    },
    _resolveContainerBackground(designBg) {
        return designBg || this._getDefaultContainerBackground();
    },
    _crateMarkup(pageNumber) {
        return `<div class="crate-ribs"></div><div class="crate-corners"></div><div class="crate-lbl">${pageNumber}</div>`;
    },
    _createCrateElement(className, pageNumber, designBg) {
        const crate = document.createElement('div');
        crate.className = className;
        crate.style.background = this._resolveContainerBackground(designBg);
        crate.innerHTML = this._crateMarkup(pageNumber);
        return crate;
    },
    pickContainerDesign() {
        const designs = this._containerDesignPool;
        const totalWeight = this._containerDesignPoolWeight;
        if (!Array.isArray(designs) || designs.length === 0) return null;
        if (!Number.isFinite(totalWeight) || totalWeight <= 0) return designs[0];

        let roll = Math.random() * totalWeight;
        for (const design of designs) {
            roll -= design.weight;
            if (roll <= 0) return design;
        }
        return designs[designs.length - 1];
    },
    addPacketToDepot(pageNumber) {
        if (!this.refs.depotStack) return;
        this.totalDepotReceived++;
        const design = this.pickContainerDesign();
        const designBg = this._resolveContainerBackground(design?.bg);
        const crate = this._createCrateElement('crate', pageNumber, designBg);
        let col = this.depotColumns[this.depotColumns.length - 1];
        if (!col || col.count >= this._maxStack) {
            const colEl = document.createElement('div');
            colEl.className = 'depot-col';
            this.refs.depotStack.appendChild(colEl);
            col = { el: colEl, count: 0 };
            this.depotColumns.push(col);
        }
        col.el.appendChild(crate);
        col.count++;
        const stackHeight = col.count;
        requestAnimationFrame(() => crate.classList.add('arrive'));
        this.depotCrates.push({ el: crate, designId: design?.id || 'default', designBg: designBg, page: pageNumber, stackHeight: stackHeight });
        this._updateDepotScroll();
        if (this.refs.cargoStage) {
            this.refs.cargoStage.classList.add('visible');
        }
    },
    startLoadingToTrain(totalBatches) {
        this.totalBatches = totalBatches;
        this.batchesCompleted = 0;
        const numCars = Math.max(1, this.totalDepotReceived || 1);
        this.ensureTrain(numCars);
    },
    _updateAnimSpeed() {
        const queueLen = this.loadQueue ? this.loadQueue.length : 0;
        const total = this.totalDepotReceived || 1;
        let speed = 0.8;
        if (total > 80 || queueLen > 20) {
            speed = 0.10;
        } else if (total > 40 || queueLen > 10) {
            speed = 0.16;
        } else if (total > 20 || queueLen > 5) {
            speed = 0.28;
        } else if (total > 8) {
            speed = 0.45;
        } else {
            speed = 0.75;
        }
        this._animSpeed = speed;

        const gantryMoveDur = Math.max(0.04, 0.32 * speed).toFixed(3);
        const hoistMoveDur = Math.max(0.03, 0.20 * speed).toFixed(3);
        const trainStepDur = Math.max(0.04, 0.35 * speed).toFixed(3);
        const root = document.documentElement;
        root.style.setProperty('--gantry-move-dur', `${gantryMoveDur}s`);
        root.style.setProperty('--trolley-move-dur', `${gantryMoveDur}s`);
        root.style.setProperty('--hoist-move-dur', `${hoistMoveDur}s`);
        root.style.setProperty('--train-step-dur', `${trainStepDur}s`);
    },
    onPolylineBatchComplete() {
        this.batchesCompleted++;
        if (this.totalDepotReceived === 0 || this.totalBatches === 0) return;
        const allDone = this.batchesCompleted >= this.totalBatches;
        const targetLoaded = allDone ? this.totalDepotReceived
            : Math.round((this.batchesCompleted / this.totalBatches) * this.totalDepotReceived);
        const alreadyQueued = this.trainCarsCount + this.loadQueue.length;
        const toQueue = Math.max(0, targetLoaded - alreadyQueued);
        for (let i = 0; i < toQueue; i++) {
            if (this.depotCrates.length === 0) break;
            this.loadQueue.push(this.depotCrates.pop());
        }
        this._processQueue();
    },
    waitForTrainCatchUp(shouldCancel) {
        if (this.totalDepotReceived === 0 || this.totalBatches === 0) return Promise.resolve();

        const allDone = this.batchesCompleted >= this.totalBatches;
        const targetLoaded = allDone ? this.totalDepotReceived
            : Math.round((this.batchesCompleted / this.totalBatches) * this.totalDepotReceived);

        if (this.trainCarsCount >= targetLoaded) return Promise.resolve();

        const startTime = Date.now();
        const maxWaitMs = 10000;

        return new Promise(resolve => {
            const poll = () => {
                if ((typeof shouldCancel === 'function' && shouldCancel()) ||
                    this.trainCarsCount >= targetLoaded ||
                    (Date.now() - startTime > maxWaitMs)) {
                    resolve();
                    return;
                }
                setTimeout(poll, 30);
            };
            poll();
        });
    },
    _processQueue() {
        if (this.craneAnimating || this.loadQueue.length === 0) return;
        this.craneAnimating = true;
        this._updateAnimSpeed();
        const t = (ms) => Math.round(ms * this._animSpeed);
        const item = this.loadQueue.shift();
        const gantry = this.refs.gantry;
        const hoist = this.refs.gantryHoist;
        const payload = this.refs.gantryPayload;
        const trainZone = this.refs.trainZone;
        if (!gantry || !hoist || !payload || !trainZone) { this.craneAnimating = false; return; }

        if (!this.locomotiveSpawned && this.trainCarsCount === 0 && !trainZone.querySelector('.locomotive')) {
            this.ensureLocomotive();
        }

        // Concurrent action: roll next empty car into loading position whilst gantry travels to depot
        if (this.loadedCarsCount > 0) {
            // Ensure next empty car exists
            if (!this.flatcars[this.loadedCarsCount]) {
                const nextCar = this._createFlatcarElement();
                trainZone.appendChild(nextCar);
                this.flatcars.push(nextCar);
            }
            // Ensure a trailing buffer car exists so cars are seen coupled behind
            if (!this.flatcars[this.loadedCarsCount + 1] && (this.loadQueue.length > 0 || (this.totalDepotReceived - this.loadedCarsCount) > 1)) {
                const bufferCar = this._createFlatcarElement();
                trainZone.appendChild(bufferCar);
                this.flatcars.push(bufferCar);
            }
            // Advance train forward so new car rolls into place under the crane
            this._updateTrainPosition(this.loadedCarsCount);
        }

        const baseHeight = 12;
        const stackLevel = Math.max(1, item.stackHeight || 1);
        const hoistDepot = Math.max(baseHeight, 70 - (stackLevel - 1) * 20);
        const hoistTrain = 58;

        // Ensure target car exists at current loading position
        let targetCar = this.flatcars && this.flatcars[this.loadedCarsCount]
            ? this.flatcars[this.loadedCarsCount]
            : null;
        if (!targetCar) {
            const extraCar = this._createFlatcarElement();
            trainZone.appendChild(extraCar);
            if (!this.flatcars) this.flatcars = [];
            this.flatcars.push(extraCar);
            targetCar = extraCar;
        }

        // Dynamically compute target gantry and trolley position to match the exact container center
        let targetGantryLeft = 32;
        let trolleyPos = '50%';
        if (this.refs.cargoScene && item.el) {
            const sceneRect = this.refs.cargoScene.getBoundingClientRect();
            const crateRect = item.el.getBoundingClientRect();
            const gantryRect = gantry.getBoundingClientRect();
            const gantryWidth = gantryRect.width || 136;
            if (crateRect.width > 0) {
                const crateCenterX = (crateRect.left + (crateRect.width / 2)) - sceneRect.left;
                targetGantryLeft = Math.round(crateCenterX - (gantryWidth / 2));
                if (targetGantryLeft < 6) {
                    const minGantryLeft = 6;
                    targetGantryLeft = minGantryLeft;
                    const trolleyPx = Math.round(crateCenterX - minGantryLeft - 2);
                    trolleyPos = `${trolleyPx}px`;
                } else {
                    trolleyPos = '50%';
                }
            }
        }

        gantry.classList.remove('at-train');
        gantry.classList.add('at-depot');
        gantry.style.left = `${targetGantryLeft}px`;
        gantry.style.setProperty('--trolley-pos', trolleyPos);

        setTimeout(() => { hoist.style.height = hoistDepot + 'px'; }, t(360));
        setTimeout(() => {
            if (item.el.parentElement) {
                const colEl = item.el.parentElement;
                item.el.remove();
                const col = this.depotColumns.find(c => c.el === colEl);
                if (col) col.count = colEl.children.length;
                this._updateDepotScroll();
            }
            const itemBg = this._resolveContainerBackground(item.designBg);
            payload.style.background = itemBg;
            payload.innerHTML = this._crateMarkup(item.page);
            payload.classList.add('visible');
            hoist.style.height = baseHeight + 'px';
        }, t(570));
        setTimeout(() => {
            gantry.classList.remove('at-depot');
            gantry.classList.add('at-train');
            gantry.style.left = '';
            gantry.style.setProperty('--trolley-pos', '50%');
        }, t(780));
        setTimeout(() => { hoist.style.height = hoistTrain + 'px'; }, t(980));
        setTimeout(() => {
            payload.classList.remove('visible');
            if (targetCar) {
                const crate = this._createCrateElement('train-crate', item.page, item.designBg);
                targetCar.appendChild(crate);
                targetCar.classList.add('settling');
                setTimeout(() => targetCar.classList.remove('settling'), Math.max(100, t(250)));
            }
            this.loadedCarsCount = (this.loadedCarsCount || 0) + 1;
            this.trainCarsCount = this.loadedCarsCount;
            hoist.style.height = baseHeight + 'px';

            if (this.refs.cargoStage) {
                if (this.trainCarsCount >= this.totalDepotReceived && this.loadQueue.length === 0) {
                    setTimeout(() => { if (this.refs.cargoStage) this.refs.cargoStage.classList.remove('visible'); }, 2000);
                }
            }
            this.craneAnimating = false;
            if (this.loadQueue.length > 0) setTimeout(() => this._processQueue(), t(40));
        }, t(1200));
    },
    _updateDepotScroll() {
        if (!this.refs?.depotStack) return;
        const stack = this.refs.depotStack;
        const zone = stack.parentElement;
        const zoneStyle = zone ? window.getComputedStyle(zone) : null;
        const rightAligned = zoneStyle?.justifyContent === 'flex-end';

        if (rightAligned) {
            stack.style.transform = 'translateX(0px)';
            return;
        }

        const colCount = this.depotColumns.length;
        if (colCount <= this._maxVisibleCols) {
            stack.style.transform = 'translateX(0px)';
            return;
        }

        const colEl = stack.querySelector('.depot-col');
        const computedStyle = window.getComputedStyle(stack);
        const gap = parseFloat(computedStyle.gap || '3') || 3;
        const colWidth = colEl ? colEl.getBoundingClientRect().width : 28;
        const overflowCols = colCount - this._maxVisibleCols;
        const shift = overflowCols * (colWidth + gap);
        stack.style.transform = `translateX(${-shift}px)`;
    },
    _triggerRollingAnimation(durationMs = 450) {
        if (!this.refs?.trainZone) return;
        this.refs.trainZone.classList.add('rolling');
        if (this._rollingTimer) clearTimeout(this._rollingTimer);
        this._rollingTimer = setTimeout(() => {
            if (this.refs?.trainZone) this.refs.trainZone.classList.remove('rolling');
        }, durationMs);
    },
    _createFlatcarElement() {
        const car = document.createElement('div');
        car.className = 'flatcar';
        car.innerHTML = `<div class="flatcar-deck">
                <div class="flatcar-chassis"></div>
                <div class="flatcar-pin tl"></div>
                <div class="flatcar-pin tr"></div>
                <div class="flatcar-coupler"></div>
            </div>
            <div class="flatcar-axle al">
                <div class="axle-guard"></div>
                <div class="train-wheel"><div class="wheel-spoke"></div></div>
            </div>
            <div class="flatcar-axle ar">
                <div class="axle-guard"></div>
                <div class="train-wheel"><div class="wheel-spoke"></div></div>
            </div>`;
        return car;
    },
    _createLocomotiveElement() {
        const loco = document.createElement('div');
        loco.className = 'locomotive diesel';
        loco.innerHTML = `<div class="loco-body">
            <div class="loco-hood-short"></div>
            <div class="loco-cab">
                <div class="loco-window side"></div>
                <div class="loco-window front"></div>
            </div>
            <div class="loco-hood-long">
                <div class="loco-radiator"></div>
                <div class="loco-exhaust"><div class="exhaust-smoke"></div></div>
            </div>
            <div class="loco-walkway"></div>
            <div class="loco-railing"></div>
            <div class="loco-stripe"></div>
            <div class="loco-headlight"></div>
            <div class="loco-ditchlights"></div>
            <div class="loco-headlight-cone"></div>
            <div class="loco-coupler"></div>
        </div>
        <div class="loco-underbody"><div class="loco-fuel-tank"></div></div>
        <div class="loco-bogie bl"><div class="train-wheel"><div class="wheel-spoke"></div></div><div class="train-wheel"><div class="wheel-spoke"></div></div></div>
        <div class="loco-bogie br"><div class="train-wheel"><div class="wheel-spoke"></div></div><div class="train-wheel"><div class="wheel-spoke"></div></div></div>`;
        return loco;
    },
    ensureTrain(numCars = 1) {
        const trainZone = this.refs.trainZone;
        if (!trainZone) return;
        if (!trainZone.querySelector('.locomotive')) {
            this.locomotiveSpawned = true;
            trainZone.innerHTML = '';

            // 1. Diesel Switcher Locomotive (child 0 in row-reverse, far right)
            const loco = this._createLocomotiveElement();
            trainZone.appendChild(loco);

            // 2. Initial flatcars:
            // Car 0: The first empty flatcar that stops directly under the crane
            // Car 1: The next empty flatcar coupled behind Car 0 (if more than 1 container)
            this.flatcars = [];
            const car0 = this._createFlatcarElement();
            trainZone.appendChild(car0);
            this.flatcars.push(car0);

            const total = this.totalDepotReceived || numCars;
            if (total > 1) {
                const car1 = this._createFlatcarElement();
                trainZone.appendChild(car1);
                this.flatcars.push(car1);
            }

            this.loadedCarsCount = 0;
            this.trainCarsCount = 0;

            trainZone.classList.add('arriving');
            this._triggerRollingAnimation(650);
            setTimeout(() => {
                if (trainZone) trainZone.classList.remove('arriving');
            }, 650);
            this._updateTrainPosition(0);
        }
    },
    ensureLocomotive() {
        const numCars = Math.max(1, this.totalDepotReceived || 1);
        this.ensureTrain(numCars);
    },
    async departTrain() {
        if (!this.refs.trainZone) return;
        const trainZone = this.refs.trainZone;
        const currentTransform = trainZone.style.transform || 'translateX(0px)';
        const match = currentTransform.match(/translateX\(([-\d.]+)px\)/);
        const currentX = match ? parseFloat(match[1]) : 0;
        trainZone.style.setProperty('--train-shift', `${currentX}px`);
        this._triggerRollingAnimation(950);
        trainZone.classList.add('departing');
        await new Promise(r => setTimeout(r, 900));
    },
    onFetchError() {
        if (!this.refs) return;
        if (this.refs.cargoScene) {
            this.refs.cargoScene.classList.add('has-error');
        }
        if (this.refs.gantry) {
            this.refs.gantry.classList.remove('at-train');
            this.refs.gantry.classList.add('at-depot');
            this.refs.gantry.style.left = '';
            this.refs.gantry.style.setProperty('--trolley-pos', '50%');
        }
        if (this.refs.gantryHoist) {
            this.refs.gantryHoist.style.height = '12px';
        }
        if (this.refs.gantryPayload) {
            this.refs.gantryPayload.classList.remove('visible');
        }
        this.craneAnimating = false;
        this.loadQueue = [];
    },
    _updateOffscreenCars() {
        if (!this.refs.trainZone || !this.flatcars) return;
        const sceneWidth = this._cargoSceneWidth || 500;
        const currentTransform = this.refs.trainZone.style.transform || '';
        const match = currentTransform.match(/translateX\(([-\d.]+)px\)/);
        const currentShift = match ? parseFloat(match[1]) : 0;

        const locoWidth = 48;
        const carWidth = 32;
        const carGap = 2;

        // Locomotive check
        const loco = this.refs.trainZone.querySelector('.locomotive');
        if (loco) {
            const locoRight = sceneWidth + currentShift;
            const locoLeft = locoRight - locoWidth;
            loco.classList.toggle('offscreen', locoLeft > sceneWidth + 30);
        }

        // Flatcars check
        this.flatcars.forEach((car, index) => {
            const distFromRight = locoWidth + carGap + (index * (carWidth + carGap));
            const carRight = sceneWidth + currentShift - distFromRight;
            const carLeft = carRight - carWidth;
            const isOffscreen = carLeft > sceneWidth + 30 || carRight < -80;
            car.classList.toggle('offscreen', isOffscreen);
        });
    },
    _updateTrainPosition(carIndex = 0) {
        if (!this.refs.trainZone) return;
        const trainZone = this.refs.trainZone;
        const sceneWidth = this._cargoSceneWidth || (this.refs.cargoScene ? this.refs.cargoScene.clientWidth : 500);

        const rootStyle = window.getComputedStyle(document.documentElement);
        const gantryTrainLeft = parseFloat(rootStyle.getPropertyValue('--gantry-train-left'));
        const gantryWidth = parseFloat(rootStyle.getPropertyValue('--gantry-width'));
        const safeGantryLeft = Number.isFinite(gantryTrainLeft) ? gantryTrainLeft : 172;
        const safeGantryWidth = Number.isFinite(gantryWidth) ? gantryWidth : 136;
        const targetCenter = safeGantryLeft + (safeGantryWidth / 2);

        const locoWidth = 48;
        const carWidth = 32;
        const carGap = 2;

        // Position carIndex directly under the gantry hoist at targetCenter (240px)
        const distFromRight = locoWidth + carGap + (carWidth / 2) + (carIndex * (carWidth + carGap));
        const shift = targetCenter - (sceneWidth - distFromRight);

        trainZone.style.transform = `translateX(${shift}px)`;
        const rollDuration = Math.max(120, Math.round(450 * this._animSpeed));
        this._triggerRollingAnimation(rollDuration);
        this._updateOffscreenCars();
    },
    _updateTrainScroll() {
        this._updateTrainPosition(this.loadedCarsCount || 0);
    },
    resetCargoAnimation() {
        if (!this.refs) return;
        this.depotCrates = [];
        this.depotColumns = [];
        this.trainCarsCount = 0;
        this.loadedCarsCount = 0;
        this.flatcars = [];
        this.craneAnimating = false;
        this.loadQueue = [];
        this.totalDepotReceived = 0;
        this.totalBatches = 0;
        this.batchesCompleted = 0;
        this.locomotiveSpawned = false;
        const root = document.documentElement;
        root.style.removeProperty('--gantry-move-dur');
        root.style.removeProperty('--trolley-move-dur');
        root.style.removeProperty('--hoist-move-dur');
        root.style.removeProperty('--train-step-dur');
        if (this.refs.cargoScene) this.refs.cargoScene.classList.remove('has-error');
        if (this.refs.depotStack) { this.refs.depotStack.innerHTML = ''; this.refs.depotStack.style.transform = ''; }
        if (this.refs.trainZone) { this.refs.trainZone.innerHTML = ''; this.refs.trainZone.style.transform = ''; this.refs.trainZone.classList.remove('departing', 'arriving'); }
        if (this.refs.gantry) {
            this.refs.gantry.classList.remove('at-depot', 'at-train');
            this.refs.gantry.style.left = '';
            this.refs.gantry.style.setProperty('--trolley-pos', '50%');
        }
        if (this.refs.gantryHoist) {
            this.refs.gantryHoist.style.height = '12px';
        }
        if (this.refs.gantryPayload) {
            this.refs.gantryPayload.classList.remove('visible');
        }
        if (this.refs.cargoStage) {
            this.refs.cargoStage.textContent = '';
            this.refs.cargoStage.classList.remove('visible');
        }
    },
    setTokenOwner(owner) {
        if (!this.refs) return;
        const { tokenOwnerAvatar, tokenOwnerName, tokenOwnerUsername, tokenOwnerProfileLink } = this.refs;
        if (tokenOwnerAvatar) {
            if (owner?.avatar) {
                tokenOwnerAvatar.style.backgroundImage = `url(${owner.avatar})`;
                tokenOwnerAvatar.textContent = '';
            } else {
                tokenOwnerAvatar.style.backgroundImage = 'none';
                tokenOwnerAvatar.textContent = (owner?.displayName || owner?.username || '?')[0]?.toUpperCase() || '?';
            }
        }
        if (tokenOwnerName) tokenOwnerName.textContent = owner?.displayName || 'Not authenticated';
        if (tokenOwnerUsername) tokenOwnerUsername.textContent = owner?.username ? `@${owner.username}` : '@unknown';
        if (tokenOwnerProfileLink) {
            if (owner?.profileUrl) {
                tokenOwnerProfileLink.classList.remove('hidden');
                tokenOwnerProfileLink.href = owner.profileUrl;
            } else {
                tokenOwnerProfileLink.classList.add('hidden');
                tokenOwnerProfileLink.removeAttribute('href');
            }
        }

        // Setup screen sync
        const authCard = document.getElementById('authCard');
        const oauthSection = document.getElementById('oauthSection');
        const setupDivider = document.getElementById('setupDivider');
        const usernameLabel = document.getElementById('usernameLabel');
        const usernameHint = document.getElementById('usernameHint');
        const usernameInput = document.getElementById('username');

        if (owner && owner.username) {
            if (authCard) {
                authCard.style.display = 'flex';
                const avatarEl = document.getElementById('authCardAvatar');
                const nameEl = document.getElementById('authCardName');
                if (avatarEl) {
                    if (owner.avatar) {
                        avatarEl.style.backgroundImage = `url(${owner.avatar})`;
                        avatarEl.textContent = '';
                    } else {
                        avatarEl.style.backgroundImage = 'none';
                        avatarEl.textContent = (owner.displayName || owner.username || '?')[0].toUpperCase();
                    }
                }
                if (nameEl) {
                    nameEl.textContent = owner.displayName ? `${owner.displayName} (@${owner.username})` : `@${owner.username}`;
                }
            }
            if (oauthSection) oauthSection.style.display = 'none';
            if (setupDivider) setupDivider.style.display = 'none';
            if (usernameLabel) usernameLabel.textContent = 'User to explore';
            if (usernameHint) usernameHint.textContent = 'Defaults to your account. Enter any username to explore their travel map.';
            if (usernameInput && !usernameInput.value) {
                usernameInput.value = owner.username;
            }
        } else {
            if (authCard) authCard.style.display = 'none';
            if (oauthSection) oauthSection.style.display = 'block';
            if (setupDivider) setupDivider.style.display = 'none';
            if (usernameLabel) usernameLabel.textContent = 'Username';
            if (usernameHint) usernameHint.textContent = '';
        }

        this.updateTokenVisibility();
    },
    updateTokenVisibility() {
        if (!this.refs?.menuApiTokenDetails) {
            this.refs.menuApiTokenDetails = document.getElementById('menuApiTokenDetails');
        }
        if (!this.refs?.menuApiTokenDetails) return;
        const authMethod = (typeof window !== 'undefined' && window.state?.authMethod) 
            || (typeof localStorage !== 'undefined' ? localStorage.getItem('tw_auth_method') : null);
        // Only display if user explicitly entered via dedicated API token
        this.refs.menuApiTokenDetails.style.display = (authMethod === 'token') ? 'block' : 'none';
    },
    setTokenStatus(message, state = 'idle', expiryText = '') {
        if (!this.refs) return;
        this.refs.tokenStatusText.textContent = message;
        this.refs.tokenStatusText.dataset.state = state;
        this.refs.tokenExpiryText.textContent = expiryText || '—';
    },
    syncTokenInputs(token) {
        if (!this.refs) return;
        if (token !== undefined) {
            this.refs.menuApiToken.value = token;
            if (this.refs.setupTokenInput) this.refs.setupTokenInput.value = token;
        }
    },
    syncUsernameInput(username) {
        if (!this.refs) return;
        if (username !== undefined) {
            this.refs.menuUsername.value = username;
            if (this.refs.setupUsernameInput) this.refs.setupUsernameInput.value = username;
        }
    },
    updateDatasetSummary(displayNameOrUsername, usernameOrTripCount, tripCountOrPicture, profilePicture) {
        if (!this.refs) return;
        
        let displayName, username, tripCount, picture;
        if (typeof usernameOrTripCount === 'number') {
            username = displayNameOrUsername;
            displayName = displayNameOrUsername;
            tripCount = usernameOrTripCount;
            picture = tripCountOrPicture;
        } else {
            displayName = displayNameOrUsername;
            username = usernameOrTripCount;
            tripCount = tripCountOrPicture;
            picture = profilePicture;
        }
        
        const datasetAvatar = document.getElementById('datasetAvatar');
        const datasetName = document.getElementById('datasetName');
        const datasetUsername = document.getElementById('datasetUsername');
        const datasetTrips = document.getElementById('datasetTrips');
        
        if (datasetAvatar) {
            if (picture) {
                datasetAvatar.style.backgroundImage = `url('${picture}')`;
                datasetAvatar.style.backgroundSize = 'cover';
                datasetAvatar.textContent = '';
            } else {
                datasetAvatar.style.backgroundImage = '';
                datasetAvatar.textContent = username ? username[0].toUpperCase() : '?';
            }
        }
        if (datasetName) {
            datasetName.textContent = displayName || 'No data loaded';
        }
        if (datasetUsername) {
            datasetUsername.textContent = username ? `@${username}` : '@—';
        }
        if (datasetTrips) {
            datasetTrips.textContent = `${tripCount || 0} trips`;
        }
    }
};

