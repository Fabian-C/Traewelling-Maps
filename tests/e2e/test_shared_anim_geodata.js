import { spawn, execSync } from 'child_process';

async function runSharedGeodataTest() {
    console.log('====================================================');
    console.log('🚀 TESTING SHARED ANIMATION LINK GEODATA FETCHING');
    console.log('====================================================');

    try { execSync('pkill -9 -f chrome-test-anim-geodata'); } catch (e) {}

    const chrome = spawn('chromium-browser', [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--remote-debugging-port=9231',
        '--user-data-dir=/tmp/chrome-test-anim-geodata',
        'about:blank'
    ]);

    let targetTab = null;
    for (let i = 0; i < 25; i++) {
        await new Promise(r => setTimeout(r, 200));
        try {
            const res = await fetch('http://127.0.0.1:9231/json');
            const tabs = await res.json();
            targetTab = tabs?.find(t => t.type === 'page' && t.webSocketDebuggerUrl) || null;
            if (targetTab) break;
        } catch (e) {}
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
        console.log('1. Navigating to animation.html?user=hash&trip=9501851 ...');
        await send('Page.navigate', { url: 'http://127.0.0.1:8000/animation.html?user=hash&trip=9501851' });
        await new Promise(r => setTimeout(r, 4000));

        const animInfo = await evalJs(`
            (async () => {
                const select = document.getElementById('tripSelect');
                const selectedOpt = select ? select.options[select.selectedIndex]?.text : null;
                const sidebarRoute = document.getElementById('sidebarRoute')?.textContent;
                const sidebarLine = document.getElementById('sidebarLine')?.textContent;
                
                // Inspect cached polyline in SessionDB or window
                const { SessionDB } = await import('./js/cache/session.js');
                const { extractRouteCoordinates } = await import('./js/animation/geometry.js');
                const cachedPolys = await SessionDB.getPolylinesBatch([9501851]);
                const tripPoly = cachedPolys[9501851];
                const dummyTrip = { checkin: { polyline: tripPoly } };
                const coords = extractRouteCoordinates(dummyTrip);

                return {
                    tripSelectValue: select?.value,
                    selectedOptionText: selectedOpt,
                    sidebarLine,
                    sidebarRoute,
                    hasCachedPoly: !!tripPoly,
                    extractedCoordsCount: coords.length
                };
            })()
        `);
        console.log('animation.html loaded state:', animInfo);

        console.log('2. Navigating to animation-v2.html?user=hash&trip=9501851 ...');
        await send('Page.navigate', { url: 'http://127.0.0.1:8000/animation-v2.html?user=hash&trip=9501851' });
        await new Promise(r => setTimeout(r, 4000));

        const animV2Info = await evalJs(`
            (async () => {
                const select = document.getElementById('tripSelect');
                const selectedOpt = select ? select.options[select.selectedIndex]?.text : null;
                const sidebarRoute = document.getElementById('sidebarRoute')?.textContent;
                const sidebarLine = document.getElementById('sidebarLine')?.textContent;

                const { SessionDB } = await import('./js/cache/session.js');
                const { extractRouteCoordinates } = await import('./js/animation/geometry.js');
                const cachedPolys = await SessionDB.getPolylinesBatch([9501851]);
                const tripPoly = cachedPolys[9501851];
                const dummyTrip = { checkin: { polyline: tripPoly } };
                const coords = extractRouteCoordinates(dummyTrip);

                return {
                    tripSelectValue: select?.value,
                    selectedOptionText: selectedOpt,
                    sidebarLine,
                    sidebarRoute,
                    hasCachedPoly: !!tripPoly,
                    extractedCoordsCount: coords.length
                };
            })()
        `);
        console.log('animation-v2.html loaded state:', animV2Info);

        if (animInfo.tripSelectValue !== '9501851') {
            throw new Error(`animation.html tripSelectValue expected '9501851', got '${animInfo.tripSelectValue}'`);
        }
        if (animV2Info.tripSelectValue !== '9501851') {
            throw new Error(`animation-v2.html tripSelectValue expected '9501851', got '${animV2Info.tripSelectValue}'`);
        }
        if (animInfo.extractedCoordsCount !== 219) {
            throw new Error(`Expected 219 high-resolution polyline coordinates in animation.html, got ${animInfo.extractedCoordsCount}`);
        }
        if (animV2Info.extractedCoordsCount !== 219) {
            throw new Error(`Expected 219 high-resolution polyline coordinates in animation-v2.html, got ${animV2Info.extractedCoordsCount}`);
        }

        console.log('====================================================');
        console.log('✅ PASS: Shared animation geodata fetch verified for both animation players!');
        console.log('====================================================');
    } finally {
        ws.close();
        chrome.kill('SIGKILL');
    }
}

runSharedGeodataTest().catch(e => {
    console.error('Test failed:', e);
    process.exit(1);
});
