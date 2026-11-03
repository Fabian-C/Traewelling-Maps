import { spawn, execSync } from 'child_process';

async function runExternalJourneyIsolationTest() {
    console.log('====================================================');
    console.log('🚀 TESTING EXTERNAL JOURNEY ISOLATION IN ANIMATION');
    console.log('====================================================');

    try { execSync('pkill -9 -f chrome-test-ext-isolation'); } catch {}

    const chrome = spawn('chromium-browser', [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--remote-debugging-port=9232',
        '--user-data-dir=/tmp/chrome-test-ext-isolation',
        'about:blank'
    ]);

    let targetTab = null;
    for (let i = 0; i < 25; i++) {
        await new Promise(r => setTimeout(r, 200));
        try {
            const res = await fetch('http://127.0.0.1:9232/json');
            const tabs = await res.json();
            targetTab = tabs?.find(t => t.type === 'page' && t.webSocketDebuggerUrl) || null;
            if (targetTab) break;
        } catch {}
    }

    if (!targetTab) {
        chrome.kill('SIGKILL');
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
        const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
        if (res?.result?.exceptionDetails) {
            throw new Error('Eval exception: ' + JSON.stringify(res.result.exceptionDetails));
        }
        return res?.result?.result?.value;
    };

    try {
        console.log('1. Navigating to base page and pre-seeding SessionDB for user "hash"...');
        await send('Page.navigate', { url: 'http://127.0.0.1:8000/animation.html' });
        await new Promise(r => setTimeout(r, 2000));

        await evalJs(`
            (async () => {
                const { SessionDB } = await import('./js/cache/session.js');
                await SessionDB.clear();
                const hashTrips = [
                    {
                        id: 101,
                        createdAt: '2026-10-01T08:00:00Z',
                        user: { username: 'hash', displayName: 'Hash' },
                        checkin: {
                            lineName: 'S-Bahn S1',
                            number: 'S1',
                            distance: 25000,
                            duration: 35,
                            origin: { name: 'Wannsee' },
                            destination: { name: 'Friedrichstraße' },
                            polyline: [[13.17, 52.42], [13.38, 52.52]]
                        }
                    },
                    {
                        id: 102,
                        createdAt: '2026-10-02T09:00:00Z',
                        user: { username: 'hash', displayName: 'Hash' },
                        checkin: {
                            lineName: 'RE 1',
                            number: 'RE1',
                            distance: 40000,
                            duration: 40,
                            origin: { name: 'Berlin Hbf' },
                            destination: { name: 'Frankfurt (Oder)' },
                            polyline: [[13.36, 52.52], [14.55, 52.34]]
                        }
                    }
                ];
                await SessionDB.save('hash', hashTrips);
            })()
        `);

        console.log('2. Navigating to animation.html?user=hash&trip=9501851 (where 9501851 belongs to @alice)...');
        // Let's enable request interception or mock the response for /api/v1/status/9501851 so it returns alice's journey
        await send('Fetch.enable', {
            patterns: [{ urlPattern: '*traewelling.de/api/v1/status/9501851*', requestStage: 'Request' }]
        });

        // Setup interception handler
        ws.onmessage = (e) => {
            const msg = JSON.parse(e.data);
            if (msg.method === 'Fetch.requestPaused') {
                const requestId = msg.params.requestId;
                const mockBody = JSON.stringify({
                    data: {
                        id: 9501851,
                        createdAt: '2026-10-31T14:00:00Z',
                        body: 'Riding Alice ICE express',
                        user: {
                            id: 42,
                            username: 'alice',
                            displayName: 'Alice Explorer'
                        },
                        checkin: {
                            category: 'nationalExpress',
                            lineName: 'ICE 999',
                            number: 'ICE 999',
                            distance: 350000,
                            duration: 120,
                            origin: { name: 'Hamburg Hbf' },
                            destination: { name: 'München Hbf' },
                            polyline: [[9.99, 53.55], [11.58, 48.14]]
                        }
                    }
                });
                send('Fetch.fulfillRequest', {
                    requestId,
                    responseCode: 200,
                    responseHeaders: [
                        { name: 'Content-Type', value: 'application/json' },
                        { name: 'Access-Control-Allow-Origin', value: '*' }
                    ],
                    body: Buffer.from(mockBody).toString('base64')
                });
                return;
            }
            if (msg.id && callbacks.has(msg.id)) {
                callbacks.get(msg.id)(msg);
                callbacks.delete(msg.id);
            }
        };

        await send('Page.navigate', { url: 'http://127.0.0.1:8000/animation.html?user=hash&trip=9501851' });
        await new Promise(r => setTimeout(r, 4000));

        const state = await evalJs(`
            (async () => {
                const tripSelect = document.getElementById('tripSelect');
                const userSelect = document.getElementById('userSelect');
                const selectedTripOpt = tripSelect ? tripSelect.options[tripSelect.selectedIndex]?.text : null;
                const selectedUserOpt = userSelect ? userSelect.options[userSelect.selectedIndex]?.text : null;
                const sidebarRoute = document.getElementById('sidebarRoute')?.textContent;
                const sidebarLine = document.getElementById('sidebarLine')?.textContent;
                const sidebarNote = document.getElementById('sidebarNote')?.textContent;

                const { SessionDB } = await import('./js/cache/session.js');
                const hashSession = await SessionDB.get('hash');
                const hashStatuses = await SessionDB.getStatusesByUser('hash');
                const aliceStatuses = await SessionDB.getStatusesByUser('alice');
                const polylines = await SessionDB.getPolylinesBatch([9501851]);

                return {
                    tripSelectValue: tripSelect?.value,
                    selectedOptionText: selectedTripOpt,
                    userSelectValue: userSelect?.value,
                    selectedUserText: selectedUserOpt,
                    sidebarLine,
                    sidebarRoute,
                    sidebarNote,
                    hashSessionTripsCount: hashSession?.trips?.length || 0,
                    hashSessionTripIds: (hashSession?.trips || []).map(t => t.id),
                    hashStatusesCount: hashStatuses.length,
                    hashStatusIds: hashStatuses.map(s => s.id),
                    aliceStatusesCount: aliceStatuses.length,
                    has9501851Polyline: !!polylines[9501851]
                };
            })()
        `);

        console.log('Evaluated isolation state:', state);

        // Verification 1: The animation player loaded Alice's trip and displays Alice in the Account field!
        if (state.tripSelectValue !== '9501851') {
            throw new Error(`Expected tripSelectValue to be '9501851', got '${state.tripSelectValue}'`);
        }
        if (!state.selectedOptionText.includes('@alice')) {
            throw new Error(`Expected option text to include attribution '@alice', got '${state.selectedOptionText}'`);
        }
        if (state.userSelectValue !== 'alice') {
            throw new Error(`CRITICAL: Expected userSelectValue to be 'alice', got '${state.userSelectValue}' (showing wrong user in account field!)`);
        }
        if (!state.selectedUserText.includes('@alice')) {
            throw new Error(`Expected account field text to include '@alice', got '${state.selectedUserText}'`);
        }
        if (state.sidebarLine !== 'ICE 999') {
            throw new Error(`Expected sidebar line 'ICE 999', got '${state.sidebarLine}'`);
        }
        if (state.sidebarRoute !== 'Hamburg Hbf → München Hbf') {
            throw new Error(`Expected sidebar route 'Hamburg Hbf → München Hbf', got '${state.sidebarRoute}'`);
        }
        if (!state.sidebarNote.includes('@alice')) {
            throw new Error(`Expected sidebar note attribution '@alice', got '${state.sidebarNote}'`);
        }

        // Verification 2: Active user 'hash' catalog was NOT contaminated!
        if (state.hashSessionTripIds.includes(9501851)) {
            throw new Error(`CRITICAL FAILURE: Alice's trip 9501851 was appended to hash's session trips! ${JSON.stringify(state.hashSessionTripIds)}`);
        }
        if (state.hashStatusIds.includes(9501851)) {
            throw new Error(`CRITICAL FAILURE: Alice's trip 9501851 was inserted into hash's statuses store! ${JSON.stringify(state.hashStatusIds)}`);
        }
        if (state.hashSessionTripsCount !== 2) {
            throw new Error(`Expected hashSessionTripsCount to remain 2, got ${state.hashSessionTripsCount}`);
        }
        if (state.hashStatusesCount !== 2) {
            throw new Error(`Expected hashStatusesCount to remain 2, got ${state.hashStatusesCount}`);
        }

        // Verification 3: Polyline was cached for smooth playback
        if (!state.has9501851Polyline) {
            throw new Error(`Expected polyline for 9501851 to be cached in SessionDB polylines store.`);
        }

        console.log('3. Switching tripSelect to Hash own trip (101)...');
        await evalJs(`
            (() => {
                const tripSelect = document.getElementById('tripSelect');
                tripSelect.value = '101';
                tripSelect.dispatchEvent(new Event('change'));
            })()
        `);
        await new Promise(r => setTimeout(r, 500));

        const stateAfterOwnTrip = await evalJs(`
            (() => {
                const tripSelect = document.getElementById('tripSelect');
                const userSelect = document.getElementById('userSelect');
                return {
                    tripSelectValue: tripSelect?.value,
                    userSelectValue: userSelect?.value,
                    selectedUserText: userSelect?.options[userSelect.selectedIndex]?.text
                };
            })()
        `);
        console.log('State after selecting own trip:', stateAfterOwnTrip);

        if (stateAfterOwnTrip.tripSelectValue !== '101') {
            throw new Error(`Expected tripSelectValue to be '101', got '${stateAfterOwnTrip.tripSelectValue}'`);
        }
        if (stateAfterOwnTrip.userSelectValue !== 'hash') {
            throw new Error(`Expected Account field to switch to 'hash' when playing own trip, got '${stateAfterOwnTrip.userSelectValue}'`);
        }

        console.log('4. Switching tripSelect back to Alice external trip (9501851)...');
        await evalJs(`
            (() => {
                const tripSelect = document.getElementById('tripSelect');
                tripSelect.value = '9501851';
                tripSelect.dispatchEvent(new Event('change'));
            })()
        `);
        await new Promise(r => setTimeout(r, 500));

        const stateAfterBackToExternal = await evalJs(`
            (() => {
                const tripSelect = document.getElementById('tripSelect');
                const userSelect = document.getElementById('userSelect');
                return {
                    tripSelectValue: tripSelect?.value,
                    userSelectValue: userSelect?.value,
                    selectedUserText: userSelect?.options[userSelect.selectedIndex]?.text
                };
            })()
        `);
        console.log('State after selecting external trip again:', stateAfterBackToExternal);

        if (stateAfterBackToExternal.userSelectValue !== 'alice') {
            throw new Error(`Expected Account field to switch back to 'alice' when playing Alice trip, got '${stateAfterBackToExternal.userSelectValue}'`);
        }

        console.log('====================================================');
        console.log('✅ PASS: External journey isolated successfully!');
        console.log('   - Replayed guest trip without contaminating active user catalog');
        console.log('   - SessionDB records for "hash" remain 100% untainted');
        console.log('   - Polyline cached for smooth playback');
        console.log('====================================================');
    } finally {
        ws.close();
        chrome.kill('SIGKILL');
    }
}

runExternalJourneyIsolationTest().catch(e => {
    console.error('Test failed:', e);
    process.exit(1);
});
