// @ts-check
import { SessionDB } from '../cache/session.js';
import { Storage, STORAGE_KEYS } from '../storage/storage.js';
import { tripsToGeoJSON } from '../export/geojson.js';
import { escapeHtml } from '../utils/format.js';
import { spatialPreviewEngine } from './mapPreview.js';
import { downloadFile } from './sorting.js';

/**
 * Create a modular Database Studio workbench controller for trips.html.
 * Encapsulates SQL console, autocomplete, schema drawer, query execution,
 * spatial preview, and studio dataset caching.
 *
 * @param {Object} ctx
 * @param {() => Promise<{sqlEngine: any, sqlAutocomplete: any}>} ctx.loadStudioModules
 * @param {() => string} ctx.getAppMode
 * @param {(mode: string) => void} ctx.setAppMode
 * @param {() => string} ctx.getStudioTableMode
 * @param {(mode: string) => void} ctx.setStudioTableMode
 * @param {() => any} ctx.getSqlQueryResult
 * @param {(res: any) => void} ctx.setSqlQueryResult
 * @param {() => any} ctx.getActiveSession
 * @param {() => Array<any>} ctx.getAllSessions
 * @param {() => Array<any>} ctx.getAllTrips
 * @param {() => Array<any>} ctx.getFilteredTrips
 * @param {() => Array<any>} ctx.getFlattenedTrips
 * @param {(rows: Array<any>) => void} ctx.setFlattenedTrips
 * @param {() => void} ctx.resetRawSqlSort
 * @param {(page: number) => void} ctx.setPage
 * @param {(trips: Array<any>) => void} ctx.updateTelemetry
 * @param {() => void} ctx.renderResults
 * @param {() => void} ctx.applyFiltersAndRender
 */
