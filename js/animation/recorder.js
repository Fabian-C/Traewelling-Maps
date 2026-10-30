/**
 * In-Browser WebM Video Recorder
 * Generates spec-compliant, seekable WebM video clips from HTML5 Canvas
 */

import { preloadTripTiles, preloadSceneTiles } from './tiles.js';
import { buildAllTripsScene } from './geometry.js';
import { fixWebMBlob } from './webmFixer.js';

export class VideoClipRecorder {
    constructor(playerRef, totalFrames = 240) {
        this.playerRef = playerRef;
        this.totalFrames = totalFrames;
        this.isRecording = false;
        this.mediaRecorder = null;
        this.chunks = [];
    }

    async recordAndDownload({
        trip = null,
        trips = [],
        mode = 'single',
        mapStyle = 'traewelling-dark',
        width = 960,
        height = 960,
        filename = 'traewelling-trip-clip.webm',
        onProgress = () => {}
    }) {
        if (!this.playerRef) {
            throw new Error('Video player is not initialized yet.');
        }

        // Silently ensure all map tiles for the scene are loaded and decoded before recording
        if (mode === 'all' && Array.isArray(trips) && trips.length > 0) {
            onProgress(5, 'Preparing all-rides map scene…');
            const allScene = buildAllTripsScene(trips, width, height);
            await preloadSceneTiles(allScene, mapStyle);
        } else if (trip) {
            onProgress(5, 'Preparing…');
            await preloadTripTiles(trip, mapStyle, width, height);
        }

        const container = document.getElementById('playerContainer');
        const canvas = container
            ? (container.querySelector('#tripClipCanvas') || container.querySelector('canvas'))
            : document.getElementById('tripClipCanvas');

        if (!canvas) {
            throw new Error('Video canvas element not found in player.');
        }

        this.playerRef.pause();
        this.playerRef.seekTo(0);
        await new Promise(r => setTimeout(r, 150));

        const stream = canvas.captureStream(30);

        const mimeCandidates = [
            'video/webm;codecs=vp9',
            'video/webm;codecs=vp8',
            'video/webm'
        ];
        let mimeType = 'video/webm';
        for (const candidate of mimeCandidates) {
            if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(candidate)) {
                mimeType = candidate;
                break;
            }
        }

        const finalFilename = filename.replace(/\.(webm|mp4)$/i, '') + '.webm';

        this.chunks = [];
        this.mediaRecorder = new MediaRecorder(stream, {
            mimeType,
            videoBitsPerSecond: 8000000
        });

        this.mediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
                this.chunks.push(e.data);
            }
        };

        const totalFrames = this.totalFrames;
        const targetDurationMs = Math.round((totalFrames / 30) * 1000);

        const recordingPromise = new Promise((resolve, reject) => {
            this.mediaRecorder.onstop = async () => {
                try {
                    onProgress(94, 'Finalizing WebM container & seek index…');
                    const rawBlob = new Blob(this.chunks, { type: mimeType });

                    // Re-mux EBML container to inject Duration, Cues, SeekHead, and defined Segment size
                    let finalBlob = rawBlob;
                    try {
                        finalBlob = await fixWebMBlob(rawBlob, { durationMs: targetDurationMs, fps: 30 });
                    } catch (remuxErr) {
                        console.warn('WebM spec metadata remux fallback:', remuxErr);
                    }

                    const url = URL.createObjectURL(finalBlob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = finalFilename;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    setTimeout(() => URL.revokeObjectURL(url), 10000);

                    onProgress(100, 'Video ready!');
                    resolve({ blob: finalBlob, filename: finalFilename, mimeType, durationMs: targetDurationMs });
                } catch (err) {
                    reject(err);
                }
            };
            this.mediaRecorder.onerror = reject;
        });

        this.mediaRecorder.start(100);
        this.isRecording = true;
        this.playerRef.play();

        let lastFrame = 0;
        let hasProgressed = false;
        let stopping = false;
        const maxDurationMs = Math.ceil((totalFrames / 30) * 1000) + 3500;
        const startTime = Date.now();

        const stopRecording = async () => {
            if (stopping) return;
            stopping = true;
            clearInterval(checkEnd);
            this.playerRef.pause();
            // Guarantee final frame is drawn and held
            this.playerRef.seekTo(totalFrames - 1);
            // Allow settling delay to flush final frame into MediaRecorder
            await new Promise(r => setTimeout(r, 200));
            if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                this.mediaRecorder.stop();
            }
            this.isRecording = false;
        };

        const checkEnd = setInterval(() => {
            const currentFrame = this.playerRef.getCurrentFrame();
            if (currentFrame > 15) {
                hasProgressed = true;
            }
            const wrappedAround = hasProgressed && currentFrame < lastFrame;
            const reachedEnd = currentFrame >= totalFrames - 1;
            const timedOut = Date.now() - startTime > maxDurationMs;
            lastFrame = currentFrame;

            const pct = (reachedEnd || wrappedAround)
                ? 92
                : 10 + Math.min(82, Math.round((currentFrame / totalFrames) * 82));

            onProgress(pct, `Recording (${Math.min(100, Math.round((currentFrame / totalFrames) * 100))}%)…`);

            if (reachedEnd || wrappedAround || timedOut) {
                stopRecording();
            }
        }, 20);

        return recordingPromise;
    }
}
