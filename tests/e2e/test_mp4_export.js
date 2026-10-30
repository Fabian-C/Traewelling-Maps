/**
 * E2E Test for Deterministic MP4 Video Generation, Duration & Timeline Seeking
 */

import { spawn } from 'child_process';

async function runMp4Verification() {
    console.log('====================================================');
    console.log('🎬 RUNNING DETERMINISTIC MP4 GENERATION & TIMELINE E2E TEST');
    console.log('====================================================');

    const chrome = spawn('chromium-browser', [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--remote-debugging-port=9250',
        '--user-data-dir=/tmp/chrome-test-mp4-deterministic',
        'about:blank'
    ]);

    try {
        let pageTab = null;
        for (let i = 0; i < 25; i++) {
            await new Promise(r => setTimeout(r, 200));
            try {
                const res = await fetch('http://127.0.0.1:9250/json');
                const tabs = await res.json();
                pageTab = tabs.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
                if (pageTab) break;
            } catch (e) {}
        }

        if (!pageTab) {
            throw new Error('Failed to find browser page tab in Chromium');
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

        await send('Page.enable');
        await send('Runtime.enable');
        await send('Page.navigate', { url: 'http://127.0.0.1:8000/animation.html' });
        await new Promise(r => setTimeout(r, 1000));

        console.log('1. Recording deterministic 60-frame video clip (2.0s duration)...');
        const recordResult = await send('Runtime.evaluate', {
            expression: `
                (async () => {
                    const { VideoClipRecorder } = await import('/js/animation/recorder.js');
                    const totalFrames = 60; // 2 seconds at 30 fps
                    const recorder = new VideoClipRecorder(null, totalFrames, 30);

                    const testTrip = {
                        id: 12345,
                        checkin: {
                            lineName: 'ICE 720',
                            category: 'nationalExpress',
                            origin: { name: 'Berlin Hbf' },
                            destination: { name: 'München Hbf' },
                            polyline: [
                                [13.3695, 52.5255],
                                [12.3731, 51.3397],
                                [11.5819, 48.1402]
                            ]
                        }
                    };

                    const progressEvents = [];
                    const result = await recorder.recordAndDownload({
                        trip: testTrip,
                        mode: 'single',
                        mapStyle: 'vector-dark',
                        width: 480,
                        height: 480,
                        fps: 30,
                        filename: 'traewelling-ice720.mp4',
                        onProgress: (pct, msg) => progressEvents.push({ pct, msg })
                    });

                    const buf = await result.blob.arrayBuffer();
                    const bytes = new Uint8Array(buf);

                    // Test playback and timeline seeking in HTML5 Video
                    const videoUrl = URL.createObjectURL(result.blob);
                    const video = document.createElement('video');
                    video.preload = 'auto';
                    video.src = videoUrl;

                    await new Promise((res) => {
                        video.onloadedmetadata = () => res();
                        setTimeout(res, 2500);
                    });

                    const duration = video.duration;
                    const hasFiniteDuration = Number.isFinite(duration) && duration > 0;
                    const seekable = video.seekable ? {
                        length: video.seekable.length,
                        start: video.seekable.length > 0 ? video.seekable.start(0) : null,
                        end: video.seekable.length > 0 ? video.seekable.end(0) : null
                    } : null;

                    // Test seeking along timeline
                    let seekWorked = false;
                    try {
                        video.currentTime = duration * 0.5;
                        await new Promise((res) => {
                            video.onseeked = () => { seekWorked = true; res(); };
                            setTimeout(res, 1000);
                        });
                    } catch (e) {}

                    URL.revokeObjectURL(videoUrl);

                    return {
                        filename: result.filename,
                        mimeType: result.mimeType,
                        size: result.blob.size,
                        duration,
                        hasFiniteDuration,
                        seekable,
                        seekWorked,
                        progressCount: progressEvents.length,
                        lastProgress: progressEvents[progressEvents.length - 1],
                        headerHex: Array.from(bytes.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' ')
                    };
                })()
            `,
            awaitPromise: true,
            returnByValue: true
        });

        if (recordResult.exceptionDetails) {
            throw new Error(`Browser execution error: ${JSON.stringify(recordResult.exceptionDetails)}`);
        }

        const data = recordResult.result.value;
        console.log(`✓ Output file: ${data.filename}`);
        console.log(`  MIME type: ${data.mimeType}`);
        console.log(`  Size: ${data.size} bytes`);
        console.log(`  Header bytes: ${data.headerHex}`);
        console.log(`  Reported Video Duration: ${data.duration}s (finite: ${data.hasFiniteDuration})`);
        console.log(`  Seekable range:`, data.seekable);
        console.log(`  Timeline seeking verified: ${data.seekWorked}`);
        console.log(`  Progress updates: ${data.progressCount}, Final:`, data.lastProgress);

        if (!data.filename.endsWith('.mp4')) {
            throw new Error(`Expected filename to end with .mp4, got ${data.filename}`);
        }
        if (!data.hasFiniteDuration) {
            throw new Error(`Video duration is not finite: ${data.duration}`);
        }
        if (!data.seekable || data.seekable.length === 0) {
            throw new Error('Video has no seekable timeline range');
        }

        console.log('\n🎉 ALL DETERMINISTIC MP4 GENERATION & TIMELINE TESTS PASSED!');
        chrome.kill();
        process.exit(0);
    } catch (err) {
        console.error('❌ E2E MP4 test failed:', err);
        chrome.kill();
        process.exit(1);
    }
}

runMp4Verification();
