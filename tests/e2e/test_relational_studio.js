import fs from 'fs';
import { spawn, execSync } from 'child_process';
import path from 'path';

const ARTIFACT_DIR = process.env.TEST_ARTIFACT_DIR || '/home/ubuntu/.gemini/antigravity/brain/5ebee223-a91a-4d93-9303-bad75ea1010d';
if (!fs.existsSync(ARTIFACT_DIR)) {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
}

async function runRelationalStudioTests() {
    console.log('====================================================');
    console.log('🚀 TESTING RELATIONAL SQL STUDIO & SCHEMA GUIDE');
    console.log('====================================================');

    try { execSync('pkill -9 -f chrome-test-relational'); } catch (e) {}

    const chrome = spawn('chromium-browser', [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--remote-debugging-port=9228',
        '--user-data-dir=/tmp/chrome-test-relational',
        'about:blank'
    ]);

    let targetTab = null;
    for (let i = 0; i < 25; i++) {
        await new Promise(r => setTimeout(r, 200));
        try {
            const res = await fetch('http://127.0.0.1:9228/json');
            const tabs = await res.json();
            targetTab = tabs?.find(t => t.type === 'page' && t.webSocketDebuggerUrl) || null;
            if (targetTab) break;
        } catch (e) {}
    }

    if (!targetTab) {
        throw new Error('Chromium debug port connection failed.');
    }

    const ws = new WebSocket(targetTab.webSocketDebuggerUrl);
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

    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: 'http://127.0.0.1:8000/trips.html?preview=resu' });

    // Poll until ready
    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 200));
        const ready = await evalJs(`typeof window.runSqlQuery === 'function' && Boolean(document.getElementById('modeStudioBtn')) && document.querySelectorAll('#tripsTableBody tr').length > 0`);
        if (ready) break;
    }

    // Switch to Studio mode and SQL Console tab
    await evalJs(`document.getElementById('modeStudioBtn').click()`);
    await new Promise(r => setTimeout(r, 300));
    await evalJs(`document.getElementById('studioTabSqlBtn').click()`);
    await new Promise(r => setTimeout(r, 300));

    // 1. Toggle Database Schema Guide Drawer
    console.log('1. Testing Schema Guide Drawer open...');
    await evalJs(`document.getElementById('sqlSchemaToggleBtn').click()`);
    await new Promise(r => setTimeout(r, 400));

    const drawerState = await evalJs(`(() => {
        const drawer = document.getElementById('sqlSchemaDrawer');
        const cards = document.querySelectorAll('#sqlSchemaContentPane .sql-schema-col-card');
        return {
            isOpen: drawer && drawer.style.display !== 'none',
            cardCount: cards.length,
            title: document.querySelector('.sql-schema-drawer-title')?.textContent.trim()
        };
    })()`);
    console.log('Drawer opened state:', drawerState);
    await capture('screenshot_studio_schema_guide.png');

    // 2. Switch to Stations tab in Schema Guide
    console.log('2. Switching Schema Guide to stations table...');
    await evalJs(`document.querySelector('.sql-schema-tab-btn[data-table="stations"]').click()`);
    await new Promise(r => setTimeout(r, 300));

    const stationsTabState = await evalJs(`(() => {
        const desc = document.querySelector('.sql-schema-table-desc')?.textContent;
        const exQuery = document.querySelector('.sql-schema-example-query')?.textContent;
        return { desc, exQuery };
    })()`);
    console.log('Stations tab in Schema Guide:', stationsTabState);

    // 3. Click Run Example on Stations
    console.log('3. Running stations example query...');
    await evalJs(`document.getElementById('schemaRunExampleBtn').click()`);
    await new Promise(r => setTimeout(r, 500));

    const stationsQueryResult = await evalJs(`(() => {
        const targetBadge = document.querySelector('.sql-editor-target code')?.textContent;
        const benchmark = document.getElementById('sqlBenchmarkBadge')?.textContent;
        const headers = Array.from(document.querySelectorAll('.trips-table thead th.sql-raw-th .sql-th-name')).map(el => el.textContent);
        const rowCount = document.querySelectorAll('#tripsTableBody tr.sql-raw-row').length;
        const firstRowCells = Array.from(document.querySelectorAll('#tripsTableBody tr.sql-raw-row:first-child td')).map(el => el.textContent.trim());
        return { targetBadge, benchmark, headers, rowCount, firstRowCells };
    })()`);
    console.log('Stations query execution result:', stationsQueryResult);
    await capture('screenshot_studio_query_stations.png');

    // 4. Query Statuses Table
    console.log('4. Querying statuses table...');
    await evalJs(`(() => {
        const input = document.getElementById('sqlQueryInput');
        input.value = "SELECT id, trip_id, departure_time, departure_delay, distance_km FROM statuses ORDER BY departure_time DESC";
        window.runSqlQuery(input.value);
    })()`);
    await new Promise(r => setTimeout(r, 500));

    const statusesQueryResult = await evalJs(`(() => {
        const targetBadge = document.querySelector('.sql-editor-target code')?.textContent;
        const benchmark = document.getElementById('sqlBenchmarkBadge')?.textContent;
        const headers = Array.from(document.querySelectorAll('.trips-table thead th.sql-raw-th .sql-th-name')).map(el => el.textContent);
        const rowCount = document.querySelectorAll('#tripsTableBody tr.sql-raw-row').length;
        return { targetBadge, benchmark, headers, rowCount };
    })()`);
    console.log('Statuses query execution result:', statusesQueryResult);
    await capture('screenshot_studio_query_statuses.png');

    // Close chrome
    try {
        ws.close();
        chrome.kill();
    } catch (e) {}

    console.log('====================================================');
    console.log('🏁 RELATIONAL STUDIO TESTS COMPLETE & SCREENSHOTS SAVED');
    console.log('====================================================');
}

runRelationalStudioTests().catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
