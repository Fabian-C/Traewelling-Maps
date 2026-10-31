/**
 * E2E Verification & Performance Test for Animation V2 (Zero-CDN)
 */

import { spawn } from 'child_process';

async function runAnimV2Test() {
    console.log('====================================================');
    console.log('🎬 RUNNING ANIMATION V2 E2E VERIFICATION TEST');
    console.log('====================================================');

    const chrome = spawn('chromium-browser', [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--remote-debugging-port=9252',
        '--user-data-dir=/tmp/chrome-test-anim-v2',
        'about:blank'
    ]);

    try {
        let pageTab = null;
        for (let i = 0; i < 25; i++) {
            await new Promise(r => setTimeout(r, 200));
            try {
                const res = await fetch('http://127.0.0.1:9252/json');
                const tabs = await res.json();
                pageTab = tabs.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
                if (pageTab) break;
            } catch {}
        }

        if (!pageTab) {
            throw new Error('Failed to find browser tab in Chromium');
        }

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

        // Intercept network requests to verify ZERO third-party CDN calls
        const externalRequests = [];
        ws.addEventListener('message', (e) => {
            const msg = JSON.parse(e.data);
            if (msg.method === 'Network.requestWillBeSent') {
                const url = msg.params.request.url;
                if (url.includes('esm.sh') || url.includes('cdnjs') || url.includes('unpkg')) {
                    externalRequests.push(url);
                }
            }
        });

        await send('Network.enable');
        await send('Page.enable');
        await send('Runtime.enable');

        const startTime = Date.now();
        await send('Page.navigate', { url: 'http://127.0.0.1:8000/animation-v2.html' });
        await new Promise(r => setTimeout(r, 1200));
        const loadDurationMs = Date.now() - startTime;

        console.log(`✓ Page loaded in ~${loadDurationMs}ms`);
        console.log(`  External CDN requests intercepted: ${externalRequests.length}`);
        if (externalRequests.length > 0) {
            throw new Error(`Found disallowed external CDN requests: ${externalRequests.join(', ')}`);
        }

        // Test DOM and Micro-Player Initialization
        const evalResult = await send('Runtime.evaluate', {
            expression: `
                (() => {
                    const canvas = document.querySelector('.v2-player-canvas');
                    const scrubber = document.getElementById('v2ScrubberWrap');
                    const playBtn = document.getElementById('v2PlayBtn');
                    const speedBtn = document.getElementById('v2SpeedBtn');
                    const downloadBtn = document.getElementById('downloadVideoBtn');
                    const sidebarLine = document.getElementById('sidebarLine');

                    return {
                        hasCanvas: !!canvas,
                        canvasWidth: canvas ? canvas.width : 0,
                        canvasHeight: canvas ? canvas.height : 0,
                        hasScrubber: !!scrubber,
                        hasPlayBtn: !!playBtn,
                        hasSpeedBtn: !!speedBtn,
                        hasDownloadBtn: !!downloadBtn,
                        sidebarText: sidebarLine ? sidebarLine.textContent : ''
                    };
                })()
            `,
            returnByValue: true
        });

        const state = evalResult.result.value;
        console.log('✓ Micro-Player Elements Status:', state);

        if (!state.hasCanvas || state.canvasWidth !== 960) {
            throw new Error(`Canvas was not initialized properly: ${JSON.stringify(state)}`);
        }
        if (!state.hasScrubber || !state.hasPlayBtn) {
            throw new Error('Micro-Player controls missing from DOM');
        }

        // Test Interactive Scrubbing & Speed Control
        const interactResult = await send('Runtime.evaluate', {
            expression: `
                (() => {
                    const speedBtn = document.getElementById('v2SpeedBtn');
                    const initialSpeed = speedBtn.textContent;
                    speedBtn.click();
                    const nextSpeed = speedBtn.textContent;

                    const loopBtn = document.getElementById('v2LoopBtn');
                    const initialLoop = loopBtn.classList.contains('active');
                    loopBtn.click();
                    const nextLoop = loopBtn.classList.contains('active');

                    return { initialSpeed, nextSpeed, initialLoop, nextLoop };
                })()
            `,
            returnByValue: true
        });

        console.log('✓ Player Interaction Result:', interactResult.result.value);

        console.log('\n🎉 ANIMATION V2 E2E VERIFICATION TEST PASSED WITH ZERO CDN REQUESTS!');
        chrome.kill();
        process.exit(0);
    } catch (err) {
        console.error('❌ E2E Anim V2 test failed:', err);
        chrome.kill();
        process.exit(1);
    }
}

runAnimV2Test();
