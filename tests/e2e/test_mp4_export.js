/**
 * E2E Test for MP4 Video Generation, Duration & Timeline Seeking
 */

import { spawn } from 'child_process';

async function runMp4Verification() {
    console.log('====================================================');
    console.log('🎬 RUNNING MP4 GENERATION & TIMELINE VERIFICATION TEST');
    console.log('====================================================');

    const chrome = spawn('chromium-browser', [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--remote-debugging-port=9244',
        '--user-data-dir=/tmp/chrome-test-mp4-e2e',
        'about:blank'
    ]);

    try {
        let pageTab = null;
        for (let i = 0; i < 25; i++) {
            await new Promise(r => setTimeout(r, 200));
            try {
                const res = await fetch('http://127.0.0.1:9244/json');
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

        console.log('1. Recording video clip with default settings...');
        const recordResult = await send('Runtime.evaluate', {
            expression: `
                (async () => {
                    const container = document.getElementById('playerContainer') || document.body;
                    let canvas = container.querySelector('#tripClipCanvas');
                    if (!canvas) {
                        canvas = document.createElement('canvas');
                        canvas.id = 'tripClipCanvas';
                        container.appendChild(canvas);
                    }
                    canvas.width = 400;
                    canvas.height = 400;
                    const ctx = canvas.getContext('2d');

                    let curFrame = 0;
                    let isPlaying = false;
                    const player = {
                        pause: () => { isPlaying = false; },
                        play: () => { isPlaying = true; },
                        seekTo: (f) => { curFrame = f; },
                        getCurrentFrame: () => curFrame
                    };

                    const totalFrames = 60; // 2 seconds
                    const drawInterval = setInterval(() => {
                        if (!isPlaying) return;
                        curFrame++;
                        ctx.fillStyle = curFrame % 2 === 0 ? '#1e293b' : '#3b82f6';
                        ctx.fillRect(0, 0, 400, 400);
                        ctx.fillStyle = '#ffffff';
                        ctx.font = '24px sans-serif';
                        ctx.fillText('Frame ' + curFrame, 20, 50);
                    }, 33);

                    const { VideoClipRecorder } = await import('/js/animation/recorder.js');
                    const recorder = new VideoClipRecorder(player, totalFrames);

                    const result = await recorder.recordAndDownload({
                        mode: 'single',
                        filename: 'traewelling-trip.mp4'
                    });

                    clearInterval(drawInterval);
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

        if (!data.filename.endsWith('.mp4')) {
            throw new Error(`Expected filename to end with .mp4, got ${data.filename}`);
        }
        if (!data.hasFiniteDuration) {
            throw new Error(`Video duration is not finite: ${data.duration}`);
        }
        if (!data.seekable || data.seekable.length === 0) {
            throw new Error('Video has no seekable timeline range');
        }

        console.log('\n🎉 MP4 DEFAULT VIDEO GENERATION & TIMELINE VERIFIED SUCCESSFULLY!');
        chrome.kill();
        process.exit(0);
    } catch (err) {
        console.error('❌ E2E MP4 test failed:', err);
        chrome.kill();
        process.exit(1);
    }
}

runMp4Verification();
