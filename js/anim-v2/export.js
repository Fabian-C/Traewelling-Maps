/**
 * Deterministic MP4 Video Exporter (V2 Engine)
 * Renders offline frame-by-frame on an isolated offscreen canvas
 * with exact timeline duration, seekable index, and instant abort control.
 */

import { renderV2Frame } from './renderer.js';
import { preloadTripTiles, preloadSceneTiles, MAP_STYLES } from '../animation/tiles.js';
import { fixWebMBlob } from '../animation/webmFixer.js';

export class VideoClipExporterV2 {
    constructor() {
        this.isExporting = false;
        this.isCancelled = false;
        this.mediaRecorder = null;
        this.activeStream = null;
        this.chunks = [];
    }

    /**
     * Determines optimal supported MIME type, prioritizing MP4 (H.264/AVC1)
     */
    static getOptimalMimeType() {
        if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
            return 'video/mp4';
        }
        const candidates = [
            'video/mp4;codecs=avc1',
            'video/mp4;codecs=h264',
            'video/mp4',
            'video/webm;codecs=vp9',
            'video/webm;codecs=vp8',
            'video/webm'
        ];
        for (const candidate of candidates) {
            if (MediaRecorder.isTypeSupported(candidate)) {
                return candidate;
            }
        }
        return 'video/mp4';
    }

    cancel() {
        this.isCancelled = true;
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            try {
                this.mediaRecorder.stop();
            } catch {
                /* ignore */
            }
        }
        if (this.activeStream) {
            try {
                this.activeStream.getTracks().forEach(t => t.stop());
            } catch {
                /* ignore */
            }
            this.activeStream = null;
        }
        this.isExporting = false;
    }

    async exportAndDownload({
        trip = null,
        trips = [],
        mode = 'single',
        username = 'Traveler',
        mapStyle = 'traewelling-dark',
        width = 960,
        height = 960,
        fps = 30,
        totalFrames = 240,
        precompute = null,
        filename = 'traewelling-journey.mp4',
        onProgress = () => {},
        signal = null
    }) {
        if (this.isExporting) {
            throw new Error('Export is already running.');
        }

        this.isExporting = true;
        this.isCancelled = false;
        this.chunks = [];

        try {
            const isAllMode = mode === 'all';
            const styleConfig = MAP_STYLES[mapStyle] || MAP_STYLES['traewelling-dark'];

            // 1. Preload tiles
            if (!styleConfig.isVector) {
                onProgress(2, 'Preloading map tiles…');
                if (isAllMode && precompute?.allScene) {
                    await preloadSceneTiles(precompute.allScene, mapStyle);
                } else if (trip && precompute?.scene) {
                    await preloadTripTiles(trip, mapStyle, width, height);
                }
            }

            if (this.isCancelled || (signal && signal.aborted)) {
                throw new Error('Export cancelled by user');
            }

            // 2. Offscreen render canvas
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                throw new Error('Failed to create offscreen canvas context.');
            }

            if (typeof canvas.captureStream !== 'function') {
                throw new Error('canvas.captureStream is not supported in this browser.');
            }

            const mimeType = VideoClipExporterV2.getOptimalMimeType();
            const isMp4 = mimeType.startsWith('video/mp4');
            const targetExt = isMp4 ? '.mp4' : '.webm';
            const baseName = filename.replace(/\.(webm|mp4)$/i, '');
            const finalFilename = `${baseName}${targetExt}`;

            // captureStream(0) allows manual frame clocking via requestFrame()
            const stream = canvas.captureStream(0);
            this.activeStream = stream;
            const track = stream.getVideoTracks()[0];

            this.mediaRecorder = new MediaRecorder(stream, {
                mimeType,
                videoBitsPerSecond: 10000000
            });

            this.mediaRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) {
                    this.chunks.push(e.data);
                }
            };

            this.mediaRecorder.start();

            // 3. Deterministic Frame Loop
            const frameDelay = 1000 / fps;
            const targetDurationMs = Math.round((totalFrames / fps) * 1000);

            for (let f = 0; f < totalFrames; f++) {
                if (this.isCancelled || (signal && signal.aborted)) {
                    throw new Error('Export cancelled by user');
                }

                renderV2Frame({
                    ctx,
                    frame: f,
                    fps,
                    width,
                    height,
                    trip,
                    trips,
                    mode,
                    username,
                    mapStyle,
                    precompute
                });

                if (track && typeof track.requestFrame === 'function') {
                    track.requestFrame();
                }

                const pct = 5 + Math.round(((f + 1) / totalFrames) * 88);
                onProgress(pct, `Rendering frame ${f + 1} of ${totalFrames} (${Math.round(((f + 1) / totalFrames) * 100)}%)…`);

                await new Promise(r => setTimeout(r, frameDelay));
            }

            // 4. Finalize
            onProgress(95, isMp4 ? 'Finalizing MP4 video container…' : 'Finalizing WebM container…');
            await new Promise(r => setTimeout(r, 120));

            const stopPromise = new Promise((resolve, reject) => {
                this.mediaRecorder.onstop = resolve;
                this.mediaRecorder.onerror = reject;
            });

            if (this.mediaRecorder.state !== 'inactive') {
                this.mediaRecorder.stop();
            }
            await stopPromise;

            if (this.activeStream) {
                this.activeStream.getTracks().forEach(t => t.stop());
                this.activeStream = null;
            }
            this.isExporting = false;

            let finalBlob = new Blob(this.chunks, { type: mimeType });
            if (!isMp4) {
                try {
                    finalBlob = await fixWebMBlob(finalBlob, { durationMs: targetDurationMs, fps });
                } catch (remuxErr) {
                    console.warn('WebM metadata remux fallback:', remuxErr);
                }
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
            return { blob: finalBlob, filename: finalFilename, mimeType, durationMs: targetDurationMs };
        } catch (err) {
            this.cancel();
            throw err;
        }
    }
}
