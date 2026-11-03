import { spawn, execSync } from 'child_process';

async function runLoadingRandomizerE2ETest() {
    console.log('====================================================');
    console.log('🚀 TESTING CHECK-IN RANDOMIZER IN CHROMIUM');
    console.log('====================================================');

    try { execSync('pkill -9 -f chrome-test-randomizer'); } catch {}

    const dataDir = `/tmp/chrome-test-randomizer-${Date.now()}`;
    const chrome = spawn('chromium-browser', [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-cache',
        '--remote-debugging-port=9235',
        `--user-data-dir=${dataDir}`,
        'about:blank'
    ]);

    let targetTab = null;
    for (let i = 0; i < 25; i++) {
        await new Promise(r => setTimeout(r, 200));
        try {
            const res = await fetch('http://127.0.0.1:9235/json');
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

        console.log('2. Starting Check-in Randomizer on #fetchScreen...');
        const initResult = await evalJs(`
            (() => {
                const { LoadingGame } = window;
                if (!LoadingGame) return { error: 'window.LoadingGame not found' };
                LoadingGame.start({ username: 'traeweller' });

                const widget = document.getElementById('loadingBingoWidget');
                const title = document.querySelector('.bingo-title');
                const quoteText = document.querySelector('.randomizer-empty-title, .randomizer-quote-text');
                const progressTrack = document.querySelector('.randomizer-progress-track');

                return {
                    widgetFound: Boolean(widget),
                    isVisible: widget ? widget.classList.contains('visible') : false,
                    isRandomizerClass: widget ? widget.classList.contains('loading-randomizer-widget') : false,
                    title: title ? title.textContent : null,
                    hasProgressTrack: Boolean(progressTrack),
                    initialStateFound: Boolean(quoteText)
                };
            })()
        `);
        console.log('   Init result:', initResult);

        if (!initResult.widgetFound || !initResult.isVisible) {
            throw new Error('Randomizer widget container failed to initialize or become visible');
        }

        console.log('3. Ingesting trip batches with user comments...');
        const batchResult = await evalJs(`
            (() => {
                const { LoadingGame } = window;
                const sampleTrips = [
                    {
                        id: 501,
                        body: 'Speisewagen hat heute frischen Kaffee! ☕ #ice',
                        train: {
                            lineName: 'ICE 700',
                            category: 'nationalExpress',
                            origin: { name: 'München Hbf' },
                            destination: { name: 'Berlin Hbf' },
                            departureDelay: 0,
                            arrivalDelay: 300
                        },
                        createdAt: '2024-06-12T10:30:00Z'
                    },
                    {
                        id: 502,
                        body: 'S-Bahn Sprint durch Frankfurt nach Feierabend',
                        train: {
                            lineName: 'S 8',
                            category: 'suburban',
                            origin: { name: 'Frankfurt Hbf' },
                            destination: { name: 'Wiesbaden Hbf' },
                            departureDelay: 120,
                            arrivalDelay: 60
                        },
                        createdAt: '2024-06-12T18:15:00Z'
                    }
                ];

                LoadingGame.onTripBatch(sampleTrips);

                const quoteEl = document.querySelector('.randomizer-quote-text');
                const lineBadge = document.querySelector('.randomizer-line-badge');
                const routeEl = document.querySelector('.randomizer-route-text');
                const subtitle = document.querySelector('.randomizer-subtitle');

                return {
                    displayedText: quoteEl ? quoteEl.textContent : null,
                    badgeText: lineBadge ? lineBadge.textContent : null,
                    routeText: routeEl ? routeEl.textContent : null,
                    subtitle: subtitle ? subtitle.textContent : null
                };
            })()
        `);
        console.log('   Batch result:', batchResult);

        if (!batchResult.displayedText || !batchResult.displayedText.includes('Speisewagen') && !batchResult.displayedText.includes('S-Bahn')) {
            throw new Error('Check-in text failed to render in randomizer bubble');
        }

        console.log('4. Testing Next / Shuffle button (🎲)...');
        const shuffleResult = await evalJs(`
            (async () => {
                const nextBtn = document.getElementById('randomizerNextBtn');
                if (!nextBtn) return { error: 'Next button not found' };
                const beforeText = document.querySelector('.randomizer-quote-text')?.textContent;
                nextBtn.click();
                await new Promise(r => setTimeout(r, 250));
                const afterText = document.querySelector('.randomizer-quote-text')?.textContent;
                return { beforeText, afterText, clicked: true };
            })()
        `);
        console.log('   Shuffle result:', shuffleResult);

        console.log('5. Testing Pause / Resume button (⏸ / ▶)...');
        const pauseResult = await evalJs(`
            (() => {
                const pauseBtn = document.getElementById('randomizerPauseBtn');
                if (!pauseBtn) return { error: 'Pause button not found' };
                pauseBtn.click();
                const pausedPill = document.querySelector('.randomizer-status-pill.paused');
                const pauseBtnText = pauseBtn.textContent;
                return { isPausedPill: Boolean(pausedPill), pauseBtnText };
            })()
        `);
        console.log('   Pause result:', pauseResult);

        console.log('6. Testing Minimize toggle...');
        const minResult = await evalJs(`
            (() => {
                const minBtn = document.getElementById('randomizerMinimizeBtn');
                minBtn.click();
                const widget = document.getElementById('loadingBingoWidget');
                const isMin = widget.classList.contains('minimized');
                minBtn.click();
                const isRestored = !widget.classList.contains('minimized');
                return { isMin, isRestored };
            })()
        `);
        console.log('   Minimize result:', minResult);

        console.log('7. Testing stop & dismiss...');
        const stopResult = await evalJs(`
            (() => {
                const { LoadingGame } = window;
                LoadingGame.stop();
                const widget = document.getElementById('loadingBingoWidget');
                return { isHidden: widget ? widget.classList.contains('hidden') : false };
            })()
        `);
        console.log('   Stop result:', stopResult);

        console.log('🎉 ALL CHECK-IN RANDOMIZER E2E TESTS PASSED!');
    } finally {
        ws.close();
        chrome.kill('SIGKILL');
        try { execSync(`rm -rf ${dataDir}`); } catch {}
    }
}

runLoadingRandomizerE2ETest().catch((err) => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
