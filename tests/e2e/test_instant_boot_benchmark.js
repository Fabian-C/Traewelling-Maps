import { spawn, execSync } from 'child_process';

async function runInstantBootBenchmark() {
    console.log('====================================================');
    console.log('⚡ BENCHMARKING INSTANT DATA BOOT & GEOJSON CACHE');
    console.log('====================================================');

    try { execSync('pkill -9 -f chrome-test-perf'); } catch {}

    const dataDir = `/tmp/chrome-test-perf-${Date.now()}`;
    const chrome = spawn('chromium-browser', [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-application-cache',
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

    const evalCode = async (expression) => {
        const res = await send('Runtime.evaluate', {
            expression,
            returnByValue: true,
            awaitPromise: true
        });
        if (res.result?.exceptionDetails) {
            console.error('Eval error:', res.result.exceptionDetails);
            throw new Error(res.result.exceptionDetails.text || 'Evaluation failed');
        }
        return res.result?.result?.value;
    };

    try {
        await send('Runtime.enable');
        await send('Page.enable');

        console.log('1. Navigating to index.html...');
        await send('Page.navigate', { url: 'http://127.0.0.1:8000/index.html' });
        await new Promise(r => setTimeout(r, 2000));

        console.log('2. Generating & saving 500 synthetic trips into SessionDB...');
        const seedResult = await evalCode(`
            (async () => {
                const { SessionDB } = await import('./js/cache/session.js');
                const categories = ['nationalExpress', 'national', 'regional', 'suburban', 'tram', 'bus'];
                const trips = [];
                const baseLat = 52.52;
                const baseLng = 13.40;

                for (let i = 1; i <= 500; i++) {
                    const cat = categories[i % categories.length];
                    const coords = [];
                    const numPoints = 8;
                    for (let p = 0; p < numPoints; p++) {
                        coords.push([
                            baseLng + (i * 0.005) + (p * 0.002),
                            baseLat + (i * 0.003) + (p * 0.002)
                        ]);
                    }
                    trips.push({
                        id: 10000 + i,
                        statusId: 10000 + i,
                        createdAt: new Date(Date.now() - i * 3600000).toISOString(),
                        checkin: {
                            category: cat,
                            lineName: cat.toUpperCase() + ' ' + (100 + (i % 50)),
                            origin: { name: 'Origin ' + (i % 20), latitude: coords[0][1], longitude: coords[0][0] },
                            destination: { name: 'Dest ' + (i % 20), latitude: coords[numPoints - 1][1], longitude: coords[numPoints - 1][0] }
                        },
                        polyline: {
                            type: 'Feature',
                            geometry: { type: 'LineString', coordinates: coords },
                            properties: { statusId: 10000 + i }
                        }
                    });
                }

                await SessionDB.save('perf_user', trips);
                return { count: trips.length, saved: true };
            })()
        `);
        console.log('   Seed result:', seedResult);

        console.log('3. Cold run: Initial processing and GeoJSON materialization...');
        const coldRunResult = await evalCode(`
            (async () => {
                const { loadSessionByUsername } = await import('./js/session/manager.js');
                const { SessionDB } = await import('./js/cache/session.js');
                
                const t0 = performance.now();
                await loadSessionByUsername('perf_user');
                const t1 = performance.now();
                
                const cached = await SessionDB.getMaterializedGeoJSON('perf_user');
                return {
                    durationMs: Math.round(t1 - t0),
                    hasCachedGeoJSON: !!cached,
                    featureCount: cached ? Object.values(cached.geojson).reduce((acc, fc) => acc + (fc.features?.length || 0), 0) : 0
                };
            })()
        `);
        console.log('   Cold run result:', coldRunResult);

        console.log('4. Warm run: Instant reload utilizing materialized GeoJSON cache...');
        const warmRunResult = await evalCode(`
            (async () => {
                const { processAndDisplayData } = await import('./js/fetch/orchestrator.js');
                const { store } = await import('./js/state/store.js');
                
                const state = store.get();
                const t0 = performance.now();
                // Call processAndDisplayData on the loaded dataset
                await processAndDisplayData(state.fetchedTrips);
                const t1 = performance.now();
                
                return {
                    durationMs: Math.round(t1 - t0),
                    layersCount: state.layers.data.size,
                    featuresLoaded: Array.from(state.layers.data.values()).reduce((acc, l) => acc + (l.data?.features?.length || 0), 0)
                };
            })()
        `);
        console.log('   Warm run result:', warmRunResult);

        console.log('5. Testing non-destructive layer reordering (map.moveLayer)...');
        const layerReorderResult = await evalCode(`
            (async () => {
                const { syncMapLayerOrder } = await import('./js/map/layers.js');
                const { store } = await import('./js/state/store.js');
                const state = store.get();
                
                let moveLayerCalls = 0;
                let removeLayerCalls = 0;
                
                const origMove = state.map.moveLayer;
                const origRemove = state.map.removeLayer;
                state.map.moveLayer = (...args) => { moveLayerCalls++; return origMove.apply(state.map, args); };
                state.map.removeLayer = (...args) => { removeLayerCalls++; return origRemove.apply(state.map, args); };
                
                // Reverse layer order
                state.layers.order.reverse();
                syncMapLayerOrder();
                
                state.map.moveLayer = origMove;
                state.map.removeLayer = origRemove;
                
                return {
                    moveLayerCalls,
                    removeLayerCalls,
                    nonDestructive: removeLayerCalls === 0 && moveLayerCalls > 0
                };
            })()
        `);
        console.log('   Layer reordering result:', layerReorderResult);

        // Assertions
        if (!coldRunResult.hasCachedGeoJSON) throw new Error('Materialized GeoJSON was not created during cold run!');
        if (coldRunResult.featureCount !== 500) throw new Error(`Expected 500 features cached, found ${coldRunResult.featureCount}`);
        if (!layerReorderResult.nonDestructive) throw new Error('Layer reordering was destructive (called removeLayer)!');

        console.log('====================================================');
        console.log('🎉 ALL PERFORMANCE BENCHMARK & REHYDRATION TESTS PASSED!');
        console.log(`   Cold run: ${coldRunResult.durationMs}ms | Warm cached: ${warmRunResult.durationMs}ms`);
        console.log('====================================================');

    } finally {
        ws.close();
        chrome.kill('SIGKILL');
        try { execSync(`rm -rf ${dataDir}`); } catch {}
    }
}

runInstantBootBenchmark().catch((err) => {
    console.error('Benchmark failed:', err);
    process.exit(1);
});
