/**
 * In-Browser WebM Video Recorder
 */

import { preloadTripTiles } from './composition.js';

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
        if (trip) {
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
        await new Promise(r => setTimeout(r, 120));

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
        const recordingPromise = new Promise((resolve, reject) => {
            this.mediaRecorder.onstop = () => {
                const blob = new Blob(this.chunks, { type: mimeType });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = finalFilename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 10000);
                resolve({ blob, filename: finalFilename, mimeType });
            };
            this.mediaRecorder.onerror = reject;
        });

        this.mediaRecorder.start(100);
        this.isRecording = true;
        this.playerRef.play();

        let lastFrame = 0;
        let hasProgressed = false;
        const maxDurationMs = Math.ceil((totalFrames / 30) * 1000) + 2500;
        const startTime = Date.now();

        const stopRecording = () => {
            clearInterval(checkEnd);
            this.playerRef.pause();
            if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                this.mediaRecorder.stop();
            }
            this.isRecording = false;
        };

        const checkEnd = setInterval(() => {
            const currentFrame = this.playerRef.getCurrentFrame();
            if (currentFrame > 20) {
                hasProgressed = true;
            }
            const wrappedAround = hasProgressed && currentFrame < lastFrame;
            const timedOut = Date.now() - startTime > maxDurationMs;
            lastFrame = currentFrame;

            const pct = wrappedAround ? 100 : 10 + Math.min(90, Math.round((currentFrame / totalFrames) * 90));
            onProgress(pct, `Recording (${Math.min(100, Math.round((currentFrame / totalFrames) * 100))}%)…`);

            if (currentFrame >= totalFrames - 2 || wrappedAround || timedOut) {
                stopRecording();
            }
        }, 45);

        return recordingPromise;
    }
}
