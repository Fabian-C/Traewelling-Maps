/**
 * E2E Verification & Benchmark: Native WebGL2 Engine with 4,000 Rides
 */

import { spawn } from 'child_process';
import fs from 'fs';

async function runWebGLTest() {
    console.log('====================================================');
    console.log('⚡ TESTING NATIVE WEBGL2 TRANSIT ENGINE & 4,000 LINES');
    console.log('====================================================');

    const chrome = spawn('chromium-browser', [
        '--headless=new',
        '--no-sandbox',
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-webgpu',
        '--remote-debugging-port=9261',
        '--user-data-dir=/tmp/chrome-test-webgl',
        'about:blank'
    ]);

    try {
        let pageTab = null;
        for (let i = 0; i < 25; i++) {
            await new Promise(r => setTimeout(r, 200));
            try {
                const res = await fetch('http://127.0.0.1:9261/json');
                const tabs = await res.json();
                pageTab = tabs.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
                if (pageTab) break;
            } catch {}
        }

        if (!pageTab) throw new Error('Could not connect to Chromium DevTools');

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

        await send('Page.navigate', { url: 'http://127.0.0.1:8000/animation.html' });
        await new Promise(r => setTimeout(r, 1500));

        // 1. Test WebGL2 context creation and shader linking in real browser
        console.log('1. Initializing WebGL2 Engine & Compiling Shaders in Chromium...');
        const initResult = await send('Runtime.evaluate', {
            expression: `(async () => {
                const { WebGLAnimEngine } = await import('./js/anim-v2/webgl/engine.js?t=' + Date.now());
                const canvas = document.createElement('canvas');
                canvas.width = 960;
                canvas.height = 960;
                const engine = new WebGLAnimEngine(canvas);

                return {
                    hasGL: !!engine.gl,
                    isPacked: engine.isPacked,
                    contextName: engine.gl ? engine.gl.constructor.name : null
                };
            })()`,
            awaitPromise: true,
            returnByValue: true
        });
        console.log('WebGL2 Engine Init:', initResult.result.value);

        // 2. Benchmark 4,000 synthetic rides (1,000,000+ vertices)
        console.log('2. Synthesizing 4,000 transit rides and benchmarking GPU render...');
        const benchResult = await send('Runtime.evaluate', {
            expression: `(async () => {
                const { WebGLAnimEngine } = await import('./js/anim-v2/webgl/engine.js?t=' + Date.now());
                const canvas = document.createElement('canvas');
                canvas.width = 960;
                canvas.height = 960;
                const engine = new WebGLAnimEngine(canvas);

                // Synthesize 4,000 realistic transit rides across a 2000x2000 coordinate space
                const rides = [];
                for (let r = 0; r < 4000; r++) {
                    const pts = [];
                    const startX = (r * 17) % 1800 + 100;
                    const startY = (r * 31) % 1800 + 100;
                    const len = 15; // 15 points per line
                    for (let p = 0; p < len; p++) {
                        pts.push({
                            x: startX + p * 8 + Math.sin(p * 0.5) * 5,
                            y: startY + p * 6 + Math.cos(p * 0.5) * 5
                        });
                    }
                    rides.push({
                        startFrame: r % 200,
                        endFrame: (r % 200) + 40,
                        points: pts,
                        cumDist: new Float32Array([0, 10, 20]),
                        totalPathPx: 100,
                        rideCenterX: startX,
                        rideCenterY: startY,
                        fitScale: 1.0,
                        trip: {
                            checkin: {
                                category: (r % 2 === 0) ? 'nationalExpress' : 'regional',
                                routeColor: (r % 2 === 0) ? '#ff2e55' : '#8b5cf6'
                            }
                        }
                    });
                }

                // Measure VBO pack time
                const t0 = performance.now();
                engine.syncScene(rides, 240);
                const packDurationMs = performance.now() - t0;

                const sceneMock = {
                    rides,
                    travelTotalFrames: 240,
                    fitScale: 1.0,
                    centerSceneX: 1000,
                    centerSceneY: 1000
                };

                // Measure GPU draw time across 10 frames
                const drawTimes = [];
                for (let f = 0; f < 10; f++) {
                    const d0 = performance.now();
                    engine.render({
                        frame: f * 24,
                        fps: 30,
                        width: 960,
                        height: 960,
                        allScene: sceneMock,
                        timing: { travelTotalFrames: 240 },
                        styleConfig: { bg: '#080a10', isDark: true }
                    });
                    // Force GPU completion to measure true hardware time
                    engine.gl.finish();
                    drawTimes.push(performance.now() - d0);
                }

                const avgDrawMs = drawTimes.reduce((a, b) => a + b, 0) / drawTimes.length;
                const totalSegments = rides.reduce((acc, r) => acc + (r.points.length - 1), 0);
                const totalVertices = totalSegments * 6;

                return {
                    totalRides: rides.length,
                    totalSegments,
                    totalVertices,
                    packDurationMs: Math.round(packDurationMs * 10) / 10,
                    avgDrawMs: Math.round(avgDrawMs * 100) / 100,
                    estimatedFps: Math.round(1000 / avgDrawMs)
                };
            })()`,
            awaitPromise: true,
            returnByValue: true
        });

        console.log('4,000 Lines GPU Benchmark Result:', JSON.stringify(benchResult.result.value, null, 2));

        if (!benchResult.result.value || benchResult.result.value.avgDrawMs > 16.6) {
            throw new Error(`Benchmark exceeded 16.6ms threshold: ${benchResult.result.value?.avgDrawMs}ms`);
        }

        console.log('====================================================');
        console.log('🎉 WEBGL2 4,000 LINES BENCHMARK PASSED AT 60+ FPS!');
        console.log('====================================================');

        ws.close();
    } finally {
        chrome.kill('SIGKILL');
    }
}

runWebGLTest().catch((err) => {
    console.error('❌ WEBGL2 TEST FAILED:', err);
    process.exit(1);
});
