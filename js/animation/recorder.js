/**
 * In-Browser Deterministic Video Clip Recorder
 * Renders animated transit journeys frame-by-frame on an offscreen canvas
 * and encodes spec-compliant MP4 (default) or WebM video with exact duration & timeline.
 */

import { preloadTripTiles, preloadSceneTiles, MAP_STYLES } from './tiles.js';
import {
    extractRouteCoordinates,
    buildMapScene,
    buildAllTripsScene,
    computeAllModeTiming
} from './geometry.js';
import { renderTripFrame, renderAllTripsFrame } from './renderer.js';
import { fixWebMBlob } from './webmFixer.js';

/**
 * Analytical damped harmonic oscillator (exact equivalent of Remotion's spring)
 */
export function computeSpring({ frame, fps = 30, config = { damping: 18, stiffness: 90, mass: 1 } }) {
    if (frame <= 0) return 0;
    const m = config.mass || 1;
    const k = config.stiffness || 90;
    const c = config.damping || 18;
    const t = frame / fps;
    const omega0 = Math.sqrt(k / m);
    const zeta = c / (2 * Math.sqrt(m * k));
    if (zeta < 1) {
        const omegaD = omega0 * Math.sqrt(1 - zeta * zeta);
        const decay = Math.exp(-zeta * omega0 * t);
        return 1 - decay * (Math.cos(omegaD * t) + ((zeta * omega0) / omegaD) * Math.sin(omegaD * t));
    }
    return 1 - Math.exp(-omega0 * t) * (1 + omega0 * t);
}

export class VideoClipRecorder {
    constructor(playerRef = null, totalFrames = 240, fps = 30) {
        this.playerRef = playerRef;
        this.totalFrames = totalFrames;
        this.fps = fps;
        this.isRecording = false;
        this.isCancelled = false;
        this.mediaRecorder = null;
        this.chunks = [];
        this.activeStream = null;
    }

    /**
     * Determines optimal supported MIME type, prioritizing MP4 (H.264/AVC1)
     */
    static getOptimalMimeType() {
        if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
            return 'video/mp4';
        }
        const mimeCandidates = [
            'video/mp4;codecs=avc1',
            'video/mp4;codecs=h264',
            'video/mp4',
            'video/webm;codecs=vp9',
            'video/webm;codecs=vp8',
            'video/webm'
        ];
        for (const candidate of mimeCandidates) {
            if (MediaRecorder.isTypeSupported(candidate)) {
                return candidate;
            }
        }
        return 'video/mp4';
    }

    /**
     * Instantly aborts an in-progress export
     */
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
        this.isRecording = false;
    }

    async recordAndDownload({
        trip = null,
        trips = [],
        mode = 'single',
        username = 'Traveler',
        mapStyle = 'traewelling-dark',
        width = 960,
        height = 960,
        fps = 30,
        filename = 'traewelling-trip-clip.mp4',
        onProgress = () => {},
        signal = null
    }) {
        if (!trip && (!Array.isArray(trips) || trips.length === 0)) {
            throw new Error('Video player is not initialized yet.');
        }

        if (this.isRecording) {
            throw new Error('Recording is already in progress.');
        }

        this.isCancelled = false;
        this.isRecording = true;
        this.fps = fps;

        try {
            const isAllMode = mode === 'all' && Array.isArray(trips) && trips.length > 0;
            const coords = (!isAllMode && trip) ? extractRouteCoordinates(trip) : [];
            const scene = isAllMode
                ? buildAllTripsScene(trips, width, height, fps)
                : buildMapScene(coords, width, height);
            const allTiming = isAllMode ? computeAllModeTiming(trips, fps) : null;
            const styleConfig = MAP_STYLES[mapStyle] || MAP_STYLES['traewelling-dark'];

            // 1. Preload 100% of required map tiles into memory
            if (!styleConfig.isVector) {
                onProgress(2, 'Preloading map tiles…');
                if (isAllMode) {
                    await preloadSceneTiles(scene, mapStyle);
                } else if (trip) {
                    await preloadTripTiles(trip, mapStyle, width, height);
                }
            }

            if (this.isCancelled || (signal && signal.aborted)) {
                throw new Error('Recording cancelled by user');
            }

            // 2. Create dedicated decoupled off-screen render canvas
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                throw new Error('Canvas element context could not be created for rendering.');
            }

            if (typeof canvas.captureStream !== 'function') {
                throw new Error('canvas.captureStream is not supported in this browser environment.');
            }

            // 3. Negotiate container format & set up manual frame capture stream
            const mimeType = VideoClipRecorder.getOptimalMimeType();
            const isMp4 = mimeType.startsWith('video/mp4');
            const targetExt = isMp4 ? '.mp4' : '.webm';
            const baseName = filename.replace(/\.(webm|mp4)$/i, '');
            const finalFilename = `${baseName}${targetExt}`;

            // captureStream(0) allows manual frame clocking via requestFrame() without wall-clock drift
            const stream = canvas.captureStream(0);
            this.activeStream = stream;
            const track = stream.getVideoTracks()[0];

            this.chunks = [];
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

            // 4. Deterministic Frame-by-Frame Render Loop
            const totalFrames = this.totalFrames;
            const targetDurationMs = Math.round((totalFrames / fps) * 1000);
            const frameDelay = 1000 / fps;

            for (let f = 0; f < totalFrames; f++) {
                if (this.isCancelled || (signal && signal.aborted)) {
                    throw new Error('Recording cancelled by user');
                }

                if (isAllMode) {
                    renderAllTripsFrame({
                        ctx,
                        frame: f,
                        fps,
                        width,
                        height,
                        username,
                        allScene: scene,
                        timing: allTiming,
                        styleConfig
                    });
                } else {
                    const introSpring = computeSpring({ frame: f, fps, config: { damping: 18, stiffness: 90 } });
                    renderTripFrame({
                        ctx,
                        frame: f,
                        fps,
                        width,
                        height,
                        trip,
                        username,
                        coords,
                        scene,
                        styleConfig,
                        introSpring
                    });
                }

                if (track && typeof track.requestFrame === 'function') {
                    track.requestFrame();
                }

                const pct = 5 + Math.round(((f + 1) / totalFrames) * 88);
                onProgress(pct, `Rendering frame ${f + 1} of ${totalFrames} (${Math.round(((f + 1) / totalFrames) * 100)}%)…`);

                // Micro-interval to preserve precise timestamp pacing in the encoder
                await new Promise(r => setTimeout(r, frameDelay));
            }

            // 5. Finalize container
            onProgress(95, isMp4 ? 'Finalizing MP4 video container…' : 'Finalizing WebM container & seek index…');
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
            this.isRecording = false;

            let finalBlob = new Blob(this.chunks, { type: mimeType });
            if (!isMp4) {
                // For WebM fallback, inject Duration, Cues, SeekHead, and defined Segment size
                try {
                    finalBlob = await fixWebMBlob(finalBlob, { durationMs: targetDurationMs, fps });
                } catch (remuxErr) {
                    console.warn('WebM spec metadata remux fallback:', remuxErr);
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
