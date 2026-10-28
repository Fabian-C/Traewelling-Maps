import fs from 'fs';
import { spawn, execSync } from 'child_process';

const ARTIFACT_DIR = '/home/ubuntu/.gemini/antigravity/brain/5ebee223-a91a-4d93-9303-bad75ea1010d';
const HASH_DATA_PATH = `${ARTIFACT_DIR}/scratch/hash_statuses.json`;

async function runHashDataAudit() {
    console.log('🚀 Loading real data for user "hash"...');
    if (!fs.existsSync(HASH_DATA_PATH)) {
        throw new Error(`Data file not found at ${HASH_DATA_PATH}`);
    }
    const rawData = JSON.parse(fs.readFileSync(HASH_DATA_PATH, 'utf8'));
    const rawStatuses = Array.isArray(rawData) ? rawData : (rawData.data || rawData.statuses || []);
    console.log(`✅ Loaded ${rawStatuses.length} actual trip statuses for user "hash"`);

    try { execSync('pkill -9 -f chrome-hash-test'); } catch (e) {}

    const chrome = spawn('chromium-browser', [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--remote-debugging-port=9230',
        '--user-data-dir=/tmp/chrome-hash-test',
        'about:blank'
    ]);

    let tabs = null;
    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 200));
        try {
            const res = await fetch('http://127.0.0.1:9230/json');
            tabs = await res.json();
            const pageTab = tabs && tabs.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
            if (pageTab) {
                tabs = [pageTab];
                break;
            }
        } catch (e) {}
    }

    if (!tabs || !tabs[0] || !tabs[0].webSocketDebuggerUrl) {
        throw new Error('Chromium debug port connection failed.');
    }

    const ws = new WebSocket(tabs[0].webSocketDebuggerUrl);
    let msgId = 1;
    const callbacks = new Map();

    ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.id && callbacks.has(msg.id)) {
            callbacks.get(msg.id)(msg);
            callbacks.delete(msg.id);
        }
    };
    await new Promise(r => { ws.onopen = r; });

    const send = (method, params = {}) => new Promise((resolve) => {
        const id = msgId++;
        callbacks.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
    });

    const evalJs = async (expr) => {
        const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
        if (res?.result?.exceptionDetails) {
            throw new Error(`Eval exception: ${JSON.stringify(res.result.exceptionDetails)}`);
        }
        return res?.result?.result?.value;
    };

    const capture = async (name) => {
        const res = await send('Page.captureScreenshot', { format: 'png' });
        if (res?.result?.data) {
            fs.writeFileSync(`${ARTIFACT_DIR}/${name}`, Buffer.from(res.result.data, 'base64'));
            console.log(`📸 Screenshot saved: ${name}`);
        }
    };

    const setViewport = async (w, h, isMobile = false) => {
        await send('Emulation.setDeviceMetricsOverride', {
            width: w,
            height: h,
            deviceScaleFactor: 2,
            mobile: isMobile
        });
    };

    await send('Page.enable');
    await send('Runtime.enable');

    console.log('🌐 Step 1: Navigating to index.html and seeding IndexedDB with user "hash"...');
    await setViewport(1440, 900);
    await send('Page.navigate', { url: 'http://127.0.0.1:8000/index.html' });
    await new Promise(r => setTimeout(r, 1500));

    // Seed hash data + a second user for duel comparisons directly into IndexedDB
    const opponentStatuses = rawStatuses.slice(0, 350); // Real subset for opponent
    const seedResult = await evalJs(`
        (async () => {
            const { SessionDB } = await import('./js/cache/session.js');
            const { Storage, STORAGE_KEYS } = await import('./js/storage/storage.js');
            
            // Save main user 'hash'
            await SessionDB.save('hash', window.__RAW_HASH_STATUSES__, {
                displayName: 'Hash',
                avatar: 'https://traewelling.de/uploads/avatars/11102_1673629089.png',
                tripCount: window.__RAW_HASH_STATUSES__.length,
                timestamp: Date.now()
            });

            // Save opponent user 'alex_rail'
            await SessionDB.save('alex_rail', window.__OPPONENT_STATUSES__, {
                displayName: 'Alex Railfan',
                avatar: null,
                tripCount: window.__OPPONENT_STATUSES__.length,
                timestamp: Date.now()
            });

            // Update session metadata cache
            SessionDB.saveStoredMetadata([
                { username: 'hash', displayName: 'Hash', tripCount: window.__RAW_HASH_STATUSES__.length, timestamp: Date.now() },
                { username: 'alex_rail', displayName: 'Alex Railfan', tripCount: window.__OPPONENT_STATUSES__.length, timestamp: Date.now() }
            ]);

            return { success: true, count: window.__RAW_HASH_STATUSES__.length };
        })()
    `.replaceAll('window.__RAW_HASH_STATUSES__', JSON.stringify(rawStatuses))
     .replaceAll('window.__OPPONENT_STATUSES__', JSON.stringify(opponentStatuses)));

    console.log(`💾 IndexedDB Seeded:`, seedResult);

    // ==========================================
    // 1. Map Explorer Test Run (index.html?user=hash)
    // ==========================================
    console.log('\n🗺️ Step 2: Testing Map Explorer with user "hash"...');
    await send('Page.navigate', { url: 'http://127.0.0.1:8000/index.html?user=hash' });
    await new Promise(r => setTimeout(r, 4000));

    // Wait until trips are loaded in store or SessionDB
    await evalJs(`
        (async () => {
            const { store } = await import('./js/state/store.js');
            for (let i = 0; i < 40; i++) {
                const trips = store.get('fetchedTrips') || store.get('activeTrips');
                if (trips && trips.length > 0) return true;
                await new Promise(r => setTimeout(r, 200));
            }
            return false;
        })()
    `);

    const mapValidation = await evalJs(`
        (async () => {
            try {
                const { SessionDB } = await import('./js/cache/session.js');
                const { applyAllFilters, filterTripsByDateRange } = await import('./js/filters/filterManager.js');
                const { matchesTripSearch, getTripBusinessType, normalizeCategory } = await import('./js/data/processing.js');
                const { extractUniqueBuddiesFromTrip } = await import('./js/analytics/statistics.js');

                const session = await SessionDB.get('hash');
                const allTrips = session?.trips || [];
                const username = session?.username;

                // 1. Test Filter: Date Range (Year 2026)
                const dateFiltered = filterTripsByDateRange(allTrips, '2026-01-01', '2026-10-31');

                // 2. Test Filter: Business Type (Personal vs Commute vs Business)
                const personalTrips = allTrips.filter(t => getTripBusinessType(t) === 0);
                const commuteTrips = allTrips.filter(t => getTripBusinessType(t) === 2);
                const workTrips = allTrips.filter(t => getTripBusinessType(t) === 1);

                // 3. Test Filter: Search Query (Find trips mentioning "Berlin" or "RE")
                const searchBerlin = allTrips.filter(t => matchesTripSearch(t, 'Berlin'));
                const searchRE = allTrips.filter(t => matchesTripSearch(t, 'RE'));

                // 4. Test Filter: Travel Buddies
                const allBuddies = new Set();
                allTrips.forEach(t => {
                    extractUniqueBuddiesFromTrip(t, true).forEach(b => allBuddies.add(b));
                });
                const topBuddies = Array.from(allBuddies).slice(0, 5);

                // 5. Test Filter Combinations:
                // Combo A: 2026 Date Range + Personal + Search "Berlin"
                const comboA = applyAllFilters(allTrips, {
                    fromDate: '2026-01-01',
                    toDate: '2026-10-31',
                    business: { personal: true, commute: false, work: false },
                    searchQuery: 'Berlin',
                    filterLevel: 0
                });

                // Combo B: 2026 Date Range + Commute + Search "RE"
                const comboB = applyAllFilters(allTrips, {
                    fromDate: '2026-01-01',
                    toDate: '2026-10-31',
                    business: { personal: false, commute: true, work: false },
                    searchQuery: 'RE',
                    filterLevel: 0
                });

                return {
                    username,
                    totalTrips: allTrips.length,
                    dateFiltered2026: dateFiltered.length,
                    personalTrips: personalTrips.length,
                    commuteTrips: commuteTrips.length,
                    workTrips: workTrips.length,
                    searchBerlin: searchBerlin.length,
                    searchRE: searchRE.length,
                    uniqueBuddiesFound: allBuddies.size,
                    topBuddies,
                    comboA_Count: comboA.length,
                    comboB_Count: comboB.length
                };
            } catch (err) {
                return { error: err.message, stack: err.stack };
            }
        })()
    `);

    console.log('📊 Map Explorer Filters Audit Results:');
    console.log(JSON.stringify(mapValidation, null, 2));
    await capture('screenshot_map_hash.png');

    // ==========================================
    // 2. Trips Studio & Visual SQL Test Run (trips.html?user=hash)
    // ==========================================
    console.log('\n📊 Step 3: Testing Trips Studio & Visual SQL Workbench with user "hash"...');
    await send('Page.navigate', { url: 'http://127.0.0.1:8000/trips.html?user=hash' });
    await new Promise(r => setTimeout(r, 3000));

    const studioValidation = await evalJs(`
        (async () => {
            const { executeSqlQuery, flattenTripRecord } = await import('./js/trips/sqlEngine.js');
            const { computeTripDurationMinutes } = await import('./js/utils/time.js');

            const tableRows = Array.from(document.querySelectorAll('#tripsTableBody tr'));
            const durationTexts = tableRows.map(r => {
                const cells = r.querySelectorAll('td');
                // Duration is column 7 in the standard table
                return cells[6]?.textContent?.trim() || '';
            });

            const nonDashDurations = durationTexts.filter(d => d && d !== '—' && d !== '-');

            // Switch to Database Studio Mode
            const studioModeBtn = document.getElementById('modeStudioBtn');
            if (studioModeBtn) studioModeBtn.click();
            await new Promise(r => setTimeout(r, 400));

            // Switch to SQL Console Tab
            const sqlTabBtn = document.getElementById('studioTabSqlBtn');
            if (sqlTabBtn) sqlTabBtn.click();
            await new Promise(r => setTimeout(r, 400));

            // Run custom SQL query inspecting durations
            const testSql = "SELECT line, origin, destination, distance_km, duration_min FROM trips WHERE duration_min > 0 ORDER BY duration_min DESC LIMIT 20";
            const textarea = document.getElementById('sqlQueryInput');
            if (textarea) {
                textarea.value = testSql;
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
            }
            const runBtn = document.getElementById('runSqlQueryBtn');
            if (runBtn) runBtn.click();

            await new Promise(r => setTimeout(r, 800));

            const sqlResultRows = Array.from(document.querySelectorAll('#tripsTableBody tr.sql-raw-row')).length;

            return {
                totalVisibleRows: tableRows.length,
                nonDashDurationsCount: nonDashDurations.length,
                sampleDurations: durationTexts.slice(0, 5),
                sqlResultRows
            };
        })()
    `);

    console.log('⚡ Trips Studio Duration & SQL Audit Results:');
    console.log(JSON.stringify(studioValidation, null, 2));
    await capture('screenshot_studio_hash_duration.png');

    // ==========================================
    // 3. Wrapped & Redone Duel Mode Desktop (wrapped.html?user=hash)
    // ==========================================
    console.log('\n🏆 Step 4: Testing Wrapped & Redone Duel Mode (Desktop Viewport 1440x900)...');
    await setViewport(1440, 900);
    await send('Page.navigate', { url: 'http://127.0.0.1:8000/wrapped.html?user=hash' });
    await new Promise(r => setTimeout(r, 3000));

    const duelDesktop = await evalJs(`
        (async () => {
            const duelBtn = document.getElementById('duelToggleBtn');
            if (duelBtn) duelBtn.click();
            await new Promise(r => setTimeout(r, 600));

            const container = document.getElementById('duelContainer');
            const isActive = container && container.classList.contains('active');
            const playerA = document.getElementById('duelPlayerAName')?.textContent;
            const playerB = document.getElementById('duelOpponentSelect')?.value;
            const metricRows = document.querySelectorAll('#duelTableBody tr').length;

            // Get distance between duel toggle button and duel container
            const btnRect = duelBtn.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            const verticalGap = Math.round(containerRect.top - btnRect.bottom);

            return {
                isActive,
                playerA,
                playerB,
                metricRows,
                verticalGapPx: verticalGap
            };
        })()
    `);

    console.log('⚔️ Duel Mode Desktop Results:');
    console.log(JSON.stringify(duelDesktop, null, 2));
    await capture('screenshot_duel_desktop.png');

    // ==========================================
    // 4. Wrapped & Redone Duel Mode Mobile (390x844 - iPhone 14)
    // ==========================================
    console.log('\n📱 Step 5: Testing Redone Duel Mode (Mobile Viewport 390x844)...');
    await setViewport(390, 844, true);
    await new Promise(r => setTimeout(r, 800));

    const duelMobile = await evalJs(`
        (() => {
            const duelBtn = document.getElementById('duelToggleBtn');
            const container = document.getElementById('duelContainer');
            const btnRect = duelBtn.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            const vsHeader = document.querySelector('.duel-versus-header');
            const select = document.getElementById('duelOpponentSelect');

            const verticalGap = Math.round(containerRect.top - btnRect.bottom);
            const selectWidth = select?.getBoundingClientRect().width;
            const selectOverflow = select?.getBoundingClientRect().right > window.innerWidth;

            return {
                verticalGapBetweenButtonAndContainer: verticalGap,
                selectWidthPx: Math.round(selectWidth || 0),
                selectOverflowsScreen: selectOverflow,
                containerVisible: containerRect.height > 0 && containerRect.top < window.innerHeight
            };
        })()
    `);

    console.log('📱 Duel Mode Mobile Geometry Check:');
    console.log(JSON.stringify(duelMobile, null, 2));
    await capture('screenshot_duel_mobile.png');

    // Clean up
    await send('Page.disable');
    await send('Runtime.disable');
    ws.close();
    chrome.kill('SIGKILL');

    console.log('\n🎉 ALL REAL-DATA TESTS AND SCREENSHOT CAPTURES COMPLETED SUCCESSFULLY!');
}

runHashDataAudit().catch(err => {
    console.error('❌ Audit Failed:', err);
    process.exit(1);
});
