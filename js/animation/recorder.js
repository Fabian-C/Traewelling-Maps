/**
 * In-Browser Video Clip Recorder
 * Preloads 100% of required map tiles, then captures the 1280x720 HTML5 canvas stream
 * into a downloadable video file (.webm / .mp4) suitable for Twitter/X, Mastodon, and Bluesky.
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
        width = 1280,
        height = 720,
        filename = 'traewelling-trip-clip.webm',
        onProgress = () => {}
    }) {
        if (!this.playerRef) {
            throw new Error('Video player is not initialized yet.');
        }

        // Step 1: Guarantee 100% of map tiles for this trip & map style are loaded and decoded
        if (trip) {
            await preloadTripTiles(trip, mapStyle, width, height, ({ loaded, total }) => {
                if (total > 0) {
                    onProgress(Math.round((loaded / total) * 15), `Preloading map tiles (${loaded}/${total})...`);
                }
            });
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
            'video/mp4;codecs=avc1',
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

        const ext = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
        const finalFilename = filename.replace(/\.(webm|mp4)$/i, '') + '.' + ext;

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

        const checkEnd = setInterval(() => {
            const currentFrame = this.playerRef.getCurrentFrame();
            const pct = 15 + Math.min(85, Math.round((currentFrame / totalFrames) * 85));
            onProgress(pct, `Recording video (${Math.round((currentFrame / totalFrames) * 100)}%)...`);

            if (currentFrame >= totalFrames - 2) {
                clearInterval(checkEnd);
                this.playerRef.pause();
                if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                    this.mediaRecorder.stop();
                }
                this.isRecording = false;
            }
        }, 80);

        return recordingPromise;
    }
}
