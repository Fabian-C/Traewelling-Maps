/**
 * Comprehensive E2E Test for WebM Generation & Spec Compliance
 */

import fs from 'fs';
import { spawn } from 'child_process';
import { inspectWebM } from '../../js/animation/webmFixer.js';

async function runWebMVerification() {
    console.log('====================================================');
    console.log('🎬 RUNNING WEBM GENERATION & SPEC VERIFICATION TEST');
    console.log('====================================================');

    const chrome = spawn('chromium-browser', [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--remote-debugging-port=9238',
        '--user-data-dir=/tmp/chrome-test-webm-e2e',
        'about:blank'
    ]);

    try {
        let pageTab = null;
        for (let i = 0; i < 25; i++) {
            await new Promise(r => setTimeout(r, 200));
            try {
                const res = await fetch('http://127.0.0.1:9238/json');
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

        // Test real recording and fixing in the browser context
        console.log('1. Simulating canvas playback and MediaRecorder stream in Chromium...');
        const recordResult = await send('Runtime.evaluate', {
            expression: `
                (async () => {
                    // Create simulated test canvas inside player container
                    const container = document.getElementById('playerContainer') || document.body;
                    const canvas = document.createElement('canvas');
                    canvas.id = 'tripClipCanvas';
                    canvas.width = 400;
                    canvas.height = 400;
                    container.appendChild(canvas);
                    const ctx = canvas.getContext('2d');

                    // Mock player
                    let curFrame = 0;
                    let isPlaying = false;
                    const player = {
                        pause: () => { isPlaying = false; },
                        play: () => { isPlaying = true; },
                        seekTo: (f) => { curFrame = f; },
                        getCurrentFrame: () => curFrame
                    };

                    // Draw loop
                    const totalFrames = 60; // 2 seconds at 30 fps
                    const drawInterval = setInterval(() => {
                        if (!isPlaying) return;
                        curFrame++;
                        ctx.fillStyle = curFrame % 2 === 0 ? '#1e293b' : '#3b82f6';
                        ctx.fillRect(0, 0, 400, 400);
                        ctx.fillStyle = '#ffffff';
                        ctx.font = '24px sans-serif';
                        ctx.fillText('Frame ' + curFrame, 20, 50);
                    }, 33);

                    // Import VideoClipRecorder directly from same origin
                    const { VideoClipRecorder } = await import('/js/animation/recorder.js');
                    const recorder = new VideoClipRecorder(player, totalFrames);

                    const progressEvents = [];
                    const result = await recorder.recordAndDownload({
                        mode: 'single',
                        filename: 'test-clip.webm',
                        onProgress: (pct, msg) => progressEvents.push({ pct, msg })
                    });

                    clearInterval(drawInterval);
                    const arrayBuf = await result.blob.arrayBuffer();

                    return {
                        filename: result.filename,
                        mimeType: result.mimeType,
                        durationMs: result.durationMs,
                        bytes: Array.from(new Uint8Array(arrayBuf)),
                        progressEventsCount: progressEvents.length,
                        finalProgress: progressEvents[progressEvents.length - 1]
                    };
                })()
            `,
            awaitPromise: true,
            returnByValue: true
        });

        if (recordResult.exceptionDetails) {
            throw new Error(`Browser execution error: ${JSON.stringify(recordResult.exceptionDetails)}`);
        }

        const resData = recordResult.result.value;
        console.log(`✓ Recording finished: ${resData.filename}`);
        console.log(`  MIME: ${resData.mimeType}, Size: ${resData.bytes.length} bytes, Target duration: ${resData.durationMs}ms`);
        console.log(`  Progress events received: ${resData.progressEventsCount}, Final: ${JSON.stringify(resData.finalProgress)}`);

        const fixedBytes = new Uint8Array(resData.bytes);
        fs.writeFileSync('/tmp/e2e_generated.webm', fixedBytes);

        // 2. Inspect with EBML parser
        console.log('\n2. Inspecting generated WebM with EBML validator...');
        const inspection = inspectWebM(fixedBytes);
        console.log('  EBML Header present:', inspection.hasEbmlHeader);
        console.log('  Segment present:', inspection.hasSegment);
        console.log('  Segment size defined:', !inspection.isIndeterminateSegment);
        console.log('  SeekHead present:', inspection.hasSeekHead);
        console.log('  Duration metadata present:', inspection.hasDuration, `(${inspection.durationMs}ms)`);
        console.log('  Cues index present:', inspection.hasCues, `(${inspection.cueCount} cue points)`);
        console.log('  Clusters recorded:', inspection.clusterCount, `(${inspection.blockCount} blocks)`);

        if (!inspection.hasEbmlHeader) throw new Error('Spec failure: EBML Header is missing');
        if (!inspection.hasSegment) throw new Error('Spec failure: Segment is missing');
        if (inspection.isIndeterminateSegment) throw new Error('Spec failure: Segment size is indeterminate');
        if (!inspection.hasSeekHead) throw new Error('Spec failure: SeekHead is missing');
        if (!inspection.hasDuration || inspection.durationMs <= 0) throw new Error('Spec failure: Duration metadata is missing or zero');
        if (!inspection.hasCues) throw new Error('Spec failure: Cues index is missing');

        // 3. Verify HTML5 Video playback and seeking in Chromium
        console.log('\n3. Testing HTML5 <video> seeking and scrubber in Chromium...');
        const fileBase64 = Buffer.from(fixedBytes).toString('base64');
        const playbackCheck = await send('Runtime.evaluate', {
            expression: `
                (async () => {
                    const video = document.createElement('video');
                    video.src = 'data:video/webm;base64,${fileBase64}';
                    await new Promise(r => {
                        video.onloadedmetadata = r;
                        video.onerror = (e) => r({ error: video.error?.message || 'load error' });
                    });

                    const reportedDuration = video.duration;
                    const isSeekable = video.seekable.length > 0;
                    const seekableStart = isSeekable ? video.seekable.start(0) : null;
                    const seekableEnd = isSeekable ? video.seekable.end(0) : null;

                    // Seek to 1.0s
                    video.currentTime = 1.0;
                    await new Promise(r => {
                        video.onseeked = r;
                        setTimeout(r, 1200);
                    });

                    return {
                        duration: reportedDuration,
                        isSeekable,
                        seekableStart,
                        seekableEnd,
                        seekedCurrentTime: video.currentTime
                    };
                })()
            `,
            awaitPromise: true,
            returnByValue: true
        });

        const playback = playbackCheck.result.value;
        console.log('  video.duration:', playback.duration, 'seconds');
        console.log('  video.seekable range: [', playback.seekableStart, 'to', playback.seekableEnd, ']');
        console.log('  video.currentTime after seeking to 1.0s:', playback.seekedCurrentTime);

        if (playback.duration === null || playback.duration === Infinity || Number.isNaN(playback.duration)) {
            throw new Error(`Playback failure: video.duration is ${playback.duration}`);
        }
        if (!playback.isSeekable || playback.seekableEnd < 1.9) {
            throw new Error(`Playback failure: video is not seekable across its full range`);
        }
        if (Math.abs(playback.seekedCurrentTime - 1.0) > 0.1) {
            throw new Error(`Playback failure: seeking failed to reach target timestamp`);
        }

        // 4. Test multi-second scenario with multiple seeks
        console.log('\n4. Testing longer 4-second clip recording and multi-point seeking...');
        const recordResult4s = await send('Runtime.evaluate', {
            expression: `
                (async () => {
                    const canvas = document.getElementById('tripClipCanvas');
                    const ctx = canvas.getContext('2d');
                    let curFrame = 0;
                    let isPlaying = false;
                    const player = {
                        pause: () => { isPlaying = false; },
                        play: () => { isPlaying = true; },
                        seekTo: (f) => { curFrame = f; },
                        getCurrentFrame: () => curFrame
                    };

                    const totalFrames = 120; // 4 seconds at 30 fps
                    const drawInterval = setInterval(() => {
                        if (!isPlaying) return;
                        curFrame++;
                        ctx.fillStyle = curFrame % 3 === 0 ? '#0f172a' : (curFrame % 3 === 1 ? '#059669' : '#d97706');
                        ctx.fillRect(0, 0, 400, 400);
                        ctx.fillStyle = '#ffffff';
                        ctx.font = '28px sans-serif';
                        ctx.fillText('Timestamp: ' + (curFrame / 30).toFixed(2) + 's', 20, 60);
                    }, 33);

                    const { VideoClipRecorder } = await import('/js/animation/recorder.js');
                    const recorder = new VideoClipRecorder(player, totalFrames);

                    const result = await recorder.recordAndDownload({
                        mode: 'single',
                        filename: 'test-clip-4s.webm',
                        onProgress: () => {}
                    });

                    clearInterval(drawInterval);
                    const arrayBuf = await result.blob.arrayBuffer();

                    return {
                        filename: result.filename,
                        durationMs: result.durationMs,
                        bytes: Array.from(new Uint8Array(arrayBuf))
                    };
                })()
            `,
            awaitPromise: true,
            returnByValue: true
        });

        const resData4s = recordResult4s.result.value;
        const fixedBytes4s = new Uint8Array(resData4s.bytes);
        const inspection4s = inspectWebM(fixedBytes4s);
        console.log(`✓ 4s Clip recorded (${fixedBytes4s.length} bytes, duration: ${inspection4s.durationMs}ms, cueCount: ${inspection4s.cueCount})`);

        const fileBase644s = Buffer.from(fixedBytes4s).toString('base64');
        const playbackCheck4s = await send('Runtime.evaluate', {
            expression: `
                (async () => {
                    const video = document.createElement('video');
                    video.src = 'data:video/webm;base64,${fileBase644s}';
                    await new Promise(r => {
                        video.onloadedmetadata = r;
                        video.onerror = r;
                    });

                    // Test seeking to multiple positions
                    const seekPoints = [1.0, 2.5, 3.8];
                    const seekResults = [];
                    for (const target of seekPoints) {
                        video.currentTime = target;
                        await new Promise(r => {
                            video.onseeked = r;
                            setTimeout(r, 800);
                        });
                        seekResults.push({ target, actual: video.currentTime });
                    }

                    return {
                        duration: video.duration,
                        seekResults
                    };
                })()
            `,
            awaitPromise: true,
            returnByValue: true
        });

        const play4s = playbackCheck4s.result.value;
        console.log('  Reported duration:', play4s.duration, 'seconds');
        console.log('  Multi-seek verification:', JSON.stringify(play4s.seekResults));
        for (const s of play4s.seekResults) {
            if (Math.abs(s.actual - s.target) > 0.15) {
                throw new Error(`Seek deviation too high: target ${s.target}, got ${s.actual}`);
            }
        }

        console.log('\n====================================================');
        console.log('🎉 ALL WEBM SPEC TESTS PASSED SUCCESSFULLY!');
        console.log('====================================================');
        chrome.kill();
        process.exit(0);
    } catch (err) {
        console.error('TEST ERROR:', err);
        chrome.kill();
        process.exit(1);
    }
}

runWebMVerification();
