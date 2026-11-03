import { spawn, execSync } from 'child_process';

async function runWrappedRehydrationTest() {
    console.log('====================================================');
    console.log('🚀 TESTING RAIL WRAPPED INDEXEDDB REHYDRATION & UI');
    console.log('====================================================');

    try { execSync('pkill -9 -f chrome-test-wrapped'); } catch {}

    const dataDir = `/tmp/chrome-test-wrapped-${Date.now()}`;
    const chrome = spawn('chromium-browser', [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-application-cache',
        '--disable-cache',
        '--remote-debugging-port=9233',
        `--user-data-dir=${dataDir}`,
        'about:blank'
    ]);

    let targetTab = null;
    for (let i = 0; i < 25; i++) {
        await new Promise(r => setTimeout(r, 200));
        try {
            const res = await fetch('http://127.0.0.1:9233/json');
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
        if (msg.method === 'Runtime.consoleAPICalled') {
            console.log('[Browser Console]', msg.params.type, msg.params.args.map(a => a.value || a.description).join(' '));
        }
        if (msg.method === 'Runtime.exceptionThrown') {
            console.error('[Browser Exception]', msg.params.exceptionDetails);
        }
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

    const navigateTo = (url) => new Promise((resolve) => {
        const handler = (e) => {
            const msg = JSON.parse(e.data);
            if (msg.method === 'Page.loadEventFired') {
                ws.removeEventListener('message', handler);
                resolve();
            }
        };
        ws.addEventListener('message', handler);
        send('Page.navigate', { url });
    });

    await send('Runtime.enable');
    await send('Page.enable');
    await send('Network.enable');
    await send('Network.setCacheDisabled', { cacheDisabled: true });

    const evalJs = async (expr) => {
        const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
        if (res?.result?.exceptionDetails) {
            throw new Error('Eval exception: ' + JSON.stringify(res.result.exceptionDetails));
        }
        return res?.result?.result?.value;
    };

    try {
        console.log('1. Seeding SessionDB with relational datasets for Alice and Bob...');
        await navigateTo('http://127.0.0.1:8000/wrapped.html');
        await new Promise(r => setTimeout(r, 1000));

        const seedResult = await evalJs(`
            (async () => {
                const { SessionDB } = await import('./js/cache/session.js');
                await SessionDB.clear();

                const aliceTrips = [
                    {
                        id: 201,
                        createdAt: '2026-05-10T10:00:00Z',
                        user: { username: 'alice', displayName: 'Alice' },
                        body: 'Trip to Berlin with @bob',
                        bodyMentions: [{ id: 2, username: 'bob' }],
                        train: {
                            category: 'highspeed',
                            lineName: 'ICE 700',
                            totalDistance: 289000,
                            departureDelay: 0,
                            arrivalDelay: 60,
                            origin: { name: 'Hamburg Hbf' },
                            destination: { name: 'Berlin Hbf' },
                            departureReal: '2026-05-10T10:00:00Z',
                            arrivalReal: '2026-05-10T11:45:00Z'
                        }
                    },
                    {
                        id: 202,
                        createdAt: '2026-06-15T14:30:00Z',
                        user: { username: 'alice', displayName: 'Alice' },
                        train: {
                            category: 'regional',
                            lineName: 'RE 1',
                            totalDistance: 54000,
                            departureDelay: 120,
                            arrivalDelay: 180,
                            origin: { name: 'Berlin Hbf' },
                            destination: { name: 'Potsdam Hbf' },
                            departureReal: '2026-06-15T14:30:00Z',
                            arrivalReal: '2026-06-15T14:55:00Z'
                        }
                    },
                    {
                        id: 203,
                        createdAt: '2025-11-20T09:00:00Z',
                        user: { username: 'alice', displayName: 'Alice' },
                        train: {
                            category: 'suburban',
                            lineName: 'S 5',
                            totalDistance: 18000,
                            departureDelay: 0,
                            arrivalDelay: 0,
                            origin: { name: 'Potsdam Hbf' },
                            destination: { name: 'Westkreuz' },
                            departureReal: '2025-11-20T09:00:00Z',
                            arrivalReal: '2025-11-20T09:25:00Z'
                        }
                    }
                ];

                const bobTrips = [
                    {
                        id: 301,
                        createdAt: '2026-05-10T10:00:00Z',
                        user: { username: 'bob', displayName: 'Bob' },
                        train: {
                            category: 'highspeed',
                            lineName: 'ICE 700',
                            totalDistance: 289000,
                            departureDelay: 0,
                            arrivalDelay: 60,
                            origin: { name: 'Hamburg Hbf' },
                            destination: { name: 'Berlin Hbf' },
                            departureReal: '2026-05-10T10:00:00Z',
                            arrivalReal: '2026-05-10T11:45:00Z'
                        }
                    }
                ];

                await SessionDB.save('alice', aliceTrips, { username: 'alice', displayName: 'Alice' });
                await SessionDB.save('bob', bobTrips, { username: 'bob', displayName: 'Bob' });
                const checkAlice = await SessionDB.get('alice');
                return {
                    saved: true,
                    aliceTripsCount: checkAlice?.trips?.length,
                    aliceSession: checkAlice
                };
            })()
        `);
        console.log('   Step 1 seeding result:', seedResult);

        console.log('2. Navigating to Rail Wrapped for Alice (?user=alice)...');
        await navigateTo('http://127.0.0.1:8000/wrapped.html?user=alice');
        await new Promise(r => setTimeout(r, 1000));

        const stateCheck = await evalJs(`
            (() => {
                const emptyEl = document.getElementById('wrappedEmptyState');
                const contentEl = document.getElementById('wrappedContent');
                const heroName = document.getElementById('heroName')?.textContent?.trim();
                const kpiTrips = document.getElementById('kpiTrips')?.textContent?.trim();
                const kpiDistance = document.getElementById('kpiDistance')?.textContent?.trim();
                const kpiPunctuality = document.getElementById('kpiPunctuality')?.textContent?.trim();

                return {
                    emptyHidden: emptyEl ? emptyEl.classList.contains('hidden') || window.getComputedStyle(emptyEl).display === 'none' : null,
                    contentVisible: contentEl ? !contentEl.classList.contains('hidden') && window.getComputedStyle(contentEl).display !== 'none' : null,
                    heroName,
                    kpiTrips,
                    kpiDistance,
                    kpiPunctuality
                };
            })()
        `);

        console.log('   State check results:', stateCheck);
        if (!stateCheck.emptyHidden) throw new Error('Empty state should be hidden for user with trips');
        if (!stateCheck.contentVisible) throw new Error('Content should be visible for user with trips');
        if (!stateCheck.heroName?.toLowerCase().includes('alice')) throw new Error('Hero name does not show Alice: ' + stateCheck.heroName);
        if (stateCheck.kpiTrips !== '3') throw new Error('Expected 3 trips in KPI, got: ' + stateCheck.kpiTrips);
        if (!stateCheck.kpiDistance || stateCheck.kpiDistance === '0 km') throw new Error('Expected non-zero distance KPI, got: ' + stateCheck.kpiDistance);

        console.log('3. Testing Year Selector Pills...');
        const yearTest = await evalJs(`
            (async () => {
                const pill2026 = document.querySelector('.control-pill[data-year="2026"]');
                if (!pill2026) return { error: 'No 2026 pill found' };
                pill2026.click();
                await new Promise(r => setTimeout(r, 300));
                return {
                    pillFound: true,
                    activeYearPill: document.querySelector('.control-pill.active')?.getAttribute('data-year'),
                    kpiTrips: document.getElementById('kpiTrips')?.textContent?.trim()
                };
            })()
        `);
        console.log('   Year test results:', yearTest);
        if (yearTest.kpiTrips !== '2') throw new Error('Filtering by year 2026 should show 2 trips, got: ' + yearTest.kpiTrips);

        console.log('4. Testing Traveler Duel Mode with Bob...');
        const duelTest = await evalJs(`
            (async () => {
                const duelBtn = document.getElementById('duelToggleBtn');
                duelBtn.click();
                await new Promise(r => setTimeout(r, 400));
                const duelContainer = document.getElementById('duelContainer');
                const pAName = document.getElementById('duelPlayerAName')?.textContent?.trim();
                const pBName = document.getElementById('duelOpponentSelect')?.value;
                const rows = document.querySelectorAll('#duelTableBody tr');
                return {
                    duelActive: duelContainer?.classList.contains('active'),
                    playerA: pAName,
                    playerB: pBName,
                    rowCount: rows.length
                };
            })()
        `);
        console.log('   Duel test results:', duelTest);
        if (!duelTest.duelActive) throw new Error('Duel container not activated on click');
        if (!duelTest.playerA?.toLowerCase().includes('alice')) throw new Error('Player A should be Alice, got: ' + duelTest.playerA);
        if (!duelTest.playerB?.toLowerCase().includes('bob')) throw new Error('Player B should be Bob, got: ' + duelTest.playerB);
        if (duelTest.rowCount < 5) throw new Error('Expected at least 5 comparison metrics in duel table, got: ' + duelTest.rowCount);

        console.log('5. Testing non-destructive user switching to empty user...');
        await evalJs(`
            (async () => {
                const { SessionDB } = await import('./js/cache/session.js');
                // Create user charlie with 0 trips
                await SessionDB.save('charlie', [], { username: 'charlie', displayName: 'Charlie' });
            })()
        `);

        // Navigate to charlie
        await navigateTo('http://127.0.0.1:8000/wrapped.html?user=charlie');
        await new Promise(r => setTimeout(r, 1000));

        const emptyStateCheck = await evalJs(`
            (() => {
                const emptyEl = document.getElementById('wrappedEmptyState');
                const contentEl = document.getElementById('wrappedContent');
                return {
                    emptyVisible: emptyEl ? !emptyEl.classList.contains('hidden') && window.getComputedStyle(emptyEl).display !== 'none' : false,
                    contentHidden: contentEl ? contentEl.classList.contains('hidden') || window.getComputedStyle(contentEl).display === 'none' : false,
                    containerIntact: Boolean(document.querySelector('.wrapped-container'))
                };
            })()
        `);
        console.log('   Empty state check:', emptyStateCheck);
        if (!emptyStateCheck.emptyVisible) throw new Error('Empty state should be visible for user with 0 trips');
        if (!emptyStateCheck.contentHidden) throw new Error('Content should be hidden for user with 0 trips');
        if (!emptyStateCheck.containerIntact) throw new Error('Container should remain intact');

        console.log('6. Switching back to Alice via profile dropdown without full page reload...');
        await evalJs(`
            (() => {
                const profileSelect = document.getElementById('profileSelect');
                if (!profileSelect) return { error: 'No profileSelect found' };
                profileSelect.value = 'alice';
                profileSelect.dispatchEvent(new Event('change', { bubbles: true }));
                return { dispatched: true };
            })()
        `);
        await new Promise(r => setTimeout(r, 1000));

        const recoveredCheck = await evalJs(`
            (() => {
                const emptyEl = document.getElementById('wrappedEmptyState');
                const contentEl = document.getElementById('wrappedContent');
                const kpiTrips = document.getElementById('kpiTrips')?.textContent?.trim();
                return {
                    emptyHidden: emptyEl ? emptyEl.classList.contains('hidden') || window.getComputedStyle(emptyEl).display === 'none' : false,
                    contentVisible: contentEl ? !contentEl.classList.contains('hidden') && window.getComputedStyle(contentEl).display !== 'none' : false,
                    kpiTrips
                };
            })()
        `);
        console.log('   Recovered check:', recoveredCheck);
        if (!recoveredCheck.emptyHidden) throw new Error('Empty state was not hidden after switching back to Alice');
        if (!recoveredCheck.contentVisible) throw new Error('Content was not restored after switching back to Alice');
        if (recoveredCheck.kpiTrips !== '3') throw new Error('Expected 3 trips for Alice after recovery, got: ' + recoveredCheck.kpiTrips);

        console.log('🎉 ALL RAIL WRAPPED E2E REHYDRATION TESTS PASSED!');
    } finally {
        ws.close();
        chrome.kill('SIGKILL');
        try { execSync('pkill -9 -f chrome-test-wrapped'); } catch {}
        try { execSync(`rm -rf ${dataDir}`); } catch {}
    }
}

runWrappedRehydrationTest().catch(err => {
    console.error('❌ TEST FAILED:', err);
    process.exit(1);
});
