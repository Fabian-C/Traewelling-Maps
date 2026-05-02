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
        return `<div class="crate-ribs"></div><div class="crate-lbl">${pageNumber}</div>`;
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

        return new Promise(resolve => {
            const poll = () => {
                if ((typeof shouldCancel === 'function' && shouldCancel()) || this.trainCarsCount >= targetLoaded) {
                    resolve();
                    return;
                }
                setTimeout(poll, 40);
            };
            poll();
        });
    },
    _processQueue() {
        if (this.craneAnimating || this.loadQueue.length === 0) return;
        this.craneAnimating = true;
        const t = (ms) => Math.round(ms * this._animSpeed);
        const item = this.loadQueue.shift();
        const gantry = this.refs.gantry;
        const hoist = this.refs.gantryHoist;
        const payload = this.refs.gantryPayload;
        const trainZone = this.refs.trainZone;
        if (!gantry || !hoist || !payload || !trainZone) { this.craneAnimating = false; return; }

        const crateHeight = 18;
        const crateGap = 2;
        const baseHeight = 12;
        const gantryBeamHeight = 95;
        const depotBottom = 26;
        const stackLevel = item.stackHeight || 1;
        const containerTop = depotBottom + (stackLevel - 1) * (crateHeight + crateGap) + crateHeight;
        const hoistDepot = Math.max(baseHeight, gantryBeamHeight - containerTop + baseHeight);
        const trainDeck = 28 + 5;
        const hoistTrain = gantryBeamHeight - trainDeck + baseHeight;
        let targetCar = null;

        gantry.classList.remove('at-train');
        gantry.classList.add('at-depot');
        setTimeout(() => { hoist.style.height = hoistDepot + 'px'; }, t(360));
        setTimeout(() => {
            item.el.classList.add('pickup');
            setTimeout(() => {
                if (item.el.parentElement) {
                    const colEl = item.el.parentElement;
                    item.el.remove();
                    if (colEl.children.length === 0) {
                        colEl.remove();
                        this.depotColumns = this.depotColumns.filter(c => c.el.parentElement);
                    } else {
                        const col = this.depotColumns.find(c => c.el === colEl);
                        if (col) col.count = colEl.children.length;
                    }
                    this._updateDepotScroll();
                }
            }, t(200));
            const itemBg = this._resolveContainerBackground(item.designBg);
            payload.style.background = itemBg;
            payload.innerHTML = this._crateMarkup(item.page);
            payload.classList.add('visible');
            hoist.style.height = baseHeight + 'px';
        }, t(570));
        setTimeout(() => {
            gantry.classList.remove('at-depot');
            gantry.classList.add('at-train');
        }, t(780));
        setTimeout(() => {
            if (this.trainCarsCount === 0 && !trainZone.querySelector('.locomotive')) {
                const loco = document.createElement('div');
                loco.className = 'locomotive';
                loco.innerHTML = `<div class="loco-body"><div class="loco-cab"><div class="loco-window"></div></div><div class="loco-stripe"></div></div>
                    <div class="loco-bogie bl"><div class="flatcar-axle"></div><div class="flatcar-axle"></div></div>
                    <div class="loco-bogie br"><div class="flatcar-axle"></div><div class="flatcar-axle"></div></div>`;
                trainZone.insertBefore(loco, trainZone.firstChild);
            }
            const car = document.createElement('div');
            car.className = 'flatcar';
            car.innerHTML = `<div class="flatcar-deck"></div>
                <div class="flatcar-bogie bl"><div class="flatcar-axle"></div><div class="flatcar-axle"></div></div>
                <div class="flatcar-bogie br"><div class="flatcar-axle"></div><div class="flatcar-axle"></div></div>`;
            trainZone.appendChild(car);
            targetCar = car;
            this.trainCarsCount++;
            this._updateTrainScroll();
        }, t(980));
        setTimeout(() => { hoist.style.height = hoistTrain + 'px'; }, t(1130));
        setTimeout(() => {
            payload.classList.remove('visible');
            if (targetCar) {
                const crate = this._createCrateElement('train-crate', item.page, item.designBg);
                targetCar.appendChild(crate);
                requestAnimationFrame(() => {
                    const tc = targetCar.querySelector('.train-crate');
                    if (tc) tc.classList.add('placed');
                });
            }
            if (!targetCar) {
                this.trainCarsCount++;
                this._updateTrainScroll();
            }
            hoist.style.height = baseHeight + 'px';
            if (this.refs.cargoStage) {
                if (this.trainCarsCount >= this.totalDepotReceived && this.loadQueue.length === 0) {
                    setTimeout(() => { if (this.refs.cargoStage) this.refs.cargoStage.classList.remove('visible'); }, 2500);
                }
            }
            this.craneAnimating = false;
            if (this.loadQueue.length > 0) setTimeout(() => this._processQueue(), t(50));
        }, t(1330));
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
    _updateTrainScroll() {
        if (!this.refs.trainZone || this.trainCarsCount === 0) return;
        const trainZone = this.refs.trainZone;
        const sceneWidth = this._cargoSceneWidth || (this.refs.cargoScene ? this.refs.cargoScene.clientWidth : 500);

        const rootStyle = window.getComputedStyle(document.documentElement);
        const gantryTrainLeft = parseFloat(rootStyle.getPropertyValue('--gantry-train-left'));
        const gantryWidth = parseFloat(rootStyle.getPropertyValue('--gantry-width'));
        const safeGantryLeft = Number.isFinite(gantryTrainLeft) ? gantryTrainLeft : 200;
        const safeGantryWidth = Number.isFinite(gantryWidth) ? gantryWidth : 120;
        const targetCenter = safeGantryLeft + (safeGantryWidth / 2) + 4;

        const locoWidth = 40;
        const carWidth = 44;
        const newestCarCenterNoShift = sceneWidth - (locoWidth + this.trainCarsCount * carWidth) + (carWidth / 2);
        const shift = targetCenter - newestCarCenterNoShift;

        trainZone.style.transform = `translateX(${shift}px)`;
    },
    resetCargoAnimation() {
        this.depotCrates = [];
        this.depotColumns = [];
        this.trainCarsCount = 0;
        this.craneAnimating = false;
        this.loadQueue = [];
        this.totalDepotReceived = 0;
        this.totalBatches = 0;
        this.batchesCompleted = 0;
        if (this.refs.depotStack) { this.refs.depotStack.innerHTML = ''; this.refs.depotStack.style.transform = ''; }
        if (this.refs.trainZone) { this.refs.trainZone.innerHTML = ''; this.refs.trainZone.style.transform = ''; }
        if (this.refs.gantry) this.refs.gantry.classList.remove('at-depot', 'at-train');
        if (this.refs.gantryHoist) this.refs.gantryHoist.style.height = '12px';
        if (this.refs.gantryPayload) this.refs.gantryPayload.classList.remove('visible');
        if (this.refs.cargoStage) { this.refs.cargoStage.textContent = ''; this.refs.cargoStage.classList.remove('visible'); }
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

