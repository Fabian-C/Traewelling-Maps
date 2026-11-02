/**
 * E2E Test: Mobile Experience, Responsive Fullscreen & UI Decoupling
 */

import { spawn } from 'child_process';
import fs from 'fs';

async function runTest() {
    console.log('====================================================');
    console.log('📱 TESTING MOBILE UI, FULLSCREEN & UI DECOUPLING');
    console.log('====================================================');

    const chrome = spawn('chromium-browser', [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--remote-debugging-port=9260',
        '--user-data-dir=/tmp/chrome-test-mobile-fullscreen',
        'about:blank'
    ]);

    try {
        let pageTab = null;
        for (let i = 0; i < 25; i++) {
            await new Promise(r => setTimeout(r, 200));
            try {
                const res = await fetch('http://127.0.0.1:9260/json');
                const tabs = await res.json();
                pageTab = tabs.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
                if (pageTab) break;
            } catch {}
        }

        if (!pageTab) throw new Error('Could not attach to Chromium target');

        const ws = new WebSocket(pageTab.webSocketDebuggerUrl);
        await new Promise(r => ws.onopen = r);
        let id = 1;
        const send = (method, params = {}) => new Promise((resolve) => {
            const reqId = id++;
            const handler = (e) => {
                const msg = JSON.parse(e.data);
                if (msg.id === reqId) {
                    ws.removeEventListener('message', handler);
                    resolve(msg.result);
                }
            };
            ws.addEventListener('message', handler);
            ws.send(JSON.stringify({ id: reqId, method, params }));
        });

        await send('Page.enable');
        await send('Runtime.enable');

        // 1. Mobile Portrait (390 x 844)
        console.log('1. Setting mobile portrait viewport (390 x 844)...');
        await send('Emulation.setDeviceMetricsOverride', {
            width: 390,
            height: 844,
            deviceScaleFactor: 2,
            mobile: true,
            hasTouch: true
        });

        await send('Page.navigate', { url: 'http://127.0.0.1:8000/animation.html' });
        await new Promise(r => setTimeout(r, 1200));

        const portraitMetrics = await send('Runtime.evaluate', {
            expression: `(() => {
                const stage = document.querySelector('.v2-player-stage');
                const controls = document.querySelector('.v2-player-controls');
                return {
                    docScrollWidth: document.documentElement.scrollWidth,
                    windowInnerWidth: window.innerWidth,
                    stageWidth: stage ? stage.offsetWidth : 0,
                    controlsWidth: controls ? controls.offsetWidth : 0,
                    hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth
                };
            })()`,
            returnByValue: true
        });
        console.log('Mobile Portrait Layout:', portraitMetrics.result.value);
        if (portraitMetrics.result.value.hasHorizontalOverflow) {
            throw new Error('Horizontal overflow detected on mobile portrait viewport!');
        }

        // 2. Fullscreen Toggle on Mobile
        console.log('2. Testing Fullscreen Toggle & Floating Close Button...');
        const fsEnter = await send('Runtime.evaluate', {
            expression: `(async () => {
                const player = window.__nativePlayer;
                player.toggleFullscreen();
                await new Promise(r => setTimeout(r, 150));
                const container = document.querySelector('.v2-player-container');
                const fsBtn = document.querySelector('#v2FullscreenBtn');
                const closeBtn = document.querySelector('#v2FullscreenCloseBtn');
                const stage = document.querySelector('.v2-player-stage');
                return {
                    isFullscreen: player.isFullscreen(),
                    hasFsClass: container.classList.contains('is-fullscreen'),
                    btnActive: fsBtn.classList.contains('active'),
                    btnTitle: fsBtn.getAttribute('title'),
                    closeBtnDisplay: window.getComputedStyle(closeBtn).display,
                    stageWidth: stage.offsetWidth,
                    stageHeight: stage.offsetHeight,
                    stageFitsScreen: stage.offsetWidth <= window.innerWidth && stage.offsetHeight <= window.innerHeight
                };
            })()`,
            awaitPromise: true,
            returnByValue: true
        });
        console.log('Fullscreen Active State:', fsEnter.result.value);
        if (!fsEnter.result.value.isFullscreen || !fsEnter.result.value.stageFitsScreen) {
            throw new Error('Fullscreen did not activate properly or stage exceeds screen boundaries!');
        }

        // Exit via Close Button
        const fsExit = await send('Runtime.evaluate', {
            expression: `(async () => {
                const closeBtn = document.querySelector('#v2FullscreenCloseBtn');
                closeBtn.click();
                await new Promise(r => setTimeout(r, 150));
                const player = window.__nativePlayer;
                const container = document.querySelector('.v2-player-container');
                const fsBtn = document.querySelector('#v2FullscreenBtn');
                return {
                    isFullscreen: player.isFullscreen(),
                    hasFsClass: container.classList.contains('is-fullscreen'),
                    btnActive: fsBtn.classList.contains('active')
                };
            })()`,
            awaitPromise: true,
            returnByValue: true
        });
        console.log('Fullscreen Exited via Close Button:', fsExit.result.value);
        if (fsExit.result.value.isFullscreen) {
            throw new Error('Fullscreen failed to exit via close button!');
        }

        // 3. Landscape Viewport (844 x 390)
        console.log('3. Testing mobile landscape viewport (844 x 390)...');
        await send('Emulation.setDeviceMetricsOverride', {
            width: 844,
            height: 390,
            deviceScaleFactor: 2,
            mobile: true,
            hasTouch: true
        });
        await new Promise(r => setTimeout(r, 500));

        const landscapeFs = await send('Runtime.evaluate', {
            expression: `(async () => {
                const player = window.__nativePlayer;
                player.enterFullscreen();
                await new Promise(r => setTimeout(r, 150));
                const stage = document.querySelector('.v2-player-stage');
                const controls = document.querySelector('.v2-player-controls');
                return {
                    stageWidth: stage.offsetWidth,
                    stageHeight: stage.offsetHeight,
                    controlsWidth: controls.offsetWidth,
                    controlsHeight: controls.offsetHeight,
                    fitsHorizontally: stage.offsetWidth <= 844,
                    fitsVertically: (stage.offsetHeight + controls.offsetHeight) <= 390
                };
            })()`,
            awaitPromise: true,
            returnByValue: true
        });
        console.log('Landscape Fullscreen Fitting:', landscapeFs.result.value);
        if (!landscapeFs.result.value.fitsHorizontally || !landscapeFs.result.value.fitsVertically) {
            throw new Error('Landscape fullscreen stage/controls overflow viewport!');
        }

        console.log('====================================================');
        console.log('✅ ALL MOBILE FULLSCREEN & UI DECOUPLING TESTS PASSED!');
        console.log('====================================================');
        ws.close();
    } finally {
        chrome.kill('SIGKILL');
    }
}

runTest().catch((err) => {
    console.error('❌ TEST FAILED:', err);
    process.exit(1);
});