export function createStudioWorkbench(ctx) {
    /** @type {Array<any>} */
    let studioStationsCache = [];
    /** @type {{ user: string, tripCount: number, datasets: any } | null} */
    let cachedDatasetsEntry = null;

    function invalidateStudioCache() {
        cachedDatasetsEntry = null;
        studioStationsCache = [];
    }

    /**
     * Initialize Database Studio workbench controls and recipes
     */
    async function initStudioWorkbench() {
        const studioPanel = document.getElementById('tripsStudioPanel');
        if (!studioPanel) return;

        const { sqlEngine } = await ctx.loadStudioModules();
        const recipes = sqlEngine?.QUERY_RECIPES || [];

        const recipeSelect = document.getElementById('sqlRecipeSelect');
        if (recipeSelect && recipes.length > 0) {
            recipeSelect.innerHTML = '<option value="">Choose a recipe...</option>' +
                recipes.map((r, i) => `<option value="${i}">${escapeHtml(r.title)}</option>`).join('');
        }

        const sqlInput = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('sqlQueryInput'));
        if (sqlInput && !sqlInput.value.trim() && recipes.length > 0) {
            sqlInput.value = recipes[0].sql;
        }
    }

    /**
     * Render small spatial map preview canvas for current SQL query results or filtered trips
     */
    function renderSpatialSqlPreview() {
        const activeSession = ctx.getActiveSession();
        const allSessions = ctx.getAllSessions();
        const allTrips = ctx.getAllTrips();
        const filteredTrips = ctx.getFilteredTrips();
        const appMode = ctx.getAppMode();
        const sqlQueryResult = ctx.getSqlQueryResult();

        const user = activeSession?.username || (allSessions.length ? allSessions[0].username : '');
        const titleEl = document.getElementById('spatialSqlTitle') || document.querySelector('.spatial-sql-title');
        if (titleEl) {
            titleEl.textContent = appMode === 'studio' ? 'Spatial Query Preview' : 'Spatial Map Preview';
        }
        spatialPreviewEngine.init(user);
        spatialPreviewEngine.indexStations(allTrips, studioStationsCache);
        spatialPreviewEngine.updateData({
            sqlQueryResult: appMode === 'studio' ? sqlQueryResult : null,
            trips: filteredTrips.length ? filteredTrips : allTrips,
            activeUser: user
        });

        if (!studioStationsCache.length && user) {
            SessionDB.getAllStations().then(stns => {
                if (stns && stns.length) {
                    studioStationsCache = stns;
                    spatialPreviewEngine.indexStations(ctx.getAllTrips(), studioStationsCache);
                    spatialPreviewEngine.updateData({
                        sqlQueryResult: ctx.getAppMode() === 'studio' ? ctx.getSqlQueryResult() : null,
                        trips: ctx.getFilteredTrips().length ? ctx.getFilteredTrips() : ctx.getAllTrips(),
                        activeUser: user
                    });
                }
            }).catch(() => {});
        }
    }

    /**
     * Retrieve normalized relational datasets for Studio SQL Console (memoized per user/tripCount)
     */
    async function getStudioDatasets() {
        const { sqlEngine } = await ctx.loadStudioModules();
        const activeSession = ctx.getActiveSession();
        const allSessions = ctx.getAllSessions();
        const allTrips = ctx.getAllTrips();
        const activeUser = activeSession?.username || (allSessions.length ? allSessions[0].username : '');

        if (
            cachedDatasetsEntry &&
            cachedDatasetsEntry.user === activeUser &&
            cachedDatasetsEntry.tripCount === allTrips.length &&
            ctx.getFlattenedTrips().length === allTrips.length
        ) {
            return cachedDatasetsEntry.datasets;
        }

        let allCoPassengers = [];
        try {
            allCoPassengers = await SessionDB.getAllCoPassengers();
        } catch (e) {
            console.warn('SessionDB co_passengers query fallback:', e);
        }

        let flattenedTrips = ctx.getFlattenedTrips();
        if (allCoPassengers.length > 0) {
            const coByTrip = new Map();
            for (const cp of allCoPassengers) {
                const tid = Number(cp.trip_id);
                if (!coByTrip.has(tid)) coByTrip.set(tid, []);
                coByTrip.get(tid).push(cp);
            }
            for (const trip of allTrips) {
                const bId = Number(trip.properties?.backend_trip_id || trip.backend_trip_id || trip.train?.trip || trip.checkin?.trip);
                if (bId && coByTrip.has(bId)) {
                    trip.co_passengers = coByTrip.get(bId);
                }
            }
            if (sqlEngine?.flattenTripRecord) {
                flattenedTrips = allTrips.map(sqlEngine.flattenTripRecord);
                ctx.setFlattenedTrips(flattenedTrips);
            }
        } else if (!flattenedTrips.length && allTrips.length && sqlEngine?.flattenTripRecord) {
            flattenedTrips = allTrips.map(sqlEngine.flattenTripRecord);
            ctx.setFlattenedTrips(flattenedTrips);
        }

        let statuses = [];
        let stations = [];
        let routes = [];

        try {
            const [sRes, stRes, rRes] = await Promise.all([
                activeUser ? SessionDB.getStatusesByUser(activeUser) : Promise.resolve([]),
                SessionDB.getAllStations(),
                SessionDB.getAllTrips()
            ]);
            statuses = sRes || [];
            stations = stRes || [];
            routes = rRes || [];
        } catch (e) {
            console.warn('SessionDB relational query fallback:', e);
        }

        if (!statuses.length || !stations.length || !routes.length) {
            const stnMap = new Map();
            const routeMap = new Map();
            const statusList = [];

            for (const trip of allTrips) {
                const norm = SessionDB.normalizeTrip(trip, activeUser);
                if (norm) {
                    for (const stn of norm.stations) {
                        if (stn && !stnMap.has(stn.id)) stnMap.set(stn.id, stn);
                    }
                    if (norm.tripRun && !routeMap.has(norm.tripRun.id)) {
                        routeMap.set(norm.tripRun.id, norm.tripRun);
                    }
                    if (norm.status) {
                        statusList.push(norm.status);
                    }
                }
            }
            if (!statuses.length) statuses = statusList;
            if (!stations.length) stations = Array.from(stnMap.values());
            if (!routes.length) routes = Array.from(routeMap.values());
        }

        if (stations.length) {
            studioStationsCache = stations;
        }

        const datasets = {
            trips: flattenedTrips,
            statuses,
            stations,
            routes,
            co_passengers: allCoPassengers
        };

        cachedDatasetsEntry = {
            user: activeUser,
            tripCount: allTrips.length,
            datasets
        };

        return datasets;
    }

    /**
     * Execute an arbitrary SQL query on the dataset
     * @param {string} sql
     */
    async function runSqlQuery(sql) {
        if (!sql) return;

        const { sqlEngine } = await ctx.loadStudioModules();

        const datasets = await getStudioDatasets();
        if (!datasets.trips.length && !datasets.statuses.length && !datasets.stations.length && !datasets.routes.length && !datasets.co_passengers.length) return;

        try {
            const result = sqlEngine.executeTripQuery(sql, datasets.trips, { tables: datasets });
            ctx.setSqlQueryResult(result);
            ctx.resetRawSqlSort();

            const targetBadge = document.querySelector('.sql-editor-target code');
            if (targetBadge && result.table) {
                targetBadge.textContent = result.table;
            }

            const badge = document.getElementById('sqlBenchmarkBadge');
            if (badge) {
                badge.textContent = `⏱️ ${result.executionTimeMs}ms • ${result.totalRows.toLocaleString()} rows`;
                badge.style.color = '#34d399';
                badge.style.borderColor = 'rgba(16, 185, 129, 0.3)';
            }

            if (result.table === 'trips' && result.rawTrips && result.rawTrips.length) {
                ctx.updateTelemetry(result.rawTrips);
            }

            ctx.setPage(1);
            ctx.renderResults();

            const spatialPanel = document.getElementById('spatialSqlPanel');
            if (spatialPanel && spatialPanel.style.display !== 'none') {
                renderSpatialSqlPreview();
            }
        } catch (err) {
            console.error('SQL execution error:', err);
            const message = err instanceof Error ? err.message : String(err);
            const badge = document.getElementById('sqlBenchmarkBadge');
            if (badge) {
                badge.textContent = `❌ ${message}`;
                badge.style.color = '#ef4444';
                badge.style.borderColor = 'rgba(239, 68, 68, 0.4)';
            }
            ctx.setSqlQueryResult({
                table: 'trips',
                columns: ['error'],
                rows: [],
                totalRows: 0,
                rawTrips: [],
                executionTimeMs: 0,
                isSelectAll: false,
                error: message
            });
            ctx.setPage(1);
            ctx.renderResults();
        }
    }

    /**
     * Setup Event Listeners for Database Studio Mode
     */
    function setupStudioEventListeners() {
        const modeStandardBtn = document.getElementById('modeStandardBtn');
        const modeStudioBtn = document.getElementById('modeStudioBtn');
        const filterPanel = document.getElementById('tripsFilterPanel');
        const studioPanel = document.getElementById('tripsStudioPanel');

        const sqlTableToggle = document.getElementById('sqlTableModeToggle');
        const btnTableUnified = document.getElementById('btnTableUnified');
        const btnTableRawSql = document.getElementById('btnTableRawSql');

        const updateSqlTableModeButtons = () => {
            if (sqlTableToggle) {
                sqlTableToggle.style.display = (ctx.getAppMode() === 'studio') ? 'inline-flex' : 'none';
            }
            if (btnTableUnified && btnTableRawSql) {
                if (ctx.getStudioTableMode() === 'raw') {
                    btnTableRawSql.classList.add('active');
                    btnTableUnified.classList.remove('active');
                } else {
                    btnTableUnified.classList.add('active');
                    btnTableRawSql.classList.remove('active');
                }
            }
        };
        updateSqlTableModeButtons();

        if (btnTableUnified && btnTableRawSql) {
            btnTableUnified.addEventListener('click', () => {
                ctx.setStudioTableMode('unified');
                Storage.set(STORAGE_KEYS.STUDIO_TABLE_MODE, 'unified');
                updateSqlTableModeButtons();
                ctx.renderResults();
            });

            btnTableRawSql.addEventListener('click', () => {
                ctx.setStudioTableMode('raw');
                Storage.set(STORAGE_KEYS.STUDIO_TABLE_MODE, 'raw');
                updateSqlTableModeButtons();
                ctx.renderResults();
            });
        }

        if (modeStandardBtn && modeStudioBtn) {
            modeStandardBtn.addEventListener('click', () => {
                ctx.setAppMode('standard');
                modeStandardBtn.classList.add('active');
                modeStudioBtn.classList.remove('active');
                if (filterPanel) filterPanel.style.display = 'flex';
                if (studioPanel) studioPanel.style.display = 'none';
                updateSqlTableModeButtons();
                ctx.applyFiltersAndRender();
            });

            modeStudioBtn.addEventListener('click', async () => {
                ctx.setAppMode('studio');
                modeStudioBtn.classList.add('active');
                modeStandardBtn.classList.remove('active');
                if (filterPanel) filterPanel.style.display = 'none';
                if (studioPanel) studioPanel.style.display = 'flex';
                updateSqlTableModeButtons();
                const viewTableBtn = document.getElementById('viewTableBtn');
                if (viewTableBtn && !viewTableBtn.classList.contains('active')) {
                    viewTableBtn.click();
                }

                await initStudioWorkbench();
                const { sqlEngine } = await ctx.loadStudioModules();
                if (!ctx.getSqlQueryResult()) {
                    const sqlInputEl = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('sqlQueryInput'));
                    const currentSql = sqlInputEl?.value || sqlEngine?.QUERY_RECIPES?.[0]?.sql;
                    if (currentSql) {
                        await runSqlQuery(currentSql);
                    }
                } else {
                    ctx.renderResults();
                    const spatialPanel = document.getElementById('spatialSqlPanel');
                    if (spatialPanel && spatialPanel.style.display !== 'none') {
                        renderSpatialSqlPreview();
                    }
                }
            });
        }

        const tabSqlBtn = document.getElementById('studioTabSqlBtn');
        if (tabSqlBtn) {
            tabSqlBtn.addEventListener('click', () => {
                tabSqlBtn.classList.add('active');
                const sqlInput = document.getElementById('sqlQueryInput');
                if (sqlInput) sqlInput.focus();
            });
        }

        const recipeSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById('sqlRecipeSelect'));
        if (recipeSelect) {
            recipeSelect.addEventListener('change', async (e) => {
                const { sqlEngine } = await ctx.loadStudioModules();
                const recipes = sqlEngine?.QUERY_RECIPES || [];
                const target = /** @type {HTMLSelectElement} */ (e.target);
                const idx = parseInt(target.value, 10);
                if (!Number.isNaN(idx) && recipes[idx]) {
                    const sql = recipes[idx].sql;
                    const sqlInput = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('sqlQueryInput'));
                    if (sqlInput) sqlInput.value = sql;
                    if (tabSqlBtn) tabSqlBtn.click();
                    runSqlQuery(sql);
                }
            });
        }

        const runSqlBtn = document.getElementById('runSqlQueryBtn');
        const sqlInput = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('sqlQueryInput'));
        const acPopover = document.getElementById('sqlAutocompletePopover');
        let activeACIndex = 0;
        /** @type {any} */
        let currentACResult = null;

        function updateACActiveItem() {
            if (!acPopover) return;
            acPopover.querySelectorAll('.sql-ac-item').forEach((el, idx) => {
                el.classList.toggle('active', idx === activeACIndex);
                el.setAttribute('aria-selected', idx === activeACIndex ? 'true' : 'false');
            });
        }

        function applyAC(index) {
            if (!sqlInput || !acPopover || !currentACResult || !currentACResult.items[index]) return;
            const item = currentACResult.items[index];
            const val = sqlInput.value;
            const tokenStart = currentACResult.tokenStart;
            const tokenEnd = tokenStart + currentACResult.token.length;

            const before = val.slice(0, tokenStart);
            const after = val.slice(tokenEnd);
            const insert = item.insertText;

            sqlInput.value = before + insert + after;
            const newCursor = tokenStart + insert.length;
            sqlInput.selectionStart = newCursor;
            sqlInput.selectionEnd = newCursor;
            sqlInput.focus();

            acPopover.style.display = 'none';
            currentACResult = null;
            activeACIndex = 0;
        }

        async function renderAC() {
            if (!sqlInput || !acPopover) return;
            const { sqlAutocomplete } = await ctx.loadStudioModules();
            const val = sqlInput.value;
            const cursorPos = sqlInput.selectionStart || 0;
            currentACResult = sqlAutocomplete ? sqlAutocomplete.getSQLCompletions(val, cursorPos) : { items: [] };

            if (!currentACResult.items || currentACResult.items.length === 0) {
                acPopover.style.display = 'none';
                return;
            }

            if (activeACIndex >= currentACResult.items.length) {
                activeACIndex = 0;
            }

            acPopover.innerHTML = currentACResult.items.map((item, idx) => `
                <div class="sql-ac-item ${idx === activeACIndex ? 'active' : ''}" data-ac-index="${idx}" role="option" aria-selected="${idx === activeACIndex}">
                    <div class="sql-ac-left">
                        <span class="sql-ac-badge ${item.type}">${item.type === 'keyword' ? 'KW' : (item.type === 'column' ? 'COL' : (item.type === 'value' ? 'VAL' : (item.type === 'table' ? 'TBL' : 'REC')))}</span>
                        <span class="sql-ac-label">${escapeHtml(item.label)}</span>
                    </div>
                    <div class="sql-ac-detail">${escapeHtml(item.detail || '')}</div>
                </div>
            `).join('') + `
                <div class="sql-ac-footer">
                    <span>↑/↓ navigate • ↵ / Tab apply</span>
                    <button type="button" class="sql-ac-close-btn" aria-label="Dismiss suggestions">✕ Close</button>
                </div>
            `;

            acPopover.style.display = 'flex';

            acPopover.querySelectorAll('.sql-ac-item').forEach(node => {
                const itemEl = /** @type {HTMLElement} */ (node);
                const handleSelect = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const idx = parseInt(itemEl.dataset.acIndex || '0', 10);
                    applyAC(idx);
                };
                itemEl.addEventListener('pointerdown', handleSelect);
                itemEl.addEventListener('click', handleSelect);
                itemEl.addEventListener('mouseenter', () => {
                    activeACIndex = parseInt(itemEl.dataset.acIndex || '0', 10);
                    updateACActiveItem();
                });
            });

            const closeBtn = acPopover.querySelector('.sql-ac-close-btn');
            if (closeBtn) {
                closeBtn.addEventListener('pointerdown', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    acPopover.style.display = 'none';
                });
                closeBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    acPopover.style.display = 'none';
                });
            }
        }

        if (runSqlBtn && sqlInput) {
            runSqlBtn.addEventListener('click', () => {
                if (acPopover) acPopover.style.display = 'none';
                runSqlQuery(sqlInput.value);
            });

            sqlInput.addEventListener('input', () => {
                renderAC();
            });

            sqlInput.addEventListener('keydown', (e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    if (acPopover) acPopover.style.display = 'none';
                    runSqlQuery(sqlInput.value);
                    return;
                }

                if ((e.ctrlKey || e.metaKey) && e.key === ' ') {
                    e.preventDefault();
                    renderAC();
                    return;
                }

                if (acPopover && acPopover.style.display !== 'none' && currentACResult && currentACResult.items.length > 0) {
                    if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        activeACIndex = (activeACIndex + 1) % currentACResult.items.length;
                        updateACActiveItem();
                        return;
                    }
                    if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        activeACIndex = (activeACIndex - 1 + currentACResult.items.length) % currentACResult.items.length;
                        updateACActiveItem();
                        return;
                    }
                    if (e.key === 'Enter' || e.key === 'Tab') {
                        e.preventDefault();
                        applyAC(activeACIndex);
                        return;
                    }
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        acPopover.style.display = 'none';
                        return;
                    }
                }
            });

            sqlInput.addEventListener('blur', () => {
                setTimeout(() => {
                    if (acPopover) acPopover.style.display = 'none';
                }, 200);
            });
        }

        document.querySelectorAll('.sql-chip-tag').forEach(node => {
            const chip = /** @type {HTMLElement} */ (node);
            chip.addEventListener('click', () => {
                const snippet = chip.dataset.insert;
                if (snippet && sqlInput) {
                    const currentVal = sqlInput.value.trim();
                    const hasFrom = /\bFROM\s+[a-zA-Z_]+\b/i.test(currentVal);
                    if (snippet.startsWith('SELECT *')) {
                        sqlInput.value = snippet;
                    } else if (!currentVal || !currentVal.toUpperCase().startsWith('SELECT')) {
                        sqlInput.value = `SELECT * FROM trips ${snippet}`;
                    } else if (!hasFrom && (snippet.startsWith('WHERE') || snippet.startsWith('ORDER BY'))) {
                        sqlInput.value = `${currentVal} FROM trips ${snippet}`;
                    } else if (snippet.startsWith('WHERE') && currentVal.toUpperCase().includes('WHERE')) {
                        const extraCond = snippet.replace(/^WHERE\s+/i, '');
                        if (currentVal.toUpperCase().includes('ORDER BY')) {
                            const parts = currentVal.split(/ORDER\s+BY/i);
                            sqlInput.value = `${parts[0].trim()} AND ${extraCond} ORDER BY${parts[1]}`;
                        } else {
                            sqlInput.value = `${currentVal} AND ${extraCond}`;
                        }
                    } else if (snippet.startsWith('ORDER BY') && currentVal.toUpperCase().includes('ORDER BY')) {
                        const base = currentVal.replace(/ORDER\s+BY\s+.*$/i, '').trim();
                        sqlInput.value = `${base} ${snippet}`;
                    } else {
                        sqlInput.value = `${currentVal} ${snippet}`;
                    }
                    sqlInput.focus();
                }
            });
        });

        // Database Schema & Tables Guide Drawer
        const schemaToggleBtn = document.getElementById('sqlSchemaToggleBtn');
        const schemaDrawer = document.getElementById('sqlSchemaDrawer');
        const closeSchemaBtn = document.getElementById('closeSchemaDrawerBtn');
        const schemaContentPane = document.getElementById('sqlSchemaContentPane');
        let activeSchemaTable = 'trips';

        async function renderSchemaDrawerTable(tableKey) {
            if (!schemaContentPane) return;
            const { sqlEngine } = await ctx.loadStudioModules();
            activeSchemaTable = tableKey;
            const schema = sqlEngine?.TABLE_SCHEMAS?.[tableKey] || sqlEngine?.TABLE_SCHEMAS?.trips;
            if (!schema) return;

            document.querySelectorAll('.sql-schema-tab-btn').forEach(node => {
                const btn = /** @type {HTMLElement} */ (node);
                const isMatch = btn.dataset.table === tableKey;
                btn.classList.toggle('active', isMatch);
                btn.setAttribute('aria-selected', isMatch ? 'true' : 'false');
            });

            const colCardsHtml = schema.columns.map(col => {
                const isNum = col.type === 'number';
                const badgeClass = isNum ? 'num' : (col.type === 'datetime' ? 'date' : 'text');
                const badgeLabel = isNum ? 'NUM' : (col.type === 'datetime' ? 'DATE' : 'TEXT');
                return `
                    <button type="button" class="sql-schema-col-card" data-col="${escapeHtml(col.name)}" title="Click to insert '${escapeHtml(col.name)}' into query">
                        <div class="sql-schema-col-top">
                            <span class="sql-schema-col-name">${escapeHtml(col.name)}</span>
                            <span class="sql-schema-col-type ${badgeClass}">${badgeLabel}</span>
                        </div>
                        <div class="sql-schema-col-desc">${escapeHtml(col.description || col.label)}</div>
                    </button>
                `;
            }).join('');

            schemaContentPane.innerHTML = `
                <div class="sql-schema-table-desc">
                    <strong>Table: <code>${escapeHtml(schema.name)}</code></strong> — ${escapeHtml(schema.description)}
                    <span style="color: var(--text-muted); font-size: 11px; margin-left: 6px;">(Click any column to insert into query)</span>
                </div>
                <div class="sql-schema-columns-grid">
                    ${colCardsHtml}
                </div>
                <div class="sql-schema-footer-actions">
                    <span class="sql-schema-example-query" title="Tested Query Template">${escapeHtml(schema.defaultQuery)}</span>
                    <button type="button" class="sql-schema-use-btn" id="schemaRunExampleBtn">Run Example</button>
                </div>
            `;

            schemaContentPane.querySelectorAll('.sql-schema-col-card').forEach(node => {
                const card = /** @type {HTMLElement} */ (node);
                card.addEventListener('click', () => {
                    const colName = card.dataset.col;
                    if (!colName || !sqlInput) return;
                    const cursorPos = sqlInput.selectionStart || sqlInput.value.length;
                    const before = sqlInput.value.substring(0, cursorPos);
                    const after = sqlInput.value.substring(cursorPos);
                    sqlInput.value = before + (before.endsWith(' ') || before.endsWith(',') || before === '' ? '' : ' ') + colName + ' ' + after;
                    sqlInput.focus();
                });
            });

            const runExBtn = schemaContentPane.querySelector('#schemaRunExampleBtn');
            if (runExBtn) {
                runExBtn.addEventListener('click', () => {
                    if (sqlInput) {
                        sqlInput.value = schema.defaultQuery;
                        if (tabSqlBtn) tabSqlBtn.click();
                        runSqlQuery(schema.defaultQuery);
                    }
                });
            }
        }

        if (schemaToggleBtn && schemaDrawer) {
            schemaToggleBtn.addEventListener('click', async () => {
                await ctx.loadStudioModules();
                const isVisible = schemaDrawer.style.display !== 'none';
                if (isVisible) {
                    schemaDrawer.style.display = 'none';
                    schemaToggleBtn.classList.remove('active');
                    schemaToggleBtn.setAttribute('aria-expanded', 'false');
                } else {
                    schemaDrawer.style.display = 'flex';
                    schemaToggleBtn.classList.add('active');
                    schemaToggleBtn.setAttribute('aria-expanded', 'true');
                    renderSchemaDrawerTable(activeSchemaTable);
                }
            });
        }

        if (closeSchemaBtn && schemaDrawer) {
            closeSchemaBtn.addEventListener('click', () => {
                schemaDrawer.style.display = 'none';
                if (schemaToggleBtn) {
                    schemaToggleBtn.classList.remove('active');
                    schemaToggleBtn.setAttribute('aria-expanded', 'false');
                }
            });
        }

        document.querySelectorAll('.sql-schema-tab-btn').forEach(node => {
            const btn = /** @type {HTMLElement} */ (node);
            btn.addEventListener('click', async () => {
                await ctx.loadStudioModules();
                const tbl = btn.dataset.table;
                if (tbl) renderSchemaDrawerTable(tbl);
            });
        });

        // Studio Result Exports (CSV, JSON, GeoJSON)
        const exportCsvBtn = document.getElementById('exportCsvBtn');
        const exportJsonBtn = document.getElementById('exportJsonBtn');
        const exportSqlGeoBtn = document.getElementById('exportSqlGeoJsonBtn');

        if (exportCsvBtn) {
            exportCsvBtn.addEventListener('click', async () => {
                const sqlQueryResult = ctx.getSqlQueryResult();
                if (!sqlQueryResult || !sqlQueryResult.rows?.length) {
                    alert('No active query results to export.');
                    return;
                }
                const { sqlEngine } = await ctx.loadStudioModules();
                const csv = sqlEngine.exportRowsToCSV(sqlQueryResult.rows, sqlQueryResult.columns);
                downloadFile(csv, `traewelling-query-${Date.now()}.csv`, 'text/csv');
            });
        }

        if (exportJsonBtn) {
            exportJsonBtn.addEventListener('click', () => {
                const sqlQueryResult = ctx.getSqlQueryResult();
                if (!sqlQueryResult || !sqlQueryResult.rows?.length) {
                    alert('No active query results to export.');
                    return;
                }
                const json = JSON.stringify(sqlQueryResult.rows, null, 2);
                downloadFile(json, `traewelling-query-${Date.now()}.json`, 'application/json');
            });
        }

        if (exportSqlGeoBtn) {
            exportSqlGeoBtn.addEventListener('click', () => {
                const sqlQueryResult = ctx.getSqlQueryResult();
                if (!sqlQueryResult) {
                    alert('No active query results to export.');
                    return;
                }

                if (sqlQueryResult.table === 'stations') {
                    const validStations = (sqlQueryResult.rows || []).filter(
                        stn => stn.latitude !== null && stn.latitude !== undefined && stn.longitude !== null && stn.longitude !== undefined && !Number.isNaN(Number(stn.latitude)) && !Number.isNaN(Number(stn.longitude))
                    );
                    if (!validStations.length) {
                        alert('No stations with geographic coordinates in current result.');
                        return;
                    }
                    const geojson = {
                        type: 'FeatureCollection',
                        title: 'SQL Stations Export',
                        exportDate: new Date().toISOString(),
                        features: validStations.map(stn => ({
                            type: 'Feature',
                            geometry: {
                                type: 'Point',
                                coordinates: [parseFloat(stn.longitude), parseFloat(stn.latitude)]
                            },
                            properties: {
                                id: stn.id,
                                name: stn.name || 'Station',
                                country_code: stn.country_code || null,
                                eva_number: stn.eva_number || null
                            }
                        }))
                    };
                    downloadFile(JSON.stringify(geojson, null, 2), `traewelling-stations-${Date.now()}.geojson`, 'application/geo+json');
                    return;
                }

                const trips = sqlQueryResult.rawTrips || [];
                if (!trips.length) {
                    alert('No geo-referenced trips in current query results.');
                    return;
                }
                const geojson = tripsToGeoJSON(trips, {
                    title: 'SQL Query Export',
                    exportDate: new Date().toISOString()
                });
                downloadFile(JSON.stringify(geojson, null, 2), `traewelling-query-${Date.now()}.geojson`, 'application/geo+json');
            });
        }

        // Spatial SQL Map Preview Controls
        const toggleSpatialBtn = document.getElementById('toggleSpatialPreviewBtn');
        const toggleStandardSpatialBtn = document.getElementById('toggleStandardSpatialBtn');
        const spatialPanel = document.getElementById('spatialSqlPanel');
        const closeSpatialBtn = document.getElementById('closeSpatialPanelBtn');

        const toggleSpatialPanel = () => {
            if (!spatialPanel) return;
            const isVisible = spatialPanel.style.display !== 'none';
            if (isVisible) {
                spatialPanel.style.display = 'none';
                if (toggleSpatialBtn) toggleSpatialBtn.classList.remove('active');
                if (toggleStandardSpatialBtn) toggleStandardSpatialBtn.classList.remove('active');
            } else {
                spatialPanel.style.display = 'block';
                if (toggleSpatialBtn) toggleSpatialBtn.classList.add('active');
                if (toggleStandardSpatialBtn) toggleStandardSpatialBtn.classList.add('active');
                renderSpatialSqlPreview();
            }
        };

        if (toggleSpatialBtn) toggleSpatialBtn.addEventListener('click', toggleSpatialPanel);
        if (toggleStandardSpatialBtn) toggleStandardSpatialBtn.addEventListener('click', toggleSpatialPanel);
        if (closeSpatialBtn && spatialPanel) {
            closeSpatialBtn.addEventListener('click', () => {
                spatialPanel.style.display = 'none';
                if (toggleSpatialBtn) toggleSpatialBtn.classList.remove('active');
                if (toggleStandardSpatialBtn) toggleStandardSpatialBtn.classList.remove('active');
            });
        }

        initStudioWorkbench();
    }

    return {
        initStudioWorkbench,
        setupStudioEventListeners,
        renderSpatialSqlPreview,
        getStudioDatasets,
        runSqlQuery,
        invalidateStudioCache
    };
}
