import fs from 'fs';
import { spawn, execSync } from 'child_process';

import path from 'path';

const ARTIFACT_DIR = process.env.TEST_ARTIFACT_DIR || path.resolve(process.cwd(), 'tests/e2e/screenshots');
if (!fs.existsSync(ARTIFACT_DIR)) {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
}

async function runStressTestSuite() {
    console.log('====================================================');
    console.log('🚀 STARTING COMPREHENSIVE E2E STRESS & EDGE-CASE TEST');
    console.log('====================================================');

    try { execSync('pkill -9 -f chrome-test-cdp'); } catch (e) {}

    const chrome = spawn('chromium-browser', [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--remote-debugging-port=9227',
        '--user-data-dir=/tmp/chrome-test-cdp',
        'about:blank'
    ]);

    let tabs = null;
    for (let i = 0; i < 25; i++) {
        await new Promise(r => setTimeout(r, 200));
        try {
            const res = await fetch('http://127.0.0.1:9227/json');
            tabs = await res.json();
            if (tabs && tabs.length > 0 && tabs[0].webSocketDebuggerUrl) break;
        } catch (e) {}
    }

    if (!tabs || !tabs[0].webSocketDebuggerUrl) {
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
    await new Promise(r => ws.onopen = r);

    const send = (method, params = {}) => new Promise((resolve) => {
        const id = msgId++;
        callbacks.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
    });

    const evalJs = async (expr) => {
        const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
        if (res?.result?.exceptionDetails) {
            throw new Error(`Eval exception: ${JSON.stringify(res.result.exceptionDetails)}`);
        }
        return res?.result?.result?.value;
    };

    const capture = async (name) => {
        const res = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(`${ARTIFACT_DIR}/${name}`, Buffer.from(res.result.data, 'base64'));
        console.log(`📸 Screenshot saved: ${name}`);
    };

    await send('Page.enable');
    await send('Runtime.enable');

    const results = [];

    // =========================================================================
    // TEST 1: SQL Studio Malformed Queries, Injections & Syntax Resilience
    // =========================================================================
    console.log('\n--- TEST 1: SQL Studio Edge-Case & Error Recovery ---');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: 'http://127.0.0.1:8000/trips.html?preview=resu' });

    // Poll until ready
    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 200));
        const ready = await evalJs(`typeof window.runSqlQuery === 'function' && Boolean(document.getElementById('modeStudioBtn')) && document.querySelectorAll('#tripsTableBody tr').length > 0`);
        if (ready) break;
    }

    // Switch to Studio mode
    await evalJs(`document.getElementById('modeStudioBtn').click()`);
    await new Promise(r => setTimeout(r, 300));

    // A. Malformed: Unclosed String
    console.log('1A. Testing unclosed string literal...');
    await evalJs(`(() => {
        const input = document.getElementById('sqlQueryInput');
        input.value = "SELECT * FROM trips WHERE category = 'highspeed";
        window.runSqlQuery(input.value);
    })()`);
    await new Promise(r => setTimeout(r, 200));

    const err1 = await evalJs(`(() => {
        const countText = document.getElementById('resultsCountText')?.textContent;
        const bodyText = document.querySelector('#tripsTableBody')?.textContent;
        return { countText, hasErrorBadge: Boolean(document.getElementById('sqlBenchmarkBadge')?.textContent.includes('❌')), hasResetBtn: Boolean(document.getElementById('emptyTableResetBtn')) };
    })()`);
    console.log('Unclosed quote handled gracefully:', err1);
    results.push({ name: 'SQL Unclosed String', passed: err1.hasErrorBadge && err1.hasResetBtn });

    // B. Error recovery: Click Reset to Default Query button
    console.log('1B. Testing error recovery button...');
    await evalJs(`(() => {
        const resetBtn = document.getElementById('emptyTableResetBtn');
        if (resetBtn) resetBtn.click();
    })()`);
    await new Promise(r => setTimeout(r, 300));

    const recovered = await evalJs(`(() => {
        return {
            rowCount: document.querySelectorAll('#tripsTableBody tr.trip-row').length,
            badge: document.getElementById('sqlBenchmarkBadge')?.textContent
        };
    })()`);
    console.log('Recovered from syntax error:', recovered);
    results.push({ name: 'SQL Error Recovery via Reset Button', passed: recovered.rowCount > 0 && !recovered.badge.includes('❌') });

    // C. Non-existent table
    console.log('1C. Testing target table validation...');
    await evalJs(`(() => {
        const input = document.getElementById('sqlQueryInput');
        input.value = "SELECT * FROM secret_database_table";
        window.runSqlQuery(input.value);
    })()`);
    await new Promise(r => setTimeout(r, 200));
    const tableErr = await evalJs(`document.getElementById('sqlBenchmarkBadge')?.textContent`);
    console.log('Table validation error message:', tableErr);
    results.push({ name: 'Invalid Table Guard', passed: tableErr.includes("Target table must be 'trips'") });

    // D. Trailing comments & semicolon
    console.log('1D. Testing semicolon and trailing comments...');
    await evalJs(`(() => {
        const input = document.getElementById('sqlQueryInput');
        input.value = "SELECT line, origin, destination, distance_km FROM trips WHERE distance_km > 0; -- test comment";
        window.runSqlQuery(input.value);
    })()`);
    await new Promise(r => setTimeout(r, 300));
    const commentRows = await evalJs(`document.querySelectorAll('#tripsTableBody tr.trip-row').length`);
    console.log('Semicolon & comment query rows:', commentRows);
    results.push({ name: 'Semicolon & Comments Handling', passed: commentRows > 0 });

    // =========================================================================
    // TEST 2: Complex Buddy Filtering & Recipes
    // =========================================================================
    console.log('\n--- TEST 2: Complex Buddy Filtering & Predicates ---');
    
    // Group travel query with buddy_count >= 1
    await evalJs(`(() => {
        const input = document.getElementById('sqlQueryInput');
        input.value = "SELECT line, origin, destination, buddies, buddy_count, departure FROM trips WHERE buddy_count >= 1 ORDER BY buddy_count DESC";
        window.runSqlQuery(input.value);
    })()`);
    await new Promise(r => setTimeout(r, 300));
    const groupResult = await evalJs(`(() => {
        const rows = Array.from(document.querySelectorAll('#tripsTableBody tr.trip-row')).map(r => ({
            id: r.dataset.tripId,
            line: r.querySelector('td[data-label="Line"]')?.textContent.trim(),
            buddies: r.querySelector('td[data-label="Companions"]')?.textContent.trim()
        }));
        return { count: rows.length, rows };
    })()`);
    console.log('Group trips (buddy_count >= 1):', groupResult);
    results.push({ name: 'Group Travel Predicate (buddy_count >= 1)', passed: groupResult.count === 2 });

    // Solo trips query (buddy_count = 0)
    await evalJs(`(() => {
        const input = document.getElementById('sqlQueryInput');
        input.value = "SELECT line, origin, destination, distance_km, departure FROM trips WHERE buddy_count = 0";
        window.runSqlQuery(input.value);
    })()`);
    await new Promise(r => setTimeout(r, 300));
    const soloResult = await evalJs(`document.querySelectorAll('#tripsTableBody tr.trip-row').length`);
    console.log('Solo trips count (buddy_count = 0):', soloResult);
    results.push({ name: 'Solo Trips Predicate (buddy_count = 0)', passed: soloResult === 1 });

    // =========================================================================
    // TEST 3: State Invariants: Row Expansion + In-Place Sort + View Toggling
    // =========================================================================
    console.log('\n--- TEST 3: State Invariants: Row Expansion, Sorting & Card View ---');
    // Run full trips query
    await evalJs(`(() => {
        const input = document.getElementById('sqlQueryInput');
        input.value = "SELECT * FROM trips";
        window.runSqlQuery(input.value);
    })()`);
    await new Promise(r => setTimeout(r, 300));

    // Expand row 1
    console.log('Expanding row 1...');
    const expandStep1 = await evalJs(`(() => {
        const row = document.querySelectorAll('#tripsTableBody tr.trip-row')[0];
        row.querySelector('.expand-trip-btn').click();
        const expandRow = document.getElementById('expandRow-' + row.dataset.tripId);
        return {
            tripId: row.dataset.tripId,
            isOpen: expandRow && expandRow.style.display !== 'none'
        };
    })()`);
    console.log('Row 1 expanded:', expandStep1);

    // Sort by duration descending while row 1 is open
    console.log('Sorting by duration descending in-place...');
    await evalJs(`(() => {
        const durHeader = document.querySelector('th[data-sort="dur"]');
        durHeader.click();
    })()`);
    await new Promise(r => setTimeout(r, 300));

    const afterSort = await evalJs(`(() => {
        const rows = document.querySelectorAll('#tripsTableBody tr.trip-row');
        const openRows = document.querySelectorAll('#tripsTableBody tr.trip-expand-row:not([style*="display: none"])');
        return {
            totalRows: rows.length,
            openCount: openRows.length
        };
    })()`);
    console.log('After in-place sort state:', afterSort);
    results.push({ name: 'Sort Invariant Clean Rerender', passed: afterSort.totalRows === 3 && afterSort.openCount === 0 });

    // Expand the new top sorted row
    await evalJs(`(() => {
        const newFirstRow = document.querySelectorAll('#tripsTableBody tr.trip-row')[0];
        newFirstRow.querySelector('.expand-trip-btn').click();
    })()`);
    await new Promise(r => setTimeout(r, 200));

    const reExpanded = await evalJs(`(() => {
        const newFirstRow = document.querySelectorAll('#tripsTableBody tr.trip-row')[0];
        const expandRow = document.getElementById('expandRow-' + newFirstRow.dataset.tripId);
        return {
            isOpen: expandRow && expandRow.style.display !== 'none',
            hasDetailsGrid: Boolean(expandRow.querySelector('.expand-details-grid'))
        };
    })()`);
    console.log('New top row re-expanded successfully:', reExpanded);
    results.push({ name: 'Re-expansion after sort', passed: reExpanded.isOpen && reExpanded.hasDetailsGrid });

    // Toggle Cards View
    console.log('Switching to Cards View mode...');
    await evalJs(`document.getElementById('viewCardsBtn').click()`);
    await new Promise(r => setTimeout(r, 300));
    const cardViewCheck = await evalJs(`(() => {
        const container = document.getElementById('cardViewContainer');
        const cards = container.querySelectorAll('.trip-card');
        return {
            isVisible: container.style.display !== 'none',
            cardCount: cards.length
        };
    })()`);
    console.log('Cards view check:', cardViewCheck);
    results.push({ name: 'Cards View Switch Invariant', passed: cardViewCheck.isVisible && cardViewCheck.cardCount === 3 });

    // Switch back to Table View
    await evalJs(`document.getElementById('viewTableBtn').click()`);
    await new Promise(r => setTimeout(r, 200));

    // =========================================================================
    // TEST 4: Deep-Linking End-to-End (?user=resu&trip=325374)
    // =========================================================================
    console.log('\n--- TEST 4: Deep-Linking into Map Explorer ---');
    console.log('Navigating to http://127.0.0.1:8000/index.html?user=resu&trip=325374 ...');
    await send('Page.navigate', { url: 'http://127.0.0.1:8000/index.html?user=resu&trip=325374' });

    // Wait up to 5 seconds for deep-link to focus and open map popup
    let popupOpened = false;
    let popupData = null;
    for (let i = 0; i < 35; i++) {
        await new Promise(r => setTimeout(r, 250));
        const res = await evalJs(`(() => {
            const popup = document.querySelector('.mapboxgl-popup');
            const setupHidden = document.getElementById('setupScreen')?.classList.contains('hidden');
            if (popup) {
                return {
                    isOpen: true,
                    setupHidden,
                    title: popup.querySelector('.popup-line')?.textContent || popup.querySelector('h3, h4')?.textContent || popup.textContent,
                    text: popup.textContent
                };
            }
            return { isOpen: false, setupHidden };
        })()`);
        if (res && res.isOpen) {
            popupOpened = true;
            popupData = res;
            console.log(`Map deep-link popup opened after ${i + 1} polls!`);
            break;
        }
    }
    console.log('Deep-link map resolution:', popupData);
    results.push({ name: 'Direct Map Deep-Linking (?trip=325374)', passed: popupOpened && popupData.setupHidden });
    await capture('screenshot_deeplink_map_popup.png');

    // =========================================================================
    // TEST 5: Extreme Mobile Viewports (iPhone SE 320px & Landscape 844x390)
    // =========================================================================
    console.log('\n--- TEST 5: Extreme Mobile Viewport Stress Tests ---');
    
    // A. 320px Portrait (iPhone SE 1st Gen)
    console.log('Testing 320x568 portrait viewport...');
    await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 568, deviceScaleFactor: 2, mobile: true });
    await send('Page.navigate', { url: 'http://127.0.0.1:8000/trips.html?preview=resu' });
    await new Promise(r => setTimeout(r, 600));

    const seCheck = await evalJs(`(() => {
        const bodyWidth = document.body.scrollWidth;
        const windowWidth = window.innerWidth;
        const tableContainer = document.querySelector('.trips-table-container, .table-responsive, .table-wrapper');
        return {
            windowWidth,
            bodyWidth,
            noHorizontalOverflow: bodyWidth <= windowWidth + 1, // allow 1px rounding
            tableScrollable: tableContainer ? tableContainer.scrollWidth > tableContainer.clientWidth : true
        };
    })()`);
    console.log('320px portrait layout integrity:', seCheck);
    results.push({ name: '320px Mobile Portrait No Body Overflow', passed: seCheck.noHorizontalOverflow });
    await capture('screenshot_extreme_320px_portrait.png');

    // B. Mobile Landscape 844x390
    console.log('Testing 844x390 mobile landscape viewport & modal scrolling...');
    await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
    await new Promise(r => setTimeout(r, 300));

    // Open inspector modal on 844x390
    await evalJs(`(() => {
        const btn = document.querySelector('.inspect-trip-btn');
        if (btn) btn.click();
    })()`);
    await new Promise(r => setTimeout(r, 400));

    const landscapeModalCheck = await evalJs(`(() => {
        const modal = document.getElementById('tripDetailModal');
        const rect = modal ? modal.getBoundingClientRect() : null;
        const closeBtn = document.getElementById('closeModalBtn');
        const closeRect = closeBtn ? closeBtn.getBoundingClientRect() : null;
        return {
            isOpen: modal?.open,
            modalHeight: rect?.height,
            viewportHeight: window.innerHeight,
            fitsInViewport: rect ? rect.bottom <= window.innerHeight + 1 : false,
            isScrollable: modal ? modal.scrollHeight > modal.clientHeight : false,
            closeVisible: closeRect ? closeRect.top >= 0 && closeRect.bottom <= window.innerHeight : false
        };
    })()`);
    console.log('844x390 landscape modal check:', landscapeModalCheck);
    results.push({ name: '844x390 Landscape Modal Dynamic Max-Height & Scroll', passed: landscapeModalCheck.isOpen && landscapeModalCheck.fitsInViewport });
    await capture('screenshot_landscape_modal_fit.png');

    // Close modal
    await evalJs(`document.getElementById('closeModalBtn')?.click()`);
    await new Promise(r => setTimeout(r, 200));

    // =========================================================================
    // TEST 6: Documentation Page & Live Copy Feedback
    // =========================================================================
    console.log('\n--- TEST 6: Documentation Page & Interactive Copy Feedback ---');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: 'http://127.0.0.1:8000/docs.html' });
    await new Promise(r => setTimeout(r, 1200));
    await send('Page.bringToFront');
    await send('Browser.grantPermissions', {
        permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
        origin: 'http://127.0.0.1:8000'
    });

    await evalJs(`document.querySelector('.copy-btn, .copy-sql-btn')?.click()`);
    await new Promise(r => setTimeout(r, 250));

    const copyCheck = await evalJs(`(() => {
        const btn = document.querySelector('.copy-btn, .copy-sql-btn');
        const toast = document.getElementById('docsToast') || document.getElementById('toastAnnouncer');
        return {
            btnText: btn ? btn.textContent.trim() : '',
            hasCopiedClass: btn ? btn.classList.contains('copied') : false,
            toastShown: toast ? toast.classList.contains('show') : false,
            toastMsg: toast ? toast.textContent.trim() : ''
        };
    })()`);
    console.log('Copy button live feedback check:', copyCheck);
    results.push({ name: 'Docs Copy Button Toast & Feedback', passed: copyCheck.hasCopiedClass && copyCheck.toastShown });

    // =========================================================================
    // FINAL SUMMARY
    // =========================================================================
    console.log('\n====================================================');
    console.log('🏁 FINAL E2E STRESS TEST RESULTS');
    console.log('====================================================');
    let allPassed = true;
    for (const res of results) {
        const mark = res.passed ? '✅ PASS' : '❌ FAIL';
        console.log(`${mark}: ${res.name}`);
        if (!res.passed) allPassed = false;
    }
    console.log('====================================================');

    ws.close();
    chrome.kill('SIGTERM');

    if (!allPassed) {
        throw new Error('One or more end-to-end stress tests failed.');
    }
    console.log('🎉 ALL TRICKY SCENARIOS & STRESS TESTS PASSED!');
}

runStressTestSuite().catch(err => {
    console.error('Fatal stress test suite error:', err);
    process.exit(1);
});
