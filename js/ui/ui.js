// UI module
import { store } from '../state/store.js';
import { CONFIG } from '../config/config.js';
import { Storage, STORAGE_KEYS } from '../storage/storage.js';
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
            cargoStage: document.getElementById('cargoStage'),
            fetchStopovers: document.getElementById('fetchStopovers'),
            sceneFlipContainer: document.getElementById('sceneFlipContainer'),
            sceneFlipper: document.getElementById('sceneFlipper'),
            solariRows: document.getElementById('solariRows'),
            solariTicker: document.getElementById('solariTicker')
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
        this._solariTimer = null;
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
    updateFetchStats({ trips, pages, routes, stopovers, progress, status }) {
        if (!this.refs) return;
        if (typeof trips === 'number') this.refs.fetchTrips.textContent = trips;
        if (typeof pages === 'number') this.refs.fetchPages.textContent = pages;
        if (typeof routes === 'number') this.refs.fetchRoutes.textContent = routes;
        if (typeof stopovers === 'number' && this.refs.fetchStopovers) this.refs.fetchStopovers.textContent = stopovers;
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
                this.wakeLock = null;
            });
            console.log('Wake Lock is active');
        } catch (err) {
            console.error(`${err.name}, ${err.message}`);
        }
    },

    async releaseWakeLock() {
        if (!this.wakeLock) return;
        try {
            if (!this.wakeLock.released) {
                await this.wakeLock.release();
            }
        } catch (err) {
            console.error(`${err.name}, ${err.message}`);
        } finally {
            this.wakeLock = null;
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
    addPacketToDepot(pageNumber, count = 1) {
        if (!this.refs.depotStack) return;
        const addCount = Math.max(1, parseInt(count, 10) || 1);
        for (let i = 0; i < addCount; i++) {
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
        }
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
        // Natural, unhurried pace matching the API rate limit (~1.1s per request)
        // Deliberate, majestic industrial rhythm
        let speed = 0.85;
        if (queueLen > 25) {
            speed = 0.55;
        } else if (queueLen > 10) {
            speed = 0.70;
        } else {
            speed = 0.85;
        }
        this._animSpeed = speed;

        const gantryMoveDur = (0.35 * speed).toFixed(3);
        const hoistMoveDur = (0.24 * speed).toFixed(3);
        const trainStepDur = (0.40 * speed).toFixed(3);
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
            // LIFO: Crane picks the topmost container of the current stack (top-to-bottom stack physics)
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
        const maxWaitMs = 15000; // Allow ample time for natural animation pace without stalling sleeping tabs

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
    retuneCargoAnimation() {
        // 1. If currently fetching and wakeLock dropped during sleep, re-acquire it
        if (!this.wakeLock && typeof this.acquireWakeLock === 'function') {
            this.acquireWakeLock().catch(() => {});
        }

        // 2. Clear any stuck / stale crane timeouts from pre-sleep
        if (Array.isArray(this._craneTimeouts)) {
            this._craneTimeouts.forEach(id => clearTimeout(id));
            this._craneTimeouts = [];
        }

        // 3. Reset crane animation lock if stalled
        const gantry = this.refs?.gantry;
        const hoist = this.refs?.gantryHoist;
        const payload = this.refs?.gantryPayload;

        if (this.craneAnimating) {
            console.log('Retuning cargo animation after sleep/visibility change');
            this.craneAnimating = false;
        }

        // 4. Restore crane gantry and hoist to safe idle position
        if (gantry) {
            gantry.classList.remove('at-depot');
            gantry.classList.add('at-train');
            gantry.style.left = '';
            gantry.style.setProperty('--trolley-pos', '50%');
        }
        if (hoist) {
            hoist.style.height = '12px';
        }
        if (payload) {
            payload.classList.remove('visible');
            payload.innerHTML = '';
        }

        // 5. Update animation speed and depot scroll
        this._updateAnimSpeed();
        this._updateDepotScroll();

        // 6. If items remain in queue, kick queue processing smoothly
        if (Array.isArray(this.loadQueue) && this.loadQueue.length > 0) {
            requestAnimationFrame(() => {
                this._processQueue();
            });
        }

        // 7. Retune Solari board shuffle if active
        if (this._solariTimer && this._solariTrips && this._solariTrips.length) {
            clearInterval(this._solariTimer);
            this.startSolariShuffle(this._solariTrips);
        }
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
        if (this.currentTrainLoadedCount > 0) {
            // Ensure next empty car exists on current train
            if (!this.flatcars[this.currentTrainLoadedCount]) {
                const nextCar = this._createFlatcarElement();
                trainZone.appendChild(nextCar);
                this.flatcars.push(nextCar);
            }
            // Advance train forward so new car rolls into place under the crane
            this._updateTrainPosition(this.currentTrainLoadedCount);
        }

        const baseHeight = 12;
        const stackLevel = Math.max(1, item.stackHeight || 1);
        const hoistDepot = Math.max(baseHeight, 70 - (stackLevel - 1) * 20);
        const hoistTrain = 58;

        // Ensure target car exists at current loading position on this train
        let targetCar = this.flatcars && this.flatcars[this.currentTrainLoadedCount]
            ? this.flatcars[this.currentTrainLoadedCount]
            : null;
        if (!targetCar) {
            const extraCar = this._createFlatcarElement();
            trainZone.appendChild(extraCar);
            if (!this.flatcars) this.flatcars = [];
            this.flatcars.push(extraCar);
            targetCar = extraCar;
        }

        // Dynamically compute target gantry and trolley position to match the container center,
        // clamped strictly to the physical crane runway and depot boundary so the crane never drives off screen
        let targetGantryLeft = 32;
        let trolleyPos = '50%';
        if (this.refs.cargoScene && item.el) {
            const sceneRect = this.refs.cargoScene.getBoundingClientRect();
            const crateRect = item.el.getBoundingClientRect();
            const gantryRect = gantry.getBoundingClientRect();
            const gantryWidth = gantryRect.width || 136;
            if (crateRect.width > 0) {
                const crateCenterX = (crateRect.left + (crateRect.width / 2)) - sceneRect.left;
                const minGantryLeft = 6;
                const maxGantryDepotLeft = 48; // Physical runway boundary over the depot
                targetGantryLeft = Math.min(maxGantryDepotLeft, Math.max(minGantryLeft, Math.round(crateCenterX - (gantryWidth / 2))));
                
                // Fine-tune trolley position along the spreader beam to hover precisely over the crate
                const trolleyPx = Math.round(crateCenterX - targetGantryLeft - 2);
                trolleyPos = `${Math.max(6, Math.min(gantryWidth - 16, trolleyPx))}px`;
            }
        }

        gantry.classList.remove('at-train');
        gantry.classList.add('at-depot');
        gantry.style.left = `${targetGantryLeft}px`;
        gantry.style.setProperty('--trolley-pos', trolleyPos);

        if (!Array.isArray(this._craneTimeouts)) this._craneTimeouts = [];
        this._craneTimeouts.forEach(id => clearTimeout(id));
        this._craneTimeouts = [];

        const registerTimeout = (fn, delay) => {
            const id = setTimeout(() => {
                const idx = this._craneTimeouts.indexOf(id);
                if (idx !== -1) this._craneTimeouts.splice(idx, 1);
                fn();
            }, delay);
            this._craneTimeouts.push(id);
            return id;
        };

        // Safety watchdog: ensure crane never stays permanently locked if an error or stall happens
        registerTimeout(() => {
            if (this.craneAnimating) {
                console.warn('Crane animation watchdog timeout triggered, resetting lock');
                this.craneAnimating = false;
                if (this.loadQueue.length > 0) {
                    this._processQueue();
                }
            }
        }, Math.max(2500, t(2800)));

        registerTimeout(() => { hoist.style.height = hoistDepot + 'px'; }, t(380));
        registerTimeout(() => {
            // Container is hooked by the spreader: transfer visually to hoist payload
            if (item.el) {
                item.el.style.visibility = 'hidden';
            }
            const itemBg = this._resolveContainerBackground(item.designBg);
            payload.style.background = itemBg;
            payload.innerHTML = this._crateMarkup(item.page);
            payload.classList.add('visible');
            hoist.style.height = baseHeight + 'px';
        }, t(600));

        registerTimeout(() => {
            // Crane begins carrying the container over to the train
            gantry.classList.remove('at-depot');
            gantry.classList.add('at-train');
            gantry.style.left = '';
            gantry.style.setProperty('--trolley-pos', '50%');

            // Now that the crane has safely departed the dock queue, cleanly remove
            // the picked container and smoothly slide the depot queue forward
            if (item.el && item.el.parentElement) {
                const colEl = item.el.parentElement;
                item.el.remove();
                const colIndex = this.depotColumns.findIndex(c => c.el === colEl);
                if (colIndex !== -1) {
                    const col = this.depotColumns[colIndex];
                    col.count = colEl.children.length;
                    if (col.count === 0) {
                        colEl.classList.add('emptying');
                        registerTimeout(() => {
                            colEl.remove();
                            const idx = this.depotColumns.indexOf(col);
                            if (idx !== -1) this.depotColumns.splice(idx, 1);
                            this._updateDepotScroll();
                        }, t(250));
                    } else {
                        this._updateDepotScroll();
                    }
                } else {
                    this._updateDepotScroll();
                }
            }
        }, t(850));
        registerTimeout(() => { hoist.style.height = hoistTrain + 'px'; }, t(1100));
        registerTimeout(() => {
            payload.classList.remove('visible');
            if (targetCar) {
                const crate = this._createCrateElement('train-crate', item.page, item.designBg);
                targetCar.appendChild(crate);
                targetCar.classList.add('settling');
                registerTimeout(() => targetCar.classList.remove('settling'), Math.max(120, t(280)));
            }
            this.loadedCarsCount = (this.loadedCarsCount || 0) + 1;
            this.trainCarsCount = this.loadedCarsCount;
            this.currentTrainLoadedCount = (this.currentTrainLoadedCount || 0) + 1;
            hoist.style.height = baseHeight + 'px';

            const remainingInQueue = this.loadQueue.length;
            const remainingInDepot = this.totalDepotReceived - this.loadedCarsCount;
            const hasMoreToLoad = remainingInQueue > 0 || remainingInDepot > 0;
            const trainIsFull = this.currentTrainLoadedCount >= (this.currentTrainCapacity || 24);

            // After 20-30 containers, current train drives off and a brand new train arrives!
            if (trainIsFull && hasMoreToLoad) {
                this._swapTrainConsist();
                return;
            }

            if (this.refs.cargoStage) {
                if (this.trainCarsCount >= this.totalDepotReceived && this.loadQueue.length === 0) {
                    registerTimeout(() => { if (this.refs.cargoStage) this.refs.cargoStage.classList.remove('visible'); }, 2000);
                }
            }
            this.craneAnimating = false;
            if (this.loadQueue.length > 0) registerTimeout(() => this._processQueue(), t(50));
        }, t(1350));
    },
    _updateDepotScroll() {
        if (!this.refs?.depotStack) return;
        const stack = this.refs.depotStack;
        const colCount = this.depotColumns.length;
        if (colCount <= this._maxVisibleCols) {
            stack.style.transform = 'translateX(0px)';
            return;
        }

        const colEl = stack.querySelector('.depot-col');
        const computedStyle = window.getComputedStyle(stack);
        const gap = parseFloat(computedStyle.gap || '3') || 3;
        const colWidth = colEl ? colEl.getBoundingClientRect().width : 28;
        
        // Find the rightmost active column (LIFO pickup order)
        let activeIndex = -1;
        for (let i = this.depotColumns.length - 1; i >= 0; i--) {
            if (this.depotColumns[i].count > 0) {
                activeIndex = i;
                break;
            }
        }
        if (activeIndex === -1) activeIndex = Math.max(0, colCount - 1);

        // In a flex-end container, column (colCount - 1) is naturally at 0px offset.
        // If the active column is deeper to the left (e.g. index 0), shifting right (+px)
        // pulls older leftward columns smoothly into view underneath the crane runway.
        const colsFromRight = (colCount - 1) - activeIndex;
        const maxColsFromRight = Math.max(0, colCount - this._maxVisibleCols);
        const shiftCols = Math.min(colsFromRight, maxColsFromRight);
        const shift = shiftCols * (colWidth + gap);
        stack.style.transform = `translateX(${shift}px)`;
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

            // 2. Initial single empty flatcar (stops directly under the crane)
            this.flatcars = [];
            const car0 = this._createFlatcarElement();
            trainZone.appendChild(car0);
            this.flatcars.push(car0);

            this.loadedCarsCount = 0;
            this.trainCarsCount = 0;
            this.currentTrainLoadedCount = 0;
            this.currentTrainCapacity = Math.floor(Math.random() * 6) + 22; // 22 to 27 containers per train (20-30 range)

            this._updateTrainPosition(0);
            void trainZone.offsetWidth;
            trainZone.classList.add('arriving');
            this._triggerRollingAnimation(800);
            setTimeout(() => {
                if (trainZone) trainZone.classList.remove('arriving');
            }, 800);
        }
    },
    async _swapTrainConsist() {
        if (!this.refs.trainZone) return;
        this.craneAnimating = true;

        if (this.refs.cargoStage) {
            this.refs.cargoStage.textContent = 'Train consist full — departing...';
            this.refs.cargoStage.classList.add('visible');
        }

        // 1. Depart the current full train (intermediate departure: do NOT flip board)
        await this.departTrain([], { isFinal: false });

        if (this.refs.cargoStage) {
            this.refs.cargoStage.textContent = 'New train arriving...';
        }

        // 2. Clear departed train and reset current train counter
        const trainZone = this.refs.trainZone;
        trainZone.classList.remove('departing');
        trainZone.innerHTML = '';
        this.currentTrainLoadedCount = 0;
        this.currentTrainCapacity = Math.floor(Math.random() * 6) + 22; // 22 to 27 containers (20-30 range)

        // 3. Spawn fresh new train: locomotive + 1 single empty flatcar
        const loco = this._createLocomotiveElement();
        trainZone.appendChild(loco);

        this.flatcars = [];
        const car0 = this._createFlatcarElement();
        trainZone.appendChild(car0);
        this.flatcars.push(car0);

        // 4. Arrive the new train
        this._updateTrainPosition(0);
        void trainZone.offsetWidth;
        trainZone.classList.add('arriving');
        this._triggerRollingAnimation(800);

        await new Promise(r => setTimeout(r, 800));
        trainZone.classList.remove('arriving');

        if (this.refs.cargoStage) {
            this.refs.cargoStage.classList.remove('visible');
        }

        this.craneAnimating = false;
        // Resume queue processing on the new train!
        if (this.loadQueue.length > 0) {
            setTimeout(() => this._processQueue(), 100);
        }
    },
    ensureLocomotive() {
        const numCars = Math.max(1, this.totalDepotReceived || 1);
        this.ensureTrain(numCars);
    },
    async departTrain(trips = [], { isFinal = true } = {}) {
        if (!this.refs.trainZone) return;
        const trainZone = this.refs.trainZone;
        const currentTransform = trainZone.style.transform || 'translateX(0px)';
        const match = currentTransform.match(/translateX\(([-\d.]+)px\)/);
        const currentX = match ? parseFloat(match[1]) : 0;
        trainZone.style.setProperty('--train-shift', `${currentX}px`);
        this._triggerRollingAnimation(1050);
        trainZone.classList.add('departing');

        // Allow train to pick up speed across the scene
        await new Promise(r => setTimeout(r, 650));

        // Flip the entire animation housing over to the Solari departure board ONLY on final departure
        if (isFinal && this.refs.sceneFlipper) {
            this.populateSolariBoard(trips);
            this.refs.sceneFlipper.classList.add('flipped');
            this.startSolariShuffle(trips);
            await new Promise(r => setTimeout(r, 700));
        } else {
            await new Promise(r => setTimeout(r, 400));
        }
    },
    _extractPlatform(trip, fallbackIndex = 1) {
        const train = trip?.train || trip?.checkin || trip?.properties?.train || trip?.properties?.checkin || {};
        const origin = train.origin || {};
        const rawPlat = origin.departurePlatformReal || origin.departurePlatformPlanned || origin.platform || train.platform || train.track;
        if (rawPlat !== undefined && rawPlat !== null && String(rawPlat).trim() !== '') {
            return String(rawPlat).replace(/[^a-zA-Z0-9]/g, '').slice(0, 4);
        }
        // Realistic varied track number based on trip/status ID or hash
        const seed = trip.id || trip.properties?.statusId || (fallbackIndex * 7 + 3);
        const trackNum = (Math.abs(seed) % 18) + 1;
        const subLetter = (seed % 5 === 0) ? (seed % 2 === 0 ? 'a' : 'b') : '';
        return `${trackNum}${subLetter}`;
    },
    _formatRouteHtml(trip) {
        const train = trip.train || trip.checkin || {};
        const origin = (train.origin?.name || 'Origin').toUpperCase();
        const dest = (train.destination?.name || 'Destination').toUpperCase();
        const stopovers = Array.isArray(train.stopovers) ? train.stopovers : [];
        let viaNames = [];
        if (stopovers.length > 0) {
            viaNames = stopovers
                .map(st => (st.name || st.station?.name || '').trim())
                .filter(n => n && n.toUpperCase() !== origin && n.toUpperCase() !== dest);
        }
        // Focus prominently on the actual intermediate stations along this traveled segment
        const viaText = viaNames.length > 0 
            ? `via ${viaNames.slice(0, 5).join(' • ')}`
            : '';

        return `<div class="solari-dest-lines"><span class="solari-dest-main">${origin} → ${dest}</span>${viaText ? `<span class="solari-dest-via">${viaText}</span>` : ''}</div>`;
    },
    populateSolariBoard(trips = []) {
        if (!this.refs.solariRows) return;
        const container = this.refs.solariRows;
        container.innerHTML = '';

        // Extract real journey segments from fetched trips
        const validTrips = Array.isArray(trips) ? trips.filter(t => t && (t.train || t.checkin)) : [];
        const pool = validTrips.length > 0 ? validTrips : [
            { train: { lineName: 'ICE 726', origin: { name: 'München Hbf' }, destination: { name: 'Köln Hbf' }, stopovers: [{ name: 'Nürnberg Hbf' }, { name: 'Würzburg Hbf' }, { name: 'Frankfurt Hbf' }, { name: 'Bonn Hbf' }], category: 'ICE' }, createdAt: new Date().toISOString() },
            { train: { lineName: 'RE 1', origin: { name: 'Hamm(Westf)' }, destination: { name: 'Aachen Hbf' }, stopovers: [{ name: 'Dortmund Hbf' }, { name: 'Bochum Hbf' }, { name: 'Essen Hbf' }, { name: 'Düsseldorf Hbf' }], category: 'RE' }, createdAt: new Date().toISOString() },
            { train: { lineName: 'IC 2020', origin: { name: 'Frankfurt Hbf' }, destination: { name: 'Hamburg-Altona' }, stopovers: [{ name: 'Göttingen' }, { name: 'Hannover Hbf' }, { name: 'Hamburg Hbf' }], category: 'IC' }, createdAt: new Date().toISOString() },
            { train: { lineName: 'TGV 9556', origin: { name: 'Stuttgart Hbf' }, destination: { name: 'Paris Est' }, stopovers: [{ name: 'Karlsruhe Hbf' }, { name: 'Strasbourg' }], category: 'TGV' }, createdAt: new Date().toISOString() },
            { train: { lineName: 'FLX 10', origin: { name: 'Berlin Hbf' }, destination: { name: 'Basel Bad Bf' }, stopovers: [{ name: 'Leipzig Hbf' }, { name: 'Erfurt Hbf' }, { name: 'Heidelberg' }], category: 'FLX' }, createdAt: new Date().toISOString() }
        ];

        // Display up to 5 real departure rows on the board
        const rowsToShow = pool.slice(0, 5);
        rowsToShow.forEach((trip, idx) => {
            const row = document.createElement('div');
            row.className = 'solari-row';
            row.id = `solariRow_${idx}`;

            const d = trip.createdAt ? new Date(trip.createdAt) : new Date();
            const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            const trainObj = trip.train || trip.checkin || {};
            const trainStr = (trainObj.lineName || trainObj.category || 'TRAIN').slice(0, 8).toUpperCase();
            const routeHtml = this._formatRouteHtml(trip);
            const platformStr = this._extractPlatform(trip, idx);
            const statuses = ['ON TIME', 'BOARDING', 'ON TIME', 'DEP 5M', 'ON TIME'];
            const statClasses = ['on-time', 'boarding', 'on-time', 'delayed', 'on-time'];

            row.innerHTML = `
                <span class="solari-time" data-field="time">${timeStr}</span>
                <span class="solari-train" data-field="train">${trainStr}</span>
                <span class="solari-dest" data-field="dest">${routeHtml}</span>
                <span class="solari-plat" data-field="plat">${platformStr}</span>
                <span class="solari-stat ${statClasses[idx % statClasses.length]}" data-field="stat">${statuses[idx % statuses.length]}</span>
            `;
            container.appendChild(row);
        });

        if (this.refs.solariTicker && validTrips.length > 0) {
            const count = validTrips.length;
            this.refs.solariTicker.textContent = `FETCHING STOPOVERS • ${count} JOURNEYS • LIVE VIA STATIONS POPULATING`;
        }
    },
    startSolariShuffle(trips = []) {
        if (this._solariTimer) clearInterval(this._solariTimer);
        const validTrips = Array.isArray(trips) ? trips.filter(t => t && t.train) : [];
        this._solariTrips = validTrips;
        if (validTrips.length <= 1) return;

        // Randomly flip departure board rows with real station names, varied track numbers, and intermediate stopovers
        this._solariTimer = setInterval(() => {
            if (!this.refs.solariRows) return;
            const rows = this.refs.solariRows.querySelectorAll('.solari-row');
            if (rows.length === 0) return;

            const randomRowIdx = Math.floor(Math.random() * rows.length);
            const targetRow = rows[randomRowIdx];
            const randomTrip = validTrips[Math.floor(Math.random() * validTrips.length)];
            if (!targetRow || !randomTrip) return;

            const destEl = targetRow.querySelector('[data-field="dest"]');
            const trainEl = targetRow.querySelector('[data-field="train"]');
            const timeEl = targetRow.querySelector('[data-field="time"]');
            const platEl = targetRow.querySelector('[data-field="plat"]');
            const statEl = targetRow.querySelector('[data-field="stat"]');

            const nextRouteHtml = this._formatRouteHtml(randomTrip);
            const nextTrain = (randomTrip.train?.lineName || randomTrip.train?.category || 'ICE').slice(0, 8).toUpperCase();
            const d = randomTrip.createdAt ? new Date(randomTrip.createdAt) : new Date();
            const nextTime = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            const nextPlat = this._extractPlatform(randomTrip, randomRowIdx);

            if (destEl) {
                destEl.classList.remove('flipping');
                void destEl.offsetWidth;
                destEl.innerHTML = nextRouteHtml;
                destEl.classList.add('flipping');
            }
            if (trainEl) {
                trainEl.classList.remove('flipping');
                void trainEl.offsetWidth;
                trainEl.textContent = nextTrain;
                trainEl.classList.add('flipping');
            }
            if (timeEl) {
                timeEl.classList.remove('flipping');
                void timeEl.offsetWidth;
                timeEl.textContent = nextTime;
                timeEl.classList.add('flipping');
            }
            if (platEl) {
                platEl.classList.remove('flipping');
                void platEl.offsetWidth;
                platEl.textContent = nextPlat;
                platEl.classList.add('flipping');
            }
            if (statEl) {
                const depDelay = randomTrip.train?.departureDelay;
                if (depDelay && depDelay > 300) {
                    statEl.textContent = `+${Math.round(depDelay / 60)}M`;
                    statEl.className = 'solari-stat delayed';
                } else {
                    statEl.textContent = 'ON TIME';
                    statEl.className = 'solari-stat on-time';
                }
            }
        }, 950);
    },
    onSolariBatchUpdated(tripsWithStopovers = [], batchNumber = 0, totalBatches = 0) {
        if (!this.refs?.solariRows || !Array.isArray(tripsWithStopovers) || tripsWithStopovers.length === 0) return;
        const rows = this.refs.solariRows.querySelectorAll('.solari-row');
        if (rows.length === 0) return;

        // Take trips from this batch that have stopovers
        const tripsWithStops = tripsWithStopovers.filter(t => Array.isArray(t?.train?.stopovers) && t.train.stopovers.length > 0);
        const tripToDisplay = tripsWithStops.length > 0 ? tripsWithStops[Math.floor(Math.random() * tripsWithStops.length)] : tripsWithStopovers[0];
        if (!tripToDisplay) return;

        // Choose a target row to flip
        const randomRowIdx = Math.floor(Math.random() * rows.length);
        const targetRow = rows[randomRowIdx];
        if (!targetRow) return;

        const destEl = targetRow.querySelector('[data-field="dest"]');
        const trainEl = targetRow.querySelector('[data-field="train"]');
        const timeEl = targetRow.querySelector('[data-field="time"]');
        const platEl = targetRow.querySelector('[data-field="plat"]');
        const statEl = targetRow.querySelector('[data-field="stat"]');

        const nextRouteHtml = this._formatRouteHtml(tripToDisplay);
        const nextTrain = (tripToDisplay.train?.lineName || tripToDisplay.train?.category || 'ICE').slice(0, 8).toUpperCase();
        const d = tripToDisplay.createdAt ? new Date(tripToDisplay.createdAt) : new Date();
        const nextTime = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        const nextPlat = this._extractPlatform(tripToDisplay, randomRowIdx);

        if (destEl) {
            destEl.classList.remove('flipping');
            void destEl.offsetWidth;
            destEl.innerHTML = nextRouteHtml;
            destEl.classList.add('flipping');
        }
        if (trainEl) {
            trainEl.classList.remove('flipping');
            void trainEl.offsetWidth;
            trainEl.textContent = nextTrain;
            trainEl.classList.add('flipping');
        }
        if (timeEl) {
            timeEl.classList.remove('flipping');
            void timeEl.offsetWidth;
            timeEl.textContent = nextTime;
            timeEl.classList.add('flipping');
        }
        if (platEl) {
            platEl.classList.remove('flipping');
            void platEl.offsetWidth;
            platEl.textContent = nextPlat;
            platEl.classList.add('flipping');
        }
        if (statEl) {
            statEl.textContent = 'SYNCED';
            statEl.className = 'solari-stat on-time';
        }

        if (this.refs?.solariTicker) {
            const stopCount = Array.isArray(tripToDisplay.train?.stopovers) ? tripToDisplay.train.stopovers.length : 0;
            const progressPart = (batchNumber && totalBatches) ? `[BATCH ${batchNumber}/${totalBatches}] ` : '';
            this.refs.solariTicker.textContent = `FETCHING STOPOVER STATIONS • ${progressPart}${nextTrain}: ${stopCount} VIA STATIONS RETRIEVED • LIVE NETWORK BOARD`;
        }
    },
    stopSolariShuffle() {
        if (this._solariTimer) {
            clearInterval(this._solariTimer);
            this._solariTimer = null;
        }
        this._craneTimeouts = [];
    },
    onFetchError() {
        if (!this.refs) return;
        if (Array.isArray(this._craneTimeouts)) {
            this._craneTimeouts.forEach(id => clearTimeout(id));
            this._craneTimeouts = [];
        }
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
    clearFetchError() {
        if (!this.refs) return;
        if (this.refs.cargoScene) {
            this.refs.cargoScene.classList.remove('has-error');
        }
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
        if (Array.isArray(this._craneTimeouts)) {
            this._craneTimeouts.forEach(id => clearTimeout(id));
            this._craneTimeouts = [];
        }
        this.craneAnimating = false;
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
        const safeGantryLeft = Number.isFinite(gantryTrainLeft) ? gantryTrainLeft : (window.innerWidth <= 375 ? 135 : (window.innerWidth <= 768 ? 142 : 155));
        const safeGantryWidth = Number.isFinite(gantryWidth) ? gantryWidth : (window.innerWidth <= 375 ? 100 : (window.innerWidth <= 768 ? 106 : 136));
        const targetCenter = safeGantryLeft + (safeGantryWidth / 2);

        const locoWidth = 48;
        const carWidth = 32;
        const carGap = 2;

        // Position carIndex directly under the gantry hoist at targetCenter
        const distFromRight = locoWidth + carGap + (carWidth / 2) + (carIndex * (carWidth + carGap));
        const shift = targetCenter - (sceneWidth - distFromRight);

        trainZone.style.setProperty('--train-shift', `${shift}px`);
        trainZone.style.transform = `translateX(${shift}px)`;
        const rollDuration = Math.max(250, Math.round(500 * this._animSpeed));
        this._triggerRollingAnimation(rollDuration);
        this._updateOffscreenCars();
    },
    _updateTrainScroll() {
        this._updateTrainPosition(this.currentTrainLoadedCount || 0);
    },
    resetCargoAnimation() {
        if (!this.refs) return;
        this.depotCrates = [];
        this.depotColumns = [];
        this.trainCarsCount = 0;
        this.loadedCarsCount = 0;
        this.currentTrainLoadedCount = 0;
        this.currentTrainCapacity = 24;
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
        if (this.refs.cargoScene) this.refs.cargoScene.classList.remove('has-error', 'train-shunting');
        if (this.refs.depotStack) { this.refs.depotStack.innerHTML = ''; this.refs.depotStack.style.transform = ''; }
        if (this.refs.trainZone) {
            this.refs.trainZone.innerHTML = '';
            this.refs.trainZone.style.transform = '';
            this.refs.trainZone.style.removeProperty('--train-shift');
            this.refs.trainZone.classList.remove('departing', 'arriving');
        }
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
        if (this.refs.waypointBoard) {
            this.refs.waypointBoard.classList.remove('active');
            const light = this.refs.waypointBoard.querySelector('.waypoint-signal-light');
            if (light) light.className = 'waypoint-signal-light green';
        }
        if (this.refs.fetchStopovers) {
            this.refs.fetchStopovers.textContent = '0';
        }
        this.stopSolariShuffle();
        if (this.refs.sceneFlipper) {
            this.refs.sceneFlipper.classList.remove('flipped');
        }
        if (this.refs.solariRows) {
            this.refs.solariRows.innerHTML = '';
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
            || Storage.get(STORAGE_KEYS.AUTH_METHOD);
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

