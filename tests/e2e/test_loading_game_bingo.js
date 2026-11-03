import { spawn, execSync } from 'child_process';

async function runLoadingGameE2ETest() {
    console.log('====================================================');
    console.log('🚀 TESTING LOADING GAME: DB DELAY BINGO IN CHROMIUM');
    console.log('====================================================');

    try { execSync('pkill -9 -f chrome-test-bingo'); } catch {}

    const dataDir = `/tmp/chrome-test-bingo-${Date.now()}`;
    const chrome = spawn('chromium-browser', [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-cache',
        '--remote-debugging-port=9234',
        `--user-data-dir=${dataDir}`,
        'about:blank'
    ]);

    let targetTab = null;
    for (let i = 0; i < 25; i++) {
        await new Promise(r => setTimeout(r, 200));
        try {
            const res = await fetch('http://127.0.0.1:9234/json');
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
        console.log('1. Navigating to index.html...');
        await navigateTo('http://127.0.0.1:8000/index.html');
        await new Promise(r => setTimeout(r, 1500));

        console.log('2. Starting LoadingGame on #fetchScreen...');
        const initResult = await evalJs(`
            (() => {
                const { LoadingGame } = window;
                if (!LoadingGame) return { error: 'window.LoadingGame not found' };
                LoadingGame.start({ username: 'traeweller' });

                const widget = document.getElementById('loadingBingoWidget');
                const tiles = document.querySelectorAll('.bingo-tile');
                const centerFree = document.querySelector('.bingo-tile.is-free');

                return {
                    widgetFound: Boolean(widget),
                    isVisible: widget ? widget.classList.contains('visible') : false,
                    tileCount: tiles.length,
                    hasFreeCenter: Boolean(centerFree),
                    centerStamped: centerFree ? centerFree.classList.contains('stamped') : false
                };
            })()
        `);
        console.log('   Init Result:', initResult);
        if (!initResult.widgetFound || !initResult.isVisible) throw new Error('Loading bingo widget not visible');
        if (initResult.tileCount !== 9) throw new Error('Expected 9 tiles in 3x3 grid, got: ' + initResult.tileCount);
        if (!initResult.hasFreeCenter || !initResult.centerStamped) throw new Error('Center Free tile missing or not stamped');

        console.log('3. Testing manual tile stamp interaction...');
        const clickResult = await evalJs(`
            (() => {
                const tile0 = document.querySelector('.bingo-tile[data-index="0"]');
                tile0.click();
                const isStampedNow = tile0.classList.contains('stamped');
                const stampText = tile0.querySelector('.stamp-text')?.textContent;
                return {
                    isStampedNow,
                    stampText
                };
            })()
        `);
        console.log('   Click Result:', clickResult);
        if (!clickResult.isStampedNow || clickResult.stampText !== 'ENTWERTET') {
            throw new Error('Manual tile stamping failed');
        }

        console.log('4. Testing incoming live trip auto-stamping & Bingo completion...');
        const autoStampResult = await evalJs(`
            (() => {
                const { LoadingGame } = window;
                const game = LoadingGame.activeGame;
                // Force tile 1 to be highspeed and tile 2 to be delay_15 for row 0 completion
                game.tiles[1] = {
                    ...game.tiles[1],
                    id: 'highspeed',
                    match: (t) => t.train?.lineName?.includes('ICE') ? { match: true, detail: 'ICE' } : { match: false },
                    stamped: false
                };
                game.tiles[2] = {
                    ...game.tiles[2],
                    id: 'delay_15',
                    match: (t) => t.train?.departureDelay >= 900 ? { match: true, detail: '+20m' } : { match: false },
                    stamped: false
                };
                game.render();

                // Ensure tile 0 is stamped
                game.stampTile(0, 'Start', 'manual');

                // Incoming batch with ICE and +20m delay
                const mockBatch = [
                    { train: { lineName: 'ICE 500', departureDelay: 1200 } }
                ];
                LoadingGame.onTripBatch(mockBatch);

                const tile1 = document.querySelector('.bingo-tile[data-index="1"]');
                const tile2 = document.querySelector('.bingo-tile[data-index="2"]');
                const banner = document.querySelector('.bingo-celebration-banner');

                return {
                    tile1Stamped: tile1?.classList.contains('stamped'),
                    tile2Stamped: tile2?.classList.contains('stamped'),
                    hasBingo: game.hasBingo,
                    bannerVisible: banner?.classList.contains('visible')
                };
            })()
        `);
        console.log('   Auto-Stamp & Bingo Result:', autoStampResult);
        if (!autoStampResult.tile1Stamped || !autoStampResult.tile2Stamped) throw new Error('Auto-stamping failed for batch');
        if (!autoStampResult.hasBingo || !autoStampResult.bannerVisible) throw new Error('Bingo detection or celebration banner failed');

        console.log('5. Testing minimize to floating pill and expand back...');
        const minimizeResult = await evalJs(`
            (() => {
                const minBtn = document.getElementById('bingoMinimizeBtn');
                minBtn.click();
                const pill = document.getElementById('bingoExpandBtn');
                const pillScore = pill?.querySelector('.bingo-pill-score')?.textContent;

                // Expand back
                pill.click();
                const gridBack = document.querySelector('.bingo-grid');

                return {
                    pillFound: Boolean(pill),
                    pillScore,
                    gridRestored: Boolean(gridBack)
                };
            })()
        `);
        console.log('   Minimize/Expand Result:', minimizeResult);
        if (!minimizeResult.pillFound || !minimizeResult.gridRestored) throw new Error('Minimize or expand toggle failed');

        console.log('6. Testing clean stop...');
        const stopResult = await evalJs(`
            (() => {
                const { LoadingGame } = window;
                LoadingGame.stop();
                const widget = document.getElementById('loadingBingoWidget');
                return {
                    isHidden: widget?.classList.contains('hidden')
                };
            })()
        `);
        console.log('   Stop Result:', stopResult);
        if (!stopResult.isHidden) throw new Error('LoadingGame.stop() did not hide widget');

        console.log('🎉 ALL DB DELAY BINGO E2E TESTS PASSED!');
    } finally {
        ws.close();
        chrome.kill('SIGKILL');
        try { execSync('pkill -9 -f chrome-test-bingo'); } catch {}
        try { execSync(`rm -rf ${dataDir}`); } catch {}
    }
}

runLoadingGameE2ETest().catch(err => {
    console.error('❌ TEST FAILED:', err);
    process.exit(1);
});
